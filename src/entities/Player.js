import Phaser from 'phaser';
import { PLAYER, BULLET, GAME_WIDTH, GAME_HEIGHT, EVENTS, POWERUP, GRAZE, MODULES, FOCUS, TOUCH } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';
import { audio } from '../systems/AudioSystem.js';
import * as VFX from '../systems/VFX.js';

// 升级 -> 战斗属性换算（GameConfig 只读，这里集中定义每级增益）
const SHIELD_PER_LEVEL = 15;    // 每级护盾吸收池上限
const MAGNET_BASE_RADIUS = 90;  // 0 级基础金币吸取半径
const MAGNET_PER_LEVEL = 45;    // 每级额外增加的吸取半径

// 纯视觉层：reduced-motion 守卫（不影响任何玩法/数值）
const prefersReduced = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

    // 局内火力(P)拾取成长（P1）：独立于机库升级，拾取 +1 / 受击 -1，0~4
    this.powerLevel = 0;

    // P1 聚焦模式：按住 Shift（或移动端按钮）进入 —— 移速 ×0.45 / 射速 ×0.8（伤害 +20% 补偿）/
    // 判定点显式显示。局内临时状态，不入存档。
    this.focusing = false;
    // P1 超载射速：射速间隔倍率（1/1.3 ≈ 0.77 = 射速 ×1.3），与 overdrive 技能槽独立叠加
    this.overchargeFireMul = null;

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

    // P0 机库模块养成：读存档三槽模块，应用射速/HP/移速/擦弹环加成（并行系统，不影响既有 upgrades）
    this.moduleFireMul = 1;
    this.moduleHpBonus = 0;
    this.moduleSpeedMul = 1;
    this.moduleGrazeExtra = 0;
    this.applyModules((SaveManager.load().modules) || {});

    // P1 留存·深空爬塔局内临时增益（不入存档）：
    //   towerExtraShots 主炮并列弹 +N（fire() 消费）
    //   towerSpeedMul    移速倍率（×1.08^N，getMoveSpeed / 拖拽路径消费）
    //   towerGrazeExtra  擦弹环额外半径 +8N px（getGrazeCircle 消费）
    this.towerExtraShots = 0;
    this.towerSpeedMul = 1;
    this.towerGrazeExtra = 0;

    // A9 救济局局内临时增益（不入存档）：
    //   tempFireBonusUntil 复活临时火力 +1 截止时间戳（scene.time.now；fire() 消费，不写 powerLevel）
    //   reliefAtkMul       救济选项 B「攻击 +10%」倍率（_emitBullet / 激光 DPS 消费）
    this.tempFireBonusUntil = 0;
    this.reliefAtkMul = 1;
    // B11 连击蓄力·强化射击：临时伤害倍率（3s，GameScene useBurst 设置 / _updateBurst 到期恢复 1）
    this.burstAtkMul = 1;

    // 尾焰粒子（增强版）
    this.thruster = VFX.attachPlayerThruster(scene, this);

    // P1-6 可见判定点：半径=真实判定圈的小圆（斑鸠/虫姬同款），由存档 showHitbox 控制显隐
    this.hitboxDot = scene.add.circle(this.x, this.y, PLAYER.HITBOX_RADIUS, 0xff3344, 0.3)
      .setStrokeStyle(2, 0xff6677, 0.95).setDepth(22)
      .setVisible(SaveManager.load().showHitbox);

    // P2 擦弹环：判定圈外的半透明青环（半径 = 判定圈 + GRAZE.RING_EXTRA + 引擎模块擦弹环加成）。
    // 纯视觉调试层，与 hitboxDot 同步显隐；不参与任何碰撞/擦弹判定。
    this.grazeRing = scene.add.circle(this.x, this.y, this.getGrazeCircle().r, 0x33ffff, 0.10)
      .setStrokeStyle(1, 0x33ffff, 0.35).setDepth(21)
      .setVisible(SaveManager.load().showHitbox);
  }

  /**
   * P0 机库模块养成：读存档三槽模块应用加成。
   *   weapon → 射速间隔倍率（_recalcFireInterval 消费）
   *   armor  → 生命上限加成（GameScene 设 maxHp 时消费）
   *   engine → 移速倍率（getMoveSpeed / update 消费）+ 擦弹环额外半径（getGrazeCircle 消费）
   */
  applyModules(modules) {
    const m = modules || {};
    const weaponDef = MODULES[m.weapon];
    const armorDef = MODULES[m.armor];
    const engineDef = MODULES[m.engine];
    this.moduleFireMul = (weaponDef && weaponDef.fireIntervalMul) || 1;
    this.moduleHpBonus = (armorDef && armorDef.hpBonus) || 0;
    this.moduleSpeedMul = (engineDef && engineDef.speedMul) || 1;
    this.moduleGrazeExtra = (engineDef && engineDef.grazeExtra) || 0;
    this._recalcFireInterval();
    return this;
  }

  /** 模块加持后的最大移动速度（键盘路径用）；P1 聚焦模式下移速 ×0.45；爬塔增益叠加 */
  getMoveSpeed() {
    const base = Math.round(PLAYER.SPEED * (this.moduleSpeedMul || 1) * (this.towerSpeedMul || 1));
    if (this.focusing && FOCUS.SPEED_MUL) return Math.round(base * FOCUS.SPEED_MUL);
    return base;
  }

  /** 每帧：移动 + 开火 */
  update(time, dt, pointer, cursors) {
    // 移动：指针拖动优先，否则键盘
    if (pointer && pointer.isDown) {
      // P1 表现工程·触控偏移 + 灵敏度：
      //   touchOffset>0：战机跟随手指下方 offset px（避免手指遮挡机体，默认 36）；
      //   touchOffset=0：关闭，回退「手指上方 40px」旧手感。
      //   灵敏度 sensitivity（0.5~1.5）放大拖动插值系数，封顶 TOUCH.LERP_CAP。
      const sv = SaveManager.load();
      const tOff = (sv && sv.touchOffset != null) ? sv.touchOffset : TOUCH.OFFSET;
      const sens = (sv && sv.sensitivity) || 1;
      const tx = Phaser.Math.Clamp(pointer.worldX, 20, GAME_WIDTH - 20);
      const ty = Phaser.Math.Clamp(
        tOff > 0 ? pointer.worldY + tOff : pointer.worldY - 40,
        40, GAME_HEIGHT - 20
      );
      // 引擎模块移速加成 + P1 聚焦减速 + 灵敏度：同时作用于拖动插值系数（保守封顶，不破坏手感）
      const spdMul = this.focusing ? (FOCUS.SPEED_MUL || 1) : 1;
      const k = Math.min(
        TOUCH.LERP_BASE * sens * (this.moduleSpeedMul || 1) * (this.towerSpeedMul || 1) * spdMul,
        TOUCH.LERP_CAP
      );
      this.x = Phaser.Math.Linear(this.x, tx, k);
      this.y = Phaser.Math.Linear(this.y, ty, k);
    } else if (cursors) {
      const v = this.getMoveSpeed();
      let vx = 0, vy = 0;
      if (cursors.left.isDown) vx = -v;
      else if (cursors.right.isDown) vx = v;
      if (cursors.up.isDown) vy = -v;
      else if (cursors.down.isDown) vy = v;
      this.setVelocity(vx, vy);
    }

    // 自动开火（P1：实际射速 = fireInterval × 超载/聚焦倍率，见 getEffectiveFireInterval）
    if (time - this._lastFire >= this.getEffectiveFireInterval()) {
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
      // 辉光层跟随核心
      if (this.laserBeam._glow) {
        this.laserBeam._glow.x = this.x;
        this.laserBeam._glow.y = this.y - GAME_HEIGHT / 2;
        this.laserBeam._glow.visible = this.laserBeam.visible;
      }
    }

    // 无敌闪烁（reduced-motion 下保持常量不闪）
    if (time < this.invulnUntil) {
      this.setAlpha(prefersReduced ? 0.7 : (0.4 + 0.4 * Math.sin(time * 0.03)));
    } else {
      this.setAlpha(1);
    }

    // P1-6 判定点跟随玩家 + 显隐同步（每帧读内存存档缓存，开销可忽略）；
    // P1 聚焦模式下强制显式显示判定圈（复用 showHitbox 的判定圈，聚焦时更亮）
    const showDot = SaveManager.load().showHitbox || this.focusing;
    if (this.hitboxDot) {
      this.hitboxDot.setPosition(this.x, this.y).setVisible(showDot);
      this.hitboxDot.setAlpha(this.focusing ? 0.55 : 0.3);
    }
    // P2 擦弹环：与判定点同位置同显隐（reduced-motion 下本就静态，无额外动效）
    if (this.grazeRing) this.grazeRing.setPosition(this.x, this.y).setVisible(showDot);
    // 战机皮肤 aura 跟随 + alpha 呼吸（待机微动，纯视觉；reduced-motion 下常量）
    if (this.aura) {
      this.aura.setPosition(this.x, this.y);
      const a = prefersReduced ? 0.5 : (0.4 + 0.12 * Math.sin(time * 0.004));
      this.aura.setAlpha(a);
    }
  }

  /** 按火力等级发射多路子弹 */
  fire() {
    if (!this.active) return;

    // 激光（B4）：持续光束，fire 仅作脉冲触发声效，伤害由 GameScene overlap 持续结算
    if (this.weapon === 'laser') {
      this._ensureLaserBeam();
      audio.sfx('shootLaser');   // P1-4 射击分流：激光束 → 扫掠音色
      return;
    }

    audio.sfx('shootPulse');     // P1-4 射击分流：主炮（pulse/missile/bomb 统一走脉冲音色）
    const patterns = this.getFirePattern(this.firepower);
    for (const p of patterns) this._emitBullet(p);

    // 局内火力(P)：脉冲主炮每级追加 1 发并列弹（对称排列，不影响导弹/炸弹/激光弹道）
    if (this.weapon === 'pulse' && this.powerLevel > 0) {
      const spread = 16;
      for (let i = 0; i < this.powerLevel; i++) {
        const side = (i % 2 === 0) ? (i / 2 + 1) : -Math.ceil(i / 2);
        this._emitBullet({ dx: side * spread, vx: 0, bulletKey: 'bullet_pulse' });
      }
    }

    // P1 留存·深空爬塔：弹量 +N（主炮并列弹，走既有 _emitBullet 机制）
    if (this.weapon === 'pulse' && this.towerExtraShots > 0) {
      const spread = 16;
      for (let i = 0; i < this.towerExtraShots; i++) {
        const side = (i % 2 === 0) ? (i / 2 + 1) : -Math.ceil(i / 2);
        this._emitBullet({ dx: side * spread, vx: 0, bulletKey: 'bullet_pulse' });
      }
    }

    // A9 救济局复活福利：临时火力 +1 持续 2 秒（独立临时字段，不写 powerLevel，避免污染拾取/受击-1 链路）
    if (this.weapon === 'pulse' && this.scene && this.scene.time
      && this.scene.time.now < (this.tempFireBonusUntil || 0)) {
      this._emitBullet({ dx: 16, vx: 0, bulletKey: 'bullet_pulse' });
    }
  }

  /** 发射单发子弹（按 pattern 描述配置贴图/速度/伤害/body） */
  _emitBullet(p) {
    // P1 聚焦模式：伤害 +20% + 弹幕更集中（侧向速度 ×0.4，弹道收拢）
    // A9 救济选项 B：攻击 +10%（reliefAtkMul，局内临时；非救济恒 1，零回归）
    // B11 连击蓄力·强化射击：burstAtkMul 临时伤害 ×1.5（3s，非激活恒 1，零回归）
    const dmgMul = ((this.focusing && FOCUS.DMG_MUL) ? FOCUS.DMG_MUL : 1)
      * (this.reliefAtkMul || 1) * (this.burstAtkMul || 1);
    const focusSpread = this.focusing ? 0.4 : 1;
    // 中央脉冲弹按战斗机元素替换元素纹理 key（苍鹰 thunder→bullet_thunder 等）；
    // 其余弹型保持原 key。逻辑 key 不变，伤害/body/命中判定零改动。
    const baseKey = p.bulletKey || 'bullet_pulse';
    const ELEMENT_BOLT = { fire: 'bullet_fire', ice: 'bullet_ice', thunder: 'bullet_thunder' };
    const drawKey = (baseKey === 'bullet_pulse' && this.shipElement && ELEMENT_BOLT[this.shipElement])
      ? ELEMENT_BOLT[this.shipElement] : baseKey;
    const key = baseKey;
    const b = this.bullets.get(this.x + p.dx, this.y - 20, key);
    if (!b) return;
    // P1-2 池贴图不变量：复用的子弹可能残留旧贴图键，先统一成本次请求的贴图，
    // 用 drawKey（元素弹时与 key 不同）重设，再读 bw/bh 计算 body。
    if (b.texture && b.texture.key !== drawKey) b.setTexture(drawKey);
    b.setActive(true).setVisible(true);
    b.body.enable = true;
    b.homing = false;
    b.isBomb = false;
    b.element = this.shipElement;          // B6：子弹携带战斗机元素属性
    const bw = b.width, bh = b.height;
    if (key === 'bullet_missile') {
      b.damage = BULLET.MISSILE_DMG * dmgMul;
      b.homing = true;
      b.body.setSize(bw * 0.6, bh * 0.6);
      b.setVelocity((p.vx || 0) * focusSpread, -BULLET.MISSILE_SPEED);
    } else if (key === 'bullet_bomb') {
      // B5 元素炸弹：向上抛，命中/到达屏顶后 AOE 爆炸（逻辑在 GameScene）
      b.damage = BULLET.BOMB_DMG * dmgMul;
      b.isBomb = true;
      b.explodeRadius = BULLET.BOMB_RADIUS;
      b.element = this.shipElement;
      b.body.setSize(bw, bh);
      b.setVelocity((p.vx || 0) * focusSpread, -BULLET.BOMB_SPEED);
    } else {
      b.damage = BULLET.PLAYER_DMG * dmgMul;
      b.setVelocity(p.vx * focusSpread, -BULLET.PLAYER_SPEED);
      if (key === 'bullet_pulse') b.body.setSize(bw * 0.6, bh * 0.7);
      else b.body.setSize(bw * 0.7, bh * 0.7);
    }
    if (p.angle) b.setRotation(p.angle);
  }

  /** 确保激光束对象存在（首次使用 laser 武器时懒创建） */
  _ensureLaserBeam() {
    if (!this.beamGroup) return;
    if (this.laserBeam) return;
    // 主束双层：细白核(亮) + 宽柔青罩(ADD, 叠加在核之下)
    const core = this.scene.add.rectangle(this.x, this.y - GAME_HEIGHT / 2, BULLET.LASER_WIDTH, GAME_HEIGHT, 0xffffff, 0.9);
    core.setDepth(18);
    this.scene.physics.add.existing(core);
    core.body.setAllowGravity(false);
    this.beamGroup.add(core);
    core.isBeam = true;
    // A9 救济选项 B：攻击 +10% 同样作用于激光 DPS（非救济恒 1，零回归）
    // B11 连击蓄力·强化射击：burstAtkMul 同样作用于激光 DPS（非激活恒 1，零回归）
    core.dps = BULLET.LASER_DPS * (this.reliefAtkMul || 1) * (this.burstAtkMul || 1);
    core.element = this.shipElement;
    core.wielder = this;
    const glow = this.scene.add.rectangle(this.x, this.y - GAME_HEIGHT / 2, BULLET.LASER_WIDTH + 12, GAME_HEIGHT, 0x9ff0ff, 0.35)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(17);
    core._glow = glow;
    this.laserBeam = core;
    // 机首瞬时发射闪光（复用 particle 白 emitter 一次）
    if (VFX.laserMuzzleFlash) VFX.laserMuzzleFlash(this.scene, this.x, this.y - 24);
  }

  /** 切换武器（B/C 武器系统）。pulse / missile / laser / bomb */
  setWeapon(weapon) {
    const valid = ['pulse', 'missile', 'laser', 'bomb'];
    this.weapon = valid.includes(weapon) ? weapon : 'pulse';
    // 离开激光时收束光束
    if (this.weapon !== 'laser' && this.laserBeam && this.laserBeam.active) {
      this.laserBeam.setActive(false).setVisible(false);
      if (this.laserBeam.body) this.laserBeam.body.enable = false;
      if (this.laserBeam._glow) this.laserBeam._glow.setVisible(false);
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

  /**
   * 切换战机元素（元素核心道具轮换用）。TINT 为元素对应的 aura 染色；
   * 改 shipElement + aura 染色，返回最终元素（null = 无元素，恢复机体原色）。
   */
  setElement(el) {
    const TINT = { fire: 0xff7a3a, ice: 0x6fd6ff, thunder: 0xffe14a };
    this.shipElement = (el && TINT[el]) ? el : null;
    const tint = TINT[this.shipElement] || this.shipTint || 0xffffff;
    if (this.aura) this.aura.setTint(tint);
    return this.shipElement;
  }

  /** 战机皮肤发光aura：随所选机型 tint 生成柔光晕，强化三机辨识度（纯视觉） */
  setShipTint(tint) {
    this.shipTint = tint;
    if (!this.aura) {
      this.aura = this.scene.add.image(this.x, this.y, 'bg_nebula')
        .setScale(0.42).setTint(tint).setAlpha(0.5)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(19);
    } else {
      this.aura.setTint(tint);
    }
  }

  /**
   * P2 皮肤装饰：应用战机皮肤纹理（key=player_skin_{shipId}_{skinId}，原 player 纹理不动）。
   * 所有皮肤均为 48×54 同尺寸，physics body 不漂移；皮肤已自带配色，应用时清 tint 避免叠加染色。
   * 纹理不存在时安全降级（保持当前贴图，不破坏既有 tint 行为）。
   */
  applySkin(shipId, skinId) {
    const key = `player_skin_${Number(shipId) || 0}_${Number(skinId) || 0}`;
    if (this.scene && this.scene.textures && this.scene.textures.exists(key)) {
      if (this.texture.key !== key) this.setTexture(key);
      this.clearTint();
    }
    return this;
  }

  setFirepower(level) {
    this.firepower = Phaser.Math.Clamp(level, 0, 8);
    this._recalcFireInterval();
  }

  /** 局内火力(P)：0~4，拾取 +1 / 受击 -1，影响射速与并列弹数量 */
  setPowerLevel(level) {
    this.powerLevel = Phaser.Math.Clamp(level || 0, 0, POWERUP.MAX_LEVEL);
    this._recalcFireInterval();
    return this.powerLevel;
  }

  /** 射速 = 机库火力减免 + 局内火力(P)减免 + 武器模块倍率（叠加，下限 45ms 防失控） */
  _recalcFireInterval() {
    const base = Math.max(70, PLAYER.FIRE_INTERVAL - (this.firepower || 0) * 8);
    this.fireInterval = Math.max(55, base - (this.powerLevel || 0) * POWERUP.FIRE_RATE_GAIN);
    // P0 机库模块：武器模块射速倍率（×0.95/×0.88 = 更快）。无模块时 moduleFireMul=1，零 diff。
    if (this.moduleFireMul && this.moduleFireMul !== 1) {
      this.fireInterval = Math.max(45, Math.round(this.fireInterval * this.moduleFireMul));
    }
    // 过载（P2）：射速倍率作用在最终间隔上（0.5 = 翻倍），下限 45ms 防失控。
    // mul 为 null/1 时零 diff，与历史行为完全一致。
    if (this.fireMul && this.fireMul !== 1) {
      this.fireInterval = Math.max(45, Math.round(this.fireInterval * this.fireMul));
    }
  }

  /** 过载射速倍率：mul<1 表示更快（0.5=翻倍）；mul=1/null 恢复基础射速（零 diff） */
  setFireRateMul(mul) {
    this.fireMul = (mul && mul !== 1) ? mul : null;
    this._recalcFireInterval();
    return this.fireInterval;
  }

  /**
   * P1 聚焦模式：切换聚焦状态。
   * 效果（均在 getEffectiveFireInterval / getMoveSpeed / _emitBullet 生效）：
   *   移速 ×FOCUS.SPEED_MUL / 射速 ×FOCUS.FIRE_MUL（伤害 +DMG_MUL 补偿）/ 弹幕更集中 / 判定点显式显示。
   * 与 overdrive 技能槽、超载独立叠加。
   */
  setFocusing(f) {
    f = !!f;
    if (this.focusing === f) return;
    this.focusing = f;
  }

  /**
   * P1 超载射速倍率：mul 为"射速间隔倍率"（1/1.3 ≈ 0.77 = 射速 ×1.3）。
   * 仅影响 getEffectiveFireInterval，不改 fireInterval 属性（与 overdrive 槽独立，互不覆盖）。
   */
  setOverchargeMul(mul) {
    this.overchargeFireMul = (mul && mul !== 1) ? mul : null;
    return this.getEffectiveFireInterval();
  }

  /**
   * P1 实际开火间隔（ms）：fireInterval（基础/火力/模块/过载）再叠乘 超载 × 聚焦。
   * 保留 fireInterval 属性为既有机制（qa_p2 overdrive 断言 140→70 依赖其不变），
   * 超载/聚焦作为"有效射速"独立叠加，互不冲突。
   */
  getEffectiveFireInterval() {
    let v = this.fireInterval;
    if (this.overchargeFireMul && this.overchargeFireMul !== 1) v *= this.overchargeFireMul;
    if (this.focusing && FOCUS.FIRE_MUL) v *= (1 / FOCUS.FIRE_MUL);
    return Math.max(45, Math.round(v));
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
      // 先 kill 再 emit：命数复活（GameScene._onPlayerDied）可能在事件里原地复活玩家，
      // 若 emit 在 kill 之前，事件回调先 revive、随后 kill 又把玩家打回 inactive，导致复活失败。
      this.kill();
      EventBus.emit(EVENTS.PLAYER_DIED);
    }
  }

  getHitCircle() {
    return { x: this.x, y: this.y, r: PLAYER.HITBOX_RADIUS };
  }

  /** 擦弹环（P2）：判定圈外的擦弹判定半径（r = 判定圈 + RING_EXTRA + 引擎模块擦弹环加成 + 爬塔擦弹环加成） */
  getGrazeCircle() {
    return {
      x: this.x, y: this.y,
      r: PLAYER.HITBOX_RADIUS + GRAZE.RING_EXTRA + (this.moduleGrazeExtra || 0) + (this.towerGrazeExtra || 0),
    };
  }

  kill() {
    VFX.setEmitterActive(this.thruster, false);
    this.setActive(false).setVisible(false);
    if (this.body) this.body.enable = false;
    if (this.aura) this.aura.setVisible(false);
    // 收束激光束
    if (this.laserBeam) {
      this.laserBeam.setActive(false).setVisible(false);
      if (this.laserBeam.body) this.laserBeam.body.enable = false;
      if (this.laserBeam._glow) this.laserBeam._glow.setVisible(false);
    }
  }

  /** 原地复活（命数复活用）：恢复可见/碰撞/推进器/光环，回满血并设置无敌时长 */
  revive(x, y, invulnUntil) {
    this.setActive(true).setVisible(true);
    if (this.body) this.body.enable = true;
    this.setPosition(x, y);
    this.hp = this.maxHp;
    this.invulnUntil = invulnUntil;
    VFX.setEmitterActive(this.thruster, true);
    if (this.aura) this.aura.setVisible(true);
  }

  destroy(fromScene) {
    VFX.destroyEmitter(this.thruster);
    this.thruster = null;
    if (this.aura) { this.aura.destroy(); this.aura = null; }
    if (this.grazeRing) { this.grazeRing.destroy(); this.grazeRing = null; }
    super.destroy(fromScene);
  }
}
