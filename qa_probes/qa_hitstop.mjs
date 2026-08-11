// qa_hitstop.mjs —— 命中定格（hitStop）真测
// 验证：requestHitStop 方法存在 / 触发后物理暂停 / 冷却内重复调用被忽略 /
//       真实时间后自动恢复 / 零 pageerror。
// 依赖：外部已起 5059 vite 服（或 run-all.mjs）。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://localhost:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const errors = [];

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

const r = await page.evaluate(async () => {
  const game = window.__SKY__;
  const SM = window.__SAVE;
  if (SM && SM.set) SM.set('tutorialDone', true); // 跳过教程，避免 physics 被教程 pause 干扰
  game.scene.stop('UIScene');
  game.scene.stop('GameScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  // 等待新实例 create 完成（玩家 active 且物理未暂停）
  await new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) {
        clearInterval(iv); res();
      } else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
  const gs = game.scene.getScene('GameScene');
  const hasMethod = typeof gs.requestHitStop === 'function';
  // 触发 300ms 定格
  gs.requestHitStop(300);
  const paused1 = gs.physics.world.isPaused;       // 期望 true
  const ms1 = gs._hitStopMs;                        // 期望 300
  // 冷却内（70ms）重复调用，应被忽略（不放大时长）
  gs.requestHitStop(50);
  const ms2 = gs._hitStopMs;                        // 期望仍为 300
  // 轮询等待直到恢复（兼容 headless 下 RAF 节流导致的慢递减；前台 60fps 下 300ms 即恢复）
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await new Promise((res) => setTimeout(res, 50));
    if (!gs.physics.world.isPaused && gs._hitStopMs <= 0) break;
  }
  const paused2 = gs.physics.world.isPaused;       // 期望 false
  const ms3 = gs._hitStopMs;                        // 期望 <= 0
  return { hasMethod, paused1, ms1, ms2, paused2, ms3 };
});

assert(r.hasMethod, 'GameScene.requestHitStop 方法存在');
assert(r.paused1 === true, `触发后物理暂停 (isPaused=${r.paused1})`);
assert(r.ms1 === 300, `首次定格时长写入 ${r.ms1} (期望 300)`);
assert(r.ms2 === 300, `冷却内重复调用被忽略 (ms=${r.ms2}, 期望 300)`);
assert(r.paused2 === false, `真实时间后自动恢复 (isPaused=${r.paused2})`);
assert(r.ms3 <= 0, `定格计时归零 (ms=${r.ms3})`);
assert(errors.length === 0, `零 pageerror (${errors.length})`);

if (errors.length) console.error('页面错误:', errors.slice(0, 5));
await browser.close();
console.log(process.exitCode ? '\n=== hitStop 探针 FAIL ===' : '\n=== hitStop 探针 PASS ===');
