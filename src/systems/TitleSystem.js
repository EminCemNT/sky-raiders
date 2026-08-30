// TitleSystem —— OPT-13 批B B12 称号系统（纯派生，读时计算，零写入）
//
// 设计纪律（红线 R7 纯视觉/零业务逻辑 + B12 规格）：
//   1) 只读既有持久化字段派生称号：levelStars / totalKills / achievements /
//      newbiePlan.progress.grazes / towerTop / medalCount，零写入、零新增存档字段。
//   2) 不依赖未持久化的局内字段（单局 comboPeak、局内 grazeCount 禁止作为称号来源）。
//   3) 不新增成就 id；称号等级不参与战力计算（calcPower 不动）。
//   4) 派生规则：当前称号 = 稀有度最高已解锁；同稀有度按表序取前者。
//      TITLES 表已按稀有度升序排列，因此"只替换更高稀有度、同稀有度保留先出现者"
//      即满足"取前者"语义（循环中仅当 rarity 严格更高时才替换 best）。
//
// 对外接口（规格一致）：
//   getTitle(id)                → TitleDef | null
//   getUnlockedTitles(stats)    → TitleDef[]   （从存档既有字段派生）
//   getCurrentTitle(stats)      → TitleDef | null（稀有度最高已解锁；无任何称号返回 null）
//   getRarityColor(rarity)      → 十六进制色值字符串（结算/分享卡展示用，纯视觉）
import { TITLES } from '../config/GameConfig.js';

// 稀有度优先级：数值越大越稀有
const RARITY_LEVEL = { common: 0, rare: 1, epic: 2, legendary: 3 };

// 稀有度展示色（纯视觉）：common 青灰 / rare 冰蓝 / epic 紫 / legendary 金
const RARITY_COLORS = {
  common: '#88bbdd',
  rare: '#9fd8ff',
  epic: '#c9bfff',
  legendary: '#ffd86b',
};

/** 解析条件 cond，用存档 stats 判定是否解锁（递归支持 and/or 组合） */
function evalCond(cond, stats) {
  if (!cond || typeof cond !== 'object') return false;
  if (Array.isArray(cond.and)) return cond.and.every((c) => evalCond(c, stats));
  if (Array.isArray(cond.or)) return cond.or.some((c) => evalCond(c, stats));
  switch (cond.type) {
    case 'levelStars': {
      const stars = stats.levelStars || {};
      if (cond.any) return Object.keys(stars).length > 0;
      return Object.keys(stars).some((k) => (stars[k] || 0) >= (cond.n || 1));
    }
    case 'totalKills':
      return (stats.totalKills || 0) >= (cond.n || 0);
    case 'grazes': {
      const np = stats.newbiePlan || {};
      return ((np.progress && np.progress.grazes) || 0) >= (cond.n || 0);
    }
    case 'towerTop':
      return (stats.towerTop || 0) >= (cond.n || 0);
    case 'medalCount':
      return (stats.medalCount || 0) >= (cond.n || 0);
    case 'achievement': {
      const ach = stats.achievements || {};
      return !!ach[cond.id];
    }
    default:
      return false;
  }
}

export const TitleSystem = {
  /** 按 id 取称号定义；未知 id 返回 null */
  getTitle(id) {
    return TITLES.find((x) => x.id === id) || null;
  },

  /** 从存档既有字段派生全部已解锁称号（按表序返回，含稀有度升序） */
  getUnlockedTitles(stats) {
    return TITLES.filter((x) => evalCond(x.cond, stats || {}));
  },

  /** 当前称号 = 稀有度最高已解锁；同稀有度按表序取前者；无任何称号返回 null */
  getCurrentTitle(stats) {
    let best = null;
    for (const t of TITLES) {
      if (!evalCond(t.cond, stats || {})) continue;
      // 仅当稀有度严格更高才替换 → 同稀有度保留表序先出现者（"取前者"）
      if (!best || RARITY_LEVEL[t.rarity] > RARITY_LEVEL[best.rarity]) best = t;
    }
    return best || null;
  },

  /** 稀有度展示色（hex 字符串；未知稀有度回退 common 色） */
  getRarityColor(rarity) {
    return RARITY_COLORS[rarity] || RARITY_COLORS.common;
  },
};

export default TitleSystem;
