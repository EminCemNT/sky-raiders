// qa_opt17_p4_overlap.mjs —— OPT-17 B 批 P4 防回归探针（浮动文本不再压按钮）
// ---------------------------------------------------------------------------
// 背景：walk 截图复盘发现主菜单两个浮动文本压字真 bug：
//   - leagueText（本周赛 · 殿堂 N 名 · 周结剩 N 天）原 y=520 与机库按钮顶 519 重叠 9px
//   - eventLeft（剩余 N 天 · 双倍奖励）原 y=772 与关卡选择按钮顶 771 重叠 8px
// 修复：把两个浮动文本改为所属按钮 container 内的子文本（fontSize 13→10、y=20 容器内偏移），
//       并以 this.add.text 创建后立即 endlessBtn.container.add(this.leagueText) 将其从
//       scene.children 转移到按钮 container 内，根除与下一行按钮的几何重叠。
// 探针断言（程序化）：
//   1) MenuScene 顶层 children.list 不再含 y≈520 的 leagueText 与 y≈772 的 eventLeft
//   2) leagueText 现嵌在无尽按钮 container（OPT-18 P2 后 x=cx+116=386, y=360）内，相对 y=20
//   3) eventLeft 现嵌在活动按钮 container（OPT-18 P2 后「战斗」页签第 3 槽 x=270, y=676）内，相对 y=20
//   4) 当前**可见** NeonButton 矩形无几何重叠（分组页签下非当前页签按钮 visible=false，不参与）
//   5) [OPT-18 P2 新增] 所有可见按钮矩形底 ≤ 900，不侵入底部存档信息(y=916)/操作提示(y=940) 文本带
// 运行：node qa_probes/qa_opt17_p4_overlap.mjs（QA_URL 默认 5059）
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAVE_KEY = 'sky_raiders_save_v1';

const checks = [];
const push = (name, ok, detail = '') => { checks.push({ name, ok }); console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : '')); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'],
});
const viewport = { width: 540, height: 960 };
const SAVE = {
  version: 1, lang: 'zh', tutorialDone: true, quality: 'high',
  coins: 99999, bestScore: 420000, unlockedLevel: 4,
  selectedShip: 0, skins: {}, ownedSkins: [],
  nickname: '爸爸', haptics: true, muted: false,
  dailyChallenge: { date: '', bestScore: 0, cleared: false, claimed: false },
};

const ctx = await browser.newContext({ viewport });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await page.addInitScript(({ key, save }) => {
  try { localStorage.setItem(key, JSON.stringify(save)); } catch (e) {}
}, { key: SAVE_KEY, save: SAVE });
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  return ms && ms.scene.isActive();
}, null, { timeout: 20000 });
await page.waitForTimeout(900);

const diag = await page.evaluate(() => {
  const ms = window.__SKY__.scene.getScene('MenuScene');
  // 收集所有 NeonButton 容器（每个按钮 container.name === 'neon-button'，NeonButton 构造时设）
  const buttons = [];
  ms.children.list.forEach((o) => {
    // OPT-18 P2 / U1：主菜单改为分组页签后，非当前页签的按钮仍在场景树内但 visible=false。
    // 几何重叠检测只针对**当前可见**按钮（跨页签按钮本就同槽位重叠，属预期）。
    if (o && o.name === 'neon-button' && o.visible) {
      // 取按钮主 label（NeonButton.list 中 text 类型对象）
      let label = '';
      o.list.forEach((c) => {
        if (c && typeof c.text === 'string' && c.fontSize && parseInt(c.fontSize, 10) >= 18) label = c.text;
      });
      buttons.push({ x: o.x, y: o.y, w: o.width, h: o.height, label });
    }
  });
  // 顶层 children 文本对象列表（不包括按钮 container 内部文本）
  const topTexts = [];
  ms.children.list.forEach((o) => {
    if (o && typeof o.text === 'string') {
      topTexts.push({ y: o.y, text: o.text.slice(0, 40) });
    }
  });
  // 找两个嵌入文本：leagueText(eventLeftText 类似) 在哪个按钮 container 内
  let leagueInButton = null;
  let eventLeftInButton = null;
  ms.children.list.forEach((o) => {
    if (o && o.name === 'neon-button') {
      o.list.forEach((c) => {
        if (c && typeof c.text === 'string') {
          // Phaser text 把 fontSize 存在 style.fontSize（字符串如 '10px'），先归一化为数字
          const fs = c.style && c.style.fontSize ? parseInt(c.style.fontSize, 10) : NaN;
          if (/本周赛|周结剩|本周赛 · 当前第/.test(c.text) || /本周赛|周结剩|本周赛 · 当前第/.test(c.text)) {
            leagueInButton = { btnX: o.x, btnY: o.y, childY: c.y, fontSize: fs, text: c.text.slice(0, 40) };
          }
          if (/剩余.*天|今日双倍|周末双倍|双倍奖励/.test(c.text)) {
            eventLeftInButton = { btnX: o.x, btnY: o.y, childY: c.y, fontSize: fs, text: c.text.slice(0, 40) };
          }
        }
      });
    }
  });
  // 按钮矩形两两几何重叠检测（任何重叠都报错）
  const overlaps = [];
  for (let i = 0; i < buttons.length; i++) {
    for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i], b = buttons[j];
      const ax1 = a.x - a.w / 2, ay1 = a.y - a.h / 2;
      const ax2 = a.x + a.w / 2, ay2 = a.y + a.h / 2;
      const bx1 = b.x - b.w / 2, by1 = b.y - b.h / 2;
      const bx2 = b.x + b.w / 2, by2 = b.y + b.h / 2;
      if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
        overlaps.push({ a: a.label || `(${a.x},${a.y})`, b: b.label || `(${b.x},${b.y})` });
      }
    }
  }
  return { buttonCount: buttons.length, buttons, topTexts, leagueInButton, eventLeftInButton, overlaps };
});

// 验证 1：顶层 children 中 y≈520（490~545）不应再有 leagueText
const leagueFloating = diag.topTexts.filter((t) => t.y >= 490 && t.y <= 545 && (/本周赛|周结剩|殿堂/.test(t.text)));
push('顶层 children 不再含独立 leagueText（y≈520 区间）',
  leagueFloating.length === 0,
  leagueFloating.map((t) => `y=${t.y}:"${t.text}"`).join(' | ') || '✓ 清洁');

// 验证 2：顶层 children 中 y≈772（760~790）不应再有 eventLeft
const eventFloating = diag.topTexts.filter((t) => t.y >= 760 && t.y <= 790 && (/剩余.*天|今日双倍|双倍奖励/.test(t.text)));
push('顶层 children 不再含独立 eventLeftText（y≈772 区间）',
  eventFloating.length === 0,
  eventFloating.map((t) => `y=${t.y}:"${t.text}"`).join(' | ') || '✓ 清洁');

// 验证 3：leagueText 已嵌入无尽按钮 container（OPT-18 P2 后按钮上移 → cx+116=386, y=360, 相对子文本 y=20）
push('leagueText 嵌入无尽按钮（btnX=386,btnY=360,childY≈20）',
  !!diag.leagueInButton && diag.leagueInButton.btnX === 386 && diag.leagueInButton.btnY === 360 && Math.abs(diag.leagueInButton.childY - 20) <= 1,
  diag.leagueInButton ? `btn=(${diag.leagueInButton.btnX},${diag.leagueInButton.btnY}) childY=${diag.leagueInButton.childY} fontSize=${diag.leagueInButton.fontSize} text="${diag.leagueInButton.text}"` : '未在按钮内找到 leagueText');

// 验证 4：eventLeftText 嵌入活动按钮 container
// （OPT-18 P2 后「本周活动」归入「战斗」页签第 3 槽：x=cx=270, y=512+2*82=676；相对子文本 y=20）
push('eventLeftText 嵌入活动按钮（btnX=270,btnY=676,childY≈20）',
  !!diag.eventLeftInButton && diag.eventLeftInButton.btnX === 270 && diag.eventLeftInButton.btnY === 676 && Math.abs(diag.eventLeftInButton.childY - 20) <= 1,
  diag.eventLeftInButton ? `btn=(${diag.eventLeftInButton.btnX},${diag.eventLeftInButton.btnY}) childY=${diag.eventLeftInButton.childY} fontSize=${diag.eventLeftInButton.fontSize} text="${diag.eventLeftInButton.text}"` : '未在按钮内找到 eventLeftText');

// 验证 5：子文本字号 = 10（原 13）
push('leagueText 字号 10（原 13）', !!diag.leagueInButton && diag.leagueInButton.fontSize === 10, `fontSize=${diag.leagueInButton && diag.leagueInButton.fontSize}`);
push('eventLeftText 字号 10（原 13）', !!diag.eventLeftInButton && diag.eventLeftInButton.fontSize === 10, `fontSize=${diag.eventLeftInButton && diag.eventLeftInButton.fontSize}`);

// 验证 6：当前可见 NeonButton 矩形无几何重叠（OPT-18 P2 分组页签后只统计可见按钮）
push('当前可见 NeonButton 矩形无重叠',
  diag.overlaps.length === 0,
  diag.overlaps.length ? diag.overlaps.map((o) => `${o.a} ↔ ${o.b}`).join(' | ') : `${diag.buttonCount} 个可见按钮零重叠`);

// 验证 7（OPT-18 P2 / U1 新增）：按钮带不得侵入底部「存档信息 / 操作提示」文本带。
// 存档信息 y=916（16px → 顶约 908）、操作提示 y=940（13px → 顶约 933）；
// 故要求所有可见按钮矩形底 ≤ 900。此项锁死原「底部按钮贴边压字」真缺陷。
const maxBtnBottom = diag.buttons.reduce((m, b) => Math.max(m, b.y + b.h / 2), 0);
push('可见按钮矩形底 ≤ 900（与底部文本带留安全间隙）',
  maxBtnBottom > 0 && maxBtnBottom <= 900,
  `按钮最大底 = ${maxBtnBottom.toFixed(1)}（存档信息 y=916 / 操作提示 y=940）`);

push('P0. 无 pageerror/console.error', errors.length === 0, errors.slice(0, 3).join(' | '));

// 截图留档（对比 opt17_walk/shot_01_menu.png 的修复前观感）
await page.screenshot({ path: 'shots/opt17_walk/shot_01_menu_p4.png' });
console.log('📸 shot_01_menu_p4.png');

const fails = checks.filter((c) => !c.ok);
console.log(`\n═══ P4 防回归：${checks.length - fails.length}/${checks.length} 通过 ═══`);
await browser.close();
process.exit(fails.length ? 1 : 0);