import { SAVE_KEY, DAILY_QUEST_POOL, DAILY_QUEST_PICK, DAILY_QUEST_ALL_CLEAR_BONUS, DIFFICULTIES, PERFORMANCE, NEWBIE_PLAN, UPGRADE_TREE, MODULES, MODULE_SLOTS, MODULE_SHOP, SKIN_PRICE, WEEKLY_LEAGUE, getIsoWeekKey, CHECKIN_REWARDS, CHECKIN_MAKEUP_COST, RETURN_GIFT, ACTIVE_CHEST, EVENTS } from '../config/GameConfig.js';
import { EventBus } from './EventBus.js';

/**
 * 存档管理（localStorage）
 * ---------------------------------------------------------------------------
 * 存：金币总数、各部件升级等级、每关最高星级、已解锁关卡。
 * 所有读写走这里，别在别处直接碰 localStorage。
 */
const DEFAULT_SAVE = {
  coins: 0,
  bestScore: 0, // 全局最高分（P1 最高分存档，默认 0）
  // wingmanFirepower：僚机火力（独立于 wingman 数量项），决定 WINGMAN.WEAPON_LV 档位
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 },
  selectedShip: 0, // C2 战机武器绑定：所选战机索引（对应 GameConfig.SHIPS）
  selectedDifficulty: 'standard', // P0 四档难度：所选难度 id（对应 GameConfig.DIFFICULTIES）
  quality: 'high', // P0 画质档：high/mid/low（对应 GameConfig.PERFORMANCE，低端机降级；纯技术，零业务逻辑）
  levelStars: {}, // { [levelId]: stars(1~3) }
  unlockedLevel: 1,
  totalKills: 0,
  achievements: {}, // { [achievementId]: true }
  // 累计成就统计（局末写回，避免每杀一怪都触发一次 save）
  // elementCombos：元素协同 combo 累计触发次数（僚机第二版 combo_element_50 成就依赖）
  achievementStats: {
    wingmanKills: 0,
    elementKills: { fire: 0, ice: 0, thunder: 0 },
    elementCombos: 0,
    bossRushClears: 0,
  },
  // 累计击败的 Boss 列表（key 集合，用于屠龙者/各 Boss 克星成就）
  bossesDefeated: {},
  lastCheckin: '', // 本地日期 YYYY-MM-DD
  checkinStreak: 0,
  tutorialDone: false,
  startWeapon: null, // 开局主武器覆盖（机库选择；null=用战机绑定武器）
  showHitbox: false, // 显示玩家判定点（P1-6：斑鸠/虫姬同款，默认关）
  // P1 表现工程·触控手感（append-only，只新增字段不改旧字段）：
  //   sensitivity 灵敏度（0.5~1.5，拖动 lerp 系数 = 0.35 × sensitivity，封顶 0.6）
  //   touchOffset  手指按住时战机跟随手指下方的像素偏移（36=默认开；0=关，回退旧手感）
  //   lang         语言（'zh' | 'en'，i18n 前置）
  sensitivity: 1.0,
  touchOffset: 36,
  lang: 'zh',
  // 每日任务（留存系统 #每日任务）：date=当天日期 / claimed=是否已领 / progress=各指标进度 / picked=当天抽中的指标
  dailyQuest: { date: '', claimed: false, progress: {}, picked: [] },
  // P0 留存-关卡勋章：{ [levelId]: ['c1','c3',...] } 达成记勋章；medalCount=累计勋章数（派生字段，读时重算自愈）
  levelMedals: {},
  medalCount: 0,
  // P0 留存-新手 7 日计划：day=当前进行天 / claimed=已领天数集合 / progress=各 metric 累计进度
  newbiePlan: { day: 1, claimed: {}, progress: {} },
  // P0 机库模块养成：modules=三槽已装模块（{weapon: moduleKey|null, armor, engine}）；moduleInv=库存数组（[{key, slot, quality}]）。
  // 只新增字段、不改旧字段：既有 upgrades 升级逻辑完全保留，模块是并行系统。
  modules: { weapon: null, armor: null, engine: null },
  moduleInv: [],
  // P2 体验细节·皮肤装饰（只新增字段，不改旧字段）：
  //   skins={ [shipId]: 当前皮肤索引 }；ownedSkins=已购买皮肤数组（"shipId:skinId"，第 0 款默认自带不进数组）
  skins: {},
  ownedSkins: [],
  // P2 激励广告位预留：去广告纯净版开关（本地立即生效，未来接付费解锁）
  noAds: false,
  // P2 系统扩展·无尽周赛（本地假组，纯本地不接后端）：
  //   week=ISO 周 key（"2026-W34"）；score=本周无尽最高分；rank=本周名次（固定种子伪随机组）；
  //   claimed=是否已结算（周切换自动结算上周奖励后置 true，新周重置 false）
  league: { week: '', score: 0, claimed: false, rank: 0 },
  // P1 留存·深空爬塔：towerTop=历史最高层数（无尽爬塔 Boss 波通关数，append-only 新字段）
  towerTop: 0,
  // P1 留存·每日活跃宝箱：dailyActs={ date: 当天 YYYY-MM-DD, count: 当日游玩局数,
  //   chests: { 3: 第3局宝箱是否已领, 5: 第5局宝箱是否已领 } }（跨天自动重置）
  dailyActs: { date: '', count: 0, chests: { 3: false, 5: false } },
  // P1 留存·回归激励：returnGift={ grantedAt: 最近一次领取回归礼包日期 YYYY-MM-DD }（null=未领过；7 天冷却）
  returnGift: null,
  // P1 留存·社交排行（本地）：topScores=[{score, levelId, mode, date}] 最多 10 条，按 score 降序
  topScores: [],
  // OPT-13 批A A9 连续失败救济局（append-only，只新增字段不改旧字段）：
  //   failStreak={ [levelId]: n } 各关连续失败计数；reliefRuns=救济局累计次数（统计用）
  failStreak: {},
  reliefRuns: 0,
};

let cache = null;

// A1 存档降频：脏标记 + rAF/微任务合并写（同帧多次 save() 合并为一次落盘）；
// 无 requestAnimationFrame 环境（Node qa_probes）退化为同步写。_broken=持久化降级态。
let _dirty = false;
let _flushScheduled = false;
let _broken = false;
let _saveFailedNotified = false;

/**
 * 生成一份全新的默认存档。
 * 注意：不能直接 `{ ...DEFAULT_SAVE }` —— 那样 upgrades/achievementStats 等嵌套对象
 * 与 DEFAULT_SAVE 共享引用，升级一次就会污染默认值（reset() 之后等级还在）。
 */
function freshSave() {
  return {
    ...DEFAULT_SAVE,
    upgrades: { ...DEFAULT_SAVE.upgrades },
    levelStars: {},
    achievements: {},
    achievementStats: {
      ...DEFAULT_SAVE.achievementStats,
      elementKills: { ...DEFAULT_SAVE.achievementStats.elementKills },
    },
    bossesDefeated: {},
    dailyQuest: { date: '', claimed: false, progress: {}, picked: [] },
    levelMedals: {},
    medalCount: 0,
    newbiePlan: { day: 1, claimed: {}, progress: {} },
    modules: { weapon: null, armor: null, engine: null },
    moduleInv: [],
    skins: {},
    ownedSkins: [],
    noAds: false,
    sensitivity: 1.0,
    touchOffset: 36,
    lang: 'zh',
    league: { week: '', score: 0, claimed: false, rank: 0 },
    towerTop: 0,
    dailyActs: { date: '', count: 0, chests: { 3: false, 5: false } },
    returnGift: null,
    topScores: [],
    failStreak: {},
    reliefRuns: 0,
  };
}

export const SaveManager = {
  load() {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { cache = freshSave(); return cache; }
      const parsed = JSON.parse(raw);
      cache = {
        ...DEFAULT_SAVE,
        ...parsed,
        // 深合并：老存档没有的升级项（如 wingmanFirepower）兜底为默认 0，避免 undefined
        upgrades: { ...DEFAULT_SAVE.upgrades, ...(parsed.upgrades || {}) },
        // levelStars/achievements 必须深拷贝：缺这两个键的老存档若走 ...DEFAULT_SAVE 兜底，
        // cache 会直接引用 DEFAULT_SAVE 上的同一个对象并被就地写脏（recordLevelStars /
        // unlockAchievement 都是原地赋值），污染后续 freshSave()/reset() 的默认值。
        levelStars: { ...(parsed.levelStars || {}) },
        achievements: { ...(parsed.achievements || {}) },
        achievementStats: {
          ...DEFAULT_SAVE.achievementStats,
          ...(parsed.achievementStats || {}),
          elementKills: {
            ...DEFAULT_SAVE.achievementStats.elementKills,
            ...((parsed.achievementStats && parsed.achievementStats.elementKills) || {}),
          },
        },
        bossesDefeated: parsed.bossesDefeated || {},
        dailyQuest: {
          date: '', claimed: false, progress: {}, picked: [],
          ...(parsed.dailyQuest || {}),
          progress: { ...((parsed.dailyQuest && parsed.dailyQuest.progress) || {}) },
        },
        // P0 留存-关卡勋章：深拷贝防默认对象被写脏；medalCount 为派生字段，统一重算自愈
        levelMedals: { ...((parsed.levelMedals || {})) },
        medalCount: 0,
        // P0 留存-新手 7 日计划：深合并，老存档缺失兜底默认
        newbiePlan: {
          day: 1, claimed: {}, progress: {},
          ...(parsed.newbiePlan || {}),
          claimed: { ...((parsed.newbiePlan && parsed.newbiePlan.claimed) || {}) },
          progress: { ...((parsed.newbiePlan && parsed.newbiePlan.progress) || {}) },
        },
        // P0 机库模块养成：三槽深合并（老存档缺失兜底 null）+ 库存数组兜底 []；模块都是 {key,slot,quality} 引用式数据，无需更深拷贝
        modules: { weapon: null, armor: null, engine: null, ...((parsed.modules) || {}) },
        moduleInv: Array.isArray(parsed.moduleInv) ? parsed.moduleInv : [],
        // P2 体验细节·皮肤装饰：只新增字段，老存档缺失兜底默认
        skins: { ...((parsed.skins) || {}) },
        ownedSkins: Array.isArray(parsed.ownedSkins) ? parsed.ownedSkins : [],
        // P2 激励广告位预留：去广告纯净版开关（布尔，老存档缺失默认 false）
        noAds: !!parsed.noAds,
        // P1 表现工程·触控手感/i18n（append-only，只新增字段不改旧字段）：
        // 老存档缺失兜底默认；越界值钳位自愈
        sensitivity: Math.min(1.5, Math.max(0.5, Number(parsed.sensitivity) || 1.0)),
        touchOffset: (parsed.touchOffset != null) ? Math.max(0, Math.round(Number(parsed.touchOffset) || 0)) : 36,
        lang: (parsed.lang === 'en') ? 'en' : 'zh',
        // P2 系统扩展·无尽周赛：深合并，老存档缺失兜底默认（只新增字段，不改旧字段）
        league: {
          week: '', score: 0, claimed: false, rank: 0,
          ...(parsed.league || {}),
        },
        // P1 留存·深空爬塔：只新增字段，老存档缺失兜底 0
        towerTop: Math.max(0, Math.floor(Number(parsed.towerTop) || 0)),
        // P1 留存·每日活跃宝箱：深合并（含 date 与 chests 子对象），老存档缺失兜底默认
        dailyActs: {
          date: '', count: 0, chests: { 3: false, 5: false },
          ...((parsed.dailyActs) || {}),
          chests: {
            3: false, 5: false,
            ...((parsed.dailyActs && parsed.dailyActs.chests) || {}),
          },
        },
        // P1 留存·回归激励：只新增字段，非法/缺失兜底 null
        returnGift: (parsed.returnGift && parsed.returnGift.grantedAt)
          ? { grantedAt: String(parsed.returnGift.grantedAt) } : null,
        // P1 留存·社交排行（本地）：数组兜底，最多保留 10 条
        topScores: Array.isArray(parsed.topScores) ? parsed.topScores.slice(0, 10) : [],
      };
      // 勋章计数是派生字段：每次 load 从 levelMedals 重算，老存档/脏数据自动自愈
      cache.medalCount = Object.values(cache.levelMedals || {})
        .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
      // 合法性清洗：老存档/脏数据不在 DIFFICULTIES 内则回退 standard
      if (!DIFFICULTIES.some((d) => d.id === cache.selectedDifficulty)) {
        cache.selectedDifficulty = 'standard';
      }
      // 画质档清洗（P0）：不在 PERFORMANCE.tiers 内则回退 high（老存档/脏数据兜底）
      if (!PERFORMANCE.tiers.includes(cache.quality)) {
        cache.quality = PERFORMANCE.defaultTier;
      }
    } catch (e) {
      cache = freshSave();
    }
    return cache;
  },

  save() {
    if (!cache) return;
    // A1 存档降频：脏标记 + rAF 合并写；同帧多次 save() 只写一次盘（每金币 addCoins 不再触发写盘风暴）。
    // 无 requestAnimationFrame 环境（Node 头测 qa_probes）退化为同步写，保证既有探针不破。
    _dirty = true;
    if (typeof requestAnimationFrame === 'function') {
      if (!_flushScheduled) {
        _flushScheduled = true;
        requestAnimationFrame(() => { _flushScheduled = false; this.flushNow(); });
      }
    } else {
      this.flushNow();
    }
  },

  /** A1 立即同步写盘并清脏（endGame 结算等关键路径调用，保证结算数据不丢） */
  flushNow() {
    if (!cache) return;
    _dirty = false;
    _flushScheduled = false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(cache));
      _broken = false; // 写成功恢复持久化态
    } catch (e) {
      // 隐私模式/超配额：进入降级态，仅首次经 EVENTS.SAVE_FAILED 一次性提示（避免刷屏）
      _broken = true;
      if (!_saveFailedNotified) {
        _saveFailedNotified = true;
        try { EventBus.emit(EVENTS.SAVE_FAILED); } catch (err) { /* EventBus 不可用时忽略 */ }
      }
    }
  },

  /** A1 是否处于持久化降级态（localStorage 写入失败后为 true） */
  isPersistBroken() {
    return _broken === true;
  },

  get(key) {
    return this.load()[key];
  },

  set(key, value) {
    this.load()[key] = value;
    this.save();
  },

  addCoins(n) {
    const s = this.load();
    s.coins += n;
    this.save();
    return s.coins;
  },

  /** 扣金币（升级/消费用），不低于 0，返回剩余金币 */
  deductCoins(n) {
    const s = this.load();
    s.coins = Math.max(0, s.coins - n);
    this.save();
    return s.coins;
  },

  /** 读取全局最高分（无记录返回 0） */
  getBestScore() {
    return this.load().bestScore || 0;
  },

  /** 更新全局最高分；破纪录返回 true，否则 false（不降分） */
  recordBestScore(score) {
    const s = this.load();
    const v = Math.max(0, Math.floor(Number(score) || 0));
    if (v > s.bestScore) {
      s.bestScore = v;
      this.save();
      return true;
    }
    return false;
  },

  recordLevelStars(levelId, stars) {
    const s = this.load();
    const prev = s.levelStars[levelId] || 0;
    if (stars > prev) s.levelStars[levelId] = stars;
    if (levelId >= s.unlockedLevel) s.unlockedLevel = levelId + 1;
    this.save();
  },

  hasAchievement(id) {
    return !!this.load().achievements[id];
  },

  /** 解锁成就；已解锁则返回 false（不重复触发） */
  unlockAchievement(id) {
    const s = this.load();
    if (s.achievements[id]) return false;
    s.achievements[id] = true;
    this.save();
    return true;
  },

  getAchievements() {
    return { ...this.load().achievements };
  },

  /** 深合并累计成就统计并保存（局末调一次） */
  saveAchievementStats(partial) {
    const s = this.load();
    s.achievementStats = {
      ...s.achievementStats,
      ...(partial || {}),
      elementKills: {
        ...s.achievementStats.elementKills,
        ...((partial && partial.elementKills) || {}),
      },
    };
    this.save();
  },

  // ---- 每日签到（P1 扩展：7 日循环大奖 + 补签）----
  _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  _yesterdayStr() {
    const y = new Date(Date.now() - 86400000);
    return `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  },

  /** 连签第 N 天（1~7 循环）：checkinStreak=0（从未签到）时视为第 1 天 */
  _checkinDayFromStreak(streak) {
    const s = Math.max(0, Number(streak) || 0);
    return s === 0 ? 1 : ((s - 1) % 7) + 1;
  },

  /** 第 N 天奖励金币（CHECKIN_REWARDS[N-1]；第 7 天大奖 800） */
  _checkinRewardForDay(day) {
    const d = Math.min(7, Math.max(1, day));
    return (CHECKIN_REWARDS && CHECKIN_REWARDS[d - 1]) != null ? CHECKIN_REWARDS[d - 1] : 50;
  },

  canCheckInToday() {
    return this.load().lastCheckin !== this._todayStr();
  },

  /**
   * 签到：今天未签则发奖并累加连签（7 日循环）。
   * 第 7 天大奖：800 金币；僚机未满级额外 +1（僚机碎片语义，满级则纯金币）。
   * 返回 { claimed, streak, day, reward, wingmanUpgraded }
   */
  checkIn() {
    const s = this.load();
    const today = this._todayStr();
    if (s.lastCheckin === today) return { claimed: false, streak: s.checkinStreak, reward: 0 };
    const yStr = this._yesterdayStr();
    s.checkinStreak = (s.lastCheckin === yStr) ? s.checkinStreak + 1 : 1;
    s.lastCheckin = today;
    const day = this._checkinDayFromStreak(s.checkinStreak);
    let reward = this._checkinRewardForDay(day);
    let wingmanUpgraded = false;
    if (day === 7) {
      const up = s.upgrades || {};
      const max = (UPGRADE_TREE.wingman && UPGRADE_TREE.wingman.max) || 2;
      if ((up.wingman || 0) < max) {
        up.wingman = (up.wingman || 0) + 1;
        wingmanUpgraded = true;
      }
    }
    s.coins += reward;
    this.save();
    return { claimed: true, streak: s.checkinStreak, day, reward, wingmanUpgraded };
  },

  /** 签到循环快照（面板展示）：streak/day/rewards/是否今天已签/可否补签 */
  getCheckinCycle() {
    const s = this.load();
    const streak = s.checkinStreak || 0;
    const today = this._todayStr();
    const yStr = this._yesterdayStr();
    const canMakeup = !!s.lastCheckin && s.lastCheckin !== today && s.lastCheckin !== yStr;
    return {
      streak,
      day: this._checkinDayFromStreak(streak),
      rewards: CHECKIN_REWARDS ? CHECKIN_REWARDS.slice() : [],
      checkedToday: s.lastCheckin === today,
      canMakeup,
      makeupCost: CHECKIN_MAKEUP_COST || 100,
    };
  },

  /**
   * 补签：断签 ≥1 天时可消耗金币补签 1 天（保留连签进度）。
   * 补签后 lastCheckin 记为昨天，今天再 checkIn() 即延续连签。
   * 返回 { claimed, streak, cost } 或 { claimed:false, reason }
   */
  makeupCheckIn() {
    const s = this.load();
    const today = this._todayStr();
    const yStr = this._yesterdayStr();
    if (s.lastCheckin === today) return { claimed: false, reason: 'checked' };
    if (!s.lastCheckin || s.lastCheckin === yStr) return { claimed: false, reason: 'no-gap' };
    if ((s.coins || 0) < (CHECKIN_MAKEUP_COST || 100)) return { claimed: false, reason: 'no-coins' };
    s.coins = Math.max(0, s.coins - (CHECKIN_MAKEUP_COST || 100));
    s.checkinStreak = (s.checkinStreak || 0) + 1;
    s.lastCheckin = yStr; // 视作昨天已签到，今天再签到即延续连签
    this.save();
    return { claimed: true, streak: s.checkinStreak, cost: CHECKIN_MAKEUP_COST || 100 };
  },

  // ---- 每日任务（留存系统 #每日任务）----
  /** 确定性日期种子：同一天全平台抽到同一组任务 */
  _dailySeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  /** 取当日任务（数组）。跨天自动刷新：重置进度与领取状态，按日期种子抽 DAILY_QUEST_PICK 个 */
  getDailyQuests() {
    const s = this.load();
    const today = this._todayStr();
    if (s.dailyQuest.date !== today) {
      const pool = DAILY_QUEST_POOL;
      const pick = Math.max(1, Number(DAILY_QUEST_PICK) || 4);
      const start = this._dailySeed(today) % pool.length;
      const picked = [];
      for (let k = 0; k < pick; k++) picked.push(pool[(start + k) % pool.length].metric);
      s.dailyQuest = { date: today, claimed: false, progress: {}, picked };
      this.save();
    }
    const dq = s.dailyQuest;
    return dq.picked.map((m) => {
      const tpl = DAILY_QUEST_POOL.find((q) => q.metric === m) || { metric: m, target: 1, desc: m, reward: 0 };
      const cur = Math.min(dq.progress[m] || 0, tpl.target);
      return { ...tpl, progress: cur, done: cur >= tpl.target };
    });
  },

  /** 累计当日任务进度（不立即存盘，由 endGame / claim 统一 flush，避免每杀一怪写 localStorage） */
  addDailyProgress(metric, n) {
    if (!n) return;
    const s = this.load();
    const today = this._todayStr();
    if (s.dailyQuest.date !== today) this.getDailyQuests();
    const dq = s.dailyQuest;
    if (!dq.picked.includes(metric)) return;
    dq.progress[metric] = (dq.progress[metric] || 0) + n;
  },

  /** 当日任务是否全部完成且尚未领取 */
  dailyQuestsReady() {
    const q = this.getDailyQuests();
    return q.length > 0 && q.every((x) => x.done);
  },

  dailyQuestsClaimed() {
    return this.load().dailyQuest.claimed === true;
  },

  /** 领取当日全部任务奖励（单条金币之和 + 全清奖励）；未全完成返回 { notReady:true }，已领返回 { claimed:false } */
  claimDailyQuests() {
    const s = this.load();
    const today = this._todayStr();
    if (s.dailyQuest.date !== today) this.getDailyQuests();
    const dq = s.dailyQuest;
    if (dq.claimed) return { claimed: false, reward: 0 };
    const q = this.getDailyQuests();
    if (!q.every((x) => x.done)) return { claimed: false, reward: 0, notReady: true };
    const base = q.reduce((sum, x) => sum + x.reward, 0);
    const bonus = Math.max(0, Number(DAILY_QUEST_ALL_CLEAR_BONUS) || 0);
    const reward = base + bonus;
    s.coins += reward;
    dq.claimed = true;
    this.save();
    return { claimed: true, reward, base, bonus, count: q.length };
  },

  // ---- 关卡勋章（P0 留存：重玩动力）----
  /** 某关已达成勋章 id 列表（无则空数组） */
  getLevelMedals(levelId) {
    const arr = this.load().levelMedals[levelId];
    return Array.isArray(arr) ? arr : [];
  },

  /** 累计勋章数：从 levelMedals 实时重算（派生字段，自愈防脏） */
  countMedals() {
    const s = this.load();
    const n = Object.values(s.levelMedals || {})
      .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    if (s.medalCount !== n) { s.medalCount = n; this.save(); }
    return n;
  },

  /** 记录某关达成勋章（append-only 幂等合并）；返回本关勋章数 */
  recordLevelMedals(levelId, ids) {
    const s = this.load();
    if (!ids || !ids.length) return this.getLevelMedals(levelId).length;
    const set = new Set(this.getLevelMedals(levelId));
    ids.forEach((id) => set.add(id));
    s.levelMedals[levelId] = Array.from(set);
    this.countMedals(); // 重算 medalCount 并保存
    return s.levelMedals[levelId].length;
  },

  // ---- 新手 7 日计划（P0 留存：新手成长目标）----
  /** 累计计划进度。save=true 立即存盘（机库等无 endGame flush 的场景）；默认由 endGame 统一 flush */
  addNewbieProgress(metric, n, { save = false } = {}) {
    if (!n) return;
    const s = this.load();
    const np = s.newbiePlan || (s.newbiePlan = { day: 1, claimed: {}, progress: {} });
    if (!np.progress) np.progress = {};
    np.progress[metric] = (np.progress[metric] || 0) + n;
    if (save) this.save();
  },

  /** 当前计划快照：7 天目标 + 进度 + 状态（isCurrent=当前进行天） */
  getNewbiePlan() {
    const s = this.load();
    const np = s.newbiePlan || (s.newbiePlan = { day: 1, claimed: {}, progress: {} });
    if (!np.progress) np.progress = {};
    if (!np.claimed) np.claimed = {};
    const day = Math.max(1, Number(np.day) || 1);
    return NEWBIE_PLAN.map((d) => {
      const progress = Math.min(np.progress[d.metric] || 0, d.target);
      const claimed = !!(np.claimed && np.claimed[d.day]);
      const done = progress >= d.target;
      return { ...d, progress, done, claimed, isCurrent: d.day === day, isFuture: d.day > day };
    });
  },

  /** 当日目标是否已达成 */
  newbieDayDone() {
    const cur = this.getNewbiePlan().find((x) => x.isCurrent);
    return cur ? cur.done : false;
  },

  /**
   * 领取当前天奖励：目标达成且未领才发奖；第 7 天额外僚机升级 +1（满级改发金币大礼包）。
   * 返回 { claimed, reward, day, wingmanUpgraded, extraCoins }
   */
  claimNewbieDay() {
    const s = this.load();
    const np = s.newbiePlan || (s.newbiePlan = { day: 1, claimed: {}, progress: {} });
    if (!np.claimed) np.claimed = {};
    const day = Math.max(1, Number(np.day) || 1);
    const cur = this.getNewbiePlan().find((x) => x.isCurrent);
    if (!cur) return { claimed: false, reward: 0, day };
    if (!cur.done) return { claimed: false, reward: 0, day, notReady: true };
    if (np.claimed[day]) return { claimed: false, reward: 0, day };
    np.claimed[day] = true;
    let reward = cur.reward;
    let wingmanUpgraded = false;
    let extraCoins = 0;
    if (day === 7) {
      const up = s.upgrades || {};
      const max = (UPGRADE_TREE.wingman && UPGRADE_TREE.wingman.max) || 2;
      if ((up.wingman || 0) < max) {
        up.wingman = (up.wingman || 0) + 1;
        wingmanUpgraded = true;
      } else {
        // 满级僚机 → 改发金币大礼包
        extraCoins = 200;
        reward += 200;
      }
    }
    s.coins += reward;
    np.day = day + 1; // 推进到次日
    this.save();
    return { claimed: true, reward, day, wingmanUpgraded, extraCoins };
  },

  // ---- P0 机库模块养成（只新增字段，不碰既有 upgrades 逻辑）----
  /** 模块 key 是否合法（定义在 MODULES） */
  _isModule(key) {
    return !!(key && MODULES[key]);
  },

  /** 按 key 加入库存。合法模块返回 true。 */
  addModule(key) {
    const s = this.load();
    const def = MODULES[key];
    if (!def) return false;
    if (!Array.isArray(s.moduleInv)) s.moduleInv = [];
    s.moduleInv.push({ key, slot: def.slot, quality: def.quality });
    this.save();
    return true;
  },

  /** 随机模块：85% common / 15% rare，随机槽位；返回 { key } 或 null */
  addRandomModule() {
    const slots = MODULE_SLOTS.map((x) => x.key);
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const quality = (Math.random() < 0.85) ? 'common' : 'rare';
    const key = `${slot}_${quality}`;
    this.addModule(key);
    return { key };
  },

  /**
   * 购买随机模块：按品质定价（MODULE_SHOP.common=500 / rare=1200），金币不足返回 null。
   * @param {string} quality 'common' | 'rare'
   */
  buyRandomModule(quality) {
    const q = (quality === 'rare') ? 'rare' : 'common';
    const price = MODULE_SHOP[q];
    const s = this.load();
    if (s.coins < price) return null;
    s.coins = Math.max(0, s.coins - price);
    this.save();
    const slots = MODULE_SLOTS.map((x) => x.key);
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const key = `${slot}_${q}`;
    this.addModule(key);
    return { key, price };
  },

  /** 装备模块：库存取出放入对应槽位；同槽位已装模块退回库存。返回是否成功 */
  equipModule(key) {
    const s = this.load();
    const def = MODULES[key];
    if (!def) return false;
    const idx = (s.moduleInv || []).findIndex((m) => m && m.key === key);
    if (idx < 0) return false;
    const [mod] = s.moduleInv.splice(idx, 1);
    if (!s.modules) s.modules = { weapon: null, armor: null, engine: null };
    const prev = s.modules[def.slot];
    if (prev && MODULES[prev]) {
      s.moduleInv.push({ key: prev, slot: def.slot, quality: MODULES[prev].quality });
    }
    s.modules[def.slot] = key;
    this.save();
    return true;
  },

  /** 卸下模块：槽位模块退回库存。无模块返回 false */
  unequipModule(slot) {
    const s = this.load();
    if (!s.modules || !s.modules[slot]) return false;
    const key = s.modules[slot];
    if (!MODULES[key]) { s.modules[slot] = null; this.save(); return true; }
    if (!Array.isArray(s.moduleInv)) s.moduleInv = [];
    s.moduleInv.push({ key, slot, quality: MODULES[key].quality });
    s.modules[slot] = null;
    this.save();
    return true;
  },

  /** 库存中某槽 common 模块数量 */
  countCommonModules(slot) {
    return (this.load().moduleInv || []).filter((m) => m && m.slot === slot && m.quality === 'common').length;
  },

  /**
   * 合成：2 个同槽同名同品质（common）模块 → 1 个同槽高一级品质（rare）。
   * 数量不足返回 null；成功返回 { key }。
   */
  craftModule(slot) {
    const s = this.load();
    const inv = Array.isArray(s.moduleInv) ? s.moduleInv : [];
    const commons = inv.filter((m) => m && m.slot === slot && m.quality === 'common');
    if (commons.length < 2) return null;
    let removed = 0;
    for (let i = inv.length - 1; i >= 0 && removed < 2; i--) {
      if (inv[i] && inv[i].slot === slot && inv[i].quality === 'common') {
        inv.splice(i, 1);
        removed++;
      }
    }
    const key = `${slot}_rare`;
    inv.push({ key, slot, quality: 'rare' });
    this.save();
    return { key };
  },

  reset() {
    cache = freshSave();
    this.save();
  },

  // ---- P2 体验细节·皮肤装饰（只新增字段与方法，不改旧字段）----
  /** 当前战机皮肤索引（无记录默认 0） */
  getSkin(shipId) {
    const s = this.load();
    const idx = s.skins ? s.skins[shipId] : undefined;
    return (idx != null) ? idx : 0;
  },

  /** 是否已拥有某皮肤（第 0 款默认自带；其余查 ownedSkins 数组） */
  ownsSkin(shipId, skinId) {
    const id = Number(skinId) || 0;
    if (id === 0) return true;
    return (this.load().ownedSkins || []).includes(`${Number(shipId)}:${id}`);
  },

  /** 切换皮肤（仅限已拥有；未拥有返回 false，不发金币） */
  equipSkin(shipId, skinId) {
    const s = this.load();
    const id = Number(skinId) || 0;
    if (!this.ownsSkin(shipId, id)) return false;
    if (!s.skins) s.skins = {};
    s.skins[shipId] = id;
    this.save();
    return true;
  },

  /** 金币购买皮肤：每款 800（SKIN_PRICE）。成功返回 true，金币不足/已拥有返回 false */
  buySkin(shipId, skinId) {
    const s = this.load();
    const id = Number(skinId) || 0;
    if (id === 0 || this.ownsSkin(shipId, id)) return false;
    if (s.coins < SKIN_PRICE) return false;
    if (!Array.isArray(s.ownedSkins)) s.ownedSkins = [];
    s.coins = Math.max(0, s.coins - SKIN_PRICE);
    s.ownedSkins.push(`${Number(shipId)}:${id}`);
    this.addDailyProgress('skins', 1); // P1 留存-每日任务：皮肤购买进度
    this.save();
    return true;
  },

  // ---- 无尽周赛（P2 系统扩展：无尽周赛，本地假组，纯本地不接后端）----
  /** 固定种子伪随机组：同分必同排名（纯本地模拟 50 人假组），rank ∈ [1, GROUP_SIZE] */
  _leagueRankForScore(score) {
    const s = Math.max(0, Math.floor(Number(score) || 0));
    const gs = (WEEKLY_LEAGUE && WEEKLY_LEAGUE.GROUP_SIZE) || 50;
    return (Math.floor(s * 0.7 + 17) % gs) + 1;
  },

  /** 按 rank 查周赛金币奖励（score<=0 不发奖）；REWARDS 支持单值 rank 与 "a-b" 区间 */
  _leagueRewardForRank(rank, score) {
    if (!score || score <= 0) return 0;
    const rewards = (WEEKLY_LEAGUE && WEEKLY_LEAGUE.REWARDS) || [];
    for (const r of rewards) {
      if (!r || r.coins == null) continue;
      if (typeof r.rank === 'number') {
        if (rank === r.rank) return r.coins;
      } else {
        const m = String(r.rank).match(/(\d+)\s*-\s*(\d+)/);
        if (m) {
          const a = Number(m[1]); const b = Number(m[2]);
          if (rank >= a && rank <= b) return r.coins;
        }
      }
    }
    return 0;
  },

  /**
   * 本周赛快照（进菜单/结算前调用一次）：
   * - 周切换（ISO 周号变化）自动结算上周奖励（rank → REWARDS 金币）并重置本周；
   * - 同周内按本周最高分算 rank（固定种子，同分同排名）。
   * 返回 { week, score, rank, settled, reward, settledRank }
   */
  getLeagueSnapshot() {
    const s = this.load();
    const week = getIsoWeekKey();
    const lg = s.league || (s.league = { week: '', score: 0, claimed: false, rank: 0 });
    if (lg.week && lg.week !== week) {
      // 跨周：先按上周 rank 结算金币，再重置本周
      const settledRank = lg.rank || this._leagueRankForScore(lg.score);
      const reward = this._leagueRewardForRank(settledRank, lg.score);
      if (reward > 0) s.coins += reward;
      lg.week = week; lg.score = 0; lg.claimed = true;
      const rank = this._leagueRankForScore(0);
      lg.rank = rank;
      this.save();
      return { week, score: 0, rank, settled: true, reward, settledRank };
    }
    if (!lg.week) { lg.week = week; this.save(); }
    const score = Math.max(0, Math.floor(Number(lg.score) || 0));
    const rank = this._leagueRankForScore(score);
    lg.rank = rank;
    return { week, score, rank, settled: false, reward: 0, settledRank: 0 };
  },

  /** 记录本周无尽分数（endless endGame 调用，取本周最高分；跨周自动先结算上周） */
  recordLeagueScore(score) {
    const s = this.load();
    const week = getIsoWeekKey();
    const lg = s.league || (s.league = { week: '', score: 0, claimed: false, rank: 0 });
    if (lg.week && lg.week !== week) {
      const settledRank = lg.rank || this._leagueRankForScore(lg.score);
      const reward = this._leagueRewardForRank(settledRank, lg.score);
      if (reward > 0) s.coins += reward;
      lg.week = week; lg.score = 0; lg.rank = 0; lg.claimed = true;
    }
    if (!lg.week) lg.week = week;
    const v = Math.max(0, Math.floor(Number(score) || 0));
    if (v > (lg.score || 0)) lg.score = v;
    lg.rank = this._leagueRankForScore(lg.score);
    this.save();
    return lg;
  },

  // ---- P1 留存·深空爬塔（无尽升级）----
  /** 历史最高爬塔层数（Boss 波通关数）；无记录返回 0 */
  getTowerTop() {
    return Math.max(0, Math.floor(Number(this.load().towerTop) || 0));
  },

  /** 记录本次爬塔层数（只升不降）；返回更新后的最高层数 */
  recordTowerTop(floor) {
    const s = this.load();
    const f = Math.max(0, Math.floor(Number(floor) || 0));
    if (f > (Number(s.towerTop) || 0)) {
      s.towerTop = f;
      this.save();
    }
    return this.getTowerTop();
  },

  // ---- P1 留存·每日活跃宝箱（当日游玩局数）----
  /** 当日活跃快照（跨天自动重置）：{ count, chests:{3,5} } */
  getDailyActs() {
    const s = this.load();
    const today = this._todayStr();
    const da = s.dailyActs || (s.dailyActs = { date: '', count: 0, chests: { 3: false, 5: false } });
    if (da.date !== today) {
      da.date = today; da.count = 0; da.chests = { 3: false, 5: false };
      this.save();
    }
    return { count: Math.max(0, Number(da.count) || 0), chests: { 3: !!da.chests[3], 5: !!da.chests[5] } };
  },

  /** 当日游玩 +1（endGame 每局调一次；跨天自动重置） */
  addDailyAct() {
    const s = this.load();
    const today = this._todayStr();
    const da = s.dailyActs || (s.dailyActs = { date: '', count: 0, chests: { 3: false, 5: false } });
    if (da.date !== today) { da.date = today; da.count = 0; da.chests = { 3: false, 5: false }; }
    da.count = Math.max(0, Number(da.count) || 0) + 1;
    this.save();
    return da.count;
  },

  /**
   * 领取活跃宝箱：n=3 或 5，当日游玩达到阈值且未领 → 发金币（随机区间）+ 随机机库模块。
   * 返回 { claimed, coins, module, count } 或 { claimed:false, reason }
   */
  claimDailyChest(n) {
    const n2 = (Number(n) === 3 || Number(n) === 5) ? Number(n) : 0;
    if (!n2) return { claimed: false, reason: 'bad' };
    const s = this.load();
    const today = this._todayStr();
    const da = s.dailyActs || (s.dailyActs = { date: '', count: 0, chests: { 3: false, 5: false } });
    if (da.date !== today) { da.date = today; da.count = 0; da.chests = { 3: false, 5: false }; }
    if (da.chests[n2]) return { claimed: false, reason: 'claimed' };
    if ((Number(da.count) || 0) < n2) return { claimed: false, reason: 'not-enough' };
    da.chests[n2] = true;
    const min = (ACTIVE_CHEST && ACTIVE_CHEST.COINS_MIN) || 50;
    const max = (ACTIVE_CHEST && ACTIVE_CHEST.COINS_MAX) || 120;
    const coins = min + Math.floor(Math.random() * Math.max(1, max - min + 1));
    s.coins = (s.coins || 0) + coins;
    const mod = this.addRandomModule();
    this.save();
    return { claimed: true, coins, module: mod ? mod.key : null, count: da.count };
  },

  // ---- P1 留存·回归激励（断签召回）----
  /** 断签天数（距上次签到；从未签到返回 -1，不触发回归礼包） */
  _missDays() {
    const s = this.load();
    if (!s.lastCheckin) return -1;
    const last = new Date(`${s.lastCheckin}T00:00:00`);
    const today = new Date(`${this._todayStr()}T00:00:00`);
    if (Number.isNaN(last.getTime())) return -1;
    return Math.max(0, Math.round((today - last) / 86400000));
  },

  /**
   * 回归礼包状态：断签 ≥ MISS_DAYS 天 且 距上次领取 ≥ COOLDOWN_DAYS 天 → due=true。
   * 返回 { due, missDays, cooldownLeft, grantedAt }
   */
  getReturnGiftStatus() {
    const s = this.load();
    const miss = this._missDays();
    const missDays = miss < 0 ? 0 : miss;
    const cfg = RETURN_GIFT || { MISS_DAYS: 3, COOLDOWN_DAYS: 7 };
    let cooldownLeft = 0;
    let grantedAt = null;
    if (s.returnGift && s.returnGift.grantedAt) {
      grantedAt = s.returnGift.grantedAt;
      const g = new Date(`${grantedAt}T00:00:00`);
      const today = new Date(`${this._todayStr()}T00:00:00`);
      if (!Number.isNaN(g.getTime())) {
        const elapsed = Math.max(0, Math.round((today - g) / 86400000));
        cooldownLeft = Math.max(0, (cfg.COOLDOWN_DAYS || 7) - elapsed);
      }
    }
    const due = miss >= 0 && miss >= (cfg.MISS_DAYS || 3) && cooldownLeft === 0;
    return { due, missDays, cooldownLeft, grantedAt };
  },

  /** 领取回归礼包：金币 + 随机机库模块；领后记 returnGift.grantedAt（7 天冷却）。未到触发条件返回 { claimed:false } */
  claimReturnGift() {
    const s = this.load();
    const st = this.getReturnGiftStatus();
    if (!st.due) return { claimed: false, reason: 'not-due' };
    const cfg = RETURN_GIFT || { COINS: 500 };
    s.coins = (s.coins || 0) + (cfg.COINS || 500);
    const mod = this.addRandomModule();
    s.returnGift = { grantedAt: this._todayStr() };
    this.save();
    return { claimed: true, coins: cfg.COINS || 500, module: mod ? mod.key : null };
  },

  // ---- P1 留存·社交排行（本地历史 Top10）----
  /** 本地历史 Top10（按 score 降序，最多 10 条） */
  getTopScores() {
    const s = this.load();
    return Array.isArray(s.topScores) ? s.topScores.slice(0, 10) : [];
  },

  /**
   * 插入一条成绩（按 score 降序，最多 10 条）。
   * 返回 { entered: 是否入榜, rank: 名次（1 起；未入榜 -1）, list: 入榜后列表 }
   */
  addTopScore(entry) {
    const s = this.load();
    if (!Array.isArray(s.topScores)) s.topScores = [];
    const score = Math.max(0, Math.floor(Number(entry && entry.score) || 0));
    if (score <= 0) return { entered: false, rank: -1, list: this.getTopScores() };
    const rec = {
      score,
      levelId: (entry && entry.levelId != null) ? entry.levelId : 1,
      mode: (entry && entry.mode) || 'normal',
      date: (entry && entry.date) || this._todayStr(),
    };
    s.topScores.push(rec);
    s.topScores.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    if (s.topScores.length > 10) s.topScores.length = 10;
    this.save();
    const rank = s.topScores.indexOf(rec) + 1;
    return { entered: rank > 0, rank: rank > 0 ? rank : -1, list: this.getTopScores() };
  },
};
