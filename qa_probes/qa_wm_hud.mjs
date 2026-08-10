// HUD 僚机状态指示独立真测：注入苍鹰(thunder)+2僚机+Lv1，验证 UIScene 渲染 + 零 pageerror。
import { chromium } from 'playwright';
const URL = 'http://localhost:5059/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });

let fails = 0;
const assert = (cond, msg) => { if (!cond) { fails++; log('  ❌ FAIL: ' + msg); } else { log('  ✅ ' + msg); } };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE && !!window.__ACH__, null, { timeout: 20000 });
await sleep(500);

// 注入存档：苍鹰(thunder) + 2 僚机 + 武器 Lv1，启动 GameScene（其 create 会并行 launch UIScene）
log('\n【HUD 僚机状态指示】注入苍鹰+2僚机+Lv1 并启动：');
await page.evaluate(({ up, sh }) => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, up); s.selectedShip = sh; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
}, { up: { wingman: 2, wingmanFirepower: 1 }, sh: 0 });
await sleep(3500);

const hud = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  if (!ui) return { hasUI: false };
  const dots = ui.wmDots || [];
  return {
    hasUI: true,
    titleVisible: ui.wmTitle ? ui.wmTitle.visible : null,
    dotsLen: dots.length,
    d0: dots[0] ? dots[0].g.visible : null,
    d1: dots[1] ? dots[1].g.visible : null,
    d2: dots[2] ? dots[2].g.visible : null,
    countText: ui.wmCountText ? ui.wmCountText.text : null,
  };
});
log('  HUD = ' + JSON.stringify(hud));
assert(hud.hasUI, 'UIScene 实例存在（GameScene 已 launch）');
assert(hud.titleVisible === true, '僚机标题已显示（收到 WINGMAN_STATUS 快照）');
assert(hud.dotsLen === 4, `预建圆点=4（WINGMAN.MAX，实际 ${hud.dotsLen}）`);
assert(hud.d0 === true && hud.d1 === true, '前 2 架僚机圆点可见（count=2 活跃）');
assert(hud.d2 === false, '第 3 架圆点隐藏（超出 count）');
assert(hud.countText && hud.countText.includes('2架') && hud.countText.includes('Lv1'),
  `僚机计数文本正确（${hud.countText}）`);

await sleep(300);
assert(pageErrors.length === 0, `启动/运行零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('  ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ HUD 僚机状态指示 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ HUD 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
