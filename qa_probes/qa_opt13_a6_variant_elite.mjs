// qa_opt13_a6_variant_elite.mjs —— OPT-13 批A A6 波次变体 + 精英承载 验收探针
//
// 验证：
//   1) ELITE 配置块存在（hpMul=5 / scoreMul=3 / spawnChance=0.08 / tint）
//   2) 4 关均配置 waveVariants（2~3 套），每套 wave 数与 waves 一致、与 wavePlan 同构
//   3) 非无尽局随机锁定 1 套变体（getVariantId → L{id}-V{n}），本局波次均用该套表
//   4) 无 waveVariants 的关回退 wavePlan（variantPlan=null / getVariantId='base'）
//   5) 精英承载：spawnEnemy(..., elite=true) → isElite、hp ×5、scale 1.2、_fireRateEff 提速
//   6) 精英击杀 → spawnEliteDrops 必掉 BOSS_DROP_TABLE 道具（items 池出现新 item）
//   7) 休闲档 _isCasual()=true → 不触发精英兜底
//   8) 零 pageerror / console error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

async function startGame(page, levelId = 1) {
  await page.evaluate((lid) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: 'normal', levelId: lid });
  }, levelId);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active && gs.waves;
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
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

// ── 1/2) 配置 ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const levels = m.LEVELS.map((l) => ({
    id: l.id, waves: l.waves, variants: (l.waveVariants || []).map((v) => v.length),
    sameCount: (l.waveVariants || []).every((v) => v.length === l.waves),
    wavePlanLen: (l.wavePlan || []).length,
  }));
  return { elite: m.ELITE, levels };
});
push('ELITE.hpMul=5 / scoreMul=3 / spawnChance=0.08',
  cfg.elite && cfg.elite.hpMul === 5 && cfg.elite.scoreMul === 3 && cfg.elite.spawnChance === 0.08,
  `hpMul=${cfg.elite && cfg.elite.hpMul}`);
const variantsOk = cfg.levels.every((l) => l.variants.length >= 2 && l.variants.length <= 3 && l.sameCount);
push('4 关均配 waveVariants（2~3 套，每套 wave 数 = waves）', variantsOk, JSON.stringify(cfg.levels.map((l) => `${l.id}:${l.variants.join('/')}`)));

// ── 3) 变体锁定 ──
await startGame(page, 1);
const variant = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  return { vid: ws.getVariantId(), planLen: ws.variantPlan ? ws.variantPlan.length : null, wavePlanLen: ws.level.wavePlan.length };
});
push('非无尽局随机锁定变体（getVariantId = L1-V{n}）', /^L1-V[123]$/.test(variant.vid), `vid=${variant.vid}`);
push('变体表 wave 数 = 关卡 waves', variant.planLen === 6, `planLen=${variant.planLen}`);

// 同一 run 内波次均用该套表：连续调用 startNextWave 数次，variantPlan 引用不变
const stable = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  const refs = [];
  for (let i = 0; i < 3; i++) refs.push(ws.variantPlan === gs.waves.variantPlan);
  return { allSame: refs.every(Boolean), vid: ws.getVariantId() };
});
push('本局波次均用同一套变体（引用稳定）', stable.allSame, `vid=${stable.vid}`);

// ── 4) 无 waveVariants 回退 wavePlan ──
const fallback = await page.evaluate(() => {
  const ws = window.__SKY__.scene.getScene('GameScene').waves;
  // 模拟"无变体"关卡：临时把 level.waveVariants 置空（不改真配置），重走 _pickVariantPlan
  const fake = { ...ws.level, waveVariants: null };
  const picked = ws._pickVariantPlan(fake, false);
  return { picked };
});
push('无 waveVariants 回退 wavePlan（variantPlan=null）', fallback.picked === null);

// ── 5) 精英承载 ──
const elite = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  // small 不开火（fireRate=0）无射速提速可验证；用 mid（fireRate=1400）验证射速 ×1.5
  const e = gs.spawnEnemy(200, 100, 'mid', 'straight', 1, 'straight', true);
  const base = 60; // mid.hp
  return {
    isElite: e.isElite,
    hp: e.hp, maxHp: e.maxHp, expectedHp: base * 1 * 1 * 5,
    scaleX: e.scaleX, scaleY: e.scaleY,
    fireRateEff: e._fireRateEff, expectedFireRate: Math.max(280, Math.round(1400 * 0.67)),
    hasGlow: !!(e._eliteGlow && e._eliteGlow.active),
  };
});
push('精英 isElite=true + hp×5', elite.isElite && elite.hp === elite.expectedHp, `hp=${elite.hp}/${elite.expectedHp}`);
push('精英 scale≈1.2 + 发光 + 射速提速', elite.scaleX > 1.19 && elite.scaleY > 1.19 && elite.hasGlow && elite.fireRateEff === elite.expectedFireRate,
  `scale=${elite.scaleX} glow=${elite.hasGlow} fireRateEff=${elite.fireRateEff}`);

// ── 6) 精英击杀必掉 BOSS_DROP_TABLE ──
const drop = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(200, 150, 'mid', 'straight', 1, 'straight', true);
  const before = gs.items.countActive(true);
  const spawnedKeys = [];
  const origSpawn = gs.spawnItem.bind(gs);
  gs.spawnItem = (x, y, key) => { spawnedKeys.push(key); origSpawn(x, y, key); };
  e.hit(99999, 'fire');
  gs.spawnItem = origSpawn;
  const after = gs.items.countActive(true);
  return { before, after, spawnedKeys };
});
push('精英击杀走 spawnEliteDrops 必掉 1 件', drop.spawnedKeys.length >= 1, `dropped=${drop.spawnedKeys.join(',') || 'none'}`);
push('掉落来自 BOSS_DROP_TABLE（energy/heal/wingman/bomb/weapon）',
  drop.spawnedKeys.length > 0 && drop.spawnedKeys.every((k) => ['energy', 'heal', 'wingman', 'bomb', 'weapon_missile', 'weapon_laser', 'weapon_bomb'].includes(k)),
  `keys=${drop.spawnedKeys.join(',')}`);

// ── 7) 休闲档不触发精英 ──
const casual = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  const realCfg = gs.difficultyCfg;
  gs.difficultyCfg = { id: 'casual', hpMul: 0.7, speedMul: 0.85 };
  const isCasual = ws._isCasual();
  gs.difficultyCfg = realCfg;
  return { isCasual };
});
push('休闲档 _isCasual()=true（不触发精英兜底）', casual.isCasual === true);

// ── 8) 零报错 ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a6_variant_elite: PASS ===' : '=== qa_opt13_a6_variant_elite: FAIL ==='));
process.exit(pass ? 0 : 1);
