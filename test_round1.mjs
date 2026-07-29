// 苍穹战机 Round-1 真机验证 (Playwright + 系统 Chrome 无头)
// 端口固定 5059 + --strictPort；视口 720x1280 (逻辑 540x960, 因子 1.333)
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5059/';
const DIR = 'D:/WorkBuddy/sky-raiders';
const W = 720, H = 1280; // 视口

// 逻辑坐标 -> 视口坐标（Scale.FIT, 因子 1.333, 无偏移）
const vx = (lx) => Math.round(lx * 1.333);
const vy = (ly) => Math.round(ly * 1.333);

const SAVE_KEY = 'sky_raiders_save_v1';
const FRESH = {
  coins: 0,
  upgrades: { firepower: 0, hull: 0, shield: 0, magnet: 0, wingman: 0 },
  levelStars: {}, unlockedLevel: 1, totalKills: 0, achievements: {},
  lastCheckin: '', checkinStreak: 0, tutorialDone: false,
};

// ── 收集错误 / 警告 / 失败请求 ──
const logs = { pageErrors: [], consoleErrors: [], consoleWarnings: [], reqFails: [], badResponses: [] };

async function applySave(page, save) {
  await page.evaluate(({ k, s }) => { localStorage.setItem(k, JSON.stringify(s)); }, { k: SAVE_KEY, s: save });
  await page.reload({ waitUntil: 'load' });
}
async function waitScene(page, key, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate((k) => {
      const g = window.__SKY__;
      return !!(g && g.scene && g.scene.getScene(k) && g.scene.isActive(k));
    }, key).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(200);
  }
  return false;
}
async function state(page) {
  return page.evaluate(() => {
    const g = window.__SKY__;
    if (!g) return { ready: false };
    const gs = g.scene.getScene('GameScene');
    const inGame = !!(gs && g.scene.isActive('GameScene') && gs.enemies);
    if (!inGame) return { ready: true, inGame: false };
    let diverSeen = false, scatterSeen = false, pulseSeen = false;
    const enemies = [];
    gs.enemies.children.each((e) => { if (e.active) { enemies.push(e.typeKey); if (e.typeKey === 'diver') diverSeen = true; } });
    gs.playerBullets.children.each((b) => { if (b.active) { const k = b.texture && b.texture.key; if (k === 'bullet_scatter') scatterSeen = true; if (k === 'bullet_pulse') pulseSeen = true; } });
    return {
      ready: true, inGame: true,
      levelId: gs.levelId,
      wave: gs.waves ? gs.waves.currentWave : 0,
      enemies, diverSeen, scatterSeen, pulseSeen,
      firepower: gs.player ? gs.player.firepower : null,
    };
  }).catch((e) => ({ ready: true, inGame: false, err: String(e) }));
}

const summary = { phases: {}, errors: logs, screenshots: [], diver: null, scatter: null, pulse: null };

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });

  page.on('pageerror', (e) => logs.pageErrors.push(`${e.message} | ${(e.stack || '').split('\n').slice(0, 4).join(' / ')}`));
  page.on('console', (m) => {
    const t = m.type();
    const txt = m.text();
    if (t === 'error') logs.consoleErrors.push(txt);
    else if (t === 'warning') logs.consoleWarnings.push(txt);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (u.endsWith('favicon.ico')) return; // 无害
    logs.reqFails.push(`${u} :: ${r.failure() ? r.failure().errorText : ''}`);
  });
  page.on('response', (r) => {
    const st = r.status();
    const u = r.url();
    if (st >= 400 && !u.endsWith('favicon.ico')) logs.badResponses.push(`${st} ${u}`);
  });

  try {
    // ============ PHASE 1: 菜单 + L1 基线 (默认火力0, 教程开) ============
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(({ k, s }) => { localStorage.setItem(k, JSON.stringify(s)); }, { k: SAVE_KEY, s: FRESH });
    await page.reload({ waitUntil: 'load' });
    const menuOk = await waitScene(page, 'MenuScene');
    summary.phases.menu = menuOk ? 'ok' : 'FAIL(scene-not-active)';
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/shot_menu.png` });
    summary.screenshots.push('shot_menu.png');

    // 开始游戏 -> 教程 -> 跳过
    await page.mouse.click(vx(270), vy(480)); // 开始游戏
    await page.waitForTimeout(1200);
    await page.mouse.click(vx(160), vy(550)); // 跳过教程
    await page.waitForTimeout(3000);
    const s1 = await state(page);
    summary.phases.battleL1 = s1.inGame ? `ok wave=${s1.wave}` : 'FAIL(not-in-game)';
    summary.pulse = s1.pulseSeen; // 火力0应只有脉冲
    await page.screenshot({ path: `${DIR}/shot_battle.png` });
    summary.screenshots.push('shot_battle.png');

    // ============ PHASE 2: 散射炮 (火力>=2) + 炸弹 ============
    await applySave(page, { ...FRESH, upgrades: { ...FRESH.upgrades, firepower: 2 }, tutorialDone: true });
    const menu2 = await waitScene(page, 'MenuScene');
    await page.mouse.click(vx(270), vy(480)); // 开始游戏 -> L1
    await page.waitForTimeout(2600);
    const s2 = await state(page);
    summary.phases.scatter = s2.inGame ? `ok wave=${s2.wave} fp=${s2.firepower}` : 'FAIL(not-in-game)';
    summary.scatter = s2.scatterSeen;
    summary.pulse = s2.pulseSeen;
    await page.screenshot({ path: `${DIR}/shot_scatter.png` });
    summary.screenshots.push('shot_scatter.png');

    // 点炸弹按钮 (逻辑 478,888 -> 视口)
    await page.mouse.click(vx(478), vy(888));
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${DIR}/shot_bomb.png` });
    summary.screenshots.push('shot_bomb.png');
    await page.waitForTimeout(1500);

    // ============ PHASE 3: 俯冲机 diver (进 L2, 中后段) ============
    await applySave(page, { ...FRESH, unlockedLevel: 3, upgrades: { ...FRESH.upgrades, firepower: 2 }, tutorialDone: true });
    const menu3 = await waitScene(page, 'MenuScene');
    await page.mouse.click(vx(270), vy(760)); // 选择关卡
    await page.waitForTimeout(900);
    await page.mouse.click(vx(270), vy(348)); // L2 卡片
    await page.waitForTimeout(1500);

    let diverSeen = false, lastWave = 0, firstDiverShot = null;
    const t0 = Date.now();
    let tick = 0;
    while (Date.now() - t0 < 82000) {
      tick++;
      // 保持玩家存活 + 居中偏下，便于波次推进与观察
      await page.evaluate(() => {
        const g = window.__SKY__;
        const gs = g && g.scene.getScene('GameScene');
        if (gs && gs.player && gs.player.active) {
          gs.player.invulnUntil = gs.time.now + 100000;
          gs.player.x = 270; gs.player.y = 880;
        }
      }).catch(() => {});
      const st = await state(page);
      if (st.inGame) {
        lastWave = st.wave;
        if (st.wave > (summary.phases.diverMaxWave || 0)) summary.phases.diverMaxWave = st.wave;
        if (st.diverSeen && !diverSeen) {
          diverSeen = true;
          await page.screenshot({ path: `${DIR}/shot_diver.png` });
          summary.screenshots.push('shot_diver.png');
          firstDiverShot = { wave: st.wave, t: ((Date.now() - t0) / 1000).toFixed(1) };
          break;
        }
      }
      if (tick % 8 === 0) { // 每 ~12s 留一张过程图
        await page.screenshot({ path: `${DIR}/shot_diver_${tick}.png` });
        summary.screenshots.push(`shot_diver_${tick}.png`);
      }
      await page.waitForTimeout(1500);
    }

    // 兜底：若自然波次未捕获 diver，强制生成一张以验证贴图/外形
    if (!diverSeen) {
      const forced = await page.evaluate(() => {
        const g = window.__SKY__;
        const gs = g && g.scene.getScene('GameScene');
        if (gs && gs.spawnEnemy) { gs.spawnEnemy(270, 140, 'diver', 'dive', 1.3); return true; }
        return false;
      }).catch(() => false);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${DIR}/shot_diver.png` });
      summary.screenshots.push('shot_diver.png');
      summary.phases.diver = forced ? 'forced-spawn (natural-not-seen)' : 'FAIL(no-gameScene)';
      diverSeen = forced;
    } else {
      summary.phases.diver = `ok wave=${firstDiverShot.wave} t=${firstDiverShot.t}s`;
    }
    summary.diver = diverSeen;

  } catch (e) {
    summary.fatal = String(e && e.stack ? e.stack : e);
  } finally {
    await browser.close();
  }

  console.log('=====R1_SUMMARY=====');
  console.log(JSON.stringify(summary, null, 2));
  console.log('=====END=====');
})();
