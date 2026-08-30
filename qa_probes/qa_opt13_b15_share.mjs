// qa_opt13_b15_share.mjs —— OPT-13 批B B15 分享卡升级 验收探针
//
// 验证（规格：ARCH-SPEC 第 B15 条 + PM 第 3 条 G/W/T）：
//   1) SaveManager append-only：nickname/lastScore/prevScore（DEFAULT_SAVE/freshSave/load 三处 + 老存档兜底）
//   2) i18n zh/en 词条：nicknameLabel / nicknameDefault / shareVsLast / shareFirstRun / shareDiffLabel
//   3) 昵称：存档已保存「阿飞」→ 画布/文本包含「阿飞」；未设置 → 生成「飞行员·随机后缀」并持久化（3.1）
//   4) 称号：已解锁称号 → 画布/文本包含称号名（与结算页一致）（3.2）
//   5) 主题背景：第 3 关 theme skyTop/skyBottom → canvas 像素抽样（3.3）
//   6) 历史对比：本局 > 历史 → 比上次 +X%（pct=向上取整）；破纪录 → ★新纪录（3.4）
//   7) 历史对比：无历史 → 首秀，不显示百分比（3.5）
//   8) 难度边框强调色：hard 橙 / hell 红 / standard 默认青
//   9) copyShareText 文本摘要同步昵称/称号/对比行；__RESULT_SHARE 钩子兼容（540×720）
//  10) 零 pageerror / console error
import { chromium } from 'playwright';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};
const near = (a, b, tol) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((v, i) => Math.abs(v - b[i]) <= tol);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

// 启动前预置「老存档形状」：不含 B15 新字段（nickname/lastScore/prevScore），
// 验证 SaveManager.load() 对老存档的兜底；同时强制 lang='zh' 保证中文文案断言确定性。
await page.addInitScript(() => {
  try {
    localStorage.setItem('sky_raiders_save_v1', JSON.stringify({ lang: 'zh', coins: 5 }));
  } catch (e) { /* ignore */ }
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, { timeout: 20000 });

// ── 1) SaveManager append-only 字段 ──
const sv = await page.evaluate(async () => {
  const SaveManager = window.__SAVE; // 必须用游戏实例，规避 vite ?t= 双模块陷阱
  const loaded = SaveManager.load(); // 老存档兜底
  const oldShape = { nickname: loaded.nickname, lastScore: loaded.lastScore, prevScore: loaded.prevScore };
  SaveManager.reset();
  const fresh = SaveManager.load();
  const freshShape = { nickname: fresh.nickname, lastScore: fresh.lastScore, prevScore: fresh.prevScore };
  return { oldShape, freshShape };
});
push('老存档 load() 兜底：nickname/lastScore/prevScore 默认（\'\'/0/0）',
  sv.oldShape.nickname === '' && sv.oldShape.lastScore === 0 && sv.oldShape.prevScore === 0,
  `nick=${JSON.stringify(sv.oldShape.nickname)} last=${sv.oldShape.lastScore} prev=${sv.oldShape.prevScore}`);
push('freshSave 含 B15 三字段（append-only）',
  sv.freshShape.nickname === '' && sv.freshShape.lastScore === 0 && sv.freshShape.prevScore === 0);

// ── 2) i18n zh/en 词条 ──
const loc = await page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  return ['nicknameLabel', 'nicknameDefault', 'shareVsLast', 'shareFirstRun', 'shareDiffLabel']
    .every((k) => typeof L.zh[k] === 'string' && L.zh[k].length > 0
      && typeof L.en[k] === 'string' && L.en[k].length > 0);
});
push('i18n zh/en B15 词条齐全（nicknameLabel/nicknameDefault/shareVsLast/shareFirstRun/shareDiffLabel）', loc === true);

// 工具：以指定 result 启动 ResultScene（置空旧钩子 → 等新 create() 挂载）
const startResult = async (resultData) => {
  await page.evaluate((data) => {
    window.__RESULT_SHARE = null;
    window.__SKY__.scene.start('ResultScene', data);
    return true;
  }, resultData);
  await page.waitForFunction(() => !!(window.__RESULT_SHARE && window.__RESULT_SHARE.getText), null, { timeout: 20000 });
};

// ── 3) 昵称（3.1）：已保存「阿飞」→ 画布/文本包含；未设置 → 默认「飞行员·随机后缀」并持久化 ──
await startResult({ levelId: 3, mode: 'normal', victory: true, score: 1200, kills: 5, coins: 30, maxCombo: 3, difficulty: 'standard', prevSameBest: 1000, isNewBest: false, ship: { id: 0, skin: 0 } });
const nickSaved = await page.evaluate(async () => {
  const SaveManager = window.__SAVE;
  SaveManager.load().nickname = '阿飞'; SaveManager.save();
  const hook = window.__RESULT_SHARE;
  const canvas = hook.buildShareCard(); // 无参调用 → 钩子兼容 + 内部现算
  const text = hook.getText();
  return {
    sizeOk: !!canvas && canvas.width === 540 && canvas.height === 720,
    hasNick: text.includes('阿飞'),
    hasLabel: text.includes('昵称'),
  };
});
push('昵称（3.1）：存档已保存「阿飞」→ 画布 540×720 且文本包含「阿飞」',
  nickSaved.sizeOk && nickSaved.hasNick && nickSaved.hasLabel,
  `hasNick=${nickSaved.hasNick} label=${nickSaved.hasLabel}`);

const nickDefault = await page.evaluate(async () => {
  const SaveManager = window.__SAVE;
  const hook = window.__RESULT_SHARE;
  SaveManager.load().nickname = ''; SaveManager.save(); // 清空 → 触发默认生成
  hook.buildShareCard();
  const nick = SaveManager.load().nickname;
  const text = hook.getText();
  return { nick, persisted: typeof nick === 'string' && /^飞行员·\d{2}$/.test(nick), textHasPilot: text.includes('飞行员') };
});
push('昵称（3.1）：未设置 → 生成「飞行员·随机后缀」并持久化到 SaveManager.nickname',
  nickDefault.persisted && nickDefault.textHasPilot, `nick=${nickDefault.nick}`);

// ── 4) 称号（3.2）：已解锁称号 → 文本包含（与结算页一致）──
const titleRes = await page.evaluate(async () => {
  const SaveManager = window.__SAVE;
  const hook = window.__RESULT_SHARE;
  SaveManager.load().levelStars = { 1: 3 }; SaveManager.save(); // 解锁 title_rookie → 苍穹新兵
  hook.buildShareCard();
  const text = hook.getText();
  return { hasRookie: text.includes('苍穹新兵') };
});
push('称号（3.2）：已解锁 title_rookie → 文本包含「苍穹新兵」', titleRes.hasRookie === true);

// ── 5) 主题背景（3.3）：第 3 关 theme skyTop/skyBottom 像素抽样 ──
await startResult({ levelId: 3, mode: 'normal', victory: true, score: 1200, kills: 5, coins: 30, maxCombo: 3, difficulty: 'standard', prevSameBest: 1000, isNewBest: false, ship: { id: 0, skin: 0 } });
const themeRes = await page.evaluate(async () => {
  const hook = window.__RESULT_SHARE;
  const canvas = hook.buildShareCard();
  const ctx = canvas.getContext('2d');
  const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
  return { top: px(270, 10), bottom: px(270, 710), border: px(16, 100) };
});
push('主题背景（3.3）：第 3 关 skyTop 像素 ≈ #1a0f33',
  near(themeRes.top, [0x1a, 0x0f, 0x33], 8), `got=${themeRes.top.join(',')}`);
push('主题背景（3.3）：第 3 关 skyBottom 像素 ≈ #070414',
  near(themeRes.bottom, [0x07, 0x04, 0x14], 8), `got=${themeRes.bottom.join(',')}`);

// ── 8) 难度边框强调色（standard 默认青）──
push('难度边框（standard）→ 默认青 #7cf3ff',
  near(themeRes.border, [0x7c, 0xf3, 0xff], 8), `got=${themeRes.border.join(',')}`);

// hard → 橙
await startResult({ levelId: 1, mode: 'normal', victory: true, score: 800, kills: 5, coins: 30, maxCombo: 2, difficulty: 'hard', prevSameBest: 0, isNewBest: false, ship: { id: 0, skin: 0 } });
const diffHard = await page.evaluate(async () => {
  const hook = window.__RESULT_SHARE;
  const ctx = hook.buildShareCard().getContext('2d');
  const d = ctx.getImageData(16, 100, 1, 1).data;
  return [d[0], d[1], d[2]];
});
push('难度边框强调色：hard → 橙 #ff7a3a', near(diffHard, [0xff, 0x7a, 0x3a], 8), `got=${diffHard.join(',')}`);

// hell → 红
await startResult({ levelId: 1, mode: 'normal', victory: true, score: 800, kills: 5, coins: 30, maxCombo: 2, difficulty: 'hell', prevSameBest: 0, isNewBest: false, ship: { id: 0, skin: 0 } });
const diffHell = await page.evaluate(async () => {
  const hook = window.__RESULT_SHARE;
  const ctx = hook.buildShareCard().getContext('2d');
  const d = ctx.getImageData(16, 100, 1, 1).data;
  return [d[0], d[1], d[2]];
});
push('难度边框强调色：hell → 红 #ff5566', near(diffHell, [0xff, 0x55, 0x66], 8), `got=${diffHell.join(',')}`);

// ── 6) 历史对比（3.4）：本局 > 历史 → 比上次 +X%（ceil）+ 破纪录 ★新纪录 ──
await startResult({ levelId: 1, mode: 'normal', victory: true, score: 1200, kills: 5, coins: 30, maxCombo: 2, difficulty: 'standard', prevSameBest: 1000, isNewBest: true, ship: { id: 0, skin: 0 } });
const histUp = await page.evaluate(async () => {
  const hook = window.__RESULT_SHARE;
  hook.buildShareCard();
  const text = hook.getText();
  return { hasVs: text.includes('比上次 +20%'), hasRecord: text.includes('★新纪录'), hasLabel: text.includes('历史对比') };
});
push('历史对比（3.4）：score 1200 vs 历史 1000 → 「比上次 +20%」（ceil）',
  histUp.hasVs === true, `hasVs=${histUp.hasVs}`);
push('历史对比（3.4）：破纪录 → 追加「★新纪录」', histUp.hasRecord === true);
push('文本摘要含「历史对比」行', histUp.hasLabel === true);

// ── 7) 历史对比（3.5）：无历史 → 首秀，不显示百分比 ──
await startResult({ levelId: 1, mode: 'normal', victory: true, score: 500, kills: 5, coins: 30, maxCombo: 2, difficulty: 'standard', prevSameBest: 0, isNewBest: true, ship: { id: 0, skin: 0 } });
const firstRun = await page.evaluate(async () => {
  const hook = window.__RESULT_SHARE;
  hook.buildShareCard();
  const text = hook.getText();
  return { hasFirst: text.includes('首秀'), noPct: !/比上次/.test(text), noErr: true };
});
push('历史对比（3.5）：无历史 → 「首秀」且不显示百分比', firstRun.hasFirst === true && firstRun.noPct === true);

// ── 9) __RESULT_SHARE 钩子兼容 + copyShareText 摘要同步 ──
const hookRes = await page.evaluate(async () => {
  const hook = window.__RESULT_SHARE;
  const names = Object.keys(hook).sort().join(',');
  let threw = false;
  try { await hook.copyShareText(); } catch (e) { threw = true; }
  const text = hook.getText();
  return { names, threw, textLen: text.length, hasShip: text.includes('战机') };
});
push('__RESULT_SHARE 钩子兼容（buildShareCard/downloadShareCard/copyShareText/getText/getCard）',
  hookRes.names === 'buildShareCard,copyShareText,downloadShareCard,getCard,getText',
  hookRes.names);
push('copyShareText 可调用不抛错且 _shareText 同步更新',
  hookRes.threw === false && hookRes.textLen > 0 && hookRes.hasShip === true, `len=${hookRes.textLen}`);

// ── 10) 全链路零 pageerror / console.error ──
push('零 pageerror / console error', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n==== B15 探针结果：${checks.length - failed.length}/${checks.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join(' ; '));
  process.exit(1);
}
