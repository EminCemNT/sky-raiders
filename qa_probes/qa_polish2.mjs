// qa_polish2.mjs —— 画质精修三件 真测
// A) bloom 参数精调：BLOOM.params 存在；strength∈[0.4,0.6]；threshold∈[0.5,0.7]（本构建无
//    threshold uniform，保留为调参锚点）；low 性能档强制关 bloom / high 开。
// B) 常驻暗角 + 胶片颗粒：常驻暗角 alpha>0 且非低血也显示（depth=88）；grain_tex 纹理 +
//    全屏 Image（alpha>0、铺满屏）；非 reduced 颗粒逐帧抖动；reduced-motion 颗粒静态；
//    low 档颗粒 alpha 减半、暗角保留。
// C) Boss 入场仪式：入场 _entering=true 且 y 在屏外上方；到达后 _entering=false 且 y=150（恢复
//    正常）；到达演出（冲击波环/顶光聚光 depth=56）；reduced-motion 直现目标位。
// 零 pageerror / console.error。
//
// ⚠️ 到达演出（冲击波环 320ms / 顶光 ~300ms）是**瞬时**特效：采样必须用「有界轮询 + 取窗口内最大值」，
//    不可固定 sleep 后单次采样，否则采样点落在窗口外 → ring=0 glow=0 假失败（曾于全量套件挂）。
//    且必须**位置绑定**（锚定 Boss 到达点 ±60px）+ **AND**（环与光都要有）：depth=56 并非到达演出独占
//    （VFX.localIllum 爆炸亮斑同为 depth 56 glow_soft），只扫 depth 会让断言恒真。
//    注意 URL 也要读取 QA_BASE_URL（统一运行器只注入后者）。
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

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
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 60000 });

// ── A) BLOOM 参数精调 ──
const bloomCfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const bfx = await import('/src/utils/BloomFX.js');
  return {
    params: gc.BLOOM.params || null,
    qualityGate: gc.BLOOM.qualityGate,
    lowOff: bfx.bloomEnabledForQuality('low') === false,
    highOn: bfx.bloomEnabledForQuality('high') === true,
  };
});
const bs = bloomCfg.params ? bloomCfg.params.strength : -1;
const bt = bloomCfg.params ? bloomCfg.params.threshold : -1;
push('BLOOM.params 存在且 strength∈[0.4,0.6]（精调后不暴走）',
  !!bloomCfg.params && bs >= 0.4 && bs <= 0.6, `strength=${bs}`);
push('BLOOM.params.threshold∈[0.5,0.7]（调参锚点）',
  bt >= 0.5 && bt <= 0.7, `threshold=${bt}`);
push('low 性能档强制关 bloom / high 开（既有逻辑保留）',
  bloomCfg.lowOff && bloomCfg.highOn, `gate=${bloomCfg.qualityGate}`);

// 进入 GameScene（复用既有标准姿势；quality 强制 high）
await page.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('tutorialDone', true);
  SM.set('selectedDifficulty', 'standard');
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
await page.waitForFunction(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui && ui.scene.isActive() && ui._permVignette && ui._filmGrain;
}, { timeout: 20000 });
await page.waitForTimeout(500);

// 截图：战斗（bloom + 暗角 + 颗粒）
await page.screenshot({ path: path.join(SHOTS, 'polish2_battle.png') });

// ── B) 常驻暗角 + 胶片颗粒 ──
const filmRt = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    permAlpha: ui._permVignette ? ui._permVignette.alpha : -1,
    permDepth: ui._permVignette ? ui._permVignette.depth : -1,
    permVisible: ui._permVignette ? ui._permVignette.visible : false,
    lowHpBase: ui._lowHpBase,
    textureExists: ui.textures.exists('grain_tex'),
    grainExists: !!ui._filmGrain,
    grainAlpha: ui._filmGrain ? ui._filmGrain.alpha : -1,
    grainTex: ui._filmGrain && ui._filmGrain.texture ? ui._filmGrain.texture.key : null,
    grainDepth: ui._filmGrain ? ui._filmGrain.depth : -1,
    grainCovers: ui._filmGrain
      ? (ui._filmGrain.displayWidth >= 540 && ui._filmGrain.displayHeight >= 960) : false,
  };
});
push('常驻暗角存在（alpha>0，depth=88，非低血也显示）',
  filmRt.permAlpha > 0 && filmRt.permDepth === 88 && filmRt.permVisible === true && filmRt.lowHpBase === 0,
  JSON.stringify(filmRt));
push('胶片颗粒：grain_tex 纹理 + 全屏 Image（alpha>0，铺满屏）',
  filmRt.textureExists && filmRt.grainExists && filmRt.grainAlpha > 0
  && filmRt.grainTex === 'grain_tex' && filmRt.grainCovers,
  JSON.stringify(filmRt));

// 颗粒逐帧抖动（非 reduced：把颗粒故意放偏，几帧后 update 应拉回中心 ±1 抖动区）
const jitter = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  ui._filmGrain.setPosition(100, 100);
  return new Promise((res) => setTimeout(() => {
    res({ x: ui._filmGrain.x, y: ui._filmGrain.y });
  }, 90));
});
const jittered = Math.abs(jitter.x - 270) <= 1 && Math.abs(jitter.y - 480) <= 1;
push('胶片颗粒逐帧抖动（呼吸感，非 reduced）', jittered === true,
  `after=${jitter.x},${jitter.y} (应回中心±1)`);

// 截图：菜单（bloom）
await page.evaluate(() => {
  const g = window.__SKY__;
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
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, 'polish2_menu.png') });

// ── C) Boss 入场仪式（非 reduced）──
await page.evaluate(() => {
  const g = window.__SKY__;
  ['MenuScene', 'UIScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await page.waitForTimeout(300);

const bossT0 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (gs.boss) gs.boss = null; // 新场景此时应无 Boss；保险起见清引用
  gs.spawnBoss('boss_sentinel', { name: 'QA 哨兵', color: 0x66ccff, pattern: 'fan', maxHp: 1000, difficulty: 1 });
  const b = gs.boss;
  return { entering: b._entering, y: b.y, targetY: 150 };
});
push('Boss 入场开始：_entering=true 且 y 在屏外上方(<目标位)',
  bossT0.entering === true && bossT0.y < bossT0.targetY,
  JSON.stringify(bossT0));

// 入场中途截图（冲入中）
await page.waitForTimeout(260);
await page.screenshot({ path: path.join(SHOTS, 'polish2_boss_entering.png') });

// 轮询观测「到达瞬间」（替代固定 400ms 后单次采样）：
// 到达演出是瞬时特效——shockwaveRing 320ms、顶光 glow_soft 约 300ms（tween 120+hold60+120），
// 而固定 sleep 会叠加截图/求值开销，采样点很容易落到 320ms 窗口之外 → ring=0 glow=0 假失败
// （本探针曾在全量套件中挂）。改为页面内 20ms 高频采样、最长 6s，记录窗口内最大值，
// 并捕获「首个 _entering=false 帧」的 y 作为到达位。
//
// ⚠️ 位置绑定（必须）：仅统计 depth=56 是**不够**的 —— VFX.localIllum（任何一次爆炸的
//    瞬间局部照亮）同样创建 depth=56 的 glow_soft（见 src/systems/VFX.js 的 _softGlow(..., 56)），
//    因此「全场景扫 depth=56」会让任意一次敌机爆炸点亮 glow 计数 → 断言恒真。
//    实证：负对照把到达演出的 depth 改成 57（应无环无光），结果仍是 ring=0 glow=1 → PASS（假通过）。
//    修法：环与顶光都锚定在 Boss 到达点 (b.x, b.y)，只统计该点 ±60px 内的对象；
//    并改 OR 为 AND（演出本就同时产出环与光），任一缺失即 FAIL。
const bossT1 = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  let anchor = null; // 首个 _entering=false 帧的 Boss 位置 = 环/顶光的创建锚点
  const near = (c) => !!(anchor && typeof c.x === 'number'
    && Math.abs(c.x - anchor.x) <= 60 && Math.abs(c.y - anchor.y) <= 60);
  const sampleFx = () => {
    let ring = 0, glow = 0;
    gs.children.list.forEach((c) => {
      if (c && c.active && near(c)) {
        if (c.type === 'Arc' && c.depth === 56) ring++;
        if (c.type === 'Image' && c.texture && c.texture.key === 'glow_soft' && c.depth === 56) glow++;
      }
    });
    return { ring, glow };
  };
  let maxRing = 0, maxGlow = 0, yAtArrive = null;
  const tStart = performance.now();
  while (performance.now() - tStart < 6000) {
    const b = gs.boss;
    if (b && b.active && b._entering === false && yAtArrive === null) {
      yAtArrive = b.y;
      anchor = { x: b.x, y: b.y };
    }
    const fx = sampleFx();
    if (fx.ring > maxRing) maxRing = fx.ring;
    if (fx.glow > maxGlow) maxGlow = fx.glow;
    if (yAtArrive !== null && maxRing >= 1 && maxGlow >= 1) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const b = gs.boss;
  return {
    entering: b ? b._entering : null,
    y: yAtArrive !== null ? yAtArrive : (b ? b.y : null),
    ringCount: maxRing,
    glowCount: maxGlow,
    anchor,
    hp: b ? b.hp : null,
  };
});
push('Boss 到达目标位：_entering=false 且 y=150（恢复正常）',
  bossT1.entering === false && Math.abs(bossT1.y - 150) < 1 && bossT1.hp > 0 && bossT1.hp <= 1000,
  JSON.stringify(bossT1));
push('Boss 到达演出：冲击波环 + 顶光聚光同时出现（depth=56，锚定到达点 ±60px）',
  bossT1.ringCount >= 1 && bossT1.glowCount >= 1,
  `ring=${bossT1.ringCount} glow=${bossT1.glowCount} anchor=${bossT1.anchor ? bossT1.anchor.x + ',' + bossT1.anchor.y : 'null'}`);
// 到达瞬间截图（冲击波环/聚光）
await page.waitForTimeout(60);
await page.screenshot({ path: path.join(SHOTS, 'polish2_boss_arrive.png') });

// ── 零 pageerror（主流程）──
push('零 pageerror / console.error（主流程）', errors.length === 0,
  errors.length ? errors.slice(0, 3).join(' | ') : '');

// ── reduced-motion：颗粒静态 + Boss 直现 ──
const rmErrors = [];
const rmPage = await browser.newPage({ viewport: { width: 540, height: 960 }, reducedMotion: 'reduce' });
rmPage.on('pageerror', (e) => rmErrors.push('pageerror: ' + e.message));
rmPage.on('console', (m) => { if (m.type() === 'error') rmErrors.push('console.error: ' + m.text()); });
await rmPage.goto(URL, { waitUntil: 'load' });
await rmPage.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 60000 });
await rmPage.evaluate(() => {
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
await rmPage.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await rmPage.waitForFunction(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui && ui.scene.isActive() && ui._filmGrain;
}, { timeout: 20000 });
await rmPage.waitForTimeout(200);
const rmGrainStatic = await rmPage.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  ui._filmGrain.setPosition(300, 500); // 故意放偏：静态实现应被 update 拉回中心并保持
  return new Promise((res) => setTimeout(() => {
    const a = { x: ui._filmGrain.x, y: ui._filmGrain.y };
    setTimeout(() => {
      const b = { x: ui._filmGrain.x, y: ui._filmGrain.y };
      res({ a, b });
    }, 150);
  }, 150));
});
push('reduced-motion 颗粒静态（居中且跨帧不抖动）',
  rmGrainStatic.a.x === 270 && rmGrainStatic.a.y === 480
  && rmGrainStatic.b.x === 270 && rmGrainStatic.b.y === 480,
  JSON.stringify(rmGrainStatic));
const rmBoss = await rmPage.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (gs.boss) gs.boss = null;
  gs.spawnBoss('boss_sentinel', { name: 'QA 哨兵', color: 0x66ccff, pattern: 'fan', maxHp: 1000, difficulty: 1 });
  const b = gs.boss;
  return { entering: b._entering, y: b.y, targetY: 150 };
});
push('reduced-motion Boss 直现目标位（无冲入动画，_entering=false）',
  rmBoss.entering === false && Math.abs(rmBoss.y - 150) < 1,
  JSON.stringify(rmBoss));
push('reduced-motion 下零 pageerror / console.error', rmErrors.length === 0,
  rmErrors.length ? rmErrors.slice(0, 3).join(' | ') : '');

// ── low 性能档降级 ──
const lowErrors = [];
const lowPage = await browser.newPage({ viewport: { width: 540, height: 960 } });
lowPage.on('pageerror', (e) => lowErrors.push('pageerror: ' + e.message));
lowPage.on('console', (m) => { if (m.type() === 'error') lowErrors.push('console.error: ' + m.text()); });
await lowPage.goto(URL, { waitUntil: 'load' });
await lowPage.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 60000 });
await lowPage.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('tutorialDone', true);
  SM.set('quality', 'low');
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await lowPage.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await lowPage.waitForFunction(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui && ui.scene.isActive() && ui._filmGrain;
}, { timeout: 20000 });
const lowRt = await lowPage.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    bloomNull: gs.bloomFX == null,
    grainAlpha: ui._filmGrain ? ui._filmGrain.alpha : -1,
    permAlpha: ui._permVignette ? ui._permVignette.alpha : -1,
    grainQuality: ui._filmGrainQuality,
  };
});
push('low 性能档降级：bloom 关闭 + 颗粒 alpha 减半 + 暗角保留',
  lowRt.bloomNull === true && lowRt.grainAlpha <= 0.03 && lowRt.grainQuality === 'low'
  && lowRt.permAlpha > 0,
  JSON.stringify(lowRt));
push('low 档下零 pageerror / console.error', lowErrors.length === 0,
  lowErrors.length ? lowErrors.slice(0, 3).join(' | ') : '');

await browser.close();

// ── 汇总 ──
const pass = checks.every((c) => c.ok);
const failed = checks.filter((c) => !c.ok);
console.log('---');
if (failed.length) console.log('FAILED: ' + failed.map((c) => c.name).join('; '));
console.log(pass ? 'QA_POLISH2: PASS' : 'QA_POLISH2: FAIL');
process.exit(pass ? 0 : 1);
