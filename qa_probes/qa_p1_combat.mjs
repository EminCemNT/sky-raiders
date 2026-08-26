// qa_p1_combat.mjs —— P1 战斗扩展组验收探针
//
// 验证：
//   A) Boss 可破坏护盾部位：GameConfig boss.shieldHp（sentinel 0/crusher 80/overlord 120/annihilator 150）、
//      部位生成/独立受击（含 checkBossHits 布线）/盾破（3s 无盾 + 弹幕增强 + 部位隐藏）/3s 后恢复
//   B) 新敌型 turret/kamikaze/summoner/shield 可生成 + 新弹幕 aimed/ring/wall/spiral/petal 可发射 +
//      laserSweep 激光扫射可发射（beam 出现）；wavePlan 含新敌型（typeKey/pattern 数据驱动）
//   C) 超载状态：OVERCHARGE 配置、连续拾 3P 触发、连续擦 5 次触发、效果（射速 ×1.3 / 得分 ×1.2）、过期
//   D) 聚焦模式：FOCUS 配置、移速 ×0.45、射速 ×0.8（有效间隔 175ms）、判定点显式显示、伤害 +20%
//   E) 红线：WINGMAN.COMBO 五字段零 diff、AchievementManager 26 成就 id 零 diff
//   F) 零 pageerror / console error
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

/** 进入 normal 第 1 关 GameScene（复用同一 page，重启场景） */
async function startGame(page) {
  await page.evaluate(() => {
    const g = window.__SKY__;
    const s = window.__SAVE.load();
    s.upgrades = { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 };
    window.__SAVE.set('selectedDifficulty', 'standard');
    window.__SAVE.set('tutorialDone', true);
    window.__SAVE.save();
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = g.scene.getScene(k);
      if (sc && sc.scene.isActive()) g.scene.stop(k);
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

// ── 1) 静态配置断言：OVERCHARGE / FOCUS / EVENTS / shieldHp / wavePlan / 红线 ──
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const ach = await import('/src/systems/AchievementManager.js');
  return {
    oc: gc.OVERCHARGE,
    focus: gc.FOCUS,
    ocEvent: gc.EVENTS.OVERCHARGE_STATE,
    focusEvent: gc.EVENTS.FOCUS_TOGGLE,
    shieldHp: gc.LEVELS.map((l) => l.boss.shieldHp),
    combo: gc.WINGMAN.COMBO,
    achLen: ach.ACHIEVEMENTS.length,
    achIds: ach.ACHIEVEMENTS.map((a) => a.id),
    // wavePlan 含新敌型（数据驱动）
    hasTurret: gc.LEVELS.some((l) => l.wavePlan.some((w) => w.comp.some((c) => (Array.isArray(c) ? c[0] : c.typeKey) === 'turret'))),
    hasKamikaze: gc.LEVELS.some((l) => l.wavePlan.some((w) => w.comp.some((c) => (Array.isArray(c) ? c[0] : c.typeKey) === 'kamikaze'))),
    hasSummoner: gc.LEVELS.some((l) => l.wavePlan.some((w) => w.comp.some((c) => (Array.isArray(c) ? c[0] : c.typeKey) === 'summoner'))),
    hasShield: gc.LEVELS.some((l) => l.wavePlan.some((w) => w.comp.some((c) => (Array.isArray(c) ? c[0] : c.typeKey) === 'shield'))),
    // wavePlan 显式 pattern 字段（第 4 元素）存在
    hasPatternField: gc.LEVELS.some((l) => l.wavePlan.some((w) => w.comp.some((c) => Array.isArray(c) && c.length >= 4 && c[3]))),
  };
});
push('OVERCHARGE 配置 = {P_STACK:3,GRAZE_STACK:5,WINDOW:30000,DURATION:5000,FIRE_MUL:1.3,SCORE_MUL:1.2}',
  !!cfg.oc && cfg.oc.P_STACK === 3 && cfg.oc.GRAZE_STACK === 5 && cfg.oc.WINDOW === 30000
  && cfg.oc.DURATION === 5000 && cfg.oc.FIRE_MUL === 1.3 && cfg.oc.SCORE_MUL === 1.2,
  JSON.stringify(cfg.oc));
push('FOCUS 配置 = {SPEED_MUL:0.45,FIRE_MUL:0.8,DMG_MUL:1.2}',
  !!cfg.focus && cfg.focus.SPEED_MUL === 0.45 && cfg.focus.FIRE_MUL === 0.8 && cfg.focus.DMG_MUL === 1.2,
  JSON.stringify(cfg.focus));
push('EVENTS.OVERCHARGE_STATE / FOCUS_TOGGLE 已登记',
  !!cfg.ocEvent && !!cfg.focusEvent, `${cfg.ocEvent} / ${cfg.focusEvent}`);
push('LEVELS boss.shieldHp = [0,80,120,150]',
  JSON.stringify(cfg.shieldHp) === JSON.stringify([0, 80, 120, 150]), cfg.shieldHp.join(','));
push('wavePlan 含新敌型 turret/kamikaze/summoner/shield',
  cfg.hasTurret && cfg.hasKamikaze && cfg.hasSummoner && cfg.hasShield,
  `turret=${cfg.hasTurret} kamikaze=${cfg.hasKamikaze} summoner=${cfg.hasSummoner} shield=${cfg.hasShield}`);
push('wavePlan 显式 pattern 字段（第 4 元素）存在', cfg.hasPatternField === true);
push('红线：WINGMAN.COMBO 五字段零 diff',
  !!cfg.combo && cfg.combo.WINDOW_MS === 1200 && cfg.combo.TRIGGER === 5 && cfg.combo.BUFF_MS === 3000
  && cfg.combo.DMG_MUL === 1.35 && cfg.combo.MAX_COUNT === 9,
  JSON.stringify(cfg.combo));
push('红线：AchievementManager 26 成就 id 零 diff',
  cfg.achLen === 26 && JSON.stringify(cfg.achIds) === JSON.stringify([
    'tutorial_done', 'first_blood', 'first_clear', 'super_nova', 'kill_100', 'kill_500', 'combo_15', 'combo_30',
    'flawless', 'coin_30', 'all_clear', 'three_star', 'boss_sentinel', 'boss_crusher', 'boss_overlord', 'boss_all',
    'bossrush_clear', 'bossrush_flawless', 'wingman_first', 'wingman_50', 'combo_element_5', 'combo_element_50',
    'element_fire', 'element_ice', 'element_thunder', 'egg_arsenal',
  ]),
  `len=${cfg.achLen}`);

// ── 2) Boss 可破坏护盾部位 ──
await startGame(page);
const bossShield = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const Boss = (await import('/src/entities/Boss.js')).default;
  // 清场防干扰
  gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  const boss = new Boss(gs, 'boss_crusher', {
    maxHp: 3300, pattern: 'spiral', name: '粉碎者 Crusher', color: 0xff9a4a, shieldHp: 80, difficulty: 1,
  });
  gs.boss = boss;
  const r = {};
  // 部位配置
  r.hasPart = !!boss.shieldPart;
  r.partHp = boss._shieldPartMaxHp;
  r.partHpCur = boss._shieldPartHp;
  // 直接受击
  boss.hitShieldPart(30);
  r.hpAfter1 = boss._shieldPartHp;            // 50
  // checkBossHits 布线受击：放一颗玩家弹在护盾部位上
  const pb = gs.playerBullets.get(boss.shieldPart.x, boss.shieldPart.y - 4, 'bullet_pulse');
  if (pb) {
    pb.setActive(true).setVisible(true); pb.body.enable = true; pb.damage = 20;
    gs.checkBossHits();
  }
  r.hpAfterHit = boss._shieldPartHp;          // 30
  // 盾破
  boss.hitShieldPart(999);
  r.broken = boss._shieldBroken;              // true
  r.brokenUntil = boss._shieldBrokenUntil;
  r.partHidden = !boss.shieldPart.visible;
  // 盾破期间弹幕增强（spiral + shieldBurst 应发射子弹）
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  boss.firePattern();
  r.bulletsDuring = gs.enemyBullets.countActive(true);
  // 3s 无盾窗口结束 → 自动恢复
  boss._shieldBrokenUntil = gs.time.now - 1;
  boss.update(gs.time.now + 1, 16);
  r.recovered = !boss._shieldBroken && boss._shieldPartHp === 80 && boss.shieldPart.visible;
  // 清理（不调 die()，避免触发 BOSS_DEFEATED 结算链路）
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  gs.boss = null;
  if (boss.shieldPart) boss.shieldPart.destroy();
  if (boss.fxG) boss.fxG.destroy();
  boss.destroy();
  return r;
});
push('Boss 护盾部位生成（shieldHp=80 → shieldPart + HP 80）',
  bossShield.hasPart === true && bossShield.partHp === 80 && bossShield.partHpCur === 80,
  `hp=${bossShield.partHpCur}`);
push('护盾部位受击独立扣血（hitShieldPart 30 → 50）', bossShield.hpAfter1 === 50, `hp=${bossShield.hpAfter1}`);
push('护盾部位受击经 checkBossHits 布线生效（弹 20 → 30）', bossShield.hpAfterHit === 30, `hp=${bossShield.hpAfterHit}`);
push('盾破：_shieldBroken=true + 3s 窗口 + 部位隐藏',
  bossShield.broken === true && bossShield.brokenUntil > 0 && bossShield.partHidden === true,
  `until=${bossShield.brokenUntil}`);
push('盾破期间弹幕增强（firePattern 发射子弹）', bossShield.bulletsDuring > 0, `bullets=${bossShield.bulletsDuring}`);
push('3s 无盾窗口结束自动恢复（盾恢复 + HP 回满 + 部位可见）', bossShield.recovered === true);

// ── 3) Boss 新弹幕：petal / laserSweep / aimed / wall ──
const bossPatterns = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const Boss = (await import('/src/entities/Boss.js')).default;
  const out = {};
  const mkBoss = (pattern) => {
    const b = new Boss(gs, 'boss_x', { maxHp: 1000, pattern, name: 'x', color: 0xff4455, shieldHp: 0, difficulty: 1 });
    b._entering = false;
    return b;
  };
  for (const p of ['aimed', 'wall', 'petal']) {
    gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
    const b = mkBoss(p);
    b.firePattern();
    out[p] = gs.enemyBullets.countActive(true);
    gs.enemyBullets.children.each((bl) => { if (bl.active) gs.killBullet(bl); });
    if (b.fxG) b.fxG.destroy();
    b.destroy();
  }
  // laserSweep：蓄力 420ms 后出现 beam
  const b = mkBoss('laserSweep');
  b.firePattern();
  await new Promise((res) => setTimeout(res, 520));
  out.laserSweep = gs.children.list.some((o) => o.type === 'Rectangle' && o._isSweep);
  gs.children.list.forEach((o) => { if (o.type === 'Rectangle' && o._isSweep) o.destroy(); });
  if (b.fxG) b.fxG.destroy();
  b.destroy();
  return out;
});
push('Boss pattern=aimed 可发射（>0 弹）', bossPatterns.aimed > 0, `bullets=${bossPatterns.aimed}`);
push('Boss pattern=wall 可发射（>0 弹）', bossPatterns.wall > 0, `bullets=${bossPatterns.wall}`);
push('Boss pattern=petal 可发射（>0 弹）', bossPatterns.petal > 0, `bullets=${bossPatterns.petal}`);
push('Boss pattern=laserSweep 可发射（beam 出现）', bossPatterns.laserSweep === true);

// ── 4) 新敌型生成 ──
const enemies = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
  const out = {};
  [['turret', 'turret', 'aimed'], ['kamikaze', 'kamikaze', 'straight'], ['summoner', 'straight', 'ring'], ['shield', 'straight', 'spread']].forEach(([tk, mode, pat]) => {
    const e = gs.spawnEnemy(270, -40, tk, mode, 1, pat);
    out[tk] = e ? { active: e.active, typeKey: e.typeKey, hp: e.hp, hasShield: !!e.hasFrontShield } : null;
  });
  // 回收测试敌机，避免 kamikaze 后续追击玩家
  gs.enemies.children.each((e) => { if (e.active && ['turret', 'kamikaze', 'summoner', 'shield'].includes(e.typeKey)) e.recycle(); });
  return out;
});
push('新敌型 turret 可生成（active/typeKey）', !!enemies.turret && enemies.turret.active && enemies.turret.typeKey === 'turret', `hp=${enemies.turret && enemies.turret.hp}`);
push('新敌型 kamikaze 可生成', !!enemies.kamikaze && enemies.kamikaze.active && enemies.kamikaze.typeKey === 'kamikaze');
push('新敌型 summoner 可生成', !!enemies.summoner && enemies.summoner.active && enemies.summoner.typeKey === 'summoner');
push('新敌型 shield 可生成（hasFrontShield=true）',
  !!enemies.shield && enemies.shield.active && enemies.shield.typeKey === 'shield' && enemies.shield.hasShield === true);

// ── 5) 新弹幕（敌机）：aimed / ring / wall / spiral / petal / laserSweep ──
const enemyBullets = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const out = {};
  for (const p of ['aimed', 'ring', 'wall', 'spiral', 'petal']) {
    gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
    gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
    const e = gs.spawnEnemy(270, 200, 'mid', 'straight', 1, p);
    const before = gs.enemyBullets.countActive(true);
    e.fireAtPlayer();
    out[p] = gs.enemyBullets.countActive(true) - before;
    gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
    e.recycle();
  }
  return out;
});
push('敌机 pattern=aimed 发射 1 发', enemyBullets.aimed === 1, `delta=${enemyBullets.aimed}`);
push('敌机 pattern=ring 发射 10 发', enemyBullets.ring === 10, `delta=${enemyBullets.ring}`);
push('敌机 pattern=wall 发射 7 发', enemyBullets.wall === 7, `delta=${enemyBullets.wall}`);
push('敌机 pattern=spiral 发射 >0 发', enemyBullets.spiral > 0, `delta=${enemyBullets.spiral}`);
push('敌机 pattern=petal 发射 >0 发', enemyBullets.petal > 0, `delta=${enemyBullets.petal}`);

const laserSweep = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  const e = gs.spawnEnemy(270, 200, 'summoner', 'straight', 1, 'laserSweep');
  e._laserSweep();
  await new Promise((res) => setTimeout(res, 520));
  const beamFound = gs.children.list.some((o) => o.type === 'Rectangle' && o._isSweep);
  gs.children.list.forEach((o) => { if (o.type === 'Rectangle' && o._isSweep) o.destroy(); });
  e.recycle();
  return { beamFound };
});
push('敌机 pattern=laserSweep 可发射（beam 出现）', laserSweep.beamFound === true);

// ── 6) 超载状态：触发（拾 3P / 擦 5 次）+ 效果 + 过期 ──
const oc = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const eb = (await import('/src/utils/EventBus.js')).EventBus;
  const p = gs.player;
  gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  const resetOc = () => {
    gs.overcharge.active = false; gs.overcharge.until = 0;
    gs._ocP.count = 0; gs._ocP.lastAt = 0;
    gs._ocGraze.count = 0; gs._ocGraze.lastAt = 0;
    p.setFirepower(0); p.setPowerLevel(0); p.setFireRateMul(1); p.setOverchargeMul(null);
  };
  // 连续拾 3P → 触发
  resetOc();
  gs.addPower(); gs.addPower(); gs.addPower();
  const pTrigger = gs.overcharge.active;
  // 连续擦 5 次 → 触发
  resetOc();
  for (let i = 0; i < 5; i++) gs._grantGraze(100, 100);
  const gTrigger = gs.overcharge.active;
  // 效果：射速 ×1.3（有效间隔 140 → 108）+ 得分 ×1.2（延迟 bonus 结算）
  resetOc();
  const baseInterval = p.fireInterval;
  gs._triggerOvercharge(gs.time.now);
  const effInterval = p.getEffectiveFireInterval();
  const ocMul = p.overchargeFireMul;
  gs.score = 0; gs._ocBonus = 0;
  eb.emit('score-changed', 100);
  const scoreMain = gs.score;       // 主分照常 100
  const scoreBonus = gs._ocBonus;   // 超载 bonus 20
  gs._flushOverchargeBonus();
  const scoreTotal = gs.score;      // flush 后 120
  // 过期
  gs.overcharge.active = true; gs.overcharge.until = gs.time.now - 1;
  gs._updateOvercharge(gs.time.now);
  const expired = !gs.overcharge.active && p.overchargeFireMul == null;
  return { pTrigger, gTrigger, baseInterval, effInterval, ocMul, scoreMain, scoreBonus, scoreTotal, expired };
});
push('连续拾取 3 个 P 触发超载', oc.pTrigger === true);
push('连续擦弹 5 次触发超载', oc.gTrigger === true);
push('超载射速 ×1.3（有效间隔 140 → 108）',
  oc.baseInterval === 140 && oc.effInterval === 108, `base=${oc.baseInterval} eff=${oc.effInterval} mul=${oc.ocMul}`);
push('超载得分 ×1.2（SCORE_CHANGED 100 → 主分100 + bonus20 = flush 后 120）',
  oc.scoreMain === 100 && oc.scoreBonus === 20 && oc.scoreTotal === 120,
  `main=${oc.scoreMain} bonus=${oc.scoreBonus} total=${oc.scoreTotal}`);
push('超载到期恢复（active=false + fireMul 清空）', oc.expired === true);

// ── 7) 聚焦模式：移速 / 射速 / 判定点 / 伤害 ──
const focus = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  p.setWeapon('pulse');
  p.setFirepower(0); p.setPowerLevel(0); p.setFireRateMul(1); p.setOverchargeMul(null);
  const baseInterval = p.fireInterval;
  const baseSpeed = p.getMoveSpeed();
  // 移速 / 射速
  p.setFocusing(true);
  const speed = p.getMoveSpeed();
  const effFocus = p.getEffectiveFireInterval();
  // 判定点显式显示（showHitbox=false 时聚焦仍显示）
  window.__SAVE.set('showHitbox', false);
  p.update(p.scene.time.now, 16, gs.input.activePointer, gs.cursors);
  const dotVisible = p.hitboxDot ? p.hitboxDot.visible : false;
  p.setFocusing(false);
  p.update(p.scene.time.now, 16, gs.input.activePointer, gs.cursors);
  const dotHidden = p.hitboxDot ? !p.hitboxDot.visible : true;
  // 伤害 +20%
  let dmgFocus = 0, dmgNormal = 0;
  p.setFocusing(true);
  gs.playerBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  p.fire();
  gs.playerBullets.children.each((b) => { if (b.active) dmgFocus = b.damage; });
  gs.playerBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  p.setFocusing(false);
  p.fire();
  gs.playerBullets.children.each((b) => { if (b.active) dmgNormal = b.damage; });
  gs.playerBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  return { baseInterval, baseSpeed, speed, effFocus, dotVisible, dotHidden, dmgFocus, dmgNormal };
});
push('聚焦移速 ×0.45（420 → 189）', focus.baseSpeed === 420 && focus.speed === 189, `speed=${focus.speed}`);
push('聚焦射速 ×0.8（有效间隔 140 → 175）',
  focus.baseInterval === 140 && focus.effFocus === 175, `base=${focus.baseInterval} eff=${focus.effFocus}`);
push('聚焦判定点显式显示（showHitbox=false 仍显示 / 退出隐藏）',
  focus.dotVisible === true && focus.dotHidden === true, `on=${focus.dotVisible} off=${focus.dotHidden}`);
push('聚焦伤害 +20%（10 → 12）', focus.dmgFocus === 12 && focus.dmgNormal === 10, `focus=${focus.dmgFocus} normal=${focus.dmgNormal}`);

// ── 8) 零 pageerror / console error ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_p1_combat: PASS ===' : '=== qa_p1_combat: FAIL ==='));
process.exit(pass ? 0 : 1);
