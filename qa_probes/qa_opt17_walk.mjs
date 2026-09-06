// qa_opt17_walk.mjs —— OPT-17 P12 走查 SOP 化（玩家视角体验 + 行为断言）
// ---------------------------------------------------------------------------
// 来源：_opt17_tour/walk_tour.mjs 转正（2026-09-06）。P1 教训：截图观察可能误读
// （MenuScene「残留」实为直跳路径误判），故走查必须配程序化断言兜底。
// 覆盖：主菜单(tips轮换/昵称/存档信息) → 每日种子行 → 机库霆光 → 霆光实战(L4)
//       → 每日种子局(mode=daily/seed 落地)；全流程零 pageerror。
// 输出截图：shots/opt17_walk/（.gitignore 已覆盖，不入库）
// 运行：node qa_probes/qa_opt17_walk.mjs（QA_URL 默认 http://127.0.0.1:5059，run-all 托管）
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'shots', 'opt17_walk');
mkdirSync(OUT, { recursive: true });

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

function baseSave(over = {}) {
  return {
    version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
    coins: 99999, bestScore: 420000, unlockedLevel: 4,
    selectedShip: 3, skins: { 3: 0 }, ownedSkins: ['3:1', '3:2'],
    nickname: '爸爸', haptics: true, muted: false,
    dailyChallenge: { date: '', bestScore: 0, cleared: false, claimed: false },
    lastDaily: null,
    ...over,
  };
}

async function newPage(save) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save }) => {
    try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) {}
  }, { key: SAVE_KEY, save });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    return ms && ms.scene.isActive();
  }, null, { timeout: 20000 });
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, name) });
  console.log('📸 ' + name);
};

// ═══ 1. 主菜单：渲染 / tips 点击轮换 / 昵称 / 存档信息 ═══
const A = await newPage(baseSave());
await shot(A.page, 'shot_01_menu.png');
const menuInfo = await A.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const tip = ms.tipText ? String(ms.tipText.text).slice(0, 30) : '';
  const saveInfo = ms.saveInfoText ? String(ms.saveInfoText.text) : '';
  const nick = (() => { try { const s = window.__SAVE.load(); return s.nickname || ''; } catch (e) { return 'ERR'; } })();
  return { tip, saveInfo, nick };
});
push('主菜单渲染（tips / 存档信息 / 昵称）', !!menuInfo.tip && !!menuInfo.saveInfo && !!menuInfo.nick,
  `tip="${menuInfo.tip}" nick=${menuInfo.nick}`);

// C9 tips 点击轮换（y=40 顶部提示条真实点击）
await A.page.mouse.click(270, 40);
await A.page.waitForTimeout(250);
const tip2 = await A.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms.tipText ? String(ms.tipText.text).slice(0, 30) : '';
});
push('C9 tips 点击轮换生效', tip2 !== menuInfo.tip, `"${menuInfo.tip}" → "${tip2}"`);

// 每日任务面板（内含 C5 每日种子挑战行）：递归读 overlay 文本
await A.page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').openDailyQuest());
await A.page.waitForTimeout(350);
await shot(A.page, 'shot_02_daily_seed.png');
const dq = await A.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  const ov = ms.dailyQuestOverlay;
  const found = [];
  const walk = (c) => {
    if (!c || !c.list) return;
    c.list.forEach((o) => {
      if (o && typeof o.text === 'string') found.push(o.text);
      if (o && o.list) walk(o);
    });
  };
  if (ov) walk(ov);
  const joined = found.join(' ');
  return { joined, hasSeed: /今日种子/.test(joined), hasTarget: /目标/.test(joined) && /奖励/.test(joined), hasEnter: /进入/.test(joined) || /挑战/.test(joined) };
});
push('C5 每日种子行（seed/目标/进入）渲染', dq.hasSeed && dq.hasTarget && dq.hasEnter,
  `seed=${dq.hasSeed} target=${dq.hasTarget} enter=${dq.hasEnter}`);
await A.page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').closeDailyQuest());
await A.page.waitForTimeout(200);
push('P0. A 上下文无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));
await A.ctx.close();

// ═══ 2. 机库霆光（ship 3 标签 / 皮肤行）═══
const B = await newPage(baseSave());
await B.page.evaluate(() => window.__SKY__.scene.start('HangarScene'));
await B.page.waitForFunction(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return hs && hs.scene.isActive() && hs.shipPreview && hs.shipAura;
}, null, { timeout: 20000 });
await B.page.waitForTimeout(600);
await shot(B.page, 'shot_03_hangar_thunder.png');
const hg = await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return { label: hs.shipLabel ? String(hs.shipLabel.text) : '', preview: hs.shipPreview ? hs.shipPreview.texture.key : '' };
});
push('机库霆光（ship3 标签 / 纹理 3_0）', hg.label.includes('霆光') && hg.preview === 'player_skin_3_0', hg.label);

// 皮肤行开（雷黄/紫电/墨青）
await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  if (typeof hs.openSkins === 'function' && !hs.skinsOpen) hs.openSkins();
});
await B.page.waitForTimeout(300);
await shot(B.page, 'shot_04_hangar_skins.png');
const skinRows = await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return (hs.skinRows || []).map((r) => (r.nameText ? String(r.nameText.text) : '')).join('/');
});
push('C11 霆光皮肤行（雷黄/紫电/墨青）', skinRows === '雷黄/紫电/墨青', skinRows);
push('P0. B 上下文无 pageerror/console.error', B.errors.length === 0, B.errors.slice(0, 2).join(' | '));
await B.ctx.close();

// ═══ 3. 霆光实战 normal level4（墨青皮肤已购 → 战场纹理 3_2）═══
const C = await newPage(baseSave({ skins: { 3: 2 } }));
await C.page.evaluate(() => {
  const g = window.__SKY__;
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene', 'HangarScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'normal', levelId: 4 });
});
await C.page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, null, { timeout: 20000 });
await C.page.waitForTimeout(1200);
await shot(C.page, 'shot_05_battle_l4_open.png');

// 模拟战斗（按住 pointer 走位 ~5s）
const cx = 270, cy = 800;
await C.page.mouse.move(cx, cy);
await C.page.mouse.down();
for (let i = 0; i < 14; i++) {
  const t = i / 14 * Math.PI * 2;
  await C.page.mouse.move(270 + Math.sin(t * 2) * 160, 780 + Math.cos(t * 3) * 180, { steps: 3 });
  await C.page.waitForTimeout(150);
}
await C.page.mouse.up();
await shot(C.page, 'shot_06_battle_l4_mid.png');
const battle = await C.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    score: gs.score || 0,
    enemiesAlive: gs.enemies ? gs.enemies.countActive(true) : -1,
    playerTex: gs.player ? gs.player.texture.key : '',
    lives: gs.lives,
    uiHud: !!ui && ui.scene.isActive(),
    mode: gs.mode,
  };
});
push('霆光实战（L4 active / HUD 在场）', battle.enemiesAlive >= 0 && battle.uiHud,
  `score=${battle.score} enemies=${battle.enemiesAlive} mode=${battle.mode}`);
push('霆光皮肤链路（战场纹理 3_2 墨青）', battle.playerTex === 'player_skin_3_2', battle.playerTex);
push('P0. C 上下文无 pageerror/console.error', C.errors.length === 0, C.errors.slice(0, 2).join(' | '));
await C.ctx.close();

// ═══ 4. 每日种子局（mode=daily / seed 落地）═══
const D = await newPage(baseSave());
await D.page.evaluate(() => {
  const g = window.__SKY__;
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene', 'HangarScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('GameScene', { mode: 'daily', levelId: 1 });
});
await D.page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, null, { timeout: 20000 });
await D.page.waitForTimeout(1500);
await shot(D.page, 'shot_07_daily_seed_run.png');
const dc = await D.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const dcInfo = (() => { try { return window.__SAVE.getDailyChallenge(); } catch (e) { return null; } })();
  return { seed: gs.dailySeed || (dcInfo && dcInfo.seed) || '', mode: gs.mode };
});
push('每日种子局（mode=daily / seed 落地）', dc.mode === 'daily' && !!dc.seed, `seed=${dc.seed}`);
push('P0. D 上下文无 pageerror/console.error', D.errors.length === 0, D.errors.slice(0, 2).join(' | '));
await D.ctx.close();

// ═══ 汇总 ═══
const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ walk 汇总：${checks.length - fails.length}/${checks.length} 通过 ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);
