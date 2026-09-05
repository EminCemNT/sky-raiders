// qa_opt16_c10.mjs —— OPT-16 批3 C10 Boss 高难终局·改型方案A 验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C10 条。断言真实运行行为：
//   C10.0  配置：BOSS_HARD { difficulty:'hell', phase3Patterns:['spiral','cross'], visualKey:'hell', densityMul:1.2, speedMul:1.1 }
//   C10.1  hell 档 spawnBoss → boss.hardPhase=true；非 hell（standard）→ false（非 hell 零出现）
//   C10.2  hardPhase=true + phase3 + 非狂暴 → firePattern 走 _fireHardPattern（_hardPatIdx 轮换 spiral/cross）
//   C10.3  高难 pattern 密度乘 BOSS_HARD.densityMul；轮换两类弹量不同（spiral > cross，可区分）
//   C10.4  狂暴让位：_enraging=true 时 firePattern 不再叠加高难 pattern（_hardPatIdx 不动）；视觉回落既有红
//   C10.5  视觉：hell phase3 tint ≠ 普通 phase3 tint（紫色终局形态）
//   红线   Boss.js 0.66/0.33 阶段阈值与 RAGE.hpThreshold 触发判断仍在（未改）
// 运行：node qa_probes/qa_opt16_c10.mjs（QA_URL 默认 http://127.0.0.1:5059）
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

async function setDifficulty(page, diffId) {
  await page.evaluate((diffId) => {
    const S = window.__SAVE;
    const s = S.load();
    if (diffId) s.selectedDifficulty = diffId;
    s.tutorialDone = true;
    S.save();
  }, diffId);
}

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
    return gs && gs.scene.isActive() && gs.player && gs.player.active && gs.waves;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

// 直接构造独立测试 Boss（沿用 qa_opt13_a7_rage：window 存实例，停入场 tween、_entering=false）
async function mkBoss(page, opts) {
  return page.evaluate(async (opts) => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    const { default: Boss } = await import('/src/entities/Boss.js');
    const b = new Boss(gs, 'boss_c10_test', Object.assign({ maxHp: 1000, pattern: 'fan', color: 0xff0000, difficulty: 1 }, opts));
    gs.tweens.killTweensOf(b);
    b._entering = false;
    b.y = 150;
    window.__C10B__ = b;
    return { ok: true, phase: b.phase, hard: b.hardPhase };
  }, opts);
}

// 计数一轮 firePattern 发射弹量并读 _hardPatIdx（monkeypatch spawnBullet）
async function fireCount(page) {
  return page.evaluate(() => {
    const b = window.__C10B__;
    const orig = b.spawnBullet.bind(b);
    let n = 0;
    b.spawnBullet = () => { n++; };
    b.firePattern();
    b.spawnBullet = orig;
    return { n, idx: b._hardPatIdx, phase: b.phase, hard: b.hardPhase, enraging: b._enraging };
  });
}

// ═══════════════ A：配置 + 静态接线/红线 ═══
const cleanA = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 0 };
const A = await launchPage(cleanA);

const cfgC10 = await A.page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  const b = m.BOSS_HARD;
  return {
    b,
    fields: ['difficulty', 'phase3Patterns', 'visualKey', 'densityMul', 'speedMul'],
  };
});
const bh = cfgC10.b || {};
push('C10.0. BOSS_HARD 配置块字段齐备', cfgC10.fields.every((k) => bh[k] != null), JSON.stringify(bh));
push('C10.0. difficulty=hell / phase3Patterns=[spiral,cross] / densityMul 1.2 / speedMul 1.1',
  bh.difficulty === 'hell' && Array.isArray(bh.phase3Patterns) && bh.phase3Patterns.length === 2
    && bh.phase3Patterns.includes('spiral') && bh.phase3Patterns.includes('cross')
    && bh.densityMul === 1.2 && bh.speedMul === 1.1 && bh.visualKey === 'hell',
  JSON.stringify({ d: bh.difficulty, p: bh.phase3Patterns, dm: bh.densityMul, sm: bh.speedMul }));

const bossSrc = (() => { try { return readFileSync(new URL('../src/entities/Boss.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
const gsSrc = (() => { try { return readFileSync(new URL('../src/scenes/GameScene.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
const gcSrc = (() => { try { return readFileSync(new URL('../src/config/GameConfig.js', import.meta.url), 'utf8'); } catch (e) { return 'ERR:' + e.message; } })();
push('E1. Boss.js constructor 追加 hardPhase 字段（默认 false）', /this\.hardPhase = !!config\.hardPhase;/.test(bossSrc), `len=${bossSrc.length}`);
push('E2. Boss.js firePattern 前置 hell 分支（hardPhase && phase>=3 && !_enraging → _fireHardPattern）', /if \(this\.hardPhase && this\.phase >= 3 && !this\._enraging\) \{[\s\S]*?this\._fireHardPattern\(\);/.test(bossSrc), `len=${bossSrc.length}`);
push('E3. Boss.js 含 _fireHardPattern 轮换 + _hardPatIdx（既有 pattern 零改动）', /_fireHardPattern\(\)/.test(bossSrc) && /_hardPatIdx/.test(bossSrc), `len=${bossSrc.length}`);
push('E4. GameScene.spawnBoss 传 hardPhase（difficultyCfg.id===BOSS_HARD.difficulty 派生）', /hardPhase/.test(gsSrc) && /BOSS_HARD\.difficulty/.test(gsSrc), `len=${gsSrc.length}`);
push('E5. GameConfig 含 BOSS_HARD 导出', /export const BOSS_HARD = \{/.test(gcSrc), `len=${gcSrc.length}`);
push('红线. Boss.js 0.66/0.33 阶段阈值未改', /ratio > 0\.66 \? 1 : ratio > 0\.33 \? 2 : 3/.test(bossSrc), `len=${bossSrc.length}`);
push('红线. Boss.js RAGE 狂暴触发判断未改（hp < maxHp × RAGE.hpThreshold）', /this\.hp < this\.maxHp \* RAGE\.hpThreshold/.test(bossSrc), `len=${bossSrc.length}`);
push('红线. GameConfig RAGE.hpThreshold 仍 0.15（hell 高难未吞狂暴）', /hpThreshold: 0\.15/.test(gcSrc), `len=${gcSrc.length}`);
push('P0. A 上下文无 pageerror/console.error', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
await A.ctx.close();

// ═══════════════ B：hell 档 E2E（spawnBoss 接线 + pattern 轮换 + 狂暴让位 + 视觉）═══
const cleanH = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 0, selectedDifficulty: 'hell' };
const H = await launchPage(cleanH);
await setDifficulty(H.page, 'hell');
await enterGame(H.page, 1);

const hellSpawn = await H.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const diffId = gs.difficultyCfg && gs.difficultyCfg.id;
  gs.spawnBoss('level_boss', { maxHp: 1000, pattern: 'fan', color: 0xff0000, difficulty: 1 });
  const b = gs.boss;
  const hard = !!(b && b.hardPhase);
  if (b) { gs.tweens.killTweensOf(b); b.destroy(); gs.boss = null; }
  return { diffId, hard };
});
push('C10.1. hell 档 GameScene difficultyCfg.id=hell', hellSpawn.diffId === 'hell', `diff=${hellSpawn.diffId}`);
push('C10.1. hell 档 spawnBoss → boss.hardPhase=true', hellSpawn.hard === true, `hard=${hellSpawn.hard}`);

await mkBoss(H.page, { hardPhase: true });
const bossState0 = await H.page.evaluate(() => {
  const b = window.__C10B__;
  b.phase = 3; // 直接置 phase3（血量档由阶段机管理，此处仅驱动弹幕/视觉分支）
  b._syncPhaseVisuals();
  return { hard: b.hardPhase, phase: b.phase };
});
push('C10.2. 测试 Boss hardPhase=true 就绪（phase3）', bossState0.hard === true && bossState0.phase === 3, JSON.stringify(bossState0));

const f1 = await fireCount(H.page);
const f2 = await fireCount(H.page);
push('C10.2. phase3 首次 fire → 走 _fireHardPattern（_hardPatIdx 前进到 1）', f1.idx === 1 && f1.n > 0, `n=${f1.n} idx=${f1.idx}`);
push('C10.2. phase3 二次 fire → spiral/cross 完成一轮（idx 1→0 回绕，弹型不同）', f2.idx === 0 && f2.n > 0 && f2.n !== f1.n, `n=${f2.n} idx=${f2.idx}`);
push('C10.3. 轮换两类弹量不同（首轮 spiral > 次轮 cross，densityMul 生效可区分）', f1.n !== f2.n && f1.n > f2.n, `spiral≈${f1.n} cross≈${f2.n}`);

const rageGive = await H.page.evaluate(() => {
  const b = window.__C10B__;
  b._enraging = true;
  b._hardPatIdx = 5;
  const orig = b.spawnBullet.bind(b);
  let n = 0;
  b.spawnBullet = () => { n++; };
  b.firePattern();
  b.spawnBullet = orig;
  const idxAfter = b._hardPatIdx;
  b._enraging = false;
  return { n, idxAfter };
});
push('C10.4. 狂暴让位：_enraging=true 时 firePattern 不叠加高难（_hardPatIdx 不动）', rageGive.idxAfter === 5, `n=${rageGive.n} idx=${rageGive.idxAfter}`);

// 非 hell（hardPhase=false）对照：phase3 fire 走既有 pattern，_hardPatIdx 不动
const plain = await H.page.evaluate(() => {
  const b = window.__C10B__;
  b.hardPhase = false;
  b._hardPatIdx = 0;
  const orig = b.spawnBullet.bind(b);
  let n = 0;
  b.spawnBullet = () => { n++; };
  b.firePattern();
  b.spawnBullet = orig;
  return { n, idx: b._hardPatIdx };
});
push('C10.2. hardPhase=false 同场景 → 不进高难（_hardPatIdx 保持 0，既有 pattern 正常）', plain.idx === 0 && plain.n > 0, `n=${plain.n} idx=${plain.idx}`);

const visual = await H.page.evaluate(() => {
  const b = window.__C10B__;
  b.hardPhase = true; b.phase = 3; b._enraging = false;
  b._syncPhaseVisuals();
  const tintHell = b.tintTopLeft;
  b.hardPhase = false; b._enraging = false;
  b._syncPhaseVisuals();
  const tintNormal = b.tintTopLeft;
  b.hardPhase = true; b._enraging = true;
  b._syncPhaseVisuals();
  const tintEnrage = b.tintTopLeft;
  b._enraging = false; b.hardPhase = false;
  return { tintHell, tintNormal, tintEnrage };
});
push('C10.5. hell phase3 机身 tint ≠ 普通 phase3 tint（紫色终局形态）', visual.tintHell !== visual.tintNormal,
  `hell=0x${visual.tintHell.toString(16)} normal=0x${visual.tintNormal.toString(16)}`);
push('C10.4. 狂暴让位视觉：_enraging 后 tint 回落既有红（= 普通 phase3）', visual.tintEnrage === visual.tintNormal,
  `enrage=0x${visual.tintEnrage.toString(16)} normal=0x${visual.tintNormal.toString(16)}`);
push('P0. H hell 上下文无 pageerror/console.error', H.errors.length === 0, H.errors.slice(0, 3).join(' | '));
await H.ctx.close();

// ═══════════════ C：非 hell（standard）零回归 ═══
const cleanS = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 0, selectedDifficulty: 'standard' };
const S = await launchPage(cleanS);
await setDifficulty(S.page, 'standard');
await enterGame(S.page, 1);

const stdSpawn = await S.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const diffId = gs.difficultyCfg && gs.difficultyCfg.id;
  gs.spawnBoss('level_boss', { maxHp: 1000, pattern: 'fan', color: 0xff0000, difficulty: 1 });
  const b = gs.boss;
  const hard = !!(b && b.hardPhase);
  if (b) { gs.tweens.killTweensOf(b); b.destroy(); gs.boss = null; }
  return { diffId, hard };
});
push('C10.1/非hell. standard 档 spawnBoss → boss.hardPhase=false（非 hell 零出现）', stdSpawn.diffId === 'standard' && stdSpawn.hard === false, `diff=${stdSpawn.diffId} hard=${stdSpawn.hard}`);
push('P0. S standard 上下文无 pageerror/console.error', S.errors.length === 0, S.errors.slice(0, 3).join(' | '));
await S.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C10 Boss 高难终局探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
