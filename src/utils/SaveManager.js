import { SAVE_KEY } from '../config/GameConfig.js';

/**
 * 存档管理（localStorage）
 * ---------------------------------------------------------------------------
 * 存：金币总数、各部件升级等级、每关最高星级、已解锁关卡。
 * 所有读写走这里，别在别处直接碰 localStorage。
 */
const DEFAULT_SAVE = {
  coins: 0,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0 },
  selectedShip: 0, // C2 战机武器绑定：所选战机索引（对应 GameConfig.SHIPS）
  levelStars: {}, // { [levelId]: stars(1~3) }
  unlockedLevel: 1,
  totalKills: 0,
  achievements: {}, // { [achievementId]: true }
  lastCheckin: '', // 本地日期 YYYY-MM-DD
  checkinStreak: 0,
  tutorialDone: false,
};

let cache = null;

export const SaveManager = {
  load() {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      cache = raw ? { ...DEFAULT_SAVE, ...JSON.parse(raw) } : { ...DEFAULT_SAVE };
    } catch (e) {
      cache = { ...DEFAULT_SAVE };
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

  reset() {
    cache = { ...DEFAULT_SAVE };
    this.save();
  },
};
