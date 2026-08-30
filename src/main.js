import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from './config/GameConfig.js';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import UIScene from './scenes/UIScene.js';
import ResultScene from './scenes/ResultScene.js';
import { TransitionScene } from './systems/TransitionManager.js';
import { SaveManager } from './utils/SaveManager.js';
import { initLocale } from './config/Locale.js';

// P1 表现工程·i18n：启动时按存档语言初始化（默认 zh 保持既有中文零回归）
initLocale(SaveManager.load().lang || 'zh');

/**
 * 游戏入口：创建 Phaser.Game 实例。
 * Scale.FIT + CENTER_BOTH：逻辑分辨率固定 540x960，等比缩放适配任意屏幕，
 * 竖屏手机撑满宽度，桌面居中留黑边。
 */
const config = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: COLORS.bg,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
    roundPixels: true,
  },
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
      // 竖版射击不用重力
      gravity: { x: 0, y: 0 },
    },
  },
  // 场景注册顺序即启动顺序，第一个 (Boot) 会自动 start
  // TransitionScene 追加在末尾：常驻转场覆盖层，渲染层级最高（含各场景 Bloom RT 4990）
  scene: [BootScene, PreloadScene, MenuScene, GameScene, UIScene, ResultScene, TransitionScene],
};

const game = new Phaser.Game(config);

// 暴露给控制台方便调试（生产可移除）
window.__SKY__ = game;
window.__SAVE = SaveManager;

// P0 技术品质：生产环境注册 Service Worker（离线缓存，缓存优先）。
// 仅 production 注册 —— dev 不注册，避免 SW 缓存干扰开发调试（改代码不生效）。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW 注册失败不影响游戏运行（隐私模式/受限上下文等场景静默降级）
    });
  });
}

// ───────────────────────────────────────────────────────────────
// P2 离线产品化（纯 DOM 叠层，不阻塞游戏）：
//   1) 断网/恢复顶部 toast：监听 online/offline，非弹窗、pointer-events:none；
//   2) 移动端横屏提示遮罩：仅移动端 UA + 非 iframe（避免干扰 CrazyGames 桌面嵌入）+ 横屏才显示。
// ───────────────────────────────────────────────────────────────
(function setupOfflineToast() {
  const el = document.createElement('div');
  el.id = 'offline-toast';
  Object.assign(el.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '9999',
    textAlign: 'center', padding: '10px 0', fontSize: '14px', fontWeight: '700',
    color: '#7cf3ff', background: 'rgba(5,10,20,0.94)',
    borderBottom: '1px solid rgba(120,200,255,.4)',
    pointerEvents: 'none', opacity: '0', transition: 'opacity .25s',
  });
  document.body.appendChild(el);
  let timer = null;
  const show = (msg, persist = false) => {
    el.textContent = msg;
    el.style.opacity = '1';
    if (timer) clearTimeout(timer);
    // 断网提示常驻到恢复；恢复提示 2.2s 后自动淡出
    if (!persist) timer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  };
  window.addEventListener('online', () => show('网络已恢复'));
  window.addEventListener('offline', () => show('网络已断开，当前为离线模式', true));
  // 测试钩子（与 window.__SKY 同性质，不影响玩法）
  window.__OFFLINE_TOAST = { show, el };
})();

(function setupLandscapeOverlay() {
  const el = document.createElement('div');
  el.id = 'landscape-overlay';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: '9998', display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(5,10,20,0.96)', color: '#7cf3ff',
    fontSize: '20px', fontWeight: '700', letterSpacing: '2px', textAlign: 'center',
  });
  el.textContent = '请竖屏游玩';
  document.body.appendChild(el);
  // 探测：移动端 UA + 非 iframe（避免干扰 CrazyGames 桌面嵌入）+ 横屏
  const state = {
    isMobile: /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent),
    inIframe: window.self !== window.top,
  };
  const update = () => {
    const landscape = window.innerWidth > window.innerHeight;
    el.style.display = (state.isMobile && !state.inIframe && landscape) ? 'flex' : 'none';
  };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  update();
  // 测试钩子（可改 state 模拟 iframe/桌面/移动端，再调 update 验证）
  window.__LANDSCAPE_OVERLAY = { el, state, update };
})();

export default game;
