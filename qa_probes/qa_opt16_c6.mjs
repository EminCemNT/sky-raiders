// qa_opt16_c6.mjs —— OPT-16 批1 C6 暂停面板「重开本局」验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C6 条。断言真实运行行为：
//   C6.1  暂停面板新增「重开本局」按钮（继续之下、quit 之上）
//   C6.2  normal L2 战斗 → 暂停 → 重开 → 确认 → GameScene 以 levelId=2/mode=normal 重启、命/HP/能量回初始
//   C6.3  endless 重开 → 从 wave1 开始（fresh waves.currentWave ≤1）
//   C6.4  救济局（failStreak≥3 接受 A 降难度）→ 暂停重开 → _reliefRun/_reliefCombatMul 保留、不重复弹面板
//   C6.5  二次确认「取消」→ 本局继续（HP/暂停态不变）、无写盘
//   C6.6  i18n zh/en：uiRestart/restartConfirmTitle/restartConfirmDesc/restartCancel；en 界面英文
//   C6.7  红线：零新存档字段；GameScene getRunParams 不写档
// 运行：node qa_probes/qa_opt16_c6.mjs（QA_URL 默认 http://127.0.0.1:5059）
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

const BASE_SAVE = {
  lang: 'zh', tutorialDone: true, quality: 'high', coins: 100, selectedDifficulty: 'standard',
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 },
  failStreak: {},
};

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

// 停全部相关场景 → 以 data 启动 GameScene（GameScene.create 自会 launch UIScene，与真实 Menu→GAME 一致）
async function enterBattle(page, data) {
  await page.evaluate((d) => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
    game.scene.start('GameScene', d);
  }, data);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const ui = window.__SKY__.scene.getScene('UIScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active
      && ui && ui.scene.isActive() && !ui._paused;
  }, null, { timeout: 20000 });
}

async function pauseGame(page) {
  await page.evaluate(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    if (ui && !ui._paused) ui.togglePause();
  });
  await page.waitForFunction(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    return ui && ui._paused && ui.pauseOverlay && ui.pauseOverlay.visible;
  }, null, { timeout: 10000 });
}

// 读暂停面板内按钮文本（NeonButton 容器内 Text）
async function pauseButtonLabels(page) {
  return page.evaluate(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    const out = [];
    if (ui && ui.pauseOverlay) {
      (ui.pauseOverlay.list || []).forEach((c) => {
        if (c && c.type === 'Container' && c.list) {
          c.list.forEach((t) => { if (t && t.type === 'Text') out.push(String(t.text)); });
        }
      });
    }
    return out;
  });
}

async function clickLabelIn(page, containerSel, label) {
  // containerSel: 'pauseOverlay' | '_restartConfirm'
  await page.evaluate(({ sel, lbl }) => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    const root = sel === 'pauseOverlay' ? ui.pauseOverlay : ui._restartConfirm;
    if (!root) return;
    for (const c of (root.list || [])) {
      if (c && c.type === 'Container' && c.list) {
        for (const t of c.list) {
          if (t && t.type === 'Text' && String(t.text) === lbl) { c.emit('pointerdown'); return; }
        }
      }
    }
  }, { sel: containerSel, lbl: label });
  await new Promise((r) => setTimeout(r, 120));
}

async function openRestartConfirm(page) {
  await page.evaluate(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    if (ui && !ui._restartConfirm) ui._confirmRestart();
  });
  await page.waitForFunction(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    return ui && ui._restartConfirm;
  }, null, { timeout: 10000 });
}

// 收集弹窗内全部文本（顶层 + 按钮容器内一层）
async function readConfirm(page) {
  return page.evaluate(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    const ov = ui && ui._restartConfirm;
    const texts = [];
    if (ov) {
      (ov.list || []).forEach((c) => {
        if (!c) return;
        if (c.type === 'Text') texts.push(String(c.text));
        else if (c.type === 'Container' && c.list) {
          (c.list || []).forEach((t) => { if (t && t.type === 'Text') texts.push(String(t.text)); });
        }
      });
    }
    return { open: !!ov, texts };
  });
}

async function waitRunReady(page) {
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const ui = window.__SKY__.scene.getScene('UIScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active
      && ui && ui.scene.isActive() && !ui._paused;
  }, null, { timeout: 25000 });
}

// ═══════════════ 0) i18n zh/en ═══════════════
const zhCtx = await launchPage(BASE_SAVE);
const loc = await zhCtx.page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  const keys = ['uiRestart', 'restartConfirmTitle', 'restartConfirmDesc', 'restartCancel'];
  return {
    all: keys.every((k) => typeof L.zh[k] === 'string' && L.zh[k].length > 0
      && typeof L.en[k] === 'string' && L.en[k].length > 0),
    zh: keys.map((k) => L.zh[k]), en: keys.map((k) => L.en[k]),
  };
});
push('C6.6. i18n zh/en C6 词条齐全（uiRestart/restartConfirm*）', loc.all === true, `zh=${loc.zh.join('|')} en=${loc.en.join('|')}`);

// ═══════════════ 1) C6.1 normal L2：暂停面板有「重开本局」 ═══════════════
await enterBattle(zhCtx.page, { mode: 'normal', levelId: 2 });
const pre = await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    maxHp: gs.player.maxHp, lives: gs.lives,
    gp: gs.getRunParams(),
    hasNewFields: ['reliefRun', 'reliefCombatMul', 'reliefAtkPicked'].some((k) => {
      const s = window.__SAVE.load();
      return k in s;
    }),
  };
});
push('C6.1. getRunParams() → mode=normal levelId=2 且不写存档', pre.gp.mode === 'normal' && pre.gp.levelId === 2 && pre.gp.reliefRun === false && pre.hasNewFields === false, `gp=${JSON.stringify(pre.gp)}`);

// 破坏生命/命数/能量，便于验证重开回初始
await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.player.hp = 1;
  gs.lives = 0;
  gs.energy = 90;
});
await pauseGame(zhCtx.page);
const pauseLbls = await pauseButtonLabels(zhCtx.page);
push('C6.1. 暂停面板包含「重开本局」按钮', pauseLbls.includes('重开本局'), `labels=${pauseLbls.join('|')}`);
push('C6.1. 暂停面板仍含「继续/退出到菜单」（既有按钮保留）', pauseLbls.includes('继续') && pauseLbls.includes('退出到菜单'), `labels=${pauseLbls.join('|')}`);

// ═══════════════ 2) C6.5 取消 → 本局继续、无写盘 ═══════════════
const saveSnapBefore = await zhCtx.page.evaluate(() => JSON.stringify(window.__SAVE.load()));
await openRestartConfirm(zhCtx.page);
const confirmZh1 = await readConfirm(zhCtx.page);
push('C6.5. 二次确认弹窗出现（标题/描述/取消）', confirmZh1.open && confirmZh1.texts.includes('重开本局？') && confirmZh1.texts.includes('取消'), `txt=${confirmZh1.texts.join('|')}`);
await clickLabelIn(zhCtx.page, '_restartConfirm', '取消');
await zhCtx.page.evaluate((snap) => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { confirmGone: !ui._restartConfirm, stillPaused: ui._paused && ui.pauseOverlay.visible, hp: gs.player.hp, saveSame: JSON.stringify(window.__SAVE.load()) === snap };
}, saveSnapBefore).then((r) => {
  push('C6.5. 取消 → 弹窗关闭且仍暂停、本局未重开（hp 仍 1）', r.confirmGone && r.stillPaused && r.hp === 1, `gone=${r.confirmGone} paused=${r.stillPaused} hp=${r.hp}`);
  push('C6.5. 取消 → 无写盘（save 快照一致）', r.saveSame === true, `same=${r.saveSame}`);
});

// ═══════════════ 3) C6.2 重开确认 → normal L2 重启、命/HP/能量回初始 ═══════════════
await openRestartConfirm(zhCtx.page);
await clickLabelIn(zhCtx.page, '_restartConfirm', '重开本局'); // OK = uiRestart label
await waitRunReady(zhCtx.page);
const afterRestart = await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  return {
    mode: gs.mode, levelId: gs.levelId, hp: gs.player.hp, maxHp: gs.player.maxHp,
    lives: gs.lives, energy: gs.energy,
    paused: ui._paused, confirmGone: !ui._restartConfirm,
  };
});
push('C6.2. 重开后 GameScene mode=normal levelId=2', afterRestart.mode === 'normal' && afterRestart.levelId === 2, `mode=${afterRestart.mode} level=${afterRestart.levelId}`);
push('C6.2. 重开命/HP/能量回初始（lives=START、hp 满、energy=0）',
  afterRestart.lives === pre.lives && afterRestart.hp === afterRestart.maxHp && afterRestart.maxHp === pre.maxHp && afterRestart.energy === 0,
  `lives=${afterRestart.lives}(want ${pre.lives}) hp=${afterRestart.hp}/${afterRestart.maxHp} energy=${afterRestart.energy}`);
push('C6.2. 重开后 HUD 恢复（未暂停、确认弹窗已清）', afterRestart.paused === false && afterRestart.confirmGone, `paused=${afterRestart.paused}`);

// ═══════════════ 4) C6.3 endless 重开 → 从 wave1 ═══════════════
await enterBattle(zhCtx.page, { mode: 'endless', levelId: 1 });
await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  // 手动把波次推到中段，验证重开回到 wave1（fresh）
  if (gs.waves) gs.waves.currentWave = 7;
});
const endlessGp = await zhCtx.page.evaluate(() => window.__SKY__.scene.getScene('GameScene').getRunParams());
push('C6.3. endless getRunParams() → mode=endless', endlessGp.mode === 'endless' && endlessGp.levelId === 1, `gp=${JSON.stringify(endlessGp)}`);
await pauseGame(zhCtx.page);
await openRestartConfirm(zhCtx.page);
await clickLabelIn(zhCtx.page, '_restartConfirm', '重开本局');
await waitRunReady(zhCtx.page);
const endlessAfter = await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { mode: gs.mode, wave: gs.waves ? gs.waves.currentWave : -1 };
});
push('C6.3. endless 重开 → mode=endless 且从 wave1 开始（wave≤1）', endlessAfter.mode === 'endless' && endlessAfter.wave <= 1, `mode=${endlessAfter.mode} wave=${endlessAfter.wave}`);

// ═══════════════ 5) C6.4 救济局重开 → 保留且不重复弹面板 ═══════════════
await zhCtx.page.evaluate(() => {
  const SM = window.__SAVE;
  SM.set('failStreak', { 2: 3 });
  SM.set('tutorialDone', true);
});
await enterBattle(zhCtx.page, { mode: 'normal', levelId: 2 });
const reliefOpen = await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { open: gs._reliefOpen === true, reliefRun: gs._reliefRun === true };
});
push('C6.4. failStreak≥3 → 开局弹救济面板（_reliefOpen）', reliefOpen.open === true && reliefOpen.reliefRun === false, `open=${reliefOpen.open} reliefRun=${reliefOpen.reliefRun}`);
// 接受选项 A（降难度）：走真实 finish('lowerDiff') 路径（关面板 + 恢复物理 + 应用救济）
await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  if (gs._reliefCtl && gs._reliefCtl.finish) gs._reliefCtl.finish('lowerDiff');
});
const reliefAccepted = await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    run: gs._reliefRun === true,
    mul: !!(gs._reliefCombatMul && gs._reliefCombatMul.hpMul != null),
    panelClosed: gs._reliefOpen === false,
    physPaused: !!(gs.physics && gs.physics.world && gs.physics.world.isPaused),
    gp: gs.getRunParams(),
  };
});
push('C6.4. 接受 A → _reliefRun=true + combatMul 生效', reliefAccepted.run && reliefAccepted.mul && reliefAccepted.panelClosed && !reliefAccepted.physPaused, `run=${reliefAccepted.run} mul=${reliefAccepted.mul}`);
push('C6.4. getRunParams() 带 reliefRun/reliefCombatMul（不写档）', reliefAccepted.gp.reliefRun === true && !!reliefAccepted.gp.reliefCombatMul && reliefAccepted.gp.mode === 'normal' && reliefAccepted.gp.levelId === 2, `gp=${JSON.stringify({ mode: reliefAccepted.gp.mode, levelId: reliefAccepted.gp.levelId, reliefRun: reliefAccepted.gp.reliefRun })}`);

await pauseGame(zhCtx.page);
await openRestartConfirm(zhCtx.page);
await clickLabelIn(zhCtx.page, '_restartConfirm', '重开本局');
await waitRunReady(zhCtx.page);
const reliefAfter = await zhCtx.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return {
    reliefRun: gs._reliefRun === true,
    mul: !!(gs._reliefCombatMul && gs._reliefCombatMul.hpMul != null),
    panelNotShown: gs._reliefOpen === false && !gs._reliefOverlay,
    physPaused: !!(gs.physics && gs.physics.world && gs.physics.world.isPaused),
    mode: gs.mode, levelId: gs.levelId,
  };
});
push('C6.4. 救济局重开 → _reliefRun/_reliefCombatMul 保留且不重复弹面板',
  reliefAfter.reliefRun && reliefAfter.mul && reliefAfter.panelNotShown && !reliefAfter.physPaused,
  `run=${reliefAfter.reliefRun} mul=${reliefAfter.mul} panelNotShown=${reliefAfter.panelNotShown} paused=${reliefAfter.physPaused}`);
push('C6.4. 救济局重开 → mode=normal levelId=2 不变', reliefAfter.mode === 'normal' && reliefAfter.levelId === 2, `mode=${reliefAfter.mode} level=${reliefAfter.levelId}`);
push('C6.7. zh 全程零新增存档字段（reliefRun/reliefCombatMul/reliefAtkPicked 不入档）', (await zhCtx.page.evaluate(() => {
  const s = window.__SAVE.load();
  return !('reliefRun' in s) && !('reliefCombatMul' in s) && !('reliefAtkPicked' in s);
})) === true);
push('P0. zh 主上下文无 pageerror/console.error', zhCtx.errors.length === 0, zhCtx.errors.slice(0, 3).join(' | '));
await zhCtx.ctx.close();

// ═══════════════ 6) en 界面英文 ═══════════════
const enCtx = await launchPage({ ...BASE_SAVE, lang: 'en' });
await enterBattle(enCtx.page, { mode: 'normal', levelId: 2 });
await pauseGame(enCtx.page);
const enPause = await pauseButtonLabels(enCtx.page);
push('C6.6. en 暂停面板含 Restart Run', enPause.includes('Restart Run'), `labels=${enPause.join('|')}`);
await openRestartConfirm(enCtx.page);
const enConfirm = await readConfirm(enCtx.page);
push('C6.6. en 二次确认为英文（Restart Run? / Cancel）', enConfirm.open && enConfirm.texts.includes('Restart Run?') && enConfirm.texts.includes('Cancel') && enConfirm.texts.some((s) => s.includes('Progress will be lost')), `txt=${enConfirm.texts.join('|')}`);
await clickLabelIn(enCtx.page, '_restartConfirm', 'Cancel');
push('P0. en 上下文无 pageerror/console.error', enCtx.errors.length === 0, enCtx.errors.slice(0, 3).join(' | '));
await enCtx.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C6 暂停重开探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
