import Phaser from 'phaser';
import {
  SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, UPGRADE_TREE, SHIPS, WEAPONS, ELEMENTS, MODULES, MODULE_SLOTS, MODULE_QUALITY, MODULE_SHOP,
  LEVELS, PLAYER, calcPower, recommendLevel, SKIN_PRICE, getShipSkins, shipSkinKey,
} from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';
import { t } from '../config/Locale.js';
import { createStarfield, HANGAR_BG_THEME } from '../systems/Starfield.js';
import { transition } from '../systems/TransitionManager.js';
import { NeonButton, THEME, drawGlassPanel } from '../utils/UIWidgets.js';

/**
 * HangarScene：机库 / 部件升级界面（Sky Force 风格金币升级树）
 * ---------------------------------------------------------------------------
 * 列出 5 种部件（UPGRADE_TREE），显示名称、当前等级/满级、下一级花费、
 * 玩家金币余额；点击升级按钮在金币足够且未满级时扣金币、升级、写存档并刷新。
 * 满级 / 金币不足时按钮置灰。
 *
 * 注意：SCENES 中未登记 HANGAR（GameConfig 只读），本场景用字面量 key
 * 'HangarScene'，并由 MenuScene 在运行时用 this.scene.add 动态注册。
 */
// 升级项展示顺序（append-only：新增项加在末尾，不打乱既有布局顺序）
const ORDER = ['firepower', 'hull', 'shield', 'magnet', 'wingman', 'wingmanFirepower'];

export default class HangarScene extends Phaser.Scene {
  constructor() {
    super('HangarScene');
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // 背景滚动星空（UI P2：淡星云 + 陨石剪影；星空色调随所选战机 tint 跟随）
    this.starfield = createStarfield(this, { theme: HANGAR_BG_THEME });

    // 标题（辉光副本层 + 呼吸脉动，与 MenuScene Phase A 统一）
    this.titleGlow = this.add.text(cx, 92, t('hangarTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '54px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleColor, 30, true, true).setAlpha(0.3).setDepth(1);
    this.add.text(cx, 92, t('hangarTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '50px', fontStyle: '800', color: THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 22, true, true).setDepth(2);

    this.add.text(cx, 142, t('hangarSub'), {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.subColor,
    }).setOrigin(0.5).setAlpha(0.8);

    // P2 体验细节·数值反馈：顶部总战力 + 推荐关卡（纯展示，由 calcPower/recommendLevel 派生）
    this.powerText = this.add.text(cx, 166, '', {
      fontFamily: THEME.fontFamily, fontSize: '15px', fontStyle: '700', color: THEME.textGoldLight,
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 6, true, true);

    // P2 体验细节·皮肤装饰：皮肤选择入口（右上角，打开独立 overlay，不影响机库布局）
    this.skinEntryBtn = new NeonButton(this, GAME_WIDTH - 66, 142, t('hangarSkin'), {
      w: 100, h: 44, fontSize: 16, stroke: 0xffd54a, glow: true,
      onDown: () => this.openSkins(),
    }).container;
    this.skinsOpen = false;

    if (!reduceMotion) {
      this.tweens.add({ targets: this.titleGlow, scale: { from: 1, to: 1.03 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: this.titleGlow, alpha: { from: 0.24, to: 0.46 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // 金币余额
    this.coinText = this.add.text(cx, 192, '', {
      fontFamily: THEME.fontFamily, fontSize: '22px', fontStyle: '700', color: THEME.textGold,
    }).setOrigin(0.5);

    // C2 战机武器绑定选择器（在机库里切战机 → 影响开局默认武器/元素）
    this.buildShipSelector(cx, 238);

    // 开局主武器选择（覆盖战机绑定武器；null=用战机默认）
    this.buildStartWeaponSelector(cx, 312);

    // 部件行（6 项：卡片高 84 / 行距 92，开局武器行占 292，起始 348 留出空间）
    this.rows = [];
    const startY = 348;
    const gap = 92;
    ORDER.forEach((key, i) => {
      this.rows.push(this.buildRow(key, cx, startY + i * gap));
    });

    // 返回菜单按钮
    this.makeButton(cx, GAME_HEIGHT - 70, t('backMenu'), () => {
      transition.goto(this, SCENES.MENU);
    });

    // P0 机库模块养成：模块面板入口（右下角，与返回菜单同行不重叠）
    this.moduleEntryBtn = new NeonButton(this, GAME_WIDTH - 82, GAME_HEIGHT - 70, t('hangarModule'), {
      w: 110, h: 56, fontSize: 18, stroke: 0xffd54a, glow: true,
      onDown: () => this.openModules(),
    }).container;

    this.modulesOpen = false;

    this.refresh();

    // 卡片入场错峰弹入（reduced-motion 静态）
    if (!reduceMotion) {
      this.rows.forEach((row, i) => {
        const btnCont = row.btn ? row.btn.container : null;
        const fade = [row.card, row.cardGlow, row.nameText, row.levelText, btnCont].filter(Boolean);
        fade.forEach((o) => o.setAlpha(0));
        this.tweens.add({ targets: [row.card, btnCont].filter(Boolean), alpha: 1, scale: { from: 0.94, to: 1 }, duration: 340, delay: i * 70, ease: 'Back.easeOut' });
        this.tweens.add({ targets: [row.cardGlow, row.nameText, row.levelText].filter(Boolean), alpha: 1, duration: 340, delay: i * 70, ease: 'Back.easeOut' });
      });
    }

    // P2 视觉四件套⑦：作为转场目标时淡入揭示（无过渡时为 no-op，零影响）
    transition.fadeIn(this);
  }

  /** 构建单个部件卡片 + 升级按钮，返回可刷新引用 */
  buildRow(key, cx, y) {
    const def = UPGRADE_TREE[key];
    const row = { key, max: def.max };

    // 背景卡片 + 外发光描边（霓虹化）
    const card = this.add.rectangle(cx, y, 480, 84, THEME.cardBg, 0.9).setStrokeStyle(2, THEME.cardStroke);
    const cardGlow = this.add.graphics().setAlpha(0.9);
    cardGlow.lineStyle(6, COLORS.accent, 0.16).strokeRoundedRect(cx - 240, y - 42, 480, 84, 10);

    // 名称（部件名，i18n key 化）
    const nameText = this.add.text(cx - 222, y - 20, t(`up_${key}`), {
      fontFamily: THEME.fontFamily, fontSize: '24px', fontStyle: '700', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);

    // 等级文本（刷新时填充）
    row.levelText = this.add.text(cx - 222, y + 16, '', {
      fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textSecondary,
    }).setOrigin(0, 0.5);

    // 升级按钮（NeonButton：辉光 + hover + 按压缩放；动态底色保留可升级/不可升级/满级三态）
    row.btn = new NeonButton(this, cx + 168, y, '', {
      w: 120, h: 56, fontSize: 20,
      bgColor: 0x1b6b4a, stroke: COLORS.accent, hoverColor: 0x22996a,
      onDown: () => this.tryUpgrade(row),
    });
    row.card = card;
    row.cardGlow = cardGlow;
    row.nameText = nameText;

    return row;
  }

  /** C2 战机武器绑定：左右切换所选战机（影响开局默认武器 + 元素属性） */
  buildShipSelector(cx, y) {
    const W = SHIPS || [];
    const chipW = 480, chipH = 72;
    const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.add.rectangle(cx, y, chipW, chipH, THEME.chipBg, 0.9).setStrokeStyle(2, THEME.chipStroke);

    // 战机皮肤预览：发光aura（随机型 tint）+ 机型纹理（带轻微浮动/呼吸）
    const px = cx - chipW / 2 + 52;
    this.shipAura = this.add.image(px, y, 'bg_nebula').setScale(0.42).setTint(COLORS.player)
      .setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(1);
    this.shipPreview = this.add.image(px, y, 'player').setScale(1.1).setDepth(2);

    this.add.text(cx - chipW / 2 + 100, y - 16, t('hangarShip'), {
      fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textSection,
    }).setOrigin(0, 0.5);
    this.shipLabel = this.add.text(cx - chipW / 2 + 100, y + 6, '', {
      fontFamily: THEME.fontFamily, fontSize: '17px', fontStyle: '700', color: THEME.white,
    }).setOrigin(0, 0.5);

    // 入场 + 浮动/呼吸（reduced-motion 仅静态显示）
    if (!reduceMotion) {
      this.shipPreview.setAlpha(0); this.shipLabel.setAlpha(0); this.shipAura.setAlpha(0);
      this.tweens.add({ targets: this.shipPreview, alpha: 1, duration: 380, ease: 'Back.easeOut' });
      this.tweens.add({ targets: this.shipLabel, alpha: 1, duration: 380, delay: 120, ease: 'Back.easeOut' });
      this.tweens.add({ targets: this.shipAura, alpha: 0.5, duration: 420, ease: 'Back.easeOut' });
      this.tweens.add({ targets: this.shipPreview, y: y - 5, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: this.shipAura, alpha: { from: 0.32, to: 0.58 }, duration: 1400, delay: 460, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    const mkArrow = (sx, dir) => {
      const a = this.add.container(sx, y);
      const bg = this.add.rectangle(0, 0, 40, 40, THEME.arrowBg, 1).setStrokeStyle(2, THEME.chipStroke);
      const t = this.add.text(0, 0, dir < 0 ? '◀' : '▶', {
        fontFamily: THEME.fontFamily, fontSize: '22px', color: THEME.textPrimary,
      }).setOrigin(0.5);
      a.add([bg, t]);
      a.setSize(40, 40).setInteractive(new Phaser.Geom.Rectangle(-20, -20, 40, 40), Phaser.Geom.Rectangle.Contains);
      a.on('pointerdown', () => {
        const save = SaveManager.load();
        const n = W.length || 1;
        save.selectedShip = (((save.selectedShip != null) ? save.selectedShip : 0) + dir + n) % n;
        SaveManager.save();
        this.refreshShip();
      });
      return a;
    };
    this.shipArrowL = mkArrow(cx - chipW / 2 - 26, -1);
    this.shipArrowR = mkArrow(cx + chipW / 2 + 26, 1);
    this.refreshShip();
  }

  /** 刷新战机标签文本 */
  refreshShip() {
    const W = SHIPS || [];
    if (!this.shipLabel || !W.length) return;
    const save = SaveManager.load();
    const idx = (save.selectedShip != null) ? save.selectedShip : 0;
    const s = W[idx] || W[0];
    const elTxt = s.element ? (ELEMENTS[s.element] ? t(`el_${s.element}`) : s.element) : t('el_none');
    const wTxt = WEAPONS[s.weapon] ? t(`w_${s.weapon}`) : s.weapon;
    this.shipLabel.setText(t('shipLabel', { name: t(`ship_${s.id}`), weapon: wTxt, element: elTxt }));
    // 同步机型皮肤预览：优先皮肤纹理（player_skin_{shipId}_{skinId}），缺失回退 tint（苍鹰青/赤焰橙/寒霜冰蓝）
    const skinId = SaveManager.getSkin(idx);
    const skinKey = shipSkinKey(idx, skinId);
    if (this.shipPreview) {
      if (this.textures.exists(skinKey)) { this.shipPreview.setTexture(skinKey); this.shipPreview.clearTint(); }
      else this.shipPreview.setTint(s.tint || 0xffffff);
    }
    if (this.shipAura) this.shipAura.setTint(s.tint || 0xffffff);
    // UI P2：机库背景星空/光晕色调跟随所选战机 tint
    if (this.starfield) this.starfield.setTint(s.tint || 0);
    // 皮肤 overlay 打开时同步刷新（战机切换 → 皮肤列表跟随）
    if (this.skinsOpen && this.refreshSkinsPanel) this.refreshSkinsPanel();
  }

  /** 开局主武器选择（覆盖战机绑定武器；null=用战机默认） */
  buildStartWeaponSelector(cx, y) {
    const chipW = 460, chipH = 44;
    this.add.rectangle(cx, y, chipW, chipH, THEME.chipBg, 0.9).setStrokeStyle(2, THEME.chipStroke);
    this.add.text(cx - chipW / 2 + 14, y, t('hangarWeapon'), {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textSection,
    }).setOrigin(0, 0.5);
    this.weaponLabel = this.add.text(cx, y, '', {
      fontFamily: THEME.fontFamily, fontSize: '17px', fontStyle: '700', color: THEME.white,
    }).setOrigin(0.5);

    const mkArrow = (sx, dir) => {
      const a = this.add.container(sx, y);
      const bg = this.add.rectangle(0, 0, 40, 40, THEME.arrowBg, 1).setStrokeStyle(2, THEME.chipStroke);
      const t = this.add.text(0, 0, dir < 0 ? '◀' : '▶', {
        fontFamily: THEME.fontFamily, fontSize: '22px', color: THEME.textPrimary,
      }).setOrigin(0.5);
      a.add([bg, t]);
      a.setSize(40, 40).setInteractive(new Phaser.Geom.Rectangle(-20, -20, 40, 40), Phaser.Geom.Rectangle.Contains);
      a.on('pointerdown', () => {
        const save = SaveManager.load();
        const keysAll = ['pulse', 'missile', 'laser', 'bomb'];
        // 状态环：[pulse, missile, laser, bomb, 默认]，dir>0 前进 / dir<0 后退，循环
        const cur = save.startWeapon || null;
        const idx = cur ? keysAll.indexOf(cur) : keysAll.length; // 默认视为末尾之后
        const ni = (idx + dir + keysAll.length + 1) % (keysAll.length + 1);
        save.startWeapon = (ni === keysAll.length) ? null : keysAll[ni];
        SaveManager.save();
        this.refreshWeapon();
      });
    };
    mkArrow(cx - chipW / 2 - 26, -1);
    mkArrow(cx + chipW / 2 + 26, 1);
    this.refreshWeapon();
  }

  /** 刷新开局武器标签 */
  refreshWeapon() {
    const save = SaveManager.load();
    const w = save.startWeapon;
    this.weaponLabel.setText(w && WEAPONS[w] ? t(`w_${w}`) : t('hangarDefaultWeapon'));
  }

  /** 升级花费：baseCost * costMul^当前等级（取整） */
  upgradeCost(key, level) {
    const def = UPGRADE_TREE[key];
    return Math.round(def.baseCost * Math.pow(def.costMul, level));
  }

  /** 根据存档刷新金币、各部件等级/花费与按钮状态 */
  refresh() {
    const save = SaveManager.load();
    const up = save.upgrades || {};
    this.coinText.setText(t('hangarCoins', { coins: save.coins }));

    // P2 体验细节·数值反馈：总战力 + 推荐关卡（纯展示）
    if (this.powerText) {
      const shipIdx = (save.selectedShip != null) ? save.selectedShip : 0;
      const ship = (SHIPS && SHIPS[shipIdx]) ? SHIPS[shipIdx] : (SHIPS ? SHIPS[0] : null);
      const power = calcPower(up, save.modules, ship);
      const rec = recommendLevel(power);
      const lvlName = t(`levelName_${rec}`);
      this.powerText.setText(t('hangarPower', { power, level: lvlName }));
    }

    for (const row of this.rows) {
      const lvl = up[row.key] || 0;
      const maxed = lvl >= row.max;
      row.levelText.setText(t('hangarLevel', { cur: lvl, max: row.max }));

      if (maxed) {
        row.btn.setLabel('MAX');
        row.btn.setBgColor(0x2a3a48);
        row.btn.setEnabled(false);
      } else {
        const cost = this.upgradeCost(row.key, lvl);
        const affordable = save.coins >= cost;
        row.btn.setLabel(`${cost}`);
        row.btn.setBgColor(affordable ? 0x1b6b4a : 0x3a3a3a);
        row.btn.setEnabled(affordable);
      }
    }
  }

  /** 尝试升级：金币足够且未满级才生效 */
  tryUpgrade(row) {
    const save = SaveManager.load();
    const up = save.upgrades || {};
    const lvl = up[row.key] || 0;
    if (lvl >= row.max) return;

    const cost = this.upgradeCost(row.key, lvl);
    if (save.coins < cost) return;

    // P2 体验细节·数值反馈：升级前弹「当前 → 升级后」数值对比（纯展示）
    const def = UPGRADE_TREE[row.key];
    this.lastCompare = {
      key: row.key,
      name: def ? def.name : row.key,
      from: lvl,
      to: lvl + 1,
      cost,
      text: this.upgradeCompareText(row.key, lvl),
    };
    this.flashCompare(this.lastCompare);

    SaveManager.deductCoins(cost);
    if (!save.upgrades) save.upgrades = {};
    save.upgrades[row.key] = lvl + 1;
    SaveManager.addNewbieProgress('hangarUpgrades', 1); // P0 留存-新手计划：D2 机库升级进度（随下方 save 一并落盘）
    SaveManager.save();

    this.refresh();
  }

  /** P2 体验细节·数值反馈：某升级项「当前等级 → 下一级」关键数值文本（只读，不改平衡） */
  upgradeCompareText(key, lvl) {
    const next = lvl + 1;
    switch (key) {
      case 'firepower': {
        const cur = Math.max(70, PLAYER.FIRE_INTERVAL - lvl * 8);
        const aft = Math.max(70, PLAYER.FIRE_INTERVAL - next * 8);
        return t('cmp_firepower', { cur, aft });
      }
      case 'hull': return t('cmp_hull', { cur: lvl * 20, next: next * 20 });
      case 'shield': return t('cmp_shield', { cur: lvl * 15, next: next * 15 });
      case 'magnet': return t('cmp_magnet', { cur: 90 + lvl * 45, next: 90 + next * 45 });
      case 'wingman': return t('cmp_wingman', { cur: lvl, next });
      case 'wingmanFirepower': return t('cmp_wingmanFirepower', { cur: lvl, next });
      default: return t('cmp_default', { cur: lvl, next });
    }
  }

  /** P2 体验细节·数值反馈：升级对比轻提示（浮动面板，不阻塞交互） */
  flashCompare(cmp) {
    if (!cmp) return;
    this.lastCompareText = t('hangarCompareToast', {
      name: t(`up_${cmp.key}`), from: cmp.from, to: cmp.to, text: cmp.text, cost: cmp.cost,
    });
    const cx = GAME_WIDTH / 2;
    const box = this.add.container(cx, GAME_HEIGHT / 2 - 60).setDepth(450);
    const g = this.add.graphics();
    const txt = this.add.text(0, 0, this.lastCompareText, {
      fontFamily: THEME.fontFamily, fontSize: '17px', fontStyle: '800', color: THEME.textGoldLight,
      align: 'center', wordWrap: { width: 420 },
    }).setOrigin(0.5).setShadow(0, 0, '#000000', 8, true, true);
    g.fillStyle(0x0a2236, 0.95).fillRoundedRect(-230, -32, 460, 64, 12);
    g.lineStyle(2, COLORS.accent, 0.85).strokeRoundedRect(-230, -32, 460, 64, 12);
    box.add([g, txt]);
    box.setAlpha(0);
    this.tweens.add({
      targets: box, alpha: 1, y: '-=14', duration: 260, yoyo: true, hold: 1100,
      onComplete: () => box.destroy(),
    });
  }

  /** 通用霓虹按钮（P1 UI：统一复用 NeonButton） */
  makeButton(x, y, label, cb) {
    return new NeonButton(this, x, y, label, { w: 240, h: 60, fontSize: 24, glow: true, onDown: cb }).container;
  }

  // ─────────────────────────────────────────────────────────────
  // P0 机库模块养成面板（三槽 / 库存 / 合成 / 商店 / 战机被动）
  // 与既有 UPGRADE_TREE 升级行并行：模块是独立养成线，互不替代。
  // 面板为挂机库之上的 overlay（depth 300），不影响既有机库布局。
  // ─────────────────────────────────────────────────────────────
  openModules() {
    if (this.modulesOpen) return;
    this.modulesOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.moduleOverlay = ov;

    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    const g = this.add.graphics();
    drawGlassPanel(g, cx, 66, GAME_HEIGHT - 40, 474, THEME.panelRadius);
    ov.add(g);

    // 标题（辉光副本层 + 本体）
    ov.add(this.add.text(cx, 100, t('moduleTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '30px', fontStyle: '800', color: THEME.titleColor,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleColor, 24, true, true).setAlpha(0.3));
    ov.add(this.add.text(cx, 100, t('moduleTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '30px', fontStyle: '800', color: THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 14, true, true));

    // 三槽（武器 / 装甲 / 引擎）
    this.moduleSlotRows = [];
    [158, 224, 290].forEach((y, i) => {
      this.moduleSlotRows.push(this._buildModuleSlotRow(ov, MODULE_SLOTS[i], y));
    });

    // 库存列表（最多展示 6 行，超出提示）
    this.moduleInvLabel = this.add.text(cx - 220, 352, '', {
      fontFamily: THEME.fontFamily, fontSize: '16px', fontStyle: '700', color: THEME.textSection,
    }).setOrigin(0, 0.5);
    ov.add(this.moduleInvLabel);
    this.moduleInvRows = [];
    for (let i = 0; i < 6; i++) {
      this.moduleInvRows.push(this._buildModuleInvRow(ov, null, 382 + i * 38));
    }

    // 合成区（2 个同名同品质 → 高一级）
    ov.add(this.add.text(cx - 220, 612, t('moduleCraftLabel'), {
      fontFamily: THEME.fontFamily, fontSize: '16px', fontStyle: '700', color: THEME.textSection,
    }).setOrigin(0, 0.5));
    this.moduleCraftBtns = [];
    [cx - 150, cx, cx + 150].forEach((x, i) => {
      this.moduleCraftBtns.push(this._buildCraftButton(ov, MODULE_SLOTS[i], x, 654));
    });

    // 商店区
    ov.add(this.add.text(cx - 220, 716, t('moduleShopLabel'), {
      fontFamily: THEME.fontFamily, fontSize: '16px', fontStyle: '700', color: THEME.textSection,
    }).setOrigin(0, 0.5));
    this.moduleShopBtns = [];
    this.moduleShopBtns.push(this._buildShopButton(ov, 'common', cx - 100, 756));
    this.moduleShopBtns.push(this._buildShopButton(ov, 'rare', cx + 100, 756));

    // 战机专属被动说明
    this.modulePassiveText = this.add.text(cx, 816, '', {
      fontFamily: THEME.fontFamily, fontSize: '16px', color: THEME.textGoldLight,
    }).setOrigin(0.5).setAlign('center').setWordWrapWidth(440);
    ov.add(this.modulePassiveText);

    // 关闭
    ov.add(this.makeButton(cx, 884, t('close'), () => this.closeModules()));

    this.refreshModulesPanel();
    this.refresh();
  }

  closeModules() {
    if (this.moduleOverlay) { this.moduleOverlay.destroy(); this.moduleOverlay = null; }
    this.moduleOverlay = null;
    this.modulesOpen = false;
    this.refresh();
  }

  /** 单槽行：槽名 + 当前模块/品质/加成 + 卸下按钮 */
  _buildModuleSlotRow(ov, slotDef, y) {
    const cx = GAME_WIDTH / 2;
    const card = this.add.rectangle(cx, y, 444, 56, THEME.chipBg, 0.92).setStrokeStyle(2, THEME.chipStroke);
    const nameText = this.add.text(cx - 208, y, t(`slot_${slotDef.key}`), {
      fontFamily: THEME.fontFamily, fontSize: '19px', fontStyle: '700', color: THEME.textSection,
    }).setOrigin(0, 0.5);
    const infoText = this.add.text(cx - 150, y, '', {
      fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5).setWordWrapWidth(250);
    const unbtn = new NeonButton(this, cx + 178, y, t('unequip'), {
      w: 76, h: 36, fontSize: 14, stroke: COLORS.accent,
      onDown: () => { this.unequipModule(slotDef.key); },
    });
    ov.add([card, nameText, infoText, unbtn.container]);
    return { slot: slotDef.key, card, nameText, infoText, unbtn };
  }

  /** 库存单行：模块名/品质/加成 + 装备按钮；mod=null 表示空位（隐藏） */
  _buildModuleInvRow(ov, mod, y) {
    const cx = GAME_WIDTH / 2;
    const card = this.add.rectangle(cx, y, 444, 34, THEME.trackBg, 0.8).setStrokeStyle(1, THEME.trackStroke);
    const txt = this.add.text(cx - 208, y, '', {
      fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    const btn = new NeonButton(this, cx + 178, y, t('equip'), {
      w: 66, h: 28, fontSize: 13, stroke: COLORS.accent,
      onDown: () => { if (row.mod) this.equipModule(row.mod.key); },
    });
    ov.add([card, txt, btn.container]);
    const row = { mod, card, txt, btn };
    return row;
  }

  /** 合成按钮（按槽位，2 common → rare） */
  _buildCraftButton(ov, slotDef, x, y) {
    const btn = new NeonButton(this, x, y, '', {
      w: 118, h: 42, fontSize: 14, stroke: 0xb98bff,
      onDown: () => { this.craftModule(slotDef.key); },
    });
    ov.add(btn.container);
    return { slot: slotDef.key, btn };
  }

  /** 商店按钮（common 500 / rare 1200，买随机同品质模块） */
  _buildShopButton(ov, quality, x, y) {
    const btn = new NeonButton(this, x, y, '', {
      w: 190, h: 44, fontSize: 15, stroke: quality === 'rare' ? 0x5aa7ff : 0xffd54a,
      onDown: () => { this.buyModule(quality); },
    });
    ov.add(btn.container);
    return { quality, btn };
  }

  /** 刷新模块面板：槽位/库存/合成/商店/被动全部按存档重绘 */
  refreshModulesPanel() {
    const save = SaveManager.load();
    const modules = save.modules || { weapon: null, armor: null, engine: null };

    // 三槽
    (this.moduleSlotRows || []).forEach((row) => {
      const key = modules[row.slot];
      if (key && MODULES[key]) {
        const def = MODULES[key];
        const q = MODULE_QUALITY[def.quality] || MODULE_QUALITY.common;
        row.infoText.setText(`[${t(`q_${q.key}`)}] ${t(`mod_${def.key}`)} · ${t(`mod_${def.key}_effect`)}`);
        row.infoText.setColor(q.key === 'rare' ? '#8fc9ff' : THEME.textPrimary);
        row.unbtn.setLabel(t('unequip'));
        row.unbtn.setEnabled(true);
      } else {
        row.infoText.setText(t('moduleEmpty'));
        row.infoText.setColor(THEME.textSecondary);
        row.unbtn.setEnabled(false);
      }
    });

    // 库存
    const inv = Array.isArray(save.moduleInv) ? save.moduleInv : [];
    this.moduleInvLabel.setText(t('moduleInvLabel', {
      count: inv.length,
      extra: inv.length > this.moduleInvRows.length ? t('moduleInvMore', { n: this.moduleInvRows.length }) : '',
    }));
    (this.moduleInvRows || []).forEach((row, i) => {
      const mod = inv[i];
      if (!mod) {
        row.card.setVisible(false); row.txt.setVisible(false); row.btn.container.setVisible(false);
        row.mod = null;
        return;
      }
      row.card.setVisible(true); row.txt.setVisible(true); row.btn.container.setVisible(true);
      row.mod = mod;
      const def = MODULES[mod.key];
      const q = MODULE_QUALITY[mod.quality] || MODULE_QUALITY.common;
      const slotDef = MODULE_SLOTS.find((s) => s.key === mod.slot) || { name: mod.slot };
      row.txt.setText(`[${t(`q_${q.key}`)}] ${def ? t(`mod_${def.key}`) : mod.key} · ${t(`slot_${mod.slot}`)} · ${def ? t(`mod_${def.key}_effect`) : ''}`);
      row.txt.setColor(q.key === 'rare' ? '#8fc9ff' : THEME.textPrimary);
    });

    // 合成按钮
    (this.moduleCraftBtns || []).forEach(({ slot, btn }) => {
      const slotDef = MODULE_SLOTS.find((s) => s.key === slot) || { name: slot };
      const n = SaveManager.countCommonModules(slot);
      btn.setLabel(t('moduleCraftBtn', { slot: t(`slot_${slot}`), n }));
      btn.setEnabled(n >= 2);
    });

    // 商店按钮
    (this.moduleShopBtns || []).forEach(({ quality, btn }) => {
      const price = MODULE_SHOP[quality];
      btn.setLabel(t('moduleShopBtn', { quality: t(`q_${quality}`), price }));
      btn.setEnabled(save.coins >= price);
    });

    // 战机专属被动
    const shipIdx = (save.selectedShip != null) ? save.selectedShip : 0;
    const ship = (SHIPS && SHIPS[shipIdx]) ? SHIPS[shipIdx] : (SHIPS ? SHIPS[0] : null);
    if (ship && ship.passive) {
      this.modulePassiveText.setText(t('modulePassive', {
        ship: t(`ship_${ship.id}`),
        desc: t(`passive_${ship.passive.element}`),
      }));
    } else {
      this.modulePassiveText.setText(t('modulePassiveNone'));
    }
  }

  /** 购买随机模块：按品质定价；成功/失败轻提示 */
  buyModule(quality) {
    const res = SaveManager.buyRandomModule(quality);
    this.flashToast(res ? t('moduleBought', { name: t(`mod_${res.key}`) }) : t('notEnoughCoins'));
    this.refreshModulesPanel();
    this.refresh();
  }

  /** 装备模块：从库存装入对应槽位 */
  equipModule(key) {
    if (!key) return;
    if (SaveManager.equipModule(key)) this.flashToast(t('moduleEquipped'));
    this.refreshModulesPanel();
  }

  /** 卸下模块：槽位退回库存 */
  unequipModule(slot) {
    if (SaveManager.unequipModule(slot)) this.flashToast(t('moduleUnequipped'));
    this.refreshModulesPanel();
  }

  /** 合成：2 个同槽普通模块 → 1 个稀有模块 */
  craftModule(slot) {
    const res = SaveManager.craftModule(slot);
    this.flashToast(res ? t('moduleCrafted', { name: t(`mod_${res.key}`) }) : t('moduleCraftFail'));
    this.refreshModulesPanel();
  }

  // ─────────────────────────────────────────────────────────────
  // P2 体验细节·皮肤装饰（overlay：预览 + 购买/切换）
  // 与模块面板同款 overlay（depth 300），不影响机库既有布局。
  // ─────────────────────────────────────────────────────────────
  openSkins() {
    if (this.skinsOpen) return;
    this.skinsOpen = true;
    const cx = GAME_WIDTH / 2;
    const ov = this.add.container(0, 0).setDepth(300);
    this.skinOverlay = ov;

    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0).setInteractive();
    ov.add(dim);
    const g = this.add.graphics();
    drawGlassPanel(g, cx, 80, GAME_HEIGHT - 40, 474, THEME.panelRadius);
    ov.add(g);

    // 标题
    ov.add(this.add.text(cx, 116, t('skinTitle'), {
      fontFamily: THEME.fontFamily, fontSize: '30px', fontStyle: '800', color: THEME.titleBright,
    }).setOrigin(0.5).setShadow(0, 0, THEME.titleShadow, 14, true, true));

    // 预览 + 当前战机名 + 金币
    this.skinPreview = this.add.image(cx - 160, 200, 'player').setScale(1.4).setDepth(2);
    ov.add(this.skinPreview);
    this.skinShipLabel = this.add.text(cx + 12, 186, '', {
      fontFamily: THEME.fontFamily, fontSize: '20px', fontStyle: '700', color: THEME.white,
    }).setOrigin(0, 0.5);
    ov.add(this.skinShipLabel);
    this.skinCoinText = this.add.text(cx + 12, 214, '', {
      fontFamily: THEME.fontFamily, fontSize: '15px', color: THEME.textGold,
    }).setOrigin(0, 0.5);
    ov.add(this.skinCoinText);

    // 皮肤行（当前战机 3 款）
    this.skinRows = [];
    [280, 360, 440].forEach((y) => this.skinRows.push(this._buildSkinRow(ov, y)));

    ov.add(this.makeButton(cx, 884, t('close'), () => this.closeSkins()));

    this.refreshSkinsPanel();
    this.refresh();
  }

  closeSkins() {
    if (this.skinOverlay) { this.skinOverlay.destroy(); this.skinOverlay = null; }
    this.skinsOpen = false;
    this.refresh();
  }

  /** 单个皮肤行：名称 + 状态 + 操作按钮（购买/装备） */
  _buildSkinRow(ov, y) {
    const cx = GAME_WIDTH / 2;
    const card = this.add.rectangle(cx, y, 444, 56, THEME.chipBg, 0.92).setStrokeStyle(2, THEME.chipStroke);
    const nameText = this.add.text(cx - 208, y, '', {
      fontFamily: THEME.fontFamily, fontSize: '18px', fontStyle: '700', color: THEME.textPrimary,
    }).setOrigin(0, 0.5);
    const statusText = this.add.text(cx - 64, y, '', {
      fontFamily: THEME.fontFamily, fontSize: '14px', color: THEME.textSecondary,
    }).setOrigin(0, 0.5);
    const btn = new NeonButton(this, cx + 176, y, '', {
      w: 96, h: 36, fontSize: 14, stroke: COLORS.accent,
      onDown: () => { if (row.skinId != null) this.actSkin(row.skinId); },
    });
    ov.add([card, nameText, statusText, btn.container]);
    const row = { skinId: null, card, nameText, statusText, btn };
    return row;
  }

  /** 刷新皮肤面板：预览贴图 + 当前战机名 + 金币 + 3 行状态/按钮 */
  refreshSkinsPanel() {
    const save = SaveManager.load();
    const shipIdx = (save.selectedShip != null) ? save.selectedShip : 0;
    const ship = (SHIPS && SHIPS[shipIdx]) ? SHIPS[shipIdx] : (SHIPS ? SHIPS[0] : null);
    const skins = getShipSkins(shipIdx);
    const cur = SaveManager.getSkin(shipIdx);
    const key = shipSkinKey(shipIdx, cur);
    if (this.skinPreview) this.skinPreview.setTexture(this.textures.exists(key) ? key : 'player');
    if (this.skinShipLabel) this.skinShipLabel.setText(t('skinShipLabel', {
      ship: ship ? t(`ship_${ship.id}`) : t('hangarShip'),
      skin: (skins[cur] && skins[cur].name) ? t(`skin_${shipIdx}_${cur}`) : '',
    }));
    if (this.skinCoinText) this.skinCoinText.setText(t('hangarCoins', { coins: save.coins }));
    (this.skinRows || []).forEach((row, i) => {
      const def = skins[i];
      if (!def) {
        row.card.setVisible(false); row.nameText.setVisible(false); row.statusText.setVisible(false);
        row.btn.container.setVisible(false); row.skinId = null;
        return;
      }
      row.card.setVisible(true); row.nameText.setVisible(true); row.statusText.setVisible(true); row.btn.container.setVisible(true);
      row.skinId = def.id;
      row.nameText.setText(t(`skin_${shipIdx}_${def.id}`));
      if (def.id === cur) {
        row.statusText.setText(t('skinStatusEquipped'));
        row.btn.setLabel(t('inUse'));
        row.btn.setEnabled(false);
      } else if (SaveManager.ownsSkin(shipIdx, def.id)) {
        row.statusText.setText(t('skinStatusOwned'));
        row.btn.setLabel(t('equip'));
        row.btn.setEnabled(true);
      } else {
        row.statusText.setText(t('skinStatusNotOwned', { price: SKIN_PRICE }));
        row.btn.setLabel(save.coins >= SKIN_PRICE ? t('buy') : t('skinNotEnough'));
        row.btn.setEnabled(save.coins >= SKIN_PRICE);
      }
    });
  }

  /** 皮肤操作：已拥有→切换装备；未拥有→金币购买（成功后自动装备） */
  actSkin(skinId) {
    const save = SaveManager.load();
    const shipIdx = (save.selectedShip != null) ? save.selectedShip : 0;
    if (SaveManager.ownsSkin(shipIdx, skinId)) {
      SaveManager.equipSkin(shipIdx, skinId);
      this.flashToast(t('skinSwitch'));
    } else if (SaveManager.buySkin(shipIdx, skinId)) {
      this.flashToast(t('skinBoughtSwitch'));
    } else {
      this.flashToast(t('notEnoughCoins'));
    }
    this.refreshSkinsPanel();
    this.refresh();
  }

  /** 顶部轻提示（与 MenuScene.flashToast 同款，不阻塞交互） */
  flashToast(msg) {
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, msg, {
      fontFamily: THEME.fontFamily, fontSize: '20px', fontStyle: '800', color: THEME.textGoldLight,
    }).setOrigin(0.5).setDepth(400).setShadow(0, 0, '#000000', 8, true, true).setAlpha(0);
    this.tweens.add({
      targets: t, alpha: 1, y: '-=16', duration: 260, yoyo: true, hold: 900,
      onComplete: () => t.destroy(),
    });
  }

  update(_, dt) {
    if (this.starfield) this.starfield.update(dt);
  }
}
