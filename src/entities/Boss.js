import Phaser from 'phaser';
import { GAME_WIDTH, BULLET, EVENTS, COLORS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import * as VFX from '../systems/VFX.js';

/**
 * Boss（多阶段，配置化弹幕）。
 * ---------------------------------------------------------------------------
 * 由 GameScene.spawnBoss(bossKey) 创建，bossKey 对应 LEVELS 里的 boss 配置。
 * 配置项（config）：maxHp / pattern(弹幕形态) / name / color / difficulty。
 * 弹幕形态：fan(扇形) / ring(环) / spiral(螺旋) / cross(瞄准+十字)。
 * 阶段按血量切分（>66% / >33% / 其余），阶段越高弹幕越密、越快。
 */
export default class Boss extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, bossKey, config = {}) {
    super(scene, GAME_WIDTH / 2, -120, 'boss');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(18);
    this.bossKey = bossKey;

    this.config = config;
    this.pattern = config.pattern || 'fan';
    this.color = config.color || COLORS.enemy;
    this.maxHp = config.maxHp || 3000;
    this.hp = this.maxHp;
    this.difficulty = config.difficulty || 1;
    this.bulletSpeed = BULLET.ENEMY_SPEED * 0.9 * this.difficulty;
    this.phase = 1;
    this.body.setSize(this.width * 0.7, this.height * 0.6);
    this.body.enable = true;
    this.setTint(this.color);

    this._entering = true;
    this._t = 0;
    this._lastFire = 0;
    this._dir = 1;
    this._spiralAng = 0;

    scene.tweens.add({
      targets: this, y: 150, duration: 2000, ease: 'Cubic.out',
      onComplete: () => { this._entering = false; },
    });

    EventBus.emit(EVENTS.BOSS_HP_CHANGED, this.hp, this.maxHp);
  }

  update(time, dt) {
    if (!this.active) return;
    this._t += dt;

    if (!this._entering) {
      // 左右横移
      this.x += this._dir * 90 * (dt / 1000);
      if (this.x < 90) { this.x = 90; this._dir = 1; }
      if (this.x > GAME_WIDTH - 90) { this.x = GAME_WIDTH - 90; this._dir = -1; }

      // 弹幕（阶段越高越频繁）
      const fireGap = this.phase === 1 ? 900 : this.phase === 2 ? 650 : 420;
      if (time - this._lastFire > fireGap) {
        this.firePattern();
        this._lastFire = time;
      }
    }
  }

  firePattern() {
    switch (this.pattern) {
      case 'ring': this._patternRing(); break;
      case 'spiral': this._patternSpiral(); break;
      case 'cross': this._patternCross(); break;
      default: this._patternFan(); break;
    }
  }

  /** 发射单发子弹并染上 Boss 配色，便于视觉区分 */
  spawnBullet(angle, speed) {
    const scene = this.scene;
    if (!scene.enemyBullets) return;
    const b = scene.enemyBullets.get(this.x, this.y + 40, 'bullet_enemy');
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.body.enable = true;
    b.setTint(this.color);
    scene.physics.velocityFromRotation(angle, speed, b.body.velocity);
  }

  // 半圆扇形（基础弹幕）：向下半圆铺开
  _patternFan() {
    const n = 10 + this.phase * 4;
    const spread = Math.PI;
    for (let i = 0; i < n; i++) {
      const ang = (spread / (n - 1)) * i;
      this.spawnBullet(ang, this.bulletSpeed * 0.9);
    }
  }

  // 环状齐射（360° 环，缓缓自转）
  _patternRing() {
    const n = 12 + this.phase * 4;
    const off = this._t * 0.0006;
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 / n) * i + off;
      this.spawnBullet(ang, this.bulletSpeed * 0.8);
    }
  }

  // 旋转螺旋：每发自转一个角度，阶段越高臂越多、越密
  _patternSpiral() {
    const arms = 2 + this.phase;       // 3 / 4 / 5 条螺旋臂
    const per = 3 + this.phase;        // 每条臂子弹数
    this._spiralAng += 0.3 + this.phase * 0.08;
    for (let a = 0; a < arms; a++) {
      const base = this._spiralAng + (Math.PI * 2 / arms) * a;
      for (let i = 0; i < per; i++) {
        this.spawnBullet(base + i * 0.14, this.bulletSpeed * 0.7);
      }
    }
  }

  // 瞄准 + 十字：朝玩家扇射；阶段2后追加正交十字弹
  _patternCross() {
    const player = this.scene.player;
    const base = (player && player.active)
      ? Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y)
      : Math.PI / 2;
    const n = 4 + this.phase * 2;
    const spread = 0.5 + this.phase * 0.25;
    for (let i = 0; i < n; i++) {
      const ang = base + (spread / Math.max(1, n - 1)) * i - spread / 2;
      this.spawnBullet(ang, this.bulletSpeed);
    }
    if (this.phase >= 2) {
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((ang) => {
        this.spawnBullet(ang, this.bulletSpeed * 0.85);
      });
    }
  }

  hit(dmg, element) {
    if (this._entering) return false;
    this.hp = Math.max(0, this.hp - dmg);
    if (element) this.applyElement(element);
    EventBus.emit(EVENTS.BOSS_HP_CHANGED, this.hp, this.maxHp);
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(40, () => { if (this.active) this.setTint(this.color); });
    VFX.hitSpark(this.scene, this.x, this.y + 20);

    // 阶段切换
    const ratio = this.hp / this.maxHp;
    const newPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this.scene.cameras.main.flash(200, 80, 20, 40);
    }

    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  /** 附加元素状态（B6，仅染色反馈；Boss 不受减速/麻痹影响） */
  applyElement(key) {
    if (!key) return;
    const map = { fire: 0xff7a3a, ice: 0x6fd6ff, thunder: 0xffe14a };
    const c = map[key];
    if (!c) return;
    this.setTint(c);
    this.scene.time.delayedCall(260, () => { if (this.active) this.setTint(this.color); });
  }

  die() {
    EventBus.emit(EVENTS.BOSS_DEFEATED);
    VFX.bossDeathExplosion(this.scene, this, this.color);
    this.setActive(false);
    this.scene.time.delayedCall(800, () => this.destroy());
  }
}
