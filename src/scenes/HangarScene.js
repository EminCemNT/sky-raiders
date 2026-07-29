import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT, COLORS, UPGRADE_TREE, SHIPS, WEAPONS, ELEMENTS } from '../config/GameConfig.js';
import { SaveManager } from '../utils/SaveManager.js';
import { createStarfield } from '../systems/Starfield.js';
import { THEME } from '../utils/UIWidgets.js';

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
const ORDER = ['firepower', 'hull', 'shield', 'magnet', 'wingman'];

export default class HangarScene extends Phaser.Scene {
  constructor() {
    super('HangarScene');
  }

  create() {
    const cx = GAME_WIDTH / 2;

    // 背景滚动星空
    this.starfield = createStarfield(this);

    // 标题
    this.add.text(cx, 92, '机  库', {
      fontFamily: 'sans-serif', fontSize: '50px', fontStyle: '800', color: '#7cf3ff',
    }).setOrigin(0.5).setShadow(0, 0, '#2a86c0', 22, true, true);

    this.add.text(cx, 142, 'HANGAR', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#4a90c0',
    }).setOrigin(0.5).setAlpha(0.8);

    // 金币余额
    this.coinText = this.add.text(cx, 192, '', {
      fontFamily: 'sans-serif', fontSize: '22px', fontStyle: '700', color: '#ffd54a',
    }).setOrigin(0.5);

    // C2 战机武器绑定选择器（在机库里切战机 → 影响开局默认武器/元素）
    this.buildShipSelector(cx, 244);

    // 部件行
    this.rows = [];
    const startY = 312;
    const gap = 104;
    ORDER.forEach((key, i) => {
      this.rows.push(this.buildRow(key, cx, startY + i * gap));
    });

    // 返回菜单按钮
    this.makeButton(cx, GAME_HEIGHT - 70, '返回菜单', () => {
      this.scene.start(SCENES.MENU);
    });

    this.refresh();
  }

  /** 构建单个部件卡片 + 升级按钮，返回可刷新引用 */
  buildRow(key, cx, y) {
    const def = UPGRADE_TREE[key];
    const row = { key, max: def.max };

    // 背景卡片
    this.add.rectangle(cx, y, 480, 92, 0x0d2840, 0.9).setStrokeStyle(2, 0x2f6f96);

    // 名称（部件中文名）
    this.add.text(cx - 222, y - 22, def.name, {
      fontFamily: 'sans-serif', fontSize: '24px', fontStyle: '700', color: '#cfe8ff',
    }).setOrigin(0, 0.5);

    // 等级文本（刷新时填充）
    row.levelText = this.add.text(cx - 222, y + 16, '', {
      fontFamily: 'sans-serif', fontSize: '15px', color: '#88bbdd',
    }).setOrigin(0, 0.5);

    // 升级按钮
    const btn = this.add.container(cx + 168, y);
    const btnBg = this.add.rectangle(0, 0, 120, 56, 0x1b6b4a, 1).setStrokeStyle(2, COLORS.accent);
    const btnLabel = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '20px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5);
    btn.add([btnBg, btnLabel]);
    btn.setSize(120, 56);
    btn.on('pointerover', () => {
      if (btn.input && btn.input.enabled) btnBg.setFillStyle(0x22996a, 1);
    });
    btn.on('pointerout', () => {
      if (btn.input && btn.input.enabled) btnBg.setFillStyle(0x1b6b4a, 1);
    });
    btn.on('pointerdown', () => this.tryUpgrade(row));
    row.btn = btn;
    row.btnBg = btnBg;
    row.btnLabel = btnLabel;

    return row;
  }

  /** C2 战机武器绑定：左右切换所选战机（影响开局默认武器 + 元素属性） */
  buildShipSelector(cx, y) {
    const W = SHIPS || [];
    const chipW = 460, chipH = 44;
    this.add.rectangle(cx, y, chipW, chipH, 0x102a44, 0.9).setStrokeStyle(2, 0x3a7fb0);
    this.add.text(cx - chipW / 2 + 14, y, '战机', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#7fb8e0',
    }).setOrigin(0, 0.5);
    this.shipLabel = this.add.text(cx, y, '', {
      fontFamily: 'sans-serif', fontSize: '17px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5);

    const mkArrow = (sx, dir) => {
      const a = this.add.container(sx, y);
      const bg = this.add.rectangle(0, 0, 40, 40, 0x1b4a6b, 1).setStrokeStyle(2, 0x3a7fb0);
      const t = this.add.text(0, 0, dir < 0 ? '◀' : '▶', {
        fontFamily: 'sans-serif', fontSize: '22px', color: '#cfe8ff',
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
    };
    mkArrow(cx - chipW / 2 - 26, -1);
    mkArrow(cx + chipW / 2 + 26, 1);
    this.refreshShip();
  }

  /** 刷新战机标签文本 */
  refreshShip() {
    const W = SHIPS || [];
    if (!this.shipLabel || !W.length) return;
    const save = SaveManager.load();
    const idx = (save.selectedShip != null) ? save.selectedShip : 0;
    const s = W[idx] || W[0];
    const elTxt = s.element ? (ELEMENTS[s.element] ? ELEMENTS[s.element].name : s.element) : '无';
    const wTxt = WEAPONS[s.weapon] ? WEAPONS[s.weapon].name : s.weapon;
    this.shipLabel.setText(`${s.name} · ${wTxt} · 元素:${elTxt}`);
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
    this.coinText.setText(`金币  ${save.coins}`);

    for (const row of this.rows) {
      const lvl = up[row.key] || 0;
      const maxed = lvl >= row.max;
      row.levelText.setText(`等级  ${lvl} / ${row.max}`);

      if (maxed) {
        row.btnLabel.setText('MAX');
        row.btnBg.setFillStyle(0x2a3a48, 1);
        row.btn.disableInteractive();
      } else {
        const cost = this.upgradeCost(row.key, lvl);
        const affordable = save.coins >= cost;
        row.btnLabel.setText(`${cost}`);
        row.btnBg.setFillStyle(affordable ? 0x1b6b4a : 0x3a3a3a, 1);
        if (affordable) {
          row.btn.setInteractive({ useHandCursor: true });
        } else {
          row.btn.disableInteractive();
        }
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

    SaveManager.deductCoins(cost);
    if (!save.upgrades) save.upgrades = {};
    save.upgrades[row.key] = lvl + 1;
    SaveManager.save();

    this.refresh();
  }

  /** 通用青蓝风按钮（矩形 + 描边），参考 ResultScene.makeButton */
  makeButton(x, y, label, cb) {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, 240, 60, THEME.btnBg, 0.95).setStrokeStyle(2, THEME.btnStroke);
    const t = this.add.text(0, 0, label, {
      fontFamily: 'sans-serif', fontSize: '24px', fontStyle: '700', color: '#ffffff',
    }).setOrigin(0.5);
    c.add([bg, t]);
    c.setSize(240, 60).setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-120, -30, 240, 60),
      hitAreaCallback: (rect, x, y) => rect.contains(x, y),
      useHandCursor: true,
    });
    c.on('pointerover', () => bg.setFillStyle(THEME.btnBgHover, 1));
    c.on('pointerout', () => bg.setFillStyle(THEME.btnBg, 0.95));
    c.on('pointerdown', cb);
    return c;
  }

  update(_, dt) {
    if (this.starfield) this.starfield.update(dt);
  }
}
