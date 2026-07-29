import { chromium } from 'playwright';

const URL = process.env.URL || 'http://127.0.0.1:5055/';
const W = 720, H = 1280; // 视口（逻辑 540x960 等比缩放因子 1.333）

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shot_ui_menu.png' });
console.log('[1] 菜单截图完成');

// 开始游戏（逻辑 270,480 -> 视口 360,640）
await page.mouse.click(360, 640);
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shot_ui_tutorial.png' });
console.log('[2] 教程截图完成');

// 跳过（逻辑 160,550 -> 视口 213,733）
await page.mouse.click(213, 733);
await page.waitForTimeout(800);
// 把玩家机移到下方中央，便于看清 HUD
await page.mouse.move(360, 760);
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shot_ui_battle.png' });
console.log('[3] 战斗 HUD 截图完成');

console.log('=== 错误数:', errors.length);
errors.forEach((e) => console.log(e));
await browser.close();
