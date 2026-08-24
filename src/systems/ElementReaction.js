import { ELEMENT_REACTIONS } from '../config/ElementReactions.js';

/**
 * ElementReaction —— 元素连锁反应（二段反应）纯逻辑。
 * ---------------------------------------------------------------------------
 * 契约：由 Enemy.hit() 在 applyElement 之前调用 onHit；经 enemy.scene 取场景，
 * 所有实际伤害/击杀/反馈都回落到 GameScene 的 reactionHit / emitReactionFeedback。
 *
 * 红线：不读不写 WINGMAN.COMBO、不触碰 wingmanSystem、不进 playerBullets↔enemies
 * 的 overlap 回调 —— 反应与元素协同 combo 完全解耦。
 */
export default class ElementReaction {
  constructor(scene) {
    this.scene = scene;
  }

  /**
   * 命中入口。返回是否触发反应（触发过即返回 true，供调用方观测）。
   * @param {Enemy} enemy   被命中的敌机
   * @param {string} element 本次命中携带的元素
   * @param {number} now    当前时刻（ms）
   */
  onHit(enemy, element, now) {
    if (!enemy || !enemy.active || enemy._dying) return false;
    if (!element) return false;
    const cfg = ELEMENT_REACTIONS[element];
    if (!cfg) return false;
    if (enemy._elem !== element) return false;         // 仅「同元素」二段反应
    if (now < (enemy._reactUntil || 0)) return false;  // 反应冷却
    enemy._reactUntil = now + ELEMENT_REACTIONS.REACT_CD;
    if (cfg.kind === 'chain') this._chain(enemy, cfg, this.scene);
    else this._aoe(enemy, cfg, this.scene);
    return true;
  }

  /** 雷·传导：取半径内最近 ≤chainCount 个未麻痹敌人，逐个传导麻痹 + 小伤害 */
  _chain(enemy, cfg, scene) {
    const now = scene.time.now;
    const list = [];
    scene.enemies.children.each((e) => {
      if (!e.active || e._dying || e === enemy) return;
      if (now < e._stunUntil) return;   // 已麻痹者不重复传导
      const dx = e.x - enemy.x, dy = e.y - enemy.y;
      list.push({ e, d: dx * dx + dy * dy });
    });
    list.sort((a, b) => a.d - b.d);
    const hitCount = Math.min(cfg.chainCount, list.length);
    for (let i = 0; i < hitCount; i++) {
      const t = list[i].e;
      scene.reactionHit(t, cfg.dmg, cfg.splash, cfg.key);
    }
    scene.emitReactionFeedback(cfg.name, enemy.x, enemy.y, hitCount, cfg.key);
  }

  /** 火·引爆 / 冰·冰爆：半径内 AoE 溅射，伤害随距离衰减（falloff） */
  _aoe(enemy, cfg, scene) {
    const r2 = cfg.radius * cfg.radius;
    let count = 0;
    scene.enemies.children.each((e) => {
      if (!e.active || e._dying || e === enemy) return;
      const dx = e.x - enemy.x, dy = e.y - enemy.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) return;
      const dist = Math.sqrt(d2);
      const dmg = cfg.dmg * (1 - cfg.falloff * dist / cfg.radius);
      scene.reactionHit(e, dmg, cfg.splash, cfg.key);
      count++;
    });
    scene.emitReactionFeedback(cfg.name, enemy.x, enemy.y, count, cfg.key);
  }
}
