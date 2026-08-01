// QA 最终复验探针（严过关）— 8b38b2f：7 缺陷行为实证 + H2 误报钉死 + 新边界探测
// 端口 5059。只读探测，不改业务代码。
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const URL = 'http://localhost:5059/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (m) => { out.push(m); };
const chk = (name, cond, extra = '') => log(`${cond ? 'OK  ' : 'BUG '} ${name}${extra ? ' :: ' + extra : ''}`);

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = []; const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

async function enterGame(up, ship = 1) {
  await page.evaluate(({ u, sh }) => {
    const s = window.__SAVE.load();
    Object.assign(s.upgrades, u); s.selectedShip = sh; s.tutorialDone = true;
    window.__SAVE.save();
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
  }, { u: up, sh: ship });
  await sleep(1400);
  await page.evaluate(() => {
    const s = window.__SKY;
    s.waves = null;
    s.enemies.children.each((e) => { if (e.active) e.hit(99999); });
    s.enemyBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    s.player.x = 270; s.player.y = 760;
  });
  await sleep(300);
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE && !!window.__ACH__, null, { timeout: 15000 });
  await sleep(800);
  await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });

  // ===== P1-1 旋转不变量（收口后主炮复用不再残留旋转） =====
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const p11 = await page.evaluate(() => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const e = s.spawnEnemy(40, 740, 'small', 'straight', 1); e.x = 40; e.y = 740; e.hp = 999999; e.setVelocity(0, 0);
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const wmRots = s.playerBullets.children.entries.filter((b) => b.active).map((b) => b.rotation);
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const poolRots = s.playerBullets.children.entries.filter((b) => !b.active).map((b) => b.rotation);
    s.player.fire();
    const mains = s.playerBullets.children.entries.filter((b) => b.active);
    e.hit(999999);
    return { poolDirty: poolRots.filter((r) => Math.abs(r) > 1e-6).length,
      mainRots: mains.map((b) => Number(b.rotation.toFixed(4))),
      mainClean: mains.length > 0 && mains.every((b) => Math.abs(b.rotation) < 1e-6),
      wmSample: wmRots.map((r) => Number(r.toFixed(3))) };
  });
  chk('P1-1 回收后池中 rotation 已复位', p11.poolDirty === 0, `池内非零 rotation=${p11.poolDirty}`);
  chk('P1-1 主炮子弹 rotation 全为 0', p11.mainClean, `主炮 rotation=${JSON.stringify(p11.mainRots)} 僚机 rotation=${JSON.stringify(p11.wmSample)}`);

  // ===== P1-2 贴图 + body 尺寸（重点是 setTexture 必须在读 bw/bh 之前） =====
  await enterGame({ wingman: 2, wingmanFirepower: 1 }, 1); // lv1=散射
  const p12 = await page.evaluate(() => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const wmTex = s.playerBullets.children.entries.filter((b) => b.active).map((b) => b.texture.key);
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const pulseW = s.textures.get('bullet_pulse').getSourceImage().width;
    const pulseH = s.textures.get('bullet_pulse').getSourceImage().height;
    const scatW = s.textures.get('bullet_scatter').getSourceImage().width;
    const scatH = s.textures.get('bullet_scatter').getSourceImage().height;
    s.player.firepower = 0; s.player.setWeapon('pulse');
    s.player.fire();
    const mains = s.playerBullets.children.entries.filter((b) => b.active);
    const m0 = mains[0];
    const expPulseW = Math.round(pulseW * 0.6), expScatW = Math.round(scatW * 0.6);
    return {
      wmTex,
      mainTex: mains.map((b) => b.texture.key),
      m0tex: m0.texture.key, m0w: m0.width, m0bw: m0.body.width, m0bh: m0.body.height,
      pulseW, pulseH, scatW,
      bodyMatchesPulse: Math.abs(m0.body.width - expPulseW) < 1 && Math.abs(m0.body.height - Math.round(pulseH * 0.7)) < 1,
      bodyDiffersScatter: Math.abs(m0.body.width - expScatW) > 1,
    };
  });
  chk('P1-2 主炮请求 bullet_pulse 贴图正确', p12.mainTex.every((k) => k === 'bullet_pulse'), `僚机弹=${JSON.stringify(p12.wmTex)} 主炮=${JSON.stringify(p12.mainTex)}`);
  chk('P1-2 body 尺寸按新贴图(pulse)算，且≠scatter 误算',
    p12.bodyMatchesPulse && p12.bodyDiffersScatter,
    `m0 ${p12.m0tex} w=${p12.m0w} body=${p12.m0bw}x${p12.m0bh} 期望pulse=${Math.round(p12.pulseW * 0.6)}x${Math.round(p12.pulseH * 0.7)} 期望scatterW=${Math.round(p12.scatW * 0.6)}`);

  // ===== P1-3 玩家阵亡后僚机不被击落 =====
  await enterGame({ wingman: 1, wingmanFirepower: 0 }, 1);
  const p13 = await page.evaluate(async () => {
    const s = window.__SKY; const w = s.wingmanSystem.getMembers()[0];
    w.invulnUntil = 0;
    s.player.setActive(false);
    for (let i = 0; i < 5; i++) {
      const b = s.enemyBullets.get(w.x + i, w.y, 'bullet_enemy');
      if (!b) continue; b.setActive(true).setVisible(true); if (b.body) b.body.enable = true;
      b.setVelocity(0, 0); b.x = w.x + i; b.y = w.y;
    }
    await new Promise((r) => setTimeout(r, 300));
    const res = { alive: w.alive, hp: w.hp, deadCount: s.wingmanSystem._deadCount };
    s.player.setActive(true);
    return res;
  });
  chk('P1-3 玩家阵亡后僚机不被敌弹击落', p13.alive === true, `alive=${p13.alive} hp=${p13.hp} _deadCount=${p13.deadCount}`);

  // ===== P1-4 reset() 清全部 run 字段，旧 session 不再复活成就 =====
  const p14 = await page.evaluate(() => {
    const A = window.__ACH__;
    A.reset(); A.startRun('normal', 1);
    A.reportKill({ byWingman: true, element: 'fire' });
    const before = A.isUnlocked('wingman_first');
    A.reset();
    A.reportCoins(0);
    return { before, after: A.isUnlocked('wingman_first'), run: A.getProgress('wingman_first').cur };
  });
  chk('P1-4 reset() 后 wingman_first 不被 _checkLive 复活', p14.before === true && p14.after === false && p14.run === 0,
    `reset前=${p14.before} reset后=${p14.after} wingmanKillsRun=${p14.run}`);

  // ===== P2-1 无敌期敌弹穿过（不消弹、不扣血），且过期后恢复常态 =====
  await enterGame({ wingman: 1, wingmanFirepower: 0 }, 1);
  const p21 = await page.evaluate(async () => {
    const s = window.__SKY; const w = s.wingmanSystem.getMembers()[0];
    w.respawn(w.x, w.y, s.time.now);
    const invulnLeft = w.invulnUntil - s.time.now;
    const b = s.enemyBullets.get(w.x, w.y, 'bullet_enemy');
    b.setActive(true).setVisible(true); if (b.body) b.body.enable = true; b.setVelocity(0, 0); b.x = w.x; b.y = w.y;
    await new Promise((r) => setTimeout(r, 350)); // 仍在 900ms 无敌内
    const during = { bulletActive: b.active, hp: w.hp, alive: w.alive };
    await new Promise((r) => setTimeout(r, 800)); // 越过 900ms 无敌
    const after = { bulletActive: b.active, hp: w.hp };
    return { invulnLeft, during, after };
  });
  chk('P2-1 无敌期敌弹穿过(仍 active、不扣血)', p21.during.bulletActive === true && p21.during.hp === 3 && p21.during.alive === true,
    `无敌剩 ${Math.round(p21.invulnLeft)}ms 期间 弹active=${p21.during.bulletActive} hp=${p21.during.hp}`);
  chk('P2-1 无敌结束后恢复常态(弹被消、扣血)', p21.after.bulletActive === false && p21.after.hp === 2,
    `越过无敌后 弹active=${p21.after.bulletActive} hp=${p21.after.hp}`);

  // ===== P2-2 屏边重生钳制 =====
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const p22 = await page.evaluate(() => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    const w0 = sys.getMembers()[0]; // offset.x=-52
    s.player.x = 18; s.player.y = 800; w0.die(); sys._tickRespawn(w0.respawnAt + 1);
    const left = { x: +w0.x.toFixed(1), y: +w0.y.toFixed(1) };
    const w1 = sys.getMembers()[1]; // offset.x=+52
    s.player.x = 522; s.player.y = 120; w1.die(); sys._tickRespawn(w1.respawnAt + 1);
    const right = { x: +w1.x.toFixed(1) };
    return { left, right, W: 540, H: 960 };
  });
  chk('P2-2 左屏边重生钳制在 [18,522]x[40,940]', p22.left.x >= 18 && p22.left.x <= 522 && p22.left.y >= 40 && p22.left.y <= 940,
    `左缘重生(${p22.left.x},${p22.left.y})`);
  chk('P2-2 右屏边重生钳制在 [18,522]', p22.right.x >= 18 && p22.right.x <= 522, `右缘重生 x=${p22.right.x}`);

  // ===== P2-3 TRIGGER=5 仍可触发（5 次交替） =====
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const p23 = await page.evaluate(() => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const A = window.__ACH__; const o = A.reportElementCombo; let n = 0;
    A.reportElementCombo = function (el) { n++; return o.call(A, el); };
    const t = s.time.now;
    for (let i = 0; i < 5; i++) sys.reportHit(i % 2 === 1, 'fire', t + i * 100);
    const mul = sys.getComboMul(t + 600);
    A.reportElementCombo = o;
    return { n, mul, count: sys.combo.count };
  });
  chk('P2-3 交替 5 次仍触发 WINGMAN_COMBO(+35%)', p23.n === 1 && p23.mul > 1 && p23.count === 0,
    `触发次数=${p23.n} 倍率=${p23.mul} 触发后count=${p23.count}`);

  // ===== 新-A invuln 边界前后 1ms 行为 + 多发连续命中 =====
  await enterGame({ wingman: 1, wingmanFirepower: 0 }, 1);
  const inv = await page.evaluate(() => {
    const s = window.__SKY; const w = s.wingmanSystem.getMembers()[0];
    w.die(); const t = s.time.now; w.respawn(w.x, w.y, t);
    const invUntil = w.invulnUntil;
    // 注意：takeDamage 仅"击落"时返回 true，非致命命中一律返回 false（不表示被无敌挡）。
    // 因此以 hp 是否变化判定：无敌期内 hp 不变=被挡；越过窗口 hp 递减=受伤。
    w.takeDamage(1, t + 899); const blocked899 = (w.hp === 3);
    w.hp = w.maxHp;
    w.takeDamage(1, t + 901); const hurt901 = (w.hp === 2);
    w.hp = w.maxHp;
    for (let i = 0; i < 5; i++) w.takeDamage(1, t + 100 + i * 10);
    const multiHp = w.hp;
    return { blocked899, hurt901, multiHp, invUntil, probeT: t, ms: 900 };
  });
  chk('inv-A 无敌边界 t+899 挡血 / t+901 受伤(900ms 窗口)', inv.blocked899 && inv.hurt901,
    `t+899挡=${inv.blocked899} t+901伤=${inv.hurt901} invUntil=${inv.invUntil} t=${inv.probeT}`);
  chk('inv-A 无敌期内 5 发连续命中血量不变', inv.multiHp === 3, `无敌期多弹后 hp=${inv.multiHp}`);

  // ===== 新-B combo WINDOW_MS 边界断链 =====
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const win = await page.evaluate(() => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const t = s.time.now;
    sys.reportHit(false, 'fire', t);
    sys.reportHit(true, 'fire', t + 1100);   // 窗口内交替，count=2
    sys.reportHit(false, 'fire', t + 1100 + 1300); // 超窗(1300>1200)，重起 count=1
    return { count: sys.combo.count };
  });
  chk('win-B WINDOW_MS 1200 边界断链(count 重起=1)', win.count === 1, `count=${win.count}`);

  // ===== 新-C combo 激活期间僚机全灭：增益延续 + 不异常 =====
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const wipe = await page.evaluate(async () => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const t = s.time.now;
    for (let i = 0; i < 5; i++) sys.reportHit(i % 2 === 1, 'fire', t + i * 100);
    const activeDuring = sys.getComboMul(t + 200) > 1;
    sys.getMembers().forEach((w) => w.die()); // 全灭
    const deadCount = sys._deadCount;
    await new Promise((r) => setTimeout(r, 300));
    const stillActive = sys.getComboMul(t + 2500) > 1; // 仍在 BUFF 内(3000)
    let crashed = false;
    try { sys.reportHit(false, 'fire', t + 2600); } catch (e) { crashed = true; }
    const countAfter = sys.combo.count;
    return { activeDuring, deadCount, stillActive, crashed, countAfter };
  });
  chk('wipe-C 激活增益不依赖僚机存活(全灭后仍延续)', wipe.activeDuring && wipe.stillActive,
    `激活期=${wipe.activeDuring} 全灭(${wipe.deadCount})后BUFF内仍活跃=${wipe.stillActive}`);
  chk('wipe-C 全灭后仍可 reportHit 不抛异常', wipe.crashed === false, `countAfter=${wipe.countAfter}`);

  // ===== 新-D 战术分工动态增减 1→4 + 上限 =====
  await enterGame({ wingman: 0, wingmanFirepower: 0 }, 0);
  const dyn = await page.evaluate(() => {
    const sys = window.__SKY.wingmanSystem;
    const seq = [];
    for (let k = 1; k <= 4; k++) { sys.addWingman(); seq.push(sys.getMembers().map((w) => w.role).join(',')); }
    const over = sys.addWingman();
    return { seq, capped: over === null && sys.getCount() === 4 };
  });
  chk('dyn-D 1→4 架 role 重排正确', dyn.seq.join(' | ') === 'suppress | suppress,support | suppress,support,flank | suppress,support,flank,support',
    `序列=${dyn.seq.join(' | ')}`);
  chk('dyn-D 第 5 架被硬上限拦下', dyn.capped === true);

  // ===== 新-E 红线：wingmanHit 绝不走 playerHit =====
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const red = await page.evaluate(async () => {
    const s = window.__SKY;
    const before = { hp: s.player.hp, dmg: s.stats.damageTaken, combo: s.combo };
    const w = s.wingmanSystem.getMembers()[0];
    w.invulnUntil = 0;
    for (let i = 0; i < 3; i++) {
      const b = s.enemyBullets.get(w.x + i, w.y, 'bullet_enemy');
      if (!b) continue; b.setActive(true).setVisible(true); if (b.body) b.body.enable = true;
      b.setVelocity(0, 0); b.x = w.x + i; b.y = w.y;
    }
    await new Promise((r) => setTimeout(r, 300));
    return { before, hp: s.player.hp, dmg: s.stats.damageTaken, combo: s.combo, wAlive: w.alive };
  });
  chk('red-E 僚机被击落：玩家 HP 不变 / damageTaken=0 / 连击不断',
    red.hp === red.before.hp && red.dmg === 0 && red.combo === red.before.combo,
    `HP ${red.before.hp}->${red.hp} dmgTaken=${red.dmg} combo ${red.before.combo}->${red.combo} 僚机被击落=${!red.wAlive}`);

  // ===== H2 跨局串台钉死（纠正上一轮探针自身的误判） =====
  // 证明手段：在重开前捕获旧 System 引用；若旧 handler 未解绑泄漏，则新局击落僚机时
  // 旧 handler 仍会自增 oldSys._deadCount。故新局击落后 oldSys._deadCount 应保持 0。
  await enterGame({ wingman: 1, wingmanFirepower: 0 }, 1);
  const h2a = await page.evaluate(() => {
    const s0 = window.__SKY; const oldSys = s0.wingmanSystem;
    const w = oldSys.getMembers()[0]; w.invulnUntil = 0; w.die();   // 旧局先有一架阵亡
    return { oldDcPre: oldSys._deadCount, oldSysRef: true };
  });
  const h2b = await page.evaluate(async () => {
    const s0 = window.__SKY; const oldSys = s0.wingmanSystem; // 重开前捕获旧引用
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
    await new Promise((r) => setTimeout(r, 1400));
    const oldAfterRestart = oldSys._deadCount; // destroy() 应已清零
    const s1 = window.__SKY; const sys1 = s1.wingmanSystem;
    const w1 = sys1.getMembers()[0]; w1.invulnUntil = 0; w1.die(); // 新局击落
    await new Promise((r) => setTimeout(r, 200));
    return { oldAfterRestart, oldAfterNewDeath: oldSys._deadCount, newDc: sys1._deadCount };
  });
  chk('H2 旧 System destroy 后 _deadCount 归零(无悬挂引用累加)', h2b.oldAfterRestart === 0,
    `旧局击落→重开后 oldSys._deadCount=${h2b.oldAfterRestart}`);
  chk('H2 新局击落不触发旧 handler 累加(oldSys 仍=0、无串台)', h2b.oldAfterNewDeath === 0 && h2b.newDc === 1,
    `新局击落后 oldSys._deadCount=${h2b.oldAfterNewDeath} 新局 _deadCount=${h2b.newDc}`);

  log('');
  log(`pageerror=${pageErrors.length} consoleError=${consoleErrors.length}`);
  if (pageErrors.length) log('PAGEERRORS: ' + pageErrors.join(' | '));
  if (consoleErrors.length) log('CONSOLE: ' + consoleErrors.join(' | '));
} catch (e) {
  log('EXCEPTION ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  const bugs = out.filter((r) => r.startsWith('BUG')).length;
  const oks = out.filter((r) => r.startsWith('OK')).length;
  out.push(`\n==== 最终复验探针汇总: ${oks} OK / ${bugs} BUG ====`);
  writeFileSync('qa_probes/_final.txt', out.join('\n'));
}
