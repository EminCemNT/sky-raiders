// qa_opt18_p3_depth.mjs —— OPT-18 P3 / V3 远景雾化层（景深分层）验收探针
// ---------------------------------------------------------------------------
// 背景：画面"糊"的成因之一是远景光效与前景弹幕亮度接近、层次不分。
// 方案：新增全屏静态渐变贴图 depth_fog（顶部深蓝黑 → 底部透明），
//       由 Starfield 以 depth −85 铺在「全部远景之上、游乐层之下」，
//       只压暗星云/云/星空/流光带/地平线/流星，完全不触碰敌机/玩家/弹幕 → 拉开景深。
// 关键不变量（本探针锁死）：
//   ① haze 之下已无更高层（即所有 depth < −85 的对象都 ≤ −88）→ 它确实盖住了全部远景；
//   ② haze 之上已无更低层（即所有 depth ≥ 0 的对象都 ≥ 4）→ 它没有侵入游乐层视角；
//   ③ 静态：无 tween、无滚动（_speed === 0）、NORMAL 混合；
//   ④ opt-in：只在传了 haze:true 的场景（GameScene）出现，菜单无。
//   ⑤ 像素实证：把 haze 下所有远景临时隐藏 + 关 bloom 后，
//      haze 开启 vs alpha=0 两态在同一像素取样 → 必变暗（证明它真的在压暗，而非空挂）。
// 运行：node qa_probes/qa_opt18_p3_depth.mjs（QA_URL 默认 5059）
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';
const HAZE_DEPTH = -85;

const checks = [];
const push = (name, ok, detail = '') => { checks.push({ name, ok }); console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : '')); };

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
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 30000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive() && ms.starfield;
}, null, { timeout: 30000 });
await page.waitForTimeout(900);

// ── 1. 贴图存在 + 菜单未启用（opt-in 证明）────────────────────────────
const menuProbe = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const dbg = ms.starfield && ms.starfield._dbg ? ms.starfield._dbg : {};
  const hazeObjs = ms.children.list.filter((o) => o && o.texture && o.texture.key === 'depth_fog');
  return {
    texExists: ms.textures.exists('depth_fog'),
    dbgHaze: dbg.haze,
    hazeObjCount: hazeObjs.length,
  };
});
push('1. depth_fog 纹理已生成（TextureFactory）', menuProbe.texExists === true, `exists=${menuProbe.texExists}`);
push('2. 菜单未启用雾化层（opts.haze 默认 false → opt-in 生效）',
  menuProbe.dbgHaze === false && menuProbe.hazeObjCount === 0,
  `_dbg.haze=${menuProbe.dbgHaze} 场景内对象数=${menuProbe.hazeObjCount}`);

// ── 2. 真实路径进战斗（click 开始游戏，走 transition.goto 正确停菜单）──
await page.mouse.click(150, 360);
await page.waitForFunction(() => {
  const g = window.__SKY__.scene.getScene('GameScene');
  return g && g.scene.isActive() && g.player && g.player.active && g.starfield;
}, null, { timeout: 25000 });
await page.waitForTimeout(1200);

// ── 3. 几何 / 静态性 / 分层不变量 ────────────────────────────────────
const g = await page.evaluate((HD) => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const dbg = gs.starfield && gs.starfield._dbg ? gs.starfield._dbg : {};
  const all = gs.children.list.filter(Boolean);
  const haze = all.find((o) => o.texture && o.texture.key === 'depth_fog') || null;
  const below = all.filter((o) => o !== haze && o.depth < HD);   // haze 之下的对象（远景）
  const above = all.filter((o) => o !== haze && o.depth >= 0);   // haze 之上的对象（游乐层+UI）
  const band = all.filter((o) => o !== haze && o.depth > HD && o.depth < 0); // haze 与游乐层之间的空档带
  const maxBelow = below.length ? Math.max(...below.map((o) => o.depth)) : null;
  const minAbove = above.length ? Math.min(...above.map((o) => o.depth)) : null;
  return {
    dbgHaze: dbg.haze,
    dbgAlpha: dbg.hazeAlpha,
    dbgDepth: dbg.hazeDepth,
    hasHaze: !!haze,
    depth: haze ? haze.depth : null,
    alpha: haze ? haze.alpha : null,
    blend: haze ? haze.blendMode : null,
    visible: haze ? haze.visible : null,
    speed: haze ? haze._speed : null,
    layer: haze ? haze._layer : null,
    w: haze ? haze.displayWidth : null,
    h: haze ? haze.displayHeight : null,
    x: haze ? haze.x : null,
    y: haze ? haze.y : null,
    ox: haze ? haze.originX : null,
    oy: haze ? haze.originY : null,
    tweens: haze ? gs.tweens.getTweensOf(haze).length : -1,
    belowCount: below.length,
    aboveCount: above.length,
    bandCount: band.length,
    bandDepths: band.slice(0, 5).map((o) => o.depth),
    maxBelow,
    minAbove,
    tier: dbg.tier,
    quality: (window.__SAVE && window.__SAVE.quality) || null,
  };
}, HAZE_DEPTH);

push('3. 战斗场景存在雾化层对象', g.hasHaze === true && g.dbgHaze === true,
  `对象=${g.hasHaze} _dbg.haze=${g.dbgHaze}`);
push('4. 雾化层 depth = −85（远景 −88 之上的空档位）', g.depth === HAZE_DEPTH, `depth=${g.depth}`);
push('5. 分层不变量①：haze 与游乐层之间是真空档（depth∈(−85,0) 无任何对象）',
  g.bandCount === 0 && g.minAbove !== null && g.minAbove >= 0,
  `空档带对象数=${g.bandCount}${g.bandCount ? ' depths=' + JSON.stringify(g.bandDepths) : ''} · haze 之上最低 depth=${g.minAbove}`);
push('6. 分层不变量②：haze 之下全部是远景层（所有 depth<−85 的对象 ≤ −88）',
  g.maxBelow !== null && g.maxBelow <= -88,
  `haze 之下最高 depth=${g.maxBelow}（上界 −88 = 流星层；流星为瞬态，未生成时观测到 −90 属正常）`);
push('7. 雾化层确实夹在中间（下方有远景、上方有游乐层）',
  g.belowCount > 0 && g.aboveCount > 0,
  `下方 ${g.belowCount} 个 / 上方 ${g.aboveCount} 个`);
push('8. 强度 alpha = TIER.hazeAlpha 且落在设计区间 [0.20, 0.26]',
  g.alpha === g.dbgAlpha && g.alpha >= 0.20 && g.alpha <= 0.26,
  `alpha=${g.alpha} _dbg=${g.dbgAlpha} tier=${g.tier}/${g.quality}`);
push('9. 静态：无 tween 驱动（渐变图层不应有动画）', g.tweens === 0, `tweens=${g.tweens}`);
push('10. 不参与滚动（_speed === 0，防 NaN 坐标 / 出屏重置）',
  g.speed === 0 && g.layer === 'haze', `_speed=${g.speed} _layer=${g.layer}`);
push('11. 全屏覆盖且居中（540×960 @ 270,480，origin 0.5）',
  g.w === 540 && g.h === 960 && g.x === 270 && g.y === 480 && g.ox === 0.5 && g.oy === 0.5,
  `${g.w}×${g.h} @ (${g.x},${g.y}) origin=(${g.ox},${g.oy})`);
push('12. NORMAL 混合且可见（非 ADD —— 压暗而非加亮）',
  g.blend === 0 && g.visible === true, `blend=${g.blend} visible=${g.visible}`);

// ── 4a. 贴图梯度确定性校验（直接读 canvas 像素，不依赖渲染帧与时序）──
// 断言「归一化渐变」本身：顶部 alpha≈1.0 → 底部 0，且色为深蓝黑（蓝分量最高）。
const tex = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const t = gs.textures.get('depth_fog');
  const src = t ? t.getSourceImage() : null;
  if (!src || !src.getContext) return { err: 'no canvas source' };
  const c2 = src.getContext('2d');
  const at = (x, y) => { const d = c2.getImageData(x, y, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] }; };
  const cx = Math.floor(src.width / 2);
  return {
    w: src.width, h: src.height,
    top: at(cx, 4),
    mid: at(cx, Math.floor(src.height * 0.5)),
    bot: at(cx, src.height - 5),
  };
});
if (tex.err) {
  push('13. depth_fog 贴图梯度正确（顶部 α≈1 → 中部递减 → 底部 0）', false, tex.err);
} else {
  const mono = tex.top.a > tex.mid.a && tex.mid.a > tex.bot.a;
  push('13. depth_fog 贴图梯度正确（顶部 α≈1 → 中部递减 → 底部 0）',
    tex.w === 540 && tex.h === 960 && tex.top.a >= 250 && tex.mid.a >= 50 && tex.mid.a <= 140 && tex.bot.a <= 3 && mono,
    `${tex.w}×${tex.h} α: top=${tex.top.a} mid=${tex.mid.a} bot=${tex.bot.a} 单调=${mono}`);
  push('14. 雾色为深蓝黑（蓝分量最高，读作"大气"而非纯黑）',
    tex.top.b > tex.top.r && tex.top.r <= 24 && tex.top.g <= 32 && tex.top.b <= 48,
    `rgb(${tex.top.r},${tex.top.g},${tex.top.b})`);
}

// ── 4b. 渲染合成实证：同帧两态比对（顶部必变暗 / 底部为负对照必几乎不变）──
// 完全隔离手法（消除一切噪声源，保证观测差值 = 雾化层单独贡献）：
//   ① 隐藏 GameScene 内除 haze 与 depth −200 关卡底色之外的全部可见对象
//      （含流星/星空/流光带/bloom RT），只留「不透明底色 × haze」两个贡献者；
//   ② 隐藏 UIScene 全部子对象（HUD 文本/暗角/颗粒会污染取样）；
//   ③ 暂停 GameScene —— Phaser 的 paused 场景**仍渲染但不 update**，
//      故 snapshot 有效且期间不会新生成子弹/爆炸等物件（否则 ②③ 白做）。
//   ④ 顶部 (270,40) 与底部 (270,930) 双点取样：前者证明"在压暗"，后者证明"只压远景"。
const px = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const us = gs.scene.get('UIScene');
  const haze = gs.children.list.find((o) => o.texture && o.texture.key === 'depth_fog');
  if (!haze) return { err: 'no haze' };
  const restore = [];
  for (const o of gs.children.list) {
    if (!o || o === haze) continue;
    if (o.depth === -200) continue;          // 保留关卡底色（不透明全屏）
    if (!o.visible) continue;
    o.setVisible(false); restore.push(o);
  }
  const uiRestore = [];
  if (us) {
    for (const o of us.children.list) {
      if (o && o.visible) { o.setVisible(false); uiRestore.push(o); }
    }
  }
  gs.scene.pause();

  const snap = (x, y) => new Promise((res) => {
    try { gs.game.renderer.snapshotPixel(x, y, (c) => res({ r: c.red, g: c.green, b: c.blue })); }
    catch (e) { res({ err: String(e) }); }
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // headless 软渲约 6~7 fps（≈150ms/帧）→ 每次状态切换后等 600ms 确保至少渲染数帧
  const alpha = haze.alpha;

  haze.setAlpha(0); await wait(600);
  const offTop = await snap(270, 40); const offBot = await snap(270, 930);
  haze.setAlpha(alpha); await wait(600);
  const onTop = await snap(270, 40); const onBot = await snap(270, 930);

  haze.setAlpha(alpha);
  gs.scene.resume();
  restore.forEach((o) => { if (o.active) o.setVisible(true); });
  uiRestore.forEach((o) => { if (o.active) o.setVisible(true); });
  return { offTop, onTop, offBot, onBot, alpha };
});
if (px.err) {
  push('15. 渲染实证：开启雾化后顶部变暗', false, px.err);
  push('16. 负对照：底部（渐变透明区）几乎不变', false, px.err);
} else if (px.offTop.err || px.onTop.err) {
  push('15. 渲染实证：开启雾化后顶部变暗', false, 'snapshot 读值失败');
  push('16. 负对照：底部（渐变透明区）几乎不变', false, 'snapshot 读值失败');
} else {
  const sum = (p) => p.r + p.g + p.b;
  const dTop = sum(px.offTop) - sum(px.onTop);
  const dBot = Math.abs(sum(px.offBot) - sum(px.onBot));
  push('15. 渲染实证：开启雾化后顶部变暗（差值 = 雾化层单独贡献）', dTop >= 3,
    `顶部 RGB 和 关闭=${sum(px.offTop)} → 开启=${sum(px.onTop)}，差值 ${dTop}（α=${px.alpha}）`);
  push('16. 负对照：底部（渐变透明区）几乎不变 → 证明"只压远景、不压近景"',
    dBot <= 4,
    `底部 RGB 和 ${sum(px.offBot)} vs ${sum(px.onBot)}，差值 ${dBot}`);
}

push('17. 零 pageerror / console.error', errors.length === 0, `errors=${errors.length}${errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''}`);

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log('\n' + '─'.repeat(60));
console.log(`qa_opt18_p3_depth: ${checks.length - failed.length}/${checks.length} PASS` + (failed.length ? `  ❌ ${failed.map((f) => f.name).join(' ; ')}` : '  ✅ 全绿'));
process.exit(failed.length ? 1 : 0);
