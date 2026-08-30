// qa_opt13_b14_elemental_storm.mjs —— OPT-13 批B B14 元素免疫 + 全屏风暴 验收探针
//
// 验证（规格）：
//   1) ELEMENT_STORM 配置块（cdMs=15000 / dmg=50 / score=500 / clearBullets / bypassCooldown=false）
//   2) Enemy.TYPES.elemental 存在（immune ['fire']）+ isImmuneTo 判定
//   3) 免疫元素命中 → 0 伤害（hp 不变、不致死）；非免疫元素 → 正常伤害
//   4) 免疫元素状态不附加（_elem 不挂火）；非免疫元素状态（冰减速/雷麻痹）正常生效
//   5) 免疫元素反应伤害归 0（applyReaction）；非元素伤害（风暴）穿透免疫
//   6) WaveSystem 门控：hard/hell 刷 elemental 带免疫；standard 下元素型降级 mid、零免疫
//   7) 风暴：_checkStormTrigger 三元素同挂 → true；elementStorm 清敌弹 + 穿透伤害 + 清元素状态
//   8) 风暴 STORM_CD=15s：连续调用第二次返回 false（防连环触发）
//   9) 活性守卫：死亡演出中敌机（_dying）残留 _elem 不计入三元素判定（防死敌误触发）
//  10) i18n：immuneFire/immuneIce/immuneThunder/stormTitle 在 zh/en 均有值
//  11) 零 pageerror / console error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

// ── 1) 配置与静态模块 ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const loc = await import('/src/config/Locale.js');
  const zh = loc.L.zh, en = loc.L.en;
  return {
    storm: m.ELEMENT_STORM,
    elemental: m.ELEMENTS && m.ELEMENTS.fire && m.ELEMENTS.ice && m.ELEMENTS.thunder,
    i18n: ['immuneFire', 'immuneIce', 'immuneThunder', 'stormTitle'].every((k) => zh[k] && en[k]),
  };
});
push('ELEMENT_STORM 配置（cdMs=15000/dmg=50/score=500/clearBullets/bypassCooldown=false）',
  cfg.storm && cfg.storm.cdMs === 15000 && cfg.storm.dmg === 50 && cfg.storm.score === 500
    && cfg.storm.clearBullets === true && cfg.storm.bypassCooldown === false,
  `cdMs=${cfg.storm && cfg.storm.cdMs} dmg=${cfg.storm && cfg.storm.dmg}`);
push('i18n zh/en 均有 immuneFire/immuneIce/immuneThunder/stormTitle', cfg.i18n);

// ── 2) 起 GameScene（先以标准档起局，再探针内动态切难度档测门控）──
await page.evaluate(() => {
  const g = window.__SKY__;
  window.__SAVE.set('tutorialDone', true);
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const s = g.scene.getScene(k);
    if (s && s.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active && gs.waves;
}, { timeout: 20000 });

// ── 3) 免疫语义（真实 Enemy 实例）──
const imm = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const { getDifficulty } = await import('/src/config/GameConfig.js');
  gs.difficultyCfg = getDifficulty('hard');   // 切 hard 便于免疫测试

  // 免疫敌人：spawn elemental + immune fire
  const e = gs.spawnEnemy(270, 120, 'elemental', 'straight', 1, 'spread', false, undefined, undefined, 'fire');
  const hp0 = e.hp;

  // 3a) 免疫元素命中 → 0 伤害
  const hitImmune = e.hit(10, 'fire');
  const hpAfterImmuneHit = e.hp;
  // 3b) 非免疫元素命中 → 正常伤害
  const hitOther = e.hit(10, 'ice');
  const hpAfterOtherHit = e.hp;
  // 3c) 免疫元素状态不附加
  e.applyElement('fire');
  const elemAfterFire = e._elem;   // 应仍为 null（或未被 fire 覆盖）
  // 3d) 非免疫元素状态正常生效（冰减速挂上）
  e.applyElement('ice');
  const elemAfterIce = e._elem;
  const slowUntil = e._slowUntil;
  // 3e) 免疫元素反应伤害归 0
  const hpBeforeReact = e.hp;
  const reactImmune = e.applyReaction(20, 'fire');
  const hpAfterReactImmune = e.hp;
  // 3f) 非元素伤害穿透免疫
  const hpBeforePlain = e.hp;
  const reactPlain = e.applyReaction(20, null);
  const hpAfterPlain = e.hp;

  // 3g) isImmuneTo 判定
  const immuneFire = e.isImmuneTo('fire');
  const immuneIce = e.isImmuneTo('ice');
  // 3h) 普通敌人恒不免疫
  const n = gs.spawnEnemy(100, 100, 'small', 'straight');
  const normalImmune = n.isImmuneTo('fire');

  e.recycle(); n.recycle();
  return {
    hp0, hitImmune, hpAfterImmuneHit, hitOther, hpAfterOtherHit,
    elemAfterFire, elemAfterIce, slowUntil: slowUntil > 0,
    hpBeforeReact, reactImmune, hpAfterReactImmune,
    hpBeforePlain, reactPlain, hpAfterPlain,
    immuneFire, immuneIce, normalImmune,
  };
});
push('免疫敌人 isImmuneTo(火)=true / (冰)=false / 普通敌人=false',
  imm.immuneFire && !imm.immuneIce && !imm.normalImmune);
push('免疫元素命中 → 0 伤害（hp 不变、不致死）',
  imm.hpAfterImmuneHit === imm.hp0 && imm.hitImmune === false,
  `hp ${imm.hp0} → ${imm.hpAfterImmuneHit}`);
push('非免疫元素命中 → 正常伤害',
  imm.hpAfterOtherHit === imm.hpAfterImmuneHit - 10, `hp ${imm.hpAfterImmuneHit} → ${imm.hpAfterOtherHit}`);
push('免疫元素状态不附加（火不挂） / 非免疫元素状态正常（冰减速挂上）',
  imm.elemAfterFire !== 'fire' && imm.elemAfterIce === 'ice' && imm.slowUntil,
  `afterFire=${imm.elemAfterFire} afterIce=${imm.elemAfterIce} slow=${imm.slowUntil}`);
push('免疫元素反应伤害归 0 / 非元素伤害穿透免疫',
  imm.hpAfterReactImmune === imm.hpBeforeReact && imm.hpAfterPlain === imm.hpBeforePlain - 20,
  `reactImmune=${imm.hpAfterReactImmune}/${imm.hpBeforeReact} plain=${imm.hpAfterPlain}/${imm.hpBeforePlain}`);

// ── 4) WaveSystem 门控：hard → elemental 带免疫；standard → 降级 mid 零免疫 ──
const gate = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const ws = gs.waves;
  const { getDifficulty } = await import('/src/config/GameConfig.js');
  const comp = [{ typeKey: 'elemental', mode: 'straight', weight: 1, pattern: 'spread', immune: 'fire' }];

  // 临时覆写 spawnEnemy 捕获 spawnOne 实际生成的敌人（确定性断言）
  let captured = null;
  const orig = gs.spawnEnemy.bind(gs);
  gs.spawnEnemy = (...args) => { const e = orig(...args); captured = e; return e; };
  const spawnViaWave = () => {
    captured = null;
    ws._elitePending = false; ws._elementalPending = false;
    ws._comp = comp;
    ws.spawnOne();
    return captured;
  };

  // hard：comp 元素型应保持 elemental + 免疫
  gs.difficultyCfg = getDifficulty('hard');
  const hardE = spawnViaWave();
  const hardType = hardE ? hardE.typeKey : null;
  const hardImmune = hardE ? hardE.isImmuneTo('fire') : null;
  if (hardE) hardE.recycle();

  // standard：comp 元素型应降级 mid + 零免疫
  gs.difficultyCfg = getDifficulty('standard');
  const stdE = spawnViaWave();
  const stdType = stdE ? stdE.typeKey : null;
  const stdImmune = stdE ? stdE.isImmuneTo('fire') : null;
  if (stdE) stdE.recycle();

  // 兜底刷 elemental（hard）：直接调 _spawnOneElemental
  gs.difficultyCfg = getDifficulty('hard');
  captured = null;
  ws._spawnOneElemental('thunder');
  const fbE = captured;
  const fbType = fbE ? fbE.typeKey : null;
  const fbImmune = fbE ? fbE.isImmuneTo('thunder') : null;
  if (fbE) fbE.recycle();

  gs.spawnEnemy = orig;
  return { hardType, hardImmune, stdType, stdImmune, fbType, fbImmune };
});
push('hard 档 comp 元素型 → elemental + 免疫火', gate.hardType === 'elemental' && gate.hardImmune === true, `type=${gate.hardType} immune=${gate.hardImmune}`);
push('standard 档 comp 元素型 → 降级 mid + 零免疫（新手保护）', gate.stdType === 'mid' && gate.stdImmune === false, `type=${gate.stdType} immune=${gate.stdImmune}`);
push('hard 档兜底刷 elemental 带免疫雷', gate.fbType === 'elemental' && gate.fbImmune === true, `type=${gate.fbType} immune=${gate.fbImmune}`);

// ── 5) 全屏元素风暴 ──
const storm = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const { getDifficulty } = await import('/src/config/GameConfig.js');
  gs.difficultyCfg = getDifficulty('standard');

  // 布 3 只普通敌机挂三元素（用 mid：hp60 > 风暴伤害50，保证存活以便断言清元素状态；
  // 若用 hp20 的 small 会被风暴打死进入 _dying，清元素循环按活性守卫跳过死敌属预期）
  const a = gs.spawnEnemy(160, 160, 'mid', 'straight');
  const b = gs.spawnEnemy(270, 180, 'mid', 'straight');
  const c = gs.spawnEnemy(380, 200, 'mid', 'straight');
  a.applyElement('fire'); b.applyElement('ice'); c.applyElement('thunder');

  // 活性守卫（在风暴清状态之前验证）：死亡演出中敌机残留 _elem 不计入三元素判定
  const now0 = gs.time.now;
  a._dying = true;
  const withDead = gs._checkStormTrigger(now0);    // fire 被 _dying 排除 → 应 false
  a._dying = false;
  const liveTrigger = gs._checkStormTrigger(now0); // 三元素齐活 → 应 true

  // 造 2 颗敌弹
  const b1 = gs.enemyBullets.get(100, 100, 'bullet_enemy'); b1.setActive(true).setVisible(true);
  const b2 = gs.enemyBullets.get(200, 100, 'bullet_enemy'); b2.setActive(true).setVisible(true);
  const bulletsBefore = gs.enemyBullets.countActive(true);
  const hpA0 = a.hp;
  const fired = gs.elementStorm();
  const bulletsAfter = gs.enemyBullets.countActive(true);
  const elemA = a._elem, elemB = b._elem, elemC = c._elem;
  const hpA1 = a.hp;
  const firedAgain = gs.elementStorm();   // STORM_CD 内第二次应 false

  a.recycle(); b.recycle(); c.recycle();
  if (b1.active) b1.destroy(); if (b2.active) b2.destroy();
  return {
    withDead, liveTrigger, bulletsBefore, fired, bulletsAfter,
    elemA, elemB, elemC, hpA0, hpA1, firedAgain,
  };
});
push('活性守卫：死亡演出中敌机（_dying 残留 _elem）不计入三元素判定', storm.withDead === false);
push('三元素同挂（无死敌）→ _checkStormTrigger=true', storm.liveTrigger === true);
push('elementStorm 触发：清敌弹 + 非元素穿透伤害 + 清元素状态',
  storm.fired === true && storm.bulletsAfter === 0
    && storm.hpA1 < storm.hpA0
    && storm.elemA === null && storm.elemB === null && storm.elemC === null,
  `bullets ${storm.bulletsBefore}→${storm.bulletsAfter} hpA ${storm.hpA0}→${storm.hpA1} elems=${storm.elemA}/${storm.elemB}/${storm.elemC}`);
push('风暴 STORM_CD=15s：连续第二次返回 false（防连环触发）', storm.firedAgain === false);

// 全链路零 pageerror / console.error
push('零 pageerror / console error', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n==== B14 探针结果：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join(' ; '));
  process.exit(1);
}
