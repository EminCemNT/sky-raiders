import { chromium } from 'playwright';

const URL = process.env.URL || 'http://127.0.0.1:5059/';
const W = 720, H = 1280; // 视口（逻辑 540x960 缩放因子 1.333）

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 开始游戏（逻辑 270,480 -> 视口 360,640）
await page.mouse.click(360, 640);
await page.waitForTimeout(1000);
// 跳过（逻辑 160,550 -> 视口 213,733）
await page.mouse.click(213, 733);
await page.waitForTimeout(1500);

// 移动玩家到中间偏下，便于炸弹以玩家为中心爆发
await page.mouse.move(360, 800);
await page.waitForTimeout(1500);

// 点击炸弹按钮（右下角，逻辑 GAME_WIDTH-60, GAME_HEIGHT-70 ≈ 480,890 -> 视口 640,1187）
await page.mouse.click(640, 1187);
await page.waitForTimeout(400); // 冲击波爆发瞬间
await page.screenshot({ path: 'shot_vfx_bomb.png' });
console.log('[1] 炸弹冲击波截图完成');

// 再等 2 秒，看连环爆炸/尾焰 steady state
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shot_vfx_battle.png' });
console.log('[2] 战斗稳态截图完成');

console.log('=== 错误数:', errors.length);
errors.forEach((e) => console.log(e));
await browser.close();
