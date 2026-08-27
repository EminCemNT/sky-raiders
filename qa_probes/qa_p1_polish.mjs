// qa_p1_polish.mjs —— P1 表现工程组四件（bloom / BGM 4 轨 / 触控偏移+灵敏度 / i18n 英文）真测
//
// 断言：
//   A) bloom 按性能档开关：high 有 postFX bloom 节点（window.__BLOOM.list>0）/ low 无
//   B) BGM 4 轨 sequencer：bass/lead/arp/drums 调度存在，stage/boss BPM 不同，可关闭
//   C) 触控偏移 + 灵敏度：SaveManager 字段 + 设置面板灵敏度滑杆 / 触控偏移开关 / 拖动 lerp 系数封顶 0.6
//   D) i18n：Locale zh/en 词表 ≥150 key、t() 语言切换生效、主要 UI 英文文案、可切回中文
//   E) 零 pageerror / console.error
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口 5059。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const g = window.__SKY__;
  return g && g.scene.getScene('MenuScene') && g.scene.getScene('MenuScene').scene.isActive();
}, { timeout: 20000 });

// ── D1) Locale 词表 + 语言切换（源码级导入：纯数据模块，无循环依赖）──
const loc = await page.evaluate(async () => {
  const L = await import('/src/config/Locale.js');
  const zhCount = L.L && L.L.zh ? Object.keys(L.L.zh).length : 0;
  const enCount = L.L && L.L.en ? Object.keys(L.L.en).length : 0;
  L.setLocale('en');
  const enStart = L.t('btnStart');
  const enTitle = L.t('title');
  const enAch = L.t('ach_first_blood');
  L.setLocale('zh');
  const zhStart = L.t('btnStart');
  const zhTitle = L.t('title');
  return { zhCount, enCount, enStart, enTitle, enAch, zhStart, zhTitle, hasGetLocale: typeof L.getLocale === 'function' };
});
push('Locale 模块存在（getLocale/setLocale/t/L）', loc.hasGetLocale === true, '');
push('Locale zh 词表 ≥150 key', loc.zhCount >= 150, `zh=${loc.zhCount}`);
push('Locale en 词表 ≥150 key', loc.enCount >= 150, `en=${loc.enCount}`);
push('t() 语言切换生效（en: Start Game / zh: 开始游戏）',
  loc.enStart === 'Start Game' && loc.zhStart === '开始游戏', `en=${loc.enStart} zh=${loc.zhStart}`);
push('英文标题 SKY RAIDERS / 成就 key 映射存在', loc.enTitle === 'SKY RAIDERS' && !!loc.enAch, `title=${loc.enTitle} ach=${loc.enAch}`);

// ── C1) SaveManager 新字段（append-only）──
const saveFields = await page.evaluate(() => {
  const s = window.__SAVE.load();
  return { sensitivity: s.sensitivity, touchOffset: s.touchOffset, lang: s.lang };
});
push('SaveManager.sensitivity 默认 1.0', saveFields.sensitivity === 1.0, `v=${saveFields.sensitivity}`);
push('SaveManager.touchOffset 默认 36', saveFields.touchOffset === 36, `v=${saveFields.touchOffset}`);
push('SaveManager.lang 默认 zh', saveFields.lang === 'zh', `v=${saveFields.lang}`);

// ── C2) 设置面板：灵敏度滑杆 + 触控偏移开关 + 语言开关（zh 下操作）──
const settings = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openSettings();
  const out = {
    sensSlider: !!ms._sensSlider,
    touchBtn: !!ms._touchOffsetBtn,
    langBtn: !!ms._langBtn,
    sensVal: window.__SAVE.load().sensitivity,
  };
  // 灵敏度滑杆 apply(1) → 拉到最大值 1.5
  if (ms._sensSlider && typeof ms._sensSlider.apply === 'function') {
    ms._sensSlider.apply(1);
    out.sensAfter = window.__SAVE.load().sensitivity;
  }
  // 触控偏移开关：点一次 → touchOffset 36→0
  if (ms._touchOffsetBtn) {
    ms._touchOffsetBtn.container.emit('pointerdown');
    out.touchAfterOff = window.__SAVE.load().touchOffset;
  }
  // 恢复：灵敏度 1.0 / 触控 36
  window.__SAVE.set('sensitivity', 1.0);
  window.__SAVE.set('touchOffset', 36);
  ms.closeSettings();
  return out;
});
push('设置面板灵敏度滑杆存在', settings.sensSlider === true, '');
push('灵敏度滑杆拖动到上限 → sensitivity=1.5', Math.abs((settings.sensAfter || 0) - 1.5) < 1e-6, `v=${settings.sensAfter}`);
push('设置面板触控偏移开关存在', settings.touchBtn === true, '');
push('触控偏移开关点击 → touchOffset=0（可关）', settings.touchAfterOff === 0, `v=${settings.touchAfterOff}`);
push('设置面板语言开关存在', settings.langBtn === true, '');

// ── C3) 源码级：Player 拖动 lerp 系数 = 0.35 × sensitivity，封顶 0.6 ──
const playerSrc = fs.readFileSync(path.join(ROOT, 'src/entities/Player.js'), 'utf8');
const playerTxt = fs.readFileSync(path.join(ROOT, 'src/config/GameConfig.js'), 'utf8');
push('GameConfig.TOUCH 存在（OFFSET=36 / LERP_BASE=0.35 / LERP_CAP=0.6）',
  /TOUCH = \{[^}]*OFFSET: 36[^}]*LERP_BASE: 0\.35[^}]*LERP_CAP: 0\.6/s.test(playerTxt), '');
push('Player 拖动使用 TOUCH.OFFSET / TOUCH.LERP_BASE / TOUCH.LERP_CAP',
  /TOUCH\.LERP_BASE/.test(playerSrc) && /TOUCH\.LERP_CAP/.test(playerSrc) && /TOUCH\.OFFSET/.test(playerSrc), '');

// ── D2) 语言切换生效（UI 级）：点语言开关 → en → 菜单英文 → 再切回 zh ──
async function switchLangViaSettings() {
  await page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    ms.openSettings();
    if (ms._langBtn) ms._langBtn.container.emit('pointerdown');
  });
  await page.waitForFunction(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    return ms && ms.scene.isActive() && ms.title && ms.title.text;
  }, { timeout: 10000 });
  return page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    return { title: ms.title ? ms.title.text : '', save: ms.saveInfoText ? ms.saveInfoText.text : '' };
  });
}
const enUi = await switchLangViaSettings();
push('切换 English 后菜单标题 = SKY RAIDERS', enUi.title === 'SKY RAIDERS', `title=${enUi.title}`);
push('切换 English 后底部存档信息含 Coins', /Coins/.test(enUi.save), `save=${enUi.save}`);
const zhUi = await switchLangViaSettings();
push('切回中文后菜单标题 = 苍穹战机', zhUi.title === '苍穹战机', `title=${zhUi.title}`);

// ── A) bloom 按性能档开关（进 GameScene）──
async function enterGame(quality) {
  await page.evaluate((q) => {
    const g = window.__SKY__;
    const SM = window.__SAVE;
    SM.set('tutorialDone', true);
    SM.set('quality', q);
    ['MenuScene', 'UIScene', 'GameScene', 'ResultScene', 'HangarScene'].forEach((k) => {
      const sc = g.scene.getScene(k);
      if (sc && sc.scene.isActive()) g.scene.stop(k);
    });
    g.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  }, quality);
  await page.waitForFunction(() => {
    const gs = window.__SKY__.scene.getScene('GameScene');
    return gs && gs.scene.isActive() && gs.player && gs.player.active;
  }, { timeout: 20000 });
}
await enterGame('high');
await page.waitForTimeout(400); // 让 bloom update 跑几帧
const bloomHigh = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  const b = window.__BLOOM;
  return {
    webgl: window.__SKY__.renderer ? window.__SKY__.renderer.type === window.Phaser.WEBGL : false,
    hook: !!b,
    pipelines: b && b.pipelines ? b.pipelines.length : 0,
    hasBloom: !!(b && b.bloom),
    rt: !!(b && b.rt),
    sceneEnabled: !!(gs && gs.bloomFX && gs.bloomFX.enabled),
  };
});
push('渲染器为 WebGL（bloom 生效前提）', bloomHigh.webgl === true, `webgl=${bloomHigh.webgl}`);
push('high 档：window.__BLOOM 存在', bloomHigh.hook === true, '');
push('high 档：postFX bloom 管线节点 > 0', bloomHigh.pipelines > 0, `pipelines=${bloomHigh.pipelines}`);
push('high 档：Bloom FX 控制器存在', bloomHigh.hasBloom === true, '');
push('high 档：GameScene.bloomFX.enabled', bloomHigh.sceneEnabled === true, '');

await enterGame('low');
await page.waitForTimeout(300);
const bloomLow = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return { hook: !!window.__BLOOM, sceneEnabled: !!(gs && gs.bloomFX && gs.bloomFX.enabled) };
});
push('low 档：window.__BLOOM 不存在（已关）', bloomLow.hook === false, '');
push('low 档：GameScene.bloomFX 未启用', bloomLow.sceneEnabled === false, '');

// ── B) BGM 4 轨 sequencer（运行时：音频单例 + 源码级）──
const bgm = await page.evaluate(() => {
  const A = window.__AUDIO;
  if (!A) return { missing: true };
  A.resume();
  A.startBgm('stage');
  const st = A.getBgmState();
  A.startBgm('boss');
  const bs = A.getBgmState();
  A.stopBgm();
  const stopped = A.getBgmState();
  return { missing: false, st, bs, stopped };
});
const audioSrc = fs.readFileSync(path.join(ROOT, 'src/systems/AudioSystem.js'), 'utf8');
push('AudioSystem 暴露 audio 单例（window.__AUDIO）', bgm.missing === false, '');
push('BGM 4 轨：bass/lead/arp/drums 全在 tracks',
  !!bgm.st && ['bass', 'lead', 'arp', 'drums'].every((tr) => bgm.st.tracks.includes(tr)),
  `tracks=${bgm.st ? bgm.st.tracks.join(',') : 'none'}`);
push('BGM stage 段 running + BPM>0', bgm.st && bgm.st.running === true && bgm.st.bpm > 0, `bpm=${bgm.st && bgm.st.bpm}`);
push('BGM boss 段 running + BPM 更快', bgm.bs && bgm.bs.running === true && bgm.bs.bpm > bgm.st.bpm, `stage=${bgm.st && bgm.st.bpm} boss=${bgm.bs && bgm.bs.bpm}`);
push('BGM 可关闭（stopBgm 后 running=false）', bgm.stopped && bgm.stopped.running === false, '');
push('源码：lookahead 调度 _scheduleBgm / _bgmTone / _bgmKick / _bgmHat',
  /_scheduleBgm/.test(audioSrc) && /_bgmTone/.test(audioSrc) && /_bgmKick/.test(audioSrc) && /_bgmHat/.test(audioSrc), '');
push('源码：BGM 模板含 stage/boss 变奏',
  /BGM_THEMES\s*=\s*\{/.test(audioSrc) && /stage:\s*\{/.test(audioSrc) && /boss:\s*\{/.test(audioSrc), '');
push('源码：BGM 走 bgmGain（与音效 sfxGain 分离）', (audioSrc.match(/\.connect\(this\.bgmGain\)/g) || []).length >= 3, '');
push('源码：音效密集 BGM 避让 _duckBgm', /_duckBgm/.test(audioSrc), '');

// ── E) 零 pageerror / console.error ──
push('零 pageerror / console.error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');

await browser.close();

const pass = checks.every((c) => c.ok);
const failed = checks.filter((c) => !c.ok);
console.log('---');
if (failed.length) console.log('FAILED: ' + failed.map((c) => c.name).join('; '));
console.log(pass ? 'QA_P1_POLISH: PASS' : 'QA_P1_POLISH: FAIL');
process.exit(pass ? 0 : 1);
