// QA 独立探针（严过关）：验证 playerBullets 池复用是否把 byWingman 脏字段
// 带到玩家主炮子弹上，从而污染 wingman_50 / wingman_first 成就统计。
// 只读探测，不修改任何业务代码。
import { chromium } from 'playwright';

const PORT = 5059;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(2500);

// 进入战斗：2 架僚机
await page.evaluate(() => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, { wingman: 2, wingmanFirepower: 0, firepower: 0 });
  s.selectedShip = 1;
  s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
});
await sleep(1500);

// --- 探针 1：僚机弹回收后，同一 sprite 被主炮复用，byWingman 是否残留 ---
const probe1 = await page.evaluate(() => {
  const s = window.__SKY;
  // 清空池
  s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });

  // 让僚机打一轮，拿到一发僚机弹
  const sys = s.wingmanSystem;
  sys.getMembers().forEach((w) => { w.fireCd = 99999; });
  sys.update(s.time.now, 16);
  const wb = s.playerBullets.children.entries.find((x) => x.active && x.byWingman);
  if (!wb) return { error: '未产生僚机弹' };
  const beforeRecycle = wb.byWingman;

  // 回收这发僚机弹（模拟飞出屏幕/命中）
  s.killBullet(wb);
  const afterRecycle = wb.byWingman;

  // 现在玩家主炮开火 —— Group.get() 会优先复用刚回收的 sprite
  s.player.lastShot = -99999;
  if (typeof s.player.fire === 'function') s.player.fire();
  const reused = s.playerBullets.children.entries.filter((x) => x.active);
  return {
    beforeRecycle,
    afterRecycle,
    playerBulletsByWingman: reused.map((b) => b.byWingman === true),
    sameSpriteReused: reused.includes(wb),
    reusedSpriteByWingman: wb.byWingman === true,
    reusedSpriteActive: wb.active,
  };
});

// --- 探针 2：端到端 —— 主炮子弹打死敌机，wingman 累计是否被错误 +1 ---
const probe2 = await page.evaluate(() => {
  const s = window.__SKY;
  const A = window.__ACH__;
  s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });

  const before = A.getSession ? A.getSession().wingmanKillsTotal : null;

  // 造一发僚机弹 -> 回收 -> 主炮复用 -> 用它打死敌机
  const sys = s.wingmanSystem;
  sys.getMembers().forEach((w) => { w.fireCd = 99999; });
  sys.update(s.time.now, 16);
  const wb = s.playerBullets.children.entries.find((x) => x.active && x.byWingman);
  if (!wb) return { error: '未产生僚机弹' };
  s.killBullet(wb);

  s.player.lastShot = -99999;
  s.player.fire();
  const pb = s.playerBullets.children.entries.find((x) => x.active);

  // 生成一个敌机并用这发"主炮"子弹结算击杀
  const e = s.enemies.get ? s.enemies.get() : null;
  let killedByWingmanFlag = null;
  if (pb) killedByWingmanFlag = pb.byWingman === true;

  // 直接走 registerKill，参数与 overlap 回调完全一致
  s.registerKill(100, 300, { enemyType: 'small', byWingman: !!(pb && pb.byWingman), element: pb ? pb.element : null });
  const after = A.getSession ? A.getSession().wingmanKillsTotal : null;

  return { before, after, killedByWingmanFlag, delta: (after != null && before != null) ? after - before : null };
});

console.log('--- 探针1：池复用脏字段 ---');
console.log(JSON.stringify(probe1, null, 2));
console.log('--- 探针2：主炮击杀被误记为僚机击杀 ---');
console.log(JSON.stringify(probe2, null, 2));
console.log('--- pageErrors ---', pageErrors);

await browser.close();
