// qa_opt17_overlay_dim.mjs —— OPT-17 B 批 P2 防回归探针（modal 遮罩 alpha 必须 ≥0.85）
// ---------------------------------------------------------------------------
// 背景：截图复盘发现打开 overlay 面板（每日任务/关卡选择/成就/签到 等）时，
// 主菜单霓虹亮色按钮文字透过 0.55~0.82 alpha 半透明遮罩与面板内容视觉竞争。
// 修复：12 处 dim rect alpha 统一 0.90。
// 探针：真实点击路径打开各面板 → 量 dim fillAlpha → 断言 ≥0.85（防未来回退到 0.7x 透出霓虹）。
// OPT-18 P2 / U1：主菜单改为「战斗/养成/社交」三分组页签，入口坐标全变且部分入口不在默认页签，
//                故点击路径升级为「先点页签 → 再点组内槽位」（见 clickMenuEntry / SLOT 表）。
// 运行：node qa_probes/qa_opt17_overlay_dim.mjs（QA_URL 默认 5059，run-all 托管）
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

async function newPage() {
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
  return { ctx, page, errors };
}

async function measureDim(page, panelGetter) {
  // 确保无残留 overlay
  await page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    ['closeSettings','closeLevelSelect','closeAchievements','closeCheckIn','closeDailyQuest',
     'closeCodex','closeNewbiePlan','closeLeaderboard','closeReturnGift','closeEvent']
      .forEach((fn) => { try { ms[fn] && ms[fn](); } catch (e) {} });
  });
  await page.waitForTimeout(150);
  await panelGetter(page);
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    let dimAlpha = -1;
    let panelExists = false;
    // 扫 MenuScene 所有 overlay 容器内的全屏 dim rect
    const ovKeys = ['settingsOverlay','levelSelectOverlay','achievementsOverlay','checkinOverlay',
      'dailyQuestOverlay','codexOverlay','newbiePlanOverlay','leaderboardOverlay','returnGiftOverlay','eventOverlay'];
    const walk = (c) => {
      if (!c || !c.list || dimAlpha >= 0) return;
      c.list.forEach((o) => {
        if (o && o.geom && o.geom.width >= 500 && o.geom.height >= 900 && o.fillAlpha != null) {
          dimAlpha = o.fillAlpha;
        }
        if (o && o.list) walk(o);
      });
    };
    for (const k of ovKeys) {
      const ov = ms[k];
      if (ov) {
        panelExists = true;
        walk(ov);
      }
    }
    return { dimAlpha, panelExists };
  });
}

const A = await newPage();

// OPT-18 P2 / U1：主菜单改为「战斗 / 养成 / 社交」三分组页签后，入口坐标全部改变，
// 且部分入口已不在默认页签。故改为**真实玩家路径**：先点页签，再点组内槽位。
// 页签栏 y=432、三个页签 x=110/270/430；分组槽位 y = 512 + i*82（i 为组内序号）。
const TAB_X = { battle: 110, growth: 270, social: 430 };
const TAB_Y = 432, SLOT_Y0 = 512, SLOT_GAP = 82;
// 组内槽位表（与 MenuScene._buildMenuTabs 的分组顺序一一对应）
const SLOT = {
  levelSelect: { tab: 'battle', i: 0 },
  bossRush: { tab: 'battle', i: 1 },
  weeklyEvent: { tab: 'battle', i: 2 },
  tutorial: { tab: 'battle', i: 3 },
  hangar: { tab: 'growth', i: 0 },
  codex: { tab: 'growth', i: 1 },
  achievements: { tab: 'growth', i: 2 },
  newbiePlan: { tab: 'growth', i: 3 },
  checkin: { tab: 'growth', i: 4 },
  leaderboard: { tab: 'social', i: 0 },
  dailyQuest: { tab: 'social', i: 1 },
};
/** 真实玩家路径：先点页签，再点组内槽位 */
async function clickMenuEntry(page, key) {
  const s = SLOT[key];
  await page.mouse.click(TAB_X[s.tab], TAB_Y);
  await page.waitForTimeout(180);
  await page.mouse.click(270, SLOT_Y0 + s.i * SLOT_GAP);
  await page.waitForTimeout(120);
}

// 第 1 关：每日任务（社交页签 · 第 2 槽）
const dq = await measureDim(A.page, (p) => clickMenuEntry(p, 'dailyQuest'));
push('每日任务面板 dim alpha ≥0.85', dq.panelExists && dq.dimAlpha >= 0.85, `alpha=${dq.dimAlpha} panel=${dq.panelExists}`);

// 第 2 关：关卡选择（战斗页签 · 第 1 槽）
const ls = await measureDim(A.page, (p) => clickMenuEntry(p, 'levelSelect'));
push('关卡选择面板 dim alpha ≥0.85', ls.panelExists && ls.dimAlpha >= 0.85, `alpha=${ls.dimAlpha} panel=${ls.panelExists}`);

// 第 3 关：成就（养成页签 · 第 3 槽）
const ach = await measureDim(A.page, (p) => clickMenuEntry(p, 'achievements'));
push('成就面板 dim alpha ≥0.85', ach.panelExists && ach.dimAlpha >= 0.85, `alpha=${ach.dimAlpha} panel=${ach.panelExists}`);

// 第 4 关：每日签到（养成页签 · 第 5 槽）
const ci = await measureDim(A.page, (p) => clickMenuEntry(p, 'checkin'));
push('每日签到面板 dim alpha ≥0.85', ci.panelExists && ci.dimAlpha >= 0.85, `alpha=${ci.dimAlpha} panel=${ci.panelExists}`);

// 截图留档
await A.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ['closeCheckIn','closeLevelSelect','closeAchievements','closeDailyQuest'].forEach((fn) => { try { ms[fn] && ms[fn](); } catch (e) {} });
});
await A.page.waitForTimeout(200);
await clickMenuEntry(A.page, 'dailyQuest'); // 开每日任务面板（社交页签 · 第 2 槽）
await A.page.waitForTimeout(400);
await A.page.screenshot({ path: 'shots/b_diag_p2_after.png' });

push('P0. 无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ overlay dim 防回归：${checks.length - fails.length}/${checks.length} ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
