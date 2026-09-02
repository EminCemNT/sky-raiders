// qa_p2_graze_overdrive_rush.mjs —— 玩法 P2 三项验收探针
//
// 验证：
//   1) GRAZE 配置存在（RING_EXTRA=18 / MIN_SPEED=80 / SCORE=5 / CHAIN_SCORE=2 /
//      CHAIN_MAX=15 / CHAIN_WINDOW=2000 / ENERGY_GAIN=1 / RE_GRAZE_MS=400 / CHECK_EVERY=2）
//      + EVENTS.GRAZE_CHANGED；OVERDRIVE 配置；EVENTS.USE_SKILL/SKILL_SWITCHED/OVERDRIVE_STATE
//   2) 擦弹触发：模拟敌弹入环 → 加分(+5)/回能(+1)/飘字「擦弹」/GRAZE_CHANGED 事件
//   3) 链式加分：2s 窗口内连续擦弹每段 +2（封顶 +15）
//   4) HUD 擦弹计数（右上角「擦弹 N」）
//   5) 过载：Skills 有 overdrive；useSkill 按 activeSkill 派发；射速翻倍 fireMul 生效；
//      倒计时 HUD；到期恢复；切换箭头/Q 事件轮换且激活中不中断
//   6) Boss Rush 差异化：hangarLv=0 与现状等价（maxHp=2600 / difficulty=1.2 / coinMul=1）；
//      hangarLv=30 时 maxHp/difficulty/coinMul 上调；ResultScene 奖励行
//   7) 零 pageerror / console error
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

/** 进入指定模式的一局（复用同一 page，重启场景）。upgrades 覆盖存档升级项 */
async function startGame(page, mode, upgrades = {}) {
  await page.evaluate(({ mode, upgrades }) => {
    const g = window.__SKY__;
    const s = window.__SAVE.load();
    s.upgrades = { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0, ...upgrades };
    window.__SAVE.set('selectedDifficulty', 'standard');
    window.__SAVE.set('tutorialDone', true);
    window.__SAVE.save();
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene'].forEach((k) => {
      const sc = g.scene.getScene(k);
      if (sc && sc.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode, levelId: 1 });
  }, { mode, upgrades });
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

// ── 1) 静态配置断言 ──
const cfg = await page.evaluate(async () => {
  const gc = await import('/src/config/GameConfig.js');
  const sk = await import('/src/config/Skills.js');
  return {
    graze: gc.GRAZE,
    grazeEvent: gc.EVENTS.GRAZE_CHANGED,
    useSkillEvent: gc.EVENTS.USE_SKILL,
    skillSwitchedEvent: gc.EVENTS.SKILL_SWITCHED,
    overdriveStateEvent: gc.EVENTS.OVERDRIVE_STATE,
    overdriveCfg: gc.OVERDRIVE,
    overdrive: sk.SKILLS.overdrive,
    bossRushScale: typeof gc.bossRushScale === 'function',
    scale0: gc.bossRushScale(0),
    scale30: gc.bossRushScale(30),
  };
});
push('GRAZE 配置存在（9 字段）', !!cfg.graze
  && cfg.graze.RING_EXTRA === 18 && cfg.graze.MIN_SPEED === 80 && cfg.graze.SCORE === 5
  && cfg.graze.CHAIN_SCORE === 2 && cfg.graze.CHAIN_MAX === 15 && cfg.graze.CHAIN_WINDOW === 2000
  && cfg.graze.ENERGY_GAIN === 1 && cfg.graze.RE_GRAZE_MS === 400 && cfg.graze.CHECK_EVERY === 2,
  JSON.stringify(cfg.graze));
push('EVENTS.GRAZE_CHANGED 已登记', cfg.grazeEvent === 'graze-changed', cfg.grazeEvent);
push('EVENTS.USE_SKILL/SKILL_SWITCHED/OVERDRIVE_STATE 已登记',
  !!cfg.useSkillEvent && !!cfg.skillSwitchedEvent && !!cfg.overdriveStateEvent,
  `${cfg.useSkillEvent} / ${cfg.skillSwitchedEvent} / ${cfg.overdriveStateEvent}`);
push('OVERDRIVE 配置 = {DURATION:6000, FIRE_MUL:0.5}',
  !!cfg.overdriveCfg && cfg.overdriveCfg.DURATION === 6000 && cfg.overdriveCfg.FIRE_MUL === 0.5,
  JSON.stringify(cfg.overdriveCfg));
push('SKILLS.overdrive 已启用（kind=buff / cost=100）',
  !!cfg.overdrive && cfg.overdrive.kind === 'buff' && cfg.overdrive.cost === 100,
  JSON.stringify(cfg.overdrive));
push('bossRushScale 已导出', cfg.bossRushScale === true);
push('bossRushScale(0)：hpMul=1 / bulletMul=1 / coinMul=1 / rareChance=0.05（零回归基准）',
  cfg.scale0.hpMul === 1 && cfg.scale0.bulletMul === 1 && cfg.scale0.coinMul === 1 && Math.abs(cfg.scale0.rareChance - 0.05) < 1e-9,
  JSON.stringify(cfg.scale0));
push('bossRushScale(30)：hpMul=1.6 / bulletMul=1.24 / coinMul=2.5 / rareChance=0.35',
  Math.abs(cfg.scale30.hpMul - 1.6) < 1e-9 && Math.abs(cfg.scale30.bulletMul - 1.24) < 1e-9
  && Math.abs(cfg.scale30.coinMul - 2.5) < 1e-9 && Math.abs(cfg.scale30.rareChance - 0.35) < 1e-9,
  JSON.stringify(cfg.scale30));

// ── 2) 擦弹触发：入环计一次（加分 +5 / 回能 +1 / 飘字 / 事件）──
await startGame(page, 'normal');
const graze = await page.evaluate(async () => {
  const eb = (await import('/src/utils/EventBus.js')).EventBus;
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  // 清场 + 复位擦弹状态
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  gs.grazeCount = 0; gs.grazeChain = 0; gs._grazeChainUntil = 0;
  gs.score = 0; gs.energy = 0;
  const energyBefore = gs.energy;
  const events = [];
  const onGraze = (pl) => events.push('graze:' + JSON.stringify(pl));
  const onFloat = (pl) => { if (pl && pl.label === '擦弹') events.push('float:' + pl.amount); };
  eb.on('graze-changed', onGraze);
  eb.on('float-score', onFloat);
  // 模拟敌弹入环：距玩家 15px（6 < d < 24），速度 200 ≥ MIN_SPEED
  const b = gs.enemyBullets.get(p.x + 15, p.y, 'bullet_enemy');
  b.setActive(true).setVisible(true);
  b.body.enable = true;
  b.setPosition(p.x + 15, p.y);
  b.body.velocity.set(0, 200);
  b._grazedAt = null;
  gs._grazeTick = 1; gs._updateEnemyBullets(gs.time.now); // OPT-16 T3：擦弹并入 _updateEnemyBullets（CHECK_EVERY=2，对齐 tick → 本次即 graze 帧）
  eb.off('graze-changed', onGraze);
  eb.off('float-score', onFloat);
  return {
    count: gs.grazeCount,
    chain: gs.grazeChain,
    scoreDelta: gs.score,
    energyDelta: gs.energy - energyBefore,
    events,
  };
});
push('擦弹入环计 1 次（grazeCount=1）', graze.count === 1, `count=${graze.count}`);
push('擦弹得分 +5（SCORE）', graze.scoreDelta === 5, `scoreDelta=${graze.scoreDelta}`);
push('擦弹回能 +1（ENERGY_GAIN）', graze.energyDelta === 1, `energyDelta=${graze.energyDelta}`);
push('擦弹事件 GRAZE_CHANGED {count:1,chain:0}', graze.events.includes('graze:{"count":1,"chain":0}'), graze.events.join(' | '));
push('擦弹飘字 FLOAT_SCORE「擦弹」+5', graze.events.some((e) => e === 'float:5'), graze.events.join(' | '));

// ── 3) 链式加分：2s 窗口内连续擦弹每段 +2（封顶 +15）──
const chain = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  gs.grazeCount = 0; gs.grazeChain = 0; gs._grazeChainUntil = 0;
  gs.score = 0;
  const mk = (dx, dy = 0) => {
    const b = gs.enemyBullets.get(p.x + dx, p.y + dy, 'bullet_enemy');
    b.setActive(true).setVisible(true); b.body.enable = true;
    b.setPosition(p.x + dx, p.y + dy);
    b.body.velocity.set(0, 200);
    b._grazedAt = null;
    return b;
  };
  const deltas = [];
  mk(15, 0); gs._grazeTick = 1; gs._updateEnemyBullets(gs.time.now); deltas.push(gs.score);            // 第 1 次 +5 (T3 merged)
  mk(-15, 0); gs._grazeTick = 1; gs._updateEnemyBullets(gs.time.now); deltas.push(gs.score - deltas[0]); // 第 2 次 +7
  for (let i = 0; i < 3; i++) {                                               // 第 3~5 次 +9/+11/+13
    const ang = (i + 1) * 1.2;
    const dx = Math.round(Math.cos(ang) * 15), dy = Math.round(Math.sin(ang) * 15);
    mk(dx, dy);
    const before = gs.score;
    gs._grazeTick = 1; gs._updateEnemyBullets(gs.time.now); // OPT-16 T3：擦弹并入 _updateEnemyBullets（CHECK_EVERY=2，对齐 tick → 本次即 graze 帧）
    deltas.push(gs.score - before);
  }
  return { deltas, count: gs.grazeCount, chain: gs.grazeChain };
});
push('链式第 1 次 +5（基础分）', chain.deltas[0] === 5, `deltas=${chain.deltas.join(',')}`);
push('链式第 2 次 +7（5+2）', chain.deltas[1] === 7, `deltas=${chain.deltas.join(',')}`);
push('链式第 3/4/5 次 +9/+11/+13（每段 +2）',
  chain.deltas[2] === 9 && chain.deltas[3] === 11 && chain.deltas[4] === 13,
  `deltas=${chain.deltas.join(',')}`);
push('链值推进 chain=4', chain.chain === 4, `chain=${chain.chain}`);

// ── 4) HUD 擦弹计数 ──
await page.waitForFunction(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui && ui.grazeText;
}, { timeout: 10000 });
const hudGraze = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  gs.grazeCount = 0; gs.grazeChain = 0; gs._grazeChainUntil = 0;
  const p = gs.player;
  gs.enemyBullets.children.each((b) => { if (b.active) gs.killBullet(b); });
  const b = gs.enemyBullets.get(p.x + 15, p.y, 'bullet_enemy');
  b.setActive(true).setVisible(true); b.body.enable = true;
  b.setPosition(p.x + 15, p.y); b.body.velocity.set(0, 200); b._grazedAt = null;
  gs._grazeTick = 1; gs._updateEnemyBullets(gs.time.now); // OPT-16 T3：擦弹并入 _updateEnemyBullets（CHECK_EVERY=2，对齐 tick → 本次即 graze 帧）
  return { text: ui.grazeText ? ui.grazeText.text : null };
});
push('HUD 擦弹计数显示「擦弹 1」', hudGraze.text === '擦弹 1', JSON.stringify(hudGraze.text));

// ── 4b) 擦弹环：随 showHitbox 同步显隐（半径=24，半透明青）──
const ring = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const p = gs.player;
  const r = p.grazeRing;
  const info = { exists: !!r, radius: r ? r.radius : -1 };
  // showHitbox=false → 隐藏
  window.__SAVE.set('showHitbox', false);
  p.update(p.scene.time.now, 16, gs.input.activePointer, gs.cursors);
  info.visibleOff = r ? r.visible : null;
  // showHitbox=true → 显示（环半径 = 判定圈 6 + RING_EXTRA 18 = 24）
  window.__SAVE.set('showHitbox', true);
  p.update(p.scene.time.now, 16, gs.input.activePointer, gs.cursors);
  info.visibleOn = r ? r.visible : null;
  info.radiusOk = r ? (r.radius === 24 && (r.fillColor === 0x33ffff || r.isFilled)) : false;
  return info;
});
push('擦弹环 grazeRing 存在（半径 24）', ring.exists === true && ring.radius === 24, `radius=${ring.radius}`);
push('擦弹环随 showHitbox=false 隐藏 / =true 显示',
  ring.visibleOff === false && ring.visibleOn === true, `off=${ring.visibleOff} on=${ring.visibleOn}`);

// ── 5) 过载：射速翻倍 + 倒计时 HUD + 到期恢复 ──
await page.waitForFunction(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui && ui.skill && ui.skill.label;
}, { timeout: 10000 });
const skillLabelInit = await page.evaluate(() => {
  const ui = window.__SKY__.scene.getScene('UIScene');
  return ui.skill.label.text;
});
push('HUD 技能按钮初始标签「星风暴」', skillLabelInit === '星风暴', JSON.stringify(skillLabelInit));

const od = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  const p = gs.player;
  // 基础射速复位
  p.firepower = 0; p.powerLevel = 0;
  p.setFirepower(0); p.setPowerLevel(0); p.setFireRateMul(1);
  const baseInterval = p.fireInterval;
  // 切到过载 + 能量满 → useSkill 派发过载
  gs.activeSkill = 'overdrive';
  gs.energy = 100;
  gs.useSkill();
  const after = {
    fireMul: p.fireMul,
    interval: p.fireInterval,
    overdriveUntil: gs._overdriveUntil,
    energy: gs.energy,
  };
  // 倒计时 HUD：手动跑一帧 update 让标签刷新
  ui.update();
  after.labelText = ui.skill && ui.skill.label ? ui.skill.label.text : null;
  after.uiOverdriveUntil = ui._overdriveUntil;
  return { baseInterval, after };
});
push('基础射速 140ms（mul=1 零 diff）', od.baseInterval === 140, `base=${od.baseInterval}`);
push('过载射速翻倍（fireMul=0.5 / interval 140→70）',
  od.after.fireMul === 0.5 && od.after.interval === 70,
  `mul=${od.after.fireMul} interval=${od.after.interval}`);
push('过载消耗能量（100→0）', od.after.energy === 0, `energy=${od.after.energy}`);
push('过载激活截止时间已设置', od.after.overdriveUntil > 0, `until=${od.after.overdriveUntil}`);
push('HUD 倒计时「过载 6s」', od.after.labelText === '过载 6s', JSON.stringify(od.after.labelText));
push('UIScene 记录过载激活（_overdriveUntil>0）', od.after.uiOverdriveUntil > 0, `uiUntil=${od.after.uiOverdriveUntil}`);

const odExpire = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  const p = gs.player;
  // 模拟到期
  gs._overdriveUntil = gs.time.now - 1;
  gs._updateOverdrive(gs.time.now);
  ui.update();
  return {
    fireMul: p.fireMul,
    interval: p.fireInterval,
    until: gs._overdriveUntil,
    uiUntil: ui._overdriveUntil,
  };
});
push('过载到期恢复射速（fireMul=null / interval=140）',
  (odExpire.fireMul === null || odExpire.fireMul === undefined || odExpire.fireMul === 1)
  && odExpire.interval === 140,
  `mul=${odExpire.fireMul} interval=${odExpire.interval}`);
push('到期后 OVERDRIVE_STATE inactive（ui._overdriveUntil=0）', odExpire.uiUntil === 0, `uiUntil=${odExpire.uiUntil}`);

// ── 5b) useSkill 切换：starstorm 走 useSuper；_switchSkill 轮换且幂等 ──
const odSwitch = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const before = gs.usedSuperCount;
  gs.activeSkill = 'starstorm';
  gs.energy = 100;
  gs.useSkill();                       // 星风暴路径
  const starOk = gs.usedSuperCount === before + 1 && gs.energy === 0;
  gs._switchSkill();                   // → overdrive（自身广播 payload，防循环）
  const afterSwitch = gs.activeSkill;
  gs._switchSkill();                   // → starstorm
  const afterSwitch2 = gs.activeSkill;
  return { starOk, afterSwitch, afterSwitch2 };
});
push('useSkill 按 activeSkill 派发星风暴（usedSuperCount+1）', odSwitch.starOk === true);
push('_switchSkill 轮换 overdrive（幂等，无循环）', odSwitch.afterSwitch === 'overdrive', odSwitch.afterSwitch);
push('_switchSkill 再切回 starstorm', odSwitch.afterSwitch2 === 'starstorm', odSwitch.afterSwitch2);

// ── 5c) 技能按钮 tap 发 USE_SKILL；切换箭头发 SKILL_SWITCHED ──
const btn = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const ui = window.__SKY__.scene.getScene('UIScene');
  gs.activeSkill = 'overdrive';
  gs.energy = 100;
  gs._overdriveUntil = 0;
  gs.player.setFireRateMul(1);
  ui.skill.container.emit('pointerdown');       // tap 技能按钮 → USE_SKILL → 过载
  const tapped = gs._overdriveUntil > 0;
  const arrowBefore = gs.activeSkill;
  ui.skillSwitch.emit('pointerdown');           // 切换箭头 → SKILL_SWITCHED → 轮换
  const arrowAfter = gs.activeSkill;
  return { tapped, arrowBefore, arrowAfter };
});
push('技能按钮 tap 触发过载（USE_SKILL 派发）', btn.tapped === true);
push('切换箭头 SKILL_SWITCHED 轮换技能槽（overdrive→starstorm）',
  btn.arrowBefore === 'overdrive' && btn.arrowAfter === 'starstorm',
  `${btn.arrowBefore} → ${btn.arrowAfter}`);

// ── 6) Boss Rush 差异化：hangarLv=0 等价 / hangarLv=30 上调 ──
await startGame(page, 'bossrush', { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0, wingmanFirepower: 0 });
const rush0 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const boss = gs.boss;
  const seq = { maxHp: 2600, hpMult: 1.0 };   // 第一个 Boss 哨兵
  const oldMaxHp = Math.round(seq.maxHp * seq.hpMult);
  return {
    hangarLv: gs._hangarLv(),
    maxHp: boss ? boss.maxHp : -1,
    difficulty: boss ? boss.difficulty : -1,
    oldMaxHp, oldDifficulty: 1.2,
    coinMul: gs._rushScale ? gs._rushScale.coinMul : -1,
    hpMul: gs._rushScale ? gs._rushScale.hpMul : -1,
    bulletMul: gs._rushScale ? gs._rushScale.bulletMul : -1,
  };
});
push('hangarLv=0（机库零升级）', rush0.hangarLv === 0, `lv=${rush0.hangarLv}`);
push('hangarLv=0：maxHp 与现状一致（2600）', rush0.maxHp === rush0.oldMaxHp && rush0.maxHp === 2600, `maxHp=${rush0.maxHp}`);
push('hangarLv=0：difficulty 与现状一致（1.2）', rush0.difficulty === rush0.oldDifficulty, `diff=${rush0.difficulty}`);
push('hangarLv=0：hpMul=1 / bulletMul=1 / coinMul=1（零回归）',
  rush0.hpMul === 1 && rush0.bulletMul === 1 && rush0.coinMul === 1,
  `hp=${rush0.hpMul} bullet=${rush0.bulletMul} coin=${rush0.coinMul}`);

await startGame(page, 'bossrush', { firepower: 8, hull: 6, shield: 5, magnet: 4, wingman: 2, wingmanFirepower: 5 });
const rush30 = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const boss = gs.boss;
  return {
    hangarLv: gs._hangarLv(),
    maxHp: boss ? boss.maxHp : -1,
    difficulty: boss ? boss.difficulty : -1,
    coinMul: gs._rushScale ? gs._rushScale.coinMul : -1,
    hpMul: gs._rushScale ? gs._rushScale.hpMul : -1,
    bulletMul: gs._rushScale ? gs._rushScale.bulletMul : -1,
  };
});
push('hangarLv=30（六项升级之和）', rush30.hangarLv === 30, `lv=${rush30.hangarLv}`);
push('hangarLv=30：maxHp 上调至 4160（2600×1.6）', rush30.maxHp === 4160, `maxHp=${rush30.maxHp}`);
push('hangarLv=30：difficulty 上调至 1.488（1.2×1.24）',
  Math.abs(rush30.difficulty - 1.488) < 1e-6, `diff=${rush30.difficulty}`);
push('hangarLv=30：coinMul=2.5 / hpMul=1.6 / bulletMul=1.24',
  rush30.coinMul === 2.5 && rush30.hpMul === 1.6 && rush30.bulletMul === 1.24,
  `coin=${rush30.coinMul} hp=${rush30.hpMul} bullet=${rush30.bulletMul}`);

// ── 6b) 稀有掉落：extraRare=1 时按概率追加 element_core/power/energy ──
const rare = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.items.children.each((it) => { if (it.active) it.recycle(); });
  const orig = Math.random;
  Math.random = () => 0;                       // 必然追加
  const n = gs.spawnBossDrops(270, 300, 1);
  Math.random = orig;
  const keys = [];
  gs.items.children.each((it) => { if (it.active && ['element_core', 'power', 'energy'].includes(it.itemKey)) keys.push(it.itemKey); });
  return { n, keys };
});
push('spawnBossDrops(extraRare=1) 返回稀有掉落数=3', rare.n === 3, `n=${rare.n}`);
push('稀有掉落已生成（element_core/power/energy）',
  rare.keys.includes('element_core') && rare.keys.includes('power') && rare.keys.includes('energy'),
  rare.keys.join(','));

// ── 6c) ResultScene「Boss Rush 奖励」行 ──
const rs = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  gs.endGame(true);                            // bossrush 胜利结算
  return true;
});
await page.waitForFunction(() => {
  const s = window.__SKY__.scene.getScene('ResultScene');
  return s && s.scene.isActive();
}, { timeout: 20000 });
const rsInfo = await page.evaluate(() => {
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
    rushReward: r.result.rushReward,
    hasRewardLine: texts.some((t) => t.includes('Boss Rush 奖励')),
    hasHangarLv30: texts.some((t) => t.includes('机库 Lv30')),
  };
});
push('结算 result.rushReward 透传 {hangarLv:30,coinMul:2.5}',
  !!rsInfo.rushReward && rsInfo.rushReward.hangarLv === 30 && rsInfo.rushReward.coinMul === 2.5,
  JSON.stringify(rsInfo.rushReward));
push('ResultScene 显示「Boss Rush 奖励」行', rsInfo.hasRewardLine === true);
push('奖励行含机库等级 Lv30', rsInfo.hasHangarLv30 === true);

// ── 7) 零 pageerror / console error ──
push('零 pageerror / console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');
if (errors.length) console.log('   errors:', errors.slice(0, 6));

await browser.close();

const pass = checks.every((c) => c.ok);
console.log('\n' + (pass ? '=== qa_p2_graze_overdrive_rush: PASS ===' : '=== qa_p2_graze_overdrive_rush: FAIL ==='));
process.exit(pass ? 0 : 1);
