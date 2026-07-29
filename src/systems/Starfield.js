import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig.js';

/**
 * 滚动星空背景（多层视差，近大远小 + 颜色层次）。
 * 用 TileSprite 太依赖贴图，这里用一批 star 精灵手动滚动，轻量且可控。
 * 返回 { update(dt), destroy() }。菜单和战斗场景共用。
 *
 * 每层配置：count 数量 / speed px·s⁻¹ / scale[min,max] 近大远小 /
 *           alpha 亮度 / tint 颜色层次（远景偏暗蓝，近景偏亮青）。
 */
const LAYER_PRESETS = [
  { count: 46, speed: 18,  scale: [0.30, 0.45], alpha: 0.35, tint: 0x2a4a6a }, // 最远：暗蓝小星
  { count: 34, speed: 52,  scale: [0.45, 0.70], alpha: 0.55, tint: 0x6f9fd6 }, // 远：蓝白
  { count: 24, speed: 105, scale: [0.70, 1.05], alpha: 0.80, tint: 0xffffff }, // 中：纯白
  { count: 14, speed: 175, scale: [1.05, 1.55], alpha: 1.00, tint: 0x7cf3ff }, // 近：亮青大星
];

export function createStarfield(scene, { layers = 4, starTints = null, theme = null } = {}) {
  const stars = [];
  const presets = LAYER_PRESETS.slice(0, Math.max(1, Math.min(layers, LAYER_PRESETS.length)));

  presets.forEach((c, l) => {
    // 关卡色调：传入 starTints[层] 时按关卡染色，否则用预设 tint
    const tint = (starTints && starTints[l] != null) ? starTints[l] : c.tint;
    for (let i = 0; i < c.count; i++) {
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
      s._speed = c.speed * (0.85 + scale * 0.3); // 越大越快，强化纵深
      stars.push(s);
    }
  });

  // ── 视差背景层：星云 / 云 / 近景剪影（A1）──
  const nebulaCfg = (theme && theme.nebula) || null;
  const cloudTint = (theme && theme.cloudTint != null) ? theme.cloudTint : 0x9fd8ff;
  const silCfg = (theme && theme.silhouette) || { kind: 'none', color: 0x0a1626, density: 0, speed: 0 };

  const bg = [];

  // 星云带（depth -180, 慢速）
  if (nebulaCfg) {
    const tints = nebulaCfg.tints || [0xffffff];
    for (let i = 0; i < 3; i++) {
      const img = scene.add.image(
        Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(0, GAME_HEIGHT), 'bg_nebula',
      ).setDepth(-180)
        .setAlpha(nebulaCfg.alpha != null ? nebulaCfg.alpha : 0.5)
        .setTint(tints[i % tints.length])
        .setScale(Phaser.Math.FloatBetween(0.8, 1.6));
      img._speed = 8;
      img._layer = 'nebula';
      bg.push(img);
    }
  }

  // 云层（depth -150, 中速 + 横向正弦摆动）
  {
    for (let i = 0; i < 4; i++) {
      const img = scene.add.image(
        Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(0, GAME_HEIGHT), 'bg_cloud',
      ).setDepth(-150)
        .setAlpha(0.5)
        .setTint(cloudTint)
        .setScale(Phaser.Math.FloatBetween(0.7, 1.4));
      img._speed = 30;
      img._baseX = img.x;
      img._swayAmp = Phaser.Math.Between(20, 60);
      img._swayPhase = Phaser.Math.FloatBetween(0, Math.PI * 2);
      img._swayFreq = Phaser.Math.FloatBetween(0.0005, 0.0012);
      img._layer = 'cloud';
      bg.push(img);
    }
  }

  // 近景剪影（depth -120, 随 kind 选贴图，出屏回收）
  if (silCfg.kind && silCfg.kind !== 'none') {
    const key = silCfg.kind === 'building' ? 'bg_building' : 'bg_asteroid';
    for (let i = 0; i < 5; i++) {
      const img = scene.add.image(
        Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(-GAME_HEIGHT, GAME_HEIGHT), key,
      ).setDepth(-120)
        .setAlpha(0.9)
        .setTint(silCfg.color)
        .setScale(Phaser.Math.FloatBetween(0.8, 1.5));
      img._speed = silCfg.speed || 60;
      img._layer = 'sil';
      bg.push(img);
    }
  }

  return {
    update(dt) {
      const d = dt / 1000;
      for (const s of stars) {
        s.y += s._speed * d;
        if (s.y > GAME_HEIGHT + 4) {
          s.y = -4;
          s.x = Phaser.Math.Between(0, GAME_WIDTH);
        }
      }
      for (const img of bg) {
        img.y += img._speed * d;
        if (img._layer === 'cloud') {
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
    },
    destroy() {
      stars.forEach((s) => s.destroy());
      stars.length = 0;
      bg.forEach((img) => img.destroy());
      bg.length = 0;
    },
  };
}
