import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVELS, SHIPS, getShipSkins, PERFORMANCE, EASE } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';
import { t } from '../config/Locale.js';
import { createStarfield } from '../systems/Starfield.js';
import { transition } from '../systems/TransitionManager.js';
import { TitleSystem } from '../systems/TitleSystem.js';
import { NeonButton, NeonBar, THEME } from '../utils/UIWidgets.js';
import { enableSceneBloom } from '../utils/BloomFX.js';
import { applyFilmLayer } from '../utils/FilmFX.js';

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

    // OPT-13 批B B15 分享卡：结算后滚动 lastScore←本次、prevScore←旧 lastScore
    // （append-only 纯视觉数据；不影响结算/排行/成就，红线 R7）
    this._rollLastScore();

    // 背景渐变（按关卡色调，与战斗场景一致）
    const lvl = LEVELS.find((l) => l.id === (r.levelId || 1)) || LEVELS[0];
    const theme = lvl.theme;
    const bg = this.add.graphics().setDepth(-200);
    bg.fillGradientStyle(theme.skyTop, theme.skyTop, theme.skyBottom, theme.skyBottom, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.starfield = createStarfield(this, { layers: 4, starTints: theme.starTints });

    // P1 表现工程·PostFX 辉光（可选场景；按性能档开，low 关 / Canvas 自动降级）。
    // OPT-14 A2：静态场景加脏标记（staticMode），避免每帧重绘烧成本。
    this.bloomFX = enableSceneBloom(this, SaveManager.load().quality || PERFORMANCE.defaultTier, { staticMode: true });
    // OPT-14 A3：结算电影层（常驻暗角 + 静态颗粒；grainSpeed=false 防闪烁）
    this.filmFX = applyFilmLayer(this, { key: 'result' });

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

    // OPT-13 批B B12 称号系统：结算页展示当前称号（标题下方一行，纯派生只读展示）。
    // 标题底 ~224 / 星级顶 ~250，称号行放 y=236（16px）不遮挡既有元素、不移动布局；
    // reduced-motion 友好：静态文本无弹跳/缩放动画。
    const _curTitle = TitleSystem.getCurrentTitle(SaveManager.load());
    this.add.text(cx, 236, _curTitle ? t('title_' + _curTitle.id) : t('titleNone'), {
      fontFamily: THEME.fontFamily, fontSize: '16px', fontStyle: '800',
      color: _curTitle ? TitleSystem.getRarityColor(_curTitle.rarity) : THEME.textSecondary,
    }).setOrigin(0.5).setAlpha(_curTitle ? 0.92 : 0.55);

    // Phase C：胜利全屏爆闪
    if (r.victory) {
      const flash = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0.85).setDepth(40);
      this.tweens.add({ targets: flash, alpha: 0, duration: 650, ease: EASE.exit, onComplete: () => flash.destroy() });
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
    // OPT-16 C3 战后复盘：本局详情三行（擦弹/局时长/受击），纯展示零业务。
    // 放最高分行之前、全模式一致显示；与既有行同 {label,value} 格式。
    lines.push({ label: t('resGrazes'), value: r.grazes || 0 });
    lines.push({ label: t('resTime'), value: this._fmtDuration(r.elapsedMs) });
    lines.push({ label: t('resHits'), value: r.damageTaken || 0 });
    lines.push({ label: t('resBest'), value: r.bestScore ?? 0 });
    const dataStartY = 400;
    // OPT-16 C3：详情行追加后行数可达 9-10（无尽/活动原本就有 5-7 行），若保持 40px 行距
    // 会把底部按钮挤出 960px 画布。这里做「行距自适应」：行数少保持 40（与旧布局逐像素一致），
    // 行数多收紧行距，保证最后一颗按钮中心 ≤919（底缘仍在屏内可点）。按钮 58 高、行距 80。
    //   约束：btnY(dataEndY+140) + (btnRows-1)*80 ≤ 919；dataEndY = dataStartY + N*rowGap
    //   btnRows：无尽/活动 2 颗；普通胜利且非末关 3 颗；其余 2 颗。
    const btnRows = (r.mode === 'endless' || r.mode === 'coin_rush' || r.mode === 'survival')
      ? 2
      : ((r.victory && (r.levelId || 1) < LEVELS.length) ? 3 : 2);
    const maxRowSpan = 919 - dataStartY - 140 - (btnRows - 1) * 80; // 3按钮 219 / 2按钮 299
    const rowGap = Math.min(40, Math.max(24, Math.floor(maxRowSpan / lines.length)));
    lines.forEach((l, i) => {
      this.add.text(cx, dataStartY + i * rowGap, `${l.label}   ${l.value}${l.newBest ? t('resNewRecord') : ''}`, {
        fontFamily: THEME.fontFamily, fontSize: '22px',
        color: l.newBest ? THEME.textGoldLight : THEME.textPrimary,
        fontStyle: l.newBest ? '800' : 'normal',
      }).setOrigin(0.5);
    });

    // ── UI P2 信息层：完成度条（NeonBar）+ 连击峰值面板 ──
    // 动态下移：数据行数与行距决定信息层与按钮基准 Y，避免遮挡（C3 行多时行距自适应收紧）。
    const dataEndY = dataStartY + lines.length * rowGap;
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
          targets: star, scale: 1, duration: 400, delay: i * 220, ease: EASE.pop,
        });
        // Phase C：星级弹入爆闪光圈
        const burst = this.add.circle(x, y, 8, 0xfff3b0, 0.5).setScale(0.3).setDepth(2);
        this.tweens.add({
          targets: burst, scale: 6, alpha: 0, duration: 440, delay: i * 220,
          ease: EASE.enter, onComplete: () => burst.destroy(),
        });
      }
    }
  }

  makeButton(x, y, label, cb) {
    // P1 UI：统一复用 NeonButton（辉光 + hover + 按压缩放），与 MenuScene 风格一致
    return new NeonButton(this, x, y, label, { glow: true, onDown: cb }).container;
  }

  /** OPT-16 C3 战后复盘：局时长格式化。95_000 → '1:35'；<1min → '0:42'（纯展示） */
  _fmtDuration(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---- P1 留存·社交排行：成绩分享卡（纯本地，无后端）----
  // OPT-13 批B B15 分享卡升级：主题背景（LEVELS.theme）/难度边框强调色/昵称行/称号行/历史对比。
  // 纯视觉展示，零业务逻辑（红线 R7）：只读 topScores 历史 + append-only 写昵称/lastScore/prevScore，
  // 不触碰结算/排行/成就；canvas 尺寸 540×720 与下载/复制链路不变。

  /** B15 历史分数滚动写盘（append-only）：结算后 lastScore←本次、prevScore←旧 lastScore */
  _rollLastScore() {
    const r = this.result || {};
    const s = SaveManager.load();
    const score = Math.max(0, Math.floor(Number(r.score) || 0));
    s.prevScore = Number(s.lastScore) || 0;
    s.lastScore = score;
    SaveManager.save();
  }

  /** B15 昵称：存档已有则复用；为空则生成「默认昵称 + 随机后缀」（如 飞行员·42）并持久化（编辑文本框后置 P2） */
  _resolveNickname() {
    const s = SaveManager.load();
    if (typeof s.nickname === 'string' && s.nickname) return s.nickname;
    const base = t('nicknameDefault') || '飞行员';
    const suffix = String(Math.floor(Math.random() * 90) + 10); // 10-99
    const nick = `${base}·${suffix}`;
    s.nickname = nick;
    SaveManager.save();
    return nick;
  }

  /** B15 称号：B12 纯派生当前称号名（与结算页一致）；无称号返回 ''（省略对应行） */
  _resolveTitle() {
    const cur = TitleSystem.getCurrentTitle(SaveManager.load());
    return cur ? t('title_' + cur.id) : '';
  }

  /** B15 历史对比：本局 vs 同关同模式排除本局历史最高（pct 向上取整；无历史返回 null → 首秀） */
  _computeDeltaPct() {
    const r = this.result || {};
    const prevBest = Number(r.prevSameBest) || 0;
    const score = Number(r.score) || 0;
    if (prevBest <= 0) return null; // 无历史 → 首秀
    if (score <= 0) return 0;
    return Math.ceil(((score - prevBest) / prevBest) * 100);
  }

  /** B15 对比行文案：无历史 → 首秀；有提升 → 比上次 +X%（破纪录追加 ★新纪录）；未提升 → 省略该行 */
  _compareLine(pct, isNewBest) {
    if (pct == null) return t('shareFirstRun'); // 无历史 → 首秀
    if (pct > 0) {
      const base = t('shareVsLast', { pct });
      return isNewBest ? `${base} ${t('resNewRecord').trim()}` : base;
    }
    return ''; // 有历史但未提升 → 不显示负/0% 干扰视觉
  }

  /** 生成 canvas 成绩卡（主题背景/难度边框/昵称/称号/历史对比，540×720 不变），返回 canvas */
  buildShareCard(deltaPct, nickname, title) {
    const r = this.result || {};
    // 钩子无参调用（__RESULT_SHARE.buildShareCard()）时从 result + 存档现算，保持兼容
    const _deltaPct = (typeof deltaPct === 'number') ? deltaPct : this._computeDeltaPct();
    const _nick = (typeof nickname === 'string' && nickname) ? nickname : this._resolveNickname();
    const _title = (typeof title === 'string' && title) ? title : this._resolveTitle();

    const canvas = document.createElement('canvas');
    canvas.width = 540; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    // 背景渐变：改用本关 LEVELS[i].theme（skyTop→skyBottom；accent 做标题/昵称强调色，零新增数据）
    const lvl = LEVELS.find((l) => l.id === (r.levelId || 1)) || LEVELS[0];
    const theme = (lvl && lvl.theme) || {};
    const hex = (n, fallback) => {
      const v = Number(n);
      return (v || v === 0) ? `#${(v >>> 0).toString(16).padStart(6, '0')}` : fallback;
    };
    const skyTop = hex(theme.skyTop, '#0b1c33');
    const skyBottom = hex(theme.skyBottom, '#040a16');
    const accent = hex(theme.accent, '#7cf3ff');
    const g = ctx.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, skyTop); g.addColorStop(1, skyBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 540, 720);
    // 霓虹边框：难度档强调色（hard=橙 / hell=红，casual·standard=默认青）
    const diffBorder = { hard: '#ff7a3a', hell: '#ff5566' }[r.difficulty || 'standard'] || '#7cf3ff';
    const rgba = (hexStr, a) => {
      const v = parseInt(hexStr.slice(1), 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    };
    ctx.strokeStyle = diffBorder; ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, 508, 688);
    ctx.strokeStyle = rgba(diffBorder, 0.25); ctx.lineWidth = 1;
    ctx.strokeRect(24, 24, 492, 672);
    ctx.textAlign = 'center';
    // 标题（关卡 accent 强调色）
    ctx.fillStyle = accent;
    ctx.font = '800 42px sans-serif';
    ctx.fillText(t('shareTitle'), 270, 118);
    // 分数（主视觉，y 252/292 保持不动，不遮挡）
    ctx.fillStyle = '#ffd86b';
    ctx.font = '800 76px Consolas, monospace';
    ctx.fillText(String(r.score || 0), 270, 252);
    ctx.fillStyle = '#88bbdd'; ctx.font = '600 20px sans-serif';
    ctx.fillText(t('shareScoreLabel'), 270, 292);
    // 昵称行（默认「飞行员·随机后缀」）
    ctx.fillStyle = accent;
    ctx.font = '700 22px sans-serif';
    ctx.fillText(`${t('nicknameLabel')}  ${_nick}`, 270, 336);
    // 称号行（B12 派生；无称号省略）
    if (_title) {
      const curTitle = TitleSystem.getCurrentTitle(SaveManager.load());
      ctx.fillStyle = curTitle ? TitleSystem.getRarityColor(curTitle.rarity) : '#88bbdd';
      ctx.font = '600 20px sans-serif';
      ctx.fillText(_title, 270, 366);
    }
    // 模式 / 爬塔层数
    const modeName = r.mode === 'endless'
      ? t('shareModeEndless', { floor: r.towerFloor || 0 })
      : r.mode === 'bossrush' ? t('shareModeBossRush')
      : r.mode === 'coin_rush' ? t('shareModeCoinRush')
      : r.mode === 'survival' ? t('shareModeSurvival')
      : t('shareModeNormal', { level: r.levelId || 1, victory: r.victory ? t('shareVictory') : t('shareChallenge') });
    ctx.fillStyle = '#cfe8ff'; ctx.font = '700 30px sans-serif';
    ctx.fillText(modeName, 270, 408);
    // 数据行
    ctx.fillStyle = '#88bbdd'; ctx.font = '600 22px sans-serif';
    ctx.fillText(t('shareData', { kills: r.kills || 0, coins: r.coins || 0, combo: r.maxCombo || 0 }), 270, 452);
    // 历史对比行（B15：比上次 +X% / 首秀 / ★新纪录；未提升省略）
    const compareText = this._compareLine(_deltaPct, !!r.isNewBest);
    if (compareText) {
      ctx.fillStyle = '#7cffa0';
      ctx.font = '700 22px sans-serif';
      ctx.fillText(compareText, 270, 492);
    }
    // 战机 / 皮肤
    const ship = (SHIPS && SHIPS[(r.ship && r.ship.id) || 0]) || (SHIPS && SHIPS[0]) || { name: '苍鹰', id: 0 };
    const skinId = (r.ship && r.ship.skin != null) ? Number(r.ship.skin) : 0;
    const skins = getShipSkins(ship.id);
    const skinName = (skins && skins[skinId] && skins[skinId].name) || '默认';
    ctx.fillStyle = '#88bbdd'; ctx.font = '600 22px sans-serif';
    ctx.fillText(t('shareShip', { ship: t(`ship_${ship.id}`), skin: t(`skin_${ship.id}_${skinId}`) }), 270, 548);
    // 日期
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    ctx.fillStyle = '#5a7a99'; ctx.font = '600 20px sans-serif';
    ctx.fillText(dateStr, 270, 620);
    // 文本摘要（复制用）：昵称/称号/历史对比行同步更新
    this._shareText = [
      t('shareLine1'),
      t('shareLine2', { score: r.score || 0, mode: modeName }),
      _title ? `${t('nicknameLabel')}  ${_nick} · ${_title}` : `${t('nicknameLabel')}  ${_nick}`,
      t('shareLine3', { kills: r.kills || 0, coins: r.coins || 0, combo: r.maxCombo || 0 }),
      compareText ? `${t('shareDiffLabel')}  ${compareText}` : '',
      t('shareLine4', { ship: t(`ship_${ship.id}`), skin: t(`skin_${ship.id}_${skinId}`) }),
      dateStr,
    ].filter(Boolean).join('\n');
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
