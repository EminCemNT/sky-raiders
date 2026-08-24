// qa_element_reaction.mjs —— 「元素玩法深挖 → 元素连锁反应系统」验收探针
//
// 验证：
//   1) 静态配置：ELEMENT_REACTIONS（REACT_CD/三元素字段）、EVENTS 两事件、ITEMS.element_core、掉落权重
//   2) 0 僚机路径：火·引爆 AoE / 雷·传导 / 冰·冰爆 / 反应冷却
//   3) 红线 diff：WINGMAN.COMBO 五字段值不变 + 成就 26 id 数量不变 + WingmanSystem 三方法未删
//   4) combo 共存：有僚机交替命中仍触发 ×1.35
//   5) 元素核心拾取：火→冰→雷→火 轮换 + HUD 指示 + aura 变色
//   6) reduced-motion 下零 pageerror / console error
//   7) 全局零 pageerror / console error
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

/** 以 0 僚机 + 标准档 + 已完成教程进入一局 */
async function startGame() {
  await page.evaluate(() => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    window.__SAVE.set('selectedDifficulty', 'standard');
    window.__SAVE.set('upgrades', { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 });
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

/** 清空场上敌机 + 敌弹（保证后续「最近 N 个」断言确定性） */
async function cleanScene() {
  await page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
    gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  });
}

// ── 1) 静态配置 + 红线 diff ──
const cfg = await page.evaluate(async () => {
  const er = await import('/src/config/ElementReactions.js');
  const gc = await import('/src/config/GameConfig.js');
  const it = await import('/src/config/Items.js');
  const ach = await import('/src/systems/AchievementManager.js');
  const wm = await import('/src/systems/WingmanSystem.js');
  return {
    E: er.ELEMENT_REACTIONS,
    evReaction: gc.EVENTS.ELEMENT_REACTION,
    evChanged: gc.EVENTS.ELEMENT_CHANGED,
    combo: gc.WINGMAN.COMBO,
    item: it.ITEMS.element_core,
    weight: it.ITEM_DROP_WEIGHTS.element_core,
    achCount: ach.ACHIEVEMENTS.length,
    wmReportHit: typeof wm.default.prototype.reportHit,
    wmGetComboMul: typeof wm.default.prototype.getComboMul,
    wmGetComboTint: typeof wm.default.prototype.getComboTint,
  };
});

push('ELEMENT_REACTIONS.REACT_CD=1200', cfg.E.REACT_CD === 1200, `got ${cfg.E.REACT_CD}`);
push('thunder 传导 chainCount=2/radius=140/dmg=15/splash=thunder',
  cfg.E.thunder && cfg.E.thunder.kind === 'chain' && cfg.E.thunder.chainCount === 2 && cfg.E.thunder.radius === 140 && cfg.E.thunder.dmg === 15 && cfg.E.thunder.splash === 'thunder');
push('fire 引爆 kind=aoe/radius=110/dmg=22/falloff=0.5/splash=null',
  cfg.E.fire && cfg.E.fire.kind === 'aoe' && cfg.E.fire.radius === 110 && cfg.E.fire.dmg === 22 && cfg.E.fire.falloff === 0.5 && cfg.E.fire.splash === null);
push('ice 冰爆 kind=aoe/radius=120/dmg=12/falloff=0.5/splash=ice',
  cfg.E.ice && cfg.E.ice.kind === 'aoe' && cfg.E.ice.radius === 120 && cfg.E.ice.dmg === 12 && cfg.E.ice.falloff === 0.5 && cfg.E.ice.splash === 'ice');
push('EVENTS.ELEMENT_REACTION 已登记', cfg.evReaction === 'element-reaction', cfg.evReaction);
push('EVENTS.ELEMENT_CHANGED 已登记', cfg.evChanged === 'element-changed', cfg.evChanged);
push('ITEMS.element_core 定义（tex=item_element/kind=element）',
  !!cfg.item && cfg.item.tex === 'item_element' && cfg.item.kind === 'element' && cfg.item.label === '元素核心',
  JSON.stringify(cfg.item));
push('ITEM_DROP_WEIGHTS.element_core=5', cfg.weight === 5, `got ${cfg.weight}`);

// 红线 diff
push('红线：WINGMAN.COMBO 五字段值不变',
  cfg.combo.WINDOW_MS === 1200 && cfg.combo.TRIGGER === 5 && cfg.combo.BUFF_MS === 3000 && cfg.combo.DMG_MUL === 1.35 && cfg.combo.MAX_COUNT === 9,
  JSON.stringify(cfg.combo));
push('红线：成就 26 id 数量不变', cfg.achCount === 26, `got ${cfg.achCount}`);
push('红线：WingmanSystem reportHit/getComboMul/getComboTint 未删',
  cfg.wmReportHit === 'function' && cfg.wmGetComboMul === 'function' && cfg.wmGetComboTint === 'function');

// ── 2) 0 僚机路径：三种反应 + 冷却 ──
await startGame();

await cleanScene();
const fire = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const wmCount = gs.wingmanSystem ? gs.wingmanSystem.getCount() : -1;
  const src = gs.spawnEnemy(270, 300, 'small', 'straight', 1, 'straight');
  src.setVelocity(0, 0);
  src.applyElement('fire');
  const a = gs.spawnEnemy(300, 300, 'small', 'straight', 1, 'straight');   // dist 30
  const b = gs.spawnEnemy(330, 300, 'small', 'straight', 1, 'straight');   // dist 60
  const far = gs.spawnEnemy(270, 520, 'small', 'straight', 1, 'straight'); // dist 220 > 110
  const hpA0 = a.hp, hpB0 = b.hp, hpFar0 = far.hp;
  src.hit(1, 'fire');
  return { wmCount, hpA0, hpA1: a.hp, hpB0, hpB1: b.hp, hpFar0, hpFar1: far.hp };
});
push('0 僚机路径（wingmanSystem 无僚机）', fire.wmCount === 0, `count=${fire.wmCount}`);
push('火·引爆：半径内敌机受损', fire.hpA1 < fire.hpA0 && fire.hpB1 < fire.hpB0,
  `A ${fire.hpA0}→${fire.hpA1}, B ${fire.hpB0}→${fire.hpB1}`);
push('火·引爆：半径外敌机不受波及', fire.hpFar1 === fire.hpFar0, `far ${fire.hpFar0}→${fire.hpFar1}`);

await cleanScene();
const thunder = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const src = gs.spawnEnemy(270, 300, 'small', 'straight', 1, 'straight');
  src.setVelocity(0, 0);
  src.applyElement('thunder');
  const a = gs.spawnEnemy(290, 300, 'small', 'straight', 1, 'straight');  // dist 20
  const b = gs.spawnEnemy(320, 300, 'small', 'straight', 1, 'straight');  // dist 50
  const c = gs.spawnEnemy(360, 300, 'small', 'straight', 1, 'straight');  // dist 90（第 3 近，chainCount=2 应跳过）
  const now = gs.time.now;
  src.hit(1, 'thunder');
  return {
    aHp: a.hp, bHp: b.hp, cHp: c.hp,
    aStun: a._stunUntil > now, bStun: b._stunUntil > now, cStun: c._stunUntil > now,
  };
});
push('雷·传导：最近 ≤2 个敌机受损（dmg=15）', thunder.aHp === 5 && thunder.bHp === 5, `A=${thunder.aHp} B=${thunder.bHp}`);
push('雷·传导：第 3 近敌机不受传导', thunder.cHp === 20, `C=${thunder.cHp}`);
push('雷·传导：传导目标附加麻痹', thunder.aStun === true && thunder.bStun === true && thunder.cStun === false);

await cleanScene();
const ice = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const src = gs.spawnEnemy(270, 300, 'small', 'straight', 1, 'straight');
  src.setVelocity(0, 0);
  src.applyElement('ice');
  const a = gs.spawnEnemy(290, 300, 'small', 'straight', 1, 'straight');  // dist 20
  const b = gs.spawnEnemy(330, 300, 'small', 'straight', 1, 'straight');  // dist 60
  const far = gs.spawnEnemy(270, 520, 'small', 'straight', 1, 'straight'); // dist 220 > 120
  const now = gs.time.now;
  src.hit(1, 'ice');
  return {
    aHp: a.hp, bHp: b.hp, farHp: far.hp,
    aSlow: a._slowUntil > now, bSlow: b._slowUntil > now, farSlow: far._slowUntil > now,
  };
});
push('冰·冰爆：半径内敌机受损', ice.aHp < 20 && ice.bHp < 20, `A=${ice.aHp} B=${ice.bHp}`);
push('冰·冰爆：半径外敌机不受波及', ice.farHp === 20, `far=${ice.farHp}`);
push('冰·冰爆：溅射目标附加减速', ice.aSlow === true && ice.bSlow === true && ice.farSlow === false);

await cleanScene();
const cd = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const src = gs.spawnEnemy(270, 300, 'small', 'straight', 1, 'straight');
  src.setVelocity(0, 0);
  src.applyElement('fire');
  const t0 = gs.time.now;
  const r1 = gs.elementReaction.onHit(src, 'fire', t0);
  const r2 = gs.elementReaction.onHit(src, 'fire', t0);            // 冷却内
  const r3 = gs.elementReaction.onHit(src, 'fire', t0 + 2000);     // 越过 REACT_CD(1200)
  return { r1, r2, r3 };
});
push('反应冷却：首击触发 / 冷却内不触发 / 越过冷却再触发',
  cd.r1 === true && cd.r2 === false && cd.r3 === true, JSON.stringify(cd));

await cleanScene();

// ── 3) 钩子暴露 ──
const hooks = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    hasSetPlayerElement: typeof window.__SKY.setPlayerElement === 'function',
    hasElementReaction: !!window.__ELEMENT_REACTION,
    sameInstance: window.__ELEMENT_REACTION === gs.elementReaction,
  };
});
push('钩子：window.__SKY.setPlayerElement 暴露', hooks.hasSetPlayerElement === true);
push('钩子：window.__ELEMENT_REACTION 暴露且同实例',
  hooks.hasElementReaction === true && hooks.sameInstance === true);

// ── 4) combo 共存：有僚机交替命中仍触发 ×1.35 ──
const combo = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const wm = gs.wingmanSystem;
  if (wm.getCount() === 0) wm.addWingman();
  const base = gs.time.now + 100000;   // 避开真实命中，用未来时间窗
  wm.reportHit(false, 'fire', base);
  wm.reportHit(true, 'fire', base + 100);
  wm.reportHit(false, 'fire', base + 200);
  wm.reportHit(true, 'fire', base + 300);
  wm.reportHit(false, 'fire', base + 400);
  return { count: wm.getCount(), mul: wm.getComboMul(base + 500) };
});
push('combo 共存：加僚机后交替命中 ×1.35', combo.count >= 1 && combo.mul === 1.35,
  `count=${combo.count} mul=${combo.mul}`);

// ── 5) 元素核心拾取轮换 + HUD + aura ──
const rot = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  gs.setPlayerElement(null);
  const seq = [];
  for (let i = 0; i < 4; i++) {
    gs.spawnItem(270, 400, 'element_core');
    let item = null;
    gs.items.children.each((x) => { if (x.active && x.itemKey === 'element_core') item = x; });
    gs.collectItem(item);
    seq.push(gs.player.shipElement);
  }
  return {
    seq,
    auraTint: gs.player.aura ? gs.player.aura.tintTopLeft : null,
    hud: ui.elementText ? ui.elementText.text : null,
    hudVisible: ui.elementText ? ui.elementText.visible : false,
  };
});
push('元素核心轮换顺序 火→冰→雷→火', JSON.stringify(rot.seq) === JSON.stringify(['fire', 'ice', 'thunder', 'fire']), rot.seq.join('→'));
push('aura 变色（火=0xff7a3a）', rot.auraTint === 0xff7a3a, `tint=0x${(rot.auraTint >>> 0).toString(16)}`);
push('HUD 元素指示显示「元素 · 火」', rot.hud === '元素 · 火' && rot.hudVisible === true, `hud="${rot.hud}" visible=${rot.hudVisible}`);

// ── 6) reduced-motion 零 pageerror ──
const rmCtx = await browser.newContext({ viewport: { width: 540, height: 960 }, reducedMotion: 'reduce' });
const rmPage = await rmCtx.newPage();
const rmErrors = [];
rmPage.on('pageerror', (e) => rmErrors.push('pageerror: ' + e.message));
rmPage.on('console', (m) => { if (m.type() === 'error') rmErrors.push('console.error: ' + m.text()); });
await rmPage.goto(URL, { waitUntil: 'load' });
await rmPage.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await rmPage.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

const rmReduced = await rmPage.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
push('reduced-motion：matchMedia reduce=true', rmReduced === true);

await rmPage.evaluate(() => {
  const g = window.__SKY__;
  window.__SAVE.set('tutorialDone', true);
  window.__SAVE.set('selectedDifficulty', 'standard');
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const s = g.scene.getScene(k);
    if (s && s.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await rmPage.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await rmPage.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
  // 触发火·引爆（reactionRing 静态圆环） + 雷·传导（conductionArc 直接 return）+ 拾取元素核心
  const src = gs.spawnEnemy(270, 300, 'small', 'straight', 1, 'straight');
  src.applyElement('fire');
  gs.spawnEnemy(300, 300, 'small', 'straight', 1, 'straight');
  src.hit(1, 'fire');
  const t = gs.spawnEnemy(270, 400, 'small', 'straight', 1, 'straight');
  t.applyElement('thunder');
  gs.spawnEnemy(300, 400, 'small', 'straight', 1, 'straight');
  t.hit(1, 'thunder');
  gs.spawnItem(270, 500, 'element_core');
  let item = null;
  gs.items.children.each((x) => { if (x.active && x.itemKey === 'element_core') item = x; });
  gs.collectItem(item);
  return true;
});
await rmPage.waitForTimeout(700);   // 让 delayedCall/tween 沉降
push('reduced-motion：触发反应 + 拾取元素核心 零 pageerror/console error',
  rmErrors.length === 0, rmErrors.length ? rmErrors.slice(0, 3).join(' | ') : '');
await rmCtx.close();

// ── 7) 全局零 pageerror / console error ──
push('零 pageerror / console error（主页面）', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_element_reaction: PASS ===' : '=== qa_element_reaction: FAIL ==='));
process.exit(pass ? 0 : 1);
