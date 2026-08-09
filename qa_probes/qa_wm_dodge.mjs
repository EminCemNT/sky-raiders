// 僚机第三版②走位规避增强 独立真测：
//   注入苍鹰+2僚机，直接对 Wingman._computeDodge 喂合成敌弹，验证
//   (A) 反应式排斥仍生效（静止弹/上方来弹→向上逃逸）
//   (B) 预测式侧步新增生效（带速弹道预判→垂直弹道侧步避让）
//   (C) 无威胁时空向量归零（回归基线不被破坏）
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
log('\n【僚机第三版② 走位规避增强】注入苍鹰+2僚机 并启动：');
await page.evaluate(({ up, sh }) => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, up); s.selectedShip = sh; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
}, { up: { wingman: 2, wingmanFirepower: 1 }, sh: 0 });
await sleep(3000);

const res = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs && gs.wingmanSystem;
  const w = ws && ws.getMembers()[0];
  if (!w) return { hasWingman: false };
  const eb = gs.enemyBullets;

  // 工具：在 (bx,by) 处造一颗带速度 (vx,vy) 的敌弹（复用敌弹池）
  const makeBullet = (bx, by, vx, vy) => {
    const b = eb.get(bx, by, 'bullet_enemy');
    if (!b) return null;
    b.setActive(true).setVisible(true);
    if (b.body) b.body.enable = true;
    b.setVelocity(vx, vy);
    return b;
  };

  // (A) 反应式回归：静止弹、正上方 60px（RADIUS=120 内）→ 应向上(+y)逃逸
  w.x = 270; w.y = 600;
  w.dodgeVec.x = 0; w.dodgeVec.y = 0;
  const bA = makeBullet(w.x, w.y - 60, 0, 0);
  w._computeDodge([bA]);
  const a = { x: w.dodgeVec.x, y: w.dodgeVec.y };

  // (B) 预测式侧步：带速弹，来自下方正冲上来、500ms 内会正撞僚机。
  //     反应式只躲"上方来弹"，此弹在下方 → 反应式跳过，干净隔离出预测式。
  //     预测式应能沿垂直弹道方向横向侧步避让（实测 x 主导、y≈0）。
  w.x = 270; w.y = 600;
  w.dodgeVec.x = 0; w.dodgeVec.y = 0;
  const bB = makeBullet(w.x, w.y + 100, 0, -200); // 正下方 100px、直上 200px/s → TCA=0.5s<0.6
  w._computeDodge([bB]);
  const b = { x: w.dodgeVec.x, y: w.dodgeVec.y };

  // (C) 回归基线：无威胁 → 空向量
  w.x = 270; w.y = 600;
  w.dodgeVec.x = 0; w.dodgeVec.y = 0;
  w._computeDodge([]);
  const c = { x: w.dodgeVec.x, y: w.dodgeVec.y };

  // 收尾：回收测试弹，避免污染后续帧
  [bA, bB].forEach((bb) => { if (bb && bb.setActive) { bb.setActive(false).setVisible(false); if (bb.body) bb.body.enable = false; } });
  return { hasWingman: true, reactive: a, predict: b, baseline: c };
});

log('  result = ' + JSON.stringify(res));
assert(res.hasWingman, '僚机实例存在（wingman=2 已激活）');
if (res.hasWingman) {
  // (A) 反应式：上方静止弹 → 向上(+y)逃逸，y 明显 > 0
  assert(res.reactive.y > 2 && Math.abs(res.reactive.x) < 1,
    `反应式排斥仍生效（上方来弹向上逃逸 y=${res.reactive.y.toFixed(2)}）`);
  // (B) 预测式侧步：带速正撞弹 → 垂直弹道侧步，横向 |x| 明显 > 5 且 y 接近 0
  assert(Math.abs(res.predict.x) > 5 && Math.abs(res.predict.y) < 2,
    `预测式侧步生效（垂直弹道侧步 x=${res.predict.x.toFixed(2)}）`);
  // (B) 反向对照：同一弹预测出的侧步方向必须垂直于其弹道(纯竖直)，即 y≈0、x≠0
  assert(Math.abs(res.predict.x) > Math.abs(res.predict.y) * 5,
    '侧步方向垂直于弹道（横向主导，符合"让开弹道"语义）');
  // (C) 基线：无威胁 → 空向量（回归不被破坏）
  assert(Math.abs(res.baseline.x) < 0.001 && Math.abs(res.baseline.y) < 0.001,
    `无威胁时空向量归零（基线未破坏 ${res.baseline.x.toFixed(3)},${res.baseline.y.toFixed(3)}）`);
}

await sleep(300);
assert(pageErrors.length === 0, `运行零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('  ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ 僚机第三版②走位规避增强 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ 走位规避增强 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
