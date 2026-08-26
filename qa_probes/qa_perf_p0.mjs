// qa_perf_p0.mjs —— P0 技术品质三件套（粒子池化 / SW+分包 / 性能档位）真测
//
// 断言：
//   1) VFX.createVfxPool / poolExplode / poolSpark 导出 + GameScene.create 已建池
//      （explosion + hitSpark 两个 offscreen emitter，emitting:false）
//   2) 池化生效：连续 6 次 poolExplode/poolSpark 后场景 ParticleEmitter 数量不增长 + 复用计数增加
//   3) 爆炸/命中火花粒子 quantity 随画质档缩放（high=1.0/mid=0.7/low=0.45，读 scene.qualityScale）
//   4) GameScene.qualityScale 读存档 quality（low → 0.45）
//   5) PERFORMANCE 三档配置（tiers=['high','mid','low'] / defaultTier='high' / scale）
//   6) SaveManager quality 字段默认 high + 脏存档清洗回退 high
//   7) 设置面板渲染三档画质按钮（高/中/低）+ 选中高亮 + 点击切换持久化
//   8) public/sw.js 存在（SW 预缓存）
//   9) main.js 有 SW 注册逻辑（import.meta.env.PROD 才注册）
//  10) 零 pageerror / console.error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// ── 6a) SaveManager quality 默认 high（必须在任何 set 之前读，读到默认存档字段）──
const smDefault = await page.evaluate(() => window.__SAVE.load().quality);
push('SaveManager quality 字段默认 high', smDefault === 'high', smDefault);

// ── 进入 GameScene（复用既有标准姿势）──
await page.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('tutorialDone', true);
  SM.set('quality', 'high');
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await page.waitForTimeout(150); // 等 VFX.warmup 的 40ms 临时 emitter 销毁完成，避免计数断言抖动

// ── 1+2) 池化接口 + GameScene 已建池 + 池化生效（emitter 数量不增长 / 复用计数增加）──
const r1 = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const VFX = await import('/src/systems/VFX.js');
  const pool = gs.vfxPool;
  const countEmitters = () => gs.children.list.filter((c) => c && c.type === 'ParticleEmitter').length;
  const before = countEmitters();
  const use0 = pool ? (pool.explosion.poolUseCount || 0) : -1;
  for (let i = 0; i < 6; i++) {
    VFX.poolExplode(gs, pool, 270, 300 + i * 20, 0xff5a6e, { scale: 1 });
    VFX.poolSpark(gs, pool, 200 + i * 10, 300 + i * 20);
  }
  const after = countEmitters();
  const use1 = pool ? (pool.explosion.poolUseCount || 0) : -1;
  const useSpark = pool ? (pool.hitSpark.poolUseCount || 0) : -1;
  return {
    api: { createVfxPool: typeof VFX.createVfxPool, poolExplode: typeof VFX.poolExplode, poolSpark: typeof VFX.poolSpark },
    hasPool: !!pool,
    poolKeys: pool ? Object.keys(pool).sort().join(',') : '',
    emitting: pool ? [!!pool.explosion.emitting, !!pool.hitSpark.emitting] : null,
    before, after, use0, use1, useSpark,
  };
});
push('VFX 池化接口导出（createVfxPool/poolExplode/poolSpark）',
  r1.api.createVfxPool === 'function' && r1.api.poolExplode === 'function' && r1.api.poolSpark === 'function',
  JSON.stringify(r1.api));
push('GameScene.create 已建 vfxPool（explosion+hitSpark，emitting:false）',
  r1.hasPool === true && r1.poolKeys === 'explosion,hitSpark' && r1.emitting && r1.emitting[0] === false && r1.emitting[1] === false,
  `keys=${r1.poolKeys} emitting=${JSON.stringify(r1.emitting)}`);
push('池化生效：连续 6 次爆炸/火花后 ParticleEmitter 数量不增长',
  r1.before === r1.after, `before=${r1.before} after=${r1.after}`);
push('池化生效：复用计数增加（explosion +6 / hitSpark +6）',
  r1.use1 - r1.use0 === 6 && r1.useSpark === 6, `explosion ${r1.use0}→${r1.use1} spark=${r1.useSpark}`);

// ── 3) 爆炸/火花粒子 quantity 随画质档缩放（high=1.0 / mid=0.7 / low=0.45）──
const r2 = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const VFX = await import('/src/systems/VFX.js');
  const pool = gs.vfxPool;
  const out = {};
  gs.qualityScale = 1.0; VFX.poolExplode(gs, pool, 270, 300, 0xff5a6e, { scale: 1 }); out.highExp = pool.explosion.lastQuantity;
  VFX.poolSpark(gs, pool, 200, 300); out.highSpark = pool.hitSpark.lastQuantity;
  gs.qualityScale = 0.7; VFX.poolExplode(gs, pool, 270, 300, 0xff5a6e, { scale: 1 }); out.midExp = pool.explosion.lastQuantity;
  gs.qualityScale = 0.45; VFX.poolExplode(gs, pool, 270, 300, 0xff5a6e, { scale: 1 }); out.lowExp = pool.explosion.lastQuantity;
  VFX.poolSpark(gs, pool, 200, 300); out.lowSpark = pool.hitSpark.lastQuantity;
  gs.qualityScale = 1.0;
  return out;
});
push('爆炸粒子 quantity 随画质档缩放（high=22 / mid=15 / low=9）',
  r2.highExp === 22 && r2.midExp === Math.floor(22 * 0.7) && r2.lowExp === Math.floor(22 * 0.45),
  JSON.stringify({ high: r2.highExp, mid: r2.midExp, low: r2.lowExp }));
push('命中火花 quantity 随画质档缩放（high=6 / low=2）',
  r2.highSpark === 6 && r2.lowSpark === Math.max(1, Math.floor(6 * 0.45)),
  JSON.stringify({ high: r2.highSpark, low: r2.lowSpark }));

// ── 4) GameScene.qualityScale 读存档 quality（low → 0.45）──
await page.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('quality', 'low');
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
const qualityScale = await page.evaluate(() => window.__SKY__.scene.getScene('GameScene').qualityScale);
push('GameScene.qualityScale 读存档 quality=low → 0.45', qualityScale === 0.45, `scale=${qualityScale}`);

// ── 5) PERFORMANCE 三档配置 ──
const perf = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  return gc.PERFORMANCE;
});
push('PERFORMANCE 三档配置（high/mid/low + defaultTier=high + scale 1.0/0.7/0.45）',
  !!perf && Array.isArray(perf.tiers) && JSON.stringify(perf.tiers) === '["high","mid","low"]'
  && perf.defaultTier === 'high' && !!perf.scale
  && perf.scale.high === 1 && perf.scale.mid === 0.7 && perf.scale.low === 0.45,
  JSON.stringify(perf));

// ── 7) 设置面板：三档画质按钮 + 选中高亮 + 点击切换 ──
await page.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('quality', 'high');
  ['UIScene', 'GameScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('MenuScene');
});
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive() && ms.children && ms.children.list.length > 10;
}, { timeout: 20000 });
const qualityUi = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openSettings();
  const btns = ms._qualityBtns || [];
  const labels = btns.map((b) => b.btn.text.text);
  const ids = btns.map((b) => b.id);
  const selected = btns.filter((b) => b.btn.selected).map((b) => b.id);
  const low = btns.find((b) => b.id === 'low');
  if (low) low.btn.container.emit('pointerdown');
  const after = window.__SAVE.load().quality;
  const selectedAfter = btns.filter((b) => b.btn.selected).map((b) => b.id);
  ms.closeSettings();
  return { labels, ids, selected, after, selectedAfter };
});
push('设置面板渲染三档画质按钮（高/中/低）',
  JSON.stringify(qualityUi.labels) === JSON.stringify(['高', '中', '低']) && JSON.stringify(qualityUi.ids) === '["high","mid","low"]',
  qualityUi.labels.join(','));
push('画质按钮选中高亮 + 点击「低」切换持久化',
  JSON.stringify(qualityUi.selected) === JSON.stringify(['high']) && qualityUi.after === 'low'
  && JSON.stringify(qualityUi.selectedAfter) === JSON.stringify(['low']),
  JSON.stringify({ selected: qualityUi.selected, after: qualityUi.after, selectedAfter: qualityUi.selectedAfter }));

// ── 8) public/sw.js 存在 ──
const swPath = path.join(ROOT, 'public', 'sw.js');
push('public/sw.js 存在（SW 预缓存）', fs.existsSync(swPath), swPath);

// ── 9) main.js 有 SW 注册逻辑（production 才注册）──
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
push('main.js 含 SW 注册逻辑（import.meta.env.PROD 才注册 navigator.serviceWorker）',
  /serviceWorker/.test(mainSrc) && /register\(\s*['"]\.\/sw\.js['"]\s*\)/.test(mainSrc) && /import\.meta\.env\.PROD/.test(mainSrc),
  '');

// ── 6b) 脏存档清洗：quality=bogus 重载后回退 high ──
await page.evaluate((key) => {
  localStorage.setItem(key, JSON.stringify({ quality: '__bogus__' }));
}, 'sky_raiders_save_v1');
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
const smClean = await page.evaluate(() => window.__SAVE.load().quality);
push('脏存档清洗回退 high（load 清洗 PERFORMANCE.tiers 外 → defaultTier）', smClean === 'high', smClean);

// ── 10) 零 pageerror / console.error ──
push('零 pageerror / console.error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
const failed = checks.filter((c) => !c.ok);
console.log('---');
if (failed.length) console.log('FAILED: ' + failed.map((c) => c.name).join('; '));
console.log(pass ? 'QA_PERF_P0: PASS' : 'QA_PERF_P0: FAIL');
process.exit(pass ? 0 : 1);
