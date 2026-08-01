// QA 探针 3（严过关）：僚机按角度射击 —— 向下/近水平的子弹是否永不回收，
// 导致 playerBullets 池（maxSize 200）泄漏耗尽。只读探测。
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
  const s = window.__SAVE.load();
  Object.assign(s.upgrades, { wingman: 2, wingmanFirepower: 0 });
  s.selectedShip = 1; s.tutorialDone = true;
  window.__SAVE.save();
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('GameScene', { mode: 'normal' });
});
await sleep(1500);

// A) findNearestTarget 是否会返回位于僚机【下方】的敌机（diver 俯冲过去后仍 active）
const partA = await page.evaluate(() => {
  const s = window.__SKY;
  s.enemies.children.each((e) => { if (e.active) e.recycle && e.recycle(); });
  const p = s.player;
  // 造一架已俯冲到玩家下方的敌机（diver 在 y>GAME_HEIGHT+60 前都保持 active）
  const e = s.enemies.get();
  if (!e) return { error: 'no enemy from pool' };
  e.spawn(p.x + 20, p.y + 150, 'diver', 'dive', 1, 'straight');
  const t = s.findNearestTarget(p.x, p.y);
  const wm = s.wingmanSystem.getMembers()[0];
  return {
    playerY: Math.round(p.y),
    wingmanY: Math.round(wm.y),
    enemyY: Math.round(e.y),
    targetIsBelowWingman: !!t && t.y > wm.y,
    targetActive: !!t && t.active,
  };
});

// B) 让僚机对着下方目标开火，看子弹方向 + 是否会被 recycleBullets 回收
const partB = await page.evaluate(async () => {
  const s = window.__SKY;
  s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
  const sys = s.wingmanSystem;
  sys.getMembers().forEach((w) => { w.fireCd = 99999; });
  sys.update(s.time.now, 16);
  const fired = s.playerBullets.children.entries.filter((b) => b.active);
  const vy = fired.map((b) => Math.round(b.body.velocity.y));

  // 手动推进：把子弹按速度积分 3 秒，并每步调用 recycleBullets（复刻 update 行为）
  for (let i = 0; i < 180; i++) {
    fired.forEach((b) => {
      if (!b.active) return;
      b.x += b.body.velocity.x / 60;
      b.y += b.body.velocity.y / 60;
    });
    s.recycleBullets();
  }
  const stillActive = fired.filter((b) => b.active);
  return {
    firedCount: fired.length,
    velocityY: vy,
    downwardShots: vy.filter((v) => v > 0).length,
    stillActiveAfter3s: stillActive.length,
    positions: stillActive.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
  };
});

// C) 泄漏累积：反复"下方目标 + 齐射"，看池中 active 子弹是否单调增长
const partC = await page.evaluate(() => {
  const s = window.__SKY;
  s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
  const sys = s.wingmanSystem;
  const samples = [];
  for (let round = 0; round < 40; round++) {
    sys.getMembers().forEach((w) => { w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    // 推进 40 帧并回收
    s.playerBullets.children.each((b) => {
      if (!b.active) return;
      b.x += b.body.velocity.x * (40 / 60);
      b.y += b.body.velocity.y * (40 / 60);
    });
    s.recycleBullets();
    if (round % 10 === 9) {
      samples.push({ round: round + 1, active: s.playerBullets.children.entries.filter((b) => b.active).length });
    }
  }
  return { samples, poolMax: s.playerBullets.maxSize };
});

console.log('--- A) findNearestTarget 方向过滤 ---');
console.log(JSON.stringify(partA, null, 2));
console.log('--- B) 向下子弹回收 ---');
console.log(JSON.stringify(partB, null, 2));
console.log('--- C) 池泄漏累积 ---');
console.log(JSON.stringify(partC, null, 2));
await browser.close();
