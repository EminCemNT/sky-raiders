import Phaser from 'phaser';
import {
  SCENES, GAME_WIDTH, GAME_HEIGHT, EVENTS, COLORS, PLAYER, BULLET, LEVELS, BOSS_RUSH, SHIPS, ELEMENTS,
} from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';
import { createStarfield } from '../systems/Starfield.js';
import Player from '../entities/Player.js';
import Enemy from '../entities/Enemy.js';
import Boss from '../entities/Boss.js';
import Item from '../entities/Item.js';
import WaveSystem from '../systems/WaveSystem.js';
import { FloatingTextManager } from '../systems/FloatingText.js';
import { AchievementManager } from '../systems/AchievementManager.js';
import { audio } from '../systems/AudioSystem.js';
import * as VFX from '../systems/VFX.js';
import {
  ITEMS, ITEM_DROP_CHANCE, ITEM_DROP_WEIGHTS, BOSS_DROP_TABLE,
} from '../config/Items.js';
import { ENERGY_MAX, DEFAULT_SKILL, SKILLS } from '../config/Skills.js';

/**
 * GameScene：核心战斗场景。
 * ---------------------------------------------------------------------------
 * 负责：世界搭建、对象池、玩家、波次驱动、碰撞、金币、Boss、结算跳转。
 * HUD 交给并行的 UIScene（通过 EventBus 通信）。
 *
 * 团队协作边界：
 *   - 敌人/Boss 行为 -> entities/*.js
 *   - 生成节奏/关卡编排 -> systems/WaveSystem.js
 *   - 数值平衡 -> config/GameConfig.js
 *   - GameScene 只做"胶水"：把它们接起来，别把行为逻辑塞这里。
 */
export default class GameScene extends Phaser.Scene {
  constructor() {
    super(SCENES.GAME);
  }

  init(data) {
    this.mode = (data && data.mode) || 'normal'; // 'normal' | 'bossrush'
    this.levelId = data.levelId || 1;
    this.stats = { kills: 0, coins: 0, damageTaken: 0, spawned: 0 };
    this.score = 0;
    this.gameEnded = false;
    // 连击系统（P0）
    this.combo = 0;
    this._comboExpire = 0;
    // 成就统计
    this.maxCombo = 0;
    this.usedSuperCount = 0;
  }

  create() {
    // 当前关卡（色调 / 难度 / Boss 配置 / 波次表）
    this.level = LEVELS.find((l) => l.id === this.levelId) || LEVELS[0];
    const theme = this.level.theme;

    // 背景渐变（按关卡色调）
    const bg = this.add.graphics().setDepth(-200);
    bg.fillGradientStyle(theme.skyTop, theme.skyTop, theme.skyBottom, theme.skyBottom, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // 星空（按关卡色调染色）
    this.starfield = createStarfield(this, { layers: 4, starTints: theme.starTints, theme });

    // 对象池
    this.playerBullets = this.physics.add.group({ defaultKey: 'bullet_pulse', maxSize: 200 });
    this.enemyBullets = this.physics.add.group({ defaultKey: 'bullet_enemy', maxSize: 400 });
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: 60, runChildUpdate: false });
    this.coins = this.physics.add.group({ defaultKey: 'coin', maxSize: 120 });
    this.items = this.physics.add.group({ classType: Item, defaultKey: 'item_energy', maxSize: 60, runChildUpdate: false });

    // 激光束组（B4）：与 playerBullets 分离，避免被 killBullet 回收
    this.playerBeams = this.physics.add.group();

    // 预填敌人池
    for (let i = 0; i < 30; i++) {
      const e = new Enemy(this);
      this.enemies.add(e);
    }

    // 预填道具池
    for (let i = 0; i < 30; i++) {
      const it = new Item(this);
      this.items.add(it);
    }

    // 玩家（读存档火力等级）
    const save = SaveManager.load();
    this.player = new Player(this, GAME_WIDTH / 2, GAME_HEIGHT - 140, this.playerBullets);
    this.player.setFirepower(save.upgrades.firepower || 0);
    this.player.maxHp = PLAYER.MAX_HP + (save.upgrades.hull || 0) * 20;
    this.player.hp = this.player.maxHp;

    // C2 战机武器绑定：从机库所选战机读取默认武器 + 元素属性
    const shipIdx = (save.selectedShip != null) ? save.selectedShip : 0;
    const ship = (SHIPS && SHIPS[shipIdx]) ? SHIPS[shipIdx] : (SHIPS ? SHIPS[0] : null);
    if (ship) {
      this.player.defaultWeapon = ship.weapon || 'pulse';
      this.player.shipElement = ship.element || null;
      // Boss Rush 仍从脉冲起步，靠武器箱切换；普通关直接使用绑定武器
      const bound = this.mode === 'bossrush' ? 'pulse' : (ship.weapon || 'pulse');
      this.player.setWeapon(bound);
      if (ship.tint) this.player.setTint(ship.tint);
      // 0 = 常驻（绑定武器无倒计时）；delayedCall 确保 UIScene 已绑定监听
      if (bound !== 'pulse') this.time.delayedCall(0, () => EventBus.emit(EVENTS.WEAPON_CHANGED, bound, 0));
    }
    // 激光束注入（B4）
    this.player.beamGroup = this.playerBeams;

    // 道具/技能系统状态（#151）— 必须在首个 ENERGY_CHANGED 事件前初始化
    this.energy = 0;
    this.buffs = { shieldUntil: 0, magnetUntil: 0 };
    this.wingmen = [];

    // 输入
    this.cursors = this.input.keyboard.createCursorKeys();
    this.bombKey = this.input.keyboard.addKey('SPACE');

    // 波次系统（Boss Rush 模式不生成普通波次，改为纯 Boss 序列）
    this.bossRushIndex = 0;
    if (this.mode !== 'bossrush') {
      this.waves = new WaveSystem(this, this.levelId);
    }
    this.boss = null;

    // 碰撞
    this.setupColliders();

    // 事件
    this.bindEvents();
    audio.bindGameEvents();

    // 飘分（d-float）：场景内浮动得分文字
    this.floaters = new FloatingTextManager(this);

    // 子弹特效 emitter（reduced-motion 下返回 null，调用方判空降级）
    this.bulletTrail = VFX.bulletTrail(this);
    this.enemyGlow = VFX.enemyBulletGlow(this);

    // 并行启动 HUD
    this.scene.launch(SCENES.UI, {
      levelId: this.levelId,
      mode: this.mode,
      hp: this.player.hp, maxHp: this.player.maxHp,
      bombs: PLAYER.START_BOMBS,
    });

    // 初始 HUD 同步
    EventBus.emit(EVENTS.HP_CHANGED, this.player.hp, this.player.maxHp);
    EventBus.emit(EVENTS.SCORE_CHANGED, 0);
    EventBus.emit(EVENTS.ENERGY_CHANGED, this.energy, ENERGY_MAX);

    this.bombs = PLAYER.START_BOMBS;

    // 永久僚机：依据机库"僚机"升级等级生成（与道具临时僚机共用 wingmen 系统）
    for (let i = 0; i < (this.player.wingmanLevel || 0); i++) {
      this.addWingman();
    }

    // 首玩教程：首次进入游戏显示操作引导（Boss Rush 跳过，避免阻塞）
    if (this.mode !== 'bossrush' && !SaveManager.get('tutorialDone')) this.showTutorial();

    // Boss Rush：直接进入 Boss 序列
    if (this.mode === 'bossrush') this.startBossRush();

    // 调试钩子（供自动化真测驱动场景状态；不影响玩法）
    if (typeof window !== 'undefined') { window.__SKY = this; window.__GAME = this.game; }

    // 场景关闭时清理事件
    this.events.once('shutdown', () => this.cleanup());
  }

  setupColliders() {
    // 玩家子弹 vs 敌人
    this.physics.add.overlap(this.playerBullets, this.enemies, (bullet, enemy) => {
      if (!bullet.active || !enemy.active) return;
      // B5 元素炸弹：命中即 AOE 爆炸
      if (bullet.isBomb) {
        this._explodeBomb(bullet.x, bullet.y, bullet.explodeRadius, bullet.damage, bullet.element);
        this.killBullet(bullet);
        VFX.hitSpark(this, bullet.x, bullet.y);
        return;
      }
      this.killBullet(bullet);
      VFX.hitSpark(this, bullet.x, bullet.y);
      if (enemy.hit(bullet.damage || 10, bullet.element)) {
        this.registerKill(enemy.x, enemy.y);
        this.addEnergy(2);
      }
    });

    // 注：激光束对敌机的伤害走 checkBossHits 内的手动包围盒判定（B4），
    // 不依赖 physics.add.overlap（Rectangle 光束与 Sprite 的 overlap 在部分版本不触发）。

    // 玩家子弹 vs Boss（Boss 是单体，用动态检查）
    // 在 update 里手动处理，避免 group 依赖

    // 敌人 vs 玩家（撞机）
    this.physics.add.overlap(this.player, this.enemies, (player, enemy) => {
      if (!enemy.active || !player.active) return;
      enemy.hit(9999);
      this.playerHit(20);
    });

    // 敌弹 vs 玩家
    this.physics.add.overlap(this.player, this.enemyBullets, (player, bullet) => {
      if (!bullet.active || !player.active) return;
      this.killBullet(bullet);
      this.playerHit(10);
    });

    // 金币 vs 玩家
    this.physics.add.overlap(this.player, this.coins, (player, coin) => {
      if (!coin.active) return;
      this.collectCoin(coin);
    });

    // 道具 vs 玩家
    this.physics.add.overlap(this.player, this.items, (player, item) => {
      if (!item.active) return;
      this.collectItem(item);
    });
  }

  bindEvents() {
    this._onScore = (v) => { this.score += v; EventBus.emit('__hud_score', this.score); };
    EventBus.on(EVENTS.SCORE_CHANGED, this._onScore);

    this._onPlayerDied = () => this.endGame(false);
    EventBus.on(EVENTS.PLAYER_DIED, this._onPlayerDied);

    this._onBossDefeated = () => {
      if (this.boss && this.boss.active) {
        this.spawnBossDrops(this.boss.x, this.boss.y);
        EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.boss.x, y: this.boss.y, special: true, label: 'BOSS 击破' });
      }
      this.boss = null;
      if (this.mode === 'bossrush') {
        this.bossRushIndex++;
        if (this.bossRushIndex < BOSS_RUSH.length) {
          this.time.delayedCall(1200, () => this.spawnBossRush());
        } else {
          this.time.delayedCall(1200, () => this.endGame(true));
        }
      } else {
        this.time.delayedCall(1200, () => this.endGame(true));
      }
    };
    EventBus.on(EVENTS.BOSS_DEFEATED, this._onBossDefeated);

    this._onUseBomb = () => this.useBomb();
    EventBus.on(EVENTS.USE_BOMB, this._onUseBomb);

    this._onUseSuper = () => this.useSuper();
    EventBus.on(EVENTS.USE_SUPER, this._onUseSuper);
  }

  update(time, dt) {
    if (this.gameEnded) return;
    if (this.starfield) this.starfield.update(dt);

    // 玩家
    const pointer = this.input.activePointer;
    if (this.player.active) this.player.update(time, dt, pointer, this.cursors);

    // 敌人（手动 update 池）
    this.enemies.children.each((e) => {
      if (e.active) e.update(time, dt);
    });

    // Boss
    if (this.boss && this.boss.active) {
      this.boss.update(time, dt);
      this.checkBossHits();
    }
    // 激光束持续伤害（B4，独立于 Boss，每帧）
    this.checkBeamHits();

    // 波次
    if (this.waves) this.waves.update(time, dt);

    // 道具/僚机/磁力/增益计时
    this.items.children.each((it) => { if (it.active) it.update(time, dt); });
    this.updateWingmen(time, dt);
    this.updateMagnet();
    this.checkBuffs();
    if (this.combo > 0 && this.time.now > this._comboExpire) this.breakCombo();

    // 回收出屏子弹
    this.recycleBullets();

    // 追踪导弹转向（B3）：逐帧朝最近目标微调速度方向
    this.steerHomingBullets();
    // 敌弹追踪转向（C3）
    this.steerEnemyBullets();

    // 武器限时到期回退（B/C 武器系统）：回退到战机绑定默认武器
    if (this._weaponUntil && time > this._weaponUntil) {
      this._weaponUntil = 0;
      const def = this.player.defaultWeapon || 'pulse';
      this.player.setWeapon(def);
      EventBus.emit(EVENTS.WEAPON_CHANGED, def, 0);
    }

    // 子弹特效尾迹（节流每 2 帧；emitter 为 null 时降级，零运行时报错）
    if (this.bulletTrail || this.enemyGlow) {
      this._trailTick = (this._trailTick || 0) + 1;
      if (this._trailTick % 2 === 0) {
        if (this.bulletTrail) {
          this.playerBullets.children.each((b) => {
            if (b.active) this.bulletTrail.emitParticleAt(b.x, b.y + b.height * 0.4);
          });
        }
        if (this.enemyGlow) {
          this.enemyBullets.children.each((b) => {
            if (b.active) this.enemyGlow.emitParticleAt(b.x, b.y);
          });
        }
      }
    }

    // 键盘炸弹
    if (Phaser.Input.Keyboard.JustDown(this.bombKey)) this.useBomb();
  }

  /** 激光束持续 DPS（B4）：每帧对列内敌机/Boss 结算，手动包围盒判定 */
  checkBeamHits() {
    if (!this.playerBeams || !this.playerBeams.children || this.playerBeams.children.size === 0) return;
    const dt = this.game.loop.delta / 1000;
    this.playerBeams.children.each((beam) => {
      if (!beam.active) return;
      this.enemies.children.each((e) => {
        if (!e.active) return;
        if (Phaser.Geom.Intersects.RectangleToRectangle(beam.getBounds(), e.getBounds())) {
          if (e.hit((beam.dps || 0) * dt, beam.element)) {
            this.registerKill(e.x, e.y);
            this.addEnergy(2);
          }
        }
      });
      if (this.boss && this.boss.active &&
          Phaser.Geom.Intersects.RectangleToRectangle(beam.getBounds(), this.boss.getBounds())) {
        this.boss.hit((beam.dps || 0) * dt, beam.element);
        this._beamFxTick = (this._beamFxTick || 0) + dt;
        if (this._beamFxTick > 0.1) { VFX.hitSpark(this, this.boss.x, this.boss.y, beam.element || 'ice'); this._beamFxTick = 0; }
      }
    });
  }

  /** 玩家子弹 vs Boss 手动检测 */
  checkBossHits() {
    this.playerBullets.children.each((b) => {
      if (!b.active) return;
      if (this.boss && this.boss.active &&
          Phaser.Geom.Intersects.RectangleToRectangle(b.getBounds(), this.boss.getBounds())) {
        if (b.isBomb) {
          this._explodeBomb(b.x, b.y, b.explodeRadius, b.damage, b.element);
          this.killBullet(b);
          VFX.hitSpark(this, b.x, b.y);
          return;
        }
        this.killBullet(b);
        VFX.hitSpark(this, b.x, b.y);
        this.boss.hit(b.damage || 10, b.element);
      }
    });
  }

  /** B5 元素炸弹 AOE：对半径内所有敌机/Boss 造成伤害并施加元素状态 */
  _explodeBomb(x, y, radius, dmg, element) {
    if (radius == null) radius = BULLET.BOMB_RADIUS;
    const r2 = radius * radius;
    this.enemies.children.each((e) => {
      if (!e.active) return;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= r2) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = 1 - 0.5 * (dist / radius);   // 中心高、边缘低
        if (e.hit(dmg * falloff, element)) this.registerKill(e.x, e.y);
      }
    });
    if (this.boss && this.boss.active) {
      const dx = this.boss.x - x, dy = this.boss.y - y;
      if (dx * dx + dy * dy <= r2) this.boss.hit(dmg * 0.6, element);
    }
    const color = element && ELEMENTS[element] ? ELEMENTS[element].color : 0xff7a3a;
    VFX.explosion(this, x, y, color, 2);
    this.cameras.main.shake(180, 0.012);
  }

  /** C3 敌弹追踪转向（tracking 弹，逐帧朝玩家微调） */
  steerEnemyBullets() {
    if (!this.enemyBullets) return;
    const p = this.player;
    if (!p || !p.active) return;
    const turn = BULLET.ENEMY_BULLET_TRACK_TURN || 0.045;
    this.enemyBullets.children.each((b) => {
      if (!b.active || !b.eHoming) return;
      const desired = Phaser.Math.Angle.Between(b.x, b.y, p.x, p.y);
      const cur = Math.atan2(b.body.velocity.y, b.body.velocity.x);
      const next = Phaser.Math.Angle.RotateTo(cur, desired, turn);
      const speed = b.body.velocity.length() || BULLET.ENEMY_SPEED;
      b.body.velocity.set(Math.cos(next) * speed, Math.sin(next) * speed);
    });
  }

  // ---- 供其他模块回调的工厂方法（WaveSystem/Enemy 依赖）----
  spawnEnemy(x, y, typeKey, moveMode, difficulty = 1, firePattern = 'straight') {
    const e = this.enemies.get();
    if (!e) return null;
    e.spawn(x, y, typeKey, moveMode, difficulty, firePattern);
    this.stats.spawned++;
    return e;
  }

  /** 找最近的可攻击目标（敌机优先，否则 Boss）。无则返回 null */
  findNearestTarget(x, y) {
    let best = null; let bestD = Infinity;
    this.enemies.children.each((e) => {
      if (!e.active) return;
      const d = Phaser.Math.Distance.Squared(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    });
    if (best) return best;
    if (this.boss && this.boss.active) return this.boss;
    return null;
  }

  /** 追踪导弹逐帧转向（B3） */
  steerHomingBullets() {
    this.playerBullets.children.each((b) => {
      if (!b.active || !b.homing) return;
      const t = this.findNearestTarget(b.x, b.y);
      if (!t) return;
      const desired = Phaser.Math.Angle.Between(b.x, b.y, t.x, t.y);
      const cur = Math.atan2(b.body.velocity.y, b.body.velocity.x);
      const maxTurn = 0.07; // 每帧最大转角（弧度）
      let diff = Phaser.Math.Angle.Wrap(desired - cur);
      diff = Phaser.Math.Clamp(diff, -maxTurn, maxTurn);
      const speed = b.body.velocity.length() || BULLET.MISSILE_SPEED;
      const na = cur + diff;
      b.body.velocity.x = Math.cos(na) * speed;
      b.body.velocity.y = Math.sin(na) * speed;
      b.setRotation(na + Math.PI / 2);
    });
  }

  spawnBoss(bossKey, overrides) {
    const base = (this.level && this.level.boss) || {};
    const cfg = Object.assign({}, base, overrides || {});
    this.boss = new Boss(this, bossKey, {
      ...cfg,
      difficulty: (overrides && overrides.difficulty) || (this.level && this.level.difficulty) || 1,
    });
  }

  // ---- Boss Rush 模式：连打 BOSS_RUSH 序列，血量随轮次递增 ----
  startBossRush() {
    this.bossRushIndex = 0;
    this.spawnBossRush();
  }

  spawnBossRush() {
    const seq = BOSS_RUSH[this.bossRushIndex];
    if (!seq) { this.endGame(true); return; }
    this.spawnBoss(seq.bossKey, {
      name: seq.name, color: seq.color, pattern: seq.pattern,
      maxHp: Math.round(seq.maxHp * seq.hpMult), difficulty: 1.2,
    });
    EventBus.emit(EVENTS.BOSS_SPAWNED, {
      key: seq.bossKey,
      name: `BOSS RUSH ${this.bossRushIndex + 1}/${BOSS_RUSH.length} · ${seq.name}`,
      color: seq.color,
    });
  }

  spawnCoin(x, y) {
    const c = this.coins.get(x, y, 'coin');
    if (!c) return;
    c.setActive(true).setVisible(true);
    c.body.enable = true;
    c.setVelocity(Phaser.Math.Between(-30, 30), 120);
    c.setDepth(12);
  }

  collectCoin(coin) {
    coin.setActive(false).setVisible(false);
    coin.body.enable = false;
    this.stats.coins++;
    SaveManager.addCoins(1);
    EventBus.emit(EVENTS.COIN_COLLECTED, this.stats.coins);
    EventBus.emit(EVENTS.SCORE_CHANGED, 20);
    EventBus.emit(EVENTS.FLOAT_SCORE, { x: coin.x, y: coin.y, amount: 20, special: true });
  }

  // ---- 道具掉落（#151）----
  /** 工厂：从池中取一个道具实体 */
  spawnItem(x, y, itemKey) {
    const it = this.items.get();
    if (!it) return;
    it.spawn(x, y, itemKey);
  }

  /** 普通敌人死亡时按概率掉落非金币道具 */
  maybeDropItem(x, y) {
    if (Math.random() > ITEM_DROP_CHANCE) return;
    const key = this.rollWeighted(ITEM_DROP_WEIGHTS);
    if (key) this.spawnItem(x, y, key);
  }

  /** Boss 必掉：按 BOSS_DROP_TABLE 撒一圈高价值道具 */
  spawnBossDrops(x, y) {
    BOSS_DROP_TABLE.forEach((key, i) => {
      const ox = x + (i - (BOSS_DROP_TABLE.length - 1) / 2) * 46;
      const oy = y + Phaser.Math.Between(-20, 20);
      this.spawnItem(
        Phaser.Math.Clamp(ox, 30, GAME_WIDTH - 30),
        Phaser.Math.Clamp(oy, 30, GAME_HEIGHT - 200),
        key,
      );
    });
  }

  /** 按权重对象抽一个 key */
  rollWeighted(weights) {
    const entries = Object.entries(weights);
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = Math.random() * total;
    for (const [k, w] of entries) {
      if ((r -= w) <= 0) return k;
    }
    return entries.length ? entries[0][0] : null;
  }

  /** 拾取道具：按 kind 应用效果 */
  collectItem(item) {
    if (!item.active) return;
    const key = item.itemKey;
    const def = ITEMS[key];
    if (def) {
      switch (def.kind) {
        case 'buff':
          this.applyBuff(key, def);
          break;
        case 'resource':
          this.addEnergy(def.amount || 0);
          break;
        case 'instant':
          if (key === 'heal') this.healPlayer(def.amount || 0);
          else if (key === 'bomb') this.addBomb();
          break;
        case 'permanent':
          if (key === 'wingman') this.addWingman();
          break;
        case 'weapon':
          if (this.player.setWeapon) this.player.setWeapon(def.weapon);
          this._weaponUntil = this.time.now + (def.duration || 15000);
          EventBus.emit(EVENTS.WEAPON_CHANGED, def.weapon, def.duration || 15000);
          break;
      }
      EventBus.emit(EVENTS.POWERUP_COLLECTED, def.label);
      this.flashPickup(item.x, item.y, def.label);
    }
    item.recycle();
  }

  /** 临时增益（护盾/磁力）计时 */
  applyBuff(key, def) {
    const until = this.time.now + (def.duration || 5000);
    if (key === 'shield') {
      this.buffs.shieldUntil = until;
      EventBus.emit(EVENTS.SHIELD_CHANGED, true, until);
    } else if (key === 'magnet') {
      this.buffs.magnetUntil = until;
      EventBus.emit(EVENTS.MAGNET_CHANGED, true, until);
    }
  }

  /** 每帧检查增益到期 */
  checkBuffs() {
    const now = this.time.now;
    if (this.buffs.shieldUntil && now > this.buffs.shieldUntil) {
      this.buffs.shieldUntil = 0;
      EventBus.emit(EVENTS.SHIELD_CHANGED, false, 0);
    }
    if (this.buffs.magnetUntil && now > this.buffs.magnetUntil) {
      this.buffs.magnetUntil = 0;
      EventBus.emit(EVENTS.MAGNET_CHANGED, false, 0);
    }
  }

  healPlayer(amount) {
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
    EventBus.emit(EVENTS.HP_CHANGED, this.player.hp, this.player.maxHp);
  }

  addBomb() {
    this.bombs++;
    EventBus.emit('__hud_bombs', this.bombs);
  }

  addEnergy(amount) {
    this.energy = Phaser.Math.Clamp((this.energy || 0) + amount, 0, ENERGY_MAX);
    EventBus.emit(EVENTS.ENERGY_CHANGED, this.energy, ENERGY_MAX);
  }

  // ---- 连击系统（P0 体验优化）----
  /** 击杀累计连击，按倍率加分并广播给 HUD */
  registerKill(x, y) {
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    const mult = this.comboMultiplier();
    this.stats.kills++;
    const amount = Math.round(10 * mult);
    EventBus.emit(EVENTS.SCORE_CHANGED, amount);
    EventBus.emit(EVENTS.COMBO_CHANGED, this.combo, mult);
    EventBus.emit(EVENTS.FLOAT_SCORE, { x, y, amount, mult, special: false });
    this._comboExpire = this.time.now + 2500; // 2.5s 内无击杀则断连
  }

  comboMultiplier() {
    // 每 5 连 +0.5 倍，最高 5x
    return 1 + Math.min(Math.floor(this.combo / 5) * 0.5, 4);
  }

  breakCombo() {
    if (this.combo > 0) EventBus.emit(EVENTS.COMBO_CHANGED, 0, 1);
    this.combo = 0;
  }

  // ---- 僚机（跟随开火，独立于 Player 升级）----
  addWingman() {
    if (!this.wingmen) this.wingmen = [];
    const wm = this.add.image(this.player.x, this.player.y + 10, 'item_wingman')
      .setDepth(18).setScale(0.9);
    wm._last = 0;
    this.wingmen.push(wm);
  }

  updateWingmen(time, dt) {
    if (!this.wingmen || !this.wingmen.length) return;
    this.wingmen = this.wingmen.filter((w) => w.active);
    this.wingmen.forEach((w, i) => {
      if (!this.player.active) return;
      const side = i % 2 === 0 ? -1 : 1;
      const tx = this.player.x + side * 48;
      const ty = this.player.y + 14;
      w.x = Phaser.Math.Linear(w.x, tx, 0.15);
      w.y = Phaser.Math.Linear(w.y, ty, 0.15);
      if (time - w._last > 220) {
        // 独立瞄准：锁定最近敌机 / Boss，而非纯镜像直上
        const target = this.findNearestTarget(w.x, w.y);
        const ang = target
          ? Phaser.Math.Angle.Between(w.x, w.y, target.x, target.y)
          : -Math.PI / 2;
        const b = this.playerBullets.get(w.x, w.y - 12, 'bullet_pulse');
        if (b) {
          b.setActive(true).setVisible(true);
          b.body.enable = true;
          b.homing = false;
          b.damage = BULLET.PLAYER_DMG;
          const bw = b.width, bh = b.height;
          b.body.setSize(bw * 0.6, bh * 0.7);
          this.physics.velocityFromRotation(ang, BULLET.PLAYER_SPEED, b.body.velocity);
        }
        w._last = time;
      }
    });
  }

  // ---- 磁力：扩大金币吸取范围 ----
  updateMagnet() {
    if (this.time.now >= (this.buffs.magnetUntil || 0)) return;
    const range = 230;
    this.coins.children.each((c) => {
      if (!c.active) return;
      const d = Phaser.Math.Distance.Between(c.x, c.y, this.player.x, this.player.y);
      if (d < range) {
        const ang = Phaser.Math.Angle.Between(c.x, c.y, this.player.x, this.player.y);
        c.body.velocity.x = Math.cos(ang) * 420;
        c.body.velocity.y = Math.sin(ang) * 420;
        if (d < 28) this.collectCoin(c);
      }
    });
  }

  flashPickup(x, y, label) {
    const t = this.add.text(x, y, label, {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#7cf3ff', fontStyle: '700',
    }).setOrigin(0.5).setDepth(40);
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 600,
      onComplete: () => t.destroy(),
    });
  }


  playerHit(dmg) {
    // 护盾激活时吸收全部伤害
    if (this.time.now < (this.buffs.shieldUntil || 0)) return;
    this.stats.damageTaken += dmg;
    this.player.takeDamage(dmg);
    this.breakCombo(); // 受击断连
  }

  useBomb() {
    if (this.bombs <= 0 || this.gameEnded) return;
    this.bombs--;
    EventBus.emit('__hud_bombs', this.bombs);

    // 清屏冲击波
    this.cameras.main.flash(300, 120, 200, 255);
    this.cameras.main.shake(300, 0.015);
    VFX.bombShockwave(this, this.player.x, this.player.y);

    // 清所有敌弹
    this.enemyBullets.children.each((b) => {
      if (b.active) this.killBullet(b);
    });

    // 秒杀所有小怪（Boss 只受固定伤害，避免章节跳跃式秒杀问题）
    this.enemies.children.each((e) => {
      if (e.active) { e.hit(9999); this.registerKill(e.x, e.y); }
    });
    if (this.boss && this.boss.active) this.boss.hit(300);
  }

  /** 主动技能：星风暴（#151）。消耗全部能量，清屏敌弹 + 重创全场 + 重创 Boss */
  useSuper() {
    if (this.gameEnded) return;
    if ((this.energy || 0) < ENERGY_MAX) return;

    this.energy = 0;
    this.usedSuperCount++;
    EventBus.emit(EVENTS.ENERGY_CHANGED, 0, ENERGY_MAX);

    const skill = SKILLS[DEFAULT_SKILL] || SKILLS.starstorm;
    // 强视觉：闪光 + 震屏
    this.cameras.main.flash(450, 180, 230, 255);
    this.cameras.main.shake(450, 0.03);

    // 清屏敌弹
    this.enemyBullets.children.each((b) => { if (b.active) this.killBullet(b); });

    // 重创所有敌机
    this.enemies.children.each((e) => {
      if (e.active && e.hit(300)) this.registerKill(e.x, e.y);
    });

    // 对 Boss 造成大额伤害
    if (this.boss && this.boss.active) this.boss.hit(1500);

    this.spawnStarstormVisual();
    EventBus.emit(EVENTS.SCORE_CHANGED, 50);
    EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.player.x, y: this.player.y - 44, amount: 50, special: true });
  }

  /** 星风暴视觉：多发星弹横扫 + 粒子爆发 */
  spawnStarstormVisual() {
    const p = this.add.particles(this.player.x, this.player.y, 'particle', {
      speed: { min: 200, max: 520 },
      lifespan: 700,
      scale: { start: 2.4, end: 0 },
      quantity: 40,
      tint: [0xb98bff, 0x7cf3ff, 0xffffff],
      angle: { min: 200, max: 340 },
    });
    p.setDepth(60);
    this.time.delayedCall(750, () => p.destroy());

    for (let i = 0; i < 18; i++) {
      this.time.delayedCall(i * 22, () => {
        const sx = Phaser.Math.Between(40, GAME_WIDTH - 40);
        const star = this.add.image(sx, GAME_HEIGHT + 20, 'item_energy')
          .setDepth(59).setScale(1.6);
        this.tweens.add({
          targets: star, y: -40, duration: 520, ease: 'Cubic.in',
          onComplete: () => star.destroy(),
        });
      });
    }
  }

  // ---- 清理工具 ----
  killBullet(b) {
    b.setActive(false).setVisible(false);
    if (b.body) { b.body.enable = false; b.setVelocity(0, 0); }
  }

  recycleBullets() {
    this.playerBullets.children.each((b) => {
      if (b.active && b.y < -30) {
        if (b.isBomb) this._explodeBomb(b.x, b.y, b.explodeRadius, b.damage, b.element);
        this.killBullet(b);
      }
    });
    this.enemyBullets.children.each((b) => {
      if (b.active && (b.y > GAME_HEIGHT + 30 || b.y < -30 || b.x < -30 || b.x > GAME_WIDTH + 30)) {
        this.killBullet(b);
      }
    });
    this.coins.children.each((c) => {
      if (c.active && c.y > GAME_HEIGHT + 30) {
        c.setActive(false).setVisible(false);
        c.body.enable = false;
      }
    });
  }

  endGame(victory) {
    if (this.gameEnded) return;
    this.gameEnded = true;

    // 结算星级
    const spawned = Math.max(1, this.stats.spawned);
    const killRatio = this.stats.kills / spawned;
    const noDamage = this.stats.damageTaken === 0 ? 1 : Math.max(0, 1 - this.stats.damageTaken / 200);
    const coinScore = Math.min(1, this.stats.coins / 30);
    const composite = killRatio * 0.5 + coinScore * 0.3 + noDamage * 0.2;
    let stars = 0;
    if (composite >= 0.9) stars = 3;
    else if (composite >= 0.7) stars = 2;
    else if (composite >= 0.4) stars = 1;
    if (!victory) stars = Math.min(stars, 1);

    if (victory && this.mode !== 'bossrush') SaveManager.recordLevelStars(this.levelId, stars);

    const result = {
      victory, stars, score: this.score,
      kills: this.stats.kills, coins: this.stats.coins,
      levelId: this.levelId, composite,
    };

    // 成就评估（#成就）：用本局数据评估并解锁新成就，挂到结算结果上
    const ctx = {
      kills: this.stats.kills,
      coins: this.stats.coins,
      damageTaken: this.stats.damageTaken,
      levelId: this.levelId,
      victory,
      maxCombo: this.maxCombo,
      usedSuper: this.usedSuperCount,
      maxLevel: LEVELS.length,
    };
    result.newAchievements = AchievementManager.evaluate(ctx);

    this.time.delayedCall(600, () => {
      this.scene.stop(SCENES.UI);
      this.scene.start(SCENES.RESULT, result);
    });
  }

  // ---- 首玩教程（#教程）：首次进入游戏分步引导，暂停世界避免被击杀 ----
  showTutorial() {
    this.physics.pause();
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(600);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setOrigin(0);
    const panel = this.add.rectangle(cx, cy, 440, 220, 0x0d2236, 0.98)
      .setStrokeStyle(2, COLORS.accent);
    const steps = [
      '移动战机：拖动屏幕，或用方向键 / WASD',
      '自动开火：无需操作，子弹持续射出',
      '技能：能量满按【空格】放星风暴，炸弹清屏',
    ];
    let i = 0;
    const txt = this.add.text(cx, cy - 36, steps[0], {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#cfe8ff', align: 'center',
      wordWrap: { width: 380 },
    }).setOrigin(0.5);
    const dots = this.add.text(cx, cy + 18, '● ○ ○', {
      fontFamily: 'sans-serif', fontSize: '16px', color: COLORS.accent,
    }).setOrigin(0.5);
    const nextBtn = this.add.text(cx + 110, cy + 70, '下一步', {
      fontFamily: 'sans-serif', fontSize: '20px', fontStyle: '700', color: '#7cf3ff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const skipBtn = this.add.text(cx - 110, cy + 70, '跳过', {
      fontFamily: 'sans-serif', fontSize: '20px', fontStyle: '700', color: '#88bbdd',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const render = () => {
      txt.setText(steps[i]);
      let d = '';
      for (let k = 0; k < steps.length; k++) d += (k === i ? '● ' : '○ ');
      dots.setText(d.trim());
      nextBtn.setText(i < steps.length - 1 ? '下一步' : '开始游戏');
    };
    const finish = () => {
      SaveManager.set('tutorialDone', true);
      this.physics.resume();
      ov.destroy();
    };
    nextBtn.on('pointerdown', () => {
      if (i < steps.length - 1) { i++; render(); } else finish();
    });
    skipBtn.on('pointerdown', finish);
    this.input.keyboard.once('keydown-ESC', finish); // 兜底：ESC 也能关闭教程，避免卡死
    ov.add([dim, panel, txt, dots, nextBtn, skipBtn]);
    render();
  }

  cleanup() {
    EventBus.off(EVENTS.SCORE_CHANGED, this._onScore);
    EventBus.off(EVENTS.PLAYER_DIED, this._onPlayerDied);
    EventBus.off(EVENTS.BOSS_DEFEATED, this._onBossDefeated);
    EventBus.off(EVENTS.USE_BOMB, this._onUseBomb);
    EventBus.off(EVENTS.USE_SUPER, this._onUseSuper);
    audio.unbindGameEvents();
    if (this.starfield) this.starfield.destroy();
  }
}
