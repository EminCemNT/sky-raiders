// qa_lives_bestscore.mjs —— P1 命数复活 + 最高分存档 验收探针
//
// 验证：
//   1) PLAYER.START_LIVES=3 / RESPAWN_INVULN=1500 / EVENTS.LIVES_CHANGED 已登记
//   2) SaveManager.bestScore 默认 0，recordBestScore 破纪录写入 / 不降分 / 取整
//   3) 命数激活：局内 lives=START_LIVES，HUD 显示命数
//   4) 血归零消耗一命原地复活（active/hp回满/无敌闪烁），清屏救场清敌弹，damageTaken 不重置
//   5) 命尽才 endGame(false)
//   6) 破纪录后 ResultScene 显示「最高分」+「新纪录」；未破纪录不显示新纪录
//   7) 零 pageerror / console error
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

/** 进入一局全新 normal 第 1 关（复用同一 page，重启场景） */
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

/** 驱动 endGame 并等待 ResultScene 就绪，返回 ResultScene 相关快照 */
async function runEndGame(page, victory, score) {
  await page.evaluate(({ victory, score }) => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    gs.score = score;
    gs.stats = { kills: 0, coins: 0, damageTaken: 0, spawned: 1 };
    gs.difficultyCfg = { scoreMul: 1, coinMul: 1, hpMul: 1, speedMul: 1, bossBulletMul: 1 };
    gs.endGame(victory);
  }, { victory, score });
  await page.waitForFunction(() => {
    const rs = window.__SKY__.scene.getScene('ResultScene');
    return rs && rs.scene.isActive();
  }, { timeout: 20000 });
}

/** 收集 ResultScene 渲染出的所有 Text 文本 + result 关键字段 */
async function readResult(page) {
  return page.evaluate(() => {
    const rs = window.__SKY__.scene.getScene('ResultScene');
    const texts = [];
    const walk = (list) => list.forEach((c) => {
      if (c && c.type === 'Text') texts.push(c.text);
      if (c && c.list && c.list.length) walk(c.list);
    });
    walk(rs.children.list);
    return {
      isNewBest: rs.result.isNewBest,
      bestScore: rs.result.bestScore,
      hasNewText: texts.some((t) => t.includes('新纪录')),
      hasBestLine: texts.some((t) => t.includes('最高分')),
      best: window.__SAVE.load().bestScore,
    };
  });
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
// 等 MenuScene 就绪（确保资源加载完毕，避免提前 start GameScene）
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

// ── 1) 静态配置断言 ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  return { startLives: m.PLAYER.START_LIVES, respawnInvuln: m.PLAYER.RESPAWN_INVULN, livesEvent: m.EVENTS.LIVES_CHANGED };
});
push('PLAYER.START_LIVES=3', cfg.startLives === 3, `got ${cfg.startLives}`);
push('RESPAWN_INVULN=1500（约1.5s无敌）', cfg.respawnInvuln === 1500, `got ${cfg.respawnInvuln}`);
push('EVENTS.LIVES_CHANGED 已登记', !!cfg.livesEvent, cfg.livesEvent);

// ── 2) SaveManager.bestScore 写入语义 ──
const sm = await page.evaluate(() => {
  window.__SAVE.set('bestScore', 0);
  const a = window.__SAVE.recordBestScore(500);
  const b = window.__SAVE.recordBestScore(400);
  const after500 = window.__SAVE.load().bestScore;
  window.__SAVE.set('bestScore', 0);
  const floorOk = window.__SAVE.recordBestScore(123.9);
  const floored = window.__SAVE.load().bestScore;
  return { a, b, after500, floorOk, floored };
});
push('recordBestScore 首次写入 true', sm.a === true);
push('recordBestScore 更低分 false（不降分）', sm.b === false && sm.after500 === 500, `after=${sm.after500}`);
push('recordBestScore 取整（123.9→123）', sm.floorOk === true && sm.floored === 123, `floored=${sm.floored}`);

// ── 3) 命数激活 + HUD ──
await startGame(page);
const initLives = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  return { lives: gs.lives, hud: ui.livesText ? ui.livesText.text : null };
});
push('局内 lives=START_LIVES(3)', initLives.lives === 3, `lives=${initLives.lives}`);
push('HUD 显示剩余命数「命 ×3」', initLives.hud === '命 ×3', initLives.hud);

// ── 4) 血归零消耗一命原地复活（含清屏救场 + damageTaken 不重置）──
const respawn = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  gs.stats.damageTaken = 42; // 标记：复活不得重置受击累计
  p.shield = 0;
  // 预置一枚敌弹，验证复活清屏救场
  const eb = gs.enemyBullets.get(270, 300, 'bullet_enemy');
  if (eb) { eb.setActive(true).setVisible(true); if (eb.body) eb.body.enable = true; }
  p.takeDamage(99999);
  return {
    lives: gs.lives,
    active: p.active,
    hp: p.hp, maxHp: p.maxHp,
    invuln: p.invulnUntil > gs.time.now,
    damageTaken: gs.stats.damageTaken,
    gameEnded: gs.gameEnded,
    bulletCleared: eb ? (eb.active === false) : false,
  };
});
push('血归零消耗一命（lives 3→2）', respawn.lives === 2, `lives=${respawn.lives}`);
push('原地复活：active=true 且 hp 回满', respawn.active === true && respawn.hp === respawn.maxHp, `hp=${respawn.hp}/${respawn.maxHp}`);
push('复活后无敌闪烁激活（invulnUntil 在未来）', respawn.invuln === true);
push('复活不重置 damageTaken（42）', respawn.damageTaken === 42, `damageTaken=${respawn.damageTaken}`);
push('复活时未结算（gameEnded=false）', respawn.gameEnded === false);
push('清屏救场：敌弹被清除', respawn.bulletCleared === true);

const hudAfterDeath = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui.livesText ? ui.livesText.text : null;
});
push('HUD 命数更新为「命 ×2」', hudAfterDeath === '命 ×2', hudAfterDeath);

// ── 5) 命尽才 endGame(false) ──
const exhausted = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  gs.lives = 1; // 只剩 1 命：下一次死亡即命尽
  p.invulnUntil = 0;
  p.shield = 0;
  p.takeDamage(99999);
  return { lives: gs.lives, gameEnded: gs.gameEnded, active: p.active };
});
push('命尽才 endGame（lives=0 且 gameEnded=true）',
  exhausted.lives === 0 && exhausted.gameEnded === true,
  `lives=${exhausted.lives} ended=${exhausted.gameEnded}`);

await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive();
}, { timeout: 20000 });
const failResult = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return { victory: rs.result.victory };
});
push('命尽结算为失败（victory=false）', failResult.victory === false, `victory=${failResult.victory}`);

// ── 6a) 破纪录：ResultScene 显示最高分 + 新纪录 ──
await page.evaluate(() => window.__SAVE.set('bestScore', 0));
await startGame(page);
await runEndGame(page, true, 1000);
const rec = await readResult(page);
push('破纪录：result.isNewBest=true', rec.isNewBest === true);
push('破纪录：bestScore 存档=1000', rec.best === 1000, `best=${rec.best}`);
push('ResultScene 显示「最高分」', rec.hasBestLine === true);
push('ResultScene 显示「新纪录」标识', rec.hasNewText === true);

// ── 6b) 未破纪录：不显示新纪录 ──
await page.evaluate(() => window.__SAVE.set('bestScore', 5000));
await startGame(page);
await runEndGame(page, true, 1000);
const norec = await readResult(page);
push('未破纪录：isNewBest=false', norec.isNewBest === false);
push('未破纪录：bestScore 保持 5000', norec.best === 5000, `best=${norec.best}`);
push('未破纪录：ResultScene 无「新纪录」', norec.hasNewText === false);

push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_lives_bestscore: PASS ===' : '=== qa_lives_bestscore: FAIL ==='));
process.exit(pass ? 0 : 1);
