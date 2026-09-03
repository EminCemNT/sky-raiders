// qa_opt16_c5.mjs —— OPT-16 批2 C5 每日种子挑战 验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C5 条。断言真实运行行为：
//   C5.1  同一天两次进入波次一致（固定 variant 0）且 seed === _dailySeed('sky-daily_YYYY-MM-DD')、difficulty=standard
//   C5.2  挑战结束 topScores/levelMedals/levelStars/achievements/bestScore 无新增、dailyChallenge.bestScore 只增不降
//   C5.3  达成目标 → cleared=true + coins+reward 一次；二次达成不重复发（claimed 幂等）
//   C5.4  跨天 date 变化 → bestScore/cleared/claimed 重置
//   UI    菜单「今日挑战」入口（合并进每日任务面板）；局内播报种子（UIScene 透传 dailySeed + daily 分支）；
//         ResultScene 追加「今日种子 # / 今日最佳 / 目标/领取态」行
// 运行：node qa_probes/qa_opt16_c5.mjs（QA_URL 默认 http://127.0.0.1:5059）
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059'; // 注意：勿命名为 URL，避免遮蔽全局 URL 构造器（静态读取 new URL 依赖它）
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };

async function launchPage(saveObj) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save }) => {
    try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }, { key: SAVE_KEY, save: saveObj });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
    await page.waitForFunction(() => {
      const ms = window.__SKY__.scene.getScene('MenuScene');
      return ms && ms.scene.isActive();
    }, null, { timeout: 20000 });
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error('launchPage timeout: ' + errors.slice(0, 3).join(' | ') || '(no console error)');
  }
  return { ctx, page, errors };
}

// 以 mode='daily' 启动真实 GameScene（由其自行 launch UIScene，透传 dailySeed）
async function enterDailyBattle(page, seed) {
  await page.evaluate(async (seed) => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
    game.scene.start('GameScene', { mode: 'daily', levelId: 1, dailySeed: seed });
    await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const gs = game.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
      }, 50);
    });
  }, seed);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.player && gs.player.active;
  }, null, { timeout: 10000 });
}

// 读取 daily 局关键状态（运行期 C5.1）
async function readDailyFlags(page) {
  return page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const uis = window.__SKY__.scene.getScene('UIScene');
    const S = window.__SAVE;
    const out = {
      mode: gs.mode,
      dailyRun: gs.dailyRun === true,
      difficulty: gs.difficultyCfg && gs.difficultyCfg.id,
      levelId: gs.levelId,
      seed: gs.dailySeed,
      dailySeedStr: S.dailySeedStr(),
      expected: S._dailySeed('sky-daily_' + S._todayStr()),
    };
    if (uis && uis.scene.isActive()) out.uiSeed = uis._dailySeed;
    return out;
  });
}

// mock 局内得分 → 驱动 endGame → 等 ResultScene → 采集 ResultScene 文本 + 存档红线段（单次调用即返回采集）
async function driveDailyEnd(page, { score, victory }) {
  await page.evaluate(async ({ score, victory }) => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    gs.score = score;
    gs.stats.spawned = Math.max(gs.stats.spawned || 0, 1);
    gs.stats.coins = 0; // 清空局内金币，保证结算金币增量仅来自 C5 奖励
    gs.stats.damageTaken = 0;
    gs.grazeCount = 0;
    gs.endGame(victory);
  }, { score, victory });
  await page.waitForFunction(() => {
    const rs = window.__SKY__.scene.getScene('ResultScene');
    return rs && rs.scene.isActive();
  }, null, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 350)); // 让 ResultScene create 完成
  return page.evaluate(() => {
    const rs = window.__SKY__.scene.getScene('ResultScene');
    const texts = rs.children.list.filter((c) => c && c.type === 'Text').map((c) => String(c.text));
    const sv = window.__SAVE.load();
    const medalN = Object.values(sv.levelMedals || {}).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
    return {
      texts,
      daily: sv.dailyChallenge,
      coins: sv.coins || 0,
      bestScore: sv.bestScore || 0,
      topLen: (sv.topScores || []).length,
      medalN,
      levelStars: JSON.stringify(sv.levelStars || {}),
      achievements: JSON.stringify(sv.achievements || {}),
      dailyQuest: JSON.stringify(sv.dailyQuest || {}),
      newbie: JSON.stringify(sv.newbiePlan || {}),
    };
  });
}

// 收集容器/子容器内全部 Text 文本
async function overlayTexts(page) {
  return page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    const ov = ms && ms.dailyQuestOverlay;
    if (!ov) return [];
    const arr = [];
    const walk = (obj) => {
      if (!obj || !obj.list) return;
      for (const c of obj.list) {
        if (c && c.type === 'Text') arr.push(String(c.text));
        else if (c && c.list) walk(c);
      }
    };
    walk(ov);
    return arr;
  });
}

// ═══════════════ A：函数级（SaveManager 语义 + i18n + 红线字段）═══
const cleanA = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 0 };
const A = await launchPage(cleanA);

const locC5 = await A.page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  const keys = ['dailyChallenge', 'dailySeedLabel', 'dailyChallengeGoal', 'dailyChallengeReward',
    'dailyChallengeDone', 'dailyChallengeClaimed', 'dailyChallengeUnclaimed', 'dailyChallengeEnter',
    'dailyChallengeBest', 'dailyChallengeCleared'];
  return {
    all: keys.every((k) => typeof L.zh[k] === 'string' && L.zh[k].length > 0
      && typeof L.en[k] === 'string' && L.en[k].length > 0),
    zh: keys.map((k) => L.zh[k]), en: keys.map((k) => L.en[k]),
  };
});
push('C5.i18n. zh/en C5 词条齐全（今日挑战/种子/目标/奖励/领取态等 10 条）', locC5.all === true, `zh=${locC5.zh.join('|')}`);

const fnRes = await A.page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  const today = S._todayStr();
  const seedStr = S.dailySeedStr();
  const expected = S._dailySeed('sky-daily_' + today);
  // 初始态
  s.dailyChallenge = { date: today, bestScore: 0, cleared: false, claimed: false };
  s.coins = 0;
  S.save();
  // record 更高覆盖
  const r1 = S.recordDailyChallenge(70000, true);
  const c1 = S.claimDailyChallenge();
  const coinsAfter1 = S.load().coins;
  // 再次 claim → 不重复
  const c2 = S.claimDailyChallenge();
  const coinsAfter2 = S.load().coins;
  // 更低分不降 bestScore；再次 cleared 幂等
  const rLow = S.recordDailyChallenge(10000, false);
  const dcAfter = S.load().dailyChallenge;
  // 跨天重置
  s.dailyChallenge = { date: S._yesterdayStr(), bestScore: 99999, cleared: true, claimed: true };
  S.save();
  const dcReset = S.getDailyChallenge();
  return {
    seedStr, expected, seedOk: seedStr === expected,
    r1, c1, coinsAfter1, c2, coinsAfter2, rLow, dcAfter, dcReset,
  };
});
push('C5.1. dailySeedStr() === _dailySeed("sky-daily_"+今天)（FNV-1a 同一天全设备一致）', fnRes.seedOk === true, `seed=${fnRes.seedStr}`);
push('C5.3. 达成 record(70000,true) → bestScore=70000 + cleared=true', fnRes.r1.bestScore === 70000 && fnRes.r1.cleared === true, JSON.stringify(fnRes.r1));
push('C5.3. claim 首次 → coins +500', fnRes.c1.claimed === true && fnRes.coinsAfter1 === 500, `coins=${fnRes.coinsAfter1} reason=${fnRes.c1.reason}`);
push('C5.3. claim 二次 → 拒绝（claimed 幂等，不重复发）', fnRes.c2.claimed === false && fnRes.coinsAfter2 === 500, `coins=${fnRes.coinsAfter2} reason=${fnRes.c2.reason}`);
push('C5.2. 更低分 record(10000) → bestScore 不降（70000）+ cleared 保持 true', fnRes.rLow.bestScore === 70000 && fnRes.dcAfter.bestScore === 70000 && fnRes.dcAfter.cleared === true, JSON.stringify(fnRes.rLow));
push('C5.4. 跨天（date=昨日）→ getDailyChallenge 重置 bestScore=0/cleared=false/claimed=false', fnRes.dcReset.bestScore === 0 && fnRes.dcReset.cleared === false && fnRes.dcReset.claimed === false, JSON.stringify(fnRes.dcReset));

// 红线：纯 SaveManager C5 调用不写 topScores/levelMedals/levelStars/achievements/bestScore
const redlineA = await A.page.evaluate(() => {
  const sv = window.__SAVE.load();
  const medalN = Object.values(sv.levelMedals || {}).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
  return {
    topLen: (sv.topScores || []).length, medalN,
    levelStars: JSON.stringify(sv.levelStars || {}),
    achievements: JSON.stringify(sv.achievements || {}),
    bestScore: sv.bestScore || 0,
  };
});
push('C5.2/红线. 函数级调用不写 topScores/levelMedals/levelStars/achievements/bestScore', redlineA.topLen === 0 && redlineA.medalN === 0 && redlineA.levelStars === '{}' && redlineA.achievements === '{}' && redlineA.bestScore === 0, JSON.stringify(redlineA));
push('P0. A 上下文无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
await A.ctx.close();

// ═══════════════ B：真实 daily 局 E2E（C5.1/C5.2/C5.3 + ResultScene UI）═══
const cleanB = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 100,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 } };
const B = await launchPage(cleanB);

const seedStrB = await B.page.evaluate(() => window.__SAVE.dailySeedStr());
const preB = await B.page.evaluate(() => {
  const sv = window.__SAVE.load();
  const medalN = Object.values(sv.levelMedals || {}).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
  return {
    coins: sv.coins || 0, topLen: (sv.topScores || []).length, medalN,
    levelStars: JSON.stringify(sv.levelStars || {}), achievements: JSON.stringify(sv.achievements || {}),
    bestScore: sv.bestScore || 0, dailyQuest: JSON.stringify(sv.dailyQuest || {}),
    newbie: JSON.stringify(sv.newbiePlan || {}),
  };
});

// ── Run1：score 70000 + victory → 达成目标，cleared + 领 1 次奖 ──
await enterDailyBattle(B.page, seedStrB);
const flags1 = await readDailyFlags(B.page);
push('C5.1. daily 局：mode=daily / dailyRun=true / levelId=1', flags1.mode === 'daily' && flags1.dailyRun === true && flags1.levelId === 1, JSON.stringify({ mode: flags1.mode, levelId: flags1.levelId }));
push('C5.1. daily 局：difficulty 固定 standard（公平，跨设备一致）', flags1.difficulty === 'standard', `difficulty=${flags1.difficulty}`);
push('C5.1. daily 局：gs.dailySeed === dailySeedStr() === _dailySeed(salt+今天)', flags1.seed === seedStrB && flags1.seed === flags1.expected && flags1.seed === flags1.dailySeedStr, `seed=${flags1.seed}`);
push('C5.1/UI. UIScene 收到 dailySeed（Phase C 播报种子用）', flags1.uiSeed === seedStrB, `uiSeed=${flags1.uiSeed}`);

const run1 = await driveDailyEnd(B.page, { score: 70000, victory: true });
const rsHasSeed = run1.texts.some((s) => s.includes('今日种子 #') && s.includes('今日最佳 70000'));
const rsHasGoal = run1.texts.some((s) => s.includes('目标 60000') && s.includes('已领取'));
push('C5.UI. ResultScene 追加「今日种子 # · 今日最佳 70000」行', rsHasSeed, `hit=${rsHasSeed}`);
push('C5.UI. ResultScene 追加「目标 60000 分 · 已领取」行', rsHasGoal, `hit=${rsHasGoal}`);
push('C5.3. daily 结算：cleared=true + claimed=true（达成即发 1 次奖）', run1.daily.cleared === true && run1.daily.claimed === true, JSON.stringify(run1.daily));
push('C5.3. daily 结算金币：coins +500（奖励一次）', run1.coins - preB.coins === 500, `pre=${preB.coins} post=${run1.coins}`);
push('C5.2. daily 结算不写 topScores（无新增）', run1.topLen === preB.topLen, `pre=${preB.topLen} post=${run1.topLen}`);
push('C5.2. daily 结算不写 levelMedals/levelStars', run1.medalN === preB.medalN && run1.levelStars === preB.levelStars, `medalN=${run1.medalN}`);
push('C5.2. daily 结算不写 achievements / bestScore', run1.achievements === preB.achievements && run1.bestScore === preB.bestScore, `achSame=${run1.achievements === preB.achievements} best=${run1.bestScore}`);
push('C5.2. daily 结算不写 每日任务/新手计划', run1.dailyQuest === preB.dailyQuest && run1.newbie === preB.newbie, `dqSame=${run1.dailyQuest === preB.dailyQuest}`);
push('C5.2. daily 结算 bestScore 落盘 = 70000（append-only dailyChallenge）', run1.daily.bestScore === 70000, `best=${run1.daily.bestScore}`);

// ── Run2（同一天二次进入）：score 75000 victory → bestScore 更高覆盖，但奖励不重复发 ──
await enterDailyBattle(B.page, seedStrB);
const flags2 = await readDailyFlags(B.page);
push('C5.1. 同一天二次进入：seed/难度/关卡与 Run1 完全一致（同图同种子）', flags2.seed === seedStrB && flags2.difficulty === 'standard' && flags2.levelId === 1, `seed=${flags2.seed}`);
const run2 = await driveDailyEnd(B.page, { score: 75000, victory: true });
push('C5.2. 二次更高分 → bestScore 只增不降（70000→75000）', run2.daily.bestScore === 75000, `best=${run2.daily.bestScore}`);
push('C5.3. 二次达成 → 金币不重复发（claimed 幂等，coins 仍 +500 总额）', run2.daily.claimed === true && run2.coins === preB.coins + 500, `coins=${run2.coins}`);

// ── Run3（同日再进，失败低分）：bestScore 不降 / cleared 保持 / 不写榜 ──
await enterDailyBattle(B.page, seedStrB);
const run3 = await driveDailyEnd(B.page, { score: 10000, victory: false });
push('C5.2. 失败低分 → bestScore 不降（保持 75000）', run3.daily.bestScore === 75000, `best=${run3.daily.bestScore}`);
push('C5.2. 失败 → cleared/claimed 保持 true（当日已达成不受影响）', run3.daily.cleared === true && run3.daily.claimed === true, JSON.stringify(run3.daily));
push('C5.2. 失败局不写 topScores（仍与 Run1 前一致）', run3.topLen === preB.topLen, `topLen=${run3.topLen}`);
push('P0. B 主上下文无 pageerror/console.error', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));
await B.ctx.close();

// ═══════════════ D：菜单「今日挑战」入口（合并进每日任务面板）═══
const cleanD = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 50 };
const D = await launchPage(cleanD);
const dqOpened = await D.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  if (!ms || typeof ms.openDailyQuest !== 'function') return false;
  if (ms.dailyQuestOpen) ms.closeDailyQuest();
  ms.openDailyQuest();
  return !!ms.dailyQuestOverlay;
});
push('C5.UI. 每日任务面板可打开（今日挑战合并入口载体）', dqOpened === true);
const dqTexts = await overlayTexts(D.page);
const zhToday = await D.page.evaluate(async () => (await import('/src/config/Locale.js')).L.zh);
push('C5.UI. 面板含「今日挑战 · 今日种子 #xxxxxx」行', dqTexts.some((s) => s.includes(zhToday.dailyChallenge) && s.includes(zhToday.dailySeedLabel.replace('{seed}', ''))), dqTexts.find((s) => s.includes(zhToday.dailyChallenge)) || '');
push('C5.UI. 面板含「进入挑战」按钮', dqTexts.some((s) => s.includes(zhToday.dailyChallengeEnter)), `found=${dqTexts.filter((s) => s.includes(zhToday.dailyChallengeEnter)).length}`);
push('C5.UI. 面板含目标/奖励或领取态（cleared 未到时展示 Goal·Reward）', dqTexts.some((s) => s.includes('目标 60000') || s.includes('已领取') || s.includes('已达成')), dqTexts.find((s) => s.includes('目标') || s.includes('已领') || s.includes('已达成')) || '');
push('P0. D 上下文无 pageerror/console.error', D.errors.length === 0, D.errors.slice(0, 3).join(' | '));
await D.ctx.close();

// ═══════════════ E：静态红线/接线（固定 variant、独立结算域、成就抑制、UIScene 播报、SaveManager append-only）═══
const gsSrc = (() => { try { return readFileSync(new URL('../src/scenes/GameScene.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
const wsSrc = (() => { try { return readFileSync(new URL('../src/systems/WaveSystem.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
const uiSrc = (() => { try { return readFileSync(new URL('../src/scenes/UIScene.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
const smSrc = (() => { try { return readFileSync(new URL('../src/utils/SaveManager.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
push('E1. GameScene：WaveSystem 固定 variant 0（daily 同一天两次同图）', /fixedVariantIndex:\s*this\.dailyRun\s*\?\s*0\s*:\s*undefined/.test(gsSrc), gsSrc.length > 200 ? `len=${gsSrc.length}` : gsSrc);
push('E2. GameScene：独立结算域 _shouldRecordPersist 含 !this.dailyRun', /return\s*!this\._reliefRun\s*&&\s*!this\.dailyRun/.test(gsSrc), `len=${gsSrc.length}`);
push('E3. GameScene：成就 startRun ignore=dailyRun（挑战全程抑制成就）', /startRun\(this\.mode,\s*this\.levelId,\s*\{\s*ignore:\s*this\.dailyRun\s*\}\)/.test(gsSrc), `len=${gsSrc.length}`);
push('E4. GameScene：endGame daily 独立结算块（record/claim/flushNow/result.daily）', /result\.daily\s*=/.test(gsSrc) && /claimDailyChallenge\(\)/.test(gsSrc), `len=${gsSrc.length}`);
push('E5. WaveSystem：_pickVariantPlan 支持 fixedIdx（clamp 到 variants 内）', /fixedIdx != null && fixedIdx >= 0/.test(wsSrc), `len=${wsSrc.length}`);
push('E6. UIScene：Phase C daily 分支播报「今日挑战 · 今日种子 #」', /const isDaily = this\.mode === 'daily'/.test(uiSrc) && /dailySeedLabel/.test(uiSrc), `len=${uiSrc.length}`);
push('E7. SaveManager：dailyChallenge 字段 append-only（DEFAULT_SAVE/freshSave/load 深合并 + 4 公开方法）', /dailyChallenge:\s*\{\s*date:\s*''/.test(smSrc) && /getDailyChallenge\(\)/.test(smSrc) && /recordDailyChallenge\(score,\s*cleared\)/.test(smSrc) && /claimDailyChallenge\(\)/.test(smSrc), `len=${smSrc.length}`);

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C5 每日种子挑战探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
