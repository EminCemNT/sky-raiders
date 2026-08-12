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
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

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

// 非致死命中 3 次，每次间隔 60ms（> enemyHit 节流 35ms）确保每次都发声
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { const e = window.__TARGET; if (e && e.active) e.hit(e.hp * 0.3, null); });
  await page.waitForTimeout(60);
}
const res1 = await page.evaluate(() => ({
  hp1: window.__TARGET ? window.__TARGET.hp : null,
  enemyHitFreqs: (window.__OSC_FREQS || []).filter((x) => x >= 1300 && x <= 1800),
}));

// 致命一击：清空基线后致命，应不产生 enemyHit 频段（避免与爆炸重音）
await page.evaluate(() => {
  const e = window.__TARGET;
  if (e && e.active) { window.__OSC_FREQS.length = 0; e.hit(999999, null); }
});
await page.waitForTimeout(80);
const res2 = await page.evaluate(() => ({
  enemyHitOnDeath: (window.__OSC_FREQS || []).filter((x) => x >= 1300 && x <= 1800).length,
  targetActive: window.__TARGET ? window.__TARGET.active : false,
}));

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
