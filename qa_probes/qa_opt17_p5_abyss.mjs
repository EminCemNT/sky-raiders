// qa_opt17_p5_abyss.mjs —— OPT-17 P5 防回归探针（L5 深渊回响高难关 + 勋章门禁）
// ---------------------------------------------------------------------------
// 背景：P5 追加第 5 关「深渊回响」(LEVELS id:5, minMedals:6, nova pattern, shieldHp 200)，
//       L5 解锁 = 通 L4(unlockedLevel>=5) 且累计勋章 >=6（与 hard/hell 难度阈值同口径）。
//       门禁消费方三处同判：MenuScene.openLevelSelect 卡 / startGame continue / ResultScene 下一关。
// 探针断言（程序化）：
//   A1 LEVELS 5 关（关卡面板 5 张卡）
//   A2 勋章 6 / unlocked 5 → L5 卡解锁（alpha≈1 + 可交互 input）
//   A3 L5 卡渲染「深渊回响」+ Boss 行含「Echo-X」（Locale levelName_5/bossName_5）
//   A4 布局：5 卡 centerY 严格递增（间距≈126）且卡 5 底 < 关闭按钮顶（不越界不遮挡）
//   B1 勋章 4（<6）→ 重开面板 L5 卡锁定（alpha 0.6 + 无 input）
//   B2 同场景 L4 卡仍解锁（L1-L4 无 minMedals → req=0 不受门禁影响）
//   C1 continue（startGame）：unlocked=5 但勋章 4 → 回退到 GameScene.levelId===4
//   P0 零 pageerror / console.error
// 运行：node qa_probes/qa_opt17_p5_abyss.mjs（QA_URL 默认 5059）
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
// 场景 A 存档：通 L4（unlocked=5）+ 勋章 6 枚（L1 三枚 + L2 两枚 + L3 一枚）→ L5 应解锁
const SAVE = {
  version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 99999, bestScore: 420000, unlockedLevel: 5,
  selectedShip: 0, skins: {}, ownedSkins: [],
  nickname: '爸爸', haptics: true, muted: false,
  dailyChallenge: { date: '', bestScore: 0, cleared: false, claimed: false },
  topScores: [],
  levelStars: { 1: 3, 2: 3, 3: 2, 4: 2 },
  levelMedals: { 1: ['c1', 'c2', 'c3'], 2: ['c1', 'c2'], 3: ['c1'] }, // 6 枚
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

// 收集关卡面板程序化快照：关卡卡容器（含 levelName 文本子）按 centerY 排序
const collectCardsFn = () => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms.levelSelectOverlay;
  if (!ov) return null;
  const NAME_RE = /近地轨道|陨石带|敌方要塞|终焉星核|深渊回响/;
  const cards = [];
  ov.list.forEach((ch) => {
    if (!ch || ch.type !== 'Container') return;
    const subs = [];
    ch.list.forEach((g) => {
      if (g && typeof g.text === 'string') subs.push({ t: g.text, x: g.x, y: g.y, fs: (g.style && g.style.fontSize) || '' });
    });
    const nameHit = subs.find((x) => NAME_RE.test(x.t));
    if (!nameHit) return;
    const bossHit = subs.find((x) => /Echo-X|Sentinel|Crusher|Overlord|Annihilator/i.test(x.t));
    cards.push({
      centerY: Math.round(ch.y), alpha: Math.round(ch.alpha * 100) / 100,
      interactive: !!(ch.input && ch.input.enabled), name: nameHit.t,
      boss: bossHit ? bossHit.t : null,
    });
  });
  cards.sort((a, b) => a.centerY - b.centerY);
  // 底部 neon-button（关闭按钮）y
  let closeY = 0;
  ov.list.forEach((ch) => {
    if (ch && ch.type === 'Container' && ch.name === 'neon-button' && ch.y > closeY) closeY = ch.y;
  });
  return { cards, closeY, medals: window.__SAVE.countMedals(), unlocked: window.__SAVE.load().unlockedLevel };
};

// ── 场景 A：勋章 6，L5 应解锁 ──────────────────────────────────────────
await page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').openLevelSelect());
await page.waitForTimeout(400);
const A = await page.evaluate(collectCardsFn);
await page.screenshot({ path: 'shots/opt17_walk/shot_p5_abyss_A_unlocked.png' });

push('A1 关卡面板含 5 张关卡卡', A && A.cards.length === 5, A ? `cards=${A.cards.length} y=[${A.cards.map((c) => c.centerY).join(',')}]` : 'no overlay');
const card5 = A && A.cards[4];
push('A2 L5 卡解锁（勋章6, unlocked5）', !!card5 && card5.interactive && card5.alpha > 0.9,
  card5 ? `name=${card5.name} alpha=${card5.alpha} interactive=${card5.interactive}` : 'no card5');
push('A3 L5 卡名「深渊回响」+ Boss 行含 Echo-X', !!card5 && card5.name === '深渊回响' && card5.boss && card5.boss.includes('Echo-X'),
  card5 ? `name=${card5.name} boss=${card5.boss}` : 'no card5');
// A4 布局：5 卡间距 ≈126（116+10）；卡5 底(=y+58) < 关闭按钮顶(=closeY-29)
const gapsOk = A && A.cards.length === 5 && A.cards.slice(1).every((c, i) => Math.abs(c.centerY - A.cards[i].centerY - 126) <= 2);
const noOverlap = A && card5 && A.closeY > 0 && (card5.centerY + 58) < (A.closeY - 29);
push('A4.1 卡间间距≈126 无重叠', !!gapsOk, A ? `deltas=${A.cards.slice(1).map((c, i) => c.centerY - A.cards[i].centerY).join(',')}` : 'no data');
push('A4.2 卡5 底 < 关闭按钮顶（不越界）', !!noOverlap, A ? `card5.bottom=${card5 && card5.centerY + 58} close.top=${A.closeY - 29}` : 'no data');

// ── 场景 B：勋章 4（<6），重开面板 L5 应锁定 ──────────────────────────
await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.closeLevelSelect();
  window.__SAVE.set('levelMedals', { 1: ['c1', 'c2'], 2: ['c1'], 3: ['c1'] }); // 4 枚
  ms.openLevelSelect();
});
await page.waitForTimeout(400);
const B = await page.evaluate(collectCardsFn);
await page.screenshot({ path: 'shots/opt17_walk/shot_p5_abyss_B_locked.png' });
const B5 = B && B.cards[4];
push('B1 勋章4（<6）→ L5 卡锁定', !!B5 && !B5.interactive && B5.alpha < 0.9,
  B5 ? `name=${B5.name} alpha=${B5.alpha} interactive=${B5.interactive} medals=${B && B.medals}` : 'no card5');
const B4 = B && B.cards[3];
push('B2 同场景 L4 卡仍解锁（req=0 不受门禁影响）', !!B4 && B4.interactive && B4.alpha > 0.9,
  B4 ? `name=${B4.name} interactive=${B4.interactive}` : 'no card4');

// ── 场景 C：continue 回退链（unlocked5 + 勋章4 → startGame 落 L4）──────
await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.closeLevelSelect();
  ms.startGame();
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.levelId != null;
}, null, { timeout: 15000 });
await page.waitForTimeout(600);
const C = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { levelId: gs.levelId, medals: window.__SAVE.countMedals() };
});
push('C1 continue 勋章不足 → 回退 L4（levelId===4）', C.levelId === 4,
  `levelId=${C.levelId} (unlocked5 + medals=${C.medals} <6 → L5 不可达)`);
push('P0. 全程无 pageerror/console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ P5 深渊回响·勋章门禁：${checks.length - fails.length}/${checks.length} ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
