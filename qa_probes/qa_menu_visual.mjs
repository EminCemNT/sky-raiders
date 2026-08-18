// Phase A 视觉 QA：主菜单标题辉光/能量环/英文名 + 按钮 glow 容器 + 功能回归(开始游戏进GameScene) + 零 pageerror
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

// 等 MenuScene 激活且有内容
await page.waitForFunction(() => {
  const g = window.__SKY__;
  if (!g) return false;
  const ms = g.scene.getScene('MenuScene');
  return ms && ms.scene.isActive() && ms.children && ms.children.list.length > 0;
}, { timeout: 20000 });

await page.waitForTimeout(900); // 让标题/环 tween 跑几帧

const info = await page.evaluate(() => {
  const g = window.__SKY__;
  const ms = g.scene.getScene('MenuScene');
  const list = ms.children.list;
  return {
    hasTitle: list.some((c) => c.text && c.text.includes('苍穹战机')),
    hasTitleGlow: !!ms.titleGlow,
    hasRing: !!ms.energyRing,
    hasSub: !!ms.subTitle,
    btnContainers: list.filter((c) => c.type === 'Container').length,
  };
});

// 功能回归：点开始游戏进 GameScene（确认标题/环改动未破坏 startGame）
await page.evaluate(() => { window.__SKY__.scene.getScene('MenuScene').startGame(); });
await page.waitForFunction(() => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await page.waitForTimeout(500);

const gameOk = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return !!(gs && gs.player && gs.player.active);
});

await browser.close();

const checks = [
  ['标题文本存在', info.hasTitle],
  ['标题辉光层', info.hasTitleGlow],
  ['能量环存在', info.hasRing],
  ['英文名存在', info.hasSub],
  ['按钮容器≥9', info.btnContainers >= 9],
  ['开始游戏进 GameScene', gameOk],
  ['零 pageerror', errors.length === 0],
];
let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'PHASE_A_VISUAL: PASS' : 'PHASE_A_VISUAL: FAIL');
process.exit(pass ? 0 : 1);
