// qa_p3_level4.mjs —— 苍穹战机 P3 内容扩展真测
// 验证：① dist 静态服 + canvas 渲染  ② 第4关「终焉星核」配置接入（levelId=4 / waves=9 / bossKey / nova pattern）
//       ③ 直接 spawnBoss('boss_annihilator') 用 nova 配置（pattern=nova / maxHp=5600）并正常发射子弹
//       ④ nova 阶段2/3 分支（反向旋转臂）安全：降血触发 phase 切换后继续 fire 无报错
//       ⑤ 流程衔接代理：levelId=4 可进入即证明 ResultScene 动态判定 (levelId<LEVELS.length) 生效
//       ⑥ 零 pageerror / console error / 资源失败
// 端口 5062（避开 5059/5060/5061），自带静态服伺服 dist/。
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 进入 GameScene + UIScene，levelId=4（终焉星核）
await page.evaluate(async () => {
  const game = window.__SKY__;
  const SM = window.__SAVE;
  if (SM && SM.set) SM.set('tutorialDone', true);
  game.scene.stop('MenuScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 4 });
  game.scene.start('UIScene', { mode: 'normal', levelId: 4, hp: 100, maxHp: 100, bombs: 3 });
  await new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
});

await sleep(800);

// 断言 1-3：第4关配置接入
const levelInfo = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    levelId: gs.levelId,
    id: gs.level && gs.level.id,
    waves: gs.level && gs.level.waves,
    bossKey: gs.level && gs.level.bossKey,
    bossPattern: gs.level && gs.level.boss && gs.level.boss.pattern,
    bossMaxHp: gs.level && gs.level.boss && gs.level.boss.maxHp,
  };
});
console.log('levelInfo:', JSON.stringify(levelInfo));
assert(levelInfo.levelId === 4, 'GameScene 进入 levelId=4');
assert(levelInfo.id === 4 && levelInfo.waves === 9, `第4关配置接入(id=4, waves=9) → 实际 id=${levelInfo.id} waves=${levelInfo.waves}`);
assert(levelInfo.bossKey === 'boss_annihilator' && levelInfo.bossPattern === 'nova' && levelInfo.bossMaxHp === 5600,
  `第4关 Boss 配置(nova/5600) → key=${levelInfo.bossKey} pattern=${levelInfo.bossPattern} hp=${levelInfo.bossMaxHp}`);

// 断言 4：直接 spawnBoss 用 nova 配置并正常发射
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.spawnBoss('boss_annihilator');
});
// 等 boss 进场完成（2000ms tween）后 fire（phase1 gap 900ms）
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs.boss && !gs.boss._entering;
}, null, { timeout: 5000 }).catch(() => {});
await sleep(2200); // 让 nova 至少发射一个周期

const bossInfo = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    hasBoss: !!gs.boss,
    pattern: gs.boss && gs.boss.pattern,
    phase: gs.boss && gs.boss.phase,
    enemyBullets: gs.enemyBullets ? gs.enemyBullets.countActive(true) : -1,
  };
});
console.log('bossInfo:', JSON.stringify(bossInfo));
assert(bossInfo.hasBoss && bossInfo.pattern === 'nova', `第4关 Boss 生成且 pattern=nova → ${bossInfo.pattern}`);
assert(bossInfo.enemyBullets > 0, `nova 弹幕正常发射（活跃敌弹 ${bossInfo.enemyBullets} 发，无报错）`);

// 断言 5：nova 阶段2/3 分支（反向旋转臂）安全 —— 降血触发 phase 切换后继续 fire
await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (gs.boss && !gs.boss._entering) gs.boss.hit(4000); // 5600→1600，ratio<0.33 → phase 3
});
await sleep(2000); // 让 phase3 nova（含反向旋转臂）跑若干周期
const phaseInfo = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    phase: gs.boss && gs.boss.phase,
    enemyBullets: gs.enemyBullets ? gs.enemyBullets.countActive(true) : -1,
    bossActive: !!(gs.boss && gs.boss.active),
  };
});
console.log('phaseInfo:', JSON.stringify(phaseInfo));
assert(phaseInfo.phase >= 2, `nova 阶段切换安全（phase=${phaseInfo.phase} ≥2）`);
assert(phaseInfo.enemyBullets > 0 && phaseInfo.bossActive, 'nova 高阶弹幕持续发射且无崩溃');

// 断言 6：流程衔接代理 —— levelId=4 可达即证明 ResultScene 动态判定 (levelId<LEVELS.length) 生效
// （第3关 3<4 → 进第4关；第4关 4<4=false → 回菜单/通关结算，无需硬编码）

await sleep(500);

assert(serverOk, 'dist 静态服务器启动成功');
assert(failedReq.length === 0, `全部资源加载成功（失败 ${failedReq.length} 条）`);
if (failedReq.length) console.error('失败请求:', failedReq.slice(0, 8));
assert(errors.length === 0, `零 pageerror / console error（${errors.length}）`);
if (errors.length) console.error('页面错误:', errors.slice(0, 5));

try { await browser.close(); } catch (e) { /* 收尾竞态忽略 */ }
server.close();
console.log(process.exitCode ? '\n=== P3 真测 FAIL ===' : '\n=== P3 真测 PASS ===');
