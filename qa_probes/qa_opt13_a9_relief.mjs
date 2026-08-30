// qa_opt13_a9_relief.mjs —— OPT-13 批A A9 连续失败救济局 验收探针
//
// 验证：
//   1) RELIEF 配置块（failStreakThreshold=3 / lowerDiff=casual / tempBuffAtk / tempBuffLife /
//      reviveFireBonusMs=2000 / fireBonus=1）
//   2) SaveManager failStreak/reliefRuns 计数辅助（get/inc/reset/incReliefRuns）+ load 深拷贝
//   3) AchievementManager ignore：startRun({ignore})/_checkLive/_checkAll/reportRun(ctx.ignore) 全程抑制解锁
//   4) _shouldRecordPersist：非救济 true / 救济 false
//   5) 触发：normal + failStreak[levelId]>=3 → 面板弹出（_reliefEligible/_reliefCtl/物理暂停）；
//      endless 不触发
//   6) 三选一：拒绝→_reliefRun=false；降低难度→_reliefCombatMul=casual（selectedDifficulty 存档不变）；
//      临时增益→+1 命 或 攻击 +10%（Player.reliefAtkMul）
//   7) Player 复活临时火力 +1 持续 2s（tempFireBonusUntil，powerLevel 不变）
//   8) 救济局内 respawnPlayer → tempFireBonusUntil 置未来
//   9) endGame 拦截清单：不计 topScores/levelStars/achievements/bestScore/每日任务/新手计划；
//      仅 failStreak/reliefRuns 计数；金币照常入账
//  10) 零 pageerror / console error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

async function startGame(page, levelId = 1, mode = 'normal') {
  await page.evaluate(([lid, md]) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: md, levelId: lid });
  }, [levelId, mode]);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active && gs.waves;
  }, { timeout: 20000 });
}

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

// 注意：本探针一律使用 window.__SAVE / window.__ACH__（应用实例）。
// 切勿动态 import() SaveManager/AchievementManager —— Vite HMR 会给应用模块加 ?t= 时间戳，
// 动态 import 裸路径会生成第二份模块实例（各自独立的 session/内存缓存），导致状态断言错位。

// ── 1) RELIEF 配置块 ──
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const r = gc.RELIEF;
  return {
    ok: r && r.failStreakThreshold === 3 && r.lowerDiff === 'casual'
      && r.tempBuffAtk === 0.10 && r.tempBuffLife === 1
      && r.reviveFireBonusMs === 2000 && r.fireBonus === 1,
    f: r.failStreakThreshold, lower: r.lowerDiff, atk: r.tempBuffAtk,
    life: r.tempBuffLife, ms: r.reviveFireBonusMs, fb: r.fireBonus,
  };
});
push('RELIEF 配置块字段齐备（3/casual/0.10/1/2000/1）',
  cfg.ok, `f=${cfg.f} lower=${cfg.lower} atk=${cfg.atk} life=${cfg.life} ms=${cfg.ms} fb=${cfg.fb}`);

// ── 2) SaveManager failStreak / reliefRuns 计数辅助 + load 深拷贝 ──
const sm = await page.evaluate(() => {
  const SaveManager = window.__SAVE;
  const prevFs = JSON.parse(JSON.stringify(SaveManager.get('failStreak') || {}));
  const prevRr = SaveManager.get('reliefRuns');
  SaveManager.set('failStreak', {});
  SaveManager.set('reliefRuns', 0);
  SaveManager.incFailStreak(2);
  SaveManager.incFailStreak(2);
  const mid = SaveManager.getFailStreak(2);
  SaveManager.incFailStreak(3);
  SaveManager.resetFailStreak(2);
  const reset = SaveManager.getFailStreak(2);
  const r3 = SaveManager.getFailStreak(3);
  SaveManager.incReliefRuns();
  SaveManager.incReliefRuns();
  const rr = SaveManager.getReliefRuns();
  // load 深拷贝：写入 failStreak 不应污染 DEFAULT_SAVE 默认对象（reset 后应为空对象）
  SaveManager.set('failStreak', { 9: 1 });
  SaveManager.reset();
  const afterReset = JSON.stringify(SaveManager.get('failStreak'));
  // 还原现场（避免影响后续场景）
  SaveManager.set('failStreak', prevFs);
  SaveManager.set('reliefRuns', prevRr);
  return { mid, reset, r3, rr, afterReset };
});
push('SaveManager 计数辅助（inc×2→2 / reset→0 / 他关独立 / reliefRuns×2）',
  sm.mid === 2 && sm.reset === 0 && sm.r3 === 1 && sm.rr === 2,
  `mid=${sm.mid} reset=${sm.reset} r3=${sm.r3} reliefRuns=${sm.rr}`);
push('load 深拷贝：failStreak 不污染 DEFAULT_SAVE（reset 后为空）', sm.afterReset === '{}', `afterReset=${sm.afterReset}`);

// ── 3) AchievementManager ignore 抑制（用应用实例 window.__ACH__）──
const ach = await page.evaluate(() => {
  const AM = window.__ACH__;
  const SaveManager = window.__SAVE;
  const prevAch = JSON.parse(JSON.stringify(SaveManager.get('achievements') || {}));
  SaveManager.set('achievements', {});
  AM.startRun({ mode: 'normal', levelId: 1, ignore: true }); // 架构规格对象形式
  for (let i = 0; i < 12; i++) AM.reportKill({}); // reportKill 为 void；first_blood 阈值 10，应被 ignore 抑制
  const reportOut = AM.reportRun({ victory: true, mode: 'normal', stars: 3, levelId: 1, damageTaken: 0, ignore: true });
  const firstBlood = SaveManager.hasAchievement('first_blood');
  AM.setIgnore(false);
  AM.startRun('normal', 1);
  SaveManager.set('achievements', prevAch);
  return { reportOut: reportOut.length, firstBlood };
});
push('AchievementManager ignore：live/_checkAll/reportRun 全程抑制解锁',
  ach.reportOut === 0 && ach.firstBlood === false,
  `report=${ach.reportOut} first_blood=${ach.firstBlood}`);

// ── 4/5) 触发 + 面板（normal + failStreak>=3）──
await page.evaluate(() => {
  window.__SAVE.set('failStreak', { 2: 3 });
  window.__SAVE.set('selectedDifficulty', 'standard');
});
await startGame(page, 2, 'normal');
const panel = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    eligible: gs._reliefEligible,
    open: gs._reliefOpen,
    ctl: !!gs._reliefCtl,
    paused: gs.physics.world.isPaused,
    recordPersistBefore: gs._shouldRecordPersist(), // 未接受救济前仍为 true
    ignoreBefore: window.__ACH__.isIgnored(),
  };
});
push('normal + failStreak>=3 → 面板弹出（_reliefEligible/_reliefCtl/物理暂停）',
  panel.eligible === true && panel.open === true && panel.ctl === true && panel.paused === true,
  JSON.stringify(panel));
push('未接受救济前：_shouldRecordPersist()=true / 成就未抑制',
  panel.recordPersistBefore === true && panel.ignoreBefore === false);

// ── 6a) 拒绝 → 非救济局 ──
const decline = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs._reliefCtl.decline();
  return {
    reliefRun: gs._reliefRun,
    open: gs._reliefOpen,
    paused: gs.physics.world.isPaused,
    ignored: window.__ACH__.isIgnored(),
    recordPersist: gs._shouldRecordPersist(),
  };
});
push('拒绝 → 非救济局（_reliefRun=false / 恢复物理 / 成就不抑制 / 照常持久化）',
  decline.reliefRun === false && decline.open === false && decline.paused === false
  && decline.ignored === false && decline.recordPersist === true,
  JSON.stringify(decline));

// ── 6b) 降低难度 → 救济局 + session 覆盖（selectedDifficulty 存档不变）──
await startGame(page, 2, 'normal');  // 重新开局（failStreak 仍 >=3）
const optA = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const savedDiff = window.__SAVE.get('selectedDifficulty');
  gs._reliefCtl.finish('lowerDiff');
  return {
    reliefRun: gs._reliefRun,
    combatId: gs._reliefCombatMul ? gs._reliefCombatMul.id : null,
    combatHp: gs._reliefCombatMul ? gs._reliefCombatMul.hpMul : -1,
    savedDiff,
    ignored: window.__ACH__.isIgnored(),
    recordPersist: gs._shouldRecordPersist(),
    paused: gs.physics.world.isPaused,
  };
});
push('降低难度 → 救济局（_reliefRun=true / 休闲档系数 / selectedDifficulty 不变 / 成就抑制 / 恢复物理）',
  optA.reliefRun === true && optA.combatId === 'casual' && optA.combatHp === 0.7
  && optA.savedDiff === 'standard' && optA.ignored === true
  && optA.recordPersist === false && optA.paused === false,
  JSON.stringify(optA));
// 静态断言：spawnEnemy/spawnBoss 消费 _reliefCombatMul（敌人/Boss 系数按休闲档）
const combatWire = await page.evaluate(async () => {
  const src = await (await fetch('/src/scenes/GameScene.js')).text();
  return src.includes('this._reliefCombatMul || this.difficultyCfg')
    && src.includes('this._reliefCombatMul && this._reliefCombatMul.bossBulletMul');
});
push('静态断言：spawnEnemy/spawnBoss 消费 _reliefCombatMul（敌人/Boss 系数）', combatWire === true);

// ── 6c) 临时增益 +1 命 / +10% 攻击 ──
await startGame(page, 2, 'normal');
const optB = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const before = gs.lives;
  gs._reliefCtl.finish('tempBuff', 'life');
  const life = { lives: gs.lives, reliefRun: gs._reliefRun, atkMul: gs.player.reliefAtkMul, ignored: window.__ACH__.isIgnored() };
  // 新开一局测攻击选项
  return { before, life };
});
await startGame(page, 2, 'normal');
const optB2 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs._reliefCtl.finish('tempBuff', 'atk');
  return { atkMul: gs.player.reliefAtkMul, reliefRun: gs._reliefRun, atkPicked: gs._reliefAtkPicked };
});
push('临时增益 +1 命：lives +1 / 救济局 / 成就抑制',
  optB.life.lives === optB.before + 1 && optB.life.reliefRun === true && optB.life.ignored === true,
  `lives ${optB.before}→${optB.life.lives}`);
push('临时增益 攻击 +10%：Player.reliefAtkMul=1.1 / 救济局',
  Math.abs(optB2.atkMul - 1.1) < 1e-9 && optB2.reliefRun === true && optB2.atkPicked === true,
  `atkMul=${optB2.atkMul}`);

// ── 7) Player 临时火力 +1 持续 2s（powerLevel 不变）──
await startGame(page, 2, 'normal');
const fb = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  const savedFire = p._lastFire;
  p._lastFire = gs.time.now + 100000; // 暂停自动开火，只统计手动 fire()
  p.setPowerLevel(0);
  p.towerExtraShots = 0;
  p.reliefAtkMul = 1;
  const countActive = () => { let n = 0; p.bullets.children.each((b) => { if (b.active) n++; }); return n; };
  const before = countActive();
  p.tempFireBonusUntil = 0;
  p.fire();
  const noBonusDelta = countActive() - before; // 1 主炮
  const before2 = countActive();
  p.tempFireBonusUntil = gs.time.now + 2000;
  p.fire();
  const withBonusDelta = countActive() - before2; // 1 主炮 + 1 临时 = 2
  const powerBefore = p.powerLevel;
  const untilDelta = p.tempFireBonusUntil - gs.time.now;
  p.tempFireBonusUntil = 0;
  p._lastFire = savedFire;
  return { noBonusDelta, withBonusDelta, powerBefore, untilDelta };
});
push('复活临时火力 +1 持续 2s：生效期多发 1 发 / 2s 后恢复 / powerLevel 不变',
  fb.noBonusDelta === 1 && fb.withBonusDelta === 2 && fb.powerBefore === 0
  && fb.untilDelta >= 1900 && fb.untilDelta <= 2100,
  `noBonus=${fb.noBonusDelta} withBonus=${fb.withBonusDelta} power=${fb.powerBefore} untilMs=${fb.untilDelta}`);

// ── 8) 救济局内 respawnPlayer → tempFireBonusUntil 置未来 ──
const rp = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  gs._reliefRun = true;
  p.tempFireBonusUntil = 0;
  gs.respawnPlayer();
  const setFuture = p.tempFireBonusUntil > gs.time.now;
  const powerUnchanged = p.powerLevel === 0;
  gs._reliefRun = false;
  return { setFuture, powerUnchanged, until: p.tempFireBonusUntil, now: gs.time.now };
});
push('救济局 respawnPlayer → tempFireBonusUntil 置未来（powerLevel 不变）',
  rp.setFuture === true && rp.powerUnchanged === true,
  `until-now=${rp.until - rp.now}ms`);

// ── 9) endGame 拦截清单（最后执行：会触发场景切结算）──
const end = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const SaveManager = window.__SAVE;
  SaveManager.set('topScores', []);
  SaveManager.set('bestScore', 0);
  SaveManager.set('achievements', {});
  SaveManager.set('levelStars', {});
  SaveManager.set('levelMedals', {});
  SaveManager.set('failStreak', { 2: 3 });
  SaveManager.set('reliefRuns', 0);
  SaveManager.set('newbiePlan', { day: 1, claimed: {}, progress: {} });
  SaveManager.set('dailyQuest', { date: '2099-01-01', claimed: false, progress: { clears: 0 }, picked: [] });
  gs._reliefRun = true;
  gs.mode = 'normal';
  gs.levelId = 2;
  gs.stats.coins = 100;
  gs.stats.kills = 50;
  gs.stats.spawned = 60;
  gs.stats.damageTaken = 0;
  gs.score = 9999;
  gs.gameEnded = false;
  // 确保结算有金币正差额可验证（coinMul>1 → coinDelta>0 → addCoins 照常入账）
  gs.difficultyCfg = { hpMul: 1.5, speedMul: 1.05, scoreMul: 1.1, coinMul: 1.2 };
  const coinsBefore = SaveManager.get('coins');
  gs.endGame(true);
  const s = SaveManager.load();
  return {
    coinsBefore, coinsAfter: s.coins,
    failStreak2: s.failStreak[2],
    reliefRuns: s.reliefRuns,
    topScores: (s.topScores || []).length,
    bestScore: s.bestScore,
    levelStars2: s.levelStars[2] || 0,
    achievements: Object.keys(s.achievements || {}).length,
    newbieClears: s.newbiePlan.progress.clears || 0,
    dailyClears: s.dailyQuest.progress.clears || 0,
  };
});
push('endGame 拦截：failStreak 归0 / reliefRuns+1 / 金币照常入账',
  end.failStreak2 === 0 && end.reliefRuns === 1 && end.coinsAfter > end.coinsBefore,
  `fs2=${end.failStreak2} reliefRuns=${end.reliefRuns} coins ${end.coinsBefore}→${end.coinsAfter}`);
push('endGame 拦截：不计 topScores/bestScore/levelStars/成就/每日任务/新手计划',
  end.topScores === 0 && end.bestScore === 0 && end.levelStars2 === 0
  && end.achievements === 0 && end.newbieClears === 0 && end.dailyClears === 0,
  `top=${end.topScores} best=${end.bestScore} stars=${end.levelStars2} ach=${end.achievements} newbie=${end.newbieClears} daily=${end.dailyClears}`);
const wiring = await page.evaluate(async () => {
  const src = await (await fetch('/src/scenes/GameScene.js')).text();
  return {
    guard: src.includes('const recordPersist = this._shouldRecordPersist();'),
    fsReset: src.includes('SaveManager.resetFailStreak(this.levelId)'),
    fsInc: src.includes('SaveManager.incFailStreak(this.levelId)'),
    rrInc: src.includes('SaveManager.incReliefRuns()'),
    ignore: src.includes('ignore: !recordPersist'),
    normalGate: src.includes("this.mode === 'normal' && !this._tutorialCtl"),
  };
});
push('静态断言：endGame 拦截清单接线（recordPersist/重置/计数/成就 ignore/normal 触发）',
  wiring.guard && wiring.fsReset && wiring.fsInc && wiring.rrInc && wiring.ignore && wiring.normalGate,
  JSON.stringify(wiring));

// ── 10) 零报错 ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a9_relief: PASS ===' : '=== qa_opt13_a9_relief: FAIL ==='));
process.exit(pass ? 0 : 1);
