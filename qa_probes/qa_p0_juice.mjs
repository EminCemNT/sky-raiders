// qa_p0_juice.mjs —— P0 手感四项（伤害飘字 / flinch 颤动 / 音高随机化 / 分级震动）真测
// 验证：
//   A. 命中敌人生成伤害飘字 damageNumber（场景 Text 数量 +1）
//   B. 命中触发 flinch（_flinchTween 创建）
//   C. flinch 角度抖动（延时后 enemy.angle != 0）
//   D. 音高随机化生效（两次 enemyHit 频率不同）
//   E. 分级震动生效（放炸弹后 camera 处于 shake 状态）
//   F. 零 pageerror
// 依赖：外部已起 5059 vite 服（或 run-all.mjs）。
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

// 进入 GameScene（跳过教程）
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

// 锁定一个活敌机
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  window.__TARGET = gs.enemies.getChildren().find((e) => e.active);
});

// 记录命中前场景内 Text 数量
const n0 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs.children.list.filter((c) => c.type === 'Text').length;
});

// 非致死命中
await page.evaluate(() => {
  const e = window.__TARGET;
  if (e && e.active) e.hit(Math.max(1, Math.round(e.hp * 0.25)), null);
});

// 立刻读 flinch 触发状态 + 命中后 Text 数量
const r = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = window.__TARGET;
  return {
    flinchTween: !!(e && e._flinchTween),
    textCount: gs.children.list.filter((c) => c.type === 'Text').length,
  };
});
const n1 = r.textCount;

// 延时 30ms 读 flinch 角度（tween 进行中，应 != 0）
await page.waitForTimeout(30);
const ang = await page.evaluate(() => (window.__TARGET ? window.__TARGET.angle : 0));

// 清空频率基线，再非致死命中 2 次（间隔 60ms > enemyHit 节流 35ms）验证随机化
await page.evaluate(() => { window.__OSC_FREQS.length = 0; });
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => { const e = window.__TARGET; if (e && e.active) e.hit(Math.max(1, Math.round(e.hp * 0.2)), null); });
  await page.waitForTimeout(60);
}
const freqs = await page.evaluate(() =>
  (window.__OSC_FREQS || []).filter((x) => x >= 1200 && x <= 1900)); // enemyHit 频段（1300~1800 ±7%）

// 验证分级震动：放炸弹（useBomb 内 VFX.shake heavy + bombShockwave heavy）
const shakeOn = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.bombs = 1;
  if (gs.useBomb) gs.useBomb();
  await new Promise((res) => setTimeout(res, 60));
  const cam = gs.cameras.main;
  const eff = cam.shakeEffect;
  return !!(eff && eff.isRunning);
});

assert(r.flinchTween, '命中触发 flinch（_flinchTween 已创建）');
assert(ang !== 0, `flinch 角度抖动生效（angle=${ang.toFixed(1)}°）`);
assert(n1 - n0 >= 1, `命中生成伤害飘字 damageNumber（Text 数 ${n0} → ${n1}）`);
assert(freqs.length >= 2 && freqs[0] !== freqs[1],
  `音高随机化生效（两次 enemyHit 频率 ${freqs.map((f) => Math.round(f)).join(' ≠ ')}）`);
assert(shakeOn, '分级震动生效（放炸弹后 camera 处于 shake 状态）');
assert(errors.length === 0, `零 pageerror (${errors.length})`);

if (errors.length) console.error('页面错误:', errors.slice(0, 5));
try { await browser.close(); } catch (e) { /* 收尾竞态忽略 */ }
console.log(process.exitCode ? '\n=== P0 手感探针 FAIL ===' : '\n=== P0 手感探针 PASS ===');
