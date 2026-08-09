/**
 * 全局游戏配置与平衡常量
 * ---------------------------------------------------------------------------
 * 这是整个项目的"单一事实来源"。所有场景/实体/系统读这里的常量，
 * 严禁在各自文件里硬编码魔法数字。团队并行开发时，改平衡只动这一个文件。
 */

// 逻辑分辨率（竖版）。Phaser Scale.FIT 会把它等比缩放到任意屏幕。
export const GAME_WIDTH = 540;
export const GAME_HEIGHT = 960;

// 场景 key —— 全局唯一，跨场景跳转全用这些常量，避免拼写错误
export const SCENES = {
  BOOT: 'BootScene',
  PRELOAD: 'PreloadScene',
  MENU: 'MenuScene',
  GAME: 'GameScene',
  UI: 'UIScene',
  RESULT: 'ResultScene',
};

// EventBus 事件名 —— 跨场景/系统通信的契约。新增事件先在这里登记。
export const EVENTS = {
  // 战斗数值
  SCORE_CHANGED: 'score-changed',
  HP_CHANGED: 'hp-changed',
  ENERGY_CHANGED: 'energy-changed',
  COMBO_CHANGED: 'combo-changed',
  // 关卡流程
  WAVE_STARTED: 'wave-started',
  WAVE_CLEARED: 'wave-cleared',
  BOSS_SPAWNED: 'boss-spawned',
  BOSS_HP_CHANGED: 'boss-hp-changed',
  BOSS_DEFEATED: 'boss-defeated',
  LEVEL_CLEARED: 'level-cleared',
  // 拾取/升级
  POWERUP_COLLECTED: 'powerup-collected',
  COIN_COLLECTED: 'coin-collected',
  // 生命周期
  PLAYER_HIT: 'player-hit',
  PLAYER_DIED: 'player-died',
  GAME_OVER: 'game-over',
  // 玩家技能
  USE_BOMB: 'use-bomb',
  USE_SUPER: 'use-super',
  // 状态指示（#151 道具/技能系统追加，append-only）
  SHIELD_CHANGED: 'shield-changed',
  MAGNET_CHANGED: 'magnet-changed',
  // 飘分（d-float）：击杀/吃币/特殊事件时在场景内浮动显示得分，payload={x,y,amount,mult,special,label}
  FLOAT_SCORE: 'float-score',
  ACHIEVEMENT_UNLOCKED: 'achievement-unlocked',
  // 武器切换（B/C 武器系统）：payload = (weaponKey, durationMs)
  WEAPON_CHANGED: 'weapon-changed',
  // 僚机 AI 进阶（第一版仅定义，独立生存/战术分工在第二版接入）
  WINGMAN_DESTROYED: 'wingman-destroyed',   // payload = { slot, x, y }
  WINGMAN_RESPAWNED: 'wingman-respawned',   // payload = { slot, x, y }
  WINGMAN_COMBO: 'wingman-combo',           // payload = { element, count }
  WINGMAN_STATUS: 'wingman-status',         // payload = { count, weaponLv, element, comboMul, members:[{alive,respawnRemainMs,element}] }（HUD 僚机指示，第三版起步）
};

// 玩家基础属性
export const PLAYER = {
  MAX_HP: 100,
  SPEED: 420,          // px/s，指针/键盘移动的跟随速度上限
  FIRE_INTERVAL: 140,  // ms，基础射速
  HITBOX_RADIUS: 6,    // 判定圈半径（比机身小，弹幕游戏惯例）
  RESPAWN_INVULN: 1500,// ms，复活/受击后无敌时长
  START_LIVES: 3,
  START_BOMBS: 3,
};

// 子弹
export const BULLET = {
  PLAYER_SPEED: 700,
  ENEMY_SPEED: 260,
  PLAYER_DMG: 10,
  MISSILE_SPEED: 420,   // 导弹初速（慢于主炮，便于转向追踪）
  MISSILE_DMG: 28,      // 导弹单发伤害（B3 追踪导弹）
  // B4 激光束：持续光束，按命中时长结算 DPS
  LASER_DPS: 130,       // 激光每秒伤害
  LASER_WIDTH: 16,      // 光束半宽（px，命中判定用）
  // B5 元素炸弹：下坠抛射物，到达目标/屏底爆炸产生 AOE
  BOMB_SPEED: 320,      // 炸弹下坠速度
  BOMB_DMG: 50,         // 炸弹 AOE 单发伤害
  BOMB_RADIUS: 120,     // 爆炸半径
  ENEMY_BULLET_TRACK_TURN: 0.045, // 敌弹 tracking 每帧最大转角（弧度，C3）
};

// 关卡制（Sky Force 风格：分关，每关有波次 + Boss）
// 每关字段说明：
//   difficulty 难度系数（作用到敌人 HP/速度、Boss 弹速）
//   theme      地图色调（背景渐变 skyTop/skyBottom + 星空 4 层染色 starTints + 强调色 accent）
//   boss       该关 Boss 配置 { maxHp, pattern(弹幕形态), name, color }
//   wavePlan   数据表驱动波次：数组，每项是 { count: 本波敌人数, comp: [[type, mode, weight], ...] }
//              WaveSystem 按权重抽取敌人组合；缺失时退回程序化兜底。
export const LEVELS = [
  {
    id: 1, name: '近地轨道', bg: 'bg_orbit', waves: 6, bossKey: 'boss_sentinel',
    difficulty: 1.0,
    theme: {
      skyTop: 0x0b1c33, skyBottom: 0x040a16,
      starTints: [0x2a4a6a, 0x6f9fd6, 0xbfe0ff, 0x66ccff],
      accent: 0x66ccff,
      nebula: { tints: [0x3a1f6e, 0x1f3a6e], alpha: 0.16 },
      cloudTint: 0x9fd8ff,
      silhouette: { kind: 'none', color: 0x0a0f1c, density: 1, speed: 40 },
    },
    boss: { maxHp: 2600, pattern: 'fan', name: '哨兵 Sentinel', color: 0x66ccff },
    wavePlan: [
      { count: 6,  comp: [['small', 'straight', 1]] },
      { count: 8,  comp: [['small', 'straight', 1], ['small', 'sine', 1]] },
      { count: 8,  comp: [['small', 'straight', 1], ['small', 'sine', 2]] },
      { count: 7,  comp: [['small', 'sine', 2], ['mid', 'straight', 1]] },
      { count: 9,  comp: [['small', 'straight', 1], ['small', 'dive', 1], ['mid', 'sine', 1]] },
      { count: 10, comp: [['small', 'sine', 2], ['mid', 'straight', 1], ['mid', 'dive', 1]] },
    ],
  },
  {
    id: 2, name: '陨石带', bg: 'bg_belt', waves: 7, bossKey: 'boss_crusher',
    difficulty: 1.3,
    theme: {
      skyTop: 0x2a1408, skyBottom: 0x0a0604,
      starTints: [0x6a3a1a, 0xd68f4a, 0xffb070, 0xff7a3a],
      accent: 0xff7a3a,
      nebula: { tints: [0x6a2f0a, 0x3a1a08], alpha: 0.18 },
      cloudTint: 0xd68f4a,
      silhouette: { kind: 'asteroid', color: 0x0a0604, density: 1, speed: 46 },
    },
    boss: { maxHp: 3300, pattern: 'spiral', name: '粉碎者 Crusher', color: 0xff9a4a },
    wavePlan: [
      { count: 8,  comp: [['small', 'straight', 1], ['small', 'sine', 1]] },
      { count: 9,  comp: [['small', 'sine', 2], ['mid', 'straight', 1]] },
      { count: 10, comp: [['small', 'straight', 1], ['small', 'dive', 2], ['mid', 'sine', 1]] },
      { count: 10, comp: [['small', 'sine', 2], ['mid', 'straight', 1], ['mid', 'dive', 1]] },
      { count: 11, comp: [['small', 'dive', 2], ['mid', 'straight', 1], ['mid', 'sine', 2], ['diver', 'dive', 1]] },
      { count: 12, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1], ['diver', 'dive', 1]] },
      { count: 13, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['mid', 'sine', 1], ['mid', 'dive', 1], ['diver', 'dive', 1]] },
    ],
  },
  {
    id: 3, name: '敌方要塞', bg: 'bg_fortress', waves: 8, bossKey: 'boss_overlord',
    difficulty: 1.7,
    theme: {
      skyTop: 0x1a0f33, skyBottom: 0x070414,
      starTints: [0x4a2a6a, 0x9a6fd6, 0xc9bfff, 0xb98bff],
      accent: 0xb98bff,
      nebula: { tints: [0x3a1f6e, 0x6a2f8a], alpha: 0.18 },
      cloudTint: 0x9a6fd6,
      silhouette: { kind: 'building', color: 0x070414, density: 1, speed: 42 },
    },
    boss: { maxHp: 4200, pattern: 'cross', name: '霸主 Overlord', color: 0x66ff99 },
    wavePlan: [
      { count: 9,  comp: [['small', 'straight', 1], ['mid', 'straight', 1]] },
      { count: 10, comp: [['small', 'sine', 2], ['mid', 'straight', 1], ['mid', 'dive', 1]] },
      { count: 11, comp: [['small', 'dive', 2], ['mid', 'sine', 2], ['mid', 'straight', 1]] },
      { count: 12, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1]] },
      { count: 12, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['mid', 'sine', 2]] },
      { count: 13, comp: [['small', 'dive', 2], ['mid', 'sine', 2], ['mid', 'straight', 2], ['diver', 'dive', 1]] },
      { count: 14, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1], ['mid', 'sine', 1], ['diver', 'dive', 1]] },
      { count: 16, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['small', 'sine', 1], ['mid', 'dive', 1], ['mid', 'sine', 1], ['diver', 'dive', 1]] },
    ],
  },
];

// Boss Rush 序列（独立于主线 3 关）：连打现有 3 个 Boss，血量随轮次递增。
// pattern / name / color 直接取自各关 Boss 配置，避免重复定义。
export const BOSS_RUSH = [
  { bossKey: 'boss_sentinel', name: '哨兵 Sentinel', color: 0x66ccff, pattern: 'fan',    maxHp: 2600, hpMult: 1.0 },
  { bossKey: 'boss_crusher',  name: '粉碎者 Crusher', color: 0xff9a4a, pattern: 'spiral',  maxHp: 3300, hpMult: 1.15 },
  { bossKey: 'boss_overlord',  name: '霸主 Overlord',  color: 0x66ff99, pattern: 'cross',  maxHp: 4200, hpMult: 1.3 },
];

// 星级评分阈值（每关结束按这些维度算 1~3 星 + 完成度百分比）
export const RATING = {
  // 三项各占权重，加权后映射到星级
  WEIGHTS: { enemiesKilled: 0.5, coinsCollected: 0.3, noDamage: 0.2 },
  STARS: [0.4, 0.7, 0.9], // >=40%一星，>=70%两星，>=90%三星
};

// 部件升级树（收集金币后升级：火力/机体/护盾/磁力/僚机）
export const UPGRADE_TREE = {
  firepower: { name: '主炮', max: 8, baseCost: 200, costMul: 1.5 },
  hull:      { name: '装甲', max: 6, baseCost: 300, costMul: 1.6 },
  shield:    { name: '护盾', max: 5, baseCost: 400, costMul: 1.7 },
  magnet:    { name: '磁力', max: 4, baseCost: 250, costMul: 1.5 },
  wingman:   { name: '僚机', max: 2, baseCost: 800, costMul: 2.0 },
  // 僚机火力：与"僚机数量"并存的独立升级项，决定 WINGMAN.WEAPON_LV 档位（0~3）
  wingmanFirepower: { name: '僚机火力', max: 5, baseCost: 600, costMul: 1.8 },
};

// 中国股市/涨跌无关，这里是玩家阵营配色（青蓝科技风）
export const COLORS = {
  player: 0x66ccff,
  playerBullet: 0x8fe3ff,
  enemy: 0xff5a6e,
  enemyBullet: 0xff5a3c,  // 红橙（A2 敌弹发光球；与俯冲机机体色拉开明度）
  coin: 0xffd54a,
  bg: 0x05070f,
  accent: 0x7cf3ff,
};

// 音频（程序化 WebAudio，主控/音效/BGM 音量）
export const AUDIO = { master: 0.5, sfx: 0.6, bgm: 0.16 };

// 本地存档 key
export const SAVE_KEY = 'sky_raiders_save_v1';

// ───────────────────────────────────────────────────────────────
// 元素属性系统（B6）：火=灼烧DoT / 冰=减速 / 雷=麻痹
// 玩家武器可携带 element，命中敌机/Boss 时施加对应状态。
// ───────────────────────────────────────────────────────────────
export const ELEMENTS = {
  fire:    { key: 'fire',    name: '火', color: 0xff7a3a, dot: 12,   duration: 3000, label: '灼烧' },
  ice:     { key: 'ice',     name: '冰', color: 0x6fd6ff, slow: 0.45, duration: 3000, label: '冰冻' },
  thunder: { key: 'thunder', name: '雷', color: 0xffe14a, stun: 1100, duration: 1100, label: '麻痹' },
};

// 武器元信息（HUD 指示器 / 武器箱展示用）
export const WEAPONS = {
  pulse:   { key: 'pulse',   name: '脉冲机枪', short: '脉冲' },
  missile: { key: 'missile', name: '追踪导弹', short: '导弹' },
  laser:   { key: 'laser',   name: '激光束',   short: '激光' },
  bomb:    { key: 'bomb',    name: '元素炸弹', short: '炸弹' },
};

// 战机（C2 武器绑定）：每架绑定默认武器 + 元素属性
// 机库选择 selectedShip（索引）后，开局即装备该战机的武器与元素。
export const SHIPS = [
  { id: 0, name: '苍鹰', weapon: 'pulse',  element: 'thunder', tint: 0x66ccff, desc: '均衡机枪机·雷麻痹' },
  { id: 1, name: '赤焰', weapon: 'missile', element: 'fire',  tint: 0xff7a3a, desc: '导弹机·火灼烧' },
  { id: 2, name: '寒霜', weapon: 'laser',   element: 'ice',   tint: 0x9ff0ff, desc: '激光机·冰减速' },
];

// ───────────────────────────────────────────────────────────────
// 僚机 AI 进阶（第一版：编队跟随 + 智能走位 + 武器/火力进化）
// 消费方：entities/Wingman.js（单体行为）+ systems/WingmanSystem.js（集合管理）
// 这里是僚机所有数值的唯一来源，严禁在实体/系统里硬编码偏移与射速。
// ───────────────────────────────────────────────────────────────
export const WINGMAN = {
  MAX: 4,               // 僚机硬上限（含道具临时僚机）
  DEPTH: 18,
  SCALE: 0.9,
  FOLLOW_LERP: 0.15,    // 编队跟随插值系数（与旧实现一致，保证手感不变）
  BASE_HP: 3,           // 独立生存：僚机血量（第二版接 enemyBullets overlap 后生效）
  RESPAWN_MS: 4000,     // 击落后重生冷却（第二版由 WingmanSystem._tickRespawn 轮询）
  HIT_DMG: 1,           // 单发敌弹对僚机的伤害（3 发击落）
  INVULN_MS: 900,       // 重生后无敌时长，防刚归队就被弹幕秒清
  ROLE: 'suppress',     // 默认角色（无 ROLE_BY_COUNT 兜底时用）
  MUZZLE_DY: -12,       // 炮口相对僚机中心的纵向偏移

  // 战术分工（第二版）：角色 -> 射速倍率 / 瞄准偏好 / 编队偏移缩放
  //   suppress 火力压制：标准射速，打最近目标，站标准槽位
  //   support  掩护支援：射速 +15%，优先锁同元素目标（吃元素协同 combo），贴近玩家后方
  //   flank    侧翼牵制：射速 -10%，打最近目标，拉宽横向站位吸引/拦截侧面来敌
  // 注意：role 只改"节奏 / 选敌 / 站位"，绝不改弹种与伤害基数（弹种仍由 WEAPON_LV 决定）
  ROLES: {
    suppress: { fireMul: 1.00, aim: 'nearest', offMul: { x: 1.0, y: 1.0 } },
    support:  { fireMul: 1.15, aim: 'element', offMul: { x: 0.8, y: 1.2 } },
    flank:    { fireMul: 0.90, aim: 'nearest', offMul: { x: 1.6, y: 0.4 } },
  },

  // 按当前僚机数量分配角色（索引 = 编队槽位序号，与 FORMATIONS 同序）
  ROLE_BY_COUNT: {
    1: ['suppress'],
    2: ['suppress', 'support'],
    3: ['suppress', 'support', 'flank'],
    4: ['suppress', 'support', 'flank', 'support'],
  },

  // 元素协同 combo（第二版）：玩家与僚机在窗口内交替以同元素命中，达阈值触发全体增伤
  //   WINDOW_MS 相邻两次命中的最大间隔；TRIGGER 需要的交替命中次数
  //   BUFF_MS   增益持续时长；DMG_MUL 增益期间僚机弹伤害倍率
  COMBO: {
    WINDOW_MS: 1200,
    TRIGGER: 5,
    BUFF_MS: 3000,
    DMG_MUL: 1.35,
    MAX_COUNT: 9,
  },

  // 编队槽位表：key = 当前僚机数量，slots[i] = 第 i 架相对玩家的偏移
  //   1 架 → 扇形单点（正后方），2 架 → 菱形对称双翼，3/4 架 → 菱形补后排
  FORMATIONS: {
    1: { name: 'fan',     slots: [{ x: 0, y: 44 }] },
    2: { name: 'diamond', slots: [{ x: -52, y: 16 }, { x: 52, y: 16 }] },
    3: { name: 'diamond', slots: [{ x: -52, y: 16 }, { x: 52, y: 16 }, { x: 0, y: 56 }] },
    4: { name: 'diamond', slots: [{ x: -52, y: 16 }, { x: 52, y: 16 }, { x: -30, y: 60 }, { x: 30, y: 60 }] },
  },

  // 智能走位（排斥力场躲弹）
  DODGE: {
    CHECK_EVERY: 3,      // 每 N 帧筛一次威胁弹（降低每帧开销）
    SCAN_RADIUS: 220,    // 系统级粗筛：只收集玩家周围这个半径内的敌弹
    SCAN_CAP: 16,        // 粗筛结果上限，防弹幕爆炸时数组过长
    RADIUS: 120,         // 单机威胁判定半径（平方比较，不开方）
    MAX_THREATS: 4,      // 每机最多参与合成的威胁弹数
    MAX_OFFSET: 40,      // 躲避偏移钳制（±px）
    GAIN: 0.55,          // 排斥力 -> 像素偏移的增益
    WEIGHT: 0.6,         // 躲避权重
    FORM_WEIGHT: 1.0,    // 编队权重
    SMOOTH: 0.4,         // 躲避向量自身平滑，避免抖动

    // 第三版②：预测式侧步（主动避让），与上方反应式排斥叠加，统一封顶 MAX_OFFSET
    PREDICT: true,          // 开关：开启弹道预判
    PREDICT_LOOKAHEAD: 0.6, // 仅预判 0.6s 内会逼近的弹（秒，与 velocity 量纲一致）
    PREDICT_RADIUS: 70,     // 最近接近距离危险半径（px）
    PREDICT_GAIN: 34,       // 预测侧步像素增益（与 GAIN 同量级，封顶由 MAX_OFFSET 钳制）
  },

  // 僚机不脱离玩家 X 轴的最大横向距离（屏宽 1/3）
  X_LEASH: GAME_WIDTH / 3,

  // 武器进化档位（索引 = 存档 upgrades.wingmanFirepower）
  //   dmgMul 相对 BULLET.PLAYER_DMG；整体 DPS 控制在主武器同级 60% 以内
  //   lv0 单发脉冲 / lv1 散射 3 路 / lv2 穿透（穿 1 个敌）/ lv3 元素弹（继承玩家元素·高伤）
  WEAPON_LV: [
    { name: '单发脉冲', key: 'bullet_pulse',   shots: 1, spreadDeg: 0,  interval: 260, dmgMul: 1.00, pierce: 0, tinted: false },
    { name: '散射',     key: 'bullet_scatter', shots: 3, spreadDeg: 8,  interval: 250, dmgMul: 0.60, pierce: 0, tinted: false },
    { name: '穿透',     key: 'bullet_pulse',   shots: 2, spreadDeg: 6,  interval: 240, dmgMul: 0.80, pierce: 1, tinted: false },
    { name: '元素弹',   key: 'bullet_scatter', shots: 3, spreadDeg: 11, interval: 240, dmgMul: 0.95, pierce: 0, tinted: true },
    // 第三版④：追踪导弹 / 穿透激光（纯新增档位，沿用玩家 missiles 转向与穿透机制，零新物理）
    { name: '追踪导弹', key: 'bullet_pulse',   shots: 1, spreadDeg: 0,  interval: 300, dmgMul: 1.30, pierce: 0, tinted: false, homing: true },
    { name: '穿透激光', key: 'bullet_pulse',   shots: 1, spreadDeg: 0,  interval: 150, dmgMul: 1.10, pierce: 8, tinted: false, laser: true },
  ],
};

// 每日任务模板池（留存系统 #每日任务）：每日按日期种子抽 3 个，跨局累计进度，完成领金币。
// metric 必须与 GameScene/SaveManager 的进度钩子一致：kills / coins / bombs / combos / super。
export const DAILY_QUEST_POOL = [
  { metric: 'kills',  target: 30, desc: '击落 30 架敌机',    reward: 40 },
  { metric: 'coins',  target: 60, desc: '收集 60 枚金币',    reward: 40 },
  { metric: 'bombs',  target: 3,  desc: '使用 3 次清屏炸弹', reward: 30 },
  { metric: 'combos', target: 5,  desc: '触发 5 次元素协同', reward: 50 },
  { metric: 'super',  target: 2,  desc: '释放 2 次星风暴',   reward: 30 },
];
