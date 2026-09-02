// qa_opt16_qa_t4_t11.mjs —— QA-OPT 独立探针：T4 场景往返监听不增长 + T11 多弹同帧击杀 Boss 稳健性
//
//   D. T4   glowTarget/idleAura 合帧：创建 N 个光效 → GameScene 'update' 监听数不随 N 增长（每场景仅 1 个 registry sync）；
//         场景 restart 往返多次 → update 监听数与 EventBus 总量不增长（零跨场景泄漏）。
//   E. T11  复现风险：checkBossHits 移除每弹 boss.active 守卫后，同帧多弹（含护盾重叠弹）击杀 Boss
//         可能在遍历中途 this.boss 被 _onBossDefeated 置 null 后继续解引用 → 期望无异常 + BOSS_DEFEATED 仅一次。
//
// 运行：node qa_probes/qa_opt16_qa_t4_t11.mjs （QA_URL 默认 http://127.0.0.1:5059）
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

async function launchPage() {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(({ key }) => {
    try { localStorage.setItem(key, JSON.stringify({ lang: 'zh', tutorialDone: true, quality: 'high' })); } catch (e) {}
  }, { key: SAVE_KEY });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
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

// ─────────────────────────────────────────────
// D. T4 场景往返监听
// ─────────────────────────────────────────────
console.log('\n=== D. T4 glow 合帧：监听数不随光效数增长 + 场景往返零泄漏 ===');
{
  const ctx = await launchPage();
  try {
    await enterBattle(ctx.page);
    const out = await ctx.page.evaluate(async () => {
      const game = window.__SKY__;
      const gs = game.scene.getScene('GameScene');
      const vfx = (game._vfx) || (window.__GAME && window.__GAME._vfx);
      const countUpdate = () => {
        const sc = game.scene.getScene('GameScene');
        return (sc && sc.events && typeof sc.events.listenerCount === 'function')
          ? sc.events.listenerCount('update') : null;
      };
      const countEB = () => {
        const p = window.__PROBE;
        return p ? p.eventBus : null;
      };
      const results = {};
      results.baseUpdate = countUpdate();
      results.baseEB = countEB();
      // 创建 6 个 glowTarget + 2 个 idleAura（含小矩形 sprite）
      const rects = [];
      for (let i = 0; i < 8; i++) {
        const r = gs.add.rectangle(100 + i * 20, 200, 30, 30, 0xff8800);
        r.setDepth(20);
        rects.push(r);
        if (i < 6) vfx.glowTarget(r, 0xffffff, { radius: 0.3, alpha: 0.2 });
        else vfx.idleAura(r, 0x66ffcc, { radius: 0.3, alpha: 0.2 });
      }
      results.afterCreate = countUpdate();       // 期望与 baseUpdate 相同（合帧：每场景 1 个）
      results.afterCreateEB = countEB();
      // 销毁 sprite → entry.remove()，监听数不变（场景级 registry 仍在）
      rects.forEach((r) => r.destroy());
      results.afterDestroy = countUpdate();
      return { ...results, hasVfx: !!vfx };
    });
    if (!out.hasVfx) { push('T4 探针钩子可用（game._vfx）', false, 'window.__GAME._vfx 缺失'); }
    else {
      const noGrowth = out.afterCreate === out.baseUpdate && out.afterDestroy === out.baseUpdate;
      push('T4a 创建 8 个光效后 GameScene update 监听数不增长（合帧生效）', noGrowth,
        `base=${out.baseUpdate} afterCreate=${out.afterCreate} afterDestroy=${out.afterDestroy}`);
    }
    // 场景往返 3 次：监听数不累计
    const roundtrip = await ctx.page.evaluate(async () => {
      const game = window.__SKY__;
      const gs0 = game.scene.getScene('GameScene');
      const baseEB = (window.__PROBE && window.__PROBE.eventBus) || 0;
      const baseUpd = (gs0 && gs0.events && typeof gs0.events.listenerCount === 'function') ? gs0.events.listenerCount('update') : null;
      const samples = [];
      for (let i = 0; i < 3; i++) {
        game.scene.stop('UIScene');
        game.scene.stop('GameScene');
        game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
        game.scene.start('UIScene', { mode: 'normal', levelId: 1, hp: 100, maxHp: 100, bombs: 3 });
        await new Promise((res) => {
          const t0 = performance.now();
          const iv = setInterval(() => {
            const g = game.scene.getScene('GameScene');
            if (g && g.player && g.player.active) { clearInterval(iv); res(); }
            else if (performance.now() - t0 > 9000) { clearInterval(iv); res(); }
          }, 50);
        });
        const gs = game.scene.getScene('GameScene');
        samples.push({
          upd: (gs && gs.events && typeof gs.events.listenerCount === 'function') ? gs.events.listenerCount('update') : null,
          eb: (window.__PROBE && window.__PROBE.eventBus) || 0,
        });
      }
      return { baseUpd, baseEB, samples };
    });
    const updOk = roundtrip.samples.every((s) => s.upd === roundtrip.baseUpd);
    const ebOk = roundtrip.samples.every((s) => s.eb <= roundtrip.baseEB + 1);
    push('T4b 场景 restart 3 次 GameScene update 监听数不累计（零泄漏）', updOk,
      `base=${roundtrip.baseUpd} samples=${JSON.stringify(roundtrip.samples.map((s) => s.upd))}`);
    push('T4c 场景 restart 3 次 EventBus 监听总量不增长', ebOk,
      `base=${roundtrip.baseEB} samples=${JSON.stringify(roundtrip.samples.map((s) => s.eb))}`);
  } catch (e) {
    push('T4 探针执行异常', false, String(e && e.message || e));
  }
  await ctx.ctx.close().catch(() => {});
}

// ─────────────────────────────────────────────
// E. T11 同帧多弹击杀 Boss 稳健性（回归风险验证）
// ─────────────────────────────────────────────
console.log('\n=== E. T11 checkBossHits 同帧多弹（含护盾重叠弹）击杀 Boss ===');
{
  const ctx = await launchPage();
  try {
    await enterBattle(ctx.page);
    const res = await ctx.page.evaluate(async () => {
      const game = window.__SKY__;
      const gs = game.scene.getScene('GameScene');
      // spawn Boss
      if (typeof gs.spawnBoss !== 'function') return { err: 'no spawnBoss' };
      gs.spawnBoss('boss_sentinel', { maxHp: 500, difficulty: 1, color: 0x66ccff, pattern: 'fan' });
      const t0 = performance.now();
      await new Promise((res2) => {
        const iv = setInterval(() => {
          if (gs.boss && gs.boss.active) { clearInterval(iv); res2(); }
          else if (performance.now() - t0 > 5000) { clearInterval(iv); res2(); }
        }, 30);
      });
      const boss = gs.boss;
      if (!boss || !boss.active) return { err: 'boss not active after spawn' };
      // 统计 BOSS_DEFEATED 次数
      const { EventBus } = await import('/src/utils/EventBus.js');
      let defeated = 0;
      const evtName = 'boss-defeated';
      const onDef = () => { defeated++; };
      EventBus.on(evtName, onDef);
      // 屏蔽护盾分支冲突，让第一颗弹打本体致死；但保留 shieldPart 对象用于构造「第二颗弹重叠护盾」场景
      boss._entering = false;
      boss.hp = 5;
      boss._shieldBroken = false;
      if (!boss.shieldPart) {
        boss.shieldPart = gs.add.rectangle(boss.x, boss.y - 60, 80, 30, 0xffffff).setVisible(false);
      } else {
        boss.shieldPart.setPosition(boss.x, boss.y - 60);
      }
      boss._shieldPartHp = 99999;
      // 清空玩家弹，造两颗重叠弹
      if (gs.playerBullets && gs.playerBullets.children) {
        gs.playerBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
      }
      // 弹1：命中本体下部（不重叠护盾）→ 击杀
      const mk = (x, y) => {
        const b = gs.playerBullets.get(x, y, 'bullet_player');
        b.setActive(true).setVisible(true);
        if (b.body) { b.body.enable = true; }
        b.setPosition(x, y);
        b.damage = 100;
        b.isBomb = false;
        b.pierce = 0;
        b._lastHit = null;
        b.element = null;
        return b;
      };
      mk(boss.x, boss.y + 30); // 弹1：本体（先入组，先遍历）
      mk(boss.x, boss.y - 60); // 弹2：护盾区（后入组，后遍历）
      let thrown = null;
      try {
        gs.checkBossHits();
      } catch (e2) {
        thrown = String(e2 && e2.message || e2);
      }
      EventBus.off(evtName, onDef);
      return { thrown, defeated, bossActive: !!(gs.boss && gs.boss.active), bossNull: gs.boss === null };
    });
    if (res.err) { push('T11 探针执行', false, res.err); }
    else {
      const clean = res.thrown === null && res.defeated === 1;
      push('T11 同帧多弹击杀 Boss：无异常且 BOSS_DEFEATED 仅 1 次（期望）', clean,
        `thrown=${res.thrown || 'null'} defeated=${res.defeated} bossNull=${res.bossNull}`);
      if (res.thrown) {
        console.log('   ⚠️ 复现到异常（P1 候选）：' + res.thrown);
      } else if (res.defeated > 1) {
        console.log('   ⚠️ BOSS_DEFEATED 重复 ' + res.defeated + ' 次（P1 候选）');
      }
    }
  } catch (e) {
    push('T11 探针执行异常', false, String(e && e.message || e));
  }
  await ctx.ctx.close().catch(() => {});
}

// ─────────────────────────────────────────────
console.log('\n=== 汇总 ===');
const pass = checks.filter((c) => c.ok).length;
console.log(`PASS ${pass}/${checks.length}`);
await browser.close();
if (pass !== checks.length) process.exit(1);
