// qa_p2_vfx_spot.mjs —— 回归抽查：确认 3 条之前 FAIL 用例为真通过（非假通过）
// 重点：⑦-1 过渡时长是否依赖 600ms 强制兜底（看 __TDIAG 是否出现 force-finish）；
//       ⑥-1 击杀残留计数来源真实（ember/scorch 构成）；⑥-3 切场景归零是门控还是 destroy。
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const PORT = 5059;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const URL = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE && window.__TRANSITION), null, { timeout: 20000 });
const out = {};

// ── 抽查 1：⑦-1 过渡时长是否靠 600ms 强制兜底 ──
out.transition = await page.evaluate(async () => {
  const game = window.__SKY__;
  const tr = window.__TRANSITION;
  const menu = game.scene.getScene('MenuScene');
  // 清诊断
  if (window.__TDIAG) window.__TDIAG.length = 0;
  const t0 = performance.now();
  const ret = tr.goto(menu, 'GameScene', { levelId: 1, mode: 'normal', forceTutorial: true });
  const tStart = performance.now();
  while (performance.now() - t0 < 4000) {
    if (!tr._busy) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const elapsed = performance.now() - t0;
  const diag = (window.__TDIAG || []).map((d) => d.ev + ':' + (d.elapsed !== undefined ? Math.round(d.elapsed) : '') + (d.fadeOut !== undefined ? ':out' + d.fadeOut : '') + (d.fadeIn !== undefined ? ':in' + d.fadeIn : ''));
  const forceFinish = (window.__TDIAG || []).filter((d) => d.ev === 'force-finish');
  const busyEnd = (window.__TDIAG || []).filter((d) => d.ev === 'busy-end');
  const slowEnv = (window.__TDIAG || []).find((d) => d.ev === 'compute' || d.ev === 'cached');
  return { ret, elapsed, forceFinishCount: forceFinish.length, busyEnd, diag, slowEnv: slowEnv ? slowEnv.slowEnv : null, tStart };
});
// 进 GameScene
await page.evaluate(() => { window.__SAVE.set('tutorialDone', true); const g = window.__SKY__; g.scene.stop('MenuScene'); g.scene.start('GameScene', { mode: 'normal', levelId: 1 }); g.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 }); });
await page.waitForFunction(() => { const gs = window.__SKY__.scene.getScene('GameScene'); return !!(gs && gs.player && gs.player.active); }, null, { timeout: 12000 });
await page.waitForTimeout(600);

// ── 抽查 2：⑥-1 击杀残留计数来源（ember/scorch 构成，240ms 时 active 由什么组成）──
out.residue = await page.evaluate(async () => {
  const game = window.__SKY__;
  const gs = game.scene.getScene('GameScene');
  const R = game._vfxResidue;
  // 记录构成（直接读池内部）
  const pool = gs.residuePool;
  const sample = [];
  for (let i = 0; i < 5; i++) {
    const e = gs.spawnEnemy(gs.player.x + 120, 80 + i * 30, 'small', 'straight');
    if (e) e.die();
    await new Promise((r) => setTimeout(r, 240));
    const emberAlive = pool && pool.ember && pool.ember.active
      ? (typeof pool.ember.getAliveParticleCount === 'function' ? pool.ember.getAliveParticleCount() : pool.ember.alive.length) : 0;
    const smokeAlive = pool && pool.smoke && pool.smoke.active
      ? (typeof pool.smoke.getAliveParticleCount === 'function' ? pool.smoke.getAliveParticleCount() : pool.smoke.alive.length) : 0;
    const scorchAlive = pool && pool.scorch ? pool.scorch.active.filter((img) => img && img.active).length : 0;
    sample.push({ Ractive: R.active, emberAlive, smokeAlive, scorchAlive });
  }
  return { sample, kinds: R.kinds, cap: R.cap };
});

// ── 抽查 3：⑥-3 切场景归零（门控 vs destroy）──
out.cutScene = await page.evaluate(async () => {
  const game = window.__SKY__;
  const gs = game.scene.getScene('GameScene');
  const R = game._vfxResidue;
  const pool = gs.residuePool;
  if (pool && pool.scorch && pool.scorch.spawn) { pool.scorch.spawn(320, 160); pool.scorch.spawn(360, 200); }
  await new Promise((r) => setTimeout(r, 200));
  const before = R.active;
  // 不 stop GameScene，直接 start Menu（探针场景：门控路径）
  game.scene.start('MenuScene');
  await new Promise((r) => setTimeout(r, 600));
  const after = R.active;
  const destroyedFlag = R.destroyed;
  const gameStillRunning = !!(gs.sys && gs.sys.isActive());
  return { before, after, destroyedFlag, gameStillRunning };
});

console.log('=== 抽查 1：过渡时长是否依赖强制兜底 ===');
console.log('elapsed=' + Math.round(out.transition.elapsed) + 'ms ret=' + out.transition.ret);
console.log('slowEnv=' + out.transition.slowEnv + '  forceFinishCount=' + out.transition.forceFinishCount);
console.log('diag=' + JSON.stringify(out.transition.diag));
console.log('=== 抽查 2：⑥-1 残留计数构成 ===');
console.log(JSON.stringify(out.residue.sample));
console.log('kinds=' + JSON.stringify(out.residue.kinds) + ' cap=' + out.residue.cap);
console.log('=== 抽查 3：⑥-3 切场景归零 ===');
console.log(JSON.stringify(out.cutScene));
console.log('pageerrors=' + errs.length + (errs.length ? ' ' + errs.join(' | ') : ''));
try { await browser.close(); } catch (e) {}
server.close();
