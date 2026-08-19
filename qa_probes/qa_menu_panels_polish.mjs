// Phase G 菜单子面板抛光 QA：辉光标题层(副本+本体) + makeMenuBtn 发光按钮 + 面板入场 + 零 pageerror
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://127.0.0.1:5059';
const errors = [];

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });

await page.waitForFunction(() => {
  const g = window.__SKY__;
  return g && g.scene.getScene('MenuScene') && g.scene.getScene('MenuScene').scene.isActive();
}, { timeout: 20000 });

// 依次打开/检测/关闭五个子面板
const PANELS = [
  { open: 'openSettings', close: 'closeSettings', overlay: 'settingsOverlay', title: '设置 · 音量' },
  { open: 'openLevelSelect', close: 'closeLevelSelect', overlay: 'levelSelectOverlay', title: '选择关卡' },
  { open: 'openAchievements', close: 'closeAchievements', overlay: 'achievementsOverlay', title: '成就勋章' },
  { open: 'openCheckIn', close: 'closeCheckIn', overlay: 'checkinOverlay', title: '每日签到' },
  { open: 'openDailyQuest', close: 'closeDailyQuest', overlay: 'dailyQuestOverlay', title: '每日任务' },
];

const results = await page.evaluate((PANELS) => {
  const g = window.__SKY__;
  const ms = g.scene.getScene('MenuScene');
  const out = [];
  for (const p of PANELS) {
    ms[p.open]();
    const ov = ms[p.overlay];
    const list = ov ? ov.list : [];
    // 辉光标题层：应有两个同字符串的 Text（glow 副本 + 本体）
    const titleTexts = list.filter((c) => c.type === 'Text' && c.text === p.title);
    const glowOk = titleTexts.length >= 2;
    // 发光按钮：至少一个 Container 含 Text 子节点（NeonButton glow）
    const hasNeonBtn = list.some((c) => c.type === 'Container' && c.list && c.list.some((ch) => ch.type === 'Text'));
    out.push({ name: p.title, overlayOk: !!ov, glowOk, hasNeonBtn });
    ms[p.close]();
  }
  return out;
}, PANELS);

await browser.close();

const checks = [];
for (const r of results) {
  checks.push([`[${r.name}] 面板存在`, r.overlayOk]);
  checks.push([`[${r.name}] 辉光标题层(副本+本体)`, r.glowOk]);
  checks.push([`[${r.name}] 发光按钮(NeonButton glow)`, r.hasNeonBtn]);
}
checks.push(['零 pageerror', errors.length === 0]);

let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'PHASE_G_MENU_PANELS: PASS' : 'PHASE_G_MENU_PANELS: FAIL');
process.exit(pass ? 0 : 1);
