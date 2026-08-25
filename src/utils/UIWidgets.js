import Phaser from 'phaser';
import { COLORS } from '../config/GameConfig.js';

// ── 全局视觉主题（统一各场景配色，避免魔法数散落）─────────────────
export const THEME = {
  // 字体（零外部字体：系统无衬线 / 分数等宽防跳动）
  fontFamily: 'sans-serif',
  scoreFont: 'Consolas, "Courier New", monospace',
  // 标题 / 强调
  accent: COLORS.accent,            // 主霓虹青（与按钮描边一致）
  titleColor: '#7cf3ff',            // 标题文字（主青）
  titleBright: '#aef6ff',           // 标题亮色（比主青更亮）
  titleShadow: '#2a86c0',           // 标题投影色
  subColor: '#4a90c0',              // 副标题 / 英文小字
  subBright: '#6fb6e6',             // 英文副标题（更亮）
  // 正文层级
  textPrimary: '#cfe8ff',           // 主文字
  textSecondary: '#88bbdd',         // 次文字
  textMuted: '#aaccdd',             // 次级浅色
  textDim: '#5a7a99',               // 弱提示
  textDisabled: '#8899aa',          // 锁定 / 禁用
  textDisabledDim: '#667788',
  white: '#ffffff',
  // 语义色
  textGold: '#ffd54a',              // 金币 / 强调金
  textGoldLight: '#ffd86b',         // 成就 / 新纪录浅金
  textSuccess: '#7cffa0',           // 生命 / 任务完成绿
  textAchieve: '#cfe8c0',           // 成就已解锁描述浅绿
  textCyan: '#9ff0ff',              // 青色强调（元素 / 僚机）
  textMint: '#c9a6ff',              // 能量值浅紫
  textPink: '#ff8aa0',              // Boss 名粉
  textRed: '#ff5566',               // 危险 / 失败红
  textWmCd: '#ff8888',              // 僚机重生倒计时红
  textSection: '#7fb8e0',           // 机库区块小标签
  hudLabel: '#5fb0e0',              // HUD 小标签（SCORE）
  dangerDeep: '#ff3355',            // Boss 名投影深红
  shield: '#3ad1ff',                // 护盾青
  magnet: '#ff4d6d',                // 磁力红
  // 面板（弹窗背景卡片，P3 玻璃拟态：半透底 + 内发光描边 + 顶部高光）
  panelBg: 0x0a2236,
  panelBgAlpha: 0.72,
  panelStroke: 0x4fc3ff,
  panelStrokeAlpha: 0.55,
  panelRadius: 18,
  panelGlass: {
    innerStroke: 0x9fd8ff,      // 内发光描边（1px 亮色低 alpha）
    innerStrokeAlpha: 0.14,
    topHighlight: 0xffffff,     // 顶部 1px 高光条
    topHighlightAlpha: 0.18,
  },
  // 按钮
  btnBg: 0x123a5a,
  btnBgHover: 0x1b5580,
  btnStroke: COLORS.accent,
  // 卡片（机库 / 关卡行 / 升级行）
  cardBg: 0x0d2840,
  cardStroke: 0x2f6f96,
  lockedBg: 0x16161e,
  lockedStroke: 0x445566,
  achBg: 0x163a2e,                  // 成就已解锁卡片底
  // 机库选择器
  chipBg: 0x102a44,
  chipStroke: 0x3a7fb0,
  arrowBg: 0x1b4a6b,
  // 进度条 / 轨道
  trackBg: 0x223344,
  trackStroke: 0x557799,
  trackFill: 0x66ccff,
  success: 0x7cffa0,
  // 结算页星级
  starEmpty: 0x334455,
  starEmptyStroke: 0x556677,
  starFillStroke: 0xfff3b0,
  // 低血红框告警
  dangerBorder: 0xff2a44,
  // 图形白 / 金色数值（Graphics 层用）
  whiteHex: 0xffffff,
  coinHex: 0xffd54a,
  // 星点默认色
  starTints: [0x9fd8ff, 0x7cf3ff, 0xffffff],
  // 战斗 HUD 配色（A5：血条 / 能量 / 暂停键 分离）
  hp: { good: 0x33dd88, warn: 0xffcc44, bad: 0xff4455 },
  energy: { low: 0x7c6bff, full: 0x6fd0ff },
  pauseBtn: { size: 56, glow: 0x7cf3ff },
};

/**
 * 玻璃拟态面板（P3 画面质感打磨）：半透玻璃底 + 霓虹描边 +
 * 内发光描边（1px 亮色低 alpha）+ 顶部 1px 高光条。
 * 供 MenuScene.addPanel 等统一绘制，视觉语言集中在 THEME.panelGlass。
 * @param {Phaser.GameObjects.Graphics} g
 */
export function drawGlassPanel(g, cx, top, bottom, w, radius = THEME.panelRadius) {
  const h = bottom - top;
  // 外发光描边层（让面板边缘发光，纯视觉）
  g.lineStyle(10, THEME.panelStroke, 0.12).strokeRoundedRect(cx - w / 2 - 2, top - 2, w + 4, h + 4, radius + 2);
  // 半透玻璃底
  g.fillStyle(THEME.panelBg, THEME.panelBgAlpha);
  g.fillRoundedRect(cx - w / 2, top, w, h, radius);
  // 霓虹描边
  g.lineStyle(2, THEME.panelStroke, THEME.panelStrokeAlpha);
  g.strokeRoundedRect(cx - w / 2, top, w, h, radius);
  // 内发光描边（1px 亮色低 alpha）
  g.lineStyle(1, THEME.panelGlass.innerStroke, THEME.panelGlass.innerStrokeAlpha);
  g.strokeRoundedRect(cx - w / 2 + 4, top + 4, w - 8, h - 8, Math.max(2, radius - 5));
  // 顶部 1px 高光条
  g.lineStyle(1, THEME.panelGlass.topHighlight, THEME.panelGlass.topHighlightAlpha);
  g.beginPath();
  g.moveTo(cx - w / 2 + 16, top + 3);
  g.lineTo(cx + w / 2 - 16, top + 3);
  g.strokePath();
}

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
    this._hover = opts.hoverColor ?? THEME.btnBgHover;
    this.glow = opts.glow ?? false;
    this.selected = false;   // 选中高亮（四档难度按钮用）
    this.container = scene.add.container(x, y);
    this.container.name = 'neon-button';   // QA 探针识别标记（纯标记，不影响渲染）
    // 外发光层（默认隐藏，hover 时淡入；向后兼容，仅 glow:true 生效）
    this.glowG = scene.add.graphics();
    this.glowG.fillStyle(stroke, 0.5).fillRoundedRect(-this.w / 2 - 10, -this.h / 2 - 10, this.w + 20, this.h + 20, 16);
    this.glowG.fillStyle(stroke, 0.8).fillRoundedRect(-this.w / 2 - 5, -this.h / 2 - 5, this.w + 10, this.h + 10, 13);
    this.glowG.setAlpha(0);
    this.g = scene.add.graphics();
    this._drawBg(bgColor, stroke, 1);
    const fontSize = opts.fontSize ?? 22;
    this.text = scene.add.text(0, 0, label, {
      fontFamily: THEME.fontFamily, fontSize: `${fontSize}px`,
      fontStyle: '700', color: textColor,
    }).setOrigin(0.5).setShadow(0, 2, '#000000', 4);   // P3 文字投影
    // P3 标题级字距：按字号比例（每 10px 字号约 1px）
    const ls = Math.max(0, Math.round(fontSize / 10));
    if (ls > 0) this.text.setLetterSpacing(ls);
    this.container.add([this.glowG, this.g, this.text]);
    this._hitConfig = {
      hitArea: new Phaser.Geom.Rectangle(-this.w / 2, -this.h / 2, this.w, this.h),
      hitAreaCallback: (rect, x, y) => rect.contains(x, y),
      useHandCursor: true,
    };
    this.container.setSize(this.w, this.h).setDepth(opts.depth ?? 10).setInteractive(this._hitConfig);
    this.container.on('pointerover', () => { this._drawBg(this._hover, stroke, 1); if (this.glow) this.scene.tweens.add({ targets: this.glowG, alpha: 0.4, duration: 160 }); });
    this.container.on('pointerout', () => { this._drawSelected(); if (this.glow) this.scene.tweens.add({ targets: this.glowG, alpha: this.selected ? 0.5 : 0, duration: 160 }); });
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
    g.lineStyle(1, THEME.whiteHex, 0.1);
    g.strokeRoundedRect(-this.w / 2 + 3, -this.h / 2 + 3, this.w - 6, this.h - 6, r - 3);
  }

  setLabel(t) { this.text.setText(t); }

  /** 动态改底色（机库升级按钮：可升级 / 金币不足 / 满级 三态） */
  setBgColor(color) {
    this._bg = color;
    this._drawBg(color, this._stroke, 1);
  }

  /** 启用/禁用交互（禁用后 hover/press 不响应，视觉回退当前底色） */
  setEnabled(on) {
    if (on) {
      this.container.setInteractive(this._hitConfig);
    } else {
      this.container.disableInteractive();
      this._drawBg(this._bg, this._stroke, 1);
    }
  }

  /** 设置选中态（四档难度按钮）：选中用高亮底 + 亮描边，未选中回默认底 */
  setSelected(sel) {
    this.selected = !!sel;
    this._drawSelected();
    if (this.glow) this.scene.tweens.add({ targets: this.glowG, alpha: this.selected ? 0.5 : 0, duration: 160 });
  }

  _drawSelected() {
    if (this.selected) this._drawBg(0x2a7ab8, 0x7cf3ff, 1);
    else this._drawBg(this._bg, this._stroke, 1);
  }

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
    ? scene.add.text(0, r + 14, opts.label, { fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.white }).setOrigin(0.5)
    : null;
  const count = (opts.count !== undefined)
    ? scene.add.text(0, r - 2, opts.count, { fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textGold }).setOrigin(0.5)
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
