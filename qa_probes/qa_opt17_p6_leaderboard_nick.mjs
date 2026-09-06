// qa_opt17_p6_leaderboard_nick.mjs —— OPT-17 P6 防回归探针（排行榜昵称列）
// ---------------------------------------------------------------------------
// 背景：C2 昵称已可编辑，但排行榜（本地历史 Top10）每行只显示分数/模式/日期，无昵称。
// 修复：openLeaderboard 行布局重排 = 名次(62) + 昵称(100 左起) + 分数(488 右对齐)
//       + 副行 模式·日期(100, y+20 12px)。昵称与 _nicknameRowLabel 同源（含默认回退）。
// 探针断言（程序化）：
//   1) 打开排行榜 → 非空榜单每行含昵称文本（昵称=当前存档值；该值在按钮/文本中可查）
//   2) 昵称列 y 与分数列同主行；副行模式·日期存在
//   3) 分数右对齐原点 (1,0.5)（防布局回退到裸分数）
//   4) 零 pageerror
// 运行：node qa_probes/qa_opt17_p6_leaderboard_nick.mjs（QA_URL 默认 5059）
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const checks = [];
const push = (name, ok, detail = '') => { checks.push({ name, ok }); console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : '')); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };
const SAVE = {
  version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 99999, bestScore: 420000, unlockedLevel: 4,
  selectedShip: 0, skins: {}, ownedSkins: [],
  nickname: '爸爸', haptics: true, muted: false,
  dailyChallenge: { date: '', bestScore: 0, cleared: false, claimed: false },
  // 预置 3 条历史成绩（昵称独立于条目，是全局字段 —— 与产品设计一致）
  topScores: [
    { score: 120000, levelId: 4, mode: 'normal', date: '09-06' },
    { score: 80000, levelId: 1, mode: 'normal', date: '09-05' },
    { score: 60000, levelId: 1, mode: 'endless', date: '09-04' },
  ],
};

const ctx = await browser.newContext({ viewport });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.addInitScript(({ key, save }) => {
  try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) {}
}, { key: SAVE_KEY, save: SAVE });
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, null, { timeout: 20000 });
await page.waitForTimeout(900);

// 打开排行榜（与真实按钮 openLeaderboard 等价）
await page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').openLeaderboard());
await page.waitForTimeout(350);
await page.screenshot({ path: 'shots/opt17_walk/shot_08_leaderboard_nick.png' });

const diag = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms.leaderboardOverlay;
  const texts = [];
  const walk = (c) => {
    if (!c || !c.list) return;
    c.list.forEach((o) => {
      if (o && typeof o.text === 'string') {
        texts.push({ x: Math.round(o.x), y: Math.round(o.y), originX: o.originX, text: o.text });
      }
      if (o && o.list) walk(o);
    });
  };
  if (ov) walk(ov);
  return { texts, nick: ms._nicknameRowLabel ? ms._nicknameRowLabel() : '' };
});

const NICK = diag.nick || '飞行员';   // 期望昵称行值
const nickRows = diag.texts.filter((t) => t.text === NICK && t.x === 100);
const scoreRows = diag.texts.filter((t) => /^\d+$/.test(t.text) && t.x === 488);
const subRows = diag.texts.filter((t) => t.x === 100 && t.y > 200 && /\d|模式|关|·/.test(t.text) && t.text !== NICK);
push('P6.1 每行含昵称列（x=100）', nickRows.length === 3, `${nickRows.length} 行含 "${NICK}"`);
push('P6.2 分数列右对齐（x=488, originX=1）', scoreRows.length === 3 && scoreRows.every((t) => t.originX === 1),
  scoreRows.map((t) => t.text).join(','));
push('P6.3 副行模式·日期存在（x=100,y>200）', subRows.length >= 3, subRows.map((t) => `${t.y}:${t.text}`).join(' | ').slice(0, 100));
push('P6.4 昵称列与首行分数同主行 y', nickRows.length >= 1 && scoreRows.length >= 1 && Math.abs(nickRows[0].y - scoreRows[0].y) <= 1,
  `nick.y=${nickRows[0] && nickRows[0].y} score.y=${scoreRows[0] && scoreRows[0].y}`);
push('P0. 无 pageerror/console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ P6 排行榜昵称防回归：${checks.length - fails.length}/${checks.length} ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);