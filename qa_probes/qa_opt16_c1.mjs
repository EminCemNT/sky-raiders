// qa_opt16_c1.mjs —— OPT-16 批2 C1 难度门禁（勋章阈值解锁困难/地狱）验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C1 条。断言真实运行行为：
//   C1.1  勋章 < MEDALS.THRESHOLD 时点击 hard/hell → 拦截（selectedDifficulty 不变）+ 弹锁定提示
//   C1.2  提示正文 = 还差 n 枚（n=6-当前），与 countMedals() 同口径
//   C1.3  存量豁免：老档 selectedDifficulty='hard' + 勋章不足 → openSettings 仅高亮不拦截
//   C1.4  casual/standard 任意勋章数均可点（不拦截）
//   C1.5  勋章 ≥ THRESHOLD 后点击 hard → 正常写入 selectedDifficulty
//   C1.6  提示主按钮「去关卡面板」→ closeSettings + openLevelSelect
//   C1.7  zh/en 文案均正常；零新增存档字段；无 console 报错
// 运行：node qa_probes/qa_opt16_c1.mjs（QA_URL 默认 http://127.0.0.1:5059）
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';
const THRESHOLD = 6;

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

// 打开设置面板（先关旧面板防重复叠层）；返回难度按钮是否就绪
async function openSettings(page) {
  return page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    if (!ms || typeof ms.openSettings !== 'function') return false;
    if (ms.settingsOpen) ms.closeSettings();
    ms.openSettings();
    return !!(ms._difficultyBtns && ms._difficultyBtns.length);
  });
}

// 模拟点击某档难度按钮（NeonButton container 的 pointerdown 监听 = 真实按钮行为）
async function clickDifficulty(page, id) {
  return page.evaluate((id) => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    const entry = (ms._difficultyBtns || []).find((e) => e.id === id);
    if (!entry) return false;
    entry.btn.container.emit('pointerdown');
    return true;
  }, id);
}

// 读取设置/门禁当前状态
async function readState(page) {
  return page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    const s = window.__SAVE.load();
    const locked = ms._diffLockedOv;
    const texts = locked
      ? (locked.list || []).filter((o) => o && typeof o.text === 'string').map((o) => String(o.text))
      : [];
    const hardEntry = (ms._difficultyBtns || []).find((e) => e.id === 'hard');
    return {
      selectedDifficulty: s.selectedDifficulty || 'standard',
      lockedVisible: !!(locked && locked.visible),
      lockedTexts: texts,
      hardSelected: !!(hardEntry && hardEntry.btn.selected),
      settingsOpen: !!ms.settingsOpen,
      levelSelectOpen: !!ms.levelSelectOpen,
      medals: window.__SAVE.countMedals(),
    };
  });
}

// 在锁定提示容器内按文案找按钮并点击（NeonButton container.name = 'neon-button'）
async function clickLockedButton(page, label) {
  return page.evaluate((label) => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    const ov = ms._diffLockedOv;
    if (!ov) return false;
    const list = ov.list || [];
    for (const child of list) {
      if (child && child.name === 'neon-button') {
        const txt = (child.list || []).find((o) => o && typeof o.text === 'string');
        if (txt && txt.text === label) { child.emit('pointerdown'); return true; }
      }
    }
    return false;
  }, label);
}

// 读词条模板并替换 {n}（与页面 t() 一致：{n} → need）
async function renderedText(page, lang, key, params = {}) {
  return page.evaluate(async ({ lang, key, params }) => {
    const { L } = await import('/src/config/Locale.js');
    const table = L[lang] || L.zh || {};
    let tpl = table[key] != null ? String(table[key]) : '';
    Object.keys(params).forEach((k) => { tpl = tpl.split('{' + k + '}').join(String(params[k])); });
    return tpl;
  }, { lang, key, params });
}

// ═══════════════ A：zh 上下文（0 勋章）═══
const A = await launchPage({ lang: 'zh', selectedDifficulty: 'casual', levelMedals: {}, coins: 0, unlockedLevel: 1 });
const zhTitle = await renderedText(A.page, 'zh', 'diffLockedTitle');
const zhNeed = await renderedText(A.page, 'zh', 'diffLockedNeed', { n: THRESHOLD });
const zhHint = await renderedText(A.page, 'zh', 'diffLockedHint');

await openSettings(A.page);
let st = await readState(A.page);
push('A0. 0勋章档 openSettings → casual 高亮', st.hardSelected === false && st.selectedDifficulty === 'casual', `sel=${st.selectedDifficulty}`);

// C1.1 拦截 hard
const clickedHard = await clickDifficulty(A.page, 'hard');
st = await readState(A.page);
push('C1.1. 勋章不足点击 hard → selectedDifficulty 不变(casual)', clickedHard && st.selectedDifficulty === 'casual', `sel=${st.selectedDifficulty}`);
push('C1.1. 勋章不足点击 hard → 弹出锁定提示', st.lockedVisible, `medals=${st.medals}`);
push('C1.1. 锁定提示标题 zh 正确', st.lockedTexts.includes(zhTitle), `title=${zhTitle}`);
push('C1.2. 锁定提示正文 = 还差 {n} 枚（含 6）', st.lockedTexts.some((s) => s.includes('6') && s.includes('勋章')), `texts=${JSON.stringify(st.lockedTexts)}`);
push('C1.1. 拦截后 hard 未高亮（当前档不变）', st.hardSelected === false);

// C1.6 主按钮 → 关卡面板
const goClicked = await clickLockedButton(A.page, zhHint);
st = await readState(A.page);
push('C1.6. 主按钮「前往关卡面板」→ 关设置', goClicked && st.settingsOpen === false, `settingsOpen=${st.settingsOpen}`);
push('C1.6. 主按钮 → 打开关卡面板（看勋章目标）', st.levelSelectOpen === true, `levelSelectOpen=${st.levelSelectOpen}`);
await A.page.evaluate(() => { const ms = window.__SKY__.scene.getScene('MenuScene'); if (ms && ms.closeLevelSelect) ms.closeLevelSelect(); });
await new Promise((r) => setTimeout(r, 100));

// C1.4 0勋章：casual/standard 自由点
await openSettings(A.page);
await clickDifficulty(A.page, 'standard');
st = await readState(A.page);
push('C1.4. 0勋章点击 standard → 正常写入且无拦截', st.lockedVisible === false && st.selectedDifficulty === 'standard', `sel=${st.selectedDifficulty}`);
await clickDifficulty(A.page, 'casual');
st = await readState(A.page);
push('C1.4. 0勋章点击 casual → 正常写入且无拦截', st.lockedVisible === false && st.selectedDifficulty === 'casual', `sel=${st.selectedDifficulty}`);

// C1.1 拦截 hell 同样
await clickDifficulty(A.page, 'hell');
st = await readState(A.page);
push('C1.1. 勋章不足点击 hell → 同样拦截', st.lockedVisible && st.selectedDifficulty === 'casual', `sel=${st.selectedDifficulty}`);
// 关掉 hell 锁定提示
await clickLockedButton(A.page, zhHint);
await new Promise((r) => setTimeout(r, 100));

// C1.5 勋章 ≥6 解锁
await A.page.evaluate(() => {
  window.__SAVE.set('levelMedals', { 1: ['a1', 'a2', 'a3'], 2: ['b1', 'b2', 'b3'] });
  window.__SAVE.countMedals();
});
await openSettings(A.page);
await clickDifficulty(A.page, 'hard');
st = await readState(A.page);
push('C1.5. 勋章≥6 点击 hard → 正常写入 hard 且无拦截', st.lockedVisible === false && st.selectedDifficulty === 'hard' && st.hardSelected === true, `sel=${st.selectedDifficulty} medals=${st.medals}`);

// C1.7a 零新增存档字段
const saveAudit = await A.page.evaluate(() => {
  const s = window.__SAVE.load();
  const keys = Object.keys(s).sort();
  const bad = keys.filter((k) => k.startsWith('c1') || k.includes('diffLocked') || k.includes('DiffLocked'));
  return { hasBad: bad.length > 0, selectedDifficulty: s.selectedDifficulty, keyCount: keys.length };
});
push('C1.7. 零新增存档字段（无 c1*/diffLocked* 键）', saveAudit.hasBad === false, `keys=${saveAudit.keyCount} sel=${saveAudit.selectedDifficulty}`);
push('P0. zh 上下文无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
await A.ctx.close();

// ═══════════════ B：存量豁免 C1.3（zh，老档 hard + 0 勋章）═══
const B = await launchPage({ lang: 'zh', selectedDifficulty: 'hard', levelMedals: {}, coins: 0, unlockedLevel: 1 });
await openSettings(B.page);
const bSt = await readState(B.page);
push('C1.3. 老档 hard + 勋章不足 → openSettings hard 高亮', bSt.hardSelected === true && bSt.selectedDifficulty === 'hard', `sel=${bSt.selectedDifficulty} medals=${bSt.medals}`);
push('C1.3. 老档 hard + 勋章不足 → 打开设置无拦截提示', bSt.lockedVisible === false, `lockedVisible=${bSt.lockedVisible}`);
// 新点击 hard 时仍拦（存量豁免只豁免展示/已存值，不豁免新选择）
await clickDifficulty(B.page, 'hell');
const bSt2 = await readState(B.page);
push('C1.3. 存量老档新点 hell(勋章仍不足) → 仍拦截且不改变已存 hard', bSt2.lockedVisible && bSt2.selectedDifficulty === 'hard', `sel=${bSt2.selectedDifficulty}`);
push('P0. zh 存量上下文无 pageerror/console.error', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));
await B.ctx.close();

// ═══════════════ C：en 上下文（0 勋章）═══
const C = await launchPage({ lang: 'en', selectedDifficulty: 'standard', levelMedals: {}, coins: 0, unlockedLevel: 1 });
const enTitle = await renderedText(C.page, 'en', 'diffLockedTitle');
const enHint = await renderedText(C.page, 'en', 'diffLockedHint');
await openSettings(C.page);
await clickDifficulty(C.page, 'hell');
const cSt = await readState(C.page);
push('C1.7. en 勋章不足点击 hell → 拦截弹英文提示', cSt.lockedVisible && cSt.lockedTexts.includes(enTitle) && cSt.selectedDifficulty === 'standard', `title=${enTitle}`);
const goEn = await clickLockedButton(C.page, enHint);
const cSt2 = await readState(C.page);
push('C1.6. en 主按钮 → 打开关卡面板', goEn && cSt2.levelSelectOpen === true && cSt2.settingsOpen === false, `levelSelectOpen=${cSt2.levelSelectOpen}`);
push('P0. en 上下文无 pageerror/console.error', C.errors.length === 0, C.errors.slice(0, 3).join(' | '));
await C.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C1 难度门禁探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
