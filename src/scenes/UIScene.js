import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, EVENTS, LEVELS, WEAPONS, SHIPS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { audio } from '../systems/AudioSystem.js';
import { NeonBar, NeonButton, makeIconButton, THEME } from '../utils/UIWidgets.js';

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
    this.pauseOverlay.add([dim, pTitle, resumeBtn, quitBtn]);

    // 键盘暂停（P / ESC）
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-ESC', () => this.togglePause());

    this.bindEvents();
    this.events.once('shutdown', () => this.unbind());

    // 初始化状态
    this.updateHp(d.hp || 100, d.maxHp || 100);
    this.updateEnergy(d.energy || 0, 100);
  }

  makePauseButton(x, y, label, cb) {
    return new NeonButton(this, x, y, label, { onDown: cb }).container;
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
      if (combo <= 1) return;
      // 居中大字号连击（每次连击变化弹一次，缩放弹入 1.3→1.0 + 渐隐，A6）
      const size = Phaser.Math.Clamp(44 + Math.floor((combo - 1) / 5) * 2, 44, 60);
      const color = combo >= 40 ? '#ff5566' : combo >= 20 ? '#ffd54a' : '#7cf3ff';
      const t = this.add.text(GAME_WIDTH / 2, 150, `连击 ×${combo}\n×${mult.toFixed(1)}`, {
        fontFamily: 'sans-serif', fontSize: `${size}px`, fontStyle: '800', color, align: 'center',
      }).setOrigin(0.5).setDepth(120).setScale(1.3).setAlpha(1)
        .setShadow(0, 0, '#000000', 8, true, true);
      this.tweens.add({
        targets: t, scale: 1.0, alpha: 0, duration: 900, ease: 'Cubic.out',
        onComplete: () => t.destroy(),
      });
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

  unbind() {
    EventBus.off('__hud_score', this._onScore);
    EventBus.off(EVENTS.HP_CHANGED, this._onHp);
    EventBus.off('__hud_bombs', this._onBombs);
    EventBus.off(EVENTS.WAVE_STARTED, this._onWave);
    EventBus.off(EVENTS.BOSS_SPAWNED, this._onBossSpawn);
    EventBus.off(EVENTS.BOSS_HP_CHANGED, this._onBossHp);
    EventBus.off(EVENTS.BOSS_DEFEATED, this._onBossDead);
    EventBus.off(EVENTS.ENERGY_CHANGED, this._onEnergy);
    EventBus.off(EVENTS.SHIELD_CHANGED, this._onShield);
    EventBus.off(EVENTS.MAGNET_CHANGED, this._onMagnet);
    EventBus.off(EVENTS.COMBO_CHANGED, this._onCombo);
    EventBus.off(EVENTS.WEAPON_CHANGED, this._onWeapon);
  }
}
