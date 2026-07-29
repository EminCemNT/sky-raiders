import Phaser from 'phaser';
import { EVENTS, COLORS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';

/**
 * 飘分（d-float）管理器
 * ---------------------------------------------------------------------------
 * 复用 Xuanji Casual 的 d-float 范式：击杀/吃币/特殊事件时，在场景内对应坐标
 * 浮起一段文字，上飘 + 淡出后自动销毁。零新增 HUD 结构，纯场景内 transient 文本。
 *
 * payload 契约（EVENTS.FLOAT_SCORE）：
 *   { x, y, amount, mult=1, special=false, label=null }
 *   - label 存在时直接显示该文字（如 BOSS 击破）
 *   - 否则显示 "+amount"( + " ×mult" 当 mult>1.05 )
 *   - special=true 用金色（COLORS.coin，单一金来源），否则白字
 *
 * 纪律：
 *   - 金单一来源 = COLORS.coin，严禁硬编码 #C8A96A 等
 *   - reduced_motion（系统"减少动态效果"）开启时不飘，直接 return
 *   - shutdown 时解绑 EventBus，避免场景重启后重复回调
 */

const RISE = 42;          // 上飘像素，对齐 d-float FLOAT_RISE 手感
const LIFETIME = 800;     // ms，对齐 d-float FLOAT_LIFETIME
const DEPTH = 80;         // 压在玩法层之上、HUD 叠层之下

function fmtMult(m) {
  if (Math.abs(m - Math.round(m)) < 0.05) return String(Math.round(m));
  return m.toFixed(1);
}

export class FloatingTextManager {
  constructor(scene) {
    this.scene = scene;
    this._onFloat = (p) => this.spawn(p);
    EventBus.on(EVENTS.FLOAT_SCORE, this._onFloat);
    scene.events.once('shutdown', () => this.destroy());
  }

  spawn(p) {
    if (!p || p.x == null || p.y == null) return;
    // reduced_motion：系统级"减少动态"，直接跳过飘字
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let text;
    if (p.label) {
      text = p.label;
    } else {
      text = '+' + (p.amount | 0);
      if (p.mult > 1.05) text += ' ×' + fmtMult(p.mult);
    }
    const color = p.special ? '#ffd54a' : '#ffffff';

    const t = this.scene.add.text(p.x, p.y, text, {
      fontFamily: 'sans-serif',
      fontSize: p.special ? '28px' : '22px',
      fontStyle: 'bold',
      color,
      stroke: '#040a16',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(DEPTH);

    this.scene.tweens.add({
      targets: t,
      y: p.y - RISE,
      alpha: 0,
      duration: LIFETIME,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  destroy() {
    EventBus.off(EVENTS.FLOAT_SCORE, this._onFloat);
  }
}
