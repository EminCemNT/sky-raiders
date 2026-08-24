// 元素连锁反应（二段反应）配置 —— 独立文件，绝不 import/引用 WINGMAN.COMBO。
// 语义：敌人已挂某元素状态、再次被同元素命中时触发反应（读 Enemy._elem）。
//   thunder 传导：麻痹中的敌人再被雷命中，电弧跳向半径内最近 ≤2 个未麻痹敌人（传导麻痹 + 小伤害）。
//   fire    引爆：灼烧中的敌人再被火命中，以该敌为中心 AoE 溅射（不蔓延灼烧）。
//   ice     冰爆：减速中的敌人再被冰命中，AoE 溅射 + 溅射目标附加减速。
// 数值来源：本文件是唯一事实来源，消费方为 systems/ElementReaction.js（纯逻辑）。
export const ELEMENT_REACTIONS = {
  REACT_CD: 1200,
  thunder: { key: 'thunder', name: '传导', kind: 'chain', chainCount: 2, radius: 140, dmg: 15, splash: 'thunder' },
  fire:    { key: 'fire',    name: '引爆', kind: 'aoe',   radius: 110, dmg: 22, falloff: 0.5, splash: null },
  ice:     { key: 'ice',     name: '冰爆', kind: 'aoe',   radius: 120, dmg: 12, falloff: 0.5, splash: 'ice' },
};
