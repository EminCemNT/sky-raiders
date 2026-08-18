import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVELS } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';
import { AchievementManager } from '../systems/AchievementManager.js';
import { createStarfield } from '../systems/Starfield.js';
import { audio } from '../systems/AudioSystem.js';
import { NeonButton, THEME } from '../utils/UIWidgets.js';
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

    // 背景滚动星空
    this.starfield = createStarfield(this);

    // 动态注册机库场景（GameConfig 只读，未登记 HANGAR，故运行时注册一次）
    if (!this.scene.get('HangarScene')) {
      this.scene.add('HangarScene', HangarScene, false);
    }

    // 标题（霓虹辉光层 + 本体 + 呼吸脉动）
    this.titleGlow = this.add.text(cx, 218, '苍穹战机', {
      fontFamily: 'sans-serif', fontSize: '62px', fontStyle: '800', color: '#7cf3ff',
    }).setOrigin(0.5).setShadow(0, 0, '#7cf3ff', 38, true, true).setAlpha(0.32).setDepth(1);
    this.title = this.add.text(cx, 218, '苍穹战机', {
      fontFamily: 'sans-serif', fontSize: '58px', fontStyle: '800', color: '#aef6ff',
    }).setOrigin(0.5).setShadow(0, 0, '#2a86c0', 24, true, true).setDepth(2);
    this.tweens.add({ targets: [this.title, this.titleGlow], scale: { from: 1, to: 1.035 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.titleGlow, alpha: { from: 0.26, to: 0.5 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // 英文名（宽字距 + 副色呼吸）
    this.subTitle = this.add.text(cx, 284, 'S K Y   R A I D E R S', {
      fontFamily: 'sans-serif', fontSize: '17px', color: '#6fb6e6', fontStyle: '700',
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
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
        audio.resume(); audio.startBgm(); audio.sfx('ui');
        this.scene.start(SCENES.GAME, { levelId: 1, mode: 'normal', forceTutorial: true });
      },
    });

    // 开始按钮
    new NeonButton(this, cx, 480, '开始游戏', {
      fontSize: 26, glow: true,
      onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
        audio.resume(); audio.startBgm(); audio.sfx('ui'); this.startGame();
      },
    });

    // 机库按钮
    new NeonButton(this, cx, 548, '机  库', {
      glow: true,
      onDown: () => {
        if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
        this.scene.start('HangarScene');
      },
    });

    // 成就按钮
    new NeonButton(this, cx, 616, '成  就', { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
      audio.sfx('ui'); this.openAchievements();
    } });

    // 设置按钮
    new NeonButton(this, cx, 680, '设  置', { glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
      this.openSettings();
    } });

    // Boss Rush 按钮
    new NeonButton(this, cx, 740, 'BOSS RUSH', { stroke: 0xff5566, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
      audio.sfx('ui'); this.scene.start(SCENES.GAME, { mode: 'bossrush' });
    } });

    // 选择关卡按钮
    new NeonButton(this, cx, 800, '选择关卡', { glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
      audio.sfx('ui'); this.openLevelSelect();
    } });

    // 每日签到按钮（主动点击才弹，避免自动弹窗挡住"开始游戏"）
    new NeonButton(this, cx, 864, '每日签到', { stroke: COLORS.coin, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen) return;
      audio.sfx('ui'); this.openCheckIn();
    } });

    // 每日任务按钮（留存系统：击杀/金币/炸弹等每日目标，完成领金币）
    new NeonButton(this, cx, 928, '每日任务', { stroke: COLORS.accent, glow: true, onDown: () => {
      if (this.settingsOpen || this.levelSelectOpen || this.achievementsOpen || this.checkinOpen || this.dailyQuestOpen) return;
      audio.sfx('ui'); this.openDailyQuest();
    } });

    // 存档信息
    const save = SaveManager.load();
    this.saveInfoText = this.add.text(cx, GAME_HEIGHT - 44,
      `金币 ${save.coins}   ·   已解锁第 ${save.unlockedLevel} 关`, {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#88bbdd',
    }).setOrigin(0.5).setAlpha(0.8);

    this.add.text(cx, GAME_HEIGHT - 20,
      '移动：拖动 / 方向键     开火：自动     炸弹：空格 / 屏幕按钮', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#5a7a99',
    }).setOrigin(0.5);

    // 版本号（右上角装饰）
    this.add.text(GAME_WIDTH - 14, 14, 'v1.4.0', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#4a90c0',
    }).setOrigin(1, 0).setAlpha(0.6).setDepth(50);

    // 键盘也能开始
    this.input.keyboard.once('keydown-ENTER', () => this.startGame());
    this.input.keyboard.once('keydown-SPACE', () => this.startGame());
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

  // ---- 设置面板（P0 音量设置）----
  openSettings() {
    this.settingsOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.settingsOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7)
      .setOrigin(0).setInteractive();
    const title = this.add.text(cx, 250, '设置 · 音量', {
      fontFamily: 'sans-serif', fontSize: '34px', fontStyle: '800', color: '#7cf3ff',
    }).setOrigin(0.5);
    ov.add(dim);
    this.addPanel(ov, cx);
    ov.add(title);
    this.makeSlider(ov, cx, 360, '主音量', 'master');
    this.makeSlider(ov, cx, 450, '音效', 'sfx');
    this.makeSlider(ov, cx, 540, '音乐', 'bgm');
    ov.add(this.makeMenuBtn(cx, 660, '关闭', () => this.closeSettings()));
  }

  closeSettings() {
    if (this.settingsOverlay) { this.settingsOverlay.destroy(); this.settingsOverlay = null; }
    this.settingsOpen = false;
  }

  // ---- 关卡选择面板 ----
  openLevelSelect() {
    this.levelSelectOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.levelSelectOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    const title = this.add.text(cx, 110, '选择关卡', {
      fontFamily: 'sans-serif', fontSize: '34px', fontStyle: '800', color: '#7cf3ff',
    }).setOrigin(0.5);
    ov.add(dim);
    this.addPanel(ov, cx);
    ov.add(title);

    const save = SaveManager.load();
    const cardW = 380, cardH = 132, gap = 16;
    const startY = 200;
    LEVELS.forEach((lvl, i) => {
      const y = startY + i * (cardH + gap);
      const unlocked = lvl.id <= (save.unlockedLevel || 1);
      const stars = save.levelStars[lvl.id] || 0;
      const c = this.add.container(cx, y);
      const bgColor = unlocked ? 0x123a5a : 0x16161e;
      const bg = this.add.rectangle(0, 0, cardW, cardH, bgColor, 0.95)
        .setStrokeStyle(2, unlocked ? lvl.theme.accent : 0x445566);
      c.add(bg);
      c.add(this.add.text(-cardW / 2 + 18, -cardH / 2 + 18, lvl.name, {
        fontFamily: 'sans-serif', fontSize: '24px', fontStyle: '700',
        color: unlocked ? '#ffffff' : '#8899aa',
      }).setOrigin(0, 0));
      const accentHex = '#' + lvl.theme.accent.toString(16).padStart(6, '0');
      c.add(this.add.text(-cardW / 2 + 18, -cardH / 2 + 52, `Boss · ${lvl.boss.name}`, {
        fontFamily: 'sans-serif', fontSize: '15px',
        color: unlocked ? accentHex : '#667788',
      }).setOrigin(0, 0));
      for (let s = 0; s < 3; s++) {
        const st = this.add.star(-cardW / 2 + 26 + s * 34, cardH / 2 - 26, 5, 7, 15,
          s < stars ? COLORS.coin : 0x334455);
        st.setStrokeStyle(2, s < stars ? 0xfff3b0 : 0x556677);
        c.add(st);
      }
      if (unlocked) {
        c.setSize(cardW, cardH).setInteractive({
          hitArea: new Phaser.Geom.Rectangle(-cardW / 2, -cardH / 2, cardW, cardH),
          hitAreaCallback: (rect, x, y) => rect.contains(x, y),
          useHandCursor: true,
        });
        c.on('pointerover', () => bg.setFillStyle(0x1b5580, 1));
        c.on('pointerout', () => bg.setFillStyle(0x123a5a, 0.95));
        c.on('pointerdown', () => {
          audio.sfx('ui');
          this.closeLevelSelect();
          this.scene.start(SCENES.GAME, { levelId: lvl.id });
        });
      } else {
        c.add(this.add.text(cardW / 2 - 26, 0, '🔒', { fontSize: '30px' }).setOrigin(0.5));
        c.setAlpha(0.6);
      }
      ov.add(c);
    });

    ov.add(this.makeMenuBtn(cx, startY + LEVELS.length * (cardH + gap) - 4, '关闭', () => this.closeLevelSelect()));
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
    const title = this.add.text(cx, 70, '成就勋章', {
      fontFamily: 'sans-serif', fontSize: '34px', fontStyle: '800', color: '#ffd86b',
    }).setOrigin(0.5);
    ov.add(dim);
    this.addPanel(ov, cx);
    ov.add(title);

    const list = AchievementManager.getAll();
    const cols = 2, cardW = 230, cardH = 96, gapX = 16, gapY = 14;
    const startX = cx - (cols * cardW + (cols - 1) * gapX) / 2 + cardW / 2;
    const startY = 140;
    list.forEach((a, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);
      const c = this.add.container(x, y);
      const bgColor = a.unlocked ? 0x163a2e : 0x16161e;
      const bg = this.add.rectangle(0, 0, cardW, cardH, bgColor, 0.96)
        .setStrokeStyle(2, a.unlocked ? COLORS.coin : 0x445566);
      c.add(bg);
      c.add(this.add.text(-cardW / 2 + 14, -cardH / 2 + 12, a.icon + '  ' + a.name, {
        fontFamily: 'sans-serif', fontSize: '18px', fontStyle: '700',
        color: a.unlocked ? '#ffffff' : '#8899aa',
      }).setOrigin(0, 0));
      c.add(this.add.text(-cardW / 2 + 14, -cardH / 2 + 42, a.desc, {
        fontFamily: 'sans-serif', fontSize: '12px',
        color: a.unlocked ? '#cfe8c0' : '#667788',
        wordWrap: { width: cardW - 28 },
      }).setOrigin(0, 0));
      if (!a.unlocked) {
        c.add(this.add.text(cardW / 2 - 18, cardH / 2 - 18, '🔒', { fontSize: '18px' }).setOrigin(0.5));
      }
      ov.add(c);
    });

    const unlockedCount = list.filter((a) => a.unlocked).length;
    const rows = Math.ceil(list.length / cols);
    ov.add(this.add.text(cx, startY + rows * (cardH + gapY) - 6,
      `已解锁 ${unlockedCount} / ${list.length}`, {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#aaccdd',
    }).setOrigin(0.5));

    ov.add(this.makeMenuBtn(cx, GAME_HEIGHT - 70, '关闭', () => this.closeAchievements()));
  }

  closeAchievements() {
    if (this.achievementsOverlay) { this.achievementsOverlay.destroy(); this.achievementsOverlay = null; }
    this.achievementsOpen = false;
  }

  // ---- 每日签到面板（首次进菜单自动弹）----
  openCheckIn() {
    this.checkinOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.checkinOverlay = ov;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    const title = this.add.text(cx, 300, '每日签到', {
      fontFamily: 'sans-serif', fontSize: '34px', fontStyle: '800', color: '#ffd86b',
    }).setOrigin(0.5);
    ov.add(dim);
    this.addPanel(ov, cx);
    ov.add(title);

    const cur = SaveManager.load();
    const y = new Date(Date.now() - 86400000);
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    const nextStreak = (cur.lastCheckin === yStr) ? (cur.checkinStreak || 0) + 1 : 1;
    const reward = 50 + (nextStreak - 1) * 20;
    const info = this.add.text(cx, 370, `连续签到第 ${cur.checkinStreak || 0} 天\n今日可领：${reward} 金币`, {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#cfe8ff', align: 'center',
      wordWrap: { width: 360 },
    }).setOrigin(0.5);
    ov.add(info);

    const claimBtn = this.makeMenuBtn(cx, 470, '领取奖励', () => {
      const res = SaveManager.checkIn();
      if (res.claimed) {
        info.setText(`已领取！\n+${res.reward} 金币 · 连续 ${res.streak} 天`);
        claimBtn.destroy();
        if (this.saveInfoText) {
          const sv = SaveManager.load();
          this.saveInfoText.setText(`金币 ${sv.coins}   ·   已解锁第 ${sv.unlockedLevel} 关`);
        }
        ov.add(this.makeMenuBtn(cx, 470, '好的', () => this.closeCheckIn()));
      } else {
        info.setText('今天已经签到啦～');
      }
    });
    ov.add(claimBtn);
    ov.add(this.makeMenuBtn(cx, 540, '稍后再说', () => this.closeCheckIn()));
  }

  closeCheckIn() {
    if (this.checkinOverlay) { this.checkinOverlay.destroy(); this.checkinOverlay = null; }
    this.checkinOpen = false;
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
    const title = this.add.text(cx, 250, '每日任务', {
      fontFamily: 'sans-serif', fontSize: '34px', fontStyle: '800', color: '#7cf3ff',
    }).setOrigin(0.5);
    ov.add(title);

    const quests = SaveManager.getDailyQuests();
    const claimed = SaveManager.dailyQuestsClaimed();
    let cursor = 320;
    quests.forEach((q) => {
      const y = cursor; cursor += 96;
      const label = this.add.text(cx - 200, y, q.desc, {
        fontFamily: 'sans-serif', fontSize: '19px', color: '#cfe8ff',
      }).setOrigin(0, 0.5);
      const prog = this.add.text(cx + 200, y, `${q.progress}/${q.target}  +${q.reward}`, {
        fontFamily: 'sans-serif', fontSize: '17px',
        color: q.done ? '#7cffa0' : '#88bbdd',
      }).setOrigin(1, 0.5);
      // 进度条
      const barW = 380, barX = cx - barW / 2, barY = y + 22;
      const track = this.add.rectangle(barX, barY, barW, 8, 0x223344)
        .setOrigin(0, 0.5).setStrokeStyle(1, 0x557799);
      const ratio = q.target ? Math.min(1, q.progress / q.target) : 0;
      const fill = this.add.rectangle(barX, barY, barW * ratio, 8, q.done ? 0x7cffa0 : 0x66ccff)
        .setOrigin(0, 0.5);
      ov.add([label, prog, track, fill]);
    });

    const statusText = this.add.text(cx, cursor + 6, claimed ? '今日任务已领取 ✅'
      : (SaveManager.dailyQuestsReady() ? '全部完成，可领取奖励！' : '完成上方目标即可领取金币'), {
      fontFamily: 'sans-serif', fontSize: '18px', color: claimed ? '#7cffa0' : '#cfe8ff',
      align: 'center', wordWrap: { width: 400 },
    }).setOrigin(0.5);
    ov.add(statusText);

    const claimBtn = this.makeMenuBtn(cx, cursor + 70, claimed ? '已领取' : '领取奖励', () => {
      const res = SaveManager.claimDailyQuests();
      if (res.claimed) {
        statusText.setText(`已领取！\n+${res.reward} 金币 · ${res.count} 项任务`);
        claimBtn.destroy();
        if (this.saveInfoText) {
          const sv = SaveManager.load();
          this.saveInfoText.setText(`金币 ${sv.coins}   ·   已解锁第 ${sv.unlockedLevel} 关`);
        }
        ov.add(this.makeMenuBtn(cx, cursor + 70, '好的', () => this.closeDailyQuest()));
      } else if (res.notReady) {
        statusText.setText('还有任务没完成哦～');
      }
    });
    if (claimed || !SaveManager.dailyQuestsReady()) claimBtn.setAlpha(0.45);
    ov.add(claimBtn);
    ov.add(this.makeMenuBtn(cx, cursor + 134, '稍后再说', () => this.closeDailyQuest()));
  }

  closeDailyQuest() {
    if (this.dailyQuestOverlay) { this.dailyQuestOverlay.destroy(); this.dailyQuestOverlay = null; }
    this.dailyQuestOpen = false;
  }

  makeSlider(ov, cx, y, label, type) {
    const val = audio.getVolume(type);
    const lab = this.add.text(cx - 150, y, label, {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#cfe8ff',
    }).setOrigin(0, 0.5);
    const trackW = 220, trackH = 8, tx = cx - 10;
    const track = this.add.rectangle(tx, y, trackW, trackH, 0x223344)
      .setStrokeStyle(1, 0x557799).setInteractive();
    const fill = this.add.rectangle(tx - trackW / 2, y, trackW * val, trackH, 0x66ccff)
      .setOrigin(0, 0.5);
    const knob = this.add.circle(tx - trackW / 2 + trackW * val, y, 12, 0x7cf3ff)
      .setStrokeStyle(2, 0xffffff).setInteractive({ useHandCursor: true });
    const valTxt = this.add.text(tx + trackW / 2 + 16, y, `${Math.round(val * 100)}%`, {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#aaccdd',
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
    return new NeonButton(this, x, y, label, { onDown: cb }).container;
  }

  /** 统一的内嵌霓虹面板背景：圆角半透卡片 + 霓虹描边，套在 dim 之上、内容之下 */
  addPanel(ov, cx, top = 70, bottom = GAME_HEIGHT - 50, w = 460) {
    const g = this.add.graphics();
    g.fillStyle(THEME.panelBg, THEME.panelBgAlpha);
    g.fillRoundedRect(cx - w / 2, top, w, bottom - top, THEME.panelRadius);
    g.lineStyle(2, THEME.panelStroke, THEME.panelStrokeAlpha);
    g.strokeRoundedRect(cx - w / 2, top, w, bottom - top, THEME.panelRadius);
    ov.add(g);
  }
}
