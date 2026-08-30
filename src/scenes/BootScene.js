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
    // P2 视觉四件套⑦：常驻转场覆盖层（渲染层级最高，平时透明待命；先于 Preload 启动，
    // 黑罩矩形无需纹理即可就绪，扫描带纹理在 Preload 生成后懒建）
    this.scene.launch(SCENES.TRANSITION);
    this.scene.start(SCENES.PRELOAD);
  }
}
