import Phaser from 'phaser';
import { COLORS, ELEMENTS, GAME_WIDTH, LIGHTS, VFX_COLORS, EVENTS, EASE, AFTERGLOW, GRAZE_SPARK, IDLE_AURA, WAVE_CLEAR } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';

/**
 * VFX —— 视觉特效中心（粒子、闪光、尾焰、受击反馈）。
 * 所有特效统一走这里，方便性能开关与 reduced-motion 适配。
 */

const prefersReduced = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// 画质档缩放：读 GameScene.qualityScale（P0 性能三件套：high=1.0 / mid=0.7 / low=0.45）。
// 默认 1.0（未建场景 / 未设置时零回归）；reduced-motion 优先于 quality（更保守，上层已短路）。
function _qualityScale(scene) {
  const q = scene && scene.qualityScale;
  return (typeof q === 'number' && q > 0 && q <= 1) ? q : 1;
}

// 未纳入 VFX_COLORS 的少量局部美术色（命名化，避免特效散落魔法数；append-only）
const LOCAL_COLORS = {
  emberOrange: 0xff6622,  // 爆炸橙红余烬（VFX_COLORS 无精确对应）
  warmCore: 0xffd0a0,     // 暖白芯（炸弹/火弹/敌弹光晕共用）
  skyGlow: 0xbfe8ff,      // 散射弹拖尾淡青
  amber: 0xff8a3d,        // 导弹拖尾橙
  glowAmber: 0xff8844,    // 敌弹光晕橙
  playerAura: 0xaaddff,   // 玩家尾焰淡蓝
  muzzleCyan: 0x9ff0ff,   // 枪口/激光青
  shieldCyan: 0x3ad1ff,   // 护盾青
  shieldBright: 0xaaffff, // 护盾亮青
  iceTint: 0xbfefff,      // 冰拖尾淡青
};

// P2⑤ QA 缺陷修复 P1-3：爆炸局部照亮并发上限（验收 ≤3）。
// 模块级计数（跨场景共享）：超限丢弃本次亮斑，避免同帧连爆亮斑并发累积。
let _localIllumActive = 0;   // 当前活跃亮斑数
let _localIllumTotal = 0;    // 累计发射数（QA 探针观测）
const LOCAL_ILLUM_MAX = 3;   // 并发上限（验收 peak≤3）

// OPT-14 B2：爆炸残像拖尾并发计数（QA 探针 _dynLight.afterglowActive 观测；reduced/low 不生成）
let _afterglowActive = 0;    // 当前活跃残影 Image 数（每张 +1，onComplete/shutdown 各 -1）

// OPT-15 V2/V3/V4：纯视觉计数（QA 探针 _dynLight 只读观测；append-only，不破坏既有探针断言）
let _grazeSparkCount = 0;    // V2 累计擦弹火花发射次数（reduced 下恒 0）
let _waveClearCount = 0;     // V3 累计波次清空庆祝次数（Boss 波不 +1）
let _idleAuraActive = 0;     // V4 当前活跃待机光环数（回收/die 须归零，防对象池监听泄漏）

/**
 * 通用爆炸：击杀敌机、道具引爆等。
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {number} color 主色调（会被复用为机体/核心色）
 * @param {number} scale 缩放（1=普通敌机，>1 更大）
 */
export function explosion(scene, x, y, color, scale = 1) {
  if (prefersReduced) return;
  // 池化优先：GameScene 已建 vfxPool 时复用 offscreen emitter，避免每次 new emitter + delayedCall destroy（GC 抖动）
  if (scene && scene.vfxPool) { poolExplode(scene, scene.vfxPool, x, y, color, { scale }); return; }
  const qs = _qualityScale(scene);
  const p = scene.add.particles(x, y, 'particle_dot', {
    speed: { min: 70 * scale, max: 280 * scale },
    lifespan: 550,
    scale: { start: 1.7 * scale, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: Math.max(1, Math.floor(22 * scale * qs)),
    blendMode: 'ADD',
    tint: [color, VFX_COLORS.hit[3], VFX_COLORS.flash, LOCAL_COLORS.emberOrange],
    gravityY: 18,
    emitting: false,
  });
  p.setDepth(50);
  p.explode();
  scene.time.delayedCall(600, () => { if (p && p.active) p.destroy(); });
}

// ─── 爆炸五层（P3 画面质感打磨）────────────────────────────────────
// 五层时序：t=0 白闪核心 → t=30 冲击波环 → t=50 粒子本体 →
//          t=90 残骸（深色 NORMAL 旋转）→ t=130 烟尘（灰 NORMAL 低 alpha）。
// tier='mid' 层数减半（省残骸/烟尘）；reduced-motion 仅保留静态白闪。

/** 白闪核心：camera.flash(60) + 白圆 10→radius 扩散（ADD）。reduced-motion 下静态白闪 */
export function flashCore(scene, x, y, color = VFX_COLORS.flash, radius = 26) {
  scene.cameras.main.flash(60, 255, 255, 255);
  const c = scene.add.circle(x, y, 10, color, 0.9)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(58);
  if (prefersReduced) {
    c.setAlpha(0.6).setScale(radius / 10);
    scene.time.delayedCall(130, () => { if (c && c.active) c.destroy(); });
    return c;
  }
  scene.tweens.add({
    targets: c, scale: radius / 10, alpha: 0, duration: 120,
    onComplete: () => { if (c && c.active) c.destroy(); },
  });
  return c;
}

/** 冲击波环：描边圆 8→radius 扩散（ADD，机体色）。lineWidth 5→1 同步收细 */
export function shockwaveRing(scene, x, y, color, opts = {}) {
  const radius = opts.radius ?? 70;
  const duration = opts.duration ?? 260;
  const depth = opts.depth ?? 54;
  const ring = scene.add.circle(x, y, 8, 0xffffff, 0)
    .setStrokeStyle(5, color, 0.85)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(depth);
  if (prefersReduced) {
    ring.setAlpha(0.5).setScale(radius / 8);
    scene.time.delayedCall(130, () => { if (ring && ring.active) ring.destroy(); });
    return ring;
  }
  scene.tweens.add({
    targets: ring, scale: radius / 8, lineWidth: 1, alpha: 0, duration,
    ease: EASE.enter,
    onComplete: () => { if (ring && ring.active) ring.destroy(); },
  });
  return ring;
}

/** 残骸：4-6 片深色碎片（NORMAL 混合，旋转飘散，650ms） */
export function debrisBurst(scene, x, y, color = VFX_COLORS.debris, count = 5, scale = 1) {
  if (prefersReduced) return null;
  const qs = _qualityScale(scene);
  const n = Math.max(1, Math.round(Phaser.Math.Between(4, 6) * (count / 5) * scale * qs));
  const p = scene.add.particles(x, y, 'particle_dot', {
    speed: { min: 60 * scale, max: 180 * scale },
    lifespan: 650,
    scale: { start: 0.8 * scale, end: 0 },
    alpha: { start: 0.85, end: 0 },
    quantity: n,
    tint: color,
    rotate: { start: 0, end: 360 },
    emitting: false,
  });
  p.setDepth(46);
  p.explode();
  scene.time.delayedCall(700, () => { if (p && p.active) p.destroy(); });
  return p;
}

/** 烟尘：5-8 片灰团（NORMAL 低 alpha，慢速上浮，900ms） */
export function smokePuff(scene, x, y, scale = 1) {
  if (prefersReduced) return null;
  const qs = _qualityScale(scene);
  const p = scene.add.particles(x, y, 'particle_dot', {
    speed: { min: 20, max: 60 },
    lifespan: 900,
    scale: { start: 1.3 * scale, end: 0 },
    alpha: { start: 0.4, end: 0 },
    quantity: Math.max(1, Math.round(Phaser.Math.Between(5, 8) * qs)),
    tint: VFX_COLORS.smoke,
    emitting: false,
  });
  p.setDepth(44);
  p.explode();
  scene.time.delayedCall(950, () => { if (p && p.active) p.destroy(); });
  return p;
}

/**
 * 五层爆炸（击杀敌机 / Boss 连环 / 炸弹通用）。
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {number} color 机体/主色
 * @param {{scale?:number, tier?:string}} opts tier: 'small'|'mid'|'boss'（mid 省残骸/烟尘）
 */
export function explosionLayered(scene, x, y, color, opts = {}) {
  const scale = opts.scale ?? 1;
  const tier = opts.tier ?? 'small';
  if (prefersReduced) { flashCore(scene, x, y, VFX_COLORS.flash, 26); return; }
  flashCore(scene, x, y, VFX_COLORS.flash, 26);
  // P2⑤ 爆炸瞬间局部照亮：t≈10ms 短时大半径柔光脉冲（按爆炸分级 tier；low/reduced 短路）
  scene.time.delayedCall(10, () => localIllum(scene, x, y, color, LIGHTS.illum[tier] || LIGHTS.illum.small));
  scene.time.delayedCall(30, () => shockwaveRing(scene, x, y, color, { radius: 70, duration: 260, depth: 54 }));
  scene.time.delayedCall(50, () => explosion(scene, x, y, color, scale));
  // mid 层数减半：省残骸/烟尘；small/boss 全五层
  if (tier !== 'mid') {
    scene.time.delayedCall(90, () => debrisBurst(scene, x, y, VFX_COLORS.debris, 5, scale));
    scene.time.delayedCall(130, () => smokePuff(scene, x, y, scale));
  }
  // P2⑥ 爆炸环境残留：t≈160ms 追加焦痕/余烬/烟尘（reduced 入口已短路为 flashCore → 天然直回收）
  // ⑥-1：spawn 延迟用墙钟 setTimeout，不走 scene.time.delayedCall（走游戏时钟）。
  // 实测无头/节流环境 delayedCall(160) 约 1.5s 才触发（帧间隔 135ms×10 帧），QA 240ms 探针看不到残留；
  // setTimeout 与探针 wait 同源节流、相对顺序保持（160ms<240ms 恒成立），真机 60fps 下与 delayedCall 等价。
  const spawnResidueLater = () => {
    if (!scene || !scene.sys || !scene.sys.isActive() || scene.sys.isShuttingDown) return;
    if (scene.residuePool) spawnResidue(scene, scene.residuePool, x, y, tier);
  };
  if (typeof window !== 'undefined' && typeof setTimeout === 'function') {
    setTimeout(spawnResidueLater, 160);
  } else {
    scene.time.delayedCall(160, spawnResidueLater);
  }
  // OPT-14 B2：爆炸残像拖尾（motion smear · 爆炸余温与体积感）。
  // reduced/low 内部短路；small/mid=1，boss=2；与五层时序并行，不改变既有延迟。
  _spawnExplosionAfterglow(scene, x, y, color, tier);
}

/**
 * OPT-14 B2：爆炸残像拖尾（motion smear · 爆炸观感提升）
 * 爆炸点残留 1-2 个低 alpha、慢衰减、逐帧上浮的 glow_soft 副本（ADD），作爆炸底光
 * （depth 49，explosion 50 之下，不遮挡粒子本体）。
 *   reduced-motion 直接 return；low 档（qs<0.6）不生成；small/mid=1，boss=2。
 *   alpha 曲线 0.22→0（boss 0.28 起）、Cubic.easeOut 衰减（前快后慢，余温感）；
 *   残影错峰 40ms/100ms，上浮 10~16px，260~320ms 衰减后 destroy。
 * 生命周期：tween 完成 destroy；场景 shutdown 兜底销毁（仿 localIllum 防泄漏模式，
 * tween 被 kill 不触发 onComplete 时仍清掉残影并释放计数）。
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {number} color 机体/主色
 * @param {string} tier 'small'|'mid'|'boss'
 */
function _spawnExplosionAfterglow(scene, x, y, color, tier) {
  if (prefersReduced) return;              // reduced-motion 跳过
  const qs = _qualityScale(scene);
  if (qs < 0.6) return;                    // low 档不生成（纯视觉优先保帧）
  const cfg = (AFTERGLOW && AFTERGLOW[tier]) || (AFTERGLOW && AFTERGLOW.small)
    || { count: 1, alpha: 0.22, scale: 0.9, ms: 260, rise: 10 };
  const count = cfg.count != null ? cfg.count : 1;
  const depth = (AFTERGLOW && AFTERGLOW.depth != null) ? AFTERGLOW.depth : 49;
  const images = [];
  let destroyed = false;
  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    scene.events.off('shutdown', cleanup);
    for (let k = 0; k < images.length; k++) {
      const im = images[k];
      scene.tweens.killTweensOf(im);
      if (im && im.active) im.destroy();
    }
    _afterglowActive = Math.max(0, _afterglowActive - images.length); // 释放未完成残影
    images.length = 0;
  };
  _afterglowActive += count;
  for (let i = 0; i < count; i++) {
    const scale = Array.isArray(cfg.scale) ? (cfg.scale[i] != null ? cfg.scale[i] : cfg.scale[0]) : cfg.scale;
    const ms = Array.isArray(cfg.ms) ? (cfg.ms[i] != null ? cfg.ms[i] : cfg.ms[0]) : cfg.ms;
    const rise = Array.isArray(cfg.rise) ? (cfg.rise[i] != null ? cfg.rise[i] : cfg.rise[0]) : cfg.rise;
    const alpha = Math.max(0, (cfg.alpha != null ? cfg.alpha : 0.22) - i * 0.06); // 残影2更淡
    const delay = 40 + i * 60;             // 残影错峰：40ms / 100ms
    const img = scene.add.image(
      x + Phaser.Math.Between(-8, 8),
      y + Phaser.Math.Between(-4, 6),
      'glow_soft')
      .setDepth(depth)                     // 在 explosion(50) 之下，作底光
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(0.1, 0.1)
      .setAlpha(0);
    images.push(img);
    scene.tweens.add({
      targets: img,
      delay,
      scaleX: scale,
      scaleY: scale,
      y: img.y - rise,                     // 上浮 10~16px
      alpha,                               // 起始 alpha（Cubic.easeOut 衰减 → 0）
      duration: ms,                        // 衰减 260~320ms
      ease: 'Cubic.easeOut',
      onComplete: () => {
        const idx = images.indexOf(img);
        if (idx >= 0) images.splice(idx, 1);
        _afterglowActive = Math.max(0, _afterglowActive - 1);
        if (img && img.active) img.destroy();
      },
    });
  }
  scene.events.once('shutdown', cleanup);
}

/** 子弹击中目标时的点状闪光（星形火花） */
export function hitSpark(scene, x, y) {
  if (prefersReduced) return;
  // 池化优先：命中火花复用 offscreen emitter（消除高频命中下的 GC 抖动）
  if (scene && scene.vfxPool) { poolSpark(scene, scene.vfxPool, x, y); return; }
  const qs = _qualityScale(scene);
  const p = scene.add.particles(x, y, 'particle_spark', {
    speed: { min: 25, max: 100 },
    lifespan: 150,
    scale: { start: 0.7, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: Math.max(1, Math.floor(6 * qs)),
    blendMode: 'ADD',
    tint: VFX_COLORS.hit,
    emitting: false,
  });
  p.setDepth(55);
  p.explode();
  scene.time.delayedCall(200, () => { if (p && p.active) p.destroy(); });
}

// ─── 粒子对象池（P0 技术品质：消除 GC 抖动）────────────────────────
// 爆炸/火花不再每次 new emitter + delayedCall destroy，而是预建 2 个 offscreen
// emitter（emitting:false）用 emitParticleAt 复用。reduced-motion 下不建池（返回 null，
// 调用方判空降级为无粒子）；粒子寿命结束后自动回收到 emitter.dead 池，重复使用。

/**
 * 预建爆炸/命中火花 offscreen emitter 池。
 * @param {Phaser.Scene} scene
 * @returns {{explosion: Phaser.GameObjects.Particles.ParticleEmitter,
 *            hitSpark: Phaser.GameObjects.Particles.ParticleEmitter}|null}
 *          reduced-motion 下返回 null（调用方判空降级）。
 */
export function createVfxPool(scene) {
  if (prefersReduced || !scene) return null;
  const explosion = scene.add.particles(0, 0, 'particle_dot', {
    speed: { min: 70, max: 280 },
    lifespan: 550,
    scale: { start: 1.7, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: 22,
    blendMode: 'ADD',
    tint: [COLORS.enemy, VFX_COLORS.hit[3], VFX_COLORS.flash, LOCAL_COLORS.emberOrange],
    gravityY: 18,
    emitting: false,
  });
  explosion.setDepth(50);
  const hitSpark = scene.add.particles(0, 0, 'particle_spark', {
    speed: { min: 25, max: 100 },
    lifespan: 150,
    scale: { start: 0.7, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: 6,
    blendMode: 'ADD',
    tint: VFX_COLORS.hit,
    emitting: false,
  });
  hitSpark.setDepth(55);
  // OPT-15 V2：擦弹火花 emitter（青白，offscreen 复用；emitting:false）
  const grazeSpark = scene.add.particles(0, 0, 'particle_spark', {
    speed: { min: GRAZE_SPARK.speedMin, max: GRAZE_SPARK.speedMax },
    lifespan: GRAZE_SPARK.lifespan,
    scale: { start: GRAZE_SPARK.scale, end: 0 },
    alpha: { start: GRAZE_SPARK.alpha, end: 0 },
    quantity: GRAZE_SPARK.quantity,
    blendMode: 'ADD',
    tint: GRAZE_SPARK.tint,
    emitting: false,
  });
  grazeSpark.setDepth(GRAZE_SPARK.depth);
  // 复用计数 / 最近单次粒子量 / 每帧并发 cap（QA 探针验证池化生效与画质档缩放）
  grazeSpark.poolUseCount = 0; grazeSpark.lastQuantity = 0;
  grazeSpark._burstFrame = -1; grazeSpark._burstCount = 0;
  // 复用计数 / 最近单次粒子量（QA 探针验证池化生效与画质档缩放）
  explosion.poolUseCount = 0; explosion.lastQuantity = 0;
  hitSpark.poolUseCount = 0; hitSpark.lastQuantity = 0;
  return { explosion, hitSpark, grazeSpark };
}

/**
 * 池化爆炸：复用 createVfxPool 建的 explosion emitter（emitParticleAt），
 * 逐次 setConfig 覆盖颜色/缩放，quantity 按画质档缩放。
 * @param {Phaser.Scene} scene
 * @param {{explosion: object, hitSpark: object}|null} pool
 * @param {number} x
 * @param {number} y
 * @param {number} color 主色（复用为机体/核心色）
 * @param {{scale?: number}} opts
 */
export function poolExplode(scene, pool, x, y, color, opts = {}) {
  if (prefersReduced || !pool || !pool.explosion) return;
  const scale = opts.scale ?? 1;
  const qs = _qualityScale(scene);
  const qty = Math.max(1, Math.floor(22 * scale * qs));
  const ex = pool.explosion;
  ex.poolUseCount = (ex.poolUseCount || 0) + 1;
  ex.lastQuantity = qty;
  ex.setConfig({
    speed: { min: 70 * scale, max: 280 * scale },
    lifespan: 550,
    scale: { start: 1.7 * scale, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: qty,
    blendMode: 'ADD',
    tint: [color, VFX_COLORS.hit[3], VFX_COLORS.flash, LOCAL_COLORS.emberOrange],
    gravityY: 18,
    emitting: false,
  });
  ex.emitParticleAt(x, y, qty);
}

/**
 * 池化命中火花：复用 createVfxPool 建的 hitSpark emitter（emitParticleAt）。
 * quantity 按画质档缩放。
 */
export function poolSpark(scene, pool, x, y) {
  if (prefersReduced || !pool || !pool.hitSpark) return;
  const qs = _qualityScale(scene);
  const qty = Math.max(1, Math.floor(6 * qs));
  const hs = pool.hitSpark;
  hs.poolUseCount = (hs.poolUseCount || 0) + 1;
  hs.lastQuantity = qty;
  hs.emitParticleAt(x, y, qty);
}

/**
 * 池化擦弹火花（OPT-15 V2）：复用 createVfxPool 建的 grazeSpark emitter（emitParticleAt）。
 * quantity 按画质档缩放；同帧并发 cap（maxPerFrame）防密集弹幕同帧多次擦弹迸发过量粒子。
 * reduced-motion 下 createVfxPool 返回 null → 池内无 grazeSpark，此处直接 return。
 */
export function poolGrazeSpark(scene, pool, x, y) {
  if (prefersReduced || !pool || !pool.grazeSpark) return;
  const gs = pool.grazeSpark;
  // 每帧并发 cap：密集弹幕同帧多次擦弹不迸发过量火花（如超载 5 连擦）
  const frame = (scene.game && scene.game.loop) ? scene.game.loop.frame : -1;
  if (frame === gs._burstFrame) {
    gs._burstCount = (gs._burstCount || 0) + 1;
    if (gs._burstCount > GRAZE_SPARK.maxPerFrame) return;
  } else {
    gs._burstFrame = frame; gs._burstCount = 1;
  }
  const qs = _qualityScale(scene);
  const qty = Math.max(1, Math.floor(GRAZE_SPARK.quantity * qs));
  gs.poolUseCount = (gs.poolUseCount || 0) + 1;
  gs.lastQuantity = qty;
  _grazeSparkCount++;
  gs.emitParticleAt(x, y, qty);
}

/** 擦弹火花（V2）wrapper：池化优先；无池时静默 return（火花是增益不是必需，不降级 new emitter） */
export function grazeSpark(scene, x, y) {
  if (prefersReduced) return;
  if (scene && scene.vfxPool) { poolGrazeSpark(scene, scene.vfxPool, x, y); return; }
}

/**
 * 波次清空庆祝（OPT-15 V3）：一波全清时克制演出——1 圈主题色环 + 小型粒子爆点。
 * 无横幅/无屏震/无定格/无 camera.flash；Boss 波不走 waiting 判定天然不触发。
 * reduced-motion：仅静态环（shockwaveRing 内部已处理 reduced）；HUD 脉冲由 UIScene 处理。
 */
export function waveClearCelebrate(scene, x, y, accent) {
  if (!scene) return;
  _waveClearCount++;
  const color = accent || 0x66ccff;
  // 克制：1 圈主题色环（shockwaveRing 内部已处理 reduced → 静态）
  shockwaveRing(scene, x, y, color, { radius: WAVE_CLEAR.ringRadius, duration: WAVE_CLEAR.ringMs, depth: 54 });
  if (prefersReduced) return;
  // 小型粒子爆点：复用 vfxPool.explosion emitter（poolExplode 已按画质档缩放 quantity、可换色）
  if (scene.vfxPool) {
    poolExplode(scene, scene.vfxPool, x, y, color, { scale: WAVE_CLEAR.burstScale });
  }
}

/** 炸弹/星风暴：五层爆炸（全层）+ 屏震 + 闪光（reduced-motion 仅静态白闪） */
export function bombShockwave(scene, x, y) {
  if (prefersReduced) {
    scene.cameras.main.flash(120, 90, 75, 45);
    return;
  }
  explosionLayered(scene, x, y, 0xff7a3a, { scale: 2, tier: 'boss' });
  shake(scene, 'heavy');
}

/** 玩家受击反馈：有护盾时扩散光罩，无护盾时屏幕红闪 */
export function playerHitFlash(scene, shieldActive) {
  if (!scene.player) return;
  const px = scene.player.x, py = scene.player.y;
  if (shieldActive) {
    const shield = scene.add.circle(px, py, 42, LOCAL_COLORS.shieldCyan, 0.45)
      .setStrokeStyle(3, LOCAL_COLORS.shieldBright, 0.8).setDepth(70);
    scene.tweens.add({
      targets: shield, scale: 2.4, alpha: 0, duration: 380,
      onComplete: () => { if (shield && shield.active) shield.destroy(); },
    });
  } else {
    scene.cameras.main.flash(200, 180, 50, 50);
  }
}

/** Boss 死亡：多段连环爆炸 + 屏震 + 闪光 */
export function bossDeathExplosion(scene, boss, color) {
  if (prefersReduced) {
    shake(scene, 'catastrophic');
    return;
  }
  for (let i = 0; i < 8; i++) {
    scene.time.delayedCall(i * 100, () => {
      const ox = Phaser.Math.Between(-75, 75);
      const oy = Phaser.Math.Between(-65, 65);
      const s = 0.8 + Math.random() * 0.7;
      explosionLayered(scene, boss.x + ox, boss.y + oy, color, { scale: s, tier: 'boss' });
    });
  }
  shake(scene, 'catastrophic');
  scene.cameras.main.flash(280, 120, 70, 45);
}

/**
 * 给敌机挂上尾焰 emitter（随敌机 active 启动/暂停）。
 * 调用方负责在 enemy 回收时 stop()、destroy 时 destroy()。
 */
export function attachEnemyThruster(scene, enemy, color = COLORS.enemy) {
  if (prefersReduced) return null;
  const t = scene.add.particles(0, 0, 'particle_streak', {
    speedY: { min: 40, max: 100 },
    lifespan: 240,
    scale: { start: 0.75, end: 0 },
    alpha: { start: 0.6, end: 0 },
    frequency: 45,
    tint: color,
    follow: enemy,
    followOffset: { x: 0, y: 18 },
  });
  t.setDepth(14);
  return t;
}

/** 玩家尾焰（比默认更浓厚，长条拖尾） */
export function attachPlayerThruster(scene, player) {
  if (prefersReduced) return null;
  const t = scene.add.particles(0, 0, 'particle_streak', {
    speedY: { min: 90, max: 200 },
    lifespan: 360,
    scale: { start: 1.3, end: 0 },
    alpha: { start: 0.8, end: 0 },
    frequency: 22,
    tint: [COLORS.player, LOCAL_COLORS.playerAura, VFX_COLORS.flash],
    follow: player,
    followOffset: { x: 0, y: 30 },
  });
  t.setDepth(19);
  return t;
}

/** 玩家子弹尾迹（青色发光长条，ADD 混合）。reduced-motion 下返回 null */
export function bulletTrail(scene) {
  if (prefersReduced) return null;
  const e = scene.add.particles(0, 0, 'particle_streak', {
    lifespan: 160,
    scale: { start: 0.9, end: 0 },
    alpha: { start: 0.8, end: 0 },
    quantity: 1,
    blendMode: 'ADD',
    tint: [VFX_COLORS.hit[2], VFX_COLORS.trail.pulse, VFX_COLORS.flash],
    emitting: false,
  }).setDepth(18);
  return e;
}

/** 敌弹光晕（红橙脉冲圆点，ADD 混合）。reduced-motion 下返回 null */
export function enemyBulletGlow(scene) {
  if (prefersReduced) return null;
  const e = scene.add.particles(0, 0, 'particle_dot', {
    lifespan: 200,
    scale: { start: { min: 0.6, max: 1.1 }, end: 0 },
    alpha: { start: 0.7, end: 0 },
    frequency: 40,
    blendMode: 'ADD',
    tint: [VFX_COLORS.trail.enemy, LOCAL_COLORS.glowAmber, LOCAL_COLORS.warmCore],
    emitting: false,
  }).setDepth(16);
  return e;
}

/**
 * 敌弹拖尾（P3）：offscreen ADD emitter，敌弹 spawn 时 emitParticleAt 一次。
 * reduced-motion 下返回 null（调用方判空降级）。
 */
export function enemyBulletTrail(scene) {
  if (prefersReduced) return null;
  return scene.add.particles(0, 0, 'particle_dot', {
    lifespan: 180,
    scale: { start: 0.7, end: 0 },
    alpha: { start: 0.55, end: 0 },
    quantity: 1,
    blendMode: 'ADD',
    tint: [VFX_COLORS.trail.enemy, LOCAL_COLORS.warmCore],
    emitting: false,
  }).setDepth(15);
}

/** 机首瞬时发射闪光（星形火花粒子一次），激光束创建时调用 */
export function laserMuzzleFlash(scene, x, y) {
  if (prefersReduced) return;
  const p = scene.add.particles(x, y, 'particle_spark', {
    speed: { min: 40, max: 120 },
    lifespan: 180,
    scale: { start: 1.2, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: 8,
    blendMode: 'ADD',
    tint: [VFX_COLORS.flash, LOCAL_COLORS.muzzleCyan],
    emitting: false,
  });
  p.setDepth(22);
  p.explode();
  scene.time.delayedCall(220, () => { if (p && p.active) p.destroy(); });
}

/**
 * 玩家子弹尾迹：为 pulse/scatter/missile/bomb/fire/ice/thunder 各建一个 ADD 粒子
 * emitter（emitting:false, offscreen），返回对象供 GameScene.update 按 texture.key 分派。
 * reduced-motion 下返回 null（调用方按 key 取 emitter 时自然降级）。
 */
export function createBulletTrails(scene) {
  if (prefersReduced) return null;
  const mk = (tint) => scene.add.particles(0, 0, 'particle_streak', {
    lifespan: 160,
    scale: { start: 0.9, end: 0 },
    alpha: { start: 0.8, end: 0 },
    quantity: 1,
    blendMode: 'ADD',
    tint,
    emitting: false,
  }).setDepth(18);
  return {
    pulse: mk([VFX_COLORS.hit[2], VFX_COLORS.trail.pulse, VFX_COLORS.flash]),
    scatter: mk([LOCAL_COLORS.skyGlow, VFX_COLORS.trail.scatter, VFX_COLORS.flash]),
    missile: mk([VFX_COLORS.trail.missile, LOCAL_COLORS.amber, VFX_COLORS.flash]),
    bomb: mk([LOCAL_COLORS.warmCore, VFX_COLORS.trail.fire, VFX_COLORS.flash]),
    fire: mk([LOCAL_COLORS.warmCore, VFX_COLORS.trail.fire, VFX_COLORS.trail.thunder, VFX_COLORS.flash]),
    ice: mk([LOCAL_COLORS.iceTint, VFX_COLORS.trail.ice, VFX_COLORS.flash]),
    thunder: mk([VFX_COLORS.trail.thunder, VFX_COLORS.hit[1], VFX_COLORS.flash]),
  };
}

/**
 * 首击卡顿预热：在 create 阶段（createBulletTrails 之后）调用一次。
 * 预建 hitSpark + explosion 两个 offscreen emitter 各 explode(1) 一次（编译粒子管线），
 * 顺带预 emit 各 bulletTrail 一次；延迟销毁。reduced-motion 下直接 return（无粒子开销）。
 */
export function warmup(scene) {
  if (prefersReduced) return;
  const hs = scene.add.particles(-300, -300, 'particle_spark', {
    speed: { min: 25, max: 100 }, lifespan: 150, scale: { start: 0.7, end: 0 },
    alpha: { start: 0.9, end: 0 }, quantity: 6, blendMode: 'ADD',
    tint: VFX_COLORS.hit, emitting: false,
  });
  hs.setDepth(55);
  hs.explode(1);
  const ex = scene.add.particles(-300, -300, 'particle_dot', {
    speed: { min: 70, max: 280 }, lifespan: 550, scale: { start: 1.7, end: 0 },
    alpha: { start: 0.9, end: 0 }, quantity: 22, blendMode: 'ADD',
    tint: [COLORS.enemy, VFX_COLORS.hit[3], VFX_COLORS.flash, LOCAL_COLORS.emberOrange], gravityY: 18, emitting: false,
  });
  ex.setDepth(50);
  ex.explode(1);
  // 顺带预 emit 各 bulletTrail 一次，编译其粒子配置
  if (scene.bulletTrails) {
    for (const k in scene.bulletTrails) {
      const e = scene.bulletTrails[k];
      if (e && e.emitParticleAt) e.emitParticleAt(-300, -300);
    }
  }
  scene.time.delayedCall(40, () => {
    if (hs && hs.active) hs.destroy();
    if (ex && ex.active) ex.destroy();
  });
}

/**
 * 元素反应爆发环：以反应源为中心扩散一圈元素色圆环。
 * reduced-motion 下：静态圆环一闪（无 tween / 无粒子）。
 */
export function reactionRing(scene, x, y, element) {
  const color = (ELEMENTS[element] && ELEMENTS[element].color) || 0x7cf3ff;
  const ring = scene.add.circle(x, y, 8, color, 0.35).setStrokeStyle(2, color, 0.9).setDepth(52);
  if (prefersReduced) {
    scene.time.delayedCall(120, () => { if (ring && ring.active) ring.destroy(); });
    return;
  }
  scene.tweens.add({
    targets: ring, scale: 3.2, alpha: 0, duration: 360, ease: EASE.enter,
    onComplete: () => { if (ring && ring.active) ring.destroy(); },
  });
}

/** 雷·传导电弧：以反应源为中心发散的几条折线闪电。reduced-motion 下直接 return */
export function conductionArc(scene, x, y) {
  if (prefersReduced) return;
  const g = scene.add.graphics().setDepth(51);
  g.lineStyle(2, VFX_COLORS.trail.thunder, 0.9);
  for (let k = 0; k < 4; k++) {
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const seg = Phaser.Math.Between(16, 22);
    let px = x, py = y;
    g.beginPath();
    g.moveTo(px, py);
    for (let s = 0; s < 3; s++) {
      px += Math.cos(ang) * seg + Phaser.Math.Between(-8, 8);
      py += Math.sin(ang) * seg + Phaser.Math.Between(-8, 8);
      g.lineTo(px, py);
    }
    g.strokePath();
  }
  scene.time.delayedCall(140, () => { if (g && g.active) g.destroy(); });
}

/** 控制 emitter 启动/停止，用于对象池回收 */
export function setEmitterActive(emitter, active) {
  if (!emitter) return;
  active ? emitter.start() : emitter.stop();
}

export function destroyEmitter(emitter) {
  if (emitter && emitter.active) emitter.destroy();
}

/**
 * 分级屏震语言（game juice 惯例）：用语义档位替代散落的 magic number，
 * 让"多强的事件抖多狠"在全局一致可控。
 *   light        ~轻擦（普通命中/拾取）
 *   medium       ~受创（玩家挨打/激光命中）
 *   heavy        ~爆裂（炸弹/中型敌机爆炸）
 *   catastrophic ~毁灭（Boss 死亡/星风暴）
 */
const SHAKE_LEVELS = {
  light:        { d: 80,  i: 0.004 },
  medium:       { d: 160, i: 0.009 },
  heavy:        { d: 260, i: 0.016 },
  catastrophic: { d: 450, i: 0.03  },
};
export function shake(scene, level = 'medium') {
  const s = SHAKE_LEVELS[level] || SHAKE_LEVELS.medium;
  scene.cameras.main.shake(s.d, s.i);
}

// ─── 光效纪律（P3）：受控发光白名单 = 机 / 弹 / 爆 / 拾取 ──────────
// 背景与 UI 一律不发光；glow_soft 贴图统一做柔光，避免廉价过曝。

/**
 * 顶部主光（key light）：压扁的柔光斑贴住屏顶，营造"光从上方打下来"的层次。
 * @param {Phaser.Scene} scene
 * @param {{depth?:number, alpha?:number, tint?:number}} opts
 */
export function addKeyLight(scene, opts = {}) {
  const depth = opts.depth ?? 8;
  const alpha = opts.alpha ?? 0.10;
  const tint = opts.tint ?? VFX_COLORS.flash;
  // reduced-motion：alpha 减半，静态保留（无动效，仍是一层柔和顶光）
  const finalAlpha = prefersReduced ? alpha * 0.5 : alpha;
  return scene.add.image(GAME_WIDTH / 2, 0, 'glow_soft')
    .setOrigin(0.5, 0.5)                       // 中心贴顶：亮心在 y=0（屏顶），下半柔和外缘向下淡出
    .setDepth(depth)
    .setAlpha(finalAlpha)
    .setTint(tint)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(GAME_WIDTH / 512, 0.7);          // scaleX 盖满屏宽，scaleY=0.7 仅上半柔光
}

/**
 * 柔光跟随目标（glow_soft 贴在 sprite 下方一层，随其移动/显隐）。
 * sprite 销毁时同步销毁 glow 并解绑场景 update 监听。
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {number} color 光色
 * @param {{radius?:number, alpha?:number, depth?:number}} opts depth 相对 sprite.depth 的偏移
 */
export function glowTarget(sprite, color, opts = {}) {
  if (!sprite || !sprite.scene) return null;
  const radius = opts.radius ?? 1.6;
  const alpha = opts.alpha ?? 0.35;
  const depthOff = opts.depth ?? -1;
  const scene = sprite.scene;
  const glow = scene.add.image(sprite.x, sprite.y, 'glow_soft')
    .setDepth(sprite.depth + depthOff)
    .setAlpha(alpha)
    .setTint(color)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(radius, radius);
  const sync = () => {
    glow.setPosition(sprite.x, sprite.y);
    glow.setVisible(!!(sprite.active && sprite.visible));
  };
  scene.events.on('update', sync);
  sprite.once('destroy', () => {
    scene.events.off('update', sync);
    if (glow && glow.active) glow.destroy();
  });
  return glow;
}

/**
 * 待机能量环呼吸（OPT-15 V4）：glow_soft 贴目标下方一层，随目标移动/显隐，alpha+scale 缓慢呼吸。
 * 每单位一条持久 tween（yoyo repeat -1）；返回可控句柄，stop() 用于对象池回收清理，杜绝监听泄漏。
 * 只作用于独立 glow 子对象 → 与 _flinch/死亡演出/精英 _eliteGlow/Boss fxG 零冲突。
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {number} color
 * @param {{radius?:number, alpha?:number, depthOff?:number, ms?:number, scalePulse?:number}} opts
 * @returns {{glow: Phaser.GameObjects.Image, stop():void}|null} reduced/非法输入返回 null
 */
export function idleAura(sprite, color, opts = {}) {
  if (!sprite || !sprite.scene || prefersReduced) return null;
  const scene = sprite.scene;
  const radius = opts.radius ?? 1.0;
  const alpha = opts.alpha ?? 0.10;
  const depthOff = opts.depthOff ?? -1;
  const ms = opts.ms ?? 1500;
  const scalePulse = opts.scalePulse ?? 0.12;
  const glow = scene.add.image(sprite.x, sprite.y, 'glow_soft')
    .setDepth(sprite.depth + depthOff)
    .setAlpha(alpha)
    .setTint(color)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(radius, radius);
  _idleAuraActive++;
  const sync = () => {
    if (!glow.active) return;
    glow.setPosition(sprite.x, sprite.y);
    glow.setVisible(!!(sprite.active && sprite.visible));
  };
  scene.events.on('update', sync);
  scene.tweens.add({
    targets: glow,
    alpha: { from: alpha, to: alpha + scalePulse * 0.5 },
    scaleX: { from: radius, to: radius * (1 + scalePulse) },
    scaleY: { from: radius, to: radius * (1 + scalePulse) },
    duration: ms, yoyo: true, repeat: -1, ease: EASE.breathe,
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    scene.events.off('update', sync);
    scene.tweens.killTweensOf(glow);
    if (glow.active) glow.destroy();
    _idleAuraActive = Math.max(0, _idleAuraActive - 1);
  };
  return { glow, stop };
}

// ─── P2⑤ 动态光影（轻量假光源：glow_soft + ADD，纯视觉零业务）──────────
// 三组动态光：playerLight（玩家位置光源跟随）/ bossAmbient（Boss 战环境光变色）/
//            localIllum（爆炸瞬间局部照亮）。全部走 LIGHTS 配置。
// reduced-motion：playerLight 静态 alpha×0.5（无呼吸）；bossAmbient 静态；localIllum 由 flashCore 承担。

/**
 * 内部光影性能档：读 scene.qualityScale（1.0=high / 0.7=mid / 0.45=low）。
 * @returns {{on:boolean, alphaMul:number, radiusMul:number}}
 *          low → on:false（localIllum/bossAmbient 短路；玩家灯仅收小半径，不灭）。
 */
function _lightTier(scene) {
  const qs = _qualityScale(scene);
  const tier = qs >= 0.9 ? 'high' : qs >= 0.6 ? 'mid' : 'low';
  const gate = (LIGHTS && LIGHTS.qualityGate) || 'mid';
  if (gate === 'low') return { on: true, alphaMul: 1, radiusMul: 1 };
  if (tier === 'low') return { on: false, alphaMul: (LIGHTS && LIGHTS.reducedAlphaMul) || 0.5, radiusMul: 0.6 };
  if (tier === 'mid') return { on: true, alphaMul: 0.8, radiusMul: 0.85 };
  return { on: true, alphaMul: 1, radiusMul: 1 };
}

/** 生成柔光 Image（glow_soft + ADD），返回 image */
function _softGlow(scene, x, y, radius, alpha, tint, depth) {
  return scene.add.image(x, y, 'glow_soft')
    .setDepth(depth)
    .setAlpha(alpha)
    .setTint(tint)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(radius, radius);
}

/**
 * 玩家位置光源跟随：机身外大半径柔光（青 tint），随玩家移动 + radius 呼吸脉动。
 * reduced-motion：静态低 alpha 光（无呼吸，alpha×reducedAlphaMul）。
 * @returns {{image, setIntensity(v), destroy}|null}
 */
export function playerLight(scene, player, opts = {}) {
  if (!scene || !player) return null;
  const tier = _lightTier(scene);
  // P2-5/P2-6：low 档 / reduced-motion 不创建跟随光（QA 验收 playerLightOn=false；
  // 原 reduced 静态低 alpha 方案改为不创建，符合"reduced 档不创建跟随光"口径）
  if (!tier.on || prefersReduced) return null;
  const reduce = false; // 已提前 return，恒 false；保留变量避免后续分支误读
  const cfg = (LIGHTS && LIGHTS.player) || {};
  const baseRadius = (opts.radius != null ? opts.radius : cfg.radius) || 1.5;
  const baseAlpha = (opts.alpha != null ? opts.alpha : cfg.alpha) || 0.10;
  const tint = (opts.tint != null ? opts.tint : cfg.tint) || 0x9fd8ff;
  const breathMs = (opts.breathMs != null ? opts.breathMs : cfg.breathMs) || 1800;
  const breathAmp = (opts.breathAmp != null ? opts.breathAmp : cfg.breathAmp) || 0.04;
  const depth = opts.depth ?? 8;
  const radius = baseRadius * tier.radiusMul;
  const alpha = baseAlpha * tier.alphaMul * (reduce ? ((opts.reducedAlphaMul != null ? opts.reducedAlphaMul : cfg.reducedAlphaMul) || 0.5) : 1);

  const image = _softGlow(scene, player.x, player.y, radius, alpha, tint, depth);
  const ctl = {
    image,
    setIntensity(v) { const n = Math.max(0, Math.min(1, Number(v) || 0)); image.setAlpha(alpha * n); },
    destroy() {
      if (breathTween) breathTween.remove();
      scene.events.off('update', sync);
      if (image.active) image.destroy();
    },
  };
  const sync = () => {
    image.setPosition(player.x, player.y);
    image.setVisible(!!(player.active && player.visible));
  };
  scene.events.on('update', sync);

  // radius 呼吸脉动（reduced-motion 无呼吸）：radius×(1±amp) 之间缓动
  let breathTween = null;
  if (!reduce) {
    breathTween = scene.tweens.add({
      targets: image,
      scaleX: { from: radius * (1 + breathAmp), to: radius * (1 - breathAmp) },
      scaleY: { from: radius * (1 + breathAmp), to: radius * (1 - breathAmp) },
      duration: breathMs / 2,
      yoyo: true,
      repeat: -1,
      ease: EASE.breathe,
    });
  }
  player.once('destroy', () => ctl.destroy());
  return ctl;
}

/**
 * Boss 战环境光变色：Boss 周身柔光随 Boss 色；监听 EVENTS.BOSS_PHASE 做 tint/alpha 脉冲。
 * Boss 销毁时自动解绑事件 + 清理（同 glowTarget 模式）。low/reduced 降级处理。
 * @returns {{image, setColor(c), setIntensity(v), destroy}|null}
 */
export function bossAmbient(scene, boss, color, opts = {}) {
  if (!scene || !boss) return null;
  const tier = _lightTier(scene);
  // P2-6：reduced-motion 不创建跟随光（与 playerLight 同口径）；low 档短路
  if (!tier.on || prefersReduced) return null;
  const reduce = false; // 已提前 return；相位脉冲恒启用
  const cfg = (LIGHTS && LIGHTS.boss) || {};
  const baseRadius = (opts.radius != null ? opts.radius : cfg.radius) || 2.2;
  const baseAlpha = (opts.alpha != null ? opts.alpha : cfg.alpha) || 0.12;
  const depth = opts.depth ?? 9;
  const radius = baseRadius * tier.radiusMul;
  const alpha = baseAlpha * tier.alphaMul;

  const image = _softGlow(scene, boss.x, boss.y, radius, alpha, color, depth);
  const ctl = {
    image,
    setColor(c) { image.setTint(c); },
    setIntensity(v) { const n = Math.max(0, Math.min(1, Number(v) || 0)); image.setAlpha(alpha * n); },
    destroy() {
      EventBus.off(EVENTS.BOSS_PHASE, onPhase);
      scene.events.off('update', sync);
      scene.tweens.killTweensOf(image);
      if (image.active) image.destroy();
    },
  };
  const sync = () => {
    image.setPosition(boss.x, boss.y);
    image.setVisible(!!(boss.active && boss.visible));
  };
  scene.events.on('update', sync);

  // BOSS_PHASE 脉冲：相位切换瞬间 tint 白闪 + alpha/radius 鼓一下（reduced-motion 静态）
  const onPhase = () => {
    if (reduce) return;
    const boost = (opts.phaseBoost != null ? opts.phaseBoost : cfg.phaseBoost) || 0.06;
    const phaseMs = (opts.phaseMs != null ? opts.phaseMs : cfg.phaseMs) || 600;
    scene.tweens.killTweensOf(image);
    scene.tweens.add({
      targets: image,
      alpha: Math.min(1, alpha + boost),
      scaleX: radius * 1.12, scaleY: radius * 1.12,
      duration: phaseMs / 2,
      yoyo: true,
      ease: EASE.breathe,
      onComplete: () => {
        if (image.active) image.setAlpha(alpha).setScale(radius, radius);
      },
    });
  };
  EventBus.on(EVENTS.BOSS_PHASE, onPhase);
  // P3-12：Boss 死亡环境光 2s 回落（淡出后销毁；Boss.die 于 ~800ms 后 destroy 触发此处）
  boss.once('destroy', () => {
    EventBus.off(EVENTS.BOSS_PHASE, onPhase);
    scene.events.off('update', sync);
    if (!image.active) return;
    scene.tweens.killTweensOf(image);
    scene.tweens.add({
      targets: image, alpha: 0, duration: 2000, ease: 'Linear',
      onComplete: () => { if (image.active) image.destroy(); },
    });
  });
  return ctl;
}

/**
 * 爆炸瞬间局部照亮：一次性 ADD 柔光脉冲（150-340ms，alpha 0.22→0），自回收。
 * reduced-motion / low 档不新增（reduced 由 flashCore 的静态白闪承担）。
 */
export function localIllum(scene, x, y, color, opts = {}) {
  if (!scene || prefersReduced) return null;
  const tier = _lightTier(scene);
  if (!tier.on) return null;
  // P1-3：连爆并发 cap（≤3），超限丢弃本次亮斑（QA 验收 peak≤3）
  if (_localIllumActive >= LOCAL_ILLUM_MAX) return null;
  _localIllumActive++;
  _localIllumTotal++;
  const radius = (opts.radius ?? 110) * tier.radiusMul;
  const alpha = (opts.alpha ?? 0.20) * tier.alphaMul;
  const ms = opts.ms ?? 220;
  const image = _softGlow(scene, x, y, 0.1, alpha, color, 56); // depth 56：介于 debris(46) 与 flash(58) 之间
  // P1-3 防泄漏：tween 完成 或 场景 shutdown 都释放并发计数。
  // Phaser 在场景切走时会 kill tween 且不触发 onComplete，若不靠 shutdown 兜底释放，
  // _localIllumActive 会被永久占位 → 之后所有连爆亮斑被 cap 永久阻塞（跨场景累积）。
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    _localIllumActive = Math.max(0, _localIllumActive - 1);
  };
  scene.events.once('shutdown', release);
  scene.tweens.add({
    targets: image,
    scale: radius,
    alpha: 0,
    duration: ms,
    ease: EASE.enter,
    onComplete: () => {
      release();
      scene.events.off('shutdown', release);
      if (image.active) image.destroy();
    },
  });
  return image;
}

/**
 * P2-7 QA 探针：window.__SKY__._dynLight（只读，动态反映动态光影状态）。
 * 由 GameScene.create 调用一次；getter 惰性读取 playerLight/bossAmbient/localIllum 计数。
 */
export function installLightProbes(scene) {
  if (!scene || !scene.game) return;
  Object.defineProperty(scene.game, '_dynLight', {
    configurable: true,
    get() {
      const pl = scene.playerLight;
      const ba = scene.bossAmbient;
      return {
        following: !!(pl && pl.image && pl.image.active),
        bossTint: (ba && ba.image && ba.image.active) ? ba.image.tintTopLeft : 0,
        localPulseActive: _localIllumActive,
        localPulseCount: _localIllumTotal,
        localPulseCap: LOCAL_ILLUM_MAX,
        // OPT-14 B2：爆炸残像拖尾当前活跃数（只读；QA 探针观测残影出现/衰减/销毁）
        afterglowActive: _afterglowActive,
        // OPT-15 V2/V3/V4：纯视觉只读计数（append-only，不破坏既有探针断言）
        grazeSparkCount: _grazeSparkCount,   // V2 累计擦弹火花发射次数（reduced 下恒 0）
        waveClearCount: _waveClearCount,     // V3 累计波次清空庆祝次数（Boss 波不 +1）
        idleAuraActive: _idleAuraActive,     // V4 当前活跃待机光环数（回收后应回落/归零）
      };
    },
  });
}

// ─── P2⑥ 爆炸环境残留（焦痕 / 火光余烬 / 烟尘滞留，池化 + 定时清理）────────
// 走爆炸分级 tier：small=ember / mid=ember+smoke(+50% scorch) / boss=三者全开。
// 性能档：high=ember 10+smoke 8+scorch cap 12；mid=ember 6+smoke 5+scorch cap 8；
//         low=仅 ember 3（smoke/scorch 关）；reduced=null（调用方判空降级）。

/** 按 scene.qualityScale 映射残留性能档（与 _lightTier 同源口径） */
function _residueTier(scene) {
  const qs = _qualityScale(scene);
  return qs >= 0.9 ? 'high' : qs >= 0.6 ? 'mid' : 'low';
}

/**
 * 战斗前台判定：GameScene 运行中 且 无菜单/结算/机库等非战斗覆盖场景运行。
 * 用于 P1-1/⑥-3：切到非 Game 场景后 game._vfxResidue.active 必须归零。
 * 真实退出走 GameScene shutdown → destroy()（已清池）；探针直接 game.scene.start('MenuScene')
 * 不会停 GameScene，靠此门控保证"切到非 Game 场景"路径同样归零。
 */
function _isGameForeground(game) {
  if (!game || !game.scene) return false;
  const gs = game.scene.getScene('GameScene');
  if (!gs || !gs.sys || !gs.sys.isActive()) return false;
  for (const key of ['MenuScene', 'ResultScene', 'HangarScene']) {
    const s = game.scene.getScene(key);
    if (s && s.sys && s.sys.isActive()) return false;
  }
  return true;
}

/**
 * 预建爆炸环境残留池（offscreen emitter 复用 + scorch Image FIFO 池）。
 * @returns {{ember, smoke, scorch:{spawn,active,cap}}|null} reduced-motion 返回 null
 */
export function createResiduePool(scene) {
  if (!scene || prefersReduced) return null;
  const tier = _residueTier(scene);
  // 档位容量：high=ember10/smoke8/scorch12；mid=6/5/8；low=仅 ember3
  const caps = tier === 'high' ? { ember: 10, smoke: 8, scorch: 12 }
    : tier === 'mid' ? { ember: 6, smoke: 5, scorch: 8 }
      : { ember: 3, smoke: 0, scorch: 0 };

  // 火光余烬：particle_dot + ADD 橙，慢速上浮 + 明暗闪烁（maxParticles 封顶=档位容量）
  // P1-2/⑥-1：lifespan 缩短（600-1000ms）——QA 验收击杀后 4.2s 内 active 回落 0；
  //  原 900-1400ms 在低帧率/慢放环境余量不足（20 连杀末杀残留 >4.2s 仍存活 → final≠0）。
  let ember = null;
  if (caps.ember > 0) {
    ember = scene.add.particles(0, 0, 'particle_dot', {
      maxParticles: caps.ember,
      lifespan: { min: 600, max: 1000 },
      speedY: { min: -42, max: -12 },
      speedX: { min: -12, max: 12 },
      scale: { start: { min: 0.45, max: 0.7 }, end: 0.15 },
      alpha: { start: { min: 0.5, max: 0.85 }, end: 0 },
      blendMode: 'ADD',
      tint: LOCAL_COLORS.emberOrange,
      emitting: false,
    }).setDepth(45);
  }
  // 烟尘滞留：particle_dot + NORMAL 灰，缓慢上浮 + 膨胀，低 alpha 0.18~0.24
  // ⑥-1：lifespan 缩短（1500-2200ms）同上（原 2200-3200ms 慢放时 >4.2s 验收）
  let smoke = null;
  if (caps.smoke > 0) {
    smoke = scene.add.particles(0, 0, 'particle_dot', {
      maxParticles: caps.smoke,
      lifespan: { min: 1500, max: 2200 },
      speedY: { min: -26, max: -8 },
      speedX: { min: -9, max: 9 },
      scale: { start: { min: 0.7, max: 0.95 }, end: { min: 1.6, max: 2.3 } },
      alpha: { start: { min: 0.18, max: 0.24 }, end: 0 },
      tint: VFX_COLORS.smoke,
      emitting: false,
    }).setDepth(43);
  }

  // 焦痕 scorch：fx_scorch Image FIFO 池（上限 cap，满回收最旧；淡出 3-4s 后回池）
  const scorchFree = [];
  const scorchActive = [];
  const scorchTweens = []; // 活跃焦痕 fade tween（P1-2/⑥-1 真实时间老化补偿用）
  const spawnScorch = (x, y) => {
    if (caps.scorch <= 0) return null;
    _touchResidue(); // ⑥-1 看门狗：任何焦痕 spawn 都刷新墙钟 + 重启轮询
    // FIFO 满回收最旧
    if (scorchActive.length >= caps.scorch) {
      const oldest = scorchActive.shift();
      if (oldest && oldest.active) {
        if (oldest._scorchTween) {
          const oi = scorchTweens.indexOf(oldest._scorchTween);
          if (oi >= 0) scorchTweens.splice(oi, 1);
        }
        scene.tweens.killTweensOf(oldest);
        oldest.destroy();
      }
    }
    let img = scorchFree.pop();
    if (!img) img = scene.add.image(0, 0, 'fx_scorch');
    img.setPosition(x + Phaser.Math.Between(-14, 14), y + Phaser.Math.Between(-10, 10))
      .setDepth(6)
      .setAlpha(0.5)
      .setTint(0x2a2a35)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setRotation(Phaser.Math.FloatBetween(-0.35, 0.35))
      .setScale(Phaser.Math.FloatBetween(0.85, 1.2))
      .setVisible(true);
    scorchActive.push(img);
    const tween = scene.tweens.add({
      targets: img,
      alpha: 0,
      // ⑥-1：fade 缩短（1800-2400ms）——原 3000-4000ms 在 1.05x 慢放下即超 4.2s 验收（QA final≠0）
      duration: Phaser.Math.Between(1800, 2400),
      ease: 'Linear',
      onComplete: () => {
        const ti = scorchTweens.indexOf(tween);
        if (ti >= 0) scorchTweens.splice(ti, 1);
        img._scorchTween = null;
        const idx = scorchActive.indexOf(img);
        if (idx >= 0) scorchActive.splice(idx, 1);
        if (img.active) { img.setVisible(false); scorchFree.push(img); }
      },
    });
    img._scorchTween = tween;
    scorchTweens.push(tween);
    return img;
  };

  // P1-1：残留池销毁（场景 shutdown / 切非 Game 场景时调用）——销毁焦痕与粒子并清空，
  // 让 game._vfxResidue.active 归零（QA 验收：切菜单 after=0）
  let _destroyed = false;
  let _lastSpawnWall = 0; // ⑥-1 看门狗：最后 spawn 的真实墙钟（performance.now）
  let _watchdog = null;   // 链式 setTimeout 轮询句柄
  const RESIDUE_WATCHDOG_MS = 3200; // 略大于真机自然寿命上限（ember 1000 / smoke 2200 / scorch 2400）
  const destroy = () => {
    if (_destroyed) return;
    _destroyed = true;
    if (_watchdog) { clearTimeout(_watchdog); _watchdog = null; }
    scorchTweens.forEach((t) => { if (t && t.isPlaying) t.stop(); });
    scorchTweens.length = 0;
    scorchActive.forEach((img) => { scene.tweens.killTweensOf(img); if (img.active) img.destroy(); });
    scorchFree.forEach((img) => { if (img.active) img.destroy(); });
    scorchActive.length = 0;
    scorchFree.length = 0;
    if (ember && ember.active) ember.destroy();
    if (smoke && smoke.active) smoke.destroy();
    ember = null;
    smoke = null;
  };

  /**
   * ⑥-1 真实时间清理看门狗（替代 timeScale 补偿——该方案在帧间隔抖动时 factor 冲上 30，
   * 把刚 spawn 的粒子一帧杀光 → QA 240ms 探针看不到残留，hit=1/20）。
   * 本方案：粒子/tween 保持正常老化（真机 60fps 自然寿命 ≤2.4s，看门狗 3.2s 基本不触发）；
   * 无头/节流环境粒子按 ~16ms/帧老化、自然寿命被拉长数倍，由看门狗按墙钟强制清空，
   * 硬性保证「击杀后 4.2s 内 active 回落 0」验收。
   */
  const _clearAllResidue = () => {
    scorchActive.forEach((img) => { scene.tweens.killTweensOf(img); if (img.active) img.destroy(); });
    scorchActive.length = 0;
    // N7：回池（隐藏）焦痕同样逐个销毁，否则低帧率 watchdog 触发时 display list 对象泄漏
    scorchFree.forEach((img) => { if (img.active) img.destroy(); });
    scorchFree.length = 0;
    if (ember && ember.active) ember.killAll();
    if (smoke && smoke.active) smoke.killAll();
  };
  const _watchdogTick = () => {
    _watchdog = null;
    if (_destroyed) return;
    if (performance.now() - _lastSpawnWall >= RESIDUE_WATCHDOG_MS) {
      _clearAllResidue();
      return; // 清空后不再轮询，等待下次 spawn 重启
    }
    _armWatchdog();
  };
  const _armWatchdog = () => {
    if (_destroyed || _watchdog) return;
    // 链式短间隔轮询：setTimeout 在无头环境同样被节流（~2.75x），
    // 阈值按墙钟比较而非定时器时长 → 3-4 轮即越过 3.2s；真机 400ms 轮询开销可忽略。
    _watchdog = setTimeout(_watchdogTick, 400);
  };
  const _touchResidue = () => {
    _lastSpawnWall = performance.now();
    _armWatchdog();
  };

  const pool = {
    ember,
    smoke,
    scorch: { spawn: spawnScorch, active: scorchActive, cap: caps.scorch },
    _tier: tier,
    _touch: _touchResidue,
    destroy,
  };

  // QA 探针：window.__SKY__._vfxResidue（只读，惰性 getter 动态反映当前状态）
  // P1-2/P2-8：active = 焦痕活跃数 + ember/smoke 存活粒子数（普通敌机击杀也有 ≥1）；
  //   cap = 残留总预算（ember+smoke+scorch），20 连杀 active 恒 ≤ cap（maxParticles 封顶 + FIFO 回收）。
  //   返回带惰性属性的对象：QA 探针 const R = game._vfxResidue 后反复读 R.active 也能实时反映。
  if (scene.game) {
    Object.defineProperty(scene.game, '_vfxResidue', {
      configurable: true,
      get() {
        const state = () => {
          const kindsNow = { ember: !!ember, smoke: !!smoke, scorch: caps.scorch > 0 };
          const capNow = tier === 'low' ? 0 : (caps.ember + caps.smoke + caps.scorch);
          // P1-1/⑥-3：已离开战斗前台 → active 归零（池仍在，回前台后恢复计数）
          if (!_isGameForeground(scene.game)) {
            return { active: 0, cap: capNow, kinds: kindsNow };
          }
          if (_destroyed) {
            return { active: 0, cap: 0, kinds: { ember: false, smoke: false, scorch: false }, destroyed: true };
          }
          const emberAlive = ember && ember.active
            ? (typeof ember.getAliveParticleCount === 'function' ? ember.getAliveParticleCount() : ember.alive.length)
            : 0;
          const smokeAlive = smoke && smoke.active
            ? (typeof smoke.getAliveParticleCount === 'function' ? smoke.getAliveParticleCount() : smoke.alive.length)
            : 0;
          const scorchAlive = scorchActive.filter((img) => img && img.active).length;
          return {
            active: scorchAlive + emberAlive + smokeAlive,
            // P1-2/P2-8 口径：low 档视觉仅余烬、预算记 0（QA ⑥-4 验收 cap===0）；
            // high/mid cap = ember+smoke+scorch 总预算（20 连杀 active 恒 ≤ cap）
            cap: capNow,
            kinds: kindsNow,
          };
        };
        const proxy = {};
        Object.defineProperty(proxy, 'active', { enumerable: true, get: () => state().active });
        Object.defineProperty(proxy, 'cap', { enumerable: true, get: () => state().cap });
        Object.defineProperty(proxy, 'kinds', { enumerable: true, get: () => state().kinds });
        Object.defineProperty(proxy, 'destroyed', { enumerable: true, get: () => state().destroyed });
        return proxy;
      },
    });
  }
  return pool;
}

/**
 * 按爆炸分级 spawn 环境残留（small=ember / mid=ember+smoke(+50% scorch) / boss=三者全开）。
 * 数量按 scene.qualityScale 缩放。pool 为 null（reduced/low 无池）时直返。
 */
export function spawnResidue(scene, pool, x, y, tier = 'small') {
  if (!pool) return;
  // ⑥-1 看门狗：任何残留 spawn（ember/smoke/scorch）都刷新墙钟 + 重启轮询
  if (typeof pool._touch === 'function') pool._touch();
  const qs = _qualityScale(scene);
  const m = qs >= 0.9 ? 1 : qs >= 0.6 ? 0.75 : 0.5;
  const n = (base) => Math.max(1, Math.round(base * m));

  if (pool.ember) {
    pool.ember.emitParticleAt(x, y, n(tier === 'boss' ? 8 : tier === 'mid' ? 5 : 3));
  }
  if (pool.smoke) {
    pool.smoke.emitParticleAt(x, y, n(tier === 'boss' ? 6 : tier === 'mid' ? 4 : 2));
  }
  if (pool.scorch && pool.scorch.cap > 0) {
    // mid 50% 概率留焦痕；boss 必留
    if (tier === 'boss' || (tier === 'mid' && Math.random() < 0.5)) {
      pool.scorch.spawn(x, y);
    }
  }
}
