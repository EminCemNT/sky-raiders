import { chromium } from 'playwright';

const URL = process.env.URL || 'http://127.0.0.1:5051/';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });

const logs = [];
page.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText || ''}`));

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
} catch (e) {
  console.log('GOTO FAILED:', e.message);
}

await page.waitForTimeout(5000);
await page.screenshot({ path: 'shot_visual_menu.png' });

// 开始游戏：逻辑中心 (270,480) -> 屏幕 (360,640)
await page.mouse.click(360, 640);
await page.waitForTimeout(5000);
await page.screenshot({ path: 'shot_visual_tutorial.png' });

// 跳过教程：逻辑 (160,550) -> 屏幕 (213,733)
await page.mouse.click(213, 733);
await page.waitForTimeout(5000);

// 移动玩家机到屏幕中心，便于看清战机
await page.mouse.click(360, 640);
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shot_visual_battle.png' });

console.log('=== LOGS ===');
console.log(logs.join('\n') || '(none)');
console.log('=== DONE ===');

await browser.close();
