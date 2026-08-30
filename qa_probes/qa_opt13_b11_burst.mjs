// qa_opt13_b11_burst.mjs —— OPT-13 批B B11 连击蓄力爆发 HUD 缺陷修复 验收探针
//
// 背景（qa-opt 审计 B11 三问题）：
//   1.【阻断】UIScene 蓄力 HUD 未实现 → 本次新增「蓄力」按钮 + BURST_CHANGED/BURST_ACTIVATED 监听
//   2.【高】Locale.js 缺六词条 chargeBurst/chargeBtn/chargePower/chargeClear/chargeEnergy/chargeNeed
//   3.【流程】补 B11 验收探针（e0b9ffc 原提交没带探针）
//
// 验证（规格：ARCH-SPEC 第 B11 条 + PM 第 6 条 G/W/T）：
//   A. UIScene.burstBtn 存在且初始置灰（gauge=0 → alpha 0.45、count 'x0'）
//   B. i18n zh/en 六词条齐全，zh 下 t('chargeBurst') 解析非裸 key
//   C. combo 10 → getBurstGauge()=1 → HUD 高亮（alpha 1 + tint + count 'x10'）【6.5 未达标置灰反向】
//   D. 键盘 C 触发 useBurst：combo→0、maxCombo 峰值保留(10)、player.burstAtkMul=1.5、按钮回灰【6.1】
//   E. 档位2 清屏：combo 15 → 点击蓄力按钮(USE_BURST) → 敌弹清除、combo→0、炸弹数不变【6.2】
//   F. 档位3 回能：combo 20 → 点击蓄力按钮 → 能量充满、combo→0【6.3】
//   G. 峰值只增不减：多轮爆发后 maxCombo 仍为 20（绝不因消耗降低）【6.4】
//   H. 三档位 HUD 文案：gauge1「强化射击」/ gauge2「+清屏」/ gauge3「+回能」
//   I. 零 pageerror / console.error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

// 停 MenuScene 并并行启动 GameScene + UIScene，等待 player.active 且物理未暂停
async function startScenes(page) {
  await page.evaluate(async () => {
    const game = window.__SKY__;
    const SM = window.__SAVE;
    if (SM && SM.set) SM.set('tutorialDone', true);
    game.scene.stop('MenuScene');
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
    await new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const gs = game.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
      }, 50);
    });
  });
  await page.waitForFunction(() => {
    const ui = window.__SKY__.scene.getScene('UIScene');
    return ui && ui.burstBtn;
  }, null, { timeout: 10000 });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

// 预置存档：zh 文案确定性 + 跳过首玩教程 + 标准难度（零精英扰动）
await page.addInitScript(() => {
  try {
    localStorage.setItem('sky_raiders_save_v1', JSON.stringify({ lang: 'zh', tutorialDone: true, quality: 'high', selectedDifficulty: 'standard' }));
  } catch (e) { /* ignore */ }
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await startScenes(page);

// ── 冻结波次 + 清空已刷敌 + 复位连击基线（保证精确档位断言；纯探针操作，不改游戏代码）──
await page.evaluate(() => {
  const gs = window.__SKY;
  if (gs.waves) { gs.waves.state = 'idle'; gs.waves._toSpawn = 0; }
  gs.enemies.children.each((e) => { if (e.active) { e.setActive(false); e.setVisible(false); if (e.body) e.body.enable = false; } });
  if (gs.combo > 0) gs.breakCombo();
  gs.maxCombo = 0;   // 探针基线复位（峰值只增不减验证从 0 起）
  gs.energy = 0;
});

// ── A. burstBtn 存在 + 初始置灰 ──
const init = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  const b = ui.burstBtn;
  return {
    exists: !!b,
    alpha: b ? b.container.alpha : null,
    gauge: ui._burstGauge,
    combo: ui._burstCombo,
    count: b && b.count ? b.count.text : null,
    label: b && b.label ? b.label.text : null,
    texKey: b && b.icon ? b.icon.texture.key : null,
  };
});
push('A1. UIScene.burstBtn 蓄力按钮存在（item_burst 图标）',
  init.exists && init.texKey === 'item_burst', `tex=${init.texKey}`);
push('A2. 初始置灰：gauge=0 → alpha 0.45、count "x0"',
  init.alpha === 0.45 && init.count === 'x0' && init.gauge === 0,
  `alpha=${init.alpha} count=${init.count} gauge=${init.gauge}`);
push('A3. 初始按钮文案为 chargeBtn（蓄力）', init.label === '蓄力', `label=${init.label}`);

// ── B. i18n zh/en 六词条 ──
const loc = await page.evaluate(async () => {
  const { L, t } = await import('/src/config/Locale.js');
  const keys = ['chargeBurst', 'chargeBtn', 'chargePower', 'chargeClear', 'chargeEnergy', 'chargeNeed'];
  const all = keys.every((k) => typeof L.zh[k] === 'string' && L.zh[k].length > 0
    && typeof L.en[k] === 'string' && L.en[k].length > 0);
  return { all, chargeBurstZh: t('chargeBurst'), bare: t('chargeBurst') === 'chargeBurst' };
});
push('B1. i18n zh/en 六词条齐全（chargeBurst/chargeBtn/chargePower/chargeClear/chargeEnergy/chargeNeed）', loc.all === true);
push('B2. zh 下 t("chargeBurst") 解析为文案非裸 key（=连击爆发）',
  loc.chargeBurstZh === '连击爆发' && loc.bare === false, `got=${loc.chargeBurstZh}`);

// ── C. 档位1（combo 10）：registerKill×10 → gauge 1 → 高亮 ──
const tier1 = await page.evaluate(() => {
  const gs = window.__SKY;
  for (let i = 0; i < 10; i++) gs.registerKill(100 + i, 200, { enemyType: 'small' });
  const ui = window.__SKY__.scene.getScene('UIScene');
  const b = ui.burstBtn;
  return {
    gauge: gs.getBurstGauge(),
    uiGauge: ui._burstGauge,
    combo: gs.combo,
    maxCombo: gs.maxCombo,
    alpha: b.container.alpha,
    tint: b.icon.tintTopLeft !== 0xffffff,
    count: b.count.text,
    label: b.label.text,
  };
});
push('C1. combo=10 → GameScene.getBurstGauge()=1 且 HUD 同步 _burstGauge=1',
  tier1.gauge === 1 && tier1.uiGauge === 1, `gauge=${tier1.gauge} ui=${tier1.uiGauge}`);
push('C2. 档位1 高亮：alpha=1 + tint + count "x10"',
  tier1.alpha === 1 && tier1.tint && tier1.count === 'x10',
  `alpha=${tier1.alpha} tint=${tier1.tint} count=${tier1.count}`);
push('C3. 档位1 文案含「强化射击」', tier1.label.includes('强化射击'), `label=${tier1.label}`);

// ── D. 键盘 C 触发 useBurst（6.1）：combo→0、maxCombo 保留 10、burstAtkMul=1.5、按钮回灰 ──
await page.keyboard.down('c');
await page.waitForTimeout(140);
await page.keyboard.up('c');
const cKey = await page.evaluate(() => {
  const gs = window.__SKY;
  const ui = window.__SKY__.scene.getScene('UIScene');
  const b = ui.burstBtn;
  return {
    combo: gs.combo,
    maxCombo: gs.maxCombo,
    mul: gs.player ? gs.player.burstAtkMul : null,
    alpha: b.container.alpha,
    count: b.count.text,
    uiGauge: ui._burstGauge,
  };
});
push('D1. 键盘 C → useBurst：combo→0（HUD count "x0"）',
  cKey.combo === 0 && cKey.count === 'x0' && cKey.uiGauge === 0, `combo=${cKey.combo} count=${cKey.count}`);
push('D2. 峰值只增不减：maxCombo 保留 10', cKey.maxCombo === 10, `maxCombo=${cKey.maxCombo}`);
push('D3. 档位1 强化射击生效：player.burstAtkMul=1.5', cKey.mul === 1.5, `mul=${cKey.mul}`);
push('D4. 爆发后按钮回灰：alpha=0.45', cKey.alpha === 0.45, `alpha=${cKey.alpha}`);

// ── E. 档位2 清屏（6.2）：combo 15 → 点击蓄力按钮(USE_BURST) → 敌弹清除、combo→0、炸弹数不变 ──
const tier2 = await page.evaluate(() => {
  const gs = window.__SKY;
  for (let i = 0; i < 15; i++) gs.registerKill(100 + i, 200, { enemyType: 'small' });
  // 预置 5 发活跃敌弹（组预填满 maxSize=400，create() 超量返回 null，必须用 get() 激活池内对象）
  for (let i = 0; i < 5; i++) {
    const b = gs.enemyBullets.get(200, 300, 'bullet_enemy');
    if (b) { b.setActive(true); b.setVisible(true); if (b.body) b.body.enable = true; }
  }
  const before = { activeBullets: gs.enemyBullets.countActive(true), gauge: gs.getBurstGauge(), bombs: gs.bombs };
  const ui = window.__SKY__.scene.getScene('UIScene');
  const b = ui.burstBtn;
  const beforeLabel = b.label.text;
  // 点击蓄力按钮 → USE_BURST → GameScene._onUseBurst → useBurst
  b.container.emit('pointerdown', null, 0, 0, { stopPropagation() {} });
  return {
    before,
    beforeLabel,
    gauge: gs.getBurstGauge(),
    afterLabel: b.label.text,
    combo: gs.combo,
    maxCombo: gs.maxCombo,
    bombs: gs.bombs,
    activeBullets: gs.enemyBullets.countActive(true),
    uiGauge: ui._burstGauge,
    alpha: b.container.alpha,
  };
});
push('E1. combo=15 → gauge=2，HUD 文案含「清屏」', tier2.before.gauge === 2 && tier2.beforeLabel.includes('清屏'), `gauge=${tier2.before.gauge} label=${tier2.beforeLabel}`);
push('E2. 点击蓄力按钮 → 全场敌弹清除（5→0）', tier2.activeBullets === 0, `bullets=${tier2.activeBullets}`);
push('E3. 清屏后 combo→0、炸弹数不变(3)',
  tier2.combo === 0 && tier2.bombs === 3, `combo=${tier2.combo} bombs=${tier2.bombs}`);
push('E4. 峰值保留：maxCombo=15', tier2.maxCombo === 15, `maxCombo=${tier2.maxCombo}`);

// ── F. 档位3 回能（6.3）：combo 20 → 点击蓄力按钮 → 能量充满、combo→0 ──
const tier3 = await page.evaluate(() => {
  const gs = window.__SKY;
  gs.energy = 0;
  for (let i = 0; i < 20; i++) gs.registerKill(100 + i, 200, { enemyType: 'small' });
  const ui = window.__SKY__.scene.getScene('UIScene');
  const b = ui.burstBtn;
  const before = { gauge: gs.getBurstGauge(), label: b.label.text, energy: gs.energy };
  b.container.emit('pointerdown', null, 0, 0, { stopPropagation() {} });
  return {
    before,
    gauge: gs.getBurstGauge(),
    combo: gs.combo,
    maxCombo: gs.maxCombo,
    energy: gs.energy,
    uiGauge: ui._burstGauge,
    alpha: b.container.alpha,
  };
});
push('F1. combo=20 → gauge=3，HUD 文案含「回能」', tier3.before.gauge === 3 && tier3.before.label.includes('回能'), `gauge=${tier3.before.gauge} label=${tier3.before.label}`);
push('F2. 点击蓄力按钮 → 能量充满（0→100）', tier3.energy === 100, `energy=${tier3.energy}`);
push('F3. 回能后 combo→0、HUD 回灰',
  tier3.combo === 0 && tier3.alpha === 0.45 && tier3.uiGauge === 0, `combo=${tier3.combo} alpha=${tier3.alpha}`);

// ── G. 峰值只增不减终判（6.4）：多轮爆发后 maxCombo 仍为 20 ──
push('G1. 峰值只增不减：三轮爆发后 maxCombo 保持 20（绝不因消耗降低）', tier3.maxCombo === 20, `maxCombo=${tier3.maxCombo}`);

// ── I. 零 pageerror / console.error ──
push('I1. 全链路零 pageerror / console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n==== B11 探针结果：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join(' ; '));
  process.exit(1);
}
