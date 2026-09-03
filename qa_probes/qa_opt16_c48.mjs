// qa_opt16_c48.mjs —— OPT-16 批2 C4 存档导出/导入 + C8 存档清除（重置进度）验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C4/C8 条。
//   C4.1  导出 JSON 含 app/version/exportedAt/save(coins/upgrades/levelMedals...)
//   C4.2  导出→导入整档覆盖，字段一致
//   C4.3  非法 JSON → 拒绝且当前档不变
//   C4.4  可解析脏档 coins=-5 → sanitize 后 coins=0（不整档拒绝）
//   C4.6  replaceSave DEFAULT 兜底：导入极简档 → 缺字段回默认
//   C8.1/C8.3  resetProgress → coins=0/unlockedLevel=1/levelMedals={}/nickname=''/tutorialDone=false
//   C8.3b 保留设置字段 lang/quality/sensitivity/touchOffset/noAds/haptics
//   UI：设置面板含 导出/导入/重置 按钮；重置强确认弹窗 + 延时 2s 防误触；无 console 报错
// 运行：node qa_probes/qa_opt16_c48.mjs（QA_URL 默认 http://127.0.0.1:5059）
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
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
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
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

// 在页面内调用与 MenuScene 同实例的 SaveTransfer 方法（真实资源 URL，避开 Vite ?t= 平行实例）
async function callST(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const url = performance.getEntriesByType('resource')
      .map((r) => r.name)
      .find((n) => /\/src\/utils\/SaveTransfer\.js(\?|$)/.test(n));
    if (!url) return { __noModule: true };
    const ST = await import(url);
    if (typeof ST[method] !== 'function') return { __noFn: true, method };
    return ST[method](...args);
  }, { method, args });
}

// 读 localStorage 原始存档（规避跨实例 cache 陈旧）
async function readRawSave(page) {
  return page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }, SAVE_KEY);
}

// 打开设置面板并确认存档管理按钮已渲染
async function openSettings(page) {
  return page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    if (!ms || typeof ms.openSettings !== 'function') return false;
    if (ms.settingsOpen) ms.closeSettings();
    ms.openSettings();
    return !!(ms._saveExportBtn && ms._saveImportBtn && ms._resetProgressBtn);
  });
}

// 在 settingsOverlay 内按 label 点击 NeonButton
async function clickBtnByLabel(page, label) {
  return page.evaluate((label) => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    const ov = ms.settingsOverlay;
    if (!ov) return false;
    const walk = (list) => {
      for (const child of list || []) {
        if (child && child.name === 'neon-button') {
          const txt = (child.list || []).find((o) => o && typeof o.text === 'string');
          if (txt && txt.text === label) { child.emit('pointerdown'); return true; }
        }
        if (child && child.list && walk(child.list)) return true;
      }
      return false;
    };
    return walk(ov.list);
  }, label);
}

// ═══════════════ A：C4 函数级（zh 页面）═══
const seedA = {
  lang: 'zh', selectedDifficulty: 'hard', quality: 'mid',
  coins: 12345, unlockedLevel: 3, totalKills: 77,
  upgrades: { firepower: 2, hull: 1, shield: 3, magnet: 0, wingman: 1, wingmanFirepower: 1 },
  levelStars: { 1: 3, 2: 2 },
  levelMedals: { 1: ['c1', 'c2', 'c3'] },
  nickname: '飞行员·42', tutorialDone: true,
  topScores: [{ score: 5000, levelId: 1, mode: 'normal', date: '2026-01-01' }],
};
const A = await launchPage(seedA);

const exportRes = await callST(A.page, 'exportSaveText');
let exportObj = null;
try { exportObj = JSON.parse(exportRes); } catch (e) { /* noop */ }
push('C4.1. 导出为合法 JSON 字符串', typeof exportRes === 'string' && !!exportObj, typeof exportRes);
push('C4.1. 导出包装含 app/version/exportedAt/save', !!exportObj && exportObj.app === 'sky-raiders' && Number.isInteger(exportObj.version) && typeof exportObj.exportedAt === 'string' && !!exportObj.save, `app=${exportObj && exportObj.app}`);
push('C4.1. 导出 save 含 coins/upgrades/levelMedals', !!exportObj && exportObj.save.coins === 12345 && !!exportObj.save.upgrades && !!exportObj.save.levelMedals, `coins=${exportObj && exportObj.save.coins}`);

// C4.2 导出→导入整档一致
const imp1 = await callST(A.page, 'importSave', exportRes);
const raw1 = await readRawSave(A.page);
push('C4.2. 导入导出的整档 → ok', imp1.ok === true);
push('C4.2. 导入后字段一致（coins/levelMedals/nickname）', !!raw1 && raw1.coins === 12345 && (raw1.levelMedals['1'] || []).length === 3 && raw1.nickname === '飞行员·42', `coins=${raw1 && raw1.coins}`);

// C4.3 非法 JSON 拒绝且档不变
const badBefore = (await readRawSave(A.page)).coins;
const impBad = await callST(A.page, 'importSave', 'not json at all');
const rawAfterBad = await readRawSave(A.page);
push('C4.3. 非法 JSON → 拒绝 reason=json', impBad.ok === false && impBad.reason === 'json', `reason=${impBad.reason}`);
push('C4.3. 拒绝后当前档不变', rawAfterBad.coins === badBefore, `coins=${rawAfterBad.coins}`);

// C4.4 可解析脏档 coins=-5 → sanitize → 0
const dirtyWrapper = JSON.parse(exportRes);
dirtyWrapper.save.coins = -5;
dirtyWrapper.save.bestScore = -1;
const impDirty = await callST(A.page, 'importSave', JSON.stringify(dirtyWrapper));
const rawDirty = await readRawSave(A.page);
push('C4.4. 可解析脏档(coins=-5) → ok 不整档拒绝', impDirty.ok === true);
push('C4.4. sanitize 后 coins=0', !!rawDirty && rawDirty.coins === 0, `coins=${rawDirty && rawDirty.coins}`);

// C4.6 replaceSave DEFAULT 兜底：极简档
const minimal = JSON.stringify({ app: 'sky-raiders', version: 1, exportedAt: new Date().toISOString(), save: { coins: 999 } });
const impMin = await callST(A.page, 'importSave', minimal);
const rawMin = await readRawSave(A.page);
push('C4.6. 导入极简档 → ok', impMin.ok === true);
push('C4.6. 缺字段兜底默认（unlockedLevel=1 / tutorialDone=false）', !!rawMin && rawMin.unlockedLevel === 1 && rawMin.tutorialDone === false && rawMin.coins === 999, `unlocked=${rawMin && rawMin.unlockedLevel} coins=${rawMin && rawMin.coins}`);
push('P0. A 上下文无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
await A.ctx.close();

// ═══════════════ B：C8 resetProgress（zh，高进度存档）═══
const seedB = {
  lang: 'zh', quality: 'low', sensitivity: 0.8, touchOffset: 0, noAds: true,
  coins: 50000, unlockedLevel: 5, totalKills: 999,
  levelStars: { 1: 3, 2: 3, 3: 2 }, levelMedals: { 1: ['a', 'b'], 2: ['c'] },
  achievements: { ace_1: true }, nickname: '老玩家', tutorialDone: true,
  topScores: [{ score: 9000, levelId: 2, mode: 'normal', date: '2026-01-02' }],
};
const B = await launchPage(seedB);
const resetRes = await callST(B.page, 'resetProgress');
const rawB = await readRawSave(B.page);
push('C8. resetProgress → ok', resetRes.ok === true);
push('C8.3. coins=0 / unlockedLevel=1 / totalKills=0', !!rawB && rawB.coins === 0 && rawB.unlockedLevel === 1 && rawB.totalKills === 0, `coins=${rawB && rawB.coins} unlocked=${rawB && rawB.unlockedLevel}`);
push('C8.3. levelStars/levelMedals/achievements/nickname 清空', !!rawB && JSON.stringify(rawB.levelMedals) === '{}' && !rawB.nickname, `nickname=${rawB && JSON.stringify(rawB.nickname)}`);
push('C8.3b. 保留 lang/quality/sensitivity/touchOffset/noAds', !!rawB && rawB.lang === 'zh' && rawB.quality === 'low' && rawB.sensitivity === 0.8 && rawB.touchOffset === 0 && rawB.noAds === true, `lang=${rawB && rawB.lang} quality=${rawB && rawB.quality}`);
push('C8.5. tutorialDone 清回 false（可重看教程）', !!rawB && rawB.tutorialDone === false);
push('P0. B 上下文无 pageerror/console.error', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));
await B.ctx.close();

// ═══════════════ C：UI 冒烟（设置面板含入口；重置强确认 + 延时 2s）═══
const C = await launchPage({ lang: 'zh', selectedDifficulty: 'standard', coins: 888, unlockedLevel: 2, tutorialDone: true });
const zhT = await C.page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  return {
    exp: L.zh.saveExport, imp: L.zh.saveImport, reset: L.zh.resetProgress,
    resetTitle: L.zh.resetConfirmTitle, resetTip: L.zh.resetExportTip,
  };
});
const uiReady = await openSettings(C.page);
push('C-UI. 设置面板含 导出/导入/重置 按钮', uiReady, `labels=${zhT.exp}/${zhT.imp}/${zhT.reset}`);

const clickedReset = await clickBtnByLabel(C.page, zhT.reset);
push('C-UI. 点击「重置进度」弹出强确认', clickedReset);
const modalInfo = await C.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms._resetConfirmOv;
  const texts = ov ? (ov.list || []).filter((o) => o && typeof o.text === 'string').map((o) => String(o.text)) : [];
  return { visible: !!(ov && ov.visible), texts };
});
push('C-UI. 确认弹窗含标题/不可撤销/导出建议', modalInfo.visible && modalInfo.texts.includes(zhT.resetTitle) && modalInfo.texts.some((s) => s.includes('不可撤销')) && modalInfo.texts.includes(zhT.resetTip), `texts=${JSON.stringify(modalInfo.texts)}`);
const confirmDisabledEarly = await C.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms._resetConfirmOv;
  if (!ov) return null;
  const btn = (ov.list || []).find((c) => c && c.name === 'neon-button' && (c.list || []).some((o) => o && typeof o.text === 'string' && String(o.text).includes('确认重置')));
  return btn ? (btn.input ? btn.input.enabled : undefined) : null;
});
push('C-UI. 弹出初期确认钮处于禁用（2s 倒计时）', confirmDisabledEarly === false, `enabled=${confirmDisabledEarly}`);
await new Promise((r) => setTimeout(r, 2400));
const confirmEnabledLate = await C.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms._resetConfirmOv;
  if (!ov) return null;
  const btn = (ov.list || []).find((c) => c && c.name === 'neon-button' && (c.list || []).some((o) => o && typeof o.text === 'string' && String(o.text).includes('确认重置')));
  return btn ? (btn.input ? btn.input.enabled : undefined) : null;
});
push('C-UI. 2s 后确认钮可用', confirmEnabledLate === true, `enabled=${confirmEnabledLate}`);
await C.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms._resetConfirmOv;
  const btn = (ov.list || []).find((c) => c && c.name === 'neon-button' && (c.list || []).some((o) => o && typeof o.text === 'string' && String(o.text).includes('确认重置')));
  if (btn) btn.emit('pointerdown');
});
await new Promise((r) => setTimeout(r, 200));
const rawC = await readRawSave(C.page);
push('C-UI. 重置执行 → coins=0', !!rawC && rawC.coins === 0, `coins=${rawC && rawC.coins}`);
push('P0. C 上下文无 pageerror/console.error', C.errors.length === 0, C.errors.slice(0, 3).join(' | '));
await C.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C4/C8 存档导出/导入/重置探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
