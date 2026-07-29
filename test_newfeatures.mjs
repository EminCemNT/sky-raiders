// 苍穹战机 — 真测脚本（覆盖 Boss Rush / 僚机 / 导弹 + B4激光/B5炸弹/B6元素/C2战机绑定/C3敌弹）
// Playwright + 系统 Chrome，抓 pageerror / console error / 404，截图间接确认。
import { chromium } from 'playwright';

const PORT = 5059;
const URL = `http://localhost:${PORT}/`;
const SHOT = 'shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const log = (m) => { console.log(m); results.push(m); };

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });

const pageErrors = [];
const consoleErrors = [];
const bad404 = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('response', (res) => { if (res.status() === 404 && !res.url().includes('favicon')) bad404.push(res.url()); });

// 逻辑分辨率 540x960 → 视口 720x1280（因子 1.333）
const vp = (lx, ly) => [Math.round(lx * 1.333), Math.round(ly * 1.333)];

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(1500);
  await page.screenshot({ path: `${SHOT}/shot_menu.png` });

  const getScene = () => page.evaluate(() => {
    if (window.__SKY && window.__SKY.scene) return true;
    if (window.__SKY__ && window.__SKY__.scene && window.__SKY__.scene.getScene('GameScene')) return true;
    return false;
  });
  if (!(await getScene())) throw new Error('菜单/游戏未就绪');

  // ---------- C2 战机武器绑定：selectedShip=1 (赤焰/missile/fire) ----------
  const c2a = await page.evaluate(() => {
    const g = window.__SKY__;
    window.__SAVE.load().selectedShip = 1;
    window.__SAVE.save();
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
    return true;
  });
  await sleep(1200);
  const c2ship1 = await page.evaluate(() => {
    const s = window.__SKY;
    return { weapon: s.player.weapon, element: s.player.shipElement, def: s.player.defaultWeapon };
  });
  log('C2 赤焰绑定: ' + JSON.stringify(c2ship1));

  // ---------- C2 战机武器绑定：selectedShip=2 (寒霜/laser/ice) ----------
  await page.evaluate(() => {
    const g = window.__SKY__;
    window.__SAVE.load().selectedShip = 2;
    window.__SAVE.save();
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
  });
  await sleep(1200);
  const c2ship2 = await page.evaluate(() => {
    const s = window.__SKY;
    s.player.fire(); // 触发激光束创建
    const lb = s.player.laserBeam;
    // 在玩家正上方生成敌机，验证光束命中列
    s.spawnEnemy(s.player.x, s.player.y - 220, 'mid', 'straight', 3, 'straight');
    let inCol = false;
    s.enemies.children.each((e) => { if (e.active && lb && Phaser.Geom.Intersects.RectangleToRectangle(lb.getBounds(), e.getBounds())) inCol = true; });
    return { weapon: s.player.weapon, element: s.player.shipElement, def: s.player.defaultWeapon, beam: !!lb, beamActive: lb ? lb.active : false, dps: lb ? lb.dps : 0, inColumn: inCol };
  });
  log('C2 寒霜绑定: ' + JSON.stringify(c2ship2));

  // ---------- B4 激光束：持续 DPS 实际削减敌机 HP ----------
  const b4 = await page.evaluate(async () => {
    const s = window.__SKY;
    s.player.fire();
    const lb = s.player.laserBeam;
    if (!lb) return { ok: false };
    // 在玩家正上方生成高血量敌机，保证 800ms 内一直停留在光束列内
    s.spawnEnemy(s.player.x, s.player.y - 300, 'mid', 'straight', 4, 'straight');
    let enemy = null;
    s.enemies.children.each((e) => { if (e.active && Math.abs(e.x - s.player.x) < 6) enemy = e; });
    if (!enemy) return { ok: false };
    const before = enemy.hp;
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, before, after: enemy.hp, dropped: enemy.hp < before };
  });
  await sleep(200);
  log('B4 激光 DPS: ' + JSON.stringify(b4));

  // ---------- B5 元素炸弹：AOE 范围伤害 ----------
  const b5 = await page.evaluate(() => {
    const s = window.__SKY;
    s.player.setWeapon('bomb');
    s.player.fire();
    let bombBullet = null;
    s.playerBullets.children.each((b) => { if (b.active && b.isBomb) bombBullet = b; });
    const hasBomb = !!bombBullet;
    const radius = bombBullet ? bombBullet.explodeRadius : 0;
    // 清空现有敌机，定点生成 3 个：2 个在范围内、1 个在范围外
    s.enemies.children.each((e) => { if (e.active) e.recycle(); });
    const cx = 270, cy = 400;
    const inA = s.spawnEnemy(cx, cy, 'small', 'straight', 1, 'straight');
    const inB = s.spawnEnemy(cx + 30, cy + 20, 'small', 'straight', 1, 'straight');
    const outC = s.spawnEnemy(cx + 240, cy + 220, 'small', 'straight', 1, 'straight');
    s._explodeBomb(cx, cy, radius, 90, 'fire');
    return {
      ok: hasBomb, radius,
      inA_killed: !inA.active,
      inB_killed: !inB.active,
      outC_alive: outC.active,
    };
  });
  log('B5 炸弹 AOE: ' + JSON.stringify(b5));

  // ---------- B6 元素属性：火/冰/雷 状态施加 ----------
  const b6 = await page.evaluate(() => {
    const s = window.__SKY;
    s.spawnEnemy(270, 300, 'mid', 'straight', 1, 'straight');
    let e = null; s.enemies.children.each((en) => { if (en.active && en.y < 400) e = en; });
    if (!e) return { ok: false };
    const now = s.time.now;
    e.applyElement('ice');
    const ice = e._slowUntil > now;
    e.applyElement('fire');
    const fire = e._dotUntil > now;
    e.applyElement('thunder');
    const thunder = e._stunUntil > now;
    // 验证 hit 附带元素
    e.applyElement(null);
    e._dotUntil = 0; e._slowUntil = 0; e._stunUntil = 0;
    const before = e.hp;
    e.hit(5, 'fire');
    const elemApplied = e._dotUntil > now;
    return { ok: true, ice, fire, thunder, elemOnHit: elemApplied, dmgApplied: e.hp < before };
  });
  log('B6 元素状态: ' + JSON.stringify(b6));

  // ---------- C3 敌机弹幕差异化 ----------
  const c3 = await page.evaluate(() => {
    const s = window.__SKY;
    const mk = (pat) => {
      s.enemyBullets.children.each((b) => { if (b.active) { b.setActive(false); b.body.enable = false; } });
      s.spawnEnemy(270, 200, 'mid', 'straight', 1, pat);
      let e = null; s.enemies.children.each((en) => { if (en.active && en.firePattern === pat) e = en; });
      if (!e) return { pat, count: -1 };
      e.fireAtPlayer();
      let count = 0, homing = 0;
      s.enemyBullets.children.each((b) => { if (b.active) { count++; if (b.eHoming) homing++; } });
      return { pat, count, homing };
    };
    return { straight: mk('straight'), spread: mk('spread'), tracking: mk('tracking'), burst: mk('burst') };
  });
  log('C3 敌弹分化: ' + JSON.stringify(c3));

  // ---------- 回归：导弹 homing（开火产生追踪弹） ----------
  const missile = await page.evaluate(() => {
    const s = window.__SKY;
    s.player.setWeapon('missile');
    s.player.lastFired = 0; s.player.fire();
    let homing = 0;
    s.playerBullets.children.each((b) => { if (b.active && b.homing) homing++; });
    return { ok: true, weapon: s.player.weapon, homing };
  });
  await sleep(800);
  await page.screenshot({ path: `${SHOT}/shot_battle_missile.png` });
  log('回归-导弹: ' + JSON.stringify(missile));

  // ---------- 回归：Boss Rush 连战 + 胜利结算 ----------
  await page.evaluate(() => {
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'bossrush' });
  });
  await sleep(1500);
  const br0 = await page.evaluate(() => {
    const s = window.__SKY; const b = s.boss;
    return { mode: s.mode, boss: b ? b.name || b.bossKey : null, rush: s.bossRushIndex };
  });
  log('BossRush 第1关: ' + JSON.stringify(br0));
  // 连破三关
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const s = window.__SKY; if (s && s._onBossDefeated) s._onBossDefeated(); });
    await sleep(1500);
  }
  await sleep(1200); // endGame 内两次 delayedCall 共 1800ms，需等足
  const brEnd = await page.evaluate(() => {
    const g = window.__SKY__;
    return { resultActive: g.scene.isActive('ResultScene'), gameActive: g.scene.isActive('GameScene') };
  });
  log('BossRush 结算: ' + JSON.stringify(brEnd));

  // ---------- 断言 ----------
  const assert = (name, cond) => log(`${cond ? '✅' : '❌'} ${name}`);
  assert('C2 赤焰=导弹+火', c2ship1.weapon === 'missile' && c2ship1.element === 'fire' && c2ship1.def === 'missile');
  assert('C2 寒霜=激光+冰', c2ship2.weapon === 'laser' && c2ship2.element === 'ice' && c2ship2.def === 'laser' && c2ship2.beam && c2ship2.dps > 0);
  assert('B4 激光光束命中列内敌机', c2ship2.inColumn);
  assert('B4 激光持续削减敌机HP', b4.ok && b4.dropped);
  assert('B5 炸弹为独立抛射物', b5.ok && b5.radius > 0);
  assert('B5 炸弹AOE命中范围内', b5.inA_killed && b5.inB_killed && b5.outC_alive);
  assert('B6 火/冰/雷状态施加', b6.ice && b6.fire && b6.thunder);
  assert('B6 命中附加元素', b6.elemOnHit && b6.dmgApplied);
  assert('C3 straight=1发', c3.straight.count === 1);
  assert('C3 spread=3发', c3.spread.count === 3);
  assert('C3 tracking=追踪弹', c3.tracking.count === 1 && c3.tracking.homing === 1);
  assert('C3 burst=5发', c3.burst.count === 5);
  assert('回归-导弹homing', missile.homing >= 1);
  assert('BossRush 首关哨兵', br0.boss && br0.boss === 'boss_sentinel');
  assert('BossRush 胜利结算', brEnd.resultActive && !brEnd.gameActive);
  assert('零 pageerror', pageErrors.length === 0);
  assert('零 console error', consoleErrors.length === 0);
  assert('零 404(非favicon)', bad404.length === 0);

  if (pageErrors.length) log('PAGEERRORS: ' + pageErrors.join(' | '));
  if (consoleErrors.length) log('CONSOLE_ERRORS: ' + consoleErrors.join(' | '));
  if (bad404.length) log('404s: ' + bad404.join(' | '));
} catch (e) {
  log('❌ 测试异常: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  const pass = results.filter((r) => r.startsWith('✅')).length;
  const fail = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n==== 真测汇总: ${pass} 通过 / ${fail} 失败 ====`);
}
