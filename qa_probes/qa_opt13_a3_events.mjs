// qa_opt13_a3_events.mjs —— OPT-13 批A A3 EVENTS 事件契约补登记 验收探针
//
// 验证：
//   1) EVENTS.HUD_SCORE === '__hud_score' / EVENTS.HUD_BOMBS === '__hud_bombs'（值不变，零回归）
//   2) 预留事件已登记：SAVE_FAILED / BURST_CHANGED / BURST_ACTIVATED / MUTATION_CHANGED
//   3) GameScene/UIScene 源码中不再出现裸字符串 '__hud_score' / '__hud_bombs'
//   4) 真实行为：SCORE_CHANGED → GameScene 累计 → HUD 得分刷新；addBomb/useBomb → HUD 炸弹数刷新
//   5) 零 pageerror / console error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

async function startGame(page) {
  await page.evaluate(() => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
  }, { timeout: 20000 });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

// ── 1) EVENTS 契约值不变 + 新事件登记 ──
const ev = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const E = m.EVENTS;
  return {
    hudScore: E.HUD_SCORE,
    hudBombs: E.HUD_BOMBS,
    saveFailed: E.SAVE_FAILED,
    burstChanged: E.BURST_CHANGED,
    burstActivated: E.BURST_ACTIVATED,
    mutationChanged: E.MUTATION_CHANGED,
  };
});
push('EVENTS.HUD_SCORE === \'__hud_score\'（值不变）', ev.hudScore === '__hud_score', ev.hudScore);
push('EVENTS.HUD_BOMBS === \'__hud_bombs\'（值不变）', ev.hudBombs === '__hud_bombs', ev.hudBombs);
push('EVENTS.SAVE_FAILED 已登记（A1 使用）', !!ev.saveFailed, ev.saveFailed);
push('EVENTS.BURST_CHANGED 已登记（B11 预留）', !!ev.burstChanged, ev.burstChanged);
push('EVENTS.BURST_ACTIVATED 已登记（B11 预留）', !!ev.burstActivated, ev.burstActivated);
push('EVENTS.MUTATION_CHANGED 已登记（A8 使用）', !!ev.mutationChanged, ev.mutationChanged);

// ── 2) 源码不再残留裸字符串事件名（经 Vite 源码服务取原始模块文本）──
const src = await page.evaluate(async () => {
  const gs = await (await fetch('/src/scenes/GameScene.js')).text();
  const ui = await (await fetch('/src/scenes/UIScene.js')).text();
  return {
    gsHasScore: gs.includes("'__hud_score'"),
    gsHasBombs: gs.includes("'__hud_bombs'"),
    uiHasScore: ui.includes("'__hud_score'"),
    uiHasBombs: ui.includes("'__hud_bombs'"),
    gsRefScore: gs.includes('EVENTS.HUD_SCORE'),
    gsRefBombs: gs.includes('EVENTS.HUD_BOMBS'),
    uiRefScore: ui.includes('EVENTS.HUD_SCORE'),
    uiRefBombs: ui.includes('EVENTS.HUD_BOMBS'),
  };
});
push('GameScene 无裸 \'__hud_score\' 且引用 EVENTS.HUD_SCORE',
  src.gsHasScore === false && src.gsRefScore === true);
push('GameScene 无裸 \'__hud_bombs\' 且引用 EVENTS.HUD_BOMBS',
  src.gsHasBombs === false && src.gsRefBombs === true);
push('UIScene 无裸 \'__hud_score\' 且引用 EVENTS.HUD_SCORE',
  src.uiHasScore === false && src.uiRefScore === true);
push('UIScene 无裸 \'__hud_bombs\' 且引用 EVENTS.HUD_BOMBS',
  src.uiHasBombs === false && src.uiRefBombs === true);

// ── 3) 真实行为：HUD 得分刷新 ──
await startGame(page);
const scoreFlow = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  const EventBus = (await import('/src/utils/EventBus.js')).default || (await import('/src/utils/EventBus.js')).EventBus;
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  gs.score = 0;
  EventBus.emit(EV.SCORE_CHANGED, 1200);
  await new Promise((r) => setTimeout(r, 50));
  return {
    score: gs.score,
    hud: ui.scoreText ? ui.scoreText.text : null,
  };
});
push('SCORE_CHANGED 经契约链路刷新 HUD（score=1200 → hud=001200）',
  scoreFlow.score === 1200 && scoreFlow.hud === '001200', `score=${scoreFlow.score} hud=${scoreFlow.hud}`);

// ── 4) 真实行为：HUD 炸弹数刷新（addBomb / useBomb）──
const bombFlow = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  gs.bombs = 3;
  gs.addBomb();
  await new Promise((r) => setTimeout(r, 50));
  const afterAdd = ui.bombIcon && ui.bombIcon.count ? ui.bombIcon.count.text : null;
  const bombsAfterAdd = gs.bombs;
  gs.useBomb();
  await new Promise((r) => setTimeout(r, 50));
  const afterUse = ui.bombIcon && ui.bombIcon.count ? ui.bombIcon.count.text : null;
  const bombsAfterUse = gs.bombs;
  return { afterAdd, bombsAfterAdd, afterUse, bombsAfterUse };
});
push('addBomb → HUD 炸弹数 x4', bombFlow.afterAdd === 'x4' && bombFlow.bombsAfterAdd === 4, `hud=${bombFlow.afterAdd} bombs=${bombFlow.bombsAfterAdd}`);
push('useBomb → HUD 炸弹数 x3', bombFlow.afterUse === 'x3' && bombFlow.bombsAfterUse === 3, `hud=${bombFlow.afterUse} bombs=${bombFlow.bombsAfterUse}`);

push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a3_events: PASS ===' : '=== qa_opt13_a3_events: FAIL ==='));
process.exit(pass ? 0 : 1);
