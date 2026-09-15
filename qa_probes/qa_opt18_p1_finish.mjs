// qa_opt18_p1_finish.mjs —— OPT-18 P1 批（F3 受击定格+机体闪白 / U2 机库布局净空）防回归探针
// ---------------------------------------------------------------------------
// 覆盖 2 项改动：
//   F3 受击反馈（Player.takeDamage + Player._flashHit）：
//      F3a 受击触发轻定格（_hitStopMs>0 或 physics.world 暂停）
//      F3b 受击瞬间机体白闪（setTintFill：tintFill=true 且 tintTopLeft=0xffffff）
//      F3c 红闪退去时（~95ms）白闪仍在（150ms > F2 红闪 90ms，不被掩盖）
//      F3d 白闪最终恢复（~215ms，tintFill=false，零残留）
//      F3e 无敌期内重复受击被拦（invulnUntil 生效，回归保护）
//   U2 机库布局净空（HangarScene 行高/行距/武器选择器位置）：
//      U2a 「开局武器」芯片与首行卡片无纵向重叠（芯片底 ≤ 首行卡顶）
//      U2b 末行卡片与底部「返回菜单」按钮无纵向重叠
//   全程零 pageerror
// 运行：node qa_probes/qa_opt18_p1_finish.mjs（QA_URL 默认 5059）
// 注意：走真实路径（真实点击），避免 game.scene.start 直切造成的场景残留假象。
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';
const checks = [];
const push = (name, ok, detail = '') => { checks.push({ name, ok }); console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : '')); };

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
const SAVE = { version: 1, lang: 'zh', tutorialDone: true, quality: 'high', coins: 99999, bestScore: 0,
  unlockedLevel: 4, selectedShip: 0, skins: {}, ownedSkins: [], nickname: '爸爸', levelStars: {}, levelMedals: {}, topScores: [] };
await page.addInitScript(({ k, s }) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch (e) {} }, { k: SAVE_KEY, s: SAVE });
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__SKY__ && window.__SKY__.scene.getScene('MenuScene') && window.__SKY__.scene.getScene('MenuScene').scene.isActive(), null, { timeout: 20000 });
await page.waitForTimeout(900);

// ── U2：真实点击「机库」→ 布局净空断言 ─────────────────────────
await page.mouse.click(270, 548);
await page.waitForTimeout(1200);
const u2 = await page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  if (!hs || !hs.rows || !hs.rows.length) return { error: 'no hangar rows' };
  // 开局武器芯片：宽 460 × 高 44 的矩形
  let chip = null;
  for (const o of hs.children.list) {
    if (o && o.type === 'Rectangle' && Math.round(o.width) === 460 && Math.round(o.height) === 44) {
      const b = o.getBounds(); chip = { top: b.y, bottom: b.y + b.height };
    }
  }
  // 底部返回菜单按钮：名为 neon-button 且 y>820 的容器
  let back = null;
  for (const o of hs.children.list) {
    if (o && o.type === 'Container' && o.name === 'neon-button' && o.y > 820) {
      const b = o.getBounds(); back = { top: b.y, bottom: b.y + b.height };
    }
  }
  const r0 = hs.rows[0].card.getBounds();
  const rl = hs.rows[hs.rows.length - 1].card.getBounds();
  return {
    chip, back,
    row0Top: r0.y, row0Bottom: r0.y + r0.height,
    lastBottom: rl.y + rl.height,
    rowCount: hs.rows.length,
  };
});
if (u2.error) { push('U2 机库布局可读', false, u2.error); }
else {
  push('U2a 开局武器芯片与首行卡片无重叠（芯片底 ≤ 首行卡顶）',
    u2.chip && u2.chip.bottom <= u2.row0Top,
    `芯片底=${u2.chip ? u2.chip.bottom.toFixed(1) : 'n/a'} 首行卡顶=${u2.row0Top.toFixed(1)} 净空=${u2.chip ? (u2.row0Top - u2.chip.bottom).toFixed(1) : 'n/a'}px`);
  push('U2b 末行卡片与返回按钮无重叠（末行底 < 按钮顶）',
    u2.back && u2.lastBottom < u2.back.top,
    `末行底=${u2.lastBottom.toFixed(1)} 按钮顶=${u2.back ? u2.back.top.toFixed(1) : 'n/a'} 净空=${u2.back ? (u2.back.top - u2.lastBottom).toFixed(1) : 'n/a'}px`);
  push('U2. 机库 6 行部件完整', u2.rowCount === 6, `rows=${u2.rowCount}`);
}
await page.screenshot({ path: 'shots/opt17_walk/opt18_p1_hangar.png' });

// ── 回菜单 → 真实点击进 L4 ────────────────────────────────────
await page.mouse.click(270, 890);            // 返回菜单
await page.waitForFunction(() => window.__SKY__.scene.getScene('MenuScene') && window.__SKY__.scene.getScene('MenuScene').scene.isActive(), null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.mouse.click(150, 478);            // 进 L4
await page.waitForFunction(() => { const g = window.__SKY__.scene.getScene('GameScene'); return g && g.scene.isActive(); }, null, { timeout: 20000 });
await page.waitForTimeout(1200);

// ── F3：受击定格 + 机体白闪 ───────────────────────────────────
const f3 = await page.evaluate(async () => {
  const g = window.__SKY__.scene.getScene('GameScene');
  const p = g.player;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 归零定格/恢复物理，准备干净态
  g._hitStopMs = 0; g._hitStopGapUntil = 0;
  if (g.physics.world.isPaused) g.physics.world.resume();
  await sleep(30);
  p.hp = p.maxHp; p.shield = 0; p.invulnUntil = 0;
  p.tintFill = false; p.clearTint();
  const pausedBefore = g.physics.world.isPaused;
  p.takeDamage(1);
  // 即刻采样（同一 tick，delayedCall 尚未触发）
  const immediate = {
    hitStopMs: g._hitStopMs || 0,
    paused: g.physics.world.isPaused,
    tintFill: p.tintFill === true,
    tintTopLeft: p.tintTopLeft,
  };
  await sleep(95);   // 越过 F2 红闪（~90ms），此时白闪应仍在（150ms）
  const during = { tintFill: p.tintFill === true, tintTopLeft: p.tintTopLeft };
  await sleep(120);  // 累计 ~215ms，越过白闪 150ms
  const after = { tintFill: p.tintFill === true, tintTopLeft: p.tintTopLeft };
  // 无敌期内二次受击应被拦（不重复触发定格）
  g._hitStopMs = 0; if (g.physics.world.isPaused) g.physics.world.resume();
  const hpBefore = p.hp;
  p.takeDamage(1);
  const invulnBlocked = p.hp === hpBefore && (g._hitStopMs || 0) === 0;
  // 清理
  g._hitStopMs = 0; if (g.physics.world.isPaused) g.physics.world.resume();
  return { pausedBefore, immediate, during, after, invulnBlocked, hp: p.hp };
});
push('F3a 受击触发轻定格（_hitStopMs>0 且物理世界暂停）',
  f3.pausedBefore === false && f3.immediate.hitStopMs > 0 && f3.immediate.paused === true,
  `hitStopMs=${Math.round(f3.immediate.hitStopMs)} paused ${f3.pausedBefore}→${f3.immediate.paused}`);
push('F3b 受击瞬间机体白闪（tintFill=true 且 tint=0xffffff）',
  f3.immediate.tintFill === true && f3.immediate.tintTopLeft === 0xffffff,
  `tintFill=${f3.immediate.tintFill} tint=0x${(f3.immediate.tintTopLeft >>> 0).toString(16)}`);
push('F3c 红闪退去时（~95ms）白闪仍在（时长 > 红闪，不被掩盖）',
  f3.during.tintFill === true,
  `tintFill=${f3.during.tintFill} tint=0x${(f3.during.tintTopLeft >>> 0).toString(16)}`);
push('F3d 白闪最终恢复（~215ms，tintFill=false，零残留）',
  f3.after.tintFill === false,
  `tintFill=${f3.after.tintFill} tint=0x${(f3.after.tintTopLeft >>> 0).toString(16)}`);
push('F3e 无敌期内重复受击被拦（hp 不变 / 不重复定格，零回归）',
  f3.invulnBlocked === true, `hp=${f3.hp} blocked=${f3.invulnBlocked}`);

await page.screenshot({ path: 'shots/opt17_walk/opt18_p1_battle.png' });

push('P1. 全程无 pageerror/console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ OPT-18 P1 批：${checks.length - fails.length}/${checks.length} ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
