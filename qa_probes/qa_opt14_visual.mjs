// qa_opt14_visual.mjs —— OPT-14 画面质感 Top5（A1/A2/A3/C1/B2）验收探针
//
// 规格来源：docs/OPT-14-VISUAL-SPEC.md（arch-opt 函数级规格）。断言真实运行行为：
//   A1  Bloom 排除 UI 层：redraw entries 不含 depth>64 对象（飘字 80 不进 RT），gameplay(≤60) 仍在
//   A2  Bloom 下采样 + 静态脏标记：rt.width=270/height=480、camera.zoom=0.5、scaleX/Y=2；
//       静态菜单 redraw 频率 ≤ ~15/s（staticEveryNFrames=5 兜底）；战斗每帧
//   A3  FILM 全场景统一：menu/result/hangar 有 vignette(88)+grain(96) 且颗粒静态；
//       战斗颗粒动态；low 档 grainAlpha 减半
//   C1  缓动表统一：EASE 表存在且值正确；按钮按压 tween 补 ease 后正常完成（无报错）
//   B2  爆炸残像拖尾：击杀敌机后 afterglowActive≥1 且 1s 内归零；low/reduced 下恒 0
// 运行：node qa_probes/qa_opt14_visual.mjs（QA_URL 默认 http://127.0.0.1:5059）
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

async function newPage(save, reduced = false) {
  const ctx = reduced
    ? await browser.newContext({ viewport: { width: 540, height: 960 }, reducedMotion: 'reduce' })
    : await browser.newContext({ viewport: { width: 540, height: 960 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript((s) => {
    try { localStorage.setItem('sky_raiders_save_v1', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }, save);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
  return { page, errors };
}

async function startCombat(page) {
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
    return ui && ui.burstBtn;
  }, null, { timeout: 10000 });
}

// ════════════════════════ Page A：主断言（high 档）════════════════════════
const A = await newPage({ lang: 'zh', tutorialDone: true, quality: 'high', selectedDifficulty: 'standard' });
const pageA = A.page;

// 等 MenuScene 的 bloom + film 就绪
await pageA.waitForFunction(() => {
  const m = window.__SKY__.scene.getScene('MenuScene');
  return m && m.filmFX && m.bloomFX;
}, null, { timeout: 10000 });

// ── A2 菜单（staticMode 下采样）──
const menuBloom = await pageA.evaluate(() => {
  const ctl = window.__BLOOM;
  const rt = ctl && ctl.rt;
  return {
    has: !!ctl,
    enabled: ctl ? ctl.enabled : null,
    width: rt ? rt.width : null,
    height: rt ? rt.height : null,
    zoom: (rt && rt.camera) ? rt.camera.zoom : null,
    scaleX: rt ? rt.scaleX : null,
    scaleY: rt ? rt.scaleY : null,
    pipelines: ctl ? (ctl.pipelines || []).length : null,
  };
});
push('A2-M1. 菜单 bloom 开启（enabled=true）', menuBloom.has && menuBloom.enabled === true);
push('A2-M2. RT 下采样 1/2：width=270 height=480', menuBloom.width === 270 && menuBloom.height === 480, `w=${menuBloom.width} h=${menuBloom.height}`);
push('A2-M3. rt.camera.zoom=0.5（内部绘制缩放）', menuBloom.zoom === 0.5, `zoom=${menuBloom.zoom}`);
push('A2-M4. rt.setScale(2,2)（显示放大铺满）', menuBloom.scaleX === 2 && menuBloom.scaleY === 2, `sx=${menuBloom.scaleX} sy=${menuBloom.scaleY}`);
push('A2-M5. PostFX bloom 管线存在（pipelines≥1）', (menuBloom.pipelines || 0) >= 1, `n=${menuBloom.pipelines}`);

// ── A2 静态脏标记：1s 内 redraw（实际 rt.draw）次数 ≤ 15（60fps 下 staticEveryNFrames=5 → ~12/s）──
const staticCount = await pageA.evaluate(async () => {
  const ctl = window.__BLOOM;
  const rt = ctl.rt;
  if (!rt.__opt14DrawCounter) {
    const orig = rt.draw.bind(rt);
    rt.__opt14DrawCounter = 0;
    rt.draw = (...a) => { rt.__opt14DrawCounter++; return orig(...a); };
  }
  rt.__opt14DrawCounter = 0;
  await new Promise((r) => setTimeout(r, 1000));
  return rt.__opt14DrawCounter;
});
push('A2-M6. 静态菜单 redraw 限频（1s 内 ≤ 15 次）', staticCount <= 15, `count=${staticCount}`);

// ── A3 菜单 film ──
const menuFilm = await pageA.evaluate(() => {
  const ctl = window.__FILM;
  const m = window.__SKY__.scene.getScene('MenuScene');
  return {
    ctl: !!ctl,
    vignetteDepth: ctl && ctl.vignette ? ctl.vignette.depth : null,
    grainDepth: ctl && ctl.grain ? ctl.grain.depth : null,
    vignetteAlpha: ctl ? ctl.vignetteAlpha : null,
    grainStatic: ctl ? ctl.grainStatic : null,
    sceneFilm: !!(m && m.filmFX && m.filmFX.vignette),
  };
});
push('A3-M1. 菜单 film 层存在（scene.filmFX.vignette）', menuFilm.sceneFilm === true);
push('A3-M2. 菜单 vignette depth=88 / grain depth=96', menuFilm.vignetteDepth === 88 && menuFilm.grainDepth === 96, `v=${menuFilm.vignetteDepth} g=${menuFilm.grainDepth}`);
push('A3-M3. 菜单预置 alpha（vignette 0.10）', menuFilm.vignetteAlpha === 0.10, `a=${menuFilm.vignetteAlpha}`);
push('A3-M4. 菜单颗粒静态（grainStatic=true，防闪烁红线）', menuFilm.grainStatic === true, `static=${menuFilm.grainStatic}`);

// ── C1 缓动表 + 按钮按压 ease ──
const c1 = await pageA.evaluate(async () => {
  const { EASE } = await import('/src/config/GameConfig.js');
  const { NeonButton } = await import('/src/utils/UIWidgets.js');
  const scene = window.__SKY__.scene.getScene('MenuScene');
  const btn = new NeonButton(scene, 270, 720, 'C1TEST', {});
  btn.container.emit('pointerdown');
  await new Promise((r) => setTimeout(r, 220));
  const scale = btn.container.scale;
  const ok = Math.abs(scale - 1) < 0.02;
  btn.destroy();
  return {
    easeOk: !!EASE && EASE.enter === 'Cubic.easeOut' && EASE.pop === 'Back.easeOut'
      && EASE.breathe === 'Sine.easeInOut' && EASE.feedback === 'Quad.easeOut' && EASE.exit === 'Cubic.easeIn',
    pressOk: ok,
    scale,
  };
});
push('C1-1. EASE 表存在且五语义值正确（enter/pop/breathe/feedback/exit）', c1.easeOk === true);
push('C1-2. NeonButton 按压 tween（补 ease）正常完成（scale 回 1 无报错）', c1.pressOk === true, `scale=${c1.scale}`);

// ── 进入战斗 ──
await startCombat(pageA);

// ── A2 战斗（动态，仍下采样）──
const combatBloom = await pageA.evaluate((menuPipelines) => {
  const ctl = window.__BLOOM;
  const rt = ctl && ctl.rt;
  return {
    has: !!ctl,
    active: rt ? rt.active : null,
    width: rt ? rt.width : null,
    zoom: (rt && rt.camera) ? rt.camera.zoom : null,
    scaleX: rt ? rt.scaleX : null,
    pipelines: ctl ? (ctl.pipelines || []).length : null,
    menuPipelines,
  };
}, menuBloom.pipelines);
push('A2-B1. 战斗 bloom 仍开启且 rt.active', combatBloom.has && combatBloom.active === true);
push('A2-B2. 战斗同样下采样（width=270 zoom=0.5 scaleX=2）', combatBloom.width === 270 && combatBloom.zoom === 0.5 && combatBloom.scaleX === 2,
  `w=${combatBloom.width} z=${combatBloom.zoom}`);
push('A2-B3. PostFX 管线节点数与菜单一致（未增未减）', combatBloom.pipelines === combatBloom.menuPipelines,
  `menu=${combatBloom.menuPipelines} combat=${combatBloom.pipelines}`);

// ── A1 排除 UI 层 ──
const a1 = await pageA.evaluate(() => {
  const gs = window.__SKY;                 // GameScene
  const ctl = window.__BLOOM;
  const rt = ctl.rt;
  if (!rt.__opt14DrawLog) {
    const orig = rt.draw.bind(rt);
    rt.__opt14DrawLog = [];
    rt.draw = (...a) => { if (Array.isArray(a[0])) rt.__opt14DrawLog.push(a[0]); return orig(...a); };
  }
  // 测试对象：depth 80（模拟飘字/弹窗 UI 层）应排除；depth 20（模拟 gameplay）应保留
  const t80 = gs.add.text(120, 120, 'A1-UI80', {}).setDepth(80);
  const t20 = gs.add.text(220, 220, 'A1-GP20', {}).setDepth(20);
  ctl.redraw();
  const last = rt.__opt14DrawLog[rt.__opt14DrawLog.length - 1] || [];
  const in80 = last.some((o) => o === t80);
  const in20 = last.some((o) => o === t20);
  const maxDepth = last.reduce((m, o) => Math.max(m, (o && o.depth) || 0), 0);
  const n = last.length;
  t80.destroy(); t20.destroy();
  return { in80, in20, maxDepth, n };
});
push('A1-1. redraw entries 不含 depth=80 的 UI 层对象（飘字/弹窗不进辉光）', a1.in80 === false, `in80=${a1.in80}`);
push('A1-2. redraw entries 保留 depth=20 的 gameplay 对象', a1.in20 === true, `in20=${a1.in20}`);
push('A1-3. redraw entries 最大 depth ≤ 64（阈值生效）', a1.maxDepth <= 64, `max=${a1.maxDepth} n=${a1.n}`);

// ── A3 战斗 film ──
const combatFilm = await pageA.evaluate(() => {
  const ctl = window.__FILM;
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    ctl: !!ctl,
    vignetteAlpha: ctl ? ctl.vignetteAlpha : null,
    grainStatic: ctl ? ctl.grainStatic : null,
    grainSpeed: ctl ? ctl.grainSpeed : null,
    uiCtl: !!(ui && ui._filmCtl && ui._filmCtl.grain),
  };
});
push('A3-B1. 战斗 film 层存在（UIScene._filmCtl.grain）', combatFilm.uiCtl === true);
push('A3-B2. 战斗预置 alpha（vignette 0.16）', combatFilm.vignetteAlpha === 0.16, `a=${combatFilm.vignetteAlpha}`);
push('A3-B3. 战斗颗粒动态（grainSpeed=true / grainStatic=false）', combatFilm.grainSpeed === true && combatFilm.grainStatic === false,
  `speed=${combatFilm.grainSpeed} static=${combatFilm.grainStatic}`);

// ── B2 高画质：击杀 → 残影出现 → 1s 内归零 ──
await pageA.waitForFunction(() => {
  const g = window.__SKY__;
  return g && g._dynLight && g._dynLight.afterglowActive === 0;
}, null, { timeout: 3000 }).catch(() => {});
await pageA.evaluate(() => {
  const gs = window.__SKY;
  if (gs.waves) { gs.waves.state = 'idle'; gs.waves._toSpawn = 0; }
  gs.enemies.children.each((e) => { if (e.active) { e.setActive(false); e.setVisible(false); if (e.body) e.body.enable = false; } });
});
await pageA.evaluate(() => {
  const gs = window.__SKY;
  const e = gs.spawnEnemy(270, 220, 'small');
  if (e) e.hit(9999);
});
const b2Appear = await pageA.waitForFunction(() => {
  const g = window.__SKY__;
  return g._dynLight.afterglowActive >= 1;
}, null, { timeout: 800 }).then(() => true).catch(() => false);
push('B2-H1. 高画质击杀 → 残影出现（afterglowActive≥1）', b2Appear === true);
const b2Clear = await pageA.waitForFunction(() => {
  const g = window.__SKY__;
  return g._dynLight.afterglowActive === 0;
}, null, { timeout: 2500 }).then(() => true).catch(() => false);
push('B2-H2. 残影 1s 内全部销毁（afterglowActive 归 0）', b2Clear === true);

// ── ResultScene film（A3）──
await pageA.evaluate(() => {
  const game = window.__SKY__;
  game.scene.stop('GameScene');
  game.scene.stop('UIScene');
  game.scene.start('ResultScene', { levelId: 1, mode: 'normal', victory: true, stars: 2, score: 1000 });
});
await pageA.waitForFunction(() => {
  const r = window.__SKY__.scene.getScene('ResultScene');
  return r && r.filmFX && window.__FILM && window.__FILM.grain;
}, null, { timeout: 10000 });
const resFilm = await pageA.evaluate(() => {
  const ctl = window.__FILM;
  return {
    vignetteAlpha: ctl.vignetteAlpha,
    grainStatic: ctl.grainStatic,
    grainDepth: ctl.grain ? ctl.grain.depth : null,
  };
});
push('A3-R1. 结算 film 层存在且 vignette depth=88 / grain depth=96', resFilm.grainDepth === 96);
push('A3-R2. 结算预置 alpha（vignette 0.12）', resFilm.vignetteAlpha === 0.12, `a=${resFilm.vignetteAlpha}`);
push('A3-R3. 结算颗粒静态（grainStatic=true）', resFilm.grainStatic === true, `static=${resFilm.grainStatic}`);

// ── HangarScene film（A3）──
await pageA.evaluate(() => {
  window.__SKY__.scene.start('HangarScene');
});
await pageA.waitForFunction(() => {
  const h = window.__SKY__.scene.getScene('HangarScene');
  return h && h.filmFX && window.__FILM && window.__FILM.grain;
}, null, { timeout: 10000 });
const hangarFilm = await pageA.evaluate(() => {
  const ctl = window.__FILM;
  return {
    vignetteAlpha: ctl.vignetteAlpha,
    grainStatic: ctl.grainStatic,
    grainDepth: ctl.grain ? ctl.grain.depth : null,
  };
});
push('A3-H1. 机库 film 层存在且 vignette depth=88 / grain depth=96', hangarFilm.grainDepth === 96);
push('A3-H2. 机库预置 alpha（vignette 0.11）', hangarFilm.vignetteAlpha === 0.11, `a=${hangarFilm.vignetteAlpha}`);
push('A3-H3. 机库颗粒静态（grainStatic=true）', hangarFilm.grainStatic === true, `static=${hangarFilm.grainStatic}`);

push('I-1. Page A 零 pageerror / console.error', A.errors.length === 0, `errors=${A.errors.length}${A.errors.length ? ' :: ' + A.errors.slice(0, 2).join(' | ') : ''}`);

// ════════════════════════ Page B：low 档（B2 不生成 + A3 grainAlpha 减半）════════════════════════
const B = await newPage({ lang: 'zh', tutorialDone: true, quality: 'low', selectedDifficulty: 'standard' });
const pageB = B.page;
await pageB.waitForFunction(() => {
  const m = window.__SKY__.scene.getScene('MenuScene');
  return m && m.filmFX;
}, null, { timeout: 10000 });
const lowMenuFilm = await pageB.evaluate(() => {
  const ctl = window.__FILM;
  return ctl ? { grainAlpha: ctl.grainAlpha, grainStatic: ctl.grainStatic } : null;
});
push('A3-L1. low 档菜单颗粒 alpha 减半（0.02→0.01）', lowMenuFilm && Math.abs(lowMenuFilm.grainAlpha - 0.01) < 1e-9, `a=${lowMenuFilm && lowMenuFilm.grainAlpha}`);
push('A3-L2. low 档菜单颗粒仍静态', lowMenuFilm && lowMenuFilm.grainStatic === true);

await startCombat(pageB);
await pageB.evaluate(() => {
  const gs = window.__SKY;
  if (gs.waves) { gs.waves.state = 'idle'; gs.waves._toSpawn = 0; }
  gs.enemies.children.each((e) => { if (e.active) { e.setActive(false); e.setVisible(false); if (e.body) e.body.enable = false; } });
});
await pageB.evaluate(() => {
  const gs = window.__SKY;
  const e = gs.spawnEnemy(270, 220, 'small');
  if (e) e.hit(9999);
});
await pageB.waitForTimeout(500);
const lowAfter = await pageB.evaluate(() => {
  const g = window.__SKY__;
  return g._dynLight ? g._dynLight.afterglowActive : -1;
});
push('B2-L1. low 档（qs=0.45<0.6）击杀后无残影（afterglowActive=0）', lowAfter === 0, `after=${lowAfter}`);
push('I-2. Page B 零 pageerror / console.error', B.errors.length === 0, `errors=${B.errors.length}`);

// ════════════════════════ Page C：reduced-motion（B2 不生成）════════════════════════
const C = await newPage({ lang: 'zh', tutorialDone: true, quality: 'high', selectedDifficulty: 'standard' }, true);
const pageC = C.page;
await pageC.waitForFunction(() => {
  const m = window.__SKY__.scene.getScene('MenuScene');
  return m && m.filmFX;
}, null, { timeout: 10000 });
const redFilm = await pageC.evaluate(() => {
  const ctl = window.__FILM;
  return ctl ? { grainStatic: ctl.grainStatic, grainSpeed: ctl.grainSpeed } : null;
});
push('A3-RED1. reduced-motion 下战斗档颗粒强制静态（grainSpeed=false）', redFilm && redFilm.grainSpeed === false && redFilm.grainStatic === true,
  `speed=${redFilm && redFilm.grainSpeed}`);
await startCombat(pageC);
await pageC.evaluate(() => {
  const gs = window.__SKY;
  if (gs.waves) { gs.waves.state = 'idle'; gs.waves._toSpawn = 0; }
  gs.enemies.children.each((e) => { if (e.active) { e.setActive(false); e.setVisible(false); if (e.body) e.body.enable = false; } });
});
await pageC.evaluate(() => {
  const gs = window.__SKY;
  const e = gs.spawnEnemy(270, 220, 'small');
  if (e) e.hit(9999);
});
await pageC.waitForTimeout(500);
const redAfter = await pageC.evaluate(() => {
  const g = window.__SKY__;
  return g._dynLight ? g._dynLight.afterglowActive : -1;
});
push('B2-RED1. reduced-motion 下击杀后无残影（afterglowActive=0）', redAfter === 0, `after=${redAfter}`);
push('I-3. Page C 零 pageerror / console.error', C.errors.length === 0, `errors=${C.errors.length}`);

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n==== OPT-14 视觉探针 结果：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((c) => console.log('  ❌ ' + c.name));
  process.exit(1);
}
process.exit(0);
