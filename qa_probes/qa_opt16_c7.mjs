// qa_opt16_c7.mjs —— OPT-16 批2 C7 移动端震动反馈 验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C7 条。
//   C7.1  vibrate('hit') → navigator.vibrate(80)
//   C7.2  vibrate 内置 120ms 节流：连续多杀只震一次；reset 后可再震
//   C7.3  haptics=false → 任何 vibrate 不再调用；恢复 true 恢复
//   C7.5  老档缺省 haptics → load().haptics === true
//   C7.4  平台无 vibrate → 设置面板震动行隐藏且不报错；有 vibrate → 显示并可切换 开/关
//   代码接入：GameScene 事件点（playerHit/registerKill/_onBossDefeated/useBomb）存在 vibrate 调用（静态断言）
// 运行：node qa_probes/qa_opt16_c7.mjs（QA_URL 默认 http://127.0.0.1:5059）
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059'; // 勿命名为 URL：遮蔽全局 URL 构造器会破坏下方静态读取 new URL
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

async function launchPage(saveObj, withVibrateStub) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save, stub }) => {
    try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) { /* ignore */ }
    if (stub) {
      window.__vibrateCalls = [];
      try { navigator.vibrate = (pat) => { window.__vibrateCalls.push(pat); return true; }; } catch (e) { /* ignore */ }
    }
  }, { key: SAVE_KEY, save: saveObj, stub: !!withVibrateStub });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
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

// 页面内调用与 GameScene 同实例的 Haptics 方法
async function callHaptics(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const url = performance.getEntriesByType('resource')
      .map((r) => r.name)
      .find((n) => /\/src\/utils\/Haptics\.js(\?|$)/.test(n));
    if (!url) return { __noModule: true };
    const H = await import(url);
    if (typeof H[method] !== 'function') return { __noFn: true, method };
    return H[method](...args);
  }, { method, args });
}

// ═══════════════ A：函数级（有 vibrate stub；haptics 缺省 true）═══
const A = await launchPage({ lang: 'zh', coins: 100 }, true);

const defHaptics = await A.page.evaluate(() => window.__SAVE.load().haptics);
push('C7.5. 老档缺省 haptics → load().haptics===true', defHaptics === true, `haptics=${defHaptics}`);
const supported = await callHaptics(A.page, 'hapticsSupported');
push('C7.4. stub 下 hapticsSupported()=true', supported === true, `=${supported}`);

const calls0 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
await callHaptics(A.page, 'vibrate', 'hit');
const calls1 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
const lastPat = await A.page.evaluate(() => (window.__vibrateCalls || []).slice(-1)[0]);
push('C7.1. vibrate("hit") → navigator.vibrate(80)', calls1 === calls0 + 1 && JSON.stringify(lastPat) === '80', `pat=${JSON.stringify(lastPat)}`);

// C7.2 节流：连续两次 kill 只震一次
const calls2 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
await callHaptics(A.page, 'vibrate', 'kill');
await callHaptics(A.page, 'vibrate', 'kill'); // 同 120ms 内 → 被节流
const calls3 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
push('C7.2. 连续两 kill 同 120ms → 只震一次（节流）', calls3 === calls2 + 1, `delta=${calls3 - calls2}`);
await callHaptics(A.page, '__resetHapticsThrottle');
await callHaptics(A.page, 'vibrate', 'kill');
const calls4 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
push('C7.2. reset 节流后 kill → 再次震动', calls4 === calls3 + 1, `delta=${calls4 - calls3}`);

// C7.3 关闭后不再调用
await A.page.evaluate(() => window.__SAVE.set('haptics', false));
const enabledOff = await callHaptics(A.page, 'hapticsEnabled');
const calls5 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
await callHaptics(A.page, 'vibrate', 'hit');
await callHaptics(A.page, 'vibrate', 'clear');
const calls6 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
push('C7.3. haptics=false → hapticsEnabled()=false', enabledOff === false);
push('C7.3. haptics=false → vibrate 不再调用', calls6 === calls5, `delta=${calls6 - calls5}`);
// 恢复 true → 恢复
await A.page.evaluate(() => window.__SAVE.set('haptics', true));
await callHaptics(A.page, 'vibrate', 'hit');
const calls7 = await A.page.evaluate(() => (window.__vibrateCalls || []).length);
push('C7.3. 恢复 true → vibrate 恢复调用', calls7 === calls6 + 1, `delta=${calls7 - calls6}`);
push('P0. A 上下文无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
await A.ctx.close();

// ═══════════════ B：设置面板震动行（有 stub → 显示并可切换）═══
const B = await launchPage({ lang: 'zh', coins: 100 }, true);
const zhHap = await B.page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  return { on: L.zh.hapticsOn, off: L.zh.hapticsOff };
});
const opened = await B.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  if (!ms || typeof ms.openSettings !== 'function') return false;
  if (ms.settingsOpen) ms.closeSettings();
  ms.openSettings();
  return !!ms._hapticsBtn;
});
push('C7.4. 有 vibrate → 设置面板出现震动行', opened === true);
const labelOn = await B.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms._hapticsBtn ? String(ms._hapticsBtn.text.text) : '';
});
push('C7.4. 默认开 → 按钮文案「开」且高亮', labelOn === zhHap.on, `label=${labelOn}`);
await B.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  if (ms._hapticsBtn) ms._hapticsBtn.container.emit('pointerdown');
});
await new Promise((r) => setTimeout(r, 120));
const afterToggle = await B.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return {
    haptics: window.__SAVE.load().haptics,
    label: ms._hapticsBtn ? String(ms._hapticsBtn.text.text) : '',
    selected: ms._hapticsBtn ? ms._hapticsBtn.selected : null,
  };
});
push('C7.3/UI. 点击震动行 → haptics=false 且文案「关」', afterToggle.haptics === false && afterToggle.label === zhHap.off, `haptics=${afterToggle.haptics} label=${afterToggle.label}`);
push('P0. B 上下文无 pageerror/console.error', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));
await B.ctx.close();

// ═══════════════ C：无 vibrate（桌面）→ 震动行隐藏 ═══
const C = await launchPage({ lang: 'zh', coins: 100 }, false);
const openedC = await C.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  if (!ms || typeof ms.openSettings !== 'function') return false;
  if (ms.settingsOpen) ms.closeSettings();
  ms.openSettings();
  return { hapticsBtn: !!ms._hapticsBtn, exportBtn: !!ms._saveExportBtn };
});
push('C7.4. 无 vibrate → 震动行隐藏（导出行仍在，不影响其它 UI）', openedC.hapticsBtn === false && openedC.exportBtn === true, `hapticsBtn=${openedC.hapticsBtn}`);
push('P0. C 上下文无 pageerror/console.error', C.errors.length === 0, C.errors.slice(0, 3).join(' | '));
await C.ctx.close();

// ═══════════════ D：GameScene 事件点接入静态断言（4 处存在 vibrate 调用）═══
import { readFileSync } from 'node:fs';
const gsSrc = (() => { try { return readFileSync(new URL('../src/scenes/GameScene.js', import.meta.url), 'utf8'); } catch (e) { return ''; } })();
let hitOk = false, killCount = 0, clearOk = false, importOk = false;
if (gsSrc) {
  hitOk = /vibrate\('hit'\)/.test(gsSrc);
  killCount = (gsSrc.match(/vibrate\('kill'\)/g) || []).length; // registerKill + Boss 击破
  clearOk = /vibrate\('clear'\)/.test(gsSrc);
  importOk = gsSrc.includes("import { vibrate } from '../utils/Haptics.js'");
}
push('D1. GameScene import vibrate + 受击点 vibrate("hit")', importOk && hitOk, `import=${importOk} hit=${hitOk}`);
push('D2. GameScene 击杀点 vibrate("kill")（registerKill+Boss 击破 ≥2）', killCount >= 2, `count=${killCount}`);
push('D3. GameScene 炸弹点 vibrate("clear")', clearOk);

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C7 震动反馈探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
