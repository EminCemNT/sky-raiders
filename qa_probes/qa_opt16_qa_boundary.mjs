// qa_opt16_qa_boundary.mjs —— QA-OPT 独立边界探针（与 coder-opt 自测 b1/b2/b3 相互独立）
//
// 审计目标（docs/OPT-16-TECH-SPEC.md）：
//   A. T1/T2  正常存档零改动：真实合法存档（脏档自愈后的落盘值）再注入 → sanitize 必须返回 false，
//              且逐字段与注入值等价 + localStorage 字符串零重写。
//   B. T3     敌弹越界回收合并：越界敌弹单次 _updateEnemyBullets 即回收；界内弹不回收；
//              擦弹判定仍在（tick 对齐后同弹环内触发）。
//   C. T5     zh/en 往返逐字等价：同一流程两次启动同语言文本逐字一致；en 无 CJK；zh/en 有差异。
//
// 运行：node qa_probes/qa_opt16_qa_boundary.mjs （QA_URL 默认 http://127.0.0.1:5059）
// 只读审计，不修改任何 src/ 源码。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };

async function launchPage(saveObj, lang) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save, lg }) => {
    try {
      const s = save == null ? null : (typeof save === 'string' ? save : JSON.stringify(save));
      if (s != null) localStorage.setItem(key, s);
      if (lg) localStorage.setItem('__qa_lang', lg);
    } catch (e) { /* ignore */ }
  }, { key: SAVE_KEY, save: saveObj, lg: lang });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error('launchPage timeout: ' + errors.slice(0, 3).join(' | ') || '(no console error)');
  }
  return { ctx, page, errors };
}

async function enterBattle(page) {
  await page.evaluate(async () => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
    await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const gs = game.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
      }, 50);
    });
  });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.player && gs.player.active;
  }, null, { timeout: 10000 });
}

// ─────────────────────────────────────────────
// A. T1/T2 正常存档零改动
// ─────────────────────────────────────────────
console.log('\n=== A. T1/T2 正常存档零改动（脏档自愈→落盘值再注入→零改动） ===');

// A1 先注入一个脏档，让 installSanitizer 自愈并落盘；读取修复后的合法落盘字符串 R
const dirtySave = {
  lang: 'zh', tutorialDone: true, quality: 'high',
  coins: -50,                         // 越界
  upgrades: { firepower: 9999, wingmanFirepower: -3, armor: 2, engine: 5, shield: 1, magnet: 0 },
  levelStars: { 1: 9, 2: 2, 3: -1 },  // 9 越界、-1 非法
  achievements: { first_blood: true, hack_cheat: true }, // hack_cheat 非白名单
  achievementStats: { elementKills: { fire: 10, ice: -2, thunder: 3 } },
  moduleInv: [{ key: 'weapon_common', slot: 'weapon', quality: 'common' }, { key: 'not_real', slot: 'x', quality: 'y' }],
  topScores: [{ score: 500, levelId: 1, mode: 'normal', date: '2026-01-01' }],
  tutorialDone: true,
};
const ctxA = await launchPage(dirtySave);
let A = null;
try {
  A = await ctxA.page.evaluate(() => ({
    sanitize: window.__SAVE_SANITIZE ? { sanitized: window.__SAVE_SANITIZE.sanitized, issues: window.__SAVE_SANITIZE.issues.slice(), broken: window.__SAVE_SANITIZE.structurallyBroken } : null,
    raw: localStorage.getItem('sky_raiders_save_v1'),
  }));
} catch (e) { A = { evalError: String(e) }; }
push('脏档启动后 __SAVE_SANITIZE.sanitized === true（确有自愈发生）',
  !!(A && A.sanitize && A.sanitize.sanitized === true),
  JSON.stringify(A && A.sanitize ? A.sanitize.issues : A));
const repairedRaw = (A && A.raw) || null;
push('脏档自愈后 localStorage 已落盘（R 非空）', !!repairedRaw, repairedRaw ? 'len=' + repairedRaw.length : 'null');
await ctxA.ctx.close().catch(() => {});
if (!repairedRaw) { push('【前置失败】无法取得合法落盘值 R，A 组后续跳过', false); }
else {
  // A2 将 R（已落盘合法存档）再次注入 → 断言 sanitize=false + 逐字段等价 + localStorage 字符串零变化
  const ctxB = await launchPage(repairedRaw);
  let B = null;
  try {
    B = await ctxB.page.evaluate(() => {
      const rawAfter = localStorage.getItem('sky_raiders_save_v1');
      const st = window.__SAVE_SANITIZE;
      // 逐字段读取权威存档（SaveManager cache）
      const SM = window.__SAVE;
      const pick = (fn) => { try { return fn(); } catch (e) { return 'ERR:' + e.message; } };
      const upgrades = pick(() => {
        const u = SM.get('upgrades') || {};
        return u;
      });
      const levelStars = pick(() => {
        const ls = SM.get('levelStars') || {};
        const out = {};
        for (const k of Object.keys(ls)) out[k] = ls[k];
        return out;
      });
      const achKeys = pick(() => { const a = SM.get('achievements') || {}; return Object.keys(a).sort(); });
      return {
        sanitized: st ? st.sanitized : null,
        issues: st ? st.issues.slice() : [],
        coins: SM.get('coins'),
        upgrades,
        levelStars,
        achKeys,
        elementKills: SM.get('achievementStats') ? (SM.get('achievementStats').elementKills || null) : null,
        moduleInvLen: (SM.get('moduleInv') || []).length,
        rawAfter,
      };
    });
  } catch (e) { B = { evalError: String(e) }; }

  const inj = JSON.parse(repairedRaw);
  const rawUnchanged = !!(B && B.rawAfter === repairedRaw);
  push('合法存档 R 二次注入 → sanitize 返回 false（零改动）',
    !!(B && B.sanitized === false), B ? 'issues=' + JSON.stringify(B.issues) : 'no data');
  push('合法存档 R 二次注入 → localStorage 字符串零重写（逐字节等价）',
    rawUnchanged, B && B.rawAfter ? 'len=' + B.rawAfter.length : 'no data');
  // 逐字段等价：coins/upgrades 与注入值一致
  const coinsEq = !!(B && B.coins === inj.coins);
  push('coins 逐字段零改动（' + inj.coins + '）', coinsEq, B ? 'got=' + B.coins : 'no data');
  // upgrades 六字段与注入值逐字段比较
  if (B && B.upgrades && inj.upgrades) {
    const keys = Object.keys(inj.upgrades);
    const diffs = [];
    for (const k of keys) {
      if (B.upgrades[k] !== inj.upgrades[k]) diffs.push(k + ':' + B.upgrades[k] + '!=' + inj.upgrades[k]);
    }
    if (Object.keys(B.upgrades).length !== keys.length) diffs.push('keyCount:' + Object.keys(B.upgrades).length + '!=' + keys.length);
    push('upgrades 六字段逐字段零改动（' + keys.join(',') + '）', diffs.length === 0, diffs.join(',') || 'all equal');
  } else { push('upgrades 六字段逐字段零改动', false, 'no data'); }
  // levelStars 与注入等价（脏档中 1:9/3:-1 越界→修复剔除，故注入 R 中仅合法 key）
  const injLs = inj.levelStars || {};
  const lsDiff = [];
  for (const k of Object.keys(injLs)) {
    if (!(B && B.levelStars && B.levelStars[k] === injLs[k])) lsDiff.push(k + ':' + (B && B.levelStars ? B.levelStars[k] : 'undef') + '!=' + injLs[k]);
  }
  if (B && B.levelStars && Object.keys(B.levelStars).length !== Object.keys(injLs).length) lsDiff.push('extraKeys=' + Object.keys(B.levelStars).join(','));
  push('levelStars 逐字段零改动（合法 key=' + Object.keys(injLs).join(',') + '）', lsDiff.length === 0, lsDiff.join(',') || 'all equal');
  // achievements 白名单 key 集合一致
  const injAch = Object.keys(inj.achievements || {}).sort();
  const achEq = !!(B && JSON.stringify(B.achKeys) === JSON.stringify(injAch));
  push('achievements 白名单 key 集合零改动（' + injAch.join(',') + '）', achEq, B ? JSON.stringify(B.achKeys) : 'no data');
  // moduleInv 数组长度一致
  const miEq = !!(B && B.moduleInvLen === (inj.moduleInv || []).length);
  push('moduleInv 长度零改动（' + (inj.moduleInv || []).length + '）', miEq, B ? 'got=' + B.moduleInvLen : 'no data');
  await ctxB.ctx.close().catch(() => {});
}

// ─────────────────────────────────────────────
// B. T3 敌弹越界回收 + 擦弹合并不回归
// ─────────────────────────────────────────────
console.log('\n=== B. T3 敌弹单次遍历：越界回收 / 界内不回收 / 擦弹仍触发 ===');
{
  const ctx = await launchPage(null, 'zh');
  try {
    await enterBattle(ctx.page);
    const res = await ctx.page.evaluate(() => {
      const gs = window.__SKY__.scene.getScene('GameScene');
      if (!gs || !gs.player) return { err: 'no gs/player' };
      const H = 960; // GAME_HEIGHT
      const out = {};
      // 清空既有敌弹（避免干扰）
      if (gs.enemyBullets && gs.enemyBullets.children) {
        gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
      }
      // B1: 越界弹（y = H+40）→ 单次 _updateEnemyBullets 即回收
      const bOut = gs.enemyBullets.get(100, H + 40, 'bullet_enemy');
      bOut.setActive(true).setVisible(true); if (bOut.body) bOut.body.enable = true;
      out.bOutActiveBefore = bOut.active;
      gs._grazeTick = 0; gs._trailTick = 0;
      gs._updateEnemyBullets(gs.time.now);
      out.bOutActiveAfter = bOut.active;

      // B2: 界内弹（远离玩家，不在擦弹环）→ 不回收
      const p = gs.player;
      const bIn = gs.enemyBullets.get(p.x + 300, p.y, 'bullet_enemy');
      bIn.setActive(true).setVisible(true); if (bIn.body) { bIn.body.enable = true; bIn.body.velocity.set(0, 50); }
      out.bInActiveBefore = bIn.active;
      gs._updateEnemyBullets(gs.time.now);
      out.bInActiveAfter = bIn.active;

      // B3: 擦弹仍触发：界内弹放入擦弹环（玩家右侧 15px、向下速度 200）→ tick 对齐为擦弹帧
      const before = gs.grazeCount || 0;
      const beforeScore = gs.score || 0;
      const bG = gs.enemyBullets.get(p.x + 15, p.y, 'bullet_enemy');
      bG.setActive(true).setVisible(true); if (bG.body) { bG.body.enable = true; bG.body.velocity.set(0, 200); }
      bG._grazedAt = null;
      gs._grazeTick = 1; // 方法内 ++ → 2；CHECK_EVERY=2 → 本帧为擦弹帧
      gs._updateEnemyBullets(gs.time.now);
      out.grazeDelta = (gs.grazeCount || 0) - before;
      out.scoreDelta = (gs.score || 0) - beforeScore;
      out.bGActiveAfter = bG.active;
      // B4: 同一帧内绝不多次遍历（T3 合并核心）：计数每次调用至多 +1
      out.loopCount = gs._bulletLoopCount || 0;
      return out;
    });
    if (res.err) { push('T3 边界探针执行', false, res.err); }
    else {
      push('T3a 越界敌弹（y>H+30）单次调用即回收', res.bOutActiveBefore === true && res.bOutActiveAfter === false,
        `before=${res.bOutActiveBefore} after=${res.bOutActiveAfter}`);
      push('T3b 界内敌弹不被回收', res.bInActiveBefore === true && res.bInActiveAfter === true,
        `before=${res.bInActiveBefore} after=${res.bInActiveAfter}`);
      push('T3c 擦弹判定合并后仍触发（graze +1 且得分 +5）', res.grazeDelta === 1 && res.scoreDelta === 5,
        `grazeDelta=${res.grazeDelta} scoreDelta=${res.scoreDelta}`);
      push('T3d 擦弹环内弹未被误回收', res.bGActiveAfter === true, `active=${res.bGActiveAfter}`);
    }
  } catch (e) {
    push('T3 边界探针执行异常', false, String(e && e.message || e));
  }
  await ctx.ctx.close().catch(() => {});
}

// ─────────────────────────────────────────────
// C. T5 zh/en 往返逐字等价
// ─────────────────────────────────────────────
console.log('\n=== C. T5 zh/en 往返逐字等价 ===');
async function captureHudTexts(lang) {
  const ctx = await launchPage({ lang, tutorialDone: true, quality: 'high' }, lang);
  try {
    await enterBattle(ctx.page);
    // 等 UIScene 挂好并触发一次初始事件刷新
    await ctx.page.waitForTimeout(300);
    const txt = await ctx.page.evaluate(() => {
      const ui = window.__SKY__.scene.getScene('UIScene');
      if (!ui) return null;
      const g = (o) => (o && typeof o.text === 'string' ? o.text : null);
      return {
        lives: g(ui.livesText), power: g(ui.powerText), graze: g(ui.grazeText),
        energy: g(ui.energyText), weapon: g(ui.weaponText), hp: g(ui.hpText),
        combo: g(ui.comboText), wave: g(ui.waveText),
      };
    });
    await ctx.ctx.close().catch(() => {});
    return { ctx: null, txt, err: null };
  } catch (e) {
    await ctx.ctx.close().catch(() => {});
    return { ctx: null, txt: null, err: String(e && e.message || e) };
  }
}
const zh1 = await captureHudTexts('zh');
const zh2 = await captureHudTexts('zh');
const en1 = await captureHudTexts('en');
const en2 = await captureHudTexts('en');
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s || '');

if (!zh1.txt || !zh2.txt || !en1.txt || !en2.txt) {
  push('T5 HUD 文本采集', false, JSON.stringify({ zh1: zh1.err || zh1.txt, zh2: zh2.err, en1: en1.err, en2: en2.err }));
} else {
  const keys = ['lives', 'power', 'graze', 'energy', 'weapon', 'hp', 'combo', 'wave'];
  const zhStable = keys.every((k) => zh1.txt[k] === zh2.txt[k]);
  const enStable = keys.every((k) => en1.txt[k] === en2.txt[k]);
  const enNoCJK = keys.every((k) => !hasCJK(en1.txt[k]) && !hasCJK(en2.txt[k]));
  const differs = keys.some((k) => zh1.txt[k] !== en1.txt[k]);
  push('T5a zh 两次启动 HUD 文本逐字一致（往返无漂移）', zhStable, JSON.stringify(zh1.txt));
  push('T5b en 两次启动 HUD 文本逐字一致（往返无漂移）', enStable, JSON.stringify(en1.txt));
  push('T5c en 文本无中文字符（真英文）', enNoCJK, JSON.stringify(en1.txt));
  push('T5d zh/en 文本确有差异（语言切换生效）', differs, `lives zh=${zh1.txt.lives} en=${en1.txt.lives}`);
  // 关键词抽查：en 含英文关键标签，zh 含对应中文
  const enKeyOk = /Lives/i.test(en1.txt.lives || '') && /Power/i.test(en1.txt.power || '') && /Energy/i.test(en1.txt.energy || '');
  const zhKeyOk = /命/.test(zh1.txt.lives || '') && /火力/.test(zh1.txt.power || '') && /能量/.test(zh1.txt.energy || '');
  push('T5e en/zh 关键标签抽查（Lives/命、Power/火力、Energy/能量）', enKeyOk && zhKeyOk,
    `en=${JSON.stringify([en1.txt.lives, en1.txt.power, en1.txt.energy])} zh=${JSON.stringify([zh1.txt.lives, zh1.txt.power, zh1.txt.energy])}`);
}

// ─────────────────────────────────────────────
console.log('\n=== 汇总 ===');
const pass = checks.filter((c) => c.ok).length;
console.log(`PASS ${pass}/${checks.length}`);
await browser.close();
if (pass !== checks.length) process.exit(1);
