// qa_opt13_a4_pool.mjs —— OPT-13 批A A4 对象池纪律加固 验收探针
//
// 验证：
//   1) POOL 配置：enemyBullets=400 / playerBeams=64
//   2) enemyBullets 池预填 400 且全部 inactive（首帧冷启动无逐发创建）
//   3) playerBeams 组带 maxSize=64（防无界增长）
//   4) killBullet 池复用复位契约：eHoming/homing/isBomb/element/damage/pierce/_lastHit/
//      _wmTinted/byWingman/rotation/scale 全部复位（真实回收行为）
//   5) Enemy.recycle 复位 _elem + clearTint + hasFrontShield（真实回收行为）
//   6) 池满 group.get() 返回 null 且各 spawn 调用不抛错（null 判空真实路径）
//   7) 源码级：Boss/Enemy/GameScene 关键 get() 调用点均判空
//   8) 零 pageerror / console error
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

async function startGame(page) {
  await page.evaluate(() => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  });
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
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

// ── 1) POOL 配置 ──
const poolCfg = await page.evaluate(async () => {
  const m = await import('/src/config/GameConfig.js');
  return { enemyBullets: m.POOL.enemyBullets, playerBeams: m.POOL.playerBeams };
});
push('POOL.enemyBullets=400', poolCfg.enemyBullets === 400, `got ${poolCfg.enemyBullets}`);
push('POOL.playerBeams=64', poolCfg.playerBeams === 64, `got ${poolCfg.playerBeams}`);

// ── 2/3) 池创建与预填 ──
await startGame(page);
const pool = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  let inactiveCount = 0;
  gs.enemyBullets.children.each((c) => { if (!c.active) inactiveCount++; });
  return {
    enemyCount: gs.enemyBullets.children.size,
    enemyInactive: inactiveCount,
    enemyMax: gs.enemyBullets.maxSize,
    beamMax: gs.playerBeams.maxSize,
  };
});
push('enemyBullets 预填 400', pool.enemyCount === 400, `count=${pool.enemyCount}`);
push('enemyBullets 全部 inactive（预填不参与战斗）', pool.enemyInactive === 400, `inactive=${pool.enemyInactive}`);
push('enemyBullets.maxSize=400', pool.enemyMax === 400, `max=${pool.enemyMax}`);
push('playerBeams.maxSize=64', pool.beamMax === 64, `max=${pool.beamMax}`);

// ── 4) killBullet 池复用复位契约（真实回收行为）──
const kb = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const b = gs.enemyBullets.get(100, 100, 'bullet_enemy');
  if (!b) return { found: false };
  // 模拟复用残留：把各自定义字段全部打脏
  b.eHoming = true;
  b.homing = true;
  b.isBomb = true;
  b.element = 'fire';
  b.damage = 99;
  b.pierce = 5;
  b._lastHit = { typeKey: 'x' };
  b._wmTinted = true;
  b.byWingman = true;
  b.setRotation(1.2);
  b.setScale(2, 3);
  b.setTint(0xff0000);
  gs.killBullet(b);
  return {
    found: true,
    eHoming: !!b.eHoming,
    homing: !!b.homing,
    isBomb: !!b.isBomb,
    element: b.element,
    damage: b.damage,
    pierce: b.pierce,
    lastHit: b._lastHit,
    wmTinted: !!b._wmTinted,
    byWingman: !!b.byWingman,
    rotation: b.rotation,
    scaleX: b.scaleX, scaleY: b.scaleY,
    // Phaser 3.90 Tint 组件用 tintTopLeft/tintBottomLeft/isTinted（无 tintTop 属性）
    tintTopLeft: b.tintTopLeft, tintBottomLeft: b.tintBottomLeft, isTinted: b.isTinted,
    active: b.active,
  };
});
push('killBullet 复位 eHoming/homing/isBomb', kb.found && kb.eHoming === false && kb.homing === false && kb.isBomb === false);
push('killBullet 复位 element/damage/pierce/_lastHit', kb.found && kb.element === null && kb.damage === 0 && kb.pierce === 0 && kb.lastHit === null);
push('killBullet 复位 _wmTinted/byWingman', kb.found && kb.wmTinted === false && kb.byWingman === false);
push('killBullet 复位 rotation/scale/tint', kb.found && kb.rotation === 0 && kb.scaleX === 1 && kb.scaleY === 1 && kb.tintTopLeft === 0xffffff && kb.isTinted === false);
push('killBullet 后子弹 inactive 入池', kb.found && kb.active === false);

// ── 5) Enemy.recycle 复位契约（真实回收行为）──
const er = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const e = gs.spawnEnemy(200, 100, 'small', 'straight', 1, 'straight');
  e._elem = 'fire';
  e.setTint(0xff7a3a);
  e.hasFrontShield = true;
  e.setScale(2, 2);
  e.angle = 45;
  e.recycle();
  return {
    elem: e._elem,
    tintTopLeft: e.tintTopLeft, isTinted: e.isTinted,
    shield: e.hasFrontShield,
    scaleX: e.scaleX,
    angle: e.angle,
    active: e.active,
  };
});
push('Enemy.recycle 复位 _elem + clearTint', er.elem === null && er.tintTopLeft === 0xffffff && er.isTinted === false);
push('Enemy.recycle 复位 hasFrontShield/scale/angle', er.shield === false && er.scaleX === 1 && er.angle === 0);
push('Enemy.recycle 后敌人 inactive', er.active === false);

// ── 6) 池满 get() 返回 null 且 spawn 不抛错（null 判空真实路径）──
const full = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  // 将敌弹池全部置 active → get() 必然返回 null
  gs.enemyBullets.children.each((c) => c.setActive(true));
  let getResult = 'not-null';
  try {
    const r = gs.enemyBullets.get(1, 1, 'bullet_enemy');
    if (r === null) getResult = 'null';
  } catch (e) { getResult = 'threw:' + e.message; }
  let bossSpawn = 'no-throw';
  const BossMod = null; // 不建 Boss，直接调 GameScene 的敌弹池 null 判空路径
  // Boss.spawnBulletAt 走 enemyBullets.get + if(!b) return —— 用既有 enemy fire 验证
  const e2 = gs.spawnEnemy(200, 100, 'small', 'straight', 1, 'spread');
  try { e2.fireAtPlayer(); } catch (e) { bossSpawn = 'threw:' + e.message; }
  // 恢复池为全 inactive
  gs.enemyBullets.children.each((c) => c.setActive(false));
  return { getResult, bossSpawn };
});
push('池满 group.get() 返回 null（不抛错）', full.getResult === 'null', full.getResult);
push('池满时敌机开火不抛错（判空兜底）', full.bossSpawn === 'no-throw', full.bossSpawn);

// ── 7) 源码级：关键 get() 调用点均判空 ──
const src = await page.evaluate(async () => {
  const boss = await (await fetch('/src/entities/Boss.js')).text();
  const enemy = await (await fetch('/src/entities/Enemy.js')).text();
  const gs = await (await fetch('/src/scenes/GameScene.js')).text();
  const player = await (await fetch('/src/entities/Player.js')).text();
  const hasGuard = (s, name) => {
    // 扫描所有出现点（同一函数名既有调用点又有定义），任一出现点后 400 字符内有判空即通过；
    // 避免 indexOf 只命中首个调用点（如 Player._emitBullet 的调用点早于定义）而误判。
    let i = s.indexOf(name);
    while (i >= 0) {
      const seg = s.slice(i, i + 400);
      if (seg.includes('if (!b) return') || seg.includes('if (!c) return') || seg.includes('if (!e) return') || seg.includes('if (!it) return')) return true;
      i = s.indexOf(name, i + name.length);
    }
    return false;
  };
  // Player._emitBullet 判空契约：`const b = this.bullets.get(...)` 后紧跟 `if (!b) return`。
  // 用 400 字符窗口从函数名出发覆盖不到（聚焦/伤害/贴图逻辑在前），改为直接锚定 get() 调用点。
  const playerGuard = (s) => {
    let i = s.indexOf('this.bullets.get(');
    while (i >= 0) {
      const seg = s.slice(i, i + 200);
      if (seg.includes('if (!b) return')) return true;
      i = s.indexOf('this.bullets.get(', i + 1);
    }
    return false;
  };
  return {
    boss: hasGuard(boss, 'spawnBulletAt('),
    enemy: hasGuard(enemy, 'const b = scene.enemyBullets.get'),
    gsCoin: hasGuard(gs, 'spawnCoin('),
    gsItem: hasGuard(gs, 'spawnItem('),
    gsWm: hasGuard(gs, 'spawnWingmanBullet('),
    player: playerGuard(player),
  };
});
push('Boss.spawnBulletAt 判空', src.boss === true);
push('Enemy 敌弹 spawn 判空', src.enemy === true);
push('GameScene.spawnCoin/spawnItem 判空', src.gsCoin === true && src.gsItem === true);
push('GameScene.spawnWingmanBullet 判空', src.gsWm === true);
push('Player._emitBullet 判空', src.player === true);

push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a4_pool: PASS ===' : '=== qa_opt13_a4_pool: FAIL ==='));
process.exit(pass ? 0 : 1);
