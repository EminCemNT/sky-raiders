// 僚机第三版③集火指令 独立真测：
//   (A) GameScene 已绑定 F 键（focusKey 存在）
//   (B) setFocusTarget 写入焦点目标；toggleFocus 在有活目标时解除
//   (C) Wingman._pickTarget 集火目标绝对优先（压过角色瞄准偏好）
//   (D) WINGMAN_STATUS 广播 focus.active + UIScene 准星显隐 + 计数文本"· 集火"
//   (E) 焦点目标阵亡 -> update 自动解除集火（准星隐藏）
//   全程零 pageerror。
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

// 注入存档：苍鹰(thunder) + 2 僚机 + 武器 Lv1，启动 GameScene
log('\n【僚机第三版③ 集火指令】注入苍鹰+2僚机 并启动：');
await page.evaluate(({ up, sh }) => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, up); s.selectedShip = sh; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
}, { up: { wingman: 2, wingmanFirepower: 1 }, sh: 0 });
await sleep(2500);

// (A)(B)(C)：F 键绑定 + 设焦点 + _pickTarget 优先
const r1 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs && gs.wingmanSystem;
  if (!ws) return { hasWs: false };
  const fake = { active: true, x: 300, y: 250 }; // 纯占位目标（只被读 .active/.x/.y）
  window.__fake = fake;
  ws.setFocusTarget(fake);
  const w = ws.getMembers()[0];
  const picked = w._pickTarget({ focusTarget: fake, elementTarget: null, target: null });
  return {
    hasWs: true,
    hasFocusKey: !!gs.focusKey,
    focusSet: ws._focusTarget === fake,
    pickedIsFake: picked === fake,
  };
});
log('  r1 = ' + JSON.stringify(r1));
assert(r1.hasWs && r1.hasFocusKey, 'GameScene 已绑定集火 F 键（focusKey 存在）');
assert(r1.focusSet, 'setFocusTarget 写入焦点目标');
assert(r1.pickedIsFake, 'Wingman._pickTarget 集火目标绝对优先（压过角色偏好）');
if (!r1.hasWs) { /* 后续断言无意义 */ }

// (D)：等一帧，UIScene 应收到 focus.active -> 准星显示 + 计数文本"· 集火"
await sleep(300);
const r2 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  const ws = gs.wingmanSystem;
  return {
    focusActive: !!(ws._focusTarget && ws._focusTarget.active),
    reticleVisible: ui && ui.wmFocus ? ui.wmFocus.visible : null,
    countText: ui && ui.wmCountText ? ui.wmCountText.text : null,
  };
});
log('  r2 = ' + JSON.stringify(r2));
assert(r2.focusActive, '焦点目标存活（active）');
assert(r2.reticleVisible === true, 'UIScene 集火准星已显示（收到 focus.active）');
assert(r2.countText && r2.countText.includes('集火'), `计数文本含"集火"（${r2.countText}）`);

// (B2)：toggleFocus 在有活目标时应解除集火
const r3 = await page.evaluate(() => {
  const ws = window.__SKY__.scene.getScene('GameScene').wingmanSystem;
  ws.toggleFocus(); // 当前 fake 活跃 -> 应解除
  return { focusAfterToggle: ws._focusTarget };
});
assert(r3.focusAfterToggle === null, 'toggleFocus 解除现有集火（焦点置空）');

// (E)：焦点目标阵亡 -> update 自动解除（准星隐藏）
const r4 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.wingmanSystem;
  const fake2 = { active: true, x: 200, y: 300 };
  window.__fake2 = fake2;
  ws.setFocusTarget(fake2);
  return { set: ws._focusTarget === fake2 };
});
assert(r4.set, '重新设定焦点目标 fake2');
await sleep(300);
const r5 = await page.evaluate(() => {
  const ws = window.__SKY__.scene.getScene('GameScene').wingmanSystem;
  window.__fake2.active = false; // 模拟目标阵亡
  return { before: !!ws._focusTarget };
});
await sleep(400); // 等若干帧让 update 自动解除
const r6 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.wingmanSystem;
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    focusCleared: ws._focusTarget === null,
    reticleHidden: ui && ui.wmFocus ? !ui.wmFocus.visible : null,
  };
});
log('  r6 = ' + JSON.stringify(r6));
assert(r6.focusCleared, '焦点目标阵亡后 update 自动解除集火（焦点置空）');
assert(r6.reticleHidden === true, '准星随集火解除自动隐藏');

await sleep(300);
assert(pageErrors.length === 0, `运行零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('  ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ 僚机第三版③集火指令 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ 集火指令 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
