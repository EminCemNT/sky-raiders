// qa_opt16_b3.mjs —— OPT-16 批次3（T10 池预填收口 / T3 敌弹遍历合并 / T11 分配审计 / T4 glowTarget 合帧）验收探针
//
// 规格来源：docs/OPT-16-TECH-SPEC.md。断言真实运行行为：
//   T10  prewarmMs 只读存在；vfxPool/residuePool/_bulletGlowPool 由 _prewarm 创建；high 全量预填 / low 按 0.45 降量
//   T3   _updateEnemyBullets 单次遍历（bulletLoopCount ≈ 1/帧）；擦弹判定内联仍生效；敌弹越界回收仍生效
//   T11  checkBossHits 改手算 AABB 后 Boss 命中功能等价；敌/玩弹池容量不超上限；转向/磁力审计函数可调用
//   T4   追加多个 glowTarget 不增加场景 'update' 监听（合帧生效）；idleAura stop 计数归零；sprite 销毁 glow 清理；
//        场景往返 10 次 GameScene/EventBus 监听不增长
// 运行：node qa_probes/qa_opt16_b3.mjs（QA_URL 默认 http://127.0.0.1:5059）
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

async function enterBattle(page) {
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
    return gs && gs.player && gs.player.active;
  }, null, { timeout: 10000 });
}

// 主上下文：high 档
const mainSave = { lang: 'zh', tutorialDone: true, quality: 'high', coins: 100,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 } };
const mCtx = await launchPage(mainSave);
await enterBattle(mCtx.page);

// ─────────────────────────────────────────────
// T10 —— 池预填收口 + prewarmMs（high 档）
// ─────────────────────────────────────────────
const t10 = await mCtx.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const gc = await import('/src/config/GameConfig.js');
  return {
    prewarmMs: window.__GAME._probe.prewarmMs,
    hasVfxPool: !!gs.vfxPool,
    hasResiduePool: !!gs.residuePool,
    glowPoolLen: gs._bulletGlowPool ? gs._bulletGlowPool.length : -1,
    enemyCount: gs.enemyBullets.children.size,
    poolCfg: gc.POOL.enemyBullets,
  };
});
push('T10. __GAME._probe.prewarmMs 存在且为数字', typeof t10.prewarmMs === 'number' && t10.prewarmMs >= 0, `prewarmMs=${t10.prewarmMs}`);
push('T10. high 档敌弹池全量预填（== POOL.enemyBullets）', t10.enemyCount === t10.poolCfg && t10.poolCfg === 400, `count=${t10.enemyCount} cfg=${t10.poolCfg}`);
push('T10. vfxPool/residuePool/_bulletGlowPool 由 _prewarm 创建', t10.hasVfxPool && t10.hasResiduePool && t10.glowPoolLen === 10, `vfx=${t10.hasVfxPool} res=${t10.hasResiduePool} glow=${t10.glowPoolLen}`);

// ─────────────────────────────────────────────
// T3 —— 敌弹遍历合并（单次遍历 + 回收/擦弹内联生效）
// ─────────────────────────────────────────────
const t3 = await mCtx.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const gc = await import('/src/config/GameConfig.js');
  const GRAZE = gc.GRAZE;
  // 帧度量：等 game.loop.frame 前进 n 帧（规避 headless 低帧率下墙钟 setInterval 度量失真）
  const waitGameFrames = (n) => new Promise((res) => {
    const target = window.__GAME.loop.frame + n;
    const iv = setInterval(() => {
      if (window.__GAME.loop.frame >= target || !gs || !gs.scene || !gs.scene.isActive()) { clearInterval(iv); res(); }
    }, 16);
  });
  // 造 5 颗活跃敌弹（保证遍历进行），采样窗口用游戏帧数
  for (let i = 0; i < 5; i++) {
    const b = gs.enemyBullets.get(80 + i * 90, 180, 'bullet_enemy');
    if (!b) continue;
    b.setActive(true).setVisible(true);
    b.body.enable = true;
    b.setVelocity(0, 100);
  }
  const g0 = window.__GAME.loop.frame;
  const p0 = window.__GAME._probe.bulletLoopCount;
  await waitGameFrames(30);
  const g1 = window.__GAME.loop.frame;
  const p1 = window.__GAME._probe.bulletLoopCount;
  const frameDelta = g1 - g0;
  const loopDelta = p1 - p0;

  // 擦弹内联：直接调用 _updateEnemyBullets 并预对齐 _grazeTick（下一次调用即 graze 帧），
  // 规避低帧率下真实弹体在判定环内停留帧数不足的时序问题（纯功能等价验证）
  const player = gs.player;
  const grazeBefore = gs.grazeCount;
  gs._grazeTick = GRAZE.CHECK_EVERY - 1;
  const gb = gs.enemyBullets.get(player.x, player.y + 15, 'bullet_enemy'); // d2=225 ∈ (36,576)
  if (gb) {
    gb.setActive(true).setVisible(true);
    gb.body.enable = true;
    gb.setVelocity(0, 120); // 120 ≥ MIN_SPEED(80)
    gb._grazedAt = null;
  }
  gs._updateEnemyBullets(gs.time.now);
  const grazeAfter = gs.grazeCount;

  // 回收内联：屏幕上方越界敌弹 → 一次遍历后 active 回落（killBullet）
  const rb = gs.enemyBullets.get(50, -80, 'bullet_enemy');
  if (rb) {
    rb.setActive(true).setVisible(true);
    rb.body.enable = true;
    rb.setVelocity(0, 0);
  }
  gs._updateEnemyBullets(gs.time.now);
  const recycled = !rb || !rb.active;

  // 单次遍历：每次 _updateEnemyBullets 调用 _bulletLoopCount +1（非 2×/3×）
  const c0 = window.__GAME._probe.bulletLoopCount;
  gs._updateEnemyBullets(gs.time.now);
  const c1 = window.__GAME._probe.bulletLoopCount;
  const perCall = c1 - c0;

  return {
    hasMerged: typeof gs._updateEnemyBullets === 'function',
    hasOldGraze: typeof gs._updateGraze === 'function',
    hasRecycle: typeof gs.recycleBullets === 'function',
    frameDelta,
    loopDelta,
    perCall,
    grazeGrew: grazeAfter > grazeBefore,
    grazeDelta: grazeAfter - grazeBefore,
    recycled,
    probe: window.__GAME._probe,
  };
});
push('T3. _updateEnemyBullets 存在 / _updateGraze 已内联移除', t3.hasMerged && !t3.hasOldGraze, `merged=${t3.hasMerged} oldGraze=${t3.hasOldGraze}`);
push('T3. 敌弹遍历为单次（游戏帧窗内 bulletLoopCount 增量 ≈ 帧数，非 2×/3×）',
  t3.frameDelta >= 25 && Math.abs(t3.loopDelta - t3.frameDelta) <= 2, `frames=${t3.frameDelta} loop=${t3.loopDelta} perCall=${t3.perCall}`);
push('T3. 擦弹判定内联仍生效（grazeCount +1）', t3.grazeGrew, `grazeDelta=${t3.grazeDelta}`);
push('T3. 敌弹越界回收内联仍生效（active 回落）', t3.recycled, `recycled=${t3.recycled}`);
push('T3. recycleBullets 对外保留（玩家弹/金币回收）', t3.hasRecycle, '');

// ─────────────────────────────────────────────
// T11 —— 每帧分配审计：checkBossHits 手算 AABB 功能等价 + 池容量 + 转向可调用
// ─────────────────────────────────────────────
const t11 = await mCtx.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const waitFrames = (n) => new Promise((res) => { let c = 0; const iv = setInterval(() => { if (++c >= n) { clearInterval(iv); res(); } }, 16); });
  // 1) checkBossHits（手算 AABB）：生成 Boss + 玩家弹穿心 → 扣血
  gs.spawnBoss('boss_sentinel', { maxHp: 800, difficulty: 1, color: 0x66ccff, pattern: 'fan' });
  const boss = gs.boss;
  boss.setPosition(270, 300);
  boss.setActive(true).setVisible(true);
  if (boss.body) boss.body.enable = true;
  const hp0 = boss.hp;
  const pb = gs.playerBullets.get(270, 380, 'bullet_pulse');
  if (pb) {
    pb.setActive(true).setVisible(true);
    pb.body.enable = true;
    pb.setVelocity(0, -400);
    pb.damage = 25;
    pb.byWingman = false;
    pb.element = null;
    pb.pierce = 0;
    pb.isBomb = false;
  }
  await waitFrames(20);
  const hp1 = boss.hp;

  // 2) 转向审计函数可调用（tracking 弹速度方向变化）
  const ste = gs.enemyBullets.get(gs.player.x + 100, gs.player.y + 80, 'bullet_enemy');
  if (ste) {
    ste.setActive(true).setVisible(true);
    ste.body.enable = true;
    ste.eHoming = true;
    ste.setVelocity(0, 120);
    const vx0 = ste.body.velocity.x;
    for (let i = 0; i < 25; i++) gs.steerEnemyBullets();
    const vx1 = ste.body.velocity.x;
    var steered = Math.abs(vx1 - vx0) > 1;
  } else { var steered = false; }

  // 3) 池容量不超上限（密集弹幕窗口）
  const busy = await (async () => {
    const g0 = gs.enemyBullets.children.size;
    const p0 = gs.playerBullets.children.size;
    for (let i = 0; i < 8; i++) {
      const b = gs.enemyBullets.get(40 + i * 55, 260, 'bullet_enemy');
      if (b) { b.setActive(true).setVisible(true); b.body.enable = true; b.setVelocity(0, 160); }
    }
    await waitFrames(30);
    return { g0, p0, g1: gs.enemyBullets.children.size, p1: gs.playerBullets.children.size };
  })();

  return {
    bossHpBefore: hp0, bossHpAfter: hp1, dmgDealt: hp0 - hp1,
    steered,
    poolG: busy.g1, poolP: busy.p1,
    poolsOk: busy.g1 <= 400 && busy.p1 <= 200,
  };
});
push('T11. checkBossHits 手算 AABB 命中等价（Boss 扣血 ≥25）', t11.dmgDealt >= 25, `hp ${t11.bossHpBefore} -> ${t11.bossHpAfter}`);
push('T11. steerEnemyBullets 转向仍生效（速度方向变化）', t11.steered, `steered=${t11.steered}`);
push('T11. 敌/玩弹池容量不超上限（≤400 / ≤200）', t11.poolsOk, `g=${t11.poolG} p=${t11.poolP}`);

// ─────────────────────────────────────────────
// T4 —— glowTarget 合帧：每场景至多 1 个 update 监听 + 清理等价
// ─────────────────────────────────────────────
const t4 = await mCtx.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  // 用游戏真实 VFX 模块实例（window.__GAME._vfx，QA 钩子）。
  // 不用动态 import：探针内 import 会被 Vite 视为第二模块实例，registry/计数不共享导致断言失真。
  const VFX = window.__GAME._vfx;
  const waitGameFrames = (n) => new Promise((res) => {
    const target = window.__GAME.loop.frame + n;
    const iv = setInterval(() => { if (window.__GAME.loop.frame >= target) { clearInterval(iv); res(); } }, 16);
  });
  const before = gs.events.listenerCount('update');

  // 追加 5 个 glowTarget（各挂不同 sprite）→ 监听数增长 ≤1（首调注册场景同步，之后幂等）
  const sprites = [];
  const glows = [];
  for (let i = 0; i < 5; i++) {
    const s = gs.add.sprite(100 + i * 30, 500, 'star');
    sprites.push(s);
    glows.push(VFX.glowTarget(s, 0xffffff, {}));
  }
  const after = gs.events.listenerCount('update');

  // idleAura stop 计数回落（_dynLight 只读 getter 读取游戏模块真实 _idleAuraActive）
  const sA = gs.add.sprite(200, 520, 'star');
  const aura = VFX.idleAura(sA, 0xffaa00, {});
  const activeBeforeStop = window.__GAME._dynLight.idleAuraActive;
  if (aura && aura.stop) aura.stop();
  const activeAfterStop = window.__GAME._dynLight.idleAuraActive;

  // sprite 销毁 → glow 销毁（destroy 时序保持）
  const sD = gs.add.sprite(220, 540, 'star');
  const glowD = VFX.glowTarget(sD, 0x00ffaa, {});
  sD.destroy();
  await waitGameFrames(2);
  const glowDestroyed = !glowD || !glowD.active;

  // 清理探针创建的 sprite
  sprites.forEach((s) => { if (s && s.active) s.destroy(); });
  if (sA && sA.active) sA.destroy();
  return { before, after, activeBeforeStop, activeAfterStop, glowDestroyed, auraCreated: !!aura };
});
push('T4. 追加 5 个 glowTarget 至多新增 1 个场景 update 监听（合帧生效）',
  typeof t4.after === 'number' && t4.after - t4.before <= 1 && t4.after >= t4.before,
  `before=${t4.before} after=${t4.after} (+${t4.after - t4.before})`);
push('T4. idleAura stop 后 _dynLight.idleAuraActive 回落',
  t4.auraCreated && t4.activeAfterStop === t4.activeBeforeStop - 1 && t4.activeAfterStop >= 0,
  `${t4.activeBeforeStop} -> ${t4.activeAfterStop}`);
push('T4. sprite 销毁后 glow 随之销毁（destroy 时序保持）', t4.glowDestroyed, `glowDestroyed=${t4.glowDestroyed}`);

// ─────────────────────────────────────────────
// T4/T7 —— 场景往返 20 次：GameScene/EventBus 监听不增长
// ─────────────────────────────────────────────
const t7 = await mCtx.page.evaluate(async () => {
  const game = window.__SKY__;
  const snapshot = () => ({
    eb: window.__PROBE.eventBus,
    gsListeners: window.__PROBE.sceneListeners,
    gsUpdate: window.__PROBE.sceneUpdate,
  });
  const waitPlayer = () => new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
    }, 50);
  });
  const stopAll = () => {
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = game.scene.getScene(k);
      if (sc && sc.scene.isActive()) game.scene.stop(k);
    });
  };
  const first = snapshot();
  const counts = [first];
  for (let i = 0; i < 20; i++) {
    stopAll();
    await new Promise((r) => setTimeout(r, 80));
    game.scene.start('MenuScene');
    await new Promise((r) => setTimeout(r, 80));
    game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
    game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
    await waitPlayer();
    counts.push(snapshot());
  }
  return { first, last: counts[counts.length - 1],
    ebSeries: counts.map((c) => c.eb), gsSeries: counts.map((c) => c.gsListeners) };
});
push('T4/T7. 场景往返 20 次 EventBus 监听不增长（相对首轮 ≤ +2）',
  typeof t7.first.eb === 'number' && t7.last.eb <= t7.first.eb + 2,
  `first=${t7.first.eb} last=${t7.last.eb} series=[${t7.ebSeries.join(',')}]`);
push('T4/T7. 场景往返 20 次 GameScene 事件监听不增长（glow registry shutdown 清理）',
  typeof t7.first.gsListeners === 'number' && t7.last.gsListeners <= t7.first.gsListeners + 2,
  `first=${t7.first.gsListeners} last=${t7.last.gsListeners} series=[${t7.gsSeries.join(',')}]`);
push('T4/T7. GameScene update 监听稳定', typeof t7.first.gsUpdate === 'number' && t7.last.gsUpdate === t7.first.gsUpdate && t7.last.gsUpdate > 0,
  `first=${t7.first.gsUpdate} last=${t7.last.gsUpdate}`);
push('P0. high 上下文无 pageerror/console.error', mCtx.errors.length === 0, mCtx.errors.slice(0, 3).join(' | '));
await mCtx.ctx.close(); // 释放资源

// ─────────────────────────────────────────────
// T10 —— low 档预填降量（独立上下文，quality=low）
// ─────────────────────────────────────────────
const lowSave = { lang: 'zh', tutorialDone: true, quality: 'low', coins: 50,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 } };
const lCtx = await launchPage(lowSave);
await enterBattle(lCtx.page);
const t10low = await lCtx.page.evaluate(async () => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const gc = await import('/src/config/GameConfig.js');
  return {
    prewarmMs: window.__GAME._probe.prewarmMs,
    enemyCount: gs.enemyBullets.children.size,
    qs: gs.qualityScale,
    poolCfg: gc.POOL.enemyBullets,
    scale: gc.PERFORMANCE.scale.low,
  };
});
const expectedLow = Math.max(1, Math.floor(400 * t10low.scale));
push('T10. low 档预填按 qualityScale 降量（== floor(400×0.45)）',
  t10low.enemyCount === expectedLow && t10low.qs === t10low.scale,
  `count=${t10low.enemyCount} expected=${expectedLow} qs=${t10low.qs}`);
push('T10. low 档 prewarmMs 仍存在', typeof t10low.prewarmMs === 'number' && t10low.prewarmMs >= 0, `prewarmMs=${t10low.prewarmMs}`);
push('P0. low 上下文无 pageerror/console.error', lCtx.errors.length === 0, lCtx.errors.slice(0, 3).join(' | '));
await lCtx.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 批次3（T3/T4/T10/T11）探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
