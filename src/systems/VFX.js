import Phaser from 'phaser';
import { COLORS } from '../config/GameConfig.js';

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
  const p = scene.add.particles(x, y, 'particle', {
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

/** 子弹击中目标时的点状闪光 */
export function hitSpark(scene, x, y) {
  if (prefersReduced) return;
  const p = scene.add.particles(x, y, 'particle', {
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

/** 炸弹/星风暴：全屏冲击波 + 屏震 + 闪光 */
export function bombShockwave(scene, x, y) {
  if (prefersReduced) return;
  const p = scene.add.particles(x, y, 'particle', {
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
  scene.cameras.main.shake(220, 0.03);
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
    scene.cameras.main.shake(450, 0.025);
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
  scene.cameras.main.shake(520, 0.035);
  scene.cameras.main.flash(280, 120, 70, 45);
}

/**
 * 给敌机挂上尾焰 emitter（随敌机 active 启动/暂停）。
 * 调用方负责在 enemy 回收时 stop()、destroy 时 destroy()。
 */
export function attachEnemyThruster(scene, enemy, color = COLORS.enemy) {
  if (prefersReduced) return null;
  const t = scene.add.particles(0, 0, 'particle', {
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

/** 玩家尾焰（比默认更浓厚） */
export function attachPlayerThruster(scene, player) {
  if (prefersReduced) return null;
  const t = scene.add.particles(0, 0, 'particle', {
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

/** 玩家子弹尾迹（青色发光，ADD 混合）。reduced-motion 下返回 null */
export function bulletTrail(scene) {
  if (prefersReduced) return null;
  const e = scene.add.particles(0, 0, 'particle', {
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

/** 敌弹光晕（红橙脉冲，ADD 混合）。reduced-motion 下返回 null */
export function enemyBulletGlow(scene) {
  if (prefersReduced) return null;
  const e = scene.add.particles(0, 0, 'particle', {
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

/** 控制 emitter 启动/停止，用于对象池回收 */
export function setEmitterActive(emitter, active) {
  if (!emitter) return;
  active ? emitter.start() : emitter.stop();
}

export function destroyEmitter(emitter) {
  if (emitter && emitter.active) emitter.destroy();
}
