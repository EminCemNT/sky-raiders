// qa_modules_p0.mjs —— P0 机库模块养成系统验收探针
//
// 验证：
//   1) MODULES 配置：3 槽 × 2 品质 = 6 个模块 key；MODULE_SLOTS/MODULE_QUALITY/MODULE_SHOP 存在
//   2) 存档默认：modules 三槽全空、moduleInv 空数组（只新增字段，不改旧字段）
//   3) 购买随机模块入库存 + 装备装槽（common 500 / rare 1200 定价）
//   4) 合成：2 个同名同品质 → 1 个高一级品质（同槽）
//   5) 装备模块后 Player 加成生效：射速 / HP / 移速 / 擦弹环半径
//   6) 战机专属被动生效：赤焰灼烧 ×1.25 / 寒霜减速 ×0.8 / 苍鹰雷定身 ×1.15（Enemy.applyElement 系数）
//   7) 机库模块 UI 存在：入口按钮 + 面板（三槽/库存/合成/商店/战机被动说明）+ 交互生效
//   8) Boss 低概率模块掉落（spawnBossDrops 追加 item_module）
//   9) 存档持久化：localStorage 含 modules/moduleInv
//  10) 零 pageerror / console error
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

/** 进入 GameScene 一局（复用同一 page，重启场景） */
async function startGame(page, mode = 'normal') {
  await page.evaluate((mode) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene', 'HangarScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode, levelId: 1 });
  }, mode);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
  }, { timeout: 20000 });
}

/** 进入 HangarScene（清掉其它场景） */
async function startHangar(page) {
  await page.evaluate(() => {
    const g = window.__SKY__;
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('HangarScene');
  });
  await page.waitForFunction(() => {
    const hs = window.__SKY__.scene.getScene('HangarScene');
    return hs && hs.scene.isActive() && hs.moduleEntryBtn && hs.rows && hs.rows.length >= 6;
  }, { timeout: 20000 });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// 干净存档：重置后三槽全空 / 库存空
await page.evaluate(() => window.__SAVE.reset());
await page.evaluate(() => window.__SAVE.set('coins', 5000));

// ── 1) 静态配置：MODULES / SLOTS / QUALITY / SHOP / DROP_CHANCE ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  return {
    slots: m.MODULE_SLOTS.map((s) => s.key),
    quality: Object.keys(m.MODULE_QUALITY).sort(),
    rareMul: m.MODULE_QUALITY.rare && m.MODULE_QUALITY.rare.mul,
    shop: m.MODULE_SHOP,
    dropChance: m.MODULE_DROP_CHANCE,
    moduleKeys: Object.keys(m.MODULES).sort(),
    weaponCommon: m.MODULES.weapon_common,
    weaponRare: m.MODULES.weapon_rare,
    armorRare: m.MODULES.armor_rare,
    engineCommon: m.MODULES.engine_common,
    engineRare: m.MODULES.engine_rare,
    shipPassives: m.SHIPS.map((s) => s.passive && s.passive.element),
  };
});
push('MODULE_SLOTS 三槽(weapon/armor/engine)', JSON.stringify(cfg.slots) === JSON.stringify(['weapon', 'armor', 'engine']), cfg.slots.join(','));
push('MODULE_QUALITY 两档(common/rare)', JSON.stringify(cfg.quality) === JSON.stringify(['common', 'rare']), cfg.quality.join(','));
push('rare 品质系数 ×1.3', cfg.rareMul === 1.3, `mul=${cfg.rareMul}`);
push('MODULE_SHOP 定价(500/1200)', cfg.shop && cfg.shop.common === 500 && cfg.shop.rare === 1200, JSON.stringify(cfg.shop));
push('MODULE_DROP_CHANCE 存在', typeof cfg.dropChance === 'number' && cfg.dropChance > 0 && cfg.dropChance < 1, `chance=${cfg.dropChance}`);
push('MODULES 共 6 个（3 槽 × 2 品质）', cfg.moduleKeys.length === 6, cfg.moduleKeys.join(','));
push('weapon_common 射速 ×0.95', cfg.weaponCommon && cfg.weaponCommon.fireIntervalMul === 0.95);
push('weapon_rare 射速 ×0.88', cfg.weaponRare && cfg.weaponRare.fireIntervalMul === 0.88);
push('armor_rare HP +40', cfg.armorRare && cfg.armorRare.hpBonus === 40);
push('engine_common 移速 ×1.1', cfg.engineCommon && cfg.engineCommon.speedMul === 1.1);
push('engine_rare 擦弹环 +6', cfg.engineRare && cfg.engineRare.grazeExtra === 6);
push('SHIPS 三机均有 passive', cfg.shipPassives.length === 3 && cfg.shipPassives.every(Boolean), cfg.shipPassives.join(','));

// ── 2) 存档默认：三槽空 / 库存空 ──
const dflt = await page.evaluate(() => {
  const s = window.__SAVE.load();
  return { modules: s.modules, inv: s.moduleInv, upgrades: s.upgrades };
});
push('默认 modules 三槽全空', !!dflt.modules && dflt.modules.weapon === null && dflt.modules.armor === null && dflt.modules.engine === null, JSON.stringify(dflt.modules));
push('默认 moduleInv 空数组', Array.isArray(dflt.inv) && dflt.inv.length === 0, `len=${Array.isArray(dflt.inv) ? dflt.inv.length : 'N/A'}`);
push('旧字段 upgrades 六项保留', !!dflt.upgrades && ['firepower', 'hull', 'shield', 'magnet', 'wingman', 'wingmanFirepower'].every((k) => k in dflt.upgrades), JSON.stringify(dflt.upgrades));

// ── 3) 购买 + 装备 ──
const buyEquip = await page.evaluate(() => {
  const S = window.__SAVE;
  S.reset(); S.set('coins', 5000);
  const orig = Math.random;
  Math.random = () => 0; // slot=0(weapon), quality common（0<0.85）
  const buy = S.buyRandomModule('common');
  const coinsAfterBuy = S.load().coins;
  const invAfterBuy = S.load().moduleInv.slice();
  const equip = S.equipModule(buy.key);
  const modulesAfter = S.load().modules;
  const invAfterEquip = S.load().moduleInv.slice();
  Math.random = orig;
  return { buy, coinsAfterBuy, invAfterBuy, equip, modulesAfter, invAfterEquip };
});
push('购买 common 模块入库存（key=weapon_common, 扣 500）',
  buyEquip.buy && buyEquip.buy.key === 'weapon_common' && buyEquip.buy.price === 500 && buyEquip.coinsAfterBuy === 4500,
  JSON.stringify(buyEquip.buy) + ` coins=${buyEquip.coinsAfterBuy}`);
push('购买后库存含 weapon_common', buyEquip.invAfterBuy.some((m) => m.key === 'weapon_common'), JSON.stringify(buyEquip.invAfterBuy));
push('装备 weapon_common → modules.weapon 装槽', buyEquip.equip === true && buyEquip.modulesAfter.weapon === 'weapon_common', JSON.stringify(buyEquip.modulesAfter));
push('装备后库存移除该模块', buyEquip.invAfterEquip.length === 0, JSON.stringify(buyEquip.invAfterEquip));

// ── 4) 合成：2 个同槽 common → 1 个 rare ──
const craft = await page.evaluate(() => {
  const S = window.__SAVE;
  S.reset();
  S.addModule('armor_common');
  S.addModule('armor_common');
  const res = S.craftModule('armor');
  const inv = S.load().moduleInv.slice();
  const noRes = S.craftModule('weapon'); // 无 weapon common → null
  return { res, inv, noRes, commonCount: S.countCommonModules('armor') };
});
push('合成 2×armor_common → armor_rare', craft.res && craft.res.key === 'armor_rare', JSON.stringify(craft.res));
push('合成后库存只剩 armor_rare', craft.inv.length === 1 && craft.inv[0].key === 'armor_rare', JSON.stringify(craft.inv));
push('common 消耗完（count=0）', craft.commonCount === 0, `count=${craft.commonCount}`);
push('数量不足时合成返回 null', craft.noRes === null, JSON.stringify(craft.noRes));

// ── 5) 装备模块后 Player 加成生效 ──
await page.evaluate(() => {
  const S = window.__SAVE;
  S.reset(); S.set('tutorialDone', true);
  const s = S.load();
  s.modules = { weapon: 'weapon_common', armor: 'armor_rare', engine: 'engine_common' };
  S.save();
});
await startGame(page, 'normal');
const bonus = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  return {
    fireMul: p.moduleFireMul,
    fireInterval: p.fireInterval,
    maxHp: p.maxHp,
    hpBonus: p.moduleHpBonus,
    speed: p.getMoveSpeed(),
    speedMul: p.moduleSpeedMul,
    grazeR: p.getGrazeCircle().r,
  };
});
push('武器模块 moduleFireMul=0.95', bonus.fireMul === 0.95, `mul=${bonus.fireMul}`);
push('射速加成生效（fireInterval 140→133）', bonus.fireInterval === 133, `interval=${bonus.fireInterval}`);
push('装甲模块 HP 加成（maxHp=100+0×20+40=140）', bonus.maxHp === 140 && bonus.hpBonus === 40, `maxHp=${bonus.maxHp}`);
push('引擎模块移速加成（getMoveSpeed=420×1.1=462）', bonus.speed === 462 && bonus.speedMul === 1.1, `speed=${bonus.speed}`);
push('engine_common 不改变擦弹环（r=24）', bonus.grazeR === 24, `r=${bonus.grazeR}`);

await page.evaluate(() => {
  const S = window.__SAVE;
  const s = S.load();
  s.modules = { weapon: null, armor: null, engine: 'engine_rare' };
  S.save();
});
await startGame(page, 'normal');
const grazeBonus = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { grazeR: gs.player.getGrazeCircle().r, extra: gs.player.moduleGrazeExtra };
});
push('engine_rare 擦弹环 +6（r=24→30）', grazeBonus.grazeR === 30 && grazeBonus.extra === 6, `r=${grazeBonus.grazeR}`);

// ── 6) 战机专属被动：Enemy.applyElement 系数（每次切换战机后重启场景，刷新 scene.shipPassive）──
await page.evaluate(() => window.__SAVE.set('selectedShip', 1)); // 赤焰 fire
await startGame(page, 'normal');
const passiveFire = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(270, -40, 'small', 'straight', 1, 'straight');
  e.applyElement('fire');
  return { dotMul: e._dotMul, passive: gs.shipPassive && gs.shipPassive.element };
});
push('赤焰被动：灼烧伤害系数 ×1.25', passiveFire.dotMul === 1.25 && passiveFire.passive === 'fire', `dotMul=${passiveFire.dotMul} passive=${passiveFire.passive}`);

await page.evaluate(() => window.__SAVE.set('selectedShip', 0)); // 苍鹰 thunder
await startGame(page, 'normal');
const passiveThunder = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(270, -40, 'small', 'straight', 1, 'straight');
  const now = gs.time.now;
  e.applyElement('thunder');
  return { delta: e._stunUntil - now, passive: gs.shipPassive && gs.shipPassive.element };
});
push('苍鹰被动：雷定身时长 ×1.15（1100→1265ms）',
  passiveThunder.delta >= 1264 && passiveThunder.delta <= 1270 && passiveThunder.passive === 'thunder',
  `delta=${passiveThunder.delta}`);

await page.evaluate(() => window.__SAVE.set('selectedShip', 2)); // 寒霜 ice
await startGame(page, 'normal');
const passiveIce = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(270, -40, 'small', 'straight', 1, 'straight');
  e.applyElement('ice');
  return { slowMul: e._slowMul, passive: gs.shipPassive && gs.shipPassive.element };
});
push('寒霜被动：减速强度 ×0.8（更慢）', passiveIce.slowMul === 0.8 && passiveIce.passive === 'ice', `slowMul=${passiveIce.slowMul}`);

// ── 8) Boss 低概率模块掉落 ──
await startGame(page, 'normal');
const drop = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const orig = Math.random;
  Math.random = () => 0; // 确保命中 MODULE_DROP_CHANCE 且随机槽位=weapon
  gs.spawnBossDrops(270, 300);
  Math.random = orig;
  let found = null;
  gs.items.children.each((it) => { if (it.active && it.itemKey === 'module') found = it; });
  return found ? { itemKey: found.itemKey, tex: found.texture.key } : null;
});
push('spawnBossDrops 低概率追加模块掉落（item_module）',
  !!drop && drop.itemKey === 'module' && drop.tex === 'item_module', JSON.stringify(drop));

// ── 7) 机库模块 UI：入口 + 面板 + 交互 ──
await startHangar(page);
const ui = await page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  hs.openModules();
  return {
    hasEntry: !!hs.moduleEntryBtn,
    hasOverlay: !!hs.moduleOverlay,
    slotCount: hs.moduleSlotRows ? hs.moduleSlotRows.length : 0,
    invRowCount: hs.moduleInvRows ? hs.moduleInvRows.length : 0,
    craftCount: hs.moduleCraftBtns ? hs.moduleCraftBtns.length : 0,
    shopCount: hs.moduleShopBtns ? hs.moduleShopBtns.length : 0,
    passiveText: hs.modulePassiveText ? hs.modulePassiveText.text : '',
    craftLabels: hs.moduleCraftBtns ? hs.moduleCraftBtns.map((c) => c.btn.text.text) : [],
  };
});
push('机库模块入口按钮存在', ui.hasEntry === true);
push('模块面板 overlay 打开', ui.hasOverlay === true);
push('三槽展示（weapon/armor/engine）', ui.slotCount === 3, `slots=${ui.slotCount}`);
push('库存列表 6 行', ui.invRowCount === 6, `rows=${ui.invRowCount}`);
push('合成按钮 3 个', ui.craftCount === 3, `crafts=${ui.craftCount}`);
push('商店按钮 2 个', ui.shopCount === 2, `shops=${ui.shopCount}`);
push('战机被动说明文案存在（当前 寒霜）', /寒霜/.test(ui.passiveText) && /减速强度 \+20%/.test(ui.passiveText), ui.passiveText);
push('合成按钮文案显示 common 计数', ui.craftLabels.every((t) => /\/2/.test(t)), ui.craftLabels.join('|'));

// UI 交互：注入 2 weapon_common → 点武器合成 → 库存出现 weapon_rare
const uiCraft = await page.evaluate(() => {
  const S = window.__SAVE;
  const hs = window.__SKY__.scene.getScene('HangarScene');
  hs.closeModules();
  S.reset(); S.set('coins', 5000);
  S.addModule('weapon_common');
  S.addModule('weapon_common');
  hs.openModules();
  const weaponBtn = hs.moduleCraftBtns.find((c) => c.slot === 'weapon');
  weaponBtn.btn.container.emit('pointerdown');
  const inv = S.load().moduleInv.slice();
  return { inv, modules: S.load().modules };
});
push('UI 合成按钮点击生效（2×weapon_common → weapon_rare）',
  uiCraft.inv.some((m) => m.key === 'weapon_rare'), JSON.stringify(uiCraft.inv));

// UI 交互：点商店 common 按钮（Math.random=0 → weapon_common）+ 点装备按钮
const uiShop = await page.evaluate(() => {
  const S = window.__SAVE;
  const hs = window.__SKY__.scene.getScene('HangarScene');
  const orig = Math.random;
  Math.random = () => 0;
  const commonBtn = hs.moduleShopBtns.find((b) => b.quality === 'common');
  commonBtn.btn.container.emit('pointerdown');
  Math.random = orig;
  // 点第一行库存的「装备」按钮
  hs.refreshModulesPanel();
  const firstRow = hs.moduleInvRows.find((r) => r.mod);
  if (firstRow && firstRow.btn.container) firstRow.btn.container.emit('pointerdown');
  return { coins: S.load().coins, inv: S.load().moduleInv.slice(), modules: S.load().modules };
});
push('UI 商店购买扣金币（5000→4500）', uiShop.coins === 4500, `coins=${uiShop.coins}`);
push('UI 装备按钮点击后装槽', uiShop.modules.weapon !== null, JSON.stringify(uiShop.modules));

// ── 9) 存档持久化：localStorage 含 modules/moduleInv ──
const persist = await page.evaluate(() => {
  const raw = localStorage.getItem('sky_raiders_save_v1');
  const parsed = JSON.parse(raw);
  return { hasModules: 'modules' in parsed, hasInv: 'moduleInv' in parsed, modules: parsed.modules, inv: parsed.moduleInv };
});
push('localStorage 持久化 modules 字段', persist.hasModules === true && !!persist.modules, JSON.stringify(persist.modules));
push('localStorage 持久化 moduleInv 数组', persist.hasInv === true && Array.isArray(persist.inv) && persist.inv.length === 1, `invLen=${Array.isArray(persist.inv) ? persist.inv.length : 'N/A'}`);

// ── 10) 零 pageerror / console error ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_modules_p0: PASS ===' : '=== qa_modules_p0: FAIL ==='));
process.exit(pass ? 0 : 1);
