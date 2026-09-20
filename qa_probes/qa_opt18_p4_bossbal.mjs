// qa_opt18_p4_bossbal.mjs —— OPT-18 P4：Boss 承伤不变式验收探针
// ---------------------------------------------------------------------------
// 背景：2d7d8c2 修掉「Boss 命中恒落 10 兜底」真 bug（killBullet 会复位 b.damage=0 /
//       b.element=null，旧代码「先回收后读」→ `b.damage || 10` 恒为 10）。
//       修复后普通弹开始读真实 b.damage（含聚焦/救济/强化/武器档位）。
//
// 该修复的平衡影响已实证评估（见 OPT-18-P4-评估-Boss平衡回调.md），结论：
//   · 主炮普攻（含满火力）单发伤害 10 → 10，倍率 1.000 —— 火力等级只加"弹数"不加"单发伤害"
//   · 真实提速仅发生在主动增益：聚焦 ×1.2 / 救济 ×1.1 / 强化射击(B11) ×1.5 / 导弹主武器 ×2.8
//   · 炸弹(killBullet 前调用 _explodeBomb)、激光(beam.dps)、穿透弹 —— 修复前就已正确，不受影响
//   → 决议：不回调 Boss 数值（方案 A），改为本探针锁死不变式（方案 D）。
//
// 本探针锁死的不变量（任何一条挂掉都说明 Boss 平衡被静默改变）：
//   ① 池复用契约仍在：killBullet 后 b.damage === 0 且 b.element === null
//      （这是"为什么必须快照"的根因；若被删掉，本探针的其余断言语义会漂移）
//   ② 【A 方案核心】主炮普攻对 Boss 的单发伤害 ≡ BULLET.PLAYER_DMG，
//      与机库火力等级(0/8)、局内 P(0/4) 均无关 —— 火力只增弹数
//   ③ 增益倍率如实生效且互乘：聚焦 ×1.2、救济 ×1.1、强化射击 ×1.5
//   ④ 武器档位伤害基数为配置真值：导弹 28 / 炸弹 50
//   ⑤ 僚机各档 = PLAYER_DMG × cfg.dmgMul（不得回退成"一律 10"）
//   ⑥ 端到端：Boss 本体掉血 ≡ Σ各弹 b.damage；炸弹 ≡ Σ × 0.6（AOE 系数）
//   ⑦ 端到端：可破坏护盾部位掉血 ≡ Σ各弹 b.damage（护盾分支同源，此前同样恒 10）
//   ⑧ 命中数 ≡ 发出数（非炸弹、非穿透）—— 证明"每发都结算，没被去重逻辑吞掉"
//
// 运行：node qa_probes/qa_opt18_p4_bossbal.mjs（QA_BASE_URL 默认 5059）
// 说明：本探针只读伤害数值，无像素/重叠断言 → 不触发"场景残留渲染"陷阱，
//       故直接 scene.start('GameScene') 而不走菜单点击（与 _boss_dmg_diag.mjs 同法）。
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_BASE_URL || process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';
const TOL = 0.01;

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};
const near = (a, b, tol = TOL) => Math.abs(a - b) <= tol;
const fmt = (n) => (typeof n === 'number' ? +n.toFixed(2) : n);

const SAVE = {
  version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 99999, bestScore: 0, unlockedLevel: 1,
  selectedShip: 0, skins: {}, ownedSkins: [],
  nickname: '爸爸', haptics: true, muted: true,
  dailyChallenge: { date: '', bestScore: 0, cleared: false, claimed: false },
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.addInitScript(({ key, save }) => {
  try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) {}
}, { key: SAVE_KEY, save: SAVE });

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 30000 });

await page.evaluate(() => {
  const g = window.__SKY__;
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const sc = g.scene.getScene(k); if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, null, { timeout: 30000 });

// ══════════════════════════ 采集 ══════════════════════════
const R = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const Boss = (await import('/src/entities/Boss.js')).default;
  const { BULLET, FOCUS, WINGMAN } = await import('/src/config/GameConfig.js');
  const p = gs.player;

  const clearBullets = () => { gs.playerBullets.children.each((b) => { if (b.active) gs.killBullet(b); }); };
  const clearAll = () => {
    gs.enemies.children.each((e) => { if (e.active) e.recycle(); });
    gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
    clearBullets();
    if (gs.boss) { if (gs.boss.fxG) gs.boss.fxG.destroy(); gs.boss.destroy(); gs.boss = null; }
  };
  const mkBoss = (shieldHp) => {
    const b = new Boss(gs, 'boss_crusher', {
      maxHp: 1000000, pattern: 'spiral', name: 'probe', color: 0xff9a4a,
      shieldHp, difficulty: 1,
    });
    b._entering = false;
    b.update = () => {};                          // 冻住：不横移、不放弹幕
    b.setPosition(270, 300);
    if (b.shieldPart) b.shieldPart.setPosition(270, 300);
    gs.boss = b;
    return b;
  };
  const applyLoadout = (c) => {
    p.setWeapon(c.weapon || 'pulse');
    p.setFirepower(c.firepower || 0);
    p.setPowerLevel(c.powerLevel || 0);
    p.setFocusing(!!c.focus);
    p.reliefAtkMul = c.relief || 1;
    p.burstAtkMul = c.burst || 1;
    p.towerExtraShots = 0;
    p.tempFireBonusUntil = 0;
    p.invulnUntil = gs.time.now + 1e9;
  };

  // ── 阶段 0：池复用契约（本探针的根因不变量）────────────────────────
  clearAll();
  applyLoadout({ weapon: 'missile' });
  clearBullets();
  const probeBullet = gs.playerBullets.get(270, 500, 'bullet_pulse');
  probeBullet.setActive(true).setVisible(true);
  probeBullet.damage = 28;
  probeBullet.element = 'fire';
  gs.killBullet(probeBullet);
  const recycleContract = {
    damage: probeBullet.damage,
    element: probeBullet.element,
    byWingman: probeBullet.byWingman,
  };

  // ── 阶段 1：静态管线（读实际发射出的 b.damage，帧率无关）───────────
  const CONFIGS = [
    { id: 'M1 主炮·裸装(火力0/P0)', weapon: 'pulse', firepower: 0, powerLevel: 0 },
    { id: 'M2 主炮·满火力(机库8/局内P4)', weapon: 'pulse', firepower: 8, powerLevel: 4 },
    { id: 'M3 满火力+聚焦', weapon: 'pulse', firepower: 8, powerLevel: 4, focus: true },
    { id: 'M4 满火力+聚焦+救济', weapon: 'pulse', firepower: 8, powerLevel: 4, focus: true, relief: 1.1 },
    { id: 'M5 满火力+强化射击', weapon: 'pulse', firepower: 8, powerLevel: 4, burst: 1.5 },
    { id: 'M6 导弹主武器(火力8)', weapon: 'missile', firepower: 8 },
    { id: 'M7 炸弹主武器(火力8)', weapon: 'bomb', firepower: 8 },
  ];
  const stat = [];
  for (const c of CONFIGS) {
    clearAll();
    applyLoadout(c);
    clearBullets();
    p.fire();
    const ds = [];
    gs.playerBullets.children.each((b) => { if (b.active) ds.push(b.damage); });
    stat.push({
      id: c.id,
      bullets: ds.length,
      uniq: [...new Set(ds.map((x) => +x.toFixed(2)))],
      sum: +ds.reduce((a, x) => a + x, 0).toFixed(2),
      interval: p.getEffectiveFireInterval(),
    });
  }

  // ── 阶段 2：僚机各档（同属 killBullet 影响面）──────────────────────
  const wm = [];
  for (let lv = 0; lv < WINGMAN.WEAPON_LV.length; lv++) {
    const cfg = WINGMAN.WEAPON_LV[lv];
    clearAll();
    applyLoadout({ weapon: 'pulse' });
    clearBullets();
    const wb = gs.spawnWingmanBullet(270, 500, -Math.PI / 2, { weaponLv: lv, element: null });
    wm.push({
      lv, name: cfg.name, shots: cfg.shots || 1, dmgMul: cfg.dmgMul,
      pierce: wb ? (wb.pierce || 0) : -1,
      dmg: wb ? +wb.damage.toFixed(2) : null,
      expect: +(BULLET.PLAYER_DMG * cfg.dmgMul).toFixed(2),
    });
  }

  // ── 阶段 3：端到端（真弹搬到 Boss 命中盒 → 走生产函数 checkBossHits）──
  const endToEnd = (c, useShield) => {
    clearAll();
    applyLoadout(c);
    const boss = mkBoss(useShield ? 1000000 : 0);
    let hits = 0;
    const oh = boss.hit.bind(boss);
    boss.hit = (d, e) => { hits += 1; return oh(d, e); };
    let shieldHits = 0;
    const osh = boss.hitShieldPart.bind(boss);
    boss.hitShieldPart = (d) => { shieldHits += 1; return osh(d); };

    clearBullets();
    p.fire();
    const ds = [];
    gs.playerBullets.children.each((b) => {
      if (b.active) { ds.push(b.damage); b.setPosition(270, 300); }
    });
    const hp0 = boss.hp;
    const sp0 = boss._shieldPartHp;
    gs.checkBossHits();
    const out = {
      id: c.id, isBomb: c.weapon === 'bomb',
      emitted: ds.length, sumSet: +ds.reduce((a, x) => a + x, 0).toFixed(2),
      hits, shieldHits,
      hpDelta: +(hp0 - boss.hp).toFixed(2),
      shieldDelta: +(sp0 - boss._shieldPartHp).toFixed(2),
    };
    clearAll();
    return out;
  };
  const e2eBody = CONFIGS.map((c) => endToEnd(c, false));
  const e2eShield = CONFIGS.filter((c) => c.weapon === 'pulse').map((c) => endToEnd(c, true));

  return {
    base: { PLAYER_DMG: BULLET.PLAYER_DMG, MISSILE_DMG: BULLET.MISSILE_DMG, BOMB_DMG: BULLET.BOMB_DMG, FOCUS_MUL: FOCUS.DMG_MUL },
    recycleContract, stat, wm, e2eBody, e2eShield,
  };
});

// ══════════════════════════ 断言 ══════════════════════════
const B = R.base;
const byId = (arr, id) => arr.find((x) => x.id === id);

// —— ① 池复用契约 ——
push('1. 池复用契约：killBullet 后 b.damage 归零（快照根因未变）',
  R.recycleContract.damage === 0, `damage=${R.recycleContract.damage}`);
push('2. 池复用契约：killBullet 后 b.element 置空',
  R.recycleContract.element === null, `element=${JSON.stringify(R.recycleContract.element)}`);

// —— ② A 方案核心不变式：主炮普攻对 Boss 恒为基础伤害 ——
const m1 = byId(R.stat, 'M1 主炮·裸装(火力0/P0)');
const m2 = byId(R.stat, 'M2 主炮·满火力(机库8/局内P4)');
push('3.【A 核心】主炮·裸装 单发 === PLAYER_DMG',
  m1 && m1.uniq.length === 1 && near(m1.uniq[0], B.PLAYER_DMG),
  `单发=${JSON.stringify(m1 && m1.uniq)} 期望=${B.PLAYER_DMG}`);
push('4.【A 核心】主炮·满火力(机库8+P4) 单发仍 === PLAYER_DMG（火力只加弹数，不加单发伤害）',
  m2 && m2.uniq.length === 1 && near(m2.uniq[0], B.PLAYER_DMG),
  `单发=${JSON.stringify(m2 && m2.uniq)} 期望=${B.PLAYER_DMG}`);
push('5. 弹数随火力增长（裸装 1 发 → 满火力 15 发）：火力成长确实只走数量',
  m1 && m2 && m1.bullets === 1 && m2.bullets === 15,
  `裸装=${m1 && m1.bullets} 发 / 满火力=${m2 && m2.bullets} 发`);
push('6. 齐射总伤：满火力 === 弹数 × PLAYER_DMG',
  m2 && near(m2.sum, m2.bullets * B.PLAYER_DMG),
  `齐射=${m2 && m2.sum} 期望=${m2 ? m2.bullets * B.PLAYER_DMG : '-'}`);

// —— ③ 增益倍率如实生效 ——
const m3 = byId(R.stat, 'M3 满火力+聚焦');
const m4 = byId(R.stat, 'M4 满火力+聚焦+救济');
const m5 = byId(R.stat, 'M5 满火力+强化射击');
push('7. 聚焦 ×FOCUS.DMG_MUL 生效', m3 && near(m3.uniq[0], B.PLAYER_DMG * B.FOCUS_MUL),
  `单发=${m3 && JSON.stringify(m3.uniq)} 期望=${(B.PLAYER_DMG * B.FOCUS_MUL).toFixed(2)}`);
push('8. 救济 ×1.1 与聚焦叠乘', m4 && near(m4.uniq[0], B.PLAYER_DMG * B.FOCUS_MUL * 1.1),
  `单发=${m4 && JSON.stringify(m4.uniq)} 期望=${(B.PLAYER_DMG * B.FOCUS_MUL * 1.1).toFixed(2)}`);
push('9. 强化射击(B11) ×1.5 生效', m5 && near(m5.uniq[0], B.PLAYER_DMG * 1.5),
  `单发=${m5 && JSON.stringify(m5.uniq)} 期望=${(B.PLAYER_DMG * 1.5).toFixed(2)}`);
push('10. 增益不改弹数（聚焦/救济/强化均 15 发）',
  m3 && m4 && m5 && m3.bullets === 15 && m4.bullets === 15 && m5.bullets === 15,
  `聚焦=${m3 && m3.bullets} 救济=${m4 && m4.bullets} 强化=${m5 && m5.bullets}`);

// —— ④ 武器档位基数 ——
const m6 = byId(R.stat, 'M6 导弹主武器(火力8)');
const m7 = byId(R.stat, 'M7 炸弹主武器(火力8)');
push('11. 导弹主武器单发 === MISSILE_DMG',
  m6 && m6.uniq.length === 1 && near(m6.uniq[0], B.MISSILE_DMG),
  `单发=${m6 && JSON.stringify(m6.uniq)} 期望=${B.MISSILE_DMG}`);
push('12. 炸弹主武器单发 === BOMB_DMG',
  m7 && m7.uniq.length === 1 && near(m7.uniq[0], B.BOMB_DMG),
  `单发=${m7 && JSON.stringify(m7.uniq)} 期望=${B.BOMB_DMG}`);

// —— ⑤ 僚机各档 ——
const wmBad = R.wm.filter((w) => !near(w.dmg, w.expect));
push('13. 僚机全 6 档单发 === PLAYER_DMG × cfg.dmgMul（未回退成"一律 10"）',
  wmBad.length === 0,
  wmBad.length
    ? wmBad.map((w) => `lv${w.lv}(${w.name}) 实测${w.dmg}≠期望${w.expect}`).join(' ; ')
    : R.wm.map((w) => `lv${w.lv}:${w.dmg}`).join(' '));

// —— ⑥⑦⑧ 端到端 ——
const bodyBad = R.e2eBody.filter((r) => {
  const exp = r.isBomb ? r.sumSet * 0.6 : r.sumSet;
  return !near(r.hpDelta, exp);
});
push('14. 端到端：Boss 本体掉血 ≡ Σ各弹 damage（炸弹 ≡ Σ×0.6 AOE）',
  bodyBad.length === 0,
  bodyBad.length
    ? bodyBad.map((r) => `${r.id} 实测${r.hpDelta}≠期望${fmt(r.isBomb ? r.sumSet * 0.6 : r.sumSet)}`).join(' ; ')
    : R.e2eBody.map((r) => `${r.id.split(' ')[0]}:${r.hpDelta}`).join(' '));

const shieldBad = R.e2eShield.filter((r) => !near(r.shieldDelta, r.sumSet));
push('15. 端到端：可破坏护盾部位掉血 ≡ Σ各弹 damage（护盾分支同源）',
  shieldBad.length === 0,
  shieldBad.length
    ? shieldBad.map((r) => `${r.id} 实测${r.shieldDelta}≠期望${r.sumSet}`).join(' ; ')
    : R.e2eShield.map((r) => `${r.id.split(' ')[0]}:${r.shieldDelta}`).join(' '));

const hitBad = R.e2eBody.filter((r) => !r.isBomb
  && (r.hits !== r.emitted || r.shieldHits !== 0 || r.emitted === 0));
push('16. 命中数 ≡ 发出数（非炸弹；无去重吞弹、无漏结算）',
  hitBad.length === 0,
  hitBad.length
    ? hitBad.map((r) => `${r.id} 命中${r.hits}/发出${r.emitted} 盾命中${r.shieldHits}`).join(' ; ')
    : R.e2eBody.filter((r) => !r.isBomb).map((r) => `${r.id.split(' ')[0]}:${r.hits}/${r.emitted}`).join(' '));

const shieldHitBad = R.e2eShield.filter((r) => r.shieldHits !== r.emitted || r.hpDelta !== 0);
push('17. 护盾判定优先：命中全走护盾，Boss 本体不掉血',
  shieldHitBad.length === 0,
  shieldHitBad.length
    ? shieldHitBad.map((r) => `${r.id} 盾命中${r.shieldHits}/发出${r.emitted} 本体掉血${r.hpDelta}`).join(' ; ')
    : R.e2eShield.map((r) => `${r.id.split(' ')[0]}:盾${r.shieldHits} 本体${r.hpDelta}`).join(' '));

push('18. 零 pageerror / console.error',
  errors.length === 0,
  `errors=${errors.length}${errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''}`);

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log('\n' + '─'.repeat(60));
console.log(`qa_opt18_p4_bossbal: ${checks.length - failed.length}/${checks.length} PASS`
  + (failed.length ? `  ❌ ${failed.map((f) => f.name).join(' ; ')}` : '  ✅ 全绿'));
process.exit(failed.length ? 1 : 0);
