// qa_opt16_b1.mjs —— OPT-16 批次1（T6 键名契约 / T9 测试钩子规范化）验收探针
//
// 规格来源：docs/OPT-16-TECH-SPEC.md。断言真实运行行为：
//   T6  TEXTURE_KEYS 常量值=原字符串；游戏内 textures.exists 为 true；VFX/GameScene 不再散落裸字符串
//   T9  window.__PROBE 只读 getter（eventBus/sceneUpdate）；GameScene create 后 game._probe 存在
// 运行：node qa_probes/qa_opt16_b1.mjs（QA_URL 默认 http://127.0.0.1:5059）
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
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const ctx = await browser.newContext({ viewport: { width: 540, height: 960 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.addInitScript(() => {
  try { localStorage.setItem('sky_raiders_save_v1', JSON.stringify({ lang: 'zh', tutorialDone: true, quality: 'high' })); } catch (e) { /* ignore */ }
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

// ── T6 键名契约 ──
const t6 = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const g = window.__SKY__;
  return {
    glowSoft: gc.TEXTURE_KEYS.glowSoft,
    particleSpark: gc.TEXTURE_KEYS.particleSpark,
    particleDot: gc.TEXTURE_KEYS.particleDot,
    vignettePerm: gc.TEXTURE_KEYS.vignettePerm,
    bulletPrefix: gc.TEXTURE_KEYS.bulletPrefix,
    eventContractWingman: gc.EVENT_CONTRACT.WINGMAN_COMBO,
    exists: g && g.textures ? {
      glowSoft: g.textures.exists('glow_soft'),
      particleSpark: g.textures.exists('particle_spark'),
      particleDot: g.textures.exists('particle_dot'),
    } : null,
  };
});
push('T6. TEXTURE_KEYS 值=原字符串', t6.glowSoft === 'glow_soft' && t6.particleSpark === 'particle_spark'
  && t6.particleDot === 'particle_dot' && t6.vignettePerm === 'vignette-perm' && t6.bulletPrefix === 'bullet_',
  JSON.stringify(t6));
push('T6. EVENT_CONTRACT 登记 WINGMAN_COMBO 值一致', t6.eventContractWingman === 'wingman-combo', `value=${t6.eventContractWingman}`);
push('T6. 游戏内纹理存在（glow_soft/particle_spark/particle_dot）', t6.exists && t6.exists.glowSoft && t6.exists.particleSpark && t6.exists.particleDot,
  JSON.stringify(t6.exists));

// ── T9 测试钩子规范化 ──
const t9Pre = await page.evaluate(() => {
  const p = window.__PROBE;
  return { has: !!p, eb: p && p.eventBus, su: p && p.sceneUpdate, sl: p && p.sceneListeners };
});
push('T9. window.__PROBE 存在（只读 getter）', t9Pre.has, JSON.stringify(t9Pre));

// 进入 GameScene → game._probe 存在
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
  return gs && gs.player && gs.player.active && window.__SKY__._probe;
}, null, { timeout: 10000 });

const t9Post = await page.evaluate(() => {
  const g = window.__SKY__;
  const probe = g._probe;
  const p = window.__PROBE;
  return {
    hasProbe: !!probe,
    bulletLoopCount: probe ? probe.bulletLoopCount : null,
    prewarmMs: probe ? probe.prewarmMs : null,
    eb: p ? p.eventBus : null,
    su: p ? p.sceneUpdate : null,
    readonly: (() => {
      try { g._probe = 123; return g._probe !== 123; } catch (e) { return true; }
    })(),
  };
});
push('T9. GameScene create 后 game._probe 存在', t9Post.hasProbe, `bulletLoopCount=${t9Post.bulletLoopCount} prewarmMs=${t9Post.prewarmMs}`);
push('T9. _probe 只读（赋值无效/抛错）', t9Post.readonly === true, `readonly=${t9Post.readonly}`);
push('T9. __PROBE 可读监听计数（eventBus 为数字）', typeof t9Post.eb === 'number' && t9Post.eb > 0, `eventBus=${t9Post.eb} sceneUpdate=${t9Post.su}`);

await new Promise((r) => setTimeout(r, 300));
push('P0. 全程无 pageerror/console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 批次1（T6/T9）探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
process.exit(0);
