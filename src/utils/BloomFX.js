/**
 * P1 表现工程·PostFX 辉光（Bloom）
 * ---------------------------------------------------------------------------
 * 本 Phaser 3.90 构建无 camera.postFX，改用「全屏 RenderTexture + GameObject
 * postFX.addBloom」实现真实 PostFX 辉光：
 *   1) 每帧把场景显示列表（剔除 RT 自身 / 粒子发射器，active&visible 由
 *      RT.draw 内部 willRender 过滤）画进 RenderTexture；
 *   2) RT 以 ADD 叠加 + 低 alpha 渲染在场景之上，叠加层经 postFX Bloom 后
 *      亮部弥散成辉光 —— 等价于"整屏 bloom"。
 *
 * 开关纪律（与 BLOOM 配置一致）：
 *   - WebGL 才生效（postFX 无 Canvas 实现）；Canvas 模式返回 null 自动降级，无影响。
 *   - quality high/mid 开，low 关（qualityGate='mid'）。
 *   - reduced-motion 不关闭 bloom（静态渲染，不涉及动画偏好）。
 * 消费方：GameScene.create（必开，按性能档）、MenuScene/ResultScene（可选）。
 */

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, BLOOM } from '../config/GameConfig.js';

/** WebGL 才可用 postFX（Canvas 自动降级） */
function isWebGL(scene) {
  return !!(scene && scene.game && scene.game.renderer
    && scene.game.renderer.type === Phaser.WEBGL);
}

/** 按性能档判定是否开启 bloom（high/mid 开，low 关） */
export function bloomEnabledForQuality(quality) {
  if (!BLOOM || BLOOM.enabled === false) return false;
  const tiers = ['high', 'mid', 'low'];
  const q = tiers.includes(quality) ? quality : 'high';
  const gate = tiers.indexOf(BLOOM.qualityGate || 'mid');
  return tiers.indexOf(q) <= gate; // high(0)/mid(1) ≤ mid(1) → 开；low(2) > mid(1) → 关
}

/**
 * 为场景开启整屏 bloom。
 * @param {Phaser.Scene} scene
 * @param {string} quality 'high'|'mid'|'low'
 * @returns {{rt, list, enabled}|null} 控制柄；不满足档位/非 WebGL 返回 null
 */
export function enableSceneBloom(scene, quality) {
  if (!bloomEnabledForQuality(quality)) return null;
  if (!isWebGL(scene)) return null;

  const p = (BLOOM && BLOOM.params) || {};
  const rt = scene.add.renderTexture(0, 0, GAME_WIDTH, GAME_HEIGHT)
    .setOrigin(0)
    .setDepth(4990)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha((BLOOM && BLOOM.rtAlpha) || 0.3);

  // 注意：PostFX 的控制器不进 postFX.list（那是 PreFX 专属），
  // addBloom 会把 BloomFXPipeline 挂到 GameObject.postPipelines 上。
  const bloom = rt.postFX.addBloom(
    p.color != null ? p.color : 0xffffff,
    p.offsetX != null ? p.offsetX : 1,
    p.offsetY != null ? p.offsetY : 1,
    p.blurStrength != null ? p.blurStrength : 0.6,
    p.strength != null ? p.strength : 0.5,
    p.steps != null ? p.steps : 4,
  );

  const redraw = () => {
    if (!rt || !rt.active || !rt.visible) return;
    rt.clear();
    const children = scene.children.getChildren();
    const entries = [];
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c === rt) continue;                       // 防递归：RT 自己不画自己
      if (c && (c.type === 'ParticleEmitter' || c.type === 'Zone')) continue; // 粒子/区域不进辉光层（避免双份粒子）
      entries.push(c);
    }
    if (entries.length) rt.draw(entries, 0, 0, 1);
  };
  scene.events.on('update', redraw);
  scene.events.once('shutdown', () => {
    scene.events.off('update', redraw);
    if (rt && rt.active) rt.destroy();
    if (typeof window !== 'undefined' && window.__BLOOM === ctl) window.__BLOOM = null;
  });

  const ctl = {
    rt,
    bloom,                       // Bloom FX 控制器（Phaser.FX.Bloom）
    pipelines: rt.postPipelines || [], // 实际挂到 RT 上的 PostFX 管线（QA 断言节点数用）
    enabled: true,
    redraw,
  };
  if (typeof window !== 'undefined') window.__BLOOM = ctl; // QA 探针测试钩子
  return ctl;
}

/** 移除场景 bloom（通常不需要；shutdown 自动清理） */
export function disableSceneBloom(scene, ctl) {
  if (!ctl) return;
  scene.events.off('update', ctl.redraw);
  if (ctl.rt && ctl.rt.active) ctl.rt.destroy();
  if (typeof window !== 'undefined' && window.__BLOOM === ctl) window.__BLOOM = null;
}
