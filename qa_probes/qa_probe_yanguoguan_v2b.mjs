// QA 探针 B（严过关）— 修正 D 用例 + 真实战斗 combo 占空比 + 旋转残留视觉取证
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
  await sleep(1400);
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE && !!window.__ACH__, null, { timeout: 15000 });
  await sleep(800);
  await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });

  // ---- D 修正：屏内玩家位置下的重生越界 ----
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const d = await page.evaluate(() => {
    const s = window.__SKY;
    s.waves = null;
    const w = s.wingmanSystem.getMembers()[0];   // offset.x=-52
    s.player.x = 24; s.player.y = 800;           // 完全合法的屏内位置（左边缘常见走位）
    w.die();
    s.wingmanSystem._tickRespawn(w.respawnAt + 1);
    return { x: +w.x.toFixed(1), y: +w.y.toFixed(1), W: 540, H: 960, visible: w.visible };
  });
  log(`D 重生点(玩家在 x=24 合法屏内)：僚机 x=${d.x} y=${d.y}  画布 ${d.W}x${d.H} -> ${d.x < 0 || d.x > d.W ? '越界屏外' : '屏内'}`);

  // ---- E 修正：真实波次交战下的 combo 占空比（不冻结敌机） ----
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const e = await page.evaluate(async () => {
    const s = window.__SKY; const sys = s.wingmanSystem;
    const A = window.__ACH__;
    A.startRun('normal', 1);
    let triggers = 0;
    const o = A.reportElementCombo; A.reportElementCombo = function (el) { triggers++; return o.call(A, el); };
    let act = 0, tot = 0, firstFive = -1;
    const t0 = performance.now();
    // firstFive = 达成 combo_element_5 阈值（现为 2 次协同）的耗时
    const iv = setInterval(() => { tot++; if (sys.getComboMul() > 1) act++; if (firstFive < 0 && triggers >= 2) firstFive = performance.now() - t0; }, 50);
    await new Promise((r) => setTimeout(r, 12000));
    clearInterval(iv);
    A.reportElementCombo = o;
    return {
      triggers, uptime: tot ? act / tot : 0,
      firstFiveMs: firstFive,
      ach5: A.isUnlocked('combo_element_5'),
      run: A.getProgress('combo_element_5').cur,
      total: A.getProgress('combo_element_50').cur,
    };
  });
  log(`E 真实波次 12s：触发 ${e.triggers} 次，增益占空比 ${(e.uptime * 100).toFixed(0)}%，`
    + `combo_element_5 ${e.ach5 ? '已解锁' : '未解锁'}（单局 ${e.run}/2，用时 ${e.firstFiveMs > 0 ? Math.round(e.firstFiveMs) + 'ms' : 'N/A'}），累计 ${e.total}/30`);

  // ---- A 视觉取证：真实战斗中主炮子弹的旋转分布 ----
  await enterGame({ wingman: 2, wingmanFirepower: 2 }, 1);
  await sleep(4000);
  const rot = await page.evaluate(() => {
    const s = window.__SKY;
    const act = s.playerBullets.children.entries.filter((b) => b.active);
    const mains = act.filter((b) => b.byWingman === false);
    const degs = mains.map((b) => +(b.rotation * 180 / Math.PI).toFixed(1));
    return {
      mainCount: mains.length,
      degs,
      tilted: degs.filter((x) => Math.abs(x) > 5).length,
      maxAbs: degs.length ? Math.max(...degs.map(Math.abs)) : 0,
      texKeys: [...new Set(mains.map((b) => b.texture.key))],
    };
  });
  log(`A 真实战斗中主炮弹 ${rot.mainCount} 发：倾斜(>5°) ${rot.tilted} 发，最大倾角 ${rot.maxAbs}°，角度样本 ${JSON.stringify(rot.degs.slice(0, 12))}`);
  log(`B 真实战斗中主炮弹贴图集合 ${JSON.stringify(rot.texKeys)}（期望只在 bullet_pulse/bullet_scatter 中按 firepower 正确分布）`);
  await page.screenshot({ path: 'shots/qa_rot_evidence.png' });
  log('已截图 shots/qa_rot_evidence.png');

  log(`pageerror=${pageErrors.length}`);
} catch (err) {
  log('EXCEPTION ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}
