// qa_opt13_qa_reg_d1_leak.mjs —— D1 (P2) 修复回归：救济局局内进度泄漏专项（独立实现）
//
// 背景：批 A 审计发现 D1 —— 救济局(_reliefRun=true)内 collectCoin/registerKill/useBomb/
// useSuper/_onWingmanCombo/_grantGraze 仍直接累加每日任务(newbiePlan)进度，_shouldRecordPersist()
// 只在 endGame 结算点拦截。开发已修复：8 个局内调用点全部改走 _addProgress 守卫（守卫在入口短路）。
//
// 本探针独立验证（不依赖开发探针）：
//   1) 救济局：6 个局内调用点触发后，dailyQuest.progress 的 coins/kills/bombs/super/combos/grazes
//      与 newbiePlan.progress 的 coins/grazes 全部保持 0；金币入账照常（AddCoins 不受拦）。
//   2) 对照：非救济局同样 6 个调用点 → daily/newbie 进度照常累加（证明守卫生效而非 SaveManager 故障）。
//   3) 静态接线：GameScene.js 中 8 个调用点均以 _addProgress 形式存在 + 守卫存在。
// 零 pageerror / console error。
//
// 注意：状态断言一律走 window.__SAVE / window.__ACH__ / window.__SKY__（应用实例）；
// 勿动态 import SaveManager/AchievementManager（Vite HMR ?t= 会生成第二份模块实例）。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

async function startGame(page, levelId = 1, mode = 'normal') {
  await page.evaluate(([lid, md]) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: md, levelId: lid });
  }, [levelId, mode]);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active && gs.waves;
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

// ═══════════════════════════════════════════════════════════════
// 准备：让每日任务/新手计划的被测 metric 全部 picked
// ═══════════════════════════════════════════════════════════════
await startGame(page, 1, 'normal');
await page.evaluate(() => {
  const SaveManager = window.__SAVE;
  const today = SaveManager._todayStr();
  SaveManager.set('dailyQuest', {
    date: today, claimed: false, progress: {},
    picked: ['coins', 'kills', 'bombs', 'super', 'combos', 'grazes'],
  });
  SaveManager.set('newbiePlan', { day: 1, claimed: {}, progress: {} });
});

// ═══════════════════════════════════════════════════════════════
// Phase 1：救济局 —— 6 个调用点触发后进度全 0，金币照常入账
// ═══════════════════════════════════════════════════════════════
const relief = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const SaveManager = window.__SAVE;
  const AM = window.__ACH__;
  const { ENERGY_MAX } = await import('/src/config/Skills.js');

  // 进入救济局态
  gs._reliefRun = true;
  AM.setIgnore(true);
  gs.mode = 'normal';

  const coinsBefore = SaveManager.get('coins');

  // 1) collectCoin：吃真实金币（金币照常入账，仅进度被拦）
  const c = gs.coins.get(200, 300, 'coin');
  c.setActive(true).setVisible(true); c.body.enable = true;
  gs.collectCoin(c);
  const coinsAfterCoin = SaveManager.get('coins');

  // 2) registerKill
  gs.registerKill(200, 200, {});

  // 3) useBomb
  const bombsBefore = gs.bombs;
  gs.bombs = 1;
  gs.useBomb();
  gs.bombs = bombsBefore;

  // 4) useSuper（能量充满）
  gs.energy = ENERGY_MAX;
  gs.useSuper();

  // 5) 元素协同
  gs._onWingmanCombo({ element: 'fire' });

  // 6) 擦弹
  gs._grantGraze(200, 200);

  const s = SaveManager.load();
  const dq = s.dailyQuest.progress || {};
  const np = s.newbiePlan.progress || {};
  // 快照（load() 返回活引用，必须在非救济对照前取值）
  return {
    coinsDelta: coinsAfterCoin - coinsBefore,
    dqCoins: dq.coins || 0, dqKills: dq.kills || 0, dqBombs: dq.bombs || 0,
    dqSuper: dq.super || 0, dqCombos: dq.combos || 0, dqGrazes: dq.grazes || 0,
    npCoins: np.coins || 0, npGrazes: np.grazes || 0,
  };
});

push('D1 救济局吃币：金币照常入账（+1）',
  relief.coinsDelta === 1, `coins ${relief.coinsDelta > 0 ? '+' + relief.coinsDelta : relief.coinsDelta}`);
push('D1 救济局每日任务进度全 0（coins/kills/bombs/super/combos/grazes）',
  relief.dqCoins === 0 && relief.dqKills === 0 && relief.dqBombs === 0 && relief.dqSuper === 0
  && relief.dqCombos === 0 && relief.dqGrazes === 0,
  `coins=${relief.dqCoins} kills=${relief.dqKills} bombs=${relief.dqBombs} super=${relief.dqSuper} combos=${relief.dqCombos} grazes=${relief.dqGrazes}`);
push('D1 救济局新手计划进度全 0（coins/grazes）',
  relief.npCoins === 0 && relief.npGrazes === 0, `coins=${relief.npCoins} grazes=${relief.npGrazes}`);

// ═══════════════════════════════════════════════════════════════
// Phase 2：对照 —— 非救济局同样 6 个调用点 → 进度照常累加
// ═══════════════════════════════════════════════════════════════
const normal = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const SaveManager = window.__SAVE;
  const AM = window.__ACH__;
  const { ENERGY_MAX } = await import('/src/config/Skills.js');

  gs._reliefRun = false;
  AM.setIgnore(false);
  gs.mode = 'normal';

  const c = gs.coins.get(200, 300, 'coin');
  c.setActive(true).setVisible(true); c.body.enable = true;
  gs.collectCoin(c);
  gs.registerKill(200, 200, {});
  const bombsBefore = gs.bombs;
  gs.bombs = 1;
  gs.useBomb();
  gs.bombs = bombsBefore;
  gs.energy = ENERGY_MAX;
  gs.useSuper();
  gs._onWingmanCombo({ element: 'fire' });
  gs._grantGraze(200, 200);

  const s = SaveManager.load();
  const dq = s.dailyQuest.progress || {};
  const np = s.newbiePlan.progress || {};
  return {
    dqCoins: dq.coins || 0, dqKills: dq.kills || 0, dqBombs: dq.bombs || 0,
    dqSuper: dq.super || 0, dqCombos: dq.combos || 0, dqGrazes: dq.grazes || 0,
    npCoins: np.coins || 0, npGrazes: np.grazes || 0,
  };
});

push('D1 对照：非救济局 6 个调用点进度全部 ≥1（守卫生效而非故障）',
  normal.dqCoins >= 1 && normal.dqKills >= 1 && normal.dqBombs >= 1 && normal.dqSuper >= 1
  && normal.dqCombos >= 1 && normal.dqGrazes >= 1 && normal.npCoins >= 1 && normal.npGrazes >= 1,
  `dq[coins=${normal.dqCoins} kills=${normal.dqKills} bombs=${normal.dqBombs} super=${normal.dqSuper} combos=${normal.dqCombos} grazes=${normal.dqGrazes}] np[coins=${normal.npCoins} grazes=${normal.npGrazes}]`);

// ═══════════════════════════════════════════════════════════════
// Phase 3：静态接线 —— 8 个调用点全走 _addProgress + 守卫存在
// ═══════════════════════════════════════════════════════════════
const wiring = await page.evaluate(async () => {
  const src = await (await fetch('/src/scenes/GameScene.js')).text();
  const need = [
    "this._addProgress('daily', 'coins', 1)",
    "this._addProgress('newbie', 'coins', 1)",
    "this._addProgress('daily', 'kills', 1)",
    "this._addProgress('daily', 'bombs', 1)",
    "this._addProgress('daily', 'super', 1)",
    "this._addProgress('daily', 'combos', 1)",
    "this._addProgress('daily', 'modules', 1)",
    "this._addProgress('newbie', 'grazes', 1)",
    "this._addProgress('daily', 'grazes', 1)",
    'if (!this._shouldRecordPersist()) return;',
  ];
  return { ok: need.every((x) => src.includes(x)), missing: need.filter((x) => !src.includes(x)) };
});
push('D1 静态接线：8 个局内调用点全走 _addProgress + 守卫存在',
  wiring.ok, wiring.missing.length ? wiring.missing.join(' | ') : 'wired');

// ── 零报错 ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_qa_reg_d1_leak: PASS ===' : '=== qa_opt13_qa_reg_d1_leak: FAIL ==='));
process.exit(pass ? 0 : 1);
