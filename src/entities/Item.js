import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/GameConfig.js';
import { ITEMS } from '../config/Items.js';

/**
 * 掉落物实体（从 physics 对象池取用）。
 * ---------------------------------------------------------------------------
 * 由 GameScene.items 物理组（classType: Item, maxSize 60）统一管理。
 * spawn(x, y, itemKey) 复活并配置贴图/下落/摆动。
 * 命中玩家由 GameScene 的 collectItem 处理效果。
 */
export default class Item extends Phaser.Physics.Arcade.Sprite {
  constructor(scene) {
    super(scene, 0, 0, 'item_energy');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(14);
    this.setActive(false).setVisible(false);
    this.body.enable = false;
    this.itemKey = null;
    this._baseX = 0;
    this._swing = 0;
  }

  /** 从池中激活一个掉落物 */
  spawn(x, y, itemKey) {
    const def = ITEMS[itemKey];
    this.itemKey = itemKey;
    this.setTexture(def ? def.tex : 'item_energy');
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.body.enable = true;
    this.setVelocity(0, 90);
    this._baseX = x;
    this._swing = Phaser.Math.FloatBetween(0, Math.PI * 2);
    this.setScale(1);
    this.clearTint();
    this.setAlpha(1);
    return this;
  }

  update(time, dt) {
    if (!this.active) return;
    // 轻微左右摆动
    this._swing += dt * 0.005;
    this.x = this._baseX + Math.sin(this._swing) * 26;
    // 出屏回收
    if (this.y > GAME_HEIGHT + 40) this.recycle();
  }

  recycle() {
    this.setActive(false).setVisible(false);
    if (this.body) {
      this.body.enable = false;
      this.setVelocity(0, 0);
    }
  }
}
