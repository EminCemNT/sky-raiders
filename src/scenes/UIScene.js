import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, EVENTS, LEVELS, SHIPS, WINGMAN, PLAYER, EVENT_MODES, OVERCHARGE, PERFORMANCE, EASE, COMBO_BURST, PAUSE_ATMO, MAGIC } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';
import { t } from '../config/Locale.js';
import { audio } from '../systems/AudioSystem.js';
import { transition } from '../systems/TransitionManager.js';
import { NeonBar, NeonButton, makeIconButton, THEME } from '../utils/UIWidgets.js';
import { SKILLS, DEFAULT_SKILL } from '../config/Skills.js';
import { applyFilmLayer } from '../utils/FilmFX.js';

const PREFERS_REDUCED = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// OPT-16 T5：武器 id → Locale 词条 key（zh 值 = WEAPONS[].short，en 由 Locale 提供）
const WEAPON_NAME_KEY = { pulse: 'weapon_pulse', missile: 'weapon_missile', laser: 'weapon_laser', bomb: 'weapon_bomb' };

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
    this.livesText = this.add.text(HUD_RIGHT, MAGIC.hudLivesY, t('hud_lives', { n: d.lives != null ? d.lives : PLAYER.START_LIVES }), {
      fontFamily: THEME.fontFamily, fontSize: '15px', fontStyle: '700', color: THEME.textSuccess,
    }).setOrigin(1, 0).setDepth(100);

    // 局内火力(P)等级指示（P1：拾取 P +1 / 受击 -1，右上角，金色）
    this.powerText = this.add.text(HUD_RIGHT, MAGIC.hudPowerY, t('hud_power', { n: 0 }), {
      fontFamily: THEME.fontFamily, fontSize: '15px', fontStyle: '700', color: THEME.textGold,
    }).setOrigin(1, 0).setDepth(100);

    // 玩家元素指示（元素核心轮换用，最小指示：右上角一行彩色文字，无元素时隐藏）
    this.elementText = this.add.text(HUD_RIGHT, MAGIC.hudElementY, '', {
      fontFamily: THEME.fontFamily, fontSize: '14px', fontStyle: '700', color: THEME.textCyan,
    }).setOrigin(1, 0).setDepth(100).setVisible(false);

    // 擦弹计数（P2）：右侧信息列追加一行，监听 GRAZE_CHANGED
    this.grazeText = this.add.text(HUD_RIGHT, MAGIC.hudGrazeY, t('hud_graze', { n: 0 }), {
      fontFamily: THEME.fontFamily, fontSize: '14px', fontStyle: '700', color: THEME.textCyan,
    }).setOrigin(1, 0).setDepth(100);

    // HP 条（圆角发光）
    this.hpBar = new NeonBar(this, 16, 64, 180, 14, { color: 0x33dd88 });
    this.hpText = this.add.text(MAGIC.hudEnergyX, 64, '', {
      fontFamily: THEME.fontFamily, fontSize: '13px', color: THEME.textMuted,
    }).setOrigin(0, 0.5).setDepth(101);

    // 能量槽（0~100%，充满高亮）
    this.energyBar = new NeonBar(this, 16, 86, 180, 12, { color: 0xb98bff });
    this.energyText = this.add.text(MAGIC.hudEnergyX, 86, t('hud_energy', { n: 0 }), {
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
      duration: 1100, yoyo: true, repeat: -1, ease: EASE.breathe,
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

    // B11 连击蓄力爆发 HUD：右下角「蓄力」按钮（技能切换钮左侧，避开炸弹/技能/切换钮）。
    // 规格：三档 combo≥10/15/20 → gauge 1/2/3；未达标置灰；按钮按下发 USE_BURST（键盘 C 在 GameScene 已绑）。
    this.burstBtn = makeIconButton(this, GAME_WIDTH - 292, GAME_HEIGHT - 72, 'item_burst', {
      radius: 34, label: t('chargeBtn'), count: 'x0', ringAlpha: 0,
      onDown: () => { audio.sfx('ui'); EventBus.emit(EVENTS.USE_BURST); },
    });
    this.burstBtn.container.setAlpha(0.45);   // 初始无连击 → 置灰
    this._burstGauge = 0;                      // 当前可触发档位（0/1/2/3，GameScene.getBurstGauge 语义）
    this._burstCombo = 0;                      // 当前连击（只读展示，不直接操作 GameScene）

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
    this.weaponText = this.add.text(16, 124, t('hud_weaponMain', { w: t('weapon_pulse') }), {
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
      duration: 900, yoyo: true, repeat: -1, ease: EASE.breathe,
    });

    // 暂停遮罩（默认隐藏）
    this._paused = false;
    this.pauseOverlay = this.add.container(0, 0).setDepth(200).setVisible(false);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.62).setOrigin(0);
    const pTitle = this.add.text(GAME_WIDTH / 2, 300, t('uiPaused'), {
      fontFamily: THEME.fontFamily, fontSize: '46px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 16, true, true);
    const resumeBtn = this.makePauseButton(GAME_WIDTH / 2, 440, t('uiResume'), () => this.togglePause());
    // OPT-16 C6 暂停面板「重开本局」：放「继续」下方、quit 上方（y485），二次确认后同参数重进（主动放弃，不结算/不计数）
    const restartBtn = this.makePauseButton(GAME_WIDTH / 2, 485, t('uiRestart'), () => this._confirmRestart());
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
    this.pauseOverlay.add([dim, pTitle, resumeBtn, restartBtn, quitBtn, hbBtn.container]);

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

    // 画质精修三件·B：常驻暗角 + 胶片颗粒（电影感；纯视觉零业务，深度低于 HUD）
    this._buildFilmLayers();

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

    // OPT-15 V7：暂停氛围只读测试钩子（QA 探针：暂停/恢复的 alpha 与呼吸状态；不影响玩法）
    if (typeof window !== 'undefined') Object.defineProperty(window, '__PAUSE', {
      configurable: true,
      get: () => this._pauseAtmo ? {
        paused: this._paused, fogAlpha: this._pauseAtmo.fog.alpha,
        glowAlpha: this._pauseAtmo.glow.alpha, pulsing: !!this._pauseTweens,
      } : { paused: this._paused, fogAlpha: 0, glowAlpha: 0, pulsing: false },
    });
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
      this.tweens.add({ targets: cont, scale: 1, alpha: 1, duration: 420, ease: EASE.pop });
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
      let txt = t('wingmanStatus', { l: s.weaponLv, count: s.count, mul: s.comboMul ? s.comboMul.toFixed(2) : '1.00' });
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

  /** B11 档位名：按 tier.kind 映射 i18n 词条（power→chargePower / clear→chargeClear / energy→chargeEnergy），
   *  缺失词条时回退 tiers.desc（防未来新增档位裸 key 泄漏；zh/en 下三词条均生效） */
  _burstTierName(tt) {
    if (!tt) return '';
    const key = tt.kind ? `charge${tt.kind.charAt(0).toUpperCase()}${tt.kind.slice(1)}` : '';
    const localized = key ? t(key) : '';
    return (localized && localized !== key) ? localized : (tt.desc || '');
  }

  /** 渲染玩家元素指示（元素核心轮换用）：无元素隐藏，有元素显示彩色「元素 · X」 */
  _renderElement(el) {
    if (!this.elementText) return;
    const INFO = { fire: [t('elemFire'), '#ff7a3a'], ice: [t('elemIce'), '#6fd6ff'], thunder: [t('elemThunder'), '#ffe14a'] };    if (el && INFO[el]) {
      this.elementText.setText(t('hud_element', { e: INFO[el][0] })).setColor(INFO[el][1]).setVisible(true);
    } else {
      this.elementText.setVisible(false);
    }
  }

  togglePause() {
    if (this._paused) {
      // OPT-15 V7：恢复即清（kill 两条呼吸 tween + 复位 alpha）
      this._stopPausePulse();
      this.scene.resume(SCENES.GAME);
      audio.resumeBgm();
      this._paused = false;
      this.pauseOverlay.setVisible(false);
    } else {
      // OPT-15 V7：暂停叠加氛围层（暗角加深 + 标题辉光；reduced/low 静态不呼吸）
      this._ensurePauseAtmosphere();
      this._startPausePulse();
      this.scene.pause(SCENES.GAME);
      audio.pauseBgm();
      this._paused = true;
      this.pauseOverlay.setVisible(true);
    }
  }

  // ---- OPT-16 C6 暂停面板「重开本局」：二次确认 → 同参数重进 GameScene ----

  /** C6 弹「重开本局」二次确认（静态面板 + 确定/取消；reduced-motion N/A） */
  _confirmRestart() {
    if (this._restartConfirm) return; // 已打开防重复叠层
    if (transition.ready && transition._busy) return; // 过渡中不叠加（与 quit 一致）
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const ov = this.add.container(0, 0).setDepth(260);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.68).setOrigin(0).setInteractive();
    const panel = this.add.rectangle(cx, cy, 400, 190, 0x0a1a2e, 0.98)
      .setStrokeStyle(2, THEME.titleColor, 0.9);
    const title = this.add.text(cx, cy - 60, t('restartConfirmTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '26px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 8, true, true);
    const desc = this.add.text(cx, cy - 8, t('restartConfirmDesc'), {
      fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textPrimary, align: 'center', wordWrap: { width: 340 },
    }).setOrigin(0.5);
    const okBtn = new NeonButton(this, cx - 88, cy + 54, t('uiRestart'), {
      w: 150, h: 44, fontSize: 15, glow: true, onDown: () => this._doRestart(),
    });
    const cancelBtn = new NeonButton(this, cx + 88, cy + 54, t('restartCancel'), {
      w: 150, h: 44, fontSize: 15, onDown: () => this._closeRestartConfirm(),
    });
    ov.add([dim, panel, title, desc, okBtn.container, cancelBtn.container]);
    dim.on('pointerdown', () => this._closeRestartConfirm()); // 点遮罩 = 取消
    this._restartConfirm = ov;
  }

  /** C6 关闭二次确认弹窗 */
  _closeRestartConfirm() {
    if (this._restartConfirm) { this._restartConfirm.destroy(); this._restartConfirm = null; }
  }

  /** C6 执行重开：读 GameScene.getRunParams() → 复位暂停态 → 同参数重进（等同 Quit 后手动 Start，一次点击） */
  _doRestart() {
    if (transition.ready && transition._busy) { this._closeRestartConfirm(); return; }
    const g = this.scene.get(SCENES.GAME);
    if (!g || typeof g.getRunParams !== 'function') { this._closeRestartConfirm(); return; } // 防御：无 GameScene 静默返回
    const params = g.getRunParams();
    this._closeRestartConfirm();
    this._stopPausePulse();
    this._paused = false;
    this.pauseOverlay.setVisible(false);
    this.scene.resume(SCENES.GAME);
    // 淡出后停旧 GAME/UI，再以同参数启动新 GameScene（重开为主动放弃：不进 endGame → 不计 failStreak/不写结算）
    transition.goto(this, SCENES.GAME, params, {
      beforeStart: () => {
        this.scene.stop(SCENES.GAME);
        this.scene.stop(SCENES.UI);
      },
    });
  }

  /**
   * OPT-15 V7：懒创建暂停氛围层（fog 暗角 + glow 标题辉光）。
   * vignette-perm 由 _buildFilmLayers → FilmFX.ensureVignetteTexture 首次生成；
   * 暂停面板创建早于 film 层 → 首次暂停必然晚于 create，纹理必已存在；仍兜底生成防极端时序。
   * fog/glow 插在 pauseOverlay 内：dim(0) 之上、标题之下（fog=1 / glow=2）。
   */
  _ensurePauseAtmosphere() {
    if (this._pauseAtmo) return;
    if (!this.textures.exists('vignette-perm')) {
      const W = GAME_WIDTH, H = GAME_HEIGHT;
      const ct = this.textures.createCanvas('vignette-perm', W, H);
      const ctx = ct.getContext();
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.62, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.95)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ct.refresh();
    }
    const fog = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'vignette-perm')
      .setAlpha(PAUSE_ATMO.fogAlpha);
    const glow = this.add.image(GAME_WIDTH / 2, 300, 'glow_soft')
      .setAlpha(PAUSE_ATMO.glowAlpha).setTint(THEME.titleColor)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(PAUSE_ATMO.glowScale);
    this.pauseOverlay.add([fog, glow]);
    // 顺序：index 0=dim 平遮罩，1=fog 暗角（叠在 dim 之上加深边缘），2=glow（在标题 pTitle 之前=其下）
    this.pauseOverlay.moveTo(fog, 1);
    this.pauseOverlay.moveTo(glow, 2);
    this._pauseAtmo = { fog, glow, baseFog: PAUSE_ATMO.fogAlpha, baseGlow: PAUSE_ATMO.glowAlpha };
  }

  /** OPT-15 V7：暂停氛围呼吸（两条 tween；reduced-motion 或 low 档静态不呼吸，仍叠加氛围） */
  _startPausePulse() {
    if (!this._pauseAtmo) return;
    if (PREFERS_REDUCED) return;
    // low 档（qualityScale < 0.6）静态不呼吸（规格降级矩阵：high/mid 呼吸，low/reduced 静态）
    if ((this.qualityScale ?? 1) < PAUSE_ATMO.minQuality) return;
    const { fog, glow } = this._pauseAtmo;
    this._pauseTweens = [
      this.tweens.add({ targets: fog, alpha: this._pauseAtmo.baseFog + PAUSE_ATMO.fogPulse,
        duration: PAUSE_ATMO.fogMs, yoyo: true, repeat: -1, ease: EASE.breathe }),
      this.tweens.add({ targets: glow, alpha: this._pauseAtmo.baseGlow + PAUSE_ATMO.glowPulse,
        duration: PAUSE_ATMO.glowMs, yoyo: true, repeat: -1, ease: EASE.breathe }),
    ];
  }

  /** OPT-15 V7：恢复即清——kill 两条呼吸 tween + alpha 复位回 base */
  _stopPausePulse() {
    if (this._pauseTweens) { this._pauseTweens.forEach((tw) => tw && tw.stop()); this._pauseTweens = null; }
    if (this._pauseAtmo) {
      this._pauseAtmo.fog.setAlpha(this._pauseAtmo.baseFog);
      this._pauseAtmo.glow.setAlpha(this._pauseAtmo.baseGlow);
    }
  }

  quitToMenu() {
    // P3-13：过渡 busy 时先不 resume(GAME)——若 goto 返回 busy，resume 已执行而游戏未切走会造成竞态。
    // 先判定可用性，busy 时直接丢弃本次操作（UI 仍处于暂停态，不会恢复战斗）。
    if (transition.ready && transition._busy) return;
    this.scene.resume(SCENES.GAME);
    // P2 视觉四件套⑦：带过渡回菜单；淡出完成后先停并行战斗场景（与旧行为一致），再切 Menu
    transition.goto(this, SCENES.MENU, undefined, {
      beforeStart: () => {
        this.scene.stop(SCENES.GAME);
        this.scene.stop(SCENES.UI);
      },
    });
  }

  bindEvents() {
    // 场景重启时复位横幅队列，避免上局残留队列导致横幅卡死/重复
    this._achShowing = false;
    this._achQueue = [];

    this._onScore = (s) => { if (this.scoreText) this.scoreText.setText(String(s).padStart(6, '0')); };
    EventBus.on(EVENTS.HUD_SCORE, this._onScore);

    this._onHp = (hp, max) => this.updateHp(hp, max);
    EventBus.on(EVENTS.HP_CHANGED, this._onHp);

    this._onBombs = (n) => {
      this.bombs = n;
      if (this.bombIcon && this.bombIcon.count) this.bombIcon.count.setText(`x${n}`);
    };
    EventBus.on(EVENTS.HUD_BOMBS, this._onBombs);

    this._onLives = (n) => {
      if (this.livesText) this.livesText.setText(t('hud_lives', { n }));
    };
    EventBus.on(EVENTS.LIVES_CHANGED, this._onLives);

    this._onPower = (n) => {
      if (this.powerText) this.powerText.setText(t('hud_power', { n }));
    };
    EventBus.on(EVENTS.POWER_CHANGED, this._onPower);

    this._onWave = ({ wave, total, endless }) => {
      if (this._eventMode) return; // 活动模式：波次文本由 EVENT_TIMER 倒计时接管
      if (this.waveText) this.waveText.setText(endless ? t('hudWaveEndless', { wave }) : t('hudWaveTotal', { wave, total }));
      this.flashCenter(t('hudWave', { wave }));
    };
    EventBus.on(EVENTS.WAVE_STARTED, this._onWave);

    // OPT-15 V3：波次清空 HUD 微反馈（波次文字脉冲；reduced-motion 不脉冲，纯静态）
    this._onWaveClearUi = () => {
      if (PREFERS_REDUCED || !this.waveText || !this.waveText.active) return;
      this.tweens.killTweensOf(this.waveText);
      this.waveText.setScale(1);
      this.tweens.add({ targets: this.waveText, scale: 1.12, duration: 140, yoyo: true, ease: EASE.feedback });
    };
    EventBus.on(EVENTS.WAVE_CLEARED, this._onWaveClearUi);

    // P0 留存-活动轮换：倒计时显示（金币冲刺/限时生存），接管 waveText
    this._onEventTimer = (e) => {
      if (!e) return;
      const evtName = (t(`eventName_${this.mode}`) !== `eventName_${this.mode}`) ? t(`eventName_${this.mode}`) : (e.name || '');
      if (this.waveText) this.waveText.setText(`${evtName} ${e.left}s`);
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

    // A8 无尽变异：横幅（负面先警示）+ 顶部状态徽章（纯视觉，无业务逻辑）
    this._onMutation = (payload) => {
      if (!payload) return;
      if (payload.type === 'warning') {
        this.flashCenter(payload.label || t('mutWarning'), THEME.textRed);
      } else if (payload.type === 'applied') {
        const label = t(`mut_${payload.id}`) !== `mut_${payload.id}` ? t(`mut_${payload.id}`) : (payload.name || '');
        this.flashCenter(label, payload.polarity === 'negative' ? THEME.textRed : THEME.textGold);
        this._addMutationBadge(label, payload.polarity === 'negative');
      }
    };
    EventBus.on(EVENTS.MUTATION_CHANGED, this._onMutation);

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
      this.comboText.setText(t('hudCombo', { combo, mult: (mult || 1).toFixed(1) }));
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
          targets: this.comboText, scale: 1.0, duration: 180, ease: EASE.pop,
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
        const wName = t(WEAPON_NAME_KEY[w] || 'weaponFallback');
        this.weaponText.setText(w === 'pulse'
          ? t('hud_weaponMain', { w: wName })
          : (isPerm ? t('hud_weapon', { w: wName }) : t('hud_weaponCount', { w: wName, n: Math.ceil(dur / 1000) })));
      }
    };
    EventBus.on(EVENTS.WEAPON_CHANGED, this._onWeapon);

    // P2 擦弹计数：右上角「擦弹 N」（payload = { count, chain }）
    this._onGraze = (p) => {
      if (this.grazeText) this.grazeText.setText(t('hud_graze', { n: (p && p.count) || 0 }));
    };
    EventBus.on(EVENTS.GRAZE_CHANGED, this._onGraze);

    // P2 技能切换：按钮标签显示当前技能名（星风暴/过载）。
    // 仅响应带 payload 的状态广播（无 payload 的 Q/箭头指令由 GameScene 轮换后再广播）。
    this._onSkillSwitched = (id) => {
      if (!id || !SKILLS[id]) return;
      this._skillName = id;
      const def = SKILLS[id];
      const label = (t(`skill_${id}`) !== `skill_${id}`) ? t(`skill_${id}`) : (def ? def.name : id);
      if (this.skill && this.skill.label) {
        this.skill.label.setText(label).setColor(THEME.white).setFontStyle('normal');
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
          this.ocLabel.setVisible(true).setText(t('overchargePct', { n: Math.min(100, Math.round(total * 100)) })).setColor(THEME.textCyan);
          this.ocText.setVisible(true).setText(t('hudGrazeUnits', { p, g }));
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

    // B11 连击蓄力爆发：HUD 蓄力按钮状态（gauge=0 置灰 / ≥1 高亮 + 档位计数；reduced-motion 静态高亮）
    this._onBurstChanged = (combo, gauge) => {
      if (!this.burstBtn) return;
      this._burstCombo = combo || 0;
      this._burstGauge = gauge || 0;
      const c = this._burstCombo, g = this._burstGauge;
      if (this.burstBtn.count) this.burstBtn.count.setText(`x${c}`);
      const tiers = (COMBO_BURST && COMBO_BURST.tiers) || [];
      if (g >= 1) {
        this.burstBtn.container.setAlpha(1);
        this.burstBtn.icon.setTint(0x7cf3ff);
        const names = tiers.filter((tt) => c >= (tt.needCombo || 999)).map((tt) => this._burstTierName(tt)).join('+');
        this.burstBtn.label.setText(names ? `${t('chargeBtn')} · ${names}` : t('chargeBtn')).setColor(THEME.textGold);
        if (PREFERS_REDUCED) {
          this.burstBtn.ring.setAlpha(0.5).setScale(1);
        } else {
          this.tweens.killTweensOf(this.burstBtn.ring);
          this.burstBtn.ring.setAlpha(0.35).setScale(1);
          this.tweens.add({
            targets: this.burstBtn.ring, alpha: { from: 0.35, to: 0.9 }, scale: { from: 0.94, to: 1.1 },
            duration: 640, yoyo: true, repeat: -1,
          });
        }
      } else {
        this.burstBtn.container.setAlpha(0.45);
        this.burstBtn.icon.clearTint();
        this.tweens.killTweensOf(this.burstBtn.ring);
        this.burstBtn.ring.setAlpha(0).setScale(1);
        if (c > 0 && tiers.length) {
          const nextT = tiers.find((tt) => c < (tt.needCombo || 999)) || tiers[0];
          this.burstBtn.label.setText(t('chargeNeed', { n: Math.max(0, (nextT.needCombo || 0) - c) })).setColor(THEME.textMuted);
        } else {
          this.burstBtn.label.setText(t('chargeBtn')).setColor(THEME.white);
        }
      }
    };
    EventBus.on(EVENTS.BURST_CHANGED, this._onBurstChanged);

    // B11 连击蓄力激活：中央飘字 + 按钮闪光（reduced-motion 静态提示）
    this._onBurstActivated = (p) => {
      if (!p || !this.burstBtn) return;
      const c = p.combo || 0;
      const names = ((COMBO_BURST && COMBO_BURST.tiers) || [])
        .filter((tt) => c >= (tt.needCombo || 999))
        .map((tt) => this._burstTierName(tt)).join('+');
      this.flashCenter(names ? `${t('chargeBurst')} · ${names}` : t('chargeBurst'), THEME.textGold);
      if (!PREFERS_REDUCED) {
        this.tweens.killTweensOf(this.burstBtn.ring);
        this.burstBtn.ring.setAlpha(1);
        this.tweens.add({ targets: this.burstBtn.ring, alpha: 0, scale: 1.4, duration: 340, ease: EASE.enter });
      }
    };
    EventBus.on(EVENTS.BURST_ACTIVATED, this._onBurstActivated);

    // D3 P3 修复：存档降级（隐私模式/超配额）一次性提示——SaveManager 已保证 SAVE_FAILED 仅首败 emit
    this._onSaveFailed = () => { this.flashCenter(t('saveFailed'), THEME.textRed); };
    EventBus.on(EVENTS.SAVE_FAILED, this._onSaveFailed);
  }

  update() {
    // （胶片颗粒逐帧抖动已由 FilmFX.applyFilmLayer 的 update 监听接管：战斗动态 / 静态场景居中 / reduced 静态）
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
        this.skill.label.setText(t('overdriveS', { n: left })).setColor(THEME.textGold).setFontStyle('700');
      } else if (this._skillName) {
        const def = SKILLS[this._skillName] || SKILLS[DEFAULT_SKILL];
        const sk = this._skillName;
        const label = (t(`skill_${sk}`) !== `skill_${sk}`) ? t(`skill_${sk}`) : (def ? def.name : sk);
        this.skill.label.setText(label).setColor(THEME.white).setFontStyle('normal');
      }
    }
    if (this._weaponName && this._weaponName !== 'pulse' && this.weaponText && this._weaponUntilTime > 0) {
      const wName = t(WEAPON_NAME_KEY[this._weaponName] || 'weaponFallback');
      const left = Math.max(0, Math.ceil((this._weaponUntilTime - this.time.now) / 1000));
      this.weaponText.setText(t('hud_weaponCount', { w: wName, n: left }));
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
    if (this.energyText) this.energyText.setText(t('hud_energy', { n: Math.round(ratio * 100) }));
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

  /** OPT-14 A3：常驻暗角 + 胶片颗粒（战斗档动态颗粒；抽 FilmFX.applyFilmLayer 复用，四场景统一）。
   *  测试钩子兼容：this._permVignette / this._filmGrain / this._filmGrainQuality（原探针口径保留）。 */
  _buildFilmLayers() {
    const quality = (SaveManager.load().quality) || PERFORMANCE.defaultTier;
    this._filmGrainQuality = quality;
    // OPT-15 V7：缓存画质档系数（high 1.0 / mid 0.7 / low 0.45），供暂停氛围 low 档静态判定
    this.qualityScale = (PERFORMANCE.scale && PERFORMANCE.scale[quality]) || 1;
    this._filmCtl = applyFilmLayer(this, { key: 'combat', grainSpeed: true });
    if (this._filmCtl) {
      this._permVignette = this._filmCtl.vignette;
      this._filmGrain = this._filmCtl.grain;
    }
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

  /** A8 无尽变异：顶部状态徽章（右上角堆叠，纯视觉；负面红 / 正面金） */
  _addMutationBadge(label, negative) {
    if (!label) return;
    if (!this._mutBadges) this._mutBadges = [];
    const idx = this._mutBadges.length;
    const y = 150 + idx * 22;
    const txt = this.add.text(GAME_WIDTH - 10, y, `◆ ${label}`, {
      fontFamily: THEME.fontFamily, fontSize: '13px', fontStyle: '800',
      color: negative ? THEME.textRed : THEME.textGold,
    }).setOrigin(1, 0.5).setDepth(130).setShadow(0, 0, '#000000', 6, true, true);
    this._mutBadges.push(txt);
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
      targets: c, y: 100, duration: 220, ease: EASE.enter,
      onComplete: () => {
        this.time.delayedCall(2200, () => {
          this.tweens.add({
            targets: c, y: -60, duration: 220, ease: EASE.exit,
            onComplete: () => { c.destroy(); onDone(); },
          });
        });
      },
    });
  }

  unbind() {
    EventBus.off(EVENTS.HUD_SCORE, this._onScore);
    EventBus.off(EVENTS.HP_CHANGED, this._onHp);
    EventBus.off(EVENTS.HUD_BOMBS, this._onBombs);
    EventBus.off(EVENTS.LIVES_CHANGED, this._onLives);
    EventBus.off(EVENTS.POWER_CHANGED, this._onPower);
    EventBus.off(EVENTS.WAVE_STARTED, this._onWave);
    EventBus.off(EVENTS.WAVE_CLEARED, this._onWaveClearUi);
    EventBus.off(EVENTS.EVENT_TIMER, this._onEventTimer);
    EventBus.off(EVENTS.BOSS_SPAWNED, this._onBossSpawn);
    EventBus.off(EVENTS.BOSS_HP_CHANGED, this._onBossHp);
    EventBus.off(EVENTS.BOSS_DEFEATED, this._onBossDead);
    EventBus.off(EVENTS.BOSS_PHASE, this._onBossPhase);
    EventBus.off(EVENTS.MUTATION_CHANGED, this._onMutation);
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
    EventBus.off(EVENTS.BURST_CHANGED, this._onBurstChanged);
    EventBus.off(EVENTS.BURST_ACTIVATED, this._onBurstActivated);
    EventBus.off(EVENTS.SAVE_FAILED, this._onSaveFailed);
  }
}
