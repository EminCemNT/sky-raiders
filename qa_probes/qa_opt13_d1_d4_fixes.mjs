// qa_opt13_d1_d4_fixes.mjs —— OPT-13 QA 缺陷修复 D1-D4 自测探针
//
// D1 (P2) 救济局局内进度拦截：
//   collectCoin / registerKill / useBomb / useSuper / _onWingmanCombo / _grantGraze / 模块
//   全部改走 _addProgress 守卫；救济局(_reliefRun=true)内 dailyQuest/newbiePlan 进度保持 0，
//   金币入账等实时统计不受影响；非救济局照常累加（证明守卫生效而非 SaveManager 故障）。
// D2 (P3) Boss 狂暴入场演出 ≥1.2s：首组风暴最早发射 = now + max(fireGapMs,1200)；后续组间歇仍 fireGapMs。
// D3 (P3) SAVE_FAILED 不再静默：SaveManager 首败 emit；UIScene 注册 _onSaveFailed 并弹提示；Locale 文案齐备。
// D4 (P3) 负面变异延迟内死亡不丢变异：玩家死亡(active=false)但本局未结束 → 1s 后仍落地；
//         仅 gameEnded 才跳过（避免结算后叠无意义变异）。
// 零 pageerror / console error。
//
// 注意：状态断言一律走 window.__SAVE / window.__ACH__ / window.__SKY__（应用实例）；
// 勿动态 import SaveManager/AchievementManager（Vite HMR ?t= 会生成第二份模块实例）。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5183';
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
// D1 救济局局内进度拦截（8 个局内调用点全走 _addProgress 守卫）
// ═══════════════════════════════════════════════════════════════
await startGame(page, 1, 'normal');
const d1 = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const SaveManager = window.__SAVE;
  const AM = window.__ACH__;
  const today = SaveManager._todayStr();
  // 让每日任务 picked 覆盖被测 metric（addDailyProgress 仅对 picked 累加）
  SaveManager.set('dailyQuest', {
    date: today, claimed: false, progress: {},
    picked: ['coins', 'kills', 'bombs', 'super', 'combos', 'grazes'],
  });
  SaveManager.set('newbiePlan', { day: 1, claimed: {}, progress: {} });

  // 救济局：进度入账全拦截，金币/击杀等局内实时统计不受影响
  gs._reliefRun = true;
  AM.setIgnore(true);
  gs.mode = 'normal';

  const coinsBefore = SaveManager.get('coins');
  // 1) collectCoin（吃币：金币照常入账，仅 dq/np coins 进度被拦）
  const c = gs.coins.get(200, 300, 'coin');
  c.setActive(true).setVisible(true); c.body.enable = true;
  gs.collectCoin(c);
  const coinsAfterCoin = SaveManager.get('coins');
  // 2) registerKill
  gs.registerKill(200, 200, {});
  // 3) useBomb（清屏炸弹）
  const bombsBefore = gs.bombs;
  gs.bombs = 1;
  gs.useBomb();
  gs.bombs = bombsBefore;
  // 4) useSuper（星风暴，能量充满）
  const { ENERGY_MAX } = await import('/src/config/Skills.js');
  gs.energy = ENERGY_MAX;
  gs.useSuper();
  // 5) 元素协同
  gs._onWingmanCombo({ element: 'fire' });
  // 6) 擦弹
  gs._grantGraze(200, 200);

  const s = SaveManager.load();
  const dq = s.dailyQuest.progress || {};
  const np = s.newbiePlan.progress || {};
  // 快照救济局阶段值（dq/np 是 load() 缓存对象的活引用，必须先取值再跑对照，
  // 否则对照段的累加会污染同一对象导致误报）
  const relief = {
    dqCoins: dq.coins || 0, npCoins: np.coins || 0,
    dqKills: dq.kills || 0, dqBombs: dq.bombs || 0, dqSuper: dq.super || 0,
    dqCombos: dq.combos || 0, dqGrazes: dq.grazes || 0, npGrazes: np.grazes || 0,
  };

  // 对照：非救济局照常累加（证明守卫本身在拦，而非 SaveManager 故障）
  gs._reliefRun = false;
  AM.setIgnore(false);
  gs._addProgress('daily', 'coins', 1);
  gs._addProgress('newbie', 'coins', 1);
  const s2 = SaveManager.load();
  const dq2 = s2.dailyQuest.progress.coins || 0;
  const np2 = s2.newbiePlan.progress.coins || 0;
  return {
    coinsDelta: coinsAfterCoin - coinsBefore,
    ...relief,
    dq2, np2,
  };
});
push('D1 救济局吃币：金币照常入账（+1）',
  d1.coinsDelta === 1, `coins ${d1.coinsDelta > 0 ? '+' + d1.coinsDelta : d1.coinsDelta}`);
push('D1 救济局每日任务进度全 0（coins/kills/bombs/super/combos/grazes）',
  d1.dqCoins === 0 && d1.dqKills === 0 && d1.dqBombs === 0 && d1.dqSuper === 0
  && d1.dqCombos === 0 && d1.dqGrazes === 0,
  `coins=${d1.dqCoins} kills=${d1.dqKills} bombs=${d1.dqBombs} super=${d1.dqSuper} combos=${d1.dqCombos} grazes=${d1.dqGrazes}`);
push('D1 救济局新手计划进度全 0（coins/grazes）',
  d1.npCoins === 0 && d1.npGrazes === 0, `coins=${d1.npCoins} grazes=${d1.npGrazes}`);
push('D1 对照：非救济局 _addProgress 照常累加（守卫生效而非故障）',
  d1.dq2 === 1 && d1.np2 === 1, `dq.coins=${d1.dq2} np.coins=${d1.np2}`);
const d1Wiring = await page.evaluate(async () => {
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
  d1Wiring.ok, d1Wiring.missing.length ? d1Wiring.missing.join(' | ') : 'wired');

// ═══════════════════════════════════════════════════════════════
// D2 狂暴入场演出 ≥1.2s（首组风暴最早发射 = now + max(fireGapMs,1200)）
// ═══════════════════════════════════════════════════════════════
await startGame(page, 1, 'normal');
const d2 = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const { default: Boss } = await import('/src/entities/Boss.js');
  const R = (await import('/src/config/GameConfig.js')).RAGE;
  const b = new Boss(gs, 'boss_test', { maxHp: 1000, pattern: 'fan', color: 0xff0000, difficulty: 1 });
  gs.tweens.killTweensOf(b);   // 停掉入场 tween
  b._entering = false;
  b.hp = 1000;
  b.hit(900);                   // hp=100 < 15% → 触发狂暴
  const now = gs.time.now;
  const firstGap = b._enrageFireUntil - now;   // 首组风暴最早发射间隔
  // 后续组间歇仍为 fireGapMs：直接推进 _updateEnrage 让首组立即发射后检查下一组
  b._enrageWindowStart = now;   // 防 DPS 结算
  b._enrageEscUntil = 0;
  b._enrageFireUntil = now;
  let stormFired = 0;
  const orig = b._patternEnrageStorm.bind(b);
  b._patternEnrageStorm = () => { stormFired++; };
  b._updateEnrage(0);
  b._patternEnrageStorm = orig;
  const secondGap = b._enrageFireUntil - gs.time.now;
  return { firstGap, secondGap, fireGapMs: R.fireGapMs, stormFired };
});
push('D2 首组狂暴弹幕最早发射 ≥1.2s（入场演出窗口）',
  d2.firstGap >= 1195 && d2.firstGap >= d2.fireGapMs, `firstGap=${d2.firstGap}ms`);
push('D2 后续组间歇仍为 fireGapMs=500（仅首组让出演出窗口）',
  Math.abs(d2.secondGap - d2.fireGapMs) <= 3 && d2.stormFired >= 1,
  `secondGap=${d2.secondGap}ms stormFired=${d2.stormFired}`);
const d2Wiring = await page.evaluate(async () => {
  const src = await (await fetch('/src/entities/Boss.js')).text();
  return src.includes('Math.max(RAGE.fireGapMs, 1200)');
});
push('D2 静态接线：Boss.js 使用 max(fireGapMs,1200) 置首组窗口', d2Wiring === true);

// ═══════════════════════════════════════════════════════════════
// D4 负面变异延迟内死亡不丢变异（仅 gameEnded 跳过）
// ═══════════════════════════════════════════════════════════════
await startGame(page, 1, 'normal');
const d4 = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  // Part A：玩家死亡(active=false)但本局未结束 → 负面变异 1s 后仍落地
  gs.mutations = {};
  gs.gameEnded = false;
  gs.player.active = false;
  const negIds = [];
  for (let i = 0; i < 60 && negIds.length < 3; i++) {
    const r = gs.applyMutation();
    if (r.polarity === 'negative') negIds.push(r.id);
  }
  await sleep(1300);
  const landedAfterDeath = negIds.length > 0 && negIds.every((id) => (gs.mutations[id] || 0) >= 1);
  // Part B：gameEnded → 跳过（不叠无意义变异）
  gs.gameEnded = true;
  gs.player.active = true;
  let neg2 = null;
  for (let i = 0; i < 60 && !neg2; i++) {
    const r = gs.applyMutation();
    if (r.polarity === 'negative') neg2 = r.id;
  }
  const beforeGameEnd = (gs.mutations[neg2] || 0);
  await sleep(1300);
  const landedAfterGameEnd = (gs.mutations[neg2] || 0) > beforeGameEnd;
  gs.gameEnded = false;
  return { negCount: negIds.length, landedAfterDeath, neg2, beforeGameEnd, landedAfterGameEnd };
});
push('D4 死亡(active=false)期间负面变异仍落地（不丢变异）',
  d4.negCount >= 1 && d4.landedAfterDeath === true,
  `neg=${d4.negCount} landed=${d4.landedAfterDeath}`);
push('D4 gameEnded 时负面变异跳过（不叠无意义变异）',
  d4.neg2 !== null && d4.landedAfterGameEnd === false,
  `neg2=${d4.neg2} landed=${d4.landedAfterGameEnd}`);
const d4Wiring = await page.evaluate(async () => {
  const src = await (await fetch('/src/scenes/GameScene.js')).text();
  return src.includes('D4 P3 修复') && src.includes('if (this.gameEnded) return;')
    && !src.includes('if (this.gameEnded || !this.player || !this.player.active) return;');
});
push('D4 静态接线：延迟回调仅判 gameEnded（移除 !player.active 守卫）', d4Wiring === true);

// ═══════════════════════════════════════════════════════════════
// D3 SAVE_FAILED 不再静默（放最后：会置 SaveManager 降级态）
// ═══════════════════════════════════════════════════════════════
const d3 = await page.evaluate(async () => {
  const SaveManager = window.__SAVE;
  const { EventBus } = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  let fired = 0;
  const h = () => fired++;
  EventBus.on(EV.SAVE_FAILED, h);
  const origSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => { throw new Error('quota-exceeded'); };
  SaveManager.flushNow();          // 首次写失败 → 应 emit SAVE_FAILED
  localStorage.setItem = origSetItem;
  EventBus.off(EV.SAVE_FAILED, h);
  const ui = window.__SKY__.scene.getScene('UIScene');
  const hasHandler = typeof ui._onSaveFailed === 'function';
  // 触发 UIScene 处理器 → 应新增一个中心 Text（flashCenter 提示）
  const countText = () => (ui.children ? ui.children.list.filter((o) => o && o.type === 'Text').length : 0);
  const beforeText = countText();
  if (hasHandler) ui._onSaveFailed();
  const afterText = countText();
  return { fired, hasHandler, textGrew: afterText > beforeText, beforeText, afterText };
});
push('D3 SaveManager 首败 emit SAVE_FAILED（不再静默）', d3.fired === 1, `fired=${d3.fired}`);
push('D3 UIScene 注册 _onSaveFailed 并弹一次性中心提示',
  d3.hasHandler === true && d3.textGrew === true,
  `handler=${d3.hasHandler} text ${d3.beforeText}→${d3.afterText}`);
const d3Wiring = await page.evaluate(async () => {
  const uiSrc = await (await fetch('/src/scenes/UIScene.js')).text();
  const loc = await (await fetch('/src/config/Locale.js')).text();
  const sm = await (await fetch('/src/utils/SaveManager.js')).text();
  return {
    ui: uiSrc.includes('EventBus.on(EVENTS.SAVE_FAILED, this._onSaveFailed)'),
    zh: loc.includes("saveFailed: '存档失败，本次进度可能无法保存'"),
    en: loc.includes("saveFailed: 'Save failed — progress may not be kept'"),
    sm: sm.includes('EventBus.emit(EVENTS.SAVE_FAILED)'),
  };
});
push('D3 静态接线：UIScene 监听 / Locale zh+en / SaveManager emit',
  d3Wiring.ui && d3Wiring.zh && d3Wiring.en && d3Wiring.sm, JSON.stringify(d3Wiring));

// ── 零报错 ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_d1_d4_fixes: PASS ===' : '=== qa_opt13_d1_d4_fixes: FAIL ==='));
process.exit(pass ? 0 : 1);
