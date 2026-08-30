import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVELS, SHIPS, getShipSkins, PERFORMANCE } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';
import { t } from '../config/Locale.js';
import { createStarfield } from '../systems/Starfield.js';
import { transition } from '../systems/TransitionManager.js';
import { NeonButton, NeonBar, THEME } from '../utils/UIWidgets.js';
import { enableSceneBloom } from '../utils/BloomFX.js';

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

    // P1 表现工程·PostFX 辉光（可选场景；按性能档开，low 关 / Canvas 自动降级）
    this.bloomFX = enableSceneBloom(this, SaveManager.load().quality || PERFORMANCE.defaultTier);

    // 霓虹装饰边框（Phase C）
    const frame = this.add.graphics().setDepth(10);
    frame.lineStyle(3, COLORS.accent, 0.5);
    frame.strokeRoundedRect(12, 12, GAME_WIDTH - 24, GAME_HEIGHT - 24, 18);

    // 半透明遮罩
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55);

    // 标题（P0 留存-活动轮换：事件模式专属标题）
    const title = r.mode === 'endless' ? t('resEndless')
      : r.mode === 'coin_rush' ? t('resCoinRush')
      : r.mode === 'survival' ? t('resSurvival')
      : (r.victory ? t('resVictory') : t('resFail'));
    const titleColor = r.mode === 'endless' || r.mode === 'coin_rush' || r.mode === 'survival'
      ? THEME.titleColor : (r.victory ? THEME.titleColor : THEME.textRed);
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

    // P2 皮肤装饰：战机立绘（小图，用对应皮肤纹理；纹理缺失安全降级 'player'）
    // 放星级左侧空位（x=96，星级最左星 x=200），不与标题/星级/数据行重叠
    const _ship = r.ship || { id: 0, skin: 0 };
    const _skinKey = `player_skin_${Number(_ship.id) || 0}_${(_ship.skin != null) ? Number(_ship.skin) : 0}`;
    if (this.textures.exists(_skinKey)) {
      this.rsShipImg = this.add.image(96, 280, _skinKey).setScale(1.5).setAlpha(0.95).setDepth(6);
    }

    // P1 留存·社交排行：成绩分享按钮（右上角；生成 canvas 成绩卡 → PNG 下载 / 文本复制）
    this._initShareHooks();
    new NeonButton(this, GAME_WIDTH - 84, 128, t('resShare'), {
      w: 116, h: 46, fontSize: 18, glow: true,
      onDown: () => {
        const res = this.downloadShareCard();
        this._flashToast(res && res.ok ? t('resShareDownloaded') : t('resShareFail'));
      },
    }).container;

    // 本局新解锁成就（来自 GameScene.evaluate）
    if (r.newAchievements && r.newAchievements.length) {
      const names = r.newAchievements.map((a) => t(`ach_${a.id}`)).join('   ');
      // 标题行：勋章矢量图标 + 文本（取代 emoji 🏅，跨端字形一致）
      const achTitle = this.add.text(0, 0, t('resNewAch'), {
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
      { label: t('resScore'), value: r.score || 0, newBest: !!r.isNewBest },
      { label: t('resKills'), value: r.kills || 0 },
      { label: t('resCoins'), value: r.coins || 0 },
    ];
    if (r.mode === 'endless') {
      lines.push({ label: t('resWave'), value: t('resWaveVal', { wave: r.wave || 0 }) });
      // P1 留存·深空爬塔：无尽结算显示爬塔层数（含破新高标识）
      if (r.towerFloor != null) {
        lines.push({ label: t('resTowerFloor'), value: t('resTowerVal', { floor: r.towerFloor }), newBest: !!r.isNewTowerTop });
      }
    }
    // P1 留存·社交排行：本局入 Top10 显示名次
    if (r.topRank > 0) lines.push({ label: t('resLeaderboard'), value: t('resRankVal', { rank: r.topRank }), newBest: true });
    // P2 Boss Rush 差异化：胜利结算新增「Boss Rush 奖励」行（机库等级 / 金币倍率 / 稀有掉落数）
    if (r.mode === 'bossrush' && r.victory && r.rushReward) {
      const rr = r.rushReward;
      const coinMulTxt = Number.isInteger(rr.coinMul) ? String(rr.coinMul) : Number(rr.coinMul).toFixed(1);
      lines.push({
        label: t('resRushReward'),
        value: t('resRushVal', { lv: rr.hangarLv, mul: coinMulTxt, rare: rr.rareDrops || 0 }),
      });
    }
    // P0 留存-活动轮换：活动模式结算明细（金币冲刺 ×N / 限时生存 波次→金币）
    if (r.eventReward) {
      const er = r.eventReward;
      const double = er.double ? t('resDoubleDay') : '';
      if (er.kind === 'coin_rush') {
        lines.push({ label: t('resEventCoins'), value: t('resEventCoinsVal', { mult: er.mult, coins: er.coins, double }) });
      } else if (er.kind === 'survival') {
        lines.push({ label: t('resSurvivalSettle'), value: t('resSurvivalVal', { waves: er.waves, per: er.per, coins: er.coins, double }) });
      }
    }
    // P0 留存-关卡勋章：本局达成勋章（normal 胜利展示）
    if (r.mode === 'normal' && r.victory && r.achievedMedals && r.achievedMedals.length) {
      const names = (lvl.challenges || [])
        .filter((c) => r.achievedMedals.includes(c.id))
        .map((c) => t(`medal_${c.type}`, { target: c.target }))
        .join(' / ');
      lines.push({ label: t('resMedals'), value: names });
    }
    lines.push({ label: t('resBest'), value: r.bestScore ?? 0 });
    const dataStartY = 400;
    lines.forEach((l, i) => {
      this.add.text(cx, dataStartY + i * 40, `${l.label}   ${l.value}${l.newBest ? t('resNewRecord') : ''}`, {
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
    this.add.text(cx - 195, barY, t('resCompletion'), {
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
    this.add.text(cx - 150, comboY, t('resComboPeak'), {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textSecondary,
    }).setOrigin(0, 0.5);
    const peak = r.maxCombo || 0;
    this.comboPeakText = this.add.text(cx + 130, comboY, `×${peak}`, {
      fontFamily: THEME.fontFamily, fontSize: '28px', fontStyle: '800',
      color: peak >= 20 ? THEME.textGold : THEME.titleColor,
    }).setOrigin(1, 0.5);

    // 按钮：无尽模式 -> 再来一局（仍进无尽）；活动模式 -> 再战一次（仍进本周活动）；
    // 胜利且可解锁 -> 下一关；其余 -> 重来/菜单
    if (r.mode === 'endless') {
      this.makeButton(cx, btnY, t('resAgainEndless'), () => {
        transition.goto(this, SCENES.GAME, { mode: 'endless', levelId: 1 });
      });
      this.makeButton(cx, btnY + 80, t('backMenu'), () => {
        transition.goto(this, SCENES.MENU);
      });
    } else if (r.mode === 'coin_rush' || r.mode === 'survival') {
      this.makeButton(cx, btnY, t('resAgainEvent'), () => {
        transition.goto(this, SCENES.GAME, { mode: r.mode });
      });
      this.makeButton(cx, btnY + 80, t('backMenu'), () => {
        transition.goto(this, SCENES.MENU);
      });
    } else if (r.victory && (r.levelId || 1) < LEVELS.length) {
      this.makeButton(cx, btnY, t('resNextLevel'), () => {
        transition.goto(this, SCENES.GAME, { levelId: (r.levelId || 1) + 1 });
      });
      this.makeButton(cx, btnY + 80, t('resReplay'), () => {
        transition.goto(this, SCENES.GAME, { levelId: r.levelId || 1 });
      });
      this.makeButton(cx, btnY + 160, t('backMenu'), () => {
        transition.goto(this, SCENES.MENU);
      });
    } else {
      this.makeButton(cx, btnY, r.victory ? t('resReplay') : t('resRetry'), () => {
        transition.goto(this, SCENES.GAME, { levelId: r.levelId || 1 });
      });
      this.makeButton(cx, btnY + 80, t('backMenu'), () => {
        transition.goto(this, SCENES.MENU);
      });
    }

    // P2 视觉四件套⑦：作为转场目标时淡入揭示（无过渡时为 no-op，零影响）
    transition.fadeIn(this);
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

  // ---- P1 留存·社交排行：成绩分享卡（纯本地，无后端）----
  /** 生成 canvas 成绩卡（分数/关卡/战机/皮肤/日期），返回 canvas */
  buildShareCard() {
    const r = this.result || {};
    const canvas = document.createElement('canvas');
    canvas.width = 540; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    // 背景渐变
    const g = ctx.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#0b1c33'); g.addColorStop(1, '#040a16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 540, 720);
    // 霓虹边框
    ctx.strokeStyle = '#7cf3ff'; ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, 508, 688);
    ctx.strokeStyle = 'rgba(124,243,255,0.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(24, 24, 492, 672);
    ctx.textAlign = 'center';
    // 标题
    ctx.fillStyle = '#7cf3ff';
    ctx.font = '800 42px sans-serif';
    ctx.fillText(t('shareTitle'), 270, 118);
    // 分数
    ctx.fillStyle = '#ffd86b';
    ctx.font = '800 76px Consolas, monospace';
    ctx.fillText(String(r.score || 0), 270, 252);
    ctx.fillStyle = '#88bbdd'; ctx.font = '600 20px sans-serif';
    ctx.fillText(t('shareScoreLabel'), 270, 292);
    // 模式 / 爬塔层数
    const modeName = r.mode === 'endless'
      ? t('shareModeEndless', { floor: r.towerFloor || 0 })
      : r.mode === 'bossrush' ? t('shareModeBossRush')
      : r.mode === 'coin_rush' ? t('shareModeCoinRush')
      : r.mode === 'survival' ? t('shareModeSurvival')
      : t('shareModeNormal', { level: r.levelId || 1, victory: r.victory ? t('shareVictory') : t('shareChallenge') });
    ctx.fillStyle = '#cfe8ff'; ctx.font = '700 30px sans-serif';
    ctx.fillText(modeName, 270, 380);
    // 数据行
    ctx.fillStyle = '#88bbdd'; ctx.font = '600 22px sans-serif';
    ctx.fillText(t('shareData', { kills: r.kills || 0, coins: r.coins || 0, combo: r.maxCombo || 0 }), 270, 452);
    // 战机 / 皮肤
    const ship = (SHIPS && SHIPS[(r.ship && r.ship.id) || 0]) || (SHIPS && SHIPS[0]) || { name: '苍鹰', id: 0 };
    const skinId = (r.ship && r.ship.skin != null) ? Number(r.ship.skin) : 0;
    const skins = getShipSkins(ship.id);
    const skinName = (skins && skins[skinId] && skins[skinId].name) || '默认';
    ctx.fillText(t('shareShip', { ship: t(`ship_${ship.id}`), skin: t(`skin_${ship.id}_${skinId}`) }), 270, 512);
    // 日期
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    ctx.fillStyle = '#5a7a99'; ctx.font = '600 20px sans-serif';
    ctx.fillText(dateStr, 270, 620);
    // 文本摘要（复制用）
    this._shareText = [
      t('shareLine1'),
      t('shareLine2', { score: r.score || 0, mode: modeName }),
      t('shareLine3', { kills: r.kills || 0, coins: r.coins || 0, combo: r.maxCombo || 0 }),
      t('shareLine4', { ship: t(`ship_${ship.id}`), skin: t(`skin_${ship.id}_${skinId}`) }),
      dateStr,
    ].join('\n');
    this._shareCardCanvas = canvas;
    return canvas;
  }

  /** 下载成绩卡 PNG（canvas.toDataURL + a 标签） */
  downloadShareCard() {
    try {
      const canvas = this.buildShareCard();
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sky-raiders-score.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { ok: true, dataUrl: url.slice(0, 32) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** 复制文本摘要（navigator.clipboard，失败回退 execCommand） */
  async copyShareText() {
    this.buildShareCard();
    const text = this._shareText || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true };
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return { ok: !!ok };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** 测试钩子（与 window.__SKY 同性质，不影响玩法） */
  _initShareHooks() {
    this._shareCardCanvas = null;
    this._shareText = '';
    window.__RESULT_SHARE = {
      buildShareCard: () => this.buildShareCard(),
      downloadShareCard: () => this.downloadShareCard(),
      copyShareText: () => this.copyShareText(),
      getText: () => this._shareText || '',
      getCard: () => this._shareCardCanvas,
    };
  }

  /** 顶部轻提示（分享下载/复制反馈），不阻塞交互 */
  _flashToast(msg) {
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 90, msg, {
      fontFamily: THEME.fontFamily, fontSize: '20px', fontStyle: '800', color: THEME.textGoldLight,
    }).setOrigin(0.5).setDepth(400).setShadow(0, 0, '#000000', 8, true, true).setAlpha(0);
    this.tweens.add({
      targets: t, alpha: 1, y: '-=14', duration: 240, yoyo: true, hold: 900,
      onComplete: () => t.destroy(),
    });
  }

  update(_, dt) {
    if (this.starfield) this.starfield.update(dt);
  }
}
