// qa_opt13_b13_codex.mjs —— OPT-13 批B B13 图鉴收藏系统 验收探针
//
// 验证（规格）：
//   1) CODEX_DECOR 配置（frame_1=300 / frame_2=600）；SaveManager append-only 字段 codex 四分类 + codexDecor
//   2) Codex 核心：18 条目定义；record 解锁 / isUnlocked / getProgress（1/7 等）/ getTotalProgress；幂等与非法键忽略
//   3) 装饰购买（金币出口）：金币不足 → false 不扣不记；足够 → 扣款 + 追加 codexDecor；已拥有 → false
//   4) 埋点接线：registerKill（敌机+元素）真实调用 → codex.enemies.turret / codex.elements.fire
//   5) 埋点接线：collectItem 拾取 weapon_laser → codex.weapons.laser；_onBossDefeated → codex.bosses.boss_annihilator
//   6) 菜单面板：openCodex 渲染（overlay + codexOpen + 总进度计数 3/18 + 已解锁条目名/未解锁 ???）+ 购买装饰 + 关闭
//   7) 零 pageerror / console error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

// 面板文案断言依赖 MenuScene 启动时按存档 lang 初始化的 Locale._lang；
// 在页面加载前强制 zh，保证 '炮台' 断言确定性（reset() 不会重新 initLocale）。
await page.addInitScript(() => {
  try {
    const raw = localStorage.getItem('sky_raiders_save_v1');
    const s = raw ? JSON.parse(raw) : {};
    s.lang = 'zh';
    localStorage.setItem('sky_raiders_save_v1', JSON.stringify(s));
  } catch (e) { /* ignore */ }
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

// ── 1) 配置与存档字段 ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const loc = await import('/src/config/Locale.js');
  // 关键：必须用游戏图内的 SaveManager 实例（window.__SAVE）。
  // Vite dev 给游戏模块追加 ?t= 版本参数，page.evaluate 裸 import('/src/utils/SaveManager.js')
  // 会得到第二个模块实例（独立内存 cache），探针写金币/重置将不被 Codex 闭包读到。
  const SaveManager = window.__SAVE;
  SaveManager.reset();
  const fresh = SaveManager.load();
  return {
    decor: m.CODEX_DECOR,
    codex: fresh.codex, codexDecor: fresh.codexDecor,
    i18n: ['codexTitle', 'codexEnemies', 'codexBosses', 'codexWeapons', 'codexElements',
      'codex_enemy_turret', 'codex_boss_annihilator', 'codex_weapon_laser', 'codex_element_fire']
      .every((k) => loc.L.zh[k] && loc.L.en[k]),
  };
});
push('CODEX_DECOR 配置（frame_1=300 / frame_2=600）',
  cfg.decor && cfg.decor.frame_1 && cfg.decor.frame_1.price === 300
    && cfg.decor.frame_2 && cfg.decor.frame_2.price === 600,
  `frame_1=${cfg.decor && cfg.decor.frame_1 && cfg.decor.frame_1.price} frame_2=${cfg.decor && cfg.decor.frame_2 && cfg.decor.frame_2.price}`);
push('SaveManager append-only：freshSave 含 codex 四分类 + codexDecor=[]',
  cfg.codex && cfg.codex.enemies && cfg.codex.bosses && cfg.codex.weapons && cfg.codex.elements
    && Array.isArray(cfg.codexDecor) && cfg.codexDecor.length === 0);
push('i18n zh/en 图鉴词条齐全', cfg.i18n === true);

// ── 2) Codex 核心 ──
const core = await page.evaluate(async () => {
  const { Codex, CODEX_ENTRIES } = await import('/src/systems/Codex.js');
  const SaveManager = window.__SAVE;
  SaveManager.reset();
  const totalEntries = Object.values(CODEX_ENTRIES).reduce((s, a) => s + a.length, 0);
  Codex.record('enemies', 'turret');
  const u1 = Codex.isUnlocked('enemies', 'turret');
  const prog1 = Codex.getProgress('enemies');
  Codex.record('enemies', 'turret'); // 幂等
  const idempotentKeys = Object.keys(Codex.getCodex().enemies).length;
  Codex.record('enemies', 'not_a_real_key'); // 非法键忽略
  const afterInvalid = Object.keys(Codex.getCodex().enemies).length;
  Codex.record('elements', 'fire'); Codex.record('weapons', 'laser'); Codex.record('bosses', 'boss_annihilator');
  const elementsFire = Codex.isUnlocked('elements', 'fire');
  const weaponsLaser = Codex.isUnlocked('weapons', 'laser');
  const bossesAnn = Codex.isUnlocked('bosses', 'boss_annihilator');
  const total = Codex.getTotalProgress();
  return {
    totalEntries, u1, prog1, idempotentKeys, afterInvalid,
    elementsFire, weaponsLaser, bossesAnn, total,
  };
});
push('18 条目定义齐全（7 敌机 + 4 Boss + 4 武器 + 3 元素）', core.totalEntries === 18, `total=${core.totalEntries}`);
push('record 敌机 turret → 解锁 true；进度 1/7',
  core.u1 === true && core.prog1.unlocked === 1 && core.prog1.total === 7,
  `u=${core.u1} prog=${core.prog1.unlocked}/${core.prog1.total}`);
push('record 幂等 + 非法键忽略（enemies 仍只有 turret）',
  core.idempotentKeys === 1 && core.afterInvalid === 1,
  `keys=${core.afterInvalid}`);
push('record 元素/武器/Boss 各自解锁', core.elementsFire === true && core.weaponsLaser === true && core.bossesAnn === true);
push('getTotalProgress：4 条解锁 / 18',
  core.total.unlocked === 4 && core.total.total === 18,
  `u=${core.total.unlocked}/${core.total.total}`);

// ── 3) 装饰购买（金币出口）──
const decor = await page.evaluate(async () => {
  const { Codex } = await import('/src/systems/Codex.js');
  const SaveManager = window.__SAVE;
  const m = await import('/src/config/GameConfig.js');
  SaveManager.reset();
  const s0 = SaveManager.load();
  const coins0 = s0.coins;
  const noCoins = Codex.buyDecor('frame_1');   // 金币 0 → false
  const decorAfterNo = Codex.getDecorOwned().length;
  s0.coins = 1000; SaveManager.save();
  const coinsBeforeBuy = SaveManager.load().coins;
  const def = m.CODEX_DECOR && m.CODEX_DECOR.frame_1;
  const ok = Codex.buyDecor('frame_1');        // 1000 ≥ 300 → true
  const coinsAfter = SaveManager.load().coins;
  const owned = Codex.getDecorOwned();
  const rebuy = Codex.buyDecor('frame_1');     // 已拥有 → false
  const decorCount = Codex.getDecorOwned().length;
  return {
    coins0, noCoins, decorAfterNo, coinsBeforeBuy, defPrice: def && def.price,
    ok, coinsAfter, owned, rebuy, decorCount,
  };
});
push('金币不足 → buyDecor false 且不扣不记',
  decor.noCoins === false && decor.decorAfterNo === 0 && decor.coins0 === 0);
push('金币足够 → 扣款（1000→700）并追加 codexDecor',
  decor.ok === true && decor.coinsAfter === 700 && decor.owned.length === 1 && decor.owned[0] === 'frame_1',
  `coins ${decor.coins0}→${decor.coinsAfter} owned=${decor.owned.join(',')} before=${decor.coinsBeforeBuy} price=${decor.defPrice}`);
push('已拥有 → 再次购买 false（不重复扣款）',
  decor.rebuy === false && decor.decorCount === 1);

// ── 4) 埋点接线：registerKill（敌机 + 元素）──
await page.evaluate(() => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  if (!gs || !gs.scene.isActive()) {
    g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  }
});
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active && gs.waves;
}, { timeout: 20000 });
const killRes = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const { Codex } = await import('/src/systems/Codex.js');
  const SaveManager = window.__SAVE;
  SaveManager.reset();
  // 直接走真实 registerKill 埋点（击杀 turret 且用火元素）
  gs.registerKill(100, 100, { enemyType: 'turret', element: 'fire' });
  const e = Codex.isUnlocked('enemies', 'turret');
  const el = Codex.isUnlocked('elements', 'fire');
  const prog = Codex.getProgress('enemies');
  // 再杀 3 只同类型，敌机进度仍 1/7（只记类型首次）
  gs.registerKill(100, 100, { enemyType: 'turret' });
  gs.registerKill(100, 100, { enemyType: 'turret' });
  gs.registerKill(100, 100, { enemyType: 'turret' });
  const progAfter = Codex.getProgress('enemies');
  return { e, el, prog, progAfter };
});
push('registerKill 埋点：击杀 turret(火) → codex.enemies.turret + codex.elements.fire',
  killRes.e === true && killRes.el === true);
push('重复击杀不改变敌机进度（仍 1/7）',
  killRes.prog.unlocked === 1 && killRes.progAfter.unlocked === 1 && killRes.progAfter.total === 7,
  `after=${killRes.progAfter.unlocked}/${killRes.progAfter.total}`);

// ── 5) 埋点接线：武器拾取 collectItem + Boss 击败 _onBossDefeated ──
const hookRes = await page.evaluate(async () => {
  const g = window.__SKY__;
  const gs = g.scene.getScene('GameScene');
  const { Codex } = await import('/src/systems/Codex.js');
  const SaveManager = window.__SAVE;
  SaveManager.reset();
  // 武器：collectItem 拾取 weapon_laser（真实拾取链路）
  gs.collectItem({ active: true, itemKey: 'weapon_laser', x: 270, y: 300, recycle: () => {} });
  const weapon = Codex.isUnlocked('weapons', 'laser');
  // Boss：构造最小 boss 状态 + 临时屏蔽 endGame 调度，调用真实 _onBossDefeated
  gs.mode = 'normal'; gs.isTower = false;
  gs.boss = { bossKey: 'boss_annihilator', active: false, x: 270, y: 200 };
  const origDelayed = gs.time.delayedCall.bind(gs.time);
  gs.time.delayedCall = () => ({});
  gs._onBossDefeated();
  gs.time.delayedCall = origDelayed;
  const boss = Codex.isUnlocked('bosses', 'boss_annihilator');
  return { weapon, boss };
});
push('collectItem 拾取 laser → codex.weapons.laser', hookRes.weapon === true);
push('_onBossDefeated 击败 annihilator → codex.bosses.boss_annihilator', hookRes.boss === true);

// ── 6) 菜单面板：openCodex 渲染 + 计数 + 装饰购买 + 关闭 ──
await page.evaluate(() => {
  const g = window.__SKY__;
  g.scene.stop('GameScene');
  g.scene.start('MenuScene');
});
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive() && ms.codexOpen === false;
}, { timeout: 20000 });
const panelRes = await page.evaluate(async () => {
  const g = window.__SKY__;
  const ms = g.scene.getScene('MenuScene');
  const { Codex } = await import('/src/systems/Codex.js');
  const SaveManager = window.__SAVE;
  SaveManager.reset();
  SaveManager.load().coins = 9999; SaveManager.save();
  // 预置 3 条解锁（enemies turret / bosses annihilator / weapons laser）
  Codex.record('enemies', 'turret'); Codex.record('bosses', 'boss_annihilator'); Codex.record('weapons', 'laser');
  ms.openCodex();
  const overlay = !!ms.codexOverlay;
  const open = ms.codexOpen;
  // 敌机 tab（默认）：应渲染 turret 名称（zh '炮台'）与 6 个未解锁 '???'（除 turret 外 6 个敌机）
  const texts = [];
  if (ms.codexOverlay && ms.codexOverlay.list) {
    ms.codexOverlay.list.forEach((c) => {
      if (c && c.type === 'Text') texts.push(c.text);
      if (c && c.list) c.list.forEach((cc) => { if (cc && cc.type === 'Text') texts.push(cc.text); });
    });
  }
  const showsUnlockedName = texts.includes('炮台');
  const lockedCount = texts.filter((x) => x === '???').length;
  const progText = Codex.getTotalProgress();
  // 购买装饰（金币足够）
  const buy = Codex.buyDecor('frame_1');
  const owned = Codex.ownsDecor('frame_1');
  ms.closeCodex();
  return { overlay, open, showsUnlockedName, lockedCount, progText, buy, owned, closed: !ms.codexOpen };
});
push('openCodex 面板打开（overlay 创建 + codexOpen=true）', panelRes.overlay === true && panelRes.open === true);
push('敌机 tab 渲染：已解锁 turret 显示名称 + 未解锁显示 ???',
  panelRes.showsUnlockedName === true && panelRes.lockedCount >= 5,
  `unlockedName=${panelRes.showsUnlockedName} ???×${panelRes.lockedCount}`);
push('面板总进度计数 3/18',
  panelRes.progText.unlocked === 3 && panelRes.progText.total === 18,
  `u=${panelRes.progText.unlocked}/${panelRes.progText.total}`);
push('面板购买装饰（金币足够）→ 成功且已拥有', panelRes.buy === true && panelRes.owned === true);
push('closeCodex 关闭（overlay 清理 + codexOpen=false）', panelRes.closed === true);

// 全链路零 pageerror / console.error
push('零 pageerror / console error', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n==== B13 探针结果：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join(' ; '));
  process.exit(1);
}
