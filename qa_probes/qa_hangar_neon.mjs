// Phase F 机库霓虹化 QA：标题辉光 + 卡片发光描边 + 入场动画恢复 + 返回按钮 + 零 pageerror
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

await page.waitForFunction(() => {
  const g = window.__SKY__;
  return g && g.scene.getScene('MenuScene') && g.scene.getScene('MenuScene').scene.isActive();
}, { timeout: 20000 });

await page.evaluate(() => window.__SKY__.scene.start('HangarScene'));
await page.waitForFunction(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return hs && hs.scene.isActive() && hs.rows && hs.rows.length > 0;
}, { timeout: 20000 });

// 等入场动画（错峰 delay 350 + 340 ≈ 700ms，留足余量）
await page.waitForTimeout(1300);

const info = await page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return {
    hasTitleGlow: !!hs.titleGlow,
    rowCount: hs.rows ? hs.rows.length : 0,
    cardGlowOk: !!(hs.rows && hs.rows.length && hs.rows.every((r) => r.cardGlow && r.cardGlow.type === 'Graphics')),
    cardAlphaOk: !!(hs.rows && hs.rows.length && hs.rows.every((r) => r.card && r.card.alpha > 0.9)),
    hasBackBtn: hs.children.list.some((c) => c.type === 'Container' && c.list && c.list.some((ch) => ch.type === 'Text' && ch.text === '返回菜单')),
  };
});

await browser.close();

const checks = [
  ['标题辉光层存在', info.hasTitleGlow],
  ['部件卡片≥6', info.rowCount >= 6],
  ['卡片发光描边存在', info.cardGlowOk],
  ['入场动画后卡片alpha恢复', info.cardAlphaOk],
  ['返回菜单按钮存在', info.hasBackBtn],
  ['零 pageerror', errors.length === 0],
];
let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'PHASE_F_HANGAR_NEON: PASS' : 'PHASE_F_HANGAR_NEON: FAIL');
process.exit(pass ? 0 : 1);
