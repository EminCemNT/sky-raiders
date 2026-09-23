// qa_enemy_hit_sfx.mjs —— 命中怪物音效（enemyHit）真测
// 验证：非致死命中播放 enemyHit 专属高频音 / 致命一击不重复播 enemyHit（交给爆炸音）/
//       命中扣血逻辑跑通 / 零 pageerror。
// 依赖：外部已起 5059 vite 服（或 run-all.mjs）。
//
// 端到端手法：在页面加载前包装 AudioContext.createOscillator，记录每次振荡器频率。
// enemyHit 程序合成频率落在 1300~1800Hz 区间（专属），据此识别其是否真的出声。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://localhost:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const errors = [];
// enemyHit 金属层标称 1300~1800Hz（AudioSystem.js: base = 1300 + rand*500），
// 但 _toneAt 有全局 ±7% 音高随机化 → 实际落点 = [1300×0.93, 1800×1.07] ≈ [1209, 1926]。
// 识别带必须按此放宽，否则每次约 10% 概率漏判 → 3 次命中偶发只认出 2 次（假失败）。
const EH_LO = 1200, EH_HI = 1930;

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

// 端到端 spy：记录每次振荡器被设定的频率
await page.addInitScript(() => {
  window.__OSC_FREQS = [];
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const Orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      const osc = Orig.call(this);
      const of = osc.frequency;
      const set = of.setValueAtTime.bind(of);
      of.setValueAtTime = (v, t) => { window.__OSC_FREQS.push(v); return set(v, t); };
      return osc;
    };
  } catch (e) { /* AudioContext 不可用则跳过 */ }
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// headless（--disable-gpu 软件渲染）下游戏时间仅约 110ms/真实秒（≈1/9 速）。
// enemyHit 的 35ms 节流按「游戏内 time.now」判定，故这里按游戏时间等待，保证跨过节流窗口。
const waitGameMs = (ms) => page.waitForFunction((need) => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (!gs) return false;
  if (window.__GW0 == null) window.__GW0 = gs.time.now;
  if (gs.time.now - window.__GW0 >= need) { window.__GW0 = null; return true; }
  return false;
}, ms, { timeout: 30000 });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 60000 });

// 进入 GameScene（跳过教程，避免 physics 被教程 pause 干扰）
await page.evaluate(async () => {
  const game = window.__SKY__;
  const SM = window.__SAVE;
  if (SM && SM.set) SM.set('tutorialDone', true);
  game.scene.stop('UIScene');
  game.scene.stop('GameScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  await new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
});

// 等待敌机出现
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.enemies && gs.enemies.getChildren().some((e) => e.active);
}, null, { timeout: 15000 });

// 锁定一个活敌机引用（跨 evaluate 用 window.__TARGET 保留）
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  window.__TARGET = gs.enemies.getChildren().find((e) => e.active);
});

const hp0 = await page.evaluate(() => (window.__TARGET ? window.__TARGET.hp : null));

// 清空基线频率，避免 BGM/其它音效干扰判定
await page.evaluate(() => { window.__OSC_FREQS.length = 0; });

// 非致死命中 3 次，每次间隔经 waitGameMs 保证 > enemyHit 的 35ms 节流（_throttle 走 performance.now 墙钟）
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { const e = window.__TARGET; if (e && e.active) e.hit(e.hp * 0.3, null); });
  await waitGameMs(60);
}
const res1 = await page.evaluate(([lo, hi]) => ({
  hp1: window.__TARGET ? window.__TARGET.hp : null,
  enemyHitFreqs: (window.__OSC_FREQS || []).filter((x) => x >= lo && x <= hi),
}), [EH_LO, EH_HI]);

// 致命一击：清空基线后致命，应不产生 enemyHit 频段（避免与爆炸重音）
await page.evaluate(() => {
  const e = window.__TARGET;
  if (e && e.active) { window.__OSC_FREQS.length = 0; e.hit(999999, null); }
});
// 轮询至死亡/回收完成（headless 软件渲染下死亡演出+回收实测约 720ms 真实时间，固定 80ms 不够）
await page.waitForFunction(() => window.__TARGET && window.__TARGET.active === false, null, { timeout: 20000 })
  .catch(() => { /* 超时则下方断言给出失败 */ });
const res2 = await page.evaluate(([lo, hi]) => ({
  enemyHitOnDeath: (window.__OSC_FREQS || []).filter((x) => x >= lo && x <= hi).length,
  targetActive: window.__TARGET ? window.__TARGET.active : false,
}), [EH_LO, EH_HI]);

assert(hp0 !== null && res1.hp1 !== null && res1.hp1 < hp0,
  `非致死命中扣血逻辑跑通 (hp ${hp0 != null ? Math.round(hp0) : '?'} → ${res1.hp1 != null ? Math.round(res1.hp1) : '?'})`);
assert(res1.enemyHitFreqs.length === 3,
  `每次非致死命中播放 enemyHit 音效 (${res1.enemyHitFreqs.length}/3, 频率=${res1.enemyHitFreqs.map((f) => Math.round(f)).join(',')})`);
assert(res2.enemyHitOnDeath === 0,
  `致命一击不重复播放 enemyHit（交给爆炸音, 实际 ${res2.enemyHitOnDeath} 次）`);
assert(res2.targetActive === false, '致命一击触发死亡（敌机 recycle）');
assert(errors.length === 0, `零 pageerror (${errors.length})`);

if (errors.length) console.error('页面错误:', errors.slice(0, 5));
try { await browser.close(); } catch (e) { /* 收尾竞态忽略 */ }
console.log(process.exitCode ? '\n=== 命中音效探针 FAIL ===' : '\n=== 命中音效探针 PASS ===');
