import Phaser from 'phaser';
import { COLORS, ELEMENTS, GAME_WIDTH, VFX_COLORS } from '../config/GameConfig.js';

/**
 * VFX —— 视觉特效中心（粒子、闪光、尾焰、受击反馈）。
 * 所有特效统一走这里，方便性能开关与 reduced-motion 适配。
 */

const prefersReduced = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
  const p = scene.add.particles(x, y, 'particle_dot', {
    speed: { min: 70 * scale, max: 280 * scale },
    lifespan: 550,
    scale: { start: 1.7 * scale, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: Math.floor(22 * scale),
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
    ease: 'Cubic.out',
    onComplete: () => { if (ring && ring.active) ring.destroy(); },
  });
  return ring;
}

/** 残骸：4-6 片深色碎片（NORMAL 混合，旋转飘散，650ms） */
export function debrisBurst(scene, x, y, color = VFX_COLORS.debris, count = 5, scale = 1) {
  if (prefersReduced) return null;
  const n = Math.max(1, Math.round(Phaser.Math.Between(4, 6) * (count / 5) * scale));
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
  const p = scene.add.particles(x, y, 'particle_dot', {
    speed: { min: 20, max: 60 },
    lifespan: 900,
    scale: { start: 1.3 * scale, end: 0 },
    alpha: { start: 0.4, end: 0 },
    quantity: Phaser.Math.Between(5, 8),
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
  scene.time.delayedCall(30, () => shockwaveRing(scene, x, y, color, { radius: 70, duration: 260, depth: 54 }));
  scene.time.delayedCall(50, () => explosion(scene, x, y, color, scale));
  // mid 层数减半：省残骸/烟尘；small/boss 全五层
  if (tier !== 'mid') {
    scene.time.delayedCall(90, () => debrisBurst(scene, x, y, VFX_COLORS.debris, 5, scale));
    scene.time.delayedCall(130, () => smokePuff(scene, x, y, scale));
  }
}

/** 子弹击中目标时的点状闪光（星形火花） */
export function hitSpark(scene, x, y) {
  if (prefersReduced) return;
  const p = scene.add.particles(x, y, 'particle_spark', {
    speed: { min: 25, max: 100 },
    lifespan: 150,
    scale: { start: 0.7, end: 0 },
    alpha: { start: 0.9, end: 0 },
    quantity: 6,
    blendMode: 'ADD',
    tint: VFX_COLORS.hit,
    emitting: false,
  });
  p.setDepth(55);
  p.explode();
  scene.time.delayedCall(200, () => { if (p && p.active) p.destroy(); });
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
    targets: ring, scale: 3.2, alpha: 0, duration: 360, ease: 'Cubic.out',
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
