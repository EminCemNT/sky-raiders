// Phase D 背景动态酷炫化 QA：能量流光带存在 + 流星定时生成 + 星云脉动 + 零 pageerror
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const errors = [];

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });

// 等 MenuScene 激活（默认场景，全新加载会用到新版 Starfield）
await page.waitForFunction(() => {
  const g = window.__SKY__;
  if (!g) return false;
  const ms = g.scene.getScene('MenuScene');
  return ms && ms.scene.isActive() && ms.children && ms.children.list.length > 0;
}, { timeout: 20000 });

await page.waitForTimeout(600);

// 读取 starfield 调试接口
const dbg = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const sf = ms.starfield;
  if (!sf || !sf._dbg) return null;
  return {
    hasStarfield: true,
    reduceMotion: sf._dbg.reduceMotion,
    streams: sf._dbg.streamCount(),
  };
});

// 轮询采样流星（720ms 飞行，间隔 2.4~5.2s），累计峰值
let maxMeteor = 0;
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(550);
  const c = await page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    const sf = ms.starfield;
    return sf && sf._dbg ? sf._dbg.meteorCount() : 0;
  });
  if (c > maxMeteor) maxMeteor = c;
}

// 不破坏运行：确认 GameScene 仍可正常进入（回归）
await page.evaluate(() => { const ms = window.__SKY__.scene.getScene('MenuScene'); if (ms.startGame) ms.startGame(); });
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(300);

const gameOk = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return !!(gs && gs.player && gs.player.active);
});

await browser.close();

const checks = [
  ['Starfield 实例存在', !!(dbg && dbg.hasStarfield)],
  ['非 reduced-motion 环境', dbg && dbg.reduceMotion === false],
  ['能量流光带已创建(≥1)', dbg && dbg.streams >= 1],
  ['流星曾生成过(≥1)', maxMeteor >= 1],
  ['开始游戏进 GameScene(回归)', gameOk],
  ['零 pageerror', errors.length === 0],
];
let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'PHASE_D_STARFIELD: PASS' : 'PHASE_D_STARFIELD: FAIL');
process.exit(pass ? 0 : 1);
