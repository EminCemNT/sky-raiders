import Phaser from 'phaser';
import { GAME_WIDTH, WINGMAN, UPGRADE_TREE, EVENTS } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';
import { EventBus } from '../utils/EventBus.js';
import Wingman from '../entities/Wingman.js';

// 元素协同 combo 激活时僚机弹的染色（区别于 lv3 元素弹本身的 ELEMENTS.color，
// 更亮、更饱和，让"协同增伤中"一眼可辨）
const COMBO_TINT = { fire: 0xff6633, ice: 0x33ccff, thunder: 0xffee44 };

/**
 * WingmanSystem：僚机集合管理（僚机 AI 进阶 第一/二版）
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 读存档等级 -> 决定僚机数量（upgrades.wingman，硬上限 WINGMAN.MAX）与
 *      武器等级（upgrades.wingmanFirepower）
 *   2. 编队槽位分配 + 战术角色分配（数量变化时重排，表来自 GameConfig.WINGMAN）
 *   3. 每帧算一份"共享快照"注入各僚机：最近目标 + 同元素目标 + 威胁弹列表
 *      —— 威胁弹粗筛与同元素目标扫描都每 DODGE.CHECK_EVERY 帧只做 1 次全组扫描
 *   4. 独立生存：监听 WINGMAN_DESTROYED/RESPAWNED 维护 _deadCount，
 *      _tickRespawn 轮询到点归队（玩家阵亡时冻结计时）
 *   5. 元素协同 combo 状态机：reportHit / getComboMul / getComboTint
 *   6. 对外暴露 getGroup() / addWingman() / onPlayerElementChanged()
 *
 * 性能红线：0 架僚机时 update 与 reportHit 首行返回；满编 4 架时每帧开销 =
 *   4 次实体 update + 1 次 findNearestTarget + (每 3 帧) 1 次敌弹粗筛 + (每 3 帧、
 *   且编队内确有 support 时) 1 次敌机扫描。_tickRespawn 在 _deadCount=0 时首行返回。
 */
export default class WingmanSystem {
  /**
   * @param {Phaser.Scene} scene  GameScene
   * @param {Phaser.Physics.Arcade.Group} bulletGroup  玩家子弹池（复用，不新建）
   */
  constructor(scene, bulletGroup) {
    this.scene = scene;
    this.bullets = bulletGroup;

    // 僚机自身的物理组（子弹仍复用 playerBullets）
    this.group = scene.physics.add.group({
      classType: Wingman,
      maxSize: WINGMAN.MAX,
      runChildUpdate: false,
    });
    this.members = [];

    this._frame = 0;
    this._threats = [];        // 复用同一个数组，避免每次扫描分配

    // 独立生存：被击落的僚机计数（>0 时 _tickRespawn 才真正跑）
    this._deadCount = 0;
    // 战术分工：编队内是否存在 aim='element' 的角色（决定要不要扫同元素目标）
    this._hasElementAim = false;
    this._elementTarget = null;
    this._focusTarget = null;       // 第三版③集火指令：锁定的优先火力目标（null=无）

    // 元素协同 combo 状态机（System 单例，一局一份）
    //   element  当前链路的元素；count 交替命中计数；lastSide 上次命中来源(true=僚机)
    //   lastAt   上次命中时刻；activeUntil 增益截止时刻
    this.combo = { element: null, count: 0, lastSide: null, lastAt: 0, activeUntil: 0 };

    // 事件接线：Wingman.die/respawn 广播 -> 系统维护 _deadCount
    this._onDestroyed = () => {
      this._deadCount = Phaser.Math.Clamp(this._deadCount + 1, 0, WINGMAN.MAX);
    };
    this._onRespawned = () => {
      this._deadCount = Phaser.Math.Clamp(this._deadCount - 1, 0, WINGMAN.MAX);
    };
    EventBus.on(EVENTS.WINGMAN_DESTROYED, this._onDestroyed);
    EventBus.on(EVENTS.WINGMAN_RESPAWNED, this._onRespawned);

    const up = (SaveManager.load().upgrades) || {};
    const maxLv = WINGMAN.WEAPON_LV.length - 1;
    this.weaponLv = Phaser.Math.Clamp(up.wingmanFirepower || 0, 0, maxLv);
    this.element = (scene.player && scene.player.shipElement) || null;

    // 数量：机库"僚机"等级，受该项 max 与硬上限双重约束
    const wanted = Math.min(up.wingman || 0, UPGRADE_TREE.wingman.max, WINGMAN.MAX);
    for (let i = 0; i < wanted; i++) this.addWingman();
  }

  /** 新增一架僚机（机库等级初始化 / 拾取"僚机"道具都走这里），超上限返回 null */
  addWingman() {
    if (this.members.length >= WINGMAN.MAX) return null;
    const p = this.scene.player;
    const x = p ? p.x : GAME_WIDTH / 2;
    const y = p ? p.y + 24 : 0;
    const w = new Wingman(this.scene, x, y);
    this.group.add(w);
    this.members.push(w);
    w.setWeaponLv(this.weaponLv).setElement(this.element);
    this._assignSlots();
    this._assignRoles();
    return w;
  }

  /** 按当前数量套用编队表，重排所有槽位 */
  _assignSlots() {
    const n = this.members.length;
    if (!n) return;
    const f = WINGMAN.FORMATIONS[n] || WINGMAN.FORMATIONS[WINGMAN.MAX];
    const slots = f.slots;
    for (let i = 0; i < n; i++) {
      this.members[i].setSlot(i, slots[i] || slots[slots.length - 1], f.name);
    }
  }

  /**
   * 按当前数量套用角色表（战术分工，第二版）。与 _assignSlots 同点调用，
   * 保证"槽位 i 的角色"始终与 ROLE_BY_COUNT[n][i] 一致，不随增援顺序漂移。
   */
  _assignRoles() {
    const n = this.members.length;
    if (!n) return;
    const roles = WINGMAN.ROLE_BY_COUNT[n] || WINGMAN.ROLE_BY_COUNT[WINGMAN.MAX] || [];
    let hasElementAim = false;
    for (let i = 0; i < n; i++) {
      const r = roles[i] || WINGMAN.ROLE;
      this.members[i].setRole(r);
      const cfg = WINGMAN.ROLES[r];
      if (cfg && cfg.aim === 'element') hasElementAim = true;
    }
    this._hasElementAim = hasElementAim;
  }

  /** 每帧驱动（GameScene.update 调用）。dt 为毫秒 */
  update(time, dt) {
    if (!this.members.length) return;              // 0 架：静默降级，零开销
    const p = this.scene.player;
    if (!p || !p.active) return;                   // 玩家阵亡：僚机停摆，不报错

    this._frame++;
    const recompute = (this._frame % WINGMAN.DODGE.CHECK_EVERY) === 0;
    if (recompute) {
      this._scanThreats(p);
      // 同元素目标同样节流扫描；编队里没有 support 时整段跳过，零额外开销
      if (this._hasElementAim && this.element) this._scanElementTarget(p);
      else this._elementTarget = null;
    }
    // 缓存目标可能在两次扫描之间死亡，用前先验活
    if (this._elementTarget && !this._elementTarget.active) this._elementTarget = null;
    // 焦点目标同理：阵亡即自动解除集火（不残留死目标导致哑火）
    if (this._focusTarget && !this._focusTarget.active) this._focusTarget = null;

    // 共享快照：最近目标只算一次（原实现是每机一次全组扫描）
    const ctx = {
      px: p.x,
      py: p.y,
      playerActive: true,
      target: this.scene.findNearestTarget ? this.scene.findNearestTarget(p.x, p.y) : null,
      elementTarget: this._elementTarget,
      focusTarget: (this._focusTarget && this._focusTarget.active) ? this._focusTarget : null,
      threats: this._threats,
      recomputeDodge: recompute,
      time,
    };

    for (let i = 0; i < this.members.length; i++) {
      const w = this.members[i];
      if (w.active && w.alive) w.update(dt, ctx);
    }

    // 状态快照广播（HUD 僚机指示，第三版起步）：只读快照，不动战斗逻辑
    this._emitStatus(time);
  }

  /**
   * 状态快照广播（第三版 HUD 僚机指示）：每帧在 update 末尾调用，
   * 仅读取 members / weaponLv / element / comboMul，构造轻量快照经 EventBus 发出。
   * 注意：0 架 / 玩家阵亡时 update 已在上方早返回，本方法不会被调用，天然零开销。
   */
  _emitStatus(time) {
    const members = this.members.map((w) => ({
      alive: !!w.alive,
      respawnRemainMs: (w.respawnAt && w.respawnAt > time) ? (w.respawnAt - time) : 0,
      element: w.element,
    }));
    EventBus.emit(EVENTS.WINGMAN_STATUS, {
      count: this.members.length,
      weaponLv: this.weaponLv,
      element: this.element,
      comboMul: this.getComboMul(time),
      focus: {
        active: !!(this._focusTarget && this._focusTarget.active),
        x: (this._focusTarget && this._focusTarget.active) ? this._focusTarget.x : 0,
        y: (this._focusTarget && this._focusTarget.active) ? this._focusTarget.y : 0,
      },
      members,
    });
  }

  /**
   * 威胁弹粗筛：收集玩家周围 SCAN_RADIUS 内的活跃敌弹（上限 SCAN_CAP）。
   * 精筛（上方来弹 + 平方距 < 120²+ 上限 4 颗）由各僚机在 _computeDodge 里做。
   */
  _scanThreats(p) {
    const list = this._threats;
    list.length = 0;
    const eb = this.scene.enemyBullets;
    if (!eb || !eb.children) return;
    const D = WINGMAN.DODGE;
    const r2 = D.SCAN_RADIUS * D.SCAN_RADIUS;
    const cap = D.SCAN_CAP;
    eb.children.each((b) => {
      if (list.length >= cap || !b.active) return;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (dx * dx + dy * dy > r2) return;
      list.push(b);
    });
  }

  /**
   * 同元素目标粗筛（support 角色专用）：找最近的、已挂当前元素状态（Enemy._elem）的敌人。
   * 语义：玩家先点燃/冰冻，support 补刀同一个目标 —— 这正是元素协同 combo 的交替命中来源。
   */
  _scanElementTarget(p) {
    const el = this.element;
    const es = this.scene.enemies;
    let best = null; let bestD = Infinity;
    if (es && es.children) {
      es.children.each((e) => {
        if (!e.active || e._elem !== el) return;
        const dx = e.x - p.x; const dy = e.y - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = e; }
      });
    }
    this._elementTarget = best;
  }

  // ---- 独立生存：重生轮询（第二版）----

  /**
   * 重生轮询。由 GameScene.update 每帧调用（前置于 wingmanSystem.update）。
   * 三重守卫保证零开销 / 零副作用：
   *   1. _deadCount === 0 → 首行返回（绝大多数帧走这条）
   *   2. 玩家阵亡 → 直接返回，重生计时冻结（不会在 Game Over 画面把僚机刷回来）
   *   3. 逐机比对 respawnAt，到点才归队
   * 重生位置 = 玩家当前位置 + 该机原槽位偏移，避免在屏幕外或敌群里凭空出现。
   */
  _tickRespawn(time) {
    if (this._deadCount <= 0) return;
    const p = this.scene && this.scene.player;
    if (!p || !p.active) return;
    for (let i = 0; i < this.members.length; i++) {
      const w = this.members[i];
      if (!w || w.alive) continue;
      if (w.respawnAt > time) continue;
      // P2-2 钳制到屏内（x∈[18,522], y∈[40,940]），避免玩家贴屏边时僚机重生越界
      w.respawn(Phaser.Math.Clamp(p.x + w.offset.x, 18, 522), Phaser.Math.Clamp(p.y + w.offset.y, 40, 940), time);
    }
  }

  // ---- 元素协同 combo（第二版）----

  /**
   * 上报一次"玩家子弹命中敌人"。由 GameScene 的 playerBullets↔enemies overlap 回调调用。
   * @param {boolean} byWingman 命中来源是否为僚机
   * @param {?string} element   该发子弹的元素（无元素 = 不参与协同）
   * @param {number}  now       当前时刻（ms）
   *
   * 触发条件：同一元素、相邻命中间隔 <= WINDOW_MS、且来源在"玩家/僚机"之间交替，
   * 累计 TRIGGER 次即激活 BUFF_MS 的僚机增伤。同来源连打只刷新窗口、不涨计数 ——
   * 必须是真正的"协同"才算数。
   */
  reportHit(byWingman, element, now) {
    if (!this.members.length) return;          // 0 架：静默降级，零开销
    const C = WINGMAN.COMBO;
    const c = this.combo;
    if (!element) {                            // 无元素命中：断链但不影响已激活的增益
      c.element = null; c.count = 0; c.lastSide = null; c.lastAt = 0;
      return;
    }
    const side = !!byWingman;
    if (element !== c.element || (now - c.lastAt) > C.WINDOW_MS) {
      // 换元素 或 超出窗口 → 以本次命中为起点重新起链
      c.element = element;
      c.count = 1;
    } else if (side !== c.lastSide) {
      // 来源交替才计数（上限 MAX_COUNT，防长链溢出）
      c.count = Math.min(c.count + 1, C.MAX_COUNT);
    }
    c.lastSide = side;
    c.lastAt = now;

    if (c.count >= C.TRIGGER) {
      c.activeUntil = now + C.BUFF_MS;
      const n = c.count;
      c.count = 0;                             // 清零：同一条链不重复广播
      EventBus.emit(EVENTS.WINGMAN_COMBO, { element, count: n });
    }
  }

  /** 当前僚机弹伤害倍率：协同增益期内为 COMBO.DMG_MUL，否则 1.0 */
  getComboMul(now) {
    const t = (now != null) ? now : (this.scene && this.scene.time ? this.scene.time.now : 0);
    return t < this.combo.activeUntil ? WINGMAN.COMBO.DMG_MUL : 1.0;
  }

  /** 协同增益期内的僚机弹染色；未激活或无元素返回 0（调用方据此跳过 setTint） */
  getComboTint(now) {
    if (this.getComboMul(now) <= 1) return 0;
    return COMBO_TINT[this.combo.element] || 0;
  }

  // ---- 第三版③集火指令：僚机集中火力锁定指定目标 ----

  /** 设置焦点目标（外部/输入调用）。传 null 等同于 clearFocus。 */
  setFocusTarget(t) {
    this._focusTarget = (t && t.active) ? t : null;
    return this._focusTarget;
  }

  /** 解除集火 */
  clearFocus() {
    this._focusTarget = null;
  }

  /**
   * 切换集火：当前有活的焦点目标则解除；否则把"当前最近目标"设为焦点。
   * 由 GameScene 的 F 键（JustDown）调用。无玩家/无目标时安全降级为空操作。
   */
  toggleFocus() {
    if (this._focusTarget && this._focusTarget.active) { this._focusTarget = null; return; }
    const p = this.scene && this.scene.player;
    const t = (p && this.scene.findNearestTarget) ? this.scene.findNearestTarget(p.x, p.y) : null;
    this._focusTarget = (t && t.active) ? t : null;
  }

  /** 玩家元素变化时同步给所有僚机（保证僚机弹 element 与玩家一致） */
  onPlayerElementChanged(el) {
    this.element = el || null;
    for (let i = 0; i < this.members.length; i++) this.members[i].setElement(this.element);
  }

  /** 运行时改武器档位（升级项生效点在开局构造，这里供调试/后续道具用） */
  setWeaponLv(lv) {
    const maxLv = WINGMAN.WEAPON_LV.length - 1;
    this.weaponLv = Phaser.Math.Clamp(lv || 0, 0, maxLv);
    for (let i = 0; i < this.members.length; i++) this.members[i].setWeaponLv(this.weaponLv);
  }

  getGroup() { return this.group; }

  getMembers() { return this.members; }

  getCount() { return this.members.length; }

  destroy() {
    // 事件必须解绑：EventBus 是全局单例，重开一局会新建 System，
    // 不解绑会让上一局的 _deadCount 处理器继续吃事件（内存泄漏 + 计数串台）
    EventBus.off(EVENTS.WINGMAN_DESTROYED, this._onDestroyed);
    EventBus.off(EVENTS.WINGMAN_RESPAWNED, this._onRespawned);
    for (let i = 0; i < this.members.length; i++) {
      const w = this.members[i];
      if (w && w.destroy) w.destroy();
    }
    this.members.length = 0;
    this._threats.length = 0;
    this._elementTarget = null;
    this._deadCount = 0;
    if (this.group) { this.group.destroy(false); this.group = null; }
    this.scene = null;
  }
}
