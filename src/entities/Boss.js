import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, BULLET, EVENTS, COLORS, RAGE, EASE } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';
import { audio } from '../systems/AudioSystem.js';
import * as VFX from '../systems/VFX.js';

// reduced-motion 偏好：三阶段视觉脉动降级为静态
const PREFERS_REDUCED = (typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Boss（多阶段，配置化弹幕）。
 * ---------------------------------------------------------------------------
 * 由 GameScene.spawnBoss(bossKey) 创建，bossKey 对应 LEVELS 里的 boss 配置。
 * 配置项（config）：maxHp / pattern(弹幕形态) / name / color / difficulty。
 * 弹幕形态：fan(扇形) / ring(环) / spiral(螺旋) / cross(瞄准+十字)。
 * 阶段按血量切分（>66% / >33% / 其余），阶段越高弹幕越密、越快。
 */
export default class Boss extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, bossKey, config = {}) {
    super(scene, GAME_WIDTH / 2, -120, 'boss');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(18);
    this.bossKey = bossKey;

    this.config = config;
    this.pattern = config.pattern || 'fan';
    this.color = config.color || COLORS.enemy;
    this.maxHp = config.maxHp || 3000;
    this.hp = this.maxHp;
    this.difficulty = config.difficulty || 1;
    this.bulletSpeed = BULLET.ENEMY_SPEED * 0.9 * this.difficulty;
    this.phase = 1;
    this.body.setSize(this.width * 0.7, this.height * 0.6);
    this.body.enable = true;
    this.setTint(this.color);

    // P1 UI：三阶段机身差异化（纯视觉叠加层：能量环强度 / 裂纹 / 相位 tint / 描边换色）
    // 不改弹幕/伤害/命中判定，只读 phase 做视觉表现。
    this.fxG = scene.add.graphics().setDepth(this.depth + 1);
    this._crackPaths = [];
    this._syncPhaseVisuals();

    // P1 战斗扩展·可破坏护盾部位：独立小对象（跟随 Boss 移动，受弹 hit 判定独立，
    // 不触发 Boss 阶段）。config.shieldHp 0 = 无盾（如 sentinel）；盾破后 3s 无盾 +
    // 弹幕增强（更密 + 全弹幕朝玩家）。
    this.shieldPart = null;
    this._shieldPartHp = 0;
    this._shieldPartMaxHp = 0;
    this._shieldBroken = false;
    this._shieldBrokenUntil = 0;
    const shieldHp = Number(config.shieldHp) || 0;
    if (shieldHp > 0) {
      this._shieldPartHp = shieldHp;
      this._shieldPartMaxHp = shieldHp;
      this.shieldPart = scene.add.image(this.x, this.y, 'boss_shield')
        .setDepth(this.depth + 2)
        .setTint(this.color);
      this._syncShieldPart();
    }

    this._entering = true;
    this._t = 0;
    this._lastFire = 0;
    this._dir = 1;
    this._spiralAng = 0;
    // P2 体验细节·慢放子弹时间：血线首次降至 50% / 25% 触发（每血线只触发一次）
    this._slowAt50 = false;
    this._slowAt25 = false;
    // A5 激光扫射递归取消：标志 + 残留视觉引用（防 Boss 死亡后幽灵扫射链）
    this._sweeping = false;
    this._sweepWarn = null; this._sweepBeam = null; this._sweepGlow = null;

    // A7 Boss 狂暴终结技（叠加在既有 phase 3 之上，零改动 0.66/0.33 阶段机）
    //   _enrageTriggered 已进入狂暴（一次性，防止重复触发/双横幅）
    //   _enraging         狂暴态生效中（触发后保持，DPS 窗口可重复检查）
    //   _enrageDmgAcc     当前 DPS 窗口内累计伤害
    //   _enrageEscUntil   破绽（硬直）结束时间（scene.time.now ms；期间受击 ×2 且 Boss 停火停移）
    this._enrageTriggered = false;
    this._enraging = false;
    this._enrageDmgAcc = 0;
    this._enrageEscUntil = 0;
    // 狂暴内部节奏（append-only 派生字段）
    this._enrageWindowStart = 0;  // 当前 DPS 窗口起始时间
    this._enrageFireUntil = 0;    // 下一组狂暴弹幕最早发射时间
    this._enrageStormGroup = 0;   // 3 组弹幕轮换索引
    this._enrageStormAng = 0;     // 安全缝隙旋转角

    // 画质精修三件·C：Boss 入场仪式（纯演出，血量/阶段/掉落/成就链路零改动）。
    // 初始 y 已在屏外上方（super y=-120），冲入目标位 y=150（400-600ms + Back 轻微回弹）；
    // 到达时冲击波环 + 顶光聚光（大半径柔光短暂显影）+ 轻微 camera.flash。
    // 入场期间 _entering=true：update 跳过横移/弹幕，hit() 返回 false（无敌）。
    // reduced-motion：直接出现在目标位，仅冲击波环一闪（无冲入动画）。
    const ENTRY_Y = 150;
    if (PREFERS_REDUCED) {
      this.y = ENTRY_Y;
      VFX.shockwaveRing(scene, this.x, this.y, this.color, { radius: 120, duration: 240, depth: 56 });
      this._entering = false;
    } else {
      scene.tweens.add({
        targets: this, y: ENTRY_Y, duration: 500, ease: EASE.pop,
        onComplete: () => {
          if (!this.active) return;
          this._entering = false;
          // 冲击波环 + 顶光聚光（glow_soft 大半径柔光短暂显影）+ 轻微 camera.flash
          VFX.shockwaveRing(scene, this.x, this.y, this.color, { radius: 130, duration: 320, depth: 56 });
          const glow = scene.add.image(this.x, this.y, 'glow_soft')
            .setDepth(56).setAlpha(0).setTint(this.color)
            .setBlendMode(Phaser.BlendModes.ADD).setScale(1.1);
          scene.tweens.add({
            targets: glow, alpha: { from: 0, to: 0.45 }, duration: 120, yoyo: true, hold: 60,
            onComplete: () => { if (glow && glow.active) glow.destroy(); },
          });
          scene.cameras.main.flash(90, 255, 255, 255);
        },
      });
    }

    EventBus.emit(EVENTS.BOSS_HP_CHANGED, this.hp, this.maxHp);
  }

  /** 相位 tint：P1 狂暴形态可视化（纯视觉，不影响弹幕/伤害） */
  _getPhaseTint() {
    const base = Phaser.Display.Color.IntegerToColor(this.color);
    if (this.phase <= 1) return this.color;
    if (this.phase === 2) {
      // 二阶段：向白提亮，机体更「充能」
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        base, Phaser.Display.Color.IntegerToColor(0xffffff), 100, 26,
      );
      return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    }
    // 三阶段（狂暴）：向红偏移，呈现愤怒形态
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      base, Phaser.Display.Color.IntegerToColor(0xff3344), 100, 60,
    );
    return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
  }

  /** 生成确定性裂纹路径（相位越高裂纹越多），避免每帧随机闪烁 */
  _genCrackPaths() {
    this._crackPaths = [];
    const n = this.phase === 1 ? 0 : this.phase === 2 ? 5 : 10;
    for (let i = 0; i < n; i++) {
      const a0 = (Math.PI * 2 / n) * i + (i % 3) * 0.35;
      const pts = [];
      let r = 14 + (i % 4) * 5;
      for (let s = 0; s < 4; s++) {
        const ang = a0 + (s % 2 === 0 ? 0.18 : -0.14) * s;
        r += 11 + (i % 3) * 3;
        pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r * 0.82 });
      }
      this._crackPaths.push(pts);
    }
  }

  /** 重绘相位视觉：机身 tint + 能量环 + 描边换色 + 裂纹（纯视觉） */
  _drawPhaseFx() {
    const g = this.fxG;
    if (!g) return;
    g.clear();
    const col = this.phase >= 3 ? 0xff4455 : this.phase === 2 ? 0xffb066 : 0xffffff;
    const ringAlpha = this.phase === 1 ? 0.20 : this.phase === 2 ? 0.45 : 0.85;
    const ringW = this.phase === 1 ? 2 : this.phase === 2 ? 3 : 5;
    const R = this.phase === 1 ? 76 : this.phase === 2 ? 82 : 88;
    // 能量环（内圈 + 外圈，强度随相位递增）
    g.lineStyle(ringW, col, ringAlpha);
    g.strokeCircle(0, 0, R);
    g.lineStyle(1, col, ringAlpha * 0.5);
    g.strokeCircle(0, 0, R - 7);
    // 机身描边（换色）：六边形轮廓，相位越高越亮
    g.lineStyle(this.phase >= 2 ? 2 : 1, col, this.phase >= 2 ? 0.8 : 0.35);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      pts.push({ x: Math.cos(a) * 64, y: Math.sin(a) * 64 * 0.82 });
    }
    g.strokePoints(pts, true);
    // 裂纹（二阶段起步，三阶段更密更亮）
    if (this._crackPaths.length) {
      g.lineStyle(this.phase >= 3 ? 2 : 1.5, col, this.phase >= 3 ? 0.9 : 0.55);
      for (const path of this._crackPaths) {
        g.beginPath();
        g.moveTo(0, 0);
        for (const p of path) g.lineTo(p.x, p.y);
        g.strokePath();
      }
    }
  }

  /** 同步相位视觉（init / 阶段切换时调用） */
  _syncPhaseVisuals() {
    this.setTint(this._getPhaseTint());
    this._genCrackPaths();
    this._drawPhaseFx();
  }

  /** 护盾部位跟随 Boss + 显隐（盾破期间隐藏） */
  _syncShieldPart() {
    if (!this.shieldPart) return;
    this.shieldPart.setPosition(this.x, this.y - 8);
    this.shieldPart.setVisible(!this._shieldBroken);
  }

  update(time, dt) {
    if (!this.active) return;
    this._t += dt;

    // 纯视觉：能量环/裂纹跟随 Boss 移动；相位 2/3 轻微脉动（reduced-motion 静态）
    if (this.fxG) {
      this.fxG.setPosition(this.x, this.y);
      if (!PREFERS_REDUCED && this.phase >= 2) {
        this.fxG.setAlpha(0.75 + 0.25 * Math.sin(this._t * 0.006));
      } else {
        this.fxG.setAlpha(1);
      }
    }

    // P1 可破坏护盾部位：3s 无盾窗口结束自动恢复 → 再同步位置/显隐（恢复当帧即显示）
    if (this.shieldPart) {
      if (this._shieldBroken && time > this._shieldBrokenUntil) {
        this._shieldBroken = false;
        this._shieldPartHp = this._shieldPartMaxHp;
      }
      this._syncShieldPart();
    }

    if (!this._entering) {
      // A7 破绽硬直：Boss 停火停移（纯硬直），狂暴弹幕节奏由 _updateEnrage 接管
      const staggered = this._isStaggered();
      if (!staggered) {
        // 左右横移（A7 狂暴期移速 ×0.5，便于集火）
        const moveSpeed = 90 * (this._enraging ? RAGE.moveSpeedMul : 1);
        this.x += this._dir * moveSpeed * (dt / 1000);
        if (this.x < 90) { this.x = 90; this._dir = 1; }
        if (this.x > GAME_WIDTH - 90) { this.x = GAME_WIDTH - 90; this._dir = -1; }
      }

      if (this._enraging) {
        // 狂暴态：弹幕节奏走 _updateEnrage（专属风暴 + DPS 窗口/破绽/回血）
        this._updateEnrage(dt);
      } else if (!staggered) {
        // 弹幕（阶段越高越频繁）
        const fireGap = this.phase === 1 ? 900 : this.phase === 2 ? 650 : 420;
        if (time - this._lastFire > fireGap) {
          this.firePattern();
          this._lastFire = time;
        }
      }
    }
  }

  firePattern() {
    switch (this.pattern) {
      case 'ring': this._patternRing(); break;
      case 'spiral': this._patternSpiral(); break;
      case 'cross': this._patternCross(); break;
      case 'nova': this._patternNova(); break;
      // P1 几何/扩展弹幕（append-only）
      case 'aimed': this._patternAimed(); break;
      case 'wall': this._patternWall(); break;
      case 'laserSweep': this._patternLaserSweep(); break;
      case 'petal': this._patternPetal(); break;
      default: this._patternFan(); break;
    }
    // P1 盾破期间：弹幕增强（额外瞄准弹雨，全弹幕朝玩家）
    if (this._shieldBroken) this._patternShieldBurst();
  }

  /** 盾破期间弹幕密度系数（>1 = 更密集；无盾时 1.4） */
  _density() {
    let d = this._shieldBroken ? 1.4 : 1;
    // A7 狂暴全屏弹幕：reduced-motion / 性能档 low 下密度减半（保证可玩 + 无障碍）
    if (this._enraging) {
      const low = this.scene && this.scene.qualityScale != null && this.scene.qualityScale < 0.7;
      if (PREFERS_REDUCED || low) d *= 0.5;
    }
    return d;
  }

  // ───────────────────────────────────────────────────────────────
  // A7 Boss 狂暴终结技（叠加在既有 phase 3 之上，零改动 0.66/0.33 阶段机）
  // 触发：hp < maxHp×15% → 狂暴态。狂暴期专属全屏弹幕（3 组轮换、每组含旋转安全缝隙
  // ≥ 玩家机身×3），横移 -50%；DPS 窗口内造成 maxHp×10% → 破绽 2s（受击 ×2 + 硬直），
  // 失败 → 回血至 maxHp×20% + 全屏弹幕（可重复）。击杀仍走正常 die() → BOSS_DEFEATED。
  // ───────────────────────────────────────────────────────────────

  /** 狂暴破绽（硬直）中？破绽期间 Boss 停火停移、受击 ×2 */
  _isStaggered() {
    return this._enraging && this.scene.time.now < this._enrageEscUntil;
  }

  /** 进入狂暴态（一次性命中 <15% 触发一次；数值按各自 maxHp 比例，主线/爬塔/BossRush 复用） */
  _triggerEnrage() {
    if (this._enrageTriggered || this._entering || !this.active || this.hp <= 0) return;
    if (this.hp >= this.maxHp * RAGE.hpThreshold) return;
    this._enrageTriggered = true;
    this._enraging = true;
    this._enrageDmgAcc = 0;
    this._enrageEscUntil = 0;
    this._enrageWindowStart = this.scene.time.now;
    // D2 P3 修复：PM 要求入场演出 ≥1.2s —— 首组狂暴弹幕最早发射时间取「组间歇与 1.2s 演出期」较大者
    // （后续组间歇仍按 RAGE.fireGapMs=500ms，仅首组让出演出窗口）
    this._enrageFireUntil = this.scene.time.now + Math.max(RAGE.fireGapMs, 1200);
    // 演出：狂暴横幅（复用 UIScene BOSS_PHASE≥3『狂暴』文案）+ 红屏闪烁（reduced-motion 降级）
    EventBus.emit(EVENTS.BOSS_PHASE, 3);
    if (!PREFERS_REDUCED) this.scene.cameras.main.flash(180, 140, 16, 16);
    VFX.shockwaveRing(this.scene, this.x, this.y, 0xff4455, { radius: 200, duration: 420, depth: 56 });
  }

  /**
   * 安全缝隙半角（弧度）：以 Boss 为圆心、玩家典型距离为半径，
   * 保证缺口线性宽度 ≥ 玩家机身 × RAGE.gapMul（硬性红线：禁止无缝隙全屏弹幕）。
   */
  _enrageGapHalf() {
    const playerW = (this.scene.player && this.scene.player.displayWidth) || 40;
    const dist = Math.max(120, GAME_HEIGHT - this.y - 40);
    const ratio = (playerW * RAGE.gapMul) / (2 * dist);
    return Math.asin(Math.min(1, ratio)) + 0.04; // +4% 余量，防贴边擦伤
  }

  /** 狂暴专属全屏弹幕：3 组轮换，每组含旋转安全缝隙（缺口 ≥ 玩家机身 3 倍） */
  _patternEnrageStorm() {
    const R = RAGE;
    const group = this._enrageStormGroup % 3;
    this._enrageStormGroup += 1;
    // 旋转安全缝隙：朝向在「向下帘幕」范围内缓摆
    this._enrageStormAng += 0.55;
    const lo = Math.PI * 0.18, hi = Math.PI * 0.82;
    const gapHalf = this._enrageGapHalf();
    const raw = Math.PI / 2 + Math.sin(this._enrageStormAng) * 0.9;
    const gapCenter = Phaser.Math.Clamp(raw, lo + gapHalf + 0.06, hi - gapHalf - 0.06);
    // 密度：基础 × 阶段 + 盾破增强（reduced-motion / low 档由 _density 减半）
    const total = Math.round((22 + this.phase * 5) * this._density());
    const speedMul = [0.85, 1.0, 1.15][group] || 1;
    for (let i = 0; i < total; i++) {
      const ang = lo + ((hi - lo) / Math.max(1, total - 1)) * i;
      if (Math.abs(ang - gapCenter) < gapHalf) continue; // 安全缝隙：缺口内不落弹
      this.spawnBullet(ang, this.bulletSpeed * speedMul);
    }
  }

  /** 狂暴态驱动：DPS 窗口判定（破绽/回血）+ 专属弹幕组间歇（≥0.5s） */
  _updateEnrage(dt) {
    const R = RAGE;
    const now = this.scene.time.now;
    // 破绽硬直中：不检查 DPS 窗口、不开火（update() 已跳过移动）
    if (this._isStaggered()) return;
    if (!this._enrageWindowStart) this._enrageWindowStart = now;

    // DPS 窗口结算
    if (now - this._enrageWindowStart >= R.windowMs) {
      const need = this.maxHp * R.needDmgRatio;
      if (this._enrageDmgAcc >= need) {
        // 成功：破绽 2s（受击 ×2 + 硬直）
        this._enrageEscUntil = now + R.staggerMs;
        EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.x, y: this.y, special: true, label: '破绽！' });
      } else {
        // 失败：回血至 maxHp×20% + 立即释放一次全屏弹幕，狂暴态继续
        this.hp = this.maxHp * R.failHealRatio;
        EventBus.emit(EVENTS.BOSS_HP_CHANGED, this.hp, this.maxHp);
        this._patternEnrageStorm();
        EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.x, y: this.y, special: true, label: '狂暴回涌' });
        if (!PREFERS_REDUCED) this.scene.cameras.main.flash(160, 120, 20, 20);
      }
      this._enrageDmgAcc = 0;
      this._enrageWindowStart = now; // 重启窗口（可重复触发）
    }

    // 狂暴专属弹幕：3 组轮换，组间歇 ≥ fireGapMs
    if (now >= this._enrageFireUntil) {
      this._patternEnrageStorm();
      this._enrageFireUntil = now + R.fireGapMs;
    }
  }

  /** 发射单发子弹并染上 Boss 配色，便于视觉区分 */
  spawnBullet(angle, speed) {
    this.spawnBulletAt(this.x, this.y + 40, angle, speed);
  }

  /** 在任意坐标发射单发敌弹（P1：wall 等需多 x 布局的弹幕） */
  spawnBulletAt(x, y, angle, speed) {
    const scene = this.scene;
    if (!scene.enemyBullets) return;
    // A8 弹速风暴变异：Boss 弹速同样 ×1.2^N（非塔模式恒 1，零回归）
    if (scene._mutationMul) speed *= scene._mutationMul().bulletSpeed;
    const b = scene.enemyBullets.get(x, y, 'bullet_enemy');
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.body.enable = true;
    b.setTint(this.color);
    scene.physics.velocityFromRotation(angle, speed, b.body.velocity);
    if (scene.enemyTrail) scene.enemyTrail.emitParticleAt(b.x, b.y);   // 敌弹拖尾视觉一行
  }

  // 半圆扇形（基础弹幕）：向下半圆铺开
  _patternFan() {
    const n = Math.round((10 + this.phase * 4) * this._density());
    const spread = Math.PI;
    for (let i = 0; i < n; i++) {
      const ang = (spread / (n - 1)) * i;
      this.spawnBullet(ang, this.bulletSpeed * 0.9);
    }
  }

  // 环状齐射（360° 环，缓缓自转）
  _patternRing() {
    const n = Math.round((12 + this.phase * 4) * this._density());
    const off = this._t * 0.0006;
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 / n) * i + off;
      this.spawnBullet(ang, this.bulletSpeed * 0.8);
    }
  }

  // 旋转螺旋：每发自转一个角度，阶段越高臂越多、越密
  _patternSpiral() {
    const arms = 2 + this.phase;       // 3 / 4 / 5 条螺旋臂
    const per = Math.round((3 + this.phase) * this._density());        // 每条臂子弹数
    this._spiralAng += 0.3 + this.phase * 0.08;
    for (let a = 0; a < arms; a++) {
      const base = this._spiralAng + (Math.PI * 2 / arms) * a;
      for (let i = 0; i < per; i++) {
        this.spawnBullet(base + i * 0.14, this.bulletSpeed * 0.7);
      }
    }
  }

  // 瞄准 + 十字：朝玩家扇射；阶段2后追加正交十字弹
  _patternCross() {
    const player = this.scene.player;
    const base = (player && player.active)
      ? Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y)
      : Math.PI / 2;
    const n = Math.round((4 + this.phase * 2) * this._density());
    const spread = 0.5 + this.phase * 0.25;
    for (let i = 0; i < n; i++) {
      const ang = base + (spread / Math.max(1, n - 1)) * i - spread / 2;
      this.spawnBullet(ang, this.bulletSpeed);
    }
    if (this.phase >= 2) {
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((ang) => {
        this.spawnBullet(ang, this.bulletSpeed * 0.85);
      });
    }
  }

  // 新星弹幕（第4关 Boss「湮灭者」finale 形态）：环弹铺底 + 朝玩家瞄准爆发，
  // 阶段2 起追加反向旋转臂。复用 spawnBullet / bulletSpeed，不与现有 pattern 耦合。
  _patternNova() {
    const n = Math.round((16 + this.phase * 4) * this._density());
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 / n) * i;
      this.spawnBullet(ang, this.bulletSpeed * 0.7);
    }
    const player = this.scene.player;
    const base = (player && player.active)
      ? Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y)
      : Math.PI / 2;
    const burst = 3 + this.phase;
    for (let i = 0; i < burst; i++) {
      const ang = base + (i - (burst - 1) / 2) * 0.18;
      this.spawnBullet(ang, this.bulletSpeed * 1.05);
    }
    if (this.phase >= 2) {
      this._novaAng = (this._novaAng || 0) + 0.4;
      for (let i = 0; i < 4; i++) {
        const ang = this._novaAng + (Math.PI / 2) * i;
        this.spawnBullet(ang, this.bulletSpeed * 0.9);
      }
    }
  }

  // P1 瞄准弹幕：朝玩家扇射（turret 式 / 盾破增强共用）
  _patternAimed() {
    const player = this.scene.player;
    const base = (player && player.active)
      ? Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y)
      : Math.PI / 2;
    const n = Math.round((3 + this.phase) * this._density());
    const spread = 0.35 + this.phase * 0.1;
    for (let i = 0; i < n; i++) {
      const ang = base + (spread / Math.max(1, n - 1)) * i - spread / 2;
      this.spawnBullet(ang, this.bulletSpeed);
    }
  }

  // P1 墙弹：横向一排向下直落
  _patternWall() {
    const n = Math.round(7 * this._density());
    const gap = GAME_WIDTH / (n + 1);
    for (let i = 1; i <= n; i++) {
      this.spawnBulletAt(gap * i, this.y + 40, Math.PI / 2, this.bulletSpeed * 0.85);
    }
  }

  // P1 花瓣弹：多臂对称（每臂两侧花瓣，缓缓自转）
  _patternPetal() {
    const arms = 3 + this.phase;
    const per = 2 + Math.floor(this.phase / 2);
    this._petalAng = (this._petalAng || 0) + 0.28;
    for (let a = 0; a < arms; a++) {
      const base = this._petalAng + (Math.PI * 2 / arms) * a;
      for (let i = 0; i < per; i++) {
        const off = (i % 2 === 0 ? 1 : -1) * 0.15 * (1 + Math.floor(i / 2));
        this.spawnBullet(base + off, this.bulletSpeed * 0.72);
      }
    }
  }

  // P1 盾破增强弹雨：全弹幕朝玩家（额外瞄准弹 + 更密）
  _patternShieldBurst() {
    const player = this.scene.player;
    const base = (player && player.active)
      ? Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y)
      : Math.PI / 2;
    const n = 3 + this.phase;
    for (let i = 0; i < n; i++) {
      const ang = base + (i - (n - 1) / 2) * 0.13;
      this.spawnBullet(ang, this.bulletSpeed * 1.08);
    }
  }

  // A5 取消/清理激光扫射链：复位递归标志并销毁残留视觉（die 时调用）
  _cancelSweep() {
    this._sweeping = false;
    [this._sweepWarn, this._sweepBeam, this._sweepGlow].forEach((o) => {
      if (o && o.active) o.destroy();
    });
    this._sweepWarn = null; this._sweepBeam = null; this._sweepGlow = null;
  }

  // P1 激光扫射（Boss 版）：短暂蓄力警示 → 扫射 beam（复用视觉 beam_glow/矩形光柱）
  _patternLaserSweep() {
    const scene = this.scene;
    if (!this.active || this._sweeping) return;   // A5：Boss 已死亡/扫射进行中则中止
    this._sweeping = true;
    const sx = this.x, sy = this.y + 40;
    // 蓄力警示（reduced-motion 静态圆）
    const warn = scene.add.circle(sx, sy, 22, 0xff4455, 0.22)
      .setStrokeStyle(2, 0xff4455, 0.8).setDepth(this.depth + 2);
    this._sweepWarn = warn;
    if (PREFERS_REDUCED) {
      warn.setAlpha(0.5);
    } else {
      const spin = () => {
        if (!warn.active || !this.active || !this._sweeping) return;
        warn.setScale(1 + 0.3 * Math.sin(scene.time.now * 0.02));
        scene.time.delayedCall(40, spin);
      };
      spin();
    }
    scene.time.delayedCall(420, () => {
      if (warn.active) warn.destroy();
      this._sweepWarn = null;
      if (!this.active || !this._sweeping) return;   // A5：蓄力期间被回收/死亡则不再出 beam
      const beam = scene.add.rectangle(sx, sy, 12, 420, 0xff5a3c, 0.5)
        .setOrigin(0.5, 0).setDepth(this.depth + 1);
      const glow = scene.add.rectangle(sx, sy, 20, 420, 0xffa07a, 0.22)
        .setOrigin(0.5, 0).setDepth(this.depth).setBlendMode(Phaser.BlendModes.ADD);
      beam._isSweep = true;
      this._sweepBeam = beam; this._sweepGlow = glow;
      if (PREFERS_REDUCED) {
        beam.setRotation(-0.4);
        scene.time.delayedCall(160, () => {
          if (beam.active) beam.destroy();
          if (glow.active) glow.destroy();
          this._sweepBeam = this._sweepGlow = null;
          this._sweeping = false;
        });
        return;
      }
      const dur = 720;
      const t0 = scene.time.now;
      const tick = () => {
        if (!beam.active) return;
        if (!this.active || !this._sweeping) {   // A5：递归取消——Boss 死亡立即停链
          if (beam.active) beam.destroy();
          if (glow.active) glow.destroy();
          this._sweepBeam = this._sweepGlow = null;
          return;
        }
        const p = (scene.time.now - t0) / dur;
        if (p >= 1) {
          if (beam.active) beam.destroy();
          if (glow.active) glow.destroy();
          this._sweepBeam = this._sweepGlow = null;
          this._sweeping = false;   // 扫射自然结束，允许下一次
          return;
        }
        const ang = Phaser.Math.DegToRad(-60 + 120 * p);
        beam.setRotation(ang);
        glow.setRotation(ang);
        // 命中判定：beam 线段与玩家判定圈相交 → 单次受击（玩家无敌帧天然防连击）
        if (scene.player && scene.player.active) {
          const hc = scene.player.getHitCircle();
          const tipX = sx + Math.sin(ang) * 420;
          const tipY = sy + Math.cos(ang) * 420;
          if (!beam._hitDone && _distToSegment(hc.x, hc.y, sx, sy, tipX, tipY) < hc.r + 6) {
            beam._hitDone = true;
            scene.playerHit(10);
          }
        }
        scene.time.delayedCall(16, tick);
      };
      tick();
    });
  }

  /** P1 可破坏护盾部位受击：独立 HP，不触发 Boss 阶段；盾破 → 3s 无盾 + 弹幕增强 */
  hitShieldPart(dmg) {
    if (!this.shieldPart || this._shieldBroken) return;
    this._shieldPartHp = Math.max(0, this._shieldPartHp - dmg);
    VFX.hitSpark(this.scene, this.shieldPart.x, this.shieldPart.y);
    if (this._shieldPartHp <= 0) {
      this._shieldBroken = true;
      this._shieldBrokenUntil = this.scene.time.now + 3000;
      VFX.explosion(this.scene, this.shieldPart.x, this.shieldPart.y, this.color, 1.2);
      this._syncShieldPart();
      this.scene.cameras.main.flash(120, 80, 60, 140);
      EventBus.emit(EVENTS.FLOAT_SCORE, { x: this.shieldPart.x, y: this.shieldPart.y, special: true, label: '护盾击破' });
      audio.sfx('explosionMid');
    }
  }

  hit(dmg, element) {
    if (this._entering) return false;
    // A7 破绽期间受击 ×2（纯增益玩家输出，不叠加元素/盾破倍率）
    if (this._isStaggered()) dmg *= RAGE.dmgMulOnStagger;
    this.hp = Math.max(0, this.hp - dmg);
    if (this._enraging) this._enrageDmgAcc += dmg; // A7 DPS 窗口累计（含破绽 ×2 伤害）
    if (element) this.applyElement(element);
    EventBus.emit(EVENTS.BOSS_HP_CHANGED, this.hp, this.maxHp);
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(40, () => { if (this.active) this.setTint(this._getPhaseTint()); });
    VFX.hitSpark(this.scene, this.x, this.y + 20);

    // 阶段切换
    const ratio = this.hp / this.maxHp;
    const newPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this._syncPhaseVisuals();                                       // 同步三阶段机身差异化视觉
      this.scene.cameras.main.flash(200, 80, 20, 40);
      if (this.scene.requestHitStop) this.scene.requestHitStop(180); // 阶段切换：中强定格
      EventBus.emit(EVENTS.BOSS_PHASE, newPhase);                    // 阶段演出：UIScene 提示文字
      // 变身脉冲：短暂放大+白闪，强化「进场变身」感（能量环叠加层同步放大）
      this.scene.tweens.add({ targets: this, scaleX: 1.18, scaleY: 1.18, duration: 220, yoyo: true, ease: EASE.feedback });
      if (this.fxG) this.scene.tweens.add({ targets: this.fxG, scaleX: 1.18, scaleY: 1.18, duration: 220, yoyo: true, ease: EASE.feedback });
    }
    // P2 体验细节·慢放子弹时间：血线首次降至 50% / 25% 触发 slowMotion(300ms)（纯演出，复用 scene.slowMotion）
    // 两条 if 独立判断：大额伤害一次性压过 50%+25% 时两个血线都会触发，slowMotion 内部叠加计数安全。
    if (ratio <= 0.5 && !this._slowAt50) {
      this._slowAt50 = true;
      if (this.scene.slowMotion) this.scene.slowMotion(300);
    }
    if (ratio <= 0.25 && !this._slowAt25) {
      this._slowAt25 = true;
      if (this.scene.slowMotion) this.scene.slowMotion(300);
    }

    if (this.hp <= 0) {
      this.die();
      return true;
    }
    // A7 狂暴触发：非致死命中且 hp < maxHp×15%（叠加在 phase 3 之上；不双触发）
    if (!this._enrageTriggered && this.hp < this.maxHp * RAGE.hpThreshold) {
      this._triggerEnrage();
    }
    // P0-3 非致死命中：Boss 专属双音层命中音（致死走 die() 的 explosionBoss，避免双重音）
    audio.sfx('bossHit');
    return false;
  }

  /** 附加元素状态（B6，仅染色反馈；Boss 不受减速/麻痹影响） */
  applyElement(key) {
    if (!key) return;
    const map = { fire: 0xff7a3a, ice: 0x6fd6ff, thunder: 0xffe14a };
    const c = map[key];
    if (!c) return;
    this.setTint(c);
    this.scene.time.delayedCall(260, () => { if (this.active) this.setTint(this._getPhaseTint()); });
  }

  die() {
    this._cancelSweep();  // A5：Boss 死亡即取消激光扫射递归链，杜绝死亡演出期间幽灵扫射
    EventBus.emit(EVENTS.BOSS_DEFEATED);
    // P0-2 爆炸三阶段分级：Boss 用最高档，与 BOSS_DEFEATED 同帧（定格同步由 GameScene 现有逻辑天然成立）
    audio.sfx('explosionBoss');
    VFX.bossDeathExplosion(this.scene, this, this.color);
    // P3 弹性缩放死亡演出：1→1.25 Back.easeOut(90ms)→0 Back.easeIn(260ms)，fxG 同步 yoyo
    if (!PREFERS_REDUCED) {
      this.scene.tweens.add({
        targets: this, scaleX: 1.25, scaleY: 1.25, duration: 90, ease: EASE.pop,
        onComplete: () => {
          this.scene.tweens.add({
            targets: this, scaleX: 0, scaleY: 0, duration: 260, ease: EASE.exit,
          });
        },
      });
      if (this.fxG) {
        this.scene.tweens.add({
          targets: this.fxG, scaleX: 1.25, scaleY: 1.25, duration: 90, yoyo: true, ease: EASE.pop,
        });
      }
    }
    this.setActive(false);
    this.scene.time.delayedCall(800, () => {
      if (this.fxG) { this.fxG.destroy(); this.fxG = null; }
      if (this.shieldPart) { this.shieldPart.destroy(); this.shieldPart = null; }
      this.destroy();
    });
  }
}

/** P1 激光扫射命中辅助：点到线段最近距离（beam 扫掠判定用） */
function _distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  const ox = px - cx, oy = py - cy;
  return Math.sqrt(ox * ox + oy * oy);
}
