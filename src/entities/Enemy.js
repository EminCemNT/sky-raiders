import Phaser from 'phaser';
import { BULLET, GAME_HEIGHT, GAME_WIDTH, EVENTS, ELEMENTS, ELITE, EASE, IDLE_AURA } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { audio } from '../systems/AudioSystem.js';
import * as VFX from '../systems/VFX.js';
import { damageNumber } from '../systems/FloatingText.js';
import { t as localeT } from '../config/Locale.js';

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
  // P1 战斗扩展·新敌型（append-only）：
  //   turret   地面炮台（固定底部两侧，发 aimed 弹，HP 中）
  //   kamikaze 自爆机（高速冲玩家，靠近自爆 AoE）
  //   summoner 召唤机（定期召唤 small）
  //   shield   护盾机（正面护盾挡玩家弹，从侧/后打才掉血；弹幕慢）
  turret:   { tex: 'enemy_turret',   hp: 70, score: 350, coin: 0.5, speed: 0,   fireRate: 1600, color: 0xffaa3a, defaultMode: 'turret' },
  kamikaze: { tex: 'enemy_kamikaze', hp: 30, score: 250, coin: 0.3, speed: 270, fireRate: 0,    color: 0xff5a3c, defaultMode: 'kamikaze' },
  summoner: { tex: 'enemy_summoner', hp: 90, score: 450, coin: 0.6, speed: 70,  fireRate: 0,    color: 0x9a6fd6, defaultMode: 'straight' },
  shield:   { tex: 'enemy_shield',   hp: 55, score: 300, coin: 0.5, speed: 85,  fireRate: 1800, color: 0x4ad1ff, defaultMode: 'straight' },
  // OPT-13 B14 元素免疫敌人（困难/地狱档）：immune 默认免疫元素数组；
  // 实例可用 spawn 第 10 参 immune 覆盖（WaveSystem comp 透传）。纹理复用 enemy_mid，免疫标记用金色字。
  elemental: { tex: 'enemy_mid', hp: 90, score: 120, coin: 0.4, speed: 90, fireRate: 1500, color: 0xffd24a, immune: ['fire'] },
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
    // P0 战机专属被动系数（默认 1 = 无加成；applyElement 时按 scene.shipPassive 写入）
    this._dotMul = 1;
    this._slowMul = 1;
    // 元素连锁反应（二段反应）冷却截止时刻
    this._reactUntil = 0;
    // B14 元素免疫：免疫元素数组（null=普通敌人）+ 免疫标记文字
    this._immune = null;
    this._immuneLabel = null;
    // OPT-15 V4：待机能量环呼吸句柄（对象池复用须 recycle 清理，防监听泄漏）
    this._idleAura = null;
  }

  getColor() {
    return this.def.color;
  }

  /** 从池中激活一个敌人。difficulty 为关卡难度系数；hpMul/speedMul 为难度档系数（P0 四档，默认 1）；
   *  elite（A6/B10）：精英 mini-boss 标记——血量 ×ELITE.hpMul、射速 ×1.5、发光描边 + 放大约 1.2 倍；
   *  immune（B14）：元素免疫标记（'fire'|'ice'|'thunder'，缺省取型号默认 immune 数组） */
  spawn(x, y, typeKey = 'small', moveMode = 'straight', difficulty = 1, firePattern = 'straight', hpMul = 1, speedMul = 1, elite = false, immune = null) {
    const t = TYPES[typeKey] || TYPES.small;
    this.typeKey = typeKey;
    this.def = t;
    this.difficulty = difficulty;
    this.isElite = !!elite;
    // B14 元素免疫：实例免疫（wavePlan comp 透传）缺省取型号默认；普通敌人 null。
    // 兼容字符串（'fire'）与数组（['fire']）两种入参，统一归一化为数组（免疫标签 .map 依赖数组形态）
    let instImmune = immune;
    if (typeof instImmune === 'string') instImmune = [instImmune];
    this._immune = (instImmune && instImmune.length ? instImmune : null)
      || (t.immune && t.immune.length ? t.immune : null) || null;
    this.setTexture(t.tex);
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.body.enable = true;
    // 难度：关卡系数（HP 线性、速度略增）再乘难度档系数（标准档全 1.0 = 现状）；精英再 ×ELITE.hpMul
    this.hp = Math.round(t.hp * difficulty * hpMul * (this.isElite ? ELITE.hpMul : 1));
    this.maxHp = this.hp;
    // A6 精英射速：沿用既有 firePattern，射速 ×1.5（间隔 ×0.67）；非精英走 def.fireRate（零回归）
    this._fireRateEff = this.isElite && t.fireRate > 0 ? Math.max(280, Math.round(t.fireRate * 0.67)) : null;
    // P1 新敌型默认移动模式：显式传 'straight'/缺省时回退到型号默认（仅限新类型，diver 等旧行为零改动）
    if (t.defaultMode && (typeKey === 'turret' || typeKey === 'kamikaze' || typeKey === 'summoner' || typeKey === 'shield')
      && (!moveMode || moveMode === 'straight')) {
      moveMode = t.defaultMode;
    }
    this.moveMode = moveMode;
    this.firePattern = firePattern || 'straight';
    // P1 护盾机：正面护盾标志 + 盾宽（GameScene overlap 吸收玩家弹用）
    this.hasFrontShield = typeKey === 'shield';
    this.shieldWidth = 26;
    this._t = 0;
    this._baseX = x;
    this._lastFire = this.scene.time.now;
    this._baseVy = t.speed * (1 + (difficulty - 1) * 0.4) * speedMul;
    this.setVelocity(0, this._baseVy);
    // 重置元素状态（B6）
    this._elem = null;
    this._slowUntil = 0;
    this._stunUntil = 0;
    this._dotUntil = 0;
    this._dotTick = 0;
    this._dotMul = 1;   // P0 战机被动系数复位（防对象池复用残留）
    this._slowMul = 1;
    this._reactUntil = 0;   // 元素连锁反应冷却复位
    this._summonAt = 0;     // P1 召唤机定时复位
    this._sweeping = false;  // A5 激光扫射递归标志复位（防对象池复用残留）
    this._sweepWarn = null; this._sweepBeam = null; this._sweepGlow = null;
    this.clearTint();
    // A6 精英外观：发光描边（复用 VFX.glowTarget，质量档自动降级）+ 放大约 1.2 倍
    if (this.isElite) {
      this.setScale(1.2, 1.2);
      if (!this._eliteGlow || !this._eliteGlow.active) {
        this._eliteGlow = VFX.glowTarget(this, ELITE.tint, { radius: 1.4, alpha: 0.4, depth: 1 });
      }
    } else {
      this.setScale(1, 1);
    }

    // OPT-15 V4：普通敌机待机能量环呼吸（精英已有 _eliteGlow 不再叠；kamikaze 高速冲脸无待机态不加；
    // reduced/low 由 VFX.idleAura 内部短路 / qualityScale 门槛短路）。防御性清理防对象池复用残留。
    if (this._idleAura) { this._idleAura.stop(); this._idleAura = null; }
    if (!this.isElite && !PREFERS_REDUCED && (this.scene.qualityScale || 1) >= IDLE_AURA.minQuality
        && this.typeKey !== 'kamikaze') {
      this._idleAura = VFX.idleAura(this, this.getColor(), IDLE_AURA.enemy);
    }

    // B14 免疫标记展示（纯视觉静态文字，reduced-motion 无动画）：如「免疫火 / Immune: Fire」
    if (this._immune && this._immune.length) {
      const label = this._immune
        .map((k) => localeT('immune' + k.charAt(0).toUpperCase() + k.slice(1)))
        .join('/');
      if (!this._immuneLabel || !this._immuneLabel.active) {
        this._immuneLabel = this.scene.add.text(this.x, this.y - 28, label, {
          fontFamily: 'sans-serif', fontSize: '10px', fontStyle: '800', color: '#ffd24a',
        }).setOrigin(0.5).setDepth(16);
      } else {
        this._immuneLabel.setText(label).setPosition(this.x, this.y - 28);
      }
    } else if (this._immuneLabel) {
      if (this._immuneLabel.active) this._immuneLabel.destroy();
      this._immuneLabel = null;
    }

    // P1 地面炮台无尾焰（固定底座，不喷气）
    if (this.typeKey === 'turret') {
      if (this.thruster) VFX.setEmitterActive(this.thruster, false);
    } else {
      if (!this.thruster) {
        this.thruster = VFX.attachEnemyThruster(this.scene, this, this.getColor());
      } else {
        VFX.setEmitterActive(this.thruster, true);
      }
    }
    return this;
  }

  update(time, dt) {
    if (!this.active || this._dying) return;

    // B14 免疫标记跟随（纯视觉；无标记零开销）
    if (this._immuneLabel && this._immuneLabel.active) {
      this._immuneLabel.setPosition(this.x, this.y - 28);
    }

    // B6 火元素 DoT（灼烧）
    if (time < this._dotUntil) {
      const dps = (ELEMENTS.fire && ELEMENTS.fire.dot) || 10;
      // P0 战机被动：赤焰灼烧伤害 ×1.25（_dotMul 默认 1 = 无加成）
      this.hp -= dps * (this._dotMul || 1) * dt / 1000;
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

    // B6 冰元素减速：放大时间步 + 速度。P0 战机被动：寒霜减速强度 ×0.8（因子更小 = 减速更强）
    const slow = (time < this._slowUntil)
      ? (((ELEMENTS.ice && ELEMENTS.ice.slow) || 0.5) * (this._slowMul || 1)) : 1;
    this._t += dt * slow;

    // 移动模式（P1 特殊敌型优先；其余走 moveMode 既有分支）
    if (this.typeKey === 'kamikaze') {
      this._updateKamikaze(time, dt);
    } else if (this.typeKey === 'turret') {
      // 地面炮台：固定不动（出生即定位在底部两侧）
      this.setVelocity(0, 0);
    } else {
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
    }

    // P1 召唤机：定期召唤 small（数据驱动，复用 scene.spawnEnemy）
    if (this.typeKey === 'summoner') this._updateSummoner(time);

    // 敌人开火（仅 fireRate>0 型号：mid / turret / shield；A6 精英用 _fireRateEff 提速 ×1.5）
    const fireRate = this._fireRateEff != null ? this._fireRateEff : this.def.fireRate;
    if (fireRate > 0 && time - this._lastFire > fireRate) {
      this.fireAtPlayer();
      this._lastFire = time;
    }

    // 出屏回收
    if (this.y > GAME_HEIGHT + 60 || this.x < -80 || this.x > GAME_WIDTH + 80) {
      this.recycle();
    }
  }

  /** P1 自爆机：高速冲向玩家，靠近自爆 AoE */
  _updateKamikaze(time, dt) {
    const p = this.scene.player;
    if (!p || !p.active) { this.setVelocity(0, this._baseVy); return; }
    const slow = (time < this._slowUntil)
      ? (((ELEMENTS.ice && ELEMENTS.ice.slow) || 0.5) * (this._slowMul || 1)) : 1;
    const spd = (this.def.speed || 270) * (1 + (this.difficulty - 1) * 0.4)
      * (this.scene.difficultyCfg ? this.scene.difficultyCfg.speedMul : 1) * slow;
    const ang = Phaser.Math.Angle.Between(this.x, this.y, p.x, p.y);
    this.scene.physics.velocityFromRotation(ang, spd, this.body.velocity);
    // 靠近玩家自爆 AoE（先于撞机 overlap 触发的半径，避免双重受击）
    const d2 = Phaser.Math.Distance.Squared(this.x, this.y, p.x, p.y);
    if (d2 < 60 * 60) this._kamikazeBoom();
  }

  /** P1 自爆演出：AoE 伤害玩家 + 自身消失（不计击杀得分，纯进攻型敌机） */
  _kamikazeBoom() {
    const scene = this.scene;
    if (scene.playerHit) scene.playerHit(25);
    if (scene.requestHitStop) scene.requestHitStop(90);
    VFX.explosionLayered(scene, this.x, this.y, this.getColor(), { scale: 1.2, tier: 'mid' });
    this._dying = true;
    this.recycle();
  }

  /** P1 召唤机：每 ~2.2s 在身前召唤一只 small（继承当前难度） */
  _updateSummoner(time) {
    if (!this._summonAt) this._summonAt = time + 1500;
    if (time < this._summonAt) return;
    this._summonAt = time + 2200;
    this.scene.spawnEnemy(
      Phaser.Math.Clamp(this.x + Phaser.Math.Between(-24, 24), 30, GAME_WIDTH - 30),
      this.y + 34,
      'small', 'straight', this.difficulty,
    );
  }

  fireAtPlayer() {
    const scene = this.scene;
    const player = scene.player;
    if (!player || !player.active || !scene.enemyBullets) return;
    const aim = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    // A8 弹速风暴变异：敌弹速度 ×1.2^N（非塔模式恒 1，零回归）
    const spd = BULLET.ENEMY_SPEED * (this.difficulty || 1)
      * (scene._mutationMul ? scene._mutationMul().bulletSpeed : 1);

    const spawnBullet = (ang, homing = false) => {
      const b = scene.enemyBullets.get(this.x, this.y + 16, 'bullet_enemy');
      if (!b) return;
      b.setActive(true).setVisible(true);
      b.body.enable = true;
      b.eHoming = homing;                    // C3：tracking 弹由 GameScene 转向
      b.setVelocity(0, 0);
      scene.physics.velocityFromRotation(ang, spd, b.body.velocity);
      if (scene.enemyTrail) scene.enemyTrail.emitParticleAt(b.x, b.y);   // 敌弹拖尾视觉一行
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
      // ── P1 战斗扩展·新弹幕（append-only）──
      case 'aimed':    // 瞄准弹：朝玩家当前方向单发（turret 炮台用）
        spawnBullet(aim);
        break;
      case 'ring': {   // 环弹：n 发圆周（缓缓自转）
        const n = 10;
        this._bulletAng = (this._bulletAng || 0) + 0.25;
        for (let i = 0; i < n; i++) spawnBullet((Math.PI * 2 / n) * i + this._bulletAng);
        break;
      }
      case 'wall':     // 墙弹：横向一排向下直落
        this._fireWall();
        break;
      case 'laserSweep':  // 激光扫射（蓄力 → 扫射 beam）
        this._laserSweep();
        break;
      case 'spiral': { // 螺旋弹：角度持续递增
        const arms = 2, per = 2;
        this._bulletAng = (this._bulletAng || 0) + 0.32;
        for (let a = 0; a < arms; a++) {
          const base = this._bulletAng + Math.PI * a;
          for (let i = 0; i < per; i++) spawnBullet(base + i * 0.14);
        }
        break;
      }
      case 'petal': {  // 花瓣弹：多臂对称
        const arms = 3;
        this._bulletAng = (this._bulletAng || 0) + 0.26;
        for (let a = 0; a < arms; a++) {
          const base = this._bulletAng + (Math.PI * 2 / arms) * a;
          spawnBullet(base + 0.16);
          spawnBullet(base - 0.16);
        }
        break;
      }
      default:         // straight：朝玩家直射
        spawnBullet(aim);
        break;
    }
  }

  /** P1 墙弹：横向一排向下直落（复用 enemyBullets 池） */
  _fireWall() {
    const scene = this.scene;
    if (!scene.enemyBullets) return;
    const n = 7;
    const gap = GAME_WIDTH / (n + 1);
    // A8 弹速风暴变异：墙弹速度同样 ×1.2^N（非塔模式恒 1）
    const spd = BULLET.ENEMY_SPEED * (this.difficulty || 1) * 0.85
      * (scene._mutationMul ? scene._mutationMul().bulletSpeed : 1);
    for (let i = 1; i <= n; i++) {
      const b = scene.enemyBullets.get(gap * i, this.y + 16, 'bullet_enemy');
      if (!b) continue;
      b.setActive(true).setVisible(true);
      b.body.enable = true;
      b.eHoming = false;
      b.setVelocity(0, 0);
      b.body.velocity.set(0, spd);
      if (scene.enemyTrail) scene.enemyTrail.emitParticleAt(b.x, b.y);
    }
  }

  /** A5 取消/清理激光扫射链：复位递归标志并销毁残留视觉（recycle/die/spawn 时调用） */
  _cancelSweep() {
    this._sweeping = false;
    [this._sweepWarn, this._sweepBeam, this._sweepGlow].forEach((o) => {
      if (o && o.active) o.destroy();
    });
    this._sweepWarn = null; this._sweepBeam = null; this._sweepGlow = null;
  }

  /** P1 激光扫射：短暂蓄力警示 → 扫射 beam（视觉复用矩形光柱，命中判定点相交单次受击） */
  _laserSweep() {
    const scene = this.scene;
    if (!this.active || this._sweeping) return;   // A5：敌人已回收/死亡或扫射进行中则中止
    this._sweeping = true;
    const sx = this.x, sy = this.y + 16;
    const warn = scene.add.circle(sx, sy, 18, 0xff4455, 0.22)
      .setStrokeStyle(2, 0xff4455, 0.8).setDepth(16);
    this._sweepWarn = warn;
    if (PREFERS_REDUCED) {
      warn.setAlpha(0.5);
    } else {
      const spin = () => {
        if (!warn.active || !this.active || !this._sweeping) return;
        warn.setScale(1 + 0.3 * Math.sin(scene.time.now * 0.02));
        scene.time.delayedCall(40, spin);
      };
      spin();
    }
    scene.time.delayedCall(420, () => {
      if (warn.active) warn.destroy();
      this._sweepWarn = null;
      if (!this.active || !this._sweeping) return;   // A5：蓄力期间被回收/死亡则不再出 beam
      const beam = scene.add.rectangle(sx, sy, 10, 260, 0xff5a3c, 0.5)
        .setOrigin(0.5, 0).setDepth(16);
      const glow = scene.add.rectangle(sx, sy, 18, 260, 0xffa07a, 0.22)
        .setOrigin(0.5, 0).setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
      beam._isSweep = true;
      this._sweepBeam = beam; this._sweepGlow = glow;
      if (PREFERS_REDUCED) {
        beam.setRotation(-0.4);
        scene.time.delayedCall(160, () => {
          if (beam.active) beam.destroy();
          if (glow.active) glow.destroy();
          this._sweepBeam = this._sweepGlow = null;
          this._sweeping = false;
        });
        return;
      }
      const dur = 720;
      const t0 = scene.time.now;
      const tick = () => {
        if (!beam.active) return;
        if (!this.active || !this._sweeping) {   // A5：递归取消——敌人回收/死亡立即停链
          if (beam.active) beam.destroy();
          if (glow.active) glow.destroy();
          this._sweepBeam = this._sweepGlow = null;
          return;
        }
        const p = (scene.time.now - t0) / dur;
        if (p >= 1) {
          if (beam.active) beam.destroy();
          if (glow.active) glow.destroy();
          this._sweepBeam = this._sweepGlow = null;
          this._sweeping = false;   // 扫射自然结束，允许下一次
          return;
        }
        const ang = Phaser.Math.DegToRad(-60 + 120 * p);
        beam.setRotation(ang);
        glow.setRotation(ang);
        // 命中判定：beam 线段与玩家判定圈相交 → 单次受击（玩家无敌帧天然防连击）
        if (scene.player && scene.player.active) {
          const hc = scene.player.getHitCircle();
          const tipX = sx + Math.sin(ang) * 260;
          const tipY = sy + Math.cos(ang) * 260;
          if (!beam._hitDone && _distToSegment(hc.x, hc.y, sx, sy, tipX, tipY) < hc.r + 6) {
            beam._hitDone = true;
            scene.playerHit(10);
          }
        }
        scene.time.delayedCall(16, tick);
      };
      tick();
    });
  }

  /** B14 元素免疫判定：免疫敌人对该元素伤害免疫（0 伤害）；普通敌人恒 false */
  isImmuneTo(el) {
    return !!(el && this._immune && this._immune.indexOf(el) >= 0);
  }

  /** 受伤，返回是否死亡 */
  hit(dmg, element) {
    if (this._dying) return false;            // 死亡演出进行中，忽略后续命中（防对象池复用前的重复结算）
    // B14 元素免疫：免疫元素命中 → 伤害归 0、不附加该元素状态（反应链也不触发，
    // 因为免疫元素状态从未挂上，_elem !== element，onHit 天然 return false）。
    if (element && this.isImmuneTo(element)) {
      this._flinch();
      return false;
    }
    // 元素连锁反应（二段反应）：在 applyElement 之前触发（此时 _elem 仍是上次命中残留的元素）。
    // 不读写 combo、不进 overlap 回调，由 ElementReaction 纯逻辑判同元素 + 冷却后派发。
    if (element && this.scene.elementReaction) this.scene.elementReaction.onHit(this, element, this.scene.time.now);
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
      duration: 70, yoyo: true, ease: EASE.feedback,
      onComplete: () => { this.setScale(1, 1); this.angle = 0; this._flinchTween = null; },
    });
  }

  /** 附加元素状态（B6）：火=灼烧 / 冰=减速 / 雷=麻痹。P0 战机被动在系数处乘 selectedShip.passive */
  applyElement(key) {
    if (!key || !ELEMENTS[key]) return;
    // B14 元素免疫：免疫元素状态不附加（0 DoT / 0 状态 / 无染色）——非免疫元素照常生效
    if (this.isImmuneTo(key)) return;
    const now = this.scene.time.now;
    const cfg = ELEMENTS[key];
    // P0 战机专属被动：由 GameScene.create 从 selectedShip 写入 scene.shipPassive（无则空对象 = 零加成）
    const passive = (this.scene && this.scene.shipPassive) || {};
    this._elem = key;
    if (key === 'fire') {
      this._dotUntil = now + (cfg.duration || 3000);
      // 赤焰：灼烧伤害 +25%
      this._dotMul = (passive.element === 'fire' && passive.dotMul) || 1;
    } else if (key === 'ice') {
      this._slowUntil = now + (cfg.duration || 3000);
      // 寒霜：减速强度 +20%（slowMul<1 = 敌人更慢）
      this._slowMul = (passive.element === 'ice' && passive.slowMul) || 1;
    } else if (key === 'thunder') {
      // 苍鹰：雷麻痹强度 +15%（现机制命中必定身，乘在定身时长上）
      this._stunUntil = now + ((cfg.stun || 1100) * ((passive.element === 'thunder' && passive.stunMul) || 1));
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

  /**
   * 反应伤害结算（元素连锁反应专用）：不触发二次反应、不飘字。
   * 区别于 hit()：无受击音/闪白/flinch，仅施加元素状态 + 扣血 + 致死判定。
   * @param {number} dmg 伤害
   * @param {?string} element 要附加的元素状态（fire/ice/thunder/null）
   * @returns {boolean} 是否致死
   */
  applyReaction(dmg, element) {
    if (this._dying) return false;
    // B14 元素免疫：免疫元素反应伤害归 0（且不附加免疫元素状态）——非元素伤害（如风暴）穿透免疫
    if (element && this.isImmuneTo(element)) return false;
    if (element) this.applyElement(element);
    this.hp -= dmg;
    if (this.hp <= 0) { this.die(); return true; }
    return false;
  }

  die() {
    if (this._dying) return;
    this._dying = true;
    this._cancelSweep();  // A5：死亡即取消激光扫射递归链，避免死亡演出期间幽灵扫射
    // P0-2 爆炸三阶段分级：mid 用中档、small/diver 用小型（Boss 用 explosionBoss 在 Boss.die）
    audio.sfx(this.typeKey === 'mid' ? 'explosionMid' : 'explosionSmall');
    // A6 精英：得分 ×ELITE.scoreMul（走正常 registerKill 击杀语义，不是 Boss）；必掉 BOSS_DROP_TABLE
    EventBus.emit(EVENTS.SCORE_CHANGED, Math.round(this.def.score * (this.isElite ? ELITE.scoreMul : 1)));
    if (this.isElite && this.scene.spawnEliteDrops) {
      this.scene.spawnEliteDrops(this.x, this.y, this.typeKey);
    }
    // 掉金币
    if (Math.random() < this.def.coin && this.scene.spawnCoin) {
      this.scene.spawnCoin(this.x, this.y);
    }
    // 增强爆炸（P3 五层：闪光→冲击波→粒子→残骸→烟尘；mid 层数减半）
    VFX.explosionLayered(this.scene, this.x, this.y, this.getColor(), {
      scale: this.typeKey === 'mid' ? 1.3 : 1,
      tier: this.typeKey === 'mid' ? 'mid' : 'small',
    });
    if (this.scene.maybeDropItem) this.scene.maybeDropItem(this.x, this.y);
    // 局内火力(P)掉落（P1）：独立于普通道具的概率掉落
    if (this.scene.maybeDropPower) this.scene.maybeDropPower(this.x, this.y);
    // 死亡演出（P1-7）：先停用碰撞体避免死敌仍挡子弹/被重复 overlap，再短命中定格 + 弹性缩放消失
    if (this.body) this.body.enable = false;
    if (this.scene.requestHitStop) this.scene.requestHitStop(60);
    if (PREFERS_REDUCED) { this.recycle(); return; }
    this.scene.tweens.add({
      targets: this, scaleX: 1.28, scaleY: 1.28, duration: 90, ease: EASE.pop,
      onComplete: () => {
        this.scene.tweens.add({
          targets: this, scaleX: 0, scaleY: 0, duration: 150, ease: EASE.exit,
          onComplete: () => this.recycle(),
        });
      },
    });
  }

  recycle() {
    this._cancelSweep();  // A5：先取消激光扫射递归链再回收，杜绝幽灵 tick 污染下一个复用实例
    VFX.setEmitterActive(this.thruster, false);
    this.setActive(false).setVisible(false);
    if (this.body) { this.body.enable = false; this.setVelocity(0, 0); }
    this._dying = false; this.setScale(1, 1); this.angle = 0;  // P1-7 复位死亡演出状态，保障对象池复用
    this.hasFrontShield = false;  // P1 护盾机复位，防对象池复用残留
    // A4 池复用复位契约：回收即清元素染色/状态残留（spawn() 仍会重写，这里双重保险防复用污染）
    this._elem = null;
    this.clearTint();
    // B14 免疫复位契约：免疫标记与标签清理，防对象池复用污染
    this._immune = null;
    if (this._immuneLabel) {
      if (this._immuneLabel.active) this._immuneLabel.destroy();
      this._immuneLabel = null;
    }
    // A6 精英复位契约：isElite / _fireRateEff / _eliteGlow 全部清理，防对象池复用污染
    this.isElite = false;
    this._fireRateEff = null;
    if (this._eliteGlow) {
      if (this._eliteGlow.active) this._eliteGlow.destroy();
      this._eliteGlow = null;
    }
    // OPT-15 V4：待机光环回收清理（stop 解绑 update 监听 + kill tween + destroy glow），防监听泄漏
    if (this._idleAura) {
      this._idleAura.stop();
      this._idleAura = null;
    }
  }

  destroy(fromScene) {
    VFX.destroyEmitter(this.thruster);
    this.thruster = null;
    super.destroy(fromScene);
  }
}

/** P1 激光扫射命中辅助：点到线段最近距离（beam 扫掠判定用） */
function _distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  const ox = px - cx, oy = py - cy;
  return Math.sqrt(ox * ox + oy * oy);
}
