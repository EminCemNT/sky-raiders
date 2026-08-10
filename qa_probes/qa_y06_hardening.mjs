// Y-06 加固独立真测：脏存档注入 → progress 钳位生效（无 NaN/负数 ratio）
// 兼：苍鹰(thunder)僚机开局冒烟 + 启动零 pageerror。
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

// ───────── 1) Y-06 脏存档钳位 ─────────
log('\n【Y-06】脏存档注入后 progress 钳位：');
const dirty = await page.evaluate(() => {
  const S = window.__SAVE, A = window.__ACH__;
  S.reset(); A.reset();
  const s = S.load();
  s.totalKills = -5;                                   // 负数
  s.achievementStats = {
    wingmanKills: 'oops',                              // 字符串
    elementKills: { fire: 'abc', ice: 10, thunder: 5 },// fire=NaN 源
    elementCombos: -3,                                 // 负数
    bossRushClears: null,                              // null
  };
  s.bossesDefeated = { boss_sentinel: true };
  S.save();
  A.init();                                            // 重新预载累计（loadCumulative，不擦除存档）
  const ids = ['kill_100', 'kill_500', 'element_fire', 'element_ice',
    'wingman_50', 'combo_element_50', 'bossrush_clear', 'boss_all'];
  const out = {};
  for (const id of ids) out[id] = A.getProgress(id);
  return out;
});
for (const [id, p] of Object.entries(dirty)) {
  const okFinite = Number.isFinite(p.cur) && Number.isFinite(p.ratio);
  const okRange = p.cur >= 0 && p.ratio >= 0 && p.ratio <= 1;
  assert(okFinite, `${id}: cur=${p.cur} ratio=${p.ratio} 有限`);
  assert(okRange, `${id}: cur>=0 且 ratio∈[0,1]`);
}

// 上限钳位仍生效（正常值不超过 1）
const clamp = await page.evaluate(() => {
  const S = window.__SAVE, A = window.__ACH__;
  const s = S.load();
  s.totalKills = 99999;
  s.achievementStats = { wingmanKills: 99999, elementKills: { fire: 99999, ice: 99999, thunder: 99999 }, elementCombos: 99999, bossRushClears: 99999 };
  S.save(); A.init();
  return { kill500: A.getProgress('kill_500'), elemFire: A.getProgress('element_fire') };
});
assert(clamp.kill500.cur === 500 && clamp.kill500.ratio === 1, 'kill_500 上限钳位=500/ratio=1');
assert(clamp.elemFire.cur === 50 && clamp.elemFire.ratio === 1, 'element_fire 上限钳位=50/ratio=1');

// 全量成就 progress 有限性回归
const allFinite = await page.evaluate(() => {
  const A = window.__ACH__;
  const bad = [];
  for (const a of A.getAll()) {
    const p = A.getProgress(a.id);
    if (!Number.isFinite(p.cur) || !Number.isFinite(p.ratio) || p.cur < 0 || p.ratio < 0 || p.ratio > 1) bad.push(a.id);
  }
  return bad;
});
assert(allFinite.length === 0, `全部 23 成就 progress 有限且合法（异常=${allFinite.join(',') || '无'}）`);

// ───────── 2) 苍鹰(thunder)僚机开局冒烟 ─────────
log('\n【苍鹰配雷】thunder 僚机开局 + 零 pageerror：');
await page.evaluate(({ up, sh }) => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, up); s.selectedShip = sh; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
}, { up: { wingman: 2, wingmanFirepower: 0 }, sh: 0 });
await sleep(2500);
const wm = await page.evaluate(() => {
  const sys = window.__SKY.wingmanSystem;
  return sys && sys.members ? sys.members.map((m) => m.element) : 'NO_SYS';
});
log('  僚机元素 = ' + JSON.stringify(wm));
assert(Array.isArray(wm) && wm.length === 2 && wm.every((e) => e === 'thunder'),
  '苍鹰僚机 2 架元素均为 thunder（阵亡爆炸色分支可达）');

await sleep(500);
assert(pageErrors.length === 0, `启动/运行零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('   ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ Y-06 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ Y-06 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
