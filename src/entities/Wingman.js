import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, WINGMAN, EVENTS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';

/**
 * 僚机实体（僚机 AI 进阶 第一/二版）
 * ---------------------------------------------------------------------------
 * 职责边界：只负责"单机行为" —— 编队插值跟随、排斥力场躲避偏移、开火节奏，
 * 以及 HP / 受击 / 死亡 / 重生（第二版起 GameScene 接 enemyBullets overlap，僚机可被击落）。
 *
 * 明确不做的事（一律由 WingmanSystem 注入）：
 *   - 不直接读 scene.enemies / scene.enemyBullets（避免每机一次全组扫描）
 *   - 不读存档、不决定数量、不决定槽位、不决定角色
 *
 * update(dt, ctx) 的 ctx 契约（由 WingmanSystem 每帧构造一份共享快照）：
 *   { px, py, playerActive, target, elementTarget, threats[], recomputeDodge, time }
 *
 * WingmanState 字段：slot / offset / formation / role / hp / maxHp / invulnUntil /
 *                    weaponLv / element / alive / respawnAt / fireCd / dodgeVec
 *
 * 第二版战术分工：role 由 System 按 ROLE_BY_COUNT 注入，只影响
 *   射速倍率 fireMul / 瞄准偏好 aim / 编队偏移缩放 offMul —— 弹种与伤害基数不受影响。
 */
export default class Wingman extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'item_wingman');
    scene.add.existing(this);
    scene.physics.add.existing(this);   // 必须有 body（第二版接受击 overlap 时直接可用）

    this.setDepth(WINGMAN.DEPTH).setScale(WINGMAN.SCALE);
    if (this.body) {
      this.body.setAllowGravity(false);
      this.body.setSize(this.width * 0.7, this.height * 0.7);
    }

    // ---- WingmanState ----
    this.slot = 0;
    this.offset = { x: 0, y: 0 };
    this.formation = 'fan';           // 'diamond' | 'fan'
    this.role = WINGMAN.ROLE;         // 由 WingmanSystem._assignRoles 注入，构造期先兜底
    this._roleCfg = WINGMAN.ROLES[this.role] || WINGMAN.ROLES.suppress;
    this.maxHp = WINGMAN.BASE_HP;
    this.hp = this.maxHp;
    this.invulnUntil = 0;             // 重生无敌截止时刻（scene.time.now 时基）
    this.weaponLv = 0;
    this.element = null;              // 继承 player.shipElement
    this.alive = true;
    this.respawnAt = 0;
    this.fireCd = 0;                  // dt 累加（ms）
    this.dodgeVec = { x: 0, y: 0 };
  }

  /** 由 WingmanSystem 分配编队槽位 */
  setSlot(index, offset, formation) {
    this.slot = index;
    if (offset) { this.offset.x = offset.x; this.offset.y = offset.y; }
    if (formation) this.formation = formation;
    return this;
  }

  /**
   * 由 WingmanSystem 注入战术角色（第二版）。
   * 只缓存配置，不改弹种/伤害 —— role 影响面严格限定在 fireMul / aim / offMul。
   */
  setRole(role) {
    const cfg = WINGMAN.ROLES[role];
    this.role = cfg ? role : WINGMAN.ROLE;
    this._roleCfg = cfg || WINGMAN.ROLES[WINGMAN.ROLE] || WINGMAN.ROLES.suppress;
    return this;
  }

  /** 由 WingmanSystem 注入武器等级（存档 upgrades.wingmanFirepower） */
  setWeaponLv(lv) {
    const max = WINGMAN.WEAPON_LV.length - 1;
    this.weaponLv = Phaser.Math.Clamp(lv || 0, 0, max);
    return this;
  }

  /** 由 WingmanSystem 注入玩家元素（成就 element_* 统计依赖它写进子弹） */
  setElement(el) {
    this.element = el || null;
    return this;
  }

  /** 每帧：编队跟随（含躲避偏移） + 开火节奏 */
  update(dt, ctx) {
    if (!this.active || !this.alive || !ctx || !ctx.playerActive) return;

    // 1) 躲避向量：每 CHECK_EVERY 帧才重算一次，其余帧沿用（配合 0.15 插值不会突变）
    if (ctx.recomputeDodge) this._computeDodge(ctx.threats);

    // 2) 目标点 = 玩家位置 + 编队槽位 * 角色偏移缩放 * 编队权重 + 躲避向量 * 躲避权重
    //    offMul 只在这里参与运算：this.offset 保持 FORMATIONS 原始槽位值（唯一事实来源）
    const D = WINGMAN.DODGE;
    const om = (this._roleCfg && this._roleCfg.offMul) || { x: 1, y: 1 };
    let tx = ctx.px + this.offset.x * om.x * D.FORM_WEIGHT + this.dodgeVec.x * D.WEIGHT;
    let ty = ctx.py + this.offset.y * om.y * D.FORM_WEIGHT + this.dodgeVec.y * D.WEIGHT;

    // 3) 缰绳：横向不脱离玩家 ±屏宽1/3，且整体不出屏
    tx = Phaser.Math.Clamp(tx, ctx.px - WINGMAN.X_LEASH, ctx.px + WINGMAN.X_LEASH);
    tx = Phaser.Math.Clamp(tx, 18, GAME_WIDTH - 18);
    ty = Phaser.Math.Clamp(ty, 40, GAME_HEIGHT - 20);

    // 4) 平滑插值跟随（不用物理速度，避免与玩家本体推挤/抖动）
    this.x = Phaser.Math.Linear(this.x, tx, WINGMAN.FOLLOW_LERP);
    this.y = Phaser.Math.Linear(this.y, ty, WINGMAN.FOLLOW_LERP);

    // 5) 开火。角色射速：interval / fireMul（fireMul>1 = 更快，与"射速倍率"语义一致）
    const cfg = WINGMAN.WEAPON_LV[this.weaponLv] || WINGMAN.WEAPON_LV[0];
    this.fireCd += dt;
    if (this.fireCd >= this.getFireInterval()) {
      this.fireCd = 0;
      this._fire(this._pickTarget(ctx), cfg);
    }
  }

  /** 当前实际开火间隔（ms）：档位 interval 经角色 fireMul 缩放 */
  getFireInterval() {
    const cfg = WINGMAN.WEAPON_LV[this.weaponLv] || WINGMAN.WEAPON_LV[0];
    const mul = (this._roleCfg && this._roleCfg.fireMul) || 1;
    return cfg.interval / mul;
  }

  /**
   * 按角色瞄准偏好选目标：
   *   'nearest' → 共享快照里的最近目标（System 每帧只算一次）
   *   'element' → 优先打已挂同元素状态的敌人（support 补刀促成元素协同 combo），
   *               没有则退回最近目标 —— 绝不因为选不到目标就哑火。
   */
  _pickTarget(ctx) {
    // 第三版③集火指令：锁定的焦点目标绝对优先（压过角色瞄准偏好），集火期内所有僚机打同一个
    if (ctx && ctx.focusTarget && ctx.focusTarget.active) return ctx.focusTarget;
    const aim = (this._roleCfg && this._roleCfg.aim) || 'nearest';
    if (aim === 'element' && ctx.elementTarget && ctx.elementTarget.active) return ctx.elementTarget;
    return ctx.target;
  }

  /**
   * 躲避向量（僚机 AI 进阶 第三版②：反应式排斥 + 预测式侧步）：
   *   1) 反应式（保留原逻辑）：只躲"当前在上方正压过来"的敌弹，合成逃逸向量。
   *   2) 预测式（新增）：对带速度的敌弹做弹道预判，算最近接近时刻(TCA)与最近接
   *      近距离；若会在 PREDICT_LOOKAHEAD 内逼近到 PREDICT_RADIUS 内，则沿"垂直于
   *      弹道、且朝僚机当前所在一侧"的方向侧步避让 —— 主动让开弹道，而非等弹贴脸
   *      才反应。静止弹/已远离/不会擦到的弹直接跳过，交给反应式处理。
   * 两部分加权求和后统一封顶到 MAX_OFFSET，自身再做 SMOOTH 平滑防抖。
   * 全程平方距 / 向量运算不开方（仅预测式侧步归一化用一次 sqrt，量级极小）。
   */
  _computeDodge(threats) {
    const D = WINGMAN.DODGE;
    let ax = 0, ay = 0, n = 0;

    // 1) 反应式排斥（原实现，保持不变）
    if (threats && threats.length) {
      const r2 = D.RADIUS * D.RADIUS;
      for (let i = 0; i < threats.length; i++) {
        const t = threats[i];
        if (!t.active || t.y >= this.y) continue;      // 只躲上方来弹
        const dx = this.x - t.x;
        const dy = this.y - t.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;                        // 平方距剪枝
        const w = 1 - Math.min(d2, r2) / r2;           // 越近权重越大（0~1）
        ax += dx * w;
        ay += dy * w;
        if (++n >= D.MAX_THREATS) break;
      }
    }

    // 2) 预测式侧步（第三版②，新增）
    let px = 0, py = 0;
    if (D.PREDICT && threats && threats.length) {
      const danger2 = D.PREDICT_RADIUS * D.PREDICT_RADIUS;
      for (let i = 0; i < threats.length; i++) {
        const t = threats[i];
        if (!t.active || !t.body) continue;
        const bvx = t.body.velocity.x, bvy = t.body.velocity.y;
        const speed2 = bvx * bvx + bvy * bvy;
        if (speed2 < 1) continue;                       // 静止弹：交给反应式
        const rx = t.x - this.x, ry = t.y - this.y;     // 弹 -> 机 向量
        const tca = -(rx * bvx + ry * bvy) / speed2;    // 最近接近时刻（秒）
        if (tca <= 0 || tca > D.PREDICT_LOOKAHEAD) continue; // 远离 / 过远
        const cx = rx + bvx * tca, cy = ry + bvy * tca; // 最近接近点（相对机）
        const cd2 = cx * cx + cy * cy;
        if (cd2 >= danger2) continue;                   // 不会擦到
        const prox = 1 - Math.min(cd2, danger2) / danger2;   // 越近越急（0~1）
        const inv = 1 / Math.sqrt(speed2);
        const perpx = -bvy * inv, perpy = bvx * inv;    // 垂直弹道方向（单位向量）
        const side = (rx * perpx + ry * perpy) >= 0 ? 1 : -1; // 机在弹道哪一侧
        px += perpx * side * prox;
        py += perpy * side * prox;
      }
    }

    const gxRaw = n ? ax * D.GAIN : 0;
    const gyRaw = n ? ay * D.GAIN : 0;
    const gx = Phaser.Math.Clamp(gxRaw + px * D.PREDICT_GAIN, -D.MAX_OFFSET, D.MAX_OFFSET);
    const gy = Phaser.Math.Clamp(gyRaw + py * D.PREDICT_GAIN, -D.MAX_OFFSET, D.MAX_OFFSET);
    // 自身再平滑一次，威胁进出视野时不会瞬移
    this.dodgeVec.x = Phaser.Math.Linear(this.dodgeVec.x, gx, D.SMOOTH);
    this.dodgeVec.y = Phaser.Math.Linear(this.dodgeVec.y, gy, D.SMOOTH);
  }

  /** 按当前武器档位齐射；子弹一律走 GameScene.spawnWingmanBullet（复用玩家子弹池） */
  _fire(target, cfg) {
    const scene = this.scene;
    if (!scene || !scene.spawnWingmanBullet) return;
    const base = target
      ? Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y)
      : -Math.PI / 2;
    const shots = cfg.shots || 1;
    const step = Phaser.Math.DegToRad(cfg.spreadDeg || 0);
    for (let i = 0; i < shots; i++) {
      const ang = base + (i - (shots - 1) / 2) * step;
      scene.spawnWingmanBullet(this.x, this.y + WINGMAN.MUZZLE_DY, ang, {
        element: this.element,
        weaponLv: this.weaponLv,
        byWingman: true,
      });
    }
  }

  // ---- 独立生存（第二版：GameScene 接 enemyBullets overlap 后真正生效）----

  /**
   * 受击。返回 true 表示"本次受击导致僚机被击落"（调用方据此播爆炸）。
   * @param {number} n   伤害
   * @param {number} now 当前时刻（由 GameScene 传 this.time.now，便于测试注入时基）
   * 无敌期内直接返回 false 且不扣血 —— 重生瞬间穿过残余弹幕不会被秒清。
   */
  takeDamage(n, now) {
    if (!this.alive) return false;
    const t = (now != null) ? now : (this.scene && this.scene.time ? this.scene.time.now : 0);
    if (t < this.invulnUntil) return false;
    this.hp = Math.max(0, this.hp - (n || 0));
    if (this.hp <= 0) { this.die(); return true; }
    this.setAlpha(0.5);
    if (this.scene) this.scene.time.delayedCall(90, () => { if (this.active) this.setAlpha(1); });
    return false;
  }

  /** 击落：隐藏 + 进入重生冷却（第二版由 WingmanSystem 轮询 respawnAt） */
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.respawnAt = (this.scene && this.scene.time ? this.scene.time.now : 0) + WINGMAN.RESPAWN_MS;
    this.setActive(false).setVisible(false);
    if (this.body) this.body.enable = false;
    EventBus.emit(EVENTS.WINGMAN_DESTROYED, { slot: this.slot, x: this.x, y: this.y });
  }

  /**
   * 重生：满血归队 + 短暂无敌。
   * 注意：不动 this.element / this.weaponLv / this.role —— 重生后首弹仍带玩家元素，
   * 成就 element_* 与 wingman_* 链路不断。
   */
  respawn(x, y, now) {
    const t = (now != null) ? now : (this.scene && this.scene.time ? this.scene.time.now : 0);
    this.alive = true;
    this.hp = this.maxHp;
    this.respawnAt = 0;
    this.fireCd = 0;
    this.invulnUntil = t + WINGMAN.INVULN_MS;
    this.dodgeVec.x = 0;
    this.dodgeVec.y = 0;
    this.setPosition(x != null ? x : this.x, y != null ? y : this.y);
    this.setActive(true).setVisible(true).setAlpha(1);
    if (this.body) this.body.enable = true;
    EventBus.emit(EVENTS.WINGMAN_RESPAWNED, { slot: this.slot, x: this.x, y: this.y });
  }
}
