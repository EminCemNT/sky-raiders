// qa_p2_bignumbers_combohud.mjs —— P2 (B) 击杀分数 BIG numbers / popup 强化 + (D) 连击数 HUD 强化 真测
// 验证：
//   A. 进入游戏后无 pageerror
//   B. 触发击杀后分数飘字存在，且倍率高（连击累积）时字号 > 常态 22px（落在 40~48px 区间）
//   B2. 同屏飘字上限生效（MAX_FLOATERS=24，清屏炸弹/星风暴瞬时数十弹不爆炸遮挡）
//   C. COMBO_CHANGED 触发后 UIScene.comboText 常驻对象存在，combo≥2 时 visible=true、text 含连击数
//   D. 连击断后 comboText 隐藏（visible=false）
//   E. reduced-motion：飘字与连击 HUD 跳过弹入 scale（静态出现，scale 恒为 1）—— 独立 context，matchMedia 预载覆盖
//   F. 零 pageerror 终判（normal + reduced 双上下文）
// 依赖：外部已起 5059 vite 服（NODE_OPTIONS= node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5059）
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

// 停 MenuScene 并并行启动 GameScene + UIScene，等待 player.active 且物理未暂停
async function startScenes(page) {
  await page.evaluate(async () => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    game.scene.stop('MenuScene');
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
    await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const gs = game.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
      }, 50);
    });
  });
  await page.waitForFunction(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    return ui && ui.comboText;
  }, null, { timeout: 10000 });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required'],
});

// ───────────────────────── 主上下文（正常动效） ─────────────────────────
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await startScenes(page);

// A. 进入游戏后无 pageerror（采样）
assert(errors.length === 0, `进入游戏后无 pageerror (${errors.length})`);

// B. BIG numbers：高倍率飘字字号 > 常态 22px（落在 40~48px）
const big = await page.evaluate(() => {
  const gs = window.__SKY;
  gs.combo = 40;                 // 模拟高连击 → comboMultiplier()=5
  gs.registerKill(270, 400, {}); // 同步触发 FLOAT_SCORE(mult=5) → 最新飘字为 BIG number
  const arr = gs.floaters._floaters;
  const t = arr[arr.length - 1];
  return { has: !!t, fs: t ? parseInt(String(t.style.fontSize), 10) : 0, stroke: t ? t.style.stroke : '' };
});
assert(big.has && big.fs > 22, `BIG numbers：高倍率飘字存在且字号(${big.fs}px) > 常态 22px`);
assert(big.fs >= 40 && big.fs <= 48, `BIG numbers：字号落在 40~48px 区间 (实际 ${big.fs}px)`);
assert(big.fs === 48 && /ffd54a/i.test(String(big.stroke)), `BIG numbers：mult=5 取到金描边 (fs=${big.fs}, stroke=${big.stroke})`);

// B3. 阈值 >1.05 与金描边：mult=1.04 不放大(22px/默认描边)，mult=1.06 放大(40px/金描边)
const thr = await page.evaluate(() => {
  const gs = window.__SKY;
  gs.floaters.spawn({ x: 100, y: 300, amount: 50, mult: 1.04 });
  const a = gs.floaters._floaters[gs.floaters._floaters.length - 1];
  gs.floaters.spawn({ x: 100, y: 300, amount: 50, mult: 1.06 });
  const b = gs.floaters._floaters[gs.floaters._floaters.length - 1];
  return {
    lo: { fs: parseInt(String(a.style.fontSize), 10), stroke: a.style.stroke },
    hi: { fs: parseInt(String(b.style.fontSize), 10), stroke: b.style.stroke },
  };
});
console.log('BIG 阈值:', JSON.stringify(thr));
assert(thr.lo.fs === 22 && /040a16/i.test(String(thr.lo.stroke)), `阈值：mult=1.04 非 BIG(22px,描边${thr.lo.stroke})`);
assert(thr.hi.fs === 40 && /ffd54a/i.test(String(thr.hi.stroke)), `阈值：mult=1.06 触发 BIG(40px,金描边${thr.hi.stroke})`);

// B2. 同屏飘字上限：瞬时 30 个高倍率飘字，活跃数应被裁剪到 ≤ 24
const cap = await page.evaluate(() => {
  const gs = window.__SKY;
  for (let i = 0; i < 30; i++) gs.floaters.spawn({ x: 60 + i * 8, y: 220, amount: 100, mult: 3 });
  return gs.floaters._floaters.length;
});
assert(cap <= 24, `同屏飘字上限生效（当前 ${cap} ≤ MAX_FLOATERS 24）`);

// C. 连击 HUD：comboText 常驻对象存在，combo≥2 时可见且文本含连击数
const c3 = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  const ct = ui.comboText;
  const txt = ct ? ct.text : '';
  return { exists: !!ct, visible: ct ? ct.visible : false, hasCombo: ct ? txt.includes('41') : false, text: txt };
});
assert(c3.exists, '连击 HUD：UIScene.comboText 常驻对象存在');
assert(c3.visible && c3.hasCombo, `连击 HUD：combo≥2 时可见且文本含连击数 (visible=${c3.visible}, text="${c3.text}")`);

// D. 连击断后 comboText 隐藏
const c4 = await page.evaluate(() => {
  const gs = window.__SKY;
  gs.breakCombo();   // 触发 COMBO_CHANGED(0,1) → _onCombo 隐藏
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui.comboText ? ui.comboText.visible : null;
});
assert(c4 === false, `连击断后 comboText 隐藏 (visible=${c4})`);

// C-ext. 连击 HUD 档位变色 + 文本格式 + 脉冲起始 + combo≤1 隐藏（直接驱动 _onCombo 隔离验证）
const tiers = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  ui._onCombo(5, 1.5);
  const low = { scale: ui.comboText.scaleX, color: ui.comboText.style.color, text: ui.comboText.text, visible: ui.comboText.visible };
  ui._onCombo(25, 3.0);
  const mid = { color: ui.comboText.style.color, text: ui.comboText.text };
  ui._onCombo(50, 5.0);
  const high = { color: ui.comboText.style.color, text: ui.comboText.text };
  ui._onCombo(1, 1);
  const hide = { visible: ui.comboText.visible };
  return { low, mid, high, hide };
});
console.log('combo tiers:', JSON.stringify(tiers));
assert(tiers.low.scale === 1.35, `连击 HUD：combo=5 触发脉冲起始 scale=1.35 (实际 ${tiers.low.scale})`);
assert(tiers.low.visible && /7cf3ff/i.test(String(tiers.low.color)), `连击 HUD：combo<20 青色 (color=${tiers.low.color})`);
assert(tiers.low.text.startsWith('连击 ×') && tiers.low.text.includes('1.5'), `连击 HUD：文本含连击数+倍率 (text="${tiers.low.text}")`);
assert(/ffd54a/i.test(String(tiers.mid.color)) && tiers.mid.text.includes('3.0'), `连击 HUD：combo 20-39 金色 (color=${tiers.mid.color})`);
assert(/ff5566/i.test(String(tiers.high.color)) && tiers.high.text.includes('5.0'), `连击 HUD：combo≥40 红色 (color=${tiers.high.color})`);
assert(tiers.hide.visible === false, `连击 HUD：combo≤1 隐藏 (visible=${tiers.hide.visible})`);

// D-diag：断连(隐藏)后 120ms 内重新连击，频控是否误伤显隐（仅诊断，不计入 PASS/FAIL）
const diag = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  ui._onCombo(5, 1.5);              // 建立连击并触发脉冲 → _lastComboPulse=now
  ui._onCombo(0, 1);               // 断连：隐藏
  const afterBreak = ui.comboText.visible;
  ui._lastComboPulse = ui.time.now; // 模拟刚触发过脉冲（高频击杀场景）
  ui._onCombo(2, 1.2);             // 120ms 内重新连击
  return { afterBreak, afterRekill: ui.comboText.visible };
});
console.log('combo 重新显隐诊断:', JSON.stringify(diag), '→ 期望 afterRekill=true');

await ctx.close();

// ─────────────── reduced-motion 上下文（matchMedia 预载覆盖，模块级常量求值生效） ───────────────
const rctx = await browser.newContext();
await rctx.addInitScript(() => {
  window.matchMedia = (q) => ({
    matches: /prefers-reduced-motion/.test(q),
    media: q, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  });
});
const rpage = await rctx.newPage();
const rerrors = [];
rpage.on('pageerror', (e) => rerrors.push(String(e)));
rpage.on('console', (m) => { if (m.type() === 'error') rerrors.push('console:' + m.text()); });

await rpage.goto(URL, { waitUntil: 'domcontentloaded' });
await rpage.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await startScenes(rpage);

// E. reduced-motion：飘字静态出现（scale 恒 1，跳过弹入）；连击 HUD 静态（scale 恒 1，去掉脉冲）
const c5 = await rpage.evaluate(() => {
  const gs = window.__SKY;
  gs.combo = 40;
  gs.registerKill(270, 400, {});   // 高倍率 FLOAT_SCORE + COMBO_CHANGED(41,5)
  const arr = gs.floaters._floaters;
  const t = arr[arr.length - 1];
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    floaterExists: !!t,
    floaterScale: t ? t.scaleX : null,
    comboVisible: ui.comboText ? ui.comboText.visible : false,
    comboScale: ui.comboText ? ui.comboText.scaleX : null,
  };
});
assert(c5.floaterExists && c5.floaterScale === 1, `reduced-motion：飘字静态出现、跳过弹入 scale (scale=${c5.floaterScale})`);
assert(c5.comboVisible && c5.comboScale === 1, `reduced-motion：连击 HUD 静态、去掉 scale 弹入 (visible=${c5.comboVisible}, scale=${c5.comboScale})`);

// E-ext. reduced-motion 档位变色仍生效且 scale 恒 1（无脉冲）
const rtiers = await rpage.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  ui._onCombo(5, 1.5);
  const low = { color: ui.comboText.style.color, scale: ui.comboText.scaleX };
  ui._onCombo(25, 3.0);
  const mid = { color: ui.comboText.style.color };
  ui._onCombo(50, 5.0);
  const high = { color: ui.comboText.style.color };
  return { low, mid, high };
});
console.log('reduced combo tiers:', JSON.stringify(rtiers));
assert(/7cf3ff/i.test(String(rtiers.low.color)) && rtiers.low.scale === 1, `reduced：combo<20 青色且 scale=1 (color=${rtiers.low.color}, scale=${rtiers.low.scale})`);
assert(/ffd54a/i.test(String(rtiers.mid.color)), `reduced：combo 20-39 金色 (color=${rtiers.mid.color})`);
assert(/ff5566/i.test(String(rtiers.high.color)), `reduced：combo≥40 红色 (color=${rtiers.high.color})`);

assert(rerrors.length === 0, `reduced-motion 上下文零 pageerror (${rerrors.length})`);
if (rerrors.length) console.error('reduced 页面错误:', rerrors.slice(0, 5));

await rctx.close();
await browser.close();

// F. 零 pageerror 终判
assert(errors.length === 0, `零 pageerror 终判 (normal=${errors.length})`);
if (errors.length) console.error('页面错误:', errors.slice(0, 5));
console.log(process.exitCode ? '\n=== P2 BIG numbers / 连击 HUD 探针 FAIL ===' : '\n=== P2 BIG numbers / 连击 HUD 探针 PASS ===');
