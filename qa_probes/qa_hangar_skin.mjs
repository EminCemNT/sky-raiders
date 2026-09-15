// Phase E 皮肤 QA：机库战机预览存在 + 初始机型色正确 + 切换更新 + 皮肤贴图切换 + 游戏内玩家aura + 零 pageerror
// 注：预览已改用自带配色的皮肤贴图（player_skin_X_Y）→ clearTint()，机型辨识色由 shipAura 承载，
//     故 tint 断言读 shipAura、预览断言读 texture.key。
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

// 进入机库
await page.evaluate(() => window.__SKY__.scene.start('HangarScene'));
await page.waitForFunction(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return hs && hs.scene.isActive() && hs.shipPreview && hs.shipAura;
}, { timeout: 20000 });
await page.waitForTimeout(700); // 让入场/呼吸 tween 跑几帧

const hangar = await page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return {
    hasPreview: !!hs.shipPreview,
    hasAura: !!hs.shipAura,
    hasArrows: !!(hs.shipArrowL && hs.shipArrowR),
    // 机型辨识色现在由 aura 承载：预览已改用自带配色的皮肤贴图（player_skin_X_Y）→ clearTint()。
    // 故 tint 断言读 shipAura；预览则断皮肤贴图 key。默认 selectedShip=0 苍鹰 0x66ccff。
    tint0: hs.shipAura.tintTopLeft,
    tex0: hs.shipPreview.texture.key,
  };
});

// 切换战机（右箭头一次 → selectedShip=1 赤焰 0xff7a3a）
await page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  hs.shipArrowR.emit('pointerdown');
});
await page.waitForTimeout(300);
const after = await page.evaluate(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return { tint: hs.shipAura.tintTopLeft, tex: hs.shipPreview.texture.key };
});
const tintAfter = after.tint;

// 进 GameScene 验证玩家 aura（游戏内辨识度）
await page.evaluate(() => window.__SKY__.scene.start('GameScene', { levelId: 1 }));
await page.waitForFunction(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return gs && gs.scene.isActive() && gs.player && gs.player.active;
}, { timeout: 20000 });
await page.waitForTimeout(400);
const gameAura = await page.evaluate(() => {
  const gs = window.__SKY__.scene.getScene('GameScene');
  return !!(gs.player.aura && gs.player.aura.type === 'Image');
});

await browser.close();

const checks = [
  ['机库战机预览存在', hangar.hasPreview],
  ['机库发光aura存在', hangar.hasAura],
  ['切换箭头已注册', hangar.hasArrows],
  ['初始 aura tint=苍鹰青(0x66ccff)', hangar.tint0 === 0x66ccff],
  ['切换后 aura tint=赤焰橙(0xff7a3a)', tintAfter === 0xff7a3a],
  ['预览按皮肤贴图切换(0_0→1_0)', hangar.tex0 === 'player_skin_0_0' && after.tex === 'player_skin_1_0'],
  ['游戏内玩家aura存在', gameAura],
  ['零 pageerror', errors.length === 0],
];
let pass = true;
const log = [];
for (const [n, ok] of checks) { log.push((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
console.log(log.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
console.log(pass ? 'PHASE_E_SKIN: PASS' : 'PHASE_E_SKIN: FAIL');
process.exit(pass ? 0 : 1);
