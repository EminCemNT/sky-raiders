// qa_dist_smoke.mjs —— sky-raiders 生产构建 dist/ 真测
// 验证：① 自带静态服托管 dist/ 可正常服务  ② 相对路径资源全 200（无 404/失败）
//       ③ 成功进入 GameScene（player.active）  ④ 零 pageerror / console error
// 不依赖外部 vite preview，端口 5062（避开 5059/5060/5061）。
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const PORT = 5062;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const errors = [];
const failedReq = [];
let serverOk = false;

function assert(c, m) {
  if (!c) { console.error('❌ FAIL:', m); process.exitCode = 1; }
  else console.log('✅', m);
}

await new Promise((r) => server.listen(PORT, '127.0.0.1', () => { serverOk = true; r(); }));
console.log('static server up:', serverOk, 'port', PORT);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });
page.on('requestfailed', (r) => failedReq.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
page.on('response', (r) => { if (r.status() >= 400) failedReq.push(r.url() + ' ' + r.status()); });

const URL = `http://127.0.0.1:${PORT}`;
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// 进入 GameScene + UIScene（复用 P1 标准姿势）
await page.evaluate(async () => {
  const game = window.__SKY__;
  const SM = window.__SAVE;
  if (SM && SM.set) SM.set('tutorialDone', true);
  game.scene.stop('MenuScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
  await new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
});

await page.waitForTimeout(1500); // 实跑 1.5s 让对象池/敌机/飘字等路径都跑过

const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
const playerActive = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return !!(gs && gs.player && gs.player.active);
});

assert(serverOk, 'dist 静态服务器启动成功');
assert(hasCanvas, 'canvas 渲染存在');
assert(playerActive, '成功进入 GameScene（player.active）');
assert(failedReq.length === 0, `全部资源加载成功（失败 ${failedReq.length} 条）`);
if (failedReq.length) console.error('失败请求:', failedReq.slice(0, 8));
assert(errors.length === 0, `零 pageerror / console error（${errors.length}）`);
if (errors.length) console.error('页面错误:', errors.slice(0, 5));

try { await browser.close(); } catch (e) { /* 收尾竞态忽略 */ }
server.close();
console.log(process.exitCode ? '\n=== dist 真测 FAIL ===' : '\n=== dist 真测 PASS ===');
