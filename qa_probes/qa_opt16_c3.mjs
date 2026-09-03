// qa_opt16_c3.mjs —— OPT-16 批1 C3 战后复盘 验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C3 条。断言真实运行行为：
//   C3.1  GameScene.endGame payload 透传 grazes/elapsedMs/damageTaken（只读，不入存档）
//   C3.2  ResultScene 详情行追加「擦弹/局时长/受击」三行，且在 resBest 之前（全模式一致）
//   C3.3  _fmtDuration：95_000→'1:35'；42_000→'0:42'；0→'0:00'（<1min 前导 0）
//   C3.4  i18n zh/en：resGrazes/resTime/resHits 词条齐全，en 显示英文
//   C3.5  行距自适应：normal 胜利 3 按钮（7-8 行）与 endless 多行场景，按钮均不越界（中心≤919、底缘≤960）
//   C3.6  红线：SaveManager 不写入 grazes/elapsedMs/damageTaken（C3 零存档改动）
// 运行：node qa_probes/qa_opt16_c3.mjs（QA_URL 默认 http://127.0.0.1:5059）
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };

async function launchPage(saveObj) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save }) => {
    try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }, { key: SAVE_KEY, save: saveObj });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error('launchPage timeout: ' + errors.slice(0, 3).join(' | ') || '(no console error)');
  }
  return { ctx, page, errors };
}

// ── i18n 词条 ──
async function checkLocale(page) {
  return page.evaluate(async () => {
    const { L } = await import('/src/config/Locale.js');
    const keys = ['resGrazes', 'resTime', 'resHits'];
    const all = keys.every((k) => typeof L.zh[k] === 'string' && L.zh[k].length > 0
      && typeof L.en[k] === 'string' && L.en[k].length > 0);
    return { all, zh: keys.map((k) => L.zh[k]), en: keys.map((k) => L.en[k]) };
  });
}

// ── 直接以 payload 启动 ResultScene，收集数据行文本 ──
// 返回 { linesText: 数据行文本数组, texts: 全部 Text 文本, btns: 底缘>450 的按钮容器 y 数组 }
async function startResultAndInspect(page, payload) {
  return page.evaluate((data) => {
    window.__RESULT_SHARE = null;
    window.__SKY__.scene.start('ResultScene', data);
    return true;
  }, payload).then(async () => {
    await page.waitForFunction(() => {
      const rs = window.__SKY__.scene.getScene('ResultScene');
      return rs && rs.scene.isActive() && rs.children && rs.children.list.some((c) => c && c.type === 'Text');
    }, null, { timeout: 20000 });
    // 等 create 完成（含 _initShareHooks 挂载 + 文本就位）
    await page.waitForFunction(() => {
      const rs = window.__SKY__.scene.getScene('ResultScene');
      return rs && rs.children && rs.children.list.some((c) => c && c.type === 'Text' && String(c.text).includes('擦弹'));
    }, null, { timeout: 20000 }).catch(() => {}); // en 语境下不含「擦弹」，仅 zh 用
    await new Promise((r) => setTimeout(r, 120)); // 让星级弹入 tween 不干扰文本枚举
    return page.evaluate(() => {
      const rs = window.__SKY__.scene.getScene('ResultScene');
      const texts = rs.children.list.filter((c) => c && c.type === 'Text').map((c) => String(c.text));
      // 按钮容器：NeonButton 以 name='neon-button' 标记；剔除右上分享按钮（y=128），取动作区 y>450
      const btns = rs.children.list
        .filter((c) => c && c.name === 'neon-button' && typeof c.y === 'number' && c.y > 450)
        .map((c) => c.y)
        .sort((a, b) => a - b);
      return { texts, btns };
    });
  });
}

// ── 真实 GameScene.endGame 链路：mock 局内统计 → endGame(true) → 等 ResultScene ──
async function enterBattle(page) {
  await page.evaluate(async () => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
    await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const gs = game.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
      }, 50);
    });
  });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.player && gs.player.active;
  }, null, { timeout: 10000 });
}

async function driveRealEndGame(page) {
  await page.evaluate(async () => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    // mock 局内统计（规格 C3 探针建议）：擦弹 37、局时长 95s、受击 3
    gs.grazeCount = 37;
    gs._levelStartTime = gs.time.now - 95000;
    gs.stats.damageTaken = 3;
    gs.endGame(true);
  });
  // endGame 内部 delayedCall(600) → transition.goto(ResultScene)
  await page.waitForFunction(() => {
    const rs = window.__SKY__.scene.getScene('ResultScene');
    return rs && rs.scene.isActive();
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const rs = window.__SKY__.scene.getScene('ResultScene');
    return rs && rs.children && rs.children.list.some((c) => c && c.type === 'Text' && String(c.text).includes('擦弹'));
  }, null, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 200));
  return page.evaluate(() => {
    const rs = window.__SKY__.scene.getScene('ResultScene');
    const texts = rs.children.list.filter((c) => c && c.type === 'Text').map((c) => String(c.text));
    const sv = window.__SAVE.load();
    const hasNewFields = 'grazes' in sv || 'elapsedMs' in sv || 'damageTaken' in sv;
    return { texts, hasNewFields };
  });
}

// ═══════════════ 主流程 ═══════════════
const zhSave = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 100,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 } };

// 1) i18n 词条（zh/en）
const zhCtx = await launchPage(zhSave);
const loc = await checkLocale(zhCtx.page);
push('C3.4. i18n zh/en resGrazes/resTime/resHits 词条齐全', loc.all === true, `zh=${loc.zh.join('/')} en=${loc.en.join('/')}`);

// 2) zh：普通关 victory（3 按钮，含勋章 8 行）—— 详情三行 + resBest 在最后 + 按钮不越界
const zhNormal = await startResultAndInspect(zhCtx.page, {
  levelId: 1, mode: 'normal', victory: true, score: 1200, kills: 20, coins: 30,
  maxCombo: 5, stars: 3, composite: 0.95, bestScore: 500, isNewBest: true,
  grazes: 37, elapsedMs: 95000, damageTaken: 3,
  achievedMedals: ['killRate_1'], difficulty: 'standard', ship: { id: 0, skin: 0 },
});
const zhHasGraze = zhNormal.texts.some((s) => s.includes('擦弹') && s.includes('37'));
const zhHasTime = zhNormal.texts.some((s) => s.includes('局时长') && s.includes('1:35'));
const zhHasHits = zhNormal.texts.some((s) => s.includes('受击') && s.includes('3'));
const zhIdxGraze = zhNormal.texts.findIndex((s) => s.includes('擦弹'));
const zhIdxBest = zhNormal.texts.findIndex((s) => s.includes('最高分'));
const zhBtnMax = zhNormal.btns.length ? Math.max(...zhNormal.btns) : -1;
push('C3.2. zh 详情行：擦弹 37 显示', zhHasGraze, `hit=${zhHasGraze}`);
push('C3.2. zh 详情行：局时长 1:35 显示', zhHasTime, `hit=${zhHasTime}`);
push('C3.2. zh 详情行：受击 3 显示', zhHasHits, `hit=${zhHasHits}`);
push('C3.2. zh 行序：擦弹/局时长/受击 在 resBest 之前', zhIdxGraze >= 0 && zhIdxBest > zhIdxGraze, `grazeIdx=${zhIdxGraze} bestIdx=${zhIdxBest}`);
push('C3.5. zh normal 胜利 3 按钮不越界（中心≤919）', zhBtnMax > 0 && zhBtnMax <= 919, `btnMaxY=${zhBtnMax} btns=${JSON.stringify(zhNormal.btns)}`);

// 3) zh：endless（多行 ~10 行 + 2 按钮）—— 按钮仍不越界
const zhEndless = await startResultAndInspect(zhCtx.page, {
  levelId: 1, mode: 'endless', victory: true, score: 800, kills: 30, coins: 20,
  maxCombo: 8, stars: 2, composite: 0.7, bestScore: 600, isNewBest: false,
  grazes: 12, elapsedMs: 62000, damageTaken: 1, wave: 5, towerFloor: 4, topRank: 3,
  ship: { id: 0, skin: 0 },
});
const zhEndBtnMax = zhEndless.btns.length ? Math.max(...zhEndless.btns) : -1;
const zhEndTime = zhEndless.texts.some((s) => s.includes('局时长') && s.includes('1:02'));
push('C3.5. zh endless 多行 2 按钮不越界（中心≤919，底缘≤960）',
  zhEndBtnMax > 0 && zhEndBtnMax <= 919 && zhEndBtnMax + 29 <= 960, `btnMaxY=${zhEndBtnMax} btns=${JSON.stringify(zhEndless.btns)}`);
push('C3.2. zh endless 局时长 62000→1:02 显示', zhEndTime, `hit=${zhEndTime}`);

// 4) _fmtDuration 边界（直接调实例私有方法）
const fmt = await zhCtx.page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return {
    a: rs._fmtDuration(95000), b: rs._fmtDuration(42000), c: rs._fmtDuration(0), d: rs._fmtDuration(-5000),
  };
});
push('C3.3. _fmtDuration(95000) = 1:35', fmt.a === '1:35', `got=${fmt.a}`);
push('C3.3. _fmtDuration(42000) = 0:42（<1min 前导 0）', fmt.b === '0:42', `got=${fmt.b}`);
push('C3.3. _fmtDuration(0) = 0:00 / 负数 clamp 0:00', fmt.c === '0:00' && fmt.d === '0:00', `0=${fmt.c} neg=${fmt.d}`);

// 5) 真实 GameScene → endGame 链路（zh）
// 注意：上方 startResultAndInspect 用 SceneManager.start('ResultScene') 已把 GameScene 关闭，
//     需先重新进战斗（create 重建 stats），再 mock 局内统计并驱动 endGame。
await enterBattle(zhCtx.page);
const realZh = await driveRealEndGame(zhCtx.page);
const realHasGraze = realZh.texts.some((s) => s.includes('擦弹') && s.includes('37'));
const realHasTime = realZh.texts.some((s) => s.includes('局时长') && s.includes('1:35'));
const realHasHits = realZh.texts.some((s) => s.includes('受击') && s.includes('3'));
push('C3.1. GameScene.endGame payload → ResultScene：擦弹 37', realHasGraze, `hit=${realHasGraze}`);
push('C3.1. GameScene.endGame payload → ResultScene：局时长 1:35', realHasTime, `hit=${realHasTime}`);
push('C3.1. GameScene.endGame payload → ResultScene：受击 3', realHasHits, `hit=${realHasHits}`);
push('C3.6. 红线：SaveManager 不写 grazes/elapsedMs/damageTaken（C3 零存档改动）', realZh.hasNewFields === false, `hasNewFields=${realZh.hasNewFields}`);
push('P0. zh 主上下文无 pageerror/console.error', zhCtx.errors.length === 0, zhCtx.errors.slice(0, 3).join(' | '));
await zhCtx.ctx.close();

// 6) en：词条英文断言（独立上下文 lang=en）
const enCtx = await launchPage({ ...zhSave, lang: 'en' });
const enNormal = await startResultAndInspect(enCtx.page, {
  levelId: 1, mode: 'normal', victory: true, score: 900, kills: 10, coins: 10,
  maxCombo: 3, stars: 2, composite: 0.7, bestScore: 300, isNewBest: false,
  grazes: 7, elapsedMs: 95000, damageTaken: 2, ship: { id: 0, skin: 0 },
});
const enHasGraze = enNormal.texts.some((s) => s.includes('Grazes') && s.includes('7'));
const enHasTime = enNormal.texts.some((s) => s.includes('Time') && s.includes('1:35'));
const enHasHits = enNormal.texts.some((s) => s.includes('Hits Taken') && s.includes('2'));
push('C3.4. en 详情行：Grazes 7', enHasGraze, `hit=${enHasGraze}`);
push('C3.4. en 详情行：Time 1:35', enHasTime, `hit=${enHasTime}`);
push('C3.4. en 详情行：Hits Taken 2', enHasHits, `hit=${enHasHits}`);
push('P0. en 上下文无 pageerror/console.error', enCtx.errors.length === 0, enCtx.errors.slice(0, 3).join(' | '));
await enCtx.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C3 战后复盘探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
