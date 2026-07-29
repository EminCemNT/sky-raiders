import { SaveManager } from '../utils/SaveManager.js';
import { EventBus } from '../utils/EventBus.js';
import { EVENTS } from '../config/GameConfig.js';

/**
 * 成就系统（单一事实来源 + 评估 + 持久化）
 * ---------------------------------------------------------------------------
 * - ACHIEVEMENTS：成就定义表，check(ctx) 返回是否满足（ctx 由 GameScene.endGame 提供）。
 * - evaluate(ctx)：评估一局结果，解锁新成就并持久化，返回本次新解锁的定义数组。
 * - getAll()：返回 [{...def, unlocked}] 供 UI 渲染成就墙。
 * 设计约束：不碰 localStorage（走 SaveManager）；不依赖渲染（纯逻辑，QA 可单测）。
 */
export const ACHIEVEMENTS = [
  { id: 'first_blood',  name: '初露锋芒', desc: '单局击杀 10 个敌人',       icon: '🗡️', check: (c) => c.kills >= 10 },
  { id: 'sharpshooter', name: '百步穿杨', desc: '单局击杀 50 个敌人',       icon: '🎯', check: (c) => c.kills >= 50 },
  { id: 'coin_hunter',  name: '金银满仓', desc: '单局收集 30 枚金币',       icon: '💰', check: (c) => c.coins >= 30 },
  { id: 'flawless',     name: '毫发无伤', desc: '无伤通关任意一关',         icon: '🛡️', check: (c) => c.victory && c.damageTaken === 0 },
  { id: 'combo_master', name: '连击大师', desc: '单局达成 15 连击',         icon: '⚡', check: (c) => c.maxCombo >= 15 },
  { id: 'super_nova',   name: '星河爆发', desc: '单局释放 1 次星风暴',       icon: '🌟', check: (c) => c.usedSuper >= 1 },
  { id: 'first_clear',  name: '初定苍穹', desc: '通关任意一关',             icon: '🏆', check: (c) => c.victory },
  { id: 'all_clear',    name: '苍穹制霸', desc: '通关全部关卡',             icon: '👑', check: (c) => c.victory && c.levelId >= c.maxLevel },
];

export const AchievementManager = {
  /**
   * 评估一局结果。
   * @param {Object} ctx { kills, coins, damageTaken, levelId, victory, maxCombo, usedSuper, maxLevel }
   * @returns {Array} 本次新解锁的成就定义数组（已按 SaveManager 持久化）
   */
  evaluate(ctx) {
    const unlocked = [];
    for (const a of ACHIEVEMENTS) {
      if (SaveManager.hasAchievement(a.id)) continue;
      let ok = false;
      try { ok = !!a.check(ctx); } catch (e) { ok = false; }
      if (ok && SaveManager.unlockAchievement(a.id)) {
        unlocked.push(a);
        EventBus.emit(EVENTS.ACHIEVEMENT_UNLOCKED, a);
      }
    }
    return unlocked;
  },

  /** 供 UI：返回带 unlocked 标记的完整数组 */
  getAll() {
    const got = SaveManager.getAchievements();
    return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: !!got[a.id] }));
  },

  /** 测试/重置用 */
  reset() {
    const s = SaveManager.load();
    s.achievements = {};
    SaveManager.save();
  },
};
