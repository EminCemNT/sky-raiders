// element_thunder 成就独立真测：动态闭环验证「雷击杀统计 → 成就解锁」
// 兼：fire/ice 不受影响 + 苍鹰(thunder)僚机冒烟 + 启动零 pageerror。
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

// ───────── 1) element_thunder 动态闭环 ─────────
log('\n【element_thunder】雷击杀统计→成就解锁闭环：');
const res = await page.evaluate(() => {
  const S = window.__SAVE, A = window.__ACH__;
  const s = S.load();
  // 设 thunder=49，fire/ice=0，其余统计归零（新 profile 默认全 0，避免误解锁别的）
  s.achievementStats = {
    wingmanKills: 0,
    elementKills: { fire: 0, ice: 0, thunder: 49 },
    elementCombos: 0,
    bossRushClears: 0,
  };
  S.save();
  A.init();                          // 预载累计（不擦除 unlocked）
  A.reportKill({ element: 'thunder' }); // 49→50，触发 _checkLive 解锁
  const all = A.getAll();
  const prog = (id) => A.getProgress(id) || null;
  return {
    total: all.length,
    thunder: prog('element_thunder'),
    fire: prog('element_fire'),
    ice: prog('element_ice'),
  };
});
log('  成就总数 = ' + res.total);
assert(res.thunder != null, 'element_thunder 定义存在（ACHIEVEMENTS 数组已含）');
log(`  （基线实为 ${res.total - 1} 项，新增 thunder 后 ${res.total} 项）`);
assert(res.thunder && res.thunder.unlocked === true, '雷击杀达 50 → element_thunder 解锁');
assert(res.fire && res.fire.unlocked === false, 'fire 未受影响（fire=0 仍锁定）');
assert(res.ice && res.ice.unlocked === false, 'ice 未受影响（ice=0 仍锁定）');

// ───────── 2) 苍鹰(thunder)僚机开局冒烟（元素链路闭合）─────────
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
  '苍鹰僚机 2 架元素均为 thunder（雷弹/雷击杀链路闭合）');

await sleep(500);
assert(pageErrors.length === 0, `启动/运行零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('   ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ element_thunder 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ element_thunder 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
