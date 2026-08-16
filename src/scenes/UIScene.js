import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, EVENTS, LEVELS, WEAPONS, SHIPS, WINGMAN } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { SaveManager } from '../utils/SaveManager.js';
import { audio } from '../systems/AudioSystem.js';
import { NeonBar, NeonButton, makeIconButton, THEME } from '../utils/UIWidgets.js';

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
  }

  create() {
    const d = this.hudData;

    // 分数（带霓虹投影）
    this.scoreText = this.add.text(16, 14, '0', {
      fontFamily: 'sans-serif', fontSize: '28px', fontStyle: '800', color: '#ffffff',
    }).setDepth(100).setShadow(0, 0, '#2a86c0', 10, true, true);

    // 关卡名 / Boss Rush 标签
    const lvl = LEVELS.find((l) => l.id === d.levelId) || LEVELS[0];
    const levelLabel = this.mode === 'bossrush' ? 'BOSS RUSH' : `第 ${lvl.id} 关 · ${lvl.name}`;
    this.add.text(GAME_WIDTH - 16, 18, levelLabel, {
      fontFamily: 'sans-serif', fontSize: '15px', fontStyle: '700', color: '#7cf3ff',
    }).setOrigin(1, 0).setDepth(100);

    // 波次提示
    this.waveText = this.add.text(GAME_WIDTH - 16, 42, '', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#88bbdd',
    }).setOrigin(1, 0).setDepth(100);

    // HP 条（圆角发光）
    this.hpBar = new NeonBar(this, 16, 64, 180, 14, { color: 0x33dd88 });
    this.hpText = this.add.text(204, 64, '', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#aaccdd',
    }).setOrigin(0, 0.5).setDepth(101);

    // 能量槽（0~100%，充满高亮）
    this.energyBar = new NeonBar(this, 16, 86, 180, 12, { color: 0xb98bff });
    this.energyText = this.add.text(204, 86, '能量 0%', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#c9a6ff',
    }).setOrigin(0, 0.5).setDepth(101);

    // Boss 血条（居中，默认隐藏）
    this.bossBar = new NeonBar(
      this, GAME_WIDTH / 2 - (GAME_WIDTH - 84) / 2, 84, GAME_WIDTH - 84, 12,
      { color: 0xff3355, bgColor: 0x330011, borderColor: 0xcc4466 },
    );
    this.bossBar.setVisible(false);

    // 炸弹按钮（右下角图标化）
    this.bombs = d.bombs || 0;
    this.bombIcon = makeIconButton(this, GAME_WIDTH - 62, GAME_HEIGHT - 72, 'item_bomb', {
      radius: 40, count: `x${this.bombs}`,
      onDown: () => { audio.sfx('ui'); EventBus.emit(EVENTS.USE_BOMB); },
    });

    // 技能按钮（右下角图标化，能量满时发光脉冲）
    this.skill = makeIconButton(this, GAME_WIDTH - 156, GAME_HEIGHT - 72, 'item_energy', {
      radius: 40, ringAlpha: 0,
      onDown: () => { audio.sfx('ui'); EventBus.emit(EVENTS.USE_SUPER); },
    });
    this.skill.container.setAlpha(0.45);
    this.skillReady = false;

    // 增益徽标（护盾/磁力）
    this.shieldBadge = this.add.text(16, 104, '', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#3ad1ff',
    }).setDepth(101);
    this.magnetBadge = this.add.text(96, 104, '', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#ff4d6d',
    }).setDepth(101);

    // 武器指示器（B/C 武器系统）
    this._weaponName = 'pulse';
    this._weaponUntilTime = 0;
    this.weaponText = this.add.text(16, 124, '主炮 · 脉冲', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#9ff0ff',
    }).setDepth(101);

    // 僚机状态指示（第三版起步）：数量 / 元素 / 武器等级 / 重生倒计时
    this._buildWingmanHud();

    this.skillKey = this.input.keyboard.addKey('F');

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
    pg.fillStyle(0x123a5a, 0.9); pg.fillRoundedRect(-ph, -ph, ps, ps, 8);
    pg.lineStyle(2, THEME.pauseBtn.glow, 0.9); pg.strokeRoundedRect(-ph, -ph, ps, ps, 8);
    const barW = Math.max(4, ps * 0.16), barH = ps * 0.42, off = ps * 0.13;
    pg.fillStyle(0xffffff, 1);
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
    const pTitle = this.add.text(GAME_WIDTH / 2, 300, '已暂停', {
      fontFamily: 'sans-serif', fontSize: '46px', fontStyle: '800', color: '#7cf3ff',
    }).setOrigin(0.5).setShadow(0, 0, '#2a86c0', 16, true, true);
    const resumeBtn = this.makePauseButton(GAME_WIDTH / 2, 440, '继续', () => this.togglePause());
    const quitBtn = this.makePauseButton(GAME_WIDTH / 2, 530, '退出到菜单', () => this.quitToMenu());
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

    // 连击 HUD（常驻，复用不重建）：击杀连击计数，脉冲缩放 + 档位变色（D）
    // y≈150 顶部区域，不挡玩家判定区（约 y≈860）；初始隐藏，COMBO_CHANGED 触发显隐
    this.comboText = this.add.text(GAME_WIDTH / 2, 150, '', {
      fontFamily: 'sans-serif', fontSize: '42px', fontStyle: '800', color: '#7cf3ff', align: 'center',
    }).setOrigin(0.5).setDepth(120).setShadow(0, 0, '#000000', 8, true, true).setVisible(false);
    this._lastComboPulse = 0;     // 连击脉冲频控（120ms）

    this.bindEvents();
    this.events.once('shutdown', () => this.unbind());

    // 初始化状态
    this.updateHp(d.hp || 100, d.maxHp || 100);
    this.updateEnergy(d.energy || 0, 100);
  }

  makePauseButton(x, y, label, cb) {
    return new NeonButton(this, x, y, label, { onDown: cb }).container;
  }

  // ---- 僚机状态指示（第三版起步）----
  // 预建 WINGMAN.MAX 个小圆 + 倒计时文本（初始隐藏），收到 WINGMAN_STATUS 后按快照更新。
  _buildWingmanHud() {
    const WM_COLORS = { fire: 0xff6633, ice: 0x33ccff, thunder: 0xffe14a };
    this._wmColors = WM_COLORS;
    this.wmTitle = this.add.text(16, 146, '僚机', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#9ff0ff',
    }).setDepth(101).setVisible(false);
    this.wmCountText = this.add.text(16, 164, '', {
      fontFamily: 'sans-serif', fontSize: '11px', color: '#aaccdd',
    }).setDepth(101).setVisible(false);
    this.wmDots = [];
    for (let i = 0; i < WINGMAN.MAX; i++) {
      const x = 58 + i * 22, y = 152;
      const g = this.add.graphics().setDepth(101).setVisible(false);
      const cd = this.add.text(x, y, '', {
        fontFamily: 'sans-serif', fontSize: '10px', color: '#ff8888',
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
        this.wmFocus.lineStyle(2, 0xffd54a, 0.95);
        this.wmFocus.strokeCircle(fx, fy, 26);
        this.wmFocus.lineStyle(2, 0xffd54a, 0.7);
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
      if (s.focus && s.focus.active) txt += ' · 集火';
      this.wmCountText.setText(txt);
    };
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

    this._onScore = (s) => { if (this.scoreText) this.scoreText.setText(String(s)); };
    EventBus.on('__hud_score', this._onScore);

    this._onHp = (hp, max) => this.updateHp(hp, max);
    EventBus.on(EVENTS.HP_CHANGED, this._onHp);

    this._onBombs = (n) => {
      this.bombs = n;
      if (this.bombIcon && this.bombIcon.count) this.bombIcon.count.setText(`x${n}`);
    };
    EventBus.on('__hud_bombs', this._onBombs);

    this._onWave = ({ wave, total }) => {
      if (this.waveText) this.waveText.setText(`第 ${wave}/${total} 波`);
      this.flashCenter(`第 ${wave} 波`);
    };
    EventBus.on(EVENTS.WAVE_STARTED, this._onWave);

    this._onBossSpawn = (info) => {
      this.bossBar.setVisible(true);
      const name = (info && info.name) ? info.name : 'BOSS';
      this.flashCenter(`⚠ ${name} 来袭`, '#ff5566');
      if (this.waveText) this.waveText.setText('BOSS 战');
    };
    EventBus.on(EVENTS.BOSS_SPAWNED, this._onBossSpawn);

    this._onBossHp = (hp, max) => {
      this.bossBar.setRatio(Phaser.Math.Clamp(hp / max, 0, 1));
    };
    EventBus.on(EVENTS.BOSS_HP_CHANGED, this._onBossHp);

    this._onBossDead = () => { this.bossBar.setVisible(false); };
    EventBus.on(EVENTS.BOSS_DEFEATED, this._onBossDead);

    this._onBossPhase = (phase) => {
      const label = phase >= 3 ? '狂暴形态！' : `第 ${phase} 阶段`;
      this.flashCenter(label, phase >= 3 ? '#ff5566' : '#ffd54a');
    };
    EventBus.on(EVENTS.BOSS_PHASE, this._onBossPhase);

    this._onEnergy = (val, max) => this.updateEnergy(val, max);
    EventBus.on(EVENTS.ENERGY_CHANGED, this._onEnergy);

    this._onShield = (active) => {
      if (this.shieldBadge) this.shieldBadge.setText(active ? '🛡护盾' : '');
    };
    EventBus.on(EVENTS.SHIELD_CHANGED, this._onShield);

    this._onMagnet = (active) => {
      if (this.magnetBadge) this.magnetBadge.setText(active ? '🧲磁力' : '');
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
      this.comboText.setColor(combo >= 40 ? '#ff5566' : combo >= 20 ? '#ffd54a' : '#7cf3ff');
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

    // 成就系统：监听成就解锁事件，入队后顺序播放顶部横幅
    this._onAchUnlock = (def) => {
      if (!this._achQueue) this._achQueue = [];
      this._achQueue.push(def);
      if (!this._achShowing) this._nextAch();
    };
    EventBus.on(EVENTS.ACHIEVEMENT_UNLOCKED, this._onAchUnlock);

    // 僚机状态指示（第三版起步）
    EventBus.on(EVENTS.WINGMAN_STATUS, this._onWmStatus);
  }

  update() {
    if (this.skillKey && Phaser.Input.Keyboard.JustDown(this.skillKey)) {
      EventBus.emit(EVENTS.USE_SUPER);
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

  flashCenter(text, color = '#7cf3ff') {
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, text, {
      fontFamily: 'sans-serif', fontSize: '38px', fontStyle: '800', color,
    }).setOrigin(0.5).setDepth(120).setAlpha(0).setShadow(0, 0, '#000000', 8, true, true);
    this.tweens.add({
      targets: t, alpha: 1, scale: 1.2, duration: 300, yoyo: true, hold: 500,
      onComplete: () => t.destroy(),
    });
  }

  /** P1-6 判定点按钮文案：随存档开关显示 开/关 */
  _hitboxLabel() {
    return `判定点：${SaveManager.load().showHitbox ? '开' : '关'}`;
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
    const icon = def.icon || '🏅';
    const c = this.add.container(GAME_WIDTH / 2, -60).setDepth(150);
    const w = 300, h = 64;
    const bg = this.add.graphics();
    bg.fillStyle(0x0d2840, 0.96); bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.lineStyle(2, 0x7cf3ff, 1); bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    const ico = this.add.text(-w / 2 + 16, 0, icon, { fontSize: '30px' }).setOrigin(0, 0.5);
    const tag = this.add.text(-w / 2 + 54, -16, '成就解锁', { fontFamily: 'sans-serif', fontSize: '12px', color: '#ffd86b', fontStyle: '800' }).setOrigin(0, 0.5);
    const nm = this.add.text(-w / 2 + 54, 2, label, { fontFamily: 'sans-serif', fontSize: '17px', color: '#ffffff', fontStyle: '800' }).setOrigin(0, 0.5);
    const ds = this.add.text(-w / 2 + 54, 20, desc, { fontFamily: 'sans-serif', fontSize: '11px', color: '#aaccdd' }).setOrigin(0, 0.5);
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
    EventBus.off(EVENTS.WAVE_STARTED, this._onWave);
    EventBus.off(EVENTS.BOSS_SPAWNED, this._onBossSpawn);
    EventBus.off(EVENTS.BOSS_HP_CHANGED, this._onBossHp);
    EventBus.off(EVENTS.BOSS_DEFEATED, this._onBossDead);
    EventBus.off(EVENTS.BOSS_PHASE, this._onBossPhase);
    EventBus.off(EVENTS.ENERGY_CHANGED, this._onEnergy);
    EventBus.off(EVENTS.SHIELD_CHANGED, this._onShield);
    EventBus.off(EVENTS.MAGNET_CHANGED, this._onMagnet);
    EventBus.off(EVENTS.COMBO_CHANGED, this._onCombo);
    EventBus.off(EVENTS.WEAPON_CHANGED, this._onWeapon);
    EventBus.off(EVENTS.ACHIEVEMENT_UNLOCKED, this._onAchUnlock);
    EventBus.off(EVENTS.WINGMAN_STATUS, this._onWmStatus);
  }
}
