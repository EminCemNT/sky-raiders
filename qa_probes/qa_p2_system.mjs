// qa_p2_system.mjs —— P2 系统扩展组验收探针（周期周赛 / 激励广告位预留 / 离线产品化）
//
// 验证：
//   1) WEEKLY_LEAGUE 配置（GROUP_SIZE=50 / REWARDS 5 档）+ getIsoWeekKey 格式
//   2) league 存档：默认字段 / 本周分数写入（取最高）/ 低分不覆盖
//   3) rank 计算：固定种子同分同排名 / 范围 [1, GROUP_SIZE] / 确定性
//   4) 周切换自动结算：旧周 + rank1 -> +500 金币，本周重置（week=本周 / score=0）
//   5) Ads 抽象接口（hasAds/showRewardAd + window.__ADS）+ noAds 开关联动
//   6) MenuScene 无尽入口旁显示「本周赛 · 当前第 X 名 · 周结倒计时」
//   7) 无尽失败「看广告复活」：弹面板 -> Ads 成功 -> 复活 1 次继续
//   8) 无尽 endGame 分数写入 league
//   9) 签到「看广告双倍」：Ads 成功后金币 ×2
//  10) 设置面板「去广告」开关（本地立即生效）
//  11) 断网/恢复顶部 toast 监听
//  12) 横屏遮罩：横屏触发 / 竖屏不触发 / iframe 不触发
//  13) 零 pageerror / console error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
// ⚠️ Ads 打桩必须覆盖「双实例」：Vite dev 在 src 改动后会给 app 侧 import 加 `?t=<ms>` 时间戳，
//    页面内裸路径 import('/src/systems/Ads.js') 与 window.__ADS 可能是两个模块实例；只打一处会
//    对 app 无效（真实 Ads 有 3s 假延时）→ 假失败。统一走 stubRewardAd()。等待金币翻倍亦用
//    轮询 waitForFunction（非固定 sleep），确保打桩未命中时仍能通过。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

/**
 * 打桩 Ads.showRewardAd → 立即回调 success=true（跳过占位 3s 假延时）。
 * 必须同时覆盖 window.__ADS 与页面内 re-import 的模块实例：Vite dev 在 src 改动后会给
 * app 侧 import 加 `?t=<ms>` 时间戳，二者可能是「两个模块实例」，只打一处会对 app 无效
 * （真实实现有 3s 假延时 → 短 sleep 后读到未翻倍的金币）→ 假失败。
 * 注意：裸路径 import 会重新求值 Ads.js 并改写 window.__ADS，故先捕获原指针、打完桩再还原。
 */
async function stubRewardAd(page) {
  return page.evaluate(async () => {
    const orig = window.__ADS;
    const targets = new Set();
    if (orig) targets.add(orig);
    try {
      const m = await import('/src/systems/Ads.js');
      if (m && m.Ads) targets.add(m.Ads);
    } catch (e) { /* ignore */ }
    let n = 0;
    targets.forEach((A) => {
      if (A && typeof A.showRewardAd === 'function') { A.showRewardAd = (cb) => cb(true); n++; }
    });
    window.__ADS = orig; // 还原全局指针，避免污染后续断言
    return n;
  });
}

/** 进入指定模式的一局（复用同一 page，重启场景） */
async function startGame(page, mode = 'normal') {
  await page.evaluate((mode) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode, levelId: 1 });
  }, mode);
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

// ── 1) 静态配置：WEEKLY_LEAGUE + getIsoWeekKey ──
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const r = gc.WEEKLY_LEAGUE.REWARDS || [];
  return {
    group: gc.WEEKLY_LEAGUE.GROUP_SIZE,
    rewards: r,
    weekKey: gc.getIsoWeekKey(),
  };
});
push('WEEKLY_LEAGUE.GROUP_SIZE=50', cfg.group === 50, `got ${cfg.group}`);
push('WEEKLY_LEAGUE.REWARDS 共 5 档', Array.isArray(cfg.rewards) && cfg.rewards.length === 5, `got ${cfg.rewards.length}`);
const rewMap = Object.fromEntries(cfg.rewards.map((x) => [String(x.rank), x.coins]));
push('REWARDS 档位金额（1:500 / 2:300 / 3:200 / 4-10:100 / 11-50:50）',
  rewMap['1'] === 500 && rewMap['2'] === 300 && rewMap['3'] === 200 && rewMap['4-10'] === 100 && rewMap['11-50'] === 50,
  JSON.stringify(rewMap));
push('getIsoWeekKey 格式 "YYYY-WNN"', /^\d{4}-W\d{2}$/.test(cfg.weekKey), cfg.weekKey);

// ── 2) league 存档：默认字段 + 本周分数写入 ──
const rec = await page.evaluate(() => {
  const SM = window.__SAVE;
  SM.reset();
  const lg0 = { ...SM.load().league };
  SM.recordLeagueScore(10000);
  const a = { score: SM.load().league.score, week: SM.load().league.week };
  SM.recordLeagueScore(5000);
  const b = { score: SM.load().league.score, week: SM.load().league.week };
  SM.recordLeagueScore(99999);
  const c = { score: SM.load().league.score, week: SM.load().league.week };
  return { lg0, a, b, c };
});
push('league 默认字段 {week:"",score:0,claimed:false,rank:0}',
  JSON.stringify(rec.lg0) === JSON.stringify({ week: '', score: 0, claimed: false, rank: 0 }),
  JSON.stringify(rec.lg0));
push('recordLeagueScore 写入本周分数', rec.a.score === 10000 && rec.a.week === rec.c.week, `score=${rec.a.score} week=${rec.a.week}`);
push('recordLeagueScore 低分不覆盖（保持 10000）', rec.b.score === 10000, `score=${rec.b.score}`);
push('recordLeagueScore 更高分覆盖（→99999）', rec.c.score === 99999, `score=${rec.c.score}`);

// ── 3) rank 计算：固定种子 / 范围 / 确定性 ──
const rk = await page.evaluate(async () => {
  const SM = window.__SAVE;
  const gc = await import('/src/config/GameConfig.js');
  const gs = gc.WEEKLY_LEAGUE.GROUP_SIZE;
  return {
    a1: SM._leagueRankForScore(12345),
    a2: SM._leagueRankForScore(12345),
    b: SM._leagueRankForScore(99999),
    c: SM._leagueRankForScore(10000),
    gs,
  };
});
push('rank 固定种子：同分同排名', rk.a1 === rk.a2, `rank=${rk.a1}`);
push('rank 范围在 [1, GROUP_SIZE]', rk.a1 >= 1 && rk.a1 <= rk.gs && rk.b >= 1 && rk.b <= rk.gs, `${rk.a1} / ${rk.b} / size=${rk.gs}`);
push('rank(10000)=18（确定性基准）', rk.c === 18, `rank=${rk.c}`);

// ── 4) 周切换自动结算 + 重置 ──
const curWeek = await page.evaluate(async () => (await import('/src/config/GameConfig.js')).getIsoWeekKey());
const settle = await page.evaluate(() => {
  const SM = window.__SAVE;
  SM.reset();
  const lg = SM.load().league;
  lg.week = '2000-W01';   // 旧周
  lg.score = 12345;
  lg.rank = 1;
  const coinsBefore = SM.load().coins;
  const snap = SM.getLeagueSnapshot();
  const after = SM.load();
  return {
    settled: snap.settled, reward: snap.reward, settledRank: snap.settledRank,
    week: snap.week, score: snap.score,
    coinsBefore, coinsAfter: after.coins,
    lgScore: after.league.score, claimed: after.league.claimed,
  };
});
push('周切换自动结算 settled=true', settle.settled === true, JSON.stringify(settle));
push('周结发奖：rank1 → +500 金币', settle.reward === 500 && settle.coinsAfter === settle.coinsBefore + 500, `${settle.coinsBefore}→${settle.coinsAfter}`);
push('周结后本周重置（week=本周 / score=0）', settle.week === curWeek && settle.score === 0 && settle.lgScore === 0, `week=${settle.week}`);

// ── 5) Ads 抽象接口 + noAds 开关联动 ──
const ads = await page.evaluate(async () => {
  const m = await import('/src/systems/Ads.js');
  const A = m.Ads;
  const hasFn = typeof A.hasAds === 'function' && typeof A.showRewardAd === 'function';
  const winAds = !!window.__ADS;
  const defaultHas = A.hasAds();
  window.__SAVE.set('noAds', true);
  const noAdsHas = A.hasAds();
  window.__SAVE.set('noAds', false);
  return { hasFn, winAds, defaultHas, noAdsHas };
});
push('Ads 抽象接口存在（hasAds/showRewardAd）', ads.hasFn === true);
push('window.__ADS 已暴露', ads.winAds === true);
push('默认 hasAds()=true（noAds=false）', ads.defaultHas === true);
push('noAds=true 时 hasAds()=false', ads.noAdsHas === false);

// ── 6) MenuScene 无尽入口旁显示周赛状态 ──
const lgUi = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return {
    hasFn: typeof ms._leagueLabel === 'function',
    text: ms.leagueText ? ms.leagueText.text : '',
  };
});
const menuTexts = await collectTexts(page, 'MenuScene');
push('MenuScene 有无尽周赛状态文本（含「本周赛」）', menuTexts.some((t) => t.includes('本周赛')), lgUi.text);
push('周赛文案含名次与周结倒计时', lgUi.text.includes('当前第') && lgUi.text.includes('周结'), lgUi.text);

// ── 7) 无尽失败「看广告复活继续」──
await startGame(page, 'endless');
await stubRewardAd(page); // 跳过 3s 假延时：立即成功（覆盖 __ADS 与 re-import 双实例）
const rev = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs._adReviveUsed = false;
  gs.lives = 1;
  gs.player.invulnUntil = 0;
  gs.buffs.shieldUntil = 0;
  gs.player.takeDamage(99999);
  return { open: gs._adReviveOpen, lives: gs.lives, gameEnded: gs.gameEnded };
});
push('无尽失败弹「看广告复活」面板（lives=0 / 未结算）', rev.open === true && rev.lives === 0 && rev.gameEnded === false, JSON.stringify(rev));

await page.waitForTimeout(120);
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (gs._adReviveCtl) gs._adReviveCtl.adBtn.container.emit('pointerdown');
});
// 等待复活落定（finish 内含 260ms delayedCall），用轮询替代固定 sleep 消除偶发时序
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs._adReviveOpen === false && gs.lives === 1 && gs.player && gs.player.active;
}, { timeout: 5000 });
const revAfter = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    open: gs._adReviveOpen,
    lives: gs.lives,
    active: !!(gs.player && gs.player.active),
    gameEnded: gs.gameEnded,
    used: gs._adReviveUsed,
    paused: !!(gs.physics && gs.physics.world && gs.physics.world.isPaused),
  };
});
push('广告成功 → 复活 1 次继续（lives=1 / player.active / 未结算）',
  revAfter.lives === 1 && revAfter.active === true && revAfter.gameEnded === false && revAfter.open === false,
  JSON.stringify(revAfter));
push('看广告复活每局仅一次（_adReviveUsed=true）', revAfter.used === true);
push('复活后物理恢复（isPaused=false）', revAfter.paused === false);

// ── 8) 无尽 endGame 分数写入 league ──
await page.evaluate(() => window.__SAVE.set('noAds', true)); // 关闭广告位：失败直接结算，不弹复活
await startGame(page, 'endless');
const lgRec = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.score = 5000;
  gs.lives = 1;
  gs.player.invulnUntil = 0;
  gs.buffs.shieldUntil = 0;
  gs.player.takeDamage(99999);
  return { league: { ...window.__SAVE.load().league }, gameEnded: gs.gameEnded };
});
push('无尽 endGame 分数写入 league（score=5000）', lgRec.league.score === 5000, `score=${lgRec.league.score}`);
push('无尽 endGame 写入本周 week', lgRec.league.week === curWeek, `week=${lgRec.league.week}`);
await page.evaluate(() => window.__SAVE.set('noAds', false));

// ── 9) 签到「看广告双倍」：Ads 成功后金币 ×2 ──
await page.evaluate(() => window.__SAVE.reset());
await stubRewardAd(page); // 同样覆盖双实例（见函数说明）
await page.evaluate(() => {
  const g = window.__SKY__;
  ['UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const s = g.scene.getScene(k);
    if (s && s.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('MenuScene');
});
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });
await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openCheckIn();
});
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.checkinOpen && !!ms._checkinClaimBtn;
}, { timeout: 20000 });
const chk = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const coinsBefore = window.__SAVE.load().coins;
  ms._checkinClaimBtn.emit('pointerdown');
  return {
    coinsBefore,
    coinsAfterClaim: window.__SAVE.load().coins,
    hasDouble: !!ms._checkinDoubleBtn,
  };
});
push('签到领取 +50 金币', chk.coinsBefore === 0 && chk.coinsAfterClaim === 50, `${chk.coinsBefore}→${chk.coinsAfterClaim}`);
push('签到后出现「看广告双倍」按钮', chk.hasDouble === true);
// 触发「看广告双倍」按钮，然后轮询等待金币翻倍。
// 不用「固定 sleep + 单次读取」：若打桩未命中（走了真实 Ads 的 3s 假延时），
// 固定短 sleep 会读到未翻倍的金币 → 假失败。
const dblBtn = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const b = ms && ms._checkinDoubleBtn;
  if (b) b.emit('pointerdown');
  return !!b;
});
const doubled = await page.waitForFunction(() => window.__SAVE.load().coins === 100, null, { timeout: 6000 })
  .then(() => true).catch(() => false);
const coinsAfterDouble = await page.evaluate(() => window.__SAVE.load().coins);
push('看广告双倍：金币 ×2（50→100）', dblBtn && doubled, `btn=${dblBtn} coins=${coinsAfterDouble}`);
await page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').closeCheckIn());

// ── 10) 设置面板「去广告」开关 ──
const tog = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openSettings();
  const has = !!ms._noAdsBtn;
  if (ms._noAdsBtn) {
    ms._noAdsBtn.container.emit('pointerdown'); // noAds=false -> true
    const on1 = window.__SAVE.load().noAds;
    const sel1 = ms._noAdsBtn.selected;
    ms._noAdsBtn.container.emit('pointerdown'); // true -> false
    const on2 = window.__SAVE.load().noAds;
    const sel2 = ms._noAdsBtn.selected;
    ms.closeSettings();
    return { has, on1, sel1, on2, sel2 };
  }
  ms.closeSettings();
  return { has, on1: null, sel1: null, on2: null, sel2: null };
});
push('设置面板存在「去广告」开关', tog.has === true);
push('点击开启 noAds=true 并高亮', tog.on1 === true && tog.sel1 === true, JSON.stringify(tog));
push('再点关闭 noAds=false', tog.on2 === false && tog.sel2 === false, JSON.stringify(tog));

// ── 11) 断网/恢复 toast 监听 ──
const toast = await page.evaluate(() => {
  const t = window.__OFFLINE_TOAST;
  if (!t) return { exists: false };
  window.dispatchEvent(new Event('offline'));
  const offText = t.el.textContent;
  const offOpacity = t.el.style.opacity;
  window.dispatchEvent(new Event('online'));
  const onText = t.el.textContent;
  return { exists: true, offText, offOpacity, onText };
});
push('断网 toast 监听存在（window.__OFFLINE_TOAST）', toast.exists === true);
push('断网显示「网络已断开，当前为离线模式」', toast.exists && toast.offText.includes('网络已断开') && toast.offOpacity === '1', toast.offText);
push('恢复显示「网络已恢复」', toast.exists && toast.onText.includes('网络已恢复'), toast.onText);

// ── 12) 横屏遮罩：横屏触发 / 竖屏不触发 / iframe 不触发 ──
const l1 = await page.evaluate(() => {
  const L = window.__LANDSCAPE_OVERLAY;
  if (!L) return { exists: false };
  return { exists: true, display: L.el.style.display };
});
push('横屏遮罩存在（window.__LANDSCAPE_OVERLAY）', l1.exists === true);
push('竖屏不触发（默认视口 display=none）', l1.exists && l1.display === 'none', `display=${l1.display}`);

await page.evaluate(() => {
  const L = window.__LANDSCAPE_OVERLAY;
  L.state.isMobile = true;
  L.state.inIframe = false;
  L.update();
});
const l2 = await page.evaluate(() => window.__LANDSCAPE_OVERLAY.el.style.display);
push('移动端 + 竖屏仍不触发', l2 === 'none', `display=${l2}`);

await page.setViewportSize({ width: 960, height: 540 }); // 横屏
await page.evaluate(() => window.__LANDSCAPE_OVERLAY.update());
const l3 = await page.evaluate(() => window.__LANDSCAPE_OVERLAY.el.style.display);
push('移动端横屏触发「请竖屏游玩」（display=flex）', l3 === 'flex', `display=${l3}`);

await page.evaluate(() => {
  const L = window.__LANDSCAPE_OVERLAY;
  L.state.inIframe = true;
  L.update();
});
const l4 = await page.evaluate(() => window.__LANDSCAPE_OVERLAY.el.style.display);
push('iframe 内横屏不触发（display=none）', l4 === 'none', `display=${l4}`);

await page.setViewportSize({ width: 540, height: 960 });
await page.evaluate(() => {
  const L = window.__LANDSCAPE_OVERLAY;
  L.state.inIframe = false;
  L.update();
});
const l5 = await page.evaluate(() => window.__LANDSCAPE_OVERLAY.el.style.display);
push('恢复竖屏不触发', l5 === 'none', `display=${l5}`);

// ── 13) 零 pageerror / console error ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_p2_system: PASS ===' : '=== qa_p2_system: FAIL ==='));
process.exit(pass ? 0 : 1);
