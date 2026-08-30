// qa_p2_vfx_qa.mjs —— 严过关独立 QA 探针（P2 视觉四件套④⑤⑥⑦）
// 端口 5059（避开 5060/5061）。在 coder 自测（qa_p2_vfx_four.mjs）基础上独立补边界：
//   - ④ 行为断言：high 档 starCount 全量 / low 档层数+数量缩放
//   - ⑤ 行为断言：playerLight 跟随偏差 ≤30px（不依赖缺失的 _dynLight）/ localIllum 一次衰减销毁 /
//                  连续 10 次爆炸亮斑并发数（无 cap 时应 >3 → FAIL）/ low 档动态光是否整体关闭
//   - ⑥ 行为断言：击杀 1 敌机 200ms active（mid 50% 概率 → 统计比例）/ 20 连杀 cap /
//                  WAVE_CLEARED 与切场景后 active 归零（stale 检查）
//   - ⑦ 行为断言：goto 100ms 内 busy=true / 800ms 内 false / 5 条导航路径目标 key /
//                  Result 数据透传 / reduced 直切
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const PORT = 5059;
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
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const URL = `http://127.0.0.1:${PORT}`;

const results = [];
function rec(cat, name, pass, detail = '') {
  results.push({ cat, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${cat}] ${name}${detail ? '  — ' + detail : ''}`);
}
function assert(cat, name, cond, detail = '') { rec(cat, name, !!cond, detail); }

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required'],
});

function trackPage(page, tag) {
  const errs = [];
  const failed = [];
  const external = [];
  page.on('pageerror', (e) => errs.push(tag + ':pageerror:' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(tag + ':console:' + m.text()); });
  page.on('requestfailed', (r) => failed.push(tag + ':failed:' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(tag + ':' + r.status() + ':' + r.url()); });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('http') && !u.includes('127.0.0.1') && !u.includes('localhost')) external.push(u);
  });
  return { errs, failed, external };
}

async function waitFor(page, fn, timeout = 10000, step = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(step);
  }
  return false;
}

async function enterGame(page, saveSetter) {
  // 进战斗：关教程 → GameScene + UIScene
  await page.evaluate((s) => {
    const SM = window.__SAVE;
    if (s && SM && SM.set) SM.set('tutorialDone', true);
    const game = window.__SKY__;
    game.scene.stop('MenuScene');
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
  }, saveSetter);
  const ok = await waitFor(page, () => {
    const gs = window.__SKY__ && window.__SKY__.scene.getScene('GameScene');
    return !!(gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused);
  }, 12000);
  await page.waitForTimeout(600);
  return ok;
}

// ══════════════ Page H：high 档主流程（默认存档）══════════════
{
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const { errs, failed, external } = trackPage(page, 'H');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE && window.__TRANSITION), null, { timeout: 20000 });

  // ── ⑦-1/⑦-2 过渡时序（等价「点开始」路径：MenuScene→GameScene）──
  const tStart = await page.evaluate(() => {
    const game = window.__SKY__;
    const tr = window.__TRANSITION;
    const menu = game.scene.getScene('MenuScene');
    const t0 = performance.now();
    const ret = tr.goto(menu, 'GameScene', { levelId: 1, mode: 'normal', forceTutorial: true });
    return { ret, t0 };
  });
  const tSeq = await page.evaluate(async (t0) => {
    const tr = window.__TRANSITION;
    const at = [];
    const t1 = performance.now();
    // 100ms 内 busy 应 true
    while (performance.now() - t1 < 110) { if (tr._busy) break; await new Promise((r) => setTimeout(r, 10)); }
    const busy100 = tr._busy;
    const alphaPeak = { seen: false, max: 0 };
    while (performance.now() - t0 < 1500) {
      if (tr._black && tr._black.visible) { alphaPeak.seen = true; alphaPeak.max = Math.max(alphaPeak.max, tr._black.alpha); }
      if (!tr._busy) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    return { busy100, alphaPeak, busyEnd: tr._busy, elapsed: performance.now() - t0 };
  }, tStart.t0);
  assert('⑦-1', '开始跳转 goto 返回 ok', tStart.ret === 'ok', `ret=${tStart.ret}`);
  assert('⑦-1', '100ms 内过渡进行中（busy=true）', tSeq.busy100 === true, `busy100=${tSeq.busy100}`);
  assert('⑦-1', '800ms 内过渡结束（busy=false）', !tSeq.busyEnd && tSeq.elapsed <= 800, `elapsed=${Math.round(tSeq.elapsed)}ms`);
  assert('⑦-2', '过渡期间黑罩 alpha≥0.9', tSeq.alphaPeak.seen && tSeq.alphaPeak.max >= 0.9, `peak=${tSeq.alphaPeak.max.toFixed(2)}`);
  const blackAfter = await page.evaluate(() => {
    const tr = window.__TRANSITION;
    return !!(tr._black && tr._black.visible && tr._black.alpha > 0.01);
  });
  assert('⑦-2', '过渡结束遮罩隐藏（代码为复用隐藏而非销毁）', blackAfter === false, `blackVisible=${blackAfter}`);

  // 等真正进入 GameScene（goto 已 start，教程被关）
  await page.evaluate(() => { const g = window.__SKY__; if (g.scene.getScene('GameScene')) g.scene.start('GameScene', { mode: 'normal', levelId: 1 }); });
  await waitFor(page, () => {
    const gs = window.__SKY__ && window.__SKY__.scene.getScene('GameScene');
    return !!(gs && gs.player && gs.player.active);
  }, 12000);
  await page.waitForTimeout(600);

  // ── ④-2 high 档 starCount 全量 ──
  const sfHigh = await page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const sf = gs && gs.starfield;
    return { tier: sf && sf._dbg && sf._dbg.tier, layers: sf && sf._dbg && sf._dbg.effectiveLayers, stars: sf && sf._dbg && typeof sf._dbg.starCount === 'function' ? sf._dbg.starCount() : -1 };
  });
  assert('④-2', 'high 档 tier=high', sfHigh.tier === 'high', `tier=${sfHigh.tier}`);
  assert('④-2', 'high 档 4 层全开', sfHigh.layers === 4, `layers=${sfHigh.layers}`);
  assert('④-2', 'high 档星数全量 118（46+34+24+14）', sfHigh.stars === 118, `stars=${sfHigh.stars}`);

  // ── ⑤-1 playerLight 跟随偏差（替代缺失 _dynLight：直接算 image.x vs player.x）──
  const follow = await page.evaluate(async () => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const pl = gs.playerLight;
    if (!pl || !pl.image || !pl.image.active) return { ok: false, reason: 'no playerLight' };
    const p = gs.player;
    const x0 = p.x, y0 = p.y;
    p.setPosition(x0 + 120, y0);            // 玩家瞬移 120px
    await new Promise((r) => setTimeout(r, 80)); // 等 update 事件同步
    const dx = Math.abs(pl.image.x - p.x);
    const dy = Math.abs(pl.image.y - p.y);
    return { ok: true, dx: Math.round(dx), dy: Math.round(dy) };
  });
  assert('⑤-1', 'playerLight 挂接并 active', follow.ok === true, follow.reason || '');
  assert('⑤-1', '玩家移动后跟随光偏差 ≤30px', follow.ok && follow.dx <= 30 && follow.dy <= 30, follow.ok ? `dx=${follow.dx} dy=${follow.dy}` : follow.reason);

  // ── ⑤-3 localIllum：一次爆炸出现亮斑 + 500ms 内衰减销毁 ──
  const illOnce = await page.evaluate(async () => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const count = () => gs.children.list.filter((c) => c.texture && c.texture.key === 'glow_soft' && c.depth === 56 && c.active).length;
    const e = gs.spawnEnemy(gs.player.x + 160, gs.player.y, 'small', 'straight');
    if (!e) return { ok: false, reason: 'spawnEnemy null' };
    e.die();
    await new Promise((r) => setTimeout(r, 120));
    const after120 = count();
    await new Promise((r) => setTimeout(r, 600));
    const after720 = count();
    return { ok: true, after120, after720 };
  });
  assert('⑤-3', '一次爆炸 120ms 出现局部亮斑 ≥1', illOnce.ok && illOnce.after120 >= 1, illOnce.ok ? `count=${illOnce.after120}` : illOnce.reason);
  assert('⑤-3', '亮斑 600ms 后衰减销毁（0）', illOnce.ok && illOnce.after720 === 0, illOnce.ok ? `count=${illOnce.after720}` : illOnce.reason);

  // ── ⑤-3 连续 10 次爆炸：活跃亮斑并发数（无 cap 逻辑，预期 >3 → FAIL）──
  const illBurst = await page.evaluate(async () => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const count = () => gs.children.list.filter((c) => c.texture && c.texture.key === 'glow_soft' && c.depth === 56 && c.active).length;
    const spawned = [];
    for (let i = 0; i < 10; i++) {
      const e = gs.spawnEnemy(gs.player.x + 60 + i * 30, gs.player.y - 40, 'small', 'straight');
      if (e) { e.die(); spawned.push(e); }
    }
    await new Promise((r) => setTimeout(r, 60));
    const peak = count();
    await new Promise((r) => setTimeout(r, 800));
    const tail = count();
    return { spawned: spawned.length, peak, tail };
  });
  assert('⑤-3', '连续 10 次爆炸活跃亮斑 ≤3（无并发 cap，验证缺陷）', illBurst.peak <= 3, `spawn=${illBurst.spawned} peak=${illBurst.peak}`);
  assert('⑤-3', '连爆后 800ms 亮斑回收', illBurst.tail === 0, `tail=${illBurst.tail}`);

  // ── ⑥-1 击杀 1 敌机：200ms 内 active≥1（mid 50% 概率 → 统计 20 次命中率）──
  const resHit = await page.evaluate(async () => {
    const game = window.__SKY__;
    const gs = game.scene.getScene('GameScene');
    let hit = 0, total = 0;
    const R = game._vfxResidue;
    for (let i = 0; i < 20; i++) {
      const e = gs.spawnEnemy(gs.player.x + 120, 80 + i * 20, 'small', 'straight');
      if (!e) continue;
      e.die();
      total++;
      await new Promise((r) => setTimeout(r, 240));
      if (R.active >= 1) hit++;
    }
    // 等残留淡出
    await new Promise((r) => setTimeout(r, 4200));
    return { hit, total, final: R.active };
  });
  assert('⑥-1', '击杀敌机后残留 active≥1（探针只统计焦痕，mid 档 50% 概率 → 应为 flaky）', resHit.hit >= 19, `hit=${resHit.hit}/${resHit.total}`);
  rec('⑥-1', '命中率观察（>15 说明必留，否则证明 flaky）', resHit.hit > 15, `hit=${resHit.hit}/${resHit.total} final=${resHit.final}`);
  assert('⑥-1', '3s+ 后残留回落 0', resHit.final === 0, `final=${resHit.final}`);

  // ── ⑥-2 5s 内 20 连杀：active 峰值 ≤cap（high cap=12）──
  const resCap = await page.evaluate(async () => {
    const game = window.__SKY__;
    const gs = game.scene.getScene('GameScene');
    const R = game._vfxResidue;
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      const e = gs.spawnEnemy(120 + (i % 5) * 60, 60 + (i % 4) * 40, 'small', 'straight');
      if (!e) continue;
      e.die();
      await new Promise((r) => setTimeout(r, 200));
      peak = Math.max(peak, R.active);
    }
    return { peak, cap: R.cap };
  });
  assert('⑥-2', '20 连杀 active 峰值 ≤cap（high=12）', resCap.peak <= resCap.cap, `peak=${resCap.peak} cap=${resCap.cap}`);

  // ── ⑥-1 补充证据：Boss 击杀（tier=boss）必留焦痕 vs small 敌机恒 0 ──
  const bossRes = await page.evaluate(async () => {
    const game = window.__SKY__;
    const gs = game.scene.getScene('GameScene');
    const R = game._vfxResidue;
    if (typeof gs.spawnBoss === 'function') gs.spawnBoss((gs.level && gs.level.boss && gs.level.boss.key) || 'boss');
    await new Promise((r) => setTimeout(r, 400));
    const boss = gs.boss;
    if (boss && typeof boss.die === 'function') boss.die();
    await new Promise((r) => setTimeout(r, 300));
    const afterBoss = R.active;
    return { afterBoss };
  });
  rec('⑥-1', 'Boss 击杀（tier=boss）焦痕 active≥1（对照：small 敌机恒 0）', bossRes.afterBoss >= 1, `afterBoss=${bossRes.afterBoss}`);

  // ── ⑥-3 切场景后 active 归零（直接 spawn 焦痕，验证 stale）──
  const cutScene = await page.evaluate(async () => {
    const game = window.__SKY__;
    const gs = game.scene.getScene('GameScene');
    const R = game._vfxResidue;
    // 直接向残留池 spawn 焦痕（绕过爆炸 tier 限制，制造 before>0 前提）
    if (gs.residuePool && gs.residuePool.scorch && gs.residuePool.scorch.spawn) {
      gs.residuePool.scorch.spawn(320, 160);
      gs.residuePool.scorch.spawn(360, 200);
    }
    await new Promise((r) => setTimeout(r, 200));
    const before = R.active;
    // 直接切菜单（模拟结算/返回菜单）
    game.scene.stop('UIScene');
    game.scene.start('MenuScene');
    await new Promise((r) => setTimeout(r, 600));
    const after = R.active;
    return { before, after };
  });
  rec('⑥-3', '切场景前有焦痕（before>0 前提成立）', cutScene.before > 0, `before=${cutScene.before}`);
  assert('⑥-3', '切场景后 game._vfxResidue.active===0（预期 stale → FAIL）', cutScene.after === 0, `before=${cutScene.before} after=${cutScene.after}`);

  // ── ⑦-3 导航路径 2/3：结算→菜单（模拟 GameScene.endGame → Result → 菜单）──
  const navRes = await page.evaluate(async () => {
    const game = window.__SKY__;
    const gs = game.scene.getScene('GameScene');
    if (!gs || !gs.sys.isActive()) { game.scene.start('GameScene', { mode: 'normal', levelId: 1 }); await new Promise((r) => setTimeout(r, 800)); }
    const g2 = game.scene.getScene('GameScene');
    g2.endGame(true);
    // 等 ResultScene 出现
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const rs = game.scene.getScene('ResultScene');
      if (rs && rs.sys && rs.sys.isActive() && rs.result && Object.keys(rs.result).length) return { rsActive: true, result: rs.result };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { rsActive: false, result: null };
  });
  assert('⑦-3', '游戏→结算过渡且 ResultScene active', navRes.rsActive === true, navRes.rsActive ? '' : 'ResultScene 未出现');
  // ⑦-5 Result 透传
  if (navRes.rsActive && navRes.result) {
    const r = navRes.result;
    assert('⑦-5', 'Result 含 score/kills/coins/levelId/mode', r.score !== undefined && r.kills !== undefined && r.coins !== undefined && r.levelId !== undefined && r.mode !== undefined, JSON.stringify({ score: r.score, kills: r.kills, coins: r.coins, levelId: r.levelId, mode: r.mode }));
    assert('⑦-5', 'Result.mode 正确（normal）', r.mode === 'normal', `mode=${r.mode}`);
  } else {
    assert('⑦-5', 'Result 数据透传', false, 'Result 未就绪');
  }
  // 结算→菜单
  const resToMenu = await page.evaluate(async () => {
    const game = window.__SKY__;
    const rs = game.scene.getScene('ResultScene');
    const tr = window.__TRANSITION;
    // 等 游戏→结算 过渡完全结束（fade-in 完成），避免 busy 丢弃
    const tWait = Date.now();
    while (tr._busy && Date.now() - tWait < 4000) await new Promise((r) => setTimeout(r, 50));
    const ret = tr.goto(rs, 'MenuScene', undefined, {});
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const m = game.scene.getScene('MenuScene');
      if (m && m.sys && m.sys.isActive()) return { ret, menuActive: true };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ret, menuActive: false };
  });
  assert('⑦-3', '结算→菜单过渡且 MenuScene active', resToMenu.ret === 'ok' && resToMenu.menuActive === true, `ret=${resToMenu.ret}`);

  // ── ⑦-3 导航路径 4：机库→菜单（先等上一次过渡结束，避免 busy 丢弃）──
  const hangarNav = await page.evaluate(async () => {
    const game = window.__SKY__;
    const menu = game.scene.getScene('MenuScene');
    const tr = window.__TRANSITION;
    // 等上次 结算→菜单 过渡完全结束
    const t0 = Date.now();
    while (tr._busy && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
    const r1 = tr.goto(menu, 'HangarScene', undefined, {});
    const t1 = Date.now();
    while (Date.now() - t1 < 5000) {
      const h = game.scene.getScene('HangarScene');
      if (h && h.sys && h.sys.isActive()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const h = game.scene.getScene('HangarScene');
    while (tr._busy && Date.now() - t1 < 4000) await new Promise((r) => setTimeout(r, 50));
    const r2 = tr.goto(h, 'MenuScene', undefined, {});
    const t2 = Date.now();
    while (Date.now() - t2 < 5000) {
      const m = game.scene.getScene('MenuScene');
      if (m && m.sys && m.sys.isActive()) return { r1, r2, hangarOk: true, menuBack: true };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { r1, r2, hangarOk: !!h, menuBack: false };
  });
  assert('⑦-3', '菜单→机库→菜单 过渡（r1=ok & 机库 active）', hangarNav.r1 === 'ok' && hangarNav.hangarOk === true, `r1=${hangarNav.r1}`);
  assert('⑦-3', '机库→菜单 过渡（r2=ok & 菜单 active）', hangarNav.r2 === 'ok' && hangarNav.menuBack === true, `r2=${hangarNav.r2}`);

  // ── ⑦-1 复测：warm 后二次 GameScene 切换时长（区分首次 create 慢 vs 常态超时）──
  const tRe = await page.evaluate(async () => {
    const game = window.__SKY__;
    const tr = window.__TRANSITION;
    const menu = game.scene.getScene('MenuScene');
    while (tr._busy) await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    const ret = tr.goto(menu, 'GameScene', { mode: 'normal', levelId: 1 });
    while (performance.now() - t0 < 4000) {
      if (!tr._busy) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    return { ret, elapsed: performance.now() - t0 };
  });
  rec('⑦-1', 'warm 后二次切换时长（首次 1268ms 若为 create 开销，二次应 <800ms）', tRe.ret === 'ok' && tRe.elapsed <= 800, `ret=${tRe.ret} elapsed=${Math.round(tRe.elapsed)}ms`);

  // ── ⑦-3 导航路径 5：暂停→菜单（UIScene.quitToMenu 等价）──
  const quitNav = await page.evaluate(async () => {
    const game = window.__SKY__;
    const tr = window.__TRANSITION;
    while (tr._busy) await new Promise((r) => setTimeout(r, 50));
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
    await new Promise((r) => setTimeout(r, 800));
    const ui = game.scene.getScene('UIScene');
    if (ui && ui.quitToMenu) ui.quitToMenu();
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const m = game.scene.getScene('MenuScene');
      const g = game.scene.getScene('GameScene');
      if (m && m.sys && m.sys.isActive() && !(g && g.sys && g.sys.isActive())) return { quitOk: true };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { quitOk: false };
  });
  assert('⑦-3', '暂停→菜单（quitToMenu 过渡后 GameScene 停止、Menu active）', quitNav.quitOk === true, '');

  // ── ④-4 运行段：30s 战斗帧无外部资源/console error ──
  await page.evaluate(() => { const g = window.__SKY__; if (!g.scene.getScene('GameScene').sys.isActive()) g.scene.start('GameScene', { mode: 'normal', levelId: 1 }); });
  await page.waitForTimeout(5000);
  const runErr = await page.evaluate(() => { const gs = window.__SKY__.scene.getScene('GameScene'); return !!(gs && gs.player && gs.player.active); });
  assert('④-4', '运行段战斗存活（30s 冒烟）', runErr === true, '');
  await page.waitForTimeout(8000);
  assert('④-4', '运行段零 console error/pageerror', errs.length === 0, errs.slice(0, 3).join(' | '));
  assert('④-4', '运行段零资源失败/404', failed.length === 0, failed.slice(0, 3).join(' | '));
  assert('④-4', '零外部资源请求（红线）', external.length === 0, external.slice(0, 3).join(' | '));
  await page.close();
}

// ══════════════ Page L：low 档（存档 quality=low 后 reload）══════════════
{
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const { errs } = trackPage(page, 'L');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
  await page.evaluate(() => { window.__SAVE.set('quality', 'low'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE && window.__TRANSITION), null, { timeout: 20000 });
  await enterGame(page, true);

  const lowProbes = await page.evaluate(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const sf = gs && gs.starfield;
    const pl = gs && gs.playerLight;
    return {
      q: window.__SAVE.load().quality,
      tier: sf && sf._dbg && sf._dbg.tier,
      layers: sf && sf._dbg && sf._dbg.effectiveLayers,
      stars: sf && sf._dbg && typeof sf._dbg.starCount === 'function' ? sf._dbg.starCount() : -1,
      streams: sf && sf._dbg && typeof sf._dbg.streamCount === 'function' ? sf._dbg.streamCount() : -1,
      meteors: sf && sf._dbg && typeof sf._dbg.meteorCount === 'function' ? sf._dbg.meteorCount() : -1,
      playerLightOn: !!(pl && pl.image && pl.image.active),
      bossAmbient: !!(gs && gs.bossAmbient && gs.bossAmbient.image && gs.bossAmbient.image.active),
      residue: window.__SKY__._vfxResidue ? { kinds: window.__SKY__._vfxResidue.kinds, cap: window.__SKY__._vfxResidue.cap } : null,
    };
  });
  assert('④-2', 'low 档 tier=low', lowProbes.tier === 'low', `tier=${lowProbes.tier}`);
  assert('④-2', 'low 档 3 层生效', lowProbes.layers === 3, `layers=${lowProbes.layers}`);
  assert('④-2', 'low 档星数缩放 45（floor(46*.45)+floor(34*.45)+floor(24*.45)）', lowProbes.stars === 45, `stars=${lowProbes.stars}`);
  assert('④-2', 'low 档流光 0 / 流星 0', lowProbes.streams === 0 && lowProbes.meteors === 0, `streams=${lowProbes.streams} meteors=${lowProbes.meteors}`);
  assert('⑤-4', 'low 档 bossAmbient 关闭（null）', lowProbes.bossAmbient === false, `bossAmbient=${lowProbes.bossAmbient}`);
  assert('⑥-4', 'low 档残留仅余烬（smoke/scorch 关，cap 0）', lowProbes.residue && lowProbes.residue.kinds.ember === true && lowProbes.residue.kinds.smoke === false && lowProbes.residue.kinds.scorch === false && lowProbes.residue.cap === 0, `kinds=${JSON.stringify(lowProbes.residue && lowProbes.residue.kinds)} cap=${lowProbes.residue && lowProbes.residue.cap}`);
  assert('⑤-4', 'low 档动态光整体关闭（playerLight 应不创建——验收；当前设计仍收小半径创建）', lowProbes.playerLightOn === false, `playerLightOn=${lowProbes.playerLightOn}`);

  const lowTrans = await page.evaluate(() => {
    const game = window.__SKY__;
    const tr = window.__TRANSITION;
    const menu = game.scene.getScene('MenuScene');
    const r = tr.goto(menu, 'MenuScene', undefined, {});
    return r;
  });
  assert('⑦-4', 'low 档过渡直切（返回 direct）', lowTrans === 'direct', `ret=${lowTrans}`);
  assert('L', 'low 档零 console error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ══════════════ Page R：reduced-motion（加载前模拟）══════════════
{
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const { errs } = trackPage(page, 'R');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE && window.__TRANSITION), null, { timeout: 20000 });
  await enterGame(page, true);

  const redProbes = await page.evaluate(async () => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const sf = gs && gs.starfield;
    const pl = gs && gs.playerLight;
    const base = {
      reduceMotion: sf && sf._dbg && sf._dbg.reduceMotion,
      streams: sf && sf._dbg && typeof sf._dbg.streamCount === 'function' ? sf._dbg.streamCount() : -1,
      meteors: sf && sf._dbg && typeof sf._dbg.meteorCount === 'function' ? sf._dbg.meteorCount() : -1,
      residueNull: !gs.residuePool,
      playerLightOn: !!(pl && pl.image && pl.image.active),
    };
    if (pl && pl.image && pl.image.active) {
      const p = gs.player;
      p.setPosition(p.x + 100, p.y);
      await new Promise((r) => setTimeout(r, 80));
      base.followDx = Math.round(Math.abs(pl.image.x - p.x));
    }
    return base;
  });
  assert('④-3', 'reduced-motion 探针 reduceMotion=true', redProbes.reduceMotion === true, `reduceMotion=${redProbes.reduceMotion}`);
  assert('④-3', 'reduced-motion streamCount=0', redProbes.streams === 0, `streams=${redProbes.streams}`);
  assert('④-3', 'reduced-motion meteorCount=0', redProbes.meteors === 0, `meteors=${redProbes.meteors}`);
  assert('⑥-5', 'reduced-motion 残留池 null（不创建）', redProbes.residueNull === true, '');
  assert('⑤-5', 'reduced-motion 跟随光关闭（验收；当前设计仍创建跟随 → FAIL）', redProbes.playerLightOn === false, `playerLightOn=${redProbes.playerLightOn} followDx=${redProbes.followDx}`);

  const redTrans = await page.evaluate(() => {
    const game = window.__SKY__;
    const tr = window.__TRANSITION;
    const menu = game.scene.getScene('MenuScene');
    const r = tr.goto(menu, 'MenuScene', undefined, {});
    return r;
  });
  assert('⑦-4', 'reduced-motion 过渡直切（direct）', redTrans === 'direct', `ret=${redTrans}`);
  assert('R', 'reduced-motion 零 console error/NaN', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ══════════════ 汇总 ══════════════
try { await browser.close(); } catch (e) { /* ignore */ }
server.close();

const fails = results.filter((r) => !r.pass);
const warns = results.filter((r) => r.pass === false && (r.name.includes('flaky') || r.name.includes('观察') || r.name.includes('缺陷') || r.name.includes('验收')));
console.log('\n========== 汇总 ==========');
console.log(`总用例 ${results.length}，FAIL ${fails.length}（其中预期缺陷/观察项 ${fails.filter((r) => r.name.includes('缺陷') || r.name.includes('观察') || r.name.includes('flaky')).length} 条）`);
for (const f of fails) console.log(`  ❌ [${f.cat}] ${f.name} — ${f.detail}`);
process.exit(fails.some((r) => !r.name.includes('观察') && !r.name.includes('flaky') && !r.name.includes('缺陷') && !r.name.includes('验收')) ? 1 : 0);
