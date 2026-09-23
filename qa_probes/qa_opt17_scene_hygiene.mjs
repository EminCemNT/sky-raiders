// qa_opt17_scene_hygiene.mjs —— OPT-17 P1 场景切换卫生探针（防回归）
// ---------------------------------------------------------------------------
// 背景：walk 截图疑似主菜单 tips 残留战斗场景（P1 候选）。程序化诊断证伪：
// 真实玩家路径（MenuScene.startGame → transition.goto → GameScene）下
// MenuScene 正常 shutdown、tip 文案零持有者、战斗顶部无幽灵文本。
// 本探针把该诊断固化为回归断言：一旦未来场景切换链回归（如 MenuScene 漏 stop、
// tips 残留在战斗中渲染、战斗顶部出现来源不明的覆盖文本），立即红灯。
// 运行：node qa_probes/qa_opt17_scene_hygiene.mjs（QA_URL 默认 5059）
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
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
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };
const SAVE = {
  version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 99999, bestScore: 420000, unlockedLevel: 4,
  selectedShip: 0, skins: {}, ownedSkins: [],
  nickname: '爸爸', haptics: true, muted: false,
  dailyChallenge: { date: '', bestScore: 0, cleared: false, claimed: false },
};

const ctx = await browser.newContext({ viewport });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.addInitScript(({ key, save }) => {
  try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) {}
}, { key: SAVE_KEY, save: SAVE });
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, null, { timeout: 20000 });
await page.waitForTimeout(900);

// 真实玩家路径：MenuScene.startGame（与点「开始游戏」等价，走 transition.goto）
await page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').startGame());
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, null, { timeout: 20000 });
await page.waitForTimeout(1500);

const diag = await page.evaluate(async () => {
  const g = window.__SKY__;
  const out = { scenes: {} };
  ['BootScene', 'PreloadScene', 'MenuScene', 'GameScene', 'UIScene', 'ResultScene', 'TransitionScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (!sc) { out.scenes[k] = 'MISSING'; return; }
    out.scenes[k] = {
      active: sc.scene.isActive(),
      visible: sc.scene.isVisible(),
      children: sc.children ? sc.children.list.length : -1,
    };
  });
  // 全场景扫描 tips 文案持有者（MenuScene.tipText 若残留战斗必被此捕获）
  const TARGET = '连续击杀维持连击';
  out.tipHolders = [];
  g.scene.scenes.forEach((sc) => {
    if (!sc || !sc.children) return;
    sc.children.list.forEach((obj) => {
      if (obj && typeof obj.text === 'string' && obj.text.includes(TARGET)) {
        out.tipHolders.push({ scene: sc.scene.key, y: obj.y, text: obj.text.slice(0, 30) });
      }
    });
  });
  // 递归收集 Container 内文本
  function collectTexts(sceneObj, container) {
    const list = (container || sceneObj.children).list || [];
    const found = [];
    list.forEach((obj) => {
      if (!obj) return;
      if (obj.list && obj.list.length) { found.push(...collectTexts(sceneObj, obj)); return; }
      if (typeof obj.text === 'string' && obj.visible !== false && obj.active !== false) {
        found.push({ x: Math.round(obj.x), y: Math.round(obj.y), text: obj.text.slice(0, 34) });
      }
    });
    return found;
  }
  out.topTexts = {};
  ['UIScene', 'MenuScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (!sc) return;
    out.topTexts[k] = collectTexts(sc, null).filter((t) => t.y >= 0 && t.y < 150 && t.text.trim().length);
  });
  // GameScene 顶部 y<150：先「静默战斗」再采样，只把真残留计入。
  // 背景：战斗飘字（伤害数字 "10"、传导 banner 等）是瞬态反馈，单次采样会把它们误判为幽灵文本（实测踩到）。
  //   仅靠「多次采样取交集」也不行 —— 敌机在固定编队位被击落时，同一 (x,y) 会反复冒出 "10"，照样骗过持续判据。
  // 做法：暂停物理 + 清空场上实体（不再产生新命中）→ 等既有飘字自然过期销毁 → 再一次性采样。
  //   注意：tween 走游戏 delta，headless 软件渲染下约 110ms/真实秒，560ms 上飘 tween 需 ~5s 才销毁，故等待放宽到 9s。
  {
    const gs = g.scene.getScene('GameScene');
    if (gs) {
      if (gs.physics && gs.physics.world) gs.physics.world.pause();
      const clear = (grp, fn) => { if (grp && grp.children) grp.children.each((o) => { if (o.active) fn(o); }); };
      clear(gs.enemies, (e) => e.recycle());
      clear(gs.enemyBullets, (b) => gs.killBullet(b));
      clear(gs.playerBullets, (b) => gs.killBullet(b));
      await new Promise((r) => setTimeout(r, 9000));
    }
    out.topTexts.GameScene = gs
      ? collectTexts(gs, null).filter((t) => t.y >= 0 && t.y < 150 && t.text.trim().length)
      : [];
  }
  return out;
});

push('MenuScene 已 shutdown（active=false / children=0）', diag.scenes.MenuScene && !diag.scenes.MenuScene.active && diag.scenes.MenuScene.children === 0,
  JSON.stringify(diag.scenes.MenuScene));
push('GameScene 激活（active / children>0）', diag.scenes.GameScene && diag.scenes.GameScene.active && diag.scenes.GameScene.children > 0,
  `children=${diag.scenes.GameScene.children}`);
push('tips 文案零残留（全场景扫描无持有者）', diag.tipHolders.length === 0, diag.tipHolders.length ? JSON.stringify(diag.tipHolders[0]) : '');
push('GameScene 顶部 y<150 无持久残留文本（瞬态战斗飘字已排除）', diag.topTexts.GameScene.length === 0, `n=${diag.topTexts.GameScene.length}`);
// UIScene 顶部允许正常 HUD（SCORE/关卡/命/火力/元素），但不允许出现 tips 类/tip_ 文案
const uiTopText = diag.topTexts.UIScene.map((t) => t.text).join(' ');
push('UIScene 顶部仅 HUD（无 tips 文案混入）', !/连击越高|连续击杀|磁吸|爬塔每层/.test(uiTopText), uiTopText.slice(0, 80));
push('P0. 无 pageerror/console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ 场景卫生汇总：${checks.length - fails.length}/${checks.length} 通过 ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
