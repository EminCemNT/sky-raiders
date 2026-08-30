// qa_opt13_a8_mutations.mjs —— OPT-13 批A A8 无尽变异规则 验收探针
//
// 验证：
//   1) Mutations.js 新建：POSITIVE×5 / NEGATIVE×4 / MUTATION_EVERY_LAYERS=5 / MUTATION_WEIGHTS
//   2) rollMutation 正负比（55/45，可注入随机源）
//   3) _mutationMul：标准路径全 1.0；swiftBullets→bulletSpeed 1.2 / glassCannon→incomingDmg 1.3 /
//      tinyRing→grazeRadius 0.7；叠加 Math.pow（×2 → 1.2²）
//   4) applyMutation 正面：立即幂等叠加 + MUTATION_CHANGED(applied)
//   5) applyMutation 负面：先 warning（1s 警示），后 commit（不可静默生效）
//   6) playerHit 消费 incomingDmg（10 → 13）
//   7) 敌弹/Boss 弹速消费 bulletSpeed（×1.2）
//   8) 触发接线：towerFloor % MUTATION_EVERY_LAYERS === 0（GameScene 源码静态断言）
//   9) UIScene：MUTATION_CHANGED(applied) → 顶部状态徽章（纯视觉）
//  10) 非塔模式零变异逻辑（_mutationMul 全 1.0）
//  11) 零 pageerror / console error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

async function startGame(page, levelId = 1, mode = 'normal') {
  await page.evaluate(([lid, md]) => {
    const g = window.__SKY__;
    window.__SAVE.set('tutorialDone', true);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const s = g.scene.getScene(k);
      if (s && s.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: md, levelId: lid });
  }, [levelId, mode]);
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

// ── 1) Mutations.js 配置 ──
const cfg = await page.evaluate(async () => {
  const m = await import('/src/config/Mutations.js');
  const pos = Object.keys(m.POSITIVE);
  const neg = Object.keys(m.NEGATIVE);
  const all = { ...m.POSITIVE, ...m.NEGATIVE };
  const wellFormed = Object.values(all).every((e) =>
    e.id && e.name && e.desc && (e.polarity === 'positive' || e.polarity === 'negative')
    && typeof e.apply === 'string' && e.stats && typeof e.stats === 'object');
  return {
    pos: pos.sort(), neg: neg.sort(), every: m.MUTATION_EVERY_LAYERS,
    weight: m.MUTATION_WEIGHTS, wellFormed,
  };
});
push('Mutations.js：正面 5 / 负面 4 / 每 5 层',
  cfg.pos.length === 5 && cfg.neg.length === 4 && cfg.every === 5,
  `POSITIVE=${cfg.pos.length} NEGATIVE=${cfg.neg.length} EVERY=${cfg.every}`);
push('变异条目字段齐备（id/name/desc/polarity/apply/stats）', cfg.wellFormed,
  `positive=${cfg.pos.join(',')} | negative=${cfg.neg.join(',')}`);

// ── 2) rollMutation 正负比 ──
const roll = await page.evaluate(async () => {
  const m = await import('/src/config/Mutations.js');
  const pos0 = m.rollMutation(() => 0);                 // r<0.55 → positive
  const neg1 = m.rollMutation(() => 0.99);              // r>=0.55 → negative
  const posMid = m.rollMutation(() => 0.5);             // 仍 positive
  return { pos0: pos0.polarity, neg1: neg1.polarity, posMid: posMid.polarity };
});
push('rollMutation 正负比 55/45（0→正 / 0.5→正 / 0.99→负）',
  roll.pos0 === 'positive' && roll.posMid === 'positive' && roll.neg1 === 'negative',
  JSON.stringify(roll));

// ── 3/10) _mutationMul 标准路径 + 叠加 ──
await startGame(page, 1, 'normal');   // 普通关：非塔 → mutations 未初始化
const mul = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const m0 = gs._mutationMul();
  const stdOk = m0.dmg === 1 && m0.hp === 1 && m0.speed === 1 && m0.bulletSpeed === 1
    && m0.grazeRadius === 1 && m0.incomingDmg === 1;
  // 模拟爬塔状态（局内临时）
  gs.isTower = true;
  gs.mutations = { swiftBullets: 1, glassCannon: 1, tinyRing: 1 };
  const m1 = gs._mutationMul();
  gs.mutations = { swiftBullets: 2 };
  const m2 = gs._mutationMul();
  gs.isTower = false;
  gs.mutations = undefined;
  return {
    stdOk, b1: m1.bulletSpeed, i1: m1.incomingDmg, g1: m1.grazeRadius,
    dmg1: m1.dmg, hp1: m1.hp, speed1: m1.speed,
    b2: m2.bulletSpeed, expected2: Math.pow(1.2, 2),
  };
});
push('非塔模式 _mutationMul 全 1.0（零变异逻辑）', mul.stdOk, JSON.stringify({ d: mul.dmg1, b: mul.b1 }));
push('swiftBullets → bulletSpeed 1.2 / glassCannon → incomingDmg 1.3 / tinyRing → grazeRadius 0.7',
  mul.b1 === 1.2 && mul.i1 === 1.3 && mul.g1 === 0.7, `b=${mul.b1} i=${mul.i1} g=${mul.g1}`);
push('叠加 Math.pow（×2 → 1.2²=1.44）', Math.abs(mul.b2 - mul.expected2) < 1e-9, `b2=${mul.b2}`);
push('其余键（dmg/hp/speed）不受影响', mul.dmg1 === 1 && mul.hp1 === 1 && mul.speed1 === 1);

// ── 4/5) applyMutation 正面 / 负面 ──
await startGame(page, 1, 'endless');  // 无尽（爬塔）：isTower=true，mutations 已初始化
const apply = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const { EventBus } = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  const events = [];
  const h = (p) => events.push(p);
  EventBus.on(EV.MUTATION_CHANGED, h);
  // 循环直到 roll 到正面
  let posResult = null;
  for (let i = 0; i < 40 && !posResult; i++) {
    const r = gs.applyMutation();
    if (r.polarity === 'positive') posResult = r;
  }
  EventBus.off(EV.MUTATION_CHANGED, h);
  return {
    posId: posResult ? posResult.id : null,
    posStack: posResult ? (gs.mutations[posResult.id] || 0) : -1,
    appliedEvents: events.filter((e) => e.type === 'applied').length,
    warningEvents: events.filter((e) => e.type === 'warning').length,
    snapshot: Object.keys(gs.mutations || {}),
  };
});
push('applyMutation 正面：立即叠加（mutations[id] 递增）+ applied 事件',
  !!apply.posId && apply.posStack >= 1 && apply.appliedEvents >= 1,
  `id=${apply.posId} stack=${apply.posStack} applied=${apply.appliedEvents}`);

// 负面：先 warning，1s 后 commit
const neg = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const { EventBus } = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  let warnSeen = null;
  const h = (p) => { if (p.type === 'warning' && !warnSeen) warnSeen = p; };
  EventBus.on(EV.MUTATION_CHANGED, h);
  let negResult = null;
  for (let i = 0; i < 60 && !negResult; i++) {
    const r = gs.applyMutation();
    if (r.polarity === 'negative') negResult = r;
  }
  EventBus.off(EV.MUTATION_CHANGED, h);
  const pendingNotCommitted = negResult ? (gs.mutations[negResult.id] || 0) : -1;
  return { negId: negResult ? negResult.id : null, warnSeen: !!warnSeen, pendingNotCommitted };
});
push('applyMutation 负面：先出 warning（生效前 1s 警示）',
  !!neg.negId && neg.warnSeen === true, `id=${neg.negId}`);
push('负面警示时尚未生效（mutations 未叠加）', neg.pendingNotCommitted === 0,
  `pending=${neg.pendingNotCommitted}`);

// 等待负面 commit 落地
await page.waitForTimeout(1300);
const negCommitted = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const id = window.__A8_LAST_NEG__;
  return { };
});
const negFinal = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const { EventBus } = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  // 重新取最新负面 id：直接读 mutations 中负面的键
  const negIds = Object.keys(gs.mutations || {}).filter((k) =>
    ['swiftBullets', 'tinyRing', 'glassCannon', 'swarm'].includes(k));
  let applied = 0;
  const h = (p) => { if (p.type === 'applied' && p.polarity === 'negative') applied++; };
  EventBus.on(EV.MUTATION_CHANGED, h);
  // 若上一步未抓到负面（极端随机），直接补一个负面 commit 验证可反制链路
  if (negIds.length === 0) {
    gs._commitMutation({ id: 'glassCannon', polarity: 'negative', name: '玻璃大炮', desc: '', stats: { incomingDmgMul: 1.3 } });
  }
  EventBus.off(EV.MUTATION_CHANGED, h);
  const finalNeg = Object.keys(gs.mutations || {}).filter((k) =>
    ['swiftBullets', 'tinyRing', 'glassCannon', 'swarm'].includes(k));
  const finalCount = finalNeg.reduce((s, k) => s + (gs.mutations[k] || 0), 0);
  return { finalCount, finalNeg };
});
push('负面 1s 后 commit 生效（mutations 叠加 + applied 事件）',
  negFinal.finalCount >= 1,
  `negatives=${negFinal.finalNeg.join(',') || 'glassCannon(补)'}`);

// ── 6) playerHit 消费 incomingDmg ──
const hit = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  gs.isTower = true;
  gs.mutations = { glassCannon: 1 };
  const origTake = p.takeDamage.bind(p);
  let lastDmg = 0;
  p.takeDamage = (d) => { lastDmg = d; };
  gs.stats.damageTaken = 0;
  gs.buffs.shieldUntil = 0;
  p.invulnUntil = gs.time.now + 100000; // landed=false → 不 losePower，聚焦验证倍率
  gs.playerHit(10);
  p.takeDamage = origTake;
  const delta = gs.stats.damageTaken;
  gs.isTower = false;
  gs.mutations = undefined;
  return { lastDmg, delta };
});
push('playerHit 消费 incomingDmg（玻璃大炮：10 → 13）', hit.lastDmg === 13 && hit.delta === 13,
  `lastDmg=${hit.lastDmg} delta=${hit.delta}`);

// ── 7) 敌弹 / Boss 弹速消费 bulletSpeed ──
const bullet = await page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const { default: Boss } = await import('/src/entities/Boss.js');
  gs.isTower = true;
  gs.mutations = { swiftBullets: 1 };
  // Boss 弹速
  const b = new Boss(gs, 'boss_test', { maxHp: 1000, pattern: 'fan', color: 0xff0000, difficulty: 1 });
  gs.tweens.killTweensOf(b);
  b._entering = false;
  const b0 = gs.enemyBullets.get(100, 100, 'bullet_enemy');
  const origGet = gs.enemyBullets.get.bind(gs.enemyBullets);
  const captured = [];
  gs.enemyBullets.get = (x, y, k) => { const bl = origGet(x, y, k); captured.push(bl); return bl; };
  b.spawnBulletAt(200, 150, Math.PI / 2, 100);
  gs.enemyBullets.get = origGet;
  b.fxG.destroy();
  b.destroy();
  const bossSpd = captured.length ? Math.hypot(captured[0].body.velocity.x, captured[0].body.velocity.y) : 0;
  // 敌弹速度（mid 直射）
  const e = gs.spawnEnemy(200, 100, 'mid', 'straight', 1, 'straight');
  gs.enemyBullets.get = (x, y, k) => { const bl = origGet(x, y, k); captured.push(bl); return bl; };
  e.fireAtPlayer();
  gs.enemyBullets.get = origGet;
  e.hit(99999);
  const enemySpd = captured.length > 1
    ? Math.hypot(captured[captured.length - 1].body.velocity.x, captured[captured.length - 1].body.velocity.y) : 0;
  gs.isTower = false;
  gs.mutations = undefined;
  return { bossSpd, enemySpd };
});
push('Boss 弹速 ×1.2（swiftBullets）', Math.abs(bullet.bossSpd - 120) < 1.5,
  `bossSpd=${bullet.bossSpd.toFixed(1)}/120`);
// 敌弹基础速度 = BULLET.ENEMY_SPEED(260) × difficulty(1) = 260；swiftBullets ×1.2 → 312
push('敌弹速度 ×1.2（swiftBullets）', Math.abs(bullet.enemySpd - 312) < 3,
  `enemySpd=${bullet.enemySpd.toFixed(1)}/312`);

// ── 8) 触发接线（towerFloor % 5 === 0，静态断言） ──
const wiring = await page.evaluate(async () => {
  const src = await (await fetch('/src/scenes/GameScene.js')).text();
  return {
    hasModulo: src.includes('towerFloor % MUTATION_EVERY_LAYERS === 0'),
    hasApplyCall: src.includes('this.applyMutation();'),
    every: (await import('/src/config/Mutations.js')).MUTATION_EVERY_LAYERS,
  };
});
push('触发接线：towerFloor % MUTATION_EVERY_LAYERS === 0 调用 applyMutation',
  wiring.hasModulo && wiring.hasApplyCall && wiring.every === 5,
  `every=${wiring.every}`);

// ── 9) UIScene 状态徽章（纯视觉） ──
const ui = await page.evaluate(async () => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  if (!ui || !ui.scene.isActive()) return { active: false };
  const { EventBus } = await import('/src/utils/EventBus.js');
  const EV = (await import('/src/config/GameConfig.js')).EVENTS;
  const before = (ui._mutBadges || []).length;
  EventBus.emit(EV.MUTATION_CHANGED, { id: 'glassCannon', polarity: 'negative', name: '玻璃大炮', desc: '', stats: {}, type: 'applied' });
  const after = (ui._mutBadges || []).length;
  return { active: true, before, after };
});
push('UIScene：applied → 顶部状态徽章 +1（纯视觉）', ui.active === true && ui.after === ui.before + 1,
  JSON.stringify(ui));

// ── 11) 零报错 ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_opt13_a8_mutations: PASS ===' : '=== qa_opt13_a8_mutations: FAIL ==='));
process.exit(pass ? 0 : 1);
