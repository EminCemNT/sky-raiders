import Phaser from 'phaser';
import { SCENES } from '../config/GameConfig.js';
import { generateAll } from '../utils/TextureFactory.js';
import { warmFonts } from '../systems/FloatingText.js';

/**
 * PreloadScene：生成所有纹理并进入菜单。
 * ---------------------------------------------------------------------------
 * 2026-07 美术升级后，全部纹理由 TextureFactory 程序化生成（科幻扁平霓虹），
 * 取代 public/sprites 下的低清 AI PNG，自包含、零外部依赖、可版本化。
 *
 * 贴图 key 契约（entities 依赖这些名字，禁止改名/删除）：
 *   player, enemy_small, enemy_mid, enemy_diver, boss,
 *   bullet_player(回退保留), bullet_pulse, bullet_scatter, bullet_enemy,
 *   coin, powerup, particle, star
 *   item_shield, item_magnet, item_wingman, item_energy, item_heal, item_bomb
 *   背景层：bg_nebula, bg_cloud, bg_asteroid, bg_building
 */
export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PRELOAD);
  }

  preload() {
    // 全部纹理由 TextureFactory 程序化生成，无需加载外部 PNG
  }

  create() {
    // 生成全部游戏纹理（覆盖式，确保实体引用的是代码绘制版本）
    generateAll(this);

    // 字体光栅化预热（双保险：GameScene.create 也会再预热一次）
    warmFonts(this);

    // 移除首屏 HTML loader
    const loader = document.getElementById('boot-loader');
    if (loader) loader.style.display = 'none';

    this.scene.start(SCENES.MENU);
  }
}
