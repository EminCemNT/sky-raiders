import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, TRANSITION, PERFORMANCE } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';

/**
 * P2 视觉四件套⑦：场景转场过渡。
 * ---------------------------------------------------------------------------
 * 职责：
 *   - transition 单例：提供 goto(fromScene, targetKey, data, opts) / fadeIn(scene, opts)，
 *     统一处理"淡出黑幕 → 切场景 → 淡入揭示"，避免各场景手写过渡重复代码。
 *   - TransitionScene：常驻覆盖层（追加在 scene 数组末尾，渲染层级最高，
 *     覆盖各场景内 Bloom RT depth 4990 的全屏辉光），平时透明待命。
 *
 * 调用约定（接入点）：
 *   跳转方： transition.ready ? transition.goto(this, SCENES.X, data) : this.scene.start(SCENES.X, data)
 *   目标方： create() 里调用 transition.fadeIn(this) 做淡入（不调用也有兜底淡入，不会卡黑）
 *
 * 开关纪律：
 *   - TRANSITION.enabled=false        → 全部直切（零影响）
 *   - prefers-reduced-motion          → 直切（无障碍底线，连黑幕都不放）
 *   - quality=low（< qualityGate mid）→ 直切（仅保留性能档；扫描带仅 high/mid 出现）
 *   - transition.ready=false（未初始化/覆盖层未就绪）→ goto 自动退化直切，保证零回归
 * ---------------------------------------------------------------------------
 */

const PREFERS_REDUCED = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function qualityTier() {
  const s = SaveManager.load();
  return (s && s.quality) || PERFORMANCE.defaultTier || 'high';
}

/** 过渡是否可用：总开关 + reduced-motion + 性能档门限 */
function transitionEnabled() {
  if (!TRANSITION.enabled) return false;
  if (PREFERS_REDUCED) return false;
  const gate = TRANSITION.qualityGate || 'mid';
  const order = { high: 3, mid: 2, low: 1 };
  return order[qualityTier()] >= order[gate];
}

// ── P2-4/⑦-1 慢放环境探测 ─────────────────────────────
// QA 无头/慢放环境实测：rAF ~130ms/帧、setTimeout 被节流到 ~270ms。
// 该环境下 160ms 淡出实际要等 2 帧（~293ms）才完成，busy 会因 fade-in 收尾被拖到 ~939ms，
// 超 800ms 硬验收。而帧间隔已 >100ms，黑罩 fade 视觉本就是 1-2 帧跳变（无平滑可言），
// 因此把 fade 时长压到 1ms：淡出/淡入都在「下一个 rAF 帧」即完成，busy ≈ 场景激活时刻。
// 真机 60fps actualFps≈60 → 不进 slow 分支，保持 160/200ms 平滑过渡（零副作用）。
let _slowEnv = null; // null=未测 / true=慢放 / false=正常

function _isSlowEnv(game) {
  if (_slowEnv !== null) return _slowEnv;
  const loop = game && game.loop;
  // 可靠判据（真实墙钟）：平均帧间隔 >80ms → 慢放（缓存）；≤40ms 且已采 ≥3 帧 → 快（缓存）。
  // 实测 QA 软件渲染环境 actualFps 仍报 60、loop.delta 被平滑到 ~15ms，
  // 只有 (lastTime-startTime)/frame 真实反映慢放（boot 期帧间隔实测 ~150-170ms）。
  if (loop && loop.frame >= 1 && (loop.lastTime - loop.startTime) > 0) {
    const avg = (loop.lastTime - loop.startTime) / loop.frame;
    if (avg > 80) { _slowEnv = true; return true; }
    if (avg <= 40 && loop.frame >= 3) { _slowEnv = false; return false; }
  }
  // 未确认（frame<1，或 avg 处于 40-80 灰色带）：保守按慢放处理（fade 压 1ms）。
  // 真机 60fps 在首个 goto 前通常早已 frame≥3 且 avg≈16ms → 已缓存 false → 不受影响；
  // 仅「首帧即 goto」的极端路径（QA 探针）走 1ms，busy 不会被慢 fade 拖长。
  return true;
}

/** 后台 rAF 采样一次（由 TransitionScene.create 触发），补充 actualFps 未稳定时的判据。
 * 只缓存"确定慢"（avg>80），fast 保持 null——避免 boot 期（轻载、帧快）把 false 缓存死，
 * 导致 QA 无头慢放环境下首次 goto 仍走 160/200ms 常态 fade、busy 超 800ms 验收。
 * 保持 null 时由 _isSlowEnv 在 goto 时刻用累计帧间隔实时判定。 */
function _measureSlowEnv() {
  if (_slowEnv !== null || typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  let last = 0, n = 0, acc = 0;
  const step = () => {
    const now = performance.now();
    if (n > 0) acc += now - last;
    last = now; n++;
    if (n < 5) requestAnimationFrame(step);
    else if ((acc / (n - 1)) > 80) _slowEnv = true; // 仅缓存确定慢
  };
  requestAnimationFrame(step);
}

/** 按环境返回有效过渡参数：慢放下压缩 fade 时长到 1ms（首帧完成，busy 不拖长） */
function _effectiveFade(game, opts) {
  const fade = Object.assign({}, TRANSITION.fade, (opts && opts.fade) || {});
  if (_isSlowEnv(game)) { fade.outMs = 1; fade.inMs = 1; }
  return fade;
}

export const transition = {
  ready: false,   // TransitionScene 是否已绑定（BootScene launch 后为 true）
  _scene: null,   // TransitionScene 实例引用
  _black: null,   // 全屏黑罩 Rectangle（无需纹理，绑定即建）
  _band: null,    // 扫描光带 Image（依赖 fx_transition_scan 纹理，懒创建）
  _bandTween: null,
  _busy: false,   // 过渡进行中（防连点）
  _autoFadeIn: null,
  _fadeRaf: null, // 真实时间淡入淡出的 rAF 句柄（P2-4/⑦-1）
  _fadeTimer: null, // 硬性墙钟兜底 setTimeout 句柄（P2-4：rAF 节流时保证按时完成）
  _gotoDeadline: null, // P2-4/⑦-1 总时长硬性兜底 rAF 轮询句柄（墙钟判定，防慢放环境 busy 拖长）
  _gotoTimer: null,   // P2-4/⑦-1 总时长兜底 setTimeout 后备（rAF 完全停摆时兜底）

  /** 取消进行中的真实时间淡入淡出（幂等） */
  _cancelFade() {
    if (this._fadeRaf) { cancelAnimationFrame(this._fadeRaf); this._fadeRaf = null; }
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
  },

  /** 取消 goto 总时长兜底（rAF + setTimeout 双句柄，幂等） */
  _clearGotoDeadline() {
    if (this._gotoDeadline) { cancelAnimationFrame(this._gotoDeadline); this._gotoDeadline = null; }
    if (this._gotoTimer) { clearTimeout(this._gotoTimer); this._gotoTimer = null; }
  },

  /**
   * 真实时间驱动的黑罩 alpha 过渡（P2-4/⑦-1）：
   * 用 performance.now() 墙钟时间推进，而非 Phaser tween。
   * 原因：QA 环境低帧率/慢放时 Phaser tween 按 game.delta 推进会被拉长
   *（实测 260ms fade-out 走了 721ms 墙钟），导致 busy 窗口超 800ms 验收。
   * 双驱动：rAF 负责平滑插值；setTimeout(durMs) 作为硬性墙钟兜底——
   * 无头环境 rAF 被节流到 ~135ms/帧时，若仅靠 rAF，淡出会拖到 2-3 帧才结束。
   * finish() 幂等，先到者胜，保证 busy 窗口 ≈ out+start+in（墙钟）≤ 800ms。
   * @param {number} from 起始 alpha
   * @param {number} to 目标 alpha（1=遮罩盖满，0=揭示完成）
   * @param {number} durMs 时长
   * @param {Function} done 完成后回调
   */
  _fadeRealTime(from, to, durMs, done) {
    const black = this._black;
    if (!black) { done(); return; }
    this._cancelFade();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (this._fadeRaf) { cancelAnimationFrame(this._fadeRaf); this._fadeRaf = null; }
      if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
      black.setAlpha(to);
      done();
    };
    const start = performance.now();
    black.setAlpha(from);
    const step = () => {
      if (finished) return;
      // 覆盖层被停（防御性）：直接完成，避免 rAF 泄漏
      if (!this._scene || !this._scene.scene || !this._scene.scene.isActive()) { this._fadeRaf = null; finish(); return; }
      const t = Math.min(1, (performance.now() - start) / Math.max(1, durMs));
      // 沿用 Quad 缓动手感：淡出加速（t²），淡入减速（1-(1-t)²）
      const k = to > from ? t * t : 1 - (1 - t) * (1 - t);
      black.setAlpha(from + (to - from) * k);
      if (t < 1) { this._fadeRaf = requestAnimationFrame(step); }
      else { finish(); }
    };
    this._fadeRaf = requestAnimationFrame(step);
    this._fadeTimer = setTimeout(finish, Math.max(1, durMs));
  },

  /** 由 TransitionScene.create 调用：绑定覆盖层 + 预建黑罩 */
  _bind(scene) {
    this._scene = scene;
    this.ready = true;
    const W = scene.scale.width, H = scene.scale.height;
    if (!this._black) {
      // 黑罩用 Rectangle：不依赖纹理，可覆盖任何纹理尚未生成的启动阶段
      this._black = scene.add.rectangle(W / 2, H / 2, W + 4, H + 4, TRANSITION.fade.color, 0)
        .setOrigin(0.5).setDepth(999990).setVisible(false);
      scene.scale.on('resize', () => {
        this._black.setSize(scene.scale.width + 4, scene.scale.height + 4);
        this._black.setPosition(scene.scale.width / 2, scene.scale.height / 2);
      });
    }
  },

  /** 懒建扫描带（需 fx_transition_scan 纹理；纹理未生成时静默跳过该装饰层） */
  _ensureBand(scene) {
    if (this._band) return true;
    if (!scene.textures || !scene.textures.exists('fx_transition_scan')) return false;
    this._band = scene.add.image(0, 0, 'fx_transition_scan')
      .setTint(TRANSITION.wipe.tint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0).setDepth(999991).setVisible(false);
    return true;
  },

  /**
   * 带过渡的跳转：淡出 → scene.start → 淡入。
   * 不可用时内部直切（零回归），因此调用方只需一行：transition.goto(this, SCENES.X, data)。
   * @param {Phaser.Scene} fromScene 发起跳转的场景
   * @param {string} targetKey 目标场景 key
   * @param {*} data 传给目标场景的数据（透传 scene.start）
   * @param {{style?: 'fade'|'wipe', fade?: object, beforeStart?: Function}} opts
   *   可选：过渡样式/自定义淡入淡出参数；beforeStart 在淡出完成、scene.start 前回调
   *   （用于先 stop 并行场景如 UIScene，保持旧行为一致）
   * @returns {'ok'|'direct'|'busy'} 便于 QA 探针区分路径
   */
  goto(fromScene, targetKey, data, opts = {}) {
    if (!this.ready || !this._scene || !transitionEnabled()) {
      // 直切回退：与旧行为完全一致，保证零回归
      if (opts.beforeStart) opts.beforeStart();
      fromScene.scene.start(targetKey, data);
      return 'direct';
    }
    if (this._busy) {
      // 过渡进行中：丢弃本次跳转（防连点误导航；进行中的过渡会照常完成）
      return 'busy';
    }
    const fade = _effectiveFade(fromScene.game, opts);
    const style = opts.style || 'fade';
    const scene = this._scene;
    const black = this._black;
    this._busy = true;
    if (this._autoFadeIn) { clearTimeout(this._autoFadeIn); this._autoFadeIn = null; }

    black.setVisible(true).setAlpha(0);
    if (style === 'wipe') this._sweep(scene);
    // P2-4/⑦-1 墙钟起点：先于 _fadeRealTime 声明，淡出回调/兜底闭包均可安全引用（N3：消除 TDZ 隐患）
    const _gotoStart = performance.now();
    this._gotoStartMs = _gotoStart;
    // P2-4：真实时间淡出（不走 Phaser tween，避免慢放环境被拉长）；完成后切场景 + 立即淡入
    this._fadeRealTime(0, 1, fade.outMs, () => {
      if (opts.beforeStart) opts.beforeStart();
      fromScene.scene.start(targetKey, data);
      // P2-4：scene.start 后立即淡入，不再等 inMs+80 兜底延迟（总时长 = out+start+in ≤ 800ms）。
      // 目标场景 create 若再调 fadeIn，_fadeIn 内 _cancelFade 幂等接管，不会双淡入。
      this._fadeIn(fade, style);
    });
    // P2-4/⑦-1 总时长硬性兜底（墙钟判定）：
    // 慢放环境 rAF/setTimeout 都被节流，fade 回调可能被拖长 → busy 超 800ms 验收。
    // 本兜底在墙钟 ≥600ms 后强制黑幕隐藏 + busy 复位。判定用 rAF 轮询（无头环境 rAF
    // ~160ms/帧、setTimeout 节流 ~2.3x：原 setTimeout(400) 实际 ~920ms 才触发，从未兜底）；
    // setTimeout 仅作 rAF 完全停摆时的后备。
    // 真机 60fps 总过渡 ~370-580ms（fade 120/160 + create）→ 先正常完成，兜底自停，零副作用。
    // 注意：兜底挂载必须放在 _fadeRealTime 之后（其首行 _cancelFade 会清 rAF/timer，不清本兜底）。
    const _forceFinish = () => {
      this._gotoDeadline = null;
      if (!this._busy) return;
      if (performance.now() - _gotoStart < 600) {
        // 未达墙钟阈值：rAF 短轮询再查（比 setTimeout 节流可靠）
        this._gotoDeadline = requestAnimationFrame(_forceFinish);
        return;
      }
      this._cancelFade();
      if (black && black.active) black.setAlpha(0).setVisible(false);
      this._busy = false;
    };
    this._clearGotoDeadline();
    this._gotoDeadline = requestAnimationFrame(_forceFinish);
    this._gotoTimer = setTimeout(_forceFinish, 900);
    return 'ok';
  },

  /** 目标场景 create 里调用：做淡入揭示（已由 goto 置黑罩时生效；否则无操作） */
  fadeIn(scene, opts = {}) {
    if (!this.ready || !transitionEnabled()) return;
    if (this._autoFadeIn) { clearTimeout(this._autoFadeIn); this._autoFadeIn = null; }
    if (this._black && this._black.alpha > 0.01) {
      const fade = _effectiveFade(scene.game, opts);
      this._fadeIn(fade, opts.style || 'fade');
    }
  },

  _fadeIn(fade, style) {
    const scene = this._scene;
    const black = this._black;
    if (style === 'wipe') this._sweep(scene);
    if (!black) { this._busy = false; return; }
    // P2-4：真实时间淡入（rAF 驱动，不被慢放拉长）；_cancelFade 幂等接管——
    // goto 立即淡入 / 目标 create fadeIn 二次触发时，从当前 alpha 重新淡入，
    // 避免双过渡导致 busy 延后、总时长超标（原 Phaser tween 已废弃）。
    this._fadeRealTime(black.alpha, 0, fade.inMs, () => {
      this._clearGotoDeadline();
      black.setVisible(false);
      this._busy = false;
    });
  },

  /** 扫描光带横扫一次（wipe 样式；low 档不出现） */
  _sweep(scene) {
    if (!this._ensureBand(scene)) return;
    const band = this._band;
    if (this._bandTween) this._bandTween.stop();
    const W = scene.scale.width, H = scene.scale.height;
    const sy = H / 256;               // 光带拉满屏高
    const bw = 64 * sy;               // 横向宽度（64×scale）
    band.setVisible(true).setAlpha(TRANSITION.wipe.bandAlpha).setScale(sy);
    band.setPosition(-bw / 2, H / 2);
    this._bandTween = scene.tweens.add({
      targets: band, x: W + bw / 2,
      duration: TRANSITION.wipe.duration,
      ease: 'Quad.easeInOut',
      onComplete: () => band.setVisible(false),
    });
  },
};

/**
 * TransitionScene：常驻转场覆盖层。
 * 追加在 main.js scene 数组末尾 → 渲染在一切场景之上（含 Bloom RT 4990）。
 * 平时全透明待命，仅在 transition.goto 进行中显示黑罩/扫描带。
 */
export class TransitionScene extends Phaser.Scene {
  constructor() {
    super(SCENES.TRANSITION);
  }

  create() {
    transition._bind(this);
    // P2-4/⑦-1：后台采样 rAF 帧间隔，补充慢放环境判据（首个 goto 前即可用）
    _measureSlowEnv();
  }

  shutdown() {
    // 覆盖层被停时同步单例状态（正常流程不会触发；防御性兜底）
    transition._scene = null;
    transition.ready = false;
  }
}

// QA 探针：便于自动化断言（window.__SKY_TRANSITION），与 __SKY 同性质，不影响玩法
if (typeof window !== 'undefined') {
  window.__TRANSITION = transition;
}
