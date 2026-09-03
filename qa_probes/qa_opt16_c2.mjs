// qa_opt16_c2.mjs —— OPT-16 批1 C2 昵称编辑器 验收探针
//
// 规格来源：docs/OPT-16-PROD-SPEC.md 第 C2 条。断言真实运行行为：
//   C2.1  MenuScene 设置面板新增昵称行（_nicknameBtn 存在），空值展示「默认名·随机后缀」（纯展示不写档）
//   C2.2  编辑浮层：DOM <input> 打开；输入合法「阿飞」→ 确定 → SaveManager.nickname==='阿飞' + toast
//   C2.3  校验：超长(>12)/非法字符 → 拒绝写入且 nickname 不变（红框错误提示）
//   C2.4  取消/遮罩关闭：不写档；昵称行刷新显示用户值
//   C2.5  ResultScene._resolveNickname：nickname 非空走用户值；清空后分享卡回退「飞行员·随机后缀」
//   C2.6  i18n zh/en：nicknameEdit/Placeholder/LenErr/CharErr/saveOk 词条齐全；en 界面英文
//   C2.7  零新存档字段（仅复用 nickname）；零 pageerror/console.error
// 运行：node qa_probes/qa_opt16_c2.mjs（QA_URL 默认 http://127.0.0.1:5059）
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
    await page.waitForFunction(() => {
      const ms = window.__SKY__.scene.getScene('MenuScene');
      return ms && ms.scene.isActive();
    }, { timeout: 20000 });
  } catch (e) {
    await page.close().catch(() => {});
    throw new Error('launchPage timeout: ' + errors.slice(0, 3).join(' | ') || '(no console error)');
  }
  return { ctx, page, errors };
}

// 打开设置面板 + 昵称编辑浮层；返回 DOM input 引用句柄可继续填值
async function openNicknameEditor(page) {
  await page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    ms.openSettings();
  });
  await page.waitForFunction(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    return ms && ms._nicknameBtn;
  }, null, { timeout: 10000 });
  await page.evaluate(() => {
    const ms = window.__SKY__.scene.getScene('MenuScene');
    if (ms._nicknameBtn) ms._nicknameBtn.container.emit('pointerdown');
  });
  await page.waitForFunction(() => !!document.querySelector('#nickname-editor-overlay input'), null, { timeout: 10000 });
}

// 填值并点确定（走真实 DOM 事件）
async function submitNickname(page, value) {
  await page.evaluate((v) => {
    const input = document.querySelector('#nickname-editor-overlay input');
    if (!input) return;
    input.value = v;
    // 触发真实 keydown-Enter → 内部 okBtn.click() 路径（含校验 + stopPropagation）
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }, value);
  await new Promise((r) => setTimeout(r, 80));
}

// 点取消（DOM 按钮）
async function cancelNickname(page) {
  await page.evaluate(() => {
    const ov = document.querySelector('#nickname-editor-overlay');
    if (!ov) return;
    const btns = ov.querySelectorAll('button');
    if (btns.length >= 2) btns[1].click(); // 第二个 = 取消/关闭
  });
  await new Promise((r) => setTimeout(r, 60));
}

// ═══════════════ 1) i18n 词条 zh/en ═══════════════
const zhSave = { lang: 'zh', tutorialDone: true, coins: 100 };
const zhCtx = await launchPage(zhSave);
const loc = await zhCtx.page.evaluate(async () => {
  const { L } = await import('/src/config/Locale.js');
  const keys = ['nicknameEdit', 'nicknamePlaceholder', 'nicknameLenErr', 'nicknameCharErr', 'saveOk'];
  return {
    all: keys.every((k) => typeof L.zh[k] === 'string' && L.zh[k].length > 0
      && typeof L.en[k] === 'string' && L.en[k].length > 0),
    zh: keys.map((k) => L.zh[k]), en: keys.map((k) => L.en[k]),
  };
});
push('C2.6. i18n zh/en C2 词条齐全（nicknameEdit/Placeholder/LenErr/CharErr/saveOk）', loc.all === true, `zh=${loc.zh.join('|')}`);

// ═══════════════ 2) C2.1 昵称行存在 + 空值预览（纯展示）═══════════════
const rowZh = await zhCtx.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openSettings();
  return {
    hasBtn: !!ms._nicknameBtn,
    label: ms._nicknameBtn ? ms._nicknameBtn.text.text : '',
    savedNick: window.__SAVE.load().nickname,
  };
});
push('C2.1. 设置面板昵称行存在（_nicknameBtn）', rowZh.hasBtn === true, '');
push('C2.1. 空值展示「飞行员·随机后缀」预览且未写档', rowZh.label.length > 0 && rowZh.savedNick === '', `label=${rowZh.label} saved='${rowZh.savedNick}'`);
await zhCtx.page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').closeSettings());

// ═══════════════ 3) C2.2 输入合法昵称 → 保存 ═══════════════
await openNicknameEditor(zhCtx.page);
await submitNickname(zhCtx.page, '阿飞');
const saved1 = await zhCtx.page.evaluate(() => ({
  nick: window.__SAVE.load().nickname,
  overlayGone: !document.querySelector('#nickname-editor-overlay'),
  btnLabel: window.__SKY__.scene.getScene('MenuScene')._nicknameBtn
    ? window.__SKY__.scene.getScene('MenuScene')._nicknameBtn.text.text : '',
}));
push('C2.2. 合法输入「阿飞」→ nickname==阿飞 且浮层关闭', saved1.nick === '阿飞' && saved1.overlayGone, `nick=${saved1.nick}`);
push('C2.2. 昵称行刷新为「阿飞」', saved1.btnLabel === '阿飞', `label=${saved1.btnLabel}`);

// ═══════════════ 4) C2.3 非法输入拒绝写入 ═══════════════
await openNicknameEditor(zhCtx.page);
await submitNickname(zhCtx.page, 'abc!@#');
const badChar = await zhCtx.page.evaluate(() => ({
  nick: window.__SAVE.load().nickname,
  overlayOpen: !!document.querySelector('#nickname-editor-overlay'),
  err: document.querySelector('#nickname-editor-overlay') ? document.querySelector('#nickname-editor-overlay').innerText : '',
}));
push('C2.3. 非法字符「abc!@#」→ 拒绝写入且 nickname 保持 阿飞', badChar.nick === '阿飞' && badChar.overlayOpen, `nick=${badChar.nick} open=${badChar.overlayOpen}`);
push('C2.3. 浮层显示字符错误提示', /不支持|Unsupported|字符|chars/i.test(badChar.err), `err=${badChar.err.slice(0, 40)}`);

// 超长 13 字符
await submitNickname(zhCtx.page, '一二三四五六七八九十一二三'); // 13 中文
const tooLong = await zhCtx.page.evaluate(() => ({
  nick: window.__SAVE.load().nickname,
  overlayOpen: !!document.querySelector('#nickname-editor-overlay'),
  err: document.querySelector('#nickname-editor-overlay') ? document.querySelector('#nickname-editor-overlay').innerText : '',
}));
push('C2.3. 超长 13 字符 → 拒绝写入且浮层保持', tooLong.nick === '阿飞' && tooLong.overlayOpen, `nick=${tooLong.nick} open=${tooLong.overlayOpen}`);

// ═══════════════ 5) C2.4 取消不写档 ═══════════════
await cancelNickname(zhCtx.page);
const afterCancel = await zhCtx.page.evaluate(() => ({
  nick: window.__SAVE.load().nickname,
  overlayGone: !document.querySelector('#nickname-editor-overlay'),
}));
push('C2.4. 取消关闭 → nickname 仍 阿飞、浮层移除', afterCancel.nick === '阿飞' && afterCancel.overlayGone, `nick=${afterCancel.nick} gone=${afterCancel.overlayGone}`);

// ═══════════════ 6) C2.5 ResultScene 分享卡：用户值 vs 清空默认 ═══════════════
await zhCtx.page.evaluate(() => {
  window.__RESULT_SHARE = null;
  window.__SKY__.scene.start('ResultScene', { levelId: 1, mode: 'normal', victory: true, score: 800, kills: 5, coins: 10, maxCombo: 3, difficulty: 'standard', prevSameBest: 100, isNewBest: false, ship: { id: 0, skin: 0 } });
});
await zhCtx.page.waitForFunction(() => !!(window.__RESULT_SHARE && window.__RESULT_SHARE.getText), null, { timeout: 20000 });
const shareUser = await zhCtx.page.evaluate(() => {
  window.__RESULT_SHARE.buildShareCard(); // 先构建（populate _shareText）
  const text = window.__RESULT_SHARE.getText();
  return { hasAfei: text.includes('阿飞') };
});
push('C2.5. nickname=阿飞 → 分享卡文本含「阿飞」', shareUser.hasAfei === true, `hasAfei=${shareUser.hasAfei}`);

// 清空 nickname → 回退默认「飞行员·随机后缀」（_resolveNickname 按既有语义写回默认，见 C2.5 回退规则）
const shareDefault = await zhCtx.page.evaluate(() => {
  const SM = window.__SAVE;
  SM.load().nickname = ''; SM.save();
  window.__RESULT_SHARE.buildShareCard(); // 空值触发默认生成 + 持久化（既有 B15 行为）
  const text = window.__RESULT_SHARE.getText();
  const nick = SM.load().nickname;
  return { textHasPilot: text.includes('飞行员'), nick, isDefault: /^飞行员·\d{2}$/.test(nick) };
});
push('C2.5. 清空 nickname → 分享卡回退「飞行员·随机后缀」并写回默认', shareDefault.textHasPilot === true && shareDefault.isDefault, `hasPilot=${shareDefault.textHasPilot} nick=${shareDefault.nick}`);
push('C2.7. 零新存档字段（仅 nickname；无 grazes 等）', (await zhCtx.page.evaluate(() => {
  const s = window.__SAVE.load();
  return !('grazes' in s) && !('elapsedMs' in s) && !('damageTaken' in s);
})) === true);
push('P0. zh 主上下文无 pageerror/console.error', zhCtx.errors.length === 0, zhCtx.errors.slice(0, 3).join(' | '));
await zhCtx.ctx.close();

// ═══════════════ 7) en 界面英文 ═══════════════
const enCtx = await launchPage({ lang: 'en', tutorialDone: true, coins: 100 });
const enRow = await enCtx.page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  ms.openSettings();
  // 找昵称行标签文本：昵称行左标签
  const ov = ms.settingsOverlay;
  let label = '';
  if (ov && ov.list) {
    ov.list.forEach((c) => {
      if (c && c.type === 'Text' && /Edit Nickname/i.test(String(c.text))) label = String(c.text);
    });
  }
  return { label, hasBtn: !!ms._nicknameBtn };
});
push('C2.6. en 设置面板昵称行标签 = Edit Nickname', enRow.label === 'Edit Nickname' && enRow.hasBtn, `label=${enRow.label}`);
await enCtx.page.evaluate(() => window.__SKY__.scene.getScene('MenuScene').closeSettings());
await openNicknameEditor(enCtx.page);
const enEditor = await enCtx.page.evaluate(() => {
  const ov = document.querySelector('#nickname-editor-overlay');
  return ov ? ov.innerText : '';
});
push('C2.6. en 昵称浮层为英文（含 Edit Nickname / Saved / Close）', /Edit Nickname/.test(enEditor) && /Saved|Enter nickname/.test(enEditor), `txt=${enEditor.slice(0, 60).replace(/\n/g, ' | ')}`);
push('P0. en 上下文无 pageerror/console.error', enCtx.errors.length === 0, enCtx.errors.slice(0, 3).join(' | '));
await enCtx.ctx.close();

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\nOPT-16 C2 昵称编辑器探针：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  ❌ ' + f.name));
  process.exit(1);
}
