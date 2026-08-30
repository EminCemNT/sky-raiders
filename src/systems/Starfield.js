import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, PERFORMANCE, EASE } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';

/**
 * 滚动星空背景（多层视差，近大远小 + 颜色层次）。
 * 用 TileSprite 太依赖贴图，这里用一批 star 精灵手动滚动，轻量且可控。
 * 返回 { update(dt), destroy() }。菜单和战斗场景共用。
 *
 * P2 视觉四件套④：改为「视差系数」驱动 —— SCROLL_BASE × PARALLAX.factor，
 * 近/远比 ≈13.6×，纵深比旧固定 speed 更显著；同时接入画质档 TIER：
 *   - 生效层数 / 星数 / 流光条数 / 剪影数 / 呼吸 / 流星 全部按档位缩放；
 *   - 云层 sway：reduced-motion 停 + low 档停（仅保留纵向滚动）；
 *   - 档位解析自包含（opts.quality || 存档 quality || PERFORMANCE.defaultTier），
 *     调用方无需改动（GameScene/Menu/Hangar/Result 均从同一存档源读 quality）。
 *
 * 动态酷炫层（Phase D，纯视觉装饰）：
 *   - 能量流光带（streams）：竖向发光带，慢速向下流动 + 横向正弦缓动。
 *   - 偶发流星（meteors）：随机间隔斜向飞过屏幕，带拖尾淡入淡出，自回收。
 *   - 星云脉动（nebula pulse）：已有星云图做 alpha 呼吸，强化"活"的氛围。
 * reduced-motion 环境下全部禁用，仅保留原有静态滚动星/云，守住无障碍底线。
 */
const SCROLL_BASE = 70; // px/s 战斗基准滚速（星体速度 = SCROLL_BASE × factor × (0.85 + scale*0.3) × tier.speedMul）
const PARALLAX = [
  { depth: 'far1', factor: 0.23, count: 46, scale: [0.30, 0.45], alpha: 0.35, tint: 0x2a4a6a }, // 最远：暗蓝小星
  { depth: 'far2', factor: 0.62, count: 34, scale: [0.45, 0.70], alpha: 0.55, tint: 0x6f9fd6 }, // 远：蓝白
  { depth: 'mid',  factor: 1.35, count: 24, scale: [0.70, 1.05], alpha: 0.80, tint: 0xffffff }, // 中：纯白
  { depth: 'near', factor: 3.10, count: 14, scale: [1.05, 1.55], alpha: 1.00, tint: 0x7cf3ff }, // 近：亮青大星
];

/**
 * 内部性能档表（P2 视觉四件套④）：解析自包含（存档 quality），仅影响纯视觉装饰。
 *   layerCount 生效视差层数 / countMul 每层星数倍率 / speedMul 背景滚动速度倍率
 *   streams 流光条数 / meteors 是否生成流星 / silCount 剪影数量
 *   breathing 星云呼吸 + 云层 sway / glowbandMul 底部光带 alpha 倍率
 */
const TIER = {
  high: { layerCount: 4, countMul: 1.0,  speedMul: 1.0,  streams: 4, meteors: true,  silCount: 5, breathing: true,  glowbandMul: 1.0  },
  mid:  { layerCount: 4, countMul: 0.7,  speedMul: 0.85, streams: 2, meteors: true,  silCount: 4, breathing: true,  glowbandMul: 0.9  },
  low:  { layerCount: 3, countMul: 0.45, speedMul: 0.7,  streams: 0, meteors: false, silCount: 3, breathing: false, glowbandMul: 0.75 },
};

/**
 * UI P2 背景主题（菜单 / 机库，纯视觉装饰参数化）。
 * 复用 Starfield 已有 nebula / cloudTint / silhouette 能力：
 *   - 菜单：青色星云脉动 + 楼群近景剪影（科幻都市天际线）。
 *   - 机库：淡紫青星云 + 陨石近景剪影；星云/星空会随所选战机 tint。
 */
export const MENU_BG_THEME = {
  starTints: [0x2a4a6a, 0x6f9fd6, 0xbfe0ff, 0x7cf3ff],
  nebula: { tints: [0x3a1f6e, 0x1f3a6e, 0x0f2a4a], alpha: 0.22 },
  cloudTint: 0x9fd8ff,
  silhouette: { kind: 'building', color: 0x0a101c, density: 1, speed: 40 },
};

export const HANGAR_BG_THEME = {
  starTints: [0x2a4a6a, 0x6f9fd6, 0xbfe0ff, 0x9fd8ff],
  nebula: { tints: [0x1f2a5a, 0x2a1f5a, 0x1f3a4a], alpha: 0.22 },
  cloudTint: 0x9fd8ff,
  silhouette: { kind: 'asteroid', color: 0x0a101c, density: 1, speed: 34 },
};

/** 颜色乘法（白纹理 tint 叠加）：base * tint 逐通道 /255，用于「星空随战机 tint 跟随」 */
function mulTint(base, tint) {
  const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
  const tr = (tint >> 16) & 0xff, tg = (tint >> 8) & 0xff, tb = tint & 0xff;
  return ((br * tr / 255) << 16) | ((bg * tg / 255) << 8) | (bb * tb / 255);
}

export function createStarfield(scene, { layers = 4, starTints = null, theme = null, quality = null } = {}) {
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // 性能档解析自包含：opts.quality || 存档 quality || 默认 high（调用方无需传档）
  // P3-10：SaveManager.load() 只调一次（原两次调用，防存档对象不一致/重复反序列化开销）
  const _save = SaveManager.load();
  const saveQ = (_save && _save.quality) || null;
  const rawQ = quality || saveQ || PERFORMANCE.defaultTier;
  const tierKey = (TIER[rawQ] && rawQ) || PERFORMANCE.defaultTier;
  const tier = TIER[tierKey] || TIER[PERFORMANCE.defaultTier];
  // 生效视差层数：min(调用方 layers, PARALLAX 上限, 档位 layerCount)
  const effectiveLayers = Math.max(1, Math.min(layers, PARALLAX.length, tier.layerCount));
  const stars = [];
  const presets = PARALLAX.slice(0, effectiveLayers);
  // P2-7：按层记录代表滚动速度（取该层首颗星星的 _speed，供 QA/PM 探针 speeds()）
  const layerSpeeds = [];

  presets.forEach((c, l) => {
    // 关卡色调：传入 starTints[层] 时按关卡染色，否则用预设 tint
    const tint = (starTints && starTints[l] != null) ? starTints[l] : c.tint;
    const count = Math.max(1, Math.floor(c.count * tier.countMul));
    for (let i = 0; i < count; i++) {
      const s = scene.add.image(
        Phaser.Math.Between(0, GAME_WIDTH),
        Phaser.Math.Between(0, GAME_HEIGHT),
        'star'
      );
      const scale = Phaser.Math.FloatBetween(c.scale[0], c.scale[1]);
      s.setScale(scale)
        .setAlpha(c.alpha)
        .setDepth(-100 + l)
        .setTint(tint);
      s._baseTint = tint;   // 记录基色，供 setTint(战机色) 乘算叠加
      // P2④ 视差系数驱动：SCROLL_BASE × factor × (0.85 + scale*0.3) × tier.speedMul（近/远比 ≈13.6×）
      s._speed = SCROLL_BASE * c.factor * (0.85 + scale * 0.3) * tier.speedMul;
      stars.push(s);
      if (i === 0) layerSpeeds.push(s._speed); // 每层首颗作为该层代表速度
    }
  });

  // ── 视差背景层：星云 / 云 / 近景剪影（A1）──
  const nebulaCfg = (theme && theme.nebula) || null;
  const cloudTint = (theme && theme.cloudTint != null) ? theme.cloudTint : 0x9fd8ff;
  const silCfg = (theme && theme.silhouette) || { kind: 'none', color: 0x0a1626, density: 0, speed: 0 };

  const bg = [];
  const nebulaImgs = [];

  // 星云带（depth -180, 慢速；P3：3→4 张，雾感更厚）
  if (nebulaCfg) {
    const tints = nebulaCfg.tints || [0xffffff];
    for (let i = 0; i < 4; i++) {
      const img = scene.add.image(
        Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(0, GAME_HEIGHT), 'bg_nebula',
      ).setDepth(-180)
        .setAlpha(nebulaCfg.alpha != null ? nebulaCfg.alpha : 0.5)
        .setTint(tints[i % tints.length])
        .setScale(Phaser.Math.FloatBetween(0.8, 1.6));
      img._baseTint = tints[i % tints.length];
      img._speed = 8 * tier.speedMul;
      img._layer = 'nebula';
      img._baseAlpha = img.alpha;
      bg.push(img);
      nebulaImgs.push(img);
    }
  }

  // 云层（depth -150, 中速 + 横向正弦摆动；reduced-motion 与 low 档停 sway，仅纵向滚动）
  {
    const cloudSway = !reduceMotion && tier.breathing;
    for (let i = 0; i < 4; i++) {
      const img = scene.add.image(
        Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(0, GAME_HEIGHT), 'bg_cloud',
      ).setDepth(-150)
        .setAlpha(0.5)
        .setTint(cloudTint)
        .setScale(Phaser.Math.FloatBetween(0.7, 1.4));
      img._baseTint = cloudTint;
      img._speed = 30 * tier.speedMul;
      img._baseX = img.x;
      img._sway = cloudSway;
      img._swayAmp = Phaser.Math.Between(20, 60);
      img._swayPhase = Phaser.Math.FloatBetween(0, Math.PI * 2);
      img._swayFreq = Phaser.Math.FloatBetween(0.0005, 0.0012);
      img._layer = 'cloud';
      bg.push(img);
    }
  }

  // 近景剪影（depth -120, 随 kind 选贴图，出屏回收；数量按 TIER.silCount）
  if (silCfg.kind && silCfg.kind !== 'none') {
    const key = silCfg.kind === 'building' ? 'bg_building' : 'bg_asteroid';
    for (let i = 0; i < tier.silCount; i++) {
      const img = scene.add.image(
        Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(-GAME_HEIGHT, GAME_HEIGHT), key,
      ).setDepth(-120)
        .setAlpha(0.9)
        .setTint(silCfg.color)
        .setScale(Phaser.Math.FloatBetween(0.8, 1.5));
      img._speed = (silCfg.speed || 60) * tier.speedMul;
      img._layer = 'sil';
      bg.push(img);
    }
  }

  // 底部地平线光带（P3：ADD 贴屏底滚动，alpha 0.10~0.14 随 theme tint × TIER.glowbandMul）
  {
    const bandTint = (theme && (theme.accent || theme.cloudTint)) || 0x7cf3ff;
    const band = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT - 10, 'bg_glowband')
      .setDepth(-90)
      .setAlpha(Phaser.Math.FloatBetween(0.10, 0.14) * tier.glowbandMul)
      .setTint(bandTint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale((GAME_WIDTH * 1.2) / 512, 1.0);
    band._baseTint = bandTint;
    band._speed = 18 * tier.speedMul;
    band._layer = 'glowband';
    bg.push(band);
  }

  // ── 动态酷炫层（Phase D）：能量流光带 + 流星（reduced-motion 下不创建；数量按 TIER.streams）──
  const streams = [];
  const meteors = [];
  let meteorTimer = Phaser.Math.Between(2200, 4200); // 首颗流星延迟

  if (!reduceMotion && tier.streams > 0) {
    // 能量流光带：少量竖向发光长条，慢速向下流动 + 横向缓动（ADD 混合更"发光"）
    const STREAM_COUNT = tier.streams;
    for (let i = 0; i < STREAM_COUNT; i++) {
      const x = Phaser.Math.Between(40, GAME_WIDTH - 40);
      const s = scene.add.image(x, Phaser.Math.Between(0, GAME_HEIGHT), 'particle_streak')
        .setDepth(-95)
        .setTint(0x7cf3ff)
        .setScale(2.2 + i * 0.6, 150 + i * 20)
        .setAlpha(0.08 + i * 0.02)   // P3：流光 alpha 微提 0.05~0.11 → 0.08~0.14
        .setBlendMode(Phaser.BlendModes.ADD);
      s._speed = Phaser.Math.Between(45, 95) * tier.speedMul;
      s._baseX = x;
      s._swayAmp = Phaser.Math.Between(10, 38);
      s._swayPhase = Phaser.Math.FloatBetween(0, Math.PI * 2);
      s._swayFreq = Phaser.Math.FloatBetween(0.0004, 0.0010);
      streams.push(s);
    }

    // 星云呼吸脉动：已有星云图做 alpha 呼吸（不新增对象，仅加 tween；low 档停）
    if (tier.breathing) {
      nebulaImgs.forEach((img, i) => {
        scene.tweens.add({
          targets: img,
          alpha: { from: img._baseAlpha * 0.55, to: img._baseAlpha * 1.15 },
          duration: 2600 + i * 400,
          yoyo: true,
          repeat: -1,
          ease: EASE.breathe,
        });
      });
    }
  }

  // 生成一颗流星（斜向飞过，淡入淡出，飞出后自回收；low 档不生成）
  function spawnMeteor() {
    if (reduceMotion || !tier.meteors) return;
    const x0 = Phaser.Math.Between(0, Math.floor(GAME_WIDTH * 0.7));
    const m = scene.add.image(x0, -12, 'star')
      .setDepth(-88)
      .setTint(0xbfe8ff)
      .setScale(1.6, 4.5)
      .setAngle(22)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    meteors.push(m);
    const dx = Phaser.Math.Between(90, 170);
    scene.tweens.add({
      targets: m,
      x: x0 + dx,
      y: GAME_HEIGHT + 30,
      duration: 720,
      ease: 'Sine.easeIn',
      onComplete: () => {
        const idx = meteors.indexOf(m);
        if (idx >= 0) meteors.splice(idx, 1);
        m.destroy();
      },
    });
    scene.tweens.add({
      targets: m,
      alpha: { from: 0, to: 0.95 },
      duration: 140,
      yoyo: true,
      hold: 380,
      onComplete: () => { if (m.active && m.alpha > 0) m.setAlpha(0); },
    });
  }

  return {
    update(dt) {
      const d = dt / 1000;      for (const s of stars) {
        s.y += s._speed * d;
        if (s.y > GAME_HEIGHT + 4) {
          s.y = -4;
          s.x = Phaser.Math.Between(0, GAME_WIDTH);
        }
      }
      for (const img of bg) {
        img.y += img._speed * d;
        if (img._layer === 'cloud' && img._sway) {
          img._swayPhase += img._swayFreq * dt;
          img.x = img._baseX + Math.sin(img._swayPhase) * img._swayAmp;
        }
        const h = img.displayHeight || img.height;
        if (img.y > GAME_HEIGHT + h) {
          img.y = -h;
          img.x = Phaser.Math.Between(0, GAME_WIDTH);
          if (img._layer === 'cloud') img._baseX = img.x;
        }
      }
      // 能量流光带流动 + 横向缓动
      for (const s of streams) {
        s.y += s._speed * d;
        if (s.y > GAME_HEIGHT + s.displayHeight) s.y = -s.displayHeight;
        s._swayPhase += s._swayFreq * dt;
        s.x = s._baseX + Math.sin(s._swayPhase) * s._swayAmp;
      }
      // 流星定时生成（reduced-motion / low 档不生成）
      if (!reduceMotion && tier.meteors) {
        meteorTimer -= dt;
        if (meteorTimer <= 0) {
          spawnMeteor();
          meteorTimer = Phaser.Math.Between(2400, 5200);
        }
      }
    },
    destroy() {
      stars.forEach((s) => s.destroy());
      stars.length = 0;
      bg.forEach((img) => img.destroy());
      bg.length = 0;
      streams.forEach((s) => { scene.tweens.killTweensOf(s); s.destroy(); });
      streams.length = 0;
      meteors.forEach((m) => { scene.tweens.killTweensOf(m); m.destroy(); });
      meteors.length = 0;
      nebulaImgs.forEach((img) => scene.tweens.killTweensOf(img));
    },
    /**
     * 机库用：让星空 / 星云 / 云层的色调随所选战机 tint 跟随（乘算叠加基色）。
     * 传入 null/0 时回到基色（恢复默认观感）。
     */
    setTint(tint) {
      if (!tint) {
        stars.forEach((s) => s.setTint(s._baseTint));
        bg.forEach((img) => { if (img._baseTint) img.setTint(img._baseTint); });
        return;
      }
      stars.forEach((s) => s.setTint(mulTint(s._baseTint, tint)));
      bg.forEach((img) => { if (img._baseTint) img.setTint(mulTint(img._baseTint, tint)); });
    },
    // 调试接口（供 QA 探针断言，不影响运行）
    _dbg: {
      reduceMotion,
      tier: tierKey,
      effectiveLayers,
      starCount: () => stars.length,
      streamCount: () => streams.length,
      meteorCount: () => meteors.length,
      // P2-7：四层（或生效层）代表滚动速度数组，QA/PM 探针验收视差系数化
      speeds: () => layerSpeeds.slice(),
    },
  };
}
