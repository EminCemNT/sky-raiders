// 苍穹战机 — 成就系统深度接入真测（零 pageerror + 关键解锁断言）
// Playwright + 系统 Chrome，抓 pageerror / console error / 404，截图间接确认。
import { chromium } from 'playwright';

const PORT = 5059;
const URL = `http://localhost:${PORT}/`;
const SHOT = 'shots';
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

// 逻辑分辨率 540x960 → 视口 720x1280（因子 1.333）
const vp = (lx, ly) => [Math.round(lx * 1.333), Math.round(ly * 1.333)];

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__ACH__ && !!window.__SKY__ && !!window.__SAVE, null, { timeout: 15000 });
  await sleep(1200);
  await page.screenshot({ path: `${SHOT}/shot_ach_menu.png` });

  // ---------- 复位（确保确定性）：清成就/统计，选赤焰(火元素) ----------
  await page.evaluate(() => {
    window.__ACH__.reset();
    window.__SAVE.set('selectedShip', 1); // 赤焰 = 火元素，用于 element_fire
  });

  // ---------- 进入普通关（火元素战机）----------
  await page.evaluate(() => {
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'normal' });
  });
  await sleep(1300);

  // 校验 C2 绑定 + 主炮子弹携带 shipElement（真实集成点）
  const shipInfo = await page.evaluate(() => {
    const s = window.__SKY;
    const before = s.player.shipElement;
    s.player.fire();
    let elem = null;
    s.playerBullets.children.each((b) => { if (b.active) elem = b.element; });
    return { shipElement: before, bulletElement: elem };
  });
  assert('火战机 shipElement=fire', shipInfo.shipElement === 'fire');
  assert('主炮子弹携带 fire 元素', shipInfo.bulletElement === 'fire');
  await page.screenshot({ path: `${SHOT}/shot_ach_battle.png` });

  // ---------- first_blood：单局击杀 >=10 ----------
  const fb = await page.evaluate(() => {
    const s = window.__SKY;
    for (let i = 0; i < 12; i++) s.registerKill(120, 300);
    return window.__ACH__.isUnlocked('first_blood');
  });
  assert('first_blood 解锁(单局>=10杀)', fb);

  // ---------- super_nova：释放星风暴 ----------
  const sn = await page.evaluate(() => {
    const s = window.__SKY;
    s.energy = 9999;
    s.useSuper();
    return window.__ACH__.isUnlocked('super_nova');
  });
  assert('super_nova 解锁(释放星风暴)', sn);

  // ---------- element_fire：火元素累计击杀 50 ----------
  const ef = await page.evaluate(() => {
    const s = window.__SKY;
    for (let i = 0; i < 50; i++) s.registerKill(120, 300, { element: 'fire' });
    return {
      unlocked: window.__ACH__.isUnlocked('element_fire'),
      prog: window.__ACH__.getProgress('element_fire'),
    };
  });
  assert('element_fire 解锁(火累计50杀)', ef.unlocked);
  assert('element_fire 进度=50/50', ef.prog && ef.prog.cur === 50 && ef.prog.target === 50);

  // ---------- bossrush_clear：Boss Rush 全通 ----------
  await page.evaluate(() => {
    const g = window.__SKY__;
    g.scene.stop('GameScene'); g.scene.stop('UIScene');
    g.scene.start('GameScene', { mode: 'bossrush' });
  });
  // 轮询等首关 Boss 生成（不用固定 sleep：生成耗时受机器负载影响，定时等待会偶发抢跑）
  await page.waitForFunction(
    () => { const s = window.__SKY; return !!(s && s.boss && s.boss.active && s.boss.bossKey); },
    null, { timeout: 15000 },
  );
  const br0 = await page.evaluate(() => {
    const s = window.__SKY;
    return { mode: s.mode, boss: s.boss ? s.boss.bossKey : null };
  });
  assert('BossRush 首关=哨兵', br0.mode === 'bossrush' && br0.boss === 'boss_sentinel');

  // 连破三关：每关都先轮询确认"本关 Boss 已生成"再击破，击破后再轮询确认
  // "已切到下一个不同的 Boss 或本局已结束"。原实现用固定 sleep(1500)，
  // Boss 未及时生成时会对同一个 Boss 重复结算，导致 boss_all 三连破首跑偶发 FAIL。
  const bossSeq = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(
      () => { const s = window.__SKY; return !!(s && s.boss && s.boss.active && s.boss.bossKey); },
      null, { timeout: 15000 },
    );
    const cur = await page.evaluate(() => window.__SKY.boss.bossKey);
    bossSeq.push(cur);
    await page.evaluate(() => { const s = window.__SKY; if (s && s._onBossDefeated) s._onBossDefeated(); });
    // 末关击破后本局结束，不会再有新 Boss —— gameEnded 也算达成条件
    await page.waitForFunction(
      (prev) => {
        const s = window.__SKY;
        if (!s || s.gameEnded) return true;
        return !!(s.boss && s.boss.active && s.boss.bossKey && s.boss.bossKey !== prev);
      },
      cur, { timeout: 15000 },
    );
  }
  assert('三连破为三个不同 Boss（boss_all 前置）', new Set(bossSeq).size === 3);
  // 轮询等 endGame + reportRun 落地，避免固定 sleep 抢跑
  await page.waitForFunction(
    () => { const A = window.__ACH__; return !!(A && A.isUnlocked('bossrush_clear')); },
    null, { timeout: 15000 },
  ).catch(() => {});

  const brEnd = await page.evaluate(() => {
    const ach = window.__SAVE.get('achievements');
    return {
      bossrush_clear: window.__ACH__.isUnlocked('bossrush_clear'),
      boss_all: window.__ACH__.isUnlocked('boss_all'),
      boss_sentinel: window.__ACH__.isUnlocked('boss_sentinel'),
      persisted: !!(ach && ach.bossrush_clear === true),
      isRecord: ach && typeof ach === 'object' && !Array.isArray(ach),
    };
  });
  await page.screenshot({ path: `${SHOT}/shot_ach_bossrush.png` });
  assert('bossrush_clear 解锁(BossRush全通)', brEnd.bossrush_clear);
  assert('boss_all 解锁(三Boss各1次)', brEnd.boss_all);
  assert('boss_sentinel 解锁', brEnd.boss_sentinel);
  assert('解锁写入 SaveManager.achievements 且无重复(对象映射)', brEnd.persisted && brEnd.isRecord);

  // ---------- 汇总断言 ----------
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
  console.log(`\n==== 成就真测汇总: ${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
}
