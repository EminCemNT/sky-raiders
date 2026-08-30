// qa_opt13_a7_rage.mjs —— OPT-13 批A A7 Boss 狂暴终结技 验收探针
//
// 验证：
//   1) RAGE 配置块字段齐备（hpThreshold=0.15 / windowMs=8000 / needDmgRatio=0.10 /
//      failHealRatio=0.20 / staggerMs=2000 / dmgMulOnStagger=2 / moveSpeedMul=0.5 /
//      gapMul=3 / fireGapMs=500）
//   2) Boss 实例字段齐备（_enrageTriggered/_enraging/_enrageDmgAcc/_enrageEscUntil）
//   3) hp < 15% 触发狂暴（_enrageTriggered=true / _enraging=true / BOSS_PHASE=3 横幅）
//   4) 安全缝隙硬红线：缺口线性宽度 ≥ 玩家机身 ×3，且风暴弹幕缝隙内零落弹
//   5) 3 组轮换 + 旋转缝隙（_enrageStormGroup 递增 / 缝隙角变化）
//   6) DPS 窗口失败 → 回血至 maxHp×20% + 立即全屏弹幕 + 窗口重启（可重复）
//   7) DPS 窗口成功 → 破绽 2s（受击 ×2 + _isStaggered）
//   8) 狂暴期横移 -50%（90px/s → 45px/s）
//   9) reduced-motion / 性能档 low 下弹幕密度减半（_density=0.5）
//  10) 击杀仍走正常 die() → BOSS_DEFEATED 单次触发
//  11) 零 pageerror / console error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

async function startGame(page, levelId = 1) {
  await page.evaluate((lid) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: 'normal', levelId: lid });
  }, levelId);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active && gs.waves;
  }, { timeout: 20000 });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

// ── 1) RAGE 配置块 ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const r = m.RAGE;
  return {
    r,
    fields: ['hpThreshold', 'windowMs', 'needDmgRatio', 'failHealRatio', 'staggerMs',
      'dmgMulOnStagger', 'moveSpeedMul', 'gapMul', 'fireGapMs'],
  };
});
const rc = cfg.r || {};
push('RAGE 配置块字段齐备',
  cfg.fields.every((k) => typeof rc[k] === 'number'),
  `hpThreshold=${rc.hpThreshold}`);
push('RAGE 关键数值 = 规格（0.15/8000/0.10/0.20/2000/2/0.5/3/500）',
  rc.hpThreshold === 0.15 && rc.windowMs === 8000 && rc.needDmgRatio === 0.10 &&
  rc.failHealRatio === 0.20 && rc.staggerMs === 2000 && rc.dmgMulOnStagger === 2 &&
  rc.moveSpeedMul === 0.5 && rc.gapMul === 3 && rc.fireGapMs === 500,
  JSON.stringify({ h: rc.hpThreshold, w: rc.windowMs, need: rc.needDmgRatio, heal: rc.failHealRatio, s: rc.staggerMs, d: rc.dmgMulOnStagger, m: rc.moveSpeedMul, g: rc.gapMul, f: rc.fireGapMs }));
push('狂暴阈值 0.15 与阶段机阈值(0.33/0.66)区分（不触碰阶段机）',
  rc.hpThreshold === 0.15 && rc.hpThreshold < 0.33);

// ── 2) 构造独立 Boss + 实例字段 ──
await startGame(page, 1);
const created = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const { default: Boss } = await import('/src/entities/Boss.js');
  const b = new Boss(gs, 'boss_test', { maxHp: 1000, pattern: 'fan', color: 0xff0000, difficulty: 1 });
  gs.tweens.killTweensOf(b);   // 停掉入场 tween，避免 y 被演出覆盖
  b._entering = false;
  window.__A7BOSS__ = b;
  return {
    hasFields: ['_enrageTriggered', '_enraging', '_enrageDmgAcc', '_enrageEscUntil']
      .every((k) => k in b),
    hp: b.hp, maxHp: b.maxHp,
  };
});
push('Boss 实例含狂暴四字段（_enrageTriggered/_enraging/_enrageDmgAcc/_enrageEscUntil）',
  created.hasFields, JSON.stringify(created));

// ── 3) hp < 15% 触发狂暴 ──
const trig = await page.evaluate(async () => {
  const b = window.__A7BOSS__;
  const { EventBus } = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  const phases = [];
  const h = (p) => phases.push(p);
  EventBus.on(EV.BOSS_PHASE, h);
  b.hp = 1000;
  b.hit(900);   // hp=100 < 15% → 应触发狂暴（且阶段机 → phase 3）
  EventBus.off(EV.BOSS_PHASE, h);
  return {
    triggered: b._enrageTriggered, enraging: b._enraging,
    phase: b.phase, phases, hp: b.hp,
  };
});
push('hp<15% 触发狂暴（_enrageTriggered=true / _enraging=true）',
  trig.triggered === true && trig.enraging === true,
  `hp=${trig.hp} phase=${trig.phase}`);
push('触发时发出 BOSS_PHASE=3（UIScene『狂暴』横幅接线）',
  trig.phases.length >= 1 && trig.phases.every((p) => p === 3),
  `phases=${trig.phases.join(',')}`);

// ── 4) 安全缝隙硬红线 ──
const gap = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const b = window.__A7BOSS__;
  const R = (await import('/src/config/GameConfig.js')).RAGE;
  b._enraging = true; b._enrageTriggered = true;
  b._enrageStormGroup = 0; b._enrageStormAng = 0;
  b.y = 150;
  const fired = [];
  const orig = b.spawnBullet.bind(b);
  b.spawnBullet = (ang, spd) => { fired.push({ ang, spd }); };
  b._patternEnrageStorm();
  b.spawnBullet = orig;
  const playerW = (gs.player && gs.player.displayWidth) || 40;
  const dist = Math.max(120, 960 - b.y - 40);
  const gapHalf = b._enrageGapHalf();
  const lo = Math.PI * 0.18, hi = Math.PI * 0.82;
  const raw = Math.PI / 2 + Math.sin(b._enrageStormAng) * 0.9;
  const gapCenter = Math.min(Math.max(raw, lo + gapHalf + 0.06), hi - gapHalf - 0.06);
  const inGap = fired.filter((f) => Math.abs(f.ang - gapCenter) < gapHalf);
  const linear = 2 * Math.sin(gapHalf) * dist;
  return {
    fired: fired.length, inGap: inGap.length,
    gapHalf, gapCenter, linear, needLinear: playerW * R.gapMul,
    groupAfter: b._enrageStormGroup,
  };
});
push('风暴弹幕发射（非空）', gap.fired > 0, `fired=${gap.fired}`);
push('安全缝隙硬红线：缺口线性宽度 ≥ 玩家机身×3', gap.linear >= gap.needLinear,
  `linear=${gap.linear.toFixed(1)}px need=${gap.needLinear}px`);
push('安全缝隙内零落弹', gap.inGap === 0, `inGap=${gap.inGap}`);

// ── 5) 3 组轮换 + 旋转缝隙 ──
const groups = await page.evaluate(() => {
  const b = window.__A7BOSS__;
  const orig = b.spawnBullet.bind(b);
  const counts = [];
  const centers = [];
  const beforeAng = b._enrageStormAng;
  const groupBefore = b._enrageStormGroup;
  for (let g = 0; g < 3; g++) {
    let n = 0;
    b.spawnBullet = () => { n++; };
    b._patternEnrageStorm();
    b.spawnBullet = orig;
    counts.push(n);
    centers.push(Math.PI / 2 + Math.sin(b._enrageStormAng) * 0.9);
  }
  b.spawnBullet = orig;
  return {
    counts, centers, groupAdvance: b._enrageStormGroup - groupBefore,
    angChanged: Math.abs(b._enrageStormAng - beforeAng) > 1.0,
    distinct: new Set(centers.map((c) => c.toFixed(2))).size,
  };
});
push('狂暴弹幕 3 组轮换（连发 3 组，组计数 +3）', groups.groupAdvance === 3,
  `counts=${groups.counts.join(',')} advance=${groups.groupAdvance}`);
push('安全缝隙旋转（每组缝隙朝向不同）', groups.distinct >= 2 && groups.angChanged,
  `distinct=${groups.distinct}`);

// ── 6) DPS 窗口失败 → 回血 20% + 全屏弹幕 + 窗口重启 ──
const fail = await page.evaluate(async () => {
  const b = window.__A7BOSS__;
  const R = (await import('/src/config/GameConfig.js')).RAGE;
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  const { EventBus } = await import('/src/utils/EventBus.js');
  b._enraging = true; b._enrageTriggered = true;
  b._enrageDmgAcc = 0;
  b._enrageWindowStart = b.scene.time.now - R.windowMs - 1;
  b.hp = 100;                       // < 20%
  let stormFired = 0;
  const orig = b._patternEnrageStorm.bind(b);
  b._patternEnrageStorm = () => { stormFired++; orig(); };
  const labels = [];
  const h = (p) => { if (p && p.label) labels.push(p.label); };
  EventBus.on(EV.FLOAT_SCORE, h);
  b._updateEnrage(0);
  EventBus.off(EV.FLOAT_SCORE, h);
  b._patternEnrageStorm = orig;
  return {
    stormFired, labels,
    healOk: Math.abs(b.hp - b.maxHp * R.failHealRatio) < 0.01,
    hp: b.hp, expected: b.maxHp * R.failHealRatio,
    windowRestarted: (b.scene.time.now - b._enrageWindowStart) < R.windowMs,
  };
});
push('DPS 失败：回血至 maxHp×20%', fail.healOk, `hp=${fail.hp}/${fail.expected}`);
push('DPS 失败：立即释放一次全屏弹幕 + 狂暴回涌提示', fail.stormFired >= 1 && fail.labels.includes('狂暴回涌'),
  `storm=${fail.stormFired} labels=${fail.labels.join(',')}`);
push('DPS 失败：窗口重启（可重复触发）', fail.windowRestarted);

// ── 7) DPS 窗口成功 → 破绽 2s（受击 ×2 + _isStaggered） ──
const success = await page.evaluate(async () => {
  const b = window.__A7BOSS__;
  const R = (await import('/src/config/GameConfig.js')).RAGE;
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  const { EventBus } = await import('/src/utils/EventBus.js');
  b._enraging = true; b._enrageTriggered = true;
  b._enrageEscUntil = 0;
  b.hp = 200;                                    // 保持 phase 3（ratio 0.2），不触发阶段机
  b._enrageDmgAcc = b.maxHp * R.needDmgRatio;    // 达标（maxHp×10%）
  b._enrageWindowStart = b.scene.time.now - R.windowMs - 1;
  const labels = [];
  const h = (p) => { if (p && p.label) labels.push(p.label); };
  EventBus.on(EV.FLOAT_SCORE, h);
  b._updateEnrage(0);
  EventBus.off(EV.FLOAT_SCORE, h);
  const staggered = b._isStaggered();
  // 破绽期间受击 ×2
  b.hit(50);
  const hpDrop = 200 - b.hp;
  return {
    staggered, hpDrop, expectedDrop: 50 * R.dmgMulOnStagger,
    escUntilFuture: b._enrageEscUntil > b.scene.time.now,
    labels,
  };
});
push('DPS 达标：破绽 2s（_isStaggered=true + 硬直窗口未来）',
  success.staggered === true && success.escUntilFuture === true,
  `escUntil=${success.escUntilFuture}`);
push('破绽期间受击 ×2', success.hpDrop === success.expectedDrop,
  `drop=${success.hpDrop}/${success.expectedDrop} labels=${success.labels.join(',')}`);

// ── 8) 狂暴期横移 -50%（90 → 45 px/s） ──
const move = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const b = window.__A7BOSS__;
  const R = (await import('/src/config/GameConfig.js')).RAGE;
  b._enraging = true; b._enrageTriggered = true;
  b._enrageEscUntil = 0;
  b._enrageWindowStart = gs.time.now;            // 防 DPS 结算
  b._enrageFireUntil = gs.time.now + 100000;     // 防风暴干扰
  b._lastFire = gs.time.now + 100000;            // 防普通弹幕（对照档）
  b._dir = 1; b.x = 200; b.y = 150;
  b.update(b.scene.time.now, 1000);
  const movedEnrage = Math.abs(b.x - 200);
  // 对照：非狂暴 90px/s
  b._enraging = false; b.x = 200;
  b.update(b.scene.time.now, 1000);
  const movedNormal = Math.abs(b.x - 200);
  b._enraging = true;
  return { movedEnrage, movedNormal, expectedEnrage: 90 * R.moveSpeedMul };
});
push('狂暴期横移 -50%（90 → 45 px/s）',
  Math.abs(move.movedEnrage - move.expectedEnrage) <= 1.5 && Math.abs(move.movedNormal - 90) <= 1.5,
  `enrage=${move.movedEnrage.toFixed(1)} normal=${move.movedNormal.toFixed(1)}`);

// ── 9) reduced-motion / 性能档 low 下密度减半 ──
const dens = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const b = window.__A7BOSS__;
  const realQS = gs.qualityScale;
  b._enraging = true; b._shieldBroken = false;
  gs.qualityScale = 0.45;                        // low 档
  const dLow = b._density();
  gs.qualityScale = 1;                           // high 档
  const dHigh = b._density();
  gs.qualityScale = realQS;
  return { dLow, dHigh };
});
push('性能档 low 下狂暴弹幕密度减半（_density=0.5）', dens.dLow === 0.5 && dens.dHigh === 1,
  `low=${dens.dLow} high=${dens.dHigh}`);

// ── 10) 击杀仍走正常 die() → BOSS_DEFEATED 单次触发（最后执行，避免干扰后续步骤） ──
const dieTest = await page.evaluate(async () => {
  const b = window.__A7BOSS__;
  const { EventBus } = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  let defeated = 0;
  const h = () => defeated++;
  EventBus.on(EV.BOSS_DEFEATED, h);
  b._enraging = true; b._enrageTriggered = true;
  b.hp = 10;
  b.hit(99999);                                  // 致死 → die()
  EventBus.off(EV.BOSS_DEFEATED, h);
  return { defeated, active: b.active };
});
push('狂暴态击杀走正常 die() → BOSS_DEFEATED 单次触发', dieTest.defeated === 1 && dieTest.active === false,
  `defeated=${dieTest.defeated} active=${dieTest.active}`);

// ── 11) 零报错 ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a7_rage: PASS ===' : '=== qa_opt13_a7_rage: FAIL ==='));
process.exit(pass ? 0 : 1);
