// 苍穹战机 — 僚机 AI 进阶第二版 真测（独立生存 / 战术分工 / 元素协同 combo）
// Playwright + 系统 Chrome，抓 pageerror / console error / 404，断言 + 截图。
// 端口 5059（5060/5061 是 Chrome 不安全端口，会 ERR_UNSAFE_PORT）。
import { chromium } from 'playwright';

const PORT = 5059;
const URL = `http://localhost:${PORT}/`;
const SHOT = 'shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const log = (m) => { console.log(m); results.push(m); };
const assert = (name, cond) => log(`${cond ? 'PASS' : 'FAIL'} ${name}`);

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

// 进战斗场景：先写存档，再重启 GameScene（僚机数量/火力在 create 时读档）
async function enterGame(upgrades, ship = 1) {
  await page.evaluate(({ up, sh }) => {
    const s = window.__SAVE.load();
    Object.assign(s.upgrades, up);
    s.selectedShip = sh;
    s.tutorialDone = true;   // 首玩教程会 physics.pause()，会让碰撞全部停摆
    window.__SAVE.save();
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
  }, { up: upgrades, sh: ship });
  await sleep(1300);
  // 隔离环境：停波次 + 清场，避免路过敌机/敌弹干扰确定性断言
  await page.evaluate(() => {
    const s = window.__SKY;
    s.waves = null;
    s.enemies.children.each((e) => { if (e.active) e.hit(99999); });
    s.enemyBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    s.player.x = 270; s.player.y = 760;
  });
  await sleep(400);
}

// 强制所有僚机立刻开火一轮，返回本轮产生的僚机弹快照
async function forceWingmanVolley() {
  return page.evaluate(() => {
    const s = window.__SKY;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const sys = s.wingmanSystem;
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const out = [];
    s.playerBullets.children.each((b) => {
      if (!b.active) return;
      out.push({
        byWingman: b.byWingman === true,
        element: b.element,
        damage: b.damage,
        tinted: !!b._wmTinted,
        tint: b.tintTopLeft,
      });
    });
    return out;
  });
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE && !!window.__ACH__, null, { timeout: 15000 });
  await sleep(1000);
  await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });

  // ============================================================
  // ② 战术分工：2 架 = suppress + support，fireMul / offMul 生效
  // ============================================================
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1); // 赤焰 = 火元素
  const roles = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    const m = sys.getMembers();
    return {
      count: sys.getCount(),
      roles: m.map((w) => w.role),
      intervals: m.map((w) => w.getFireInterval()),
      offMuls: m.map((w) => ({ x: w._roleCfg.offMul.x, y: w._roleCfg.offMul.y })),
      aims: m.map((w) => w._roleCfg.aim),
      hasElementAim: sys._hasElementAim,
      rawOffsets: m.map((w) => ({ x: w.offset.x, y: w.offset.y })),
    };
  });
  assert('2 架角色 = suppress + support（ROLE_BY_COUNT）',
    roles.count === 2 && roles.roles[0] === 'suppress' && roles.roles[1] === 'support');
  assert('fireMul 生效：suppress=260ms / support=260/1.15≈226ms',
    Math.abs(roles.intervals[0] - 260) < 1e-6 && Math.abs(roles.intervals[1] - 260 / 1.15) < 1e-6);
  assert('support 射速确实快于 suppress', roles.intervals[1] < roles.intervals[0]);
  assert('offMul 生效：suppress(1,1) / support(0.8,1.2)',
    roles.offMuls[0].x === 1 && roles.offMuls[0].y === 1
    && roles.offMuls[1].x === 0.8 && roles.offMuls[1].y === 1.2);
  assert('aim 偏好：suppress=nearest / support=element',
    roles.aims[0] === 'nearest' && roles.aims[1] === 'element' && roles.hasElementAim === true);
  assert('原始槽位不被 offMul 就地污染（仍为 ±52,16）',
    roles.rawOffsets[0].x === -52 && roles.rawOffsets[1].x === 52
    && roles.rawOffsets[0].y === 16 && roles.rawOffsets[1].y === 16);

  // 编队收敛点 = 槽位 * offMul
  const conv = await page.evaluate(() => {
    const s = window.__SKY;
    s.player.x = 270; s.player.y = 700;
    for (let i = 0; i < 90; i++) s.wingmanSystem.update(s.time.now + i * 16, 16);
    const m = s.wingmanSystem.getMembers();
    return {
      d0: Math.abs(m[0].x - (270 - 52)),
      d1: Math.abs(m[1].x - (270 + 52 * 0.8)),
      dy1: Math.abs(m[1].y - (700 + 16 * 1.2)),
    };
  });
  assert('suppress 收敛到 x-52（误差<2px）', conv.d0 < 2);
  assert('support 收敛到 x+52*0.8（误差<2px）', conv.d1 < 2);
  assert('support 纵向收敛到 y+16*1.2（误差<2px）', conv.dy1 < 2);

  // 3/4 架角色表。注意：机库 UPGRADE_TREE.wingman.max=2，3/4 架只能靠"僚机道具"运行时增援，
  // 所以这里走 addWingman()（与 collectItem 的 'wingman' 分支同一入口）。
  const r34 = await page.evaluate(() => {
    const sys = window.__SKY.wingmanSystem;
    sys.addWingman();
    const roles3 = sys.getMembers().map((w) => w.role);
    sys.addWingman();
    const m = sys.getMembers();
    const over = sys.addWingman();   // 第 5 架应被硬上限拦下
    return {
      roles3,
      roles4: m.map((w) => w.role),
      flankInterval: m[2].getFireInterval(),
      capped: over === null && sys.getCount() === 4,
    };
  });
  assert('3 架角色 = suppress/support/flank（增援后即时重排）',
    r34.roles3.join(',') === 'suppress,support,flank');
  assert('4 架角色 = suppress/support/flank/support',
    r34.roles4.join(',') === 'suppress,support,flank,support');
  assert('flank 射速更慢（260/0.9≈289ms）', Math.abs(r34.flankInterval - 260 / 0.9) < 1e-6);
  assert('僚机硬上限 4 仍生效', r34.capped === true);
  await page.screenshot({ path: `${SHOT}/shot_wm2_roles.png` });

  // ============================================================
  // ① 独立生存：敌弹击落僚机 -> ~4s 归队 -> 重生后首弹仍带 element
  // ============================================================
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const downed = await page.evaluate(() => {
    const s = window.__SKY;
    const w = s.wingmanSystem.getMembers()[0];
    const before = { hp: w.hp, alive: w.alive, dead: s.wingmanSystem._deadCount, combo: s.combo };
    // 3 发敌弹（HIT_DMG=1，BASE_HP=3）压在僚机身上，走真实 overlap 回调
    for (let i = 0; i < 3; i++) {
      const b = s.enemyBullets.get(w.x, w.y, 'bullet_enemy');
      if (!b) continue;
      b.setActive(true).setVisible(true);
      if (b.body) b.body.enable = true;
      b.setVelocity(0, 0);
      b.x = w.x + i * 2; b.y = w.y;
    }
    s.__w0 = w;
    return before;
  });
  assert('击落前僚机满血存活', downed.hp === 3 && downed.alive && downed.dead === 0);

  await sleep(400);
  const afterHit = await page.evaluate(() => {
    const s = window.__SKY;
    const w = s.__w0;
    return {
      hp: w.hp,
      alive: w.alive,
      active: w.active,
      bodyOff: w.body ? w.body.enable === false : true,
      deadCount: s.wingmanSystem._deadCount,
      respawnDelay: w.respawnAt - s.time.now,
      playerHp: s.player.hp,
      damageTaken: s.stats.damageTaken,
      combo: s.combo,
      leftBullets: s.enemyBullets.children.entries.filter((b) => b.active).length,
    };
  });
  assert('敌弹击落僚机（alive=false / active=false / body 关闭）',
    afterHit.hp === 0 && !afterHit.alive && !afterHit.active && afterHit.bodyOff);
  assert('_deadCount 由 WINGMAN_DESTROYED 事件维护 = 1', afterHit.deadCount === 1);
  assert('重生冷却 ≈ RESPAWN_MS 4000ms', afterHit.respawnDelay > 3200 && afterHit.respawnDelay <= 4000);
  assert('击中僚机的敌弹被回收', afterHit.leftBullets === 0);
  assert('僚机被击落不扣玩家 HP / 不计 damageTaken（flawless 不破）',
    afterHit.playerHp === 100 && afterHit.damageTaken === 0);
  assert('僚机被击落不断玩家连击', afterHit.combo >= downed.combo);
  await page.screenshot({ path: `${SHOT}/shot_wm2_downed.png` });

  // 玩家阵亡时重生计时冻结
  const frozen = await page.evaluate(() => {
    const s = window.__SKY;
    const w = s.__w0;
    s.player.setActive(false);
    s.wingmanSystem._tickRespawn(s.time.now + 999999);  // 时间早已越过 respawnAt
    const stillDead = !w.alive;
    s.player.setActive(true);
    return stillDead;
  });
  assert('玩家阵亡时重生冻结（_tickRespawn 前置 playerActive 守卫）', frozen === true);

  // 2s 时仍未归队（证明不是立刻重生）
  await sleep(1600);
  const mid = await page.evaluate(() => window.__SKY.__w0.alive);
  assert('冷却期内不提前归队（~2s 仍为击落态）', mid === false);

  // 等满 4s 后归队
  await sleep(3200);
  const back = await page.evaluate(() => {
    const s = window.__SKY;
    const w = s.__w0;
    return {
      alive: w.alive,
      active: w.active,
      hp: w.hp,
      bodyOn: !!(w.body && w.body.enable),
      deadCount: s.wingmanSystem._deadCount,
      invulnLeft: w.invulnUntil - s.time.now,
      element: w.element,
      role: w.role,
      nearPlayer: Math.hypot(w.x - s.player.x, w.y - s.player.y) < 260,
    };
  });
  assert('~4s 后自动归队（alive / active / body 恢复）',
    back.alive && back.active && back.bodyOn);
  assert('归队满血 hp=3 且 _deadCount 归零', back.hp === 3 && back.deadCount === 0);
  assert('归队位置 = 玩家位置 + 原槽位偏移（未跑出屏外）', back.nearPlayer);
  assert('重生后 element / role 不丢失', back.element === 'fire' && back.role === 'suppress');

  const firstShot = await forceWingmanVolley();
  assert('重生后首弹仍带 element=fire + byWingman（成就链路不断）',
    firstShot.length === 2 && firstShot.every((b) => b.byWingman && b.element === 'fire'));
  await page.screenshot({ path: `${SHOT}/shot_wm2_respawn.png` });

  // 无敌窗口：刚归队瞬间再吃弹不掉血（用一次显式 die+respawn 精确对齐时间基准，
  // 不依赖上面那次"真实 4s 冷却"的余量 —— 那时 900ms 窗口早已过完）
  const invuln = await page.evaluate(() => {
    const s = window.__SKY;
    const w = s.__w0;
    w.die();
    const t = s.time.now;
    w.respawn(s.player.x + w.offset.x, s.player.y + w.offset.y, t);
    const window900 = w.invulnUntil - t;
    const blocked = w.takeDamage(1, t) === false && w.hp === 3;
    const inside = w.takeDamage(1, t + 800) === false && w.hp === 3;       // 仍在窗口内
    const hurt = w.takeDamage(1, t + 5000) === false && w.hp === 2;        // 窗口外正常掉血
    w.hp = w.maxHp;
    return { window900, blocked, inside, hurt, deadCount: s.wingmanSystem._deadCount };
  });
  assert('重生无敌窗口 = INVULN_MS 900ms', invuln.window900 === 900);
  assert('无敌窗口内不掉血（t=0 / t=800）', invuln.blocked === true && invuln.inside === true);
  assert('无敌结束后正常受伤（断言有效性自检）', invuln.hurt === true);
  assert('die+respawn 一轮后 _deadCount 收支平衡', invuln.deadCount === 0);

  // ============================================================
  // ③ 元素协同 combo：交替命中 -> +35% 增伤 + 事件 + 成就
  // ============================================================
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  await page.evaluate(() => { window.__ACH__.reset(); });

  // 3-1 同来源连打不触发（必须交替）
  // 每个子用例都先把 combo 归零：进场那 1.3s 里在飞的玩家弹/僚机弹可能命中残敌，
  // 给状态机塞进真实命中，不复位会偶发抢跑（page.evaluate 内部是原子的，复位后不会再被打断）。
  const sameSide = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0; sys.combo.count = 0;
    sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const t = s.time.now;
    sys.reportHit(false, 'fire', t);
    sys.reportHit(false, 'fire', t + 100);
    sys.reportHit(false, 'fire', t + 200);
    return { count: sys.combo.count, mul: sys.getComboMul(t + 250), combo: { ...sys.combo }, now: t };
  });
  assert('同来源连续命中不触发协同（count 不涨、无增益）',
    sameSide.count === 1 && sameSide.mul === 1);

  // 3-2 交替但超窗不触发
  const outWindow = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0; sys.combo.count = 0;
    sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const t = s.time.now;
    sys.reportHit(false, 'fire', t);
    sys.reportHit(true, 'fire', t + 2000);   // > WINDOW_MS 1200
    sys.reportHit(false, 'fire', t + 4000);
    return { count: sys.combo.count, mul: sys.getComboMul(t + 4100) };
  });
  assert('超出 WINDOW_MS 1200ms 断链，不触发协同',
    outWindow.count === 1 && outWindow.mul === 1);

  // 3-3 元素不同不触发
  const mixEl = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0; sys.combo.count = 0;
    sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const t = s.time.now;
    sys.reportHit(false, 'fire', t);
    sys.reportHit(true, 'ice', t + 100);
    sys.reportHit(false, 'fire', t + 200);
    return { count: sys.combo.count, mul: sys.getComboMul(t + 250) };
  });
  assert('不同元素混打不触发协同', mixEl.count === 1 && mixEl.mul === 1);

  // 3-4 正路：交替 5 次同元素 -> 触发（同时验证 WINGMAN_COMBO 事件真的走到成就层）
  const fired = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0;
    sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    // 监听点：GameScene 把 EVENTS.WINGMAN_COMBO 转发到 AchievementManager.reportElementCombo，
    // 包一层就能同时证明"事件发出"与"payload.element 透传"
    const A = window.__ACH__;
    const orig = A.reportElementCombo;
    const seen = [];
    A.reportElementCombo = function (el) { seen.push(el); return orig.call(A, el); };
    const t = s.time.now;
    sys.reportHit(false, 'fire', t);          // 玩家 -> 第 1 次
    sys.reportHit(true, 'fire', t + 100);     // 僚机 -> 第 2 次
    sys.reportHit(false, 'fire', t + 200);    // 玩家 -> 第 3 次
    sys.reportHit(true, 'fire', t + 300);     // 僚机 -> 第 4 次
    sys.reportHit(false, 'fire', t + 400);    // 玩家 -> 第 5 次交替，触发
    const res = {
      seen: seen.slice(),
      mulIn: sys.getComboMul(t + 250),
      mulOut: sys.getComboMul(t + 3800),      // BUFF_MS 3000 之后应失效
      countAfter: sys.combo.count,
      activeUntilDelta: sys.combo.activeUntil - t,
    };
    A.reportElementCombo = orig;
    return res;
  });
  assert('交替 5 次同元素命中触发 WINGMAN_COMBO 事件（payload.element=fire）',
    fired.seen.length === 1 && fired.seen[0] === 'fire');
  assert('增益倍率 = 1.35（DMG_MUL）', Math.abs(fired.mulIn - 1.35) < 1e-9);
  assert('增益时长 = 3000ms（BUFF_MS）且到期失效',
    Math.abs(fired.activeUntilDelta - 3400) <= 60 && fired.mulOut === 1);
  assert('触发后 count 清零（同链不重复广播）', fired.countAfter === 0);

  // 3-5 增益期内僚机弹伤害 +35% 且染色
  const buffVolley = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    sys.combo.element = 'fire';
    sys.combo.activeUntil = s.time.now + 3000;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const out = [];
    s.playerBullets.children.each((b) => {
      if (b.active) out.push({ dmg: b.damage, tint: b.tintTopLeft, tinted: !!b._wmTinted, byWingman: b.byWingman });
    });
    return out;
  });
  assert('增益期僚机弹伤害 = 10 * 1.00 * 1.35 = 13.5',
    buffVolley.length === 2 && buffVolley.every((b) => Math.abs(b.dmg - 13.5) < 1e-6));
  assert('增益期僚机弹染 combo 色 0xff6633',
    buffVolley.every((b) => b.tinted && b.tint === 0xff6633));
  assert('增益期僚机弹仍带 byWingman（成就链路不受 combo 影响）',
    buffVolley.every((b) => b.byWingman === true));
  await page.screenshot({ path: `${SHOT}/shot_wm2_combo.png` });

  // 3-6 增益到期后回落 1.0
  const expired = await page.evaluate(() => {
    const s = window.__SKY;
    s.wingmanSystem.combo.activeUntil = s.time.now - 1;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const sys = s.wingmanSystem;
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const out = [];
    s.playerBullets.children.each((b) => { if (b.active) out.push({ dmg: b.damage, tinted: !!b._wmTinted }); });
    return out;
  });
  assert('增益到期后伤害回落 10.0 且不再染色',
    expired.length === 2 && expired.every((b) => Math.abs(b.dmg - 10) < 1e-6 && !b.tinted));

  // 3-7 成就 combo_element_5 / combo_element_50 计数
  const comboAch = await page.evaluate(() => {
    const A = window.__ACH__;
    A.reset();
    const p0 = A.getProgress('combo_element_5');
    for (let i = 0; i < 5; i++) A.reportElementCombo('fire');
    const p5 = A.getProgress('combo_element_5');
    const p50a = A.getProgress('combo_element_50');
    for (let i = 0; i < 45; i++) A.reportElementCombo('ice');
    const p50b = A.getProgress('combo_element_50');
    return {
      start: p0.cur, unlocked5: p5.unlocked, cur5: p5.cur, target5: p5.target,
      cur50a: p50a.cur, unlocked50: p50b.unlocked, cur50: p50b.cur, target50: p50b.target,
    };
  });
  assert('combo_element_5 起始进度 0/5', comboAch.start === 0 && comboAch.target5 === 5);
  assert('触发 5 次后 combo_element_5 解锁（5/5）',
    comboAch.unlocked5 === true && comboAch.cur5 === 5);
  assert('combo_element_50 同步累计（5 -> 50）',
    comboAch.cur50a === 5 && comboAch.cur50 === 50 && comboAch.target50 === 50);
  assert('累计 50 次后 combo_element_50 解锁', comboAch.unlocked50 === true);

  // 3-8 累计次数持久化到存档 achievementStats.elementCombos
  const persisted = await page.evaluate(() => {
    const A = window.__ACH__;
    A.reportRun({ victory: false, damageTaken: 10, stars: 0, levelId: 1, mode: 'normal' });
    const raw = JSON.parse(localStorage.getItem('sky_raiders_save_v1'));
    return raw.achievementStats.elementCombos;
  });
  assert('elementCombos 累计写回存档（=50）', persisted === 50);

  // 3-9 真实链路：僚机弹命中敌人自动上报（不手搓 reportHit）
  const realHit = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    sys.combo.activeUntil = 0;
    sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const e = s.spawnEnemy(270, 420, 'small', 'straight', 1);
    e.x = 270; e.y = 420; e.hp = 99999; e.setVelocity(0, 0);
    s.__ce = e;
    return { spawned: !!e, count0: sys.combo.count };
  });
  assert('真实链路前置：敌机就位、combo 已复位', realHit.spawned && realHit.count0 === 0);

  const chain = await page.evaluate(async () => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    const e = s.__ce;
    const snap = [];
    const sides = [];
    // 命中来源探针：包一层 reportHit，记录 overlap 回调真正传进来的 byWingman
    const origReport = sys.reportHit.bind(sys);
    sys.reportHit = (bw, el, now) => { sides.push(bw); return origReport(bw, el, now); };
    // 交替投放：玩家弹 / 僚机弹 各命中一次，共 5 发 -> 应触发
    const put = (byWingman) => {
      const b = s.playerBullets.get(e.x, e.y - 4, 'bullet_pulse');
      if (!b) return;
      b.setActive(true).setVisible(true);
      if (b.body) b.body.enable = true;
      b.isBomb = false; b.homing = false; b.pierce = 0; b._lastHit = null;
      b.damage = 1; b.element = 'fire'; b.byWingman = byWingman;
      b.setVelocity(0, 0);
      b.x = e.x; b.y = e.y;
    };
    for (let i = 0; i < 5; i++) {
      put(i % 2 === 1);
      await new Promise((r) => setTimeout(r, 120));
      snap.push({ count: sys.combo.count, active: sys.getComboMul() > 1 });
    }
    sys.reportHit = origReport;
    e.hit(999999);
    return { snap, sides, mul: sys.getComboMul(), element: sys.combo.element };
  });
  assert('真实 overlap 回调自动上报（combo 元素被识别为 fire）', chain.element === 'fire');
  assert('真实交替命中 5 次后增益激活（+35%）',
    chain.snap[chain.snap.length - 1].active === true && Math.abs(chain.mul - 1.35) < 1e-9);
  assert('真实链路能识别"僚机侧"命中（P0-3：killBullet 先复位 byWingman 的回归）',
    chain.sides.includes(true) && chain.sides.includes(false));

  // ---- P0-3 回归：真实 overlap 击杀必须把 byWingman 传进 registerKill ----
  // 根因：overlap 回调里先 killBullet（会把 byWingman 复位 false）后读 bullet.byWingman，
  // 导致真实战斗中僚机击杀永远不计入 wingman_first / wingman_50。
  const killChain = await page.evaluate(async () => {
    const s = window.__SKY;
    const A = window.__ACH__;
    A.reset();
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const e = s.spawnEnemy(270, 420, 'small', 'straight', 1);
    e.x = 270; e.y = 420; e.hp = 5; e.setVelocity(0, 0);
    const before = A.getProgress('wingman_50').cur;
    const b = s.playerBullets.get(e.x, e.y, 'bullet_pulse');
    b.setActive(true).setVisible(true);
    if (b.body) b.body.enable = true;
    b.isBomb = false; b.homing = false; b.pierce = 0; b._lastHit = null;
    b.damage = 9999; b.element = 'fire'; b.byWingman = true;
    b.setVelocity(0, 0); b.x = e.x; b.y = e.y;
    await new Promise((r) => setTimeout(r, 220));
    return {
      before,
      after: A.getProgress('wingman_50').cur,
      first: A.isUnlocked('wingman_first'),
      enemyDead: !e.active,
      elemFire: A.getProgress('element_fire').cur,
    };
  });
  assert('真实 overlap 击杀生效（敌机死亡）', killChain.enemyDead === true);
  assert('真实僚机击杀计入 wingman_50（P0-3 回归）', killChain.after === killChain.before + 1);
  assert('真实僚机击杀解锁 wingman_first', killChain.first === true);
  assert('真实击杀的 element 也未被 killBullet 冲掉（element_fire +1）', killChain.elemFire >= 1);

  // ============================================================
  // ④ 主炮子弹无残留 tint / byWingman（池复用红线）
  // ============================================================
  const clean = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    // 制造最脏的场景：combo 增益 + lv3 元素弹染色
    sys.setWeaponLv(3);
    sys.combo.element = 'fire';
    sys.combo.activeUntil = s.time.now + 3000;
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    sys.getMembers().forEach((w) => { if (w.alive) w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const wbs = s.playerBullets.children.entries.filter((b) => b.active);
    const wasDirty = wbs.length > 0 && wbs.every((b) => b.byWingman === true && b.isTinted);
    // 全部回收
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const dirtyInPool = s.playerBullets.children.entries
      .filter((b) => !b.active && (b.byWingman === true || b.isTinted)).length;
    // 主炮开火，Group.get() 会优先复用刚回收的 sprite
    sys.combo.activeUntil = 0;
    s.player.fire();
    const mains = s.playerBullets.children.entries.filter((b) => b.active);
    return {
      wasDirty,
      dirtyInPool,
      mainCount: mains.length,
      mainClean: mains.length > 0 && mains.every((b) => b.byWingman === false && !b.isTinted),
      mainTints: mains.map((b) => b.tintTopLeft),
    };
  });
  assert('回收前确有"带 combo 染色 + byWingman"的僚机弹（断言有效性自检）', clean.wasDirty === true);
  assert('待复用池内无 byWingman / tint 脏标残留', clean.dirtyInPool === 0);
  assert('主炮子弹无残留 byWingman 与 tint（killBullet 无条件 clearTint）',
    clean.mainClean === true && clean.mainTints.every((t) => t === 0xffffff));

  // ============================================================
  // ⑤ 0 架僚机：受击 / 重生 / combo 全部静默降级
  // ============================================================
  await enterGame({ wingman: 0, wingmanFirepower: 0 }, 0);
  const zero = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    let threw = null;
    try {
      for (let i = 0; i < 60; i++) {
        sys._tickRespawn(s.time.now + i * 16);
        sys.update(s.time.now + i * 16, 16);
      }
      sys.reportHit(false, 'fire', s.time.now);
      sys.reportHit(true, 'fire', s.time.now + 100);
      sys.reportHit(false, 'fire', s.time.now + 200);
    } catch (e) { threw = String(e); }
    return {
      count: sys.getCount(),
      threw,
      frame: sys._frame,
      deadCount: sys._deadCount,
      comboCount: sys.combo.count,
      mul: sys.getComboMul(),
      groupOk: !!sys.getGroup(),
    };
  });
  assert('0 架时 update/_tickRespawn/reportHit 均不抛错', zero.count === 0 && zero.threw === null);
  assert('0 架时不空转（_frame 未累加、_deadCount=0）', zero.frame === 0 && zero.deadCount === 0);
  assert('0 架时 combo 完全不参与（count=0、倍率 1.0）',
    zero.comboCount === 0 && zero.mul === 1);
  assert('0 架时僚机组仍可用（overlap 注册不报错）', zero.groupOk === true);
  await sleep(500);
  await page.screenshot({ path: `${SHOT}/shot_wm2_zero.png` });

  // ============================================================
  // 汇总
  // ============================================================
  assert('零 pageerror', pageErrors.length === 0);
  assert('零 console error', consoleErrors.length === 0);
  assert('零 404(非favicon)', bad404.length === 0);
  if (pageErrors.length) log('PAGEERRORS: ' + pageErrors.join(' | '));
  if (consoleErrors.length) log('CONSOLE_ERRORS: ' + consoleErrors.join(' | '));
  if (bad404.length) log('404s: ' + bad404.join(' | '));
} catch (e) {
  log('FAIL 测试异常: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  const pass = results.filter((r) => r.startsWith('PASS')).length;
  const fail = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== 僚机第二版真测汇总: ${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
}
