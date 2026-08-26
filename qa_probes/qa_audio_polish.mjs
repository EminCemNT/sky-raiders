// qa_audio_polish.mjs —— 音效质感打磨（P0-1/P0-2/P0-3/P1-4/P1-5/P1-6）真测
//
// 说明：Vite dev 会给入口/依赖加 ?t= 时间戳，页面内动态 import('/src/systems/AudioSystem.js')
// 会得到与游戏不同的模块实例。因此运行时断言全部走「WebAudio 原型级 spy」（同 qa_enemy_hit_sfx）：
//   - addInitScript 包装 createOscillator / createDynamicsCompressor / createGain /
//     createStereoPanner / createDelay / createBiquadFilter，记录游戏真实音频节点。
//   - 通过真实事件/调用触发各音效，按振荡器频率/波形、滤波类型、延迟节点验证"确实出声"。
//
// 断言：
//   1) P0-1 compressor 已接入主输出链（运行时节点存在 + 参数 + makeupGain 1.25 + 源码链）
//   2) P0-2 EXPLOSION_TIERS 三档参数（small/mid/boss）
//   3) 8 个新 key 注册（源码级 case） + 运行时真实触发零异常并产出预期节点
//   4) Enemy.die 爆炸分级调用（源码）
//   5) Boss.hit 有 bossHit 调用 / Boss.die 同帧 explosionBoss（源码 + 运行时）
//   6) Player 射击分流（源码 + 运行时：pulse→square~880 / laser→sawtooth240）
//   7) Wingman._fire 有 shootWingman（源码 + 运行时：triangle~620）
//   8) P1-6 HP_CHANGED ≤30% 触发 heartbeat（sine 60+50），>30% / hp=0 不触发
//   9) P1-5 立体声/混响尾真实产出 StereoPanner + Delay 节点
//  10) 零 pageerror / console.error（Playwright 进 GameScene）
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

// 页面加载前注入 WebAudio 原型 spy（记录游戏真实创建的音频节点）
await page.addInitScript(() => {
  window.__AUDIO_OBS = { osc: [], comp: [], gain: [], panner: [], delay: [], filter: [] };
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const OrigOsc = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      const osc = OrigOsc.call(this);
      const rec = { node: osc, type: osc.type, freqs: [] };
      const of = osc.frequency;
      const set = of.setValueAtTime.bind(of);
      of.setValueAtTime = (v, t) => { rec.freqs.push(v); return set(v, t); };
      window.__AUDIO_OBS.osc.push(rec);
      return osc;
    };
    const OrigComp = AC.prototype.createDynamicsCompressor;
    AC.prototype.createDynamicsCompressor = function () {
      const c = OrigComp.call(this);
      window.__AUDIO_OBS.comp.push(c);
      return c;
    };
    const OrigGain = AC.prototype.createGain;
    AC.prototype.createGain = function () {
      const g = OrigGain.call(this);
      window.__AUDIO_OBS.gain.push(g);
      return g;
    };
    if (typeof AC.prototype.createStereoPanner === 'function') {
      const OrigP = AC.prototype.createStereoPanner;
      AC.prototype.createStereoPanner = function () {
        const p = OrigP.call(this);
        window.__AUDIO_OBS.panner.push(p);
        return p;
      };
    }
    if (typeof AC.prototype.createDelay === 'function') {
      const OrigD = AC.prototype.createDelay;
      AC.prototype.createDelay = function (max) {
        const d = OrigD.call(this, max);
        window.__AUDIO_OBS.delay.push(d);
        return d;
      };
    }
    const OrigF = AC.prototype.createBiquadFilter;
    AC.prototype.createBiquadFilter = function () {
      const f = OrigF.call(this);
      window.__AUDIO_OBS.filter.push({ node: f, type: f.type });
      return f;
    };
  } catch (e) { /* AudioContext 不可用则跳过 */ }
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// 注入快照/复位助手
await page.evaluate(() => {
  window.__AUDIO_SNAP = () => ({
    osc: window.__AUDIO_OBS.osc.map((r) => ({ type: r.node.type, freqs: r.freqs.slice() })),
    // 注意：filter 的 type 是创建后由调用方赋值（默认 lowpass），必须读 node 的实时 type
    filter: window.__AUDIO_OBS.filter.map((f) => ({ type: f.node.type, freq: f.node.frequency.value, Q: f.node.Q ? f.node.Q.value : null })),
    delay: window.__AUDIO_OBS.delay.length,
    panner: window.__AUDIO_OBS.panner.length,
  });
  window.__AUDIO_RESET = () => {
    window.__AUDIO_OBS.osc.length = 0;
    window.__AUDIO_OBS.filter.length = 0;
    window.__AUDIO_OBS.delay.length = 0;
    window.__AUDIO_OBS.panner.length = 0;
  };
});

// ── 进入 GameScene（复用既有标准姿势）──
await page.evaluate(() => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('tutorialDone', true);
  SM.set('selectedDifficulty', 'standard');
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });

// ── 1) P0-1 compressor 接入主输出链（运行时节点 + 参数 + makeup + 源码链）──
const compRt = await page.evaluate(() => {
  const cs = window.__AUDIO_OBS.comp;
  const c = cs[0];
  return {
    count: cs.length,
    isDyn: !!c && c.constructor && c.constructor.name === 'DynamicsCompressorNode',
    threshold: c ? c.threshold.value : null,
    knee: c ? c.knee.value : null,
    ratio: c ? c.ratio.value : null,
    attack: c ? c.attack.value : null,
    release: c ? c.release.value : null,
    hasMakeup: window.__AUDIO_OBS.gain.some((g) => g.gain && Math.abs(g.gain.value - 1.25) < 1e-6),
  };
});
const audioSrc = fs.readFileSync(path.join(ROOT, 'src/systems/AudioSystem.js'), 'utf8');
const chainOk = /this\.master\.connect\(this\.compressor\)/.test(audioSrc)
  && /this\.compressor\.connect\(this\.compGain\)/.test(audioSrc)
  && /this\.compGain\.connect\(this\.ctx\.destination\)/.test(audioSrc);
push('P0-1 compressor 接入主输出链（源码 master→compressor→compGain→destination）', chainOk, '');
push('P0-1 运行时创建了 DynamicsCompressorNode', compRt.isDyn === true, `count=${compRt.count}`);
push('P0-1 压缩参数 threshold=-18 / knee=20 / ratio=6 / attack=0.003 / release=0.25',
  compRt.threshold === -18 && compRt.knee === 20 && compRt.ratio === 6
  && Math.abs(compRt.attack - 0.003) < 1e-6 && compRt.release === 0.25,
  `thr=${compRt.threshold} knee=${compRt.knee} ratio=${compRt.ratio} atk=${compRt.attack} rel=${compRt.release}`);
push('P0-1 makeupGain 1.25（≈+2dB 补偿）', compRt.hasMakeup === true, `hasMakeup=${compRt.hasMakeup}`);

// ── 2) P0-2 EXPLOSION_TIERS 三档参数（模块常量，纯数据不受实例影响）──
const tiers = await page.evaluate(async () => {
  const mod = await import('/src/systems/AudioSystem.js');
  return mod.EXPLOSION_TIERS;
});
const tEq = (t, e) => t && t.burstDur === e.burstDur && t.burstCut === e.burstCut
  && t.bodyFreq === e.bodyFreq && t.bodyDur === e.bodyDur && Math.abs(t.bodyVol - e.bodyVol) < 1e-6
  && t.subFreq === e.subFreq && t.tailFreq === e.tailFreq && t.tailDur === e.tailDur
  && Math.abs(t.tailVol - e.tailVol) < 1e-6;
push('P0-2 EXPLOSION_TIERS 导出三档', !!tiers && !!tiers.small && !!tiers.mid && !!tiers.boss,
  tiers ? Object.keys(tiers).join(',') : 'missing');
push('P0-2 small 档参数', tEq(tiers && tiers.small, { burstDur: 0.05, burstCut: 2400, bodyFreq: 50, bodyDur: 0.22, bodyVol: 0.30, subFreq: null, tailFreq: 92, tailDur: 0.16, tailVol: 0.10 }),
  tiers.small ? JSON.stringify(tiers.small) : 'missing');
push('P0-2 mid 档参数（含 subFreq=30）', tEq(tiers && tiers.mid, { burstDur: 0.07, burstCut: 1800, bodyFreq: 45, bodyDur: 0.30, bodyVol: 0.38, subFreq: 30, tailFreq: 84, tailDur: 0.22, tailVol: 0.14 }),
  tiers.mid ? JSON.stringify(tiers.mid) : 'missing');
push('P0-2 boss 档参数（含 subFreq=27）', tEq(tiers && tiers.boss, { burstDur: 0.11, burstCut: 1400, bodyFreq: 40, bodyDur: 0.50, bodyVol: 0.45, subFreq: 27, tailFreq: 76, tailDur: 0.34, tailVol: 0.18 }),
  tiers.boss ? JSON.stringify(tiers.boss) : 'missing');

// ── 3) 8 个新 key 注册（源码级 case）──
const keys = ['explosionSmall', 'explosionMid', 'explosionBoss', 'bossHit', 'shootPulse', 'shootLaser', 'shootWingman', 'heartbeat'];
for (const k of keys) {
  push(`新 key ${k} 在 sfx 注册`, new RegExp(`case '${k}'`).test(audioSrc), '');
}

// ── 4) Enemy.die 爆炸分级（源码级）──
const enemySrc = fs.readFileSync(path.join(ROOT, 'src/entities/Enemy.js'), 'utf8');
push('Enemy.die 爆炸分级（mid→explosionMid / 其余→explosionSmall）',
  /explosionMid/.test(enemySrc) && /explosionSmall/.test(enemySrc), '');

// ── 5) Boss.hit bossHit / Boss.die explosionBoss（源码级）──
const bossSrc = fs.readFileSync(path.join(ROOT, 'src/entities/Boss.js'), 'utf8');
push('Boss.hit 调用 audio.sfx(\'bossHit\')（非致死分支）', /audio\.sfx\('bossHit'\)/.test(bossSrc), '');
push('Boss.die 调用 audio.sfx(\'explosionBoss\')（BOSS_DEFEATED 同帧）', /audio\.sfx\('explosionBoss'\)/.test(bossSrc), '');

// ── 6) Player 射击分流（源码级）──
const playerSrc = fs.readFileSync(path.join(ROOT, 'src/entities/Player.js'), 'utf8');
push('Player 源码：主炮→shootPulse / laser→shootLaser',
  /shootPulse/.test(playerSrc) && /shootLaser/.test(playerSrc), '');

// ── 7) Wingman._fire 有 shootWingman（源码级）──
const wingSrc = fs.readFileSync(path.join(ROOT, 'src/entities/Wingman.js'), 'utf8');
push('Wingman._fire 调用 shootWingman', /shootWingman/.test(wingSrc), '');

// ── 运行时真实触发：逐个验证 8 个新 key 确实出声（osc/filter/delay 节点证据）──

const hasOsc = (snap, type, lo, hi) => snap.osc.some((o) => o.type === type && o.freqs.some((f) => f >= lo && f <= hi));
const hasFilter = (snap, type, freq, qLo, qHi) => snap.filter.some((f) => f.type === type && Math.abs(f.freq - freq) < 60 && f.Q >= (qLo || 0) && f.Q <= (qHi || 10));

// 6a) explosionSmall：小敌机 die() → sine~50 轰鸣 + sine~92 尾音 + highpass2400 爆裂 + 混响尾
const expSmall = await page.evaluate(() => {
  window.__AUDIO_RESET();
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(270, 80, 'small', 'straight');
  if (e) e.die();
  return window.__AUDIO_SNAP();
});
await page.waitForTimeout(120);
push('explosionSmall 运行时出声（sine50 轰鸣 + sine92 尾音 + highpass2400 爆裂 + 混响尾）',
  hasOsc(expSmall, 'sine', 46, 56) && hasOsc(expSmall, 'sine', 86, 100) && hasFilter(expSmall, 'highpass', 2400) && expSmall.delay >= 1,
  JSON.stringify({ osc: expSmall.osc.map((o) => ({ t: o.type, f: Math.round(o.freqs[0] || 0) })), delay: expSmall.delay }));

// 6b) explosionMid：中敌机 die() → sine45 + sub30 + tail84
const expMid = await page.evaluate(() => {
  window.__AUDIO_RESET();
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(200, 80, 'mid', 'straight');
  if (e) e.die();
  return window.__AUDIO_SNAP();
});
await page.waitForTimeout(120);
push('explosionMid 运行时出声（sine45 轰鸣 + sub30 + tail84 + 混响尾）',
  hasOsc(expMid, 'sine', 41, 51) && hasOsc(expMid, 'sine', 27, 34) && hasOsc(expMid, 'sine', 78, 92) && expMid.delay >= 1,
  JSON.stringify({ osc: expMid.osc.map((o) => ({ t: o.type, f: Math.round(o.freqs[0] || 0) })), delay: expMid.delay }));

// 6c) explosionBoss：Boss.die() → sine40 + sub27 + tail76 + 混响尾（先清掉 spawnBoss 的 BOSS_SPAWNED 音）
const expBoss = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.spawnBoss('boss_sentinel');
  window.__AUDIO_RESET();
  const boss = gs.boss;
  if (boss) boss.die();
  return window.__AUDIO_SNAP();
});
await page.waitForTimeout(120);
push('explosionBoss 运行时出声（sine40 轰鸣 + sub27 + tail76 + 混响尾）',
  hasOsc(expBoss, 'sine', 36, 46) && hasOsc(expBoss, 'sine', 24, 31) && hasOsc(expBoss, 'sine', 71, 83) && expBoss.delay >= 1,
  JSON.stringify({ osc: expBoss.osc.map((o) => ({ t: o.type, f: Math.round(o.freqs[0] || 0) })), delay: expBoss.delay }));

// 6d) bossHit：Boss.hit 非致死 → square 700-1400 金属层 + bandpass2500 Q≈1.5 噪声层 + 混响尾
const bossHitSnap = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.spawnBoss('boss_sentinel');
  window.__AUDIO_RESET();
  const boss = gs.boss;
  if (boss) { boss._entering = false; boss.hit(10, null); }
  return window.__AUDIO_SNAP();
});
await page.waitForTimeout(120);
push('bossHit 运行时出声（square 700-1400 金属层 + bandpass2500 Q≈1.5 噪声层 + 混响尾）',
  hasOsc(bossHitSnap, 'square', 650, 1500) && hasFilter(bossHitSnap, 'bandpass', 2500, 1.2, 2.0) && bossHitSnap.delay >= 1,
  JSON.stringify({ osc: bossHitSnap.osc.map((o) => ({ t: o.type, f: Math.round(o.freqs[0] || 0) })), bandpass: bossHitSnap.filter.filter((f) => f.type === 'bandpass').length, delay: bossHitSnap.delay }));

// 6e) shootPulse：主炮 fire() → square ~880（音高循环 784-988）
const pulseSnap = await page.evaluate(() => {
  window.__AUDIO_RESET();
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  p._lastFire = 1e12;   // 压制 update 自动开火，只统计手动 fire()
  p.weapon = 'pulse';
  p.fire();
  return window.__AUDIO_SNAP();
});
await page.waitForTimeout(60);
push('shootPulse 运行时出声（square 880 系，音高循环）',
  hasOsc(pulseSnap, 'square', 750, 1050),
  JSON.stringify(pulseSnap.osc.map((o) => ({ t: o.type, f: Math.round(o.freqs[0] || 0) }))));

// 6f) shootLaser：laser 分支 fire() → sawtooth 240
const laserSnap = await page.evaluate(() => {
  window.__AUDIO_RESET();
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  p._lastFire = 1e12;
  p.weapon = 'laser';
  p.fire();
  return window.__AUDIO_SNAP();
});
await page.waitForTimeout(60);
push('shootLaser 运行时出声（sawtooth 240 扫掠）',
  hasOsc(laserSnap, 'sawtooth', 220, 260),
  JSON.stringify(laserSnap.osc.map((o) => ({ t: o.type, f: Math.round(o.freqs[0] || 0) }))));

// 6g) shootWingman：僚机 _fire() → triangle ~620
const wmSnap = await page.evaluate(() => {
  window.__AUDIO_RESET();
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.wingmanSystem;
  if (!ws) return window.__AUDIO_SNAP();
  const w = ws.getMembers()[0] || ws.addWingman();
  if (w) w._fire(null, { shots: 1, spreadDeg: 0 });
  return window.__AUDIO_SNAP();
});
await page.waitForTimeout(60);
push('shootWingman 运行时出声（triangle 620 系，音高循环）',
  hasOsc(wmSnap, 'triangle', 520, 720),
  JSON.stringify(wmSnap.osc.map((o) => ({ t: o.type, f: Math.round(o.freqs[0] || 0) }))));

// 6h) heartbeat：HP_CHANGED 低血触发 → sine 60 + sine 50；>30% / hp=0 不触发
const hbLow = await page.evaluate(async () => {
  window.__AUDIO_RESET();
  const bus = (await import('/src/utils/EventBus.js')).EventBus;
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  bus.emit(EV.HP_CHANGED, 30, 100);
  return window.__AUDIO_SNAP().osc.map((o) => ({ type: o.type, freqs: o.freqs }));
});
const hbMid = await page.evaluate(async () => {
  window.__AUDIO_RESET();
  const bus = (await import('/src/utils/EventBus.js')).EventBus;
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  bus.emit(EV.HP_CHANGED, 50, 100);
  return window.__AUDIO_SNAP().osc.map((o) => ({ type: o.type, freqs: o.freqs }));
});
const hbDead = await page.evaluate(async () => {
  window.__AUDIO_RESET();
  const bus = (await import('/src/utils/EventBus.js')).EventBus;
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  bus.emit(EV.HP_CHANGED, 0, 100);
  return window.__AUDIO_SNAP().osc.map((o) => ({ type: o.type, freqs: o.freqs }));
});
const hbLowHit = (s) => s.some((o) => o.type === 'sine' && o.freqs.some((f) => f >= 56 && f <= 64))
  && s.some((o) => o.type === 'sine' && o.freqs.some((f) => f >= 46 && f <= 54));
const hbAny = (s) => s.some((o) => o.type === 'sine' && o.freqs.some((f) => (f >= 46 && f <= 64)));
push('P1-6 HP_CHANGED ≤30% 触发 heartbeat（sine 60 + sine 50 双搏）',
  hbLowHit(hbLow), `low=${hbLow.map((o) => Math.round(o.freqs[0] || 0)).join(',')}`);
push('P1-6 HP_CHANGED >30% / hp=0 不触发', hbAny(hbMid) === false && hbAny(hbDead) === false,
  `midOsc=${hbMid.length} deadOsc=${hbDead.length}`);

// ── 9) P1-5 立体声/混响尾真实产出（StereoPanner + Delay 节点）──
// 爆炸/bossHit 触发时已断言 delay；这里确认 panner 也被真实使用（爆炸带随机声像）
const pannerUsed = await page.evaluate(() => {
  window.__AUDIO_RESET();
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(270, 80, 'small', 'straight');
  if (e) e.die();
  return window.__AUDIO_SNAP().panner;
});
push('P1-5 爆炸立体声声像真实使用 StereoPanner', pannerUsed >= 1, `panners=${pannerUsed}`);

// ── 10) 零 pageerror / console.error ──
push('零 pageerror / console.error（主流程）', errors.length === 0,
  errors.length ? errors.slice(0, 3).join(' | ') : '');

await browser.close();

// ── 汇总 ──
const pass = checks.every((c) => c.ok);
const failed = checks.filter((c) => !c.ok);
console.log('---');
if (failed.length) console.log('FAILED: ' + failed.map((c) => c.name).join('; '));
console.log(pass ? 'QA_AUDIO_POLISH: PASS' : 'QA_AUDIO_POLISH: FAIL');
process.exit(pass ? 0 : 1);
