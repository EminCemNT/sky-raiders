import { chromium } from 'playwright';

const URL = process.env.URL || 'http://127.0.0.1:5050/';
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
await page.screenshot({ path: 'shot_menu.png' });
console.log('=== MENU CONSOLE/ERRORS ===');
console.log(logs.join('\n') || '(none)');
console.log('=== canvas size ===');
const box = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return 'NO CANVAS';
  const r = c.getBoundingClientRect();
  return `canvas rect: x=${r.x} y=${r.y} w=${r.width} h=${r.height}`;
});
console.log(box);

// 尝试点击多个候选点
const points = [
  { x: 360, y: 480, name: 'design-center' },
  { x: 480, y: 640, name: 'scaled-center' },
  { x: 300, y: 480, name: 'left-center' },
  { x: 360, y: 500, name: 'center-lower' },
  { x: 360, y: 450, name: 'center-upper' },
];
for (const p of points) {
  console.log(`--- click ${p.name} (${p.x},${p.y}) ---`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `shot_after_${p.name}.png` });
}
const afterLogs = [];
console.log('=== AFTER CLICK CONSOLE/ERRORS ===');
console.log(logs.join('\n') || '(none)');

await browser.close();
console.log('DONE');
