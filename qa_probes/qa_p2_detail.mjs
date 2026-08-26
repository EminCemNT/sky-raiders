// qa_p2_detail.mjs —— P2 体验细节组（数值反馈 / 皮肤装饰 / 慢放子弹时间 / 语音连击反馈）真测
//
// 断言：
//   1) GameConfig 导出 calcPower / recommendLevel（源码 + 运行期调用）
//   2) 机库顶部展示总战力 + 推荐关卡（HangarScene.powerText）
//   3) 升级按钮弹数值对比（tryUpgrade → lastCompareText 含 "→"）
//   4) 皮肤装饰：
//      a. SHIP_SKINS 3 机 × 3 款（源码 + 运行期）
//      b. SaveManager 新增 skins/ownedSkins + buySkin/equipSkin/ownsSkin（只新增字段）
//      c. TextureFactory 生成 player_skin_{shipId}_{skinId}（textures.exists）
//      d. 机库 openSkins overlay 3 行 + 购买/切换生效
//      e. Player.applySkin 应用皮肤纹理（GameScene 开局）
//      f. ResultScene 战机立绘（rsShipImg 用皮肤纹理）
//   5) 慢放子弹时间：Boss 血线首降至 50% → physics.world.timeScale=0.3，随后恢复 1
//   6) 语音/连击反馈：
//      a. comboUp 音高随连击数爬升（440×2^(n/12)，combo=12 > combo=1）
//      b. voicePickup（POWERUP_COLLECTED）/ voiceCombo（连击5）/ voiceBoss（BOSS_SPAWNED）合成音素出声
//   7) 零 pageerror / console.error（全程）
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

// 页面加载前：WebAudio 原型 spy（记录真实振荡器频率）+ 强制 prefers-reduced-motion=false（保证慢放/动效可测）
await page.addInitScript(() => {
  try {
    const origMM = window.matchMedia ? window.matchMedia.bind(window) : null;
    window.matchMedia = (q) => {
      const m = origMM ? origMM(q) : { matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      if (String(q).includes('prefers-reduced-motion')) m.matches = false;
      return m;
    };
  } catch (e) { /* ignore */ }
  window.__AUDIO_OBS = { osc: [] };
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
  } catch (e) { /* AudioContext 不可用则跳过 */ }
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const g = window.__SKY__;
  return g && g.scene.getScene('MenuScene') && g.scene.getScene('MenuScene').scene.isActive();
}, { timeout: 20000 });

// ── 源码级断言 ──
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const gcSrc = read('src/config/GameConfig.js');
const smSrc = read('src/utils/SaveManager.js');
const tfSrc = read('src/utils/TextureFactory.js');
const gsSrc = read('src/scenes/GameScene.js');
const hsSrc = read('src/scenes/HangarScene.js');
const bossSrc = read('src/entities/Boss.js');
const plSrc = read('src/entities/Player.js');
const rsSrc = read('src/scenes/ResultScene.js');
const auSrc = read('src/systems/AudioSystem.js');

push('GameConfig 导出 calcPower', /export function calcPower\(/.test(gcSrc), '');
push('GameConfig 导出 recommendLevel', /export function recommendLevel\(/.test(gcSrc), '');
push('GameConfig 定义 SHIP_SKINS（3 机×3 款）', /export const SHIP_SKINS = \[/.test(gcSrc)
  && (gcSrc.match(/\{ id: 0, name: '青蓝'/g) || []).length >= 1, '');
push('SaveManager 新增 skins 字段', /skins: \{\}/.test(smSrc), '');
push('SaveManager 新增 ownedSkins 字段', /ownedSkins: \[\]/.test(smSrc), '');
push('SaveManager 皮肤方法 buySkin/equipSkin/ownsSkin/getSkin', /buySkin\(/.test(smSrc) && /equipSkin\(/.test(smSrc) && /ownsSkin\(/.test(smSrc) && /getSkin\(/.test(smSrc), '');
push('TextureFactory 生成 player_skin_{shipId}_{skinId}', /player_skin_\$\{shipId\}_\$\{skinId\}/.test(tfSrc), '');
push('GameScene 新增 slowMotion 方法', /slowMotion\(duration, timeScale = 0\.3\)/.test(gsSrc), '');
push('Boss.hit 血线 50%/25% 慢放触发', /_slowAt50/.test(bossSrc) && /_slowAt25/.test(bossSrc) && /slowMotion\(300\)/.test(bossSrc), '');
push('Player.applySkin 方法存在', /applySkin\(shipId, skinId\)/.test(plSrc), '');
push('HangarScene 皮肤入口 + 战力文本', /skinEntryBtn/.test(hsSrc) && /powerText/.test(hsSrc), '');
push('HangarScene 升级对比 flashCompare', /flashCompare/.test(hsSrc) && /lastCompareText/.test(hsSrc), '');
push('ResultScene 战机立绘 rsShipImg', /rsShipImg/.test(rsSrc), '');
push('AudioSystem comboUp 音高爬升', /case 'comboUp'/.test(auSrc) && /Math\.pow\(2, n \/ 12\)/.test(auSrc), '');
push('AudioSystem 合成音素 voicePickup/voiceCombo/voiceBoss',
  /case 'voicePickup'/.test(auSrc) && /case 'voiceCombo'/.test(auSrc) && /case 'voiceBoss'/.test(auSrc), '');
push('AudioSystem 挂 POWERUP_COLLECTED/COMBO_CHANGED/BOSS_SPAWNED 语音',
  /POWERUP_COLLECTED, \(\) => this\.sfx\('voicePickup'\)/.test(auSrc)
  && /COMBO_CHANGED/.test(auSrc)
  && /BOSS_SPAWNED, \(\) => this\.sfx\('voiceBoss'\)/.test(auSrc), '');

// ── 运行期断言 ──
const r = await page.evaluate(async () => {
  const g = window.__SKY__;
  const SM = window.__SAVE;
  const out = {};
  const waitFor = (fn, ms = 20000) => new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => { if (fn() || performance.now() - t0 > ms) { clearInterval(iv); res(); } }, 50);
  });

  SM.reset();
  SM.set('tutorialDone', true);
  SM.set('selectedDifficulty', 'standard');

  // 1) calcPower / recommendLevel 运行期
  const GC = await import('/src/config/GameConfig.js');
  out.calcPowerIsFn = typeof GC.calcPower === 'function';
  out.calcPowerVal = GC.calcPower({ firepower: 3, hull: 2 }, { weapon: 'weapon_rare' }, { id: 0 });
  out.recommend = GC.recommendLevel(out.calcPowerVal);
  out.skinCount = GC.SHIP_SKINS.length;
  out.skin0count = GC.SHIP_SKINS[0] ? GC.SHIP_SKINS[0].skins.length : 0;
  out.skinKeyFn = GC.shipSkinKey(0, 1) === 'player_skin_0_1';

  // 2) 机库：战力 + 推荐关卡 + 升级对比
  if (!g.scene.getScene('HangarScene')) {
    const H = (await import('/src/scenes/HangarScene.js')).default;
    g.scene.add('HangarScene', H, false);
  }
  g.scene.start('HangarScene');
  await waitFor(() => { const s = g.scene.getScene('HangarScene'); return s && s.scene.isActive() && s.powerText && s.rows && s.rows.length > 0; });
  const hs = g.scene.getScene('HangarScene');
  out.powerText = hs.powerText ? hs.powerText.text : '';
  out.powerHas = /总战力/.test(out.powerText) && /推荐关卡/.test(out.powerText);
  // 升级对比：给足金币后 tryUpgrade(firepower 行)
  SM.set('coins', 100000);
  hs.refresh();
  const fireRow = hs.rows.find((row) => row.key === 'firepower');
  hs.tryUpgrade(fireRow);
  out.compareText = hs.lastCompareText || '';
  out.compareOk = /→/.test(out.compareText) && /主炮/.test(out.compareText);

  // 3) 皮肤：纹理存在 + overlay + 购买/切换
  out.texSkin01 = g.textures.exists('player_skin_0_1');
  out.texSkin12 = g.textures.exists('player_skin_1_2');
  out.texSkin20 = g.textures.exists('player_skin_2_0');
  out.texPlayerIntact = g.textures.exists('player');
  hs.openSkins();
  await waitFor(() => hs.skinRows && hs.skinRows.length === 3 && hs.skinsOpen);
  out.skinRows = hs.skinRows.length;
  // 购买皮肤 0:1（初始金币 100000 → 购买后 99200）
  SM.set('coins', 2000);
  hs.refreshSkinsPanel();
  out.buyOk = SM.buySkin(0, 1) === true;
  out.ownedAfterBuy = SM.ownsSkin(0, 1);
  out.coinsAfterBuy = SM.load().coins;
  out.equipOk = SM.equipSkin(0, 1) === true;
  out.skinApplied = SM.getSkin(0) === 1;
  hs.closeSkins();

  // 4) GameScene：开局玩家应用皮肤纹理
  g.scene.stop('HangarScene');
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  await waitFor(() => { const gs = g.scene.getScene('GameScene'); return gs && gs.scene.isActive() && gs.player && gs.player.active; });
  const gs = g.scene.getScene('GameScene');
  out.playerTex = gs.player ? gs.player.texture.key : '';
  out.playerSkinApplied = out.playerTex === 'player_skin_0_1';

  // 5) 慢放子弹时间：Boss 血线首降至 50% → timeScale 0.3 → 恢复 1
  gs.spawnBoss('boss_sentinel');
  const boss = gs.boss;
  if (boss) boss._entering = false;
  const ts0 = gs.physics.world.timeScale;
  if (boss) boss.hit(boss.maxHp * 0.55); // hp=45% < 50% 首触发
  const tsSlow = gs.physics.world.timeScale;
  out.slowTriggered = ts0 === 1 && tsSlow === 0.3;
  await new Promise((res) => setTimeout(res, 500)); // 慢放 300ms 定时器已过，等待恢复
  out.slowRestored = gs.physics.world.timeScale === 1;

  return out;
});

// 慢放恢复等待已在上面内联等待 500ms（恢复定时器 300ms 已过）
push('calcPower 运行期为函数', r.calcPowerIsFn, `val=${r.calcPowerVal}`);
push('calcPower 计算战力 > 0 且 recommendLevel 生效', r.calcPowerVal > 0 && r.recommend >= 1, `power=${r.calcPowerVal} rec=${r.recommend}`);
push('SHIP_SKINS 3 机 × 3 款（运行期）', r.skinCount === 3 && r.skin0count === 3, `ships=${r.skinCount} skins/ship=${r.skin0count}`);
push('shipSkinKey 派生正确', r.skinKeyFn === true, '');
push('机库顶部展示总战力 + 推荐关卡', r.powerHas === true, r.powerText);
push('升级按钮弹数值对比（当前→升级后）', r.compareOk === true, r.compareText);
push('皮肤纹理已生成（0_1 / 1_2 / 2_0）', r.texSkin01 && r.texSkin12 && r.texSkin20, `0_1=${r.texSkin01} 1_2=${r.texSkin12} 2_0=${r.texSkin20}`);
push('原 player 纹理未动', r.texPlayerIntact === true, '');
push('机库皮肤 overlay 3 行', r.skinRows === 3, `rows=${r.skinRows}`);
push('金币购买皮肤（800）成功', r.buyOk && r.ownedAfterBuy, `owned=${r.ownedAfterBuy} coins=${r.coinsAfterBuy}`);
push('切换皮肤 equipSkin 生效', r.equipOk && r.skinApplied, `skin=${r.skinApplied}`);
push('GameScene 开局应用皮肤纹理 player_skin_0_1', r.playerSkinApplied === true, r.playerTex);
push('Boss 血线 50% 慢放触发（timeScale 0.3）', r.slowTriggered === true, `ts0=${r.slowTriggered ? 1 : 0} slow=${r.slowTriggered ? 0.3 : '?'}`);
push('慢放 300ms 后恢复 timeScale=1', r.slowRestored === true, '');

// ── 6) 语音/连击反馈（WebAudio 运行时）──
const audio = await page.evaluate(async () => {
  const g = window.__SKY__;
  const bus = (await import('/src/utils/EventBus.js')).EventBus;
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const SNAP = () => window.__AUDIO_OBS.osc.map((o) => ({ type: o.node.type, freqs: o.freqs.slice() }));
  const RESET = () => { window.__AUDIO_OBS.osc.length = 0; };
  const firstFreq = (snap, type) => {
    for (const o of snap) if (o.type === type && o.freqs.length) return o.freqs[0];
    return null;
  };
  const anyFreq = (snap, type, lo, hi) => snap.some((o) => o.type === type && o.freqs.some((f) => f >= lo && f <= hi));

  // 前面 slow-mo 测试已触发过 voiceBoss（800ms 节流），先等 900ms 让节流窗口过期
  await sleep(900);

  // comboUp 音高爬升：combo=1 vs combo=12（两发之间 >150ms 节流窗口）
  RESET();
  bus.emit(EV.COMBO_CHANGED, 1, 1);
  const f1 = firstFreq(SNAP(), 'triangle');
  await sleep(220);
  RESET();
  bus.emit(EV.COMBO_CHANGED, 12, 3);
  const f12 = firstFreq(SNAP(), 'triangle');
  // voiceCombo：combo=5 时追加 440Hz 上扬音素（boss BGM 音阶无 440，可区分）
  await sleep(220);
  RESET();
  bus.emit(EV.COMBO_CHANGED, 5, 2);
  const voiceComboHit = anyFreq(SNAP(), 'triangle', 430, 452);
  // voicePickup：POWERUP_COLLECTED → sine 196（distinct from comboUp sine 泛音/ BGM sine 73）
  await sleep(220);
  RESET();
  bus.emit(EV.POWERUP_COLLECTED, '护盾');
  const pickupSnap = SNAP();
  const voicePickupHit = anyFreq(pickupSnap, 'sine', 188, 205);
  // voiceBoss：BOSS_SPAWNED → sawtooth 196/175（bosswarn 是 440/220，可区分；节流 800ms 已过）
  await sleep(220);
  RESET();
  bus.emit(EV.BOSS_SPAWNED, { key: 'boss_sentinel', name: '哨兵', color: 0x66ccff });
  const bossSnap = SNAP();
  const voiceBossHit = anyFreq(bossSnap, 'sawtooth', 160, 205);

  return { f1, f12, voiceComboHit, voicePickupHit, voiceBossHit };
});

push('comboUp 音高随连击数爬升（combo=12 > combo=1）',
  audio.f1 != null && audio.f12 != null && audio.f12 > audio.f1,
  `combo1=${audio.f1 ? Math.round(audio.f1) : '?'} combo12=${audio.f12 ? Math.round(audio.f12) : '?'}`);
push('combo=5 追加 voiceCombo 上扬音素', audio.voiceComboHit === true, '');
push('POWERUP_COLLECTED 触发 voicePickup 音素', audio.voicePickupHit === true, '');
push('BOSS_SPAWNED 触发 voiceBoss 音素', audio.voiceBossHit === true, '');

// ── 7) ResultScene 战机立绘 ──
const rs = await page.evaluate(async () => {
  const g = window.__SKY__;
  g.scene.stop('GameScene'); g.scene.stop('UIScene');
  g.scene.start('ResultScene', { victory: true, stars: 2, score: 100, kills: 5, coins: 10, levelId: 1, ship: { id: 0, skin: 1 } });
  const waitFor = (fn, ms = 20000) => new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => { if (fn() || performance.now() - t0 > ms) { clearInterval(iv); res(); } }, 50);
  });
  await waitFor(() => { const s = g.scene.getScene('ResultScene'); return s && s.scene.isActive(); });
  const s = g.scene.getScene('ResultScene');
  return { key: s.rsShipImg ? s.rsShipImg.texture.key : '', ok: !!(s.rsShipImg && s.rsShipImg.texture.key === 'player_skin_0_1') };
});
push('ResultScene 战机立绘用皮肤纹理 player_skin_0_1', rs.ok === true, rs.key);

await browser.close();

push('零 pageerror / console.error（全程）', errors.length === 0,
  errors.length ? errors.slice(0, 3).join(' | ') : '');

// ── 汇总 ──
const pass = checks.every((c) => c.ok);
const failed = checks.filter((c) => !c.ok);
console.log('---');
if (failed.length) console.log('FAILED: ' + failed.map((c) => c.name).join('; '));
console.log(pass ? 'QA_P2_DETAIL: PASS' : 'QA_P2_DETAIL: FAIL');
process.exit(pass ? 0 : 1);
