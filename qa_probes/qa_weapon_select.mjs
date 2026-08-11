// qa_weapon_select.mjs —— 开局武器选择（机库持久覆盖战机绑定）真测
// 验证：startWeapon=missile 覆盖生效 / startWeapon=null 回退战机绑定 / 机库选择器渲染 / 零 pageerror。
// 依赖：外部已起 5059 vite 服（或 run-all.mjs）。
import { chromium } from 'playwright';

const URL = process.env.QA_URL || 'http://localhost:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const errors = [];

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅', msg);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 20000 });

const r = await page.evaluate(async () => {
  const game = window.__SKY__;
  const SM = window.__SAVE;
  SM.set('tutorialDone', true);
  const waitPlayer = (ms = 12000) => new Promise((res) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const gs = game.scene.getScene('GameScene');
      if (gs && gs.player && gs.player.active && gs.physics && !gs.physics.world.isPaused) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > ms) { clearInterval(iv); res(); }
    }, 50);
  });

  // 1) startWeapon='missile' 覆盖战机绑定
  SM.set('startWeapon', 'missile');
  game.scene.stop('UIScene'); game.scene.stop('GameScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  await waitPlayer();
  const gs1 = game.scene.getScene('GameScene');
  const wOverride = gs1.player.weapon;

  // 2) startWeapon=null 回退战机绑定
  SM.set('startWeapon', null);
  game.scene.stop('GameScene');
  game.scene.start('GameScene', { mode: 'normal', levelId: 1 });
  await waitPlayer();
  const gs2 = game.scene.getScene('GameScene');
  const wDefault = gs2.player.weapon;

  // 3) 机库选择器渲染（buildStartWeaponSelector 应创建 weaponLabel）
  game.scene.stop('GameScene'); game.scene.stop('UIScene');
  game.scene.start('HangarScene');
  await new Promise((res) => setTimeout(res, 450));
  const hang = game.scene.getScene('HangarScene');
  const weaponLabelText = (hang && hang.weaponLabel) ? hang.weaponLabel.text : null;

  return {
    wOverride, wDefault, weaponLabelText,
    validWeapon: ['pulse', 'missile', 'laser', 'bomb'].includes(wDefault),
  };
});

assert(r.wOverride === 'missile', `startWeapon=missile 覆盖生效 (player.weapon=${r.wOverride})`);
assert(r.validWeapon && r.wDefault !== 'missile', `startWeapon=null 回退战机绑定 (player.weapon=${r.wDefault})`);
assert(!!r.weaponLabelText, `机库开局武器选择器渲染 (label="${r.weaponLabelText}")`);
assert(errors.length === 0, `零 pageerror (${errors.length})`);

if (errors.length) console.error('页面错误:', errors.slice(0, 5));
await browser.close();
console.log(process.exitCode ? '\n=== 武器选择探针 FAIL ===' : '\n=== 武器选择探针 PASS ===');
