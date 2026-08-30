// qa_opt14_g2_downgrade.mjs —— OPT-14 G2 降级路径（BLOOM.downscale.enabled:false）验收探针
//
// 背景：QA 独立审计抓到 G2-4 —— 降级路径（downscale.enabled:false → 全分辨率 RT + 仅 A1）
// 下静态场景脏标记失效（draws/ticks = 1.00，每 tick 全分辨率重绘，比主路径更耗）。
// 修复：BloomFX staticMode 脏标记从 downscale 分支解耦（独立 staticEveryNFrames），降级路径同样限频重绘。
//
// 断言（复刻 QA 独立审计 G2-0..G2-7）：
//   G2-0  前置：默认配置下采样生效（width=270 zoom=0.5）
//   G2-1  enabled:false → bloom 仍开启（enabled=true）
//   G2-2  enabled:false → 全分辨率 RT（width=540 height=960）
//   G2-3  enabled:false → zoom=1 / scaleX=1（无下采样缩放）
//   G2-4  降级路径 draws/ticks 比值 ≈0.2（脏标记仍生效；若≈1.0=每tick重绘=缺陷回归）
//   G2-5  enabled:false 降级后 A1 仍生效（depth80 排除 / depth20 保留 / max≤64）
//   G2-6  对照 enabled:true 下采样恢复（width=270）
//   G2-7  对照脏标记路径 draws/ticks ≈0.2（enabled:true staticMode）
//   I-D   Page D 零 pageerror / console.error
// 运行：node qa_probes/qa_opt14_g2_downgrade.mjs（QA_URL 默认 http://127.0.0.1:5059）
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
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const save = { lang: 'zh', tutorialDone: true, quality: 'high', selectedDifficulty: 'standard' };
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.addInitScript((s) => {
  try { localStorage.setItem('sky_raiders_save_v1', JSON.stringify(s)); } catch (e) { /* ignore */ }
}, save);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// 等 MenuScene 首个 bloom（默认 downscale enabled）就绪
await page.waitForFunction(() => {
  const m = window.__SKY__.scene.getScene('MenuScene');
  return m && m.bloomFX && window.__BLOOM && window.__BLOOM.rt;
}, null, { timeout: 10000 });

// ── G2-0 前置：默认配置下采样生效 ──
const base = await page.evaluate(() => {
  const rt = window.__BLOOM.rt;
  return { width: rt.width, zoom: (rt.camera && rt.camera.zoom) || null };
});
push('G2-0. 前置：默认配置下采样生效（width=270 zoom=0.5）', base.width === 270 && base.zoom === 0.5, `w=${base.width} z=${base.zoom}`);

// ── 注入降级：BLOOM.downscale.enabled=false + restart MenuScene（create 重读配置）──
await page.evaluate(async () => {
  const game = window.__SKY__;
  const cfg = await import('/src/config/GameConfig.js');
  cfg.BLOOM.downscale.enabled = false;
  game.scene.stop('MenuScene');
  game.scene.start('MenuScene');
});
await page.waitForFunction(() => {
  const m = window.__SKY__.scene.getScene('MenuScene');
  return m && m.bloomFX && window.__BLOOM && window.__BLOOM.rt && window.__BLOOM.rt.width === 540;
}, null, { timeout: 10000 });

// ── G2-1 / G2-2 / G2-3：降级路径 RT 状态 ──
const downg = await page.evaluate(() => {
  const ctl = window.__BLOOM;
  const rt = ctl.rt;
  return {
    enabled: ctl.enabled,
    width: rt.width,
    height: rt.height,
    zoom: (rt.camera && rt.camera.zoom) || null,
    scaleX: rt.scaleX,
    scaleY: rt.scaleY,
    pipelines: (ctl.pipelines || []).length,
  };
});
push('G2-1. enabled:false → bloom 仍开启（enabled=true）', downg.enabled === true);
push('G2-2. enabled:false → 全分辨率 RT（width=540 height=960）', downg.width === 540 && downg.height === 960, `w=${downg.width} h=${downg.height}`);
push('G2-3. enabled:false → zoom=1 / scaleX=1（无下采样缩放）', downg.zoom === 1 && downg.scaleX === 1 && downg.scaleY === 1, `z=${downg.zoom} sx=${downg.scaleX} sy=${downg.scaleY}`);

// ── G2-4：降级路径脏标记仍生效（9 ticks 内 rt.draw ≤ ~2 次，ratio ≈0.2）──
// 数 9 个 rAF tick 内实际 rt.draw 调用次数（instrument 真实 draw，不断言合成/假值）
async function countDraws(page, frames = 9) {
  return page.evaluate(async (n) => {
    const rt = window.__BLOOM && window.__BLOOM.rt;
    if (!rt) return { draws: -1, ticks: n, ratio: -1 };
    if (!rt.__opt14DrawCounter) {
      const orig = rt.draw.bind(rt);
      rt.__opt14DrawCounter = 0;
      rt.draw = (...a) => { rt.__opt14DrawCounter++; return orig(...a); };
    }
    // 等一个稳定帧，让 instrument 之前可能的 dirty 落在计数外
    await new Promise((r) => requestAnimationFrame(() => r()));
    rt.__opt14DrawCounter = 0;
    await new Promise((resolve) => {
      let ticks = 0;
      const step = () => { ticks++; if (ticks >= n) resolve(); else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    return {
      draws: rt.__opt14DrawCounter,
      ticks: n,
      ratio: +(rt.__opt14DrawCounter / n).toFixed(3),
    };
  }, frames);
}

const g24 = await countDraws(page, 9);
push('G2-4. 降级路径 draws/ticks ≈0.2（脏标记仍生效，非每 tick 重绘）',
  g24.ratio >= 0 && g24.ratio <= 0.45 && g24.draws <= 4,
  `draws=${g24.draws} ticks=${g24.ticks} ratio=${g24.ratio}`);

// ── G2-5：降级路径 A1 仍生效（staticMode 下需置脏后 redraw 才实际绘制）──
const g25 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('MenuScene');
  const ctl = window.__BLOOM;
  const rt = ctl.rt;
  if (!rt.__opt14DrawLog) {
    const orig = rt.draw.bind(rt);
    rt.__opt14DrawLog = [];
    rt.draw = (...a) => { if (Array.isArray(a[0])) rt.__opt14DrawLog.push(a[0]); return orig(...a); };
  }
  const t80 = gs.add.text(120, 120, 'G2-UI80', {}).setDepth(80);
  const t20 = gs.add.text(220, 220, 'G2-GP20', {}).setDepth(20);
  ctl.markDirty(); // staticMode：置脏保证本次 redraw 实际绘制
  ctl.redraw();
  const last = rt.__opt14DrawLog[rt.__opt14DrawLog.length - 1] || [];
  const in80 = last.some((o) => o === t80);
  const in20 = last.some((o) => o === t20);
  const maxDepth = last.reduce((m, o) => Math.max(m, (o && o.depth) || 0), 0);
  t80.destroy(); t20.destroy();
  return { in80, in20, maxDepth, n: last.length };
});
push('G2-5. enabled:false 降级后 A1 仍生效（depth80 排除 / depth20 保留）',
  g25.in80 === false && g25.in20 === true && g25.maxDepth <= 64,
  `in80=${g25.in80} in20=${g25.in20} max=${g25.maxDepth}`);

// ── G2-6 / G2-7 对照：改回 enabled=true → 下采样恢复 + 主路径脏标记不回归 ──
await page.evaluate(async () => {
  const game = window.__SKY__;
  const cfg = await import('/src/config/GameConfig.js');
  cfg.BLOOM.downscale.enabled = true;
  game.scene.stop('MenuScene');
  game.scene.start('MenuScene');
});
await page.waitForFunction(() => {
  const m = window.__SKY__.scene.getScene('MenuScene');
  return m && m.bloomFX && window.__BLOOM && window.__BLOOM.rt && window.__BLOOM.rt.width === 270;
}, null, { timeout: 10000 });
const restore = await page.evaluate(() => {
  const rt = window.__BLOOM.rt;
  return { width: rt.width, zoom: (rt.camera && rt.camera.zoom) || null };
});
push('G2-6. 对照 enabled:true 下采样恢复（width=270 zoom=0.5）', restore.width === 270 && restore.zoom === 0.5, `w=${restore.width} z=${restore.zoom}`);

const g27 = await countDraws(page, 9);
push('G2-7. 对照脏标记路径 draws/ticks ≈0.2（enabled:true staticMode）',
  g27.ratio >= 0 && g27.ratio <= 0.45 && g27.draws <= 4,
  `draws=${g27.draws} ticks=${g27.ticks} ratio=${g27.ratio}`);

push('I-D. Page D 零 pageerror / console.error', errors.length === 0, `errors=${errors.length}${errors.length ? ' :: ' + errors.slice(0, 2).join(' | ') : ''}`);

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n==== OPT-14 G2 降级路径探针 结果：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((c) => console.log('  ❌ ' + c.name));
  process.exit(1);
}
process.exit(0);
