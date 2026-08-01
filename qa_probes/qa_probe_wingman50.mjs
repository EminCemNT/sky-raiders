// QA 探针 2（严过关）：端到端证明 —— 玩家主炮击杀被错误累加进 wingman_50 进度。
// 只读探测，不修改业务代码。
import { chromium } from 'playwright';

const PORT = 5059;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await sleep(2500);

await page.evaluate(() => {
  window.__SAVE.reset();
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, { wingman: 2, wingmanFirepower: 0, firepower: 0 });
  s.selectedShip = 1; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
});
await sleep(1500);

const out = await page.evaluate(() => {
  const s = window.__SKY;
  const A = window.__ACH__;
  const prog = () => A.getProgress('wingman_50').cur;

  s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
  const start = prog();

  // 1) 僚机开火 -> 全部回收（模拟飞出屏幕，未击杀任何敌人）
  const sys = s.wingmanSystem;
  sys.getMembers().forEach((w) => { w.fireCd = 99999; });
  sys.update(s.time.now, 16);
  const wCount = s.playerBullets.children.entries.filter((b) => b.active).length;
  s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
  const afterWingmanRecycled = prog();

  // 2) 玩家主炮开火（复用刚回收的 sprite）
  s.player.lastShot = -99999;
  s.player.fire();
  const mainBullets = s.playerBullets.children.entries.filter((b) => b.active);
  const dirtyFlags = mainBullets.map((b) => b.byWingman === true);

  // 3) 用主炮子弹走真实 overlap 参数结算 3 次击杀
  mainBullets.slice(0, 3).forEach((b) => {
    s.registerKill(100, 300, { enemyType: 'small', byWingman: !!b.byWingman, element: b.element });
  });
  const afterMainCannonKills = prog();

  return {
    start,
    wingmanBulletsFired: wCount,
    afterWingmanRecycled,
    mainCannonBulletCount: mainBullets.length,
    mainCannonBulletsMarkedByWingman: dirtyFlags,
    afterMainCannonKills,
    inflatedBy: afterMainCannonKills - afterWingmanRecycled,
  };
});

console.log(JSON.stringify(out, null, 2));
console.log(out.inflatedBy > 0
  ? `\n>>> P0 复现：主炮击杀 ${out.inflatedBy} 次被错误计入 wingman_50 累计进度`
  : '\n>>> 未复现');
await browser.close();
