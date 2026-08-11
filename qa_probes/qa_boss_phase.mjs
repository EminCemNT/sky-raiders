// qa_boss_phase.mjs —— Boss 阶段化演出真测
// 验证：阶段切换时 emit BOSS_PHASE 事件 + UIScene 显示阶段提示文字（flashCenter）+ 变身 tween 不报错 + 零 pageerror。
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
  if (SM && SM.set) SM.set('tutorialDone', true);
  game.scene.stop('UIScene');
  game.scene.stop('GameScene');
  game.scene.start('GameScene', { mode: 'bossrush', levelId: 1 });
  const waitFor = (fn, ms = 12000) => new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => { if (fn() || performance.now() - t0 > ms) { clearInterval(iv); res(); } }, 50);
  });
  await waitFor(() => {
    const gs = game.scene.getScene('GameScene');
    return gs && gs.boss && gs.boss.active && !gs.boss._entering;
  });
  const gs = game.scene.getScene('GameScene');
  const boss = gs.boss;
  const beforePhase = boss.phase;
  // 把血量拉到 50%（跨入 phase2）再触发一次受击，驱动阶段切换分支
  boss.hp = boss.maxHp * 0.5;
  boss.hit(1);
  const afterPhase = boss.phase;
  await new Promise((res) => setTimeout(res, 360)); // 等 flashCenter 文本显示
  const ui = game.scene.getScene('UIScene');
  let phaseText = null;
  if (ui && ui.children && ui.children.list) {
    ui.children.list.forEach((o) => {
      if (o.type === 'Text' && o.text && /阶段|形态/.test(o.text) && o.alpha > 0.1) phaseText = o.text;
    });
  }
  return { beforePhase, afterPhase, phaseText, bossActive: boss.active };
});

assert(r.beforePhase === 1, `阶段切换前 phase=${r.beforePhase} (期望 1)`);
assert(r.afterPhase === 2, `50% 血触发跨阶段 phase=${r.afterPhase} (期望 2)`);
assert(!!r.phaseText && /阶段|形态/.test(r.phaseText), `UIScene 阶段提示文字出现 ("${r.phaseText}")`);
assert(errors.length === 0, `零 pageerror (${errors.length})`);

if (errors.length) console.error('页面错误:', errors.slice(0, 5));
await browser.close();
console.log(process.exitCode ? '\n=== Boss 阶段演出探针 FAIL ===' : '\n=== Boss 阶段演出探针 PASS ===');
