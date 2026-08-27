import { AUDIO, EVENTS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';

/**
 * 程序化音效与 BGM（WebAudio，零外部依赖，无需 CDN / 音频文件）
 * ---------------------------------------------------------------------------
 * 单例：import { audio } from '../systems/AudioSystem.js'; audio.sfx('shoot');
 *
 * 浏览器 autoplay 限制：AudioContext 创建即 suspended，必须在用户手势
 * （如点击"开始游戏"）后调用 audio.resume() 才能出声。MenuScene 已接。
 *
 * 音量分级：master(总) / sfx(音效) / bgm(音乐) 三路独立增益，
 * 设置面板拖动即时生效并写入 localStorage（SaveManager）。
 *
 * 接入方式：
 *   - 射击音效在 Player.fire 直接调用（太频繁，内部节流）
 *   - 其余通过 bindGameEvents() 监听 EventBus 自动播放（GameScene.create 调用一次）
 */

// ── P0-1 全链路动态压缩：参数集中一处，便于试听微调 ──
// master → compressor → compGain(makeup) → destination。阈值 -18dB / ratio 6 收紧峰值，
// makeupGain 1.25（≈ +2dB）补偿压缩带来的响度损失，听感更"贴"不炸耳。
const COMPRESSOR = {
  threshold: -18,
  knee: 20,
  ratio: 6,
  attack: 0.003,
  release: 0.25,
  makeupGain: 1.25,
};

// ── P0-2 爆炸三阶段分级参数表（small/mid/boss）──
//   ① 瞬态爆裂：highpass 噪声，burstDur 时长 / burstCut 高通截止，快衰减
//   ② 低频轰鸣：bodyFreq sine 指数衰减，freq 滑落 ~0.6x；subFreq 非空时追加更低 sub 正弦
//   ③ 回声尾音：tailFreq（≈bodyFreq*2）sine，低音量，tailDur 时长
export const EXPLOSION_TIERS = {
  small: { burstDur: 0.05, burstCut: 2400, bodyFreq: 50, bodyDur: 0.22, bodyVol: 0.30, subFreq: null, tailFreq: 92, tailDur: 0.16, tailVol: 0.10 },
  mid:   { burstDur: 0.07, burstCut: 1800, bodyFreq: 45, bodyDur: 0.30, bodyVol: 0.38, subFreq: 30,  tailFreq: 84, tailDur: 0.22, tailVol: 0.14 },
  boss:  { burstDur: 0.11, burstCut: 1400, bodyFreq: 40, bodyDur: 0.50, bodyVol: 0.45, subFreq: 27,  tailFreq: 76, tailDur: 0.34, tailVol: 0.18 },
};

// ── P1 表现工程·BGM 4 轨 sequencer 模板（程序合成，零外部音频）──
// 每段 8 步（8 分音符步长，2 步 = 1 拍，8 步 = 1 小节）：
//   bass  低频铺底（sine，长时值）
//   lead  主旋律（triangle 简单音阶序列；0 = 休止）
//   arp   琶音（当前 scale 快速轮转）
//   drums kick（每 kickEvery 步）+ hihat（每 hatEvery 步，噪声 burst）
// Boss 段：小调 + 更高 BPM + 更紧凑旋律（紧张感）。
const BGM_THEMES = {
  stage: {
    bpm: 116,
    bassType: 'sine', leadType: 'triangle', arpType: 'triangle',
    bass: [55, 55, 65.41, 55, 49, 49, 65.41, 61.74],
    lead: [220, 261.63, 329.63, 392, 329.63, 261.63, 220, 0],
    arp: [440, 523.25, 659.25, 783.99, 659.25, 523.25, 440, 349.23],
    bassVol: 0.15, leadVol: 0.05, arpVol: 0.045, drumsVol: 0.05,
    kickEvery: 4, hatEvery: 2,
  },
  boss: {
    bpm: 138,
    bassType: 'sine', leadType: 'triangle', arpType: 'sawtooth',
    bass: [65.41, 65.41, 61.74, 61.74, 73.42, 73.42, 65.41, 69.3],
    lead: [233.08, 311.13, 349.23, 466.16, 349.23, 311.13, 233.08, 207.65],
    arp: [466.16, 622.25, 698.46, 932.33, 698.46, 622.25, 466.16, 415.3],
    bassVol: 0.16, leadVol: 0.055, arpVol: 0.045, drumsVol: 0.055,
    kickEvery: 2, hatEvery: 2,
  },
};

class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;   // P0-1 主输出链动态压缩节点
    this.compGain = null;     // P0-1 压缩后 makeup 增益（+2dB 补偿）
    this.sfxGain = null;
    this.bgmGain = null;
    this.enabled = true;
    this._last = {};        // 各音效最小间隔节流
    this._pitchStep = {};   // P1-4 音高循环：各射击音效的轮换步进
    this._bgmTimer = null;
    this._bgmBass = null;
    this._bgmStep = 0;
    this._bgmMode = 'stage';
    this._bgmBpm = 0;
    this._bgmTracks = [];
    this._bgmNextTime = 0;
    this._bgmLookahead = 0;
    this._bgmCfg = null;
    this._bgmBaseVol = null;  // BGM 基准音量（_ensure/setVolume 维护，避让 duck 用）
    this._bgmDuckUntil = 0;
    this._bound = false;
    this._handlers = [];
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    const saved = SaveManager.get('audio') || {};
    const a = { ...AUDIO, ...saved };
    this.master = this.ctx.createGain();
    this.master.gain.value = a.master;
    // P0-1 全链路动态压缩：master → compressor → compGain(makeup) → destination。
    // 收敛多路音效叠加时的峰值，makeupGain 补偿响度；参数集中在顶部 COMPRESSOR 常量。
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = COMPRESSOR.threshold;
    this.compressor.knee.value = COMPRESSOR.knee;
    this.compressor.ratio.value = COMPRESSOR.ratio;
    this.compressor.attack.value = COMPRESSOR.attack;
    this.compressor.release.value = COMPRESSOR.release;
    this.compGain = this.ctx.createGain();
    this.compGain.gain.value = COMPRESSOR.makeupGain;
    this.master.connect(this.compressor);
    this.compressor.connect(this.compGain);
    this.compGain.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = a.sfx;
    this.sfxGain.connect(this.master);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = a.bgm;
    this._bgmBaseVol = a.bgm;   // P1 表现工程·BGM 避让基准音量
    this.bgmGain.connect(this.master);
  }

  /** 必须在用户手势后调用，解除浏览器 autoplay 限制 */
  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * 音频管线预热：静默(增益0)编译 oscillator + noise 缓冲两条音频节点路径，
   * 消除"首击卡顿"中音频节点首次编译的尖峰。仅当 ctx.state==='running' 且 enabled 时执行；
   * 否则（未 resume / 被禁用）直接跳过，零副作用。
   */
  warmup() {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    // 静默振荡器路径
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    g.gain.value = 0;
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, t);
    osc.connect(g);
    g.connect(this.sfxGain || this.master);
    osc.start(t);
    osc.stop(t + 0.015);
    // 静默噪声缓冲路径（lowpass 滤波）
    const len = Math.floor(this.ctx.sampleRate * 0.015);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0;
    src.connect(lp);
    lp.connect(g2);
    g2.connect(this.sfxGain || this.master);
    src.start(t);
    src.stop(t + 0.015);
  }

  _throttle(name, gap = 50) {
    const now = performance.now();
    if (this._last[name] && now - this._last[name] < gap) return false;
    this._last[name] = now;
    return true;
  }

  _tone(freq, type, dur, vol, slideTo, randomize = true, pan = 0) {
    this._toneAt(freq, type, dur, vol, slideTo, 0, randomize, pan);
  }

  /** 与 _tone 同构，但可在 offset(秒) 后起播（P1-6 心搏双搏用）。pan 默认 0 不建 Panner，BGM 零影响 */
  _toneAt(freq, type, dur, vol, slideTo, offset = 0, randomize = true, pan = 0) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (offset || 0);
    // 全局音高随机化 ±7%：规避机械重复疲劳感（业界 juice 惯例）；BGM 传 false 保持音准
    const f = randomize ? freq * (1 + (Math.random() * 2 - 1) * 0.07) : freq;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, randomize ? slideTo * (1 + (Math.random() * 2 - 1) * 0.07) : slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    // P1-5 立体声声像：pan!=0 且支持 StereoPanner 时插入；否则直连（零行为变化）
    const panNode = this._panNode(pan);
    if (panNode) {
      g.connect(panNode);
      panNode.connect(this.sfxGain);
    } else {
      g.connect(this.sfxGain);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noiseBurst(dur, vol, cutoff, filterType = 'lowpass', pan = 0) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = filterType || 'lowpass';
    lp.frequency.value = cutoff || 1200;
    if (lp.type === 'bandpass') lp.Q.value = 1.5;   // P0-3 双音层噪声：bandpass Q≈1.5
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    // P1-5 立体声声像：pan!=0 且支持 StereoPanner 时插入；否则直连（默认值=现状，零破坏）
    const panNode = this._panNode(pan);
    if (panNode) {
      g.connect(panNode);
      panNode.connect(this.sfxGain);
    } else {
      g.connect(this.sfxGain);
    }
    src.start(t);
    src.stop(t + dur);
  }

  /** P1-5 立体声像节点：StereoPanner 不可用时返回 null（调用方降级直连） */
  _panNode(value) {
    if (!this.ctx || typeof this.ctx.createStereoPanner !== 'function') return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, value || 0));
    return p;
  }

  /** P1-5 简易混响尾：单样本脉冲 → 反馈延迟环，wet 随时间淡出形成"回声尾" */
  _echoTail(dur, vol, interval = 0.09, feedback = 0.3) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = interval;
    const fb = this.ctx.createGain();
    fb.gain.value = feedback;
    const wet = this.ctx.createGain();
    wet.gain.setValueAtTime(vol, t);
    wet.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const src = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    buf.getChannelData(0)[0] = 1;
    src.buffer = buf;
    src.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.sfxGain);
    src.start(t);
    src.stop(t + 0.02);
  }

  /** P1-4 射击音高循环：按 key 在 semis 半音表内轮换，规避机械重复感 */
  _pitchCycle(key, base, semis = [0, -2, 2]) {
    const arr = (semis && semis.length) ? semis : [0, -2, 2];
    const idx = (this._pitchStep[key] = ((this._pitchStep[key] || -1) + 1) % arr.length);
    return base * Math.pow(2, arr[idx] / 12);
  }

  /** P0-3 命中双音层：金属层(square 高音随机) + 噪声层(白噪声 bandpass) */
  _dualHit(metalFreq, metalDur, noiseVol, noiseFilter = 'bandpass') {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    // 金属层：square 短促，vol 0.22~0.32，音高随机 ±7%（_tone 内部处理）
    this._tone(metalFreq, 'square', metalDur, 0.22 + Math.random() * 0.10, metalFreq * 0.55);
    // 噪声层：白噪声 0.025~0.05s，bandpass（Q≈1.5 中心 ~2500Hz）
    this._noiseBurst(0.025 + Math.random() * 0.025, noiseVol, 2500, noiseFilter);
  }

  /** P0-2 爆炸三阶段分级：①瞬态爆裂 ②低频轰鸣(+sub) ③回声尾音；外加 P1-5 混响尾 */
  _explosion(tier) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    this._duckBgm(); // P1 表现工程·音效密集时 BGM 轻微避让
    const t = EXPLOSION_TIERS[tier] || EXPLOSION_TIERS.small;
    // 每次爆炸轻微随机声像偏置（P1-5 立体声宽度）
    const pan = (Math.random() * 2 - 1) * 0.12;
    // ① 瞬态爆裂：highpass 噪声，vol 0.5~0.6 快衰减
    this._noiseBurst(t.burstDur, 0.55, t.burstCut, 'highpass');
    // ② 低频轰鸣：40-60Hz sine 指数衰减，freq 滑落 ~0.6x；mid/boss 追加 25-30Hz sub 正弦
    this._tone(t.bodyFreq, 'sine', t.bodyDur, t.bodyVol, t.bodyFreq * 0.6, true, pan);
    if (t.subFreq) this._tone(t.subFreq, 'sine', t.bodyDur, t.bodyVol * 0.7, t.subFreq * 0.7, true, -pan);
    // ③ 回声尾音：比 body 高 ~2x 的 sine（76-92Hz）低音量
    this._tone(t.tailFreq, 'sine', t.tailDur, t.tailVol, t.tailFreq * 0.85, true, pan * 0.6);
    // P1-5 简易混响尾：爆炸这类大事件追加反馈延迟尾
    this._echoTail(Math.min(0.5, t.bodyDur + t.tailDur), 0.10, 0.09, 0.3);
  }

  /** 播放一个音效。arg 为可选参数（如 comboUp 传入连击数 n，随 n 音高爬升） */
  sfx(name, arg) {
    if (!this.enabled) return;
    switch (name) {
      case 'shoot':
        // 旧键保留（历史兼容）：Player.fire 已分流到 shootPulse / shootLaser
        if (!this._throttle('shoot', 55)) return;
        this._tone(880, 'square', 0.06, 0.10, 440);
        break;
      case 'shootPulse':
        // P1-4 主炮：square 880 系 + 音高循环，清脆不拖泥带水（不加混响尾）
        if (!this._throttle('shoot', 55)) return;
        this._tone(this._pitchCycle('shootPulse', 880), 'square', 0.06, 0.10, 0, false);
        break;
      case 'shootLaser':
        // P1-4 激光：sawtooth 240→480 扫掠（持续光束的"充能"质感），节流 80ms
        if (!this._throttle('shootLaser', 80)) return;
        this._tone(240, 'sawtooth', 0.12, 0.10, 480, false);
        break;
      case 'shootWingman':
        // P1-4 僚机：triangle 620 系低音量，节流 60ms（多僚机齐射不噪）
        if (!this._throttle('shootWingman', 60)) return;
        this._tone(this._pitchCycle('shootWingman', 620), 'triangle', 0.07, 0.06, 0, false);
        break;
      case 'explosion':
        // PLAYER_DIED 保留原爆炸（命数复活即播，三阶段留给敌机/Boss 分级）
        if (!this._throttle('explosion', 40)) return;
        this._noiseBurst(0.25, 0.45, 900);
        this._tone(120, 'sine', 0.25, 0.28, 50);
        break;
      case 'explosionSmall':
        if (!this._throttle('explosion', 40)) return;
        this._explosion('small');
        break;
      case 'explosionMid':
        if (!this._throttle('explosion', 60)) return;
        this._explosion('mid');
        break;
      case 'explosionBoss':
        if (!this._throttle('explosion', 100)) return;
        this._explosion('boss');
        break;
      case 'hit':
        if (!this._throttle('hit', 80)) return;
        this._tone(160, 'sawtooth', 0.18, 0.32, 60);
        break;
      case 'enemyHit': {
        // P0-3 升级双音层：金属层 + 噪声层（噪声层 vol 0.05→0.10~0.14，bandpass Q≈1.5）
        // 35ms 节流，避免高射速下成片命中变成嘈杂噪声
        if (!this._throttle('enemyHit', 35)) return;
        const base = 1300 + Math.random() * 500;   // 1300~1800Hz 金属层
        this._dualHit(base, 0.035, 0.10 + Math.random() * 0.04, 'bandpass');
        break;
      }
      case 'bossHit':
        // P0-3 Boss 命中：金属层更低（700-1400Hz）更厚重，噪声层略强；P1-5 加混响尾
        if (!this._throttle('bossHit', 60)) return;
        this._duckBgm();
        this._dualHit(700 + Math.random() * 700, 0.05, 0.14, 'bandpass');
        this._echoTail(0.25, 0.07, 0.08, 0.3);
        break;
      case 'heartbeat':
        // P1-6 濒死心搏：双低频 thump（60Hz + 50Hz，间隔 0.12s），900ms 节流
        if (!this._throttle('heartbeat', 900)) return;
        this._toneAt(60, 'sine', 0.09, 0.20, 40, 0, false);
        this._toneAt(50, 'sine', 0.07, 0.20, 34, 0.12, false);
        break;
      case 'pickup':
        this._tone(660, 'triangle', 0.08, 0.18, 990);
        break;
      case 'powerup':
        this._tone(523, 'triangle', 0.10, 0.20, 784);
        this._tone(784, 'triangle', 0.12, 0.18, 1046);
        break;
      case 'bomb':
        this._duckBgm();
        this._noiseBurst(0.5, 0.55, 600);
        this._tone(80, 'sine', 0.5, 0.35, 30);
        this._echoTail(0.7, 0.12, 0.10, 0.35);      // P1-5 混响尾
        break;
      case 'super':
        this._duckBgm();
        this._tone(330, 'sawtooth', 0.5, 0.28, 1320);
        this._noiseBurst(0.4, 0.35, 2000);
        this._echoTail(0.6, 0.10, 0.09, 0.3);       // P1-5 混响尾
        break;
      case 'ui':
        this._tone(520, 'square', 0.05, 0.16, 700);
        break;
      case 'bosswarn':
        this._duckBgm();
        this._tone(440, 'sawtooth', 0.3, 0.28, 220);
        this._tone(220, 'sawtooth', 0.4, 0.28, 110);
        break;
      case 'comboUp': {
        // P2 体验细节·连击反馈：音高随连击数爬升（base 440 × 2^(n/12)，封顶 12 半音）
        // ≥150ms 节流防吵；高频段叠一层轻泛音增加"上扬"感
        if (!this._throttle('comboUp', 150)) return;
        const n = Math.min(Math.max(Number(arg) || 1, 1), 12);
        const f = 440 * Math.pow(2, n / 12);
        this._tone(f, 'triangle', 0.09, 0.16, f * 1.4, false);
        this._tone(f * 2, 'sine', 0.07, 0.05, f * 2.4, false);
        break;
      }
      case 'voicePickup': {
        // P2 合成音素语音·拾取："嘟-叮"（低→高双音，人声感 sine + 轻泛音，零外部资源）
        if (!this._throttle('voicePickup', 120)) return;
        this._toneAt(196, 'sine', 0.09, 0.10, 156, 0, false);
        this._toneAt(392, 'sine', 0.13, 0.10, 523, 0.09, false);
        break;
      }
      case 'voiceCombo': {
        // P2 合成音素语音·连击："啊-↑"（上扬滑音，≥200ms 节流防吵）
        if (!this._throttle('voiceCombo', 200)) return;
        this._toneAt(294, 'triangle', 0.11, 0.10, 440, 0, false);
        this._toneAt(440, 'triangle', 0.14, 0.10, 660, 0.09, false);
        break;
      }
      case 'voiceBoss': {
        // P2 合成音素语音·Boss 警戒："呜-呜"（两次下行低鸣，节流 800ms）
        if (!this._throttle('voiceBoss', 800)) return;
        this._toneAt(196, 'sawtooth', 0.28, 0.09, 147, 0, false);
        this._toneAt(175, 'sawtooth', 0.30, 0.09, 131, 0.26, false);
        break;
      }
      default:
        break;
    }
  }

  /** 监听 EventBus 关键事件自动播放（GameScene.create 调一次，幂等） */
  bindGameEvents() {
    if (this._bound) return;
    this._bound = true;
    const add = (evt, fn) => {
      EventBus.on(evt, fn);
      this._handlers.push([evt, fn]);
    };
    add(EVENTS.PLAYER_HIT, () => this.sfx('hit'));
    add(EVENTS.COIN_COLLECTED, () => this.sfx('pickup'));
    add(EVENTS.POWERUP_COLLECTED, () => this.sfx('powerup'));
    // P2 合成音素语音·拾取：在既有 powerup 之上叠一层"嘟-叮"人声感音素
    add(EVENTS.POWERUP_COLLECTED, () => this.sfx('voicePickup'));
    add(EVENTS.USE_BOMB, () => this.sfx('bomb'));
    add(EVENTS.USE_SUPER, () => this.sfx('super'));
    add(EVENTS.BOSS_SPAWNED, () => this.sfx('bosswarn'));
    // P2 合成音素语音·Boss 警戒："呜-呜"（叠在 bosswarn 之上）
    add(EVENTS.BOSS_SPAWNED, () => this.sfx('voiceBoss'));
    add(EVENTS.BOSS_SPAWNED, () => this.startBgm('boss'));   // P1-9 Boss 动态音乐：进 Boss 切激烈段
    add(EVENTS.BOSS_DEFEATED, () => this.startBgm('stage')); // 退 Boss 切回普通段
    add(EVENTS.PLAYER_DIED, () => this.sfx('explosion'));
    // P2 体验细节·连击反馈：音高随连击数爬升（comboUp），每 5 连追加上扬语音（voiceCombo）
    add(EVENTS.COMBO_CHANGED, (combo) => {
      if (combo > 0) {
        this.sfx('comboUp', combo);
        if (combo % 5 === 0) this.sfx('voiceCombo');
      }
    });
    // P1-6 濒死心搏：hp>0 且 ≤30% 时低频双搏（900ms 节流在 sfx 内，GameScene 零改动）
    add(EVENTS.HP_CHANGED, (hp, maxHp) => {
      if (hp > 0 && maxHp > 0 && hp / maxHp <= 0.30) this.sfx('heartbeat');
    });
  }

  unbindGameEvents() {
    for (const [evt, fn] of this._handlers) EventBus.off(evt, fn);
    this._handlers = [];
    this._bound = false;
  }

  /**
   * BGM 4 轨 sequencer（P1 表现工程）：bass / lead / arp / drums 四轨，
   * lookahead 调度（ctx.currentTime + 定时器排队，BPM 可配）。
   * mode('stage'|'boss') 切换：Boss 段小调 + 加速；幂等（重复调用安全）。
   * 全部程序合成（零外部音频），复用 tone/noise 合成原语，BGM 全部走 bgmGain。
   */
  startBgm(mode = 'stage', opts = {}) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    // 已是同一模式且正在跑：幂等返回（避免 Boss 事件重复触发时反复重启）
    if (this._bgmTimer && this._bgmMode === mode) return;
    // 切换模式：先停旧 loop（保留 this._bgmMode 用于 resumeBgm 恢复）
    this.stopBgm();
    this._bgmMode = mode;
    const cfg = BGM_THEMES[mode] || BGM_THEMES.stage;
    const bpm = Math.max(60, Math.min(200, Number(opts.bpm) || cfg.bpm || 120));
    this._bgmCfg = cfg;
    this._bgmBpm = bpm;
    this._bgmStep = 0;
    this._bgmNextTime = this.ctx.currentTime + 0.06;
    this._bgmLookahead = 0.14;
    this._bgmTracks = ['bass', 'lead', 'arp', 'drums'];
    this._bgmTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      this._scheduleBgm();
    }, 30);
  }

  /** lookahead 调度：把未来 LOOKAHEAD 内的音符全部排进音频时间线 */
  _scheduleBgm() {
    const ctx = this.ctx, cfg = this._bgmCfg;
    if (!ctx || !cfg) return;
    const spb = 60 / this._bgmBpm;        // 秒/拍
    const stepDur = spb / 2;              // 8 分音符步长
    const vol = {
      bass: cfg.bassVol || 0.15,
      lead: cfg.leadVol || 0.05,
      arp: cfg.arpVol || 0.045,
      drums: cfg.drumsVol || 0.05,
    };
    while (this._bgmNextTime < ctx.currentTime + this._bgmLookahead) {
      const s = this._bgmStep % 8;
      const when = this._bgmNextTime;
      // bass：低频铺底（长时值 + 轻微下滑）
      const bf = cfg.bass && cfg.bass[s];
      if (bf) this._bgmTone(bf, cfg.bassType || 'sine', stepDur * 0.95, vol.bass, when, bf * 0.97);
      // lead：主旋律（0 = 休止）
      const lf = cfg.lead && cfg.lead[s];
      if (lf) this._bgmTone(lf, cfg.leadType || 'triangle', stepDur * 0.8, vol.lead, when, 0);
      // arp：琶音（当前 scale 快速轮转）
      const af = cfg.arp && cfg.arp[s];
      if (af) this._bgmTone(af, cfg.arpType || 'triangle', stepDur * 0.55, vol.arp, when, 0);
      // drums：kick + hihat（噪声 burst 模拟）
      if (s % (cfg.kickEvery || 4) === 0) this._bgmKick(when, vol.drums);
      if (s % (cfg.hatEvery || 2) === 0) this._bgmHat(when, vol.drums);
      this._bgmStep++;
      this._bgmNextTime += stepDur;
    }
  }

  /** BGM 专用音：路由到 bgmGain（与音效 sfxGain 分离，音乐音量独立生效） */
  _bgmTone(freq, type, dur, vol, when, slideTo) {
    if (!this.ctx || !this.bgmGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, when);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  /** BGM kick：低频正弦 thump（160→45Hz 快速下滑） */
  _bgmKick(when, vol) {
    if (!this.ctx || !this.bgmGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.09);
    g.gain.setValueAtTime((vol || 0.05) * 0.9, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(when);
    osc.stop(when + 0.12);
  }

  /** BGM hihat：短噪声 burst（highpass 7000Hz 模拟踩镲） */
  _bgmHat(when, vol) {
    if (!this.ctx || !this.bgmGain) return;
    const dur = 0.035;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime((vol || 0.05) * 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.bgmGain);
    src.start(when);
    src.stop(when + dur);
  }

  /** 音效密集时 BGM 轻微避让（bgmGain 微降到 0.85×基准，250ms 内平滑恢复） */
  _duckBgm() {
    if (!this.ctx || !this.bgmGain) return;
    const now = this.ctx.currentTime;
    if (this._bgmDuckUntil && now < this._bgmDuckUntil) return; // 避让冷却
    const base = (this._bgmBaseVol != null) ? this._bgmBaseVol : ((AUDIO && AUDIO.bgm) || 0.16);
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setTargetAtTime(base * 0.85, now, 0.02);
    this._bgmDuckUntil = now + 0.18;
    this.bgmGain.gain.setTargetAtTime(base, now + 0.25, 0.05);
  }

  stopBgm() {
    if (this._bgmTimer) { clearInterval(this._bgmTimer); this._bgmTimer = null; }
    if (this._bgmBass) { try { this._bgmBass.stop(); } catch (e) { /* 已停 */ } this._bgmBass = null; }
    this._bgmTracks = [];
  }

  /** 测试钩子：BGM 状态快照（QA 断言 4 轨 sequencer 用） */
  getBgmState() {
    return {
      running: !!this._bgmTimer,
      mode: this._bgmMode || 'stage',
      bpm: this._bgmBpm || 0,
      tracks: this._bgmTracks ? this._bgmTracks.slice() : [],
      step: this._bgmStep || 0,
    };
  }

  /** 设置某类音量（master/sfx/bgm），0~1。persist=true 时写入存档 */
  setVolume(type, v, persist = true) {
    this._ensure();
    v = Math.max(0, Math.min(1, v));
    if (type === 'master' && this.master) this.master.gain.value = v;
    else if (type === 'sfx' && this.sfxGain) this.sfxGain.gain.value = v;
    else if (type === 'bgm' && this.bgmGain) { this.bgmGain.gain.value = v; this._bgmBaseVol = v; }
    if (persist) {
      const saved = SaveManager.get('audio') || {};
      saved[type] = v;
      SaveManager.set('audio', saved);
    }
  }

  /** 读取某类当前音量（0~1） */
  getVolume(type) {
    if (type === 'master' && this.master) return this.master.gain.value;
    if (type === 'sfx' && this.sfxGain) return this.sfxGain.gain.value;
    if (type === 'bgm' && this.bgmGain) return this.bgmGain.gain.value;
    return (AUDIO && AUDIO[type]) || 0.5;
  }

  /** 暂停 / 恢复 BGM（暂停游戏或切后台时使用） */
  pauseBgm() {
    if (this._bgmTimer) { clearInterval(this._bgmTimer); this._bgmTimer = null; }
    if (this._bgmBass) { try { this._bgmBass.stop(); } catch (e) { /* 已停 */ } this._bgmBass = null; }
  }

  resumeBgm() { this.startBgm(this._bgmMode || 'stage'); }
}

export const audio = new AudioSystem();

// 暴露给自动化真测（与 window.__ACH__ 同性质，仅调试用）
if (typeof window !== 'undefined') window.__AUDIO = audio;
