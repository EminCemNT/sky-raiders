// qa_difficulty.mjs —— P0 四档难度系统验收探针
//
// 验证：
//   1) GameConfig.DIFFICULTIES 四档存在、id 顺序正确
//   2) getDifficulty(id) 各档系数正确，未知 id 回退 standard，标准档全 1.0
//   3) SaveManager.selectedDifficulty 默认 standard，切换后更新
//   4) 非法档（脏存档）在 load() 时清洗回退 standard
//   5) GameScene 里 Enemy HP 按 hpMul 缩放：切 hard 后敌 HP 变大（20 → 28）
//   6) 标准档 vs 困难档 系数生效（difficultyCfg 读取正确）
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

/** 进入指定难度的 GameScene（复用同一 page，重启场景） */
async function startGame(page, diff) {
  await page.evaluate((d) => {
    const game = window.__SKY__;
    window.__SAVE.set('selectedDifficulty', d);
    window.__SAVE.set('tutorialDone', true);
    game.scene.stop('MenuScene');
    game.scene.stop('UIScene');
    game.scene.stop('GameScene');
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  }, diff);
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

// ── 1) 静态断言：DIFFICULTIES + getDifficulty ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const byId = Object.fromEntries(m.DIFFICULTIES.map((d) => [d.id, d]));
  return {
    len: m.DIFFICULTIES.length,
    ids: m.DIFFICULTIES.map((d) => d.id),
    names: m.DIFFICULTIES.map((d) => d.name),
    standard: m.getDifficulty('standard'),
    casual: m.getDifficulty('casual'),
    hard: m.getDifficulty('hard'),
    hell: m.getDifficulty('hell'),
    fallback: m.getDifficulty('__nope__'),
    saveKey: m.SAVE_KEY,
  };
});

push('DIFFICULTIES 共 4 档', cfg.len === 4, `got ${cfg.len}`);
push('四档 id 顺序', JSON.stringify(cfg.ids) === JSON.stringify(['casual', 'standard', 'hard', 'hell']), cfg.ids.join(','));
push('四档名称', JSON.stringify(cfg.names) === JSON.stringify(['休闲', '标准', '困难', '地狱']), cfg.names.join(','));
push('casual 系数 0.7/0.85/0.85/0.8/0.9',
  cfg.casual.hpMul === 0.7 && cfg.casual.speedMul === 0.85 && cfg.casual.bossBulletMul === 0.85 && cfg.casual.scoreMul === 0.8 && cfg.casual.coinMul === 0.9);
push('hard 系数 1.4/1.15/1.2/1.3/1.2',
  cfg.hard.hpMul === 1.4 && cfg.hard.speedMul === 1.15 && cfg.hard.bossBulletMul === 1.2 && cfg.hard.scoreMul === 1.3 && cfg.hard.coinMul === 1.2);
push('hell 系数 2.0/1.3/1.5/1.8/1.5',
  cfg.hell.hpMul === 2.0 && cfg.hell.speedMul === 1.3 && cfg.hell.bossBulletMul === 1.5 && cfg.hell.scoreMul === 1.8 && cfg.hell.coinMul === 1.5);
push('标准档全 1.0（零回归基准）',
  cfg.standard.hpMul === 1.0 && cfg.standard.speedMul === 1.0 && cfg.standard.bossBulletMul === 1.0 && cfg.standard.scoreMul === 1.0 && cfg.standard.coinMul === 1.0);
push('getDifficulty 未知 id 回退 standard', cfg.fallback && cfg.fallback.id === 'standard', cfg.fallback && cfg.fallback.id);

// ── 2) SaveManager.selectedDifficulty 默认 / 切换 / 清洗 ──
const smDefault = await page.evaluate(() => window.__SAVE.load().selectedDifficulty);
push('默认 selectedDifficulty=standard', smDefault === 'standard', smDefault);

await page.evaluate(() => window.__SAVE.set('selectedDifficulty', 'hard'));
const smHard = await page.evaluate(() => window.__SAVE.load().selectedDifficulty);
push('切换后 selectedDifficulty=hard', smHard === 'hard', smHard);

// ── 2b) MenuScene 设置面板：难度按钮渲染 + 选中高亮 + 点击切换 ──
const ui = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openSettings();
  const btns = ms._difficultyBtns || [];
  const labels = btns.map((b) => b.btn.text.text);
  const selectedBefore = btns.filter((b) => b.btn.selected).map((b) => b.id);
  // 点击「休闲」：触发 onDown → 保存 + 刷新高亮
  const casual = btns.find((b) => b.id === 'casual');
  if (casual) casual.btn.container.emit('pointerdown');
  const after = window.__SAVE.load().selectedDifficulty;
  const selectedAfter = btns.filter((b) => b.btn.selected).map((b) => b.id);
  ms.closeSettings();
  return { labels, selectedBefore, after, selectedAfter };
});
push('设置面板渲染 4 档难度按钮', JSON.stringify(ui.labels) === JSON.stringify(['休闲', '标准', '困难', '地狱']), ui.labels.join(','));
push('当前档(hard)选中高亮', JSON.stringify(ui.selectedBefore) === JSON.stringify(['hard']), ui.selectedBefore.join(','));
push('点击「休闲」后 selectedDifficulty=casual', ui.after === 'casual', ui.after);
push('点击后高亮切换到 casual', JSON.stringify(ui.selectedAfter) === JSON.stringify(['casual']), ui.selectedAfter.join(','));

// ── 3) Enemy HP 缩放：standard vs hard ──
async function readEnemyHp(diff) {
  await startGame(page, diff);
  return page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const dcfg = gs.difficultyCfg || {};
    const e = gs.spawnEnemy(270, -40, 'small', 'straight', gs.level.difficulty || 1, 'straight');
    return {
      hp: e ? e.hp : -1,
      hpMul: dcfg.hpMul, speedMul: dcfg.speedMul,
      bossBulletMul: dcfg.bossBulletMul, scoreMul: dcfg.scoreMul, coinMul: dcfg.coinMul,
    };
  });
}

const std = await readEnemyHp('standard');
const hard = await readEnemyHp('hard');

push('标准档 small HP=20（difficulty 1.0 × hpMul 1.0）', std.hp === 20, `hp=${std.hp}`);
push('困难档 small HP=28（difficulty 1.0 × hpMul 1.4）', hard.hp === 28, `hp=${hard.hp}`);
push('切 hard 后敌 HP 变大', hard.hp > std.hp, `${std.hp} → ${hard.hp}`);
push('标准档 difficultyCfg 系数全 1.0',
  std.hpMul === 1.0 && std.speedMul === 1.0 && std.bossBulletMul === 1.0 && std.scoreMul === 1.0 && std.coinMul === 1.0);
push('困难档 difficultyCfg 系数生效（hpMul/speedMul/bossBulletMul/scoreMul/coinMul）',
  hard.hpMul === 1.4 && hard.speedMul === 1.15 && hard.bossBulletMul === 1.2 && hard.scoreMul === 1.3 && hard.coinMul === 1.2,
  `hpMul=${hard.hpMul} speedMul=${hard.speedMul} bossBulletMul=${hard.bossBulletMul} scoreMul=${hard.scoreMul} coinMul=${hard.coinMul}`);

// ── 4) 非法档清洗：写脏 localStorage 后重载，load() 应回退 standard ──
await page.evaluate((key) => {
  localStorage.setItem(key, JSON.stringify({ selectedDifficulty: '__bogus__' }));
}, cfg.saveKey);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
const smClean = await page.evaluate(() => window.__SAVE.load().selectedDifficulty);
push('脏存档清洗回退 standard', smClean === 'standard', smClean);

push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_difficulty: PASS ===' : '=== qa_difficulty: FAIL ==='));
process.exit(pass ? 0 : 1);
