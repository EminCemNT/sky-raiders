// 苍穹战机 — 僚机 AI 进阶第一版 真测（编队 / 智能走位 / 武器进化 / 成就链路）
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

// 进战斗场景：先按需写存档，再重启 GameScene（僚机数量/火力在 create 时读档）
async function enterGame(upgrades, ship = 1) {
  await page.evaluate(({ up, sh }) => {
    const s = window.__SAVE.load();
    Object.assign(s.upgrades, up);
    s.selectedShip = sh;
    s.tutorialDone = true;   // 关键：首玩教程会 physics.pause()，会让碰撞/移动全部停摆
    window.__SAVE.save();
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
  }, { up: upgrades, sh: ship });
  await sleep(1300);
}

// 强制所有僚机立刻开火一轮，返回本轮产生的僚机弹快照
async function forceWingmanVolley() {
  return page.evaluate(() => {
    const s = window.__SKY;
    // 先清空子弹池，保证统计只含本轮僚机弹
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const sys = s.wingmanSystem;
    sys.getMembers().forEach((w) => { w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const out = [];
    s.playerBullets.children.each((b) => {
      if (!b.active) return;
      out.push({
        byWingman: b.byWingman === true,
        element: b.element,
        damage: b.damage,
        pierce: b.pierce || 0,
        texture: b.texture ? b.texture.key : null,
        tinted: !!b._wmTinted,
      });
    });
    return out;
  });
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE, null, { timeout: 15000 });
  await sleep(1000);

  // 复位存档，保证确定性
  await page.evaluate(() => { window.__SAVE.reset(); });

  // ========== 1. 2 架僚机 + weaponLv0：系统实例化 / 编队槽位 ==========
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1); // 赤焰=火元素
  const base = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    return {
      hasSystem: !!sys,
      count: sys.getCount(),
      hasGroup: !!sys.getGroup(),
      weaponLv: sys.weaponLv,
      element: sys.element,
      shipElement: s.player.shipElement,
      slots: sys.getMembers().map((w) => ({
        slot: w.slot, ox: w.offset.x, oy: w.offset.y, f: w.formation, role: w.role,
        hasBody: !!w.body, hp: w.hp, maxHp: w.maxHp, alive: w.alive,
      })),
      legacyRemoved: (typeof s.addWingman === 'undefined') && (typeof s.updateWingmen === 'undefined'),
    };
  });
  assert('WingmanSystem 实例化成功', base.hasSystem && base.hasGroup);
  assert('僚机数量=2（读存档 upgrades.wingman）', base.count === 2);
  assert('编队=菱形对称槽位(±52,16)',
    base.slots.length === 2 && base.slots[0].f === 'diamond'
    && base.slots[0].ox === -52 && base.slots[1].ox === 52
    && base.slots[0].oy === 16 && base.slots[1].oy === 16);
  // 第二版战术分工：2 架 = ROLE_BY_COUNT[2] = ['suppress','support']（第一版恒为 suppress）
  assert('僚机含物理 body / 角色=suppress+support / hp=3',
    base.slots.every((w) => w.hasBody && w.maxHp === 3 && w.alive)
    && base.slots[0].role === 'suppress' && base.slots[1].role === 'support');
  assert('元素继承玩家 shipElement=fire', base.element === 'fire' && base.shipElement === 'fire');
  assert('GameScene 旧 addWingman/updateWingmen 已删除', base.legacyRemoved);

  // ---- lv0 子弹：byWingman + element 红线 ----
  const v0 = await forceWingmanVolley();
  assert('lv0 齐射 2 发（2 架 x 1 路）', v0.length === 2);
  assert('lv0 全部 byWingman=true', v0.length > 0 && v0.every((b) => b.byWingman));
  assert('lv0 全部 element=fire（成就链路）', v0.length > 0 && v0.every((b) => b.element === 'fire'));
  assert('lv0 单发脉冲贴图 + 无穿透', v0.every((b) => b.texture === 'bullet_pulse' && b.pierce === 0));
  await page.screenshot({ path: `${SHOT}/shot_wingman_lv0.png` });

  // ========== 2. 编队跟随：不抖动 / 不脱离 X 轴 ±屏宽1/3 ==========
  const follow = await page.evaluate(async () => {
    const s = window.__SKY;
    s.player.x = 120; s.player.y = 700;
    for (let i = 0; i < 90; i++) s.wingmanSystem.update(s.time.now + i * 16, 16);
    const w = s.wingmanSystem.getMembers();
    // 第二版：目标点 = 玩家 + 槽位 * 角色 offMul（suppress x1.0 / support x0.8）
    return {
      dx0: Math.abs(w[0].x - (s.player.x - 52 * 1.0)),
      dx1: Math.abs(w[1].x - (s.player.x + 52 * 0.8)),
      leash: w.every((m) => Math.abs(m.x - s.player.x) <= 180 + 0.5),
      notOnPlayer: w.every((m) => Math.hypot(m.x - s.player.x, m.y - s.player.y) > 20),
    };
  });
  assert('编队收敛到槽位（误差<2px）', follow.dx0 < 2 && follow.dx1 < 2);
  assert('不脱离玩家 X 轴 ±180', follow.leash);
  assert('僚机不重叠玩家本体', follow.notOnPlayer);

  // ========== 3. 智能走位：排斥力场生效且仍在阵型内 ==========
  const dodge = await page.evaluate(() => {
    const s = window.__SKY;
    const w = s.wingmanSystem.getMembers()[0];
    const beforeX = w.x;
    // 在僚机正上方塞 3 颗敌弹（y < 僚机.y 且距离 < 120）
    for (let i = 0; i < 3; i++) {
      const b = s.enemyBullets.get(w.x + i * 6 - 6, w.y - 60, 'bullet_enemy');
      if (b) { b.setActive(true).setVisible(true); b.body.enable = true; b.setVelocity(0, 0); }
    }
    for (let i = 0; i < 30; i++) s.wingmanSystem.update(s.time.now + i * 16, 16);
    const res = {
      dodgeX: w.dodgeVec.x, dodgeY: w.dodgeVec.y,
      moved: Math.abs(w.x - beforeX) + Math.abs(w.dodgeVec.y) > 0.5,
      clamped: Math.abs(w.dodgeVec.x) <= 40.001 && Math.abs(w.dodgeVec.y) <= 40.001,
      inFormation: Math.abs(w.x - s.player.x) <= 180,
      threatCount: s.wingmanSystem._threats.length,
    };
    s.enemyBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    return res;
  });
  assert('威胁弹被筛出（快照非空）', dodge.threatCount >= 3);
  assert('躲避偏移生效（dodgeVec 非零）', dodge.moved && (dodge.dodgeX !== 0 || dodge.dodgeY !== 0));
  assert('躲避偏移钳制在 ±40px', dodge.clamped);
  assert('躲避后仍不脱离阵型', dodge.inFormation);

  // ========== 4. 僚机火力升级持久化 -> weaponLv 生效 ==========
  // 通过机库同款写法升级（deductCoins + upgrades 写档），再重进关卡
  const persisted = await page.evaluate(() => {
    const s = window.__SAVE.load();
    s.upgrades.wingmanFirepower = 3;
    window.__SAVE.save();
    // 模拟"重启游戏"：清内存缓存后重新从 localStorage 读
    const raw = JSON.parse(localStorage.getItem('sky_raiders_save_v1'));
    return raw.upgrades.wingmanFirepower;
  });
  assert('wingmanFirepower 写入 localStorage', persisted === 3);

  await enterGame({ wingman: 2, wingmanFirepower: 3 }, 1);
  const lv3 = await page.evaluate(() => window.__SKY.wingmanSystem.weaponLv);
  assert('读档后 weaponLv=3 生效', lv3 === 3);

  const v3 = await forceWingmanVolley();
  assert('lv3 元素弹齐射 6 发（2 架 x 3 路）', v3.length === 6);
  assert('lv3 全部 byWingman=true + element=fire',
    v3.length > 0 && v3.every((b) => b.byWingman && b.element === 'fire'));
  assert('lv3 元素染色生效', v3.every((b) => b.tinted));
  assert('lv3 伤害 = 10 * 0.95', v3.every((b) => Math.abs(b.damage - 9.5) < 1e-6));
  await page.screenshot({ path: `${SHOT}/shot_wingman_lv3.png` });

  // ========== 5. 穿透档（lv2）==========
  await enterGame({ wingman: 1, wingmanFirepower: 2 }, 1);
  const solo = await page.evaluate(() => {
    const sys = window.__SKY.wingmanSystem;
    const w = sys.getMembers()[0];
    return { count: sys.getCount(), f: w.formation, ox: w.offset.x, oy: w.offset.y };
  });
  assert('1 架 = 后侧单点编队(fan, 0/44)',
    solo.count === 1 && solo.f === 'fan' && solo.ox === 0 && solo.oy === 44);

  const v2 = await forceWingmanVolley();
  assert('lv2 穿透弹 pierce=1', v2.length === 2 && v2.every((b) => b.pierce === 1));
  assert('lv2 仍带 byWingman + element', v2.every((b) => b.byWingman && b.element === 'fire'));

  // 穿透命中后不销毁：把穿透弹钉在原地，塞一个高血量敌机重叠，走真实 overlap 回调
  await page.evaluate(() => {
    const s = window.__SKY;
    // 隔离环境：停波次 + 清场，避免路过的敌机把停在半空的测试弹提前消耗掉
    s.waves = null;
    s.enemies.children.each((e) => { if (e.active) e.hit(99999); });
    const b = s.playerBullets.children.entries.find((x) => x.active && x.pierce === 1);
    b.setVelocity(0, 0); b.x = 270; b.y = 500;
    const e = s.spawnEnemy(270, 500, 'small', 'straight', 1);
    e.x = 270; e.y = 500; e.hp = 9999; e.setVelocity(0, 0);
    s.__pB = b; s.__pE = e;
  });
  await sleep(350);
  const pierceRun = await page.evaluate(() => {
    const s = window.__SKY;
    const b = s.__pB; const e = s.__pE;
    const afterHit = {
      active: b.active, pierce: b.pierce, lastHit: b._lastHit === e,
      damaged: e.hp < 9999, byWingman: b.byWingman === true,
    };
    s.killBullet(b);
    return {
      afterHit,
      afterRecycle: { pierce: b.pierce, lastHit: b._lastHit, byWingman: b.byWingman },
    };
  });
  assert('穿透弹命中后存活且 pierce 递减',
    pierceRun.afterHit.active === true && pierceRun.afterHit.pierce === 0
    && pierceRun.afterHit.lastHit && pierceRun.afterHit.damaged);
  assert('穿透弹同目标只结算一次（_lastHit 去重）', pierceRun.afterHit.pierce === 0);
  assert('回收后 pierce/_lastHit/byWingman 复位（不污染主炮）',
    pierceRun.afterRecycle.pierce === 0 && !pierceRun.afterRecycle.lastHit
    && pierceRun.afterRecycle.byWingman === false);
  assert('回收前该弹确实是僚机弹（断言有效性自检）', pierceRun.afterHit.byWingman === true);

  // ---- P0-1 回归：僚机弹回收后被 Group.get() 复用给主炮，byWingman 不得残留 ----
  // 根因：Player.fire() 只写 element/damage，从不写 byWingman=false；若 killBullet 不复位，
  // 复用出去的主炮弹会带着 byWingman=true 让 registerKill 把主炮击杀误计入 wingman_50。
  const reuse = await page.evaluate(() => {
    const s = window.__SKY;
    const sys = s.wingmanSystem;
    sys.getMembers().forEach((w) => { w.fireCd = 99999; });
    sys.update(s.time.now, 16);
    const wbs = s.playerBullets.children.entries.filter((x) => x.active && x.byWingman);
    if (!wbs.length) return { error: '未产生僚机弹' };
    // 关键：把整池清空（含本轮全部僚机弹），否则残留的在飞僚机弹会混进下面的统计
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });
    const afterRecycle = wbs.every((b) => b.byWingman === false);
    const wasDirty = wbs.length;
    // 池不变量：任何待复用（inactive）的 sprite 都不得残留 byWingman=true，
    // 否则下一次 Group.get() 就会把脏标带给主炮。这条与 Phaser 内部取用顺序无关，确定性成立。
    const dirtyInPool = s.playerBullets.children.entries
      .filter((b) => !b.active && b.byWingman === true).length;
    // 主炮开火：Group.get() 会优先复用刚回收的 sprite
    s.player.fire();
    const active = s.playerBullets.children.entries.filter((x) => x.active);
    return {
      afterRecycle,
      wasDirty,
      dirtyInPool,
      mainGunCount: active.length,
      allMainGunClean: active.length > 0 && active.every((b) => b.byWingman === false),
    };
  });
  assert('回收前确有僚机弹带 byWingman=true（断言有效性自检）',
    !reuse.error && reuse.wasDirty > 0);
  assert('僚机弹回收后 byWingman 全部复位为 false', !reuse.error && reuse.afterRecycle === true);
  assert('待复用池内无 byWingman 脏标残留（P0-1 池不变量）', reuse.dirtyInPool === 0);
  assert('主炮开火后全部 byWingman=false（P0-1 回归）',
    !reuse.error && reuse.allMainGunClean === true);

  // ---- P0-2 回归：任意角度僚机弹（含朝下/近水平）必须被四边界回收，池不泄漏 ----
  // 直接把子弹摆在四个边界之外（速度 0），只验证 recycleBullets 的剔除条件本身。
  // 不用"飞出去"的方式：回收后的 sprite 会立刻被主炮/僚机 get() 复用并重新激活，
  // 按 sprite 身份追踪会误判。同时临时屏蔽 player.fire / wingmanSystem.update 杜绝复用。
  const leak = await page.evaluate(async () => {
    const s = window.__SKY;
    s.waves = null;
    s.enemies.children.each((e) => { if (e.active) e.hit(99999); });
    const origFire = s.player.fire;
    const origWmUpdate = s.wingmanSystem.update;
    s.player.fire = () => {};
    s.wingmanSystem.update = () => {};
    s.playerBullets.children.each((b) => { if (b.active) s.killBullet(b); });

    const W = s.scale.width, H = s.scale.height;
    const spots = [
      { tag: 'down', x: 270, y: H + 60 },   // 朝下弹飞出底边 —— 旧逻辑只判 y<-30，这发永不回收
      { tag: 'up', x: 270, y: -60 },
      { tag: 'left', x: -60, y: 400 },      // 近水平弹飞出左边
      { tag: 'right', x: W + 60, y: 400 },  // 近水平弹飞出右边
    ];
    const made = spots.map((p) => {
      const b = s.playerBullets.get(p.x, p.y, 'bullet_pulse');
      if (!b) return null;
      b.setActive(true).setVisible(true);
      if (b.body) { b.body.enable = true; }
      b.isBomb = false; b.homing = false; b.damage = 1; b.byWingman = true;
      b.setVelocity(0, 0);
      b.x = p.x; b.y = p.y;
      return { tag: p.tag, b };
    }).filter(Boolean);
    // 对照组：屏幕内的子弹不应被误杀，用来证明不是"把所有弹都清了"
    const inside = s.playerBullets.get(270, 400, 'bullet_pulse');
    if (inside) {
      inside.setActive(true).setVisible(true);
      if (inside.body) inside.body.enable = true;
      inside.isBomb = false; inside.homing = false;
      inside.setVelocity(0, 0); inside.x = 270; inside.y = 400;
    }

    await new Promise((r) => setTimeout(r, 400)); // 若干帧，足够 recycleBullets 跑到
    const result = {
      made: made.length,
      stillActive: made.filter((m) => m.b.active).map((m) => m.tag),
      insideSurvived: !!(inside && inside.active),
    };
    s.player.fire = origFire;
    s.wingmanSystem.update = origWmUpdate;
    return result;
  });
  assert('四边界外的子弹全部被回收（P0-2 池泄漏回归）',
    leak.made === 4 && leak.stillActive.length === 0);
  assert('屏幕内子弹不被误回收（断言有效性自检）', leak.insideSurvived === true);

  // ========== 6. 僚机击杀仍走 registerKill -> 成就链路 ==========
  const ach = await page.evaluate(() => {
    const s = window.__SKY;
    const before = window.__ACH__.getProgress('wingman_50').cur;
    s.registerKill(100, 300, { byWingman: true, element: 'fire' });
    return { before, after: window.__ACH__.getProgress('wingman_50').cur, first: window.__ACH__.isUnlocked('wingman_first') };
  });
  assert('僚机击杀累计 wingman_50 +1', ach.after === ach.before + 1);
  assert('wingman_first 解锁', ach.first);

  // ========== 7. 0 架僚机静默降级 ==========
  await enterGame({ wingman: 0, wingmanFirepower: 0 }, 0);
  const zero = await page.evaluate(() => {
    const s = window.__SKY;
    let threw = false;
    try { for (let i = 0; i < 60; i++) s.wingmanSystem.update(s.time.now + i * 16, 16); } catch (e) { threw = true; }
    return { count: s.wingmanSystem.getCount(), threw, frame: s.wingmanSystem._frame };
  });
  assert('0 架时 count=0 且 update 不抛错', zero.count === 0 && !zero.threw);
  assert('0 架时不空转（首行返回，_frame 未累加）', zero.frame === 0);
  await sleep(600);
  await page.screenshot({ path: `${SHOT}/shot_wingman_zero.png` });

  // ========== 8. 机库新增"僚机火力"项渲染 ==========
  await page.evaluate(() => {
    const g = window.__SKY__;
    window.__SAVE.load().coins = 99999;
    window.__SAVE.save();
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    if (!g.scene.getScene('HangarScene')) g.scene.start('MenuScene');
  });
  await sleep(500);
  await page.evaluate(() => { window.__SKY__.scene.start('HangarScene'); });
  await sleep(900);
  const hangar = await page.evaluate(() => {
    const h = window.__SKY__.scene.getScene('HangarScene');
    return { rows: h.rows.length, keys: h.rows.map((r) => r.key), lastY: h.rows[h.rows.length - 1].levelText.y };
  });
  assert('机库 6 行升级项含 wingmanFirepower',
    hangar.rows === 6 && hangar.keys.includes('wingmanFirepower'));
  assert('末行不越界（levelText.y < 860）', hangar.lastY < 860);
  await page.screenshot({ path: `${SHOT}/shot_wingman_hangar.png` });

  // ========== 汇总 ==========
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
  console.log(`\n==== 僚机 AI 真测汇总: ${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
}
