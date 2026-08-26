// qa_powerup_endless.mjs —— P1 局内火力(P)拾取成长 + 无尽 Score Attack 验收探针
//
// 验证：
//   1) 静态配置：POWERUP(MAX_LEVEL=4 / DROP_CHANCE=0.15 / FIRE_RATE_GAIN=8)、
//      EVENTS.POWER_CHANGED、ITEMS.power(item_power / kind=power)
//   2) MenuScene 主菜单存在「无尽模式」入口
//   3) P 掉落生成：敌人死亡独立概率掉落（spawnItem power）
//   4) 拾取火力 +1（封顶 4）、射速提升、并列弹数量 +1/级
//   5) 受击火力 -1（下限 0）、无敌期不重复掉级
//   6) HUD 显示当前火力等级
//   7) 进入 endless：mode 标记 + WaveSystem.endless + 无限波次（永不进 Boss）
//   8) 难度递增：每 5 波 +10%
//   9) 命尽 endGame(false) -> ResultScene 展示无尽结算 + 最高分
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

/** 进入指定模式的一局（复用同一 page，重启场景） */
async function startGame(page, mode = 'normal') {
  await page.evaluate((mode) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
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

/** 递归收集某场景渲染出的全部 Text 文本 */
async function collectTexts(page, sceneKey) {
  return page.evaluate((key) => {
    const s = window.__SKY__.scene.getScene(key);
    const out = [];
    const walk = (list) => list.forEach((c) => {
      if (c && c.type === 'Text') out.push(c.text);
      if (c && c.list && c.list.length) walk(c.list);
    });
    walk(s.children.list);
    return out;
  }, sceneKey);
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

// ── 1) 静态配置断言 ──
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const it = await import('/src/config/Items.js');
  return {
    maxLevel: gc.POWERUP.MAX_LEVEL,
    dropChance: gc.POWERUP.DROP_CHANCE,
    fireRateGain: gc.POWERUP.FIRE_RATE_GAIN,
    powerEvent: gc.EVENTS.POWER_CHANGED,
    powerItem: it.ITEMS.power,
  };
});
push('POWERUP.MAX_LEVEL=4', cfg.maxLevel === 4, `got ${cfg.maxLevel}`);
push('POWERUP.DROP_CHANCE=0.15', cfg.dropChance === 0.15, `got ${cfg.dropChance}`);
push('POWERUP.FIRE_RATE_GAIN=8', cfg.fireRateGain === 8, `got ${cfg.fireRateGain}`);
push('EVENTS.POWER_CHANGED 已登记', !!cfg.powerEvent, cfg.powerEvent);
push('ITEMS.power 定义（tex=item_power / kind=power）',
  !!cfg.powerItem && cfg.powerItem.tex === 'item_power' && cfg.powerItem.kind === 'power',
  JSON.stringify(cfg.powerItem));

// ── 2) MenuScene 无尽模式入口 ──
const menuTexts = await collectTexts(page, 'MenuScene');
const msInfo = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return { hasEndlessFn: typeof ms.startEndless === 'function' };
});
push('MenuScene 存在「无尽模式」按钮', menuTexts.includes('无尽模式'));
push('MenuScene.startEndless() 已实现', msInfo.hasEndlessFn === true);

// ── 3) 局内火力(P)：并列弹 + 射速 ──
await startGame(page, 'normal');
const bullets = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  p.weapon = 'pulse';
  p.firepower = 0;
  p.setPowerLevel(0);
  const clear = () => gs.playerBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  clear();
  p.fire();
  const base = gs.playerBullets.countActive(true);
  clear();
  p.setPowerLevel(3);
  p.fire();
  const powered = gs.playerBullets.countActive(true);
  return { base, powered, interval: p.fireInterval };
});
push('P=0 时主炮 1 发', bullets.base === 1, `got ${bullets.base}`);
push('P=3 时主炮 4 发（+3 并列弹）', bullets.powered === 4, `got ${bullets.powered}`);
push('P 提升射速（fireInterval 140→116）', bullets.interval === 116, `got ${bullets.interval}`);

// ── 4) P 掉落生成 ──
const drop = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const orig = Math.random;
  Math.random = () => 0; // <= DROP_CHANCE(0.15)，强制掉落（maybeDropPower 用 Math.random()>CHANCE 提前 return）
  gs.maybeDropPower(270, 300);
  Math.random = orig;
  let found = null;
  gs.items.children.each((it) => { if (it.active && it.itemKey === 'power') found = it; });
  return found ? { itemKey: found.itemKey, tex: found.texture.key } : null;
});
push('P 掉落生成（itemKey=power / 贴图 item_power）',
  !!drop && drop.itemKey === 'power' && drop.tex === 'item_power', JSON.stringify(drop));

// ── 5) 拾取火力 +1 + 封顶 4 ──
const pickup = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.powerLevel = 0;
  gs.player.setPowerLevel(0);
  const before = gs.player.fireInterval;
  gs.spawnItem(270, 300, 'power');
  let item = null;
  gs.items.children.each((it) => { if (it.active && it.itemKey === 'power') item = it; });
  gs.collectItem(item);
  return { powerLevel: gs.powerLevel, playerPower: gs.player.powerLevel, before, after: gs.player.fireInterval };
});
push('拾取 P 火力 +1', pickup.powerLevel === 1 && pickup.playerPower === 1, `Lv=${pickup.powerLevel}`);
push('拾取后射速提升（140→132）', pickup.before === 140 && pickup.after === 132, `${pickup.before}→${pickup.after}`);

const cap = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  for (let i = 0; i < 10; i++) gs.addPower();
  return { powerLevel: gs.powerLevel, playerPower: gs.player.powerLevel };
});
push('火力封顶 4 级', cap.powerLevel === 4 && cap.playerPower === 4, `Lv=${cap.powerLevel}`);

// ── 6) 受击掉级（下限 0 / 无敌期不重复掉级）──
const lose = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.losePower();
  const a = gs.powerLevel;
  gs.losePower();
  const b = gs.powerLevel;
  return { a, b };
});
push('losePower 逐级 -1（4→3→2）', lose.a === 3 && lose.b === 2, `${lose.a} / ${lose.b}`);

const hitDrop = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.powerLevel = 2; gs.player.setPowerLevel(2);
  gs.player.invulnUntil = 0; gs.buffs.shieldUntil = 0;
  gs.playerHit(10);
  return gs.powerLevel;
});
push('受击 playerHit 掉 1 级（2→1）', hitDrop === 1, `Lv=${hitDrop}`);

const invulnNoDrop = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.powerLevel = 2; gs.player.setPowerLevel(2);
  gs.player.invulnUntil = gs.time.now + 5000; // 无敌期内
  gs.playerHit(10);
  return gs.powerLevel;
});
push('无敌期内受击不掉级（保持 2）', invulnNoDrop === 2, `Lv=${invulnNoDrop}`);

// ── 7) HUD 火力等级显示 ──
const hud = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  gs.powerLevel = 0; gs.player.setPowerLevel(0);
  gs.addPower(); // → Lv1，触发 POWER_CHANGED → HUD 更新
  return { powerLevel: gs.powerLevel, hud: ui.powerText ? ui.powerText.text : null };
});
push('HUD 显示火力 Lv1', hud.powerLevel === 1 && hud.hud === '火力 Lv1', hud.hud);

// ── 8) 无尽模式：标记 + 无限波次 + 难度递增 ──
await startGame(page, 'endless');
const endless = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  return { mode: gs.mode, endless: ws ? ws.endless : null, hasBoss: !!gs.boss };
});
push('endless：mode 标记正确', endless.mode === 'endless', endless.mode);
push('endless：WaveSystem.endless=true', endless.endless === true);
push('endless：开局无 Boss', endless.hasBoss === false);

const infinite = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  for (let i = 0; i < 12; i++) ws.startNextWave();
  return { wave: ws.currentWave, state: ws.state, bossSpawned: ws.bossSpawned };
});
push('无尽模式波次无限（推进 12 波仍 spawning）',
  infinite.wave >= 12 && infinite.state === 'spawning' && infinite.bossSpawned === false,
  `wave=${infinite.wave} state=${infinite.state}`);

const diff = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ws = gs.waves;
  const base = gs.level.difficulty;
  ws.currentWave = 1;  const d1 = ws.getDifficulty();
  ws.currentWave = 6;  const d6 = ws.getDifficulty();
  ws.currentWave = 11; const d11 = ws.getDifficulty();
  return { base, d1, d6, d11 };
});
push('无尽难度：第 1 波 = 基础难度', Math.abs(diff.d1 - diff.base) < 1e-9, `d1=${diff.d1}`);
push('无尽难度：每 5 波 +10%（第 6 波 = ×1.1）', Math.abs(diff.d6 - diff.base * 1.1) < 1e-9, `d6=${diff.d6}`);
push('无尽难度：第 11 波 = ×1.2', Math.abs(diff.d11 - diff.base * 1.2) < 1e-9, `d11=${diff.d11}`);

// ── 9) 命尽结束 → ResultScene 无尽结算 + 最高分 ──
// 注：P2 激励广告位预留后，无尽命尽默认会弹「看广告复活」面板（Ads.hasAds()=true）。
// 本段测经典"命尽直接结算"流，故开 noAds=true（纯净版语义 = 不弹广告位），保持既有断言不变。
await page.evaluate(() => {
  window.__SAVE.set('bestScore', 0);
  window.__SAVE.set('noAds', true);
});
await startGame(page, 'endless');
const ended = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  gs.lives = 1;
  p.invulnUntil = 0;
  p.shield = 0;
  p.takeDamage(99999);
  return { lives: gs.lives, gameEnded: gs.gameEnded };
});
push('命尽才结束（lives=0 且 gameEnded=true）',
  ended.lives === 0 && ended.gameEnded === true, `lives=${ended.lives}`);

await page.waitForFunction(() => {
  const rs = window.__SKY__.scene.getScene('ResultScene');
  return rs && rs.scene.isActive();
}, { timeout: 20000 });
const rs = await page.evaluate(() => {
  const r = window.__SKY__.scene.getScene('ResultScene');
  const texts = [];
  const walk = (list) => list.forEach((c) => {
    if (c && c.type === 'Text') texts.push(c.text);
    if (c && c.list && c.list.length) walk(c.list);
  });
  walk(r.children.list);
  return {
    mode: r.result.mode,
    victory: r.result.victory,
    hasEndlessTitle: texts.some((t) => t.includes('无尽挑战结束')),
    hasWaveLine: texts.some((t) => t.includes('波次')),
    hasBestLine: texts.some((t) => t.includes('最高分')),
  };
});
push('无尽结算：result.mode=endless', rs.mode === 'endless', rs.mode);
push('无尽结算：victory=false', rs.victory === false);
push('无尽结算：标题「无尽挑战结束」', rs.hasEndlessTitle === true);
push('无尽结算：显示波次', rs.hasWaveLine === true);
push('无尽结算：显示最高分（复用 bestScore）', rs.hasBestLine === true);

// ── 10) 零 pageerror / console error ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_powerup_endless: PASS ===' : '=== qa_powerup_endless: FAIL ==='));
process.exit(pass ? 0 : 1);
