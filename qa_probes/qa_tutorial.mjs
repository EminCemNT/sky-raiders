// 教程引导独立真测：首玩触发 6 步教程、分步推进、完成置 tutorialDone、forceTutorial 覆盖重看、零 pageerror。
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
await sleep(300);

// (A) 注入 tutorialDone=false，启动 GameScene（normal）触发首玩教程
log('\n【教程引导】注入 tutorialDone=false 并启动 GameScene：');
await page.evaluate(() => {
  const s = window.__SAVE.load();
  s.tutorialDone = false;
  window.__SAVE.save();
  window.__SKY__.scene.stop('MenuScene');
  window.__SKY__.scene.stop('GameScene');
  window.__SKY__.scene.stop('UIScene');
  window.__SKY__.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => window.__SKY && window.__SKY._tutorialCtl, null, { timeout: 15000 });
await sleep(300);

const init = await page.evaluate(() => ({
  total: window.__SKY._tutorialCtl.total,
  step: window.__SKY._tutorialCtl.getStep(),
  done: window.__SAVE.get('tutorialDone'),
}));
assert(init.total === 6, `教程步骤数=6（覆盖移动/开火/技能/HUD/集火/进阶，实际 ${init.total}）`);
assert(init.step === 0, `首步索引=0（实际 ${init.step}）`);
assert(init.done === false, '初始 tutorialDone=false（首玩触发）');

// (B) 分步推进：advance 0->5，第 6 步 finish
log('【教程引导】分步推进 0→5 并结束：');
let ok = true;
for (let k = 0; k < 5; k++) {
  const before = await page.evaluate(() => window.__SKY._tutorialCtl.getStep());
  if (before !== k) { ok = false; break; }
  await page.evaluate(() => window.__SKY._tutorialCtl.advance());
  await sleep(60);
  const after = await page.evaluate(() => window.__SKY._tutorialCtl.getStep());
  if (after !== k + 1) { ok = false; break; }
}
assert(ok, 'advance 使步骤 0→1→2→3→4→5 递增');
// 第 6 步（i=5）advance -> finish
await page.evaluate(() => window.__SKY._tutorialCtl.advance());
await sleep(200);
const fin = await page.evaluate(() => ({
  ctl: window.__SKY._tutorialCtl,
  done: window.__SAVE.get('tutorialDone'),
  paused: window.__SKY.physics.world.isPaused,
}));
assert(fin.ctl === null, '完成后 _tutorialCtl 置空（overlay 销毁）');
assert(fin.done === true, '完成后 tutorialDone=true（成就钩子就绪）');
assert(fin.paused === false, '完成后物理世界恢复（非暂停）');

// (C) forceTutorial 覆盖：tutorialDone=true 时仍能重看（菜单"新手教程"按钮路径）
log('【教程引导】forceTutorial 覆盖重看：');
await page.evaluate(() => {
  window.__SKY__.scene.stop('GameScene');
  window.__SKY__.scene.stop('UIScene');
  window.__SKY__.scene.start('GameScene', { mode: 'normal', levelId: 1, forceTutorial: true });
});
await page.waitForFunction(() => window.__SKY && window.__SKY._tutorialCtl, null, { timeout: 15000 });
await sleep(200);
const forced = await page.evaluate(() => ({
  total: window.__SKY._tutorialCtl.total,
  done: window.__SAVE.get('tutorialDone'),
}));
assert(forced.total === 6, `forceTutorial 下教程再次出现（total=${forced.total}）`);
assert(forced.done === true, 'forceTutorial 时 tutorialDone 仍为 true（重看不重置进度）');
await page.evaluate(() => window.__SKY._tutorialCtl.finish());
await sleep(150);

await sleep(200);
assert(pageErrors.length === 0, `全程零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('  ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ 教程引导 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ 教程引导 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
