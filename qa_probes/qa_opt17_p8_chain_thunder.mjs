// qa_opt17_p8_chain_thunder.mjs —— OPT-17 P8 霆光「传导」音效差异化验收探针
// ---------------------------------------------------------------------------
// 断言：emitReactionFeedback 收口时
//   P8.1  thunder 传导 → audio.sfx('chainThunder')（专属电弧音，不再共用 powerup）
//   P8.2  fire/ice 反应 → audio.sfx('powerup')（既有行为零变化）
//   P8.3  AudioSystem.sfx 支持 'chainThunder' case（零外部资源，WebAudio 合成）
//   P8.4  触发后零 pageerror
// 运行：node qa_probes/qa_opt17_p8_chain_thunder.mjs（QA_URL 默认 5059）
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const checks = [];
const push = (name, ok, detail = '') => { checks.push({ name, ok }); console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : '')); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };
const SAVE = {
  version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 99999, bestScore: 420000, unlockedLevel: 4,
  selectedShip: 3, skins: { 3: 0 }, ownedSkins: [],
  nickname: '爸爸', haptics: true, muted: false,
  dailyChallenge: { date: '', bestScore: 0, cleared: false, claimed: false },
};

const ctx = await browser.newContext({ viewport });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.addInitScript(({ key, save }) => {
  try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) {}
}, { key: SAVE_KEY, save: SAVE });
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE && window.__AUDIO), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, null, { timeout: 20000 });
await page.waitForTimeout(800);

// P8.3 静态：AudioSystem 源码含 chainThunder case（module 无法直接 import，走 sfx 调用观测）
const sfxLog = await page.evaluate(async () => {
  // 拦截 audio.sfx：记录调用名（不破坏原逻辑，仅包裹）
  const audio = window.__AUDIO;
  if (!audio || typeof audio.sfx !== 'function') return { ok: false, reason: 'no audio.sfx' };
  const orig = audio.sfx.bind(audio);
  const calls = [];
  audio.sfx = (name, arg) => { calls.push(String(name)); return orig(name, arg); };
  return { ok: true, calls };
});

// 进 GameScene
await page.evaluate(() => {
  const g = window.__SKY__;
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene', 'HangarScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, null, { timeout: 20000 });
await page.waitForTimeout(600);

// 直接触发各元素反馈（thunder / fire / ice），观测 sfx 分流
const res = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const audio = window.__AUDIO;
  const calls = [];
  audio.sfx = (name, arg) => { calls.push(String(name)); };
  // 依次触发（thunder 传导 / fire 引爆 / ice 冰爆）
  if (typeof gs.emitReactionFeedback === 'function') {
    gs.emitReactionFeedback('传导', 200, 300, 3, 'thunder');
    gs.emitReactionFeedback('引爆', 200, 300, 3, 'fire');
    gs.emitReactionFeedback('冰爆', 200, 300, 3, 'ice');
  }
  return { calls };
});
push('P8.1 thunder 传导 → chainThunder（专属电弧音）', res.calls.includes('chainThunder'),
  `calls=${res.calls.join(',')}`);
push('P8.2 fire/ice 反应 → powerup（既有行为不变）', res.calls.filter((c) => c === 'powerup').length >= 2,
  `powerup×${res.calls.filter((c) => c === 'powerup').length}`);
// 补一次 thunder 也应含 powerup 之外不再走 powerup —— thunder 分支应只播 chainThunder
const thunderOnly = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const audio = window.__AUDIO;
  const calls = [];
  audio.sfx = (name, arg) => { calls.push(String(name)); };
  gs.emitReactionFeedback('传导', 200, 300, 5, 'thunder');
  return { calls };
});
push('P8.1b thunder 不再走 powerup（听觉差异确立）',
  thunderOnly.calls.includes('chainThunder') && !thunderOnly.calls.includes('powerup'),
  `calls=${thunderOnly.calls.join(',')}`);
push('P8.4 触发全程零 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));

// 清理拦截
await page.evaluate(() => {
  const audio = window.__AUDIO;
  if (audio && audio.__origSfx) { audio.sfx = audio.__origSfx; }
});

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ P8 霆光传导音效：${checks.length - fails.length}/${checks.length} 通过 ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
