import Phaser from 'phaser';
import { COLORS, ELEMENTS } from '../config/GameConfig.js';

/**
 * VFX —— 视觉特效中心（粒子、闪光、尾焰、受击反馈）。
 * 所有特效统一走这里，方便性能开关与 reduced-motion 适配。
 */

const prefersReduced = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
    tint: [color, 0xffaa33, 0xffffff, 0xff6622],
    gravityY: 18,
    emitting: false,
  });
  p.setDepth(50);
  p.explode();
  scene.time.delayedCall(600, () => { if (p && p.active) p.destroy(); });
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
    tint: [0xffffff, 0xffd54a, 0x8fe3ff, 0xffaa33],
    emitting: false,
  });
  p.setDepth(55);
  p.explode();
  scene.time.delayedCall(200, () => { if (p && p.active) p.destroy(); });
}

/** 炸弹/星风暴：全屏冲击波 + 屏震 + 闪光（圆点柔光） */
export function bombShockwave(scene, x, y) {
  if (prefersReduced) return;
  const p = scene.add.particles(x, y, 'particle_dot', {
    speed: { min: 140, max: 460 },
    lifespan: 750,
    scale: { start: 2.4, end: 0 },
    alpha: { start: 0.8, end: 0 },
    quantity: 42,
    blendMode: 'ADD',
    tint: [0xffd54a, 0xff6622, 0xffffff, 0x66ccff, 0xffaa33],
    emitting: false,
  });
  p.setDepth(80);
  p.explode();
  shake(scene, 'heavy');
  scene.cameras.main.flash(120, 90, 75, 45);
  scene.time.delayedCall(800, () => { if (p && p.active) p.destroy(); });
}

/** 玩家受击反馈：有护盾时扩散光罩，无护盾时屏幕红闪 */
export function playerHitFlash(scene, shieldActive) {
  if (!scene.player) return;
  const px = scene.player.x, py = scene.player.y;
  if (shieldActive) {
    const shield = scene.add.circle(px, py, 42, 0x3ad1ff, 0.45)
      .setStrokeStyle(3, 0xaaffff, 0.8).setDepth(70);
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
      explosion(scene, boss.x + ox, boss.y + oy, color, s);
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
    tint: [COLORS.player, 0xaaddff, 0xffffff],
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
    tint: [0x8fe3ff, 0x66ccff, 0xffffff],
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
    tint: [0xff5a3c, 0xff8844, 0xffd0a0],
    emitting: false,
  }).setDepth(16);
  return e;
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
    tint: [0xffffff, 0x9ff0ff],
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
    pulse: mk([0x8fe3ff, 0x66ccff, 0xffffff]),
    scatter: mk([0xbfe8ff, 0x9fd8ff, 0xffffff]),
    missile: mk([0xffcc44, 0xff8a3d, 0xffffff]),
    bomb: mk([0xffd0a0, 0xff7a3a, 0xffffff]),
    fire: mk([0xffd0a0, 0xff7a3a, 0xffe14a, 0xffffff]),
    ice: mk([0xbfefff, 0x6fd6ff, 0xffffff]),
    thunder: mk([0xffe14a, 0xffd54a, 0xffffff]),
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
    tint: [0xffffff, 0xffd54a, 0x8fe3ff, 0xffaa33], emitting: false,
  });
  hs.setDepth(55);
  hs.explode(1);
  const ex = scene.add.particles(-300, -300, 'particle_dot', {
    speed: { min: 70, max: 280 }, lifespan: 550, scale: { start: 1.7, end: 0 },
    alpha: { start: 0.9, end: 0 }, quantity: 22, blendMode: 'ADD',
    tint: [COLORS.enemy, 0xffaa33, 0xffffff, 0xff6622], gravityY: 18, emitting: false,
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
  g.lineStyle(2, 0xffe14a, 0.9);
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
