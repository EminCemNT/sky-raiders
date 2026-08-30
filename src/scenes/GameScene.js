import Phaser from 'phaser';
import {
  SCENES, GAME_WIDTH, GAME_HEIGHT, EVENTS, COLORS, PLAYER, BULLET, LEVELS, BOSS_RUSH, SHIPS, ELEMENTS, WINGMAN,
  DIFFICULTIES, getDifficulty, POWERUP, GRAZE, OVERDRIVE, OVERCHARGE, FOCUS, bossRushScale, PERFORMANCE, POOL, COMBAT_PERF,
  EVENT_MODES, getCurrentEvent, MODULE_DROP_CHANCE, getShipSkins, TOWER, TOWER_BUFFS, LIGHTS, TRANSITION,
  RELIEF, COMBO_BURST, ELEMENT_STORM,
} from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';
import { t } from '../config/Locale.js';
import { Ads } from '../systems/Ads.js';
import { createStarfield } from '../systems/Starfield.js';
import { transition } from '../systems/TransitionManager.js';
import Player from '../entities/Player.js';
import Enemy from '../entities/Enemy.js';
import Boss from '../entities/Boss.js';
import Item from '../entities/Item.js';
import WaveSystem from '../systems/WaveSystem.js';
import WingmanSystem from '../systems/WingmanSystem.js';
import ElementReaction from '../systems/ElementReaction.js';
import { FloatingTextManager, warmFonts } from '../systems/FloatingText.js';
import { NeonButton } from '../utils/UIWidgets.js';
import { enableSceneBloom } from '../utils/BloomFX.js';
import { AchievementManager } from '../systems/AchievementManager.js';
import { Codex } from '../systems/Codex.js';
import { audio } from '../systems/AudioSystem.js';
import * as VFX from '../systems/VFX.js';
import {
  ITEMS, ITEM_DROP_CHANCE, ITEM_DROP_WEIGHTS, BOSS_DROP_TABLE,
} from '../config/Items.js';
import { ENERGY_MAX, DEFAULT_SKILL, SKILLS } from '../config/Skills.js';
import { MUTATION_EVERY_LAYERS, MUTATIONS, rollMutation } from '../config/Mutations.js';

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
    this.mode = (data && data.mode) || 'normal'; // 'normal' | 'bossrush' | 'endless' | 'coin_rush' | 'survival'
    this.levelId = data.levelId || 1;
    this.forceTutorial = !!(data && data.forceTutorial); // 菜单"教程"按钮强制重看
    // P0 留存-活动轮换：事件模式配置（coin_rush/survival），非事件模式为 null
    this.eventCfg = (data && data.mode && EVENT_MODES[data.mode]) || null;
    // P0 留存-关卡勋章：单武器通关判定（局内武器切换次数；开局绑定武器不算切换）
    this._weaponSwitchCount = 0;
    this._levelStartTime = 0;
    this.stats = { kills: 0, coins: 0, damageTaken: 0, spawned: 0 };
    this.score = 0;
    this.gameEnded = false;
    // 连击系统（P0）
    this.combo = 0;
    this._comboExpire = 0;
    // 局内火力(P)成长（P1）：独立于机库升级，拾取 P +1 / 受击 -1，0~4
    this.powerLevel = 0;
    // 成就统计
    this.maxCombo = 0;
    this.usedSuperCount = 0;
    // B11 连击蓄力爆发（局内临时，不入存档）：_burstUntil = 强化射击到期时刻（0=未激活）
    this._burstUntil = 0;
    // 第二主动技能（P2）：当前技能槽（星风暴 ↔ 过载），由 SKILL_SWITCHED 轮换
    this.activeSkill = DEFAULT_SKILL;
    this._overdriveUntil = 0;
    // P1 战斗扩展·超载状态（局内临时，不入存档）：连续拾取 3P 或连续擦弹 5 次（30s 窗口）触发
    this.overcharge = { active: false, until: 0, duration: 0 };
    this._ocP = { count: 0, lastAt: 0 };
    this._ocGraze = { count: 0, lastAt: 0 };
    this._ocBonus = 0; // 超载得分 bonus 累积器（延迟结算，见 _onScore / _flushOverchargeBonus）
    // P1 聚焦模式：移动端专用按钮状态（桌面用 Shift 键，见 create/update）
    this._focusBtnDown = false;
    // 擦弹 Graze（P2）状态
    this.grazeCount = 0;
    this.grazeChain = 0;
    this._grazeChainUntil = 0;
    this._grazeTick = 0;
    // Boss Rush 差异化（P2）
    this._rushScale = null;
    this._rushRareDrops = 0;
    // 无尽看广告复活（P2 激励广告位预留）：每局一次，不持久化
    this._adReviveUsed = false;
    this._adReviveOpen = false;
    this._adReviveOverlay = null;
    this._adReviveCtl = null;
    // P1 留存·深空爬塔（无尽升级）：局内临时状态（不入存档）
    //   isTower=true 无尽爬塔；towerFloor=已通过层数（Boss 波通关数）；
    //   towerBonuses={ fireRate/extraShot/speed/graze/hp/coin: 各增益累计次数 }
    this.isTower = false;
    this.towerFloor = 0;
    this.towerBonuses = { fireRate: 0, extraShot: 0, speed: 0, graze: 0, hp: 0, coin: 0 };
    this._towerBuffOpen = false;
    this._towerBuffOverlay = null;
    // OPT-13 批A A9 连续失败救济局（仅 normal 主线；局内临时，不入存档）：
    //   _reliefRun        本局是否为救济局（选 A/B 后置 true；选「拒绝」保持 false）
    //   _reliefEligible   failStreak[levelId] >= RELIEF.failStreakThreshold（create 判定）
    //   _reliefCombatMul  选项 A：休闲档敌人/Boss 战斗系数（session 覆盖，不写 selectedDifficulty）
    //   _reliefAtkPicked  选项 B：已选 +10% 攻击（Player.reliefAtkMul 消费）
    //   _reliefOverlay/_reliefCtl  救济提示面板（与爬塔增益面板同款）
    this._reliefRun = false;
    this._reliefEligible = false;
    this._reliefCombatMul = null;
    this._reliefAtkPicked = false;
    this._reliefOpen = false;
    this._reliefOverlay = null;
    this._reliefCtl = null;
    // 成就系统：本局开始，重置会话态并预载累计数据
    AchievementManager.startRun(this.mode, this.levelId);
  }

  create() {
    // 当前关卡（色调 / 难度 / Boss 配置 / 波次表）
    this.level = LEVELS.find((l) => l.id === this.levelId) || LEVELS[0];
    const theme = this.level.theme;
    // P0 留存-关卡勋章：计时起点（timeLimit 勋章判定）
    this._levelStartTime = this.time.now;
    // P0 留存-活动轮换：读取当前活动（双倍奖励日 / 剩余天数透传给 ResultScene 展示）
    if (this.eventCfg) {
      const ev = getCurrentEvent();
      this.eventDouble = !!ev.double;
      this.eventDaysLeft = ev.daysLeft;
      this._eventUntil = this.time.now + (this.eventCfg.duration || 60) * 1000;
      this._eventTimerAcc = 0;
    }

    // P0 四档难度：读存档选择，标准档系数全 1.0（与现状逐字段等价，零回归）
    this.difficultyCfg = getDifficulty(SaveManager.load().selectedDifficulty) || DIFFICULTIES[1];

    // 背景渐变（按关卡色调）
    const bg = this.add.graphics().setDepth(-200);
    bg.fillGradientStyle(theme.skyTop, theme.skyTop, theme.skyBottom, theme.skyBottom, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // 星空（按关卡色调染色）
    this.starfield = createStarfield(this, { layers: 4, starTints: theme.starTints, theme });

    // 顶部主光（P3 光效纪律：发光白名单=机/弹/爆/拾取，背景仅此一层顶光）
    VFX.addKeyLight(this);

    // 对象池
    this.playerBullets = this.physics.add.group({ defaultKey: 'bullet_pulse', maxSize: 200 });
    this.enemyBullets = this.physics.add.group({ defaultKey: 'bullet_enemy', maxSize: POOL.enemyBullets });
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: 60, runChildUpdate: false });
    this.coins = this.physics.add.group({ defaultKey: 'coin', maxSize: 120 });
    this.items = this.physics.add.group({ classType: Item, defaultKey: 'item_energy', maxSize: 60, runChildUpdate: false });

    // 激光束组（B4）：与 playerBullets 分离，避免被 killBullet 回收；A4 上限防无界增长
    this.playerBeams = this.physics.add.group({ maxSize: POOL.playerBeams });

    // 预填敌人池
    for (let i = 0; i < 30; i++) {
      const e = new Enemy(this);
      this.enemies.add(e);
    }

    // A4 预填敌弹池：避免首帧冷启动 Group.get() 逐发创建的开销（与 enemies/items 预填对齐）
    for (let i = 0; i < POOL.enemyBullets; i++) {
      const b = this.physics.add.sprite(0, -200, 'bullet_enemy');
      b.setActive(false).setVisible(false);
      b.body.enable = false;
      this.enemyBullets.add(b);
    }

    // 预填道具池
    for (let i = 0; i < 30; i++) {
      const it = new Item(this);
      this.items.add(it);
    }

    // 玩家（读存档火力等级）
    const save = SaveManager.load();
    // 命数复活：每局命数重置为 START_LIVES；spawn 位置供原地复活复用
    this.lives = PLAYER.START_LIVES;
    // P0 留存-活动轮换：限时生存命数+1 补偿
    if (this.eventCfg && this.eventCfg.extraLives) this.lives += this.eventCfg.extraLives;
    this.playerSpawnX = GAME_WIDTH / 2;
    this.playerSpawnY = GAME_HEIGHT - 140;
    this.player = new Player(this, this.playerSpawnX, this.playerSpawnY, this.playerBullets);
    this.player.setFirepower(save.upgrades.firepower || 0);
    this.player.setPowerLevel(this.powerLevel); // 局内火力(P)从 0 起步
    // P0 机库模块养成：装甲模块生命上限加成叠加在既有 hull 升级之上（Player 构造时已应用模块）
    this.player.maxHp = PLAYER.MAX_HP + (save.upgrades.hull || 0) * 20 + (this.player.moduleHpBonus || 0);
    this.player.hp = this.player.maxHp;

    // C2 战机武器绑定：从机库所选战机读取默认武器 + 元素属性
    const shipIdx = (save.selectedShip != null) ? save.selectedShip : 0;
    const ship = (SHIPS && SHIPS[shipIdx]) ? SHIPS[shipIdx] : (SHIPS ? SHIPS[0] : null);
    // P0 战机专属被动：Enemy.applyElement 按此系数乘元素效果（无 passive = 零加成）
    this.shipPassive = (ship && ship.passive) || null;
    if (ship) {
      this.player.defaultWeapon = ship.weapon || 'pulse';
      this.player.shipElement = ship.element || null;
      // Boss Rush 仍从脉冲起步，靠武器箱切换；普通关直接使用绑定武器
      // 开局武器：机库持久选择（startWeapon）覆盖战机绑定武器；bossrush 仍强制脉冲维持平衡
    const startWeapon = (save.startWeapon) || null;
    const bound = this.mode === 'bossrush' ? 'pulse' : (startWeapon || ship.weapon || 'pulse');
      this.player.setWeapon(bound);
      AchievementManager.reportWeaponUsed(bound);
      Codex.record('weapons', bound);   // B13 图鉴收藏：首次使用该武器
      if (ship.tint) { this.player.setTint(ship.tint); this.player.setShipTint(ship.tint); }
      // P2 皮肤装饰：机库所选皮肤纹理覆盖默认 tint（skin 0=默认款，回退既有视觉；皮肤已自带配色）
      const skinId = SaveManager.getSkin(shipIdx);
      if (SaveManager.ownsSkin(shipIdx, skinId)) {
        this.player.applySkin(shipIdx, skinId);
        const skinDef = (getShipSkins(shipIdx) || [])[skinId];
        if (skinDef && skinDef.accent) this.player.setShipTint(skinDef.accent);
      }
      this._runShipId = shipIdx;
      this._runSkinId = skinId;
      // 0 = 常驻（绑定武器无倒计时）；delayedCall 确保 UIScene 已绑定监听
      if (bound !== 'pulse') this.time.delayedCall(0, () => EventBus.emit(EVENTS.WEAPON_CHANGED, bound, 0));
    }
    // 激光束注入（B4）
    this.player.beamGroup = this.playerBeams;

    // 画质档（P0 性能三件套）：读存档 quality → 粒子/弹幕密度缩放系数。
    // P2-5：必须在 playerLight 创建前就绪 —— playerLight 依赖 qualityScale 判断 low 档短路不创建
    //（此前 qualityScale 在 260 行才赋值，playerLight 于 202 行先建 → low 档误按 high 建灯，QA ⑤-4 FAIL）
    const quality = (SaveManager.load().quality) || PERFORMANCE.defaultTier;
    this.qualityScale = (PERFORMANCE.scale && PERFORMANCE.scale[quality]) || 1;

    // 玩家机柔光（P3 光效纪律白名单：机/弹/爆/拾取；随 player 移动/显隐）
    VFX.glowTarget(this.player, this.player.shipTint || COLORS.player, { radius: 0.55, alpha: 0.20, depth: -2 });
    // ⑤ 动态光影-玩家引擎辉光（P2 视觉四件套；随 player 呼吸，reduced/low 降级为静态/无）
    this.playerLight = VFX.playerLight(this, this.player, LIGHTS.player);

    // 道具/技能系统状态（#151）— 必须在首个 ENERGY_CHANGED 事件前初始化
    this.energy = 0;
    this.buffs = { shieldUntil: 0, magnetUntil: 0 };
    // P0 留存-活动轮换：金币冲刺磁力常驻（MAX_SAFE_INTEGER 永不到期；HUD 徽标在下方初始同步处广播）
    if (this.eventCfg && this.eventCfg.magnet) {
      this.buffs.magnetUntil = Number.MAX_SAFE_INTEGER;
    }
    this.wingmanSystem = null; // 僚机集合（在玩家元素绑定后创建，见下方）

    // 输入
    this.cursors = this.input.keyboard.createCursorKeys();
    this.bombKey = this.input.keyboard.addKey('SPACE');
    this.focusKey = this.input.keyboard.addKey('F'); // 第三版③集火指令：切换僚机集火
    this.shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT); // P1 聚焦模式（按住 Shift）
    this.burstKey = this.input.keyboard.addKey('C'); // B11 连击蓄力爆发（不占用空格炸弹 / 技能 / FOCUS 键位）

    // 波次系统（Boss Rush 模式不生成普通波次，改为纯 Boss 序列；
    // endless 复用同一 WaveSystem，开无尽循环 + 难度递增；
    // 活动模式同样走无尽循环，由 EVENT_TIMER 到期结算）
    // P1 留存·深空爬塔：无尽模式升级为爬塔（每 TOWER.BOSS_EVERY 波一个 Boss + 每波 3 选 1 增益）；
    //   活动模式（coin_rush/survival）保持纯无尽，不受影响。
    this.bossRushIndex = 0;
    this.isTower = this.mode === 'endless';
    if (this.isTower) {
      this.towerFloor = 0;
      this.towerBonuses = { fireRate: 0, extraShot: 0, speed: 0, graze: 0, hp: 0, coin: 0 };
      // A8 无尽变异层（局内临时不入存档）：id → 累计次数，幂等叠加
      this.mutations = {};
    }
    if (this.mode !== 'bossrush') {
      this.waves = new WaveSystem(this, this.levelId, {
        endless: this.mode === 'endless' || !!this.eventCfg,
        endlessBossEvery: this.isTower ? (TOWER.BOSS_EVERY || 10) : 0,
        awaitBuff: this.isTower,
      });
    }
    this.boss = null;

    // 命中定格（hitStop）：大事件短暂冻结物理强化打击感（指针拖动玩家不受影响）
    this._hitStopMs = 0;
    this._hitStopGapUntil = 0;

    // 碰撞
    this.setupColliders();

    // 事件
    this.bindEvents();
    audio.bindGameEvents();

    // 飘分（d-float）：场景内浮动得分文字
    this.floaters = new FloatingTextManager(this);

    // 子弹特效 emitter（reduced-motion 下返回 null，调用方判空降级）
    this.bulletTrails = VFX.createBulletTrails(this);
    this.enemyGlow = VFX.enemyBulletGlow(this);
    this.enemyTrail = VFX.enemyBulletTrail(this);

    // 画质档（P0 性能三件套）已在 create 顶部赋值（playerLight 创建前就绪，见上）；
    // 此处复用顶部 quality 变量开启 PostFX 辉光（high/mid 开，low 关；WebGL 才生效，Canvas 自动降级）
    this.bloomFX = enableSceneBloom(this, quality);
    // 爆炸/命中火花对象池：预建 2 个 offscreen emitter 复用（消除 GC 抖动）
    this.vfxPool = VFX.createVfxPool(this);
    // ⑥ 爆炸环境残留池（P2 视觉四件套：焦痕/余烬/烟尘；reduced 下返回 null 自动降级）
    this.residuePool = VFX.createResiduePool(this);
    // P2-7：挂接 __SKY._dynLight 动态光影探针（QA/PM 验收只读接口，不影响玩法）
    VFX.installLightProbes(this);

    // 拾取柔光（P3 光效纪律白名单：机/弹/爆/拾取；对象池每实例挂一层，随 active 显隐）
    this.items.children.each((it) => VFX.glowTarget(it, 0x9ff0ff, { radius: 0.38, alpha: 0.22, depth: -1 }));
    // 玩家弹柔光：capped 池复用（别滥用），由 update 每帧映射到活跃弹；克制到"几乎不可见的辉光"
    this._bulletGlowPool = [];
    for (let i = 0; i < 10; i++) {
      this._bulletGlowPool.push(this.add.image(0, 0, 'glow_soft')
        .setDepth(17).setAlpha(0.10).setTint(0x8fdcff)
        .setBlendMode(Phaser.BlendModes.ADD).setScale(0.07).setVisible(false));
    }

    // 首击卡顿预热：在 createBulletTrails 之后调用。
    // 编译粒子管线 / 字体光栅化 / 音频节点路径，确保首次命中无可见卡顿。
    // reduced-motion 下 VFX.warmup 内部直接 return（warmFonts 仍执行，字体预热不依赖动效）。
    VFX.warmup(this);
    warmFonts(this);
    audio.warmup();
    window.__SKY_WARMUP = true;

    // 并行启动 HUD
    this.scene.launch(SCENES.UI, {
      levelId: this.levelId,
      mode: this.mode,
      hp: this.player.hp, maxHp: this.player.maxHp,
      bombs: PLAYER.START_BOMBS,
      lives: this.lives,
      element: this.player.shipElement,
    });

    // 初始 HUD 同步
    EventBus.emit(EVENTS.HP_CHANGED, this.player.hp, this.player.maxHp);
    EventBus.emit(EVENTS.SCORE_CHANGED, 0);
    EventBus.emit(EVENTS.ENERGY_CHANGED, this.energy, ENERGY_MAX);
    EventBus.emit(EVENTS.LIVES_CHANGED, this.lives);
    EventBus.emit(EVENTS.POWER_CHANGED, this.powerLevel);
    EventBus.emit(EVENTS.GRAZE_CHANGED, { count: this.grazeCount, chain: this.grazeChain });
    // P2 技能：开局广播当前技能槽，UIScene 按钮标签随之初始化
    EventBus.emit(EVENTS.SKILL_SWITCHED, this.activeSkill);
    // P0 留存-活动轮换：金币冲刺磁力常驻（UI 已绑定监听后广播徽标）
    if (this.eventCfg && this.eventCfg.magnet) {
      EventBus.emit(EVENTS.MAGNET_CHANGED, true, Number.MAX_SAFE_INTEGER);
    }

    this.bombs = PLAYER.START_BOMBS;

    // 僚机 AI 进阶：数量/编队/武器等级全部交给 WingmanSystem（读存档 upgrades）
    // 子弹复用 playerBullets 池，系统内不新建子弹组、不新建 Timer
    this.wingmanSystem = new WingmanSystem(this, this.playerBullets);
    // 元素连锁反应（二段反应）：独立于 combo，由 Enemy.hit 经 scene.elementReaction 调用
    this.elementReaction = new ElementReaction(this);
    // 僚机受击 overlap 必须在系统实例化之后注册（setupColliders 早于此处执行，
    // 那时 wingmanSystem 还是 null，拿不到 getGroup()）
    this.setupWingmanCollider();

    // 首玩教程：首次进入游戏显示操作引导（Boss Rush / 无尽 / 活动模式跳过，避免阻塞）；forceTutorial 供菜单"教程"按钮重看
    if (this.mode !== 'bossrush' && this.mode !== 'endless' && !this.eventCfg && (!SaveManager.get('tutorialDone') || this.forceTutorial)) this.showTutorial();

    // A9 连续失败救济局（仅 normal 主线）：failStreak[levelId] >= 3 → 开局弹三选一
    //（降难度 session 覆盖 / 临时增益 +1 命或 +10% 攻击 / 拒绝）。无尽已有广告复活兜底，不触发。
    if (this.mode === 'normal' && !this._tutorialCtl) {
      this._reliefEligible = SaveManager.getFailStreak(this.levelId) >= (RELIEF.failStreakThreshold || 3);
      if (this._reliefEligible) this.showReliefPanel();
    }

    // Boss Rush：直接进入 Boss 序列
    if (this.mode === 'bossrush') this.startBossRush();

    // 调试钩子（供自动化真测驱动场景状态；不影响玩法）
    if (typeof window !== 'undefined') { window.__SKY = this; window.__GAME = this.game; window.__ELEMENT_REACTION = this.elementReaction; }

    // 场景关闭时清理事件
    this.events.once('shutdown', () => this.cleanup());
  }

  setupColliders() {
    // 玩家子弹 vs 敌人
    this.physics.add.overlap(this.playerBullets, this.enemies, (bullet, enemy) => {
      if (!bullet.active || !enemy.active) return;
      // P1 护盾机：正面护盾吸收玩家弹（不扣血、不计数），从侧/后打才掉血。
      // 规则：弹 x 落在盾宽内且弹处于敌机前侧（下方）→ 吸收；否则正常结算。
      if (enemy.hasFrontShield && Math.abs(bullet.x - enemy.x) <= (enemy.shieldWidth || 26) / 2
        && bullet.y >= enemy.y - 4) {
        this.killBullet(bullet);
        VFX.hitSpark(this, bullet.x, bullet.y);
        return;
      }
      // ★ 命中来源快照，必须在任何 killBullet 之前取值 ★
      // killBullet 会把 byWingman 无条件复位为 false（池复用红线，见 killBullet 注释）。
      // 本回调里"先回收子弹、后读 bullet.byWingman"的写法会永远读到 false ——
      // 结果就是真实战斗中僚机击杀永远进不了 wingman_first/wingman_50，
      // 元素协同 combo 也永远收不到"僚机侧"命中而无法交替计数。
      const byWm = !!bullet.byWingman;
      const el = bullet.element;
      const dmg = bullet.damage || 10;
      // B5 元素炸弹：命中即 AOE 爆炸
      if (bullet.isBomb) {
        this._explodeBomb(bullet.x, bullet.y, bullet.explodeRadius, bullet.damage, bullet.element);
        this.killBullet(bullet);
        VFX.hitSpark(this, bullet.x, bullet.y);
        return;
      }
      // 穿透弹（僚机 weaponLv2）：命中后保留子弹，最多穿 pierce 个目标。
      // _lastHit 去重必须在 pierce 判断之前 —— 否则子弹穿进敌机体内的下一帧
      // 会以"pierce 已耗尽"被就地销毁，等于对同一个目标结算两次、根本穿不过去。
      // 普通子弹 _lastHit 恒为 null，命中即销毁，行为与改动前完全一致。
      if (bullet._lastHit === enemy) return;
      if ((bullet.pierce || 0) > 0) {
        bullet._lastHit = enemy;
        bullet.pierce -= 1;
      } else {
        this.killBullet(bullet);
      }
      VFX.hitSpark(this, bullet.x, bullet.y);
      // 元素协同 combo：命中即上报来源+元素（僚机 0 架时系统内部首行返回，零开销）
      if (this.wingmanSystem) this.wingmanSystem.reportHit(byWm, el, this.time.now);
      if (enemy.hit(dmg, el)) {
        this.registerKill(enemy.x, enemy.y, { enemyType: enemy.typeKey, byWingman: byWm, element: el });
        this.addEnergy(2);
      }
      this._impactFeedback();   // P1-8 普通命中轻震 + 玩家机微后坐（节流）
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

    // 注：敌弹 vs 僚机的 overlap 在 setupWingmanCollider() 里注册 ——
    // WingmanSystem 在本方法之后才实例化，这里还拿不到僚机组。
  }

  /**
   * 敌弹 vs 僚机（僚机 AI 进阶 第二版·独立生存）。
   * 只吃敌弹，不吃敌机撞击 —— 僚机不承担撞机拦截职责，否则会变成"免费护盾"破坏难度。
   */
  setupWingmanCollider() {
    if (!this.wingmanSystem) return;
    this.physics.add.overlap(this.enemyBullets, this.wingmanSystem.getGroup(), (bullet, w) => {
      if (bullet.active && w.active && w.alive) this.wingmanHit(w, bullet);
    });
  }

  /**
   * 僚机受击结算。
   * 红线：绝不调用 playerHit —— 那会计入 stats.damageTaken（破 flawless/不动如山成就）、
   * 断玩家连击、并扣玩家 HP。僚机被击落对玩家的唯一代价是"火力真空 RESPAWN_MS"。
   */
  wingmanHit(w, bullet) {
    // P1-3 玩家阵亡后僚机不再被敌弹击落（与"独立生存"语义一致：玩家已亡，敌弹打僚机无意义）
    if (!this.player || !this.player.active) return;
    // P2-1 无敌期让敌弹穿过（不消弹、不扣血），符合"僚机不拦截"设计红线
    if (this.time.now < w.invulnUntil) return;
    this.killBullet(bullet);
    const downed = w.takeDamage(WINGMAN.HIT_DMG, this.time.now);
    if (downed) {
      // 僚机阵亡爆炸色：按自身元素取色（fire 橙 / thunder 黄 / 其余冰蓝）。
      // 修复：苍鹰(雷)僚机此前因缺 thunder 分支被喷成冰蓝色。
      const elColor = w.element === 'fire' ? 0xff6633 : w.element === 'thunder' ? 0xffe14a : 0x33ccff;
      VFX.explosion(this, w.x, w.y, elColor, 1.2);
    }
  }

  bindEvents() {
    // P1 超载状态：得分 ×1.2 —— 采用"延迟结算"（主分照常累计 + 超载期间另计 bonus，由
    // _flushOverchargeBonus 在每帧/结算时并入）。避免即时乘分污染同帧连续擦弹的链式增量断言
    // （qa_p2 链式擦弹探针：同帧 5 连擦的每段 +2 增量必须保持原值，见红线）。
    this._onScore = (v) => {
      if (this.overcharge && this.overcharge.active) {
        this._ocBonus += Math.round(v * ((OVERCHARGE.SCORE_MUL || 1) - 1));
      }
      this.score += v;
      EventBus.emit(EVENTS.HUD_SCORE, this.score);
    };
    EventBus.on(EVENTS.SCORE_CHANGED, this._onScore);

    this._onPlayerDied = () => {
      // 命数复活：优先消耗一命原地复活；命尽才结算失败。
      // 注意：不重置 stats.damageTaken —— 无伤/不动如山类成就仍按全局受击判定，复活不影响成就链路。
      this.lives = Math.max(0, (this.lives || 0) - 1);
      EventBus.emit(EVENTS.LIVES_CHANGED, this.lives);
      if (this.lives > 0) {
        this.respawnPlayer();
      } else if (this.mode === 'endless' && Ads.hasAds() && !this._adReviveUsed && this._offerAdRevive()) {
        // P2 激励广告位预留：无尽失败弹「看广告复活继续」面板（由 _offerAdRevive 接管；
        // 广告成功复活 1 次继续，取消/失败则走 endGame(false)）
      } else {
        this.endGame(false);
      }
    };
    EventBus.on(EVENTS.PLAYER_DIED, this._onPlayerDied);

    this._onBossDefeated = () => {
      this.requestHitStop(120);     // Boss 击破：强命中定格（P3 视觉打磨，350→120 收敛不拖沓）
      if (this.boss && this.boss.active) {
        // P2 Boss Rush 差异化：按机库稀有概率追加掉落并累计（普通模式 extraRare=0，行为不变）
        const rareChance = (this.mode === 'bossrush' && this._rushScale) ? this._rushScale.rareChance : 0;
        const rare = this.spawnBossDrops(this.boss.x, this.boss.y, rareChance);
        if (rare > 0) this._rushRareDrops = (this._rushRareDrops || 0) + rare;
        EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.boss.x, y: this.boss.y, special: true, label: t('fl_bossDown') });
      }
      // 成就系统：Boss 击败实时上报（bossKey 对应各克星/屠龙者成就）
      if (this.boss) AchievementManager.reportBossDefeated(this.boss.bossKey);
      // B13 图鉴收藏：首次击败该 Boss（独立 codex.bosses，不复用 bossesDefeated，避免污染成就语义）
      if (this.boss) Codex.record('bosses', this.boss.bossKey);
      this.boss = null;
      if (this.mode === 'bossrush') {
        this.bossRushIndex++;
        if (this.bossRushIndex < BOSS_RUSH.length) {
          this.time.delayedCall(1200, () => this.spawnBossRush());
        } else {
          this.time.delayedCall(1200, () => this.endGame(true));
        }
      } else if (this.isTower) {
        // P1 留存·深空爬塔：Boss 击破 → 层数 +1 → 记录最高层 → 弹 3 选 1 增益 → 继续下一波
        this.towerFloor = (this.towerFloor || 0) + 1;
        SaveManager.recordTowerTop(this.towerFloor);
        // A8 无尽变异：每 MUTATION_EVERY_LAYERS 层（5/10/15…）roll 一个全局变异（叠在 3 选 1 增益之上）
        if (this.towerFloor % MUTATION_EVERY_LAYERS === 0) {
          this.applyMutation();
        }
        // Boss 波结束：波次系统回 idle，等增益面板选择后 continueAfterWave 推进下一波
        if (this.waves) this.waves.state = 'idle';
        this.time.delayedCall(1200, () => {
          const shown = this.showTowerBuffPanel();
          if (!shown && this.waves && typeof this.waves.continueAfterWave === 'function') {
            this.waves.continueAfterWave();
          }
        });
      } else {
        this.time.delayedCall(1200, () => this.endGame(true));
      }
    };
    EventBus.on(EVENTS.BOSS_DEFEATED, this._onBossDefeated);

    this._onUseBomb = () => this.useBomb();
    EventBus.on(EVENTS.USE_BOMB, this._onUseBomb);

    this._onUseSuper = () => this.useSuper();
    EventBus.on(EVENTS.USE_SUPER, this._onUseSuper);

    // P2 第二主动技能：统一派发（USE_SKILL 按 activeSkill 分发）+ 切换
    this._onUseSkill = () => this.useSkill();
    EventBus.on(EVENTS.USE_SKILL, this._onUseSkill);
    this._onSkillSwitched = (id) => {
      // 带 payload = 状态广播（幂等设置，来自 _switchSkill 自身发射，防循环）；
      // 无 payload = 用户切换指令（Q / 切换箭头），执行轮换。
      if (id && SKILLS[id]) {
        this.activeSkill = id;
      } else {
        this._switchSkill();
      }
    };
    EventBus.on(EVENTS.SKILL_SWITCHED, this._onSkillSwitched);

    // 元素协同 combo 触发 -> 成就统计（combo_element_5 / combo_element_50）
    this._onWingmanCombo = (e) => { AchievementManager.reportElementCombo(e && e.element); this._addProgress('daily', 'combos', 1); }; // #每日任务：元素协同进度
    EventBus.on(EVENTS.WINGMAN_COMBO, this._onWingmanCombo);

    // P1 聚焦模式：移动端按钮切换（UIScene 发 FOCUS_TOGGLE）
    this._onFocusToggle = () => { this._focusBtnDown = !this._focusBtnDown; };
    EventBus.on(EVENTS.FOCUS_TOGGLE, this._onFocusToggle);

    // P1 留存·深空爬塔：普通波清空 → 弹 3 选 1 增益（Boss 波在 _onBossDefeated 分支处理）
    this._onWaveCleared = () => {
      if (this.isTower && !this.gameEnded) {
        const shown = this.showTowerBuffPanel();
        // 玩家已死等场景未弹面板：直接推进下一波，避免波次死锁
        if (!shown && this.waves && typeof this.waves.continueAfterWave === 'function') {
          this.waves.continueAfterWave();
        }
      }
    };
    EventBus.on(EVENTS.WAVE_CLEARED, this._onWaveCleared);

    // P2 视觉四件套⑦：作为转场目标时淡入揭示（无过渡时为 no-op，零影响）
    transition.fadeIn(this);
  }

  update(time, dt) {
    // 命中定格：真物理暂停期间用真实 dt 递减，归零即恢复（camera 演出不受影响）
    if (this._hitStopMs > 0) {
      this._hitStopMs -= dt;
      if (this._hitStopMs <= 0) {
        this._hitStopMs = 0;
        if (this.physics.world.isPaused) this.physics.world.resume();
      }
    }
    if (this.gameEnded) return;
    // P0 留存-活动轮换：倒计时 + 到期结算（复用 endGame，活动模式按规则结算）
    if (this.eventCfg && this._eventUntil) {
      const remainMs = this._eventUntil - this.time.now;
      if (remainMs <= 0) { this.endGame(true); return; }
      this._eventTimerAcc = (this._eventTimerAcc || 0) + dt;
      if (this._eventTimerAcc >= 250) {
        this._eventTimerAcc = 0;
        EventBus.emit(EVENTS.EVENT_TIMER, {
          mode: this.mode, name: this.eventCfg.name,
          left: Math.ceil(remainMs / 1000), total: this.eventCfg.duration,
        });
      }
    }
    if (this.starfield) this.starfield.update(dt);
    // P1-2/⑥-1：残留池真实时间清理由池内看门狗（performance.now 墙钟 + 链式 setTimeout）驱动，
    // 硬性保证「击杀后 4.2s 内 active 回落 0」。

    // 玩家
    const pointer = this.input.activePointer;
    if (this.player.active) {
      // P1 聚焦模式：Shift 按住（桌面）或移动端专用按钮进入
      const focusInput = (this.shiftKey && this.shiftKey.isDown) || !!this._focusBtnDown;
      this.player.setFocusing(focusInput);
      this.player.update(time, dt, pointer, this.cursors);
    }

    // 敌人（手动 update 池）
    this.enemies.children.each((e) => {
      if (e.active) e.update(time, dt);
    });

    // OPT-13 B14 元素风暴：三元素同挂检测（节流每 30 帧 ≈ 500ms；活性守卫防死敌/过期误触发）
    this._stormTick = (this._stormTick || 0) + 1;
    if (this._stormTick % 30 === 0 && this._checkStormTrigger(time)) this.elementStorm();

    // Boss
    if (this.boss && this.boss.active) {
      this.boss.update(time, dt);
      this.checkBossHits();
    }
    // 激光束持续伤害（B4，独立于 Boss）。A2：每帧累积真实 dt，按 COMBAT_PERF.HIT_CHECK_EVERY
    // 降频执行命中检测，并用累积 dt 补偿 DPS（跳帧精度补偿，平均 DPS 与旧行为等价）。
    this._beamAccDt = (this._beamAccDt || 0) + (this.game.loop.delta / 1000);
    this._beamCheckTick = (this._beamCheckTick || 0) + 1;
    if (this._beamCheckTick % COMBAT_PERF.HIT_CHECK_EVERY === 0) {
      this.checkBeamHits(this._beamAccDt);
      this._beamAccDt = 0;
    }

    // 波次
    if (this.waves) this.waves.update(time, dt);

    // 道具/僚机/磁力/增益计时
    this.items.children.each((it) => { if (it.active) it.update(time, dt); });
    if (this.wingmanSystem) {
      // 重生轮询前置于 update：update 在"僚机全灭"时会照常跑（成员还在，只是 alive=false），
      // 但玩家阵亡分支会 return —— 重生计时必须由独立入口驱动，且内部自带
      // _deadCount>0 与 player.active 双守卫，玩家阵亡时冻结、无僚机阵亡时零开销。
      this.wingmanSystem._tickRespawn(this.time.now);
      this.wingmanSystem.update(time, dt);
    }
    this.updateMagnet();
    this.checkBuffs();
    if (this.combo > 0 && this.time.now > this._comboExpire) this.breakCombo();

    // P2 过载：到期恢复射速
    this._updateOverdrive(time);
    // B11 连击蓄力·强化射击：到期恢复伤害倍率
    this._updateBurst(time);
    // P1 超载：到期恢复射速 + 得分倍率；每帧结算 bonus（真实玩法一帧内即见 ×1.2）
    this._updateOvercharge(time);
    this._flushOverchargeBonus();
    // P2 擦弹：每 CHECK_EVERY 帧遍历敌弹（玩家存活守卫在 _updateGraze 内）
    this._grazeTick = (this._grazeTick || 0) + 1;
    if (this._grazeTick % GRAZE.CHECK_EVERY === 0) this._updateGraze(time);

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
    if (this.bulletTrails || this.enemyGlow) {
      this._trailTick = (this._trailTick || 0) + 1;
      if (this._trailTick % 2 === 0) {
        if (this.bulletTrails) {
          this.playerBullets.children.each((b) => {
            if (!b.active || b.isBeam) return;
            const key = b.texture.key.replace('bullet_', '');
            const e = this.bulletTrails[key];
            if (e) e.emitParticleAt(b.x, b.y + b.height * 0.4);
          });
        }
        if (this.enemyGlow) {
          this.enemyBullets.children.each((b) => {
            if (b.active) this.enemyGlow.emitParticleAt(b.x, b.y);
          });
        }
      }
    }

    // 玩家弹柔光跟随（P3 capped 池：只照亮前 N 颗活跃弹，防滥用）
    if (this._bulletGlowPool && this._bulletGlowPool.length) {
      let gi = 0;
      this.playerBullets.children.each((b) => {
        if (!b.active || b.isBeam || gi >= this._bulletGlowPool.length) return;
        const g = this._bulletGlowPool[gi++];
        g.setPosition(b.x, b.y).setVisible(true);
      });
      for (let k = gi; k < this._bulletGlowPool.length; k++) this._bulletGlowPool[k].setVisible(false);
    }

    // 键盘炸弹
    if (Phaser.Input.Keyboard.JustDown(this.bombKey)) this.useBomb();
    // 第三版③集火指令：F 键切换僚机集火（无僚机/无目标时安全降级为空操作）
    if (Phaser.Input.Keyboard.JustDown(this.focusKey) && this.wingmanSystem) this.wingmanSystem.toggleFocus();
    // B11 连击蓄力爆发：C 键（combo 达标才生效；未达标 useBurst 内部安全返回 false）
    if (Phaser.Input.Keyboard.JustDown(this.burstKey)) this.useBurst();
  }

  /** B11 每帧：强化射击到期恢复伤害倍率（mul=1 → 零 diff；与 _updateOverdrive 同模式） */
  _updateBurst(time) {
    if (this._burstUntil && time > this._burstUntil) {
      this._burstUntil = 0;
      if (this.player) this.player.burstAtkMul = 1;
    }
  }

  /** 激光束持续 DPS（B4）：对列内敌机/Boss 结算，手动包围盒判定。
   *  A2：dt 传跳帧累积真实秒数（精度补偿）；包围盒走手算 AABB（零 Rectangle 分配）。 */
  checkBeamHits(dt) {
    if (!this.playerBeams || !this.playerBeams.children || this.playerBeams.children.size === 0) return;
    if (dt == null) dt = this.game.loop.delta / 1000;
    // P1 聚焦模式：激光束伤害同样 +DMG_MUL（与弹幕伤害一致）
    const focusDmg = (this.player && this.player.focusing && FOCUS.DMG_MUL) ? FOCUS.DMG_MUL : 1;
    const ab1 = this._ab1 || (this._ab1 = { left: 0, top: 0, right: 0, bottom: 0 });
    const ab2 = this._ab2 || (this._ab2 = { left: 0, top: 0, right: 0, bottom: 0 });
    this.playerBeams.children.each((beam) => {
      if (!beam.active) return;
      const dps = (beam.dps || 0) * focusDmg;
      this._goBounds(beam, ab1);
      this.enemies.children.each((e) => {
        if (!e.active) return;
        this._goBounds(e, ab2);
        if (ab1.left <= ab2.right && ab1.right >= ab2.left && ab1.top <= ab2.bottom && ab1.bottom >= ab2.top) {
          if (e.hit(dps * dt, beam.element)) {
            this.registerKill(e.x, e.y, { element: beam.element });
            this.addEnergy(2);
          }
        }
      });
      if (this.boss && this.boss.active) {
        // P1 可破坏护盾部位：激光（宽光束）同时命中护盾（独立 HP，不触发阶段）
        if (this.boss.shieldPart && !this.boss._shieldBroken) {
          this._goBounds(this.boss.shieldPart, ab2);
          if (ab1.left <= ab2.right && ab1.right >= ab2.left && ab1.top <= ab2.bottom && ab1.bottom >= ab2.top) {
            this.boss.hitShieldPart(dps * dt, beam.element);
          }
        }
        this._goBounds(this.boss, ab2);
        if (ab1.left <= ab2.right && ab1.right >= ab2.left && ab1.top <= ab2.bottom && ab1.bottom >= ab2.top) {
          this.boss.hit(dps * dt, beam.element);
          this._beamFxTick = (this._beamFxTick || 0) + dt;
          if (this._beamFxTick > 0.1) { VFX.hitSpark(this, this.boss.x, this.boss.y, beam.element || 'ice'); this._beamFxTick = 0; }
        }
      }
    });
  }

  /** A2 手算 AABB（零 Rectangle 分配）：语义对齐 Phaser.getBounds——含 origin/scale/rotation。
   *  复用 out 对象，避免每帧 getBounds()×N 的对象分配（GC 热点）。 */
  _goBounds(go, out) {
    const w = (go.displayWidth != null) ? go.displayWidth : go.width;
    const h = (go.displayHeight != null) ? go.displayHeight : go.height;
    const ox = (go.originX != null) ? go.originX : 0.5;
    const oy = (go.originY != null) ? go.originY : 0.5;
    const x0 = go.x - w * ox;
    const y0 = go.y - h * oy;
    if (!go.rotation) {
      out.left = x0; out.top = y0; out.right = x0 + w; out.bottom = y0 + h;
      return out;
    }
    // 旋转四角（RotateAround 语义，取轴对齐外接盒）
    const cos = Math.cos(go.rotation), sin = Math.sin(go.rotation);
    const cx = go.x, cy = go.y;
    const x1 = x0 + w, y1 = y0 + h;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const rx = cx + (px - cx) * cos - (py - cy) * sin;
      const ry = cy + (px - cx) * sin + (py - cy) * cos;
      if (rx < left) left = rx;
      if (rx > right) right = rx;
      if (ry < top) top = ry;
      if (ry > bottom) bottom = ry;
    }
    out.left = left; out.top = top; out.right = right; out.bottom = bottom;
    return out;
  }

  /** 玩家子弹 vs Boss 手动检测 */
  checkBossHits() {
    this.playerBullets.children.each((b) => {
      if (!b.active) return;
      // P1 可破坏护盾部位：优先独立判定（命中护盾扣护盾 HP，不扣 Boss HP / 不触发阶段）。
      // 炸弹（isBomb）走 _explodeBomb 全场 AOE，不进此分支。
      if (!b.isBomb && this.boss && this.boss.active && this.boss.shieldPart && !this.boss._shieldBroken
        && Phaser.Geom.Intersects.RectangleToRectangle(b.getBounds(), this.boss.shieldPart.getBounds())) {
        this.killBullet(b);
        VFX.hitSpark(this, b.x, b.y);
        this.boss.hitShieldPart(b.damage || 10, b.element);
        return;
      }
      if (this.boss && this.boss.active &&
          Phaser.Geom.Intersects.RectangleToRectangle(b.getBounds(), this.boss.getBounds())) {
        if (b.isBomb) {
          this._explodeBomb(b.x, b.y, b.explodeRadius, b.damage, b.element);
          this.killBullet(b);
          VFX.hitSpark(this, b.x, b.y);
          return;
        }
        // 穿透弹同样只对 Boss 结算一次（Boss 体积大，不去重会每帧连击）
        if (b._lastHit === this.boss) return;
        if ((b.pierce || 0) > 0) {
          b._lastHit = this.boss;
          b.pierce -= 1;
        } else {
          this.killBullet(b);
        }
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
        if (e.hit(dmg * falloff, element)) this.registerKill(e.x, e.y, { element });
      }
    });
    if (this.boss && this.boss.active) {
      const dx = this.boss.x - x, dy = this.boss.y - y;
      if (dx * dx + dy * dy <= r2) this.boss.hit(dmg * 0.6, element);
    }
    const color = element && ELEMENTS[element] ? ELEMENTS[element].color : 0xff7a3a;
    VFX.explosion(this, x, y, color, 2);
    VFX.shake(this, 'medium');
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
  spawnEnemy(x, y, typeKey, moveMode, difficulty = 1, firePattern = 'straight', elite = false, hpMul, speedMul, immune = null) {
    const e = this.enemies.get();
    if (!e) return null;
    // A9 救济局选项 A：敌人 HP/速度按休闲档（session 覆盖，不写 selectedDifficulty；得分/金币仍按所选难度）
    const cfg = this._reliefCombatMul || this.difficultyCfg || { hpMul: 1, speedMul: 1 };
    // A6 参数序：elite 在 firePattern 之后、hpMul/speedMul 之前；未传 hpMul/speedMul 时用难度档系数
    e.spawn(x, y, typeKey, moveMode, difficulty, firePattern,
      hpMul != null ? hpMul : cfg.hpMul,
      speedMul != null ? speedMul : cfg.speedMul,
      elite, immune);
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
    // 难度档 bossBulletMul 乘到 Boss.difficulty 上（Boss.js 弹速计算零改动；标准档 ×1.0）
    // A9 救济局选项 A：Boss 弹速同样按休闲档（session 覆盖）
    const bossBulletMul = (this._reliefCombatMul && this._reliefCombatMul.bossBulletMul)
      || (this.difficultyCfg && this.difficultyCfg.bossBulletMul) || 1;
    const baseDifficulty = (overrides && overrides.difficulty) || (this.level && this.level.difficulty) || 1;
    this.boss = new Boss(this, bossKey, {
      ...cfg,
      difficulty: baseDifficulty * bossBulletMul,
    });
    // Boss 柔光（P3 光效纪律白名单：机/弹/爆/拾取；随 Boss 销毁自动清理）
    if (this.boss) VFX.glowTarget(this.boss, cfg.color || COLORS.enemy, { radius: 0.75, alpha: 0.25, depth: -1 });
    // ⑤ 动态光影-Boss 环境光（P2 视觉四件套；随 BOSS_PHASE 事件相位脉冲，low 下返回 null）
    this.bossAmbient = VFX.bossAmbient(this, this.boss, cfg.color || COLORS.enemy, LIGHTS.boss);
    // P1-9 Boss 动态音乐 + UIScene 血条：boss 生成唯一入口统一 emit（原仅 rush 发，普通关 Boss 缺此事件）
    EventBus.emit(EVENTS.BOSS_SPAWNED, {
      key: bossKey,
      name: (cfg && cfg.name) || 'BOSS',
      color: cfg && cfg.color,
    });
  }

  // ---- Boss Rush 模式：连打 BOSS_RUSH 序列，血量随轮次递增 ----
  startBossRush() {
    this.bossRushIndex = 0;
    // P2 差异化：开局锁定机库缩放（hangarLv=0 时全 1.0 = 现状零回归）
    this._rushScale = bossRushScale(this._hangarLv());
    this._rushRareDrops = 0;
    this.spawnBossRush();
  }

  /** 机库等级：六项升级之和（0..30），Boss Rush 差异化输入 */
  _hangarLv() {
    const up = (SaveManager.load().upgrades) || {};
    return (up.firepower || 0) + (up.hull || 0) + (up.shield || 0)
      + (up.magnet || 0) + (up.wingman || 0) + (up.wingmanFirepower || 0);
  }

  spawnBossRush() {
    const seq = BOSS_RUSH[this.bossRushIndex];
    if (!seq) { this.endGame(true); return; }
    if (!this._rushScale) this._rushScale = bossRushScale(this._hangarLv());
    this.spawnBoss(seq.bossKey, {
      name: `BOSS RUSH ${this.bossRushIndex + 1}/${BOSS_RUSH.length} · ${seq.name}`,
      color: seq.color, pattern: seq.pattern,
      maxHp: Math.round(seq.maxHp * seq.hpMult * this._rushScale.hpMul),
      difficulty: 1.2 * this._rushScale.bulletMul,
    });
  }

  /**
   * P1 留存·深空爬塔：无尽模式每 TOWER.BOSS_EVERY 波的 Boss 波。
   * 复用 spawnBoss；bossKey 按层数轮换 BOSS_RUSH 4 Boss；层数越高血越厚、弹速越快。
   * @param {number} floor 爬塔层数（1 起；wave=10 → floor 1）
   */
  spawnTowerBoss(floor) {
    const f = Math.max(1, Math.floor(Number(floor) || 1));
    const seq = BOSS_RUSH[(f - 1) % BOSS_RUSH.length] || BOSS_RUSH[0];
    const tower = TOWER || { BOSS_HP_GROWTH: 0.18, BOSS_DIFF_GROWTH: 0.15 };
    const hpGrowth = (tower.BOSS_HP_GROWTH || 0.18) * (f - 1);
    const diffGrowth = (tower.BOSS_DIFF_GROWTH || 0.15) * (f - 1);
    this.spawnBoss(seq.bossKey, {
      name: `爬塔 ${f} 层 · ${seq.name}`,
      color: seq.color, pattern: seq.pattern,
      maxHp: Math.round(seq.maxHp * (1 + hpGrowth)),
      difficulty: 1.0 + diffGrowth,
    });
    EventBus.emit(EVENTS.FLOAT_SCORE, { x: GAME_WIDTH / 2, y: 260, special: true, label: `爬塔 ${f} 层` });
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
    AchievementManager.reportCoins(this.stats.coins);
    SaveManager.addCoins(1);
    this._addProgress('daily', 'coins', 1); // #每日任务：金币收集进度
    this._addProgress('newbie', 'coins', 1); // P0 留存-新手计划：D3 收集金币进度
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

  /** 局内火力(P)掉落（P1）：敌人死亡独立概率掉落，与普通道具互不影响 */
  maybeDropPower(x, y) {
    if (Math.random() > POWERUP.DROP_CHANCE) return;
    this.spawnItem(x, y, 'power');
  }

  /** A6/B10 精英击杀必掉：从 BOSS_DROP_TABLE 随机 1 件高价值道具（复用 spawnItem）。 */
  spawnEliteDrops(x, y) {
    const key = BOSS_DROP_TABLE[Phaser.Math.Between(0, BOSS_DROP_TABLE.length - 1)];
    if (key) this.spawnItem(
      Phaser.Math.Clamp(x + Phaser.Math.Between(-14, 14), 30, GAME_WIDTH - 30),
      Phaser.Math.Clamp(y + Phaser.Math.Between(-14, 14), 30, GAME_HEIGHT - 200),
      key,
    );
  }

  /** Boss 必掉：按 BOSS_DROP_TABLE 撒一圈高价值道具。
   *  @param {number} [extraRare=0] Boss Rush 差异化：按该概率追加稀有掉落
   *         （element_core / power / energy），返回本批稀有掉落数 */
  spawnBossDrops(x, y, extraRare = 0) {
    BOSS_DROP_TABLE.forEach((key, i) => {
      const ox = x + (i - (BOSS_DROP_TABLE.length - 1) / 2) * 46;
      const oy = y + Phaser.Math.Between(-20, 20);
      this.spawnItem(
        Phaser.Math.Clamp(ox, 30, GAME_WIDTH - 30),
        Phaser.Math.Clamp(oy, 30, GAME_HEIGHT - 200),
        key,
      );
    });
    // P2 差异化：按 rareChance 独立追加稀有掉落（hangarLv=0 → rareChance 仅 0.05，概率性追加）
    if (extraRare > 0) {
      const RARE = ['element_core', 'power', 'energy'];
      let rareCount = 0;
      for (let i = 0; i < RARE.length; i++) {
        if (Math.random() < extraRare) {
          rareCount++;
          this.spawnItem(
            Phaser.Math.Clamp(x + Phaser.Math.Between(-40, 40), 30, GAME_WIDTH - 30),
            Phaser.Math.Clamp(y + Phaser.Math.Between(-10, 40), 30, GAME_HEIGHT - 200),
            RARE[i],
          );
        }
      }
      return rareCount;
    }
    // P0 机库模块养成：低概率追加模块掉落（玩家拾取后入库存，机库面板可装备/合成）
    if (Math.random() < (MODULE_DROP_CHANCE || 0)) {
      this.spawnItem(
        Phaser.Math.Clamp(x + Phaser.Math.Between(-40, 40), 30, GAME_WIDTH - 30),
        Phaser.Math.Clamp(y + Phaser.Math.Between(-10, 40), 30, GAME_HEIGHT - 200),
        'module',
      );
    }
    return 0;
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
          if (key === 'wingman' && this.wingmanSystem) this.wingmanSystem.addWingman();
          break;
        case 'power':
          this.addPower();
          break;
        case 'module':
          // P0 机库模块养成：Boss 掉落的模块 → 随机入库存（机库面板装备/合成）
          SaveManager.addRandomModule();
          this._addProgress('daily', 'modules', 1); // P1 留存-每日任务：收集模块进度
          break;
        case 'element':
          this.rotatePlayerElement();   // 元素核心：火→冰→雷→火 轮换
          break;
        case 'weapon':
          if (this.player.setWeapon) this.player.setWeapon(def.weapon);
          AchievementManager.reportWeaponUsed(def.weapon);
          Codex.record('weapons', def.weapon);   // B13 图鉴收藏：首次使用该武器
          // P0 留存-关卡勋章：拾取武器箱 = 一次武器切换（singleWeapon 勋章要求 0 次）
          this._weaponSwitchCount = (this._weaponSwitchCount || 0) + 1;
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
    EventBus.emit(EVENTS.HUD_BOMBS, this.bombs);
  }

  addEnergy(amount) {
    this.energy = Phaser.Math.Clamp((this.energy || 0) + amount, 0, ENERGY_MAX);
    EventBus.emit(EVENTS.ENERGY_CHANGED, this.energy, ENERGY_MAX);
  }

  /** 局内火力(P)：拾取 P +1（封顶 POWERUP.MAX_LEVEL） */
  addPower() {
    this.powerLevel = this.player.setPowerLevel(this.powerLevel + 1);
    EventBus.emit(EVENTS.POWER_CHANGED, this.powerLevel);
    // P1 超载：连续拾取 P 计数（30s 窗口）
    this._registerOvercharge('p', this.time.now);
  }

  /** 局内火力(P)：受击 -1（下限 0），仅在实际受伤（非无敌/非护盾吸收）时调用 */
  losePower() {
    if (this.powerLevel <= 0) return;
    this.powerLevel = this.player.setPowerLevel(this.powerLevel - 1);
    EventBus.emit(EVENTS.POWER_CHANGED, this.powerLevel);
  }

  // ---- 元素连锁反应（二段反应）----
  /**
   * 反应伤害落地（ElementReaction 回调）。applyReaction 不触发二次反应、不飘字。
   * 致死走 registerKill，击杀来源 element 归反应归属元素（计入 element_* 成就）。
   */
  reactionHit(enemy, dmg, apply, attribute) {
    if (!enemy || !enemy.active) return false;
    const died = enemy.applyReaction(dmg, apply);
    if (died) this.registerKill(enemy.x, enemy.y, { byWingman: false, element: attribute });
    return died;
  }

  /** 反应演出反馈：EventBus 广播 + 飘分 + VFX + 音效 */
  emitReactionFeedback(name, x, y, count, element) {
    EventBus.emit(EVENTS.ELEMENT_REACTION, { name, element, count, x, y });
    if (count > 0) {
      EventBus.emit(EVENTS.FLOAT_SCORE, { x, y, amount: count * 10, special: true, label: `${name} ×${count}` });
      VFX.reactionRing(this, x, y, element);
      if (element === 'thunder') VFX.conductionArc(this, x, y);
      audio.sfx('powerup');
    }
  }

  /** 设置玩家元素（元素核心道具用）：同步 Player + 僚机 + EventBus */
  setPlayerElement(element) {
    const el = this.player.setElement(element);
    if (this.wingmanSystem) this.wingmanSystem.onPlayerElementChanged(el);
    EventBus.emit(EVENTS.ELEMENT_CHANGED, el);
    return el;
  }

  /** 元素核心轮换：火→冰→雷→火（无元素时从火起步） */
  rotatePlayerElement() {
    const ORDER = ['fire', 'ice', 'thunder'];
    const cur = this.player.shipElement;
    const idx = ORDER.indexOf(cur);
    const next = (idx < 0) ? ORDER[0] : ORDER[(idx + 1) % ORDER.length];
    return this.setPlayerElement(next);
  }

  // ---- OPT-13 B14 全屏元素风暴 ----
  /**
   * 三元素同挂检测：场上 active 敌机同时存在 fire / ice / thunder 元素状态（读 Enemy._elem）。
   * 活性守卫：
   *   - 排除死亡演出中的敌机（e._dying，死敌残留 _elem 不参与判定，防误触发）
   *   - 元素状态已全部过期（dot/slow/stun 截止均过）视为无元素（防过期残留误触发）
   */
  _checkStormTrigger(now) {
    const seen = { fire: false, ice: false, thunder: false };
    this.enemies.children.each((e) => {
      if (!e.active || e._dying || !e._elem) return;
      if (now >= (e._dotUntil || 0) && now >= (e._slowUntil || 0) && now >= (e._stunUntil || 0)) return;
      if (e._elem === 'fire') seen.fire = true;
      else if (e._elem === 'ice') seen.ice = true;
      else if (e._elem === 'thunder') seen.thunder = true;
    });
    return seen.fire && seen.ice && seen.thunder;
  }

  /**
   * 全屏元素风暴：三元素同挂触发。
   * 效果：对所有敌机大额非元素伤害（穿透免疫，走 applyReaction 直接结算）+ 清全场敌弹 +
   *       大额得分 + 全屏演出；Boss 固定伤害（Boss 无免疫标记）；Boss 战也可触发。
   * 冷却：STORM_CD（ELEMENT_STORM.cdMs）防连环触发；触发后清除敌机元素状态避免同帧再触发。
   * 已拍板：bypassCooldown=false —— 三元素反应链走 ElementReaction.onHit 尊重 REACT_CD=1200ms，
   *         不 bypass；风暴频率由独立 STORM_CD 控制。
   */
  elementStorm() {
    if (this.gameEnded) return false;
    const cfg = ELEMENT_STORM || {};
    const now = this.time.now;
    if (now < (this._stormUntil || 0)) return false;   // STORM_CD 防连环触发
    this._stormUntil = now + (cfg.cdMs || 15000);
    // 全屏演出（reduced-motion 由 VFX/shake/tween 内部降级）
    this.cameras.main.flash(420, 150, 220, 255);
    VFX.shake(this, 'heavy');
    EventBus.emit(EVENTS.FLOAT_SCORE, {
      x: this.player ? this.player.x : GAME_WIDTH / 2,
      y: (this.player ? this.player.y : 400) - 60,
      amount: cfg.score || 500, special: true, label: t('stormTitle'),
    });
    // 清全场敌弹
    if (cfg.clearBullets !== false) {
      this.enemyBullets.children.each((b) => { if (b.active) this.killBullet(b); });
    }
    // 非元素穿透伤害（穿透免疫）：applyReaction 直接结算（无受击音/飘字刷屏）
    this.enemies.children.each((e) => {
      if (!e.active || e._dying) return;
      if (e.applyReaction(cfg.dmg || 50, null)) this.registerKill(e.x, e.y);
    });
    // Boss 固定伤害（Boss 不加免疫标记，避免地狱 Boss 无解）
    if (this.boss && this.boss.active) this.boss.hit(cfg.dmg || 50);
    // 三元素反应链：对当前带元素的敌机触发二段反应（尊重 REACT_CD；bypassCooldown=false）
    if (this.elementReaction) {
      this.enemies.children.each((e) => {
        if (!e.active || e._dying || !e._elem) return;
        this.elementReaction.onHit(e, e._elem, now);
      });
    }
    // 清除敌机元素状态（避免同帧再触发）
    this.enemies.children.each((e) => {
      if (!e.active || e._dying || !e._elem) return;
      e._elem = null; e._dotUntil = 0; e._slowUntil = 0; e._stunUntil = 0;
      if (e.clearTint) e.clearTint();
    });
    EventBus.emit(EVENTS.SCORE_CHANGED, cfg.score || 500);
    return true;
  }

  /** 命中定格（hitStop）：冻结物理世界（子弹/敌机/敌弹）强化打击感；指针拖动玩家不受影响。
   *  @param {number} ms 定格时长（真实毫秒）
   *  内置 70ms 冷却防连杀卡顿；reduced-motion 下跳过。camera 演出（shake/flash）不受影响。 */
  requestHitStop(ms) {
    if (typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now < this._hitStopGapUntil) return;          // 冷却中：忽略，避免叠加卡顿
    this._hitStopGapUntil = now + 70;
    this._hitStopMs = Math.max(this._hitStopMs || 0, ms);
    if (this.physics && this.physics.world && !this.physics.world.isPaused) {
      this.physics.world.pause();
    }
  }

  /**
   * P2 体验细节·慢放子弹时间（纯演出，不改判定/数值）。
   * 将 physics.world.timeScale 降为 timeScale（默认 0.3），duration ms 后恢复 1。
   * 支持叠加：每次调用自建恢复定时器 + _slowMotionCount 计数，全部结束后才恢复，避免多层触发互相覆盖。
   * reduced-motion 偏好下跳过（不打扰动效敏感用户）。
   */
  slowMotion(duration, timeScale = 0.3) {
    if (typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scale = (timeScale && timeScale > 0 && timeScale < 1) ? timeScale : 0.3;
    this._slowMotionCount = (this._slowMotionCount || 0) + 1;
    if (this.physics && this.physics.world) this.physics.world.timeScale = scale;
    this.time.delayedCall(Math.max(50, duration || 300), () => {
      this._slowMotionCount = Math.max(0, (this._slowMotionCount || 0) - 1);
      if (this._slowMotionCount === 0 && this.physics && this.physics.world) {
        this.physics.world.timeScale = 1;
      }
    });
  }

  /** P1-8 普通命中轻震 + 玩家机微后坐：极轻 + 90ms 节流，避免高射速下持续抖动。reduced-motion 跳过后坐 */
  _impactFeedback() {
    const now = this.time.now;
    if (this._lastImpact && now - this._lastImpact < 90) return;
    this._lastImpact = now;
    VFX.shake(this, 'light');
    this.requestHitStop(33);   // 普通命中 2 帧定格（吃既有 70ms 冷却限频，连发不卡顿）
    const p = this.player;
    const reduced = (typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (p && p.active && !reduced) {
      if (p._recoilTween) p._recoilTween.stop();
      p.setScale(1, 1);
      p._recoilTween = this.tweens.add({
        targets: p, scaleY: 0.9, duration: 50, yoyo: true, ease: 'Quad.easeOut',
        onComplete: () => { if (p.active) p.setScale(1, 1); p._recoilTween = null; },
      });
    }
  }

  // ---- 连击系统（P0 体验优化）----
  /** 击杀累计连击，按倍率加分并广播给 HUD */
  registerKill(x, y, meta = {}) {
    this.combo++;
    this.requestHitStop(45);        // 命中定格：每次击杀轻微定格强化打击感（内置限频防卡顿）
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    const mult = this.comboMultiplier();
    this.stats.kills++;
    this._addProgress('daily', 'kills', 1); // #每日任务：击杀进度
    const amount = Math.round(10 * mult);
    EventBus.emit(EVENTS.SCORE_CHANGED, amount);
    EventBus.emit(EVENTS.COMBO_CHANGED, this.combo, mult);
    EventBus.emit(EVENTS.FLOAT_SCORE, { x, y, amount, mult, special: false });
    this._comboExpire = this.time.now + 2500; // 2.5s 内无击杀则断连
    // 成就系统：实时上报击杀（含来源/元素），并同步连击峰值
    AchievementManager.reportKill(meta);
    AchievementManager.reportComboPeak(this.maxCombo);
    // B13 图鉴收藏：首次击杀该类型 / 首次用该元素击杀（纯收集埋点，不影响既有结算与成就）
    if (meta.enemyType) Codex.record('enemies', meta.enemyType);
    if (meta.element) Codex.record('elements', meta.element);
    // B11 连击蓄力：击杀后广播蓄力档位变化（不 reset combo/maxCombo，峰值只增不减）
    EventBus.emit(EVENTS.BURST_CHANGED, this.combo, this.getBurstGauge());
    // P0 留存-活动轮换：金币冲刺击杀额外掉金币（池满自动丢弃，不影响玩法）
    if (this.mode === 'coin_rush' && !meta.noEventCoin) {
      const n = (this.eventCfg && this.eventCfg.extraCoinsPerKill) || 2;
      for (let i = 0; i < n; i++) {
        this.spawnCoin(x + Phaser.Math.Between(-14, 14), y + Phaser.Math.Between(-14, 14));
      }
    }
  }

  comboMultiplier() {
    // 每 5 连 +0.5 倍，最高 5x
    return 1 + Math.min(Math.floor(this.combo / 5) * 0.5, 4);
  }

  breakCombo() {
    if (this.combo > 0) EventBus.emit(EVENTS.COMBO_CHANGED, 0, 1);
    this.combo = 0;
    // B11 连击蓄力：断连后蓄力档位归 0（峰值 maxCombo/session.comboPeak 不受影响）
    EventBus.emit(EVENTS.BURST_CHANGED, 0, 0);
  }

  /**
   * B11 当前可触发蓄力档位（0/1/2/3，用于 HUD 按钮置灰）：
   *   combo >= 10 → 1（强化射击）；>= 15 → 2（+清屏）；>= 20 → 3（+回能）。
   * 只读 this.combo，绝不改 maxCombo / session.comboPeak。
   */
  getBurstGauge() {
    const tiers = (COMBO_BURST && COMBO_BURST.tiers) || [];
    let g = 0;
    for (const t of tiers) if (this.combo >= (t.needCombo || 999)) g++;
    return g;
  }

  /**
   * B11 连击蓄力爆发：消耗当前击杀 combo 触发三档累计效果。
   *   power  ≥10 强化射击：3s 伤害 ×1.5（Player.burstAtkMul）
   *   clear  ≥15 清屏：清敌弹 + 全场敌机中等伤害 + Boss 固定伤害（复用 useBomb 逻辑，不耗炸弹）
   *   energy ≥20 回能：能量槽直接充满（addEnergy / ENERGY_MAX）
   * 触发后 breakCombo()（只清 this.combo，峰值只增不减）。返回是否成功触发。
   */
  useBurst() {
    if (this.gameEnded || !this.player || !this.player.active) return false;
    const gauge = this.getBurstGauge();
    if (gauge <= 0) return false;
    const comboAtFire = this.combo;
    const cfg = (COMBO_BURST && COMBO_BURST.tiers) ? COMBO_BURST : { tiers: [] };
    for (const tier of cfg.tiers || []) {
      if (comboAtFire < (tier.needCombo || 999)) continue;
      if (tier.kind === 'power') {
        this.player.burstAtkMul = cfg.powerDmgMul || 1.5;
        this._burstUntil = this.time.now + (cfg.powerMs || 3000);
      } else if (tier.kind === 'clear') {
        this._burstClear(cfg);
      } else if (tier.kind === 'energy') {
        this.addEnergy(ENERGY_MAX);
      }
    }
    // 广播：蓄力激活（payload 含触发档位与连击），随后断连（HUD 蓄力条归零）
    EventBus.emit(EVENTS.BURST_ACTIVATED, { gauge, combo: comboAtFire });
    this.breakCombo();
    // 视觉/音效反馈（reduced-motion 由 VFX/tween 内部降级）
    this.cameras.main.flash(220, 160, 220, 255);
    VFX.shake(this, 'light');
    audio.sfx('super');
    EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.player.x, y: this.player.y - 44, special: true, label: t('chargeBurst') });
    return true;
  }

  /** B11 清屏档：清全场敌弹 + 全场敌机中等伤害 + Boss 固定伤害（复用 useBomb 清屏思路，不耗炸弹） */
  _burstClear(cfg) {
    this.enemyBullets.children.each((b) => { if (b.active) this.killBullet(b); });
    this.enemies.children.each((e) => {
      if (e.active && e.hit(cfg.clearDmg || 150)) this.registerKill(e.x, e.y);
    });
    if (this.boss && this.boss.active) this.boss.hit(cfg.clearBossDmg || 300);
    VFX.bombShockwave(this, this.player.x, this.player.y);
  }

  // ---- 擦弹 Graze（P2）----
  // 独立距离环判断：d²∈(判定圈², 擦弹环²) 且弹速达标才计一次擦弹。
  // 红线：不消弹、不结算命中、零改动既有 overlap/playerHit/invuln/registerKill/combo 逻辑。
  _updateGraze(time) {
    if (!this.player || !this.player.active) return;
    const gc = this.player.getGrazeCircle();
    const inner = PLAYER.HITBOX_RADIUS * PLAYER.HITBOX_RADIUS;   // 6² = 36（判定圈外）
    const outer = gc.r * gc.r;                                    // 24² = 576（擦弹环内）
    this.enemyBullets.children.each((b) => {
      if (!b.active) return;
      const dx = b.x - gc.x, dy = b.y - gc.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= inner || d2 >= outer) return;                     // 判定圈内 / 环外都不算
      const spd = (b.body && b.body.velocity) ? b.body.velocity.length() : 0;
      if (spd < GRAZE.MIN_SPEED) return;                          // 静止/极慢弹不计
      if (b._grazedAt != null && (time - b._grazedAt) < GRAZE.RE_GRAZE_MS) return; // 同弹冷却
      b._grazedAt = time;
      this._grantGraze(b.x, b.y);
    });
  }

  /** 结算一次擦弹：回能 + 得分（2s 链式加分封顶 +15）+ 飘字 + 广播 GRAZE_CHANGED */
  _grantGraze(x, y) {
    const now = this.time.now;
    // 链式窗口：2s 内连续擦弹每段 +2，总加成封顶 CHAIN_MAX(+15)
    if (now <= (this._grazeChainUntil || 0)) {
      this.grazeChain = Math.min((this.grazeChain || 0) + 1, GRAZE.CHAIN_MAX);
    } else {
      this.grazeChain = 0;
    }
    this._grazeChainUntil = now + GRAZE.CHAIN_WINDOW;
    this.grazeCount = (this.grazeCount || 0) + 1;
    const chainBonus = Math.min(this.grazeChain * GRAZE.CHAIN_SCORE, GRAZE.CHAIN_MAX);
    const total = GRAZE.SCORE + chainBonus;
    // A8 擦弹之泉变异：擦弹回能 ×2^N（非塔模式恒 1）
    const grazeEnergyMul = (this.mutations && this.mutations.grazeWell)
      ? Math.pow(2, this.mutations.grazeWell) : 1;
    this.addEnergy(Math.round(GRAZE.ENERGY_GAIN * grazeEnergyMul));
    EventBus.emit(EVENTS.SCORE_CHANGED, total);
    EventBus.emit(EVENTS.FLOAT_SCORE, { x, y, amount: total, special: true, label: t('fl_graze') });
    EventBus.emit(EVENTS.GRAZE_CHANGED, { count: this.grazeCount, chain: this.grazeChain });
    this._addProgress('newbie', 'grazes', 1); // P0 留存-新手计划：D6 擦弹进度
    this._addProgress('daily', 'grazes', 1); // P1 留存-每日任务：累计擦弹进度
    // P1 超载：连续擦弹计数（30s 窗口）
    this._registerOvercharge('graze', now);
  }

  // ---- P1 战斗扩展·超载状态（局内临时，不入存档）----
  /** 累计超载触发计数：type = 'p'（拾 P）/ 'graze'（擦弹）。窗口内连续达成 → 触发。 */
  _registerOvercharge(type, now) {
    const cfg = OVERCHARGE;
    const st = type === 'p' ? this._ocP : this._ocGraze;
    const threshold = type === 'p' ? cfg.P_STACK : cfg.GRAZE_STACK;
    if (now - (st.lastAt || 0) > (cfg.WINDOW || 30000)) st.count = 1;
    else st.count = (st.count || 0) + 1;
    st.lastAt = now;
    if (st.count >= threshold) {
      this._triggerOvercharge(now);
    } else {
      this._emitOverchargeHud();
    }
  }

  /** 触发超载：射速 ×1.3（间隔 ×1/1.3）+ 得分 ×1.2，持续 DURATION */
  _triggerOvercharge(now) {
    const cfg = OVERCHARGE;
    this.overcharge.active = true;
    this.overcharge.until = now + (cfg.DURATION || 5000);
    this.overcharge.duration = cfg.DURATION || 5000;
    // setOverchargeMul 接收"射速间隔倍率"（1/1.3 ≈ 0.77 = 射速 ×1.3），与 overdrive 槽独立叠加
    this.player.setOverchargeMul(1 / cfg.FIRE_MUL);
    this._ocP.count = 0;
    this._ocGraze.count = 0;
    EventBus.emit(EVENTS.OVERCHARGE_STATE, {
      active: true, until: this.overcharge.until, duration: this.overcharge.duration, p: 0, graze: 0,
    });
    // 视觉反馈（reduced-motion 由 VFX 降级）
    this.cameras.main.flash(200, 90, 200, 130);
    EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.player.x, y: this.player.y - 44, special: true, label: t('fl_overcharge') });
  }

  /** 每帧：超载到期恢复（射速倍率回退 + 得分倍率自动随 active 关闭） */
  _updateOvercharge(time) {
    if (this.overcharge && this.overcharge.active && time > this.overcharge.until) {
      this.overcharge.active = false;
      this.overcharge.until = 0;
      this.player.setOverchargeMul(null);
      EventBus.emit(EVENTS.OVERCHARGE_STATE, {
        active: false, until: 0, duration: 0, p: this._ocP.count, graze: this._ocGraze.count,
      });
    }
  }

  /** 超载得分 bonus 结算：把超载期间累计的 +20% 并入总分（每帧/结算调用，幂等） */
  _flushOverchargeBonus() {
    if (this._ocBonus) {
      this.score += this._ocBonus;
      this._ocBonus = 0;
      EventBus.emit(EVENTS.HUD_SCORE, this.score);
    }
  }

  /** 广播超载 HUD（蓄力进度），供 UIScene 小图标进度条渲染 */
  _emitOverchargeHud() {
    EventBus.emit(EVENTS.OVERCHARGE_STATE, {
      active: this.overcharge.active,
      until: this.overcharge.until,
      duration: this.overcharge.duration,
      p: this._ocP.count, graze: this._ocGraze.count,
    });
  }

  // ---- 僚机子弹工厂（僚机 AI 进阶）----
  /**
   * 发射一发僚机子弹。复用 playerBullets 现有池，不新建组。
   * @param {number} x 发射点
   * @param {number} y 发射点
   * @param {number} ang 弧度
   * @param {{element:?string, weaponLv:number, byWingman:boolean}} opts
   * @returns {Phaser.Physics.Arcade.Sprite|null} 池满时返回 null
   *
   * 红线：每发子弹必须写入 byWingman=true 与 element=玩家元素，
   *       否则 registerKill -> AchievementManager.reportKill 的
   *       wingman_first / wingman_50 / element_* 统计会断链。
   */
  spawnWingmanBullet(x, y, ang, opts = {}) {
    const maxLv = WINGMAN.WEAPON_LV.length - 1;
    const lv = Phaser.Math.Clamp(opts.weaponLv || 0, 0, maxLv);
    const cfg = WINGMAN.WEAPON_LV[lv];
    const b = this.playerBullets.get(x, y, cfg.key);
    if (!b) return null;

    // 池复用时 Group.get 不会改贴图（拿到的可能是上一发导弹/散射），必须显式重设，
    // 否则僚机弹会顶着导弹外观飞出去；setTexture 会改 width/height，故放在 setSize 之前。
    if (b.texture.key !== cfg.key) b.setTexture(cfg.key);
    b.setActive(true).setVisible(true);
    b.body.enable = true;
    b.homing = !!cfg.homing;         // 第三版④：追踪导弹复用 steerHomingBullets 转向；非导弹档恒 false
    b.isBomb = false;
    b.setScale(1, 1);                // 第三版④：复位缩放，避免激光拉伸污染池复用
    if (cfg.laser) b.setScale(1, 2.6); // 穿透激光：纵向拉伸成光束观感（命中盒用纹理尺寸，不随之放大）
    b.pierce = cfg.pierce || 0;      // >0 时命中后不销毁（穿透档）
    b._lastHit = null;
    b.damage = BULLET.PLAYER_DMG * cfg.dmgMul;
    // ↓↓↓ 成就链路红线：僚机来源 + 玩家元素 ↓↓↓
    b.byWingman = true;
    b.element = opts.element || null;

    // 元素协同 combo 增益：激活期内僚机弹伤害 x DMG_MUL（只作用于僚机弹，不碰主炮）
    const comboMul = this.wingmanSystem ? this.wingmanSystem.getComboMul(this.time.now) : 1;
    if (comboMul > 1) b.damage *= comboMul;

    const bw = b.width, bh = b.height;
    b.body.setSize(bw * 0.6, bh * 0.7);
    b.setRotation(ang + Math.PI / 2);

    // 染色优先级：协同增益色 > lv3 元素弹色。两者都记 _wmTinted，回收时统一清除。
    const comboTint = comboMul > 1 && this.wingmanSystem ? this.wingmanSystem.getComboTint(this.time.now) : 0;
    if (comboTint) {
      b.setTint(comboTint);
      b._wmTinted = true;
    } else if (cfg.laser) {
      // 第三版④穿透激光：激光青染色；回收时在 killBullet 里 clearTint 清除
      b.setTint(0x66ffff);
      b._wmTinted = true;
    } else if (cfg.tinted && b.element && ELEMENTS[b.element]) {
      // 元素弹（lv3）按元素染色；回收时在 killBullet 里清除，避免污染主炮子弹
      b.setTint(ELEMENTS[b.element].color);
      b._wmTinted = true;
    }

    this.physics.velocityFromRotation(ang, BULLET.PLAYER_SPEED, b.body.velocity);
    return b;
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


  /** 命数复活：原地回满血复活 + 清屏救场（清除敌弹），不重置 damageTaken */
  respawnPlayer() {
    const p = this.player;
    p.revive(this.playerSpawnX, this.playerSpawnY, this.time.now + PLAYER.RESPAWN_INVULN);

    // A9 救济局复活福利：追加「临时火力 +1 持续 2 秒」（独立临时字段，不写 powerLevel）
    if (this._reliefRun && RELIEF.reviveFireBonusMs > 0) {
      p.tempFireBonusUntil = this.time.now + RELIEF.reviveFireBonusMs;
    }

    // 清屏救场：清掉所有敌弹，给玩家安全空间
    this.enemyBullets.children.each((b) => {
      if (b.active) this.killBullet(b);
    });

    // 复活闪光 + 震屏（reduced-motion 由 VFX 内部降级）
    VFX.shake(this, 'medium');
    EventBus.emit(EVENTS.HP_CHANGED, p.hp, p.maxHp);
  }

  /**
   * P2 激励广告位预留：无尽失败弹「看广告复活继续」面板。
   * 广告成功 -> 复活 1 次继续；取消/失败 -> 走 endGame(false)。每局最多一次。
   * 纯 UI：不改任何 hp/score/判定/连击核心逻辑。
   * @returns {boolean} 面板是否弹出
   */
  _offerAdRevive() {
    if (this.gameEnded || this._adReviveUsed) return false;
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(800);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.66)
      .setOrigin(0).setInteractive();
    const panel = this.add.rectangle(cx, cy, 440, 250, 0x0d2236, 0.98)
      .setStrokeStyle(2, COLORS.accent);
    const title = this.add.text(cx, cy - 66, t('adReviveTitle'), {
      fontFamily: 'sans-serif', fontSize: '34px', fontStyle: '800', color: COLORS.accent,
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 8, true, true);
    const sub = this.add.text(cx, cy - 20, t('adReviveSub'), {
      fontFamily: 'sans-serif', fontSize: '18px', color: '#cfe8ff',
    }).setOrigin(0.5);
    ov.add([dim, panel, title, sub]);

    let done = false;
    const finish = (revive) => {
      if (done) return;
      done = true;
      this._adReviveOpen = false;
      this._adReviveCtl = null;
      if (ov.active) ov.destroy();
      this._adReviveOverlay = null;
      if (this.physics && this.physics.world && this.physics.world.isPaused) this.physics.world.resume();
      if (revive) {
        this._adReviveUsed = true;
        this.lives = 1;
        EventBus.emit(EVENTS.LIVES_CHANGED, this.lives);
        this.respawnPlayer();
      } else {
        this.endGame(false);
      }
    };

    const adBtn = new NeonButton(this, cx - 100, cy + 62, t('adReviveBtn'), {
      w: 190, glow: true,
      onDown: () => {
        audio.sfx('ui');
        adBtn.setEnabled(false);
        sub.setText(t('adPlaying'));
        Ads.showRewardAd((ok) => {
          if (ok) {
            sub.setText(t('adReviveOk'));
            this.time.delayedCall(260, () => finish(true));
          } else {
            sub.setText(t('adReviveFail'));
            adBtn.setEnabled(true);
          }
        });
      },
    });
    const quitBtn = new NeonButton(this, cx + 100, cy + 62, t('adQuit'), {
      w: 190, glow: true, onDown: () => { audio.sfx('ui'); finish(false); },
    });
    ov.add([adBtn.container, quitBtn.container]);

    // 面板弹出期间冻结物理世界（玩家已死，敌弹/敌机静止；复活时恢复）
    if (this.physics && this.physics.world) this.physics.world.pause();
    this._adReviveOpen = true;
    this._adReviveOverlay = ov;
    // 测试钩子（与 window.__SKY 同性质，不影响玩法）
    this._adReviveCtl = { adBtn, quitBtn, finish, overlay: ov, title, sub };
    return true;
  }

  // ---- P1 留存·深空爬塔：每波结束 3 选 1 随机增益 ----
  /** 从 TOWER_BUFFS 随机抽 3 个不同增益 */
  rollTowerBuffOptions() {
    const pool = (TOWER_BUFFS || []).slice();
    const out = [];
    while (out.length < 3 && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  /**
   * 弹「3 选 1 增益」面板：暂停物理世界，玩家选择后应用增益并继续下一波。
   * 纯局内临时：towerBonuses 不入存档，复用 Player/GameScene 既有机制。
   * @returns {boolean} 面板是否弹出（玩家已死/游戏结束等场景返回 false，调用方应继续推进波次）
   */
  showTowerBuffPanel() {
    if (this.gameEnded || this._towerBuffOpen || !this.player || !this.player.active) return false;
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(800);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setOrigin(0).setInteractive();
    const panel = this.add.rectangle(cx, cy, 460, 430, 0x0d2236, 0.98)
      .setStrokeStyle(2, COLORS.accent);
    const title = this.add.text(cx, cy - 158, t('towerTitle'), {
      fontFamily: 'sans-serif', fontSize: '30px', fontStyle: '800', color: COLORS.accent,
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 8, true, true);
    const sub = this.add.text(cx, cy - 112, this.isTower ? t('towerSubTower', { floor: this.towerFloor || 0 }) : t('towerSubPick'), {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#cfe8ff',
    }).setOrigin(0.5);
    ov.add([dim, panel, title, sub]);

    const opts = this.rollTowerBuffOptions();
    let done = false;
    const finish = (pickId) => {
      if (done) return;
      done = true;
      this._towerBuffOpen = false;
      this._towerBuffOverlay = null;
      if (ov.active) ov.destroy();
      if (this.physics && this.physics.world && this.physics.world.isPaused) this.physics.world.resume();
      if (pickId) this.applyTowerBuff(pickId);
      if (this.waves && typeof this.waves.continueAfterWave === 'function') this.waves.continueAfterWave();
    };

    opts.forEach((b, i) => {
      const by = cy - 40 + i * 96;
      const card = this.add.container(cx, by).setDepth(801);
      const bg = this.add.rectangle(0, 0, 400, 80, 0x123a5a, 0.98)
        .setStrokeStyle(2, COLORS.accent);
      card.add(bg);
      card.add(this.add.text(-170, -14, t(`tb_${b.id}`), {
        fontFamily: 'sans-serif', fontSize: '22px', fontStyle: '800', color: '#aef6ff',
      }).setOrigin(0, 0.5));
      card.add(this.add.text(-170, 18, t(`tb_${b.id}_desc`), {
        fontFamily: 'sans-serif', fontSize: '15px', color: '#88bbdd',
      }).setOrigin(0, 0.5));
      card.setSize(400, 80).setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-200, -40, 400, 80),
        hitAreaCallback: (rect, x, y) => rect.contains(x, y),
        useHandCursor: true,
      });
      card.on('pointerover', () => bg.setFillStyle(0x1b5580, 1));
      card.on('pointerout', () => bg.setFillStyle(0x123a5a, 0.98));
      card.on('pointerdown', () => { audio.sfx('ui'); finish(b.id); });
      ov.add(card);
    });

    // 面板弹出期间冻结物理世界（选择后恢复；与广告复活面板同款）
    if (this.physics && this.physics.world) this.physics.world.pause();
    this._towerBuffOpen = true;
    this._towerBuffOverlay = ov;
    // 测试钩子（与 window.__SKY 同性质，不影响玩法）
    this._towerBuffCtl = { opts, finish, overlay: ov, open: true };
    return true;
  }

  /**
   * 应用一项爬塔增益（幂等叠加，全部走既有机制）：
   *   fireRate → player.setFireRateMul（×0.9^N） / extraShot → towerExtraShots
   *   speed → towerSpeedMul（×1.08^N） / graze → towerGrazeExtra +8 / hp → maxHp+20 / coin → 结算 ×1.2^N
   */
  applyTowerBuff(id) {
    const b = this.towerBonuses || (this.towerBonuses = { fireRate: 0, extraShot: 0, speed: 0, graze: 0, hp: 0, coin: 0 });
    const p = this.player;
    if (!p) return;
    switch (id) {
      case 'fireRate':
        b.fireRate = (b.fireRate || 0) + 1;
        this._refreshFireRate();   // A8：与 rapidFire 变异合并重算（tower × mutation）
        break;
      case 'extraShot':
        b.extraShot = (b.extraShot || 0) + 1;
        p.towerExtraShots = (p.towerExtraShots || 0) + 1;
        break;
      case 'speed':
        b.speed = (b.speed || 0) + 1;
        p.towerSpeedMul = Math.pow(1.08, b.speed);
        break;
      case 'graze':
        b.graze = (b.graze || 0) + 1;
        p.towerGrazeExtra = (p.towerGrazeExtra || 0) + 8;
        if (p.grazeRing && p.grazeRing.setRadius) p.grazeRing.setRadius(p.getGrazeCircle().r);
        break;
      case 'hp':
        b.hp = (b.hp || 0) + 1;
        p.maxHp += 20;
        p.hp = Math.min(p.maxHp, p.hp + 20);
        EventBus.emit(EVENTS.HP_CHANGED, p.hp, p.maxHp);
        break;
      case 'coin':
        b.coin = (b.coin || 0) + 1;
        break;
      default:
        break;
    }
    EventBus.emit(EVENTS.FLOAT_SCORE, { x: p.x, y: p.y - 44, special: true, label: t('fl_buff') });
  }

  // ───────────────────────────────────────────────────────────────
  // A9 连续失败救济局（仅 normal 主线）
  // 触发：failStreak[levelId] >= RELIEF.failStreakThreshold（create 判定，_reliefEligible）
  // 面板三选一：
  //   A 降低难度：本局 session 覆盖休闲档战斗系数（不写 selectedDifficulty 存档）
  //   B 临时增益：+1 命（默认）或 攻击 +10%（子按钮二选一）
  //   拒绝：按原难度硬刚（_reliefRun 保持 false，计数保留）
  // 任何救济接受 → _reliefRun=true + AchievementManager.setIgnore(true)（成就全程抑制）
  // ───────────────────────────────────────────────────────────────

  /** 全局守卫：救济局返回 false（该局「写盘/成就/排行/勋章」链路短路），其余 true */
  _shouldRecordPersist() {
    return !this._reliefRun;
  }

  /**
   * D1 P2 修复：统一局内「每日任务 / 新手计划」持久化进度入账守卫。
   * 救济局(_reliefRun=true)不累加进度（防刷）；局内金币入账、击杀/连击等实时统计不受影响。
   * @param {'daily'|'newbie'} type
   * @param {string} key
   * @param {number} [n=1]
   */
  _addProgress(type, key, n = 1) {
    if (!this._shouldRecordPersist()) return;
    if (type === 'newbie') SaveManager.addNewbieProgress(key, n);
    else SaveManager.addDailyProgress(key, n);
  }

  /**
   * 弹「救济提示」面板三选一（静态弹窗 + 按钮，无粒子；reduced-motion 零动画）。
   * 面板弹出期间冻结物理世界，选择后恢复并开始本局。
   * @returns {boolean} 面板是否弹出
   */
  showReliefPanel() {
    if (this.gameEnded || this._reliefOpen || !this.player || !this.player.active) return false;
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(800);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setOrigin(0).setInteractive();
    const panel = this.add.rectangle(cx, cy, 460, 500, 0x0d2236, 0.98)
      .setStrokeStyle(2, COLORS.accent);
    const title = this.add.text(cx, cy - 192, t('reliefTitle'), {
      fontFamily: 'sans-serif', fontSize: '28px', fontStyle: '800', color: COLORS.accent,
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 8, true, true);
    const sub = this.add.text(cx, cy - 150, t('reliefSub', { level: this.levelId, n: SaveManager.getFailStreak(this.levelId) }), {
      fontFamily: 'sans-serif', fontSize: '15px', color: '#cfe8ff',
    }).setOrigin(0.5);
    ov.add([dim, panel, title, sub]);

    let done = false;
    const finish = (pickId, buffChoice) => {
      if (done) return;
      done = true;
      this._reliefOpen = false;
      this._reliefOverlay = null;
      if (ov.active) ov.destroy();
      if (this.physics && this.physics.world && this.physics.world.isPaused) this.physics.world.resume();
      if (pickId) this._applyRelief(pickId, buffChoice);
    };

    // 选项 A：降低难度（整卡可点）
    const mkCard = (y, titleText, descText, stroke, cb, subBtns) => {
      const card = this.add.container(cx, y).setDepth(801);
      const bg = this.add.rectangle(0, 0, 400, subBtns ? 92 : 66, 0x123a5a, 0.98)
        .setStrokeStyle(2, stroke);
      card.add(bg);
      card.add(this.add.text(-180, subBtns ? -26 : -16, titleText, {
        fontFamily: 'sans-serif', fontSize: '21px', fontStyle: '800', color: '#aef6ff',
      }).setOrigin(0, 0.5));
      card.add(this.add.text(-180, subBtns ? 4 : 16, descText, {
        fontFamily: 'sans-serif', fontSize: '14px', color: '#88bbdd',
      }).setOrigin(0, 0.5));
      if (subBtns) {
        subBtns.forEach((sb, i) => {
          const bw = 150, bx = -92 + i * 184;
          const btn = this.add.rectangle(bx, 34, bw, 42, 0x1b5580, 1)
            .setStrokeStyle(1, sb.stroke || COLORS.accent).setInteractive({ useHandCursor: true });
          const lbl = this.add.text(bx, 34, sb.label, {
            fontFamily: 'sans-serif', fontSize: '17px', fontStyle: '800', color: sb.color || '#eaf6ff',
          }).setOrigin(0.5);
          btn.on('pointerover', () => btn.setFillStyle(0x2a6a9a, 1));
          btn.on('pointerout', () => btn.setFillStyle(0x1b5580, 1));
          btn.on('pointerdown', () => { audio.sfx('ui'); finish('tempBuff', sb.key); });
          card.add([btn, lbl]);
        });
      } else if (cb) {
        card.setSize(400, 66).setInteractive({
          hitArea: new Phaser.Geom.Rectangle(-200, -33, 400, 66),
          hitAreaCallback: (rect, x, y) => rect.contains(x, y),
          useHandCursor: true,
        });
        card.on('pointerover', () => bg.setFillStyle(0x1b5580, 1));
        card.on('pointerout', () => bg.setFillStyle(0x123a5a, 0.98));
        card.on('pointerdown', () => { audio.sfx('ui'); cb(); });
      }
      ov.add(card);
      return card;
    };

    mkCard(cy - 92, t('reliefLowerDiff'), t('reliefLowerDiffDesc'), COLORS.accent,
      () => finish('lowerDiff'));
    // 选项 B：临时增益 —— 子按钮「+1 命（默认）/ 攻击 +10%」
    mkCard(cy + 4, t('reliefTempBuff'), t('reliefTempBuffDesc'), 0xffd54a, null, [
      { key: 'life', label: t('reliefBuffLife'), stroke: 0xffd54a, color: '#ffe9a0' },
      { key: 'atk', label: t('reliefBuffAtk'), stroke: 0xff9a4a, color: '#ffd0a0' },
    ]);
    mkCard(cy + 100, t('reliefDecline'), t('reliefDeclineDesc'), 0x88bbdd,
      () => finish(null));

    // 面板弹出期间冻结物理世界（选择后恢复；与爬塔增益/广告复活面板同款）
    if (this.physics && this.physics.world) this.physics.world.pause();
    this._reliefOpen = true;
    this._reliefOverlay = ov;
    // 测试钩子（与 window.__SKY 同性质，不影响玩法）
    this._reliefCtl = { finish, overlay: ov, open: true, decline: () => finish(null) };
    return true;
  }

  /**
   * 应用救济选择（仅本局，不持久化、不叠加；每次救济局独立结算）。
   *   lowerDiff：session 覆盖休闲档战斗系数（不写 selectedDifficulty；得分/金币仍按所选难度）
   *   tempBuff 'life'：lives +RELIEF.tempBuffLife（默认 +1）
   *   tempBuff 'atk' ：Player.reliefAtkMul = 1 + RELIEF.tempBuffAtk（主炮/导弹/炸弹/激光 DPS 消费）
   * 接受任何救济 → _reliefRun=true + AchievementManager.setIgnore(true)（成就全程抑制）
   */
  _applyRelief(pickId, buffChoice) {
    this._reliefRun = true;
    AchievementManager.setIgnore(true);
    const p = this.player;
    if (pickId === 'lowerDiff') {
      this._reliefCombatMul = getDifficulty(RELIEF.lowerDiff) || this.difficultyCfg;
      if (p) EventBus.emit(EVENTS.FLOAT_SCORE, { x: p.x, y: p.y - 44, special: true, label: t('reliefLowerDiff') });
    } else if (pickId === 'tempBuff') {
      if (buffChoice === 'atk') {
        this._reliefAtkPicked = true;
        if (p) p.reliefAtkMul = 1 + (RELIEF.tempBuffAtk || 0);
      } else {
        this.lives = (this.lives || 0) + (RELIEF.tempBuffLife || 1);
        EventBus.emit(EVENTS.LIVES_CHANGED, this.lives);
      }
      if (p) EventBus.emit(EVENTS.FLOAT_SCORE, { x: p.x, y: p.y - 44, special: true, label: t('reliefTempBuff') });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // A8 无尽变异规则（深空爬塔全局变异层，叠在 TOWER_BUFFS 3 选 1 之上）
  // 触发：towerFloor % MUTATION_EVERY_LAYERS === 0（5/10/15… 层 Boss 波通关后）
  // 正面 5 / 负面 4；负面生效前 1s 先出警示（不可静默生效）；幂等叠加，局内临时不入存档。
  // 普通关 / BossRush / 活动模式 mutations 为空 → _mutationMul 全 1.0（零回归）。
  // ───────────────────────────────────────────────────────────────

  /**
   * roll 一个变异并进入待生效状态。
   * 负面：先 emit warning（生效前 1s 警示），1s 后 _commitMutation 真正生效；
   * 正面：立即生效。
   * @returns {{id:string, polarity:string, name:string, desc:string, stats:Object}}
   */
  applyMutation() {
    const m = rollMutation();
    const result = { id: m.id, polarity: m.polarity, name: m.name, desc: m.desc, stats: m.stats || {} };
    if (m.polarity === 'negative') {
      // 负面变异不可静默生效：先警示文字，1s 后再落地
      EventBus.emit(EVENTS.MUTATION_CHANGED, { ...result, type: 'warning', label: t('mutWarning') });
      this.time.delayedCall(1000, () => {
        // D4 P3 修复：延迟内玩家死亡不再静默丢弃——仅本局结束时跳过。
        // 死亡等待 / 广告复活 / 命数复活期间照常落地（_commitMutation 对 player 全判空安全，
        // 磁力/护盾等计时器在复活后自然生效；stack 标记必叠，不丢变异）。
        if (this.gameEnded) return;
        this._commitMutation(result);
      });
    } else {
      this._commitMutation(result);
    }
    return result;
  }

  /** 变异真正落地：幂等叠加 + 直接生效型 apply + emit applied（UIScene 横幅/图标） */
  _commitMutation(m) {
    const stack = this.mutations || (this.mutations = {});
    stack[m.id] = (stack[m.id] || 0) + 1;
    const p = this.player;
    const def = MUTATIONS[m.id] || {};
    switch (def.apply) {
      case 'magnet':   // 磁力风暴：全屏吸金 6s
        this.buffs.magnetUntil = this.time.now + 6000;
        EventBus.emit(EVENTS.MAGNET_CHANGED, true);
        break;
      case 'shield':   // 过载护盾：8s 护盾 + 回血 10
        this.buffs.shieldUntil = this.time.now + 8000;
        if (p) { p.hp = Math.min(p.maxHp, p.hp + 10); EventBus.emit(EVENTS.HP_CHANGED, p.hp, p.maxHp); }
        EventBus.emit(EVENTS.SHIELD_CHANGED, true);
        break;
      case 'fireRate': // 急速射击：与 tower fireRate 合并重算
        this._refreshFireRate();
        break;
      case 'coin':     // 双倍金币：endGame 结算消费
      case 'grazeEnergy': // 擦弹之泉：_grantGraze 消费
      case 'bulletSpeed': // 弹速风暴：_mutationMul().bulletSpeed 消费（敌/Boss 弹速）
      case 'grazeRadius': // 擦弹环缩小：_mutationMul().grazeRadius（接口预留，后续接线）
      case 'incomingDmg': // 玻璃大炮：playerHit 消费
      case 'spawn':       // 蜂群：_mutationMul 接口预留（WaveSystem 后续接线）
        break;
      default:
        break;
    }
    EventBus.emit(EVENTS.MUTATION_CHANGED, {
      id: m.id, polarity: m.polarity, name: m.name, desc: m.desc, stats: m.stats || {}, type: 'applied',
    });
  }

  /**
   * 当前变异对战斗数值的倍率（新配置键，标准路径全 1.0 = 零回归）。
   * @returns {{dmg:number, hp:number, speed:number, bulletSpeed:number, grazeRadius:number, incomingDmg:number}}
   */
  _mutationMul() {
    const out = { dmg: 1, hp: 1, speed: 1, bulletSpeed: 1, grazeRadius: 1, incomingDmg: 1 };
    if (!this.isTower || !this.mutations) return out;
    for (const id in this.mutations) {
      const n = this.mutations[id];
      const def = MUTATIONS[id];
      if (!def || !def.stats) continue;
      const s = def.stats;
      if (s.dmgMul) out.dmg *= Math.pow(s.dmgMul, n);
      if (s.hpMul) out.hp *= Math.pow(s.hpMul, n);
      if (s.speedMul) out.speed *= Math.pow(s.speedMul, n);
      if (s.bulletSpeedMul) out.bulletSpeed *= Math.pow(s.bulletSpeedMul, n);
      if (s.grazeRadiusMul) out.grazeRadius *= Math.pow(s.grazeRadiusMul, n);
      if (s.incomingDmgMul) out.incomingDmg *= Math.pow(s.incomingDmgMul, n);
    }
    return out;
  }

  /** 合并 tower fireRate + rapidFire 变异，统一写 player.setFireRateMul（默认 1 = 零回归） */
  _refreshFireRate() {
    const p = this.player;
    if (!p || !p.setFireRateMul) return;
    const tower = Math.pow(0.9, (this.towerBonuses && this.towerBonuses.fireRate) || 0);
    const mut = Math.pow(1 / 1.2, (this.mutations && this.mutations.rapidFire) || 0);
    p.setFireRateMul(tower * mut);
  }

  playerHit(dmg) {
    // 护盾激活时吸收全部伤害
    if (this.time.now < (this.buffs.shieldUntil || 0)) return;
    // A8 玻璃大炮变异：受击伤害 ×1.3^N（非塔模式恒 1）
    dmg *= this._mutationMul().incomingDmg;
    // 是否真正"落地"：无敌期内敌弹穿过不视为受击（不扣火力，避免 1.5s 内连掉多级）
    const landed = this.time.now >= (this.player.invulnUntil || 0);
    this.stats.damageTaken += dmg;
    this.player.takeDamage(dmg);
    this.breakCombo(); // 受击断连
    if (landed) this.losePower(); // 受击火力 -1（下限 0）
  }

  useBomb() {
    if (this.bombs <= 0 || this.gameEnded) return;
    this.bombs--;
    this._addProgress('daily', 'bombs', 1); // #每日任务：清屏炸弹进度
    EventBus.emit(EVENTS.HUD_BOMBS, this.bombs);

    // 清屏冲击波
    this.cameras.main.flash(300, 120, 200, 255);
    VFX.shake(this, 'heavy');
    VFX.bombShockwave(this, this.player.x, this.player.y);
    this.requestHitStop(250);       // 炸弹：强命中定格

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
    AchievementManager.reportSuperUsed();
    this._addProgress('daily', 'super', 1); // #每日任务：星风暴进度
    EventBus.emit(EVENTS.ENERGY_CHANGED, 0, ENERGY_MAX);

    const skill = SKILLS[DEFAULT_SKILL] || SKILLS.starstorm;
    // 强视觉：闪光 + 震屏
    this.cameras.main.flash(450, 180, 230, 255);
    VFX.shake(this, 'catastrophic');

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

  /** 第二主动技能（P2）统一派发：按当前 activeSkill 分发 starstorm / overdrive（能量满才生效） */
  useSkill() {
    if (this.gameEnded) return;
    if ((this.energy || 0) < ENERGY_MAX) return;
    const key = this.activeSkill || DEFAULT_SKILL;
    const skill = SKILLS[key] || SKILLS.starstorm;
    if (skill.kind === 'buff') {
      this.useOverdrive();
    } else {
      this.useSuper();   // screen_clear（星风暴）：复用既有实现，消耗能量 + 清屏重创
    }
  }

  /** 过载：短时射速翻倍（buff）。不消弹、不结算命中，到期由 _updateOverdrive 恢复 */
  useOverdrive() {
    if (this.gameEnded) return;
    if ((this.energy || 0) < ENERGY_MAX) return;
    this.energy = 0;
    EventBus.emit(EVENTS.ENERGY_CHANGED, 0, ENERGY_MAX);
    this.player.setFireRateMul(OVERDRIVE.FIRE_MUL);
    this._overdriveUntil = this.time.now + OVERDRIVE.DURATION;
    EventBus.emit(EVENTS.OVERDRIVE_STATE, { active: true, until: this._overdriveUntil, duration: OVERDRIVE.DURATION });
    // 轻量视觉反馈：闪光 + 轻震 + 飘字（reduced-motion 由 VFX/tween 内部降级）
    this.cameras.main.flash(280, 120, 200, 255);
    VFX.shake(this, 'light');
    EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.player.x, y: this.player.y - 44, special: true, label: t('fl_overdrive') });
  }

  /** 技能切换：星风暴 ↔ 过载 轮换。激活中的过载 buff 不中断（fireMul 独立于技能槽） */
  _switchSkill() {
    const order = ['starstorm', 'overdrive'];
    const cur = this.activeSkill || DEFAULT_SKILL;
    const idx = order.indexOf(cur);
    this.activeSkill = order[(idx + 1) % order.length];
    EventBus.emit(EVENTS.SKILL_SWITCHED, this.activeSkill);
    audio.sfx('ui');
  }

  /** 每帧：过载到期恢复射速（mul=1 → 零 diff） */
  _updateOverdrive(time) {
    if (this._overdriveUntil && time > this._overdriveUntil) {
      this._overdriveUntil = 0;
      this.player.setFireRateMul(1);
      EventBus.emit(EVENTS.OVERDRIVE_STATE, { active: false, until: 0, duration: 0 });
    }
  }

  /** 星风暴视觉：多发星弹横扫 + 粒子爆发 */
  spawnStarstormVisual() {
    const p = this.add.particles(this.player.x, this.player.y, 'particle_dot', {
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
    // 僚机进阶新增字段：回收即复位，避免池复用把穿透/元素染色带到玩家主炮子弹上
    if (b.pierce) b.pierce = 0;
    if (b._lastHit) b._lastHit = null;
    if (b._wmTinted) { b._wmTinted = false; }
    // A4 池复用复位契约（append-only）：敌弹 eHoming / 玩家弹 homing / isBomb / element / damage
    // 全部复位——Boss.spawnBulletAt 等路径不重设 eHoming，复用追踪弹会残留转向（C3 幽灵转向）；
    // 各 spawn 路径都会重写所需字段，此处复位零副作用。
    if (b.eHoming) b.eHoming = false;
    if (b.homing) b.homing = false;
    if (b.isBomb) { b.isBomb = false; }
    b.element = null;
    b.damage = 0;
    // clearTint 无条件执行：combo 染色路径与 lv3 元素弹共用 _wmTinted，但历史上存在
    // 只 setTint 未置标记的分支；无条件清一次成本可忽略，能彻底杜绝主炮弹被染色残留。
    b.clearTint();
    // byWingman 必须无条件复位：Player.fire() 只写 element/damage，从不写 byWingman=false，
    // 僚机弹回收后被 Group.get() 复用给主炮时会残留 true，导致主炮击杀被 registerKill
    // 误计入 wingman_50/wingman_first（且已持久化不可逆）。僚机每次发射都会重设 true，不影响僚机统计。
    b.byWingman = false;
    b.setRotation(0);   // P1-1 旋转不变量：僚机任意角度弹回收后主炮复用不再残留旋转
    b.setScale(1, 1);   // 第三版④：复位缩放，杜绝激光拉伸污染主炮/其他僚机弹
  }

  recycleBullets() {
    // 四边界剔除：旧逻辑只判 y < -30，前提是"主炮弹恒向上"。僚机进阶后子弹按任意角度
    // 发射（含朝下/近水平），这类弹永远飞不到 y<-30 → 永久 active → playerBullets 池
    // (maxSize 200) 耗尽 → get() 返回 null → 主炮哑火。与下方 enemyBullets 判定对齐。
    this.playerBullets.children.each((b) => {
      if (b.active && (b.y < -30 || b.y > GAME_HEIGHT + 30 || b.x < -30 || b.x > GAME_WIDTH + 30)) {
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

    // A9 连续失败救济局（仅 normal 主线）：
    //   failStreak/reliefRuns 为唯一计数（胜 归0 / 负 +1；救济局照常计数，恢复逻辑不变）
    if (this.mode === 'normal') {
      if (victory) SaveManager.resetFailStreak(this.levelId);
      else SaveManager.incFailStreak(this.levelId);
    }
    if (this._reliefRun) SaveManager.incReliefRuns();
    // A9 全局守卫：救济局短路下方「写盘/成就/排行/勋章」链路（金币照常入账）
    const recordPersist = this._shouldRecordPersist();

    // P0 留存-活动轮换：事件模式结算按活动规则（金币冲刺 ×2 / 限时生存 按波次），不计星级/勋章/关卡进度
    const eventCfg = this.eventCfg;
    const isEvent = !!eventCfg;
    const isNormal = this.mode === 'normal';

    // 结算星级（活动模式跳过，stars=0 不触发完美通关类成就）
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
    if (isEvent) stars = 0;

    if (victory && isNormal && recordPersist) SaveManager.recordLevelStars(this.levelId, stars);

    // P0 四档难度结算：得分 ×scoreMul，金币 ×coinMul（标准档全 1.0 = 现状零回归）。
    // 金币在局中已按 1:1 入账；这里仅对正差额（困难/地狱档）补发，休闲/标准档不回退，避免"低难度倒扣金币"的诡异体验。
    // P1 超载：结算前并入未结算的超载 bonus（+20% 得分，局内临时）
    this._flushOverchargeBonus();
    const scoreMul = (this.difficultyCfg && this.difficultyCfg.scoreMul) || 1;
    const coinMul = (this.difficultyCfg && this.difficultyCfg.coinMul) || 1;
    // P1 留存·深空爬塔：局内「金币 +20%」增益（towerBonuses.coin 次 → 结算 ×1.2^N）
    const towerCoinMul = (this.isTower && this.towerBonuses && this.towerBonuses.coin > 0)
      ? Math.pow(1.2, this.towerBonuses.coin) : 1;
    // A8 双倍金币变异：金币 ×2^N（非塔模式恒 1）
    const mutationCoinMul = (this.isTower && this.mutations && this.mutations.doubleCoin)
      ? Math.pow(2, this.mutations.doubleCoin) : 1;
    const scaledScore = Math.round(this.score * scoreMul);
    const coinTarget = Math.round(this.stats.coins * coinMul * towerCoinMul * mutationCoinMul);
    let coinDelta = coinTarget - this.stats.coins;
    // P2 Boss Rush 差异化：机库等级金币倍率补发（hangarLv=0 → coinMul=1 → 零 diff）。
    // rushReward 透传给 ResultScene 展示「Boss Rush 奖励」行。
    const rushReward = (victory && this.mode === 'bossrush') ? {
      hangarLv: this._hangarLv(),
      coinMul: (this._rushScale && this._rushScale.coinMul) || 1,
      rareDrops: this._rushRareDrops || 0,
    } : null;
    if (rushReward) coinDelta += Math.round(this.stats.coins * (rushReward.coinMul - 1));

    // P0 留存-活动轮换：金币冲刺结算金币 ×2（周末双倍再 ×2）；限时生存按波次给金币
    let eventReward = null;
    if (isEvent && victory) {
      if (this.mode === 'coin_rush') {
        const mult = (eventCfg.coinMul || 2) * (this.eventDouble ? 2 : 1);
        const total = Math.round(this.stats.coins * mult);
        coinDelta = Math.max(0, total - this.stats.coins);
        eventReward = { kind: 'coin_rush', coins: total, mult, double: !!this.eventDouble };
      } else if (this.mode === 'survival') {
        const waves = this.waves ? this.waves.currentWave : 0;
        const per = eventCfg.coinPerWave || 8;
        const total = waves * per * (this.eventDouble ? 2 : 1);
        coinDelta = Math.max(0, total - this.stats.coins);
        eventReward = { kind: 'survival', waves, per, coins: total, double: !!this.eventDouble };
      }
    }

    if (coinDelta > 0) SaveManager.addCoins(coinDelta);
    const finalCoins = coinDelta > 0 ? this.stats.coins + coinDelta : this.stats.coins;

    // 最高分存档：比较 scaledScore 与全局 bestScore，破纪录则写回（胜负都记）
    // A9 救济局不更新 bestScore（救济有加成，避免刷最高分）
    const isNewBest = recordPersist ? SaveManager.recordBestScore(scaledScore) : false;
    const bestScore = SaveManager.getBestScore();

    // P2 系统扩展·无尽周赛：无尽模式分数写入 league（取本周最高，纯本地假组）
    if (recordPersist && this.mode === 'endless') SaveManager.recordLeagueScore(scaledScore);

    // P1 留存·每日活跃宝箱：每局游玩 +1（endGame 唯一入口，一次性计数；救济局也算游玩）
    SaveManager.addDailyAct();

    // P1 留存·社交排行（本地）：每次结算插入历史 Top10（按 score 降序，最多 10 条）
    // A9 救济局不入榜（防救济加成刷榜）
    // OPT-13 批B B15 分享卡：同关+同模式「排除本局」的历史最高分（只读 topScores，零写入；
    // 必须在 addTopScore 插入本局之前捕获，否则会把本局分数误当成历史基准）
    const prevSameBest = recordPersist
      ? SaveManager.getTopScores()
          .filter((s) => s && s.levelId === this.levelId && s.mode === this.mode)
          .reduce((m, s) => Math.max(m, Number(s.score) || 0), 0)
      : 0;
    const topScoreRes = recordPersist ? SaveManager.addTopScore({
      score: scaledScore,
      levelId: this.levelId,
      mode: this.mode,
      date: SaveManager._todayStr(),
    }) : { entered: false, rank: -1, list: SaveManager.getTopScores() };

    // P1 留存·深空爬塔：记录最高层数（towerFloor 为本次已通过 Boss 波数）
    let towerTop = 0;
    let isNewTowerTop = false;
    if (recordPersist && this.isTower) {
      const prev = SaveManager.getTowerTop();
      towerTop = SaveManager.recordTowerTop(this.towerFloor || 0);
      isNewTowerTop = (this.towerFloor || 0) > 0 && (this.towerFloor || 0) > prev;
    }

    // P0 留存-新手计划：跨模式累计进度（与 addDailyProgress 一样不立即存盘，由下方 save() 统一 flush）
    // A9 救济局跳过每日任务/新手计划进度（防刷），金币照常入账
    if (recordPersist && this.mode === 'normal') {
      if (victory) {
        SaveManager.addNewbieProgress('clears', 1);      // D1 通关任意关
        SaveManager.addNewbieProgress('levelClears', 1); // D7 累计通关关数
        SaveManager.addDailyProgress('clears', 1);       // P1 留存-每日任务：通关任意一关
      }
    } else if (recordPersist && this.mode === 'bossrush') {
      if (victory) {
        SaveManager.addNewbieProgress('bossRushClears', 1); // D4 通关 Boss Rush
        SaveManager.addDailyProgress('bossRushClears', 1);  // P1 留存-每日任务：通关 Boss Rush
      }
    } else if (recordPersist && this.mode === 'endless') {
      const w = this.waves ? this.waves.currentWave : 0;
      SaveManager.addNewbieProgress('endlessWaves', w); // D5 无尽波次
      SaveManager.addDailyProgress('endlessWaves', w);  // P1 留存-每日任务：无尽累计波数
    }

    SaveManager.flushNow(); // A1 结算关键路径立即同步落盘（flush 每日任务/新手计划进度，不丢结算数据）

    // P0 留存-关卡勋章：普通关胜利后按关卡 challenges 判定达成（killRate 用 stats.kills/spawned；
    // timeLimit 用耗时；singleWeapon 用局内武器切换次数===0）
    let achievedMedals = [];
    if (victory && isNormal && recordPersist) {
      const lvl = LEVELS.find((l) => l.id === this.levelId);
      if (lvl && Array.isArray(lvl.challenges) && lvl.challenges.length) {
        const elapsedSec = (this.time.now - (this._levelStartTime || this.time.now)) / 1000;
        for (const ch of lvl.challenges) {
          let ok = false;
          if (ch.type === 'killRate') ok = (this.stats.kills / spawned) >= (ch.target || 1);
          else if (ch.type === 'timeLimit') ok = elapsedSec <= (ch.target || 60);
          else if (ch.type === 'singleWeapon') ok = (this._weaponSwitchCount || 0) === 0;
          if (ok) achievedMedals.push(ch.id);
        }
        if (achievedMedals.length) SaveManager.recordLevelMedals(this.levelId, achievedMedals);
      }
    }

    const result = {
      victory, stars, score: scaledScore,
      bestScore, isNewBest,
      kills: this.stats.kills, coins: finalCoins,
      levelId: this.levelId, composite,
      mode: this.mode, wave: this.waves ? this.waves.currentWave : 0,
      maxCombo: this.maxCombo || 0,   // UI P2：结算页连击峰值面板（纯展示数据透传）
      rushReward,                     // P2 Boss Rush 差异化：{ hangarLv, coinMul, rareDrops }
      achievedMedals,                 // P0 留存-关卡勋章：本局达成勋章 id 列表
      ship: { id: this._runShipId != null ? this._runShipId : 0, skin: this._runSkinId != null ? this._runSkinId : 0 }, // P2 皮肤装饰：结算页战机立绘用
      eventReward,                    // P0 留存-活动轮换：活动模式结算明细
      event: eventCfg ? { name: eventCfg.name, short: eventCfg.short, double: !!this.eventDouble, daysLeft: this.eventDaysLeft } : null,
      // P1 留存·深空爬塔：本次层数 + 历史最高（结算页展示）
      towerFloor: this.isTower ? (this.towerFloor || 0) : 0,
      towerTop,
      isNewTowerTop,
      towerCoinMul,
      // P1 留存·社交排行：本局是否入 Top10 及名次（-1=未入榜）
      topRank: topScoreRes ? topScoreRes.rank : -1,
      topList: topScoreRes ? topScoreRes.list : [],
      // OPT-13 批B B15 分享卡：同关同模式排除本局的历史最高分（0=无历史 → 首秀）+ 本局难度（边框强调色）
      prevSameBest,
      difficulty: (this.difficultyCfg && this.difficultyCfg.id) || 'standard',
    };

    // 成就评估（#成就）：事件已实时上报，这里做局末兜底评估（无伤/通关/BossRush 等）。
    // 活动模式胜利不计"通关任意一关/无伤"类成就（victory 仅透传给结算展示，reportRun 按活动压制）
    // A9 救济局 ignore=true：reportRun 短路写盘与解锁（AchievementManager 全程抑制）
    result.newAchievements = AchievementManager.reportRun({
      victory: isEvent ? false : victory,
      mode: this.mode,
      stars,
      levelId: this.levelId,
      damageTaken: this.stats.damageTaken,
      ignore: !recordPersist,
    });

    this.time.delayedCall(600, () => {
      // P2 视觉四件套⑦：带过渡切结算；淡出完成后先停并行 HUD（与旧行为一致），再切 Result
      transition.goto(this, SCENES.RESULT, result, {
        beforeStart: () => this.scene.stop(SCENES.UI),
      });
    });
  }

  // ---- 首玩教程（#教程）：首次进入游戏分步引导，暂停世界避免被击杀 ----
  showTutorial() {
    this.physics.pause();
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(600);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setOrigin(0);
    const panel = this.add.rectangle(cx, cy, 470, 300, 0x0d2236, 0.98)
      .setStrokeStyle(2, COLORS.accent);
    const steps = [
      t('tutStep1'),
      t('tutStep2'),
      t('tutStep3'),
      t('tutStep4'),
      t('tutStep5'),
      t('tutStep6'),
    ];
    let i = 0;
    const txt = this.add.text(cx, cy - 66, steps[0], {
      fontFamily: 'sans-serif', fontSize: '19px', color: '#cfe8ff', align: 'center',
      wordWrap: { width: 420 },
    }).setOrigin(0.5);
    const dots = this.add.text(cx, cy + 44, '● ○ ○ ○ ○ ○', {
      fontFamily: 'sans-serif', fontSize: '16px', color: COLORS.accent,
    }).setOrigin(0.5);
    const nextBtn = this.add.text(cx + 120, cy + 105, t('tutNext'), {
      fontFamily: 'sans-serif', fontSize: '20px', fontStyle: '700', color: '#7cf3ff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const skipBtn = this.add.text(cx - 120, cy + 105, t('tutSkip'), {
      fontFamily: 'sans-serif', fontSize: '20px', fontStyle: '700', color: '#88bbdd',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const render = () => {
      txt.setText(steps[i]);
      let d = '';
      for (let k = 0; k < steps.length; k++) d += (k === i ? '● ' : '○ ');
      dots.setText(d.trim());
      nextBtn.setText(i < steps.length - 1 ? t('tutNext') : t('tutStart'));
    };
    const finish = () => {
      SaveManager.set('tutorialDone', true);
      this.physics.resume();
      ov.destroy();
      this._tutorialCtl = null;
    };
    const advance = () => {
      if (i < steps.length - 1) { i++; render(); } else finish();
    };
    nextBtn.on('pointerdown', advance);
    skipBtn.on('pointerdown', finish);
    this.input.keyboard.once('keydown-ESC', finish); // 兜底：ESC 也能关闭教程，避免卡死
    // 自动化真测钩子（不影响玩法，与 window.__SKY 同性质）
    this._tutorialCtl = { advance, finish, getStep: () => i, total: steps.length };
    ov.add([dim, panel, txt, dots, nextBtn, skipBtn]);
    render();
  }

  cleanup() {
    EventBus.off(EVENTS.SCORE_CHANGED, this._onScore);
    EventBus.off(EVENTS.PLAYER_DIED, this._onPlayerDied);
    EventBus.off(EVENTS.BOSS_DEFEATED, this._onBossDefeated);
    EventBus.off(EVENTS.USE_BOMB, this._onUseBomb);
    EventBus.off(EVENTS.USE_SUPER, this._onUseSuper);
    EventBus.off(EVENTS.USE_SKILL, this._onUseSkill);
    EventBus.off(EVENTS.SKILL_SWITCHED, this._onSkillSwitched);
    EventBus.off(EVENTS.WINGMAN_COMBO, this._onWingmanCombo);
    EventBus.off(EVENTS.FOCUS_TOGGLE, this._onFocusToggle);
    EventBus.off(EVENTS.WAVE_CLEARED, this._onWaveCleared);
    audio.unbindGameEvents();
    // 无尽看广告复活：清理面板并恢复物理（避免切场景残留冻结）
    if (this._adReviveOverlay) { this._adReviveOverlay.destroy(); this._adReviveOverlay = null; }
    // P1 留存·深空爬塔：清理 3 选 1 增益面板并恢复物理
    if (this._towerBuffOverlay) { this._towerBuffOverlay.destroy(); this._towerBuffOverlay = null; }
    // A9 连续失败救济局：清理救济提示面板并恢复物理（避免切场景残留冻结）
    if (this._reliefOverlay) { this._reliefOverlay.destroy(); this._reliefOverlay = null; }
    this._reliefOpen = false;
    if (this.physics && this.physics.world && this.physics.world.isPaused) this.physics.world.resume();
    if (this.wingmanSystem) { this.wingmanSystem.destroy(); this.wingmanSystem = null; }
    if (this.starfield) this.starfield.destroy();
    // P1-1：切场景残留归零——销毁残留池（焦痕/粒子清空，game._vfxResidue.active 归零）
    if (this.residuePool && typeof this.residuePool.destroy === 'function') {
      this.residuePool.destroy();
      this.residuePool = null;
    }
  }
}
