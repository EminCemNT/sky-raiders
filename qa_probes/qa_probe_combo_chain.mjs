// 调试探针：元素协同 combo 真实命中链路（playerBullets↔enemies overlap -> reportHit）
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));

await page.goto('http://localhost:5059/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE, null, { timeout: 15000 });
await sleep(1000);
await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });
await page.evaluate(() => {
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, { wingman: 2, wingmanFirepower: 0 });
  s.selectedShip = 1; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
});
await sleep(1500);
await page.evaluate(() => {
  const s = window.__SKY;
  s.waves = null;
  s.enemies.children.each((e) => { if (e.active) e.hit(99999); });
  s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
  s.player.x = 270; s.player.y = 760;
});
await sleep(300);

const out = await page.evaluate(async () => {
  const s = window.__SKY;
  const sys = s.wingmanSystem;
  sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null;
  sys.combo.lastSide = null; sys.combo.lastAt = 0;
  const trace = [];
  const orig = sys.reportHit.bind(sys);
  sys.reportHit = (bw, el, now) => {
    const r = orig(bw, el, now);
    trace.push({ bw, el, t: Math.round(now), c: sys.combo.count, act: sys.combo.activeUntil > 0 });
    return r;
  };
  const e = s.spawnEnemy(270, 420, 'small', 'straight', 1);
  e.x = 270; e.y = 420; e.hp = 99999; e.setVelocity(0, 0);
  const put = (byWingman) => {
    const b = s.playerBullets.get(e.x, e.y - 4, 'bullet_pulse');
    if (!b) return 'nopool';
    b.setActive(true).setVisible(true);
    if (b.body) b.body.enable = true; else return 'nobody';
    b.isBomb = false; b.homing = false; b.pierce = 0; b._lastHit = null;
    b.damage = 1; b.element = 'fire'; b.byWingman = byWingman;
    b.setVelocity(0, 0); b.x = e.x; b.y = e.y;
    return 'ok';
  };
  const snap = [];
  for (let i = 0; i < 5; i++) {
    const r = put(i % 2 === 1);
    await new Promise((r2) => setTimeout(r2, 120));
    snap.push({ put: r, count: sys.combo.count, lastSide: sys.combo.lastSide, mul: sys.getComboMul(), eHp: e.hp });
  }
  sys.reportHit = orig;
  e.hit(999999);
  return { snap, trace: trace.slice(0, 30), traceLen: trace.length, mul: sys.getComboMul(), combo: { ...sys.combo }, now: s.time.now };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
