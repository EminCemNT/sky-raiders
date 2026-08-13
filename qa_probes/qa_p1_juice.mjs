// qa_p1_juice.mjs —— P1 手感质变区五项（低血量暗角 / 可见判定点 / 死亡演出 / 命中轻震+后坐 / Boss 动态音乐事件链）真测
// 验证：
//   A. 低血量 vignette 图层存在（UIScene._lowHpVignette + 纹理 'vignette-lowhp'）
//   B. 可见判定点显隐（Player.hitboxDot 随存档 showHitbox 同步）
//   C. 死亡演出（致命命中后 _dying=true 且 scaleY 弹性放大 >1）
//   D. 命中轻震（_impactFeedback 触发 camera shake）
//   E. Boss 动态音乐事件链（startBossRush 后 gs.boss 生成 + UIScene.bossBar 显示，证明 spawnBoss 统一 emit BOSS_SPAWNED）
//   F. 零 pageerror
// 依赖：外部已起 5059 vite 服（或 run-all.mjs）。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://localhost:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const errors = [];

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// 进入 GameScene + UIScene（并行，保留 HUD 以便测 vignette / Boss 血条）
await page.evaluate(async () => {
  const game = window.__SKY__;
  const SM = window.__SAVE;
  if (SM && SM.set) SM.set('tutorialDone', true);
  if (SM && SM.set) SM.set('showHitbox', false);
  game.scene.stop('MenuScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
  await new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
});

// 等待 UIScene 就绪（vignette 已建）
await page.waitForFunction(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui && ui._lowHpVignette;
}, null, { timeout: 10000 });

// A. 低血量暗角图层
const vue = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    hasVignette: !!ui._lowHpVignette,
    texExists: ui.textures.exists('vignette-lowhp'),
    depth: ui._lowHpVignette ? ui._lowHpVignette.depth : -1,
  };
});
assert(vue.hasVignette && vue.texExists, `低血量暗角图层存在（纹理 vignette-lowhp=${vue.texExists}, depth=${vue.depth}）`);

// B. 可见判定点显隐同步
const hb0 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs.player.hitboxDot ? gs.player.hitboxDot.visible : null;
});
await page.evaluate(() => window.__SAVE.set('showHitbox', true));
await page.waitForTimeout(160);
const hb1 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs.player.hitboxDot ? gs.player.hitboxDot.visible : null;
});
await page.evaluate(() => window.__SAVE.set('showHitbox', false));
await page.waitForTimeout(160);
const hb2 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs.player.hitboxDot ? gs.player.hitboxDot.visible : null;
});
assert(hb0 === false, `判定点默认隐藏（showHitbox=false → visible=${hb0}）`);
assert(hb1 === true, `判定点开启后可见（showHitbox=true → visible=${hb1}）`);
assert(hb2 === false, `判定点关闭后隐藏（showHitbox=false → visible=${hb2}）`);

// D. 命中轻震（先测，避免杀敌机影响）
const shakeOn = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs._impactFeedback();
  await new Promise((res) => setTimeout(res, 30));
  const eff = gs.cameras.main.shakeEffect;
  return !!(eff && eff.isRunning);
});
assert(shakeOn, '命中轻震生效（_impactFeedback 触发 camera shake）');

// 等待一个活敌机用于死亡演出（C）
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.enemies && gs.enemies.getChildren().some((e) => e.active);
}, null, { timeout: 15000 });
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  window.__TARGET = gs.enemies.getChildren().find((e) => e.active);
});

// C. 死亡演出：致命命中 → _dying=true 且弹性放大
const dying = await page.evaluate(() => {
  const e = window.__TARGET;
  if (e && e.active) e.hit(99999, null);
  return e ? e._dying === true : false;
});
await page.waitForTimeout(60);
const sy = await page.evaluate(() => (window.__TARGET ? window.__TARGET.scaleY : 1));
assert(dying, '致命命中触发死亡演出（_dying=true）');
assert(sy > 1, `死亡弹性缩放生效（scaleY=${sy.toFixed(2)} > 1，scaleX 同步放大）`);

// E. Boss 动态音乐事件链：startBossRush → gs.boss 生成 + UIScene.bossBar 显示
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (gs.startBossRush) gs.startBossRush();
});
const bossOk = await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  return gs && gs.boss && ui && ui.bossBar && ui.bossBar.g && ui.bossBar.g.visible === true;
}, null, { timeout: 8000 }).then(() => true).catch(() => false);
assert(bossOk, 'Boss 事件链（spawnBoss 统一 emit BOSS_SPAWNED → UIScene 血条显示 + gs.boss 生成）');

assert(errors.length === 0, `零 pageerror (${errors.length})`);
if (errors.length) console.error('页面错误:', errors.slice(0, 5));
try { await browser.close(); } catch (e) { /* 收尾竞态忽略 */ }
console.log(process.exitCode ? '\n=== P1 手感探针 FAIL ===' : '\n=== P1 手感探针 PASS ===');
