// 局内掉落道具定义（#151 道具/技能系统专用配置）
// 贴图 key 由 PreloadScene 程序化生成（item_*），美术升级时禁止重命名/删除。
// 本文件只被 GameScene / Item 实体 / SkillSystem 读取，不污染 GameConfig。

export const ITEMS = {
  shield:  { tex: 'item_shield',  label: '护盾', kind: 'buff',     duration: 5000, desc: '获得临时护盾，吸收伤害' },
  magnet:  { tex: 'item_magnet',  label: '磁力', kind: 'buff',     duration: 8000, desc: '大幅扩大金币吸取范围' },
  wingman: { tex: 'item_wingman', label: '僚机', kind: 'permanent', desc: '立即增加一架跟随僚机协同火力' },
  energy:  { tex: 'item_energy',  label: '能量', kind: 'resource', amount: 25,   desc: '为技能槽充能' },
  heal:    { tex: 'item_heal',    label: '修复', kind: 'instant',  amount: 30,   desc: '立即恢复生命值' },
  bomb:    { tex: 'item_bomb',    label: '炸弹', kind: 'instant',  amount: 1,    desc: '补充一枚清屏炸弹' },
  weapon_missile: { tex: 'item_weapon',       label: '导弹', kind: 'weapon', weapon: 'missile', duration: 15000, desc: '切换追踪导弹 15 秒' },
  weapon_laser:   { tex: 'item_weapon_laser', label: '激光', kind: 'weapon', weapon: 'laser',   duration: 15000, desc: '切换激光束 15 秒' },
  weapon_bomb:    { tex: 'item_weapon_bomb',  label: '炸弹', kind: 'weapon', weapon: 'bomb',    duration: 15000, desc: '切换元素炸弹 15 秒' },
  // 局内火力(P)成长（P1）：独立掉落，拾取后火力 +1，受击 -1
  power:          { tex: 'item_power',        label: '火力P', kind: 'power', desc: '局内火力 +1（最多 4 级）' },
  // 元素核心（二段反应 enabler）：拾取后按 火→冰→雷→火 轮换战机元素
  element_core:   { tex: 'item_element',      label: '元素核心', kind: 'element', desc: '轮换战机元素(火→冰→雷)' },
};

// 普通敌人掉"非金币道具"的基础概率
export const ITEM_DROP_CHANCE = 0.16;

// 掉落权重（抽中"非金币道具"后按权重选一种）
export const ITEM_DROP_WEIGHTS = {
  shield: 8, magnet: 8, wingman: 4, energy: 12, heal: 6, bomb: 4, weapon_missile: 5, weapon_laser: 5, weapon_bomb: 5, element_core: 5,
};

// Boss 必掉的高价值道具（按权重）
export const BOSS_DROP_TABLE = ['energy', 'energy', 'heal', 'wingman', 'bomb', 'weapon_missile', 'weapon_laser', 'weapon_bomb'];
