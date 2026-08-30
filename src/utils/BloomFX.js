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
 * OPT-14 扩展（append-only，纯视觉）：
 *   A1  UI 层不进辉光：redraw 按 depth 过滤（> BLOOM.excludeUIDepth=64 跳过），
 *       飘字(80)/战斗弹窗(600+) 保持锐利，gameplay(≤60) 仍发光。
 *   A2  下采样 + 脏标记：RT 1/2 分辨率 + rt.camera.setZoom(1/d) + setScale(d,d)
 *       （soft bloom，带宽≈4x）；opts.staticMode 时 redraw 走 _bloomDirty 脏标记，
 *       静态场景不每帧重绘（兜底 staticEveryNFrames=5 帧一次）。
 *       G2-4 降级路径（downscale.enabled:false → 全分辨率 + 仅 A1）同样走脏标记，
 *       保证降级后静态场景仍限频重绘（不回归为每帧全分辨率重绘）。
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
 * @param {{staticMode?: boolean}} opts staticMode=true 时 redraw 走脏标记（静态场景不每帧重绘；
 *   默认 false → 战斗场景行为不变，每帧重绘，弹幕/爆炸实时）
 * @returns {{rt, list, enabled, redraw, markDirty, dirty}|null} 控制柄；不满足档位/非 WebGL 返回 null
 */
export function enableSceneBloom(scene, quality, opts = {}) {
  if (!bloomEnabledForQuality(quality)) return null;
  if (!isWebGL(scene)) return null;

  const p = (BLOOM && BLOOM.params) || {};
  // OPT-14 A2：下采样开关（d=1 表示全分辨率，走既有行为）
  const ds = (BLOOM && BLOOM.downscale && BLOOM.downscale.enabled) ? (BLOOM.downscale || {}) : null;
  const d = ds ? (ds.factor || 2) : 1;
  // OPT-14 G2-4：staticMode 脏标记兜底周期独立于 downscale——降级路径（enabled:false →
  // 全分辨率 RT + 仅 A1）同样限频重绘，避免每帧烧全分辨率 RT（规格 A2 降级兜底语义）。
  const staticEveryNFrames = Math.max(1, (BLOOM && BLOOM.downscale && BLOOM.downscale.staticEveryNFrames) || 5);
  const rtAlpha = ds
    ? ((ds.rtAlpha != null ? ds.rtAlpha : ((BLOOM && BLOOM.rtAlpha) || 0.3)))
    : ((BLOOM && BLOOM.rtAlpha) || 0.3);
  const rt = scene.add.renderTexture(0, 0, GAME_WIDTH / d, GAME_HEIGHT / d)
    .setOrigin(0)
    .setDepth(4990)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha(rtAlpha);
  // A2 关键：camera.zoom 进入 view 矩阵 → 把全分辨率世界坐标压缩进低分辨率 framebuffer；
  // 显示时再放大 d 倍铺满屏幕（origin(0) 已设）。缺 camera.zoom 只改 framebuffer 会错位。
  if (d > 1) {
    rt.camera.setZoom(1 / d);
    rt.setScale(d, d);
  }

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

  let frame = 0;
  let dirtyFlag = false;                       // staticMode 脏标记：置 true 下一帧强制重绘
  const redraw = () => {
    if (!rt || !rt.active || !rt.visible) return;
    frame++;
    // OPT-14 A2/G2-4：静态场景脏标记（staticMode）——脏标记或到周期才重绘，避免每帧烧成本。
    // 主路径（downscale enabled）与降级路径（enabled:false → 全分辨率 + 仅 A1）均生效；
    // 静态菜单/结算/机库限频重绘（≈staticEveryNFrames 帧一次），战斗（staticMode=false）仍每帧，
    // markDirty()/dirty=true 置脏后下一帧立即重绘、不受限频影响。
    if (opts.staticMode) {
      if (dirtyFlag !== true && (frame % staticEveryNFrames) !== 0) return;
      dirtyFlag = false;
    }
    rt.clear();
    const children = scene.children.getChildren();
    const entries = [];
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c === rt) continue;                       // 防递归：RT 自己不画自己
      if (c && (c.type === 'ParticleEmitter' || c.type === 'Zone')) continue; // 粒子/区域不进辉光层（避免双份粒子）
      // OPT-14 A1：跳过 UI 层（depth > excludeUIDepth 视为 UI：飘字 80 / 战斗弹窗 600+），保持锐利 + 减绘制
      if (BLOOM.excludeUI && c.depth > BLOOM.excludeUIDepth) continue;
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
    markDirty() { dirtyFlag = true; },
  };
  // 探针友好：__BLOOM.dirty = true 等价 markDirty()（QA 可置脏强制重绘）
  Object.defineProperty(ctl, 'dirty', {
    configurable: true,
    get: () => dirtyFlag,
    set: (v) => { if (v) dirtyFlag = true; },
  });
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
