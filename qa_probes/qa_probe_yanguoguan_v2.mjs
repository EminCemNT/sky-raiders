// QA 独立探针（严过关）— 僚机第二版：作者测试未覆盖的边界
// 端口 5059。只读探测，不改业务代码。
import { chromium } from 'playwright';

const URL = 'http://localhost:5059/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (m) => { console.log(m); out.push(m); };
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
  await sleep(1300);
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

  // ---------- A. 主炮子弹旋转残留（killBullet 未复位 rotation） ----------
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const rot = await page.evaluate(() => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    // 让僚机朝一个明显的斜/侧向角度开火：造一个远在侧上方的敌人当目标
    const e = s.spawnEnemy(40, 700, 'small', 'straight', 1);
    e.x = 40; e.y = 740; e.hp = 999999; e.setVelocity(0, 0);
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const wmRots = s.playerBullets.children.entries.filter((b) => b.active).map((b) => b.rotation);
    // 全部回收
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const poolRots = s.playerBullets.children.entries.filter((b) => !b.active).map((b) => b.rotation);
    // 主炮开火，复用刚回收的 sprite
    s.player.fire();
    const mains = s.playerBullets.children.entries.filter((b) => b.active);
    e.hit(999999);
    return {
      wmRots,
      poolDirty: poolRots.filter((r) => Math.abs(r) > 1e-6).length,
      mainRots: mains.map((b) => Number(b.rotation.toFixed(4))),
      mainTex: mains.map((b) => b.texture.key),
      mainClean: mains.length > 0 && mains.every((b) => Math.abs(b.rotation) < 1e-6),
    };
  });
  chk('A1 回收后池中 sprite 的 rotation 已复位', rot.poolDirty === 0,
    `池内非零 rotation 数=${rot.poolDirty}`);
  chk('A2 主炮子弹 rotation 为 0（无僚机角度残留）', rot.mainClean,
    `主炮 rotation=${JSON.stringify(rot.mainRots)} 僚机 rotation=${JSON.stringify(rot.wmRots.map((r) => Number(r.toFixed(3))))}`);

  // ---------- B. 主炮子弹贴图残留（Group.get 复用不换贴图） ----------
  const tex = await page.evaluate(() => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    sys.setWeaponLv(1);                 // lv1 = 散射，key = bullet_scatter
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const wmTex = s.playerBullets.children.entries.filter((b) => b.active).map((b) => b.texture.key);
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    s.player.firepower = 0;             // 火力0 -> 单发 bullet_pulse
    s.player.setWeapon('pulse');
    s.player.fire();
    const mains = s.playerBullets.children.entries.filter((b) => b.active);
    return { wmTex, mainTex: mains.map((b) => b.texture.key) };
  });
  chk('B1 主炮请求 bullet_pulse 时贴图确实为 bullet_pulse', tex.mainTex.every((k) => k === 'bullet_pulse'),
    `僚机弹贴图=${JSON.stringify(tex.wmTex)} 复用后主炮贴图=${JSON.stringify(tex.mainTex)}`);

  // ---------- C. 无敌期僚机仍吞噬敌弹（免费护盾） ----------
  await enterGame({ wingman: 1, wingmanFirepower: 0 }, 1);
  const shield = await page.evaluate(async () => {
    const s = window.__SKY;
    const w = s.wingmanSystem.getMembers()[0];
    w.respawn(w.x, w.y, s.time.now);              // 进入 900ms 无敌
    const invulnLeft = w.invulnUntil - s.time.now;
    let spawned = 0;
    for (let i = 0; i < 6; i++) {
      const b = s.enemyBullets.get(w.x + i, w.y, 'bullet_enemy');
      if (!b) continue;
      b.setActive(true).setVisible(true);
      if (b.body) b.body.enable = true;
      b.setVelocity(0, 0); b.x = w.x + i; b.y = w.y; spawned++;
    }
    await new Promise((r) => setTimeout(r, 250));
    return {
      invulnLeft,
      spawned,
      leftAlive: s.enemyBullets.children.entries.filter((b) => b.active).length,
      hp: w.hp, alive: w.alive,
    };
  });
  chk('C1 无敌期不消耗敌弹（不做免费护盾）', shield.leftAlive === shield.spawned,
    `投放 ${shield.spawned} 发 / 剩余 ${shield.leftAlive} 发，僚机 hp=${shield.hp} 无敌剩余=${Math.round(shield.invulnLeft)}ms`);

  // ---------- D. 屏幕边缘重生位置越界 ----------
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const edge = await page.evaluate(() => {
    const s = window.__SKY;
    const w = s.wingmanSystem.getMembers()[0];   // offset.x = -52
    s.player.x = 20; s.player.y = 1200;
    w.die();
    s.wingmanSystem._tickRespawn(w.respawnAt + 1);
    return { x: w.x, y: w.y, offx: w.offset.x, alive: w.alive, W: 540, H: 1260 };
  });
  chk('D1 重生点在屏内（未越界）', edge.x >= 0 && edge.x <= 540 && edge.y >= 0 && edge.y <= 1260,
    `重生坐标 (${edge.x.toFixed(1)}, ${edge.y.toFixed(1)}) offset.x=${edge.offx}`);

  // ---------- E. 真实战斗中 combo 增益占空比（数值失控风险） ----------
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const uptime = await page.evaluate(async () => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    // 恢复波次，放一批耐打的敌机，模拟正常交战 6 秒
    for (let i = 0; i < 6; i++) {
      const e = s.spawnEnemy(120 + i * 60, 300 + (i % 3) * 60, 'small', 'straight', 1);
      e.hp = 999999; e.setVelocity(0, 0);
    }
    let triggers = 0;
    const origEmit = sys.reportHit.bind(sys);
    let activeFrames = 0; let totalFrames = 0;
    const iv = setInterval(() => {
      totalFrames++;
      if (sys.getComboMul() > 1) activeFrames++;
    }, 50);
    const A = window.__ACH__;
    const o = A.reportElementCombo; A.reportElementCombo = function (el) { triggers++; return o.call(A, el); };
    await new Promise((r) => setTimeout(r, 6000));
    clearInterval(iv);
    A.reportElementCombo = o;
    s.enemies.children.each((e) => { if (e.active) e.hit(999999); });
    return { triggers, uptime: totalFrames ? activeFrames / totalFrames : 0, totalFrames };
  });
  chk('E1 combo 增益占空比 < 70%（不是常驻 buff）', uptime.uptime < 0.7,
    `6s 交战触发 ${uptime.triggers} 次，增益占空比 ${(uptime.uptime * 100).toFixed(0)}%`);
  chk('E2 单局 5 次触发（combo_element_5）不应 6s 内达成', uptime.triggers < 5,
    `6s 内触发 ${uptime.triggers} 次`);

  // ---------- F. 玩家阵亡后僚机仍被敌弹击落（状态一致性） ----------
  await enterGame({ wingman: 1, wingmanFirepower: 0 }, 1);
  const dead = await page.evaluate(async () => {
    const s = window.__SKY;
    const w = s.wingmanSystem.getMembers()[0];
    w.invulnUntil = 0;
    s.player.setActive(false);                 // 模拟玩家阵亡
    for (let i = 0; i < 4; i++) {
      const b = s.enemyBullets.get(w.x, w.y, 'bullet_enemy');
      if (!b) continue;
      b.setActive(true).setVisible(true);
      if (b.body) b.body.enable = true;
      b.setVelocity(0, 0); b.x = w.x + i; b.y = w.y;
    }
    await new Promise((r) => setTimeout(r, 300));
    const res = { alive: w.alive, hp: w.hp, deadCount: s.wingmanSystem._deadCount };
    s.player.setActive(true);
    return res;
  });
  chk('F1 玩家阵亡后僚机不再被敌弹击落', dead.alive === true,
    `僚机 alive=${dead.alive} hp=${dead.hp} _deadCount=${dead.deadCount}`);

  // ---------- G. AchievementManager.reset() 单局字段复位是否完整 ----------
  const resetChk = await page.evaluate(() => {
    const A = window.__ACH__;
    A.reset();
    A.startRun('normal', 1);
    A.reportKill({ byWingman: true, element: 'fire' });   // 单局僚机击杀 1
    const unlockedBefore = A.isUnlocked('wingman_first');
    A.reset();                                            // 用户在设置里"清空成就"
    const unlockedAfterReset = A.isUnlocked('wingman_first');
    A.reportCoins(0);                                     // 触发一次 _checkLive
    return {
      unlockedBefore,
      unlockedAfterReset,
      reUnlocked: A.isUnlocked('wingman_first'),
      runProgress: A.getProgress('wingman_first').cur,
    };
  });
  chk('G1 reset() 后单局僚机击杀数已清零，不会被 _checkLive 复活',
    resetChk.reUnlocked === false,
    `reset前解锁=${resetChk.unlockedBefore} reset后=${resetChk.unlockedAfterReset} 一次_checkLive后=${resetChk.reUnlocked} wingmanKillsRun残留=${resetChk.runProgress}`);

  // ---------- H. WingmanSystem 跨局不串台（EventBus 解绑） ----------
  const cross = await page.evaluate(async () => {
    const s0 = window.__SKY;
    const oldSys = s0.wingmanSystem;
    const w = oldSys.getMembers()[0];
    if (w) w.die();                                  // 旧局留一个阵亡僚机
    const dcOld = oldSys._deadCount;
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
    await new Promise((r) => setTimeout(r, 1400));
    const s1 = window.__SKY;
    const newSys = s1.wingmanSystem;
    const dcNew0 = newSys._deadCount;
    // 旧系统句柄再发一次事件，新系统不应受影响（已解绑）
    const nw = newSys.getMembers()[0];
    if (nw) { nw.die(); }
    const dcNew1 = newSys._deadCount;
    const dcOldAfter = oldSys._deadCount;
    return { dcOld, dcNew0, dcNew1, dcOldAfter, oldDestroyed: oldSys.scene === null };
  });
  chk('H1 新局 _deadCount 从 0 起算', cross.dcNew0 === 0, `新局初始 _deadCount=${cross.dcNew0}`);
  chk('H2 旧 System 已 destroy 且不再吃事件（无串台）',
    cross.oldDestroyed === true && cross.dcOldAfter === cross.dcOld,
    `旧 _deadCount ${cross.dcOld} -> ${cross.dcOldAfter}，新局 die 后 _deadCount=${cross.dcNew1}`);

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
  console.log(`\n==== 探针汇总: ${oks} 项符合预期 / ${bugs} 项疑似缺陷 ====`);
}
