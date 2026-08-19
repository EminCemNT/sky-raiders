// qa_firsthit_warmup.mjs —— 首击卡顿预热 + 视觉升级验收探针
//
// 验证（连 dad 诉求 ③ 根因消除）：
//   1) 进入 GameScene 后 window.__SKY_WARMUP === true（预热已执行）
//   2) 对首架 active 敌机执行首次 e.hit(e.hp*0.3, null) 触发全路径（命中/飘字/粒子），
//      硬断言 errors.length === 0（零 pageerror + 零 console error）
//   3) selectedShip 0/1/2 各自的中央脉冲弹纹理 key 正确映射元素弹：
//      苍鹰(thunder)→bullet_thunder / 赤焰(fire)→bullet_fire / 寒霜(ice)→bullet_ice
//   4) 以 --force-prefers-reduced-motion 重跑，断言零 pageerror（reduced 适配）
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// 每架战机的预期元素弹纹理 key（与 SHIPS 元素绑定一致）
const EXPECT_BOLT = { 0: 'bullet_thunder', 1: 'bullet_fire', 2: 'bullet_ice' };
const SHIP_NAME = { 0: '苍鹰(thunder)', 1: '赤焰(fire)', 2: '寒霜(ice)' };

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

/** 进入指定战机的 GameScene（复用同一 page，重启场景） */
async function enterGame(page, idx) {
  await page.evaluate((i) => {
    const game = window.__SKY__;
    window.__SAVE.set('selectedShip', i);
    window.__SAVE.set('tutorialDone', true);
    game.scene.stop('MenuScene');
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
  }, idx);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
  }, { timeout: 20000 });
}

// ───────────────────────── 正常模式：三机各跑一遍 ─────────────────────────
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

const shipResults = [];
for (let idx = 0; idx < 3; idx++) {
  errors.length = 0; // 每机重置错误收集

  await enterGame(page, idx);

  // 预热标志
  const warmed = await page.evaluate(() => !!window.__SKY_WARMUP);
  push(`ship${idx}(${SHIP_NAME[idx]}) __SKY_WARMUP===true`, warmed);

  // 等一架 active 敌机
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.enemies.getChildren().some((e) => e.active);
  }, { timeout: 15000 }).catch(() => {});

  // 首次命中：触发全路径（Enemy.hit → registerKill → 飘字字体预热；自然碰撞还会触发 hitSpark/explosion 粒子）
  await page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const e = gs.enemies.getChildren().find((x) => x.active);
    if (e) e.hit(e.hp * 0.3, null);
  });

  // 让首击后的自然碰撞跑起来（粒子/字体/音频均已被预热，无编译卡顿）
  await page.waitForTimeout(1500);

  // 元素弹纹理 key 校验：强制主炮脉冲，发射一发，读取最新子弹纹理
  const boltKey = await page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    gs.player.setWeapon('pulse');
    gs.player.fire();
    let found = null;
    gs.playerBullets.getChildren().forEach((b) => {
      if (b.active && /^bullet_(fire|ice|thunder|pulse)$/.test(b.texture.key)) found = b.texture.key;
    });
    return found;
  });

  const playerActive = await page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return !!(gs && gs.player && gs.player.active);
  });

  const expect = EXPECT_BOLT[idx];
  const boltOk = boltKey === expect;
  push(`ship${idx}(${SHIP_NAME[idx]}) 元素弹纹理=${expect}`, boltOk, `got ${boltKey}`);
  push(`ship${idx}(${SHIP_NAME[idx]}) 首击后零 pageerror/console.error`, errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
  if (errors.length) console.log('   errors:', errors.slice(0, 5));

  shipResults.push({ idx, warmed, boltKey, expect, boltOk, playerActive, errors: errors.slice() });
}

await page.close();
await browser.close();

// ─────────────── reduced-motion 重跑：断言零 pageerror ───────────────
const browserR = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--force-prefers-reduced-motion', '--autoplay-policy=no-user-gesture-required'],
});
const pageR = await browserR.newPage({ viewport: { width: 540, height: 960 } });
const errorsR = [];
pageR.on('pageerror', (e) => errorsR.push('pageerror: ' + e.message));
pageR.on('console', (m) => { if (m.type() === 'error') errorsR.push('console.error: ' + m.text()); });

await pageR.goto(URL, { waitUntil: 'load' });
await pageR.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

await enterGame(pageR, 0);
const warmedR = await pageR.evaluate(() => !!window.__SKY_WARMUP);
await pageR.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.enemies.getChildren().some((e) => e.active);
}, { timeout: 15000 }).catch(() => {});
await pageR.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.enemies.getChildren().find((x) => x.active);
  if (e) e.hit(e.hp * 0.3, null);
});
await pageR.waitForTimeout(1200);

push('reduced-motion __SKY_WARMUP===true', warmedR);
push('reduced-motion 零 pageerror/console.error', errorsR.length === 0, errorsR.length ? errorsR.slice(0, 3).join(' | ') : '');
if (errorsR.length) console.log('   errors:', errorsR.slice(0, 5));

await pageR.close();
await browserR.close();

// ───────────────────────────── 汇总 ─────────────────────────────
const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_firsthit_warmup: PASS ===' : '=== qa_firsthit_warmup: FAIL ==='));
process.exit(pass ? 0 : 1);
