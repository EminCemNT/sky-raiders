import { chromium } from 'playwright';

const URL = 'http://localhost:5059/';
const V = 1.333; // 逻辑坐标 → 视口坐标（540x960 → 720x1280）
const errors = [];
const consoleErrs = [];

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=720,1280'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
page.on('pageerror', (e) => errors.push(e.stack || String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });

const tap = async (lx, ly, wait = 500) => {
  await page.mouse.click(Math.round(lx * V), Math.round(ly * V));
  await page.waitForTimeout(wait);
};

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shot_theme_menu.png' });

  // 设置弹窗
  await tap(270, 680);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shot_theme_settings.png' });
  await tap(270, 660); // 关闭

  // 选择关卡弹窗
  await tap(270, 760);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shot_theme_levelselect.png' });
  await tap(270, 640); // 关闭

  // 成就弹窗
  await tap(270, 616);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shot_theme_achievements.png' });
  await tap(270, 890); // 关闭

  // 每日签到弹窗
  await tap(270, 840);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shot_theme_checkin.png' });
  await tap(270, 540); // 稍后再说

  // 机库
  await tap(270, 548);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'shot_theme_hangar.png' });
  await tap(270, 890); // 返回菜单

  // 开始游戏 → 跳过教程 → 战斗
  await tap(270, 480);
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'shot_theme_pre_tutorial.png' });
  await tap(213, 733); // 跳过教程
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shot_theme_battle.png' });
  await tap(640, 1187, 900); // 点炸弹看特效
  await page.screenshot({ path: 'shot_theme_bomb.png' });
} catch (e) {
  errors.push('SCRIPT_EXCEPTION: ' + (e.stack || String(e)));
} finally {
  await browser.close();
}

console.log('=== 错误数: ' + (errors.length + consoleErrs.length));
errors.forEach((e) => console.log('PAGEERROR: ' + e.slice(0, 500)));
consoleErrs.forEach((e) => console.log('CONSOLE: ' + e.slice(0, 200)));
