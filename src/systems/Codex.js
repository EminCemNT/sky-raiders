import { SaveManager } from '../utils/SaveManager.js';
import { CODEX_DECOR } from '../config/GameConfig.js';

/**
 * 图鉴收藏系统（OPT-13 批B B13）
 * ---------------------------------------------------------------------------
 * 纯展示 + 收集：不动战斗数值、不影响成就；图鉴解锁不影响敌人/Boss 行为、不掉落、不加成。
 * 存档：SaveManager append-only 字段 codex（四分类解锁记录）+ codexDecor（装饰购买记录）。
 * 解锁触发点全部挂接在既有事件上（GameScene.registerKill / _onBossDefeated / collectItem、
 * create 开局武器），只增不改，不新增战斗数值。
 *
 * 红线：
 *   - Boss 图鉴用独立 codex.bosses，不复用 bossesDefeated（后者被成就语义占用，避免污染）。
 *   - 26 成就 id 零改动；WingmanSystem 零触碰；FloatingText 零改动。
 */

/** 四分类（与存档 codex 键一致） */
export const CODEX_TYPES = ['enemies', 'bosses', 'weapons', 'elements'];

/** 18 条目元数据：key=条目 id（对应解锁埋点传入的 id）；tex=复用现有纹理；tint 仅 Boss 共纹理差异化 */
export const CODEX_ENTRIES = {
  enemies: [
    { key: 'small',    tex: 'enemy_small' },
    { key: 'mid',      tex: 'enemy_mid' },
    { key: 'diver',    tex: 'enemy_diver' },
    { key: 'turret',   tex: 'enemy_turret' },
    { key: 'kamikaze', tex: 'enemy_kamikaze' },
    { key: 'summoner', tex: 'enemy_summoner' },
    { key: 'shield',   tex: 'enemy_shield' },
  ],
  bosses: [
    { key: 'boss_sentinel',    tex: 'boss', tint: 0x66ccff },
    { key: 'boss_crusher',     tex: 'boss', tint: 0xff9a4a },
    { key: 'boss_overlord',    tex: 'boss', tint: 0x66ff99 },
    { key: 'boss_annihilator', tex: 'boss', tint: 0xff6a3d },
  ],
  weapons: [
    { key: 'pulse',   tex: 'bullet_pulse' },
    { key: 'missile', tex: 'bullet_missile' },
    { key: 'laser',   tex: 'item_weapon_laser' },
    { key: 'bomb',    tex: 'item_weapon_bomb' },
  ],
  elements: [
    { key: 'fire',    tex: 'bullet_fire' },
    { key: 'ice',     tex: 'bullet_ice' },
    { key: 'thunder', tex: 'bullet_thunder' },
  ],
};

/** 读存档 codex 数据（老存档缺失时兜底默认并就地初始化，不落盘） */
function codexData() {
  const s = SaveManager.load();
  if (!s.codex || !s.codex.enemies) {
    s.codex = { enemies: {}, bosses: {}, weapons: {}, elements: {} };
  }
  return s.codex;
}

export const Codex = {
  /**
   * 解锁一条图鉴条目（幂等）：首次触发写入并 save；已解锁/非法条目零动作。
   * @param {'enemies'|'bosses'|'weapons'|'elements'} type 分类
   * @param {string} key 条目 id（如 'turret' / 'boss_annihilator' / 'laser' / 'fire'）
   */
  record(type, key) {
    if (!key || !CODEX_ENTRIES[type]) return;
    if (!CODEX_ENTRIES[type].some((e) => e.key === key)) return; // 只记合法条目（防脏数据）
    const c = codexData();
    if (c[type][key]) return; // 已解锁幂等，不重复写盘
    c[type][key] = true;
    SaveManager.save();
  },

  /** 是否已解锁该条目 */
  isUnlocked(type, key) {
    const c = codexData();
    return !!(c[type] && c[type][key]);
  },

  /** 某分类进度：{ unlocked, total, pct }（total 固定 7/4/4/3） */
  getProgress(type) {
    const list = CODEX_ENTRIES[type] || [];
    const c = codexData();
    const unlocked = list.filter((e) => c[type] && c[type][e.key]).length;
    return {
      unlocked,
      total: list.length,
      pct: list.length ? Math.round((unlocked / list.length) * 100) : 0,
    };
  },

  /** 全图鉴总进度：{ unlocked, total:18, pct } */
  getTotalProgress() {
    let unlocked = 0; let total = 0;
    for (const type of CODEX_TYPES) {
      const p = this.getProgress(type);
      unlocked += p.unlocked; total += p.total;
    }
    return { unlocked, total, pct: total ? Math.round((unlocked / total) * 100) : 0 };
  },

  /** 图鉴数据快照（浅拷贝，防外部写脏存档） */
  getCodex() {
    const c = codexData();
    return {
      enemies: { ...c.enemies },
      bosses: { ...c.bosses },
      weapons: { ...c.weapons },
      elements: { ...c.elements },
    };
  },

  /** 已购装饰 id 列表 */
  getDecorOwned() {
    const s = SaveManager.load();
    return Array.isArray(s.codexDecor) ? s.codexDecor.slice() : [];
  },

  ownsDecor(decorId) {
    return this.getDecorOwned().includes(decorId);
  },

  /**
   * 购买图鉴装饰（纯展示金币出口）：金币足够则扣款并追加 codexDecor，返回 true；
   * 金币不足 / 已拥有 / 未知 id 返回 false（不扣不记）。
   */
  buyDecor(decorId) {
    const def = (CODEX_DECOR || {})[decorId];
    if (!def) return false;
    const s = SaveManager.load();
    if (this.ownsDecor(decorId)) return false;
    if ((s.coins || 0) < def.price) return false;
    s.coins = Math.max(0, (s.coins || 0) - def.price);
    if (!Array.isArray(s.codexDecor)) s.codexDecor = [];
    s.codexDecor.push(decorId);
    SaveManager.save();
    return true;
  },
};
