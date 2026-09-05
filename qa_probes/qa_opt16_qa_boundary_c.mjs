// qa_opt16_qa_boundary_c.mjs —— QA-OPT 独立边界探针：OPT-16 C1/C5/C6/C10 补强审计
//
//   独立于 coder-opt 的 c1/c5/c6/c10 探针，补测实现者未直接断言、但规格要求/易回归的边界：
//   A. C1 存量豁免贯穿到战斗：selectedDifficulty='hell' + 勋章不足 → 进 normal 战斗仍按 hell 系数（不自动回退）
//   B. C5 独立结算域：daily 局失败不误增 normal failStreak；daily 抑制不反向泄漏到后续 normal 局；
//      daily 局内拾取金币照常入账（防刷的镜像：正常局仍正常写榜）
//   C. C6 主动重开：failStreak 不计（主动放弃≠失败）、重开 score 归 0、新局不弹救济
//   D. C10 hell 高难仅 phase3 + 0.33 边界 + 狂暴让位真实路径 + standard 零出现
//
// 运行：node qa_probes/qa_opt16_qa_boundary_c.mjs （QA_URL 默认 http://127.0.0.1:5059）
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

async function launchPage(save) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save: s }) => {
    try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }, { key: SAVE_KEY, save });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
  return { ctx, page, errors };
}

// 启动指定模式的战斗局（normal/daily），等待 player 就绪
async function startBattle(page, mode, extra) {
  await page.evaluate(async ({ mode, extra }) => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
    const data = Object.assign({ mode, levelId: 1 }, extra || {});
    game.scene.start('GameScene', data);
    game.scene.start('UIScene', data);
    await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const gs = game.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
      }, 50);
    });
  }, { mode, extra });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.player && gs.player.active;
  }, null, { timeout: 10000 });
}

const base = (o) => Object.assign({
  lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 0, selectedDifficulty: 'standard', unlockedLevel: 1,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 },
}, o);

// ═══════════════ A 组：C1 存量豁免贯穿战斗 ═══════════════
console.log('\n=== A. C1 存量豁免：已选 hell 老档(勋章不足) 进战斗仍按 hell ===');
{
  const A = await launchPage(base({ selectedDifficulty: 'hell', levelMedals: {} })); // countMedals=0 < 6
  try {
    await startBattle(A.page, 'normal', {});
    const r = await A.page.evaluate(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      return { diff: gs.difficultyCfg && gs.difficultyCfg.id, mode: gs.mode };
    });
    push('A1. 存量 hell(0勋章) 进 normal 战斗 → difficultyCfg.id=hell（不自动回退）', r.diff === 'hell', `diff=${r.diff}`);
  } catch (e) { push('A 组异常', false, String(e && e.message || e)); }
  await A.ctx.close().catch(() => {});
}

// ═══════════════ B 组：C5 独立结算域 ═══════════════
console.log('\n=== B. C5 独立结算域：failStreak 不误增 / 反向不泄漏 / 金币入账 ===');
{
  const B = await launchPage(base({ coins: 0, failStreak: { 1: 2 } }));
  try {
    // B1/B2: daily 局内真实拾取金币 + 失败结束
    const preFail = await B.page.evaluate(() => window.__SAVE.getFailStreak(1));
    const preCoins = await B.page.evaluate(() => (window.__SAVE.load().coins) || 0);
    await startBattle(B.page, 'daily', { dailySeed: 'testseed' });
    const pickCoins = await B.page.evaluate(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      gs.spawnCoin(200, 300);
      const coin = (gs.coins.getChildren() || []).find((c) => c && c.active);
      if (coin) gs.collectCoin(coin); // 真实拾取路径：SaveManager.addCoins(1) 无条件（daily 不抑制金币）
      return true;
    });
    await B.page.evaluate(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      gs.score = 10000;
      gs.stats.spawned = Math.max(gs.stats.spawned || 0, 1);
      gs.endGame(false);                   // daily 失败
    });
    await B.page.waitForFunction(() => {
      const rs = window.__SKY__.scene.getScene('ResultScene');
      return rs && rs.scene.isActive();
    }, null, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300));
    const afterDaily = await B.page.evaluate(() => {
      const sv = window.__SAVE.load();
      return {
        fail: sv.failStreak && sv.failStreak[1] ? sv.failStreak[1] : 0,
        coins: sv.coins || 0,
        topLen: (sv.topScores || []).length,
        dc: sv.dailyChallenge,
      };
    });
    push('B1. daily 失败局 → normal failStreak[1] 不增（独立结算域）', afterDaily.fail === preFail && preFail === 2, `pre=${preFail} post=${afterDaily.fail}`);
    push('B2. daily 局真实拾取金币 → coins +1 即时入账（打得不白打）', pickCoins === true && afterDaily.coins === preCoins + 1, `pre=${preCoins} post=${afterDaily.coins}`);
    push('B3. daily 失败局不写 topScores', afterDaily.topLen === 0, `topLen=${afterDaily.topLen}`);
    push('B4. daily 失败局不写 failStreak（dailyChallenge 域）→ dc 存在', !!afterDaily.dc, JSON.stringify(afterDaily.dc));

    // B5: 反向不泄漏——daily 后立即 normal 胜利局正常写榜/成就
    const preTop = afterDaily.topLen;
    await startBattle(B.page, 'normal', {});
    await B.page.evaluate(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      gs.score = 5000;
      gs.stats.spawned = Math.max(gs.stats.spawned || 0, 1);
      gs.stats.coins = 0; gs.stats.damageTaken = 0;
      gs.endGame(true);
    });
    await B.page.waitForFunction(() => {
      const rs = window.__SKY__.scene.getScene('ResultScene');
      return rs && rs.scene.isActive();
    }, null, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300));
    const norm = await B.page.evaluate(() => {
      const sv = window.__SAVE.load();
      return { topLen: (sv.topScores || []).length, fail: sv.failStreak && sv.failStreak[1] ? sv.failStreak[1] : 0 };
    });
    push('B5. daily 后立即 normal 胜利 → topScores 正常 +1（daily 抑制不反向泄漏）', norm.topLen === preTop + 1, `pre=${preTop} post=${norm.topLen}`);
    push('B6. daily 后 normal 胜利 → failStreak[1] 正常归 0（normal 胜利链路不受 daily 影响）', norm.fail === 0, `fail=${norm.fail}`);
  } catch (e) { push('B 组异常', false, String(e && e.message || e)); }
  await B.ctx.close().catch(() => {});
}

// ═══════════════ C 组：C6 主动重开 failStreak 不计 + 状态清零 ═══════════════
console.log('\n=== C. C6 主动重开：failStreak 不计 / score 清零 / 不弹救济 ===');
{
  const C = await launchPage(base({ failStreak: { 1: 2 }, coins: 99 }));
  try {
    await startBattle(C.page, 'normal', {});
    // 打点分再重开
    const pre = await C.page.evaluate(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      gs.score = 7777;
      gs.stats.coins = 50;
      return { fail: window.__SAVE.getFailStreak(1), score: gs.score };
    });
    await C.page.evaluate(() => {
      const uis = window.__SKY__.scene.getScene('UIScene');
      uis._paused = true;
      uis._doRestart(); // 真实重开路径（主动放弃，不进 endGame）
    });
    await C.page.waitForFunction(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      const uis = window.__SKY__.scene.getScene('UIScene');
      return gs && gs.player && gs.player.active && uis && uis._paused === false;
    }, null, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));
    const post = await C.page.evaluate(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      return {
        fail: window.__SAVE.getFailStreak(1),
        score: gs.score,
        mode: gs.mode,
        levelId: gs.levelId,
        reliefRun: !!gs._reliefRun,
        reliefOpen: !!gs._reliefOpen,
        lives: gs.lives,
      };
    });
    push('C1. 主动重开（非救济，failStreak=2）→ failStreak[1] 不计（仍 2，非 3）', post.fail === pre.fail && post.fail === 2, `pre=${pre.fail} post=${post.fail}`);
    push('C2. 重开后 score 归 0（本局进度不保留，等同放弃）', post.score === 0, `score=${post.score}`);
    push('C3. 重开后 mode/levelId 与本局相同（normal/1）', post.mode === 'normal' && post.levelId === 1, `mode=${post.mode} lv=${post.levelId}`);
    push('C4. 重开不弹救济面板（failStreak=2<3 且重开非失败）', post.reliefRun === false && post.reliefOpen === false, `relief=${post.reliefRun}/${post.reliefOpen}`);
  } catch (e) { push('C 组异常', false, String(e && e.message || e)); }
  await C.ctx.close().catch(() => {});
}

// ═══════════════ D 组：C10 hell phase3/0.33 边界/狂暴让位 + standard 对照 ═══════════════
console.log('\n=== D. C10 hell 高难仅 phase3 + 边界 + 狂暴让位（真实路径）；standard 零出现 ===');

// hell 档：进战斗 difficultyCfg.id=hell → spawnBoss → hardPhase=true
{
  const D = await launchPage(base({ selectedDifficulty: 'hell' }));
  try {
    await startBattle(D.page, 'normal', {});
    const out = await D.page.evaluate(async () => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      if (typeof gs.spawnBoss !== 'function') return { err: 'no spawnBoss' };
      gs.spawnBoss('boss_sentinel', {});
      const t0 = performance.now();
      await new Promise((res) => {
        const iv = setInterval(() => {
          if (gs.boss && gs.boss.active) { clearInterval(iv); res(); }
          else if (performance.now() - t0 > 5000) { clearInterval(iv); res(); }
        }, 30);
      });
      const b = gs.boss;
      if (!b || !b.active) return { err: 'boss not active' };
      const res = { hardPhase: b.hardPhase, diff: gs.difficultyCfg && gs.difficultyCfg.id, maxHp: b.maxHp };
      b._entering = false; // 入场态结束（否则 hit() 无敌挡 phase 重算/狂暴触发）
      // phase2 段（hp≈0.5*max）：不走高难 → _hardPatIdx 保持
      b.hp = Math.floor(b.maxHp * 0.5);
      b.phase = 1;
      b.hit(1); // 触发 phase 重算（0.5 > 0.33 → phase2）
      const p2 = b.phase;
      const idx0 = b._hardPatIdx || 0;
      b.firePattern();
      const idxAfterPhase2 = b._hardPatIdx || 0;
      res.phase2 = { p2, idxUnchanged: idxAfterPhase2 === idx0 };
      // phase3 段（hp=0.3*max）：走高难 → _hardPatIdx 前进
      b.hp = Math.floor(b.maxHp * 0.3);
      b.hit(1); // ratio≈0.3 ≤0.33 → phase3
      const p3 = b.phase;
      const idx1 = b._hardPatIdx || 0;
      b.firePattern();
      const idxAfterPhase3 = b._hardPatIdx || 0;
      res.phase3 = { p3, advanced: idxAfterPhase3 === idx1 + 1 };
      // 0.33 边界：从 phase2 状态直接压到 hp=floor(0.33*max) → ratio≈0.33 → 进 phase3（档位含边界）
      b.hp = Math.floor(b.maxHp * 0.5);
      b.phase = 2;
      b.hit(1); // 复位到 phase2
      b.hp = Math.floor(b.maxHp * 0.33);
      b.hit(1); // ratio≈0.33 ≤0.33 → newPhase=3
      res.boundaryPhase = b.phase;
      // 狂暴真实路径：hp 压 <15% → _triggerEnrage → _enraging true → firePattern 不高难叠加
      b.hp = Math.floor(b.maxHp * 0.1);
      b.hit(1); // hit 内自动 _triggerEnrage（hp<15%）
      const enraged = !!b._enraging;
      const idx2 = b._hardPatIdx || 0;
      b.firePattern();
      const idxAfterEnrage = b._hardPatIdx || 0;
      res.enrage = { enraged, idxUnchanged: idxAfterEnrage === idx2 };
      return res;
    });
    if (out.err) push('D 组执行', false, out.err);
    else {
      push('D1. hell 档 spawnBoss → boss.hardPhase=true（difficulty=hell）', out.hardPhase === true && out.diff === 'hell', `hardPhase=${out.hardPhase} diff=${out.diff}`);
      push('D2. hp≈0.5(max) → phase2 且 firePattern 不走高难（_hardPatIdx 不变）', out.phase2.p2 === 2 && out.phase2.idxUnchanged === true, JSON.stringify(out.phase2));
      push('D3. hp≈0.3(max) → phase3 且 firePattern 走高难（_hardPatIdx 前进）', out.phase3.p3 === 3 && out.phase3.advanced === true, JSON.stringify(out.phase3));
      push('D4. 0.33 边界（hp=floor(0.33*max)）→ phase3（血量≤0.33 档含边界）', out.boundaryPhase === 3, `boundaryPhase=${out.boundaryPhase}`);
      push('D5. hp<15% 真实 _triggerEnrage → _enraging=true 且 firePattern 不高难叠加（狂暴让位）', out.enrage.enraged === true && out.enrage.idxUnchanged === true, JSON.stringify(out.enrage));
    }
  } catch (e) { push('D hell 异常', false, String(e && e.message || e)); }
  await D.ctx.close().catch(() => {});
}

// standard 档对照：hardPhase=false 恒不高难
{
  const S = await launchPage(base({ selectedDifficulty: 'standard' }));
  try {
    await startBattle(S.page, 'normal', {});
    const out = await S.page.evaluate(async () => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      gs.spawnBoss('boss_sentinel', {});
      const t0 = performance.now();
      await new Promise((res) => {
        const iv = setInterval(() => {
          if (gs.boss && gs.boss.active) { clearInterval(iv); res(); }
          else if (performance.now() - t0 > 5000) { clearInterval(iv); res(); }
        }, 30);
      });
      const b = gs.boss;
      if (!b || !b.active) return { err: 'boss not active' };
      b._entering = false; // 入场态结束（否则 hit() 挡 phase 重算）
      b.hp = Math.floor(b.maxHp * 0.3);
      b.hit(1); // phase3
      const idx0 = b._hardPatIdx || 0;
      b.firePattern();
      return { hardPhase: b.hardPhase, diff: gs.difficultyCfg && gs.difficultyCfg.id, phase: b.phase, idxUnchanged: (b._hardPatIdx || 0) === idx0 };
    });
    if (out.err) push('standard 对照执行', false, out.err);
    else {
      push('D6. standard 档 spawnBoss → hardPhase=false（非 hell 零出现）', out.hardPhase === false && out.diff === 'standard', `hardPhase=${out.hardPhase} diff=${out.diff}`);
      push('D7. standard phase3 firePattern → 不高难（_hardPatIdx 不变）', out.phase === 3 && out.idxUnchanged === true, JSON.stringify({ phase: out.phase, idxUnchanged: out.idxUnchanged }));
    }
  } catch (e) { push('D standard 异常', false, String(e && e.message || e)); }
  await S.ctx.close().catch(() => {});
}

console.log('\n=== 汇总 ===');
const pass = checks.filter((c) => c.ok).length;
console.log(`PASS ${pass}/${checks.length}`);
await browser.close();
if (pass !== checks.length) process.exit(1);
