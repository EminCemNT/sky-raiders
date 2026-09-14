// qa_opt18_p0_feel.mjs —— OPT-18 P0 快赢批防回归探针
// ---------------------------------------------------------------------------
// 覆盖 5 项改动：
//   V1 环境流光带退背景（Starfield.js）：长条 particle_streak 的 alpha ≤0.075、scaleX ≤2.5
//   V2 敌弹冷色描边（TextureFactory.js）：bullet_enemy 尺寸仍 18×18 + 描边环采样到亮青
//   F1 普攻枪口火光（VFX.muzzleFlash + Player._emitBullet）：射击期间出现 particleSpark / 节流时间戳被赋值
//   F2 受击边缘红晕（VFX.playerHitFlash）：受击后新增 Graphics 红晕层（替代全屏 flash）
//   F5 定格分级（GameScene.requestHitStop）：45ms 事件 25ms 冷却（45ms 后可再触发）；
//      普攻 33ms 保持 70ms 冷却（45ms 内被拦，零回归）
//   全程零 pageerror
// 运行：node qa_probes/qa_opt18_p0_feel.mjs（QA_URL 默认 5059）
// 注意：走真实路径（点击开始游戏），避免 game.scene.start 直切造成的场景残留假象。
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

// 真实路径进 L4
await page.mouse.click(150, 478);
await page.waitForFunction(() => { const g = window.__SKY__.scene.getScene('GameScene'); return g && g.scene.isActive(); }, null, { timeout: 20000 });
await page.waitForTimeout(1500);

// ── V1 流光带退背景 ─────────────────────────────────────────────
const v1 = await page.evaluate(() => {
  const g = window.__SKY__.scene.getScene('GameScene');
  const streams = g.children.list
    .filter((o) => o && o.texture && o.texture.key === 'particle_streak' && o.scaleY > 50 && o.alpha > 0)
    .map((o) => ({ alpha: +o.alpha.toFixed(3), sx: +o.scaleX.toFixed(2) }));
  return { count: streams.length, streams };
});
const v1ok = v1.count > 0 && v1.streams.every((s) => s.alpha <= 0.075 && s.sx <= 2.5);
push('V1 流光带已退背景（alpha≤0.075 / scaleX≤2.5）', v1ok,
  `n=${v1.count} ` + v1.streams.map((s) => `a${s.alpha}/x${s.sx}`).join(' '));

// ── V2 敌弹描边（描边环位于距中心 8px，实测 (9,1)/(16,9) 为亮青）────
const v2 = await page.evaluate(() => {
  const g = window.__SKY__.scene.getScene('GameScene');
  const exists = g.textures.exists('bullet_enemy');
  const tex = exists ? g.textures.get('bullet_enemy') : null;
  const src = tex && tex.getSourceImage ? tex.getSourceImage() : null;
  const size = src ? { w: src.width, h: src.height } : null;
  let top = null, left = null, core = null;
  try {
    top = g.textures.getPixel(9, 1, 'bullet_enemy');    // 描边环（上）
    left = g.textures.getPixel(1, 9, 'bullet_enemy');   // 描边环（左）
    core = g.textures.getPixel(9, 9, 'bullet_enemy');   // 弹体核心
  } catch (e) { /* getPixel 不可用 */ }
  return { exists, size, top, left, core };
});
const isCyan = (p) => !!(p && p.b > 200 && p.g > 200 && p.r < 180);
push('V2 敌弹纹理尺寸 18×18（判定/尺寸零影响）', v2.exists && v2.size && v2.size.w === 18 && v2.size.h === 18,
  `size=${v2.size ? v2.size.w + 'x' + v2.size.h : 'n/a'}`);
push('V2 描边环为亮青（上/左两点采样）', isCyan(v2.top) && isCyan(v2.left),
  `top=${v2.top ? `${v2.top.r},${v2.top.g},${v2.top.b}` : 'n/a'} left=${v2.left ? `${v2.left.r},${v2.left.g},${v2.left.b}` : 'n/a'} core=${v2.core ? `${v2.core.r},${v2.core.g},${v2.core.b}` : 'n/a'}`);

// ── F2 受击边缘红晕 ───────────────────────────────────────────
const f2 = await page.evaluate(() => {
  const g = window.__SKY__.scene.getScene('GameScene');
  const before = g.children.list.filter((o) => o && o.type === 'Graphics').length;
  g.player.shield = 0; g.player.invulnUntil = 0; g.player.takeDamage(1);
  const after = g.children.list.filter((o) => o && o.type === 'Graphics').length;
  return { before, after };
});
push('F2 受击新增边缘红晕 Graphics 层', f2.after > f2.before, `Graphics ${f2.before}→${f2.after}`);
await page.screenshot({ path: 'shots/opt17_walk/opt18_f2_hit_vignette.png' });
await page.waitForTimeout(500);

// ── F1 枪口火光（按住射击期间循环采样）────────────────────────
await page.mouse.move(270, 800);
await page.mouse.down();
let sparkSeen = 0;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(90);
  const n = await page.evaluate(() => {
    const g = window.__SKY__.scene.getScene('GameScene');
    return g.children.list.filter((o) => o && o.type === 'ParticleEmitter' && o.texture && o.texture.key === 'particleSpark').length;
  });
  if (n > sparkSeen) sparkSeen = n;
}
await page.mouse.up();
const muzzle = await page.evaluate(() => {
  const g = window.__SKY__.scene.getScene('GameScene');
  return { lastMuzzle: g.player._lastMuzzle || 0, bullets: g.playerBullets ? g.playerBullets.countActive(true) : -1 };
});
push('F1 射击后出现枪口火花 / 节流时间戳被赋值', sparkSeen > 0 || muzzle.lastMuzzle > 0,
  `spark emitters=${sparkSeen} lastMuzzle=${muzzle.lastMuzzle} bullets=${muzzle.bullets}`);

// ── F5 定格分级 ───────────────────────────────────────────────
const f5 = await page.evaluate(async () => {
  const g = window.__SKY__.scene.getScene('GameScene');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const resume = () => { if (g.physics.world.isPaused) g.physics.world.resume(); };
  // 击杀级（45ms）：45ms 后应可再次触发（冷却仅 25ms）
  g._hitStopGapUntil = 0; g._hitStopMs = 0; resume();
  g.requestHitStop(45);
  const g1 = g._hitStopGapUntil;
  await sleep(45);
  g.requestHitStop(45);
  const g2 = g._hitStopGapUntil;
  // 普攻（33ms）：45ms 内仍应被 70ms 冷却拦（零回归）
  g._hitStopGapUntil = 0; g._hitStopMs = 0; resume();
  g.requestHitStop(33);
  const n1 = g._hitStopGapUntil;
  await sleep(45);
  g.requestHitStop(33);
  const n2 = g._hitStopGapUntil;
  resume();
  return { g1, g2, n1, n2 };
});
push('F5 击杀级(45ms) 45ms 后可再次触发（25ms 冷却）', f5.g2 > f5.g1, `gap ${Math.round(f5.g1)}→${Math.round(f5.g2)}`);
push('F5 普攻(33ms) 45ms 内仍被 70ms 冷却拦（零回归）', f5.n2 === f5.n1, `gap ${Math.round(f5.n1)}→${Math.round(f5.n2)}`);

push('P0. 全程无 pageerror/console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'shots/opt17_walk/opt18_p0_battle.png' });
const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ OPT-18 P0 快赢批：${checks.length - fails.length}/${checks.length} ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
