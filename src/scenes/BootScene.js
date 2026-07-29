import Phaser from 'phaser';
import { SCENES } from '../config/GameConfig.js';

/**
 * BootScene：最早启动，只做全局设置，然后立刻切到 Preload。
 * 这里适合放：输入配置、缩放监听、全局数据初始化。
 */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.BOOT);
  }

  create() {
    // 允许多点触控（移动端摇杆 + 开火键同时按）
    this.input.addPointer(2);
    this.scene.start(SCENES.PRELOAD);
  }
}
