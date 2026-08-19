import { SAVE_KEY, DAILY_QUEST_POOL, DIFFICULTIES } from '../config/GameConfig.js';

/**
 * 存档管理（localStorage）
 * ---------------------------------------------------------------------------
 * 存：金币总数、各部件升级等级、每关最高星级、已解锁关卡。
 * 所有读写走这里，别在别处直接碰 localStorage。
 */
const DEFAULT_SAVE = {
  coins: 0,
  // wingmanFirepower：僚机火力（独立于 wingman 数量项），决定 WINGMAN.WEAPON_LV 档位
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 },
  selectedShip: 0, // C2 战机武器绑定：所选战机索引（对应 GameConfig.SHIPS）
  selectedDifficulty: 'standard', // P0 四档难度：所选难度 id（对应 GameConfig.DIFFICULTIES）
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
  // 每日任务（留存系统 #每日任务）：date=当天日期 / claimed=是否已领 / progress=各指标进度 / picked=当天抽中的指标
  dailyQuest: { date: '', claimed: false, progress: {}, picked: [] },
};

let cache = null;

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
      };
      // 合法性清洗：老存档/脏数据不在 DIFFICULTIES 内则回退 standard
      if (!DIFFICULTIES.some((d) => d.id === cache.selectedDifficulty)) {
        cache.selectedDifficulty = 'standard';
      }
    } catch (e) {
      cache = freshSave();
    }
    return cache;
  },

  save() {
    if (!cache) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* 隐私模式/超配额，静默失败 */
    }
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

  // ---- 每日签到 ----
  _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  canCheckInToday() {
    return this.load().lastCheckin !== this._todayStr();
  },

  /** 签到：今天未签则发奖并累加连签；返回 { claimed, streak, reward } */
  checkIn() {
    const s = this.load();
    const today = this._todayStr();
    if (s.lastCheckin === today) return { claimed: false, streak: s.checkinStreak, reward: 0 };
    const y = new Date(Date.now() - 86400000);
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    s.checkinStreak = (s.lastCheckin === yStr) ? s.checkinStreak + 1 : 1;
    s.lastCheckin = today;
    const reward = 50 + (s.checkinStreak - 1) * 20;
    s.coins += reward;
    this.save();
    return { claimed: true, streak: s.checkinStreak, reward };
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

  /** 取当日任务（数组）。跨天自动刷新：重置进度与领取状态，按日期种子抽 3 个 */
  getDailyQuests() {
    const s = this.load();
    const today = this._todayStr();
    if (s.dailyQuest.date !== today) {
      const pool = DAILY_QUEST_POOL;
      const start = this._dailySeed(today) % pool.length;
      const picked = [];
      for (let k = 0; k < 3; k++) picked.push(pool[(start + k) % pool.length].metric);
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

  /** 领取当日全部任务奖励；未全完成返回 { notReady:true }，已领返回 { claimed:false } */
  claimDailyQuests() {
    const s = this.load();
    const today = this._todayStr();
    if (s.dailyQuest.date !== today) this.getDailyQuests();
    const dq = s.dailyQuest;
    if (dq.claimed) return { claimed: false, reward: 0 };
    const q = this.getDailyQuests();
    if (!q.every((x) => x.done)) return { claimed: false, reward: 0, notReady: true };
    const reward = q.reduce((sum, x) => sum + x.reward, 0);
    s.coins += reward;
    dq.claimed = true;
    this.save();
    return { claimed: true, reward, count: q.length };
  },

  reset() {
    cache = freshSave();
    this.save();
  },
};
