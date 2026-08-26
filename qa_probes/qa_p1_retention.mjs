// qa_p1_retention.mjs —— P1 留存系统组四件验收探针（深空爬塔 / 每日任务扩展+活跃宝箱 / 回归激励 / 社交排行）
//
// 验证：
//   A) 深空爬塔（无尽升级）
//      1) TOWER/TOWER_BUFFS 配置（每 10 波 Boss、6 种增益）
//      2) endless 分支：isTower / WaveSystem.endlessBossEvery=10 / awaitBuff=true
//      3) 每 10 波 Boss：推进到第 10 波 → 弹 Boss（bossKey 按层数轮换 4 Boss）
//      4) Boss 击破 → 层数 +1 + towerTop 存档 + 3 选 1 增益面板弹出
//      5) 3 选 1：rollTowerBuffOptions 抽 3 个不重复 + 选择后应用增益 + 波次继续
//      6) ResultScene 无尽结算显示「爬塔层数」
//   B) 每日任务扩展 + 活跃宝箱
//      7) DAILY_QUEST_POOL 扩至 10 条 / DAILY_QUEST_PICK=4 / 每日抽 4 条
//      8) 新钩子（grazes/modules/clears 等）累计进度
//      9) 全清奖励（claimDailyQuests 含 bonus）
//     10) 活跃宝箱：addDailyAct 计数 / claimDailyChest(3)/(5) 发金币+模块 / 阈值不足与重复领取拒绝
//   C) 回归激励
//     11) 断签 ≥3 天触发（getReturnGiftStatus.due）/ 领后 7 天冷却
//     12) claimReturnGift：金币 500 + 随机模块 + returnGift.grantedAt
//     13) MenuScene 自动弹回归礼包面板（断签状态重进菜单）
//   D) 签到 7 日循环 + 补签
//     14) 第 1 天 50 金币 / 第 7 天大奖 800 金币（僚机未满级 +1）
//     15) 补签：断签消耗 100 金币保留连签（makeupCheckIn）
//   E) 社交排行（本地 Top10）+ 成绩分享卡
//     16) addTopScore 按分降序 / 最多 10 条 / 返回名次
//     17) ResultScene 结算页显示入榜名次（历史排行榜 行）
//     18) 成绩分享卡：buildShareCard 生成 canvas + 文本摘要 + downloadShareCard
//   F) 零 pageerror / console error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 进入指定模式的一局（复用同一 page，重启场景） */
async function startGame(page, mode = 'normal', levelId = 1) {
  await page.evaluate(({ mode, levelId }) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode, levelId });
  }, { mode, levelId });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
  }, { timeout: 20000 });
}

/** 递归收集某场景渲染出的全部 Text 文本 */
async function collectTexts(page, sceneKey) {
  return page.evaluate((key) => {
    const s = window.__SKY__.scene.getScene(key);
    const out = [];
    const walk = (list) => list.forEach((c) => {
      if (c && c.type === 'Text') out.push(c.text);
      if (c && c.list && c.list.length) walk(c.list);
    });
    walk(s.children.list);
    return out;
  }, sceneKey);
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

// ══════════════════════════════════════════════════════════════
// A) 深空爬塔（无尽升级）
// ══════════════════════════════════════════════════════════════
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  return {
    tower: gc.TOWER,
    buffs: gc.TOWER_BUFFS,
    poolLen: gc.DAILY_QUEST_POOL.length,
    pick: gc.DAILY_QUEST_PICK,
    allClear: gc.DAILY_QUEST_ALL_CLEAR_BONUS,
    checkinRewards: gc.CHECKIN_REWARDS,
    makeupCost: gc.CHECKIN_MAKEUP_COST,
    returnGift: gc.RETURN_GIFT,
    activeChest: gc.ACTIVE_CHEST,
  };
});
push('TOWER.BOSS_EVERY = 10', cfg.tower && cfg.tower.BOSS_EVERY === 10, `BOSS_EVERY=${cfg.tower && cfg.tower.BOSS_EVERY}`);
push('TOWER_BUFFS 含 6 种增益', Array.isArray(cfg.buffs) && cfg.buffs.length === 6, `n=${cfg.buffs && cfg.buffs.length}`);
push('每日任务池扩至 10 条', cfg.poolLen === 10, `pool=${cfg.poolLen}`);
push('每日随机抽 4 条（DAILY_QUEST_PICK=4）', cfg.pick === 4, `pick=${cfg.pick}`);
push('全清奖励配置存在（>=50）', cfg.allClear >= 50, `bonus=${cfg.allClear}`);
push('签到 7 日循环奖励（第 7 天 800）',
  Array.isArray(cfg.checkinRewards) && cfg.checkinRewards.length === 7 && cfg.checkinRewards[6] === 800,
  cfg.checkinRewards && cfg.checkinRewards.join(','));
push('补签花费 100 金币', cfg.makeupCost === 100, `cost=${cfg.makeupCost}`);
push('回归礼包配置（断签3天 / 500金币 / 7天冷却）',
  cfg.returnGift && cfg.returnGift.MISS_DAYS === 3 && cfg.returnGift.COINS === 500 && cfg.returnGift.COOLDOWN_DAYS === 7,
  JSON.stringify(cfg.returnGift));
push('活跃宝箱阈值 [3,5]', Array.isArray(cfg.activeChest && cfg.activeChest.THRESHOLDS)
  && cfg.activeChest.THRESHOLDS[0] === 3 && cfg.activeChest.THRESHOLDS[1] === 5,
  JSON.stringify(cfg.activeChest && cfg.activeChest.THRESHOLDS));

// 进入无尽爬塔
await startGame(page, 'endless');
const towerEnter = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  return {
    mode: gs.mode,
    isTower: gs.isTower === true,
    bossEvery: ws ? ws.endlessBossEvery : 0,
    awaitBuff: ws ? ws.awaitBuff : false,
    endless: ws ? ws.endless : false,
    hasBoss: !!gs.boss,
  };
});
push('endless：isTower=true', towerEnter.isTower === true);
push('endless：WaveSystem.endlessBossEvery=10', towerEnter.bossEvery === 10, `bossEvery=${towerEnter.bossEvery}`);
push('endless：WaveSystem.awaitBuff=true', towerEnter.awaitBuff === true);
push('endless：仍为无尽循环（endless=true）', towerEnter.endless === true);
push('endless：开局无 Boss', towerEnter.hasBoss === false);

// 每 10 波 Boss：从第 8 波推进 → 第 9 波无 Boss、第 10 波触发 Boss（层数 1 = boss_sentinel）
const towerBoss = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  // 清掉可能残留的 boss（防御）
  if (gs.boss) { gs.boss.destroy(); gs.boss = null; }
  ws.currentWave = 8;
  ws.startNextWave(); // → wave 9（普通波）
  const before = { wave: ws.currentWave, hasBoss: !!gs.boss, state: ws.state };
  ws.startNextWave(); // → wave 10 = Boss 波
  return {
    before,
    after: { wave: ws.currentWave, hasBoss: !!gs.boss, state: ws.state },
    bossKey: gs.boss ? gs.boss.bossKey : null,
  };
});
push('第 10 波前无 Boss（wave 9）', towerBoss.before.hasBoss === false && towerBoss.before.wave === 9, `wave=${towerBoss.before.wave}`);
push('第 10 波触发 Boss 波（state=boss + 生成 Boss）',
  towerBoss.after.wave === 10 && towerBoss.after.state === 'boss' && towerBoss.after.hasBoss === true,
  `wave=${towerBoss.after.wave} state=${towerBoss.after.state}`);
push('第 1 层 Boss = boss_sentinel（BOSS_RUSH 轮换）', towerBoss.bossKey === 'boss_sentinel', towerBoss.bossKey);

// 第 2 层轮换：从第 19 波推进 → 第 20 波 Boss = boss_crusher
const towerBoss2 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  if (gs.boss) { gs.boss.destroy(); gs.boss = null; }
  gs.towerFloor = 1; // 模拟第 1 层已击破
  ws.currentWave = 19;
  ws.startNextWave(); // → wave 20 = Boss 波（层 2）
  return { wave: ws.currentWave, bossKey: gs.boss ? gs.boss.bossKey : null, floor: ws.currentWave / 10 };
});
push('第 20 波（层 2）Boss 轮换 = boss_crusher', towerBoss2.bossKey === 'boss_crusher', towerBoss2.bossKey);

// Boss 击破 → 层数 +1 + towerTop 存档 + 3 选 1 增益面板（复用 spawnBoss 的 BOSS_DEFEATED 链路）
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  // 跳过 Boss 2s 入场无敌（_entering），直接击破
  if (gs.boss) {
    gs.boss._entering = false;
    if (gs.boss.active) gs.boss.hit(99999999);
  }
});
await sleep(1500); // 等待 1200ms delayedCall 弹面板
const towerDefeat = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    floor: gs.towerFloor,
    towerTop: window.__SAVE.getTowerTop(),
    buffOpen: gs._towerBuffOpen === true,
    opts: gs._towerBuffCtl ? gs._towerBuffCtl.opts : [],
    bossCleared: !gs.boss,
    waveState: gs.waves ? gs.waves.state : null,
  };
});
push('Boss 击破：层数 +1（towerFloor 1→2）', towerDefeat.floor === 2, `floor=${towerDefeat.floor}`);
push('Boss 击破：towerTop 存档更新（>=2）', towerDefeat.towerTop >= 2, `towerTop=${towerDefeat.towerTop}`);
push('Boss 击破：3 选 1 增益面板弹出（_towerBuffOpen=true）', towerDefeat.buffOpen === true);
push('Boss 击破：面板 3 个选项不重复',
  Array.isArray(towerDefeat.opts) && towerDefeat.opts.length === 3
  && new Set(towerDefeat.opts.map((o) => o.id)).size === 3,
  (towerDefeat.opts || []).map((o) => o.id).join(','));
push('Boss 击破：波次系统回 idle（等增益后推进）', towerDefeat.waveState === 'idle', `state=${towerDefeat.waveState}`);

// 选择增益（fireRate → 射速 +10% = fireInterval ×0.9）+ 波次继续
const buffPick = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const beforeFire = gs.player.fireInterval;
  const ctl = gs._towerBuffCtl;
  const picked = 'fireRate';
  if (ctl && ctl.finish) ctl.finish(picked);
  return { picked, beforeFire, fireMul: gs.player.fireMul, afterFire: gs.player.fireInterval, buffClosed: !gs._towerBuffOpen };
});
push('选择增益后面板关闭（_towerBuffOpen=false）', buffPick.buffClosed === true);
push('fireRate 增益生效（fireInterval ×0.9）',
  buffPick.fireMul === 0.9 && Math.abs(buffPick.afterFire - Math.round(buffPick.beforeFire * 0.9)) <= 1,
  `${buffPick.beforeFire} → ${buffPick.afterFire} (fireMul=${buffPick.fireMul})`);
await sleep(1500); // 等待 continueAfterWave 的 1200ms 延迟推进下一波
const waveAfter = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { wave: gs.waves ? gs.waves.currentWave : 0, state: gs.waves ? gs.waves.state : null };
});
push('增益选择后波次继续推进（wave 20 → 21）', waveAfter.wave === 21, `wave=${waveAfter.wave} state=${waveAfter.state}`);

// rollTowerBuffOptions 独立校验：抽 3 个不重复
const roll = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const a = gs.rollTowerBuffOptions();
  const b = gs.rollTowerBuffOptions();
  const ok = a.length === 3 && b.length === 3
    && new Set(a.map((x) => x.id)).size === 3 && new Set(b.map((x) => x.id)).size === 3;
  return { ok, a: a.map((x) => x.id).join(','), b: b.map((x) => x.id).join(',') };
});
push('rollTowerBuffOptions 抽 3 个不重复（两次采样）', roll.ok, `a=[${roll.a}] b=[${roll.b}]`);

// 无尽结算显示爬塔层数（towerFloor / towerTop / isNewTowerTop 透传）
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  // 纯净版：避免无尽命尽弹「看广告复活」面板，直接走 endGame
  window.__SAVE.set('noAds', true);
  gs.lives = 1;
  gs.towerFloor = 3; // 模拟本次已爬 3 层
  gs.player.invulnUntil = 0;
  gs.player.shield = 0;
  gs.player.takeDamage(99999);
});
await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive();
}, { timeout: 20000 });
const rsTower = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  const r = rs.result;
  const texts = [];
  const walk = (list) => list.forEach((c) => {
    if (c && c.type === 'Text') texts.push(c.text);
    if (c && c.list && c.list.length) walk(c.list);
  });
  walk(rs.children.list);
  return { mode: r.mode, towerFloor: r.towerFloor, towerTop: r.towerTop, isNewTowerTop: !!r.isNewTowerTop, texts };
});
push('无尽结算：result.towerFloor=3 透传', rsTower.towerFloor === 3, `floor=${rsTower.towerFloor}`);
push('无尽结算：result.towerTop>=3', rsTower.towerTop >= 3, `top=${rsTower.towerTop}`);
push('无尽结算：显示「爬塔层数」行', rsTower.texts.some((t) => t.includes('爬塔层数')), (rsTower.texts.find((t) => t.includes('爬塔层数')) || '').slice(0, 30));

// ══════════════════════════════════════════════════════════════
// B) 每日任务扩展 + 活跃宝箱
// ══════════════════════════════════════════════════════════════
const dq = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.dailyQuest = { date: '', claimed: false, progress: {}, picked: [] }; // 强制刷新
  const q = S.getDailyQuests();
  const metricsInPool = q.every((x) => S._dailySeed ? true : true); // 占位
  return {
    n: q.length,
    metrics: q.map((x) => x.metric),
    allHasDescReward: q.every((x) => x.desc && x.reward > 0),
    claimed: S.dailyQuestsClaimed(),
  };
});
push('每日任务：当天抽 4 条', dq.n === 4, `n=${dq.n}`);
push('每日任务：每条含 desc/reward', dq.allHasDescReward === true);
push('每日任务：初始未领取', dq.claimed === false);

// 新钩子：grazes / modules 累计进度（强制 picked 含新指标；date 设为今天避免 addDailyProgress 重新抽任务）
const dqHook = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.dailyQuest = { date: S._todayStr(), claimed: false, progress: {}, picked: ['grazes', 'modules', 'clears', 'kills'] };
  S.save();
  S.addDailyProgress('grazes', 4);
  S.addDailyProgress('modules', 1);
  const q = S.getDailyQuests();
  const grazes = q.find((x) => x.metric === 'grazes');
  const modules = q.find((x) => x.metric === 'modules');
  return { grazesProg: grazes ? grazes.progress : -1, modulesProg: modules ? modules.progress : -1, modulesDone: modules ? modules.done : false };
});
push('每日任务：擦弹钩子（grazes +4）', dqHook.grazesProg === 4, `grazes=${dqHook.grazesProg}`);
push('每日任务：模块钩子（modules +1 done）', dqHook.modulesProg === 1 && dqHook.modulesDone === true, `modules=${dqHook.modulesProg}`);

// 全清奖励：全部完成后领取 = 单条金币之和 + bonus
const dqClaim = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.dailyQuest = { date: '', claimed: false, progress: {}, picked: ['grazes', 'modules', 'clears', 'kills'] };
  S.save();
  const q = S.getDailyQuests();
  q.forEach((x) => S.addDailyProgress(x.metric, x.target));
  const coinsBefore = S.load().coins;
  const res = S.claimDailyQuests();
  const delta = S.load().coins - coinsBefore;
  const base = q.reduce((sum, x) => sum + x.reward, 0);
  return { res, delta, base };
});
push('每日任务：全清领取成功（count=4）', dqClaim.res.claimed === true && dqClaim.res.count === 4, `count=${dqClaim.res.count}`);
push('每日任务：全清奖励 = 单条金币之和 + bonus',
  dqClaim.delta === dqClaim.base + (dqClaim.res.bonus || 0),
  `delta=${dqClaim.delta} base=${dqClaim.base} bonus=${dqClaim.res.bonus}`);

// 活跃宝箱：addDailyAct 计数 + claimDailyChest
const chest = await page.evaluate(() => {
  const S = window.__SAVE;
  S.set('dailyActs', { date: '', count: 0, chests: { 3: false, 5: false } });
  S.addDailyAct(); S.addDailyAct(); S.addDailyAct();
  const after3 = S.getDailyActs();
  const invBefore = S.load().moduleInv.length;
  const coinsBefore = S.load().coins;
  const c3 = S.claimDailyChest(3);
  const c3again = S.claimDailyChest(3); // 重复领取
  const c5 = S.claimDailyChest(5); // 只玩 3 局，5 局未达
  const after = S.load();
  return {
    count: after3.count,
    c3,
    c3again,
    c5,
    coinDelta: after.coins - coinsBefore,
    moduleDelta: after.moduleInv.length - invBefore,
  };
});
push('活跃宝箱：当日游玩 3 局计数', chest.count === 3, `count=${chest.count}`);
push('活跃宝箱：第 3 局宝箱可开（金币+模块）',
  chest.c3.claimed === true && chest.c3.coins > 0 && chest.moduleDelta >= 1,
  `coins=${chest.c3.coins} moduleDelta=${chest.moduleDelta}`);
push('活跃宝箱：第 3 局重复领取被拒', chest.c3again.claimed === false && chest.c3again.reason === 'claimed');
push('活跃宝箱：第 5 局未达阈值被拒（not-enough）', chest.c5.claimed === false && chest.c5.reason === 'not-enough');

// 跨天重置：dailyActs date 改昨天 → 计数与宝箱重置
const chestReset = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  const y = new Date(Date.now() - 86400000);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  s.dailyActs = { date: yStr, count: 7, chests: { 3: true, 5: true } };
  S.save();
  const a = S.getDailyActs();
  return { count: a.count, c3: a.chests[3], c5: a.chests[5] };
});
push('活跃宝箱：跨天自动重置（count=0 / chests 复位）',
  chestReset.count === 0 && chestReset.c3 === false && chestReset.c5 === false,
  `count=${chestReset.count}`);

// ══════════════════════════════════════════════════════════════
// C) 回归激励
// ══════════════════════════════════════════════════════════════
const returnGift = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  const d = new Date(Date.now() - 5 * 86400000);
  s.lastCheckin = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.returnGift = null;
  S.save();
  const st = S.getReturnGiftStatus();
  const coinsBefore = S.load().coins;
  const claim = S.claimReturnGift();
  const after = S.load();
  const st2 = S.getReturnGiftStatus();
  return {
    due: st.due, missDays: st.missDays,
    claim: { claimed: claim.claimed, coins: claim.coins, module: claim.module },
    coinDelta: after.coins - coinsBefore,
    grantedAt: after.returnGift ? after.returnGift.grantedAt : null,
    dueAfter: st2.due,
  };
});
push('回归礼包：断签 5 天 → due=true', returnGift.due === true, `missDays=${returnGift.missDays}`);
push('回归礼包：领取成功（金币 500 + 随机模块）',
  returnGift.claim.claimed === true && returnGift.coinDelta === 500 && !!returnGift.claim.module,
  `coins=+${returnGift.coinDelta} module=${returnGift.claim.module}`);
push('回归礼包：领取后记 grantedAt', !!returnGift.grantedAt, returnGift.grantedAt);
push('回归礼包：领取后 7 天冷却（due=false）', returnGift.dueAfter === false);

// 断签不足 3 天不触发
const returnGiftNo = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  const d = new Date(Date.now() - 1 * 86400000);
  s.lastCheckin = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.returnGift = null;
  S.save();
  return S.getReturnGiftStatus().due;
});
push('回归礼包：断签 1 天不触发', returnGiftNo === false);

// MenuScene 断签自动弹回归礼包（真实渲染路径）
await page.evaluate(() => {
  const g = window.__SKY__;
  ['ResultScene', 'GameScene', 'UIScene'].forEach((k) => { const s = g.scene.getScene(k); if (s && s.scene.isActive()) g.scene.stop(k); });
  const S = window.__SAVE;
  const s = S.load();
  const d = new Date(Date.now() - 4 * 86400000);
  s.lastCheckin = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.returnGift = null;
  S.save();
  g.scene.start('MenuScene');
});
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });
await sleep(800); // 等待 450ms delayedCall 弹回归礼包
const rgPopup = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const open = ms.returnGiftOpen === true && !!ms.returnGiftOverlay;
  const texts = [];
  const walk = (list) => list.forEach((c) => {
    if (c && c.type === 'Text') texts.push(c.text);
    if (c && c.list && c.list.length) walk(c.list);
  });
  walk(ms.children.list);
  ms.closeReturnGift();
  return { open, hasTitle: texts.some((t) => t.includes('回归礼包')) };
});
push('MenuScene：断签 ≥3 天自动弹「回归礼包」面板', rgPopup.open === true && rgPopup.hasTitle === true);

// ══════════════════════════════════════════════════════════════
// D) 签到 7 日循环 + 补签
// ══════════════════════════════════════════════════════════════
const checkin = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.lastCheckin = ''; s.checkinStreak = 0; s.coins = 0;
  S.save();
  const c1 = S.checkIn(); // 第 1 天
  const coins1 = S.load().coins;
  // 第 7 天大奖：lastCheckin=昨天、streak=6 → checkIn → day 7
  const y = new Date(Date.now() - 86400000);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  s.lastCheckin = yStr; s.checkinStreak = 6; s.coins = 0; s.upgrades.wingman = 0;
  S.save();
  const c7 = S.checkIn();
  const after7 = S.load();
  const cyc = S.getCheckinCycle();
  return {
    c1: { claimed: c1.claimed, day: c1.day, reward: c1.reward, streak: c1.streak, delta: coins1 },
    c7: { claimed: c7.claimed, day: c7.day, reward: c7.reward, wingmanUpgraded: !!c7.wingmanUpgraded, delta: after7.coins, wingman: after7.upgrades.wingman },
    cyc: { day: cyc.day, streak: cyc.streak },
  };
});
push('签到：第 1 天 +50 金币（day=1 / streak=1）',
  checkin.c1.claimed === true && checkin.c1.day === 1 && checkin.c1.reward === 50 && checkin.c1.delta === 50,
  `day=${checkin.c1.day} reward=${checkin.c1.reward} delta=${checkin.c1.delta}`);
push('签到：第 7 天大奖 +800 金币（僚机 +1）',
  checkin.c7.claimed === true && checkin.c7.day === 7 && checkin.c7.reward === 800 && checkin.c7.wingman === 1,
  `day=${checkin.c7.day} reward=${checkin.c7.reward} wingman=${checkin.c7.wingman}`);
push('签到：getCheckinCycle 返回循环（day=1..7）', checkin.cyc.day >= 1 && checkin.cyc.day <= 7, `day=${checkin.cyc.day}`);

// 补签：断签 3 天 → 消耗 100 金币保留连签
const makeup = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  const d = new Date(Date.now() - 3 * 86400000);
  s.lastCheckin = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.checkinStreak = 3; s.coins = 200;
  S.save();
  const before = S.load().coins;
  const mk = S.makeupCheckIn();
  // 立即快照（S.load() 返回同一缓存对象，后续 checkIn 会原地改值，必须先取数）
  const streakAfterMakeup = S.load().checkinStreak;
  const coinsAfterMakeup = S.load().coins;
  const y = new Date(Date.now() - 86400000);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const lastIsYesterday = S.load().lastCheckin === yStr;
  const cyc = S.getCheckinCycle();
  // 补签后再签到 → 延续连签
  const ci = S.checkIn();
  return {
    mk, cost: before - coinsAfterMakeup, streakAfter: streakAfterMakeup, lastIsYesterday,
    ci: { claimed: ci.claimed, streak: ci.streak }, canMakeup: cyc.canMakeup,
  };
});
push('补签：消耗 100 金币 + 连签 +1',
  makeup.mk.claimed === true && makeup.cost === 100 && makeup.streakAfter === 4,
  `cost=${makeup.cost} streak=${makeup.streakAfter}`);
push('补签：lastCheckin 记为昨天（今天可继续签到）', makeup.lastIsYesterday === true);
push('补签后签到延续连签（streak 4→5）', makeup.ci.claimed === true && makeup.ci.streak === 5, `streak=${makeup.ci.streak}`);

// 补签金币不足被拒
const makeupNoCoin = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  const d = new Date(Date.now() - 3 * 86400000);
  s.lastCheckin = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.coins = 10;
  S.save();
  const mk = S.makeupCheckIn();
  return { claimed: mk.claimed, reason: mk.reason };
});
push('补签：金币不足被拒（no-coins）', makeupNoCoin.claimed === false && makeupNoCoin.reason === 'no-coins');

// ══════════════════════════════════════════════════════════════
// E) 社交排行（本地 Top10）+ 成绩分享卡
// ══════════════════════════════════════════════════════════════
const top = await page.evaluate(() => {
  const S = window.__SAVE;
  S.set('topScores', []);
  const r1 = S.addTopScore({ score: 100, levelId: 1, mode: 'normal', date: '2026-01-01' });
  const r2 = S.addTopScore({ score: 500, levelId: 2, mode: 'bossrush', date: '2026-01-02' });
  const r3 = S.addTopScore({ score: 300, levelId: 1, mode: 'endless', date: '2026-01-03' });
  for (let i = 0; i < 12; i++) S.addTopScore({ score: 1000 + i, levelId: 1, mode: 'normal', date: '2026-01-04' });
  const list = S.getTopScores();
  const sorted = list.every((x, i, a) => i === 0 || a[i - 1].score >= x.score);
  return {
    r1: { entered: r1.entered, rank: r1.rank },
    r2: { entered: r2.entered, rank: r2.rank },
    r3: { entered: r3.entered, rank: r3.rank },
    len: list.length, sorted,
    first: list[0] ? list[0].score : 0,
    last: list[list.length - 1] ? list[list.length - 1].score : 0,
  };
});
push('Top10：破纪录插入返回名次（500 分 → 第 1 名）', top.r2.entered === true && top.r2.rank === 1, `rank=${top.r2.rank}`);
push('Top10：最多保留 10 条', top.len === 10, `len=${top.len}`);
push('Top10：按 score 降序', top.sorted === true, `first=${top.first} last=${top.last}`);

// ResultScene 结算页显示入榜名次（历史排行榜 行）
// 当前已在 ResultScene（前文 endless 结算），直接触发一次 endGame 携带 topRank 验证展示
await page.evaluate(() => {
  const g = window.__SKY__;
  ['ResultScene', 'GameScene', 'UIScene'].forEach((k) => { const s = g.scene.getScene(k); if (s && s.scene.isActive()) g.scene.stop(k); });
  window.__SAVE.set('tutorialDone', true);
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.stats = { kills: 5, coins: 3, damageTaken: 0, spawned: 5 };
  gs.score = 12345;
  gs.endGame(true);
});
await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive() && rs.result && rs.result.topRank != null;
}, { timeout: 20000 });
const rsTop = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  const r = rs.result;
  const texts = [];
  const walk = (list) => list.forEach((c) => {
    if (c && c.type === 'Text') texts.push(c.text);
    if (c && c.list && c.list.length) walk(c.list);
  });
  walk(rs.children.list);
  return { topRank: r.topRank, score: r.score, hasLine: texts.some((t) => t.includes('历史排行榜')) };
});
push('ResultScene：endGame 后 topRank 透传（>0 入榜）', rsTop.topRank > 0, `topRank=${rsTop.topRank}`);
push('ResultScene：结算页显示「历史排行榜」行', rsTop.hasLine === true);

// 成绩分享卡（纯本地：canvas 成绩卡 + PNG 下载 + 文本复制）
const share = await page.evaluate(async () => {
  const hook = window.__RESULT_SHARE;
  if (!hook) return { error: 'no hook' };
  const card = hook.buildShareCard();
  const text = hook.getText();
  const dl = hook.downloadShareCard();
  const cp = await hook.copyShareText();
  return {
    cardOk: !!(card && card.getContext && card.width === 540 && card.height === 720),
    textLen: text ? text.length : 0,
    textHasScore: !!text && text.includes('12345'),
    dlOk: dl && dl.ok === true,
    cpOk: cp && (cp.ok === true || cp.ok === false), // 无剪贴板权限时返回 false 但不抛错
    shareBtnText: null,
  };
});
push('分享卡：buildShareCard 生成 540×720 canvas', share.cardOk === true);
push('分享卡：文本摘要含分数', share.textLen > 0 && share.textHasScore === true, `len=${share.textLen}`);
push('分享卡：downloadShareCard 生成 PNG 数据流', share.dlOk === true);
push('分享卡：copyShareText 无异常（返回状态）', share.cpOk === true);

// ══════════════════════════════════════════════════════════════
// F) 零 pageerror / console error
// ══════════════════════════════════════════════════════════════
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 8));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_p1_retention: PASS ===' : '=== qa_p1_retention: FAIL ==='));
process.exit(pass ? 0 : 1);
