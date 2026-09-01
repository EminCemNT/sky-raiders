import { SaveManager } from '../utils/SaveManager.js';
import { EventBus } from '../utils/EventBus.js';
import { EVENTS, LEVELS } from '../config/GameConfig.js';

const MAX_LEVEL = LEVELS.length;

// 进度钳位（Y-06 加固）：原先 progress 全用裸 Math.min(value, target)，
// 只有上限、无下界钳位、且不防 NaN。一旦存档被写脏（如 totalKills=-5 或 "abc"），
// progress 会吐出负数 / NaN 的 cur，getProgress 的 ratio 跟着变 NaN/负数。
// 这里统一收口：下限 0（防负数）、非有限值归零（防 NaN/字符串）、上限 b。
function _safeMin(a, b) {
  const max = Number.isFinite(b) ? b : 0;
  let v = Number.isFinite(a) ? a : 0;
  if (v < 0) v = 0;
  if (v > max) v = max;
  return v;
}

// 23 个成就定义。字段：id/name/desc/icon/type/category/hidden/live/condition(s)/progress(s)
// live:true = 局内事件点实时判定解锁；live:false = 仅局末 reportRun 兜底判定
export const ACHIEVEMENTS = [
  { id: 'tutorial_done', name: '新手上路', desc: '完成新手教程', icon: '🎓', type: 'special', category: 'combat', hidden: false, live: true,
    condition: (s) => !!SaveManager.get('tutorialDone'),
    progress: (s) => ({ cur: SaveManager.get('tutorialDone') ? 1 : 0, target: 1 }) },

  { id: 'first_blood', name: '初露锋芒', desc: '单局击杀 10 个敌人', icon: '🗡️', type: 'kill', category: 'combat', hidden: false, live: true,
    condition: (s) => s.kills >= 10,
    progress: (s) => ({ cur: _safeMin(s.kills, 10), target: 10 }) },

  { id: 'first_clear', name: '初定苍穹', desc: '通关任意一关', icon: '🏆', type: 'clear', category: 'progression', hidden: false, live: false,
    condition: (s) => s.victory && s.mode !== 'bossrush',
    progress: (s) => ({ cur: s.victory ? 1 : 0, target: 1 }) },

  { id: 'super_nova', name: '星河爆发', desc: '单局释放 1 次星风暴', icon: '🌟', type: 'special', category: 'combat', hidden: false, live: true,
    condition: (s) => s.superUsed >= 1,
    progress: (s) => ({ cur: _safeMin(s.superUsed, 1), target: 1 }) },

  { id: 'kill_100', name: '小试身手', desc: '历史累计击杀 100', icon: '💀', type: 'kill', category: 'combat', hidden: false, live: true,
    condition: (s) => s.totalKills >= 100,
    progress: (s) => ({ cur: _safeMin(s.totalKills, 100), target: 100 }) },

  { id: 'kill_500', name: '百人斩', desc: '历史累计击杀 500', icon: '☠️', type: 'kill', category: 'combat', hidden: false, live: true,
    condition: (s) => s.totalKills >= 500,
    progress: (s) => ({ cur: _safeMin(s.totalKills, 500), target: 500 }) },

  { id: 'combo_15', name: '连击大师', desc: '单局连击峰值 15', icon: '⚡', type: 'combo', category: 'combat', hidden: false, live: true,
    condition: (s) => s.comboPeak >= 15,
    progress: (s) => ({ cur: _safeMin(s.comboPeak, 15), target: 15 }) },

  { id: 'combo_30', name: '连击狂人', desc: '单局连击峰值 30', icon: '🌩️', type: 'combo', category: 'combat', hidden: false, live: true,
    condition: (s) => s.comboPeak >= 30,
    progress: (s) => ({ cur: _safeMin(s.comboPeak, 30), target: 30 }) },

  { id: 'flawless', name: '毫发无伤', desc: '无伤通关任意一关', icon: '🛡️', type: 'clear', category: 'mastery', hidden: false, live: false,
    condition: (s) => s.victory && s.damageTaken === 0 && s.mode !== 'bossrush',
    progress: (s) => ({ cur: (s.victory && s.damageTaken === 0) ? 1 : 0, target: 1 }) },

  { id: 'coin_30', name: '金银满仓', desc: '单局收集 30 枚金币', icon: '💰', type: 'coin', category: 'combat', hidden: false, live: true,
    condition: (s) => s.coins >= 30,
    progress: (s) => ({ cur: _safeMin(s.coins, 30), target: 30 }) },

  { id: 'all_clear', name: '苍穹制霸', desc: '累计通关全部 4 关', icon: '👑', type: 'clear', category: 'progression', hidden: false, live: false,
    condition: (s) => Object.keys(SaveManager.get('levelStars') || {}).length >= MAX_LEVEL,
    progress: (s) => ({ cur: _safeMin(Object.keys(SaveManager.get('levelStars') || {}).length, MAX_LEVEL), target: MAX_LEVEL }) },

  { id: 'three_star', name: '完美主义', desc: '单局达成 3 星通关', icon: '⭐', type: 'clear', category: 'mastery', hidden: false, live: false,
    condition: (s) => s.victory && s.stars === 3 && s.mode !== 'bossrush',
    progress: (s) => ({ cur: (s.victory && s.stars === 3) ? 1 : 0, target: 1 }) },

  { id: 'boss_sentinel', name: '哨兵克星', desc: '累计击败哨兵 Sentinel', icon: '🛰️', type: 'boss', category: 'progression', hidden: false, live: true,
    condition: (s) => !!s.bossesDefeated['boss_sentinel'],
    progress: (s) => ({ cur: s.bossesDefeated['boss_sentinel'] ? 1 : 0, target: 1 }) },

  { id: 'boss_crusher', name: '粉碎者克星', desc: '累计击败粉碎者', icon: '🪨', type: 'boss', category: 'progression', hidden: false, live: true,
    condition: (s) => !!s.bossesDefeated['boss_crusher'],
    progress: (s) => ({ cur: s.bossesDefeated['boss_crusher'] ? 1 : 0, target: 1 }) },

  { id: 'boss_overlord', name: '霸主克星', desc: '累计击败霸主', icon: '👹', type: 'boss', category: 'progression', hidden: false, live: true,
    condition: (s) => !!s.bossesDefeated['boss_overlord'],
    progress: (s) => ({ cur: s.bossesDefeated['boss_overlord'] ? 1 : 0, target: 1 }) },

  { id: 'boss_all', name: '屠龙者', desc: '三种 Boss 各击败 1 次', icon: '🐉', type: 'boss', category: 'progression', hidden: false, live: true,
    condition: (s) => Object.keys(s.bossesDefeated).length >= 3,
    progress: (s) => ({ cur: _safeMin(Object.keys(s.bossesDefeated).length, 3), target: 3 }) },

  { id: 'bossrush_clear', name: '极限连战', desc: '通关 Boss Rush', icon: '🔥', type: 'bossrush', category: 'progression', hidden: false, live: false,
    condition: (s) => s.bossRushClears >= 1,
    progress: (s) => ({ cur: _safeMin(s.bossRushClears, 1), target: 1 }) },

  { id: 'bossrush_flawless', name: '不动如山', desc: 'Boss Rush 全程无伤通关', icon: '🏔️', type: 'bossrush', category: 'mastery', hidden: false, live: false,
    condition: (s) => s.bossRushClears >= 1 && s.mode === 'bossrush' && s.victory && s.damageTaken === 0,
    progress: (s) => ({ cur: (s.bossRushClears >= 1 && s.damageTaken === 0) ? 1 : 0, target: 1 }) },

  { id: 'wingman_first', name: '僚机出击', desc: '单局僚机击杀 1 个', icon: '🛩️', type: 'wingman', category: 'combat', hidden: false, live: true,
    condition: (s) => s.wingmanKillsRun >= 1,
    progress: (s) => ({ cur: _safeMin(s.wingmanKillsRun, 1), target: 1 }) },

  { id: 'wingman_50', name: '僚机王牌', desc: '累计僚机击杀 50', icon: '🎖️', type: 'wingman', category: 'combat', hidden: false, live: true,
    condition: (s) => s.wingmanKillsTotal >= 50,
    progress: (s) => ({ cur: _safeMin(s.wingmanKillsTotal, 50), target: 50 }) },

  // 注：id 里的 5 / 50 是历史代号（存档解锁主键，改 id 会让老玩家已解锁记录失效并重复弹提示），
  // 不代表阈值。实际阈值以 desc / condition / progress 为准（2 次 / 30 次）。
  // 阈值取值依据：WINGMAN.COMBO.TRIGGER 由 3 上调到 5 后，触发 N 次协同 = 5N 次交替命中；
  // 累计 30 次是按"改动前 150 次交替命中"精确还原的等价值（不变）；
  // 单局阈值原 3 次（=15 命中）经 #59 复评选 B 降为 2 次（≈10 命中），短局更友好，红线 TRIGGER 未动。
  { id: 'combo_element_5', name: '元素共鸣', desc: '单局触发 2 次元素协同', icon: '🎼', type: 'wingman', category: 'combat', hidden: false, live: true,
    condition: (s) => s.elementCombosRun >= 2,
    progress: (s) => ({ cur: _safeMin(s.elementCombosRun, 2), target: 2 }) },

  { id: 'combo_element_50', name: '协同大师', desc: '累计触发 30 次元素协同', icon: '🎇', type: 'wingman', category: 'mastery', hidden: false, live: true,
    condition: (s) => s.elementCombosTotal >= 30,
    progress: (s) => ({ cur: _safeMin(s.elementCombosTotal, 30), target: 30 }) },

  { id: 'element_fire', name: '烈焰焚敌', desc: '火元素累计击杀 50', icon: '🔥', type: 'element', category: 'mastery', hidden: false, live: true,
    condition: (s) => s.elementKillsTotal.fire >= 50,
    progress: (s) => ({ cur: _safeMin(s.elementKillsTotal.fire, 50), target: 50 }) },

  { id: 'element_ice', name: '冰封千里', desc: '冰元素累计击杀 50', icon: '❄️', type: 'element', category: 'mastery', hidden: false, live: true,
    condition: (s) => s.elementKillsTotal.ice >= 50,
    progress: (s) => ({ cur: _safeMin(s.elementKillsTotal.ice, 50), target: 50 }) },

  { id: 'element_thunder', name: '雷霆万钧', desc: '雷元素累计击杀 50', icon: '⚡', type: 'element', category: 'mastery', hidden: false, live: true,
    condition: (s) => s.elementKillsTotal.thunder >= 50,
    progress: (s) => ({ cur: _safeMin(s.elementKillsTotal.thunder, 50), target: 50 }) },

  { id: 'egg_arsenal', name: '军火库', desc: '单局用齐 3 种武器', icon: '🧰', type: 'special', category: 'mastery', hidden: true, live: true,
    condition: (s) => Object.keys(s.weaponsUsed).length >= 3,
    progress: (s) => ({ cur: _safeMin(Object.keys(s.weaponsUsed).length, 3), target: 3 }) },
];

// 会话态：单局字段 + 累计字段（startRun 预载存档，report* 累加，reportRun 写回）
const session = {
  kills: 0,
  wingmanKillsRun: 0,
  elementCombosRun: 0,
  elementKillsRun: { fire: 0, ice: 0, thunder: 0 },
  comboPeak: 0,
  coins: 0,
  superUsed: 0,
  weaponsUsed: {},
  victory: false,
  damageTaken: 0,
  levelId: 1,
  mode: 'normal',
  stars: 0,
  maxLevel: MAX_LEVEL,
  gameClears: 0,
  // A9 救济局抑制开关（附加式，不改任何 id / condition / progress）：
  // ignore=true 时 _checkLive/_checkAll 不解锁、reportRun 短路写盘，防救济局刷成就。
  ignore: false,
  // 累计（预载）
  totalKills: 0,
  wingmanKillsTotal: 0,
  elementCombosTotal: 0,
  elementKillsTotal: { fire: 0, ice: 0, thunder: 0 },
  bossesDefeated: {},
  bossRushClears: 0,
};

function loadCumulative() {
  const s = SaveManager.load();
  session.totalKills = s.totalKills || 0;
  const st = s.achievementStats || {};
  session.wingmanKillsTotal = st.wingmanKills || 0;
  session.elementCombosTotal = st.elementCombos || 0;
  session.elementKillsTotal = {
    fire: (st.elementKills && st.elementKills.fire) || 0,
    ice: (st.elementKills && st.elementKills.ice) || 0,
    thunder: (st.elementKills && st.elementKills.thunder) || 0,
  };
  session.bossRushClears = st.bossRushClears || 0;
  session.bossesDefeated = { ...(s.bossesDefeated || {}) };
}

export const AchievementManager = {
  init() { loadCumulative(); },

  /**
   * 本局开始：重置会话态并预载累计数据。
   * 兼容两种调用形式：
   *   startRun(mode, levelId, { ignore })   —— GameScene.init 既有调用
   *   startRun({ mode, levelId, ignore })   —— 架构规格新增对象形式
   * ignore=true 时本局不计成就（A9 救济局抑制）。
   */
  startRun(mode, levelId, opts) {
    if (mode && typeof mode === 'object') {
      opts = mode;
      mode = opts.mode;
      levelId = opts.levelId;
    }
    session.kills = 0;
    session.wingmanKillsRun = 0;
    session.elementCombosRun = 0;
    session.elementKillsRun = { fire: 0, ice: 0, thunder: 0 };
    session.comboPeak = 0;
    session.coins = 0;
    session.superUsed = 0;
    session.weaponsUsed = {};
    session.victory = false;
    session.damageTaken = 0;
    session.levelId = levelId || 1;
    session.mode = mode || 'normal';
    session.stars = 0;
    session.gameClears = 0;
    session.ignore = !!(opts && opts.ignore);
    loadCumulative();
  },

  /** A9 救济局抑制开关（局中救济被接受时调用，附加式；不解锁任何成就） */
  setIgnore(ignore) {
    session.ignore = !!ignore;
    return session.ignore;
  },

  /** A9 当前是否抑制成就（救济局为 true） */
  isIgnored() {
    return session.ignore === true;
  },

  reportKill(opts = {}) {
    session.kills++;
    session.totalKills++;
    if (opts.byWingman) { session.wingmanKillsRun++; session.wingmanKillsTotal++; }
    if (opts.element && session.elementKillsRun[opts.element] != null) session.elementKillsRun[opts.element]++;
    if (opts.element && session.elementKillsTotal[opts.element] != null) session.elementKillsTotal[opts.element]++;
    this._checkLive();
  },

  /**
   * 元素协同 combo 触发上报（僚机第二版）。
   * 由 GameScene 监听 EVENTS.WINGMAN_COMBO 转发，单局与累计各记一份。
   * element 目前只用于未来按元素细分成就，当前两个成就不区分元素。
   */
  reportElementCombo(element) {
    session.elementCombosRun++;
    session.elementCombosTotal++;
    this._checkLive();
  },

  reportComboPeak(peak) {
    if (peak > session.comboPeak) session.comboPeak = peak;
    this._checkLive();
  },

  reportCoins(total) { session.coins = total; this._checkLive(); },
  reportSuperUsed() { session.superUsed++; this._checkLive(); },
  reportBossDefeated(bossKey) { if (bossKey) session.bossesDefeated[bossKey] = true; this._checkLive(); },
  reportBossRushClear() { session.bossRushClears++; this._checkLive(); },
  reportWeaponUsed(w) { if (w) session.weaponsUsed[w] = true; this._checkLive(); },

  reportRun(ctx = {}) {
    // A9 救济局抑制：ctx.ignore 短路写盘与解锁（bestScore/topScores 等由 GameScene 侧一并拦截）
    if (ctx.ignore !== undefined) session.ignore = !!ctx.ignore;
    if (session.ignore) return [];
    session.victory = !!ctx.victory;
    session.damageTaken = ctx.damageTaken || 0;
    session.stars = ctx.stars || 0;
    session.levelId = ctx.levelId || session.levelId;
    session.mode = ctx.mode || session.mode;
    if (session.victory && session.mode === 'bossrush') session.bossRushClears++;
    if (session.victory && session.mode !== 'bossrush') session.gameClears = (session.gameClears || 0) + 1;
    SaveManager.set('totalKills', session.totalKills);
    SaveManager.saveAchievementStats({
      wingmanKills: session.wingmanKillsTotal,
      elementKills: session.elementKillsTotal,
      elementCombos: session.elementCombosTotal,
      bossRushClears: session.bossRushClears,
    });
    SaveManager.set('bossesDefeated', session.bossesDefeated);
    return this._checkAll();
  },

  _checkLive() {
    // A9 救济局抑制：全程不解锁（不改任何 id / condition / progress）
    if (session.ignore) return [];
    const out = [];
    for (const a of ACHIEVEMENTS) {
      if (!a.live || SaveManager.hasAchievement(a.id)) continue;
      let ok = false;
      try { ok = !!a.condition(session); } catch (e) { ok = false; }
      if (ok && this._unlock(a)) out.push(a);
    }
    return out;
  },

  _checkAll() {
    // A9 救济局抑制：全程不解锁（不改任何 id / condition / progress）
    if (session.ignore) return [];
    const out = [];
    for (const a of ACHIEVEMENTS) {
      if (SaveManager.hasAchievement(a.id)) continue;
      let ok = false;
      try { ok = !!a.condition(session); } catch (e) { ok = false; }
      if (ok && this._unlock(a)) out.push(a);
    }
    return out;
  },

  _unlock(def) {
    if (SaveManager.unlockAchievement(def.id)) {
      EventBus.emit(EVENTS.ACHIEVEMENT_UNLOCKED, def);
      return true;
    }
    return false;
  },

  isUnlocked(id) { return SaveManager.hasAchievement(id); },
  getDefinition(id) { return ACHIEVEMENTS.find((a) => a.id === id) || null; },
  getProgress(id) {
    const def = this.getDefinition(id);
    if (!def) return null;
    const p = def.progress ? def.progress(session) : { cur: 0, target: 1 };
    const unlocked = this.isUnlocked(id);
    return { ...p, unlocked, ratio: p.target ? _safeMin(1, p.cur / p.target) : (unlocked ? 1 : 0) };
  },
  getAll() {
    return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: SaveManager.hasAchievement(a.id) }));
  },
  reset() {
    const s = SaveManager.load();
    s.achievements = {};
    s.achievementStats = {
      wingmanKills: 0, elementKills: { fire: 0, ice: 0, thunder: 0 }, elementCombos: 0, bossRushClears: 0,
    };
    s.bossesDefeated = {};
    s.totalKills = 0;
    s.levelStars = {};
    SaveManager.save();
    // 内存会话同步复位：清掉全部 run 字段，否则 reset() 后 session 里陈旧的 run 计数
    // 会被下一次 _checkLive 重新解锁刚清掉的成就。
    session.kills = 0;
    session.wingmanKillsRun = 0;
    session.elementCombosRun = 0;
    session.elementKillsRun = { fire: 0, ice: 0, thunder: 0 };
    session.comboPeak = 0;
    session.coins = 0;
    session.superUsed = 0;
    session.weaponsUsed = {};
    session.victory = false;
    session.damageTaken = 0;
    session.stars = 0;
    session.gameClears = 0;
    session.ignore = false;
    loadCumulative();  // 重新预载累计（totalKills / wingmanKillsTotal / elementCombosTotal 等）
  },
};

// 暴露给自动化真测（仅调试用）
if (typeof window !== 'undefined') window.__ACH__ = AchievementManager;

/**
 * OPT-16 T1：只读成就 id 白名单（append-only，零写入）。
 * 供 SaveSanitizer 校验 achievements 键：仅保留合法 id，脏 key 剔除。
 * 返回只读集合（Set），绝不改动 ACHIEVEMENTS 数据本身。
 */
export function getAchievementIds() {
  return new Set(ACHIEVEMENTS.map((a) => a.id));
}
