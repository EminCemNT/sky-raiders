import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, EVENTS, LEVELS, WEAPONS, SHIPS, WINGMAN, PLAYER, EVENT_MODES, OVERCHARGE } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';
import { t } from '../config/Locale.js';
import { audio } from '../systems/AudioSystem.js';
import { NeonBar, NeonButton, makeIconButton, THEME } from '../utils/UIWidgets.js';
import { SKILLS, DEFAULT_SKILL } from '../config/Skills.js';

const PREFERS_REDUCED = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * UIScene：HUD 叠层，与 GameScene 并行运行。
 * ---------------------------------------------------------------------------
 * 只读 EventBus 事件更新显示，绝不直接操作 GameScene 对象。
 * 显示：分数、HP 条、炸弹数、关卡/波次、Boss 血条、移动端炸弹按钮。
 * 视觉：科幻扁平霓虹（圆角发光状态条 + 图标按钮 + 图形化暂停键）。
 */
export default class UIScene extends Phaser.Scene {
  constructor() {
    super(SCENES.UI);
  }

  init(data) {
    this.hudData = data || {};
    this.mode = (data && data.mode) || 'normal';
    this._element = (data && data.element) || null;   // 开局战机元素（元素核心轮换指示初始值）
    // P0 留存-活动轮换：事件模式（金币冲刺/限时生存）HUD 走倒计时文本
    this._eventMode = this.mode === 'coin_rush' || this.mode === 'survival';
    this._eventCfg = EVENT_MODES[this.mode] || null;
  }

  create() {
    const d = this.hudData;

    // 分数（等宽数字防跳动 + 霓虹辉光 + SCORE 标签）
    this.add.text(16, 14, 'SCORE', {
      fontFamily: THEME.fontFamily, fontSize: '11px', fontStyle: '700', color: THEME.hudLabel,
    }).setDepth(100).setAlpha(0.8);
    this.scoreText = this.add.text(16, 28, '000000', {
      fontFamily: THEME.scoreFont, fontSize: '26px', fontStyle: '800', color: THEME.titleBright,
    }).setDepth(100).setShadow(0, 0, THEME.titleShadow, 12, true, true);

    // 关卡名 / Boss Rush 标签（右侧信息列整体右对齐留白 70px，避让右上角暂停键，避免小屏重叠）
    const HUD_RIGHT = GAME_WIDTH - 70;
    const lvl = LEVELS.find((l) => l.id === d.levelId) || LEVELS[0];
    const levelLabel = this.mode === 'bossrush' ? 'BOSS RUSH'
      : (this._eventCfg ? t(`eventName_${this.mode}`) : t('hudLevelLabel', { level: lvl.id, name: t(`levelName_${lvl.id}`) }));
    this.levelLabel = this.add.text(HUD_RIGHT, 18, levelLabel, {
      fontFamily: THEME.fontFamily, fontSize: '15px', fontStyle: '700', color: THEME.titleColor,
    }).setOrigin(1, 0).setDepth(100);

    // 波次提示
    this.waveText = this.add.text(HUD_RIGHT, 42, '', {
      fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textSecondary,
    }).setOrigin(1, 0).setDepth(100);

    // 剩余命数（P1 命数复活：数字指示，右上角）
    this.livesText = this.add.text(HUD_RIGHT, 64, `命 ×${d.lives != null ? d.lives : PLAYER.START_LIVES}`, {
      fontFamily: THEME.fontFamily, fontSize: '15px', fontStyle: '700', color: THEME.textSuccess,
    }).setOrigin(1, 0).setDepth(100);

    // 局内火力(P)等级指示（P1：拾取 P +1 / 受击 -1，右上角，金色）
    this.powerText = this.add.text(HUD_RIGHT, 84, '火力 Lv0', {
      fontFamily: THEME.fontFamily, fontSize: '15px', fontStyle: '700', color: THEME.textGold,
    }).setOrigin(1, 0).setDepth(100);

    // 玩家元素指示（元素核心轮换用，最小指示：右上角一行彩色文字，无元素时隐藏）
    this.elementText = this.add.text(HUD_RIGHT, 104, '', {
      fontFamily: THEME.fontFamily, fontSize: '14px', fontStyle: '700', color: THEME.textCyan,
    }).setOrigin(1, 0).setDepth(100).setVisible(false);

    // 擦弹计数（P2）：右侧信息列追加一行，监听 GRAZE_CHANGED
    this.grazeText = this.add.text(HUD_RIGHT, 124, '擦弹 0', {
      fontFamily: THEME.fontFamily, fontSize: '14px', fontStyle: '700', color: THEME.textCyan,
    }).setOrigin(1, 0).setDepth(100);

    // HP 条（圆角发光）
    this.hpBar = new NeonBar(this, 16, 64, 180, 14, { color: 0x33dd88 });
    this.hpText = this.add.text(204, 64, '', {
      fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textMuted,
    }).setOrigin(0, 0.5).setDepth(101);

    // 能量槽（0~100%，充满高亮）
    this.energyBar = new NeonBar(this, 16, 86, 180, 12, { color: 0xb98bff });
    this.energyText = this.add.text(204, 86, '能量 0%', {
      fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textMint,
    }).setOrigin(0, 0.5).setDepth(101);

    // Boss 血条（居中，默认隐藏）
    this.bossBar = new NeonBar(
      this, GAME_WIDTH / 2 - (GAME_WIDTH - 84) / 2, 84, GAME_WIDTH - 84, 12,
      { color: 0xff3355, bgColor: 0x330011, borderColor: 0xcc4466 },
    );
    this.bossBar.setVisible(false);
    // Boss 名字（常驻，血条上方居中，霓虹辉光描边；错层到 y=52 避让左侧 HP 条与右侧命数）
    this.bossNameText = this.add.text(GAME_WIDTH / 2, 52, '', {
      fontFamily: THEME.fontFamily, fontSize: '15px', fontStyle: '800', color: THEME.textPink, align: 'center',
    }).setOrigin(0.5).setDepth(100).setShadow(0, 0, THEME.dangerDeep, 14, true, true).setVisible(false);

    // 炸弹按钮（右下角图标化）
    this.bombs = d.bombs || 0;
    this.bombIcon = makeIconButton(this, GAME_WIDTH - 62, GAME_HEIGHT - 72, 'item_bomb', {
      radius: 40, count: `x${this.bombs}`, ringAlpha: 0.18,
      onDown: () => { audio.sfx('ui'); EventBus.emit(EVENTS.USE_BOMB); },
    });
    // 炸弹常驻辉光（轻脉动，区分"始终可用"与能量技能）
    this.tweens.add({
      targets: this.bombIcon.ring, alpha: { from: 0.12, to: 0.34 },
      duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // 技能按钮（右下角图标化，能量满时发光脉冲）。
    // P2 第二主动技能：tap 发 USE_SKILL（由 GameScene 按 activeSkill 派发星风暴/过载；USE_SUPER 事件保留兼容）
    this.skill = makeIconButton(this, GAME_WIDTH - 156, GAME_HEIGHT - 72, 'item_energy', {
      radius: 40, ringAlpha: 0, label: t('uiSkill'),
      onDown: () => { audio.sfx('ui'); EventBus.emit(EVENTS.USE_SKILL); },
    });
    this.skill.container.setAlpha(0.45);
    this.skillReady = false;
    this._skillName = DEFAULT_SKILL;
    this._overdriveUntil = 0;

    // P2 技能切换箭头（星风暴 ↔ 过载 轮换）：技能按钮左侧小圆钮，发 SKILL_SWITCHED
    this.skillSwitch = this.add.container(GAME_WIDTH - 224, GAME_HEIGHT - 72).setDepth(105);
    const swBg = this.add.circle(0, 0, 17, THEME.btnBg, 0.85).setStrokeStyle(2, THEME.btnStroke, 0.9);
    const swTxt = this.add.text(0, 0, '⇄', {
      fontFamily: THEME.fontFamily, fontSize: '18px', fontStyle: '700', color: THEME.textCyan,
    }).setOrigin(0.5);
    this.skillSwitch.add([swBg, swTxt]);
    this.skillSwitch.setSize(34, 34).setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-17, -17, 34, 34),
      hitAreaCallback: (rect, x, y) => rect.contains(x, y),
      useHandCursor: true,
    });
    this.skillSwitch.on('pointerdown', () => { audio.sfx('ui'); EventBus.emit(EVENTS.SKILL_SWITCHED); });

    // 增益徽标（护盾/磁力）：矢量纹理图标 + 文本，取代 emoji 🛡/🧲（跨端字形一致）
    this.shieldIcon = this.add.image(16, 104, 'item_shield').setScale(0.5).setDepth(101).setVisible(false);
    this.shieldBadge = this.add.text(26, 104, t('uiShield'), {
      fontFamily: THEME.fontFamily, fontSize: '12px', color: THEME.shield,
    }).setOrigin(0, 0.5).setDepth(101).setVisible(false);
    this.magnetIcon = this.add.image(96, 104, 'item_magnet').setScale(0.5).setDepth(101).setVisible(false);
    this.magnetBadge = this.add.text(106, 104, t('uiMagnet'), {
      fontFamily: THEME.fontFamily, fontSize: '12px', color: THEME.magnet,
    }).setOrigin(0, 0.5).setDepth(101).setVisible(false);

    // 武器指示器（B/C 武器系统）
    this._weaponName = 'pulse';
    this._weaponUntilTime = 0;
    this.weaponText = this.add.text(16, 124, '主炮 · 脉冲', {
      fontFamily: THEME.fontFamily, fontSize: '12px', color: THEME.textCyan,
    }).setDepth(101);

    // 僚机状态指示（第三版起步）：数量 / 元素 / 武器等级 / 重生倒计时
    this._buildWingmanHud();

    // P1 超载 HUD（小图标 + 进度条：蓄力进度 / 激活倒计时）
    this._buildOverchargeHud();
    // P1 聚焦模式：移动端专用按钮（桌面用 Shift 键）
    this._buildFocusButton();

    this.skillKey = this.input.keyboard.addKey('F');
    this.skillSwitchKey = this.input.keyboard.addKey('Q');   // P2：Q 切换星风暴 ↔ 过载

    // 暂停按钮（右上角：放大发光 + 轻微 alpha 脉冲，A5）
    const ps = THEME.pauseBtn.size;   // 48
    const ph = ps / 2;                // 24
    this.pauseBtn = this.add.container(GAME_WIDTH - 30, 26).setDepth(110);
    this.pauseBtn.setSize(ps, ps).setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-ph, -ph, ps, ps),
      hitAreaCallback: (rect, x, y) => rect.contains(x, y),
      useHandCursor: true,
    });
    const pg = this.add.graphics();
    pg.fillStyle(THEME.pauseBtn.glow, 0.18); pg.fillRoundedRect(-ph - 3, -ph - 3, ps + 6, ps + 6, 10);
    pg.fillStyle(THEME.btnBg, 0.9); pg.fillRoundedRect(-ph, -ph, ps, ps, 8);
    pg.lineStyle(2, THEME.pauseBtn.glow, 0.9); pg.strokeRoundedRect(-ph, -ph, ps, ps, 8);
    const barW = Math.max(4, ps * 0.16), barH = ps * 0.42, off = ps * 0.13;
    pg.fillStyle(THEME.whiteHex, 1);
    pg.fillRoundedRect(-off - barW / 2, -barH / 2, barW, barH, barW / 2);
    pg.fillRoundedRect(off - barW / 2, -barH / 2, barW, barH, barW / 2);
    this.pauseBtn.add(pg);
    this.pauseBtn.on('pointerdown', () => this.togglePause());
    // 外圈轻微 alpha 脉冲
    this.tweens.add({
      targets: this.pauseBtn, alpha: { from: 1, to: 0.7 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    // 暂停遮罩（默认隐藏）
    this._paused = false;
    this.pauseOverlay = this.add.container(0, 0).setDepth(200).setVisible(false);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.62).setOrigin(0);
    const pTitle = this.add.text(GAME_WIDTH / 2, 300, t('uiPaused'), {
      fontFamily: THEME.fontFamily, fontSize: '46px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 16, true, true);
    const resumeBtn = this.makePauseButton(GAME_WIDTH / 2, 440, t('uiResume'), () => this.togglePause());
    const quitBtn = this.makePauseButton(GAME_WIDTH / 2, 530, t('uiQuit'), () => this.quitToMenu());
    // P1-6 可见判定点开关（斑鸠/虫姬同款）：暂停面板内一键切换存档 showHitbox
    const hbBtn = new NeonButton(this, GAME_WIDTH / 2, 620, this._hitboxLabel(), {
      onDown: () => {
        const cur = SaveManager.load().showHitbox;
        SaveManager.set('showHitbox', !cur);
        hbBtn.setLabel(this._hitboxLabel());
        audio.sfx('ui');
      },
    });
    this.pauseOverlay.add([dim, pTitle, resumeBtn, quitBtn, hbBtn.container]);

    // 键盘暂停（P / ESC）
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-ESC', () => this.togglePause());

    this._buildLowHpVignette();   // P1-5 低血量暗角图层（先于 updateHp 首次调用建立）

    // Phase B：低血屏幕红色告警边框（与 vignette 暗角互补：亮红框强调危险）
    const bw = 6;
    this._lowHpBorder = this.add.graphics().setDepth(95).setVisible(false);
    this._lowHpBorder.lineStyle(bw, THEME.dangerBorder, 1);
    this._lowHpBorder.strokeRect(bw / 2, bw / 2, GAME_WIDTH - bw, GAME_HEIGHT - bw);
    this._lowHpBorderBase = 0;

    // 连击 HUD（常驻，复用不重建）：击杀连击计数，脉冲缩放 + 档位变色（D）
    // y≈170 顶部区域（错层到 Boss 血条之下），不挡玩家判定区（约 y≈860）；初始隐藏，COMBO_CHANGED 触发显隐
    this.comboText = this.add.text(GAME_WIDTH / 2, 170, '', {
      fontFamily: THEME.fontFamily, fontSize: '42px', fontStyle: '800', color: THEME.titleColor, align: 'center',
    }).setOrigin(0.5).setDepth(120).setShadow(0, 0, '#000000', 8, true, true).setVisible(false);
    this._lastComboPulse = 0;     // 连击脉冲频控（120ms）

    this.bindEvents();
    this.events.once('shutdown', () => this.unbind());

    // 初始化状态
    this.updateHp(d.hp || 100, d.maxHp || 100);
    this.updateEnergy(d.energy || 0, 100);
    this._renderElement(this._element);   // 开局元素指示（元素核心轮换初始值）

    // Phase C：关卡开场大字 banner（Stage Banner，Back.easeOut 弹入 + 辉光 + 淡出）
    const stageName = this.mode === 'bossrush' ? 'BOSS RUSH'
      : (this._eventCfg ? t(`eventName_${this.mode}`) : t(`levelName_${lvl.id}`));
    const stageSub = this.mode === 'bossrush' ? t('stageSubRush')
      : (this._eventCfg ? t('stageSubEvent', { duration: this._eventCfg.duration }) : t('stageSubLevel', { level: lvl.id }));
    this.showStageBanner(stageName, stageSub);
  }

  /** Phase C：关卡开场大字横幅（弹入 + 停留 + 淡出；reduced-motion 静态） */
  showStageBanner(name, sub) {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT * 0.4;
    const cont = this.add.container(cx, cy).setDepth(130);
    const title = this.add.text(0, 0, name, {
      fontFamily: THEME.fontFamily, fontSize: '46px', fontStyle: '800', color: THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 22, true, true);
    const subT = this.add.text(0, 46, sub, {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.titleColor, fontStyle: '700',
    }).setOrigin(0.5).setAlpha(0.9).setLetterSpacing(6);
    cont.add([title, subT]);
    if (PREFERS_REDUCED) {
      cont.setScale(1).setAlpha(1);
      this.time.delayedCall(1800, () => this.tweens.add({ targets: cont, alpha: 0, duration: 400, onComplete: () => cont.destroy() }));
    } else {
      cont.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: cont, scale: 1, alpha: 1, duration: 420, ease: 'Back.easeOut' });
      this.tweens.add({ targets: cont, alpha: 0, delay: 1700, duration: 500, onComplete: () => cont.destroy() });
    }
  }

  makePauseButton(x, y, label, cb) {
    return new NeonButton(this, x, y, label, { onDown: cb }).container;
  }

  // ---- 僚机状态指示（第三版起步）----
  // 预建 WINGMAN.MAX 个小圆 + 倒计时文本（初始隐藏），收到 WINGMAN_STATUS 后按快照更新。
  _buildWingmanHud() {
    const WM_COLORS = { fire: 0xff6633, ice: 0x33ccff, thunder: 0xffe14a };
    this._wmColors = WM_COLORS;
    this.wmTitle = this.add.text(16, 146, t('uiWingman'), {
      fontFamily: THEME.fontFamily, fontSize: '12px', color: THEME.textCyan,
    }).setDepth(101).setVisible(false);
    this.wmCountText = this.add.text(16, 164, '', {
      fontFamily: THEME.fontFamily, fontSize: '11px', color: THEME.textMuted,
    }).setDepth(101).setVisible(false);
    this.wmDots = [];
    for (let i = 0; i < WINGMAN.MAX; i++) {
      const x = 58 + i * 22, y = 152;
      const g = this.add.graphics().setDepth(101).setVisible(false);
      const cd = this.add.text(x, y, '', {
        fontFamily: THEME.fontFamily, fontSize: '10px', color: THEME.textWmCd,
      }).setOrigin(0.5).setDepth(102).setVisible(false);
      this.wmDots.push({ g, cd, x, y });
    }
    // 集火准星（第三版③）：锁定时在焦点目标位置画圆环 + 十字（默认隐藏）
    this.wmFocus = this.add.graphics().setDepth(103).setVisible(false);
    // 状态回调（只读快照，零直接对象操作）
    this._onWmStatus = (s) => {
      if (!this.wmDots || !s) return;
      this.wmTitle.setVisible(true);
      this.wmCountText.setVisible(true);
      for (let i = 0; i < this.wmDots.length; i++) {
        const d = this.wmDots[i];
        const m = (s.members && s.members[i]) || null;
        if (!m || i >= s.count) { d.g.setVisible(false); d.cd.setVisible(false); continue; }
        d.g.setVisible(true).clear();
        const col = m.alive ? (this._wmColors[m.element] || 0x88aacc) : 0x445566;
        d.g.fillStyle(col, m.alive ? 1 : 0.5);
        d.g.fillCircle(d.x, d.y, 7);
        if (!m.alive && m.respawnRemainMs > 0) {
          d.cd.setVisible(true).setText(Math.ceil(m.respawnRemainMs / 1000).toString());
        } else {
          d.cd.setVisible(false);
        }
      }
      // 第三版③集火指令：锁定目标时画准星 + 计数文本追加"· 集火"
      if (s.focus && s.focus.active) {
        const fx = s.focus.x, fy = s.focus.y;
        this.wmFocus.setVisible(true).clear();
        this.wmFocus.lineStyle(2, THEME.coinHex, 0.95);
        this.wmFocus.strokeCircle(fx, fy, 26);
        this.wmFocus.lineStyle(2, THEME.coinHex, 0.7);
        this.wmFocus.beginPath();
        this.wmFocus.moveTo(fx - 34, fy); this.wmFocus.lineTo(fx - 30, fy);
        this.wmFocus.moveTo(fx + 30, fy); this.wmFocus.lineTo(fx + 34, fy);
        this.wmFocus.moveTo(fx, fy - 34); this.wmFocus.lineTo(fx, fy - 30);
        this.wmFocus.moveTo(fx, fy + 30); this.wmFocus.lineTo(fx, fy + 34);
        this.wmFocus.strokePath();
      } else {
        this.wmFocus.setVisible(false);
      }
      let txt = `Lv${s.weaponLv} · ${s.count}架 · 协同×${s.comboMul ? s.comboMul.toFixed(2) : '1.00'}`;
      if (s.focus && s.focus.active) txt += t('uiFocusOn');
      this.wmCountText.setText(txt);
    };
  }

  /** P1 超载 HUD：小图标 + 进度条（左下发；蓄力进度青 / 激活倒计时金） */
  _buildOverchargeHud() {
    const x = 20, y = GAME_HEIGHT - 58;
    this.ocBg = this.add.rectangle(x, y, 92, 20, 0x0a1a2a, 0.9)
      .setStrokeStyle(1, 0x2a4a6a, 0.9).setDepth(101).setVisible(false);
    this.ocFill = this.add.rectangle(x - 44 + 2, y, 88, 14, 0x33ccff, 0.9)
      .setOrigin(0, 0.5).setDepth(102).setVisible(false);
    this.ocLabel = this.add.text(x, y - 18, t('uiOvercharge'), {
      fontFamily: THEME.fontFamily, fontSize: '11px', fontStyle: '700', color: THEME.textGold,
    }).setDepth(101).setVisible(false);
    this.ocText = this.add.text(x + 94, y, '', {
      fontFamily: THEME.fontFamily, fontSize: '10px', color: THEME.textMuted,
    }).setDepth(101).setVisible(false);
    this._ocActiveUntil = 0;
    this._ocActiveDur = OVERCHARGE.DURATION || 5000;
    this._lastOc = null;
  }

  /** P1 聚焦模式：移动端专用按钮（点击切换，桌面 Shift 键无需此按钮） */
  _buildFocusButton() {
    const x = 52, y = GAME_HEIGHT - 124;
    this._focusOn = false;
    this.focusBtn = this.add.circle(x, y, 24, 0x0a2a44, 0.92)
      .setStrokeStyle(2, 0x33ccff, 0.8).setDepth(105).setInteractive({ useHandCursor: true });
    this.focusBtnTxt = this.add.text(x, y, t('uiFocus'), {
      fontFamily: THEME.fontFamily, fontSize: '17px', fontStyle: '700', color: '#9fe8ff',
    }).setOrigin(0.5).setDepth(106);
    this.focusBtn.on('pointerdown', () => {
      audio.sfx('ui');
      this._focusOn = !this._focusOn;
      EventBus.emit(EVENTS.FOCUS_TOGGLE);
      this.focusBtn.setStrokeStyle(2, this._focusOn ? 0xffd54a : 0x33ccff, this._focusOn ? 1 : 0.8);
      this.focusBtnTxt.setColor(this._focusOn ? '#ffe9a0' : '#9fe8ff');
    });
  }

  /** P1 渲染超载进度条：激活 → 剩余时长 / 蓄力 → max(P/3, graze/5) */
  _renderOverchargeBar() {
    if (!this.ocFill || !this.ocBg) return;
    let ratio = 0;
    if (this._ocActiveUntil && this._ocActiveUntil > 0) {
      const left = Math.max(0, this._ocActiveUntil - this.time.now);
      ratio = Phaser.Math.Clamp(left / (this._ocActiveDur || 5000), 0, 1);
      this.ocFill.setFillStyle(0xffd54a, 0.9);
    } else {
      const cfg = OVERCHARGE;
      const s = this._lastOc || {};
      ratio = Phaser.Math.Clamp(Math.max((s.p || 0) / (cfg.P_STACK || 3), (s.graze || 0) / (cfg.GRAZE_STACK || 5)), 0, 1);
      this.ocFill.setFillStyle(0x33ccff, 0.9);
    }
    this.ocFill.setSize(Math.max(0, 88 * ratio), 14);
  }

  /** 渲染玩家元素指示（元素核心轮换用）：无元素隐藏，有元素显示彩色「元素 · X」 */
  _renderElement(el) {
    if (!this.elementText) return;
    const INFO = { fire: ['火', '#ff7a3a'], ice: ['冰', '#6fd6ff'], thunder: ['雷', '#ffe14a'] };    if (el && INFO[el]) {
      this.elementText.setText(`元素 · ${INFO[el][0]}`).setColor(INFO[el][1]).setVisible(true);
    } else {
      this.elementText.setVisible(false);
    }
  }

  togglePause() {
    if (this._paused) {
      this.scene.resume(SCENES.GAME);
      audio.resumeBgm();
      this._paused = false;
      this.pauseOverlay.setVisible(false);
    } else {
      this.scene.pause(SCENES.GAME);
      audio.pauseBgm();
      this._paused = true;
      this.pauseOverlay.setVisible(true);
    }
  }

  quitToMenu() {
    this.scene.resume(SCENES.GAME);
    this.scene.stop(SCENES.GAME);
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.MENU);
  }

  bindEvents() {
    // 场景重启时复位横幅队列，避免上局残留队列导致横幅卡死/重复
    this._achShowing = false;
    this._achQueue = [];

    this._onScore = (s) => { if (this.scoreText) this.scoreText.setText(String(s).padStart(6, '0')); };
    EventBus.on('__hud_score', this._onScore);

    this._onHp = (hp, max) => this.updateHp(hp, max);
    EventBus.on(EVENTS.HP_CHANGED, this._onHp);

    this._onBombs = (n) => {
      this.bombs = n;
      if (this.bombIcon && this.bombIcon.count) this.bombIcon.count.setText(`x${n}`);
    };
    EventBus.on('__hud_bombs', this._onBombs);

    this._onLives = (n) => {
      if (this.livesText) this.livesText.setText(`命 ×${n}`);
    };
    EventBus.on(EVENTS.LIVES_CHANGED, this._onLives);

    this._onPower = (n) => {
      if (this.powerText) this.powerText.setText(`火力 Lv${n}`);
    };
    EventBus.on(EVENTS.POWER_CHANGED, this._onPower);

    this._onWave = ({ wave, total, endless }) => {
      if (this._eventMode) return; // 活动模式：波次文本由 EVENT_TIMER 倒计时接管
      if (this.waveText) this.waveText.setText(endless ? `第 ${wave} 波 · 无尽` : `第 ${wave}/${total} 波`);
      this.flashCenter(`第 ${wave} 波`);
    };
    EventBus.on(EVENTS.WAVE_STARTED, this._onWave);

    // P0 留存-活动轮换：倒计时显示（金币冲刺/限时生存），接管 waveText
    this._onEventTimer = (e) => {
      if (!e) return;
      if (this.waveText) this.waveText.setText(`${e.name} ${e.left}s`);
    };
    EventBus.on(EVENTS.EVENT_TIMER, this._onEventTimer);

    this._onBossSpawn = (info) => {
      this.bossBar.setVisible(true);
      const name = (info && info.name) ? info.name : 'BOSS';
      if (this.bossNameText) this.bossNameText.setText(name).setVisible(true);
      this.flashCenter(t('bossIncoming', { name }), THEME.textRed);
      if (this.waveText) this.waveText.setText(t('uiBossBattle'));
    };
    EventBus.on(EVENTS.BOSS_SPAWNED, this._onBossSpawn);

    this._onBossHp = (hp, max) => {
      this.bossBar.setRatio(Phaser.Math.Clamp(hp / max, 0, 1));
    };
    EventBus.on(EVENTS.BOSS_HP_CHANGED, this._onBossHp);

    this._onBossDead = () => { this.bossBar.setVisible(false); if (this.bossNameText) this.bossNameText.setVisible(false); };
    EventBus.on(EVENTS.BOSS_DEFEATED, this._onBossDead);

    this._onBossPhase = (phase) => {
      const label = phase >= 3 ? t('uiBossRage') : t('uiPhase', { phase });
      this.flashCenter(label, phase >= 3 ? THEME.textRed : THEME.textGold);
    };
    EventBus.on(EVENTS.BOSS_PHASE, this._onBossPhase);

    this._onEnergy = (val, max) => this.updateEnergy(val, max);
    EventBus.on(EVENTS.ENERGY_CHANGED, this._onEnergy);

    this._onShield = (active) => {
      if (this.shieldIcon) this.shieldIcon.setVisible(!!active);
      if (this.shieldBadge) this.shieldBadge.setVisible(!!active);
    };
    EventBus.on(EVENTS.SHIELD_CHANGED, this._onShield);

    this._onMagnet = (active) => {
      if (this.magnetIcon) this.magnetIcon.setVisible(!!active);
      if (this.magnetBadge) this.magnetBadge.setVisible(!!active);
    };
    EventBus.on(EVENTS.MAGNET_CHANGED, this._onMagnet);

    this._onCombo = (combo, mult) => {
      if (!this.comboText) return;
      // 断连（combo≤1）：快速收缩隐藏（复用常驻对象，不重建）
      if (combo <= 1) {
        if (this.comboText.visible) {
          this.tweens.killTweensOf(this.comboText);
          this.comboText.setVisible(false).setScale(1);
        }
        return;
      }
      // 每次连击变化都更新文本 + 档位变色（combo<20 青 / 20~39 金 / ≥40 红）
      this.comboText.setText(`连击 ×${combo}\n×${(mult || 1).toFixed(1)}`);
      this.comboText.setColor(combo >= 40 ? THEME.textRed : combo >= 20 ? THEME.textGold : THEME.titleColor);
      // combo>1 即立即显示（优先于频控，保证断连后 120ms 内重新击杀也能立即显示）
      this.comboText.setVisible(true);
      // 频控：120ms 内跳过脉冲重放，防高频击杀抖动（但仍刷新文本/颜色/显隐）
      if (this.time.now - this._lastComboPulse < 120) return;
      this._lastComboPulse = this.time.now;
      if (PREFERS_REDUCED) {
        // reduced-motion：静态（保留色变/字号），去掉 scale 弹入
        this.comboText.setScale(1);
      } else {
        this.tweens.killTweensOf(this.comboText);   // 防叠加：先清旧脉冲再放新脉冲
        this.comboText.setScale(1.35);
        this.tweens.add({
          targets: this.comboText, scale: 1.0, duration: 180, ease: 'Back.easeOut',
        });
      }
    };
    EventBus.on(EVENTS.COMBO_CHANGED, this._onCombo);

    this._onElementChanged = (el) => this._renderElement(el);
    EventBus.on(EVENTS.ELEMENT_CHANGED, this._onElementChanged);

    this._onWeapon = (w, dur) => {
      this._weaponName = w;
      const isPerm = !dur || dur <= 0;   // 0 / 缺省 = 常驻（C2 绑定武器）
      this._weaponUntilTime = isPerm ? 0 : this.time.now + dur;
      if (this.weaponText) {
        const short = (WEAPONS[w] && WEAPONS[w].short) || '武器';
        this.weaponText.setText(w === 'pulse'
          ? '主炮 · 脉冲'
          : (isPerm ? `武器 · ${short}` : `武器 · ${short} ${Math.ceil(dur / 1000)}s`));
      }
    };
    EventBus.on(EVENTS.WEAPON_CHANGED, this._onWeapon);

    // P2 擦弹计数：右上角「擦弹 N」（payload = { count, chain }）
    this._onGraze = (p) => {
      if (this.grazeText) this.grazeText.setText(`擦弹 ${(p && p.count) || 0}`);
    };
    EventBus.on(EVENTS.GRAZE_CHANGED, this._onGraze);

    // P2 技能切换：按钮标签显示当前技能名（星风暴/过载）。
    // 仅响应带 payload 的状态广播（无 payload 的 Q/箭头指令由 GameScene 轮换后再广播）。
    this._onSkillSwitched = (id) => {
      if (!id || !SKILLS[id]) return;
      this._skillName = id;
      const def = SKILLS[id];
      if (this.skill && this.skill.label) {
        this.skill.label.setText(def ? def.name : id).setColor(THEME.white).setFontStyle('normal');
      }
    };
    EventBus.on(EVENTS.SKILL_SWITCHED, this._onSkillSwitched);

    // P2 过载状态：激活期按钮高亮 + 倒计时（reduced-motion 静态高亮无脉动）
    this._onOverdriveState = (s) => {
      this._overdriveUntil = (s && s.active) ? s.until : 0;
      if (!this.skill) return;
      if (s && s.active) {
        this.skill.icon.setTint(THEME.energy.full);
        this.skill.container.setAlpha(1);
        if (PREFERS_REDUCED) {
          this.skill.ring.setAlpha(0.7);
        } else {
          this.tweens.killTweensOf(this.skill.ring);
          this.tweens.add({
            targets: this.skill.ring, alpha: { from: 0.4, to: 0.95 },
            duration: 500, yoyo: true, repeat: -1,
          });
        }
      } else {
        this.skill.icon.clearTint();
        this.tweens.killTweensOf(this.skill.ring);
        this.skill.ring.setAlpha(0);
        // 非激活且能量未满时恢复暗态
        if (!this.skillReady) this.skill.container.setAlpha(0.45);
      }
    };
    EventBus.on(EVENTS.OVERDRIVE_STATE, this._onOverdriveState);

    // 成就系统：监听成就解锁事件，入队后顺序播放顶部横幅
    this._onAchUnlock = (def) => {
      if (!this._achQueue) this._achQueue = [];
      this._achQueue.push(def);
      if (!this._achShowing) this._nextAch();
    };
    EventBus.on(EVENTS.ACHIEVEMENT_UNLOCKED, this._onAchUnlock);

    // 僚机状态指示（第三版起步）
    EventBus.on(EVENTS.WINGMAN_STATUS, this._onWmStatus);

    // P1 超载状态：HUD 小图标 + 进度条（蓄力进度 / 激活倒计时）
    this._onOverchargeState = (s) => {
      if (!this.ocFill) return;
      const cfg = OVERCHARGE;
      this._lastOc = s || {};
      if (s && s.active) {
        this.ocBg.setVisible(true); this.ocFill.setVisible(true);
        this.ocLabel.setVisible(true).setText(t('uiOvercharge')).setColor(THEME.textGold);
        this.ocText.setVisible(true).setText('');
        this._ocActiveUntil = s.until || 0;
        this._ocActiveDur = s.duration || cfg.DURATION || 5000;
      } else {
        const p = (s && s.p) || 0, g = (s && s.graze) || 0;
        const total = Math.max(p / (cfg.P_STACK || 3), g / (cfg.GRAZE_STACK || 5));
        if (total > 0) {
          this.ocBg.setVisible(true); this.ocFill.setVisible(true);
          this.ocLabel.setVisible(true).setText(`超载 ${Math.min(100, Math.round(total * 100))}%`).setColor(THEME.textCyan);
          this.ocText.setVisible(true).setText(`${p}P ${g}擦`);
          this._ocActiveUntil = 0;
        } else {
          this.ocBg.setVisible(false); this.ocFill.setVisible(false);
          this.ocLabel.setVisible(false); this.ocText.setVisible(false);
          this._ocActiveUntil = 0;
        }
      }
      this._renderOverchargeBar();
    };
    EventBus.on(EVENTS.OVERCHARGE_STATE, this._onOverchargeState);
  }

  update() {
    // P2 技能键：F 发 USE_SKILL（按 activeSkill 派发）；Q 发 SKILL_SWITCHED（轮换技能槽）
    if (this.skillKey && Phaser.Input.Keyboard.JustDown(this.skillKey)) {
      EventBus.emit(EVENTS.USE_SKILL);
    }
    if (this.skillSwitchKey && Phaser.Input.Keyboard.JustDown(this.skillSwitchKey)) {
      EventBus.emit(EVENTS.SKILL_SWITCHED);
    }
    // P2 过载激活倒计时：按钮标签显示「过载 Ns」，到期回技能名
    if (this.skill && this.skill.label) {
      if (this._overdriveUntil && this._overdriveUntil > 0) {
        const left = Math.max(0, Math.ceil((this._overdriveUntil - this.time.now) / 1000));
        this.skill.label.setText(`过载 ${left}s`).setColor(THEME.textGold).setFontStyle('700');
      } else if (this._skillName) {
        const def = SKILLS[this._skillName] || SKILLS[DEFAULT_SKILL];
        this.skill.label.setText(def ? def.name : this._skillName).setColor(THEME.white).setFontStyle('normal');
      }
    }
    if (this._weaponName && this._weaponName !== 'pulse' && this.weaponText && this._weaponUntilTime > 0) {
      const short = (WEAPONS[this._weaponName] && WEAPONS[this._weaponName].short) || '武器';
      const left = Math.max(0, Math.ceil((this._weaponUntilTime - this.time.now) / 1000));
      this.weaponText.setText(`武器 · ${short} ${left}s`);
    }
    // P1-5 低血量暗角脉动（心跳感）；reduced-motion 用静态基线
    if (this._lowHpVignette) {
      if (this._lowHpBase > 0 && !PREFERS_REDUCED) {
        this._lowHpVignette.setAlpha(this._lowHpBase + 0.16 * (0.5 + 0.5 * Math.sin(this.time.now * 0.006)));
      } else {
        this._lowHpVignette.setAlpha(this._lowHpBase);
      }
    }
    // Phase B：低血红框告警脉动（比暗角更快，强调危险）
    if (this._lowHpBorder) {
      if (this._lowHpBorderBase > 0) {
        this._lowHpBorder.setVisible(true);
        if (!PREFERS_REDUCED) {
          this._lowHpBorder.setAlpha(this._lowHpBorderBase + 0.3 * (0.5 + 0.5 * Math.sin(this.time.now * 0.009)));
        } else {
          this._lowHpBorder.setAlpha(this._lowHpBorderBase);
        }
      } else {
        this._lowHpBorder.setVisible(false);
      }
    }
    // P1 超载激活倒计时：进度条随剩余时长收缩
    if (this._ocActiveUntil && this._ocActiveUntil > 0) this._renderOverchargeBar();
  }

  updateEnergy(val, max) {
    const ratio = Phaser.Math.Clamp((val || 0) / (max || 100), 0, 1);
    const full = ratio >= 1;
    // 能量槽：低紫 → 满蓝 渐变（统一紫蓝，A5）
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.IntegerToColor(THEME.energy.low),
      Phaser.Display.Color.IntegerToColor(THEME.energy.full),
      100, Math.round(ratio * 100),
    );
    this.energyBar.setRatio(ratio, Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    if (this.energyText) this.energyText.setText(`能量 ${Math.round(ratio * 100)}%`);
    if (this.skill && this.skillReady !== full) {
      this.skillReady = full;
      if (full) {
        this.skill.container.setAlpha(1);
        this.skill.icon.setTint(THEME.energy.full);
        this.tweens.add({
          targets: this.skill.ring, alpha: { from: 0.2, to: 0.95 },
          scale: { from: 0.9, to: 1.12 }, duration: 620, yoyo: true, repeat: -1,
        });
      } else {
        this.skill.container.setAlpha(0.45);
        this.skill.icon.clearTint();
        this.tweens.killTweensOf(this.skill.ring);
        this.skill.ring.setAlpha(0).setScale(1);
      }
    }
  }

  updateHp(hp, max) {
    if (!this.hpBar) return;
    const ratio = Phaser.Math.Clamp(hp / max, 0, 1);
    const color = ratio > 0.5 ? THEME.hp.good : ratio > 0.25 ? THEME.hp.warn : THEME.hp.bad;
    this.hpBar.setRatio(ratio, color);
    this.hpText.setText(`${Math.ceil(hp)}/${max}`);
    if (this._lowHpVignette) {
      this._lowHpBase = ratio <= 0.3 ? 0.7 * (1 - ratio / 0.3) : 0;   // P1-5 低血量驱动暗角强度
    }
    if (this._lowHpBorder) {
      this._lowHpBorderBase = ratio <= 0.3 ? 0.55 * (1 - ratio / 0.3) : 0;  // Phase B 低血红框告警强度
    }
  }

  /** P1-5 低血量暗角：程序生成径向渐变纹理（中心透明→边缘红），全屏铺底，alpha 由 HP 驱动 */
  _buildLowHpVignette() {
    const key = 'vignette-lowhp';
    if (!this.textures.exists(key)) {
      const W = GAME_WIDTH, H = GAME_HEIGHT;
      const ct = this.textures.createCanvas(key, W, H);
      const ctx = ct.getContext();
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.62);
      g.addColorStop(0, 'rgba(180,0,0,0)');
      g.addColorStop(0.7, 'rgba(180,0,0,0)');
      g.addColorStop(1, 'rgba(200,10,10,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ct.refresh();
    }
    this._lowHpVignette = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, key).setDepth(90).setAlpha(0);
    this._lowHpBase = 0;
  }

  flashCenter(text, color = THEME.titleColor) {
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, text, {
      fontFamily: THEME.fontFamily, fontSize: '38px', fontStyle: '800', color,
    }).setOrigin(0.5).setDepth(120).setAlpha(0).setShadow(0, 0, '#000000', 8, true, true);
    this.tweens.add({
      targets: t, alpha: 1, scale: 1.2, duration: 300, yoyo: true, hold: 500,
      onComplete: () => t.destroy(),
    });
  }

  /** P1-6 判定点按钮文案：随存档开关显示 开/关 */
  _hitboxLabel() {
    return t('uiHitbox', { state: SaveManager.load().showHitbox ? t('on') : t('off') });
  }

  // ---- 成就解锁横幅（顶部滑入，2.2s 后滑出）----
  _nextAch() {
    if (!this._achQueue || !this._achQueue.length) { this._achShowing = false; return; }
    this._achShowing = true;
    const def = this._achQueue.shift();
    this.showAchievementBanner(def, () => this._nextAch());
  }

  showAchievementBanner(def, onDone) {
    const hiddenLocked = def.hidden && !SaveManager.hasAchievement(def.id);
    const label = hiddenLocked ? '???' : def.name;
    const desc = hiddenLocked ? '？？？' : def.desc;
    // 成就图标：矢量勋章 / 锁（取代 emoji def.icon/🏅，跨端字形一致）
    const iconKey = hiddenLocked ? 'icon_lock' : 'icon_medal';
    const c = this.add.container(GAME_WIDTH / 2, -60).setDepth(150);
    const w = 300, h = 64;
    const bg = this.add.graphics();
    bg.fillStyle(THEME.cardBg, 0.96); bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.lineStyle(2, THEME.accent, 1); bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    const ico = this.add.image(-w / 2 + 18, 0, iconKey).setScale(0.85);
    const tag = this.add.text(-w / 2 + 54, -16, t('uiAchTag'), { fontFamily: THEME.fontFamily, fontSize: '12px', color: THEME.textGoldLight, fontStyle: '800' }).setOrigin(0, 0.5);
    const nm = this.add.text(-w / 2 + 54, 2, label, { fontFamily: THEME.fontFamily, fontSize: '17px', color: THEME.white, fontStyle: '800' }).setOrigin(0, 0.5);
    const ds = this.add.text(-w / 2 + 54, 20, desc, { fontFamily: THEME.fontFamily, fontSize: '11px', color: THEME.textMuted }).setOrigin(0, 0.5);
    c.add([bg, ico, tag, nm, ds]);
    this.tweens.add({
      targets: c, y: 100, duration: 220, ease: 'Cubic.out',
      onComplete: () => {
        this.time.delayedCall(2200, () => {
          this.tweens.add({
            targets: c, y: -60, duration: 220, ease: 'Cubic.in',
            onComplete: () => { c.destroy(); onDone(); },
          });
        });
      },
    });
  }

  unbind() {
    EventBus.off('__hud_score', this._onScore);
    EventBus.off(EVENTS.HP_CHANGED, this._onHp);
    EventBus.off('__hud_bombs', this._onBombs);
    EventBus.off(EVENTS.LIVES_CHANGED, this._onLives);
    EventBus.off(EVENTS.POWER_CHANGED, this._onPower);
    EventBus.off(EVENTS.WAVE_STARTED, this._onWave);
    EventBus.off(EVENTS.EVENT_TIMER, this._onEventTimer);
    EventBus.off(EVENTS.BOSS_SPAWNED, this._onBossSpawn);
    EventBus.off(EVENTS.BOSS_HP_CHANGED, this._onBossHp);
    EventBus.off(EVENTS.BOSS_DEFEATED, this._onBossDead);
    EventBus.off(EVENTS.BOSS_PHASE, this._onBossPhase);
    EventBus.off(EVENTS.ENERGY_CHANGED, this._onEnergy);
    EventBus.off(EVENTS.SHIELD_CHANGED, this._onShield);
    EventBus.off(EVENTS.MAGNET_CHANGED, this._onMagnet);
    EventBus.off(EVENTS.COMBO_CHANGED, this._onCombo);
    EventBus.off(EVENTS.ELEMENT_CHANGED, this._onElementChanged);
    EventBus.off(EVENTS.WEAPON_CHANGED, this._onWeapon);
    EventBus.off(EVENTS.GRAZE_CHANGED, this._onGraze);
    EventBus.off(EVENTS.SKILL_SWITCHED, this._onSkillSwitched);
    EventBus.off(EVENTS.OVERDRIVE_STATE, this._onOverdriveState);
    EventBus.off(EVENTS.ACHIEVEMENT_UNLOCKED, this._onAchUnlock);
    EventBus.off(EVENTS.WINGMAN_STATUS, this._onWmStatus);
    EventBus.off(EVENTS.OVERCHARGE_STATE, this._onOverchargeState);
  }
}
