import Phaser from 'phaser';
import { COLORS } from '../config/GameConfig.js';

// ── 全局视觉主题（统一各场景配色，避免魔法数散落）─────────────────
export const THEME = {
  accent: COLORS.accent,            // 主霓虹青（与按钮描边一致）
  titleColor: '#7cf3ff',            // 标题文字
  titleShadow: '#2a86c0',           // 标题投影色
  subColor: '#4a90c0',              // 副标题 / 英文小字
  textPrimary: '#cfe8ff',           // 主文字
  textSecondary: '#88bbdd',         // 次文字
  textGold: '#ffd54a',              // 金币 / 成就强调
  // 面板（弹窗背景卡片）
  panelBg: 0x0a2236,
  panelBgAlpha: 0.94,
  panelStroke: 0x4fc3ff,
  panelStrokeAlpha: 0.55,
  panelRadius: 18,
  // 按钮
  btnBg: 0x123a5a,
  btnBgHover: 0x1b5580,
  btnStroke: COLORS.accent,
  // 卡片（机库 / 关卡行）
  cardBg: 0x0d2840,
  cardStroke: 0x2f6f96,
  // 星点默认色
  starTints: [0x9fd8ff, 0x7cf3ff, 0xffffff],
  // 战斗 HUD 配色（A5：血条 / 能量 / 暂停键 分离）
  hp: { good: 0x33dd88, warn: 0xffcc44, bad: 0xff4455 },
  energy: { low: 0x7c6bff, full: 0x6fd0ff },
  pauseBtn: { size: 56, glow: 0x7cf3ff },
};

/**
 * UIWidgets —— 科幻扁平霓虹风格的复用 UI 组件。
 * 供 UIScene（游戏内 HUD）与 MenuScene（菜单/面板）统一调用，
 * 避免各场景散落 rectangle + 手写描边，保证视觉语言一致。
 */

// ── 圆角发光状态条（HP / 能量 / Boss）──────────────────────────────
export class NeonBar {
  constructor(scene, x, y, w, h, opts = {}) {
    this.scene = scene;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.bgColor = opts.bgColor ?? 0x0a1626;
    this.bgAlpha = opts.bgAlpha ?? 0.85;
    this.borderColor = opts.borderColor ?? 0x33597a;
    this.corner = opts.corner ?? Math.min(h / 2, 7);
    this.color = opts.color ?? 0x66ccff;
    this.depth = opts.depth ?? 100;
    this.g = scene.add.graphics().setDepth(this.depth);
    this.ratio = 0;
    this.draw();
  }

  setRatio(r, color) {
    this.ratio = Phaser.Math.Clamp(r, 0, 1);
    if (color !== undefined) this.color = color;
    this.draw();
  }

  setColor(c) { this.color = c; this.draw(); }

  setVisible(v) { this.g.setVisible(v); }

  draw() {
    const g = this.g;
    g.clear();
    // 外发光（半透明放大圆角）
    g.fillStyle(this.color, 0.16);
    g.fillRoundedRect(this.x - 3, this.y - this.h / 2 - 3, this.w + 6, this.h + 6, this.corner + 3);
    // 背景槽
    g.fillStyle(this.bgColor, this.bgAlpha);
    g.fillRoundedRect(this.x, this.y - this.h / 2, this.w, this.h, this.corner);
    g.lineStyle(1, this.borderColor, 0.9);
    g.strokeRoundedRect(this.x, this.y - this.h / 2, this.w, this.h, this.corner);
    // 前景填充
    const fw = this.w * this.ratio;
    if (fw > 1) {
      g.fillStyle(this.color, 1);
      g.fillRoundedRect(this.x, this.y - this.h / 2, fw, this.h, this.corner);
      g.fillStyle(0xffffff, 0.22);
      g.fillRoundedRect(this.x + 1, this.y - this.h / 2 + 1, Math.max(0, fw - 2), this.h * 0.42, this.corner);
    }
  }

  destroy() { this.g.destroy(); }
}

// ── 圆角霓虹按钮（菜单 / 面板通用）────────────────────────────────
export class NeonButton {
  constructor(scene, x, y, label, opts = {}) {
    this.scene = scene;
    this.w = opts.w ?? 220;
    this.h = opts.h ?? 58;
    const bgColor = opts.bgColor ?? THEME.btnBg;
    const stroke = opts.stroke ?? THEME.btnStroke;
    const textColor = opts.textColor ?? '#ffffff';
    this._bg = bgColor; this._stroke = stroke;
    this.container = scene.add.container(x, y);
    this.g = scene.add.graphics();
    this._drawBg(bgColor, stroke, 1);
    this.text = scene.add.text(0, 0, label, {
      fontFamily: 'sans-serif', fontSize: `${opts.fontSize ?? 22}px`,
      fontStyle: '700', color: textColor,
    }).setOrigin(0.5);
    this.container.add([this.g, this.text]);
    this.container.setSize(this.w, this.h).setDepth(opts.depth ?? 10).setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-this.w / 2, -this.h / 2, this.w, this.h),
      hitAreaCallback: (rect, x, y) => rect.contains(x, y),
      useHandCursor: true,
    });
    this.container.on('pointerover', () => this._drawBg(0x1b5580, stroke, 1));
    this.container.on('pointerout', () => this._drawBg(this._bg, stroke, 1));
    this.container.on('pointerdown', () => {
      scene.tweens.add({ targets: this.container, scale: 0.96, duration: 80, yoyo: true });
    });
    if (opts.onDown) this.container.on('pointerdown', opts.onDown);
  }

  _drawBg(fill, stroke, alpha) {
    const g = this.g;
    const r = 10;
    g.clear();
    g.fillStyle(fill, alpha);
    g.fillRoundedRect(-this.w / 2, -this.h / 2, this.w, this.h, r);
    g.lineStyle(2, stroke, 0.95);
    g.strokeRoundedRect(-this.w / 2, -this.h / 2, this.w, this.h, r);
    g.lineStyle(1, 0xffffff, 0.1);
    g.strokeRoundedRect(-this.w / 2 + 3, -this.h / 2 + 3, this.w - 6, this.h - 6, r - 3);
  }

  setLabel(t) { this.text.setText(t); }

  destroy() { this.container.destroy(); }
}

// ── 图标按钮（游戏内右下角炸弹 / 技能）────────────────────────────
export function makeIconButton(scene, x, y, iconKey, opts = {}) {
  const r = opts.radius ?? 36;
  const bgColor = opts.bgColor ?? THEME.btnBg;
  const stroke = opts.stroke ?? THEME.btnStroke;
  const c = scene.add.container(x, y).setDepth(opts.depth ?? 105);
  const ring = scene.add.circle(0, 0, r + 5).setStrokeStyle(3, stroke, 0.9).setAlpha(opts.ringAlpha ?? 0);
  const bg = scene.add.circle(0, 0, r, bgColor, 0.85).setStrokeStyle(2, stroke, 0.9);
  const icon = scene.add.image(0, 0, iconKey).setScale(opts.iconScale ?? 1.6);
  const label = opts.label
    ? scene.add.text(0, r + 14, opts.label, { fontFamily: 'sans-serif', fontSize: '13px', color: '#ffffff' }).setOrigin(0.5)
    : null;
  const count = (opts.count !== undefined)
    ? scene.add.text(0, r - 2, opts.count, { fontFamily: 'sans-serif', fontSize: '13px', color: '#ffd54a' }).setOrigin(0.5)
    : null;
  const parts = [ring, bg, icon];
  if (label) parts.push(label);
  if (count) parts.push(count);
  c.add(parts);
  c.setSize(r * 2 + 10, r * 2 + 10).setInteractive({
    hitArea: new Phaser.Geom.Rectangle(-(r * 2 + 10) / 2, -(r * 2 + 10) / 2, r * 2 + 10, r * 2 + 10),
    hitAreaCallback: (rect, x, y) => rect.contains(x, y),
    useHandCursor: true,
  });
  c.on('pointerdown', (p, x2, y2, e) => {
    if (e) e.stopPropagation();
    scene.tweens.add({ targets: c, scale: 0.92, duration: 90, yoyo: true });
    if (opts.onDown) opts.onDown();
  });
  return { container: c, ring, bg, icon, label, count };
}
