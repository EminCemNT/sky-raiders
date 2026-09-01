// SaveSanitizer.js —— OPT-16 T1/T2 存档钳位统一 + 损坏分级自愈（新建独立文件）
// ---------------------------------------------------------------------------
// 红线约束：
//   - SaveManager.js diff 为空：本文件只调 SaveManager 既有公开 API（load()/save()），
//     不碰其内部私有状态（_dirty/_broken/cache）。
//   - AchievementManager.js 零写入：只通过 getAchievementIds() 只读白名单校验。
// 语义：
//   - clampInt / sanitizeSave / analyzeSave 均为纯数据操作，不触发 SaveManager.save()；
//   - installSanitizer 由 main.js 启动挂接，统一触发一次写盘（仅首启）。
//   - 合法值零改动：只修「越界 / 非数字 / 类型错误」，不重算、不重排、不改变合法值语义。
import { SANITIZE, MODULES, UPGRADE_TREE, SAVE_KEY } from '../config/GameConfig.js';
import { SaveManager } from './SaveManager.js';
import { getAchievementIds } from '../systems/AchievementManager.js';

/** Number 化 + 整数 + 越界回 def；非法/NaN 回 def */
export function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.round(n);
  if (i < min || i > max) return def;
  return i;
}

/** 诊断累计（append-only，供 analyzeSave / __SAVE_SANITIZE 观测） */
const _diagnostics = { issues: [], sanitized: false };

/**
 * 存档清洗（纯函数语义：就地修复脏字段，返回是否发生改动）。
 * 返回 true = 有越界/非法值被修复；false = 零改动（合法存档逐字段等价）。
 * 不调用 SaveManager.save()（由 installSanitizer 统一触发一次写盘）。
 */
export function sanitizeSave(save) {
  if (!save || typeof save !== 'object') return false;
  let changed = false;
  const issues = [];
  const mark = (label) => { changed = true; issues.push(label); };

  // 1) coins：>=0 整数，越界/NaN 回 0
  if (save.coins !== undefined) {
    const c = clampInt(save.coins, 0, SANITIZE.coinsMax, 0);
    if (c !== save.coins) { save.coins = c; mark('coins'); }
  }

  // 2) upgrades：六字段 clamp 0..upgradeMax
  if (save.upgrades && typeof save.upgrades === 'object') {
    for (const k of Object.keys(UPGRADE_TREE)) {
      const v = save.upgrades[k];
      if (v === undefined) continue;
      const c = clampInt(v, 0, SANITIZE.upgradeMax, 0);
      if (c !== v) { save.upgrades[k] = c; mark(`upgrades.${k}`); }
    }
  }

  // 3) levelStars：{levelId: 1..3}，非法值剔除（回 0 = 移除该 key 语义）
  if (save.levelStars && typeof save.levelStars === 'object') {
    for (const k of Object.keys(save.levelStars)) {
      const v = clampInt(save.levelStars[k], 1, SANITIZE.levelStarsMax, 0);
      if (v <= 0) { delete save.levelStars[k]; mark(`levelStars.${k}`); }
      else if (v !== save.levelStars[k]) { save.levelStars[k] = v; mark(`levelStars.${k}`); }
    }
  }

  // 4) achievements：仅保留白名单 26 id（只读集合），非法 key 剔除（零写成就）
  if (save.achievements && typeof save.achievements === 'object') {
    const whitelist = getAchievementIds();
    for (const k of Object.keys(save.achievements)) {
      if (!whitelist.has(k)) { delete save.achievements[k]; mark(`achievements.${k}`); }
    }
  }

  // 5) achievementStats.elementKills：fire/ice/thunder clamp >=0
  const ek = save.achievementStats && save.achievementStats.elementKills;
  if (ek && typeof ek === 'object') {
    for (const el of ['fire', 'ice', 'thunder']) {
      if (ek[el] === undefined) continue;
      const c = clampInt(ek[el], 0, Number.MAX_SAFE_INTEGER, 0);
      if (c !== ek[el]) { ek[el] = c; mark(`elementKills.${el}`); }
    }
  }

  // 6) moduleInv：元素 {key,slot,quality} schema 校验，非法元素剔除，超上限截断
  if (save.moduleInv !== undefined) {
    if (!Array.isArray(save.moduleInv)) { save.moduleInv = []; mark('moduleInv'); }
    else {
      const clean = save.moduleInv.filter((m) => {
        if (!m || typeof m !== 'object') return false;
        const def = MODULES[m.key];
        return !!(def && def.slot === m.slot && def.quality === m.quality);
      });
      if (clean.length !== save.moduleInv.length) { save.moduleInv = clean; mark('moduleInv'); }
      if (save.moduleInv.length > SANITIZE.moduleInvMax) {
        save.moduleInv = save.moduleInv.slice(0, SANITIZE.moduleInvMax);
        mark('moduleInv.truncate');
      }
    }
  }

  // 7) topScores：元素 {score,levelId,mode,date} 校验，score clamp >=0，超 10 条截断
  if (save.topScores !== undefined) {
    if (!Array.isArray(save.topScores)) { save.topScores = []; mark('topScores'); }
    else {
      let tChanged = false;
      const clean = save.topScores
        .filter((r) => {
          if (!r || typeof r !== 'object') { tChanged = true; return false; }
          const score = clampInt(r.score, 0, Number.MAX_SAFE_INTEGER, 0);
          if (score !== r.score) { tChanged = true; r.score = score; }
          if (r.levelId === undefined) { r.levelId = 1; tChanged = true; }
          if (typeof r.mode !== 'string') { r.mode = 'normal'; tChanged = true; }
          if (typeof r.date !== 'string') { r.date = ''; tChanged = true; }
          return true;
        })
        .slice(0, SANITIZE.topScoresMax);
      if (tChanged || clean.length !== save.topScores.length) {
        save.topScores = clean;
        mark('topScores');
      }
    }
  }

  _diagnostics.issues = issues;
  _diagnostics.sanitized = changed;
  return changed;
}

/**
 * 存档损坏分级诊断（T2，只读）：不修改存档，仅返回诊断。
 * @param {string|null} raw localStorage 原始字符串（null = 无存档）
 * @returns {{ structurallyBroken: boolean, fieldIssues: string[], hadRaw: boolean }}
 */
export function analyzeSave(raw) {
  if (raw == null) return { structurallyBroken: false, fieldIssues: [], hadRaw: false };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // 整档损坏：SaveManager.load 既有 catch → freshSave 兜底，本层不动
    return { structurallyBroken: true, fieldIssues: [], hadRaw: true };
  }
  // 可解析：用 sanitize 的修复清单做只读诊断（不改原对象 —— 在副本上跑）
  const probe = JSON.parse(JSON.stringify(parsed));
  sanitizeSave(probe);
  return { structurallyBroken: false, fieldIssues: _diagnostics.issues.slice(), hadRaw: true };
}

/**
 * main.js 启动挂接：load → 分级诊断 → sanitize → 有改动才 save（仅首启一次性）。
 * 无 localStorage 环境（Node 头测）由 SaveManager.load 兜底 freshSave，静默跳过。
 */
export function installSanitizer() {
  const s = SaveManager.load();
  // T2：先记录诊断（整档损坏由 SaveManager 既有 catch 兜底 freshSave）
  let raw = null;
  try { raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(SAVE_KEY) : null; } catch (e) { raw = null; }
  let diag;
  try {
    diag = analyzeSave(raw);
  } catch (e) {
    diag = { structurallyBroken: false, fieldIssues: [], hadRaw: raw != null };
  }
  // T1：就地清洗（sanitizeSave 返回是否有改动）
  let sanitized = false;
  try {
    sanitized = sanitizeSave(s);
  } catch (e) {
    sanitized = false;
  }
  if (sanitized) SaveManager.save();
  // 探针钩子：append-only 只读观测（__SAVE_SANITIZE）
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__SAVE_SANITIZE', {
      configurable: true,
      get: () => ({ issues: _diagnostics.issues.slice(), sanitized: _diagnostics.sanitized, structurallyBroken: !!diag.structurallyBroken }),
    });
  }
  return { sanitized, structurallyBroken: !!diag.structurallyBroken, issues: _diagnostics.issues.slice() };
}
