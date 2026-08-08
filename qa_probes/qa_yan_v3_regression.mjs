// 严过关 v3 独立回归探针 —— 元素协同成就阈值还原（5→3 / 50→30）
// 不复用实现者断言，全部重写口径。AC-1~AC-5 + 自设边界场景 X1~X7。
import { chromium } from 'playwright';

const URL = 'http://localhost:5059/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let pass = 0, fail = 0;
function chk(id, name, ok, evidence) {
  if (ok) { pass++; out.push(`PASS [${id}] ${name}  >> ${evidence}`); }
  else { fail++; out.push(`FAIL [${id}] ${name}  >> ${evidence}`); }
  console.log(out[out.length - 1]);
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

async function waitGlobals() {
  await page.waitForFunction(() => !!window.__SKY__ && !!window.__SAVE && !!window.__ACH__, null, { timeout: 20000 });
  await sleep(600);
}
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
  await waitGlobals();
  await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });

  // ══════════ AC-1 运行时反推配置（不只读文件，量真实行为） ══════════
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const cfg = await page.evaluate(() => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset();
    const rst = () => { sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0; };
    // TRIGGER：spy reportElementCombo，找首次触发所需交替命中数
    let trig = 0; const o = A.reportElementCombo; A.reportElementCombo = function (e) { trig++; return o.call(A, e); };
    rst(); const t0 = s.time.now; let firstAt = -1;
    for (let i = 0; i < 12 && firstAt < 0; i++) { sys.reportHit(i % 2 === 1, 'fire', t0 + i * 100); if (trig > 0) firstAt = i + 1; }
    const buffMs = sys.combo.activeUntil - (t0 + (firstAt - 1) * 100);
    const dmgMul = sys.getComboMul(t0 + (firstAt - 1) * 100 + 10);
    // WINDOW_MS 边界：间隔恰好 1200 应续链（判定是 > 不是 >=），1201 应断链
    rst(); sys.reportHit(false, 'fire', 10000); sys.reportHit(true, 'fire', 10000 + 1200);
    const at1200 = sys.combo.count;
    rst(); sys.reportHit(false, 'fire', 20000); sys.reportHit(true, 'fire', 20000 + 1201);
    const at1201 = sys.combo.count;
    A.reportElementCombo = o; rst(); A.reset();
    return { firstAt, buffMs, dmgMul, at1200, at1201 };
  });
  chk('AC-1a', 'TRIGGER 运行时实测仍为 5（未被顺手改回 3）', cfg.firstAt === 5,
    `首次协同触发发生在第 ${cfg.firstAt} 次交替命中（TRIGGER=${cfg.firstAt}）`);
  chk('AC-1b', 'BUFF_MS=3000 / DMG_MUL=1.35', Math.abs(cfg.buffMs - 3000) < 1e-6 && Math.abs(cfg.dmgMul - 1.35) < 1e-9,
    `增益时长 ${cfg.buffMs}ms，增益期倍率 ${cfg.dmgMul}`);
  chk('AC-1c', 'WINDOW_MS=1200 且边界为闭区间（1200 续链 / 1201 断链）',
    cfg.at1200 === 2 && cfg.at1201 === 1,
    `间隔 1200ms 后 count=${cfg.at1200}（续链应为2），间隔 1201ms 后 count=${cfg.at1201}（断链重起应为1）`);

  // ══════════ AC-4 交替命中成本 = 15（独立口径：逐次快照） ══════════
  const cost = await page.evaluate(() => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset();
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    // 用 spy 统计真实触发次数（getProgress().cur 会被 Math.min 钳到 3，不能当计数器用）
    let trig = 0; const o = A.reportElementCombo; A.reportElementCombo = function (e) { trig++; return o.call(A, e); };
    const t0 = s.time.now; const snap = [];
    for (let i = 0; i < 20; i++) {
      sys.reportHit(i % 2 === 1, 'fire', t0 + i * 150);
      snap.push({ n: i + 1, u: A.isUnlocked('combo_element_5'), run: A.getProgress('combo_element_5').cur, trig });
    }
    A.reportElementCombo = o;
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    return { snap, first: (snap.find((x) => x.u) || { n: -1 }).n, members: sys.getCount() };
  });
  chk('AC-4', '第 15 次交替命中恰好解锁、第 14 次仍未解锁（成本=15，等价改动前）',
    cost.first === 15 && cost.snap[13].u === false && cost.snap[14].u === true && cost.members >= 1,
    `首解锁于第 ${cost.first} 次；第14次 unlocked=${cost.snap[13].u}(run=${cost.snap[13].run})，`
    + `第15次 unlocked=${cost.snap[14].u}(run=${cost.snap[14].run})；僚机 ${cost.members} 架`);
  chk('AC-4b', '协同触发点严格落在 5/10/15/20 次（触发后计数清零而非清1）',
    cost.snap[4].trig === 1 && cost.snap[9].trig === 2 && cost.snap[14].trig === 3 && cost.snap[19].trig === 4
    && cost.snap[3].trig === 0 && cost.snap[8].trig === 1,
    `第4/5/9/10/15/20 次交替命中后真实触发数 = ${cost.snap[3].trig}/${cost.snap[4].trig}/${cost.snap[8].trig}/${cost.snap[9].trig}/${cost.snap[14].trig}/${cost.snap[19].trig}`);
  chk('X8', '【自设】getProgress().cur 被 Math.min 钳位，不可当计数器：第20次真实触发4次但 cur 显示 3',
    cost.snap[19].trig === 4 && cost.snap[19].run === 3,
    `第20次交替命中：真实触发=${cost.snap[19].trig}，getProgress().cur=${cost.snap[19].run}（钳位正确）`);

  // ══════════ AC-3 边界值 + X1 溢出钳位 ══════════
  const edge = await page.evaluate(() => {
    const A = window.__ACH__; A.reset();
    const R = [];
    for (let i = 1; i <= 9; i++) { A.reportElementCombo('fire'); const p = A.getProgress('combo_element_5'); R.push({ i, cur: p.cur, t: p.target, u: p.unlocked, r: +p.ratio.toFixed(3) }); }
    A.reset(); const T = [];
    for (let i = 1; i <= 35; i++) { A.reportElementCombo('ice'); if (i >= 28) { const p = A.getProgress('combo_element_50'); T.push({ i, cur: p.cur, t: p.target, u: p.unlocked, r: +p.ratio.toFixed(3) }); } }
    A.reset();
    return { R, T };
  });
  const r2 = edge.R[1], r3 = edge.R[2], r9 = edge.R[8];
  const t29 = edge.T.find((x) => x.i === 29), t30 = edge.T.find((x) => x.i === 30), t35 = edge.T.find((x) => x.i === 35);
  chk('AC-3a', 'combo_element_5：2 次未解锁 / 3 次解锁，target 恒为 3',
    r2.u === false && r2.cur === 2 && r2.t === 3 && r3.u === true && r3.cur === 3 && r3.t === 3,
    `第2次 ${r2.cur}/${r2.t} unlocked=${r2.u}；第3次 ${r3.cur}/${r3.t} unlocked=${r3.u}`);
  chk('AC-3b', 'combo_element_50：29 次未解锁 / 30 次解锁，target 恒为 30',
    t29.u === false && t29.cur === 29 && t29.t === 30 && t30.u === true && t30.cur === 30 && t30.t === 30,
    `第29次 ${t29.cur}/${t29.t} unlocked=${t29.u}；第30次 ${t30.cur}/${t30.t} unlocked=${t30.u}`);
  chk('X1', '【自设】超额溢出：解锁后继续累计，进度分子必须钳在 target，不出现 9/3 或 35/30',
    r9.cur === 3 && r9.t === 3 && r9.r === 1 && t35.cur === 30 && t35.t === 30 && t35.r === 1,
    `单局第9次协同 -> 显示 ${r9.cur}/${r9.t} ratio=${r9.r}；累计第35次 -> 显示 ${t35.cur}/${t35.t} ratio=${t35.r}`);

  // ══════════ X6 desc 文案与真实阈值一致性（M1 假绿盲区的补位断言） ══════════
  const descChk = await page.evaluate(() => {
    const A = window.__ACH__;
    const grab = (id) => { const d = A.getDefinition(id); const m = d.desc.match(/(\d+)/); return { desc: d.desc, num: m ? +m[1] : null, name: d.name }; };
    A.reset();
    let n5 = -1; for (let i = 1; i <= 10 && n5 < 0; i++) { A.reportElementCombo('fire'); if (A.isUnlocked('combo_element_5')) n5 = i; }
    A.reset();
    let n50 = -1; for (let i = 1; i <= 60 && n50 < 0; i++) { A.reportElementCombo('fire'); if (A.isUnlocked('combo_element_50')) n50 = i; }
    A.reset();
    return { d5: grab('combo_element_5'), d50: grab('combo_element_50'), n5, n50, t5: A.getProgress('combo_element_5').target, t50: A.getProgress('combo_element_50').target };
  });
  chk('X6', '【自设】desc 文案数字 == target == 实测解锁阈值（三者一致，防"只改逻辑不改文案"）',
    descChk.d5.num === 3 && descChk.t5 === 3 && descChk.n5 === 3
    && descChk.d50.num === 30 && descChk.t50 === 30 && descChk.n50 === 30,
    `「${descChk.d5.desc}」desc数字=${descChk.d5.num} target=${descChk.t5} 实测解锁于第${descChk.n5}次 | `
    + `「${descChk.d50.desc}」desc数字=${descChk.d50.num} target=${descChk.t50} 实测解锁于第${descChk.n50}次`);

  // ══════════ X3 双成就同一次上报同时跨线 ══════════
  const both = await page.evaluate(() => {
    const A = window.__ACH__; A.reset();
    for (let i = 0; i < 29; i++) A.reportElementCombo('fire');   // total=29
    A.startRun('normal', 1);                                      // run 清零, total 保留 29(内存)
    A.reportElementCombo('fire'); A.reportElementCombo('fire');   // run=2 total=31? -> 见下
    const beforeRun = A.getProgress('combo_element_5').cur, beforeTot = A.getProgress('combo_element_50').cur;
    return { beforeRun, beforeTot, u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50') };
  });
  const both2 = await page.evaluate(() => {
    const A = window.__ACH__; A.reset();
    const emits = []; const orig = A._unlock;
    A._unlock = function (d) { const r = orig.call(this, d); if (r) emits.push(d.id); return r; };
    // 连打 40 次：run/total 同步涨，第 3 次跨 combo_element_5、第 30 次跨 combo_element_50
    for (let i = 0; i < 40; i++) A.reportElementCombo('fire');
    const e1 = emits.slice();
    A._unlock = orig;
    return { emits: e1, u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50') };
  });
  chk('X3', '【自设】单局连续 40 次协同：两成就各只派发一次解锁事件，无重复 toast',
    both2.emits.filter((x) => x === 'combo_element_5').length === 1
    && both2.emits.filter((x) => x === 'combo_element_50').length === 1,
    `派发序列(仅combo_*)=${JSON.stringify(both2.emits.filter((x) => x.startsWith('combo_element')))}，`
    + `u5=${both2.u5} u50=${both2.u50}`);

  // ══════════ X4 存档 elementCombos 异常值鲁棒性 ══════════
  const weird = await page.evaluate(() => {
    const A = window.__ACH__, S = window.__SAVE;
    const cases = [-5, 0.5, 29.5, 1e9, Number.MAX_SAFE_INTEGER, NaN, Infinity, 'abc', null, undefined, true];
    const res = [];
    for (const v of cases) {
      S.reset();
      S.saveAchievementStats({ elementCombos: v });
      let err = null, p = null, u = null;
      try { A.init(); p = A.getProgress('combo_element_50'); u = A.isUnlocked('combo_element_50'); }
      catch (e) { err = String(e && e.message || e); }
      res.push({ v: String(v), err, cur: p ? p.cur : null, target: p ? p.target : null, ratio: p ? p.ratio : null, u });
    }
    S.reset(); A.reset();
    return res;
  });
  const weirdBad = weird.filter((x) => x.err !== null || x.target !== 30 || !(x.ratio >= 0 && x.ratio <= 1));
  chk('X4', '【自设】存档 elementCombos 为负/小数/超大/NaN/字符串/null 时不抛错、target 恒 30、ratio∈[0,1]',
    weirdBad.length === 0,
    weirdBad.length === 0
      ? `11 组异常值全部安全，样例：${weird.filter((x) => ['-5', 'NaN', 'abc', '9007199254740991'].includes(x.v)).map((x) => `${x.v}->${x.cur}/${x.target} ratio=${x.ratio} u=${x.u}`).join(' | ')}`
      : `异常项：${JSON.stringify(weirdBad)}`);
  const weirdUnlock = weird.filter((x) => x.u === true && !(typeof x.cur === 'number' && x.cur >= 30));
  chk('X4b', '【自设】异常值不得造成"白嫖解锁"（未达 30 却解锁）', weirdUnlock.length === 0,
    weirdUnlock.length === 0 ? '无白嫖解锁' : `白嫖：${JSON.stringify(weirdUnlock)}`);

  // ══════════ X2 reset() 后 target 稳定 + 不被 _checkLive 复活 ══════════
  const rst = await page.evaluate(() => {
    const A = window.__ACH__; A.reset();
    for (let i = 0; i < 30 ; i++) A.reportElementCombo('fire');
    const before = { u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50') };
    A.reset();
    const afterR = { u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50'), t5: A.getProgress('combo_element_5').target, t50: A.getProgress('combo_element_50').target, c5: A.getProgress('combo_element_5').cur, c50: A.getProgress('combo_element_50').cur };
    A.reportCoins(0); A.reportKill({});           // 触发两次 _checkLive
    const revive = { u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50') };
    A.reset();
    return { before, afterR, revive };
  });
  chk('X2', '【自设】reset() 后两成就归零、target 仍是 3/30、且不被 _checkLive 复活',
    rst.before.u5 && rst.before.u50 && !rst.afterR.u5 && !rst.afterR.u50
    && rst.afterR.t5 === 3 && rst.afterR.t50 === 30 && rst.afterR.c5 === 0 && rst.afterR.c50 === 0
    && !rst.revive.u5 && !rst.revive.u50,
    `reset前 u5=${rst.before.u5} u50=${rst.before.u50}；reset后 ${rst.afterR.c5}/${rst.afterR.t5} 与 ${rst.afterR.c50}/${rst.afterR.t50}，`
    + `u5=${rst.afterR.u5} u50=${rst.afterR.u50}；两次_checkLive后 u5=${rst.revive.u5} u50=${rst.revive.u50}`);

  // ══════════ AC-5 降级路径 ══════════
  // ① 0 架僚机（真实战斗 4s）
  await enterGame({ wingman: 0, wingmanFirepower: 0 }, 1);
  const deg0 = await page.evaluate(async () => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset(); A.startRun('normal', 1);
    for (let i = 0; i < 5; i++) { const e = s.spawnEnemy(120 + i * 70, 320, 'small', 'straight', 1); e.hp = 999999; e.setVelocity(0, 0); }
    let err = null;
    try { for (let i = 0; i < 40; i++) sys.reportHit(i % 2 === 1, 'fire', s.time.now + i * 120); } catch (e) { err = String(e); }
    await new Promise((r) => setTimeout(r, 4000));
    const res = { members: sys.getCount(), count: sys.combo.count, mul: sys.getComboMul(), err,
      run: A.getProgress('combo_element_5').cur, tot: A.getProgress('combo_element_50').cur,
      u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50') };
    s.enemies.children.each((e) => { if (e.active) e.hit(999999); });
    return res;
  });
  chk('AC-5a', '① 0 架僚机：40 次交替上报 + 4s 真实战斗，协同计数恒 0、两成就不解锁、无异常',
    deg0.members === 0 && deg0.run === 0 && deg0.tot === 0 && !deg0.u5 && !deg0.u50 && deg0.count === 0 && deg0.mul === 1 && deg0.err === null,
    `僚机${deg0.members}架 combo.count=${deg0.count} 倍率=${deg0.mul} run=${deg0.run} total=${deg0.tot} u5=${deg0.u5} u50=${deg0.u50} err=${deg0.err}`);

  // ② 苍鹰 SHIPS[0].element === null（真实战斗 5s，不手搓 reportHit）
  await enterGame({ wingman: 2, wingmanFirepower: 3 }, 0);
  const deg1 = await page.evaluate(async () => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset(); A.startRun('normal', 1);
    for (let i = 0; i < 6; i++) { const e = s.spawnEnemy(110 + i * 65, 300 + (i % 3) * 50, 'small', 'straight', 1); e.hp = 999999; e.setVelocity(0, 0); }
    await new Promise((r) => setTimeout(r, 5000));
    const res = { shipEl: sys.element, members: sys.getCount(), count: sys.combo.count, mul: sys.getComboMul(),
      run: A.getProgress('combo_element_5').cur, tot: A.getProgress('combo_element_50').cur,
      u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50') };
    s.enemies.children.each((e) => { if (e.active) e.hit(999999); });
    return res;
  });
  chk('AC-5b', '② 苍鹰（element=null）：5s 真实交战，协同恒 0、两成就不解锁',
    (deg1.shipEl === null || deg1.shipEl === undefined) && deg1.members === 2 && deg1.run === 0 && deg1.tot === 0 && !deg1.u5 && !deg1.u50 && deg1.mul === 1,
    `僚机元素=${JSON.stringify(deg1.shipEl)} 僚机${deg1.members}架 combo.count=${deg1.count} 倍率=${deg1.mul} run=${deg1.run} total=${deg1.tot}`);

  // ③ 携带元素但命中的是无元素子弹
  await enterGame({ wingman: 2, wingmanFirepower: 0 }, 1);
  const deg2 = await page.evaluate(() => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset(); A.startRun('normal', 1);
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    let err = null;
    try { for (let i = 0; i < 40; i++) sys.reportHit(i % 2 === 1, null, s.time.now + i * 120); } catch (e) { err = String(e); }
    const a = { count: sys.combo.count, mul: sys.getComboMul(), run: A.getProgress('combo_element_5').cur, u5: A.isUnlocked('combo_element_5'), err };
    // 混合：无元素命中必须断链（打 4 次 fire 后插一发无元素，再打 4 次 fire，不应触发）
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const t = s.time.now + 50000;
    for (let i = 0; i < 4; i++) sys.reportHit(i % 2 === 1, 'fire', t + i * 100);
    const c4 = sys.combo.count;
    sys.reportHit(true, null, t + 400);                    // 无元素插入 -> 断链
    const cBreak = sys.combo.count;
    for (let i = 0; i < 4; i++) sys.reportHit(i % 2 === 1, 'fire', t + 500 + i * 100);
    const cAfter = sys.combo.count;
    const runAfter = A.getProgress('combo_element_5').cur;
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    A.reset();
    return { ...a, c4, cBreak, cAfter, runAfter };
  });
  chk('AC-5c', '③ 命中不带元素的子弹：40 次上报协同恒 0、不解锁、无异常',
    deg2.count === 0 && deg2.mul === 1 && deg2.run === 0 && deg2.u5 === false && deg2.err === null,
    `combo.count=${deg2.count} 倍率=${deg2.mul} run=${deg2.run} u5=${deg2.u5} err=${deg2.err}`);
  chk('X7', '【自设】无元素命中插入链中必须断链（4+断+4 共 8 次不得凑成触发）',
    deg2.c4 === 4 && deg2.cBreak === 0 && deg2.cAfter === 4 && deg2.runAfter === 0,
    `连打4次 count=${deg2.c4} -> 插入无元素 count=${deg2.cBreak} -> 再打4次 count=${deg2.cAfter}，协同触发数=${deg2.runAfter}`);

  // ══════════ X5 同侧连打不计数（防廉价刷成就） ══════════
  const sameSide = await page.evaluate(() => {
    const s = window.__SKY, sys = s.wingmanSystem, A = window.__ACH__;
    A.reset();
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    const t = s.time.now + 90000;
    for (let i = 0; i < 40; i++) sys.reportHit(false, 'fire', t + i * 100);   // 全玩家侧
    const r = { count: sys.combo.count, run: A.getProgress('combo_element_5').cur, u5: A.isUnlocked('combo_element_5') };
    sys.combo.activeUntil = 0; sys.combo.count = 0; sys.combo.element = null; sys.combo.lastSide = null; sys.combo.lastAt = 0;
    A.reset();
    return r;
  });
  chk('X5', '【自设】同侧连打 40 次不计数（成就不可被单方刷出）',
    sameSide.count === 1 && sameSide.run === 0 && sameSide.u5 === false,
    `全玩家侧 40 次命中后 count=${sameSide.count}（应恒为1），协同触发=${sameSide.run}，u5=${sameSide.u5}`);

  // ══════════ AC-2 存档向后兼容（写"改动前存档" -> 整页 reload -> 加载新版本） ══════════
  await page.evaluate(() => {
    const S = window.__SAVE;
    S.reset();
    S.unlockAchievement('combo_element_5');
    S.unlockAchievement('combo_element_50');
    S.saveAchievementStats({ elementCombos: 63 });   // 老玩家已刷到 63 次
    S.set('totalKills', 1234);
  });
  const rawBefore = await page.evaluate(() => localStorage.getItem('sky_raiders_save_v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await waitGlobals();
  const compat = await page.evaluate(() => {
    const A = window.__ACH__, S = window.__SAVE;
    const emits = []; const orig = A._unlock;
    A._unlock = function (d) { const r = orig.call(this, d); if (r) emits.push(d.id); return r; };
    A.init();
    const u = { u5: A.isUnlocked('combo_element_5'), u50: A.isUnlocked('combo_element_50') };
    const p5 = A.getProgress('combo_element_5'), p50 = A.getProgress('combo_element_50');
    A.startRun('normal', 1);
    for (let i = 0; i < 6; i++) A.reportElementCombo('fire');    // 老存档 total=63 -> 69，再次跨线
    A.reportRun({ victory: false, damageTaken: 1, stars: 0, levelId: 1, mode: 'normal' });
    A._unlock = orig;
    const ids = Object.keys(S.getAchievements());
    return { u, p5, p50, emits, ids, elementCombos: S.load().achievementStats.elementCombos };
  });
  chk('AC-2a', '改动前存档加载后两成就仍为已解锁（id 未变，解锁记录未失效）',
    compat.u.u5 === true && compat.u.u50 === true,
    `reload 后 isUnlocked: combo_element_5=${compat.u.u5} combo_element_50=${compat.u.u50}；存档 id 集合=${JSON.stringify(compat.ids)}`);
  chk('AC-2b', '不重复派发 ACHIEVEMENT_UNLOCKED（不再弹解锁 toast）',
    compat.emits.filter((x) => x === 'combo_element_5' || x === 'combo_element_50').length === 0,
    `一整局(6次协同 + reportRun)期间 combo_* 解锁派发次数=0，实际派发列表=${JSON.stringify(compat.emits)}`);
  chk('AC-2c', '老存档累计值不被新阈值破坏（63 -> 69 正常累加），进度分母显示 30 且钳位',
    compat.elementCombos === 69 && compat.p50.target === 30 && compat.p50.cur === 30 && compat.p50.ratio === 1,
    `elementCombos 63->${compat.elementCombos}；combo_element_50 进度 ${compat.p50.cur}/${compat.p50.target} ratio=${compat.p50.ratio}；`
    + `combo_element_5 进度 ${compat.p5.cur}/${compat.p5.target}`);
  chk('AC-2d', '存档主键仍为 combo_element_5 / combo_element_50 字符串原文',
    compat.ids.includes('combo_element_5') && compat.ids.includes('combo_element_50'),
    `存档 achievements 键：${JSON.stringify(compat.ids)}`);
  chk('AC-2e', '存档原文快照含两个 id（改动前写入格式）',
    rawBefore.includes('"combo_element_5":true') && rawBefore.includes('"combo_element_50":true'),
    `原始存档片段：${(rawBefore.match(/"achievements":\{[^}]*\}/) || [''])[0]}`);

  await page.evaluate(() => { window.__SAVE.reset(); window.__ACH__.reset(); });

} catch (e) {
  fail++; console.log('EXCEPTION ' + (e && e.stack ? e.stack : e));
} finally {
  console.log(`\npageerror=${pageErrors.length} consoleError=${consoleErrors.length}`);
  if (pageErrors.length) console.log('PAGEERRORS: ' + pageErrors.slice(0, 5).join(' | '));
  if (consoleErrors.length) console.log('CONSOLE: ' + consoleErrors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(`\n==== 严过关 v3 独立回归: ${pass} PASS / ${fail} FAIL ====`);
}
