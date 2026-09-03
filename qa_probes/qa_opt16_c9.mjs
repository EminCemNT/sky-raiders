// qa_opt16_c9.mjs —— OPT-16 批1 C9 主菜单轮换战术提示 验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C9 条。断言真实运行行为：
//   C9.1  新档（tutorialDone=false）进主菜单 → 顶部 tips 显示 novice 池词条
//   C9.2  置 tutorialDone=true 重进菜单 → 显示 advanced 池词条（分流，只读不写档）
//   C9.3  点击 tips（下一条）→ 顺序换到池内下一条且文案变化
//   C9.5  空池 / 词条缺失 → 静默隐藏该行，无 console 报错，不影响其它 UI
//   C9.6  切 en → 显示英文 advanced 词条
//   C9.7  纯展示零业务：不新增存档字段 / 不改 tutorialDone
// 运行：node qa_probes/qa_opt16_c9.mjs（QA_URL 默认 http://127.0.0.1:5059）
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const NOVICE_KEYS = ['tip_nov_mov', 'tip_nov_shot', 'tip_nov_focus', 'tip_nov_bomb', 'tip_nov_shield', 'tip_nov_power', 'tip_nov_graze', 'tip_nov_coin'];
const ADV_KEYS = ['tip_adv_grazeEnergy', 'tip_adv_combo', 'tip_adv_element', 'tip_adv_magnet', 'tip_adv_tower', 'tip_adv_medal', 'tip_adv_overcharge', 'tip_adv_skill'];

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
      return ms && ms.scene.isActive() && ms.tipText;
    }, { timeout: 20000 });
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error('launchPage timeout: ' + errors.slice(0, 3).join(' | ') || '(no console error)');
  }
  return { ctx, page, errors };
}

// 读当前 tips 文本 + 可见性
async function readTip(page) {
  return page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    const tip = ms && ms.tipText;
    return {
      exists: !!tip,
      visible: !!(tip && tip.visible),
      text: tip ? String(tip.text) : '',
    };
  });
}

// 重启 MenuScene（重跑 create → _renderTip），返回后等待稳定
async function restartMenu(page) {
  await page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    if (ms && ms.scene && ms.scene.restart) ms.scene.restart();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.waitForFunction(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    return ms && ms.scene.isActive() && ms.tipText;
  }, null, { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 120));
}

// 改 MenuScene 可见 TIPS.advanced（经真实模块 URL，避开 Vite ?t= 平行实例）
async function mutateTipsAdvanced(page, value) {
  await page.evaluate((v) => (async () => {
    const url = performance.getEntriesByType('resource')
      .map((r) => r.name)
      .find((n) => /\/src\/config\/GameConfig\.js(\?|$)/.test(n));
    if (!url) return false;
    const cfg = await import(url);
    cfg.TIPS.advanced = v;
    return true;
  })(), value);
}

// 词条翻译表（页面内读 Locale，路径与源码模块单例一致）
async function readTranslations(page, lang, keys) {
  return page.evaluate(async ({ lang, keys }) => {
    const { L } = await import('/src/config/Locale.js');
    const table = L[lang] || L.zh || {};
    return keys.map((k) => table[k]);
  }, { lang, keys });
}

// ═══════════════ 1) C9.1 新档 novice 池 ═══════════════
const zhCtx = await launchPage({ lang: 'zh', tutorialDone: false, coins: 0 });
const novTr = await readTranslations(zhCtx.page, 'zh', NOVICE_KEYS);
const advTr = await readTranslations(zhCtx.page, 'zh', ADV_KEYS);
const nov1 = await readTip(zhCtx.page);
push('C9.1. 新档主菜单存在顶部 tips 且可见', nov1.exists && nov1.visible, `text=${nov1.text.slice(0, 28)}`);
push('C9.1. 显示 novice 池词条（tutorialDone=false）', nov1.visible && novTr.includes(nov1.text) && !NOVICE_KEYS.includes(nov1.text), `text=${nov1.text.slice(0, 28)}`);
push('C9.1. 不显示 advanced 池词条', !advTr.includes(nov1.text), `text=${nov1.text.slice(0, 28)}`);

// ═══════════════ 2) C9.2 tutorialDone=true → advanced 池 ═══════════════
await zhCtx.page.evaluate(() => window.__SAVE.set('tutorialDone', true));
await restartMenu(zhCtx.page);
const adv1 = await readTip(zhCtx.page);
push('C9.2. tutorialDone=true 重进菜单 → 显示 advanced 池词条', adv1.visible && advTr.includes(adv1.text) && !ADV_KEYS.includes(adv1.text), `text=${adv1.text.slice(0, 28)}`);

// ═══════════════ 3) C9.3 点击「下一条」文案变化 ═══════════════
await zhCtx.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  if (ms && ms.tipText) ms.tipText.emit('pointerdown');
});
await new Promise((r) => setTimeout(r, 120));
const adv2 = await readTip(zhCtx.page);
push('C9.3. 点击 tips → 文案变化', adv2.visible && adv2.text !== adv1.text, `was=${adv1.text.slice(0, 20)} now=${adv2.text.slice(0, 20)}`);
push('C9.3. 变化后仍在 advanced 池内', advTr.includes(adv2.text), `text=${adv2.text.slice(0, 28)}`);

// ═══════════════ 4) C9.5 空池静默隐藏 ═══════════════
// Vite dev 下模块 URL 带 ?t= 时间戳，裸路径 import 是平行实例（双模块陷阱）；
// 必须从 performance 资源表取真实 GameConfig.js URL 再 import，才能改到 MenuScene 可见的同一 TIPS。
await mutateTipsAdvanced(zhCtx.page, []);
await restartMenu(zhCtx.page);
const empty = await readTip(zhCtx.page);
push('C9.5. advanced 池置空 → tips 隐藏且不报错', !empty.visible && zhCtx.errors.length === 0, `visible=${empty.visible} errors=${zhCtx.errors.length}`);

// 恢复池（供后续同页断言兜底，不影响独立 en 上下文）
await mutateTipsAdvanced(zhCtx.page, ADV_KEYS);

// ═══════════════ 5) C9.7 纯展示零业务：不新增存档字段 / tutorialDone 不受影响 ═══════════════
const saveAudit = await zhCtx.page.evaluate(() => {
  const SM = window.__SAVE;
  const s = SM.load();
  const keys = Object.keys(s).sort();
  return { keys: keys.join(','), tutorialDone: s.tutorialDone, hasTipField: keys.some((k) => k.startsWith('c9') || k.includes('Tip')) };
});
push('C9.7. 零新增存档字段（无 c9*/Tip* 键）', saveAudit.hasTipField === false, `keys=${saveAudit.keys.length}`);
push('P0. zh 主上下文无 pageerror/console.error', zhCtx.errors.length === 0, zhCtx.errors.slice(0, 3).join(' | '));
await zhCtx.ctx.close();

// ═══════════════ 6) C9.6 en 界面英文 ═══════════════
const enCtx = await launchPage({ lang: 'en', tutorialDone: true, coins: 0 });
const enAdvTr = await readTranslations(enCtx.page, 'en', ADV_KEYS);
const en1 = await readTip(enCtx.page);
push('C9.6. en + tutorialDone=true → 英文 advanced 词条', en1.visible && enAdvTr.includes(en1.text) && !ADV_KEYS.includes(en1.text), `text=${en1.text.slice(0, 30)}`);
await enCtx.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  if (ms && ms.tipText) ms.tipText.emit('pointerdown');
});
await new Promise((r) => setTimeout(r, 120));
const en2 = await readTip(enCtx.page);
push('C9.6. en 点击下一条 → 英文文案变化', en2.visible && en2.text !== en1.text && enAdvTr.includes(en2.text), `now=${en2.text.slice(0, 30)}`);
push('P0. en 上下文无 pageerror/console.error', enCtx.errors.length === 0, enCtx.errors.slice(0, 3).join(' | '));
await enCtx.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C9 主菜单轮换战术提示探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
