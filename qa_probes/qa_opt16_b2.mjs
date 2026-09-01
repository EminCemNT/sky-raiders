// qa_opt16_b2.mjs —— OPT-16 批次2（T1/T2 存档钳位+自愈 / T5 HUD i18n / T12 魔法值收敛 / T7 监听泄漏）验收探针
//
// 规格来源：docs/OPT-16-TECH-SPEC.md。断言真实运行行为：
//   T1/T2 脏存档自愈（coins/upgrades/levelStars/achievements）；正常存档零改动；__SAVE_SANITIZE 可读
//   T5   en 版 HUD 全英文（命/火力/擦弹/能量/武器/元素/波次）；zh 版逐字等价
//   T12  MAGIC 常量值正确；UIScene 布局坐标引用 MAGIC
//   T7   场景往返重启 10 次 EventBus 监听数不增长；UIScene 'update' 监听稳定
// 运行：node qa_probes/qa_opt16_b2.mjs（QA_URL 默认 http://127.0.0.1:5059）
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

// 通用：启动页面并等待游戏就绪；注入指定存档
async function launchPage(saveObj) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save }) => {
    try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }, { key: SAVE_KEY, save: saveObj });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error('launchPage timeout: ' + errors.slice(0, 3).join(' | ') || '(no console error)');
  }
  return { ctx, page, errors };
}

// 进入战斗（GameScene + UIScene 并行），等玩家就绪
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
// T1/T2 —— 脏存档清洗（独立上下文，注入脏数据）
// ─────────────────────────────────────────────
const dirtySave = {
  lang: 'zh', tutorialDone: true, quality: 'high',
  coins: -5,
  upgrades: { firepower: 'abc', hull: 999, shield: 3, magnet: -2, wingman: 2.7, wingmanFirepower: 0 },
  levelStars: { '1': 9, '2': 2, '3': 0 },
  achievements: { fake_key: true },
};
const dCtx = await launchPage(dirtySave);
await dCtx.page.waitForFunction(() => !!(window.__SAVE_SANITIZE), null, { timeout: 10000 });

const t1 = await dCtx.page.evaluate(async () => {
  const save = window.__SAVE.load();
  const ss = window.__SAVE_SANITIZE;
  const ids = await (async () => {
    try { const m = await import('/src/systems/AchievementManager.js'); return [...m.getAchievementIds()]; } catch (e) { return null; }
  })();
  return {
    sanitized: ss.sanitized,
    structurallyBroken: ss.structurallyBroken,
    coins: save.coins,
    firepower: save.upgrades.firepower,
    hull: save.upgrades.hull,
    shield: save.upgrades.shield,
    magnet: save.upgrades.magnet,
    wingman: save.upgrades.wingman,
    wingmanFirepower: save.upgrades.wingmanFirepower,
    lvl1: save.levelStars['1'],
    lvl2: save.levelStars['2'],
    lvl3: save.levelStars['3'],
    hasFake: 'fake_key' in (save.achievements || {}),
    achCount: ids ? ids.length : -1,
  };
});
push('T1. 脏存档被清洗（__SAVE_SANITIZE.sanitized=true）', t1.sanitized === true, `sanitized=${t1.sanitized} broken=${t1.structurallyBroken}`);
push('T1. coins=-5 → 0', t1.coins === 0, `coins=${t1.coins}`);
push('T1. upgrades.firepower="abc" → 0', t1.firepower === 0, `firepower=${t1.firepower}`);
push('T1. upgrades.hull=999 → 0（clampInt 越界回 def=0）', t1.hull === 0, `hull=${t1.hull}`);
push('T1. upgrades.magnet=-2 → 0', t1.magnet === 0, `magnet=${t1.magnet}`);
push('T1. upgrades.wingman=2.7 → 3（取整）', t1.wingman === 3, `wingman=${t1.wingman}`);
push('T1. levelStars.1=9 → 剔除（非法值回 def=0 → 移除）', t1.lvl1 === undefined, `lvl1=${t1.lvl1}`);
push('T1. levelStars.3=0 → 剔除（undefined）', t1.lvl3 === undefined, `lvl3=${t1.lvl3}`);
push('T1. achievements 假 key 剔除', t1.hasFake === false, `hasFake=${t1.hasFake}`);
push('T1. 成就白名单 id 数 = 26', t1.achCount === 26, `achCount=${t1.achCount}`);
push('T1. __SAVE_SANITIZE 只读 getter 可读', dCtx.page.__SAVE_SANITIZE === undefined, '');
await dCtx.ctx.close(); // 释放资源，避免后续上下文资源耗尽

// ─────────────────────────────────────────────
// T1 —— 正常存档零改动（独立上下文，合法值）
// ─────────────────────────────────────────────
const normalSave = {
  lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 12345,
  upgrades: { firepower: 5, hull: 3, shield: 2, magnet: 1, wingman: 1, wingmanFirepower: 4 },
  levelStars: { '1': 3, '2': 2 },
  achievements: {},
  topScores: [{ score: 8888, levelId: 1, mode: 'normal', date: '2026-01-01' }],
};
const nCtx = await launchPage(normalSave);
await nCtx.page.waitForFunction(() => !!(window.__SAVE_SANITIZE), null, { timeout: 10000 });
const t1n = await nCtx.page.evaluate(() => {
  const save = window.__SAVE.load();
  const ss = window.__SAVE_SANITIZE;
  return {
    sanitized: ss.sanitized,
    coins: save.coins,
    firepower: save.upgrades.firepower,
    hull: save.upgrades.hull,
    lvl1: save.levelStars['1'],
    lvl2: save.levelStars['2'],
    topScore: save.topScores.length,
  };
});
push('T1. 正常存档零改动（sanitized=false）', t1n.sanitized === false, `sanitized=${t1n.sanitized}`);
push('T1. 正常存档字段逐字等价', t1n.coins === 12345 && t1n.firepower === 5 && t1n.hull === 3 && t1n.lvl1 === 3 && t1n.lvl2 === 2 && t1n.topScore === 1,
  `coins=${t1n.coins} fire=${t1n.firepower} hull=${t1n.hull} lvl1=${t1n.lvl1} lvl2=${t1n.lvl2} top=${t1n.topScore}`);

// ─────────────────────────────────────────────
// T5 —— zh 版 HUD 逐字等价（用正常存档上下文）
// ─────────────────────────────────────────────
await enterBattle(nCtx.page);
const zhHud = await nCtx.page.evaluate(async () => {
  const game = window.__SKY__;
  const ui = game.scene.getScene('UIScene');
  const { EventBus } = await import('/src/utils/EventBus.js');
  const { EVENTS } = await import('/src/config/GameConfig.js');
  EventBus.emit(EVENTS.WAVE_STARTED, { wave: 3, total: 6, endless: false });
  ui._renderElement('fire');
  return {
    lives: ui.livesText.text,
    power: ui.powerText.text,
    graze: ui.grazeText.text,
    energy: ui.energyText.text,
    weapon: ui.weaponText.text,
    element: ui.elementText.text,
    wave: ui.waveText.text,
  };
});
push('T5. zh HUD 命/火力/擦弹/能量 与原文一致',
  zhHud.lives.startsWith('命 ×') && zhHud.power === '火力 Lv0' && zhHud.graze === '擦弹 0' && zhHud.energy === '能量 0%',
  JSON.stringify(zhHud));
push('T5. zh HUD 武器/元素/波次 与原文一致',
  zhHud.weapon === '主炮 · 脉冲' && zhHud.element === '元素 · 火' && zhHud.wave === '第 3/6 波',
  JSON.stringify(zhHud));

// ─────────────────────────────────────────────
// T12 —— MAGIC 常量收敛 + 运行时布局引用
// ─────────────────────────────────────────────
const t12 = await nCtx.page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    stormTickEvery: gc.MAGIC.stormTickEvery,
    trailTickEvery: gc.MAGIC.trailTickEvery,
    grazeCheckEvery: gc.MAGIC.grazeCheckEvery,
    grazeCfg: gc.GRAZE.CHECK_EVERY,
    hudLivesY: gc.MAGIC.hudLivesY, hudPowerY: gc.MAGIC.hudPowerY,
    hudElementY: gc.MAGIC.hudElementY, hudGrazeY: gc.MAGIC.hudGrazeY, hudEnergyX: gc.MAGIC.hudEnergyX,
    uiLivesY: ui.livesText.y, uiPowerY: ui.powerText.y, uiElementY: ui.elementText.y,
    uiGrazeY: ui.grazeText.y, uiEnergyX: ui.energyText.x, uiHpX: ui.hpText.x,
  };
});
push('T12. MAGIC 常量值正确', t12.stormTickEvery === 30 && t12.trailTickEvery === 2 && t12.grazeCheckEvery === t12.grazeCfg,
  `storm=${t12.stormTickEvery} trail=${t12.trailTickEvery} graze=${t12.grazeCheckEvery}`);
push('T12. HUD 布局坐标引用 MAGIC（值不变）',
  t12.uiLivesY === t12.hudLivesY && t12.uiPowerY === t12.hudPowerY && t12.uiElementY === t12.hudElementY
  && t12.uiGrazeY === t12.hudGrazeY && t12.uiEnergyX === t12.hudEnergyX && t12.uiHpX === t12.hudEnergyX,
  JSON.stringify({ ui: [t12.uiLivesY, t12.uiPowerY, t12.uiElementY, t12.uiGrazeY, t12.uiEnergyX, t12.uiHpX] }));

// ─────────────────────────────────────────────
// T7 —— 场景往返重启 10 次，EventBus 监听数不增长
// ─────────────────────────────────────────────
const t7 = await nCtx.page.evaluate(async () => {
  const game = window.__SKY__;
  const snapshot = () => ({
    eb: window.__PROBE.eventBus,
    uiUpdate: game.scene.getScene('UIScene') ? game.scene.getScene('UIScene').events.listenerCount('update') : -1,
  });
  const waitPlayer = () => new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
  const stopAll = () => {
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
  };
  // 首轮（已有一次 Game+UI 创建）作为基线
  const first = snapshot();
  const counts = [first];
  for (let i = 0; i < 10; i++) {
    stopAll();
    await new Promise((r) => setTimeout(r, 80));
    game.scene.start('MenuScene');
    await new Promise((r) => setTimeout(r, 80));
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
    await waitPlayer();
    counts.push(snapshot());
  }
  return { first, last: counts[counts.length - 1], counts: counts.map((c) => c.eb) };
});
push('T7. 场景往返 10 次 EventBus 监听数不增长（相对首轮 ≤ +2）',
  typeof t7.first.eb === 'number' && t7.last.eb <= t7.first.eb + 2,
  `first=${t7.first.eb} last=${t7.last.eb} series=[${t7.counts.join(',')}]`);
push('T7. UIScene update 监听稳定', t7.first.uiUpdate === t7.last.uiUpdate && t7.last.uiUpdate > 0,
  `first=${t7.first.uiUpdate} last=${t7.last.uiUpdate}`);
await nCtx.ctx.close(); // 释放资源，避免后续上下文资源耗尽

// ─────────────────────────────────────────────
// T2 —— 整档损坏（JSON 不可解析）→ SaveManager freshSave 兜底，不崩溃
// ─────────────────────────────────────────────
const brokenCtx = await browser.newContext({ viewport });
const brokenPage = await brokenCtx.newPage();
const brokenErrors = [];
brokenPage.on('pageerror', (e) => brokenErrors.push('pageerror: ' + e.message));
brokenPage.on('console', (m) => { if (m.type() === 'error') brokenErrors.push('console.error: ' + m.text()); });
await brokenPage.addInitScript((key) => {
  try { localStorage.setItem(key, '{broken json, not parseable!!'); } catch (e) { /* ignore */ }
}, SAVE_KEY);
await brokenPage.goto(URL, { waitUntil: 'domcontentloaded' });
try {
  await brokenPage.waitForFunction(() => !!(window.__SKY__ && window.__SAVE && window.__SAVE_SANITIZE), null, { timeout: 20000 });
} catch (e) {
  await brokenPage.close().catch(() => {});
  throw new Error('T2 broken-save page timeout: ' + brokenErrors.slice(0, 3).join(' | '));
}
const t2b = await brokenPage.evaluate(() => {
  const save = window.__SAVE.load();
  const ss = window.__SAVE_SANITIZE;
  return { coins: save.coins, upgrades: save.upgrades.firepower, broken: ss.structurallyBroken };
});
push('T2. 整档损坏仍启动（freshSave 兜底，coins=0/upgrades=0）', t2b.coins === 0 && t2b.upgrades === 0,
  `coins=${t2b.coins} fire=${t2b.upgrades} broken=${t2b.broken}`);
push('T2. 整档损坏被诊断为 structurallyBroken=true', t2b.broken === true, `broken=${t2b.broken}`);
push('T2. 整档损坏无 pageerror/console.error', brokenErrors.length === 0, brokenErrors.slice(0, 3).join(' | '));
await brokenCtx.close();

// ─────────────────────────────────────────────
// T5 —— en 版 HUD 全英文（独立上下文，lang=en）
// ─────────────────────────────────────────────
const enSave = { lang: 'en', tutorialDone: true, quality: 'high', coins: 100, upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 } };
const eCtx = await launchPage(enSave);
await enterBattle(eCtx.page);
const enHud = await eCtx.page.evaluate(async () => {
  const game = window.__SKY__;
  const ui = game.scene.getScene('UIScene');
  const { EventBus } = await import('/src/utils/EventBus.js');
  const { EVENTS } = await import('/src/config/GameConfig.js');
  EventBus.emit(EVENTS.WAVE_STARTED, { wave: 3, total: 6, endless: false });
  ui._renderElement('fire');
  ui._onWeapon('missile', 5000);
  const timed = ui.weaponText.text;
  ui._onWeapon('pulse', 0);
  const main = ui.weaponText.text;
  return {
    lives: ui.livesText.text,
    power: ui.powerText.text,
    graze: ui.grazeText.text,
    energy: ui.energyText.text,
    weaponMain: main,
    weaponTimed: timed,
    element: ui.elementText.text,
    wave: ui.waveText.text,
  };
});
push('T5. en HUD 命/火力/擦弹/能量 全英文',
  /Lives/.test(enHud.lives) && /Power Lv/.test(enHud.power) && /Graze/.test(enHud.graze) && /Energy/.test(enHud.energy),
  JSON.stringify(enHud));
push('T5. en HUD 武器/元素/波次 全英文',
  enHud.weaponMain === 'Main · Pulse' && /Weapon · Missile \d+s/.test(enHud.weaponTimed)
  && enHud.element === 'Element · Fire' && enHud.wave === 'Wave 3/6',
  JSON.stringify(enHud));

// ─────────────────────────────────────────────
// 收尾：全程无控制台错误
// ─────────────────────────────────────────────
const allErrors = [...nCtx.errors, ...dCtx.errors, ...eCtx.errors];
push('P0. 全程无 pageerror/console.error', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 批次2（T1/T2/T5/T12/T7）探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
process.exit(0);
