// qa_opt16_c11.mjs —— OPT-16 批3 C11 第4架战机「霆光」 验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C11 条。断言真实运行行为：
//   C11.0  数据层：SHIPS.length===4 且既有 3 架字段零改动；SHIP_SKINS shipId=3（3 款）；SKIN_PALETTES 第 4 组
//   C11.1  机库：4 架均可切换；selectedShip=3 展示「霆光·脉冲·雷」；3 款皮肤纹理存在；皮肤行 雷黄/紫电/墨青
//   C11.2  开局：ship 3 → defaultWeapon='pulse' / shipElement='thunder' / shipPassive.stunMul=1.3（Enemy.applyElement 自动生效）
//   C11.3  皮肤链路：player_skin_3_0..2 纹理存在；skin0 默认自带；装备后 player 纹理 player_skin_3_x
//   C11.4  存档：selectedShip=3 结算 → ResultScene 立绘 player_skin_3_x 无越界/无 pageerror
//   C11.5  i18n：zh/en ship_3/skin_3_0..2/passiveDesc_3 词条齐全；既有词条 ship_0..2 不变
//   UI     模块被动面板：霆光显示「霆光 … 麻痹时长 +30%」（thunder 与苍鹰共用 element 词条 → per-ship 覆盖）
// 运行：node qa_probes/qa_opt16_c11.mjs（QA_URL 默认 http://127.0.0.1:5059）
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

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
    '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };

async function launchPage(saveObj) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key, save }) => {
    try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }, { key: SAVE_KEY, save: saveObj });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
    await page.waitForFunction(() => {
      const ms = window.__SKY__.scene.getScene('MenuScene');
      return ms && ms.scene.isActive();
    }, null, { timeout: 20000 });
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error('launchPage timeout: ' + errors.slice(0, 3).join(' | ') || '(no console error)');
  }
  return { ctx, page, errors };
}

// 写 save.selectedShip 并保存
async function setSelectedShip(page, shipId) {
  await page.evaluate((shipId) => {
    const S = window.__SAVE;
    const s = S.load();
    s.selectedShip = shipId;
    s.tutorialDone = true;
    S.save();
  }, shipId);
}

// 进入机库（沿用 qa_hangar_skin：MenuScene 已注册 HangarScene）
async function enterHangar(page) {
  await page.evaluate(() => window.__SKY__.scene.start('HangarScene'));
  await page.waitForFunction(() => {
    const hs = window.__SKY__.scene.getScene('HangarScene');
    return hs && hs.scene.isActive() && hs.shipPreview && hs.shipAura;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

// 进入 normal 局
async function enterGame(page, levelId = 1) {
  await page.evaluate((lid) => {
    const g = window.__SKY__;
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene', 'HangarScene'].forEach((k) => {
      const sc = g.scene.getScene(k);
      if (sc && sc.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: 'normal', levelId: lid });
  }, levelId);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(400);
}

// ═══════════════ A：数据层 + i18n + 静态接线 ═══
const cleanA = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 0 };
const A = await launchPage(cleanA);

const cfgA = await A.page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const SH = m.SHIPS;
  const SK = m.SHIP_SKINS;
  const exp = [
    { id: 0, weapon: 'pulse', element: 'thunder', tint: 0x66ccff, sm: 1.15 },
    { id: 1, weapon: 'missile', element: 'fire', tint: 0xff7a3a, dotMul: 1.25 },
    { id: 2, weapon: 'laser', element: 'ice', tint: 0x9ff0ff, slowMul: 0.8 },
  ];
  const existingOk = SH.length >= 3 && exp.every((e, i) => {
    const s = SH[i];
    if (!s) return false;
    return s.id === e.id && s.weapon === e.weapon && s.element === e.element && s.tint === e.tint
      && (e.sm == null || s.passive.stunMul === e.sm)
      && (e.dotMul == null || s.passive.dotMul === e.dotMul)
      && (e.slowMul == null || s.passive.slowMul === e.slowMul);
  });
  const s3 = SH.find((s) => s.id === 3);
  const sk3 = SK.find((s) => s.shipId === 3);
  return {
    len: SH.length,
    existingOk,
    s3: s3 ? { weapon: s3.weapon, element: s3.element, tint: s3.tint, name: s3.name, stunMul: s3.passive && s3.passive.stunMul, pel: s3.passive && s3.passive.element, pname: s3.passive && s3.passive.name } : null,
    skinCount: SK.length,
    sk3: sk3 ? { n: sk3.skins.length, accents: sk3.skins.map((k) => k.accent), names: sk3.skins.map((k) => k.name) } : null,
    gss3: m.getShipSkins(3).length,
    sk0count: SK[0] ? SK[0].skins.length : 0,
  };
});
push('C11.0. SHIPS.length===4（既有 3 架 + 霆光）', cfgA.len === 4, `len=${cfgA.len}`);
push('C11.0. 既有 3 架字段零改动（id/武器/元素/tint/被动系数）', cfgA.existingOk === true, 'compare vs baseline');
push('C11.0. ship id=3 霆光：pulse/thunder/0xffe14a/passive stunMul 1.3', cfgA.s3 && cfgA.s3.weapon === 'pulse' && cfgA.s3.element === 'thunder' && cfgA.s3.tint === 0xffe14a && cfgA.s3.stunMul === 1.3 && cfgA.s3.pel === 'thunder' && cfgA.s3.pname === '连锁雷', JSON.stringify(cfgA.s3));
push('C11.0. SHIP_SKINS shipId=3：3 款（雷黄/紫电/墨青 0xffe14a/0xb26bff/0x2fd4c8）', cfgA.sk3 && cfgA.sk3.n === 3 && cfgA.sk3.accents.join(',') === [0xffe14a, 0xb26bff, 0x2fd4c8].join(',') && cfgA.sk3.names.join('/') === '雷黄/紫电/墨青', JSON.stringify(cfgA.sk3));
push('C11.0. 既有 3 架皮肤仍 3 款（append 不动既有）', cfgA.sk0count === 3 && cfgA.skinCount === 4, `sk0=${cfgA.sk0count} total=${cfgA.skinCount}`);
push('C11.0. getShipSkins(3).length===3', cfgA.gss3 === 3, `n=${cfgA.gss3}`);

const locC11 = await A.page.evaluate(async () => {
  const { L, t } = await import('/src/config/Locale.js');
  const keys = ['ship_3', 'skin_3_0', 'skin_3_1', 'skin_3_2', 'passiveDesc_3'];
  const all = keys.every((k) => typeof L.zh[k] === 'string' && L.zh[k].length > 0 && typeof L.en[k] === 'string' && L.en[k].length > 0);
  return {
    all, zh: keys.map((k) => L.zh[k]), en: keys.map((k) => L.en[k]),
    ship0_zh: L.zh.ship_0, ship0_en: L.en.ship_0,
    t3: t('ship_3'),
  };
});
push('C11.5. zh/en C11 词条齐全（ship_3/skin_3_0..2/passiveDesc_3）', locC11.all === true, `zh=${locC11.zh.join('|')} en=${locC11.en.join('|')}`);
push('C11.5. zh ship_3=霆光 / en ship_3=Thunderflash', locC11.zh[0] === '霆光' && locC11.en[0] === 'Thunderflash', `t3=${locC11.t3}`);
push('C11.5. 既有词条 ship_0 未变（zh 苍鹰 / en Eagle）', locC11.ship0_zh === '苍鹰' && locC11.ship0_en === 'Eagle', `${locC11.ship0_zh}/${locC11.ship0_en}`);

const tfSrc = (() => { try { return readFileSync(new URL('../src/utils/TextureFactory.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
const enemySrc = (() => { try { return readFileSync(new URL('../src/entities/Enemy.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
const hgSrc = (() => { try { return readFileSync(new URL('../src/scenes/HangarScene.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
push('C11.3. TextureFactory 皮肤循环上限改用 SHIPS.length', /for \(let shipId = 0; shipId < SHIPS\.length; shipId\+\+\)/.test(tfSrc), `len=${tfSrc.length}`);
push('C11.3. SKIN_PALETTES 含霆光第 4 组（雷黄/紫电/墨青配色）', tfSrc.includes('霆光') && tfSrc.includes('0x2fd4c8') && tfSrc.includes('0xb26bff'), `len=${tfSrc.length}`);
push('C11.2. Enemy.applyElement 雷麻痹仍乘 shipPassive.stunMul（霆光自动生效）', /\(\(passive\.element === 'thunder' && passive\.stunMul\) \|\| 1\)/.test(enemySrc), `len=${enemySrc.length}`);
push('C11.UI. HangarScene 模块被动文案 per-ship passiveDesc 回退 element（霆光 +30% 可展示）', /passiveDesc_\$\{ship\.id\}/.test(hgSrc), `len=${hgSrc.length}`);
push('P0. A 上下文无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
await A.ctx.close();

// ═══════════════ B：机库 E2E（4 架切换 / 霆光展示 / 皮肤行 / 模块被动文案）═══
const cleanB = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 5000 };
const B = await launchPage(cleanB);
await setSelectedShip(B.page, 3);
await enterHangar(B.page);

const hangarB = await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  const label = hs.shipLabel ? String(hs.shipLabel.text) : '';
  return {
    label,
    tex0: hs.textures.exists('player_skin_3_0'),
    tex1: hs.textures.exists('player_skin_3_1'),
    tex2: hs.textures.exists('player_skin_3_2'),
    previewKey: hs.shipPreview ? hs.shipPreview.texture.key : '',
  };
});
push('C11.1. selectedShip=3 机库标签含「霆光 · 脉冲机枪 · 雷」', hangarB.label.includes('霆光') && hangarB.label.includes('脉冲') && hangarB.label.includes('雷'), hangarB.label);
push('C11.3. player_skin_3_0/1/2 纹理全部生成', hangarB.tex0 && hangarB.tex1 && hangarB.tex2, `0=${hangarB.tex0} 1=${hangarB.tex1} 2=${hangarB.tex2}`);
push('C11.1. 机库预览默认皮肤贴图 player_skin_3_0', hangarB.previewKey === 'player_skin_3_0', hangarB.previewKey);

// 皮肤 overlay 行名
await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  if (typeof hs.openSkins === 'function' && !hs.skinsOpen) hs.openSkins();
});
await B.page.waitForTimeout(200);
const skinRows = await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return (hs.skinRows || []).map((r) => r.nameText ? String(r.nameText.text) : '');
});
push('C11.3. 皮肤行 = 雷黄/紫电/墨青（ship 3 三款可购名）', skinRows.join('/') === '雷黄/紫电/墨青', skinRows.join('/'));

// 模块面板被动文案（霆光 +30%）
await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  if (typeof hs.openModules === 'function' && !hs.modulesOpen) hs.openModules();
});
await B.page.waitForTimeout(200);
const modPassive = await B.page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return hs.modulePassiveText ? String(hs.modulePassiveText.text) : '';
});
push('C11.UI. 模块被动面板：霆光 … 麻痹时长 +30%（per-ship 覆盖 thunder +15%）', modPassive.includes('霆光') && modPassive.includes('麻痹时长 +30%'), modPassive);
push('P0. B 机库上下文无 pageerror/console.error', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));
await B.ctx.close();

// ═══════════════ C：开局 + 结算 E2E（ship 3 武器/元素/被动 + ResultScene 立绘）═══
const cleanC = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 100,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 } };
const C = await launchPage(cleanC);
await setSelectedShip(C.page, 3);
await enterGame(C.page, 1);

const gameC = await C.page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  const sp = gs.shipPassive || {};
  return {
    defaultWeapon: p.defaultWeapon,
    shipElement: p.shipElement,
    stunMul: sp.stunMul,
    pel: sp.element,
    texKey: p.texture ? p.texture.key : '',
    owns0: window.__SAVE.ownsSkin(3, 0),
  };
});
push('C11.2. 开局 defaultWeapon=pulse（霆光绑定）', gameC.defaultWeapon === 'pulse', gameC.defaultWeapon);
push('C11.2. 开局 shipElement=thunder（雷元素弹）', gameC.shipElement === 'thunder', gameC.shipElement);
push('C11.2. 开局 shipPassive.stunMul=1.3 / element=thunder（Enemy 自动乘麻痹）', gameC.stunMul === 1.3 && gameC.pel === 'thunder', `stunMul=${gameC.stunMul} el=${gameC.pel}`);
push('C11.3. 默认皮肤 0 自带 + player 纹理 player_skin_3_0', gameC.owns0 === true && gameC.texKey === 'player_skin_3_0', `owns0=${gameC.owns0} tex=${gameC.texKey}`);

// 结算 → ResultScene 立绘无越界
const resC = await C.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.score = 12000;
  gs.stats = gs.stats || {};
  gs.stats.spawned = Math.max(gs.stats.spawned || 0, 1);
  gs.stats.coins = 0; gs.stats.damageTaken = 0; gs.grazeCount = 0;
  gs.endGame(true);
  return true;
});
await C.page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive();
}, null, { timeout: 15000 });
await C.page.waitForTimeout(350);
const resultC = await C.page.evaluate(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  const img = rs.rsShipImg;
  return {
    hasImg: !!(img && img.texture),
    imgKey: (img && img.texture) ? img.texture.key : '',
  };
});
push('C11.4. selectedShip=3 结算 → ResultScene 立绘 player_skin_3_0（无越界）', resultC.hasImg && resultC.imgKey === 'player_skin_3_0', resultC.imgKey);
push('P0. C 开局/结算上下文无 pageerror/console.error', C.errors.length === 0, C.errors.slice(0, 3).join(' | '));
await C.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C11 第4架战机霆光探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
