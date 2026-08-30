/**
 * OPT-14 A3：FILM 电影层全场景统一（常驻暗角 + 胶片颗粒）
 * ---------------------------------------------------------------------------
 * 背景：常驻暗角 + 胶片颗粒此前只在战斗 UIScene._buildFilmLayers()，菜单/结算/机库
 * 只开 bloom、无 film → 战斗有电影感、菜单/结算发「平」。本模块抽 applyFilmLayer()
 * 复用函数，四场景统一；菜单/结算/机库颗粒做**静态纹理**（防每帧抖动闪烁）。
 *
 * 精确语义（与 OPT-14-VISUAL-SPEC.md 第 A3 条一致）：
 *   - vignette-perm / grain_tex 纹理不存在时首次生成（TextureFactory 已生成 grain_tex；
 *     vignette 从 UIScene 抽入此处首次调用时生成），后续场景复用，不重复建。
 *   - 战斗（UIScene）：vignette depth 88 / grain depth 96；grainSpeed:true → 每帧抖动 1-2px。
 *   - 菜单/结算/机库：vignette depth 88 / grain depth 96；grainSpeed:false → 不注册每帧抖动。
 *   - reduced-motion 强制颗粒静态（grainSpeed 降 false）；low 档颗粒 alpha 减半（沿用减半语义）。
 *   - destroy：移除 update 抖动监听 + 销毁 image（场景 shutdown 自动清理，保持对称）。
 * 纯视觉零业务：不触碰伤害/数值/流程/存档。
 * 测试钩子：window.__FILM = {vignette, grain, vignetteAlpha, grainAlpha, grainStatic, ...}（每场景最新）。
 */

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, FILM, PERFORMANCE } from '../config/GameConfig.js';
import { SaveManager } from './SaveManager.js';

const PREFERS_REDUCED = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** 常驻暗角径向渐变纹理（首次生成，后续场景复用 key='vignette-perm'） */
function ensureVignetteTexture(scene) {
  const vk = 'vignette-perm';
  if (scene.textures.exists(vk)) return vk;
  const W = GAME_WIDTH, H = GAME_HEIGHT;
  const ct = scene.textures.createCanvas(vk, W, H);
  const ctx = ct.getContext();
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.62, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ct.refresh();
  return vk;
}

/**
 * 常驻暗角 + 胶片颗粒（电影感，纯视觉零业务）。
 * @param {Phaser.Scene} scene
 * @param {{key?:string, vignetteAlpha?:number, grainAlpha?:number, grainSpeed?:boolean}} opts
 *   key 预置档：'combat'|'menu'|'result'|'hangar'（查 FILM.presets）；显式传 alpha/速度 覆盖 preset。
 *   未传 key 且未显式传值时回退 FILM 原字段（combat 语义，向后兼容）。
 * @returns {{vignette, grain, vignetteAlpha, grainAlpha, grainSpeed, grainStatic,
 *            setGrainStatic(on), destroy}|null}
 */
export function applyFilmLayer(scene, opts = {}) {
  if (!scene) return null;
  const key = opts.key;
  const preset = (FILM && FILM.presets && key && FILM.presets[key]) || {};
  // 优先级：显式 opts > preset > FILM 原字段（combat 兼容默认）
  const vignetteAlpha = (opts.vignetteAlpha != null) ? opts.vignetteAlpha
    : ((preset.vignetteAlpha != null) ? preset.vignetteAlpha : FILM.vignetteAlpha);
  const grainAlpha = (opts.grainAlpha != null) ? opts.grainAlpha
    : ((preset.grainAlpha != null) ? preset.grainAlpha : FILM.grainAlpha);
  const grainSpeed = (opts.grainSpeed != null) ? opts.grainSpeed
    : ((preset.grainSpeed != null) ? preset.grainSpeed : FILM.grainSpeed);
  // reduced-motion 强制颗粒静态（战斗也静态，与旧 UIScene update 判定一致）
  const finalGrainSpeed = PREFERS_REDUCED ? false : grainSpeed;
  // low 档颗粒 alpha 减半（沿用 FILM.grainLowAlpha 语义；combat 0.04→0.02、menu 0.02→0.01 等）
  const quality = (SaveManager.load().quality) || PERFORMANCE.defaultTier;
  const finalGrainAlpha = quality === 'low' ? grainAlpha * 0.5 : grainAlpha;

  const vk = ensureVignetteTexture(scene);
  const vignette = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, vk)
    .setDepth(opts.vignetteDepth ?? 88)
    .setAlpha(vignetteAlpha);

  let grain = null;
  if (scene.textures.exists('grain_tex')) {
    grain = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'grain_tex')
      .setDepth(opts.grainDepth ?? 96)
      .setAlpha(finalGrainAlpha)
      .setScale(GAME_WIDTH / 128, GAME_HEIGHT / 128)
      .setBlendMode(Phaser.BlendModes.NORMAL);
  }

  // 颗粒逐帧抖动（战斗动态 / 静态场景居中）。update 事件监听（与 BloomFX redraw 同模式）。
  let staticOverride = false; // setGrainStatic(true) 临时关抖动；false 恢复（若 finalGrainSpeed 允许）
  const jitter = () => {
    if (!grain || !grain.active) return;
    if (finalGrainSpeed && !staticOverride) {
      grain.setPosition(
        GAME_WIDTH / 2 + Phaser.Math.Between(-1, 1),
        GAME_HEIGHT / 2 + Phaser.Math.Between(-1, 1),
      );
    } else {
      grain.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    }
  };
  scene.events.on('update', jitter);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    scene.events.off('update', jitter);
    if (vignette && vignette.active) vignette.destroy();
    if (grain && grain.active) grain.destroy();
    if (typeof window !== 'undefined' && window.__FILM === ctl) window.__FILM = null;
  };
  scene.events.once('shutdown', destroy);

  /**
   * 颗粒抖动开关：on=true 静态（不抖动）；on=false 恢复抖动（若该档 grainSpeed=true 才生效）。
   * 静态场景（grainSpeed=false）恒静态，调 false 也不会抖动（finalGrainSpeed 已假）。
   */
  const setGrainStatic = (on) => { staticOverride = !!on; };

  const ctl = {
    vignette,
    grain,
    vignetteAlpha,
    grainAlpha: finalGrainAlpha,
    grainSpeed: finalGrainSpeed,
    grainStatic: !finalGrainSpeed,
    setGrainStatic,
    destroy,
  };
  if (typeof window !== 'undefined') window.__FILM = ctl; // QA 探针测试钩子（每场景最新）
  return ctl;
}

/** 便捷导出：切换 film ctl 的颗粒抖动状态（setFilmGrainStatic(ctl, on)） */
export function setFilmGrainStatic(ctl, on) {
  if (ctl && typeof ctl.setGrainStatic === 'function') ctl.setGrainStatic(on);
  return ctl;
}
