// qa_mobile.mjs —— 移动端适配真测
// 验证：① 移动端视口（390×844/hasTouch）下游戏正常加载、零 pageerror；
//       ② Scale.FIT 保持竖版比例（canvas 存在且非拉伸变形）；
//       ③ 模拟触摸拖动 → 玩家跟随手指移动（核心移动端交互）；
//       ④ 触摸点击不触发异常。
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
  args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
// 移动端上下文：竖屏手机视口 + 触摸 + 高 DPR
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });
process.on('unhandledRejection', (e) => { console.error('UNHANDLED_REJECTION:', e); process.exitCode = 1; });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// 跳过教程，直接进入普通关卡（同时确认菜单→游戏场景切换在移动端无碍）
const loaded = await page.evaluate(async () => {
  const game = window.__SKY__;
  const SM = window.__SAVE;
  if (SM && SM.set) SM.set('tutorialDone', true);
  game.scene.stop('UIScene');
  game.scene.stop('GameScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  await new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) {
        clearInterval(iv); res();
      } else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
  const gs = game.scene.getScene('GameScene');
  const canvas = game.canvas;
  const rect = canvas.getBoundingClientRect();
  // 竖版逻辑尺寸（与 GameConfig GAME_WIDTH/HEIGHT 一致）
  const GW = 540, GH = 960;
  return {
    hasPlayer: !!(gs && gs.player && gs.player.active),
    canvasW: rect.width, canvasH: rect.height,
    left: rect.left, top: rect.top,
    startX: gs.player.x, startY: gs.player.y,
    GW, GH,
  };
});

// ① 游戏加载 / 玩家就绪
assert(loaded.hasPlayer, 'GameScene 玩家在移动端视口下就绪');
// ② Scale.FIT：canvas 存在且维持竖版比例（540:960 ≈ 0.5625），
//    FIT 下 CSS 宽高比应≈逻辑宽高比（letterbox 不拉伸）
const cssRatio = loaded.canvasW / loaded.canvasH;
const logicalRatio = loaded.GW / loaded.GH;
assert(Math.abs(cssRatio - logicalRatio) < 0.02, `Scale.FIT 保持竖版比例 (css=${cssRatio.toFixed(3)} vs logic=${logicalRatio.toFixed(3)})`);

// ③ 触摸拖动跟手：CDP 派发真实 touch 事件
const client = await context.newCDPSession(page);
function toCss(gx, gy) {
  // canvas 内像素 → CSS 坐标（FIT + CENTER_BOTH，画布可能居中留黑边）
  const sx = loaded.canvasW / loaded.GW;
  const sy = loaded.canvasH / loaded.GH;
  return { x: loaded.left + gx * sx, y: loaded.top + gy * sy };
}
const a = toCss(270, 700);   // 起点（中部偏下）
const b = toCss(120, 360);   // 终点（左上偏移）
await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x, y: b.y }] });
// 等待若干帧让 Player.update 跟随
await new Promise((res) => setTimeout(res, 400));
const after = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { x: gs.player.x, y: gs.player.y, isDown: gs.input.activePointer.isDown };
});
await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

// 断言：玩家朝拖动终点方向移动（不要求精确命中，给足容差）
const movedDist = Math.hypot(after.x - loaded.startX, after.y - loaded.startY);
assert(movedDist > 40, `触摸拖动后玩家跟随移动 (Δ=${movedDist.toFixed(0)} 逻辑像素)`);
// 终点目标游戏坐标经 clamp：tx∈[20,520], ty∈[40,940]；玩家应靠近 (120, 320)
const nearTarget = Math.hypot(after.x - 120, after.y - 320) < 120;
assert(nearTarget, `玩家位置靠近拖动终点 (x=${after.x.toFixed(0)}, y=${after.y.toFixed(0)})`);

// ④ 触摸点击（tap）不引发异常：在画布空白区轻点
const tap = toCss(270, 500);
await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tap.x, y: tap.y }] });
await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await new Promise((res) => setTimeout(res, 150));

assert(errors.length === 0, `零 pageerror (${errors.length})`);
if (errors.length) console.error('页面错误:', errors.slice(0, 5));

try {
  await browser.close();
} catch (e) {
  console.error('browser.close 异常:', e && e.message ? e.message : String(e));
  process.exitCode = 1;
}
console.log(process.exitCode ? '\n=== 移动端探针 FAIL ===' : '\n=== 移动端探针 PASS ===');
