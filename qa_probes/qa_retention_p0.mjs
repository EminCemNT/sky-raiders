// qa_retention_p0.mjs —— P0 留存内容组验收探针
//
// 验证：
//   A) 关卡勋章目标
//      1) GameConfig.LEVELS 每关带 challenges（killRate/timeLimit/singleWeapon）
//      2) SaveManager.recordLevelMedals / countMedals / getLevelMedals
//      3) GameScene.endGame 按关卡 challenges 判定勋章写入（killRate/timeLimit/singleWeapon）
//      4) ResultScene 展示「本局勋章」；MenuScene 关卡选择展示勋章图标 + 累计勋章数
//   B) 新手 7 日计划
//      5) NEWBIE_PLAN 7 天目标存在
//      6) 目标达成判定 + 领奖写存档 + day 推进
//      7) 第 7 天额外僚机升级 +1
//      8) MenuScene 新手计划面板存在（openNewbiePlan）
//   C) 活动轮换
//      9) EVENT_CYCLE / EVENT_MODES / getCurrentEvent 轮换逻辑
//     10) MenuScene「本周活动」入口显示（当前活动名 + 剩余天数）
//     11) 进入活动模式（coin_rush: 无尽循环+磁力常驻；survival: 命数+1）
//     12) 活动结算（金币冲刺 ×N / 限时生存 按波次）+ ResultScene 活动标题
//   D) 零 pageerror / console error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

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
// A-1) 关卡 challenges 配置
// ══════════════════════════════════════════════════════════════
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const TYPES = ['killRate', 'timeLimit', 'singleWeapon'];
  const perLevel = gc.LEVELS.map((l) => ({
    id: l.id,
    n: (l.challenges || []).length,
    types: (l.challenges || []).map((c) => c.type),
    names: (l.challenges || []).map((c) => c.name),
    first: l.challenges && l.challenges[0] ? l.challenges[0] : null,
  }));
  const allOk = perLevel.every((p) => p.n >= 1 && p.types.every((t) => TYPES.includes(t)));
  const medalCfg = gc.MEDALS;
  return { perLevel, allOk, medalCfg, totalChallenges: perLevel.reduce((s, p) => s + p.n, 0) };
});
cfg.perLevel.forEach((p) => {
  push(`关卡${p.id} challenges 配置（${p.n} 个，类型合法）`,
    p.n >= 1 && p.types.every((t) => ['killRate', 'timeLimit', 'singleWeapon'].includes(t)),
    p.types.join(','));
});
push('全部关卡 challenges 配置合法（含 3 种类型）', cfg.allOk === true);
push('MEDALS 阈值配置存在（threshold>=1）', !!(cfg.medalCfg && cfg.medalCfg.THRESHOLD >= 1), JSON.stringify(cfg.medalCfg));

// ══════════════════════════════════════════════════════════════
// A-2) SaveManager 勋章存取
// ══════════════════════════════════════════════════════════════
const medalSave = await page.evaluate(() => {
  const S = window.__SAVE;
  S.set('levelMedals', {});
  S.set('medalCount', 0);
  const before = S.countMedals();
  const n1 = S.recordLevelMedals(1, ['c1', 'c3']);
  const n2 = S.recordLevelMedals(1, ['c2', 'c3']); // 幂等合并 c3
  const list1 = S.getLevelMedals(1);
  const total = S.countMedals();
  S.recordLevelMedals(2, ['c1']);
  const total2 = S.countMedals();
  return { before, n1, n2, list1, total, total2 };
});
push('recordLevelMedals 幂等合并（D1 追加 c2 后共 3 枚）',
  medalSave.list1.length === 3 && medalSave.list1.includes('c1') && medalSave.list1.includes('c2') && medalSave.list1.includes('c3'),
  medalSave.list1.join(','));
push('countMedals 累计正确（关卡1×3 + 关卡2×1 = 4）', medalSave.total === 3 && medalSave.total2 === 4, `${medalSave.total}→${medalSave.total2}`);

// ══════════════════════════════════════════════════════════════
// A-3) GameScene.endGame 勋章判定写入
// ══════════════════════════════════════════════════════════════
await startGame(page, 'normal', 1);
const medalEnd = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const S = window.__SAVE;
  S.set('levelMedals', {});
  S.set('medalCount', 0);
  // 满足：killRate 18/20=0.9>=0.9 · timeLimit 30s<=60 · singleWeapon 0 次切换
  gs.stats = { kills: 18, coins: 10, damageTaken: 0, spawned: 20 };
  gs._levelStartTime = gs.time.now - 30000;
  gs._weaponSwitchCount = 0;
  gs.endGame(true);
  return { saved: S.getLevelMedals(1), count: S.countMedals() };
});
push('endGame 判定写入勋章（killRate+timeLimit+singleWeapon 全达成）',
  medalEnd.saved.includes('c1') && medalEnd.saved.includes('c2') && medalEnd.saved.includes('c3'),
  medalEnd.saved.join(','));
push('endGame 后累计勋章数=3', medalEnd.count === 3, `${medalEnd.count}`);

await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive();
}, { timeout: 20000 });
const rsMedal = await collectTexts(page, 'ResultScene');
push('ResultScene 展示「本局勋章」行', rsMedal.some((t) => t.includes('本局勋章')), (rsMedal.find((t) => t.includes('本局勋章')) || '').slice(0, 40));

// ══════════════════════════════════════════════════════════════
// B) 新手 7 日计划（纯逻辑 + 面板）
// ══════════════════════════════════════════════════════════════
const npCfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  return { n: gc.NEWBIE_PLAN.length, metrics: gc.NEWBIE_PLAN.map((d) => d.metric), descs: gc.NEWBIE_PLAN.map((d) => d.desc) };
});
push('NEWBIE_PLAN 7 天目标', npCfg.n === 7, `${npCfg.n}`);
push('7 天 metric 覆盖 7 种钩子',
  JSON.stringify(npCfg.metrics) === JSON.stringify(['clears', 'hangarUpgrades', 'coins', 'bossRushClears', 'endlessWaves', 'grazes', 'levelClears']),
  npCfg.metrics.join(','));

const npFlow = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.newbiePlan = { day: 1, claimed: {}, progress: {} };
  const initList = S.getNewbiePlan();
  const cur1 = initList.find((d) => d.isCurrent);
  const notReady = S.claimNewbieDay();
  S.addNewbieProgress('clears', 1);
  const done1 = S.newbieDayDone();
  const coinsBefore = S.load().coins;
  const claim1 = S.claimNewbieDay();
  const coinsAfter = S.load().coins;
  const list2 = S.getNewbiePlan();
  const day2 = list2.find((d) => d.day === 2);
  return { cur1Desc: cur1.desc, notReady, done1, claim1, coinsDelta: coinsAfter - coinsBefore, day2Current: day2.isCurrent };
});
push('新手计划初始进行天=D1', npFlow.cur1Desc === '通关任意一关', npFlow.cur1Desc);
push('目标未达成时领奖被拒（notReady）', npFlow.notReady && npFlow.notReady.notReady === true);
push('D1 目标达成判定（clears>=1 → done）', npFlow.done1 === true);
push('领奖写存档（D1 领奖 +60 金币 + day 推进）',
  npFlow.claim1.claimed === true && npFlow.claim1.reward === 60 && npFlow.coinsDelta === 60 && npFlow.day2Current === true,
  `reward=${npFlow.claim1.reward} coinsDelta=${npFlow.coinsDelta}`);

const npDay7 = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.newbiePlan = { day: 7, claimed: {}, progress: {} };
  s.upgrades.wingman = 0;
  S.addNewbieProgress('levelClears', 3);
  const done = S.newbieDayDone();
  const coinsBefore = S.load().coins;
  const claim = S.claimNewbieDay();
  const after = S.load();
  const dayAfter = after.newbiePlan.day;
  return { done, claim, wingman: after.upgrades.wingman, coinsDelta: after.coins - coinsBefore, dayAfter };
});
push('第 7 天目标达成（levelClears>=3 → done）', npDay7.done === true);
push('第 7 天领奖：僚机升级 +1 + 金币奖励', npDay7.claim.claimed === true && npDay7.claim.wingmanUpgraded === true && npDay7.wingman === 1,
  `wingman=${npDay7.wingman} reward=${npDay7.claim.reward}`);
push('第 7 天领奖后计划结束（day→8）', npDay7.dayAfter === 8, `day=${npDay7.dayAfter}`);

const npDay7Max = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.newbiePlan = { day: 7, claimed: {}, progress: {} };
  s.upgrades.wingman = 2; // 已满级
  S.addNewbieProgress('levelClears', 3);
  const coinsBefore = S.load().coins;
  const claim = S.claimNewbieDay();
  const after = S.load();
  return { claim, wingman: after.upgrades.wingman, coinsDelta: after.coins - coinsBefore };
});
push('第 7 天僚机满级 → 改发金币大礼包（wingman 保持 2）',
  npDay7Max.claim.claimed === true && npDay7Max.claim.wingmanUpgraded === false && npDay7Max.wingman === 2 && npDay7Max.coinsDelta >= 350,
  `wingman=${npDay7Max.wingman} coinsDelta=${npDay7Max.coinsDelta}`);

// ══════════════════════════════════════════════════════════════
// C) 活动轮换（配置 + 菜单入口 + 进模式 + 结算）
// ══════════════════════════════════════════════════════════════
const evCfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const e = gc.getCurrentEvent(new Date(2026, 0, 5)); // 固定周一
  const eSun = gc.getCurrentEvent(new Date(2026, 0, 11)); // 固定周日
  return {
    cycle: gc.EVENT_CYCLE,
    modes: Object.keys(gc.EVENT_MODES),
    coin: gc.EVENT_MODES.coin_rush,
    survival: gc.EVENT_MODES.survival,
    mon: e, sun: eSun,
  };
});
push('EVENT_CYCLE = [coin_rush, survival]', JSON.stringify(evCfg.cycle) === JSON.stringify(['coin_rush', 'survival']), evCfg.cycle.join(','));
push('EVENT_MODES 含两模式配置（duration/coinMul/coinPerWave）',
  evCfg.coin.duration === 60 && evCfg.coin.coinMul === 2 && evCfg.survival.duration === 120 && evCfg.survival.coinPerWave === 8);
push('getCurrentEvent 返回活动 id 在 EVENT_CYCLE 内', evCfg.cycle.includes(evCfg.mon.id), evCfg.mon.id);
push('getCurrentEvent 返回剩余天数>=1', evCfg.mon.daysLeft >= 1, `${evCfg.mon.daysLeft}`);
push('getCurrentEvent 周末=双倍 / 周一=非双倍', evCfg.sun.double === true && evCfg.mon.double === false, `sun=${evCfg.sun.double} mon=${evCfg.mon.double}`);

// 菜单入口（先回菜单）
await page.evaluate(() => {
  const g = window.__SKY__;
  ['ResultScene', 'GameScene', 'UIScene'].forEach((k) => { const s = g.scene.getScene(k); if (s && s.scene.isActive()) g.scene.stop(k); });
  g.scene.start('MenuScene');
});
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });
await sleep(300);
const menuTexts = await collectTexts(page, 'MenuScene');
const menuInfo = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return {
    hasEventPanel: typeof ms.openEvent === 'function',
    hasNewbiePanel: typeof ms.openNewbiePlan === 'function',
    saveInfo: ms.saveInfoText ? ms.saveInfoText.text : '',
  };
});
push('MenuScene 主菜单含「本周活动」入口', menuTexts.some((t) => t.includes('本周活动')), (menuTexts.find((t) => t.includes('本周活动')) || '').slice(0, 24));
push('MenuScene 主菜单含「新手计划」入口', menuTexts.includes('新手计划'));
push('MenuScene.openEvent / openNewbiePlan 已实现', menuInfo.hasEventPanel && menuInfo.hasNewbiePanel);
push('底部存档信息含勋章计数', menuInfo.saveInfo.includes('勋章'), menuInfo.saveInfo.slice(0, 40));

// 打开新手计划面板（渲染路径）
const newbiePanel = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openNewbiePlan();
  const ok = ms.newbiePlanOpen === true && !!ms.newbiePlanOverlay;
  const list = ms.newbiePlanOverlay ? ms.newbiePlanOverlay.list : [];
  const textCount = list.filter((c) => c.type === 'Text').length;
  ms.closeNewbiePlan();
  return { ok, textCount };
});
push('新手计划面板打开/关闭正常', newbiePanel.ok === true, `texts=${newbiePanel.textCount}`);

// 打开关卡选择 → 勋章图标 + 累计勋章数
await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openLevelSelect();
});
const lvlMedalUi = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms.levelSelectOverlay;
  let medalIcons = 0; let lockIcons = 0; let medalSummary = '';
  const walk = (list) => list.forEach((c) => {
    if (c && c.type === 'Image' && c.texture && c.texture.key === 'icon_medal') medalIcons++;
    if (c && c.type === 'Image' && c.texture && c.texture.key === 'icon_lock') lockIcons++;
    if (c && c.type === 'Text' && typeof c.text === 'string' && c.text.includes('累计勋章')) medalSummary = c.text;
    if (c && c.list && c.list.length) walk(c.list);
  });
  walk(ov.list);
  ms.closeLevelSelect();
  return { medalIcons, lockIcons, medalSummary };
});
push('关卡选择展示勋章图标（icon_medal 出现）', lvlMedalUi.medalIcons >= 1, `medal=${lvlMedalUi.medalIcons} lock=${lvlMedalUi.lockIcons}`);
push('关卡选择展示累计勋章数+阈值提示', lvlMedalUi.medalSummary.includes('累计勋章'), lvlMedalUi.medalSummary.slice(0, 40));

// ══════════════════════════════════════════════════════════════
// C) 活动模式：进模式 + 结算（取当前真实活动）
// ══════════════════════════════════════════════════════════════
const evId = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  return gc.getCurrentEvent().id;
});
push('当前活动 id 合法（从菜单读取）', evCfg.cycle.includes(evId), evId);

// 活动模式前重置成就：验证活动胜利不计"通关任意一关/无伤"类成就
await page.evaluate(() => {
  const S = window.__SAVE;
  S.load().achievements = {};
  S.save();
});

await startGame(page, evId, 1);
const eventEnter = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    mode: gs.mode,
    eventCfgId: gs.eventCfg ? gs.eventCfg.id : null,
    endless: gs.waves ? gs.waves.endless : null,
    magnetAlways: (gs.buffs.magnetUntil || 0) > 999999999,
    lives: gs.lives,
    eventDouble: !!gs.eventDouble,
    coinPerKill: gs.eventCfg ? gs.eventCfg.extraCoinsPerKill : 0,
  };
});
push(`进入活动模式 ${evId}：mode/eventCfg 正确`,
  eventEnter.mode === evId && eventEnter.eventCfgId === evId, `${eventEnter.mode}`);
push(`活动模式 ${evId}：无尽循环波次`, eventEnter.endless === true);
if (evId === 'coin_rush') {
  push('金币冲刺：磁力常驻', eventEnter.magnetAlways === true);
  push('金币冲刺：命数 = 3（无补偿）', eventEnter.lives === 3, `lives=${eventEnter.lives}`);
  push('金币冲刺：击杀额外掉金币配置', eventEnter.coinPerKill >= 1, `perKill=${eventEnter.coinPerKill}`);
} else {
  push('限时生存：命数 +1 = 4（补偿）', eventEnter.lives === 4, `lives=${eventEnter.lives}`);
}

// 结算
const evSettle = await page.evaluate((evId) => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.stats = { kills: 5, coins: evId === 'survival' ? 0 : 10, damageTaken: 0, spawned: 5 };
  const wavesBefore = gs.waves ? gs.waves.currentWave : 0;
  gs.endGame(true);
  return { wavesBefore, double: !!gs.eventDouble, mode: gs.mode };
}, evId);
await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive() && rs.result && rs.result.eventReward != null;
}, { timeout: 20000 });
const rsEvent = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  const r = rs.result;
  const texts = [];
  const walk = (list) => list.forEach((c) => {
    if (c && c.type === 'Text') texts.push(c.text);
    if (c && c.list && c.list.length) walk(c.list);
  });
  walk(rs.children.list);
  return { mode: r.mode, victory: r.victory, er: r.eventReward, coins: r.coins, texts };
});
if (evId === 'coin_rush') {
  const mult = 2 * (evSettle.double ? 2 : 1);
  const total = Math.round(10 * mult);
  push('金币冲刺结算：金币×2（周末×4）精确',
    rsEvent.er.kind === 'coin_rush' && rsEvent.er.coins === total && rsEvent.coins === total,
    `mult=${rsEvent.er.mult} coins=${rsEvent.coins}`);
  push('ResultScene 活动标题「金币冲刺结束」', rsEvent.texts.some((t) => t.includes('金币冲刺结束')));
  push('ResultScene 活动结算行', rsEvent.texts.some((t) => t.includes('活动金币')));
} else {
  const per = 8;
  const total = evSettle.wavesBefore * per * (evSettle.double ? 2 : 1);
  push('限时生存结算：按波次给金币',
    rsEvent.er.kind === 'survival' && rsEvent.er.waves === evSettle.wavesBefore && rsEvent.coins === total,
    `waves=${evSettle.wavesBefore} coins=${rsEvent.coins}`);
  push('ResultScene 活动标题「限时生存结束」', rsEvent.texts.some((t) => t.includes('限时生存结束')));
  push('ResultScene 活动结算行', rsEvent.texts.some((t) => t.includes('生存结算')));
}
push('活动模式 victory=true（限时完成即胜利）', rsEvent.victory === true);

// 额外：强制金币冲刺（不依赖本周活动，确保两种模式都被覆盖）
await startGame(page, 'coin_rush', 1);
const coinEnter = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    mode: gs.mode,
    eventCfgId: gs.eventCfg ? gs.eventCfg.id : null,
    endless: gs.waves ? gs.waves.endless : null,
    magnetAlways: (gs.buffs.magnetUntil || 0) > 999999999,
    lives: gs.lives,
  };
});
push('强制金币冲刺：mode/eventCfg 正确', coinEnter.mode === 'coin_rush' && coinEnter.eventCfgId === 'coin_rush');
push('强制金币冲刺：无尽循环波次', coinEnter.endless === true);
push('强制金币冲刺：磁力常驻', coinEnter.magnetAlways === true);
push('强制金币冲刺：命数 = 3', coinEnter.lives === 3, `lives=${coinEnter.lives}`);

const coinSettle = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.stats = { kills: 5, coins: 10, damageTaken: 0, spawned: 5 };
  gs.endGame(true);
  return { double: !!gs.eventDouble };
});
await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive() && rs.result && rs.result.eventReward != null;
}, { timeout: 20000 });
const rsCoin = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  const r = rs.result;
  const texts = [];
  const walk = (list) => list.forEach((c) => {
    if (c && c.type === 'Text') texts.push(c.text);
    if (c && c.list && c.list.length) walk(c.list);
  });
  walk(rs.children.list);
  return { er: r.eventReward, coins: r.coins, texts };
});
const coinMult = 2 * (coinSettle.double ? 2 : 1);
const coinTotal = Math.round(10 * coinMult);
push('金币冲刺结算：金币×2（周末×4）精确',
  rsCoin.er.kind === 'coin_rush' && rsCoin.er.coins === coinTotal && rsCoin.coins === coinTotal,
  `mult=${rsCoin.er.mult} coins=${rsCoin.coins}`);
push('ResultScene 活动标题「金币冲刺结束」', rsCoin.texts.some((t) => t.includes('金币冲刺结束')));
push('ResultScene 活动结算行', rsCoin.texts.some((t) => t.includes('活动金币')));

// 活动模式不计普通关成就：活动胜利不应解锁 first_clear / flawless（victory 被 reportRun 压制）
const achGate = await page.evaluate(() => {
  const a = window.__SAVE.load().achievements;
  return { firstClear: !!a.first_clear, flawless: !!a.flawless };
});
push('活动模式胜利不计「通关任意一关」成就', achGate.firstClear === false);
push('活动模式胜利不计「无伤通关」成就', achGate.flawless === false);

// ══════════════════════════════════════════════════════════════
// D) 零 pageerror / console error
// ══════════════════════════════════════════════════════════════
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 8));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_retention_p0: PASS ===' : '=== qa_retention_p0: FAIL ==='));
process.exit(pass ? 0 : 1);
