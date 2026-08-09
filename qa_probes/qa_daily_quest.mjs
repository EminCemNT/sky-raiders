// 每日任务独立真测：当天生成/进度累加/done/领取发币/重复拒/跨天刷新 + 端到端面板与击杀钩子 + 零 pageerror。
import { chromium } from 'playwright';
const URL = 'http://localhost:5059/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });

let fails = 0;
const assert = (cond, msg) => { if (!cond) { fails++; log('  ❌ FAIL: ' + msg); } else { log('  ✅ ' + msg); } };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE, null, { timeout: 20000 });
await sleep(300);
log('\n【每日任务】菜单已渲染（含新增"每日任务"按钮），校验纯逻辑：');

// (A) 重置当日任务 -> 取当天任务
const init = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.dailyQuest = { date: '', claimed: false, progress: {}, picked: [] }; // 强制刷新
  const q = S.getDailyQuests();
  return { n: q.length, metrics: q.map((x) => x.metric), claimed: S.dailyQuestsClaimed(), ready: S.dailyQuestsReady() };
});
assert(init.n === 3, `当日任务数=3（实际 ${init.n}）`);
assert(init.metrics.every((m) => ['kills', 'coins', 'bombs', 'combos', 'super'].includes(m)), `任务指标均来自池（${init.metrics.join(',')}）`);
assert(init.claimed === false, '初始未领取');
assert(init.ready === false, '初始未全部完成');

// (B) 灌满当天任务进度 -> done & ready
const filled = await page.evaluate(() => {
  const S = window.__SAVE;
  S.getDailyQuests().forEach((x) => S.addDailyProgress(x.metric, x.target));
  const q2 = S.getDailyQuests();
  return { allDone: q2.every((x) => x.done), ready: S.dailyQuestsReady() };
});
assert(filled.allDone, '灌满后全部 done');
assert(filled.ready, 'dailyQuestsReady=true');

// (C) 领取 -> 金币增加 + claimed + count
const before = await page.evaluate(() => window.__SAVE.load().coins);
const claim = await page.evaluate(() => window.__SAVE.claimDailyQuests());
const after = await page.evaluate(() => window.__SAVE.load().coins);
assert(claim.claimed === true, '领取成功');
assert(claim.count === 3, `领取 3 项（实际 ${claim.count}）`);
assert(after - before === claim.reward, `金币 +${claim.reward}（实际 +${after - before}）`);

// (D) 重复领取应被拒
const dup = await page.evaluate(() => window.__SAVE.claimDailyQuests());
assert(dup.claimed === false, '已领后重复领取被拒');

// (E) 跨天刷新：把 date 改昨天 -> 进度与领取重置
const refresh = await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  const y = new Date(Date.now() - 86400000);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  s.dailyQuest.date = yStr;
  s.dailyQuest.claimed = true;
  s.dailyQuest.progress = { kills: 999 };
  const q = S.getDailyQuests(); // 今天 != 昨天 -> 重置
  const s2 = S.load();
  return { n: q.length, claimed: s2.dailyQuest.claimed, progressEmpty: Object.keys(s2.dailyQuest.progress).length === 0, dateIsToday: s2.dailyQuest.date !== yStr };
});
assert(refresh.n === 3, '跨天后重新生成 3 个');
assert(refresh.claimed === false, '跨天后领取状态重置');
assert(refresh.progressEmpty, '跨天后进度重置');
assert(refresh.dateIsToday, '跨天后 date 更新为今天');

// (F) 端到端：MenuScene 打开每日任务面板（构建代码路径）+ GameScene 击杀钩子 + endGame flush
log('\n【每日任务】端到端面板与击杀钩子：');
const e2e = await page.evaluate(() => {
  try {
    const S = window.__SAVE;
    const s = S.load();
    s.dailyQuest = { date: '', claimed: false, progress: {}, picked: [] };
    const q = S.getDailyQuests();
    const hasKills = q.some((x) => x.metric === 'kills');
    // 打开面板（MenuScene 实例）
    const menu = window.__SKY__.scene.getScene('MenuScene');
    menu.openDailyQuest();
    const opened = menu.dailyQuestOpen === true;
    menu.closeDailyQuest();
    // 进 GameScene 并触发击杀钩子（forceTutorial 避免首玩阻塞）
    window.__SKY__.scene.stop('MenuScene');
    window.__SKY__.scene.stop('GameScene');
    window.__SKY__.scene.stop('UIScene');
    window.__SKY__.scene.start('GameScene', { mode: 'normal', levelId: 1, forceTutorial: true });
    return { opened, hasKills };
  } catch (e) { return { error: String(e) }; }
});
assert(!e2e.error, `面板打开/关闭无异常（${e2e.error || 'ok'}）`);
assert(e2e.opened === true, 'MenuScene.openDailyQuest 成功置位');
await page.waitForFunction(() => window.__SKY && window.__SKY.registerKill, null, { timeout: 15000 });
await sleep(300);
const killHook = await page.evaluate(() => {
  const g = window.__SKY;
  const before = (window.__SAVE.load().dailyQuest.progress.kills) || 0;
  g.registerKill(100, 100, {});
  g.registerKill(100, 100, {});
  const after = (window.__SAVE.load().dailyQuest.progress.kills) || 0;
  // 触发 endGame 走 SaveManager.save flush（不崩溃即可）
  try { g.endGame(false); } catch (e) { return { before, after, endErr: String(e) }; }
  return { before, after, endErr: null };
});
assert(killHook.after - killHook.before === 2, `GameScene 击杀钩子累计 kills +2（实际 +${killHook.after - killHook.before}）`);
assert(!killHook.endErr, `endGame flush 无异常（${killHook.endErr || 'ok'}）`);

await sleep(200);
assert(pageErrors.length === 0, `全程零 pageerror（实际 ${pageErrors.length} 条）`);
if (pageErrors.length) pageErrors.slice(0, 10).forEach((e) => log('  ⚠️ ' + e));

await browser.close();
log('\n══════════════════════════════════');
log(fails === 0 ? `✅ 每日任务 真测 PASS（0 失败，pageerror=${pageErrors.length}）` : `❌ 每日任务 真测 FAIL（${fails} 失败）`);
process.exit(fails === 0 ? 0 : 1);
