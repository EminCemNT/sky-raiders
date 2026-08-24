// 主动技能定义（#151 道具/技能系统专用配置）
// 能量槽 ENERGY_MAX，充满后可释放；技能为可切换槽位（预留多技能扩展）。

export const ENERGY_MAX = 100;

export const SKILLS = {
  starstorm: {
    id: 'starstorm',
    name: '星风暴',
    icon: 'item_energy',
    cost: 100,
    kind: 'screen_clear',
    desc: '全屏星弹横扫，清除敌弹并重创所有敌机与 Boss',
  },
  // 第二主动技能（P2）：过载——短时射速翻倍（buff，不消弹）
  overdrive: {
    id: 'overdrive',
    name: '过载',
    icon: 'item_energy',
    cost: 100,
    kind: 'buff',
    desc: '短时射速翻倍',
  },
};

export const DEFAULT_SKILL = 'starstorm';
