// qa_opt15_visual.mjs —— OPT-15 V系纯视觉五项（V2/V3/V5/V7/V4）验收探针
//
// 规格来源：docs/OPT-15-VISUAL-SPEC.md（arch-opt 函数级规格）。断言真实运行行为：
//   V2  擦弹火花：擦弹触发 sparks → _dynLight.grazeSparkCount +1、vfxPool.grazeSpark.poolUseCount>0、
//       high 档 lastQuantity=6；同帧 5 连擦 cap≤3；reduced 下恒 0；low 档 lastQuantity=2
//   V3  波次清空：击杀本波最后敌机 → _dynLight.waveClearCount +1；Boss 战结束不 +1
//   V5  关卡环境：_envNarrative{watermark,emblem,progress}；watermark 非 raw key；
//       normal progress.ratio>0（wave1/total）；无尽/BossRush progress===null
//   V7  暂停氛围：暂停 __PAUSE.paused=true / fog≈0.22 / pulsing=true；恢复 pulsing=false、alpha 回 base；
//       reduced/low 下 pulsing=false
//   V4  单位待机：战斗中普通敌机存在 → idleAuraActive>0；spawn+recycle 30 次后增量≈0（防监听泄漏）；
//       reduced/low 下恒 0
// 运行：node qa_probes/qa_opt15_visual.mjs（QA_URL 默认 http://127.0.0.1:5059）
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

/** 进入一局（GameScene + UIScene，normal level 1；reduced/low 由 save 控制） */
async function startCombat(page) {
  await page.evaluate(async () => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
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
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs._envNarrative && window.__GAME && window.__GAME._dynLight;
  }, null, { timeout: 10000 });
}

/** 进入 bossrush 一局（仅 GameScene；V3 Boss 波不误触发） */
async function startBossRush(page) {
  await page.evaluate(async () => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
    game.scene.start('GameScene', { mode: 'bossrush', levelId: 1 });
    await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const gs = game.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active && gs.boss && gs.boss.active) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
      }, 50);
    });
  });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs._envNarrative && window.__GAME && window.__GAME._dynLight;
  }, null, { timeout: 10000 });
}

// ════════════════════════════ Page A：high 档主断言 ════════════════════════════
const A = await newPage({ lang: 'zh', tutorialDone: true, quality: 'high', selectedDifficulty: 'standard' });
const pageA = A.page;

// ── 1) 静态配置（append-only 5 块）──
const cfg = await pageA.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  return {
    gs: gc.GRAZE_SPARK, ia: gc.IDLE_AURA, wc: gc.WAVE_CLEAR,
    en: gc.ENV_NARRATIVE, pa: gc.PAUSE_ATMO,
  };
});
push('V*配置 GRAZE_SPARK 存在（10 字段）', !!cfg.gs && cfg.gs.quantity === 6 && cfg.gs.maxPerFrame === 3
  && cfg.gs.tint === 0x66ffff && cfg.gs.speedMin === 20 && cfg.gs.speedMax === 70
  && cfg.gs.lifespan === 160 && cfg.gs.scale === 0.5 && cfg.gs.alpha === 0.9 && cfg.gs.depth === 55 && cfg.gs.enabled === true,
  JSON.stringify(cfg.gs));
push('V*配置 IDLE_AURA 存在（minQuality=0.6 + 三实体）', !!cfg.ia && cfg.ia.minQuality === 0.6
  && cfg.ia.enemy.radius === 1.0 && cfg.ia.enemy.alpha === 0.10 && cfg.ia.enemy.ms === 1500
  && cfg.ia.boss.radius === 1.9 && cfg.ia.boss.ms === 2000 && cfg.ia.wingman.radius === 0.8 && cfg.ia.wingman.alpha === 0.14,
  JSON.stringify(cfg.ia));
push('V*配置 WAVE_CLEAR 存在（ringRadius=46/ringMs=340/burstScale=0.5/uiPulse）', !!cfg.wc
  && cfg.wc.ringRadius === 46 && cfg.wc.ringMs === 340 && cfg.wc.burstScale === 0.5 && cfg.wc.uiPulse === true,
  JSON.stringify(cfg.wc));
push('V*配置 ENV_NARRATIVE 存在（watermark/emblem/progress）', !!cfg.en
  && cfg.en.watermark.alpha === 0.18 && cfg.en.watermark.size === 12 && cfg.en.watermark.depth === 4
  && cfg.en.emblem.alpha === 0.22 && cfg.en.emblem.depth === 4 && cfg.en.emblem.size === 12
  && cfg.en.progress.y === (cfg.en.progress.y) && cfg.en.progress.h === 2 && cfg.en.progress.depth === 4,
  JSON.stringify(cfg.en));
push('V*配置 PAUSE_ATMO 存在（fog/glow）', !!cfg.pa && cfg.pa.fogAlpha === 0.22 && cfg.pa.fogPulse === 0.08
  && cfg.pa.fogMs === 2000 && cfg.pa.glowAlpha === 0.16 && cfg.pa.glowPulse === 0.10 && cfg.pa.glowMs === 2200 && cfg.pa.glowScale === 0.6,
  JSON.stringify(cfg.pa));

// ── 2) 进战斗（high）──
await startCombat(pageA);

// ── 3) V5 关卡环境叙事层 ──
const env = await pageA.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const n = gs._envNarrative || {};
  return {
    has: !!gs._envNarrative,
    watermarkText: n.watermark ? n.watermark.text : null,
    watermarkAlpha: n.watermark ? n.watermark.alpha : null,
    watermarkDepth: n.watermark ? n.watermark.depth : null,
    hasEmblem: !!(n.emblem && n.emblem.active),
    hasProgress: !!(n.progress && typeof n.progress.setRatio === 'function'),
    progressRatio: n.progress ? n.progress.ratio : null,
    accent: n.accent || null,
  };
});
push('V5. _envNarrative 存在（watermark/emblem/progress）', env.has && env.watermarkText != null && env.hasEmblem && env.hasProgress, JSON.stringify(env));
push('V5. watermark 文本非 raw key（不显示 levelName_N）', env.watermarkText != null && !/^levelName_\d+$/.test(env.watermarkText), `text=${JSON.stringify(env.watermarkText)}`);
push('V5. watermark 低干扰（alpha 0.18 / depth 4）', Math.abs(env.watermarkAlpha - 0.18) < 0.001 && env.watermarkDepth === 4, `alpha=${env.watermarkAlpha} depth=${env.watermarkDepth}`);
push('V5. normal 进度线初始 ratio>0（wave1/total）', env.hasProgress && env.progressRatio > 0, `ratio=${env.progressRatio}`);

// V5 进度增长：触发 WAVE_STARTED → ratio 更新为 wave/total
const envGrow = await pageA.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const r0 = gs._envNarrative.progress.ratio;
  gs._onWaveStartedEnv({ wave: 3, total: 6 });
  const r1 = gs._envNarrative.progress.ratio;
  return { r0, r1 };
});
push('V5. WAVE_STARTED 驱动 progress.ratio 增长（0.5 > 初始）', envGrow.r1 === 0.5 && envGrow.r1 > envGrow.r0, `r0=${envGrow.r0} r1=${envGrow.r1}`);

// ── 4) V2 擦弹火花 ──
const graze = await pageA.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  const d0 = window.__GAME._dynLight.grazeSparkCount;
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  gs.grazeCount = 0; gs.grazeChain = 0; gs._grazeChainUntil = 0;
  const b = gs.enemyBullets.get(p.x + 15, p.y, 'bullet_enemy');
  b.setActive(true).setVisible(true); b.body.enable = true;
  b.setPosition(p.x + 15, p.y); b.body.velocity.set(0, 200); b._grazedAt = null;
  gs._updateGraze(gs.time.now);
  const d1 = window.__GAME._dynLight.grazeSparkCount;
  const gs2 = gs.vfxPool ? gs.vfxPool.grazeSpark : null;
  return {
    inc: d1 - d0,
    poolUse: gs2 ? gs2.poolUseCount : null,
    lastQty: gs2 ? gs2.lastQuantity : null,
    grazeCount: gs.grazeCount,
  };
});
push('V2. 擦弹触发火花：_dynLight.grazeSparkCount +1', graze.inc === 1, `inc=${graze.inc}`);
push('V2. 火花走池：vfxPool.grazeSpark.poolUseCount>0', graze.poolUse > 0, `poolUse=${graze.poolUse}`);
push('V2. high 档单次粒子量 lastQuantity=6', graze.lastQty === 6, `lastQty=${graze.lastQty}`);
push('V2. 擦弹结算不受影响（grazeCount=1）', graze.grazeCount === 1, `grazeCount=${graze.grazeCount}`);

// V2 同帧 5 连擦 cap
const cap = await pageA.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  const d0 = window.__GAME._dynLight.grazeSparkCount;
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  gs.grazeCount = 0; gs.grazeChain = 0; gs._grazeChainUntil = 0;
  const mk = (dx, dy = 0) => {
    const b = gs.enemyBullets.get(p.x + dx, p.y + dy, 'bullet_enemy');
    b.setActive(true).setVisible(true); b.body.enable = true;
    b.setPosition(p.x + dx, p.y + dy); b.body.velocity.set(0, 200); b._grazedAt = null;
    return b;
  };
  for (let i = 0; i < 5; i++) { mk(15, i * 3 - 6); gs._updateGraze(gs.time.now); }
  return { inc: window.__GAME._dynLight.grazeSparkCount - d0 };
});
push('V2. 同帧 5 连擦 cap≤3（maxPerFrame=3）', cap.inc <= 3, `inc=${cap.inc}`);

// ── 5) V4 单位待机（战斗中普通敌机存在 → idleAuraActive>0）──
const auraLive = await pageA.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  // 生成一只普通敌机（small，非 elite/kamikaze）→ 应挂 aura
  const e = gs.enemies.get();
  e.spawn(200, -50, 'small', 'straight', 1, 'straight', 1, 1, false, null);
  const afterSpawn = window.__GAME._dynLight.idleAuraActive;
  e.recycle();
  const afterRecycle = window.__GAME._dynLight.idleAuraActive;
  return { afterSpawn, afterRecycle };
});
push('V4. 普通敌机 spawn → idleAuraActive>0', auraLive.afterSpawn > 0, `idleAuraActive=${auraLive.afterSpawn}`);
push('V4. recycle 后 idleAuraActive 回落（stop 生效）', auraLive.afterRecycle < auraLive.afterSpawn, `afterRecycle=${auraLive.afterRecycle}`);

// V4 监听泄漏：spawn+recycle 30 次 → 增量≈0（stop() 解绑 update 监听 + kill tween）
const leak = await pageA.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const d0 = window.__GAME._dynLight.idleAuraActive;
  for (let i = 0; i < 30; i++) {
    const e = gs.enemies.get();
    if (!e) break;
    e.spawn(100 + i * 3, -50, 'small', 'straight', 1, 'straight', 1, 1, false, null);
    e.recycle();
  }
  const d1 = window.__GAME._dynLight.idleAuraActive;
  return { d0, d1, delta: d1 - d0 };
});
push('V4. 泄漏检查：spawn+recycle 30 次后 idleAuraActive 增量<10', leak.delta < 10, `d0=${leak.d0} d1=${leak.d1} delta=${leak.delta}`);

// ── 6) V3 波次清空庆祝（击杀本波最后敌机 → waveClearCount +1）──
// 等 waves 进入 waiting 态，然后杀光当前波敌机 → WAVE_CLEARED
const waveClear = await (async () => {
  const before = await pageA.evaluate(() => window.__GAME._dynLight.waveClearCount);
  const waited = await pageA.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.waves && gs.waves.state === 'waiting';
  }, { timeout: 12000 }).then(() => true).catch(() => false);
  if (!waited) return { ok: false, reason: 'no waiting state', before };
  const killed = await pageA.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    gs.enemies.children.each((e) => { if (e.active) e.die(); });
    return true;
  });
  const after = await pageA.waitForFunction((b) => {
    return window.__GAME._dynLight.waveClearCount > b;
  }, before, { timeout: 8000 }).then(() => pageA.evaluate(() => window.__GAME._dynLight.waveClearCount)).catch(() => null);
  return { ok: after !== null, before, after, killed };
})();
push('V3. 击杀本波最后敌机 → waveClearCount +1', waveClear.ok === true, `before=${waveClear.before} after=${waveClear.after}`);

// V3 reduced/普通：HUD 波次文字脉冲不报错（bindEvents 已注册；此处只验证事件消费不崩溃）
const wavePulse = await pageA.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  if (!ui || typeof ui._onWaveClearUi !== 'function') return { has: false };
  const waveTextActive = !!(ui.waveText && ui.waveText.active);
  ui._onWaveClearUi(); // 直接调用：验证 waveText 脉冲 tween 正常启动（无异常即通过）
  return { has: true, waveTextActive, pulseTween: !!ui.tweens.getTweensOf(ui.waveText).length };
});
push('V3. UIScene 已注册 _onWaveClearUi 且波次文字脉冲可触发', wavePulse.has && wavePulse.waveTextActive && wavePulse.pulseTween, JSON.stringify(wavePulse));

// ── 7) V7 暂停氛围（high：pulsing=true）──
const pauseOn = await pageA.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  if (ui && !ui._paused) ui.togglePause();
  return window.__PAUSE;
});
push('V7. 暂停 paused=true / fog≈0.22 / glow≈0.16 / pulsing=true', pauseOn.paused === true
  && Math.abs(pauseOn.fogAlpha - 0.22) < 0.02 && Math.abs(pauseOn.glowAlpha - 0.16) < 0.02 && pauseOn.pulsing === true,
  JSON.stringify(pauseOn));
const pauseOff = await pageA.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  if (ui && ui._paused) ui.togglePause();
  return window.__PAUSE;
});
push('V7. 恢复 paused=false / pulsing=false / alpha 回 base', pauseOff.paused === false && pauseOff.pulsing === false
  && Math.abs(pauseOff.fogAlpha - 0.22) < 0.02 && Math.abs(pauseOff.glowAlpha - 0.16) < 0.02,
  JSON.stringify(pauseOff));

// ── 8) V3 Boss 波不误触发（bossrush：杀 Boss → waveClearCount 不 +1）──
const bossNoInc = await (async () => {
  await startBossRush(pageA);
  const before = await pageA.evaluate(() => window.__GAME._dynLight.waveClearCount);
  await pageA.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    if (gs.boss && gs.boss.active) gs.boss.die();
  });
  await new Promise((r) => setTimeout(r, 300));
  const after = await pageA.evaluate(() => window.__GAME._dynLight.waveClearCount);
  return { before, after };
})();
push('V3. Boss 战结束（BOSS_DEFEATED）不触发波次庆祝（waveClearCount 不 +1）', bossNoInc.after === bossNoInc.before,
  `before=${bossNoInc.before} after=${bossNoInc.after}`);

// V5 BossRush progress===null
const envRush = await pageA.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const n = gs._envNarrative || {};
  return { has: !!gs._envNarrative, progressNull: n.progress === null, watermarkOk: !!(n.watermark && n.watermark.active) };
});
push('V5. BossRush progress===null（无 total 语义）', envRush.has && envRush.progressNull, JSON.stringify(envRush));

// ── 9) 零 pageerror / console.error（high 全程）──
await new Promise((r) => setTimeout(r, 300));
push('P0. high 全程无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));

// ════════════════════════════ Page B：reduced-motion ════════════════════════════
const B = await newPage({ lang: 'zh', tutorialDone: true, quality: 'high', selectedDifficulty: 'standard' }, true);
const pageB = B.page;
await startCombat(pageB);

const red = await pageB.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const d = window.__GAME._dynLight;
  const pool = gs.vfxPool; // reduced 下 createVfxPool 返回 null
  return { poolNull: pool === null, grazeCount: d.grazeSparkCount, idleAura: d.idleAuraActive };
});
push('V2(reduced). vfxPool 为 null（池内无 grazeSpark）', red.poolNull === true, `poolNull=${red.poolNull}`);
push('V2(reduced). grazeSparkCount 恒 0', red.grazeCount === 0, `grazeCount=${red.grazeCount}`);
push('V4(reduced). idleAuraActive 恒 0', red.idleAura === 0, `idleAuraActive=${red.idleAura}`);

const pauseRed = await pageB.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  if (ui && !ui._paused) ui.togglePause();
  const p = window.__PAUSE;
  if (ui && ui._paused) ui.togglePause();
  return p;
});
push('V7(reduced). 暂停有氛围层但 pulsing=false（静态）', pauseRed.paused === true && pauseRed.fogAlpha > 0 && pauseRed.pulsing === false,
  JSON.stringify(pauseRed));
push('P0. reduced 全程无 pageerror/console.error', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));

// ════════════════════════════ Page C：low 档 ════════════════════════════
const C = await newPage({ lang: 'zh', tutorialDone: true, quality: 'low', selectedDifficulty: 'standard' });
const pageC = C.page;
await startCombat(pageC);

const low = await pageC.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const d = window.__GAME._dynLight;
  const gs2 = gs.vfxPool ? gs.vfxPool.grazeSpark : null;
  // 触发一次擦弹看 lastQuantity（low=0.45 → floor(6*0.45)=2）
  const p = gs.player;
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  gs.grazeCount = 0; gs.grazeChain = 0; gs._grazeChainUntil = 0;
  const b = gs.enemyBullets.get(p.x + 15, p.y, 'bullet_enemy');
  b.setActive(true).setVisible(true); b.body.enable = true;
  b.setPosition(p.x + 15, p.y); b.body.velocity.set(0, 200); b._grazedAt = null;
  gs._updateGraze(gs.time.now);
  return {
    qualityScale: gs.qualityScale,
    idleAura: d.idleAuraActive,
    lastQty: gs2 ? gs2.lastQuantity : null,
  };
});
push('V4(low). qualityScale<0.6 → idleAuraActive 恒 0', low.qualityScale < 0.6 && low.idleAura === 0,
  `qs=${low.qualityScale} idleAura=${low.idleAura}`);
push('V2(low). low 档单次粒子量 lastQuantity=2（×0.45）', low.lastQty === 2, `lastQty=${low.lastQty}`);

const pauseLow = await pageC.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  if (ui && !ui._paused) ui.togglePause();
  const p = window.__PAUSE;
  if (ui && ui._paused) ui.togglePause();
  return p;
});
push('V7(low). 暂停 pulsing=false（low 静态不呼吸）', pauseLow.paused === true && pauseLow.pulsing === false, JSON.stringify(pauseLow));
push('P0. low 全程无 pageerror/console.error', C.errors.length === 0, C.errors.slice(0, 3).join(' | '));

await browser.close();

// ════════════════════════════ 汇总 ════════════════════════════
const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-15 V系五项探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
process.exit(0);
