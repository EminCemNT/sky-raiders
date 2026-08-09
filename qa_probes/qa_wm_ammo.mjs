// 僚机第三版④导弹/激光僚机弹 独立真测：
//   (A) 旧档位( lv0 单发脉冲 )不受影响：homing=false / pierce=0 / 未拉伸 / 未染色
//   (B) 新增 lv4 追踪导弹：spawnWingmanBullet 置 homing=true（复用 steerHomingBullets 转向）
//   (C) 新增 lv5 穿透激光：pierce>=8 + 纵向拉伸(scaleY>1.5) + 激光青染色
//   (D) killBullet 复位 scale/tint，杜绝激光拉伸/染色污染池复用（主炮/其他僚机弹）
//   (E) setWeaponLv 上限已扩展到 5（新档位可达）
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

// 注入存档：苍鹰(thunder) + 2 僚机 + 武器拉满 Lv5，启动 GameScene
log('\n【僚机第三版④ 导弹/激光僚机弹】注入苍鹰+2僚机+Lv5 并启动：');
await page.evaluate(({ up, sh }) => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, up); s.selectedShip = sh; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
}, { up: { wingman: 2, wingmanFirepower: 5 }, sh: 0 });
await sleep(2500);

const r = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.wingmanSystem;
  const out = {};
  // (E) 武器档位上限扩展到 5
  ws.setWeaponLv(5);
  out.weaponLv5 = ws.weaponLv === 5;
  // (A) lv0 单发脉冲：不受影响
  const b0 = gs.spawnWingmanBullet(270, 600, -Math.PI / 2, { weaponLv: 0, element: null, byWingman: true });
  out.lv0 = b0 && {
    homing: b0.homing === false,
    pierce: (b0.pierce || 0) === 0,
    scaleOk: Math.abs(b0.scaleY - 1) < 0.001,
    noTint: b0.isTinted === false,
  };
  // (B) lv4 追踪导弹
  const b4 = gs.spawnWingmanBullet(270, 600, -Math.PI / 2, { weaponLv: 4, element: null, byWingman: true });
  out.lv4 = b4 && { homing: b4.homing === true };
  // (C) lv5 穿透激光
  const b5 = gs.spawnWingmanBullet(270, 600, -Math.PI / 2, { weaponLv: 5, element: null, byWingman: true });
  out.lv5 = b5 && {
    pierce: (b5.pierce || 0) >= 8,
    stretched: b5.scaleY > 1.5,
    tinted: b5.isTinted === true,
  };
  // (D) killBullet 复位：激光弹回收后 scale/tint 清零（防池污染）
  gs.killBullet(b5);
  out.recycle = {
    scaleReset: Math.abs(b5.scaleY - 1) < 0.001,
    tintReset: b5.isTinted === false,
  };
  // 再从池取一发 lv0，断言未继承激光的拉伸/染色
  const b0b = gs.spawnWingmanBullet(270, 600, -Math.PI / 2, { weaponLv: 0, element: null, byWingman: true });
  out.reuse = b0b && { scaleOk: Math.abs(b0b.scaleY - 1) < 0.001, noTint: b0b.isTinted === false };
  return out;
});

log('  r = ' + JSON.stringify(r));
assert(r.weaponLv5, 'setWeaponLv 上限已扩展到 5（新档位可达）');
if (r.lv0) {
  assert(r.lv0.homing && r.lv0.pierce && r.lv0.scaleOk && r.lv0.noTint,
    'lv0 单发脉冲不受影响（homing=false/pierce=0/未拉伸/未染色）');
}
assert(r.lv4 && r.lv4.homing, 'lv4 追踪导弹 homing=true（复用 steerHomingBullets 转向）');
if (r.lv5) {
  assert(r.lv5.pierce && r.lv5.stretched && r.lv5.tinted,
    'lv5 穿透激光 pierce≥8 + 纵向拉伸 + 激光青染色');
}
assert(r.recycle && r.recycle.scaleReset && r.recycle.tintReset, 'killBullet 复位 scale/tint（杜绝池污染）');
assert(r.reuse && r.reuse.scaleOk && r.reuse.noTint, '池中复用子弹未继承激光拉伸/染色');

await sleep(300);
assert(pageErrors.length === 0, `运行零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('  ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ 僚机第三版④导弹/激光僚机弹 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ 导弹/激光僚机弹 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
