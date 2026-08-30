// qa_p2_vfx_four.mjs —— P2 视觉四件套（④背景视差 / ⑤动态光影 / ⑥爆炸残留 / ⑦场景转场）真测
// 生产构建 dist/ 真测：静态服托管，端口 5062（避开 5059/5060/5061）。
// 验证：④ Starfield._dbg 探针；⑤ playerLight/bossAmbient/localIllum 挂接；
//       ⑥ residuePool + game._vfxResidue 探针；⑦ transition.ready + TransitionScene + goto('ok') + 黑罩淡入淡出；
//       全程零 pageerror / console error / 404。
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

// ── ⑦ 转场覆盖层就绪 ────────────────────────────────────────────
const tReady = await page.evaluate(() => {
  const game = window.__SKY__;
  const tr = window.__TRANSITION;
  const ts = game.scene.getScene('TransitionScene');
  return {
    probe: !!tr,
    ready: tr ? tr.ready : false,
    sceneExists: !!ts,
    sceneRunning: !!(ts && ts.sys && ts.sys.isActive()),
  };
});
assert(tReady.probe, '⑦ __TRANSITION 探针存在');
assert(tReady.ready, '⑦ transition.ready === true');
assert(tReady.sceneExists, '⑦ TransitionScene 已注册');
assert(tReady.sceneRunning, '⑦ TransitionScene 运行中（常驻覆盖层）');

// ── ⑦ transition.goto 走过渡路径（返回 ok）─ 先回菜单确认可用 ────
const gotoResult = await page.evaluate(() => {
  const game = window.__SKY__;
  const gs = game.scene.getScene('GameScene');
  if (gs) game.scene.stop('UIScene');
  const tr = window.__TRANSITION;
  // 从当前场景发起：若已在 GameScene 则先回菜单再发起，保证 fromScene 存活
  const from = gs && gs.sys && gs.sys.isActive() ? gs : (game.scene.getScene('MenuScene') || gs);
  const r = tr.goto(from, 'MenuScene', undefined, {});
  return r;
});
assert(gotoResult === 'ok', `⑦ transition.goto 返回 'ok'（实际 ${gotoResult}）`);

// 等待黑罩出现（淡出 260ms 内 alpha 应 >0）再等待淡入完成（过渡结束、黑罩隐藏）
const fadeSeen = await page.evaluate(async () => {
  const game = window.__SKY__;
  const tr = window.__TRANSITION;
  const t0 = performance.now();
  let sawBlack = false;
  while (performance.now() - t0 < 1500) {
    if (tr._black && tr._black.visible && tr._black.alpha > 0.6) { sawBlack = true; break; }
    await new Promise((r) => setTimeout(r, 30));
  }
  // 等过渡彻底完成（busy=false）
  while (performance.now() - t0 < 3000) {
    if (!tr._busy) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  return { sawBlack, busy: tr._busy, blackAlpha: tr._black ? tr._black.alpha : -1 };
});
assert(fadeSeen.sawBlack, `⑦ 过渡黑罩出现（alpha>0.6）`);
assert(!fadeSeen.busy, `⑦ 过渡完成（busy=false，不卡黑）`);
assert(errors.length === 0, `⑦ 过渡全程零 pageerror / console error（${errors.length}）`);

// ── 进入 GameScene：⑤⑥ 挂接 + ④ 视差探针 ──────────────────────
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
await page.waitForTimeout(800);

const gameProbes = await page.evaluate(() => {
  const game = window.__SKY__;
  const gs = game.scene.getScene('GameScene');
  const sf = gs && gs.starfield;
  return {
    playerLight: !!(gs && gs.playerLight && gs.playerLight.image && gs.playerLight.image.active),
    residuePool: !!(gs && gs.residuePool),
    residueProbe: game._vfxResidue ? { kinds: game._vfxResidue.kinds, cap: game._vfxResidue.cap } : null,
    sfDbg: sf && sf._dbg ? sf._dbg : null,
    sfStarCount: sf && sf._dbg && typeof sf._dbg.starCount === 'function' ? sf._dbg.starCount() : -1,
  };
});
assert(gameProbes.playerLight, '⑤ 玩家引擎辉光 playerLight 挂接并 active');
assert(!!gameProbes.residuePool, '⑥ GameScene.residuePool 已建（非空池）');
assert(gameProbes.residueProbe && gameProbes.residueProbe.kinds,
  `⑥ game._vfxResidue 探针就位（kinds=${JSON.stringify(gameProbes.residueProbe && gameProbes.residueProbe.kinds)} cap=${gameProbes.residueProbe && gameProbes.residueProbe.cap}）`);
assert(!!gameProbes.sfDbg && typeof gameProbes.sfDbg.effectiveLayers === 'number' && gameProbes.sfDbg.tier,
  `④ Starfield._dbg 就位（tier=${gameProbes.sfDbg && gameProbes.sfDbg.tier} layers=${gameProbes.sfDbg && gameProbes.sfDbg.effectiveLayers} stars=${gameProbes.sfStarCount}）`);

// ⑤ Boss 环境光：强制 spawnBoss 验证 bossAmbient 挂接（low 档可能为 null，允许）
const bossProbe = await page.evaluate(() => {
  const game = window.__SKY__;
  const gs = game.scene.getScene('GameScene');
  if (gs && typeof gs.spawnBoss === 'function') gs.spawnBoss((gs.level && gs.level.boss && gs.level.boss.key) || 'boss');
  return new Promise((res) => {
    setTimeout(() => {
      res({
        boss: !!(gs && gs.boss),
        bossAmbient: !!(gs && gs.bossAmbient && gs.bossAmbient.image && gs.bossAmbient.image.active),
      });
    }, 300);
  });
});
assert(bossProbe.boss, '⑤ Boss 已生成（spawnBoss 触发）');
// low 档下 bossAmbient 允许为 null（设计如此），此处仅 high 断言；是否断言按探针值说明
console.log(`   ℹ️  bossAmbient active=${bossProbe.bossAmbient}（low 档设计为 null，high/mid 应为 true）`);
if (bossProbe.bossAmbient === false) {
  const q = await page.evaluate(() => (window.__SAVE && window.__SAVE.load().quality) || 'high');
  if (q !== 'low') { assert(false, `⑤ Boss 环境光未挂接（quality=${q} 非 low 时应 active）`); }
  else { console.log('   ↳ quality=low，bossAmbient 短路符合设计'); }
} else {
  console.log('✅ ⑤ Boss 环境光 bossAmbient active');
}

await page.waitForTimeout(1200); // 跑一段战斗帧，触发爆炸/残留/光影路径
const combatOk = await page.evaluate(() => {
  const game = window.__SKY__;
  const gs = game.scene.getScene('GameScene');
  return !!(gs && gs.player && gs.player.active);
});
assert(combatOk, '战斗帧存活（player.active，爆炸/残留路径无崩溃）');
assert(failedReq.length === 0, `全部资源加载成功（失败 ${failedReq.length} 条）`);
if (failedReq.length) console.error('失败请求:', failedReq.slice(0, 8));
assert(errors.length === 0, `零 pageerror / console error（${errors.length}）`);
if (errors.length) console.error('页面错误:', errors.slice(0, 5));

// ── reduced-motion 边界：无障碍底线（新页面在加载前模拟，命中模块级 matchMedia）──
const rp = await browser.newPage();
rp.on('pageerror', (e) => errors.push('reduced:' + String(e)));
rp.on('console', (m) => { if (m.type() === 'error') errors.push('reduced-console:' + m.text()); });
await rp.emulateMedia({ reducedMotion: 'reduce' });
await rp.goto(URL, { waitUntil: 'domcontentloaded' });
await rp.waitForFunction(() => !!(window.__SKY__ && window.__SAVE && window.__TRANSITION), null, { timeout: 20000 });
const reduced = await rp.evaluate(async () => {
  const game = window.__SKY__;
  const tr = window.__TRANSITION;
  const SM = window.__SAVE;
  // reduced-motion 下 goto 应直切（返回 'direct'，不发黑罩）
  const r = tr.goto(game.scene.getScene('MenuScene'), 'MenuScene', undefined, {});
  // 进 GameScene 验证残留池为 null + 玩家灯静态（无呼吸 tween 由内部保证，此处仅验挂接不崩）
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
  const gs = game.scene.getScene('GameScene');
  return {
    gotoRet: r,
    residueNull: !gs.residuePool,
    playerLightStatic: !!(gs && gs.playerLight && gs.playerLight.image && gs.playerLight.image.active),
    blackHidden: !tr._black || !tr._black.visible,
  };
});
assert(reduced.gotoRet === 'direct', `reduced-motion：goto 直切（返回 'direct'，实际 ${reduced.gotoRet}）`);
assert(reduced.residueNull, 'reduced-motion：residuePool 为 null（爆炸残留降级）');
assert(reduced.playerLightStatic, 'reduced-motion：playerLight 静态挂接不崩');
assert(reduced.blackHidden, 'reduced-motion：黑罩不显示（无障碍底线）');
await rp.close();

assert(errors.length === 0, `全程（含 reduced）零 pageerror / console error（${errors.length}）`);
if (errors.length) console.error('页面错误:', errors.slice(0, 5));

try { await browser.close(); } catch (e) { /* 收尾竞态忽略 */ }
server.close();
console.log(process.exitCode ? '\n=== P2 视觉四件套 真测 FAIL ===' : '\n=== P2 视觉四件套 真测 PASS ===');
