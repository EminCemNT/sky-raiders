import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVELS, DIFFICULTIES, PERFORMANCE, MEDALS, getCurrentEvent, TOUCH, CODEX_DECOR, EASE, TIPS, DAILY_CHALLENGE } from '../config/GameConfig.js'; // OPT-16 C5 今日挑战入口
import { SaveManager } from '../utils/SaveManager.js';
import { copySaveText, downloadSaveFile, importSave, resetProgress } from '../utils/SaveTransfer.js'; // OPT-16 C4/C8
import { hapticsSupported } from '../utils/Haptics.js'; // OPT-16 C7 移动端震动开关
import { t, setLocale } from '../config/Locale.js';
import { Ads } from '../systems/Ads.js';
import { AchievementManager } from '../systems/AchievementManager.js';
import { Codex, CODEX_ENTRIES } from '../systems/Codex.js';
import { createStarfield, MENU_BG_THEME } from '../systems/Starfield.js';
import { transition } from '../systems/TransitionManager.js';
import { audio } from '../systems/AudioSystem.js';
import { NeonButton, THEME, drawGlassPanel } from '../utils/UIWidgets.js';
import { enableSceneBloom } from '../utils/BloomFX.js';
import { applyFilmLayer } from '../utils/FilmFX.js';
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
    this.codexOpen = false; // OPT-13 批B B13 图鉴面板标志
    // reduced-motion 偏好（子面板动画降级）
    this.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // 背景滚动星空（UI P2：主题化 = 星云脉动 + 近景剪影，reduced-motion 自动降级为静态）
    this.starfield = createStarfield(this, { theme: MENU_BG_THEME });

    // P1 表现工程·PostFX 辉光（可选场景；按性能档开，low 关 / Canvas 自动降级）。
    // OPT-14 A2：静态场景加脏标记（staticMode），避免每帧重绘烧成本。
    this.bloomFX = enableSceneBloom(this, SaveManager.load().quality || PERFORMANCE.defaultTier, { staticMode: true });
    // OPT-14 A3：菜单电影层（常驻暗角 + 静态颗粒；grainSpeed=false 防闪烁，红线）
    this.filmFX = applyFilmLayer(this, { key: 'menu' });

    // 动态注册机库场景（GameConfig 只读，未登记 HANGAR，故运行时注册一次）
    if (!this.scene.get('HangarScene')) {
      this.scene.add('HangarScene', HangarScene, false);
    }

    // 标题（霓虹辉光层 + 本体 + 呼吸脉动）
    this.titleGlow = this.add.text(cx, 218, t('title'), {
      fontFamily: THEME.fontFamily, fontSize: '62px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleColor, 38, true, true).setAlpha(0.32).setDepth(1);
    this.title = this.add.text(cx, 218, t('title'), {
      fontFamily: THEME.fontFamily, fontSize: '58px', fontStyle: '800', color: THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 24, true, true).setDepth(2);
    this.tweens.add({ targets: [this.title, this.titleGlow], scale: { from: 1, to: 1.035 }, duration: 1700, yoyo: true, repeat: -1, ease: EASE.breathe });
    this.tweens.add({ targets: this.titleGlow, alpha: { from: 0.26, to: 0.5 }, duration: 1700, yoyo: true, repeat: -1, ease: EASE.breathe });

    // 英文名（宽字距 + 副色呼吸）
    this.subTitle = this.add.text(cx, 284, t('subtitle'), {
      fontFamily: THEME.fontFamily, fontSize: '17px', color: THEME.subBright, fontStyle: '700',
    }).setOrigin(0.5).setAlpha(0.75).setDepth(2).setLetterSpacing(8);
    this.tweens.add({ targets: this.subTitle, alpha: { from: 0.5, to: 0.95 }, duration: 2200, yoyo: true, repeat: -1, ease: EASE.breathe });

    // OPT-16 C9 主菜单轮换战术提示（纯展示零业务）：顶部空隙一条 tips，点击「下一条」轮换。
    // 放 y=40（顶版号 y14 之下、标题能量环 y74 之上），不与任何主按钮/controlsHint/存档信息重叠。
    // reduced-motion 友好：入场淡入省略（静态直接显示）；词条缺失/空池静默隐藏（C9.5）。
    this.tipText = this.add.text(cx, 40, '', {
      fontFamily: THEME.fontFamily, fontSize: '13px', fontStyle: '700', color: THEME.subBright,
    }).setOrigin(0.5).setAlpha(0.9).setDepth(2).setInteractive({ useHandCursor: true });
    this.tipText.on('pointerdown', () => { audio.sfx('ui'); this._nextTip(); });
    if (!this.reduceMotion) {
      this.tipText.setAlpha(0);
      this.tweens.add({ targets: this.tipText, alpha: 0.9, duration: 320, ease: EASE.enter });
    }
    this._renderTip();

    // 标题能量环装饰（缓慢旋转 + 脉动）
    this.energyRing = this.add.graphics().setPosition(cx, 218).setDepth(0);
    this.energyRing.lineStyle(3, COLORS.accent, 0.5).strokeCircle(0, 0, 132);
    this.energyRing.lineStyle(1, 0xffffff, 0.25).strokeCircle(0, 0, 120);
    this.energyRing.lineStyle(2, 0x66ccff, 0.3).strokeCircle(0, 0, 144);
    this.tweens.add({ targets: this.energyRing, angle: 360, duration: 28000, repeat: -1 });
    this.tweens.add({ targets: this.energyRing, scale: { from: 0.97, to: 1.05 }, duration: 3200, yoyo: true, repeat: -1, ease: EASE.breathe });

    // OPT-13 批B B13 图鉴收藏入口（收集型玩家长期目标；面板内可购买装饰金币出口）
    new NeonButton(this, cx, 330, t('btnCodex'), { stroke: 0x9a6fd6, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen || this.codexOpen) return;
      audio.sfx('ui'); this.openCodex();
    } });

    // 教程按钮（重看新手引导，进入第 1 关并强制显示教程）
    new NeonButton(this, cx, 400, t('btnTutorial'), {
      stroke: COLORS.accent, fontSize: 22, glow: true, onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        audio.resume(); audio.startBgm(); audio.sfx('ui');
        transition.goto(this, SCENES.GAME, { levelId: 1, mode: 'normal', forceTutorial: true });
      },
    });

    // 主入口：开始游戏（主线进度） + 无尽模式（Score Attack），并排两个主按钮
    new NeonButton(this, cx - 116, 480, t('btnStart'), {
      w: 220, fontSize: 24, glow: true,
      onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        audio.resume(); audio.startBgm(); audio.sfx('ui'); this.startGame();
      },
    });

    new NeonButton(this, cx + 116, 480, t('btnEndless'), {
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
        this.flashToast(t('leagueSettled', { rank: snap.settledRank, coins: snap.reward }));
      }
    }

    // 机库按钮
    new NeonButton(this, cx, 548, t('btnHangar'), {
      glow: true,
      onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        transition.goto(this, 'HangarScene');
      },
    });

    // 成就按钮
    new NeonButton(this, cx, 616, t('btnAchievements'), { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openAchievements();
    } });

    // 设置按钮
    new NeonButton(this, cx, 680, t('btnSettings'), { glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      this.openSettings();
    } });

    // Boss Rush 按钮
    new NeonButton(this, cx - 116, 736, 'BOSS RUSH', { stroke: 0xff5566, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); transition.goto(this, SCENES.GAME, { mode: 'bossrush' });
    } });

    // P0 留存-活动轮换：本周活动入口（显示当前活动名 + 剩余天数，点开进入对应模式）
    {
      const ev = getCurrentEvent();
      new NeonButton(this, cx + 116, 736, t('weeklyEvent', { short: t(`eventName_${ev.id || 'coin_rush'}`) }), { w: 220, fontSize: 18, stroke: 0xffd54a, glow: true, onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
        audio.sfx('ui'); this.openEvent();
      } });
      this.add.text(cx + 116, 772, t('eventLeft', { days: ev.daysLeft, double: t(ev.double ? 'eventDoubleToday' : 'eventDoubleWeekend') }), {
        fontFamily: THEME.fontFamily, fontSize: '13px', color: ev.double ? THEME.textGold : THEME.textDim,
      }).setOrigin(0.5).setAlpha(0.9);
    }

    // 选择关卡按钮
    new NeonButton(this, cx, 800, t('btnLevelSelect'), { glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openLevelSelect();
    } });

    // 每日签到按钮（主动点击才弹，避免自动弹窗挡住"开始游戏"）
    new NeonButton(this, cx - 116, 864, t('btnCheckin'), { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openCheckIn();
    } });

    // P0 留存-新手计划按钮（挂到签到旁）
    new NeonButton(this, cx + 116, 864, t('btnNewbiePlan'), { stroke: 0x7cffa0, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openNewbiePlan();
    } });

    // 每日任务按钮（留存系统：击杀/金币/炸弹等每日目标，完成领金币 + 活跃宝箱）
    new NeonButton(this, cx - 116, 928, t('btnDailyQuest'), { stroke: COLORS.accent, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.dailyQuestOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openDailyQuest();
    } });

    // P1 留存·社交排行：排行榜入口（本地历史 Top10 列表）
    new NeonButton(this, cx + 116, 928, t('btnLeaderboard'), { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.dailyQuestOpen || this.eventOpen || this.newbiePlanOpen || this.leaderboardOpen || this.returnGiftOpen) return;
      audio.sfx('ui'); this.openLeaderboard();
    } });

    // 存档信息（含全局最高分）
    this.saveInfoText = this.add.text(cx, GAME_HEIGHT - 44,
      this._saveInfoLabel(), {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textSecondary,
    }).setOrigin(0.5).setAlpha(0.8);

    this.add.text(cx, GAME_HEIGHT - 20,
      t('controlsHint'), {
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

    // P2 视觉四件套⑦：作为转场目标时淡入揭示（无过渡时为 no-op，零影响）
    transition.fadeIn(this);
  }

  update(_, dt) {
    if (this.starfield) this.starfield.update(dt);
  }

  startGame() {
    // OPT-16 C2 防御：昵称编辑浮层打开时忽略键盘快捷（避免误触发开局）
    if (this._nickInputEl) return;
    // 「开始游戏」= 进入已解锁的最高关（继续进度）
    const unlocked = SaveManager.load().unlockedLevel || 1;
    const lvl = Math.min(unlocked, LEVELS.length);
    transition.goto(this, SCENES.GAME, { levelId: lvl });
  }

  /** 无尽模式（Score Attack）：无限波次 + 难度递增，直到命尽 */
  startEndless() {
    if (this._nickInputEl) return; // OPT-16 C2 防御同上
    transition.goto(this, SCENES.GAME, { mode: 'endless', levelId: 1 });
  }

  /** 底部存档信息文案（金币 / 最高分 / 勋章 / 已解锁关卡），多处共用保持一致 */
  _saveInfoLabel() {
    const sv = SaveManager.load();
    return t('saveInfo', {
      coins: sv.coins, best: sv.bestScore || 0,
      medals: SaveManager.countMedals(), level: sv.unlockedLevel,
    });
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
    return t('leagueLabel', { rank: (snap && snap.rank) || 0, days: this._weekDaysLeft() });
  }

  // ---- 设置面板（P0 音量设置 + P1 表现工程：灵敏度 / 触控偏移 / 语言）----
  openSettings() {
    this.settingsOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.settingsOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx, 70, 928); // OPT-16 C4/C8：底部加高，容纳存档管理行
    this.addGlowTitle(ov, cx, 250, t('settingsTitle'), THEME.titleColor);

    // 四档难度按钮（P0）：一排四档，当前档选中高亮；点击切换 → 持久化 + 刷新高亮
    this._difficultyBtns = [];
    const diffLabel = this.add.text(cx, 292, t('difficulty'), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0.5);
    ov.add(diffLabel);
    const btnW = 92, btnH = 46, gap = 8;
    const totalW = DIFFICULTIES.length * btnW + (DIFFICULTIES.length - 1) * gap;
    const startX = cx - totalW / 2 + btnW / 2;
    DIFFICULTIES.forEach((d, i) => {
      const x = startX + i * (btnW + gap);
      const btn = new NeonButton(this, x, 330, t(`diff_${d.id}`), {
        w: btnW, h: btnH, fontSize: 16, glow: true,
        onDown: () => {
          this._trySelectDifficulty(d.id); // OPT-16 C1 难度门禁：勋章不足时拦截 hard/hell 新点击
        },
      });
      ov.add(btn.container);
      this._difficultyBtns.push({ btn, id: d.id });
    });
    this.refreshDifficultySelect();

    // 画质档位按钮（P0 性能三件套）：三档画质，当前档选中高亮；点击切换 → 持久化 + 刷新高亮
    this._qualityBtns = [];
    const qLabel = this.add.text(cx, 372, t('quality'), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0.5);
    ov.add(qLabel);
    const qW = 92, qH = 46;
    const qTotalW = PERFORMANCE.tiers.length * qW + (PERFORMANCE.tiers.length - 1) * gap;
    const qStartX = cx - qTotalW / 2 + qW / 2;
    const QUALITY_NAMES = { high: t('qualityHigh'), mid: t('qualityMid'), low: t('qualityLow') };
    PERFORMANCE.tiers.forEach((t2, i) => {
      const x = qStartX + i * (qW + gap);
      const btn = new NeonButton(this, x, 410, QUALITY_NAMES[t2] || t2, {
        w: qW, h: qH, fontSize: 16, glow: true,
        onDown: () => {
          audio.sfx('ui');
          SaveManager.set('quality', t2);
          this.refreshQualitySelect();
        },
      });
      ov.add(btn.container);
      this._qualityBtns.push({ btn, id: t2 });
    });
    this.refreshQualitySelect();

    // P2 激励广告位预留：去广告开关（本地立即生效，未来接付费解锁）
    const adLabel = this.add.text(cx - 150, 452, t('noAds'), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    ov.add(adLabel);
    const adBtn = new NeonButton(this, cx + 60, 452, '', { w: 170, h: 40, fontSize: 15, glow: true, onDown: () => {
      audio.sfx('ui');
      const cur = !!SaveManager.load().noAds;
      SaveManager.set('noAds', !cur);
      this.refreshNoAdsSelect();
    } });
    ov.add(adBtn.container);
    this._noAdsBtn = adBtn;
    this.refreshNoAdsSelect();

    // P1 表现工程·触控偏移开关（默认开=手指下方 36px；关=旧手感手指上方 40px）
    const tOffLabel = this.add.text(cx - 150, 494, t('touchOffset'), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    ov.add(tOffLabel);
    const tOffBtn = new NeonButton(this, cx + 60, 494, '', { w: 170, h: 40, fontSize: 15, glow: true, onDown: () => {
      audio.sfx('ui');
      const cur = SaveManager.load().touchOffset || 0;
      SaveManager.set('touchOffset', cur > 0 ? 0 : 36);
      this.refreshTouchOffsetSelect();
    } });
    ov.add(tOffBtn.container);
    this._touchOffsetBtn = tOffBtn;
    this.refreshTouchOffsetSelect();

    this.makeSlider(ov, cx, 536, t('masterVol'), 'master');
    this.makeSlider(ov, cx, 588, t('sfxVol'), 'sfx');
    this.makeSlider(ov, cx, 640, t('bgmVol'), 'bgm');
    // P1 表现工程·灵敏度滑杆（0.5~1.5，拖动 lerp 系数 = 0.35 × sensitivity，封顶 0.6）
    this._sensSlider = this.makeSlider(ov, cx, 692, t('sensitivity'), null, {
      min: TOUCH.SENS_MIN, max: TOUCH.SENS_MAX,
      getValue: () => SaveManager.load().sensitivity || 1,
      display: (v) => `×${v.toFixed(2)}`,
      onChange: (v) => { SaveManager.set('sensitivity', Math.round(v * 100) / 100); },
    });
    // P1 表现工程·语言切换（中文 / English）：切换后存档 + 全局语言 + 场景重启重建文案
    const langLabel = this.add.text(cx - 150, 744, t('language'), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    ov.add(langLabel);
    const langBtn = new NeonButton(this, cx + 60, 744, '', { w: 170, h: 32, fontSize: 15, glow: true, onDown: () => {
      audio.sfx('ui');
      const cur = SaveManager.load().lang || 'zh';
      const next = cur === 'en' ? 'zh' : 'en';
      SaveManager.set('lang', next);
      setLocale(next);
      this.closeSettings();
      this.scene.restart();
    } });
    ov.add(langBtn.container);
    this._langBtn = langBtn;
    this.refreshLangSelect();

    // OPT-16 C7 移动端震动开关：平台支持才显示（桌面 navigator.vibrate 缺失 → 整行隐藏，不报错 C7.4）
    if (hapticsSupported()) {
      const hapLabel = this.add.text(cx - 150, 776, t('haptics'), {
        fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
      }).setOrigin(0, 0.5);
      ov.add(hapLabel);
      const hapBtn = new NeonButton(this, cx + 60, 776, '', { w: 170, h: 32, fontSize: 14, glow: true, onDown: () => {
        audio.sfx('ui');
        SaveManager.set('haptics', SaveManager.load().haptics === false); // false→开；开/缺省→关
        this.refreshHapticsSelect();
      } });
      ov.add(hapBtn.container);
      this._hapticsBtn = hapBtn;
      this.refreshHapticsSelect();
    }

    // OPT-16 C2 昵称编辑器：昵称行（标签 + 当前值/编辑按钮）。点击弹 DOM 输入浮层，
    // 校验后写既有 nickname（零新存档字段）；结算分享卡 _resolveNickname 自动走用户值。
    const nickLabel = this.add.text(cx - 150, 812, t('nicknameEdit'), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    ov.add(nickLabel);
    const nickBtn = new NeonButton(this, cx + 60, 812, '', { w: 170, h: 34, fontSize: 13, glow: true, onDown: () => {
      audio.sfx('ui');
      this._openNicknameEditor();
    } });
    ov.add(nickBtn.container);
    this._nicknameBtn = nickBtn;
    this.refreshNicknameRow();

    // OPT-16 C4/C8 存档管理（底部低风险区）：导出存档 / 导入存档 + 重置进度，关闭钮并入末行
    {
      const exportBtn = new NeonButton(this, cx - 95, 852, t('saveExport'), {
        w: 180, h: 38, fontSize: 14, glow: true, onDown: () => this._onExportSave(),
      });
      ov.add(exportBtn.container);
      this._saveExportBtn = exportBtn;
      const importBtn = new NeonButton(this, cx + 95, 852, t('saveImport'), {
        w: 180, h: 38, fontSize: 14, glow: true, onDown: () => this._onImportSave(),
      });
      ov.add(importBtn.container);
      this._saveImportBtn = importBtn;
      const resetBtn = new NeonButton(this, cx - 95, 896, t('resetProgress'), {
        w: 180, h: 38, fontSize: 14, stroke: THEME.lockedStroke, glow: false, onDown: () => this._onResetProgress(),
      });
      ov.add(resetBtn.container);
      this._resetProgressBtn = resetBtn;
      ov.add(new NeonButton(this, cx + 95, 896, t('close'), {
        w: 180, h: 38, fontSize: 14, onDown: () => this.closeSettings(),
      }).container);
    }
    this.fadeInPanel(ov);
  }

  /** 刷新去广告开关选中态（noAds=true 高亮 = 纯净版已开启） */
  refreshNoAdsSelect() {
    const cur = !!SaveManager.load().noAds;
    if (this._noAdsBtn) {
      this._noAdsBtn.setLabel(cur ? t('pureOn') : t('pureOff'));
      this._noAdsBtn.setSelected(cur);
    }
  }

  /** 刷新触控偏移开关选中态（touchOffset>0 高亮 = 已开启） */
  refreshTouchOffsetSelect() {
    const cur = (SaveManager.load().touchOffset || 0) > 0;
    if (this._touchOffsetBtn) {
      this._touchOffsetBtn.setLabel(cur ? t('pureOn') : t('pureOff'));
      this._touchOffsetBtn.setSelected(cur);
    }
  }

  /** 刷新语言按钮选中态（当前语言高亮） */
  refreshLangSelect() {
    const cur = SaveManager.load().lang || 'zh';
    if (this._langBtn) {
      this._langBtn.setLabel(cur === 'en' ? t('langEn') : t('langZh'));
      this._langBtn.setSelected(cur === 'en');
    }
  }

  /** OPT-16 C7 刷新震动开关按钮（开=高亮；关=默认） */
  refreshHapticsSelect() {
    const on = SaveManager.load().haptics !== false;
    if (this._hapticsBtn) {
      this._hapticsBtn.setLabel(on ? t('hapticsOn') : t('hapticsOff'));
      this._hapticsBtn.setSelected(on);
    }
  }

  // ---- OPT-16 C2 昵称编辑器：设置面板昵称行 + DOM 输入浮层 ----

  /** C2 校验昵称：trim 后 1–12 字符，字符集 中文字母数字_-（PM 假设） */
  _validateNickname(raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (v.length < 1 || v.length > 12) return { ok: false, reason: 'len' };
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(v)) return { ok: false, reason: 'char' };
    return { ok: true, value: v };
  }

  /** C2 昵称行展示文案：非空=用户昵称；空=默认名+随机后缀（纯展示，不写档） */
  _nicknameRowLabel() {
    const s = SaveManager.load();
    if (typeof s.nickname === 'string' && s.nickname) return s.nickname;
    if (this._nickPreviewSuffix == null) {
      this._nickPreviewSuffix = String(Math.floor(Math.random() * 90) + 10); // 10-99
    }
    return `${t('nicknameDefault')}·${this._nickPreviewSuffix}`;
  }

  /** C2 刷新昵称按钮文案（含随机后缀预览，仅展示不写档） */
  refreshNicknameRow() {
    if (this._nicknameBtn) {
      this._nicknameBtn.setLabel(this._nicknameRowLabel());
      this._nicknameBtn.setSelected(false);
    }
  }

  /** C2 昵称编辑浮层：半透明遮罩 + DOM <input>（纯本地，无网络/后端）。确认合法才写 nickname。 */
  _openNicknameEditor() {
    if (this._nickInputEl) return; // 已打开，避免重复叠层
    const s = SaveManager.load();
    const cur = (typeof s.nickname === 'string' && s.nickname) ? s.nickname : '';
    const ov = document.createElement('div');
    ov.id = 'nickname-editor-overlay';
    Object.assign(ov.style, {
      position: 'fixed', inset: '0', zIndex: '9500',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(2,6,14,0.82)',
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      width: '300px', padding: '22px 20px 18px', boxSizing: 'border-box',
      background: 'linear-gradient(180deg,#0e2740,#081627)',
      border: '1px solid rgba(124,243,255,.6)', borderRadius: '14px',
      boxShadow: '0 0 26px rgba(80,200,255,.35), inset 0 0 0 1px rgba(120,200,255,.08)',
      textAlign: 'center',
    });
    const title = document.createElement('div');
    title.textContent = t('nicknameEdit');
    Object.assign(title.style, {
      color: '#7cf3ff', fontSize: '18px', fontWeight: '800', letterSpacing: '2px',
      marginBottom: '14px', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 12;
    input.value = cur;
    input.placeholder = t('nicknamePlaceholder');
    Object.assign(input.style, {
      width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '8px',
      border: '1px solid rgba(124,243,255,.5)', background: 'rgba(3,10,20,.9)',
      color: '#eaf6ff', fontSize: '17px', outline: 'none', textAlign: 'center',
      fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    });
    const err = document.createElement('div');
    Object.assign(err.style, {
      minHeight: '20px', marginTop: '8px', color: '#ff7a7a', fontSize: '13px', lineHeight: '20px',
    });
    const btns = document.createElement('div');
    Object.assign(btns.style, { display: 'flex', gap: '12px', marginTop: '6px' });
    const mkBtn = (label, color, border) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, {
        flex: '1', padding: '9px 0', borderRadius: '8px', cursor: 'pointer',
        color, background: 'rgba(20,40,70,.8)', border: `1px solid ${border}`,
        fontSize: '15px', fontWeight: '700', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
      });
      return b;
    };
    const okBtn = mkBtn(t('saveOk'), '#ffd86b', 'rgba(255,216,107,.8)');
    const cancelBtn = mkBtn(t('close'), '#bcd7ee', 'rgba(150,180,210,.5)');
    btns.append(okBtn, cancelBtn);
    card.append(title, input, err, btns);
    ov.append(card);
    document.body.appendChild(ov);
    this._nickInputEl = ov;
    this._nickInputHandler = (e) => {
      // 阻止冒泡：MenuScene create 里全局 keydown-ENTER/SPACE 会 startGame，不能在编辑昵称时误触发
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    };
    input.addEventListener('keydown', this._nickInputHandler);
    const cleanup = () => {
      if (this._nickInputEl) { this._nickInputEl.remove(); this._nickInputEl = null; }
      if (this._nickInputHandler) { input.removeEventListener('keydown', this._nickInputHandler); this._nickInputHandler = null; }
      if (this._nickEditorCallback) this._nickEditorCallback = null;
    };
    okBtn.addEventListener('click', () => {
      const res = this._validateNickname(input.value);
      if (!res.ok) {
        err.textContent = res.reason === 'len' ? t('nicknameLenErr', { n: 12 }) : t('nicknameCharErr');
        input.style.borderColor = '#ff7a7a';
        return;
      }
      SaveManager.set('nickname', res.value);
      this.refreshNicknameRow();
      this.flashToast(t('saveOk'));
      cleanup();
    });
    cancelBtn.addEventListener('click', () => {
      err.textContent = '';
      cleanup();
    });
    // 点遮罩关闭（不写档）
    ov.addEventListener('pointerdown', (e) => {
      if (e.target === ov) { cleanup(); }
    });
    setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 30);
  }

  /** 关闭昵称浮层（外部调用：closeSettings/语言切换等兜底清理） */
  _closeNicknameEditor() {
    if (this._nickInputEl) {
      if (this._nickInputHandler) this._nickInputHandler = null;
      this._nickInputEl.remove();
      this._nickInputEl = null;
    }
  }

  // ---- OPT-16 C4/C8 存档导出/导入/重置（逻辑在独立文件 SaveTransfer.js；设置面板底部入口）----

  /** C4 导出存档：点击即复制到剪贴板并 toast；剪贴板不可用回退下载 .json */
  async _onExportSave() {
    audio.sfx('ui');
    try {
      const res = await copySaveText();
      if (res && res.ok) { this.flashToast(t('saveExportOk')); return; }
    } catch (e) { /* 回退下载 */ }
    const dl = downloadSaveFile();
    this.flashToast(dl.ok ? t('saveExportOk') : t('saveImportFail'));
  }

  /** C4 导入存档：DOM 浮层粘贴 JSON → importSave（结构校验/sanitize/备份/覆盖全在内部） */
  _onImportSave() {
    audio.sfx('ui');
    if (this._saveImportEl) return; // 防重复叠层
    const ov = document.createElement('div');
    ov.id = 'save-import-overlay';
    Object.assign(ov.style, {
      position: 'fixed', inset: '0', zIndex: '9500',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(2,6,14,0.82)',
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      width: '440px', maxWidth: '94vw', padding: '22px 20px 18px', boxSizing: 'border-box',
      background: 'linear-gradient(180deg,#0e2740,#081627)',
      border: '1px solid rgba(124,243,255,.6)', borderRadius: '14px',
      boxShadow: '0 0 26px rgba(80,200,255,.35), inset 0 0 0 1px rgba(120,200,255,.08)',
      textAlign: 'center',
    });
    const title = document.createElement('div');
    title.textContent = t('saveImport');
    Object.assign(title.style, {
      color: '#7cf3ff', fontSize: '18px', fontWeight: '800', letterSpacing: '2px',
      marginBottom: '14px', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    });
    const ta = document.createElement('textarea');
    ta.placeholder = t('saveImportPlaceholder');
    Object.assign(ta.style, {
      width: '100%', boxSizing: 'border-box', height: '150px', resize: 'vertical',
      padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(124,243,255,.5)',
      background: 'rgba(3,10,20,.9)', color: '#eaf6ff', fontSize: '13px', outline: 'none',
      fontFamily: 'Consolas, Menlo, monospace', textAlign: 'left',
    });
    const err = document.createElement('div');
    Object.assign(err.style, { minHeight: '20px', marginTop: '8px', color: '#ff7a7a', fontSize: '13px', lineHeight: '20px' });
    const btns = document.createElement('div');
    Object.assign(btns.style, { display: 'flex', gap: '12px', marginTop: '6px' });
    const mkBtn = (label, color, border) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, {
        flex: '1', padding: '10px 0', borderRadius: '8px', cursor: 'pointer',
        color, background: 'rgba(20,40,70,.8)', border: `1px solid ${border}`,
        fontSize: '15px', fontWeight: '700', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
      });
      return b;
    };
    const okBtn = mkBtn(t('saveImport'), '#ffd86b', 'rgba(255,216,107,.8)');
    const cancelBtn = mkBtn(t('close'), '#bcd7ee', 'rgba(150,180,210,.5)');
    btns.append(okBtn, cancelBtn);
    card.append(title, ta, err, btns);
    ov.append(card);
    document.body.appendChild(ov);
    this._saveImportEl = ov;
    this._saveImportHandler = (e) => {
      // 阻止冒泡：MenuScene create 全局 keydown-ENTER/SPACE 会 startGame，导入输入时不能误触发
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    };
    ta.addEventListener('keydown', this._saveImportHandler);
    const cleanup = () => {
      if (this._saveImportEl) { this._saveImportEl.remove(); this._saveImportEl = null; }
      if (this._saveImportHandler) { ta.removeEventListener('keydown', this._saveImportHandler); this._saveImportHandler = null; }
    };
    okBtn.addEventListener('click', () => {
      const text = ta.value;
      if (!text || !text.trim()) { err.textContent = t('saveImportFail'); return; }
      const res = importSave(text); // 同步；失败不破坏当前档（内部备份/回滚）
      if (res.ok) {
        cleanup();
        this.flashToast(t('saveImportOk'));
        this.refreshNicknameRow();
        if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
      } else {
        err.textContent = t('saveImportFail');
        ta.style.borderColor = '#ff7a7a';
      }
    });
    cancelBtn.addEventListener('click', () => { err.textContent = ''; cleanup(); });
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) cleanup(); });
    setTimeout(() => { try { ta.focus(); } catch (e) { /* ignore */ } }, 30);
  }

  /** 关闭导入 DOM 浮层（closeSettings/语言切换等兜底清理） */
  _closeSaveImportOverlay() {
    if (this._saveImportEl) {
      if (this._saveImportHandler) this._saveImportHandler = null;
      this._saveImportEl.remove();
      this._saveImportEl = null;
    }
  }

  /** C8 重置进度：强确认弹窗（desc 提示不可撤销 + 建议先导出；确认钮延时 2s 防误触） */
  _onResetProgress() {
    audio.sfx('ui');
    if (this._resetConfirmOv) return; // 防重复叠层
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(302);
    this._resetConfirmOv = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.68).setOrigin(0).setInteractive();
    const panel = this.add.rectangle(cx, cy, 470, 262, 0x0a1a2e, 0.98)
      .setStrokeStyle(2, THEME.titleColor, 0.9);
    const title = this.add.text(cx, cy - 98, t('resetConfirmTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '26px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 8, true, true);
    const desc = this.add.text(cx, cy - 44, t('resetConfirmDesc'), {
      fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textPrimary, align: 'center', wordWrap: { width: 410 },
    }).setOrigin(0.5);
    const tip = this.add.text(cx, cy - 4, t('resetExportTip'), {
      fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textSecondary, align: 'center',
    }).setOrigin(0.5);
    const exportTipBtn = new NeonButton(this, cx - 105, cy + 40, t('saveExport'), {
      w: 190, h: 36, fontSize: 13, glow: true, onDown: () => {
        const dl = downloadSaveFile();
        this.flashToast(dl.ok ? t('saveExportOk') : t('saveImportFail'));
      },
    });
    const doResetBtn = new NeonButton(this, cx + 105, cy + 40, '', {
      w: 190, h: 36, fontSize: 13, stroke: 0x883322, onDown: () => this._doResetProgress(),
    });
    const cancelBtn = new NeonButton(this, cx, cy + 92, t('close'), {
      w: 150, h: 36, fontSize: 14, onDown: () => this._closeResetConfirm(),
    });
    ov.add([dim, panel, title, desc, tip, exportTipBtn.container, doResetBtn.container, cancelBtn.container]);
    dim.on('pointerdown', () => this._closeResetConfirm());
    // 延时 2s 防误触：倒计时；结束后才可确认
    doResetBtn.setEnabled(false);
    let left = 2;
    const tick = () => {
      doResetBtn.setLabel(left > 0 ? `${t('resetConfirm')} (${left})` : t('resetConfirm'));
      if (left <= 0) { doResetBtn.setEnabled(true); return; }
      left -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }

  /** C8 关闭重置确认弹窗 */
  _closeResetConfirm() {
    if (this._resetConfirmOv) { this._resetConfirmOv.destroy(); this._resetConfirmOv = null; }
  }

  /** C8 执行重置：SaveTransfer.resetProgress()（保留设置，进度/收藏回默认）；成功后刷新菜单文案 */
  _doResetProgress() {
    const res = resetProgress();
    if (!res.ok) { this.flashToast(t('saveImportFail')); this._closeResetConfirm(); return; }
    this._closeResetConfirm();
    this._closeSaveImportOverlay();
    this.closeSettings();
    if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
    this.flashToast(t('resetDone'));
  }

  // ---- OPT-16 C9 主菜单轮换战术提示：顶部一条 tips 文本，点击「下一条」轮换（纯展示零业务）----

  /** C9 渲染一条战术提示：按 tutorialDone 分流 novice/advanced 池（只读不写档，C9.1/C9.2）；
   *  相邻不重复（C9.3）；空池 / 词条缺失 → 静默隐藏不报错（C9.5）。 */
  _renderTip() {
    if (!this.tipText) return;
    const s = SaveManager.load();
    const poolKey = s.tutorialDone ? 'advanced' : 'novice';
    const pool = (TIPS[poolKey] || []);
    if (!pool.length) { this.tipText.setVisible(false); return; } // C9.5 空池静默
    let idx = (this._tipIdx == null) ? Math.floor(Math.random() * pool.length) : this._tipIdx;
    const key = pool[idx];
    // 相邻不重复：随机撞到上一条则顺移 1（单元素池无法避免重复，可接受）
    if (key === this._lastTipKey && pool.length > 1) idx = (idx + 1) % pool.length;
    this._tipIdx = idx;
    this._lastTipKey = pool[idx];
    const txt = t(pool[idx]);
    if (!txt || txt === pool[idx]) { this.tipText.setVisible(false); return; } // C9.5 词条缺失静默隐藏
    this.tipText.setText(txt).setVisible(true);
  }

  /** C9 点击「下一条」：按当前 tutorialDone 对应池顺序取下一条并重渲染 */
  _nextTip() {
    const s = SaveManager.load();
    const pool = TIPS[s.tutorialDone ? 'advanced' : 'novice'] || [];
    if (!pool.length) { if (this.tipText) this.tipText.setVisible(false); return; }
    this._tipIdx = (this._tipIdx == null ? -1 : this._tipIdx) + 1;
    if (this._tipIdx >= pool.length) this._tipIdx = 0;
    this._renderTip();
  }

  /** 刷新四档难度按钮选中态（当前档高亮） */
  refreshDifficultySelect() {
    const cur = SaveManager.load().selectedDifficulty || 'standard';
    (this._difficultyBtns || []).forEach(({ btn, id }) => btn.setSelected(id === cur));
  }

  // ---- OPT-16 C1 难度门禁：勋章阈值解锁困难/地狱（只拦设置面板手动新点击）----
  /** C1 难度选择入口：casual/standard 永不拦截；hard/hell 勋章不足时弹锁定提示（不改 selectedDifficulty） */
  _trySelectDifficulty(id) {
    audio.sfx('ui');
    // C1.4：休闲/标准任意勋章可点；勋章口径与关卡面板提示同源 countMedals()（只读派生）
    if (id === 'hard' || id === 'hell') {
      const total = SaveManager.countMedals();
      if (total < MEDALS.THRESHOLD) { this._showDiffLocked(MEDALS.THRESHOLD - total); return; }
    }
    SaveManager.set('selectedDifficulty', id); // 正常持久化（与现状一致）
    this.refreshDifficultySelect();
  }

  /** C1 高难锁定提示：标题 + 还差 n 枚 + 主按钮跳关卡面板看勋章目标；不改当前选中档高亮 */
  _showDiffLocked(need) {
    if (this._diffLockedOv) return; // 已打开防重复叠层
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(302); // 高于设置面板(300)的内嵌子层
    this._diffLockedOv = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55).setOrigin(0).setInteractive();
    const panel = this.add.rectangle(cx, cy, 440, 218, 0x0a1a2e, 0.98)
      .setStrokeStyle(2, THEME.titleColor, 0.9);
    const title = this.add.text(cx, cy - 58, t('diffLockedTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '26px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 8, true, true);
    const desc = this.add.text(cx, cy - 6, t('diffLockedNeed', { n: need }), {
      fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textPrimary, align: 'center', wordWrap: { width: 380 },
    }).setOrigin(0.5);
    // 主按钮「前往关卡面板查看勋章目标」：关设置 → 开关卡面板；次按钮关闭（点遮罩 = 关闭）
    const goBtn = new NeonButton(this, cx - 112, cy + 58, t('diffLockedHint'), {
      w: 216, h: 46, fontSize: 13, glow: true, onDown: () => {
        this._closeDiffLocked();
        this.closeSettings();
        this.openLevelSelect();
      },
    });
    const closeBtn = new NeonButton(this, cx + 112, cy + 58, t('close'), {
      w: 128, h: 46, fontSize: 14, onDown: () => this._closeDiffLocked(),
    });
    ov.add([dim, panel, title, desc, goBtn.container, closeBtn.container]);
    dim.on('pointerdown', () => this._closeDiffLocked());
    this.fadeInPanel(ov);
  }

  /** C1 关闭高难锁定提示 */
  _closeDiffLocked() {
    if (this._diffLockedOv) { this._diffLockedOv.destroy(); this._diffLockedOv = null; }
  }

  /** 刷新三档画质按钮选中态（当前档高亮） */
  refreshQualitySelect() {
    const cur = SaveManager.load().quality || PERFORMANCE.defaultTier;
    (this._qualityBtns || []).forEach(({ btn, id }) => btn.setSelected(id === cur));
  }

  closeSettings() {
    if (this.settingsOverlay) { this.settingsOverlay.destroy(); this.settingsOverlay = null; }
    this.settingsOpen = false;
    this._closeNicknameEditor(); // OPT-16 C2：兜底清理 DOM 输入浮层（语言切换等路径）
    this._closeDiffLocked(); // OPT-16 C1：兜底清理高难锁定提示（语言切换等路径）
    this._closeSaveImportOverlay(); // OPT-16 C4：兜底清理导入 DOM 浮层
    this._closeResetConfirm(); // OPT-16 C8：兜底清理重置确认弹窗
    this._noAdsBtn = null;
    this._hapticsBtn = null; // OPT-16 C7
    this._touchOffsetBtn = null;
    this._langBtn = null;
    this._nicknameBtn = null;
    this._sensSlider = null;
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
    this.addGlowTitle(ov, cx, 110, t('levelSelectTitle'), THEME.titleColor);

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
      c.add(this.add.text(-cardW / 2 + 18, -cardH / 2 + 18, t(`levelName_${lvl.id}`), {
        fontFamily: THEME.fontFamily, fontSize: '24px', fontStyle: '700',
        color: unlocked ? THEME.white : THEME.textDisabled,
      }).setOrigin(0, 0));
      const accentHex = '#' + lvl.theme.accent.toString(16).padStart(6, '0');
      c.add(this.add.text(-cardW / 2 + 18, -cardH / 2 + 52, t('bossLine', { name: t(`bossName_${lvl.id}`) }), {
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
          transition.goto(this, SCENES.GAME, { levelId: lvl.id });
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
      const label = t('medalThresholdLabel');
      const extra = hit
        ? t('medalHit', { threshold: MEDALS.THRESHOLD, label })
        : t('medalNeed', { need: MEDALS.THRESHOLD - totalMedals, label });
      ov.add(this.add.text(cx, startY + LEVELS.length * (cardH + gap) - 16,
        t('medalSummary', { got: totalMedals, total: totalPossible }) + extra, {
        fontFamily: THEME.fontFamily, fontSize: '16px',
        color: hit ? THEME.textGoldLight : THEME.textSecondary,
      }).setOrigin(0.5));
    }

    ov.add(this.makeMenuBtn(cx, startY + LEVELS.length * (cardH + gap) + 30, t('close'), () => this.closeLevelSelect()));
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
    this.addGlowTitle(ov, cx, 70, t('achTitle'), THEME.textGoldLight);

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
      c.add(this.add.text(-cardW / 2 + 36, -cardH / 2 + 12, t(`ach_${a.id}`), {
        fontFamily: THEME.fontFamily, fontSize: '18px', fontStyle: '700',
        color: a.unlocked ? THEME.white : THEME.textDisabled,
      }).setOrigin(0, 0));
      c.add(this.add.text(-cardW / 2 + 14, -cardH / 2 + 42, t(`ach_${a.id}_desc`), {
        fontFamily: THEME.fontFamily, fontSize: '12px',
        color: a.unlocked ? THEME.textAchieve : THEME.textDisabledDim,
        wordWrap: { width: cardW - 28 },
      }).setOrigin(0, 0));
      ov.add(c);
    });

    const unlockedCount = list.filter((a) => a.unlocked).length;
    const rows = Math.ceil(list.length / cols);
    ov.add(this.add.text(cx, startY + rows * (cardH + gapY) - 6,
      t('achUnlocked', { n: unlockedCount, total: list.length }), {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textMuted,
    }).setOrigin(0.5));

    ov.add(this.makeMenuBtn(cx, GAME_HEIGHT - 70, t('close'), () => this.closeAchievements()));
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
    this.addGlowTitle(ov, cx, 230, t('checkinTitle'), THEME.textGoldLight);

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
      c.add(this.add.text(0, 12, isBig ? t('checkinGrand') : `+${REWARD_NAMES[i]}`, {
        fontFamily: THEME.fontFamily, fontSize: isBig ? '14px' : '13px', fontStyle: '800',
        color: isBig ? THEME.textGoldLight : THEME.textPrimary,
      }).setOrigin(0.5));
      if (isCur) c.add(this.add.text(0, boxH / 2 - 8, t('checkinToday'), {
        fontFamily: THEME.fontFamily, fontSize: '11px', color: COLORS.accent,
      }).setOrigin(0.5));
      ov.add(c);
    }
    ov.add(this.add.text(cx, cycY + boxH / 2 + 14, t('checkinDay7Info'), {
      fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textDim,
    }).setOrigin(0.5));

    const info = this.add.text(cx, 396, t('checkinStreak', {
      day: cyc.streak || 0,
      coins: (cyc.rewards[cyc.day - 1] != null) ? cyc.rewards[cyc.day - 1] : 50,
    }), {
      fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textPrimary, align: 'center',
      wordWrap: { width: 360 },
    }).setOrigin(0.5);
    ov.add(info);

    const claimBtn = this.makeMenuBtn(cx, 470, t('claimReward'), () => {
      const res = SaveManager.checkIn();
      if (res.claimed) {
        const extra = (res.day === 7 ? t('checkinDay7Bonus') : '') + (res.wingmanUpgraded ? t('checkinWingmanBonus') : '');
        info.setText(t('checkinClaimed', { coins: res.reward, day: res.streak, extra }));
        claimBtn.destroy();
        this._checkinClaimBtn = null;
        if (this.saveInfoText) {
          this.saveInfoText.setText(this._saveInfoLabel());
        }
        // P2 激励广告位预留：签到后提供「看广告双倍」按钮（Ads 成功后金币×2）
        if (Ads.hasAds()) {
          const dbl = new NeonButton(this, cx - 95, 470, t('watchAdDouble'), {
            w: 170, glow: true, onDown: () => {
              audio.sfx('ui');
              dbl.setAlpha(0.45).disableInteractive();
              info.setText(t('adPlaying'));
              Ads.showRewardAd((ok) => {
                if (ok) {
                  SaveManager.addCoins(res.reward);
                  info.setText(t('checkinDoubleResult', { coins: res.reward }));
                  if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
                  dbl.destroy();
                  this._checkinDoubleBtn = null;
                } else {
                  info.setText(t('checkinDoubleFail', { coins: res.reward }));
                  dbl.setAlpha(1).setInteractive();
                }
              });
            },
          }).container;
          ov.add(dbl);
          this._checkinDoubleBtn = dbl;
        }
        ov.add(new NeonButton(this, cx + 95, 470, t('ok'), { w: 170, glow: true, onDown: () => this.closeCheckIn() }).container);
      } else {
        info.setText(t('alreadyChecked'));
      }
    });
    ov.add(claimBtn);
    this._checkinClaimBtn = claimBtn;

    // P1 补签：断签可消耗金币补 1 天（保留连签进度）
    if (cyc.canMakeup && !cyc.checkedToday) {
      const mkBtn = this.makeMenuBtn(cx, 540, t('makeupBtn', { cost: cyc.makeupCost }), () => {
        const mk = SaveManager.makeupCheckIn();
        if (mk.claimed) {
          info.setText(t('makeupSuccess', { cost: mk.cost, day: mk.streak }));
          mkBtn.destroy();
          if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
        } else if (mk.reason === 'no-coins') {
          info.setText(t('makeupNoCoins', { cost: cyc.makeupCost }));
        } else {
          info.setText(t('makeupNoNeed'));
          mkBtn.destroy();
        }
      });
      ov.add(mkBtn);
      this._checkinMakeupBtn = mkBtn;
    }

    ov.add(this.makeMenuBtn(cx, 600, t('later'), () => this.closeCheckIn()));
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
    this.addGlowTitle(ov, cx, 250, t('dqTitle'), THEME.titleColor);

    const quests = SaveManager.getDailyQuests();
    const claimed = SaveManager.dailyQuestsClaimed();
    let cursor = 300;
    quests.forEach((q) => {
      const y = cursor; cursor += 84;
      const label = this.add.text(cx - 200, y, t(`dq_${q.metric}`, { n: q.target }), {
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

    const statusText = this.add.text(cx, cursor + 6, claimed ? t('dqClaimedStatus')
      : (SaveManager.dailyQuestsReady() ? t('dqReady') : t('dqNotReady')), {
      fontFamily: THEME.fontFamily, fontSize: '17px', color: claimed ? THEME.textSuccess : THEME.textPrimary,
      align: 'center', wordWrap: { width: 400 },
    }).setOrigin(0.5);
    ov.add(statusText);

    const claimBtn = this.makeMenuBtn(cx, cursor + 60, claimed ? t('claimed') : t('claimReward'), () => {
      const res = SaveManager.claimDailyQuests();
      if (res.claimed) {
        statusText.setText(t('dqClaimedToast', { coins: res.reward, count: res.count, bonus: res.bonus || 0 }));
        claimBtn.destroy();
        if (this.saveInfoText) {
          this.saveInfoText.setText(this._saveInfoLabel());
        }
        ov.add(this.makeMenuBtn(cx, cursor + 60, t('ok'), () => this.closeDailyQuest()));
      } else if (res.notReady) {
        statusText.setText(t('dqNotAllDone'));
      }
    });
    if (claimed || !SaveManager.dailyQuestsReady()) claimBtn.setAlpha(0.45);
    ov.add(claimBtn);

    // P1 留存·活跃宝箱：当日游玩 3/5 局各开 1 个宝箱（金币随机 + 随机机库模块，复用 module 系统）
    const acts = SaveManager.getDailyActs();
    const chestY = cursor + 118;
    ov.add(this.add.text(cx, chestY - 24, t('chestLabel', { count: acts.count }), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textGoldLight,
    }).setOrigin(0.5));
    const chest3 = new NeonButton(this, cx - 100, chestY, acts.chests[3] ? t('chestDone', { n: 3 }) : t('chestBtn', { n: 3 }), {
      w: 180, h: 48, fontSize: 16, glow: true,
      onDown: () => {
        const res = SaveManager.claimDailyChest(3);
        if (res.claimed) {
          chest3.setLabel(t('chestDone', { n: 3 }));
          if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
          this.flashToast(t('chestOpened', { coins: res.coins, module: res.module || '' }));
        } else if (res.reason === 'not-enough') {
          this.flashToast(t('chestNeed', { n: Math.max(0, 3 - acts.count), num: 3 }));
        }
      },
    });
    if (acts.chests[3] || acts.count < 3) chest3.container.setAlpha(0.55);
    const chest5 = new NeonButton(this, cx + 100, chestY, acts.chests[5] ? t('chestDone', { n: 5 }) : t('chestBtn', { n: 5 }), {
      w: 180, h: 48, fontSize: 16, glow: true,
      onDown: () => {
        const res = SaveManager.claimDailyChest(5);
        if (res.claimed) {
          chest5.setLabel(t('chestDone', { n: 5 }));
          if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
          this.flashToast(t('chestOpened', { coins: res.coins, module: res.module || '' }));
        } else if (res.reason === 'not-enough') {
          this.flashToast(t('chestNeed', { n: Math.max(0, 5 - acts.count), num: 5 }));
        }
      },
    });
    if (acts.chests[5] || acts.count < 5) chest5.container.setAlpha(0.55);
    ov.add([chest3.container, chest5.container]);

    // ── OPT-16 C5 每日种子挑战：合并进「每日任务」面板（PM：避免主菜单裸按钮）。
    //    独立结算域（不进榜/不进每日任务/不领活跃宝箱）；同一天同图同 seed。
    const dcInfo = SaveManager.getDailyChallenge(); // 跨天自动重置；{date,bestScore,cleared,claimed,seed,targetScore,rewardCoins}
    const dSeedShort = String(dcInfo.seed == null ? '' : dcInfo.seed).slice(0, 6);
    const dcY = chestY + 48;
    const dcStatus = dcInfo.cleared
      ? (dcInfo.claimed ? t('dailyChallengeDone') : t('dailyChallengeUnclaimed'))
      : `${t('dailyChallengeGoal', { score: dcInfo.targetScore })} · ${t('dailyChallengeReward', { coins: dcInfo.rewardCoins })}`;
    ov.add(this.add.text(cx - 188, dcY - 15, `${t('dailyChallenge')} · ${t('dailySeedLabel', { seed: dSeedShort })}`, {
      fontFamily: THEME.fontFamily, fontSize: '17px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0, 0.5));
    ov.add(this.add.text(cx - 188, dcY + 13, dcStatus, {
      fontFamily: THEME.fontFamily, fontSize: '14px',
      color: dcInfo.cleared ? THEME.textSuccess : THEME.textSecondary,
    }).setOrigin(0, 0.5));
    ov.add(new NeonButton(this, cx + 128, dcY, t('dailyChallengeEnter'), {
      w: 118, h: 42, fontSize: 16, glow: true,
      onDown: () => {
        audio.sfx('ui');
        transition.goto(this, SCENES.GAME, {
          mode: 'daily',
          levelId: (DAILY_CHALLENGE && DAILY_CHALLENGE.levelId) || 1,
          dailySeed: SaveManager.dailySeedStr(),
        });
      },
    }).container);

    ov.add(this.makeMenuBtn(cx, chestY + 118, t('later'), () => this.closeDailyQuest()));
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
    this.addGlowTitle(ov, cx, 340, t('rgTitle'), THEME.textGoldLight);

    const info = this.add.text(cx, 430, t('rgInfo', { days: (st && st.missDays) || 0 }), {
      fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textPrimary, align: 'center',
      wordWrap: { width: 380 },
    }).setOrigin(0.5);
    ov.add(info);

    const claimBtn = this.makeMenuBtn(cx - 95, 520, t('rgClaim'), () => {
      const res = SaveManager.claimReturnGift();
      if (res.claimed) {
        info.setText(t('rgClaimed', { coins: res.coins, module: res.module || '' }));
        claimBtn.destroy();
        if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
        ov.add(this.makeMenuBtn(cx + 95, 520, t('ok'), () => this.closeReturnGift()));
      } else {
        info.setText(t('rgNotReady'));
      }
    });
    ov.add(claimBtn);
    ov.add(this.makeMenuBtn(cx, 590, t('later'), () => this.closeReturnGift()));
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
    this.addGlowTitle(ov, cx, 150, t('lbTitle'), THEME.textGoldLight);

    const top = SaveManager.getTopScores();
    const rowH = 54, startY = 210;
    if (!top.length) {
      ov.add(this.add.text(cx, 360, t('lbEmpty'), {
        fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textSecondary,
      }).setOrigin(0.5));
    } else {
      const MODE_LABEL = {
        normal: t('mode_normal'), endless: t('mode_endless'), bossrush: t('mode_bossrush'),
        coin_rush: t('mode_coin_rush'), survival: t('mode_survival'),
      };
      top.slice(0, 10).forEach((s, i) => {
        const y = startY + i * rowH;
        const rankColor = i === 0 ? THEME.textGoldLight : (i === 1 ? '#cfe8ff' : (i === 2 ? '#ffb070' : THEME.textSecondary));
        ov.add(this.add.text(cx - 210, y, `${i + 1}`, {
          fontFamily: THEME.fontFamily, fontSize: '24px', fontStyle: '800', color: rankColor,
        }).setOrigin(0.5));
        ov.add(this.add.text(cx - 160, y, `${s.score || 0}`, {
          fontFamily: THEME.scoreFont, fontSize: '24px', fontStyle: '700', color: THEME.white,
        }).setOrigin(0, 0.5));
        const modeName = s.mode === 'endless'
          ? t('modeEndlessFloor', { floor: s.levelId || 1 })
          : (MODE_LABEL[s.mode] || t('mode_normal'));
        ov.add(this.add.text(cx + 40, y, modeName, {
          fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textSecondary,
        }).setOrigin(0, 0.5));
        ov.add(this.add.text(cx + 180, y, s.date || '', {
          fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textDim,
        }).setOrigin(0, 0.5));
      });
    }
    ov.add(this.makeMenuBtn(cx, GAME_HEIGHT - 70, t('close'), () => this.closeLeaderboard()));
    this.fadeInPanel(ov);
  }

  closeLeaderboard() {
    if (this.leaderboardOverlay) { this.leaderboardOverlay.destroy(); this.leaderboardOverlay = null; }
    this.leaderboardOpen = false;
  }

  // ---- OPT-13 批B B13 图鉴收藏面板（纯展示 + 金币装饰出口）----
  openCodex() {
    if (this.codexOpen) return;
    this.codexOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.codexOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    this.addPanel(ov, cx, 56, GAME_HEIGHT - 40, 486);
    this.addGlowTitle(ov, cx, 110, t('codexTitle'), THEME.textGoldLight);

    // 总进度计数（已解锁 X/18）
    const total = Codex.getTotalProgress();
    const progressText = this.add.text(cx, 156, t('codexProgress', { n: total.unlocked, total: total.total }), {
      fontFamily: THEME.fontFamily, fontSize: '17px', color: THEME.textPrimary,
    }).setOrigin(0.5);
    ov.add(progressText);

    // 四分类 tab 按钮 + 当前分类容器
    const tabDefs = [
      { type: 'enemies', label: t('codexEnemies') },
      { type: 'bosses', label: t('codexBosses') },
      { type: 'weapons', label: t('codexWeapons') },
      { type: 'elements', label: t('codexElements') },
    ];
    const tabBtns = [];
    let activeTab = 'enemies';
    let gridContainer = null;
    const gridTop = 208;

    const renderGrid = () => {
      if (gridContainer) gridContainer.destroy();
      gridContainer = this.add.container(0, 0);
      ov.add(gridContainer);
      const entries = CODEX_ENTRIES[activeTab] || [];
      // 条目 i18n key 前缀：codex_enemy_*/codex_boss_*/codex_weapon_*/codex_element_*
      // （boss key 已自带 boss_ 前缀，故 codex_ + key 即正确；其余需补分类前缀）
      const i18nPrefix = { enemies: 'codex_enemy_', bosses: 'codex_', weapons: 'codex_weapon_', elements: 'codex_element_' }[activeTab] || 'codex_';
      const colX = [cx - 100, cx + 100];
      const rowH = 62;
      entries.forEach((e, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = colX[col];
        const y = gridTop + row * rowH;
        const unlocked = Codex.isUnlocked(activeTab, e.key);
        // 图标（复用现有纹理；未解锁显示剪影 + ???
        const icon = this.add.image(x - 78, y, unlocked ? e.tex : 'enemy_small')
          .setScale(unlocked ? 1 : 0.9)
          .setAlpha(unlocked ? 1 : 0.35);
        if (unlocked && e.tint != null) icon.setTint(e.tint);
        gridContainer.add(icon);
        if (unlocked) {
          gridContainer.add(this.add.text(x + 4, y - 10, t(`${i18nPrefix}${e.key}`), {
            fontFamily: THEME.fontFamily, fontSize: '17px', fontStyle: '700', color: THEME.textPrimary,
          }).setOrigin(0, 0.5));
          gridContainer.add(this.add.text(x + 4, y + 13, t(`${i18nPrefix}${e.key}_desc`), {
            fontFamily: THEME.fontFamily, fontSize: '12px', color: THEME.textDim,
          }).setOrigin(0, 0.5));
        } else {
          gridContainer.add(this.add.text(x + 4, y, t('codexLocked'), {
            fontFamily: THEME.fontFamily, fontSize: '18px', fontStyle: '700', color: THEME.textDim,
          }).setOrigin(0, 0.5));
        }
        // 点亮动画：解锁条目一次性轻微缩放（reduced-motion 下静态，零粒子）
        if (unlocked && !this.reduceMotion) {
          icon.setScale(unlocked ? 1 : 0.9);
          this.tweens.add({ targets: icon, scale: { from: unlocked ? 1 : 0.9, to: 1.15, yoyo: true, duration: 260 }, ease: EASE.feedback });
        }
      });
    };
    renderGrid();

    // tab 按钮（切换重渲染网格；makeMenuBtn 返回 container，直接 setAlpha）
    tabDefs.forEach((td, i) => {
      const tx = cx - 160 + i * 106;
      const btn = this.makeMenuBtn(tx, 184, td.label, () => {
        if (activeTab === td.type) return;
        activeTab = td.type;
        tabBtns.forEach((b, bi) => b.setAlpha(bi === tabDefs.findIndex((x) => x.type === activeTab) ? 1 : 0.6));
        renderGrid();
      });
      btn.setAlpha(i === 0 ? 1 : 0.6);
      tabBtns.push(btn);
      ov.add(btn);
    });

    // 金币出口：2 款图鉴装饰（纯展示）
    const decorY = 616;
    ov.add(this.add.text(cx, decorY - 30, t('codexDecorLabel'), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textGoldLight,
    }).setOrigin(0.5));
    const coinsText = this.add.text(cx, decorY - 4, `${SaveManager.load().coins}`, {
      fontFamily: THEME.fontFamily, fontSize: '14px', color: COLORS.coin,
    }).setOrigin(0.5);
    ov.add(coinsText);
    const decors = Object.keys(CODEX_DECOR || {});
    decors.forEach((id, i) => {
      const def = CODEX_DECOR[id];
      const x = cx + (i === 0 ? -118 : 118);
      ov.add(this.add.text(x, decorY + 26, t(`codexDecor_${id}`), {
        fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textPrimary,
      }).setOrigin(0.5));
      const btn = this.makeMenuBtn(x, decorY + 62, Codex.ownsDecor(id) ? t('codexOwned') : `${t('codexBuy')} ${def.price}`, () => {
        if (Codex.ownsDecor(id)) return;
        if (Codex.buyDecor(id)) {
          btn.container.destroy();
          ov.add(this.makeMenuBtn(x, decorY + 62, t('codexOwned'), () => {}));
          coinsText.setText(`${SaveManager.load().coins}`);
          if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
          this.flashToast(t('codexBought', { name: t(`codexDecor_${id}`) }));
        } else {
          this.flashToast(t('codexNotEnough'));
        }
      });
      if (Codex.ownsDecor(id)) btn.container.setAlpha(0.5);
      ov.add(btn);
    });

    ov.add(this.makeMenuBtn(cx, GAME_HEIGHT - 74, t('close'), () => this.closeCodex()));
    this.fadeInPanel(ov);
  }

  closeCodex() {
    if (this.codexOverlay) { this.codexOverlay.destroy(); this.codexOverlay = null; }
    this.codexOpen = false;
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
    this.addGlowTitle(ov, cx, 92, t('npTitle'), THEME.titleColor);

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
      c.add(this.add.text(-208, -20, `D${d.day} ${t(`np_d${d.day}`)}`, {
        fontFamily: THEME.fontFamily, fontSize: '18px', fontStyle: '700', color: titleColor,
      }).setOrigin(0, 0.5));
      const rewardTxt = d.day === 7 ? t('npRewardDay7', { coins: d.reward }) : t('npReward', { coins: d.reward });
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
      const status = d.claimed ? t('npStatusClaimed') : (d.done ? t('npStatusReady') : `${d.progress}/${d.target}`);
      const statusColor = d.claimed ? THEME.textSuccess : (d.done ? THEME.textGold : THEME.textSecondary);
      c.add(this.add.text(208, barY, status, {
        fontFamily: THEME.fontFamily, fontSize: '14px', fontStyle: '700', color: statusColor,
      }).setOrigin(1, 0.5));
      c.add([track, fill]);
      ov.add(c);
    });

    const claimable = list.some((d) => d.isCurrent && d.done);
    const claimBtn = this.makeMenuBtn(cx, startY + list.length * rowH + 16, t('npClaimDaily'), () => {
      const res = SaveManager.claimNewbieDay();
      if (res.claimed) {
        this.closeNewbiePlan();
        this.openNewbiePlan();
        if (this.saveInfoText) this.saveInfoText.setText(this._saveInfoLabel());
        this.flashToast(res.day === 7
          ? t('npDay7Toast', { coins: res.reward, extra: res.wingmanUpgraded ? t('npWingmanUp') : t('npWingmanMax') })
          : t('npDayToast', { day: res.day, coins: res.reward }));
      } else {
        this.flashToast(t('npNotDone'));
      }
    });
    if (!claimable) claimBtn.setAlpha(0.45);
    ov.add(claimBtn);
    ov.add(this.makeMenuBtn(cx, startY + list.length * rowH + 78, t('close'), () => this.closeNewbiePlan()));
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
    this.addGlowTitle(ov, cx, 240, t('eventTitle'), THEME.titleColor);

    const ev = getCurrentEvent();
    ov.add(this.add.text(cx, 356, t(`eventName_${ev.id || 'coin_rush'}`), {
      fontFamily: THEME.fontFamily, fontSize: '40px', fontStyle: '800',
      color: ev.double ? THEME.textGoldLight : THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 16, true, true));
    ov.add(this.add.text(cx, 420, t(`eventDesc_${ev.id || 'coin_rush'}`), {
      fontFamily: THEME.fontFamily, fontSize: '18px', color: THEME.textPrimary, align: 'center',
      wordWrap: { width: 400 },
    }).setOrigin(0.5));
    ov.add(this.add.text(cx, 500, t('eventLeft', { days: ev.daysLeft, double: t(ev.double ? 'eventDoubleToday' : 'eventDoubleWeekend') }), {
      fontFamily: THEME.fontFamily, fontSize: '18px',
      color: ev.double ? THEME.textGold : THEME.textSecondary,
    }).setOrigin(0.5));

    ov.add(this.makeMenuBtn(cx, 590, t('eventEnter', { short: t(`eventName_${ev.id || 'coin_rush'}`) }), () => {
      audio.sfx('ui');
      transition.goto(this, SCENES.GAME, { mode: ev.id });
    }));
    ov.add(this.makeMenuBtn(cx, 670, t('close'), () => this.closeEvent()));
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

  /**
   * 拖动滑杆（音量 0~1 / 灵敏度 0.5~1.5 通用）。
   * opts：{ min, max, getValue, display(v)->str, onChange(v) }。
   * 未传 onChange 时默认 audio.setVolume(type, v, true)（音量类）。
   */
  makeSlider(ov, cx, y, label, type, opts = {}) {
    const min = opts.min != null ? opts.min : 0;
    const max = opts.max != null ? opts.max : 1;
    const val = opts.getValue ? opts.getValue() : audio.getVolume(type);
    const ratio = Phaser.Math.Clamp((val - min) / Math.max(0.0001, max - min), 0, 1);
    const lab = this.add.text(cx - 150, y, label, {
      fontFamily: THEME.fontFamily, fontSize: '20px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    const trackW = 220, trackH = 8, tx = cx - 10;
    const track = this.add.rectangle(tx, y, trackW, trackH, THEME.trackBg)
      .setStrokeStyle(1, THEME.trackStroke).setInteractive();
    const fill = this.add.rectangle(tx - trackW / 2, y, trackW * ratio, trackH, THEME.trackFill)
      .setOrigin(0, 0.5);
    const knob = this.add.circle(tx - trackW / 2 + trackW * ratio, y, 12, THEME.titleColor)
      .setStrokeStyle(2, THEME.whiteHex).setInteractive({ useHandCursor: true });
    const valTxt = this.add.text(tx + trackW / 2 + 16, y, opts.display ? opts.display(val) : `${Math.round(val * 100)}%`, {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textMuted,
    }).setOrigin(0, 0.5);
    ov.add([lab, track, fill, knob, valTxt]);
    const apply = (r) => {
      r = Phaser.Math.Clamp(r, 0, 1);
      const v = min + (max - min) * r;
      knob.x = tx - trackW / 2 + trackW * r;
      fill.width = trackW * r;
      valTxt.setText(opts.display ? opts.display(v) : `${Math.round(v * 100)}%`);
      if (opts.onChange) opts.onChange(v);
      else audio.setVolume(type, v, true);
    };
    track.on('pointerdown', (p) => apply((p.x - (tx - trackW / 2)) / trackW));
    knob.on('pointerdown', (p) => apply((p.x - (tx - trackW / 2)) / trackW));
    return { lab, track, fill, knob, valTxt, apply, getRatio: () => ratio };
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
      this.tweens.add({ targets: glow, alpha: { from: 0.22, to: 0.46 }, duration: 1700, yoyo: true, repeat: -1, ease: EASE.breathe });
    }
    return { glow, title };
  }

  /** 面板入场：淡入 + 轻微上滑（reduced-motion 下静态直接显示） */
  fadeInPanel(ov) {
    if (this.reduceMotion) { ov.setAlpha(1); return; }
    ov.setAlpha(0);
    ov.y = 18;
    this.tweens.add({ targets: ov, alpha: 1, y: 0, duration: 260, ease: EASE.enter });
  }

  /** 统一的内嵌霓虹面板背景：玻璃拟态卡片（半透 + 内发光 + 顶部高光），套在 dim 之上、内容之下 */
  addPanel(ov, cx, top = 70, bottom = GAME_HEIGHT - 50, w = 460) {
    const g = this.add.graphics();
    drawGlassPanel(g, cx, top, bottom, w, THEME.panelRadius);
    ov.add(g);
  }
}
