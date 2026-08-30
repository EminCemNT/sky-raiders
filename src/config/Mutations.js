// src/config/Mutations.js —— OPT-13 批A A8 无尽变异规则（append-only，纯数据 + 抽取函数）
//
// 深空爬塔（无尽）全局变异层：每 MUTATION_EVERY_LAYERS 层 roll 一个变异，
// 叠加在既有 TOWER_BUFFS 3 选 1 增益之上（幂等叠加，局内临时不入存档）。
// 正面 5 + 负面 4；负面变异生效前 1s 先出警示文字（不可静默生效）。
// 消费方：GameScene.applyMutation / _commitMutation / _mutationMul + UIScene（横幅/图标）。
// 红线：语义与 TOWER_BUFFS 对齐但不改动原条目；不触碰 WINGMAN.COMBO / 成就 / 存档。
//
// stats 键与 GameScene._mutationMul 返回结构对齐：
//   dmg / hp / speed / bulletSpeed / grazeRadius / incomingDmg（标准路径全 1.0 = 零回归）
//   apply 为「直接生效型」标记，由 _commitMutation 消费（magnet/coin/fireRate/shield/grazeEnergy）

// 每 5 层 roll 一个变异（towerFloor % 5 === 0，即 Boss 波通关后进入第 5/10/15… 层）
export const MUTATION_EVERY_LAYERS = 5;

// 正负比例（可配置；rollMutation 消费）
export const MUTATION_WEIGHTS = { positive: 0.55 };

// 正面变异（5）
export const POSITIVE = {
  magnetStorm: { id: 'magnetStorm', name: '磁力风暴', polarity: 'positive',
    desc: '磁力风暴：全屏吸金 6 秒', apply: 'magnet', stats: {} },
  doubleCoin:  { id: 'doubleCoin', name: '双倍金币', polarity: 'positive',
    desc: '双倍金币：本局金币 ×2', apply: 'coin', stats: { coinMul: 2 } },
  rapidFire:   { id: 'rapidFire', name: '急速射击', polarity: 'positive',
    desc: '急速射击：射速 +20%', apply: 'fireRate', stats: { fireRateMul: 1.2 } },
  overshield:  { id: 'overshield', name: '过载护盾', polarity: 'positive',
    desc: '过载护盾：8 秒护盾 + 回血 10', apply: 'shield', stats: {} },
  grazeWell:   { id: 'grazeWell', name: '擦弹之泉', polarity: 'positive',
    desc: '擦弹之泉：擦弹回能 ×2', apply: 'grazeEnergy', stats: { grazeEnergyMul: 2 } },
};

// 负面变异（4）：生效前 1s 警示；均可用走位/擦弹/技能反制，不得制造无解局面
export const NEGATIVE = {
  swiftBullets: { id: 'swiftBullets', name: '弹速风暴', polarity: 'negative',
    desc: '弹速风暴：敌弹速度 ×1.2', apply: 'bulletSpeed', stats: { bulletSpeedMul: 1.2 } },
  tinyRing:     { id: 'tinyRing', name: '擦弹环缩小', polarity: 'negative',
    desc: '擦弹环缩小：擦弹判定环 ×0.7', apply: 'grazeRadius', stats: { grazeRadiusMul: 0.7 } },
  glassCannon:  { id: 'glassCannon', name: '玻璃大炮', polarity: 'negative',
    desc: '玻璃大炮：受击伤害 ×1.3', apply: 'incomingDmg', stats: { incomingDmgMul: 1.3 } },
  swarm:        { id: 'swarm', name: '蜂群', polarity: 'negative',
    desc: '蜂群：敌人数量 ×1.3', apply: 'spawn', stats: { spawnMul: 1.3 } },
};

// 正负合并表（id → 定义），供 _mutationMul / _commitMutation 查表
export const MUTATIONS = { ...POSITIVE, ...NEGATIVE };

/**
 * 抽取一个随机变异（默认 55/45 正负比）。返回 { id, polarity, name, desc, stats }。
 * @param {() => number} [random] 随机源（测试可注入，需返回 [0,1)）
 */
export function rollMutation(random = Math.random) {
  const r = random();
  const pool = r < (MUTATION_WEIGHTS.positive || 0.55) ? POSITIVE : NEGATIVE;
  const keys = Object.keys(pool);
  const id = keys[Math.floor(random() * keys.length)];
  const m = pool[id];
  return { id, polarity: m.polarity, name: m.name, desc: m.desc, stats: m.stats || {} };
}
