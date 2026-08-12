import Phaser from 'phaser';
import { BULLET, GAME_HEIGHT, GAME_WIDTH, EVENTS, ELEMENTS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { audio } from '../systems/AudioSystem.js';
import * as VFX from '../systems/VFX.js';
import { damageNumber } from '../systems/FloatingText.js';

/**
 * 敌机（从对象池取用）。
 * ---------------------------------------------------------------------------
 * 通过 spawn() 复活并配置类型。支持三种类型：small / mid + 移动模式。
 * 死亡时掉金币概率、发子弹逻辑都在这里。
 *
 * 契约：由 GameScene 的 enemies 物理组管理；敌弹发到 scene.enemyBullets。
 */
const PREFERS_REDUCED = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const TYPES = {
  small: { tex: 'enemy_small', hp: 20, score: 100, coin: 0.35, speed: 130, fireRate: 0,    color: 0xff5a6e },
  mid:   { tex: 'enemy_mid',   hp: 60, score: 300, coin: 0.6,  speed: 90,  fireRate: 1400, color: 0xff8a3d },
  diver: { tex: 'enemy_diver', hp: 35, score: 200, coin: 0.45, speed: 150, fireRate: 0,    color: 0xff3df0, defaultMode: 'dive' },
};

export default class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene) {
    super(scene, 0, 0, 'enemy_small');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(15);
    this.setActive(false).setVisible(false);
    this.moveMode = 'straight';
    this.firePattern = 'straight';   // C3 弹幕形态：straight/spread/tracking/burst
    this._t = 0;
    this._lastFire = 0;
    this.thruster = null;
    // B6 元素状态
    this._elem = null;
    this._slowUntil = 0;
    this._stunUntil = 0;
    this._dotUntil = 0;
    this._dotTick = 0;
  }

  getColor() {
    return this.def.color;
  }

  /** 从池中激活一个敌人。difficulty 为关卡难度系数（作用到 HP/速度） */
  spawn(x, y, typeKey = 'small', moveMode = 'straight', difficulty = 1, firePattern = 'straight') {
    const t = TYPES[typeKey] || TYPES.small;
    this.typeKey = typeKey;
    this.def = t;
    this.difficulty = difficulty;
    this.setTexture(t.tex);
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.body.enable = true;
    // 难度系数：HP 线性放大，速度略增
    this.hp = Math.round(t.hp * difficulty);
    this.maxHp = this.hp;
    this.moveMode = moveMode;
    this.firePattern = firePattern || 'straight';
    this._t = 0;
    this._baseX = x;
    this._lastFire = this.scene.time.now;
    this._baseVy = t.speed * (1 + (difficulty - 1) * 0.4);
    this.setVelocity(0, this._baseVy);
    // 重置元素状态（B6）
    this._elem = null;
    this._slowUntil = 0;
    this._stunUntil = 0;
    this._dotUntil = 0;
    this._dotTick = 0;
    this.clearTint();

    if (!this.thruster) {
      this.thruster = VFX.attachEnemyThruster(this.scene, this, this.getColor());
    } else {
      VFX.setEmitterActive(this.thruster, true);
    }
    return this;
  }

  update(time, dt) {
    if (!this.active) return;

    // B6 火元素 DoT（灼烧）
    if (time < this._dotUntil) {
      const dps = (ELEMENTS.fire && ELEMENTS.fire.dot) || 10;
      this.hp -= dps * dt / 1000;
      this._dotTick += dt;
      if (this._dotTick > 150) { VFX.hitSpark(this.scene, this.x, this.y, 'fire'); this._dotTick = 0; }
      if (this.hp <= 0) { this.die(); return; }
    }

    // B6 雷元素麻痹：冻结移动与开火
    if (time < this._stunUntil) {
      this.body.setVelocity(0, 0);
      if (this.y > GAME_HEIGHT + 60 || this.x < -80 || this.x > GAME_WIDTH + 80) this.recycle();
      return;
    } else if (this.moveMode === 'straight' && this.body.velocity.y === 0 && this._baseVy) {
      // 麻痹结束，恢复直行速度
      this.setVelocity(0, this._baseVy);
    }

    // B6 冰元素减速：放大时间步 + 速度
    const slow = (time < this._slowUntil) ? ((ELEMENTS.ice && ELEMENTS.ice.slow) || 0.5) : 1;
    this._t += dt * slow;

    // 移动模式
    switch (this.moveMode) {
      case 'sine':
        this.x = this._baseX + Math.sin(this._t * 0.003) * 90 * slow;
        this.setVelocity(0, this._baseVy * slow);
        break;
      case 'dive':
        if (this._t > 800) this.setVelocityY(this._baseVy * 2.2 * slow);
        else this.setVelocity(0, this._baseVy * slow);
        break;
      default:
        this.setVelocity(0, this._baseVy * slow); // straight
        break;
    }

    // 敌人开火（仅 mid+）
    if (this.def.fireRate > 0 && time - this._lastFire > this.def.fireRate) {
      this.fireAtPlayer();
      this._lastFire = time;
    }

    // 出屏回收
    if (this.y > GAME_HEIGHT + 60 || this.x < -80 || this.x > GAME_WIDTH + 80) {
      this.recycle();
    }
  }

  fireAtPlayer() {
    const scene = this.scene;
    const player = scene.player;
    if (!player || !player.active || !scene.enemyBullets) return;
    const aim = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    const spd = BULLET.ENEMY_SPEED * (this.difficulty || 1);

    const spawnBullet = (ang, homing = false) => {
      const b = scene.enemyBullets.get(this.x, this.y + 16, 'bullet_enemy');
      if (!b) return;
      b.setActive(true).setVisible(true);
      b.body.enable = true;
      b.eHoming = homing;                    // C3：tracking 弹由 GameScene 转向
      b.setVelocity(0, 0);
      scene.physics.velocityFromRotation(ang, spd, b.body.velocity);
    };

    switch (this.firePattern) {
      case 'spread':   // 三向扇射
        spawnBullet(aim - 0.22);
        spawnBullet(aim);
        spawnBullet(aim + 0.22);
        break;
      case 'tracking': // 追踪弹（homing）
        spawnBullet(aim, true);
        break;
      case 'burst':    // 五发向下散射弧
        for (let i = -2; i <= 2; i++) spawnBullet(Math.PI / 2 + i * 0.18);
        break;
      default:         // straight：朝玩家直射
        spawnBullet(aim);
        break;
    }
  }

  /** 受伤，返回是否死亡 */
  hit(dmg, element) {
    if (element) this.applyElement(element);   // B6 命中附加元素状态
    const willDie = this.hp - dmg <= 0;        // 致命一击交给 die() 的爆炸音，避免双重音
    this.hp -= dmg;
    if (!willDie) audio.sfx('enemyHit');       // 非致死命中：轻脆命中反馈（音高随机在 AudioSystem 内处理）
    // 受击反馈：伤害飘字 + 颤动（flinch）+ 闪白
    damageNumber(this.scene, this.x, this.y - 14, Math.max(1, Math.round(dmg)));
    this._flinch();
    // 受击闪白
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(40, () => { if (this.active && !this._elem) this.clearTint(); });
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  /** 受击颤动（flinch）：scale 挤压 + 角度回弹；连续命中先 stop 旧 tween 防累积。reduced-motion 跳过 */
  _flinch() {
    if (PREFERS_REDUCED) return;
    if (this._flinchTween) this._flinchTween.stop();
    this.setScale(1, 1);
    this.angle = 0;
    this._flinchTween = this.scene.tweens.add({
      targets: this,
      scaleX: 1.16, scaleY: 0.86,
      angle: Phaser.Math.Between(-6, 6),
      duration: 70, yoyo: true, ease: 'Quad.easeOut',
      onComplete: () => { this.setScale(1, 1); this.angle = 0; this._flinchTween = null; },
    });
  }

  /** 附加元素状态（B6）：火=灼烧 / 冰=减速 / 雷=麻痹 */
  applyElement(key) {
    if (!key || !ELEMENTS[key]) return;
    const now = this.scene.time.now;
    const cfg = ELEMENTS[key];
    this._elem = key;
    if (key === 'fire') {
      this._dotUntil = now + (cfg.duration || 3000);
    } else if (key === 'ice') {
      this._slowUntil = now + (cfg.duration || 3000);
    } else if (key === 'thunder') {
      this._stunUntil = now + (cfg.stun || 1100);
    }
    // 元素染色反馈
    this.setTint(cfg.color || 0xffffff);
    this.scene.time.delayedCall(cfg.duration || 1100, () => {
      if (this.active && this.scene.time.now > this._dotUntil && this.scene.time.now > this._slowUntil && this.scene.time.now > this._stunUntil) {
        this._elem = null;
        this.clearTint();
      }
    });
  }

  die() {
    audio.sfx('explosion');
    EventBus.emit(EVENTS.SCORE_CHANGED, this.def.score);
    // 掉金币
    if (Math.random() < this.def.coin && this.scene.spawnCoin) {
      this.scene.spawnCoin(this.x, this.y);
    }
    // 增强爆炸
    VFX.explosion(this.scene, this.x, this.y, this.getColor(), this.typeKey === 'mid' ? 1.3 : 1);
    if (this.scene.maybeDropItem) this.scene.maybeDropItem(this.x, this.y);
    this.recycle();
  }

  recycle() {
    VFX.setEmitterActive(this.thruster, false);
    this.setActive(false).setVisible(false);
    if (this.body) { this.body.enable = false; this.setVelocity(0, 0); }
  }

  destroy(fromScene) {
    VFX.destroyEmitter(this.thruster);
    this.thruster = null;
    super.destroy(fromScene);
  }
}
