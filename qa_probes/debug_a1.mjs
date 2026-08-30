// debug_a1.mjs —— 临时调试：6b 未破纪录为何显示新纪录
import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => { const ms = window.__SKY__.scene.getScene('MenuScene'); return ms && ms.scene.isActive(); }, { timeout: 20000 });

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

await page.evaluate(() => window.__SAVE.set('bestScore', 0));
await startGame(page);
await page.evaluate(({ victory, score }) => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.score = score;
  gs.stats = { kills: 0, coins: 0, damageTaken: 0, spawned: 1 };
  gs.difficultyCfg = { scoreMul: 1, coinMul: 1, hpMul: 1, speedMul: 1, bossBulletMul: 1 };
  gs.endGame(victory);
}, { victory: true, score: 1000 });
await page.waitForFunction(() => { const rs = window.__SKY__.scene.getScene('ResultScene'); return rs && rs.scene.isActive(); }, { timeout: 20000 });
const r1 = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return { isNewBest: rs.result.isNewBest, best: window.__SAVE.load().bestScore, cached: window.__SAVE.load().bestScore };
});
console.log('6a result:', JSON.stringify(r1));

// 6b
await page.evaluate(() => window.__SAVE.set('bestScore', 5000));
await startGame(page);
const pre = await page.evaluate(() => ({ bestCache: window.__SAVE.load().bestScore, bestLS: JSON.parse(localStorage.getItem(window.__SKY__ && 'sky_raiders_save_v1')).bestScore }));
console.log('6b before endGame:', JSON.stringify(pre));
await page.evaluate(({ victory, score }) => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.score = score;
  gs.stats = { kills: 0, coins: 0, damageTaken: 0, spawned: 1 };
  gs.difficultyCfg = { scoreMul: 1, coinMul: 1, hpMul: 1, speedMul: 1, bossBulletMul: 1 };
  gs.endGame(victory);
}, { victory: true, score: 1000 });
await page.waitForFunction(() => { const rs = window.__SKY__.scene.getScene('ResultScene'); return rs && rs.scene.isActive(); }, { timeout: 20000 });
const r2 = await page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  const lsv = JSON.parse(localStorage.getItem('sky_raiders_save_v1'));
  return { isNewBest: rs.result.isNewBest, resultBest: rs.result.bestScore, cacheBest: window.__SAVE.load().bestScore, lsBest: lsv.bestScore, saveKeyFound: !!lsv };
});
console.log('6b result:', JSON.stringify(r2));
console.log('errors:', errors);
await browser.close();
