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
class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.bgmGain = null;
    this.enabled = true;
    this._last = {};        // 各音效最小间隔节流
    this._bgmTimer = null;
    this._bgmBass = null;
    this._bgmStep = 0;
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
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = a.sfx;
    this.sfxGain.connect(this.master);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = a.bgm;
    this.bgmGain.connect(this.master);
  }

  /** 必须在用户手势后调用，解除浏览器 autoplay 限制 */
  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _throttle(name, gap = 50) {
    const now = performance.now();
    if (this._last[name] && now - this._last[name] < gap) return false;
    this._last[name] = now;
    return true;
  }

  _tone(freq, type, dur, vol, slideTo) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noiseBurst(dur, vol, cutoff) {
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
    lp.type = 'lowpass';
    lp.frequency.value = cutoff || 1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
  }

  /** 播放一个音效 */
  sfx(name) {
    if (!this.enabled) return;
    switch (name) {
      case 'shoot':
        if (!this._throttle('shoot', 55)) return;
        this._tone(880, 'square', 0.06, 0.10, 440);
        break;
      case 'explosion':
        if (!this._throttle('explosion', 40)) return;
        this._noiseBurst(0.25, 0.45, 900);
        this._tone(120, 'sine', 0.25, 0.28, 50);
        break;
      case 'hit':
        if (!this._throttle('hit', 80)) return;
        this._tone(160, 'sawtooth', 0.18, 0.32, 60);
        break;
      case 'enemyHit': {
        // 打中敌人的轻脆反馈：高频短促 + 音高随机化（业界：避免机械重复疲劳感）
        // 35ms 节流，避免高射速下成片命中变成嘈杂噪声
        if (!this._throttle('enemyHit', 35)) return;
        const base = 1300 + Math.random() * 500;   // 1300~1800Hz
        this._tone(base, 'square', 0.035, 0.07, base * 0.55);
        this._noiseBurst(0.03, 0.05, 3200);         // 轻微金属/冲击质感，与音调分层
        break;
      }
      case 'pickup':
        this._tone(660, 'triangle', 0.08, 0.18, 990);
        break;
      case 'powerup':
        this._tone(523, 'triangle', 0.10, 0.20, 784);
        this._tone(784, 'triangle', 0.12, 0.18, 1046);
        break;
      case 'bomb':
        this._noiseBurst(0.5, 0.55, 600);
        this._tone(80, 'sine', 0.5, 0.35, 30);
        break;
      case 'super':
        this._tone(330, 'sawtooth', 0.5, 0.28, 1320);
        this._noiseBurst(0.4, 0.35, 2000);
        break;
      case 'ui':
        this._tone(520, 'square', 0.05, 0.16, 700);
        break;
      case 'bosswarn':
        this._tone(440, 'sawtooth', 0.3, 0.28, 220);
        this._tone(220, 'sawtooth', 0.4, 0.28, 110);
        break;
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
    add(EVENTS.USE_BOMB, () => this.sfx('bomb'));
    add(EVENTS.USE_SUPER, () => this.sfx('super'));
    add(EVENTS.BOSS_SPAWNED, () => this.sfx('bosswarn'));
    add(EVENTS.PLAYER_DIED, () => this.sfx('explosion'));
  }

  unbindGameEvents() {
    for (const [evt, fn] of this._handlers) EventBus.off(evt, fn);
    this._handlers = [];
    this._bound = false;
  }

  /** 循环 BGM：低音 pad + 轻量琶音（幂等，重复调用安全） */
  startBgm() {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx || this._bgmTimer) return;
    const bg = (AUDIO && AUDIO.bgm) || 0.16;
    const bass = this.ctx.createOscillator();
    const bgGain = this.ctx.createGain();
    bass.type = 'sine';
    bass.frequency.value = 55;
    bgGain.gain.value = bg;
    bass.connect(bgGain);
    bgGain.connect(this.bgmGain);
    bass.start();
    this._bgmBass = bass;
    const scale = [220, 277, 330, 440, 330, 277, 220, 165];
    this._bgmTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const f = scale[this._bgmStep % scale.length];
      this._bgmStep++;
      this._tone(f, 'triangle', 0.3, 0.05, 0);
    }, 320);
  }

  stopBgm() {
    if (this._bgmTimer) { clearInterval(this._bgmTimer); this._bgmTimer = null; }
    if (this._bgmBass) { try { this._bgmBass.stop(); } catch (e) { /* 已停 */ } this._bgmBass = null; }
  }

  /** 设置某类音量（master/sfx/bgm），0~1。persist=true 时写入存档 */
  setVolume(type, v, persist = true) {
    this._ensure();
    v = Math.max(0, Math.min(1, v));
    if (type === 'master' && this.master) this.master.gain.value = v;
    else if (type === 'sfx' && this.sfxGain) this.sfxGain.gain.value = v;
    else if (type === 'bgm' && this.bgmGain) this.bgmGain.gain.value = v;
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

  resumeBgm() { this.startBgm(); }
}

export const audio = new AudioSystem();
