import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVELS, DIFFICULTIES, PERFORMANCE, MEDALS, getCurrentEvent } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';
import { Ads } from '../systems/Ads.js';
import { AchievementManager } from '../systems/AchievementManager.js';
import { createStarfield, MENU_BG_THEME } from '../systems/Starfield.js';
import { audio } from '../systems/AudioSystem.js';
import { NeonButton, THEME, drawGlassPanel } from '../utils/UIWidgets.js';
import HangarScene from './HangarScene.js';

/**
 * MenuScene：标题 + 开始按钮 + 存档信息。
 * 后续可扩展：关卡选择、机库/升级界面入口、设置。
 */
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super(SCENES.MENU);
  }

  create() {
    const cx = GAME_WIDTH / 2;
    // modal 标志位初始化（防御：避免上一次残留导致按钮被错误拦截）
    this.settingsOpen = this.levelSelectOpen = this.achievementsOpen = this.checkinOpen = this.dailyQuestOpen = false;
    this.eventOpen = this.newbiePlanOpen = false; // P0 留存：本周活动 / 新手计划 面板标志
    this.leaderboardOpen = this.returnGiftOpen = false; // P1 留存：排行榜 / 回归礼包 面板标志
    // reduced-motion 偏好（子面板动画降级）
    this.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // 背景滚动星空（UI P2：主题化 = 星云脉动 + 近景剪影，reduced-motion 自动降级为静态）
    this.starfield = createStarfield(this, { theme: MENU_BG_THEME });

    // 动态注册机库场景（GameConfig 只读，未登记 HANGAR，故运行时注册一次）
    if (!this.scene.get('HangarScene')) {
      this.scene.add('HangarScene', HangarScene, false);
    }

    // 标题（霓虹辉光层 + 本体 + 呼吸脉动）
    this.titleGlow = this.add.text(cx, 218, '苍穹战机', {
      fontFamily: THEME.fontFamily, fontSize: '62px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleColor, 38, true, true).setAlpha(0.32).setDepth(1);
    this.title = this.add.text(cx, 218, '苍穹战机', {
      fontFamily: THEME.fontFamily, fontSize: '58px', fontStyle: '800', color: THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 24, true, true).setDepth(2);
    this.tweens.add({ targets: [this.title, this.titleGlow], scale: { from: 1, to: 1.035 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.titleGlow, alpha: { from: 0.26, to: 0.5 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // 英文名（宽字距 + 副色呼吸）
    this.subTitle = this.add.text(cx, 284, 'S K Y   R A I D E R S', {
      fontFamily: THEME.fontFamily, fontSize: '17px', color: THEME.subBright, fontStyle: '700',
    }).setOrigin(0.5).setAlpha(0.75).setDepth(2).setLetterSpacing(8);
    this.tweens.add({ targets: this.subTitle, alpha: { from: 0.5, to: 0.95 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // 标题能量环装饰（缓慢旋转 + 脉动）
    this.energyRing = this.add.graphics().setPosition(cx, 218).setDepth(0);
    this.energyRing.lineStyle(3, COLORS.accent, 0.5).strokeCircle(0, 0, 132);
    this.energyRing.lineStyle(1, 0xffffff, 0.25).strokeCircle(0, 0, 120);
    this.energyRing.lineStyle(2, 0x66ccff, 0.3).strokeCircle(0, 0, 144);
    this.tweens.add({ targets: this.energyRing, angle: 360, duration: 28000, repeat: -1 });
    this.tweens.add({ targets: this.energyRing, scale: { from: 0.97, to: 1.05 }, duration: 3200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // 教程按钮（重看新手引导，进入第 1 关并强制显示教程）
    new NeonButton(this, cx, 400, '新手教程', {
      stroke: COLORS.accent, fontSize: 22, glow: true, onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        audio.resume(); audio.startBgm(); audio.sfx('ui');
        this.scene.start(SCENES.GAME, { levelId: 1, mode: 'normal', forceTutorial: true });
      },
    });

    // 主入口：开始游戏（主线进度） + 无尽模式（Score Attack），并排两个主按钮
    new NeonButton(this, cx - 116, 480, '开始游戏', {
      w: 220, fontSize: 24, glow: true,
      onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        audio.resume(); audio.startBgm(); audio.sfx('ui'); this.startGame();
      },
    });

    new NeonButton(this, cx + 116, 480, '无尽模式', {
      w: 220, fontSize: 24, stroke: 0xff8a3d, glow: true,
      onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        audio.resume(); audio.startBgm(); audio.sfx('ui'); this.startEndless();
      },
    });

    // P2 系统扩展·无尽周赛：无尽入口旁显示本周赛状态（结算+重置由 SaveManager 自动处理）
    {
      const snap = SaveManager.getLeagueSnapshot();
      this.leagueText = this.add.text(cx + 116, 520, this._leagueLabel(snap), {
        fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textSecondary,
      }).setOrigin(0.5).setAlpha(0.92);
      if (snap.settled && snap.reward > 0) {
        this.flashToast(`上周周赛结算 · 第 ${snap.settledRank} 名 · +${snap.reward} 金币`);
      }
    }

    // 机库按钮
    new NeonButton(this, cx, 548, '机  库', {
      glow: true,
      onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        this.scene.start('HangarScene');
      },
    });

    // 成就按钮
    new NeonButton(this, cx, 616, '成  就', { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openAchievements();
    } });

    // 设置按钮
    new NeonButton(this, cx, 680, '设  置', { glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      this.openSettings();
    } });

    // Boss Rush 按钮
    new NeonButton(this, cx - 116, 736, 'BOSS RUSH', { stroke: 0xff5566, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.scene.start(SCENES.GAME, { mode: 'bossrush' });
    } });

    // P0 留存-活动轮换：本周活动入口（显示当前活动名 + 剩余天数，点开进入对应模式）
    {
      const ev = getCurrentEvent();
      new NeonButton(this, cx + 116, 736, `本周活动·${ev.short}`, { w: 220, fontSize: 18, stroke: 0xffd54a, glow: true, onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        audio.sfx('ui'); this.openEvent();
      } });
      this.add.text(cx + 116, 772, `剩余 ${ev.daysLeft} 天 · ${ev.double ? '今日双倍奖励' : '周末双倍奖励'}`, {
        fontFamily: THEME.fontFamily, fontSize: '13px', color: ev.double ? THEME.textGold : THEME.textDim,
      }).setOrigin(0.5).setAlpha(0.9);
    }

    // 选择关卡按钮
    new NeonButton(this, cx, 800, '选择关卡', { glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openLevelSelect();
    } });

    // 每日签到按钮（主动点击才弹，避免自动弹窗挡住"开始游戏"）
    new NeonButton(this, cx - 116, 864, '每日签到', { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openCheckIn();
    } });

    // P0 留存-新手计划按钮（挂到签到旁）
    new NeonButton(this, cx + 116, 864, '新手计划', { stroke: 0x7cffa0, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openNewbiePlan();
    } });

    // 每日任务按钮（留存系统：击杀/金币/炸弹等每日目标，完成领金币 + 活跃宝箱）
    new NeonButton(this, cx - 116, 928, '每日任务', { stroke: COLORS.accent, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.dailyQuestOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openDailyQuest();
    } });

    // P1 留存·社交排行：排行榜入口（本地历史 Top10 列表）
    new NeonButton(this, cx + 116, 928, '排行榜', { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.dailyQuestOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openLeaderboard();
    } });

    // 存档信息（含全局最高分）
    this.saveInfoText = this.add.text(cx, GAME_HEIGHT - 44,
      this._saveInfoLabel(), {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textSecondary,
    }).setOrigin(0.5).setAlpha(0.8);

    this.add.text(cx, GAME_HEIGHT - 20,
      '移动：拖动 / 方向键     开火：自动     炸弹：空格 / 屏幕按钮', {
      fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textDim,
    }).setOrigin(0.5);

    // 版本号（右上角装饰）
    this.add.text(GAME_WIDTH - 14, 14, 'v1.4.0', {
      fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.subColor,
    }).setOrigin(1, 0).setAlpha(0.6).setDepth(50);

    // 键盘也能开始
    this.input.keyboard.once('keydown-ENTER', () => this.startGame());
    this.input.keyboard.once('keydown-SPACE', () => this.startGame());

    // P1 留存·回归激励：断签 ≥3 天自动弹「回归礼包」（稍延迟，等菜单渲染完成）
    this.time.delayedCall(450, () => this.maybeShowReturnGift());
  }

  update(_, dt) {
    if (this.starfield) this.starfield.update(dt);
  }

  startGame() {
    // 「开始游戏」= 进入已解锁的最高关（继续进度）
    const unlocked = SaveManager.load().unlockedLevel || 1;
    const lvl = Math.min(unlocked, LEVELS.length);
    this.scene.start(SCENES.GAME, { levelId: lvl });
  }

  /** 无尽模式（Score Attack）：无限波次 + 难度递增，直到命尽 */
  startEndless() {
    this.scene.start(SCENES.GAME, { mode: 'endless', levelId: 1 });
  }

  /** 底部存档信息文案（金币 / 最高分 / 勋章 / 已解锁关卡），多处共用保持一致 */
  _saveInfoLabel() {
    const sv = SaveManager.load();
    return `金币 ${sv.coins}   ·   最高分 ${sv.bestScore || 0}   ·   勋章 ${SaveManager.countMedals()}   ·   已解锁第 ${sv.unlockedLevel} 关`;
  }

  /** 距下周一的剩余天数（周结倒计时，与活动轮换一致） */
  _weekDaysLeft() {
    const d = new Date();
    const nextMonday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    nextMonday.setDate(nextMonday.getDate() + (((8 - d.getDay()) % 7) || 7));
    return Math.max(1, Math.ceil((nextMonday - d) / 86400000));
  }

  /** 无尽入口旁周赛状态文案：本周赛 · 当前第 X 名 · 周结倒计时 */
  _leagueLabel(snap) {
    return `本周赛 · 当前第 ${(snap && snap.rank) || 0} 名 · 周结剩 ${this._weekDaysLeft()} 天`;
  }

  // ---- 设置面板（P0 音量设置）----
  openSettings() {
    this.settingsOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.settingsOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx);
    this.addGlowTitle(ov, cx, 250, '设置 · 音量', THEME.titleColor);

    // 四档难度按钮（P0）：一排四档，当前档选中高亮；点击切换 → 持久化 + 刷新高亮
    this._difficultyBtns = [];
    const diffLabel = this.add.text(cx, 302, '难度', {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0.5);
    ov.add(diffLabel);
    const btnW = 92, btnH = 46, gap = 8;
    const totalW = DIFFICULTIES.length * btnW + (DIFFICULTIES.length - 1) * gap;
    const startX = cx - totalW / 2 + btnW / 2;
    DIFFICULTIES.forEach((d, i) => {
      const x = startX + i * (btnW + gap);
      const btn = new NeonButton(this, x, 342, d.name, {
        w: btnW, h: btnH, fontSize: 16, glow: true,
        onDown: () => {
          audio.sfx('ui');
          SaveManager.set('selectedDifficulty', d.id);
          this.refreshDifficultySelect();
        },
      });
      ov.add(btn.container);
      this._difficultyBtns.push({ btn, id: d.id });
    });
    this.refreshDifficultySelect();

    // 画质档位按钮（P0 性能三件套）：三档画质，当前档选中高亮；点击切换 → 持久化 + 刷新高亮
    this._qualityBtns = [];
    const qLabel = this.add.text(cx, 386, '画质', {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0.5);
    ov.add(qLabel);
    const qW = 92, qH = 46;
    const qTotalW = PERFORMANCE.tiers.length * qW + (PERFORMANCE.tiers.length - 1) * gap;
    const qStartX = cx - qTotalW / 2 + qW / 2;
    const QUALITY_NAMES = { high: '高', mid: '中', low: '低' };
    PERFORMANCE.tiers.forEach((t, i) => {
      const x = qStartX + i * (qW + gap);
      const btn = new NeonButton(this, x, 426, QUALITY_NAMES[t] || t, {
        w: qW, h: qH, fontSize: 16, glow: true,
        onDown: () => {
          audio.sfx('ui');
          SaveManager.set('quality', t);
          this.refreshQualitySelect();
        },
      });
      ov.add(btn.container);
      this._qualityBtns.push({ btn, id: t });
    });
    this.refreshQualitySelect();

    // P2 激励广告位预留：去广告开关（本地立即生效，未来接付费解锁）
    const adLabel = this.add.text(cx - 150, 470, '去广告', {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    ov.add(adLabel);
    const adBtn = new NeonButton(this, cx + 60, 470, '', { w: 170, h: 40, fontSize: 15, glow: true, onDown: () => {
      audio.sfx('ui');
      const cur = !!SaveManager.load().noAds;
      SaveManager.set('noAds', !cur);
      this.refreshNoAdsSelect();
    } });
    ov.add(adBtn.container);
    this._noAdsBtn = adBtn;
    this.refreshNoAdsSelect();

    this.makeSlider(ov, cx, 510, '主音量', 'master');
    this.makeSlider(ov, cx, 580, '音效', 'sfx');
    this.makeSlider(ov, cx, 650, '音乐', 'bgm');
    ov.add(this.makeMenuBtn(cx, 700, '关闭', () => this.closeSettings()));
    this.fadeInPanel(ov);
  }

  /** 刷新去广告开关选中态（noAds=true 高亮 = 纯净版已开启） */
  refreshNoAdsSelect() {
    const cur = !!SaveManager.load().noAds;
    if (this._noAdsBtn) {
      this._noAdsBtn.setLabel(cur ? '纯净版：开' : '纯净版：关');
      this._noAdsBtn.setSelected(cur);
    }
  }

  /** 刷新四档难度按钮选中态（当前档高亮） */
  refreshDifficultySelect() {
    const cur = SaveManager.load().selectedDifficulty || 'standard';
    (this._difficultyBtns || []).forEach(({ btn, id }) => btn.setSelected(id === cur));
  }

  /** 刷新三档画质按钮选中态（当前档高亮） */
  refreshQualitySelect() {
    const cur = SaveManager.load().quality || PERFORMANCE.defaultTier;
    (this._qualityBtns || []).forEach(({ btn, id }) => btn.setSelected(id === cur));
  }

  closeSettings() {
    if (this.settingsOverlay) { this.settingsOverlay.destroy(); this.settingsOverlay = null; }
    this.settingsOpen = false;
    this._noAdsBtn = null;
  }

  // ---- 关卡选择面板 ----
  openLevelSelect() {
    this.levelSelectOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.levelSelectOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx);
    this.addGlowTitle(ov, cx, 110, '选择关卡', THEME.titleColor);

    const save = SaveManager.load();
    const cardW = 380, cardH = 132, gap = 16;
    const startY = 200;
    LEVELS.forEach((lvl, i) => {
      const y = startY + i * (cardH + gap);
      const unlocked = lvl.id <= (save.unlockedLevel || 1);
      const stars = save.levelStars[lvl.id] || 0;
      const c = this.add.container(cx, y);
      const bgColor = unlocked ? THEME.btnBg : THEME.lockedBg;
      const bg = this.add.rectangle(0, 0, cardW, cardH, bgColor, 0.95)
        .setStrokeStyle(2, unlocked ? lvl.theme.accent : THEME.lockedStroke);
      c.add(bg);
      c.add(this.add.text(-cardW / 2 + 18, -cardH / 2 + 18, lvl.name, {
        fontFamily: THEME.fontFamily, fontSize: '24px', fontStyle: '700',
        color: unlocked ? THEME.white : THEME.textDisabled,
      }).setOrigin(0, 0));
      const accentHex = '#' + lvl.theme.accent.toString(16).padStart(6, '0');
      c.add(this.add.text(-cardW / 2 + 18, -cardH / 2 + 52, `Boss · ${lvl.boss.name}`, {
        fontFamily: THEME.fontFamily, fontSize: '15px',
        color: unlocked ? accentHex : THEME.textDisabledDim,
      }).setOrigin(0, 0));
      for (let s = 0; s < 3; s++) {
        const st = this.add.star(-cardW / 2 + 26 + s * 34, cardH / 2 - 26, 5, 7, 15,
          s < stars ? COLORS.coin : THEME.starEmpty);
        st.setStrokeStyle(2, s < stars ? THEME.starFillStroke : THEME.starEmptyStroke);
        c.add(st);
      }
      // P0 留存-关卡勋章：卡片右下角显示该关 3 个勋章槽位（达成=金勋章，未达成=暗锁，只做展示）
      {
        const medals = SaveManager.getLevelMedals(lvl.id);
        const chs = Array.isArray(lvl.challenges) ? lvl.challenges.slice(0, 3) : [];
        chs.forEach((m, mi) => {
          const achieved = medals.includes(m.id);
          const mx = cardW / 2 - 22 - (chs.length - 1 - mi) * 30;
          const icon = this.add.image(mx, cardH / 2 - 26, achieved ? 'icon_medal' : 'icon_lock').setScale(0.5);
          if (!achieved) icon.setAlpha(0.35);
          c.add(icon);
        });
      }
      if (unlocked) {
        c.setSize(cardW, cardH).setInteractive({
          hitArea: new Phaser.Geom.Rectangle(-cardW / 2, -cardH / 2, cardW, cardH),
          hitAreaCallback: (rect, x, y) => rect.contains(x, y),
          useHandCursor: true,
        });
        c.on('pointerover', () => bg.setFillStyle(THEME.btnBgHover, 1));
        c.on('pointerout', () => bg.setFillStyle(THEME.btnBg, 0.95));
        c.on('pointerdown', () => {
          audio.sfx('ui');
          this.closeLevelSelect();
          this.scene.start(SCENES.GAME, { levelId: lvl.id });
        });
      } else {
        // 锁定图标：矢量锁纹理（取代 emoji 🔒，跨端字形一致）
        c.add(this.add.image(cardW / 2 - 26, 0, 'icon_lock').setScale(0.95));
        c.setAlpha(0.6);
      }
      ov.add(c);
    });

    // P0 留存-关卡勋章：累计勋章数 + 阈值解锁提示（先做展示，高难解锁后续接入）
    {
      const totalMedals = SaveManager.countMedals();
      const totalPossible = LEVELS.length * 3;
      const hit = totalMedals >= MEDALS.THRESHOLD;
      ov.add(this.add.text(cx, startY + LEVELS.length * (cardH + gap) - 16,
        `累计勋章 ${totalMedals}/${totalPossible} 枚${hit ? `  ·  已达 ${MEDALS.THRESHOLD} 枚，${MEDALS.THRESHOLD_LABEL}即将解锁` : `  ·  再 ${MEDALS.THRESHOLD - totalMedals} 枚解锁${MEDALS.THRESHOLD_LABEL}`}`, {
        fontFamily: THEME.fontFamily, fontSize: '16px',
        color: hit ? THEME.textGoldLight : THEME.textSecondary,
      }).setOrigin(0.5));
    }

    ov.add(this.makeMenuBtn(cx, startY + LEVELS.length * (cardH + gap) + 30, '关闭', () => this.closeLevelSelect()));
    this.fadeInPanel(ov);
  }

  closeLevelSelect() {
    if (this.levelSelectOverlay) { this.levelSelectOverlay.destroy(); this.levelSelectOverlay = null; }
    this.levelSelectOpen = false;
  }

  // ---- 成就墙面板 ----
  openAchievements() {
    this.achievementsOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.achievementsOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx);
    this.addGlowTitle(ov, cx, 70, '成就勋章', THEME.textGoldLight);

    const list = AchievementManager.getAll();
    const cols = 2, cardW = 230, cardH = 96, gapX = 16, gapY = 14;
    const startX = cx - (cols * cardW + (cols - 1) * gapX) / 2 + cardW / 2;
    const startY = 140;
    list.forEach((a, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);
      const c = this.add.container(x, y);
      const bgColor = a.unlocked ? THEME.achBg : THEME.lockedBg;
      const bg = this.add.rectangle(0, 0, cardW, cardH, bgColor, 0.96)
        .setStrokeStyle(2, a.unlocked ? COLORS.coin : THEME.lockedStroke);
      c.add(bg);
      // 矢量图标：已解锁勋章 / 未解锁锁（取代 a.icon emoji，跨端字形一致）
      c.add(this.add.image(-cardW / 2 + 18, -cardH / 2 + 20, a.unlocked ? 'icon_medal' : 'icon_lock').setScale(0.62));
      c.add(this.add.text(-cardW / 2 + 36, -cardH / 2 + 12, a.name, {
        fontFamily: THEME.fontFamily, fontSize: '18px', fontStyle: '700',
        color: a.unlocked ? THEME.white : THEME.textDisabled,
      }).setOrigin(0, 0));
      c.add(this.add.text(-cardW / 2 + 14, -cardH / 2 + 42, a.desc, {
        fontFamily: THEME.fontFamily, fontSize: '12px',
        color: a.unlocked ? THEME.textAchieve : THEME.textDisabledDim,
        wordWrap: { width: cardW - 28 },
      }).setOrigin(0, 0));
      ov.add(c);
    });

    const unlockedCount = list.filter((a) => a.unlocked).length;
    const rows = Math.ceil(list.length / cols);
    ov.add(this.add.text(cx, startY + rows * (cardH + gapY) - 6,
      `已解锁 ${unlockedCount} / ${list.length}`, {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textMuted,
    }).setOrigin(0.5));

    ov.add(this.makeMenuBtn(cx, GAME_HEIGHT - 70, '关闭', () => this.closeAchievements()));
    this.fadeInPanel(ov);
  }

  closeAchievements() {
    if (this.achievementsOverlay) { this.achievementsOverlay.destroy(); this.achievementsOverlay = null; }
    this.achievementsOpen = false;
  }

  // ---- 每日签到面板（P1 升级：7 日循环大奖 + 补签；首次进菜单自动弹）----
  openCheckIn() {
    this.checkinOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.checkinOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx);
    this.addGlowTitle(ov, cx, 230, '每日签到', THEME.textGoldLight);

    const cyc = SaveManager.getCheckinCycle();
    // 7 日循环奖励条（D1~D7，第 7 天大奖高亮；当前进行天描边）
    const REWARD_NAMES = ['50', '60', '70', '80', '90', '100', '800'];
    const boxW = 52, boxH = 58, gap = 6;
    const totalW = 7 * boxW + 6 * gap;
    const startX = cx - totalW / 2 + boxW / 2;
    const cycY = 296;
    for (let i = 0; i < 7; i++) {
      const x = startX + i * (boxW + gap);
      const d = i + 1;
      const isBig = d === 7;
      const isCur = d === cyc.day && !cyc.checkedToday;
      const c = this.add.container(x, cycY);
      const bg = this.add.rectangle(0, 0, boxW, boxH, isBig ? 0x4a3a12 : 0x0d2840, 0.96)
        .setStrokeStyle(2, isBig ? THEME.textGoldLight : (isCur ? COLORS.accent : THEME.lockedStroke));
      c.add(bg);
      c.add(this.add.text(0, -14, `D${d}`, {
        fontFamily: THEME.fontFamily, fontSize: '13px', fontStyle: '700',
        color: isBig ? THEME.textGoldLight : THEME.textSecondary,
      }).setOrigin(0.5));
      c.add(this.add.text(0, 12, isBig ? '大奖' : `+${REWARD_NAMES[i]}`, {
        fontFamily: THEME.fontFamily, fontSize: isBig ? '14px' : '13px', fontStyle: '800',
        color: isBig ? THEME.textGoldLight : THEME.textPrimary,
      }).setOrigin(0.5));
      if (isCur) c.add(this.add.text(0, boxH / 2 - 8, '今', {
        fontFamily: THEME.fontFamily, fontSize: '11px', color: COLORS.accent,
      }).setOrigin(0.5));
      ov.add(c);
    }
    ov.add(this.add.text(cx, cycY + boxH / 2 + 14, '第 7 天大奖：800 金币（僚机未满级再 +1 僚机） · 断签可补签', {
      fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textDim,
    }).setOrigin(0.5));

    const info = this.add.text(cx, 396, `连续签到第 ${cyc.streak || 0} 天\n今日可领：+${(cyc.rewards[cyc.day - 1] != null) ? cyc.rewards[cyc.day - 1] : 50} 金币`, {
      fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textPrimary, align: 'center',
      wordWrap: { width: 360 },
    }).setOrigin(0.5);
    ov.add(info);

    const claimBtn = this.makeMenuBtn(cx, 470, '领取奖励', () => {
      const res = SaveManager.checkIn();
      if (res.claimed) {
        info.setText(`已领取！\n+${res.reward} 金币 · 连续 ${res.streak} 天${res.day === 7 ? ' · 第 7 天大礼' : ''}${res.wingmanUpgraded ? ' · 僚机 +1' : ''}`);
        claimBtn.destroy();
        this._checkinClaimBtn = null;
        if (this.saveInfoText) {
          this.saveInfoText.setText(this._saveInfoLabel());
        }
        // P2 激励广告位预留：签到后提供「看广告双倍」按钮（Ads 成功后金币×2）
        if (Ads.hasAds()) {
          const dbl = new NeonButton(this, cx - 95, 470, '看广告双倍', {
            w: 170, glow: true, onDown: () => {
              audio.sfx('ui');
              dbl.setAlpha(0.45).disableInteractive();
              info.setText('广告播放中…');
              Ads.showRewardAd((ok) => {
                if (ok) {
                  SaveManager.addCoins(res.reward);
                  info.setText(`已领取！\n+${res.reward} 金币 · 看广告双倍再 +${res.reward}`);
                  if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
                  dbl.destroy();
                  this._checkinDoubleBtn = null;
                } else {
                  info.setText(`已领取！\n+${res.reward} 金币 · 双倍未生效`);
                  dbl.setAlpha(1).setInteractive();
                }
              });
            },
          }).container;
          ov.add(dbl);
          this._checkinDoubleBtn = dbl;
        }
        ov.add(new NeonButton(this, cx + 95, 470, '好的', { w: 170, glow: true, onDown: () => this.closeCheckIn() }).container);
      } else {
        info.setText('今天已经签到啦～');
      }
    });
    ov.add(claimBtn);
    this._checkinClaimBtn = claimBtn;

    // P1 补签：断签可消耗金币补 1 天（保留连签进度）
    if (cyc.canMakeup && !cyc.checkedToday) {
      const mkBtn = this.makeMenuBtn(cx, 540, `补签（-${cyc.makeupCost} 金币）`, () => {
        const mk = SaveManager.makeupCheckIn();
        if (mk.claimed) {
          info.setText(`补签成功！\n-${mk.cost} 金币 · 连签 ${mk.streak} 天，今天还能再签到`);
          mkBtn.destroy();
          if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
        } else if (mk.reason === 'no-coins') {
          info.setText(`金币不足，无法补签（需 ${cyc.makeupCost} 金币）`);
        } else {
          info.setText('今天无需补签');
          mkBtn.destroy();
        }
      });
      ov.add(mkBtn);
      this._checkinMakeupBtn = mkBtn;
    }

    ov.add(this.makeMenuBtn(cx, 600, '稍后再说', () => this.closeCheckIn()));
    this.fadeInPanel(ov);
  }

  closeCheckIn() {
    if (this.checkinOverlay) { this.checkinOverlay.destroy(); this.checkinOverlay = null; }
    this.checkinOpen = false;
    this._checkinClaimBtn = null;
    this._checkinDoubleBtn = null;
    this._checkinMakeupBtn = null;
  }

  // ---- 每日任务面板（留存系统 #每日任务）----
  openDailyQuest() {
    this.dailyQuestOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.dailyQuestOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx);
    this.addGlowTitle(ov, cx, 250, '每日任务', THEME.titleColor);

    const quests = SaveManager.getDailyQuests();
    const claimed = SaveManager.dailyQuestsClaimed();
    let cursor = 300;
    quests.forEach((q) => {
      const y = cursor; cursor += 84;
      const label = this.add.text(cx - 200, y, q.desc, {
        fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
      }).setOrigin(0, 0.5);
      const prog = this.add.text(cx + 200, y, `${q.progress}/${q.target}  +${q.reward}`, {
        fontFamily: THEME.fontFamily, fontSize: '16px',
        color: q.done ? THEME.textSuccess : THEME.textSecondary,
      }).setOrigin(1, 0.5);
      // 进度条
      const barW = 380, barX = cx - barW / 2, barY = y + 20;
      const track = this.add.rectangle(barX, barY, barW, 7, THEME.trackBg)
        .setOrigin(0, 0.5).setStrokeStyle(1, THEME.trackStroke);
      const ratio = q.target ? Math.min(1, q.progress / q.target) : 0;
      const fill = this.add.rectangle(barX, barY, barW * ratio, 7, q.done ? THEME.success : THEME.trackFill)
        .setOrigin(0, 0.5);
      ov.add([label, prog, track, fill]);
    });

    const statusText = this.add.text(cx, cursor + 6, claimed ? '今日任务已领取'
      : (SaveManager.dailyQuestsReady() ? '全部完成，可领取奖励！' : '完成上方目标即可领取金币'), {
      fontFamily: THEME.fontFamily, fontSize: '17px', color: claimed ? THEME.textSuccess : THEME.textPrimary,
      align: 'center', wordWrap: { width: 400 },
    }).setOrigin(0.5);
    ov.add(statusText);

    const claimBtn = this.makeMenuBtn(cx, cursor + 60, claimed ? '已领取' : '领取奖励', () => {
      const res = SaveManager.claimDailyQuests();
      if (res.claimed) {
        statusText.setText(`已领取！\n+${res.reward} 金币 · ${res.count} 项任务（含全清奖励 +${res.bonus || 0}）`);
        claimBtn.destroy();
        if (this.saveInfoText) {
          this.saveInfoText.setText(this._saveInfoLabel());
        }
        ov.add(this.makeMenuBtn(cx, cursor + 60, '好的', () => this.closeDailyQuest()));
      } else if (res.notReady) {
        statusText.setText('还有任务没完成哦～');
      }
    });
    if (claimed || !SaveManager.dailyQuestsReady()) claimBtn.setAlpha(0.45);
    ov.add(claimBtn);

    // P1 留存·活跃宝箱：当日游玩 3/5 局各开 1 个宝箱（金币随机 + 随机机库模块，复用 module 系统）
    const acts = SaveManager.getDailyActs();
    const chestY = cursor + 118;
    ov.add(this.add.text(cx, chestY - 24, `活跃宝箱 · 今日已玩 ${acts.count} 局`, {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textGoldLight,
    }).setOrigin(0.5));
    const chest3 = new NeonButton(this, cx - 100, chestY, acts.chests[3] ? '第 3 局 ✓' : '第 3 局宝箱', {
      w: 180, h: 48, fontSize: 16, glow: true,
      onDown: () => {
        const res = SaveManager.claimDailyChest(3);
        if (res.claimed) {
          chest3.setLabel('第 3 局 ✓');
          if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
          this.flashToast(`开箱！+${res.coins} 金币 · 模块 ${res.module || ''}`);
        } else if (res.reason === 'not-enough') {
          this.flashToast(`再玩 ${Math.max(0, 3 - acts.count)} 局可开第 3 局宝箱`);
        }
      },
    });
    if (acts.chests[3] || acts.count < 3) chest3.container.setAlpha(0.55);
    const chest5 = new NeonButton(this, cx + 100, chestY, acts.chests[5] ? '第 5 局 ✓' : '第 5 局宝箱', {
      w: 180, h: 48, fontSize: 16, glow: true,
      onDown: () => {
        const res = SaveManager.claimDailyChest(5);
        if (res.claimed) {
          chest5.setLabel('第 5 局 ✓');
          if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
          this.flashToast(`开箱！+${res.coins} 金币 · 模块 ${res.module || ''}`);
        } else if (res.reason === 'not-enough') {
          this.flashToast(`再玩 ${Math.max(0, 5 - acts.count)} 局可开第 5 局宝箱`);
        }
      },
    });
    if (acts.chests[5] || acts.count < 5) chest5.container.setAlpha(0.55);
    ov.add([chest3.container, chest5.container]);

    ov.add(this.makeMenuBtn(cx, chestY + 70, '稍后再说', () => this.closeDailyQuest()));
    this.fadeInPanel(ov);
  }

  closeDailyQuest() {
    if (this.dailyQuestOverlay) { this.dailyQuestOverlay.destroy(); this.dailyQuestOverlay = null; }
    this.dailyQuestOpen = false;
  }

  // ---- P1 留存·回归激励（断签召回：金币 500 + 随机模块，7 天冷却）----
  /** 断签 ≥3 天且冷却结束 → 自动弹「回归礼包」面板 */
  maybeShowReturnGift() {
    const st = SaveManager.getReturnGiftStatus();
    if (st && st.due) this.openReturnGift(st);
  }

  openReturnGift(st) {
    if (this.returnGiftOpen) return;
    this.returnGiftOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.returnGiftOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.8)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx, 250, GAME_HEIGHT - 180, 460);
    this.addGlowTitle(ov, cx, 340, '回归礼包', THEME.textGoldLight);

    const info = this.add.text(cx, 430, `欢迎回来！已断签 ${(st && st.missDays) || 0} 天\n礼包：500 金币 + 随机机库模块 1 个`, {
      fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textPrimary, align: 'center',
      wordWrap: { width: 380 },
    }).setOrigin(0.5);
    ov.add(info);

    const claimBtn = this.makeMenuBtn(cx - 95, 520, '领取礼包', () => {
      const res = SaveManager.claimReturnGift();
      if (res.claimed) {
        info.setText(`已领取！\n+${res.coins} 金币 · 模块「${res.module || ''}」已入库存`);
        claimBtn.destroy();
        if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
        ov.add(this.makeMenuBtn(cx + 95, 520, '好的', () => this.closeReturnGift()));
      } else {
        info.setText('礼包尚未就绪～');
      }
    });
    ov.add(claimBtn);
    ov.add(this.makeMenuBtn(cx, 590, '稍后再说', () => this.closeReturnGift()));
    this.fadeInPanel(ov);
  }

  closeReturnGift() {
    if (this.returnGiftOverlay) { this.returnGiftOverlay.destroy(); this.returnGiftOverlay = null; }
    this.returnGiftOpen = false;
  }

  // ---- P1 留存·社交排行（本地历史 Top10 列表面板）----
  openLeaderboard() {
    this.leaderboardOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.leaderboardOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx, 90, GAME_HEIGHT - 110, 470);
    this.addGlowTitle(ov, cx, 150, '历史排行榜', THEME.textGoldLight);

    const top = SaveManager.getTopScores();
    const rowH = 54, startY = 210;
    if (!top.length) {
      ov.add(this.add.text(cx, 360, '暂无战绩，快去打一局吧！', {
        fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textSecondary,
      }).setOrigin(0.5));
    } else {
      const MODE_LABEL = { normal: '关卡', endless: '无尽', bossrush: 'RUSH', coin_rush: '冲刺', survival: '生存' };
      top.slice(0, 10).forEach((s, i) => {
        const y = startY + i * rowH;
        const rankColor = i === 0 ? THEME.textGoldLight : (i === 1 ? '#cfe8ff' : (i === 2 ? '#ffb070' : THEME.textSecondary));
        ov.add(this.add.text(cx - 210, y, `${i + 1}`, {
          fontFamily: THEME.fontFamily, fontSize: '24px', fontStyle: '800', color: rankColor,
        }).setOrigin(0.5));
        ov.add(this.add.text(cx - 160, y, `${s.score || 0}`, {
          fontFamily: THEME.scoreFont, fontSize: '24px', fontStyle: '700', color: THEME.white,
        }).setOrigin(0, 0.5));
        const modeName = s.mode === 'endless' ? `无尽 · ${s.levelId || 1}层` : (MODE_LABEL[s.mode] || '关卡');
        ov.add(this.add.text(cx + 40, y, modeName, {
          fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textSecondary,
        }).setOrigin(0, 0.5));
        ov.add(this.add.text(cx + 180, y, s.date || '', {
          fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textDim,
        }).setOrigin(0, 0.5));
      });
    }
    ov.add(this.makeMenuBtn(cx, GAME_HEIGHT - 70, '关闭', () => this.closeLeaderboard()));
    this.fadeInPanel(ov);
  }

  closeLeaderboard() {
    if (this.leaderboardOverlay) { this.leaderboardOverlay.destroy(); this.leaderboardOverlay = null; }
    this.leaderboardOpen = false;
  }

  // ---- 新手 7 日计划面板（P0 留存：新手成长目标）----
  openNewbiePlan() {
    this.newbiePlanOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.newbiePlanOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx, 60, GAME_HEIGHT - 36, 472);
    this.addGlowTitle(ov, cx, 92, '新手计划', THEME.titleColor);

    const list = SaveManager.getNewbiePlan();
    const rowH = 74, startY = 156;
    list.forEach((d, i) => {
      const y = startY + i * rowH;
      const isActive = d.isCurrent && !d.claimed;
      const c = this.add.container(cx, y);
      const bg = this.add.rectangle(0, 0, 440, 66, d.claimed ? THEME.achBg : (isActive ? THEME.btnBg : THEME.lockedBg), 0.96)
        .setStrokeStyle(2, isActive ? THEME.titleColor : (d.claimed ? 0x2f6f96 : THEME.lockedStroke));
      c.add(bg);
      const titleColor = d.claimed ? THEME.textSuccess : (isActive ? THEME.white : THEME.textDisabled);
      c.add(this.add.text(-208, -20, `D${d.day} ${d.desc}`, {
        fontFamily: THEME.fontFamily, fontSize: '18px', fontStyle: '700', color: titleColor,
      }).setOrigin(0, 0.5));
      const rewardTxt = d.day === 7 ? `+${d.reward}金币+僚机` : `+${d.reward}金币`;
      c.add(this.add.text(208, -20, rewardTxt, {
        fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textGold,
      }).setOrigin(1, 0.5));
      // 进度条
      const barW = 392, barX = -barW / 2, barY = 12;
      const track = this.add.rectangle(barX, barY, barW, 8, THEME.trackBg)
        .setOrigin(0, 0.5).setStrokeStyle(1, THEME.trackStroke);
      const ratio = d.target ? Math.min(1, d.progress / d.target) : 0;
      const fill = this.add.rectangle(barX, barY, barW * ratio, 8, (d.claimed || d.done) ? THEME.success : THEME.trackFill)
        .setOrigin(0, 0.5);
      const status = d.claimed ? '已领取' : (d.done ? '可领取' : `${d.progress}/${d.target}`);
      const statusColor = d.claimed ? THEME.textSuccess : (d.done ? THEME.textGold : THEME.textSecondary);
      c.add(this.add.text(208, barY, status, {
        fontFamily: THEME.fontFamily, fontSize: '14px', fontStyle: '700', color: statusColor,
      }).setOrigin(1, 0.5));
      c.add([track, fill]);
      ov.add(c);
    });

    const claimable = list.some((d) => d.isCurrent && d.done);
    const claimBtn = this.makeMenuBtn(cx, startY + list.length * rowH + 16, '领取当日奖励', () => {
      const res = SaveManager.claimNewbieDay();
      if (res.claimed) {
        this.closeNewbiePlan();
        this.openNewbiePlan();
        if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
        this.flashToast(res.day === 7
          ? `第 7 天奖励！+${res.reward} 金币 · 僚机升级${res.wingmanUpgraded ? ' +1' : '（已满级改发金币）'}`
          : `领取 D${res.day} 奖励 · +${res.reward} 金币`);
      } else {
        this.flashToast('当日目标还没完成哦～');
      }
    });
    if (!claimable) claimBtn.setAlpha(0.45);
    ov.add(claimBtn);
    ov.add(this.makeMenuBtn(cx, startY + list.length * rowH + 78, '关闭', () => this.closeNewbiePlan()));
    this.fadeInPanel(ov);
  }

  closeNewbiePlan() {
    if (this.newbiePlanOverlay) { this.newbiePlanOverlay.destroy(); this.newbiePlanOverlay = null; }
    this.newbiePlanOpen = false;
  }

  // ---- 本周活动面板（P0 留存：活动轮换）----
  openEvent() {
    this.eventOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.eventOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx, 160, GAME_HEIGHT - 160, 470);
    this.addGlowTitle(ov, cx, 240, '本周活动', THEME.titleColor);

    const ev = getCurrentEvent();
    ov.add(this.add.text(cx, 356, ev.name, {
      fontFamily: THEME.fontFamily, fontSize: '40px', fontStyle: '800',
      color: ev.double ? THEME.textGoldLight : THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 16, true, true));
    ov.add(this.add.text(cx, 420, ev.desc, {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary, align: 'center',
      wordWrap: { width: 400 },
    }).setOrigin(0.5));
    ov.add(this.add.text(cx, 500, `剩余 ${ev.daysLeft} 天 · ${ev.double ? '今日双倍奖励' : '周末双倍奖励'}`, {
      fontFamily: THEME.fontFamily, fontSize: '18px',
      color: ev.double ? THEME.textGold : THEME.textSecondary,
    }).setOrigin(0.5));

    ov.add(this.makeMenuBtn(cx, 590, `进入${ev.short}`, () => {
      audio.sfx('ui');
      this.scene.start(SCENES.GAME, { mode: ev.id });
    }));
    ov.add(this.makeMenuBtn(cx, 670, '关闭', () => this.closeEvent()));
    this.fadeInPanel(ov);
  }

  closeEvent() {
    if (this.eventOverlay) { this.eventOverlay.destroy(); this.eventOverlay = null; }
    this.eventOpen = false;
  }

  /** 顶部轻提示（领奖/提示用），不阻塞交互 */
  flashToast(msg) {
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, msg, {
      fontFamily: THEME.fontFamily, fontSize: '22px', fontStyle: '800', color: THEME.textGoldLight,
    }).setOrigin(0.5).setDepth(400).setShadow(0, 0, '#000000', 8, true, true).setAlpha(0);
    this.tweens.add({
      targets: t, alpha: 1, y: '-=16', duration: 260, yoyo: true, hold: 1000,
      onComplete: () => t.destroy(),
    });
  }

  makeSlider(ov, cx, y, label, type) {
    const val = audio.getVolume(type);
    const lab = this.add.text(cx - 150, y, label, {
      fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    const trackW = 220, trackH = 8, tx = cx - 10;
    const track = this.add.rectangle(tx, y, trackW, trackH, THEME.trackBg)
      .setStrokeStyle(1, THEME.trackStroke).setInteractive();
    const fill = this.add.rectangle(tx - trackW / 2, y, trackW * val, trackH, THEME.trackFill)
      .setOrigin(0, 0.5);
    const knob = this.add.circle(tx - trackW / 2 + trackW * val, y, 12, THEME.titleColor)
      .setStrokeStyle(2, THEME.whiteHex).setInteractive({ useHandCursor: true });
    const valTxt = this.add.text(tx + trackW / 2 + 16, y, `${Math.round(val * 100)}%`, {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textMuted,
    }).setOrigin(0, 0.5);
    ov.add([lab, track, fill, knob, valTxt]);
    const apply = (t) => {
      t = Phaser.Math.Clamp(t, 0, 1);
      knob.x = tx - trackW / 2 + trackW * t;
      fill.width = trackW * t;
      valTxt.setText(`${Math.round(t * 100)}%`);
      audio.setVolume(type, t, true);
    };
    track.on('pointerdown', (p) => apply((p.x - (tx - trackW / 2)) / trackW));
    knob.on('pointerdown', (p) => apply((p.x - (tx - trackW / 2)) / trackW));
  }

  makeMenuBtn(x, y, label, cb) {
    return new NeonButton(this, x, y, label, { glow: true, onDown: cb }).container;
  }

  /** 辉光标题：副本层发光 + 本体，呼吸脉动（reduced-motion 下静态） */
  addGlowTitle(ov, cx, y, text, colorHex) {
    const glow = this.add.text(cx, y, text, {
      fontFamily: THEME.fontFamily, fontSize: '34px', fontStyle: '800', color: colorHex,
    }).setOrigin(0.5).setShadow(0, 0, colorHex, 30, true, true).setAlpha(0.3);
    const title = this.add.text(cx, y, text, {
      fontFamily: THEME.fontFamily, fontSize: '34px', fontStyle: '800', color: colorHex,
    }).setOrigin(0.5).setShadow(0, 0, colorHex, 14, true, true);
    ov.add(glow);
    ov.add(title);
    if (!this.reduceMotion) {
      this.tweens.add({ targets: glow, alpha: { from: 0.22, to: 0.46 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    return { glow, title };
  }

  /** 面板入场：淡入 + 轻微上滑（reduced-motion 下静态直接显示） */
  fadeInPanel(ov) {
    if (this.reduceMotion) { ov.setAlpha(1); return; }
    ov.setAlpha(0);
    ov.y = 18;
    this.tweens.add({ targets: ov, alpha: 1, y: 0, duration: 260, ease: 'Cubic.out' });
  }

  /** 统一的内嵌霓虹面板背景：玻璃拟态卡片（半透 + 内发光 + 顶部高光），套在 dim 之上、内容之下 */
  addPanel(ov, cx, top = 70, bottom = GAME_HEIGHT - 50, w = 460) {
    const g = this.add.graphics();
    drawGlassPanel(g, cx, top, bottom, w, THEME.panelRadius);
    ov.add(g);
  }
}
