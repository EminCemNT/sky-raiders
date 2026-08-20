// qa_ui_p1.mjs —— UI P1 四项纯视觉优化真测
// 断言：Result/Hangar 按钮已改 NeonButton、emoji 已替换为矢量纹理、Boss 三阶段外观差异存在、
//       HUD 顶部四元素（SCORE/关卡名/Boss名/连击）错层不重叠、零 pageerror。
// 依赖：外部已起 5059 vite 服（node node_modules/vite/bin/vite.js）。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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

  // 递归扫描器：Text 中的目标 emoji / 指定纹理 Image
  const EMOJI = ['🛡', '🧲', '🏅', '🔒', '⚠', '✅'];
  const scanEmoji = (scene) => {
    const found = [];
    const walk = (arr) => {
      for (const o of arr) {
        if (o.type === 'Text' && EMOJI.some((e) => (o.text || '').includes(e))) found.push(o.text);
        if (o.list) walk(o.list);
      }
    };
    if (scene && scene.children && scene.children.list) walk(scene.children.list);
    return found;
  };
  const hasImage = (scene, key) => {
    let found = false;
    const walk = (arr) => {
      for (const o of arr) {
        if (o.type === 'Image' && o.texture && o.texture.key === key) found = true;
        if (o.list) walk(o.list);
      }
    };
    if (scene && scene.children && scene.children.list) walk(scene.children.list);
    return found;
  };

  // 1) 矢量图标纹理已生成
  out.texMedal = g.textures.exists('icon_medal');
  out.texLock = g.textures.exists('icon_lock');

  // 2) MenuScene emoji 替换（基础 + 关卡选择 + 成就墙面板）
  const ms = g.scene.getScene('MenuScene');
  out.menuEmojiBase = scanEmoji(ms);
  ms.openLevelSelect();
  out.menuEmojiLevel = scanEmoji(ms);
  out.levelLockImg = hasImage(ms, 'icon_lock');
  ms.closeLevelSelect();
  ms.openAchievements();
  out.menuEmojiAch = scanEmoji(ms);
  out.achMedalOrLockImg = hasImage(ms, 'icon_medal') || hasImage(ms, 'icon_lock');
  ms.closeAchievements();

  // 3) ResultScene：按钮已改 NeonButton + 成就图标矢量化
  g.scene.start('ResultScene', {
    victory: true, stars: 3, score: 1234, kills: 10, coins: 5, levelId: 1,
    newAchievements: [{ icon: '🎓', name: '新手上路' }],
  });
  await waitFor(() => { const s = g.scene.getScene('ResultScene'); return s && s.scene.isActive(); });
  const rs = g.scene.getScene('ResultScene');
  const rsContainers = rs.children.list.filter((c) => c.type === 'Container');
  out.rsNeonBtnCount = rsContainers.filter((c) => c.name === 'neon-button').length;
  out.rsRectBtnCount = rsContainers.filter((c) => c.list && c.list.some((ch) => ch.type === 'Rectangle')).length;
  out.rsMedalImg = hasImage(rs, 'icon_medal');
  out.resultEmoji = scanEmoji(rs);

  // 4) HangarScene：6 个升级按钮 + 返回菜单按钮已改 NeonButton
  g.scene.start('HangarScene');
  await waitFor(() => { const s = g.scene.getScene('HangarScene'); return s && s.scene.isActive() && s.rows && s.rows.length > 0; });
  const hs = g.scene.getScene('HangarScene');
  out.hangarRowCount = hs.rows.length;
  out.hangarRowsNeon = hs.rows.every((row) => row.btn && row.btn.container && row.btn.container.name === 'neon-button');
  out.hangarBackNeon = hs.children.list.some((c) => c.type === 'Container' && c.name === 'neon-button'
    && c.list && c.list.some((ch) => ch.type === 'Text' && ch.text === '返回菜单'));

  // 5) Boss 三阶段外观差异（bossrush 实机）
  if (window.__SAVE && window.__SAVE.set) window.__SAVE.set('tutorialDone', true);
  g.scene.stop('UIScene');
  g.scene.stop('GameScene');
  g.scene.start('GameScene', { mode: 'bossrush', levelId: 1 });
  await waitFor(() => {
    const gs = g.scene.getScene('GameScene');
    return gs && gs.boss && gs.boss.active && !gs.boss._entering;
  });
  const boss = g.scene.getScene('GameScene').boss;
  out.bossHasFx = !!(boss && boss.fxG && boss.fxG.type === 'Graphics');
  const tints = {}, cracks = {};
  for (const ph of [1, 2, 3]) {
    boss.phase = ph;
    boss._syncPhaseVisuals();
    tints['p' + ph] = boss._getPhaseTint();
    cracks['p' + ph] = boss._crackPaths.length;
  }
  out.bossTintP1 = tints.p1; out.bossTintP2 = tints.p2; out.bossTintP3 = tints.p3;
  out.bossTintsDiffer = (tints.p1 !== tints.p2) && (tints.p2 !== tints.p3) && (tints.p1 !== tints.p3);
  out.bossCracksP1 = cracks.p1; out.bossCracksP2 = cracks.p2; out.bossCracksP3 = cracks.p3;
  out.bossCracksDiffer = (cracks.p1 === 0) && (cracks.p2 > 0) && (cracks.p3 > cracks.p2);

  // 6) HUD 顶部四元素错层不重叠（SCORE/关卡名/Boss名/连击）+ 暂停键避让
  const ui = g.scene.getScene('UIScene');
  await waitFor(() => ui && ui.scene.isActive());
  const box = (o) => { const b = o.getBounds(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (ui.bossNameText) ui.bossNameText.setText('湮灭者 Annihilator').setVisible(true);
  if (ui.comboText) ui.comboText.setText('连击 ×99\n×1.4').setVisible(true);
  const sb = box(ui.scoreText);
  const lb = box(ui.levelLabel);
  const bb = box(ui.bossNameText);
  const cb = box(ui.comboText);
  const pb = box(ui.pauseBtn);
  const pairs = [
    ['SCORE-关卡名', sb, lb],
    ['SCORE-Boss名', sb, bb],
    ['关卡名-Boss名', lb, bb],
    ['Boss名-连击', bb, cb],
    ['关卡名-暂停键', lb, pb],
  ];
  out.hudOverlaps = pairs.filter(([, a, b]) => overlap(a, b)).map(([n]) => n);
  out.hudNoOverlap = out.hudOverlaps.length === 0;

  // 7) UIScene 增益徽标矢量化 + emoji 清零
  out.shieldTex = !!(ui.shieldIcon && ui.shieldIcon.texture && ui.shieldIcon.texture.key === 'item_shield');
  out.magnetTex = !!(ui.magnetIcon && ui.magnetIcon.texture && ui.magnetIcon.texture.key === 'item_magnet');
  out.uiEmoji = scanEmoji(ui);

  return out;
});

await browser.close();

// —— 断言 ——
const checks = [
  ['icon_medal 纹理生成', r.texMedal],
  ['icon_lock 纹理生成', r.texLock],
  ['MenuScene 基础无 emoji', (r.menuEmojiBase || []).length === 0],
  ['关卡选择面板无 emoji', (r.menuEmojiLevel || []).length === 0],
  ['成就墙面板无 emoji', (r.menuEmojiAch || []).length === 0],
  ['成就墙存在勋章/锁矢量图标', r.achMedalOrLockImg],
  ['Result 按钮已改 NeonButton(≥2)', r.rsNeonBtnCount >= 2],
  ['Result 无手搓 Rectangle 按钮', r.rsRectBtnCount === 0],
  ['Result 勋章图标矢量化', r.rsMedalImg],
  ['Result 无 emoji', (r.resultEmoji || []).length === 0],
  ['Hangar 升级按钮全 NeonButton', r.hangarRowsNeon && r.hangarRowCount >= 6],
  ['Hangar 返回菜单 NeonButton', r.hangarBackNeon],
  ['Boss 视觉叠加层(fxG)存在', r.bossHasFx],
  ['Boss 三阶段 tint 差异', r.bossTintsDiffer],
  ['Boss 三阶段裂纹差异(0<5<10)', r.bossCracksDiffer],
  ['HUD 四元素+暂停键错层不重叠', r.hudNoOverlap],
  ['护盾徽标用 item_shield 纹理', r.shieldTex],
  ['磁力徽标用 item_magnet 纹理', r.magnetTex],
  ['UIScene 无 emoji', (r.uiEmoji || []).length === 0],
  ['零 pageerror', errors.length === 0],
];

let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (r.hudOverlaps && r.hudOverlaps.length) console.log('HUD 重叠项: ' + r.hudOverlaps.join(', '));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'QA_UI_P1: PASS' : 'QA_UI_P1: FAIL');
process.exit(pass ? 0 : 1);
