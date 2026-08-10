// 严过关 v3 专项：疑点2(E1 占空比口径) + 疑点3(H2 跨局串台) 的独立取证
import { chromium } from 'playwright';
const URL = 'http://localhost:5059/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)));

async function enterGame(up, ship = 1) {
  await page.evaluate(({ u, sh }) => {
    const s = window.__SAVE.load();
    Object.assign(s.upgrades, u); s.selectedShip = sh; s.tutorialDone = true;
    window.__SAVE.save();
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
  }, { u: up, sh: ship });
  await sleep(1500);
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE && !!window.__ACH__, null, { timeout: 20000 });
  await sleep(700);
  await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });

  // ══════ 疑点2：E1 占空比 —— 理想接敌场景下随观测窗口变化，验证"爬坡伪影" ══════
  log('【疑点2】理想接敌（6 架冻结敌机 hp=999999，100% 接敌）下，占空比随观测窗长的变化：');
  for (const dur of [3000, 6000, 12000]) {
    await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
    const r = await page.evaluate(async (D) => {
      const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
      A.reset();
      for (let i = 0; i < 6; i++) { const e = s.spawnEnemy(120 + i * 60, 300 + (i % 3) * 60, 'small', 'straight', 1); e.hp = 999999; e.setVelocity(0, 0); }
      let trig = 0; const o = A.reportElementCombo; A.reportElementCombo = function (el) { trig++; return o.call(A, el); };
      let act = 0, tot = 0, firstTrigAt = -1;
      const t0 = performance.now();
      const iv = setInterval(() => { tot++; if (sys.getComboMul() > 1) act++; if (firstTrigAt < 0 && trig > 0) firstTrigAt = performance.now() - t0; }, 50);
      await new Promise((r2) => setTimeout(r2, D));
      clearInterval(iv);
      A.reportElementCombo = o;
      s.enemies.children.each((e) => { if (e.active) e.hit(999999); });
      return { trig, uptime: tot ? act / tot : 0, firstTrigAt: Math.round(firstTrigAt), tot };
    }, dur);
    const theoretical = r.firstTrigAt > 0 ? (dur - r.firstTrigAt) / dur : 0;
    log(`  观测 ${dur}ms：触发 ${r.trig} 次，占空比 ${(r.uptime * 100).toFixed(0)}%，`
      + `首次触发耗时 ${r.firstTrigAt}ms，"首触发后全程常亮"理论值 ${(theoretical * 100).toFixed(0)}%`);
  }

  // 真实波次（不冻结敌机）对照
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const real = await page.evaluate(async () => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset(); A.startRun('normal', 1);
    let trig = 0; const o = A.reportElementCombo; A.reportElementCombo = function (el) { trig++; return o.call(A, el); };
    let act = 0, tot = 0;
    const iv = setInterval(() => { tot++; if (sys.getComboMul() > 1) act++; }, 50);
    await new Promise((r) => setTimeout(r, 12000));
    clearInterval(iv); A.reportElementCombo = o;
    return { trig, uptime: tot ? act / tot : 0 };
  });
  log(`  【真实波次对照】12000ms 不冻结敌机：触发 ${real.trig} 次，占空比 ${(real.uptime * 100).toFixed(0)}%`);

  // ══════ 疑点3：H2 —— 用修正后的判据重测跨局串台 ══════
  log('');
  log('【疑点3】跨局串台，修正判据（原判据 dcOldAfter===dcOld 是反的）：');
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const cross = await page.evaluate(async () => {
    const s0 = window.__SKY;
    const oldSys = s0.wingmanSystem;
    const w = oldSys.getMembers()[0];
    if (w) w.die();
    const dcOld = oldSys._deadCount;                 // 旧局阵亡 1 架 -> 1
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
    await new Promise((r) => setTimeout(r, 1500));
    const s1 = window.__SKY;
    const newSys = s1.wingmanSystem;
    const dcOldRightAfterDestroy = oldSys._deadCount;   // destroy() L305 会把它置 0
    const dcNew0 = newSys._deadCount;
    const nw = newSys.getMembers()[0];
    if (nw) nw.die();                                   // 新局阵亡 1 架
    const dcNew1 = newSys._deadCount;
    const dcOldAfter = oldSys._deadCount;               // 若旧 handler 仍绑着，这里会被顶到 1
    // 再补一刀：新局再阵亡一架，看旧系统是否继续跟涨
    const nw2 = newSys.getMembers()[1];
    if (nw2) nw2.die();
    return {
      dcOld, dcOldRightAfterDestroy, dcNew0, dcNew1, dcOldAfter,
      dcOldAfter2: oldSys._deadCount, dcNew2: newSys._deadCount,
      oldDestroyed: oldSys.scene === null, oldMembers: oldSys.getMembers().length,
    };
  });
  log(`  旧局阵亡后 old._deadCount = ${cross.dcOld}`);
  log(`  重开一局、destroy() 执行后 old._deadCount = ${cross.dcOldRightAfterDestroy}  (destroy() L305 显式置 0)`);
  log(`  新局初始 new._deadCount = ${cross.dcNew0}`);
  log(`  新局阵亡 1 架后：new=${cross.dcNew1}  old=${cross.dcOldAfter}`);
  log(`  新局再阵亡 1 架后：new=${cross.dcNew2}  old=${cross.dcOldAfter2}`);
  log(`  oldSys.scene===null ? ${cross.oldDestroyed}   旧 members 已清空 ? ${cross.oldMembers === 0}`);
  const noCrossTalk = cross.oldDestroyed && cross.dcOldAfter === 0 && cross.dcOldAfter2 === 0
    && cross.dcNew0 === 0 && cross.dcNew1 === 1 && cross.dcNew2 === 2;
  log(`  >> 修正判据 (old 恒为 0 且 new 独立递增) 结论：${noCrossTalk ? 'PASS 无串台，解绑正确' : 'FAIL 存在串台'}`);
  log(`  >> 原判据 (dcOldAfter === dcOld) 求值：${cross.dcOldAfter} === ${cross.dcOld} -> ${cross.dcOldAfter === cross.dcOld}`
    + `（解绑正确时必然为 false，解绑失效时反而为 true —— 判据方向是反的）`);

  log('');
  log(`pageerror=${pageErrors.length}`);
  if (pageErrors.length) log('PAGEERRORS: ' + pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  log('EXCEPTION ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
}
