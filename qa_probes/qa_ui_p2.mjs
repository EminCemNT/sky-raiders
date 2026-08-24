// qa_ui_p2.mjs —— UI P2 四项纯视觉优化真测
// 断言：
//   1) 结算页信息层存在：NeonBar 完成度条 / 最高分 / 连击峰值面板
//   2) THEME 常量已收敛（fontFamily/语义色集中，场景内魔法数字串明显减少）
//   3) 粒子多纹理已生成（softDot/streak/sparkStar ≥2 种）且 VFX 按用途分派
//   4) 菜单/机库背景主题化（nebula 脉动+近景剪影、机库星空随战机 tint 跟随）
//   5) 零 pageerror
// 依赖：外部已起 5059 vite 服（node node_modules/vite/bin/vite.js）。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const g = window.__SKY__;
  return g && g.scene.getScene('MenuScene') && g.scene.getScene('MenuScene').scene.isActive();
}, { timeout: 20000 });

const r = await page.evaluate(async () => {
  const g = window.__SKY__;
  const out = {};
  const waitFor = (fn, ms = 20000) => new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => { if (fn() || performance.now() - t0 > ms) { clearInterval(iv); res(); } }, 50);
  });
  const textsOf = (scene) => {
    const arr = [];
    const walk = (list) => list.forEach((c) => {
      if (c && c.type === 'Text') arr.push(c.text);
      if (c && c.list && c.list.length) walk(c.list);
    });
    walk(scene.children.list);
    return arr;
  };
  const hasImg = (scene, key) => {
    let found = false;
    const walk = (list) => list.forEach((c) => {
      if (c && c.type === 'Image' && c.texture && c.texture.key === key) found = true;
      if (c && c.list && c.list.length) walk(c.list);
    });
    walk(scene.children.list);
    return found;
  };
  const firstImg = (scene, key) => {
    let s = null;
    const walk = (list) => list.forEach((c) => {
      if (!s && c && c.type === 'Image' && c.texture && c.texture.key === key) s = c;
      if (c && c.list && c.list.length) walk(c.list);
    });
    walk(scene.children.list);
    return s;
  };

  // ── 1) THEME 收敛（运行期）──
  const m = await import('/src/utils/UIWidgets.js');
  out.themeFont = !!(m.THEME && m.THEME.fontFamily === 'sans-serif');
  out.themeKeys = m.THEME ? Object.keys(m.THEME).length : 0;

  // ── 2) 粒子多纹理 ──
  out.texDot = g.textures.exists('particle_dot');
  out.texStreak = g.textures.exists('particle_streak');
  out.texSpark = g.textures.exists('particle_spark');
  out.multiTexCount = [out.texDot, out.texStreak, out.texSpark].filter(Boolean).length;

  // ── 3) 菜单背景主题化：nebula + 近景剪影 ──
  const ms = g.scene.getScene('MenuScene');
  out.menuNebula = hasImg(ms, 'bg_nebula');
  out.menuSil = hasImg(ms, 'bg_building') || hasImg(ms, 'bg_asteroid');

  // ── 4) 结算页信息层 ──
  g.scene.stop('UIScene'); g.scene.stop('GameScene');
  g.scene.start('ResultScene', {
    victory: true, stars: 3, score: 1234, kills: 20, coins: 60,
    levelId: 1, composite: 0.87, maxCombo: 23, bestScore: 5000,
  });
  await waitFor(() => { const s = g.scene.getScene('ResultScene'); return s && s.scene.isActive(); });
  const rs = g.scene.getScene('ResultScene');
  const rsTexts = textsOf(rs);
  out.rsBar = !!(rs.completionBar && typeof rs.completionBar.setRatio === 'function');
  out.rsRatio = rs.completionRatio;
  out.rsHasCompletion = rsTexts.some((t) => t.includes('完成度'));
  out.rsHasComboPeak = rsTexts.some((t) => t.includes('连击峰值'));
  out.rsComboVal = rsTexts.some((t) => /×23/.test(t));
  out.rsComboPeakText = !!(rs.comboPeakText);
  out.rsHasBest = rsTexts.some((t) => t.includes('最高分'));
  // 不遮挡：信息层/按钮不与标题/星级重叠（近似：完成度条在星级下方、连击面板在按钮上方）
  out.rsBarY = (rs.completionBar && rs.completionBar.y) ? Math.round(rs.completionBar.y) : 0;

  // ── 5) 机库背景主题化 + 星空 tint 跟随 ──
  if (!g.scene.getScene('HangarScene')) {
    const H = (await import('/src/scenes/HangarScene.js')).default;
    g.scene.add('HangarScene', H, false);
  }
  g.scene.start('HangarScene');
  await waitFor(() => { const s = g.scene.getScene('HangarScene'); return s && s.scene.isActive() && s.shipPreview && s.shipArrowR; });
  const hs = g.scene.getScene('HangarScene');
  out.hangarNebula = hasImg(hs, 'bg_nebula');
  out.hangarSil = hasImg(hs, 'bg_building') || hasImg(hs, 'bg_asteroid');
  out.hangarSetTint = !!(hs.starfield && typeof hs.starfield.setTint === 'function');
  const s0 = firstImg(hs, 'star');
  out.hangarStarBase = s0 ? s0.tintTopLeft : 0;
  // 切换战机（右箭头 → selectedShip=1 赤焰 tint 0xff7a3a），星空 tint 应跟随变化
  hs.shipArrowR.emit('pointerdown');
  await waitFor(() => hs.shipLabel && /赤焰/.test(hs.shipLabel.text), 3000);
  const s1 = firstImg(hs, 'star');
  out.hangarStarAfter = s1 ? s1.tintTopLeft : 0;
  out.hangarTintFollows = out.hangarStarBase !== out.hangarStarAfter && !!s1;

  return out;
});

await browser.close();

// ── 6) THEME 收敛（源码级：场景内魔法数字串明显减少 / THEME 引用新增）──
const THEME_FILES = [
  'src/utils/UIWidgets.js',
  'src/scenes/MenuScene.js',
  'src/scenes/UIScene.js',
  'src/scenes/HangarScene.js',
  'src/scenes/ResultScene.js',
];
const VFX_FILE = 'src/systems/VFX.js';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let literalFontCount = 0, themeFontRefs = 0, themeRefs = 0;
for (const f of THEME_FILES) {
  const src = read(f);
  // 允许保留 UIWidgets 内 THEME 定义处 1 次；场景内字面量应为 0
  literalFontCount += (src.match(/fontFamily:\s*'sans-serif'/g) || []).length;
  themeFontRefs += (src.match(/THEME\.fontFamily/g) || []).length;
  themeRefs += (src.match(/THEME\.\w+/g) || []).length;
}
const vfx = read(VFX_FILE);
const vfxDot = (vfx.match(/particle_dot/g) || []).length;
const vfxStreak = (vfx.match(/particle_streak/g) || []).length;
const vfxSpark = (vfx.match(/particle_spark/g) || []).length;

// ── 断言 ──
const checks = [
  ['THEME.fontFamily 已定义=sans-serif', !!r.themeFont],
  ['THEME 键数收敛(≥30)', r.themeKeys >= 30],
  ['场景字面量 fontFamily 明显减少(≤1)', literalFontCount <= 1],
  ['THEME.fontFamily 引用新增(≥50)', themeFontRefs >= 50],
  ['THEME 总引用新增(≥150)', themeRefs >= 150],
  ['粒子多纹理≥2 种', r.multiTexCount >= 2],
  ['particle_dot(圆点)已生成', r.texDot],
  ['particle_streak(长条)已生成', r.texStreak],
  ['particle_spark(星形)已生成', r.texSpark],
  ['VFX 爆炸用圆点(particle_dot)', vfxDot >= 2],
  ['VFX 拖尾用长条(particle_streak)', vfxStreak >= 2],
  ['VFX 火花用星形(particle_spark)', vfxSpark >= 1],
  ['菜单背景 nebula 脉动层存在', r.menuNebula],
  ['菜单背景近景剪影存在', r.menuSil],
  ['机库背景 nebula 存在', r.hangarNebula],
  ['机库星空 setTint 接口存在', r.hangarSetTint],
  ['机库星空 tint 随战机跟随', r.hangarTintFollows === true],
  ['结算页完成度条(NeonBar)存在', r.rsBar],
  ['结算页完成度比例=0.87', Math.abs((r.rsRatio || 0) - 0.87) < 0.001],
  ['结算页「完成度」文本', r.rsHasCompletion],
  ['结算页「连击峰值」面板', r.rsHasComboPeak],
  ['结算页连击峰值数值 ×23', r.rsComboVal],
  ['结算页连击峰值文本对象', r.rsComboPeakText],
  ['结算页「最高分」展示', r.rsHasBest],
  ['结算页完成度条不与标题重叠(y>400)', r.rsBarY > 400],
  ['零 pageerror', errors.length === 0],
];

let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
console.log('--- 源码计数 ---');
console.log(`literalFontCount=${literalFontCount} themeFontRefs=${themeFontRefs} themeRefs=${themeRefs}`);
console.log(`vfx: dot=${vfxDot} streak=${vfxStreak} spark=${vfxSpark} | hangarStar ${r.hangarStarBase} -> ${r.hangarStarAfter}`);
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'QA_UI_P2: PASS' : 'QA_UI_P2: FAIL');
process.exit(pass ? 0 : 1);
