// Phase B 视觉 QA：战斗 HUD 精致化（分数等宽 / Boss名字辉光 / 低血红框 / 炸弹辉光）+ 触发 Boss 与低血回归 + 零 pageerror
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

// 进 GameScene
await page.waitForFunction(() => {
  const g = window.__SKY__;
  const ms = g && g.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });
await page.evaluate(() => { window.__SKY__.scene.getScene('MenuScene').startGame(); });
await page.waitForFunction(() => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await page.waitForTimeout(800);

const ui = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    scoreMono: ui.scoreText && /monospace/i.test(ui.scoreText.style.fontFamily || ''),
    scoreInit: ui.scoreText && ui.scoreText.text,
    bombRing: !!(ui.bombIcon && ui.bombIcon.ring),
    bombRingAlpha: (ui.bombIcon && ui.bombIcon.ring) ? ui.bombIcon.ring.alpha : -1,
    bossName: !!ui.bossNameText,
    border: !!ui._lowHpBorder,
  };
});

// 触发 Boss（普通关直接 spawn，验证 Boss 名字常驻辉光 + 血条可见）
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (gs.spawnBoss) gs.spawnBoss('boss_sentinel');
});
await page.waitForTimeout(1200);
const boss = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    bossNameVisible: !!(ui.bossNameText && ui.bossNameText.visible),
    bossName: ui.bossNameText && ui.bossNameText.text,
    bossBarVisible: !!(ui.bossBar && ui.bossBar.g && ui.bossBar.g.visible),
  };
});

// 低血告警：直接 updateHp 到低血，验证红框 base>0 且可见
await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  ui.updateHp(10, 100);
});
await page.waitForTimeout(300);
const low = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return { borderBase: ui._lowHpBorderBase, borderVisible: !!(ui._lowHpBorder && ui._lowHpBorder.visible) };
});

await browser.close();

const checks = [
  ['分数等宽字体', ui.scoreMono],
  ['分数初始6位', ui.scoreInit === '000000'],
  ['炸弹环存在', ui.bombRing],
  ['炸弹环辉光(alpha>0)', ui.bombRingAlpha > 0],
  ['Boss名字文本存在', ui.bossName],
  ['Boss名字来袭可见', boss.bossNameVisible],
  ['Boss名字非空', !!(boss.bossName && boss.bossName.length > 0)],
  ['Boss血条可见', boss.bossBarVisible],
  ['低血红框告警base>0', low.borderBase > 0],
  ['低血红框可见', low.borderVisible],
  ['零 pageerror', errors.length === 0],
];
let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'PHASE_B_VISUAL: PASS' : 'PHASE_B_VISUAL: FAIL');
process.exit(pass ? 0 : 1);
