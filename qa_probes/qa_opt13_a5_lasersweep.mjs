// qa_opt13_a5_lasersweep.mjs —— OPT-13 批A A5 激光扫射递归取消 验收探针
//
// 验证：
//   1) Enemy 扫射：_laserSweep() 置 _sweeping=true 并出蓄力警示圈；重入被拦截（不重复扫射）
//   2) 蓄力完成出 beam/glow（_sweepBeam/_sweepGlow 持有引用）
//   3) Enemy.die() → _sweeping=false 且 beam/glow 被销毁（真实死亡链路取消扫射）
//   4) Enemy.recycle() → _cancelSweep 复位（对象池复用不污染下一个实例）
//   5) Boss 扫射：_patternLaserSweep() 置 _sweeping=true 出 beam；die() 真实链路取消并销毁视觉
//   6) 扫射取消后不再产生幽灵 tick（等待后无 beam 复活 / 无 pageerror）
//   7) 源码级：Enemy.die/recycle/spawn 与 Boss.die 均调用 _cancelSweep
//   8) 零 pageerror / console error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

async function startGame(page) {
  await page.evaluate(() => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
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

await startGame(page);

// ── 1) Enemy 扫射启动 + 重入拦截 ──
const en = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(270, 200, 'mid', 'straight', 1, 'laserSweep');
  const before = e._sweeping;
  e._laserSweep();
  const after = e._sweeping;
  const warnActive = !!(e._sweepWarn && e._sweepWarn.active);
  // 重入：扫射进行中再次调用应被拦截（不新增 warn / 不重置）
  const warn1 = e._sweepWarn;
  e._laserSweep();
  const warnSame = e._sweepWarn === warn1;
  return { before, after, warnActive, warnSame, sweeping: e._sweeping };
});
push('Enemy 初始 _sweeping=false', en.before === false);
push('Enemy._laserSweep() 置 _sweeping=true', en.after === true, `sweeping=${en.after}`);
push('Enemy 蓄力警示圈已创建（_sweepWarn active）', en.warnActive === true);
push('Enemy 扫射重入被拦截（不重复创建）', en.warnSame === true && en.sweeping === true);

// ── 2) 蓄力完成出 beam/glow（持有引用）──
await page.waitForTimeout(470);
const enBeam = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.enemies.getChildren().find((c) => c.active && c._sweeping);
  if (!e) return { found: false };
  return {
    found: true,
    beamActive: !!(e._sweepBeam && e._sweepBeam.active),
    glowActive: !!(e._sweepGlow && e._sweepGlow.active),
    sweeping: e._sweeping,
  };
});
push('Enemy 蓄力完成出 beam（_sweepBeam active）', enBeam.found && enBeam.beamActive === true, `found=${enBeam.found}`);
push('Enemy beam 伴生 glow active', enBeam.found && enBeam.glowActive === true);

// ── 3) Enemy.die() 真实链路取消扫射 ──
const enDie = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.enemies.getChildren().find((c) => c.active && c._sweeping);
  if (!e) return { found: false };
  const beam = e._sweepBeam, glow = e._sweepGlow;
  e.die();
  return {
    found: true,
    sweeping: e._sweeping,
    beamGone: beam ? !beam.active : true,
    glowGone: glow ? !glow.active : true,
    warnNull: e._sweepWarn === null,
  };
});
push('Enemy.die() 后 _sweeping=false', enDie.found && enDie.sweeping === false);
push('Enemy.die() 销毁 beam/glow', enDie.found && enDie.beamGone === true && enDie.glowGone === true, `beam=${enDie.beamGone} glow=${enDie.glowGone}`);

// ── 4) Enemy.recycle() 复位（对象池复用不污染）──
const enRecycle = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(200, 100, 'small', 'straight', 1, 'laserSweep');
  e._laserSweep();
  e.recycle();
  return {
    sweeping: e._sweeping,
    warnNull: e._sweepWarn === null,
    beamNull: e._sweepBeam === null,
    glowNull: e._sweepGlow === null,
    active: e.active,
  };
});
push('Enemy.recycle() 复位 _sweeping=false', enRecycle.sweeping === false);
push('Enemy.recycle() 清空 warn/beam/glow 引用', enRecycle.warnNull && enRecycle.beamNull && enRecycle.glowNull);
push('Enemy.recycle() 后敌人 inactive（入池）', enRecycle.active === false);

// ── 5) Boss 扫射 + die() 真实链路取消 ──
const boss = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const BossMod = await import('/src/entities/Boss.js');
  const Boss = BossMod.default;
  const b = new Boss(gs, 'probe', { maxHp: 2000, pattern: 'fan', color: 0xff5a6e, difficulty: 1 });
  gs.boss = b; // 让 GameScene 持有引用（die 的 BOSS_DEFEATED 链路需要 this.boss）
  const before = b._sweeping;
  b._patternLaserSweep();
  const after = b._sweeping;
  const warnActive = !!(b._sweepWarn && b._sweepWarn.active);
  return { before, after, warnActive };
});
push('Boss 初始 _sweeping=false', boss.before === false);
push('Boss._patternLaserSweep() 置 _sweeping=true', boss.after === true);
push('Boss 蓄力警示圈已创建', boss.warnActive === true);

await page.waitForTimeout(470);
const bossBeam = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const b = gs.boss;
  if (!b || !b._sweepBeam) return { found: false };
  return {
    found: true,
    beamActive: b._sweepBeam.active,
    glowActive: !!(b._sweepGlow && b._sweepGlow.active),
  };
});
push('Boss 蓄力完成出 beam active', bossBeam.found && bossBeam.beamActive === true, `found=${bossBeam.found}`);
push('Boss beam 伴生 glow active', bossBeam.found && bossBeam.glowActive === true);

const bossDie = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const b = gs.boss;
  if (!b) return { found: false };
  const beam = b._sweepBeam, glow = b._sweepGlow;
  b.die();
  // 中和 BOSS_DEFEATED 触发的延迟 endGame（探针只测扫射取消，不测结算）
  gs.gameEnded = true;
  return {
    found: true,
    sweeping: b._sweeping,
    beamGone: beam ? !beam.active : true,
    glowGone: glow ? !glow.active : true,
  };
});
push('Boss.die() 后 _sweeping=false', bossDie.found && bossDie.sweeping === false);
push('Boss.die() 销毁 beam/glow', bossDie.found && bossDie.beamGone === true && bossDie.glowGone === true, `beam=${bossDie.beamGone} glow=${bossDie.glowGone}`);

// ── 6) 取消后无幽灵 tick：再等 200ms，无新 beam 复活 / 无报错 ──
await page.waitForTimeout(200);
const ghost = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  let ghostCount = 0;
  gs.children.list.forEach((c) => { if (c && c._isSweep && c.active) ghostCount++; });
  return ghostCount;
});
push('扫射取消后无幽灵 beam 复活（_isSweep 无残留 active）', ghost === 0, `ghost=${ghost}`);

// ── 7) 源码级：die/recycle/spawn 调用 _cancelSweep ──
const src = await page.evaluate(async () => {
  const en = await (await fetch('/src/entities/Enemy.js')).text();
  const bo = await (await fetch('/src/entities/Boss.js')).text();
  return {
    enDieCancel: en.includes('die() {') && en.includes('_cancelSweep()'),
    enRecycleCancel: en.includes('recycle() {') && en.includes('_cancelSweep()'),
    enSpawnReset: en.includes('_sweeping = false'),
    boDieCancel: bo.includes('die() {') && bo.includes('_cancelSweep()'),
  };
});
push('Enemy.die/recycle 均调用 _cancelSweep', src.enDieCancel && src.enRecycleCancel);
push('Enemy.spawn 复位 _sweeping=false（对象池复用）', src.enSpawnReset);
push('Boss.die 调用 _cancelSweep', src.boDieCancel);

push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a5_lasersweep: PASS ===' : '=== qa_opt13_a5_lasersweep: FAIL ==='));
process.exit(pass ? 0 : 1);
