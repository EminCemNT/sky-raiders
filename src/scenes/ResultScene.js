import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVELS } from '../config/GameConfig.js';
import { createStarfield } from '../systems/Starfield.js';
import { THEME } from '../utils/UIWidgets.js';

/**
 * ResultScene：关卡结算。显示胜负、星级、分数、金币，提供重来/返回。
 */
export default class ResultScene extends Phaser.Scene {
  constructor() {
    super(SCENES.RESULT);
  }

  init(data) {
    this.result = data || {};
  }

  create() {
    const r = this.result;
    const cx = GAME_WIDTH / 2;

    // 背景渐变（按关卡色调，与战斗场景一致）
    const lvl = LEVELS.find((l) => l.id === (r.levelId || 1)) || LEVELS[0];
    const theme = lvl.theme;
    const bg = this.add.graphics().setDepth(-200);
    bg.fillGradientStyle(theme.skyTop, theme.skyTop, theme.skyBottom, theme.skyBottom, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.starfield = createStarfield(this, { layers: 4, starTints: theme.starTints });

    // 霓虹装饰边框（Phase C）
    const frame = this.add.graphics().setDepth(10);
    frame.lineStyle(3, COLORS.accent, 0.5);
    frame.strokeRoundedRect(12, 12, GAME_WIDTH - 24, GAME_HEIGHT - 24, 18);

    // 半透明遮罩
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55);

    // 标题
    const title = r.victory ? '关卡通过' : '任务失败';
    const titleColor = r.victory ? '#7cf3ff' : '#ff5566';
    this.add.text(cx, 200, title, {
      fontFamily: 'sans-serif', fontSize: '48px', fontStyle: '800', color: titleColor,
    }).setOrigin(0.5).setShadow(0, 0, titleColor, 20, true, true);

    // Phase C：胜利全屏爆闪
    if (r.victory) {
      const flash = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0.85).setDepth(40);
      this.tweens.add({ targets: flash, alpha: 0, duration: 650, ease: 'Cubic.out', onComplete: () => flash.destroy() });
    }

    // 星级
    this.drawStars(cx, 280, r.stars || 0);

    // 本局新解锁成就（来自 GameScene.evaluate）
    if (r.newAchievements && r.newAchievements.length) {
      const names = r.newAchievements.map((a) => `${a.icon}${a.name}`).join('   ');
      this.add.text(cx, 345, '🏅 本局解锁成就', {
        fontFamily: 'sans-serif', fontSize: '18px', color: '#ffd86b', fontStyle: '800',
      }).setOrigin(0.5);
      this.add.text(cx, 375, names, {
        fontFamily: 'sans-serif', fontSize: '16px', color: COLORS.coin, fontStyle: '700',
      }).setOrigin(0.5).setWordWrapWidth(GAME_WIDTH - 60);
    }

    // 数据（含最高分；破纪录时得分行高亮并加「新纪录」标识）
    const lines = [
      { label: '得分', value: r.score || 0, newBest: !!r.isNewBest },
      { label: '击杀', value: r.kills || 0 },
      { label: '金币', value: r.coins || 0 },
      { label: '最高分', value: r.bestScore ?? 0 },
    ];
    lines.forEach((l, i) => {
      this.add.text(cx, 400 + i * 40, `${l.label}   ${l.value}${l.newBest ? '  ★新纪录' : ''}`, {
        fontFamily: 'sans-serif', fontSize: '22px',
        color: l.newBest ? '#ffd86b' : '#cfe8ff',
        fontStyle: l.newBest ? '800' : 'normal',
      }).setOrigin(0.5);
    });

    // 按钮：胜利且有关卡解锁时显示「下一关」
    if (r.victory && (r.levelId || 1) < LEVELS.length) {
      this.makeButton(cx, 540, '下一关', () => {
        this.scene.start(SCENES.GAME, { levelId: (r.levelId || 1) + 1 });
      });
      this.makeButton(cx, 620, '再玩一次', () => {
        this.scene.start(SCENES.GAME, { levelId: r.levelId || 1 });
      });
      this.makeButton(cx, 700, '返回菜单', () => {
        this.scene.start(SCENES.MENU);
      });
    } else {
      this.makeButton(cx, 580, r.victory ? '再玩一次' : '重新挑战', () => {
        this.scene.start(SCENES.GAME, { levelId: r.levelId || 1 });
      });
      this.makeButton(cx, 660, '返回菜单', () => {
        this.scene.start(SCENES.MENU);
      });
    }
  }

  drawStars(cx, y, count) {
    const gap = 70;
    for (let i = 0; i < 3; i++) {
      const filled = i < count;
      const x = cx + (i - 1) * gap;
      const star = this.add.star(x, y, 5, 14, 30, filled ? COLORS.coin : 0x334455);
      star.setStrokeStyle(2, filled ? 0xfff3b0 : 0x556677);
      if (filled) {
        star.setScale(0);
        this.tweens.add({
          targets: star, scale: 1, duration: 400, delay: i * 220, ease: 'Back.out',
        });
        // Phase C：星级弹入爆闪光圈
        const burst = this.add.circle(x, y, 8, 0xfff3b0, 0.5).setScale(0.3).setDepth(2);
        this.tweens.add({
          targets: burst, scale: 6, alpha: 0, duration: 440, delay: i * 220,
          ease: 'Cubic.out', onComplete: () => burst.destroy(),
        });
      }
    }
  }

  makeButton(x, y, label, cb) {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, 220, 58, THEME.btnBg, 0.95).setStrokeStyle(2, THEME.btnStroke);
    const t = this.add.text(0, 0, label, {
      fontFamily: 'sans-serif', fontSize: '22px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5);
    c.add([bg, t]);
    c.setSize(220, 58).setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-110, -29, 220, 58),
      hitAreaCallback: (rect, x, y) => rect.contains(x, y),
      useHandCursor: true,
    });
    c.on('pointerover', () => bg.setFillStyle(THEME.btnBgHover, 1));
    c.on('pointerout', () => bg.setFillStyle(THEME.btnBg, 0.95));
    c.on('pointerdown', cb);
    return c;
  }

  update(_, dt) {
    if (this.starfield) this.starfield.update(dt);
  }
}
