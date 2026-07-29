import Phaser from 'phaser';
import { COLORS } from '../config/GameConfig.js';

/**
 * TextureFactory —— 程序化生成全部游戏纹理（科幻扁平霓虹风格）。
 * 取代 public/sprites 下的低清 AI PNG。所有 key 与 entities 引用契约保持一致，
 * 禁止改名/删除：player / enemy_small / enemy_mid / boss / bullet_player /
 * bullet_enemy / coin / powerup / particle / star /
 * item_shield / item_magnet / item_wingman / item_energy / item_heal / item_bomb /
 * item_weapon / bullet_missile
 *
 * 风格要点：扁平矢量机身 + 霓虹描边（亮色）+ 少量高光。
 * Boss 画成近白/灰基底，便于 GameScene 用 setTint(关卡色) 染色。
 */

// 局部美术调色板（绘制层集中管理，避免散落魔法数字）
const C = {
  playerLight: 0xcfeeff,
  playerMid: 0x66ccff,
  playerDeep: 0x1a5a8a,
  playerWing: 0x3aa0d8,
  neonPlayer: 0x9ff0ff,

  enemyLight: 0xff9aa6,
  enemyMid: 0xff5a6e,
  enemyDeep: 0xc01f33,
  neonEnemy: 0xffb3bd,

  enemyMidLight: 0xffd0a0,
  enemyMidMid: 0xff8a3d,
  enemyMidDeep: 0x9a4a10,
  enemyMidCore: 0xffc266,
  neonEnemyMid: 0xffd0a0,

  bossBody: 0xe8eef5,
  bossInner: 0x9aa6b4,
  bossMount: 0x6b7686,
  bossMountLit: 0xd5dde6,
  bossStroke: 0xcfd8e2,
};

export function generateAll(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });

  drawPlayer(g); g.generateTexture('player', 48, 54);
  drawEnemySmall(g); g.generateTexture('enemy_small', 32, 30);
  drawEnemyMid(g); g.generateTexture('enemy_mid', 48, 44);
  drawEnemyDiver(g); g.generateTexture('enemy_diver', 36, 40);
  drawBoss(g); g.generateTexture('boss', 160, 140);
  drawCoin(g); g.generateTexture('coin', 22, 22);
  drawItemShield(g); g.generateTexture('item_shield', 26, 26);
  drawItemMagnet(g); g.generateTexture('item_magnet', 26, 26);
  drawItemWingman(g); g.generateTexture('item_wingman', 26, 26);
  drawItemEnergy(g); g.generateTexture('item_energy', 26, 26);
  drawItemHeal(g); g.generateTexture('item_heal', 26, 26);
  drawItemBomb(g); g.generateTexture('item_bomb', 26, 26);
  drawItemWeapon(g); g.generateTexture('item_weapon', 26, 26);
  drawItemWeaponLaser(g); g.generateTexture('item_weapon_laser', 26, 26);
  drawItemWeaponBomb(g); g.generateTexture('item_weapon_bomb', 26, 26);
  drawBulletPlayer(g); g.generateTexture('bullet_player', 12, 24); // 安全回退（保留）
  drawBulletPulse(g); g.generateTexture('bullet_pulse', 10, 28);
  drawBulletScatter(g); g.generateTexture('bullet_scatter', 14, 14);
  drawBulletMissile(g); g.generateTexture('bullet_missile', 14, 22);
  drawBulletBomb(g); g.generateTexture('bullet_bomb', 18, 18);
  drawBulletEnemy(g); g.generateTexture('bullet_enemy', 18, 18);
  drawPowerup(g); g.generateTexture('powerup', 26, 26);
  drawParticle(g); g.generateTexture('particle', 6, 6);
  drawStar(g); g.generateTexture('star', 4, 4);
  drawBgNebula(g); g.generateTexture('bg_nebula', 256, 256);
  drawBgCloud(g); g.generateTexture('bg_cloud', 160, 80);
  drawBgAsteroid(g); g.generateTexture('bg_asteroid', 48, 40);
  drawBgBuilding(g); g.generateTexture('bg_building', 64, 120);

  g.destroy();
}

// ─── 玩家战机：扁平箭形 + 后掠翼 + 霓虹描边 ────────────────────────
function drawPlayer(g) {
  g.clear();
  // 外发光
  g.fillStyle(COLORS.player, 0.16);
  g.fillTriangle(24, -4, 4, 54, 44, 54);
  // 后掠翼
  g.fillStyle(C.playerWing, 1);
  g.fillTriangle(24, 16, 2, 50, 18, 44);
  g.fillTriangle(24, 16, 46, 50, 30, 44);
  // 主机身（浅->深渐变）
  g.fillGradientStyle(C.playerLight, C.playerMid, C.playerMid, C.playerDeep, 1);
  g.fillTriangle(24, 2, 12, 50, 36, 50);
  // 中线高光
  g.fillStyle(0xeaffff, 0.9);
  g.fillTriangle(24, 8, 20, 46, 28, 46);
  // 驾驶舱
  g.fillStyle(0x0a2a44, 1);
  g.fillEllipse(24, 26, 12, 16);
  g.fillStyle(C.neonPlayer, 1);
  g.fillEllipse(24, 24, 7, 11);
  // 引擎喷口
  g.fillStyle(C.playerMid, 1);
  g.fillCircle(16, 50, 3.6);
  g.fillCircle(32, 50, 3.6);
  // 霓虹描边
  g.lineStyle(2, C.neonPlayer, 0.9);
  g.strokeTriangle(24, 2, 12, 50, 36, 50);
}

// ─── 小型敌机「侦察机」：轻薄三角 + 小引擎光点 ────────────────────
function drawEnemySmall(g) {
  g.clear();
  // 外发光（红 0xff5a6e）
  g.fillStyle(COLORS.enemy, 0.2);
  g.fillTriangle(2, 0, 30, 0, 16, 30);
  // 轻薄机身（细长三角）
  g.fillGradientStyle(C.enemyLight, C.enemyMid, C.enemyMid, C.enemyDeep, 1);
  g.fillTriangle(5, 2, 27, 2, 16, 28);
  // 纤细小翼
  g.fillStyle(0xc83045, 1);
  g.fillTriangle(5, 4, 0, 14, 9, 11);
  g.fillTriangle(27, 4, 32, 14, 23, 11);
  // 座舱
  g.fillStyle(0x5a0f1a, 1);
  g.fillCircle(16, 13, 3.2);
  g.fillStyle(0xffe27a, 1);
  g.fillCircle(16, 13, 1.8);
  // 小引擎光点
  g.fillStyle(0x8fe3ff, 1);
  g.fillCircle(16, 26, 1.8);
  // 霓虹描边
  g.lineStyle(1.3, C.neonEnemy, 0.85);
  g.strokeTriangle(5, 2, 27, 2, 16, 28);
}

// ─── 中型敌机「轰炸机」：宽扁菱形装甲 + 双炮塔 ──────────────────
function drawEnemyMid(g) {
  g.clear();
  // 外发光
  g.fillStyle(0xff8a3d, 0.2);
  g.fillPoints([{ x: 24, y: -6 }, { x: 54, y: 26 }, { x: 24, y: 50 }, { x: -6, y: 26 }], true);
  // 宽扁装甲机身
  g.fillGradientStyle(C.enemyMidLight, C.enemyMidMid, C.enemyMidMid, C.enemyMidDeep, 1);
  g.fillPoints([{ x: 24, y: 2 }, { x: 46, y: 26 }, { x: 24, y: 42 }, { x: 2, y: 26 }], true);
  // 装甲块
  g.fillStyle(0x7a3a08, 1);
  g.fillRect(8, 22, 6, 8);
  g.fillRect(34, 22, 6, 8);
  // 双炮塔
  g.fillStyle(0x4a2404, 1);
  g.fillRect(4, 30, 9, 8);
  g.fillRect(35, 30, 9, 8);
  g.fillStyle(C.enemyMidCore, 1);
  g.fillCircle(8.5, 34, 2.2);
  g.fillCircle(39.5, 34, 2.2);
  // 核心
  g.fillStyle(0x3a1d06, 1);
  g.fillCircle(24, 26, 8);
  g.fillStyle(C.enemyMidCore, 1);
  g.fillCircle(24, 26, 5);
  g.fillStyle(0xfff3d0, 1);
  g.fillCircle(24, 26, 2);
  // 霓虹描边
  g.lineStyle(2, C.neonEnemyMid, 0.8);
  g.strokePoints([{ x: 24, y: 2 }, { x: 46, y: 26 }, { x: 24, y: 42 }, { x: 2, y: 26 }], true);
}

// ─── Boss：近白/灰基底，便于 setTint(关卡色) 染色 ─────────────────
function drawBoss(g) {
  g.clear();
  const R = 70, cx = 80, cy = 70;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.8 });
  }
  g.fillStyle(0xffffff, 0.12);
  g.fillPoints(pts.map((p) => ({ x: cx + (p.x - cx) * 1.1, y: cy + (p.y - cy) * 1.1 })), true);
  g.fillStyle(C.bossBody, 1);
  g.fillPoints(pts, true);
  const inner = pts.map((p) => ({ x: cx + (p.x - cx) * 0.62, y: cy + (p.y - cy) * 0.62 }));
  g.fillStyle(C.bossInner, 1);
  g.fillPoints(inner, true);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(cx, cy, 30);
  g.fillStyle(0xcfe0f0, 1);
  g.fillCircle(cx, cy, 18);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const tx = cx + Math.cos(a) * 48, ty = cy + Math.sin(a) * 38;
    g.fillStyle(C.bossMount, 1);
    g.fillCircle(tx, ty, 7);
    g.fillStyle(C.bossMountLit, 1);
    g.fillCircle(tx, ty, 3);
  }
  g.lineStyle(3, C.bossStroke, 0.9);
  g.strokePoints(pts, true);
}

// ─── 金币：金色圆 + 高光 ─────────────────────────────────────────
function drawCoin(g) {
  g.clear();
  g.fillStyle(COLORS.coin, 0.3);
  g.fillCircle(11, 11, 11);
  g.fillGradientStyle(0xfff3b0, 0xffe27a, 0xe0a91f, 0xb8860b, 1);
  g.fillCircle(11, 11, 9);
  g.fillStyle(0xb8860b, 1);
  g.fillCircle(11, 11, 6);
  g.fillStyle(0xfff3b0, 0.9);
  g.fillCircle(8, 8, 2.5);
  g.lineStyle(1.5, 0xfff3b0, 0.7);
  g.strokeCircle(11, 11, 9);
}

// ─── 道具：护盾 ──────────────────────────────────────────────────
function drawItemShield(g) {
  g.clear();
  g.fillStyle(0x3ad1ff, 1);
  g.fillCircle(13, 13, 12);
  g.fillStyle(0x0a3a55, 1);
  g.fillCircle(13, 13, 7);
  g.fillStyle(0x9ff0ff, 0.95);
  g.fillTriangle(13, 4, 7, 13, 19, 13);
}

// ─── 道具：磁力（马蹄） ─────────────────────────────────────────
function drawItemMagnet(g) {
  g.clear();
  g.fillStyle(0xff4d6d, 1);
  g.fillRoundedRect(2, 2, 22, 12, 5);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(7, 4, 12, 8, 3);
  g.fillStyle(0x223344, 1);
  g.fillRect(6, 14, 4, 10);
  g.fillRect(16, 14, 4, 10);
}

// ─── 道具：僚机（双机） ─────────────────────────────────────────
function drawItemWingman(g) {
  g.clear();
  g.fillStyle(0x4dff9b, 1);
  g.fillTriangle(4, 22, 4, 6, 14, 16);
  g.fillTriangle(22, 22, 22, 6, 12, 16);
}

// ─── 道具：能量（星爆） ─────────────────────────────────────────
function drawItemEnergy(g) {
  g.clear();
  g.fillStyle(0xb98bff, 1);
  g.fillPoints([
    { x: 13, y: 1 }, { x: 17, y: 9 }, { x: 25, y: 13 }, { x: 17, y: 17 },
    { x: 13, y: 25 }, { x: 9, y: 17 }, { x: 1, y: 13 }, { x: 9, y: 9 },
  ], true);
  g.fillStyle(0xffffff, 0.85);
  g.fillCircle(13, 13, 3);
}

// ─── 道具：治疗（十字） ─────────────────────────────────────────
function drawItemHeal(g) {
  g.clear();
  g.fillStyle(0xff5566, 1);
  g.fillCircle(13, 13, 12);
  g.fillStyle(0xffffff, 1);
  g.fillRect(10, 5, 6, 16);
  g.fillRect(5, 10, 16, 6);
}

// ─── 道具：炸弹 ──────────────────────────────────────────────────
function drawItemBomb(g) {
  g.clear();
  g.fillStyle(0x2a2a3a, 1);
  g.fillCircle(13, 15, 11);
  g.fillStyle(0xffaa44, 1);
  g.fillCircle(13, 15, 5);
  g.lineStyle(2, 0xffcc66, 1);
  g.beginPath();
  g.moveTo(13, 4);
  g.lineTo(18, 0);
  g.strokePath();
}

// ─── 道具：武器箱（追踪导弹） ──────────────────────────────────
function drawItemWeapon(g) {
  g.clear();
  // 外壳（橙红箱）
  g.fillStyle(0x2a1410, 1);
  g.fillRoundedRect(0, 0, 26, 26, 5);
  g.lineStyle(2, 0xff8a3d, 0.9);
  g.strokeRoundedRect(1, 1, 24, 24, 5);
  // 导弹（朝上，带尾翼）
  g.fillStyle(0xff5a3c, 1);
  g.fillTriangle(13, 5, 9, 16, 17, 16);     // 弹头
  g.fillStyle(0xffd0a0, 1);
  g.fillRect(10, 14, 6, 7);                  // 弹体
  g.fillStyle(0xffcc44, 1);
  g.fillTriangle(9, 21, 10, 17, 13, 21);     // 左尾翼
  g.fillTriangle(17, 21, 16, 17, 13, 21);    // 右尾翼
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(13, 9, 1.6);                  // 高光
}

// ─── 道具：武器箱（激光） ─────────────────────────────────────
function drawItemWeaponLaser(g) {
  g.clear();
  g.fillStyle(0x0a2436, 1);
  g.fillRoundedRect(0, 0, 26, 26, 5);
  g.lineStyle(2, 0x6fd6ff, 0.9);
  g.strokeRoundedRect(1, 1, 24, 24, 5);
  // 激光束（蓝白竖向光束）
  g.fillStyle(0x6fd6ff, 0.4);
  g.fillRect(11, 3, 4, 20);
  g.fillStyle(0xffffff, 1);
  g.fillRect(12.5, 3, 1, 20);
  // 发射口
  g.fillStyle(0x9ff0ff, 1);
  g.fillTriangle(13, 2, 9, 7, 17, 7);
}

// ─── 道具：武器箱（元素炸弹） ─────────────────────────────────
function drawItemWeaponBomb(g) {
  g.clear();
  g.fillStyle(0x2a1430, 1);
  g.fillRoundedRect(0, 0, 26, 26, 5);
  g.lineStyle(2, 0xff9a4a, 0.9);
  g.strokeRoundedRect(1, 1, 24, 24, 5);
  // 元素圆弹（橙红 + 白芯，带三色点暗示元素）
  g.fillStyle(0xff7a3a, 1);
  g.fillCircle(13, 14, 8);
  g.fillStyle(0xffd0a0, 1);
  g.fillCircle(13, 14, 4.5);
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(13, 14, 1.8);
  g.fillStyle(0xffe14a, 1);
  g.fillCircle(9, 11, 1.4);
  g.fillStyle(0x6fd6ff, 1);
  g.fillCircle(17, 12, 1.4);
}

// ─── 玩家元素炸弹：橙红圆弹 + 白芯（18×18）─────────────────
function drawBulletBomb(g) {
  g.clear();
  // 外发光
  g.fillStyle(0xff7a3a, 0.3);
  g.fillCircle(9, 9, 9);
  // 球体渐变
  g.fillGradientStyle(0xffd0a0, 0xff7a3a, 0xff5a3c, 0xd93420, 1);
  g.fillCircle(9, 9, 7);
  // 高光
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(6.5, 6.5, 2.2);
  // 元素芯点
  g.fillStyle(0xffe14a, 0.9);
  g.fillCircle(9, 10, 1.6);
}

// ─── 玩家子弹：青色能量弹（明显柔光晕，作安全回退）─────────────
function drawBulletPlayer(g) {
  g.clear();
  // 更明显的青色柔光晕（双层）
  g.fillStyle(0x66ccff, 0.22);
  g.fillRoundedRect(0, 0, 12, 24, 6);
  g.fillStyle(COLORS.playerBullet, 0.34);
  g.fillRoundedRect(1, 1, 10, 22, 6);
  // 核心渐变
  g.fillGradientStyle(0xffffff, 0xffffff, 0x8fe3ff, 0x66ccff, 1);
  g.fillRoundedRect(2, 1, 8, 22, 4);
  // 亮芯线
  g.fillStyle(0xffffff, 0.95);
  g.fillRoundedRect(4, 3, 4, 14, 2);
}

// ─── 敌弹：红橙发光球 + 白色高光点 ─────────────────────────────
function drawBulletEnemy(g) {
  g.clear();
  // 外发光（红橙）
  g.fillStyle(COLORS.enemyBullet, 0.34);
  g.fillCircle(9, 9, 9);
  // 球体渐变 红→橙
  g.fillGradientStyle(0xffd0a0, 0xff7a3c, 0xff5a3c, 0xd93420, 1);
  g.fillCircle(9, 9, 7);
  // 脉冲内圈
  g.fillStyle(0xff5a3c, 0.5);
  g.fillCircle(9, 9, 5);
  // 白色高光点
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(6.5, 6.5, 2.2);
}

// ─── 通用道具箱（保留兼容） ─────────────────────────────────────
function drawPowerup(g) {
  g.clear();
  g.fillStyle(0x2fd18b, 1);
  g.fillRoundedRect(0, 0, 26, 26, 5);
  g.fillStyle(0xffffff, 1);
  g.fillRect(11, 4, 4, 18);
  g.fillRect(4, 11, 18, 4);
}

// ─── 通用粒子（白方，可 tint 复用） ─────────────────────────────
function drawParticle(g) {
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 6, 6);
}

// ─── 背景星点 ────────────────────────────────────────────────────
function drawStar(g) {
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(2, 2, 2);
}

// ─── 俯冲机「diver」：尖锐前掠翼 + 品红细长机身（36×40）──────────
function drawEnemyDiver(g) {
  g.clear();
  // 外发光（品红/深红 0xff3df0）
  g.fillStyle(0xff3df0, 0.18);
  g.fillTriangle(18, 0, 0, 40, 36, 40);
  // 细长机身
  g.fillGradientStyle(0xff9af2, 0xff3df0, 0xff3df0, 0x8a106f, 1);
  g.fillTriangle(18, 3, 12, 34, 24, 34);
  // 前掠翼（翼尖前于翼根）
  g.fillStyle(0xd11fc0, 1);
  g.fillTriangle(14, 12, 2, 32, 14, 26);
  g.fillTriangle(22, 12, 34, 32, 22, 26);
  // 座舱
  g.fillStyle(0x2a0820, 1);
  g.fillEllipse(18, 19, 7, 11);
  g.fillStyle(0xffd0f5, 1);
  g.fillEllipse(18, 18, 3.5, 6);
  // 引擎光
  g.fillStyle(0xff7af0, 1);
  g.fillCircle(18, 35, 2);
  // 霓虹描边
  g.lineStyle(1.5, 0xff9af2, 0.85);
  g.strokeTriangle(18, 3, 12, 34, 24, 34);
}

// ─── 玩家脉冲弹：青色细长光束（10×28）────────────────────────
function drawBulletPulse(g) {
  g.clear();
  // 柔光晕
  g.fillStyle(0x66ccff, 0.22);
  g.fillRoundedRect(0, 0, 10, 28, 5);
  // 核心渐变
  g.fillGradientStyle(0xffffff, 0xffffff, 0x8fe3ff, 0x66ccff, 1);
  g.fillRoundedRect(2, 1, 6, 26, 3);
  // 亮芯线
  g.fillStyle(0xffffff, 0.95);
  g.fillRoundedRect(4, 3, 2, 22, 1);
}

// ─── 玩家散射弹：浅蓝短粗脉冲（14×14）────────────────────────
function drawBulletScatter(g) {
  g.clear();
  // 柔光晕
  g.fillStyle(0x9fd8ff, 0.3);
  g.fillCircle(7, 7, 7);
  // 球体渐变
  g.fillGradientStyle(0xffffff, 0xbfe8ff, 0x9fd8ff, 0x66ccff, 1);
  g.fillCircle(7, 7, 5);
  // 高光
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(5, 5, 1.8);
}

// ─── 玩家追踪导弹：青橙小火箭（14×22）──────────────────────
function drawBulletMissile(g) {
  g.clear();
  // 外发光（橙）
  g.fillStyle(0xff8a3d, 0.25);
  g.fillRoundedRect(1, 0, 12, 22, 5);
  // 弹头（橙）
  g.fillStyle(0xff5a3c, 1);
  g.fillTriangle(7, 0, 2, 8, 12, 8);
  // 弹体（白青）
  g.fillGradientStyle(0xffffff, 0xffffff, 0x8fe3ff, 0x66ccff, 1);
  g.fillRoundedRect(2, 6, 10, 12, 3);
  // 尾翼
  g.fillStyle(0xffcc44, 1);
  g.fillTriangle(2, 14, 0, 20, 4, 18);
  g.fillTriangle(12, 14, 14, 20, 10, 18);
  // 高光芯
  g.fillStyle(0xffffff, 0.95);
  g.fillRoundedRect(5, 8, 3, 9, 1.5);
}

// ─── 背景：星云（256×256 径向柔光，白色基底便于 tint）──────────
function drawBgNebula(g) {
  g.clear();
  const cx = 128, cy = 128;
  for (let r = 128; r > 0; r -= 6) {
    const t = 1 - r / 128; // 中心亮、边缘透明
    g.fillStyle(0xffffff, 0.018 + t * 0.05);
    g.fillCircle(cx, cy, r);
  }
}

// ─── 背景：云层（160×80 软椭圆，白色基底便于 tint）────────────
function drawBgCloud(g) {
  g.clear();
  const cx = 80, cy = 40;
  for (let i = 40; i > 0; i -= 4) {
    const t = 1 - i / 40;
    g.fillStyle(0xffffff, 0.02 + t * 0.05);
    g.fillEllipse(cx, cy, i * 4, i * 2);
  }
}

// ─── 背景：陨石剪影（48×40 不规则岩块，白色基底便于 tint）────
function drawBgAsteroid(g) {
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillPoints([
    { x: 24, y: 2 }, { x: 38, y: 10 }, { x: 44, y: 22 },
    { x: 36, y: 36 }, { x: 20, y: 39 }, { x: 6, y: 32 },
    { x: 2, y: 18 }, { x: 10, y: 6 },
  ], true);
  // 内部暗斑（tint 后呈深浅变化）
  g.fillStyle(0xcccccc, 1);
  g.fillCircle(18, 16, 5);
  g.fillCircle(30, 24, 3.5);
  g.fillStyle(0xaaaaaa, 1);
  g.fillCircle(14, 28, 3);
}

// ─── 背景：楼群剪影（64×120 楼群，白色基底便于 tint）──────────
function drawBgBuilding(g) {
  g.clear();
  g.fillStyle(0xffffff, 1);
  // 楼体（错落矩形拼出天际线）
  g.fillRect(2, 40, 14, 80);
  g.fillRect(18, 20, 12, 100);
  g.fillRect(32, 52, 10, 68);
  g.fillRect(44, 8, 16, 112);
  // 顶部细节
  g.fillRect(46, 0, 4, 14);
  g.fillRect(50, 0, 4, 22);
  // 窗户微光（tint 后呈浅色点）
  g.fillStyle(0xdddddd, 1);
  for (let yy = 30; yy < 116; yy += 14) {
    g.fillRect(48, yy, 3, 5);
    g.fillRect(54, yy + 6, 3, 5);
  }
}
