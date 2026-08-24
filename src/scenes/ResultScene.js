import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVELS } from '../config/GameConfig.js';
import { createStarfield } from '../systems/Starfield.js';
import { NeonButton, NeonBar, THEME } from '../utils/UIWidgets.js';

/**
 * ResultScene：关卡结算。显示胜负、星级、分数、金币，提供重来/返回。
 * UI P2 信息层：NeonBar 完成度条（击杀/星级进度）+ 最高分 + 连击峰值面板。
 * 纯视觉：不改任何伤害/连击/流程/数值；布局随数据行数动态下移，不遮挡既有元素。
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
    const title = r.mode === 'endless' ? '无尽挑战结束' : (r.victory ? '关卡通过' : '任务失败');
    const titleColor = r.mode === 'endless' ? THEME.titleColor : (r.victory ? THEME.titleColor : THEME.textRed);
    this.add.text(cx, 200, title, {
      fontFamily: THEME.fontFamily, fontSize: '48px', fontStyle: '800', color: titleColor,
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
      const names = r.newAchievements.map((a) => a.name).join('   ');
      // 标题行：勋章矢量图标 + 文本（取代 emoji 🏅，跨端字形一致）
      const achTitle = this.add.text(0, 0, '本局解锁成就', {
        fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textGoldLight, fontStyle: '800',
      }).setOrigin(0.5);
      const achMedal = this.add.image(-achTitle.width / 2 - 16, 0, 'icon_medal').setScale(0.75);
      this.add.container(cx, 345, [achMedal, achTitle]);
      this.add.text(cx, 375, names, {
        fontFamily: THEME.fontFamily, fontSize: '16px', color: COLORS.coin, fontStyle: '700',
      }).setOrigin(0.5).setWordWrapWidth(GAME_WIDTH - 60);
    }

    // 数据（含最高分；破纪录时得分行高亮并加「新纪录」标识）
    const lines = [
      { label: '得分', value: r.score || 0, newBest: !!r.isNewBest },
      { label: '击杀', value: r.kills || 0 },
      { label: '金币', value: r.coins || 0 },
    ];
    if (r.mode === 'endless') lines.push({ label: '波次', value: `第 ${r.wave || 0} 波` });
    // P2 Boss Rush 差异化：胜利结算新增「Boss Rush 奖励」行（机库等级 / 金币倍率 / 稀有掉落数）
    if (r.mode === 'bossrush' && r.victory && r.rushReward) {
      const rr = r.rushReward;
      const coinMulTxt = Number.isInteger(rr.coinMul) ? String(rr.coinMul) : Number(rr.coinMul).toFixed(1);
      lines.push({
        label: 'Boss Rush 奖励',
        value: `机库 Lv${rr.hangarLv} · 金币×${coinMulTxt} · 稀有${rr.rareDrops || 0}`,
      });
    }
    lines.push({ label: '最高分', value: r.bestScore ?? 0 });
    const dataStartY = 400;
    lines.forEach((l, i) => {
      this.add.text(cx, dataStartY + i * 40, `${l.label}   ${l.value}${l.newBest ? '  ★新纪录' : ''}`, {
        fontFamily: THEME.fontFamily, fontSize: '22px',
        color: l.newBest ? THEME.textGoldLight : THEME.textPrimary,
        fontStyle: l.newBest ? '800' : 'normal',
      }).setOrigin(0.5);
    });

    // ── UI P2 信息层：完成度条（NeonBar）+ 连击峰值面板 ──
    // 动态下移：数据行数（normal 4 行 / endless 5 行）决定信息层与按钮基准 Y，避免遮挡。
    const dataEndY = dataStartY + lines.length * 40;
    const barY = dataEndY + 18;
    const comboY = barY + 56;
    const btnY = comboY + 66;

    // 完成度 = 加权 composite（击杀 50% + 金币 30% + 无伤 20%），直连星级评分；
    // 探针/旧调用未传 composite 时回退为星级/3（星级进度语义）。
    const completionRatio = r.composite != null
      ? Phaser.Math.Clamp(r.composite, 0, 1)
      : (r.stars ? Phaser.Math.Clamp(r.stars / 3, 0, 1) : 0.5);
    this.completionRatio = completionRatio;
    this.add.text(cx - 195, barY, '完成度', {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textSecondary,
    }).setOrigin(0, 0.5);
    this.completionBar = new NeonBar(this, cx - 90, barY, 250, 14, {
      color: THEME.coinHex, borderColor: 0x6a5a2a,
    });
    this.completionBar.setRatio(completionRatio);
    this.add.text(cx + 175, barY, `${Math.round(completionRatio * 100)}%`, {
      fontFamily: THEME.fontFamily, fontSize: '16px', fontStyle: '700', color: THEME.textGoldLight,
    }).setOrigin(0, 0.5);

    // 连击峰值面板（Graphics 画卡片：避免 Container+Rectangle 干扰既有 QA 判定 rsRectBtnCount）
    const comboCard = this.add.graphics().setDepth(5);
    comboCard.fillStyle(0x0a2236, 0.85).fillRoundedRect(cx - 200, comboY - 34, 400, 68, 12);
    comboCard.lineStyle(2, 0x4fc3ff, 0.5).strokeRoundedRect(cx - 200, comboY - 34, 400, 68, 12);
    this.add.text(cx - 150, comboY, '连击峰值', {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textSecondary,
    }).setOrigin(0, 0.5);
    const peak = r.maxCombo || 0;
    this.comboPeakText = this.add.text(cx + 130, comboY, `×${peak}`, {
      fontFamily: THEME.fontFamily, fontSize: '28px', fontStyle: '800',
      color: peak >= 20 ? THEME.textGold : THEME.titleColor,
    }).setOrigin(1, 0.5);

    // 按钮：无尽模式 -> 再来一局（仍进无尽）；胜利且可解锁 -> 下一关；其余 -> 重来/菜单
    if (r.mode === 'endless') {
      this.makeButton(cx, btnY, '再来一局', () => {
        this.scene.start(SCENES.GAME, { mode: 'endless', levelId: 1 });
      });
      this.makeButton(cx, btnY + 80, '返回菜单', () => {
        this.scene.start(SCENES.MENU);
      });
    } else if (r.victory && (r.levelId || 1) < LEVELS.length) {
      this.makeButton(cx, btnY, '下一关', () => {
        this.scene.start(SCENES.GAME, { levelId: (r.levelId || 1) + 1 });
      });
      this.makeButton(cx, btnY + 80, '再玩一次', () => {
        this.scene.start(SCENES.GAME, { levelId: r.levelId || 1 });
      });
      this.makeButton(cx, btnY + 160, '返回菜单', () => {
        this.scene.start(SCENES.MENU);
      });
    } else {
      this.makeButton(cx, btnY, r.victory ? '再玩一次' : '重新挑战', () => {
        this.scene.start(SCENES.GAME, { levelId: r.levelId || 1 });
      });
      this.makeButton(cx, btnY + 80, '返回菜单', () => {
        this.scene.start(SCENES.MENU);
      });
    }
  }

  drawStars(cx, y, count) {
    const gap = 70;
    for (let i = 0; i < 3; i++) {
      const filled = i < count;
      const x = cx + (i - 1) * gap;
      const star = this.add.star(x, y, 5, 14, 30, filled ? COLORS.coin : THEME.starEmpty);
      star.setStrokeStyle(2, filled ? THEME.starFillStroke : THEME.starEmptyStroke);
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
    // P1 UI：统一复用 NeonButton（辉光 + hover + 按压缩放），与 MenuScene 风格一致
    return new NeonButton(this, x, y, label, { glow: true, onDown: cb }).container;
  }

  update(_, dt) {
    if (this.starfield) this.starfield.update(dt);
  }
}
