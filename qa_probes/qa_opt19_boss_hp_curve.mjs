// qa_opt19_boss_hp_curve.mjs —— OPT-19：Boss 血量成长与难度对称性验收探针
// ---------------------------------------------------------------------------
// 背景（见 OPT-19-火力曲线与Boss-TTK.md）：
//   ① 缺陷：Boss maxHp 不吃任何难度系数，而敌机 HP = 型号×关卡×难度档×精英
//      → 「地狱档杂兵 ×2.0 而 Boss ×1.0」，难度越高 Boss 越像过场。
//   ② 曲线：同关内玩家有效 Boss 火力 ×5.8（fp0→fp8），而 Boss 血量恒定 ×1.0
//      → 满配把 L1~L5 全部压到 1.8~4.5s，3 阶段变身/狂暴/破绽演出被跳过。
//   决议：**A**（难度档 bossHpMul 作用于主线 Boss）+ **B**（L4/L5 血量温和上调）。
//
// 本探针锁死的不变量（任一条挂掉 = Boss 血量成长被静默改变）：
//   ① 配置真值：DIFFICULTIES.bossHpMul ≡ 0.75 / 1.0 / 1.31 / 1.74（软系数 hpMul^0.8）
//   ② B 落地：L4 boss.maxHp ≡ 10000、L5 ≡ 12000
//   ③ B 未外溢：L1~L3 血量保持 2600/3300/4200；BOSS_RUSH 独立数组四项未动
//   ④ A 生效：主线 Boss 实例血量 = 配置 maxHp × 难度档 bossHpMul
//   ⑤ A 零回归：standard 档（×1.0）与历史逐字节等价
//   ⑥ 边界·显式 maxHp 优先：Boss Rush / 爬塔自带血量缩放的调用方不被 A 叠加
//   ⑦ 救济局联动：_reliefCombatMul（休闲档）优先于存档难度档（与 spawnEnemy 同口径）
//   ⑧ 阶段比例制：缩放 maxHp 后 66%/33% 相位线仍按比例切分（无绝对阈值残留）
//   ⑨ 设计目标：满配有效 DPS(1424) 下 L4/L5 的 standard TTK 落入 6~12s 目标带
//
// 运行：node qa_probes/qa_opt19_boss_hp_curve.mjs（QA_BASE_URL 默认 5059）
// 说明：只读数值，无像素/重叠断言 → 直接 scene.start('GameScene')，不走菜单点击。
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_BASE_URL || process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

// OPT-19 实测：满配 fp8 对「横移 Boss」的有效 DPS（命中率 ~53% 后的口径）
const EFFECTIVE_BOSS_DPS_FP8 = 1424;
const TTK_TARGET_MIN = 6;
const TTK_TARGET_MAX = 12;

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};
const fmt = (n) => (typeof n === 'number' ? +n.toFixed(2) : n);

const SAVE = {
  version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 99999, bestScore: 0, unlockedLevel: 5,
  selectedShip: 0, skins: {}, ownedSkins: [],
  nickname: '爸爸', haptics: true, muted: true,
  selectedDifficulty: 'standard',
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 },
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

// 停掉菜单层，直接进 GameScene（不启 UIScene → 不触发 BOSS_SPAWNED 的 UI 副作用）
await page.evaluate(() => {
  const g = window.__SKY__;
  ['MenuScene', 'UIScene', 'ResultScene'].forEach((k) => {
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
  const GC = await import('/src/config/GameConfig.js');
  const { LEVELS, DIFFICULTIES, BOSS_RUSH, bossRushScale, getDifficulty, RAGE } = GC;

  // ---- 工具 ----
  const cleanupBoss = () => {
    if (!gs.boss) return;
    try { gs.tweens.killTweensOf(gs.boss); } catch (e) {}
    try { if (gs.boss.fxG) { gs.tweens.killTweensOf(gs.boss.fxG); gs.boss.fxG.destroy(); } } catch (e) {}
    try { gs.boss.destroy(); } catch (e) {}
    gs.boss = null;
  };
  const setDiff = (id) => { gs.difficultyCfg = getDifficulty(id); gs._reliefCombatMul = null; };
  // 主线路径：无 overrides → 走难度档 bossHpMul
  const mainHp = (levelIdx, diffId) => {
    setDiff(diffId);
    const savedLevel = gs.level;
    gs.level = LEVELS[levelIdx];
    cleanupBoss();
    gs.spawnBoss(LEVELS[levelIdx].bossKey);
    const hp = gs.boss ? gs.boss.maxHp : -1;
    gs.level = savedLevel;
    return hp;
  };
  // 显式 override 路径：Boss Rush / 爬塔 同款调用形态
  const overrideHp = (levelIdx, diffId, overrides, invoke) => {
    setDiff(diffId);
    const savedLevel = gs.level;
    gs.level = LEVELS[levelIdx];
    cleanupBoss();
    if (invoke) invoke(); else gs.spawnBoss(LEVELS[levelIdx].bossKey, overrides);
    const hp = gs.boss ? gs.boss.maxHp : -1;
    gs.level = savedLevel;
    return hp;
  };

  const out = {};
  // ---- ① 配置真值 ----
  out.bossHpMul = DIFFICULTIES.map((d) => ({ id: d.id, v: d.bossHpMul }));
  out.levelHp = LEVELS.map((L) => ({ id: L.id, hp: L.boss.maxHp }));
  out.rushHp = BOSS_RUSH.map((b) => b.maxHp);

  // ---- ④⑤ A 生效 / 零回归（主线 L1 全档） ----
  out.l1 = {
    standard: mainHp(0, 'standard'),
    casual: mainHp(0, 'casual'),
    hard: mainHp(0, 'hard'),
    hell: mainHp(0, 'hell'),
  };
  // ---- ② B 落地（L4/L5，standard + hell） ----
  out.l4 = { standard: mainHp(3, 'standard'), hell: mainHp(3, 'hell') };
  out.l5 = { standard: mainHp(4, 'standard') };

  // ---- ⑥ 显式 maxHp 优先：hell 档下不被叠加 ----
  out.explicit = {
    fixed5000: overrideHp(0, 'hell', { maxHp: 5000 }),            // 任意固定血量
    rushLv0: overrideHp(0, 'hell', null, () => {                  // Boss Rush hangarLv=0
      gs.bossRushIndex = 0; gs._rushScale = bossRushScale(0); gs.spawnBossRush();
    }),
    rushLv30: overrideHp(0, 'hell', null, () => {                 // Boss Rush hangarLv=30
      gs.bossRushIndex = 0; gs._rushScale = bossRushScale(30); gs.spawnBossRush();
    }),
    tower1: overrideHp(0, 'hell', null, () => gs.spawnTowerBoss(1)),
    tower5: overrideHp(0, 'hell', null, () => gs.spawnTowerBoss(5)),
  };

  // ---- ⑦ 救济局联动（存档=hell，session 覆盖=casual） ----
  setDiff('hell');
  gs._reliefCombatMul = getDifficulty('casual');
  const savedLevel = gs.level;
  gs.level = LEVELS[0];
  cleanupBoss();
  gs.spawnBoss(LEVELS[0].bossKey);
  out.relief = gs.boss ? gs.boss.maxHp : -1;
  gs.level = savedLevel;
  gs._reliefCombatMul = null;

  // ---- ⑧ 阶段阈值比例制（hell L1：maxHp 4524） ----
  setDiff('hell');
  gs.level = LEVELS[0];
  cleanupBoss();
  gs.spawnBoss(LEVELS[0].bossKey);
  const b = gs.boss;
  const ph = { maxHp: b.maxHp, hpAtSpawn: b.hp, afterP2: null, phaseP2: null, phaseP3: null, maxHpAfter: null, rageRatio: RAGE.hpThreshold };
  b._entering = false;                 // 跳过入场无敌（hit() 在 _entering 时 return false）
  b.update = () => {};                 // 冻住：不横移、不放弹幕
  b.hit(Math.round(b.maxHp * 0.4));    // → hp 60% → phase 2
  ph.phaseP2 = b.phase; ph.afterP2 = b.hp;
  b.hit(Math.round(b.maxHp * 0.4));    // → hp 20% → phase 3
  ph.phaseP3 = b.phase;
  ph.maxHpAfter = b.maxHp;
  gs.level = savedLevel;
  out.phase = ph;
  cleanupBoss();
  setDiff('standard');
  return out;
});

// ══════════════════════════ 断言 ══════════════════════════
console.log('\n采集结果:', JSON.stringify(R, null, 2), '\n');

const round = Math.round;
const L1_STD = 2600;
const CAS = round(L1_STD * 0.75);
const HARD = round(L1_STD * 1.31);
const HELL = round(L1_STD * 1.74);

// ① 配置真值
const mulOk = R.bossHpMul.length === 4
  && R.bossHpMul[0].v === 0.75 && R.bossHpMul[1].v === 1.0
  && R.bossHpMul[2].v === 1.31 && R.bossHpMul[3].v === 1.74;
push('① DIFFICULTIES.bossHpMul ≡ 0.75/1.0/1.31/1.74（软系数 hpMul^0.8）', mulOk,
  R.bossHpMul.map((d) => `${d.id}=${d.v}`).join(' / '));

// ② B 落地
push('② L4 boss.maxHp ≡ 10000（B：5600→10000，×1.786）', R.levelHp[3].hp === 10000, `hp=${R.levelHp[3].hp}`);
push('② L5 boss.maxHp ≡ 12000（B：6400→12000，×1.875）', R.levelHp[4].hp === 12000, `hp=${R.levelHp[4].hp}`);

// ③ B 未外溢
const l123 = R.levelHp[0].hp === 2600 && R.levelHp[1].hp === 3300 && R.levelHp[2].hp === 4200;
push('③ L1~L3 血量未动（2600/3300/4200）→ 低配路径零影响', l123,
  R.levelHp.slice(0, 3).map((l) => l.hp).join('/'));
const rushOk = JSON.stringify(R.rushHp) === JSON.stringify([2600, 3300, 4200, 5600]);
push('③ BOSS_RUSH 独立数组四项未动 → 爬塔/Boss Rush 零外溢', rushOk, R.rushHp.join('/'));

// ④ A 生效
push(`④ casual 档 L1 Boss = 2600×0.75 = ${CAS}`, R.l1.casual === CAS, `实际 ${R.l1.casual}`);
push(`④ hard 档 L1 Boss = 2600×1.31 = ${HARD}`, R.l1.hard === HARD, `实际 ${R.l1.hard}`);
push(`④ hell 档 L1 Boss = 2600×1.74 = ${HELL}（修复前恒 2600）`, R.l1.hell === HELL, `实际 ${R.l1.hell}`);

// ⑤ A 零回归
push('⑤ standard 档 L1 Boss ≡ 2600（×1.0，与历史逐字节等价）', R.l1.standard === L1_STD, `实际 ${R.l1.standard}`);

// ② B + A 复合
push('②④ standard L4 Boss ≡ 10000；hell L4 ≡ 10000×1.74 = 17400',
  R.l4.standard === 10000 && R.l4.hell === round(10000 * 1.74),
  `standard=${R.l4.standard} hell=${R.l4.hell}`);
push('②④ standard L5 Boss ≡ 12000', R.l5.standard === 12000, `实际 ${R.l5.standard}`);

// ⑥ 显式 maxHp 优先
push('⑥ hell 档 + overrides.maxHp=5000 → 仍为 5000（显式值不被 A 叠加）', R.explicit.fixed5000 === 5000, `实际 ${R.explicit.fixed5000}`);
push('⑥ Boss Rush(hell, hangarLv=0) ≡ 2600；hangarLv=30 ≡ 4160（_rushScale 独占缩放）',
  R.explicit.rushLv0 === 2600 && R.explicit.rushLv30 === 4160,
  `lv0=${R.explicit.rushLv0} lv30=${R.explicit.rushLv30}`);
push('⑥ 爬塔(hell) 1 层 ≡ 2600；5 层 ≡ 2600×1.72 = 4472（层数增长独占）',
  R.explicit.tower1 === 2600 && R.explicit.tower5 === 4472,
  `1层=${R.explicit.tower1} 5层=${R.explicit.tower5}`);

// ⑦ 救济局联动
push('⑦ 存档=hell + 救济局选项A(casual) → Boss HP 取 2600×0.75 = 1950（session 覆盖优先）',
  R.relief === CAS, `实际 ${R.relief}`);

// ⑧ 阶段比例制
const ph = R.phase;
push('⑧ hell L1 Boss 血量 = 2600×1.74 = 4524；spawn 时满血', ph.maxHp === HELL && ph.hpAtSpawn === HELL,
  `maxHp=${ph.maxHp} hp=${ph.hpAtSpawn}`);
push('⑧ 扣至 ~60% → phase 2（相位线按 maxHp 比例，非绝对阈值）', ph.phaseP2 === 2, `phase=${ph.phaseP2} hp=${ph.afterP2}`);
push('⑧ 扣至 ~20% → phase 3 且 maxHp 不因受击漂移', ph.phaseP3 === 3 && ph.maxHpAfter === HELL,
  `phase=${ph.phaseP3} maxHp=${ph.maxHpAfter}`);

// ⑨ 设计目标 —— 血量取自**实际配置**推导（不得硬编码算式，否则是恒真断言）
const hpL4 = R.levelHp[3].hp;
const hpL5 = R.levelHp[4].hp;
const OLD_L4_HP = 5600; // OPT-19 调研基线（B 之前的值），仅用于证明改动的必要性
const ttkL4 = hpL4 / EFFECTIVE_BOSS_DPS_FP8;
const ttkL5 = hpL5 / EFFECTIVE_BOSS_DPS_FP8;
const ttkL4old = OLD_L4_HP / EFFECTIVE_BOSS_DPS_FP8;
const inBand = (t) => t >= TTK_TARGET_MIN && t <= TTK_TARGET_MAX;
push(`⑨ 满配有效 DPS(${EFFECTIVE_BOSS_DPS_FP8}) 下 L4 TTK = ${hpL4}/${EFFECTIVE_BOSS_DPS_FP8} = ${fmt(ttkL4)}s ∈ [${TTK_TARGET_MIN},${TTK_TARGET_MAX}]`,
  inBand(ttkL4), `由实际配置血量推导；基线 ${OLD_L4_HP} → ${fmt(ttkL4old)}s`);
push(`⑨ 满配有效 DPS(${EFFECTIVE_BOSS_DPS_FP8}) 下 L5 TTK = ${hpL5}/${EFFECTIVE_BOSS_DPS_FP8} = ${fmt(ttkL5)}s ∈ [${TTK_TARGET_MIN},${TTK_TARGET_MAX}]`,
  inBand(ttkL5), '由实际配置血量推导');
push('⑨ 基线血量(5600)在目标带外 → B 非无谓改动', !inBand(ttkL4old), `基线 L4 TTK=${fmt(ttkL4old)}s`);
push('⑨ 关卡血量单调递增（L1<L2<L3<L4<L5）', R.levelHp.every((l, i) => i === 0 || l.hp > R.levelHp[i - 1].hp),
  R.levelHp.map((l) => l.hp).join(' < '));

// ⑩ 零报错
push('⑩ 零 pageerror / console.error', errors.length === 0, `${errors.length} 条`);
if (errors.length) console.error(errors.slice(0, 8).join('\n'));

// ══════════════════════════ 汇总 ══════════════════════════
const pass = checks.filter((c) => c.ok).length;
console.log(`\n=== OPT-19 Boss 血量成长探针：${pass}/${checks.length} PASS ===`);
if (pass !== checks.length) {
  console.log('FAIL 明细:');
  checks.filter((c) => !c.ok).forEach((c) => console.log('  ❌ ' + c.name));
}

try { await browser.close(); } catch (e) { /* 收尾竞态忽略 */ }
process.exitCode = pass === checks.length ? 0 : 1;
