// qa_juice_visual_p3.mjs —— P3 画面质感打磨·消除廉价感 真测
//
// 断言（对应 7 步实施）：
//   1) 爆炸五层接口存在且 explosionLayered 至少触发 4 层（闪光/环/粒子/残骸/烟尘）
//   2) Boss.die 弹性缩放 tween（Back.easeOut 90ms → Back.easeIn 260ms，源码级）
//   3) 普通命中 hitStop 33（_impactFeedback 内 requestHitStop(33)）
//   4) 敌弹拖尾 emitter 存在（GameScene.enemyTrail + Enemy/Boss spawn 挂载）
//   5) addKeyLight / glowTarget 存在且生效（glow_soft 场景光 + capped 玩家弹柔光池）
//   6) VFX_COLORS 导出（flash/ring/debris/smoke/hit/trail.*）
//   7) UI 玻璃拟态：THEME.panelBgAlpha≈0.72 + panelGlass 常量 + NeonButton 文字投影
//   8) Starfield：星云 alpha≈0.22 + 底部地平线光带 bg_glowband
//   9) 零 pageerror / console.error
//  10) reduced-motion 下无 pageerror，且动态特效降级（enemyTrail 为 null）
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

// ── 进入 GameScene（复用既有标准姿势）──
await page.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('tutorialDone', true);
  SM.set('selectedDifficulty', 'standard');
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

// ── 1) 爆炸五层：接口存在 + explosionLayered 至少触发 4 层 ──
const r1 = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const VFX = await import('/src/systems/VFX.js');
  const out = {
    api: {
      explosionLayered: typeof VFX.explosionLayered,
      flashCore: typeof VFX.flashCore,
      shockwaveRing: typeof VFX.shockwaveRing,
      debrisBurst: typeof VFX.debrisBurst,
      smokePuff: typeof VFX.smokePuff,
      enemyBulletTrail: typeof VFX.enemyBulletTrail,
      addKeyLight: typeof VFX.addKeyLight,
      glowTarget: typeof VFX.glowTarget,
    },
  };
  // 采样对象计数（Arc=circle 层，ParticleEmitter=粒子层）
  const count = () => {
    let arcs = 0, emitters = 0;
    gs.children.list.forEach((c) => {
      if (c.type === 'Arc') arcs++;
      if (c.type === 'ParticleEmitter') emitters++;
    });
    return { arcs, emitters };
  };
  const t0 = count();
  VFX.explosionLayered(gs, gs.player.x, gs.player.y - 60, 0xff5a6e, { tier: 'small' });
  await new Promise((res) => setTimeout(res, 100));
  const t1 = count();
  await new Promise((res) => setTimeout(res, 70));
  const t2 = count();
  out.maxArcs = Math.max(t1.arcs - t0.arcs, t2.arcs - t0.arcs);
  out.maxEmitters = Math.max(t1.emitters - t0.emitters, t2.emitters - t0.emitters);
  return out;
});
push('VFX 五层接口导出（explosionLayered/flashCore/shockwaveRing/debrisBurst/smokePuff）',
  !!r1.api.explosionLayered && !!r1.api.flashCore && !!r1.api.shockwaveRing
  && !!r1.api.debrisBurst && !!r1.api.smokePuff,
  JSON.stringify(r1.api));
push('explosionLayered 至少 4 层触发（闪光圆+冲击波环 ≥2 Arc，粒子+残骸+烟尘 ≥3 Emitter）',
  r1.maxArcs >= 2 && r1.maxEmitters >= 3,
  `maxArcs=${r1.maxArcs} maxEmitters=${r1.maxEmitters}`);

// ── 2) Boss.die 弹性缩放 tween（源码级）──
const bossSrc = fs.readFileSync(path.join(ROOT, 'src/entities/Boss.js'), 'utf8');
const dieBlock = bossSrc.slice(bossSrc.indexOf('die()'), bossSrc.indexOf('recycle') >= 0 ? bossSrc.indexOf('recycle') : bossSrc.length);
push('Boss.die 含 Back.easeOut（1→1.25 回弹）', /Back\.easeOut/.test(dieBlock), '');
push('Boss.die 含 Back.easeIn（→0 收缩）', /Back\.easeIn/.test(dieBlock), '');

// ── 3) 普通命中 hitStop 33 ──
const hitStop = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs._hitStopMs = 0;
  gs._hitStopGapUntil = 0;
  gs._lastImpact = 0;
  gs._impactFeedback();
  return { ms: gs._hitStopMs };
});
push('普通命中 hitStop=33（2 帧定格）', hitStop.ms === 33, `ms=${hitStop.ms}`);

// ── 4) 敌弹拖尾 emitter 存在 + spawn 挂载（源码级）──
const trailRt = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    enemyTrail: !!gs.enemyTrail && typeof gs.enemyTrail.emitParticleAt === 'function',
    trailType: gs.enemyTrail ? gs.enemyTrail.type : null,
  };
});
const enemySrc = fs.readFileSync(path.join(ROOT, 'src/entities/Enemy.js'), 'utf8');
const bossSrc2 = fs.readFileSync(path.join(ROOT, 'src/entities/Boss.js'), 'utf8');
push('GameScene.enemyTrail 敌弹拖尾 emitter 存在', trailRt.enemyTrail === true, `type=${trailRt.trailType}`);
push('Enemy.fireAtPlayer 挂 enemyTrail.emitParticleAt', /scene\.enemyTrail/.test(enemySrc), '');
push('Boss.spawnBullet 挂 enemyTrail.emitParticleAt', /scene\.enemyTrail/.test(bossSrc2), '');

// ── 5) addKeyLight / glowTarget 存在且生效 ──
const lightRt = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  let keyLight = null, glowCount = 0, addCount = 0;
  gs.children.list.forEach((c) => {
    if (c && c.texture && c.texture.key === 'glow_soft') {
      glowCount++;
      if (c.depth === 8) keyLight = c;
      if (c.blendMode === 1) addCount++;
    }
  });
  return {
    glowCount,
    addCount,
    keyLightDepth: keyLight ? keyLight.depth : null,
    keyLightAlpha: keyLight ? keyLight.alpha : null,
    poolLen: gs._bulletGlowPool ? gs._bulletGlowPool.length : 0,
  };
});
push('addKeyLight 存在且生效（depth=8 的 glow_soft 顶光，ADD 混合）',
  lightRt.keyLightDepth === 8 && lightRt.addCount >= 1 && lightRt.keyLightAlpha > 0,
  JSON.stringify(lightRt));
push('玩家弹柔光 capped 池（_bulletGlowPool>0，防滥用）', lightRt.poolLen > 0, `pool=${lightRt.poolLen}`);
push('glowTarget 存在（VFX 导出 + 场景内 glow_soft 跟随层）',
  r1.api.glowTarget === 'function' && lightRt.glowCount >= 2,
  `glow_soft=${lightRt.glowCount}`);

// ── 6) VFX_COLORS 导出 ──
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  return gc.VFX_COLORS;
});
push('VFX_COLORS 导出且字段齐全（flash/ring/debris/smoke/hit/trail.*）',
  !!cfg && cfg.flash === 0xffffff && cfg.ring === 0xff5a6e && cfg.debris === 0x8a2233
  && cfg.smoke === 0x55606a && Array.isArray(cfg.hit) && cfg.hit.length === 4
  && cfg.trail && cfg.trail.enemy === 0xff5a3c && cfg.trail.pulse === 0x66ccff
  && cfg.trail.fire === 0xff7a3a && cfg.trail.ice === 0x6fd6ff && cfg.trail.thunder === 0xffe14a,
  JSON.stringify(cfg && cfg.flash !== undefined ? { flash: cfg.flash, hitLen: cfg.hit.length, enemy: cfg.trail.enemy } : 'missing'));

// ── 7) UI 玻璃拟态 ──
const uiMod = await page.evaluate(async () => {
  const m = await import('/src/utils/UIWidgets.js');
  return {
    panelBgAlpha: m.THEME.panelBgAlpha,
    hasGlass: !!(m.THEME.panelGlass && m.THEME.panelGlass.innerStroke !== undefined && m.THEME.panelGlass.topHighlight !== undefined),
    drawGlassPanel: typeof m.drawGlassPanel,
  };
});
push('THEME.panelBgAlpha≈0.72（0.94→0.72 玻璃半透）',
  uiMod.panelBgAlpha != null && Math.abs(uiMod.panelBgAlpha - 0.72) < 0.01, `alpha=${uiMod.panelBgAlpha}`);
push('THEME.panelGlass 常量存在 + drawGlassPanel 导出', uiMod.hasGlass && uiMod.drawGlassPanel === 'function', '');
// 切回 MenuScene 实测按钮投影（neon-button 容器里的 Text 带 setShadow(0,2,#000,4)）
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
const uiBtn = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  let btn = null;
  const walk = (list) => list.forEach((c) => {
    if (!btn && c && c.name === 'neon-button' && c.list && c.list.length) {
      const t = c.list.find((x) => x && x.type === 'Text');
      if (t && t.style) btn = { shadowX: t.style.shadowOffsetX, shadowY: t.style.shadowOffsetY, ls: t.letterSpacing };
    }
    if (c && c.list && c.list.length) walk(c.list);
  });
  if (ms && ms.children) walk(ms.children.list);
  return btn;
});
push('NeonButton 文字投影 setShadow(0,2,#000,4)',
  !!uiBtn && uiBtn.shadowX === 0 && uiBtn.shadowY === 2 && uiBtn.ls >= 1,
  uiBtn ? JSON.stringify(uiBtn) : 'no neon-button found');
// 切回 GameScene 供后续背景断言
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

// ── 8) Starfield：星云 alpha≈0.22 + 地平线光带 ──
const star = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  let nebulaBase = null, nebulaNow = null, glowband = null;
  gs.children.list.forEach((c) => {
    if (c && c.texture) {
      if (c.texture.key === 'bg_nebula' && nebulaBase == null) { nebulaBase = c._baseAlpha; nebulaNow = c.alpha; }
      if (c.texture.key === 'bg_glowband' && !glowband) glowband = { alpha: c.alpha, add: c.blendMode === 1, depth: c.depth };
    }
  });
  return { nebulaBase, nebulaNow, glowband };
});
push('Starfield 星云基准 alpha≈0.22（0.16→0.22；呼吸脉动调制的是当前 alpha）',
  star.nebulaBase != null && Math.abs(star.nebulaBase - 0.22) < 0.02,
  `base=${star.nebulaBase} now=${star.nebulaNow}`);
push('Starfield 底部地平线光带 bg_glowband 存在（ADD 贴底）',
  !!star.glowband && star.glowband.add === true && star.glowband.depth < 0,
  star.glowband ? JSON.stringify(star.glowband) : 'missing');

// ── 9) 零 pageerror / console.error ──
push('零 pageerror / console.error（主流程）', errors.length === 0,
  errors.length ? errors.slice(0, 3).join(' | ') : '');

// ── 10) reduced-motion 下无 pageerror + 动态特效降级 ──
const rmErrors = [];
const rmPage = await browser.newPage({ viewport: { width: 540, height: 960 }, reducedMotion: 'reduce' });
rmPage.on('pageerror', (e) => rmErrors.push('pageerror: ' + e.message));
rmPage.on('console', (m) => { if (m.type() === 'error') rmErrors.push('console.error: ' + m.text()); });
await rmPage.goto(URL, { waitUntil: 'load' });
await rmPage.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
const rm = await rmPage.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('tutorialDone', true);
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  return true;
});
await rmPage.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await rmPage.waitForTimeout(800); // 让 create/update 路径跑过
const rmRt = await rmPage.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { enemyTrailNull: gs.enemyTrail == null, bulletTrailsNull: gs.bulletTrails == null };
});
push('reduced-motion 下动态特效降级（enemyTrail/bulletTrails 为 null）',
  rmRt.enemyTrailNull === true && rmRt.bulletTrailsNull === true, JSON.stringify(rmRt));
push('reduced-motion 下零 pageerror / console.error', rmErrors.length === 0,
  rmErrors.length ? rmErrors.slice(0, 3).join(' | ') : '');

await browser.close();

// ── 汇总 ──
const pass = checks.every((c) => c.ok);
const failed = checks.filter((c) => !c.ok);
console.log('---');
if (failed.length) console.log('FAILED: ' + failed.map((c) => c.name).join('; '));
console.log(pass ? 'QA_JUICE_VISUAL_P3: PASS' : 'QA_JUICE_VISUAL_P3: FAIL');
process.exit(pass ? 0 : 1);
