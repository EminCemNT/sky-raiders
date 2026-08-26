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
  BOSS_PHASE: 'boss-phase',
  LEVEL_CLEARED: 'level-cleared',
  // 拾取/升级
  POWERUP_COLLECTED: 'powerup-collected',
  COIN_COLLECTED: 'coin-collected',
  // 生命周期
  PLAYER_HIT: 'player-hit',
  PLAYER_DIED: 'player-died',
  LIVES_CHANGED: 'lives-changed', // 命数变化（P1 命数复活：payload = 剩余命数）
  POWER_CHANGED: 'power-changed', // 局内火力(P)等级变化（P1：payload = 当前等级 0~4）
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
  // 元素连锁反应（二段反应）append-only
  ELEMENT_REACTION: 'element-reaction',     // payload = { name, element, count, x, y }
  ELEMENT_CHANGED: 'element-changed',       // payload = 当前战机元素（fire/ice/thunder/null）
  // 擦弹 Graze（P2）：敌弹擦过判定圈外/擦弹环内计分回能，payload = { count, chain }
  GRAZE_CHANGED: 'graze-changed',
  // 第二主动技能「过载」（P2）：技能统一派发/切换/状态广播（append-only，保留 USE_SUPER 兼容）
  USE_SKILL: 'use-skill',                   // 按当前 activeSkill 派发（starstorm 走 useSuper，overdrive 走 useOverdrive）
  SKILL_SWITCHED: 'skill-switched',         // 星风暴 ↔ 过载 轮换，payload = 新技能 id
  OVERDRIVE_STATE: 'overdrive-state',       // 过载激活状态，payload = { active, until, duration }
  // P0 留存-活动轮换：活动模式倒计时广播，payload = { mode, name, left, total }
  EVENT_TIMER: 'event-timer',
  // P1 战斗扩展·超载状态 / 聚焦模式（append-only）
  OVERCHARGE_STATE: 'overcharge-state',     // 超载状态/蓄力进度，payload = { active, until, duration, p, graze }
  FOCUS_TOGGLE: 'focus-toggle',             // 移动端聚焦按钮切换（无 payload）
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

// 局内火力(P)拾取成长（P1）：P 掉落拾取 +1（封顶 MAX_LEVEL），受击 -1（下限 0）。
//   MAX_LEVEL      局内火力上限（0~4）
//   FIRE_RATE_GAIN 每级射速减免(ms)，叠加在机库火力之上
//   DROP_CHANCE    敌人死亡独立掉落 P 的概率（约 15%）
export const POWERUP = {
  MAX_LEVEL: 4,
  FIRE_RATE_GAIN: 8,
  DROP_CHANCE: 0.15,
};

// 擦弹 Graze（弹幕核心玩法，P2）：敌弹进入「擦弹环」（判定圈外 ~ 判定圈+RING_EXTRA）
// 且速度达标时计一次擦弹。独立距离环判断，不消弹、不结算命中、零改动既有受击/连击逻辑。
//   RING_EXTRA    擦弹环相对判定圈的额外半径（判定圈 r=6 → 擦弹环 r=24）
//   MIN_SPEED     敌弹速度下限（静止/极慢弹不计擦弹）
//   SCORE         单次擦弹基础得分
//   CHAIN_SCORE   2s 链式窗口内连续擦弹每段额外分
//   CHAIN_MAX     链式加分封顶（总加成不超过该值，即 +15）
//   CHAIN_WINDOW  链式窗口时长（ms）
//   ENERGY_GAIN   每次擦弹回能量
//   RE_GRAZE_MS   同一颗弹的擦弹冷却（ms，避免贴弹期间连帧计多次）
//   CHECK_EVERY   每 N 帧遍历一次敌弹（降低每帧开销）
export const GRAZE = {
  RING_EXTRA: 18,
  MIN_SPEED: 80,
  SCORE: 5,
  CHAIN_SCORE: 2,
  CHAIN_MAX: 15,
  CHAIN_WINDOW: 2000,
  ENERGY_GAIN: 1,
  RE_GRAZE_MS: 400,
  CHECK_EVERY: 2,
};

// 过载 Overdrive（第二主动技能，P2）：短时射速翻倍
//   DURATION  持续时间（ms）
//   FIRE_MUL  射速倍率（0.5 = 射速间隔减半，即射速翻倍）
export const OVERDRIVE = { DURATION: 6000, FIRE_MUL: 0.5 };

// 超载状态（P1 战斗扩展）：与技能槽独立——连续拾取 3 个 P 或连续擦弹 5 次（30s 窗口）触发。
//   P_STACK      连续拾取 P 数量阈值
//   GRAZE_STACK  连续擦弹次数阈值
//   WINDOW       计数窗口（ms）：窗口内连续达成才累计
//   DURATION     超载持续时间（ms）
//   FIRE_MUL     射速倍率（1.3 = 射速 ×1.3，作用在射速上；间隔 ×(1/1.3)）
//   SCORE_MUL    得分倍率（1.2 = 得分 ×1.2）
// 消费方：GameScene（触发/状态机）+ Player（getEffectiveFireInterval 射速）+ UIScene（HUD）。
// 局内临时状态，不入存档（SaveManager 零改动）。
export const OVERCHARGE = { P_STACK: 3, GRAZE_STACK: 5, WINDOW: 30000, DURATION: 5000, FIRE_MUL: 1.3, SCORE_MUL: 1.2 };

// 聚焦模式（P1 战斗扩展）：按住 Shift（或移动端专用按钮）进入。
//   SPEED_MUL  移速倍率（0.45 = 移速 ×0.45）
//   FIRE_MUL   射速倍率（0.8 = 射速 ×0.8，间隔 ×(1/0.8)；以伤害 +20% 补偿）
//   DMG_MUL    伤害倍率（1.2 = 玩家弹伤害 +20%）
// 消费方：Player（聚焦状态/伤害/射速/移速/判定点显式显示）。
export const FOCUS = { SPEED_MUL: 0.45, FIRE_MUL: 0.8, DMG_MUL: 1.2 };

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
      nebula: { tints: [0x3a1f6e, 0x1f3a6e], alpha: 0.22 },
      cloudTint: 0x9fd8ff,
      silhouette: { kind: 'none', color: 0x0a0f1c, density: 1, speed: 40 },
    },
    boss: { maxHp: 2600, pattern: 'fan', name: '哨兵 Sentinel', color: 0x66ccff, shieldHp: 0 },
    // P0 留存-关卡勋章目标：达成记勋章（数据驱动，append-only，只加不改旧键）
    challenges: [
      { id: 'c1', type: 'killRate', target: 0.9, name: '歼灭90%' },
      { id: 'c2', type: 'timeLimit', target: 60, name: '60秒速通' },
      { id: 'c3', type: 'singleWeapon', name: '单武器通关' },
    ],
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
      nebula: { tints: [0x6a2f0a, 0x3a1a08], alpha: 0.22 },
      cloudTint: 0xd68f4a,
      silhouette: { kind: 'asteroid', color: 0x0a0604, density: 1, speed: 46 },
    },
    boss: { maxHp: 3300, pattern: 'spiral', name: '粉碎者 Crusher', color: 0xff9a4a, shieldHp: 80 },
    challenges: [
      { id: 'c1', type: 'killRate', target: 0.85, name: '歼灭85%' },
      { id: 'c2', type: 'timeLimit', target: 75, name: '75秒速通' },
      { id: 'c3', type: 'singleWeapon', name: '单武器通关' },
    ],
    wavePlan: [
      { count: 8,  comp: [['small', 'straight', 1], ['small', 'sine', 1]] },
      { count: 9,  comp: [['small', 'sine', 2], ['mid', 'straight', 1]] },
      { count: 10, comp: [['small', 'straight', 1], ['small', 'dive', 2], ['mid', 'sine', 1]] },
      { count: 10, comp: [['small', 'sine', 2], ['mid', 'straight', 1], ['mid', 'dive', 1]] },
      { count: 11, comp: [['small', 'dive', 2], ['mid', 'straight', 1], ['mid', 'sine', 2], ['diver', 'dive', 1]] },
      { count: 12, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1], ['diver', 'dive', 1], ['turret', 'turret', 1, 'aimed']] },
      { count: 13, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['mid', 'sine', 1], ['mid', 'dive', 1], ['diver', 'dive', 1], ['kamikaze', 'kamikaze', 1, 'straight']] },
    ],
  },
  {
    id: 3, name: '敌方要塞', bg: 'bg_fortress', waves: 8, bossKey: 'boss_overlord',
    difficulty: 1.7,
    theme: {
      skyTop: 0x1a0f33, skyBottom: 0x070414,
      starTints: [0x4a2a6a, 0x9a6fd6, 0xc9bfff, 0xb98bff],
      accent: 0xb98bff,
      nebula: { tints: [0x3a1f6e, 0x6a2f8a], alpha: 0.22 },
      cloudTint: 0x9a6fd6,
      silhouette: { kind: 'building', color: 0x070414, density: 1, speed: 42 },
    },
    boss: { maxHp: 4200, pattern: 'cross', name: '霸主 Overlord', color: 0x66ff99, shieldHp: 120 },
    challenges: [
      { id: 'c1', type: 'killRate', target: 0.8, name: '歼灭80%' },
      { id: 'c2', type: 'timeLimit', target: 90, name: '90秒速通' },
      { id: 'c3', type: 'singleWeapon', name: '单武器通关' },
    ],
    wavePlan: [
      { count: 9,  comp: [['small', 'straight', 1], ['mid', 'straight', 1]] },
      { count: 10, comp: [['small', 'sine', 2], ['mid', 'straight', 1], ['mid', 'dive', 1]] },
      { count: 11, comp: [['small', 'dive', 2], ['mid', 'sine', 2], ['mid', 'straight', 1]] },
      { count: 12, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1]] },
      { count: 12, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['mid', 'sine', 2]] },
      { count: 13, comp: [['small', 'dive', 2], ['mid', 'sine', 2], ['mid', 'straight', 2], ['diver', 'dive', 1], ['turret', 'turret', 1, 'aimed']] },
      { count: 14, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1], ['mid', 'sine', 1], ['diver', 'dive', 1], ['summoner', 'straight', 1, 'ring']] },
      { count: 16, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['small', 'sine', 1], ['mid', 'dive', 1], ['mid', 'sine', 1], ['diver', 'dive', 1], ['kamikaze', 'kamikaze', 1, 'straight']] },
    ],
  },
  {
    id: 4, name: '终焉星核', bg: 'bg_abyss', waves: 9, bossKey: 'boss_annihilator',
    difficulty: 2.2,
    theme: {
      skyTop: 0x2a0a1a, skyBottom: 0x0a0408,
      starTints: [0x6a2a3a, 0xd66a7a, 0xffb0c0, 0xff7a8a],
      accent: 0xff6a8a,
      nebula: { tints: [0x6a1a2a, 0x3a0a1a], alpha: 0.22 },
      cloudTint: 0xd66a7a,
      silhouette: { kind: 'building', color: 0x0a0408, density: 1, speed: 44 },
    },
    boss: { maxHp: 5600, pattern: 'nova', name: '湮灭者 Annihilator', color: 0xff6a3d, shieldHp: 150 },
    challenges: [
      { id: 'c1', type: 'killRate', target: 0.75, name: '歼灭75%' },
      { id: 'c2', type: 'timeLimit', target: 120, name: '120秒速通' },
      { id: 'c3', type: 'singleWeapon', name: '单武器通关' },
    ],
    wavePlan: [
      { count: 10, comp: [['small', 'straight', 1], ['small', 'sine', 1], ['mid', 'straight', 1]] },
      { count: 11, comp: [['small', 'sine', 2], ['mid', 'straight', 1], ['mid', 'dive', 1]] },
      { count: 12, comp: [['small', 'dive', 2], ['mid', 'sine', 2], ['mid', 'straight', 1]] },
      { count: 13, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1], ['diver', 'dive', 1]] },
      { count: 14, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['mid', 'sine', 2], ['diver', 'dive', 1]] },
      { count: 15, comp: [['small', 'dive', 2], ['mid', 'sine', 2], ['mid', 'straight', 2], ['diver', 'dive', 1]] },
      { count: 16, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1], ['mid', 'sine', 1], ['diver', 'dive', 2], ['turret', 'turret', 1, 'aimed']] },
      { count: 18, comp: [['small', 'straight', 1], ['small', 'dive', 1], ['small', 'sine', 1], ['mid', 'dive', 1], ['mid', 'sine', 1], ['diver', 'dive', 2], ['summoner', 'straight', 1, 'ring'], ['kamikaze', 'kamikaze', 1, 'straight']] },
      { count: 20, comp: [['small', 'sine', 2], ['mid', 'dive', 2], ['mid', 'straight', 1], ['mid', 'sine', 1], ['diver', 'dive', 3], ['shield', 'straight', 1, 'spread'], ['kamikaze', 'kamikaze', 1, 'straight']] },
    ],
  },
];

// Boss Rush 序列（独立于主线 4 关）：连打现有 4 个 Boss，血量随轮次递增。
// pattern / name / color 直接取自各关 Boss 配置，避免重复定义。
export const BOSS_RUSH = [
  { bossKey: 'boss_sentinel', name: '哨兵 Sentinel', color: 0x66ccff, pattern: 'fan',    maxHp: 2600, hpMult: 1.0 },
  { bossKey: 'boss_crusher',  name: '粉碎者 Crusher', color: 0xff9a4a, pattern: 'spiral',  maxHp: 3300, hpMult: 1.15 },
  { bossKey: 'boss_overlord',  name: '霸主 Overlord',  color: 0x66ff99, pattern: 'cross',  maxHp: 4200, hpMult: 1.3 },
  { bossKey: 'boss_annihilator', name: '湮灭者 Annihilator', color: 0xff6a3d, pattern: 'nova', maxHp: 5600, hpMult: 1.5 },
];

// Boss Rush 差异化（P2）：按机库等级缩放 Boss Rush 数值，回馈长期养成。
// hangarLv = 六项升级之和（0..30）。hangarLv=0 时全系数 1.0 / rareChance=0.05，与现状零回归。
//   hpMul        Boss HP 倍率（封顶 +60%）
//   bulletMul    Boss 弹速倍率（封顶 +24%）
//   coinMul      结算金币倍率（封顶 +150%）
//   rareChance   稀有掉落（element_core/power/energy）追加概率（封顶 35%）
export function bossRushScale(hangarLv) {
  const lv = Math.max(0, Number(hangarLv) || 0);
  return {
    hpMul: 1 + Math.min(lv * 0.03, 0.6),
    bulletMul: 1 + Math.min(lv * 0.012, 0.24),
    coinMul: 1 + Math.min(lv * 0.05, 1.5),
    rareChance: Math.min(0.05 + lv * 0.02, 0.35),
  };
}

// ───────────────────────────────────────────────────────────────
// P2 体验细节·数值反馈：总战力（calcPower）派生函数 + 推荐关卡
// 纯展示：由六项升级 + 三槽模块品质 + 战机基础算一个"总战力"数值，
// 不改任何 hp/score/判定/连击数值逻辑（只在机库展示与推荐）。
// ───────────────────────────────────────────────────────────────
export function calcPower(upgrades, modules, ship) {
  const up = upgrades || {};
  const firepower = up.firepower || 0;
  const hull = up.hull || 0;
  const shield = up.shield || 0;
  const magnet = up.magnet || 0;
  const wingman = up.wingman || 0;
  const wingmanFirepower = up.wingmanFirepower || 0;
  // 六项升级加权（各项上限 8/6/5/4/2/5 → 满级合计约 +442）
  const upgradePower = firepower * 16 + hull * 12 + shield * 14 + magnet * 8 + wingman * 40 + wingmanFirepower * 12;
  // 三槽模块品质加成：common +10 / rare +18（未装备不加成）
  const mods = modules || {};
  const equipped = [mods.weapon, mods.armor, mods.engine].filter((k) => k && MODULES[k]);
  const modulePower = equipped.reduce((sum, k) => sum + ((MODULES[k].quality === 'rare') ? 18 : 10), 0);
  // 战机基础战力（按机型索引：110/120/115，区分三机手感差异）
  const shipBase = (ship && ship.id != null) ? (100 + (Number(ship.id) + 1) * 10) : 110;
  return Math.round(shipBase + upgradePower + modulePower);
}

/** 按总战力映射推荐关卡（LEVELS 难度区间：<200 → 1 / <350 → 2 / <550 → 3 / 其余 4） */
export function recommendLevel(power) {
  const p = Number(power) || 0;
  if (p < 200) return 1;
  if (p < 350) return 2;
  if (p < 550) return 3;
  return 4;
}

// ───────────────────────────────────────────────────────────────
// 四档难度系统（P0）：休闲 / 标准 / 困难 / 地狱
// 系数乘在关卡 difficulty 之上；标准档全 1.0，与历史行为逐字段等价（零回归）。
//   hpMul       敌机 HP 倍率
//   speedMul    敌机移动速度倍率
//   bossBulletMul Boss 弹速倍率（乘到 Boss.difficulty 上）
//   scoreMul    结算得分倍率
//   coinMul     结算金币倍率
// 消费方：Enemy.spawn(hpMul/speedMul) / GameScene.spawnBoss(bossBulletMul) / GameScene.endGame(scoreMul/coinMul)
// ───────────────────────────────────────────────────────────────
export const DIFFICULTIES = [
  { id: 'casual',   name: '休闲', hpMul: 0.7,  speedMul: 0.85, bossBulletMul: 0.85, scoreMul: 0.8, coinMul: 0.9 },
  { id: 'standard', name: '标准', hpMul: 1.0,  speedMul: 1.0,  bossBulletMul: 1.0,  scoreMul: 1.0, coinMul: 1.0 },
  { id: 'hard',     name: '困难', hpMul: 1.4,  speedMul: 1.15, bossBulletMul: 1.2,  scoreMul: 1.3, coinMul: 1.2 },
  { id: 'hell',     name: '地狱', hpMul: 2.0,  speedMul: 1.3,  bossBulletMul: 1.5,  scoreMul: 1.8, coinMul: 1.5 },
];

/** 按 id 取难度档；未知 id 回退 standard（默认档）。 */
export function getDifficulty(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
}

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

// 中国股市/涨跌无关，这里是玩家阵营配色（青蓝科技风）。
// 配色纪律（P3 画面质感打磨）：COLORS 只放"阵营 / 界面基色"；
// 特效专属颜色一律进下方 VFX_COLORS 供 VFX.js 引用，禁止在特效/场景里散落魔法色。
export const COLORS = {
  player: 0x66ccff,
  playerBullet: 0x8fe3ff,
  enemy: 0xff5a6e,
  enemyBullet: 0xff5a3c,  // 红橙（A2 敌弹发光球；与俯冲机机体色拉开明度）
  coin: 0xffd54a,
  bg: 0x05070f,
  accent: 0x7cf3ff,
};

// 特效调色板（P3 画面质感打磨，append-only）：VFX.js 统一引用的特效颜色。
//   flash  白闪核心 / ring 冲击波环（默认机体红）/ debris 残骸深红 / smoke 烟尘灰
//   hit    命中火花序列 [白, 金, 青, 橙]
//   trail  各弹种拖尾主色（pulse 脉冲青 / scatter 散射 / missile 导弹金 /
//          fire 火橙 / ice 冰青 / thunder 雷黄 / enemy 敌弹红橙亮核）
export const VFX_COLORS = {
  flash: 0xffffff,
  ring: COLORS.enemy,
  debris: 0x8a2233,
  smoke: 0x55606a,
  hit: [0xffffff, 0xffd54a, 0x8fe3ff, 0xffaa33],
  trail: {
    pulse: 0x66ccff,
    scatter: 0x9fd8ff,
    missile: 0xffcc44,
    fire: 0xff7a3a,
    ice: 0x6fd6ff,
    thunder: 0xffe14a,
    enemy: 0xff5a3c,
  },
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
// passive（P0 机库模块·战机专属被动，append-only 新增字段）：在 Enemy.applyElement 处按所选战机乘元素系数。
//   element 匹配的元素 key；dotMul 火伤系数 / slowMul 减速因子系数（<1 = 减速更强）/ stunMul 雷定身时长系数。
export const SHIPS = [
  { id: 0, name: '苍鹰', weapon: 'pulse',  element: 'thunder', tint: 0x66ccff, desc: '均衡机枪机·雷麻痹',
    passive: { element: 'thunder', name: '雷暴', desc: '麻痹时长 +15%', stunMul: 1.15 } },
  { id: 1, name: '赤焰', weapon: 'missile', element: 'fire',  tint: 0xff7a3a, desc: '导弹机·火灼烧',
    passive: { element: 'fire', name: '烈焰', desc: '灼烧伤害 +25%', dotMul: 1.25 } },
  { id: 2, name: '寒霜', weapon: 'laser',   element: 'ice',   tint: 0x9ff0ff, desc: '激光机·冰减速',
    passive: { element: 'ice', name: '极寒', desc: '减速强度 +20%', slowMul: 0.8 } },
];

// 战机皮肤（P2 体验细节·皮肤装饰，append-only）：
//   每架战机 3 款皮肤（第 0 款 = 默认自带，其余 800 金币购买）。
//   纹理 key：player_skin_{shipId}_{skinId}（TextureFactory 程序化生成，原 player 纹理不动）。
//   accent 为皮肤强调色（机库预览 aura / 战斗 aura 染色用）。
export const SKIN_PRICE = 800;

export const SHIP_SKINS = [
  { shipId: 0, name: '苍鹰', skins: [
    { id: 0, name: '青蓝', accent: 0x66ccff },
    { id: 1, name: '曜金', accent: 0xffd54a },
    { id: 2, name: '绯红', accent: 0xff5566 },
  ] },
  { shipId: 1, name: '赤焰', skins: [
    { id: 0, name: '橙', accent: 0xff7a3a },
    { id: 1, name: '银白', accent: 0xdfeaf5 },
    { id: 2, name: '墨紫', accent: 0x9a6fd6 },
  ] },
  { shipId: 2, name: '寒霜', skins: [
    { id: 0, name: '冰蓝', accent: 0x9ff0ff },
    { id: 1, name: '玄黑', accent: 0x55606a },
    { id: 2, name: '翠绿', accent: 0x7cffa0 },
  ] },
];

/** 取某战机皮肤列表（无则回退默认 3 款），皮肤名辅助函数 */
export function getShipSkins(shipId) {
  const entry = SHIP_SKINS.find((s) => s.shipId === Number(shipId)) || SHIP_SKINS[0];
  return (entry && entry.skins) || [];
}

/** 战机皮肤纹理 key（纯派生，不碰既有 'player' 纹理） */
export function shipSkinKey(shipId, skinId) {
  return `player_skin_${Number(shipId) || 0}_${Number(skinId) || 0}`;
}

// ───────────────────────────────────────────────────────────────
// P0 机库模块养成系统（与既有 UPGRADE_TREE 金币升级并行，不替代）
// 三槽（weapon 武器 / armor 装甲 / engine 引擎），每槽装 1 模块。
// 品质：common(白, ×1) → rare(蓝, ×1.3)；合成：2 个同名同品质 → 1 个高一级品质（同槽）。
// 模块定义 append-only：新增只加 key，不改既有 key 的字段。
// 消费方：SaveManager（存档/合成/购买/装备）、Player（加成生效）、HangarScene（面板 UI）、
//         GameScene.spawnBossDrops（Boss 低概率掉落）。
// ───────────────────────────────────────────────────────────────
export const MODULE_SLOTS = [
  { key: 'weapon', name: '武器' },
  { key: 'armor',  name: '装甲' },
  { key: 'engine', name: '引擎' },
];

export const MODULE_QUALITY = {
  common: { key: 'common', name: '普通', color: 0xe8eef5, mul: 1,   order: 0 },
  rare:   { key: 'rare',   name: '稀有', color: 0x5aa7ff, mul: 1.3, order: 1 },
};

// 模块商店定价（金币）
export const MODULE_SHOP = { common: 500, rare: 1200 };

// Boss 击败后低概率追加模块掉落的概率
export const MODULE_DROP_CHANCE = 0.15;

// 模块效果字段说明：
//   weapon: fireIntervalMul（射速间隔倍率，<1 = 射速更快）
//   armor:  hpBonus（生命上限加成，相对基础 100 血保守）
//   engine: speedMul（移速倍率） / grazeExtra（擦弹环额外半径 px）
export const MODULES = {
  weapon_common: { key: 'weapon_common', slot: 'weapon', quality: 'common', name: '速射核心', effect: '射速间隔 ×0.95', fireIntervalMul: 0.95 },
  weapon_rare:   { key: 'weapon_rare',   slot: 'weapon', quality: 'rare',   name: '极速核心', effect: '射速间隔 ×0.88', fireIntervalMul: 0.88 },
  armor_common:  { key: 'armor_common',  slot: 'armor',  quality: 'common', name: '装甲板',   effect: '生命上限 +20', hpBonus: 20 },
  armor_rare:    { key: 'armor_rare',    slot: 'armor',  quality: 'rare',   name: '重装装甲', effect: '生命上限 +40', hpBonus: 40 },
  engine_common: { key: 'engine_common', slot: 'engine', quality: 'common', name: '推进器',   effect: '移速 ×1.1', speedMul: 1.1 },
  engine_rare:   { key: 'engine_rare',   slot: 'engine', quality: 'rare',   name: '擦弹环',   effect: '擦弹环半径 +6', grazeExtra: 6 },
};

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

// 每日任务模板池（留存系统 #每日任务，P1 扩展）：每日按日期种子抽 DAILY_QUEST_PICK 个，跨局累计进度。
// 池扩至 10 条；全部完成另有「全清奖励」（DAILY_QUEST_ALL_CLEAR_BONUS）。
// metric 必须与 GameScene/SaveManager 的进度钩子一致：
//   kills / coins / bombs / combos / grazes / clears / bossRushClears / endlessWaves / modules / skins。
export const DAILY_QUEST_PICK = 4;                  // 每日随机抽取任务条数
export const DAILY_QUEST_ALL_CLEAR_BONUS = 100;     // 全清奖励（单条金币之和外的追加）
export const DAILY_QUEST_POOL = [
  { metric: 'kills',  target: 30, desc: '击落 30 架敌机',      reward: 40 },
  { metric: 'coins',  target: 60, desc: '收集 60 枚金币',      reward: 40 },
  { metric: 'bombs',  target: 3,  desc: '使用 3 次清屏炸弹',   reward: 30 },
  { metric: 'combos', target: 5,  desc: '触发 5 次元素协同',   reward: 50 },
  { metric: 'grazes', target: 10, desc: '累计擦弹 10 次',      reward: 40 },
  { metric: 'clears', target: 1,  desc: '通关任意一关',        reward: 50 },
  { metric: 'bossRushClears', target: 1, desc: '通关 1 次 Boss Rush', reward: 60 },
  { metric: 'endlessWaves', target: 10, desc: '无尽模式累计 10 波', reward: 50 },
  { metric: 'modules', target: 1, desc: '收集 1 个机库模块',   reward: 40 },
  { metric: 'skins',  target: 1,  desc: '购买 1 个战机皮肤',   reward: 60 },
];

// ───────────────────────────────────────────────────────────────
// P0 留存内容组：关卡勋章 / 新手 7 日计划 / 活动轮换
// 均为"数据驱动 + append-only"：只新增键，不改既有字段。
// ───────────────────────────────────────────────────────────────

// 关卡勋章阈值（先做展示：累计达到阈值显示高难解锁提示；高难解锁后续接入）
export const MEDALS = {
  THRESHOLD: 6,
  THRESHOLD_LABEL: '高难挑战',
};

// 新手 7 日计划：每日目标。metric 必须与 GameScene/SaveManager 的进度钩子一致：
//   clears          通关任意一关（normal 胜利）
//   hangarUpgrades  机库升级次数（HangarScene.tryUpgrade）
//   coins           收集金币（GameScene.collectCoin）
//   bossRushClears  通关 Boss Rush（bossrush 胜利）
//   endlessWaves    无尽模式撑过波数（endGame 时按 currentWave 累计）
//   grazes          累计擦弹（GameScene._grantGraze）
//   levelClears     累计通关关数（normal 胜利）
export const NEWBIE_PLAN = [
  { day: 1, metric: 'clears',        target: 1,  desc: '通关任意一关',   reward: 60 },
  { day: 2, metric: 'hangarUpgrades', target: 1,  desc: '机库升级 1 次',   reward: 60 },
  { day: 3, metric: 'coins',          target: 20, desc: '收集 20 枚金币',  reward: 60 },
  { day: 4, metric: 'bossRushClears', target: 1,  desc: '通关 Boss Rush',  reward: 100 },
  { day: 5, metric: 'endlessWaves',   target: 10, desc: '无尽模式撑过 10 波', reward: 100 },
  { day: 6, metric: 'grazes',         target: 10, desc: '累计擦弹 10 次',  reward: 80 },
  { day: 7, metric: 'levelClears',    target: 3,  desc: '累计通关 3 关',   reward: 150 },
];
// 第 7 天额外奖励：僚机升级 +1（满级改发金币大礼包）
export const NEWBIE_DAY7_BONUS = { wingman: 1, coins: 200 };

// 活动轮换（低成本 2 模式）：复用既有 WaveSystem / GameScene 框架。
// 按 ISO 周号在 EVENT_CYCLE 轮换，周末（六/日）为双倍奖励日。
export const EVENT_CYCLE = ['coin_rush', 'survival'];
export const EVENT_MODES = {
  coin_rush: {
    id: 'coin_rush', name: '金币冲刺', short: '金币冲刺',
    duration: 60, coinMul: 2, magnet: true, extraCoinsPerKill: 2,
    desc: '60 秒限时 · 敌人大量掉金币 · 磁力常驻 · 结算金币×2',
  },
  survival: {
    id: 'survival', name: '限时生存', short: '限时生存',
    duration: 120, coinPerWave: 8, extraLives: 1,
    desc: '120 秒无限波 · 撑住越多波金币越多 · 命数+1 补偿',
  },
};

/** ISO 8601 周号（周一为一周起点） */
function _isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

/** 当前周活动：按 ISO 周号轮换 EVENT_CYCLE；周末双倍；返回活动配置 + daysLeft（距下次轮换天数） */
export function getCurrentEvent(date = new Date()) {
  const week = _isoWeekNumber(date);
  const id = EVENT_CYCLE[week % EVENT_CYCLE.length];
  const cfg = EVENT_MODES[id] || EVENT_MODES.coin_rush;
  const double = (date.getDay() === 0 || date.getDay() === 6);
  const nextMonday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  nextMonday.setDate(nextMonday.getDate() + (((8 - date.getDay()) % 7) || 7));
  const daysLeft = Math.max(1, Math.ceil((nextMonday - date) / 86400000));
  return { ...cfg, id, double, daysLeft };
}

// ───────────────────────────────────────────────────────────────
// P2 系统扩展 · 无尽周赛（本地假组，纯本地不接后端）
// 无尽模式只有 bestScore，无竞争周期；这里给无尽加"每周排位"。
// GROUP_SIZE  假组人数（本地模拟 50 人排位，rank 在 [1, GROUP_SIZE]）
// REWARDS     周结按 rank 发金币（append-only：rank 支持单值或 "a-b" 区间）
// ───────────────────────────────────────────────────────────────
export const WEEKLY_LEAGUE = {
  GROUP_SIZE: 50,
  REWARDS: [
    { rank: 1, coins: 500 },
    { rank: 2, coins: 300 },
    { rank: 3, coins: 200 },
    { rank: '4-10', coins: 100 },
    { rank: '11-50', coins: 50 },
  ],
};

/** ISO 周 key（形如 "2026-W34"）：无尽周赛按周切换。复用 _isoWeekNumber 的算法，ISO 年取自偏移后的日期。 */
export function getIsoWeekKey(date = new Date()) {
  const wk = _isoWeekNumber(date);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// ───────────────────────────────────────────────────────────────
// P1 留存·深空爬塔（无尽模式升级，纯本地）
// 无尽模式升级为「深空爬塔」：每 BOSS_EVERY 波一个 Boss（复用 spawnBoss，bossKey 按层数
// 轮换 BOSS_RUSH 4 Boss）；每波结束 3 选 1 随机增益（局内临时，不入存档）。
// 消费方：GameScene（爬塔流程）+ WaveSystem（endlessBossEvery/awaitBuff）+ SaveManager（towerTop）。
// ───────────────────────────────────────────────────────────────
export const TOWER = {
  BOSS_EVERY: 10,        // 每 N 波一个 Boss 波（波数 % N === 0 且非第 0 波）
  BOSS_HP_GROWTH: 0.18,  // 每层 Boss 血量 +18%
  BOSS_DIFF_GROWTH: 0.15,// 每层 Boss 弹幕难度 +0.15
};

// 3 选 1 随机增益表（id 与 GameScene.applyTowerBuff 对应，全部走既有机制）：
//   fireRate  射速 +10%（fireInterval ×0.9，player.setFireRateMul）
//   extraShot 弹量 +1（player.towerExtraShots，主炮并列弹 +1）
//   speed     移速 +8%（player.towerSpeedMul ×1.08，getMoveSpeed/拖拽路径消费）
//   graze     擦弹环 +8（player.towerGrazeExtra +8px，getGrazeCircle 消费）
//   hp        HP +20（player.maxHp +20 并回复）
//   coin      金币 +20%（结算 coinMul ×1.2，endGame 消费）
export const TOWER_BUFFS = [
  { id: 'fireRate',  name: '射速 +10%', desc: '开火间隔缩短 10%' },
  { id: 'extraShot', name: '弹量 +1',   desc: '主炮并列弹 +1' },
  { id: 'speed',     name: '移速 +8%',  desc: '移动速度提升 8%' },
  { id: 'graze',     name: '擦弹环 +8', desc: '擦弹判定环半径 +8px' },
  { id: 'hp',        name: 'HP +20',    desc: '生命上限 +20 并回复' },
  { id: 'coin',      name: '金币 +20%', desc: '本局结算金币 +20%' },
];

// ───────────────────────────────────────────────────────────────
// P1 留存·每日签到 7 日循环 + 补签
// 连签第 N 天（1~7 循环）领 CHECKIN_REWARDS[N-1]；第 7 天大奖（800 金币，僚机未满级额外 +1）。
// 断签可消耗 CHECKIN_MAKEUP_COST 金币补签 1 天（保留连签进度）。
// 消费方：SaveManager.checkIn / makeupCheckIn / getCheckinCycle + MenuScene 签到面板。
// ───────────────────────────────────────────────────────────────
export const CHECKIN_REWARDS = [50, 60, 70, 80, 90, 100, 800];
export const CHECKIN_MAKEUP_COST = 100;

// ───────────────────────────────────────────────────────────────
// P1 留存·回归激励（断签召回）
// 断签 ≥ MISS_DAYS 天：下次进菜单弹「回归礼包」（金币 + 随机模块），
// 领后记 returnGift.grantedAt，COOLDOWN_DAYS 天内不再触发。
// 消费方：SaveManager.getReturnGiftStatus / claimReturnGift + MenuScene 面板。
// ───────────────────────────────────────────────────────────────
export const RETURN_GIFT = {
  MISS_DAYS: 3,      // 断签 ≥3 天触发
  COINS: 500,        // 回归礼包金币
  COOLDOWN_DAYS: 7,  // 领取后冷却天数
};

// ───────────────────────────────────────────────────────────────
// P1 留存·活跃宝箱（每日游玩局数）
// 当日游玩 THRESHOLDS 局各开 1 个宝箱（金币随机 + 随机机库模块，复用 module 系统）。
// 消费方：SaveManager.addDailyAct / getDailyActs / claimDailyChest + MenuScene 每日任务面板。
// ───────────────────────────────────────────────────────────────
export const ACTIVE_CHEST = {
  THRESHOLDS: [3, 5],
  COINS_MIN: 50, COINS_MAX: 120,
};

// ───────────────────────────────────────────────────────────────
// 画质档位（P0 性能三件套）：低端机降级，纯视觉/技术，零业务逻辑。
// tiers 顺序即设置面板展示顺序；scale 为粒子/弹幕密度缩放系数（消费方读 scene.qualityScale）。
// 消费方：VFX.poolExplode/poolSpark/debrisBurst/smokePuff（爆炸粒子 quantity 按档缩放）、
//         GameScene.create（qualityScale = PERFORMANCE.scale[quality]）。
// reduced-motion 优先于 quality（reduced 更保守，VFX 内部全降级，池不创建）。
// ───────────────────────────────────────────────────────────────
export const PERFORMANCE = {
  tiers: ['high', 'mid', 'low'],
  defaultTier: 'high',
  scale: { high: 1.0, mid: 0.7, low: 0.45 },
};
