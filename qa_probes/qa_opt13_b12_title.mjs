// qa_opt13_b12_title.mjs —— OPT-13 批B B12 称号系统 验收探针
//
// 验证（规格：8 称号表 / 稀有度派生 / 只读纯派生 / 零新增存档字段）：
//   1) GameConfig.TITLES 存在 8 个称号，稀有度升序（common→legendary）
//   2) TitleSystem.getTitle(id) 命中 / 未知 id 返回 null
//   3) 全新号（无任何进度）：getUnlockedTitles=[] / getCurrentTitle=null（不报错）
//   4) levelStars 任意星级 → rookie（common）解锁，当前称号 = rookie
//   5) totalKills=500 → veteran（rare）解锁且覆盖 rookie（稀有度更高）
//   6) 同稀有度取表序前者：veteran+grazer 同时解锁 → 当前 = veteran
//   7) 成就 boss_all → slayer（epic）> rare
//   8) skyOverlord（legendary）：all_clear + medalCount≥6 + towerTop≥10 三者缺一不可
//   9) 零新增成就 id：TITLES 引用的 achievement 均为既有 26 个成就 id 之一
//  10) i18n：title_rookie…title_skyOverlord + titleNone 在 zh/en 两表均有值
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
await page.waitForFunction(() => !!(window.__SKY__), null, { timeout: 20000 });

// ── 1/2) 配置与派生逻辑（直接 import 模块，浏览器端跑真实代码）──
const core = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const ts = await import('/src/systems/TitleSystem.js');
  const loc = await import('/src/config/Locale.js');
  const am = await import('/src/systems/AchievementManager.js');

  // 1) 称号表：8 个 + 稀有度升序
  const order = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const titles = m.TITLES || [];
  const rarityAsc = titles.every((t, i) => i === 0 || order[titles[i - 1].rarity] <= order[t.rarity]);
  const rarityAscStrict = titles.every((t, i) => i === 0 || order[titles[i - 1].rarity] < order[t.rarity]);

  // 2) getTitle
  const getRookie = ts.TitleSystem.getTitle('rookie');
  const getUnknown = ts.TitleSystem.getTitle('not_a_title');

  // 3) 全新号
  const fresh = { levelStars: {}, totalKills: 0, achievements: {}, newbiePlan: { progress: {} }, towerTop: 0, medalCount: 0 };
  const freshUnlocked = ts.TitleSystem.getUnlockedTitles(fresh).length;
  const freshCurrent = ts.TitleSystem.getCurrentTitle(fresh);

  // 4) 任意星级 → rookie
  const withStar = { ...fresh, levelStars: { 1: 2 } };
  const starUnlocked = ts.TitleSystem.getUnlockedTitles(withStar).map((x) => x.id);
  const starCurrent = ts.TitleSystem.getCurrentTitle(withStar)?.id;

  // 5) totalKills=500 → veteran 覆盖 rookie
  const withKills = { ...fresh, levelStars: { 1: 2 }, totalKills: 500 };
  const killsCurrent = ts.TitleSystem.getCurrentTitle(withKills)?.id;
  const killsUnlocked = ts.TitleSystem.getUnlockedTitles(withKills).map((x) => x.id);

  // 6) 同稀有度取前者：veteran+grazer 同时解锁 → veteran
  const withRare = { ...withKills, newbiePlan: { progress: { grazes: 300 } } };
  const rareCurrent = ts.TitleSystem.getCurrentTitle(withRare)?.id;

  // 7) 成就 boss_all → slayer（epic）
  const withBoss = { ...withRare, achievements: { boss_all: true } };
  const bossCurrent = ts.TitleSystem.getCurrentTitle(withBoss)?.id;

  // 8) skyOverlord 三者缺一不可
  const sBase = { ...withKills, achievements: { all_clear: true } };
  const sNoMedal = ts.TitleSystem.getCurrentTitle({ ...sBase, towerTop: 12 })?.id; // 缺 medalCount
  const sNoTower = ts.TitleSystem.getCurrentTitle({ ...sBase, medalCount: 6 })?.id; // 缺 towerTop
  const sFull = ts.TitleSystem.getCurrentTitle({ ...sBase, medalCount: 6, towerTop: 12 })?.id;

  // 9) 引用成就 id 均为既有 id
  const existingAch = new Set((am.ACHIEVEMENTS || []).map((a) => a.id));
  const condAch = [];
  const collect = (c) => {
    if (!c) return;
    if (c.and) return c.and.forEach(collect);
    if (c.or) return c.or.forEach(collect);
    if (c.type === 'achievement') condAch.push(c.id);
  };
  titles.forEach((t) => collect(t.cond));
  const allAchKnown = condAch.every((id) => existingAch.has(id));

  // 10) i18n
  const zhKeys = Object.keys(loc.L.zh);
  const enKeys = Object.keys(loc.L.en);
  const i18nIds = titles.map((t) => `title_${t.id}`);
  const i18nOk = ['titleNone', ...i18nIds].every((k) => zhKeys.includes(k) && enKeys.includes(k));

  return {
    count: titles.length,
    ids: titles.map((t) => t.id),
    rarities: titles.map((t) => t.rarity),
    rarityAsc, rarityAscStrict,
    getRookie: getRookie && getRookie.id,
    getUnknown,
    freshUnlocked, freshCurrent,
    starUnlocked, starCurrent,
    killsCurrent, killsUnlocked,
    rareCurrent,
    bossCurrent,
    sNoMedal, sNoTower, sFull,
    allAchKnown, condAch,
    i18nOk,
  };
});

push('TITLES 含 8 个称号', core.count === 8, `count=${core.count} ids=${core.ids.join(',')}`);
push('稀有度升序排列', core.rarityAsc, core.rarities.join('>'));
push('getTitle(rookie) 命中 / 未知 id → null',
  core.getRookie === 'rookie' && core.getUnknown === null);
push('全新号 getCurrentTitle=null 且不报错', core.freshUnlocked === 0 && core.freshCurrent === null,
  `unlocked=${core.freshUnlocked} current=${core.freshCurrent}`);
push('任意星级 → rookie 解锁且为当前称号',
  core.starUnlocked.includes('rookie') && core.starCurrent === 'rookie',
  `current=${core.starCurrent} unlocked=${core.starUnlocked.join(',')}`);
push('totalKills=500 → veteran（rare）覆盖 rookie',
  core.killsUnlocked.includes('veteran') && core.killsCurrent === 'veteran',
  `current=${core.killsCurrent} unlocked=${core.killsUnlocked.join(',')}`);
push('同稀有度取表序前者：veteran+grazer → veteran', core.rareCurrent === 'veteran', `current=${core.rareCurrent}`);
push('成就 boss_all → slayer（epic）> rare', core.bossCurrent === 'slayer', `current=${core.bossCurrent}`);
push('skyOverlord 三者缺一不可（legendary）',
  core.sNoMedal !== 'skyOverlord' && core.sNoTower !== 'skyOverlord' && core.sFull === 'skyOverlord',
  `noMedal=${core.sNoMedal} noTower=${core.sNoTower} full=${core.sFull}`);
push('TITLES 引用成就 id 均为既有 26 个成就', core.allAchKnown, `refs=${core.condAch.join(',')}`);
push('i18n zh/en 均有 title_* + titleNone', core.i18nOk);

// ── 2/2) 结算页真实展示：起一局并快速通关到 ResultScene，断言称号行文本 ──
// 直接构造结果场景：切到 ResultScene 并注入 result，读取称号文本节点。
const ui = await page.evaluate(async () => {
  const g = window.__SKY__;
  const sm = await import('/src/utils/SaveManager.js');
  // 用"有星级 + 有击杀"的存档态，确保 rookie 解锁、结算页出现称号行
  sm.SaveManager.load().levelStars = { 1: 1 };
  sm.SaveManager.load().totalKills = 50;
  const before = await import('/src/systems/TitleSystem.js');
  const cur = before.TitleSystem.getCurrentTitle(sm.SaveManager.load());
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const s = g.scene.getScene(k);
    if (s && s.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('ResultScene', { mode: 'normal', levelId: 1, victory: true, score: 1234, stars: 2, kills: 50, coins: 100 });
  return { curId: cur && cur.id, curName: cur ? (await import('/src/config/Locale.js')).t('title_' + cur.id) : null };
});
await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive();
}, { timeout: 20000 });
const shown = await page.evaluate(async () => {
  const g = window.__SKY__;
  const rs = g.scene.getScene('ResultScene');
  const txts = rs.children.list
    .filter((c) => c && c.type === 'Text')
    .map((c) => c.text || '');
  return { txts };
});
const titleVisible = shown.txts.some((s) => String(s).includes(ui.curName));
push('结算页展示当前称号行（rookie）', ui.curId === 'rookie' && titleVisible,
  `title=${ui.curName} found=${titleVisible}`);

// 全链路零 pageerror / console.error
push('零 pageerror / console error', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n==== B12 探针结果：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join(' ; '));
  process.exit(1);
}
