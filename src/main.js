import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from './config/GameConfig.js';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import UIScene from './scenes/UIScene.js';
import ResultScene from './scenes/ResultScene.js';
import { SaveManager } from './utils/SaveManager.js';

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
  scene: [BootScene, PreloadScene, MenuScene, GameScene, UIScene, ResultScene],
};

const game = new Phaser.Game(config);

// 暴露给控制台方便调试（生产可移除）
window.__SKY__ = game;
window.__SAVE = SaveManager;

export default game;
