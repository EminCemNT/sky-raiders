// qa_opt18_p2_menu_tabs.mjs —— OPT-18 P2 / U1 主菜单密度重构（三分组页签）验收探针
// ---------------------------------------------------------------------------
// 背景：主菜单原把 14 个按钮从 y=330 平铺到 y=928，底部一行（每日任务/排行榜，矩形底 957）
//       与底部「存档信息(y=916)」「操作提示(y=940)」文本带直接重叠，观感贴边压字。
// 重构：常驻（开始游戏 / 无尽模式 / 设置）+「战斗 / 养成 / 社交」三分组页签，
//       分组按钮一次性创建、切页签只改 visible 与 interactive。
//
// 探针断言：
//   1) 三分组页签按钮存在，文案 == Locale 的 menuTabBattle/menuTabGrowth/menuTabSocial
//   2) 默认页签 = battle；battle 组可见、growth/social 组 visible=false
//   3) 三组按钮数量 = 4 / 5 / 2；文案与分组表一致
//   4) 切换页签：目标组全可见 + 其余组全不可见；且隐藏组 input.enabled === false（不可命中）
//   5) 组内按钮中心 y 严格递增（无同槽位堆叠）
//   6) 常驻按钮（设置 / 开始游戏 / 无尽模式）在任意页签下均可见
//   7) 当前可见按钮两两矩形零重叠，且矩形底 ≤ 900（不侵入底部文本带）
//   8) 零 pageerror / console.error
// 运行：node qa_probes/qa_opt18_p2_menu_tabs.mjs（QA_URL 默认 5059）
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
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 30000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive() && ms._menuTabItems;
}, null, { timeout: 30000 });
await page.waitForTimeout(900);

// 期望页签文案（从 Locale 读，避免硬编码空格/全半角差异）
const expectTabs = await page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  const zh = (L && L.zh) || {};
  return { battle: zh.menuTabBattle, growth: zh.menuTabGrowth, social: zh.menuTabSocial };
});
const expectGroups = await page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  const zh = (L && L.zh) || {};
  return {
    battle: [zh.btnLevelSelect, zh.btnBossRush, null, zh.btnTutorial], // null = 本周活动（带动态活动名，另判）
    growth: [zh.btnHangar, zh.btnCodex, zh.btnAchievements, zh.btnNewbiePlan, zh.btnCheckin],
    social: [zh.btnLeaderboard, zh.btnDailyQuest],
  };
});

/** 读取当前菜单页签快照 */
const readMenu = () => page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const pick = (b) => ({
    label: b.text ? String(b.text.text) : '',
    visible: !!b.container.visible,
    inputEnabled: !!(b.container.input && b.container.input.enabled),
    x: b.container.x, y: b.container.y,
    w: b.container.width, h: b.container.height,
  });
  const groups = {};
  Object.entries(ms._menuTabItems || {}).forEach(([k, list]) => { groups[k] = list.map(pick); });
  const tabButtons = {};
  Object.entries(ms._menuTabButtons || {}).forEach(([k, b]) => { tabButtons[k] = pick(b); });
  // 场景内全部可见 neon-button（含常驻）
  const visibleButtons = [];
  ms.children.list.forEach((o) => {
    if (o && o.name === 'neon-button' && o.visible) {
      visibleButtons.push({ x: o.x, y: o.y, w: o.width, h: o.height, label: (() => {
        // Phaser Text 的字号在 style.fontSize（字符串 '20px'），不是顶层 .fontSize
        let lab = '';
        o.list.forEach((c) => {
          if (!c || typeof c.text !== 'string') return;
          const fs = c.style && c.style.fontSize ? parseInt(c.style.fontSize, 10) : NaN;
          if (!Number.isNaN(fs) && fs >= 16) lab = c.text;
        });
        return lab;
      })() });
    }
  });
  return { current: ms.menuTab, groups, tabButtons, visibleButtons };
});

/** 切换页签（模拟真实点击页签按钮） */
const switchTab = (key) => page.evaluate((k) => {
  window.__SKY__.scene.getScene('MenuScene')._menuTabButtons[k].container.emit('pointerdown');
}, key);

const snap0 = await readMenu();

// ── 1) 页签按钮存在 + 文案正确 + 默认 battle ──
push('三分组页签按钮存在（battle/growth/social）',
  !!(snap0.tabButtons.battle && snap0.tabButtons.growth && snap0.tabButtons.social),
  Object.keys(snap0.tabButtons).join(','));
push('页签文案 == Locale.menuTab*',
  snap0.tabButtons.battle.label === expectTabs.battle
  && snap0.tabButtons.growth.label === expectTabs.growth
  && snap0.tabButtons.social.label === expectTabs.social,
  `${snap0.tabButtons.battle.label} / ${snap0.tabButtons.growth.label} / ${snap0.tabButtons.social.label}`);
push('默认页签 = battle', snap0.current === 'battle', `menuTab=${snap0.current}`);

// ── 2) 分组按钮数量 ──
push('三组按钮数量 = 4 / 5 / 2',
  snap0.groups.battle.length === 4 && snap0.groups.growth.length === 5 && snap0.groups.social.length === 2,
  `battle=${snap0.groups.battle.length} growth=${snap0.groups.growth.length} social=${snap0.groups.social.length}`);

// ── 3) 分组文案与分组表一致 ──
const labelMatch = (group, expect) => expect.every((want, i) => {
  if (want === null) return /本周活动/.test(group[i].label);   // 动态活动名
  return group[i].label === want;
});
push('战斗组文案 = 选择关卡/BOSS RUSH/本周活动/新手教程',
  labelMatch(snap0.groups.battle, expectGroups.battle),
  snap0.groups.battle.map((b) => b.label).join(' | '));
push('养成组文案 = 机库/图鉴/成就/新手计划/每日签到',
  labelMatch(snap0.groups.growth, expectGroups.growth),
  snap0.groups.growth.map((b) => b.label).join(' | '));
push('社交组文案 = 排行榜/每日任务',
  labelMatch(snap0.groups.social, expectGroups.social),
  snap0.groups.social.map((b) => b.label).join(' | '));

// ── 4) 默认页签下：battle 可见、其余不可见且不可命中 ──
const onlyVisible = (groups, on) => Object.entries(groups).every(([k, list]) => list.every((b) => b.visible === (k === on)));
const hiddenNotHittable = (groups, on) => Object.entries(groups).every(([k, list]) => k === on || list.every((b) => b.inputEnabled === false));
push('默认 battle 页签：仅 battle 组可见', onlyVisible(snap0.groups, 'battle'),
  Object.entries(snap0.groups).map(([k, l]) => `${k}:${l.filter((b) => b.visible).length}/${l.length}`).join(' '));
push('默认 battle 页签：隐藏组不可命中（input.enabled=false）', hiddenNotHittable(snap0.groups, 'battle'));

// ── 5) 切换 growth / social ──
await switchTab('growth');
await page.waitForTimeout(220);
const snapG = await readMenu();
push('切 growth：仅 growth 组可见（5 项）',
  snapG.current === 'growth' && onlyVisible(snapG.groups, 'growth') && snapG.groups.growth.filter((b) => b.visible).length === 5,
  `visible=${snapG.groups.growth.filter((b) => b.visible).length} battleVisible=${snapG.groups.battle.filter((b) => b.visible).length}`);
push('切 growth：battle/social 组不可命中', hiddenNotHittable(snapG.groups, 'growth'));

await switchTab('social');
await page.waitForTimeout(220);
const snapS = await readMenu();
push('切 social：仅 social 组可见（2 项）',
  snapS.current === 'social' && onlyVisible(snapS.groups, 'social') && snapS.groups.social.filter((b) => b.visible).length === 2,
  `visible=${snapS.groups.social.filter((b) => b.visible).length}`);
push('切 social：battle/growth 组不可命中', hiddenNotHittable(snapS.groups, 'social'));

// 切回 battle 供后续几何检查（最满屏的页签）
await switchTab('battle');
await page.waitForTimeout(220);
const snapF = await readMenu();

// ── 6) 组内按钮中心 y 严格递增（无同槽位堆叠）──
const yAscending = (list) => list.every((b, i) => i === 0 || b.y > list[i - 1].y);
push('各组按钮中心 y 严格递增（无堆叠）',
  yAscending(snapF.groups.battle) && yAscending(snapF.groups.growth) && yAscending(snapF.groups.social),
  `battle=[${snapF.groups.battle.map((b) => b.y).join(',')}] growth=[${snapF.groups.growth.map((b) => b.y).join(',')}]`);

// ── 7) 常驻按钮在任意页签均可见 ──
const hasBtnWithLabel = (labels) => {
  const want = ['设置', '开始游戏', '无尽模式'];
  return want.every((w) => labels.some((l) => l && l.replace(/\s/g, '').includes(w.replace(/\s/g, ''))));
};
push('常驻按钮（设置/开始游戏/无尽模式）在当前页签可见',
  hasBtnWithLabel(snapF.visibleButtons.map((b) => b.label)),
  snapF.visibleButtons.map((b) => (b.label || '').replace(/\s/g, '')).join(' | '));

// ── 8) 可见按钮两两零重叠 + 矩形底 ≤ 900（不侵入底部文本带）──
const btns = snapF.visibleButtons;
const overlaps = [];
for (let i = 0; i < btns.length; i++) {
  for (let j = i + 1; j < btns.length; j++) {
    const a = btns[i], b = btns[j];
    if (a.x - a.w / 2 < b.x + b.w / 2 && a.x + a.w / 2 > b.x - b.w / 2
      && a.y - a.h / 2 < b.y + b.h / 2 && a.y + a.h / 2 > b.y - b.h / 2) {
      overlaps.push(`${a.label || `(${a.x},${a.y})`} ↔ ${b.label || `(${b.x},${b.y})`}`);
    }
  }
}
push('当前可见按钮两两矩形零重叠', overlaps.length === 0,
  overlaps.length ? overlaps.join(' | ') : `${btns.length} 个可见按钮零重叠`);

const maxBottom = btns.reduce((m, b) => Math.max(m, b.y + b.h / 2), 0);
push('可见按钮矩形底 ≤ 900（与存档信息 y=916 / 操作提示 y=940 留间隙）',
  maxBottom > 0 && maxBottom <= 900, `maxBottom=${maxBottom.toFixed(1)}`);

push('零 pageerror / console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'shots/opt18_p2_menu_tabs.png' });
console.log('📸 opt18_p2_menu_tabs.png');

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ OPT-18 P2 菜单页签：${checks.length - fails.length}/${checks.length} 通过 ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
