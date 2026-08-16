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
 *   - reduced_motion（OS matchMedia，不新增存档开关）：保留静态出现 + 淡出，
 *     跳过弹入 scale 与上升位移（BIG numbers 降级为静态大字 + 淡出）
 *   - shutdown 时解绑 EventBus，避免场景重启后重复回调
 */

const RISE = 42;          // 上飘像素，对齐 d-float FLOAT_RISE 手感
const LIFETIME = 800;     // ms，对齐 d-float FLOAT_LIFETIME
const DEPTH = 80;         // 压在玩法层之上、HUD 叠层之下
const MAX_FLOATERS = 24;  // 同屏飘字上限：超出丢弃最旧（优先非 special），防清屏(useBomb/useSuper)瞬时数十弹遮挡

const prefersReduced = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function fmtMult(m) {
  if (Math.abs(m - Math.round(m)) < 0.05) return String(Math.round(m));
  return m.toFixed(1);
}

export class FloatingTextManager {
  constructor(scene) {
    this.scene = scene;
    this._floaters = [];   // 活跃飘字引用（用于同屏上限裁剪）
    this._onFloat = (p) => this.spawn(p);
    EventBus.on(EVENTS.FLOAT_SCORE, this._onFloat);
    scene.events.once('shutdown', () => this.destroy());
  }

  spawn(p) {
    if (!p || p.x == null || p.y == null) return;
    const reduced = prefersReduced;

    // 同屏上限裁剪：清屏炸弹/星风暴瞬时数十弹，超出则丢弃最旧（优先非 special）飘字防遮挡
    if (this._floaters.length >= MAX_FLOATERS) this._dropOldest();

    let text;
    if (p.label) {
      text = p.label;
    } else {
      text = '+' + (p.amount | 0);
      if (p.mult > 1.05) text += ' ×' + fmtMult(p.mult);
    }

    // 虫姬风 BIG numbers：倍率 > 1.05（即连击累积）时字号放大到 40~48px，倍率越高越大越醒目
    const big = p.mult > 1.05;
    let fontSize, color, stroke, strokeThickness;
    if (big) {
      fontSize = Phaser.Math.Clamp(
        Math.round(40 + (Math.max(p.mult, 1.05) - 1.05) / (5 - 1.05) * 8), 40, 48,
      );
      color = '#ffffff';
      stroke = '#ffd54a';      // == COLORS.coin 单一金来源：加粗金色描边
      strokeThickness = 6;
    } else {
      fontSize = p.special ? '28px' : '22px';
      color = p.special ? '#ffd54a' : '#ffffff';
      stroke = '#040a16';
      strokeThickness = 4;
    }

    const t = this.scene.add.text(p.x, p.y, text, {
      fontFamily: 'sans-serif',
      fontSize: typeof fontSize === 'number' ? fontSize + 'px' : fontSize,
      fontStyle: 'bold',
      color,
      stroke,
      strokeThickness,
    }).setOrigin(0.5).setDepth(DEPTH);
    t._special = !!p.special;
    this._floaters.push(t);

    const onDone = () => {
      const i = this._floaters.indexOf(t);
      if (i >= 0) this._floaters.splice(i, 1);
      if (t && t.active) t.destroy();
    };

    if (reduced) {
      // reduced-motion：静态出现 + 淡出，跳过弹入 scale 与上升位移
      this.scene.tweens.add({
        targets: t, alpha: 0, duration: LIFETIME, ease: 'Cubic.out', onComplete: onDone,
      });
    } else {
      if (big) {
        t.setScale(1.4);
        this.scene.tweens.add({
          targets: t, scale: 1.0, duration: 320, ease: 'Back.easeOut',
        });
      }
      this.scene.tweens.add({
        targets: t, y: p.y - RISE, alpha: 0, duration: LIFETIME, ease: 'Cubic.out', onComplete: onDone,
      });
    }
  }

  /** 同屏飘字超出上限时裁剪：优先丢弃最旧的非 special 飘字，全 special 时丢弃最旧整体；跳过已失效引用 */
  _dropOldest() {
    let idx = -1;
    for (let i = 0; i < this._floaters.length; i++) {
      if (this._floaters[i].active && !this._floaters[i]._special) { idx = i; break; }
    }
    if (idx < 0) {
      for (let i = 0; i < this._floaters.length; i++) {
        if (this._floaters[i].active) { idx = i; break; }
      }
    }
    if (idx < 0) { this._floaters.length = 0; return; }
    const old = this._floaters[idx];
    this._floaters.splice(idx, 1);
    if (old.active) {
      this.scene.tweens.killTweensOf(old);   // 先停 tween，防销毁后回调残留
      old.destroy();
    }
  }

  destroy() {
    EventBus.off(EVENTS.FLOAT_SCORE, this._onFloat);
  }
}

/**
 * 伤害飘字（受击反馈）：显示扣血数字，上飘 + 淡出后自动销毁。
 * 与 FLOAT_SCORE（分数飘字）语义分离——这里是"打掉敌人多少血"的即时反馈。
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {number} dmg  伤害值
 * @param {object} [opts] { crit, color }
 */
export function damageNumber(scene, x, y, dmg, opts = {}) {
  if (prefersReduced) return;
  const crit = !!opts.crit;
  const color = opts.color || (crit ? '#ff4d6d' : '#ffd2a6');
  const size = crit ? '26px' : '18px';
  const t = scene.add.text(x, y, String(Math.max(1, Math.round(dmg))), {
    fontFamily: 'sans-serif',
    fontSize: size,
    fontStyle: 'bold',
    color,
    stroke: '#040a16',
    strokeThickness: 4,
  }).setOrigin(0.5).setDepth(DEPTH);

  scene.tweens.add({
    targets: t,
    y: y - 34,
    alpha: 0,
    duration: 560,
    ease: 'Cubic.out',
    onComplete: () => t.destroy(),
  });
}
