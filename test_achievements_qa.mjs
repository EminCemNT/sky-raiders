// 苍穹战机 — 成就系统综合边界回归套件（常驻资产）
// 覆盖 9 项边界 + P1-1 wingman_50 + P1-2 bossrush_flawless + P1-3 egg_arsenal(>=3)
// 全部走真实运行时（GameScene 玩法链路），Playwright + 系统 Chrome headless，
// 抓 pageerror / console error / 404。端口 5059（安全端口，严禁 5060/5061）。
import { chromium } from 'playwright';

const PORT = 5059;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const log = (m) => { console.log(m); results.push(m); };
const assert = (name, cond) => log(`${cond ? 'PASS' : 'FAIL'} ${name}`);

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });

const pageErrors = [];
const consoleErrors = [];
const bad404 = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('response', (res) => { if (res.status() === 404 && !res.url().includes('favicon')) bad404.push(res.url()); });

// ---- 测试驱动助手 ----
// 全新一局：复位成就/累计 + 设战机 + 重启 GameScene（同时清理 UIScene/Result）
async function freshGame(mode = 'normal', ship = 0, level = 1) {
  await page.evaluate(({ mode, ship, level }) => {
    window.__ACH__.reset();
    window.__SAVE.set('selectedShip', ship);
    const g = window.__SKY__;
    ['GameScene', 'UIScene', 'ResultScene'].forEach((k) => { try { g.scene.stop(k); } catch (e) {} });
    g.scene.start('GameScene', { mode, levelId: level });
  }, { mode, ship, level });
  await sleep(1400);
}
// 同局累计测试用：不复位，仅重启场景（累计字段经 reportRun 持久化后由 startRun 重载）
async function reenterGame(mode = 'normal', ship = 0, level = 1) {
  await page.evaluate(({ mode, ship, level }) => {
    window.__SAVE.set('selectedShip', ship);
    const g = window.__SKY__;
    ['GameScene', 'UIScene', 'ResultScene'].forEach((k) => { try { g.scene.stop(k); } catch (e) {} });
    g.scene.start('GameScene', { mode, levelId: level });
  }, { mode, ship, level });
  await sleep(1400);
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__ACH__ && !!window.__SKY__ && !!window.__SAVE, null, { timeout: 15000 });
  await sleep(1000);

  // ============ 1. 去重：成就以对象映射存储，重复上报不重复 ============
  await freshGame('normal', 0);
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) window.__SKY.registerKill(120, 300); // first_blood 解锁
  });
  await sleep(100);
  const dedup = await page.evaluate(() => {
    const a = window.__SAVE.get('achievements');
    const before = Object.keys(a).length;
    window.__ACH__.reportRun({ victory: false, mode: 'normal', stars: 0, levelId: 1, damageTaken: 50 }); // 再次兜底
    const after = Object.keys(window.__SAVE.get('achievements')).length;
    return { isObj: a && typeof a === 'object' && !Array.isArray(a), before, after, fb: !!a.first_blood };
  });
  assert('去重-成就对象映射无重复(first_blood 不翻倍)', dedup.isObj && dedup.before === dedup.after && dedup.before >= 1 && dedup.fb);

  // ============ 2. 老存档兜底：缺 achievementStats 不抛错 ============
  await page.evaluate(() => {
    // 故意写一份缺 achievementStats / 缺 bossesDefeated 的老存档
    const raw = { coins: 0, selectedShip: 0, levelStars: {}, achievements: { first_blood: true } };
    localStorage.setItem('sky_raiders_save_v1', JSON.stringify(raw));
  });
  const errBeforeReload = pageErrors.length;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__ACH__ && !!window.__SKY__ && !!window.__SAVE, null, { timeout: 15000 });
  await sleep(800);
  const legacy = await page.evaluate(() => {
    const prog = window.__ACH__.getProgress('wingman_50');
    let ok = false;
    try {
      window.__ACH__.startRun('normal', 1);
      window.__ACH__.reportKill({ byWingman: true }); // 触发 loadCumulative 深合并兜底
      ok = true;
    } catch (e) { ok = false; }
    return { cur: prog.cur, ok };
  });
  assert('老存档缺achievementStats不报错(兜底为0)', pageErrors.length === errBeforeReload && legacy.cur === 0 && legacy.ok);

  // ============ 3. all_clear 跳关·0星不污染 ============
  await freshGame('normal', 0);
  await page.evaluate(() => {
    window.__SAVE.recordLevelStars(2, 3);  // 完成第2关 3星
    window.__SAVE.recordLevelStars(3, 0);  // 第3关 0星（应当不污染）
    window.__ACH__.reportRun({ victory: true, mode: 'normal', stars: 3, levelId: 2, damageTaken: 0 });
  });
  await sleep(100);
  const clearNeg = await page.evaluate(() => ({
    all: window.__ACH__.isUnlocked('all_clear'),
    keys: Object.keys(window.__SAVE.get('levelStars') || {}),
  }));
  assert('all_clear 跳关+0星不解锁', !clearNeg.all);
  assert('all_clear 0星不污染 levelStars(不含关3)', !clearNeg.keys.includes('3'));
  await page.evaluate(() => {
    window.__SAVE.recordLevelStars(1, 3);
    window.__SAVE.recordLevelStars(3, 1); // 1>0 才记录
    window.__ACH__.reportRun({ victory: true, mode: 'normal', stars: 3, levelId: 1, damageTaken: 0 });
  });
  const clearPos = await page.evaluate(() => window.__ACH__.isUnlocked('all_clear'));
  assert('all_clear 三关达成可解锁(正向)', clearPos);

  // ============ 4. flawless + 护盾：护盾吸收伤害 → 无伤通关解锁 ============
  await freshGame('normal', 0);
  await page.evaluate(() => {
    const s = window.__SKY;
    s.buffs.shieldUntil = s.time.now + 9e9; // 护盾常驻吸收
    s.playerHit(20); s.playerHit(30);
    s.endGame(true);
  });
  await sleep(200);
  const flaw = await page.evaluate(() => ({ fl: window.__ACH__.isUnlocked('flawless'), dt: window.__SKY.stats.damageTaken }));
  assert('flawless+护盾 无伤解锁', flaw.fl);
  assert('护盾吸收伤害 damageTaken=0', flaw.dt === 0);

  // ============ 5. kill_100 跨局累计 ============
  await freshGame('normal', 0);
  for (let i = 0; i < 60; i++) await page.evaluate(() => window.__SKY.registerKill(120, 300));
  const run1Total = await page.evaluate(() => { const s = window.__SKY; s.endGame(true); return window.__SAVE.get('totalKills'); });
  await sleep(800); // 等 endGame 的 delayedCall 过渡到 Result
  await reenterGame('normal', 0); // 不复位，累计应续接
  await page.evaluate(() => { for (let i = 0; i < 50; i++) window.__SKY.registerKill(120, 300); });
  await sleep(100);
  const kill100 = await page.evaluate(() => window.__ACH__.isUnlocked('kill_100'));
  assert('kill_100 跨局累计解锁(60+50>=100)', kill100);
  assert('totalKills 跨局持久化(首局>=60)', run1Total >= 60);

  // ============ 6. element_fire 跨局累计 ============
  await freshGame('normal', 0);
  for (let i = 0; i < 30; i++) await page.evaluate(() => window.__SKY.registerKill(120, 300, { element: 'fire' }));
  await page.evaluate(() => { const s = window.__SKY; s.endGame(true); });
  await sleep(800);
  await reenterGame('normal', 0);
  await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__SKY.registerKill(120, 300, { element: 'fire' }); });
  await sleep(100);
  const ef = await page.evaluate(() => window.__ACH__.isUnlocked('element_fire'));
  assert('element_fire 跨局累计解锁(30+30>=50)', ef);

  // ============ 7. egg_arsenal>=3 直接可达（边界：阈值3） ============
  await freshGame('normal', 0); // 苍鹰 pulse 默认 → weaponsUsed={pulse}
  await page.evaluate(() => {
    window.__ACH__.reportWeaponUsed('laser');
    window.__ACH__.reportWeaponUsed('bomb');
  });
  await sleep(100);
  const eggDirect = await page.evaluate(() => {
    const p = window.__ACH__.getProgress('egg_arsenal');
    return { u: window.__ACH__.isUnlocked('egg_arsenal'), cur: p.cur, target: p.target };
  });
  assert('egg_arsenal>=3 直接可达(pulse+laser+bomb=3)', eggDirect.u && eggDirect.cur === 3 && eggDirect.target === 3);

  // ============ 8. 横幅队列串行 + 重启解绑 ============
  // 说明：dev server 不允许页面内动态 import 源码模块（404/HTML 兜底），
  // 故直接驱动 UIScene 的 _onAchUnlock handler 来验证队列串行与重启解绑，不依赖 EventBus 全局。
  await freshGame('normal', 0);
  await sleep(300);

  // (a) 横幅队列串行：同一时刻 3 个解锁事件，仅显示 1 个、其余入队
  const serial = await page.evaluate(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    ui._achQueue = []; ui._achShowing = false;
    const all = window.__ACH__.getAll();
    ui._onAchUnlock(all[0]);
    ui._onAchUnlock(all[1]);
    ui._onAchUnlock(all[2]);
    const showing = ui._achShowing === true;
    const queueLen = ui._achQueue ? ui._achQueue.length : -1;
    ui._achShowing = false; ui._achQueue = []; // 清理
    return { showing, queueLen };
  });
  assert('横幅队列串行(显示1+队列2)', serial.showing && serial.queueLen === 2);

  // (b) 重启解绑：单发解锁事件引起的队列增量 == 监听数（1，不泄漏为2）
  // 原理：把 _achShowing 置真后，单次 emit 只会把 def 推入队（不弹窗），队列增量即监听数。
  const leak = await page.evaluate(async () => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    ui._achShowing = true; ui._achQueue = [];
    window.__ACH__._unlock(window.__ACH__.getDefinition('wingman_first')); // 1 次 emit
    const before = ui._achQueue.length;                                    // 期望 1（单监听）
    ui._achShowing = false; ui._achQueue = [];
    ui.scene.restart();
    await new Promise((r) => setTimeout(r, 700));
    const ui2 = window.__SKY__.scene.getScene('UIScene');
    ui2._achShowing = true; ui2._achQueue = [];
    window.__ACH__._unlock(window.__ACH__.getDefinition('tutorial_done')); // 1 次 emit
    const after = ui2._achQueue.length;                                    // 期望 1（旧监听已解绑）
    ui2._achShowing = false; ui2._achQueue = [];
    return { before, after };
  });
  assert('重启解绑 listenerCount 保持 1(不泄漏)', leak.before === 1 && leak.after === 1);

  // ============ 9. 无每帧轮询（事件驱动 + 局末兜底，update 不查成就） ============
  await freshGame('normal', 0);
  const noPoll = await page.evaluate(() => {
    const up = window.__SKY.update.toString();
    const uiScene = window.__SKY__.scene.getScene('UIScene');
    const uiUp = uiScene && uiScene.update ? uiScene.update.toString() : '';
    return {
      game: !up.includes('AchievementManager') && !up.includes('_checkAll') && !up.includes('reportRun'),
      ui: uiUp ? !uiUp.includes('AchievementManager') : true,
    };
  });
  assert('GameScene.update 不轮询成就系统', noPoll.game);
  assert('UIScene.update 不轮询成就系统', noPoll.ui);

  // ============ 10. wingman_50 累计 50 僚机杀（P1-1 复现） ============
  await freshGame('normal', 0);
  await page.evaluate(() => { for (let i = 0; i < 50; i++) window.__SKY.registerKill(120, 300, { byWingman: true }); });
  await sleep(100);
  const wm50 = await page.evaluate(() => window.__ACH__.isUnlocked('wingman_50'));
  assert('wingman_50 累计50僚机杀解锁(P1-1)', wm50);

  // ============ 11. bossrush_flawless 普通关无伤【不解锁】（P1-2 复现·负向） ============
  await freshGame('normal', 0);
  await page.evaluate(() => {
    const s = window.__SKY;
    s.buffs.shieldUntil = s.time.now + 9e9; // 即便无伤，也必须是 BossRush 模式才解锁
    s.endGame(true);
  });
  await sleep(200);
  const bfNormal = await page.evaluate(() => window.__ACH__.isUnlocked('bossrush_flawless'));
  assert('bossrush_flawless 普通关无伤不解锁(P1-2负向)', !bfNormal);

  // ============ 12. bossrush_flawless BossRush 无伤【解锁】（P1-2 复现·正向） ============
  await freshGame('bossrush', 0);
  await page.evaluate(() => { const s = window.__SKY; s.buffs.shieldUntil = s.time.now + 9e9; }); // 全程护盾吸收，damageTaken 保持0
  await sleep(1600); // 等首关 Boss 生成
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const s = window.__SKY; if (s && s._onBossDefeated) s._onBossDefeated(); });
    await sleep(1600); // 等下一关 Boss 生成（delayedCall 1200ms）
  }
  await sleep(1600); // 等 endGame + reportRun 兜底判定
  const bfRush = await page.evaluate(() => ({
    bf: window.__ACH__.isUnlocked('bossrush_flawless'),
    bc: window.__ACH__.isUnlocked('bossrush_clear'),
  }));
  assert('bossrush_flawless BossRush无伤解锁(P1-2正向)', bfRush.bf);
  assert('bossrush_clear 同步解锁(正向对照)', bfRush.bc);

  // ============ 13. egg_arsenal>=3 赤焰捡 laser+bomb 两箱（P1-3 方案B 复现） ============
  await freshGame('normal', 1); // 赤焰：默认绑定 missile → weaponsUsed={missile}
  const eggP13 = await page.evaluate(() => {
    const s = window.__SKY;
    // 注：spawnItem 不返回 item，需从 items 组里取刚生成的那一个再 collectItem
    const pick = (key) => {
      s.spawnItem(120, 400, key);
      const it = s.items.getChildren().find((c) => c.active && c.itemKey === key);
      if (it) s.collectItem(it);
      return !!it;
    };
    const it1 = pick('weapon_laser');
    const it2 = pick('weapon_bomb');
    const p = window.__ACH__.getProgress('egg_arsenal');
    return { u: window.__ACH__.isUnlocked('egg_arsenal'), cur: p.cur, it1, it2, ship: window.__SAVE.get('selectedShip') };
  });
  assert('egg_arsenal P1-3 赤焰捡laser+bomb两箱解锁', eggP13.u);

  // ============ 全局：零报错 ============
  assert('零 pageerror', pageErrors.length === 0);
  assert('零 console error', consoleErrors.length === 0);
  assert('零 404(非favicon)', bad404.length === 0);

  if (pageErrors.length) log('PAGEERRORS: ' + pageErrors.join(' | '));
  if (consoleErrors.length) log('CONSOLE_ERRORS: ' + consoleErrors.join(' | '));
  if (bad404.length) log('404s: ' + bad404.join(' | '));
} catch (e) {
  log('FAIL 测试异常: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  const pass = results.filter((r) => r.startsWith('PASS')).length;
  const fail = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n==== 成就综合回归汇总: ${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
}
