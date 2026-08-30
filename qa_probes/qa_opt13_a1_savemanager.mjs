// qa_opt13_a1_savemanager.mjs —— OPT-13 批A A1 SaveManager 存档降频 验收探针
//
// 验证：
//   1) flushNow() / isPersistBroken() 存在且为函数
//   2) save() 脏标记 + rAF 合并写：同帧多次 save 不立即写盘，rAF 后合并为一次写
//   3) addCoins 高频调用合并为一次落盘（真实写盘计数）
//   4) flushNow() 立即同步写盘并清脏（endGame 关键路径语义）
//   5) 无 requestAnimationFrame 环境退化为同步写（Node 头测兼容）
//   6) isPersistBroken()：setItem 抛错 → 降级态 true + EVENTS.SAVE_FAILED 仅首次一次
//   7) 源码级：GameScene.endGame 调用 flushNow
//   8) 零 pageerror / console error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
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
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// ── 1) 新接口存在 ──
const api = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  return {
    saveKey: m.SAVE_KEY,
    hasFlush: typeof window.__SAVE.flushNow === 'function',
    hasBroken: typeof window.__SAVE.isPersistBroken === 'function',
  };
});
push('SaveManager.flushNow() 存在', api.hasFlush);
push('SaveManager.isPersistBroken() 存在', api.hasBroken);

// ── 2) save() rAF 合并写：同帧不写、rAF 后落盘 ──
const throttle = await page.evaluate(async ({ saveKey }) => {
  window.__SAVE.flushNow(); // 先清脏/清 pending
  // 打桩计数 localStorage 真实写盘
  let writeCount = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { writeCount++; return orig.call(this, k, v); };
  try {
    // 同帧内多次 set（每次内部 save() → 脏标记 + 调度一次 rAF）
    window.__SAVE.set('probeThrottle', 111);
    window.__SAVE.set('probeThrottle2', 222);
    const sameTickWrite = writeCount;              // rAF 未触发，不应有写
    const rawNow = localStorage.getItem(saveKey) || '';
    const hasNow = rawNow.includes('probeThrottle');
    await new Promise((r) => setTimeout(r, 60));   // 等 rAF flush
    const afterFlushWrite = writeCount;            // 合并后应恰为 1 次
    const rawAfter = localStorage.getItem(saveKey) || '';
    const hasAfter = rawAfter.includes('probeThrottle2');
    return { sameTickWrite, afterFlushWrite, hasNow, hasAfter };
  } finally {
    Storage.prototype.setItem = orig;
  }
}, { saveKey: api.saveKey });
push('同帧多次 save() 不立即写盘（sameTickWrite=0）', throttle.sameTickWrite === 0, `write=${throttle.sameTickWrite}`);
push('同帧多次 save() 合并为一次写盘（afterFlushWrite=1）', throttle.afterFlushWrite === 1, `write=${throttle.afterFlushWrite}`);
push('rAF 前 localStorage 不含新值（延迟落盘）', throttle.hasNow === false);
push('rAF 后 localStorage 含新值（合并落盘成功）', throttle.hasAfter === true);

// ── 3) addCoins 高频合并 ──
const coins = await page.evaluate(async ({ saveKey }) => {
  window.__SAVE.flushNow();
  let writeCount = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { writeCount++; return orig.call(this, k, v); };
  try {
    const startCoins = window.__SAVE.load().coins;
    for (let i = 0; i < 20; i++) window.__SAVE.addCoins(1);  // 同帧 20 次金币
    const sameTick = writeCount;
    await new Promise((r) => setTimeout(r, 60));
    const afterFlush = writeCount;
    const coins = window.__SAVE.load().coins;
    return { sameTick, afterFlush, coins, startCoins };
  } finally {
    Storage.prototype.setItem = orig;
  }
}, { saveKey: api.saveKey });
push('addCoins ×20 同帧不写盘', coins.sameTick === 0, `write=${coins.sameTick}`);
push('addCoins ×20 合并为一次落盘', coins.afterFlush === 1, `write=${coins.afterFlush}`);
push('addCoins 金额累加正确（+20）', coins.coins === coins.startCoins + 20, `coins=${coins.coins}`);

// ── 4) flushNow() 立即同步写盘 ──
const flush = await page.evaluate(async ({ saveKey }) => {
  let writeCount = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { writeCount++; return orig.call(this, k, v); };
  try {
    window.__SAVE.set('probeFlush', 999);
    const beforeFlush = writeCount;                // 仍为 0（rAF 待定）
    window.__SAVE.flushNow();
    const afterFlush = writeCount;                 // flushNow 立即写盘
    const raw = localStorage.getItem(saveKey) || '';
    return { beforeFlush, afterFlush, has: raw.includes('probeFlush') };
  } finally {
    Storage.prototype.setItem = orig;
  }
}, { saveKey: api.saveKey });
push('flushNow() 立即写盘（afterFlush=1）', flush.beforeFlush === 0 && flush.afterFlush === 1, `before=${flush.beforeFlush} after=${flush.afterFlush}`);
push('flushNow() 后 localStorage 含新值', flush.has === true);

// ── 5) 无 requestAnimationFrame 退化为同步写 ──
const sync = await page.evaluate(async ({ saveKey }) => {
  const raf = window.requestAnimationFrame;
  try {
    window.requestAnimationFrame = undefined;       // 模拟 Node/无 rAF 环境
    window.__SAVE.set('probeSync', 42);
    const raw = localStorage.getItem(saveKey) || '';
    return { has: raw.includes('probeSync') };
  } finally {
    window.requestAnimationFrame = raf;
  }
}, { saveKey: api.saveKey });
push('无 rAF 环境 save() 同步写盘（Node 探针兼容）', sync.has === true);

// ── 6) isPersistBroken + SAVE_FAILED 仅首次一次 ──
const broken = await page.evaluate(async () => {
  const EventBusMod = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  const EventBus = EventBusMod.EventBus || EventBusMod.default;
  let saveFailedCount = 0;
  const onFail = () => { saveFailedCount++; };
  EventBus.on(EV.SAVE_FAILED, onFail);
  const orig = Storage.prototype.setItem;
  let throwing = false;
  Storage.prototype.setItem = function () { if (throwing) throw new Error('quota'); return orig.apply(this, arguments); };
  try {
    window.__SAVE.flushNow(); // 正常写 → 不降级
    const normalBroken = window.__SAVE.isPersistBroken();
    throwing = true;
    window.__SAVE.flushNow(); // 第一次失败 → 降级 + 提示一次
    const broken1 = window.__SAVE.isPersistBroken();
    const count1 = saveFailedCount;
    window.__SAVE.flushNow(); // 第二次失败 → 仍降级但不重复提示
    const broken2 = window.__SAVE.isPersistBroken();
    const count2 = saveFailedCount;
    throwing = false;
    window.__SAVE.flushNow(); // 写成功 → 恢复持久化态
    const recovered = window.__SAVE.isPersistBroken();
    EventBus.off(EV.SAVE_FAILED, onFail);
    return { normalBroken, broken1, count1, broken2, count2, recovered };
  } finally {
    Storage.prototype.setItem = orig;
  }
});
push('正常写盘 isPersistBroken()=false', broken.normalBroken === false);
push('写入失败 isPersistBroken()=true（降级态）', broken.broken1 === true);
push('EVENTS.SAVE_FAILED 首次失败仅提示一次', broken.count1 === 1, `count=${broken.count1}`);
push('连续失败不刷屏（第二次仍一次）', broken.count2 === 1, `count=${broken.count2}`);
push('写成功恢复持久化态（isPersistBroken()=false）', broken.recovered === false);

// ── 7) 源码级：endGame 调 flushNow ──
const src = await page.evaluate(async () => {
  const gs = await (await fetch('/src/scenes/GameScene.js')).text();
  const idx = gs.indexOf('endGame(victory)');
  const seg = gs.slice(idx, idx + 8000);
  return {
    hasFlushNow: seg.includes('SaveManager.flushNow()'),
    hasOldSave: seg.includes('SaveManager.save()'),
  };
});
push('GameScene.endGame 调用 SaveManager.flushNow()', src.hasFlushNow === true);
push('GameScene.endGame 不再调用 SaveManager.save()', src.hasOldSave === false);

push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a1_savemanager: PASS ===' : '=== qa_opt13_a1_savemanager: FAIL ==='));
process.exit(pass ? 0 : 1);
