// 严过关 v3：占空比指标的重复测量，量化 run-to-run 方差，判定 E1 断言是否本质 flaky
import { chromium } from 'playwright';
const URL = 'http://localhost:5059/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);
const stat = (a) => { const mn = Math.min(...a), mx = Math.max(...a), av = a.reduce((x, y) => x + y, 0) / a.length; return `min=${mn}% max=${mx}% 均值=${av.toFixed(0)}% 极差=${mx - mn}pp`; };

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
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
async function measure(frozen, dur) {
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  return page.evaluate(async ({ F, D }) => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset(); A.startRun('normal', 1);
    if (F) for (let i = 0; i < 6; i++) { const e = s.spawnEnemy(120 + i * 60, 300 + (i % 3) * 60, 'small', 'straight', 1); e.hp = 999999; e.setVelocity(0, 0); }
    let trig = 0; const o = A.reportElementCombo; A.reportElementCombo = function (el) { trig++; return o.call(A, el); };
    let act = 0, tot = 0;
    const iv = setInterval(() => { tot++; if (sys.getComboMul() > 1) act++; }, 50);
    await new Promise((r) => setTimeout(r, D));
    clearInterval(iv); A.reportElementCombo = o;
    if (F) s.enemies.children.each((e) => { if (e.active) e.hit(999999); });
    return { trig, up: Math.round((tot ? act / tot : 0) * 100), alive: !!(s.player && s.player.active) };
  }, { F: frozen, D: dur });
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE && !!window.__ACH__, null, { timeout: 20000 });
  await sleep(700);
  await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });

  const frozen = [], real = [];
  log('A. 理想接敌探针场景（E1 用的口径：6 架冻结敌机），6s × 4 次重复：');
  for (let i = 0; i < 4; i++) { const r = await measure(true, 6000); frozen.push(r.up); log(`   第${i + 1}次：占空比 ${r.up}%，触发 ${r.trig} 次，玩家存活=${r.alive}`); }
  log(`   >> ${stat(frozen)}   E1 断言线 <70%`);
  log('');
  log('B. 真实波次场景（v2b / 交付文档用的口径），10s × 4 次重复：');
  for (let i = 0; i < 4; i++) { const r = await measure(false, 10000); real.push(r.up); log(`   第${i + 1}次：占空比 ${r.up}%，触发 ${r.trig} 次，玩家存活=${r.alive}`); }
  log(`   >> ${stat(real)}   交付文档宣称 18%~28%`);
  log('');
  const fLo = Math.min(...frozen), fHi = Math.max(...frozen);
  log(`结论素材：E1 断言线 70% ${fLo < 70 && fHi > 70 ? '落在理想场景实测区间内 -> 断言本质 flaky（同一代码随机红/绿）' : (fLo >= 70 ? '恒低于实测区间 -> 断言恒红' : '恒高于实测区间 -> 断言恒绿')}`);
  const rLo = Math.min(...real), rHi = Math.max(...real);
  log(`交付文档 18%~28% ${rHi <= 28 && rLo >= 18 ? '与真实波次实测吻合' : `与真实波次实测区间 ${rLo}%~${rHi}% 不吻合 -> 文档区间过窄/以单次采样当结论`}`);
} catch (e) {
  log('EXCEPTION ' + (e && e.stack ? e.stack : e));
} finally { await browser.close(); }
