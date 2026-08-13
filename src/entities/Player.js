import Phaser from 'phaser';
import { PLAYER, BULLET, GAME_WIDTH, GAME_HEIGHT, EVENTS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';
import { audio } from '../systems/AudioSystem.js';
import * as VFX from '../systems/VFX.js';

// 升级 -> 战斗属性换算（GameConfig 只读，这里集中定义每级增益）
const SHIELD_PER_LEVEL = 15;    // 每级护盾吸收池上限
const MAGNET_BASE_RADIUS = 90;  // 0 级基础金币吸取半径
const MAGNET_PER_LEVEL = 45;    // 每级额外增加的吸取半径

/**
 * 玩家战机。
 * ---------------------------------------------------------------------------
 * 职责：移动（指针拖动 / 键盘）、自动开火、受击、无敌闪烁。
 * 依赖：GameScene 提供 playerBullets 物理组用于发射。
 *
 * 契约方法（供 GameScene / 系统调用）：
 *   update(dt, pointer, cursors)   每帧
 *   takeDamage(n)                  受击
 *   setFirepower(level)            升级主炮火力等级（0~8）
 *   getHitCircle()                 返回 {x,y,r} 精确判定圈
 */
export default class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, bulletGroup) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.scene = scene;
    this.bullets = bulletGroup;

    this.setDepth(20);
    this.setCollideWorldBounds(true);
    this.body.setSize(this.width * 0.5, this.height * 0.5);

    // 应用存档升级（shield/magnet/wingman 由本类负责；
    // firepower/hull 的 maxHp 由 GameScene 依据同一存档设置，这里仅同步字段）
    const up = (SaveManager.load().upgrades) || {};
    this.hullLevel = up.hull || 0;

    this.hp = PLAYER.MAX_HP;
    this.maxHp = PLAYER.MAX_HP;

    // 火力等级（GameScene 也会调用 setFirepower，这里保证默认值一致）
    this.firepower = up.firepower || 0;
    this.setFirepower(this.firepower);

    // 当前武器（B/C 武器系统）：'pulse'(默认主炮) | 'missile'(追踪导弹) | 'laser' | 'bomb'
    this.weapon = 'pulse';

    // 战机的元素属性（C2 武器绑定）：由所选战机决定，命中时附加元素状态
    this.shipElement = null;        // 'fire' | 'ice' | 'thunder' | null
    // 默认武器（C2）：拾取武器箱到期时回退到此，而非硬编码脉冲
    this.defaultWeapon = 'pulse';
    // 激光束（B4）：持续光束，由 GameScene 的 beamGroup 承载
    this.beamGroup = null;          // GameScene 注入的激光物理组
    this.laserBeam = null;

    this._lastFire = 0;
    this.invulnUntil = 0;

    // 护盾：升级提供吸收池基础值；战斗初始即拥有护盾池（0 级为 0）
    this.shieldLevel = up.shield || 0;
    this.shieldMax = this.shieldLevel * SHIELD_PER_LEVEL;
    this.shield = this.shieldMax;

    // 磁力：金币吸取半径（供 GameScene 范围吸取使用，暂无则预留字段）
    this.magnetLevel = up.magnet || 0;
    this.magnetRadius = MAGNET_BASE_RADIUS + this.magnetLevel * MAGNET_PER_LEVEL;

    // 僚机：永久跟随数量（由 GameScene 读取生成协同开火精灵；暂预留字段）
    this.wingmanLevel = up.wingman || 0;
    this.wingmen = this.wingmanLevel;

    // 尾焰粒子（增强版）
    this.thruster = VFX.attachPlayerThruster(scene, this);

    // P1-6 可见判定点：半径=真实判定圈的小圆（斑鸠/虫姬同款），由存档 showHitbox 控制显隐
    this.hitboxDot = scene.add.circle(this.x, this.y, PLAYER.HITBOX_RADIUS, 0xff3344, 0.3)
      .setStrokeStyle(2, 0xff6677, 0.95).setDepth(22)
      .setVisible(SaveManager.load().showHitbox);
  }

  /** 每帧：移动 + 开火 */
  update(time, dt, pointer, cursors) {
    // 移动：指针拖动优先，否则键盘
    if (pointer && pointer.isDown) {
      const tx = Phaser.Math.Clamp(pointer.worldX, 20, GAME_WIDTH - 20);
      const ty = Phaser.Math.Clamp(pointer.worldY - 40, 40, GAME_HEIGHT - 20);
      this.x = Phaser.Math.Linear(this.x, tx, 0.35);
      this.y = Phaser.Math.Linear(this.y, ty, 0.35);
    } else if (cursors) {
      const v = PLAYER.SPEED;
      let vx = 0, vy = 0;
      if (cursors.left.isDown) vx = -v;
      else if (cursors.right.isDown) vx = v;
      if (cursors.up.isDown) vy = -v;
      else if (cursors.down.isDown) vy = v;
      this.setVelocity(vx, vy);
    }

    // 自动开火
    if (time - this._lastFire >= this.fireInterval) {
      this.fire();
      this._lastFire = time;
    }

    // 激光束跟随玩家（B4）
    if (this.weapon === 'laser' && this.laserBeam) {
      this.laserBeam.x = this.x;
      this.laserBeam.y = this.y - GAME_HEIGHT / 2;
      this.laserBeam.active = true;
      this.laserBeam.visible = true;
      this.laserBeam.element = this.shipElement;
      if (this.laserBeam.body) this.laserBeam.body.enable = true;
    }

    // 无敌闪烁
    if (time < this.invulnUntil) {
      this.setAlpha(0.4 + 0.4 * Math.sin(time * 0.03));
    } else {
      this.setAlpha(1);
    }

    // P1-6 判定点跟随玩家 + 显隐同步（每帧读内存存档缓存，开销可忽略）
    if (this.hitboxDot) this.hitboxDot.setPosition(this.x, this.y).setVisible(SaveManager.load().showHitbox);
  }

  /** 按火力等级发射多路子弹 */
  fire() {
    if (!this.active) return;

    // 激光（B4）：持续光束，fire 仅作脉冲触发声效，伤害由 GameScene overlap 持续结算
    if (this.weapon === 'laser') {
      this._ensureLaserBeam();
      audio.sfx('shoot');
      return;
    }

    audio.sfx('shoot');
    const patterns = this.getFirePattern(this.firepower);
    for (const p of patterns) {
      const key = p.bulletKey || 'bullet_pulse';
      const b = this.bullets.get(this.x + p.dx, this.y - 20, key);
      if (!b) continue;
      // P1-2 池贴图不变量：复用的子弹可能残留旧贴图键，先统一成本次请求的贴图，
      // 再读 bw/bh 计算 body（下方在 setTexture 之后读取），避免不同武器共用同一池时贴图错乱。
      if (b.texture && b.texture.key !== key) b.setTexture(key);
      b.setActive(true).setVisible(true);
      b.body.enable = true;
      b.homing = false;
      b.isBomb = false;
      b.element = this.shipElement;          // B6：子弹携带战斗机元素属性
      const bw = b.width, bh = b.height;
      if (key === 'bullet_missile') {
        b.damage = BULLET.MISSILE_DMG;
        b.homing = true;
        b.body.setSize(bw * 0.6, bh * 0.6);
        b.setVelocity(p.vx, -BULLET.MISSILE_SPEED);
      } else if (key === 'bullet_bomb') {
        // B5 元素炸弹：向上抛，命中/到达屏顶后 AOE 爆炸（逻辑在 GameScene）
        b.damage = BULLET.BOMB_DMG;
        b.isBomb = true;
        b.explodeRadius = BULLET.BOMB_RADIUS;
        b.element = this.shipElement;
        b.body.setSize(bw, bh);
        b.setVelocity(p.vx || 0, -BULLET.BOMB_SPEED);
      } else {
        b.damage = BULLET.PLAYER_DMG;
        b.setVelocity(p.vx, -BULLET.PLAYER_SPEED);
        if (key === 'bullet_pulse') b.body.setSize(bw * 0.6, bh * 0.7);
        else b.body.setSize(bw * 0.7, bh * 0.7);
      }
      if (p.angle) b.setRotation(p.angle);
    }
  }

  /** 确保激光束对象存在（首次使用 laser 武器时懒创建） */
  _ensureLaserBeam() {
    if (!this.beamGroup) return;
    if (this.laserBeam) return;
    const beam = this.scene.add.rectangle(this.x, this.y - GAME_HEIGHT / 2, BULLET.LASER_WIDTH, GAME_HEIGHT, 0x9ff0ff, 0.85);
    beam.setDepth(18);
    this.scene.physics.add.existing(beam);
    beam.body.setAllowGravity(false);
    this.beamGroup.add(beam);
    beam.isBeam = true;
    beam.dps = BULLET.LASER_DPS;
    beam.element = this.shipElement;
    beam.wielder = this;
    this.laserBeam = beam;
  }

  /** 切换武器（B/C 武器系统）。pulse / missile / laser / bomb */
  setWeapon(weapon) {
    const valid = ['pulse', 'missile', 'laser', 'bomb'];
    this.weapon = valid.includes(weapon) ? weapon : 'pulse';
    // 离开激光时收束光束
    if (this.weapon !== 'laser' && this.laserBeam && this.laserBeam.active) {
      this.laserBeam.setActive(false).setVisible(false);
      if (this.laserBeam.body) this.laserBeam.body.enable = false;
    }
  }

  /** 火力等级 -> 弹道布局（仅形态/颜色/贴图差异；数量与速度不变） */
  getFirePattern(level) {
    if (this.weapon === 'missile') {
      // 追踪导弹：随火力增加数量（1~4），居中发射，homing 由 GameScene 转向
      const n = 1 + Math.min(Math.floor(level / 2), 3);
      const arr = [];
      const spread = 16;
      for (let i = 0; i < n; i++) {
        const dx = (i - (n - 1) / 2) * spread;
        arr.push({ dx, vx: 0, bulletKey: 'bullet_missile' });
      }
      return arr;
    }
    if (this.weapon === 'bomb') {
      // B5 元素炸弹：随火力增加数量（1~3），居中向上抛
      const n = 1 + Math.min(Math.floor(level / 2), 2);
      const arr = [];
      const spread = 14;
      for (let i = 0; i < n; i++) {
        const dx = (i - (n - 1) / 2) * spread;
        arr.push({ dx, vx: 0, bulletKey: 'bullet_bomb' });
      }
      return arr;
    }
    const spread = 90; // 侧向速度（不改）
    const key = (dx) => (Math.abs(dx) <= 10 ? 'bullet_pulse' : 'bullet_scatter');
    switch (level) {
      // 火力 0~1：青色细长脉冲
      case 0: return [{ dx: 0, vx: 0, bulletKey: 'bullet_pulse' }];
      case 1: return [{ dx: -8, vx: 0, bulletKey: 'bullet_pulse' }, { dx: 8, vx: 0, bulletKey: 'bullet_pulse' }];
      // 火力 >=2：中路脉冲 + 两翼散射（数量与坐标保持不变）
      case 2: return [
        { dx: 0, vx: 0, bulletKey: 'bullet_pulse' },
        { dx: -12, vx: 0, bulletKey: key(-12) },
        { dx: 12, vx: 0, bulletKey: key(12) },
      ];
      case 3: return [
        { dx: -10, vx: 0, bulletKey: key(-10) },
        { dx: 10, vx: 0, bulletKey: key(10) },
        { dx: -16, vx: -spread, bulletKey: key(-16) },
        { dx: 16, vx: spread, bulletKey: key(16) },
      ];
      default: {
        // 4+：中路密集（脉冲）+ 两翼散射，数量保持不变
        const arr = [
          { dx: 0, vx: 0, bulletKey: 'bullet_pulse' },
          { dx: -10, vx: 0, bulletKey: 'bullet_pulse' },
          { dx: 10, vx: 0, bulletKey: 'bullet_pulse' },
        ];
        const wings = Math.min(level - 2, 4);
        for (let i = 1; i <= wings; i++) {
          arr.push({ dx: -14 - i * 3, vx: -spread * i * 0.5, bulletKey: 'bullet_scatter' });
          arr.push({ dx: 14 + i * 3, vx: spread * i * 0.5, bulletKey: 'bullet_scatter' });
        }
        return arr;
      }
    }
  }

  setFirepower(level) {
    this.firepower = Phaser.Math.Clamp(level, 0, 8);
    // 火力越高射速略快
    this.fireInterval = Math.max(70, PLAYER.FIRE_INTERVAL - this.firepower * 8);
  }

  takeDamage(n) {
    if (this.scene.time.now < this.invulnUntil) return;

    // 护盾优先吸收伤害，耗尽才扣 HP
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, n);
      this.shield -= absorbed;
      n -= absorbed;
    }

    if (n > 0) {
      this.hp = Math.max(0, this.hp - n);
    }
    this.invulnUntil = this.scene.time.now + PLAYER.RESPAWN_INVULN;
    EventBus.emit(EVENTS.HP_CHANGED, this.hp, this.maxHp);
    EventBus.emit(EVENTS.PLAYER_HIT, n);

    // 受击视觉反馈：有护盾时光罩，无护盾时红屏闪
    VFX.playerHitFlash(this.scene, this.shield > 0);

    VFX.shake(this.scene, 'medium');
    if (this.hp <= 0) {
      EventBus.emit(EVENTS.PLAYER_DIED);
      this.kill();
    }
  }

  getHitCircle() {
    return { x: this.x, y: this.y, r: PLAYER.HITBOX_RADIUS };
  }

  kill() {
    VFX.setEmitterActive(this.thruster, false);
    this.setActive(false).setVisible(false);
    if (this.body) this.body.enable = false;
    // 收束激光束
    if (this.laserBeam) {
      this.laserBeam.setActive(false).setVisible(false);
      if (this.laserBeam.body) this.laserBeam.body.enable = false;
    }
  }

  destroy(fromScene) {
    VFX.destroyEmitter(this.thruster);
    this.thruster = null;
    super.destroy(fromScene);
  }
}
