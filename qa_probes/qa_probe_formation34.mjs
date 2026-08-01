// QA 探针 4（严过关）：3/4 架编队（只能通过道具 addWingman 触达，原测试套未覆盖）
// 校验：槽位重排 / 不重叠玩家本体 / 僚机之间不互相重叠 / 躲避后不脱离阵型 / 超上限保护
import { chromium } from 'playwright';

const PORT = 5059;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await sleep(2500);

await page.evaluate(() => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, { wingman: 2, wingmanFirepower: 1 });
  s.selectedShip = 1; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
});
await sleep(1500);

const out = await page.evaluate(async () => {
  const s = window.__SKY;
  const sys = s.wingmanSystem;
  const p = s.player;
  const res = {};

  const settle = (frames) => {
    for (let i = 0; i < frames; i++) sys.update(s.time.now + i * 16, 16);
  };
  const snap = () => sys.getMembers().map((w) => ({
    slot: w.slot, formation: w.formation,
    ox: Math.round(w.x - p.x), oy: Math.round(w.y - p.y),
    hw: Math.round(w.displayWidth / 2), hh: Math.round(w.displayHeight / 2),
  }));

  // 拾取道具加到 3 架
  sys.addWingman();
  settle(120);
  res.three = { count: sys.getCount(), members: snap() };

  // 加到 4 架
  sys.addWingman();
  settle(120);
  res.four = { count: sys.getCount(), members: snap() };

  // 超上限保护
  res.overCap = { ret: sys.addWingman(), countAfter: sys.getCount() };

  // 重叠检测（僚机之间 + 与玩家本体）
  const ms = sys.getMembers();
  const pw = p.displayWidth / 2, ph = p.displayHeight / 2;
  res.overlapPlayer = ms.map((w) => (Math.abs(w.x - p.x) < (pw + w.displayWidth / 2) * 0.6
    && Math.abs(w.y - p.y) < (ph + w.displayHeight / 2) * 0.6));
  const pairs = [];
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j];
      const ox = Math.abs(a.x - b.x) < (a.displayWidth + b.displayWidth) / 2 * 0.6;
      const oy = Math.abs(a.y - b.y) < (a.displayHeight + b.displayHeight) / 2 * 0.6;
      if (ox && oy) pairs.push([i, j]);
    }
  }
  res.wingmanPairsOverlapping = pairs;
  res.playerSize = { w: Math.round(p.displayWidth), h: Math.round(p.displayHeight) };
  res.wingmanSize = { w: Math.round(ms[0].displayWidth), h: Math.round(ms[0].displayHeight) };

  // 极端弹幕：塞满威胁弹，看躲避后是否脱离阵型
  for (let i = 0; i < 30; i++) {
    const b = s.enemyBullets.get(p.x - 100 + i * 7, p.y - 60, 'bullet_enemy');
    if (b) { b.setActive(true).setVisible(true); if (b.body) b.body.enable = true; }
  }
  settle(180);
  res.underFire = sys.getMembers().map((w) => ({
    dx: Math.round(w.x - p.x), dy: Math.round(w.y - p.y),
    dodge: { x: Math.round(w.dodgeVec.x), y: Math.round(w.dodgeVec.y) },
    onScreen: w.x > 0 && w.x < 540 && w.y > 0 && w.y < 960,
  }));
  res.maxDriftFromSlot = sys.getMembers().map((w) => Math.round(
    Math.hypot((w.x - p.x) - w.offset.x, (w.y - p.y) - w.offset.y)));

  return res;
});

console.log(JSON.stringify(out, null, 2));
console.log('pageErrors:', pageErrors);
await browser.close();
