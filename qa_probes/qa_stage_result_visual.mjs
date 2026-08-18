// Phase C 视觉 QA：过场与结算仪式感（开场 Stage Banner + 胜利爆闪 + 星级爆闪光圈）+ 零 pageerror
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
await page.waitForTimeout(600);

// 开场 Stage Banner 检查（container 内含 STAGE/BOSS RUSH 子文本）
const stage = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  const hasMethod = typeof ui.showStageBanner === 'function';
  const bannerText = ui.children.list.some((c) => c.type === 'Container' && c.list
    && c.list.some((t) => t.type === 'Text' && t.text && /STAGE|BOSS RUSH/.test(t.text)));
  return { hasMethod, bannerText };
});

// 启动结算（胜利）场景：先停战斗/HUD 场景，等一帧，再启动 Result，避免同帧 stop+start 时序问题
await page.evaluate(() => {
  const g = window.__SKY__;
  g.scene.stop('GameScene');
  g.scene.stop('UIScene');
});
await page.waitForTimeout(150);
await page.evaluate(() => {
  const g = window.__SKY__;
  g.scene.start('ResultScene', { victory: true, levelId: 1, stars: 3, score: 1234, kills: 20, coins: 60 });
});
const dbg = await page.evaluate(() => {
  const g = window.__SKY__;
  const sm = g.scene;
  const rs = sm.getScene('ResultScene');
  return {
    resultExists: !!rs,
    rsActive: rs ? rs.scene.isActive() : null,
    scenes: sm.scenes.map((s) => s.scene.key + (s.scene.isActive() ? ':A' : ':i')),
  };
});
console.log('DEBUG after start: ' + JSON.stringify(dbg));
try {
  await page.waitForFunction(() => {
    const g = window.__SKY__;
    const rs = g.scene.getScene('ResultScene');
    return rs && rs.scene.isActive();
  }, { timeout: 10000 });
} catch (e) {
  console.log('Result wait timeout. captured errors:\n' + (errors.join('\n') || '(none)'));
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(250);

const res = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  const flash = rs.children.list.some((c) => c.type === 'Rectangle' && c.fillColor === 0xffffff);
  const burst = rs.children.list.some((c) => c.type === 'Arc');
  return { flash, burst };
});

await browser.close();

const checks = [
  ['showStageBanner 方法存在', stage.hasMethod],
  ['开场 Stage Banner 文本出现', stage.bannerText],
  ['胜利全屏爆闪存在', res.flash],
  ['星级爆闪光圈存在', res.burst],
  ['零 pageerror', errors.length === 0],
];
let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'PHASE_C_VISUAL: PASS' : 'PHASE_C_VISUAL: FAIL');
process.exit(pass ? 0 : 1);
