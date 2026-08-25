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
  drawItemPower(g); g.generateTexture('item_power', 26, 26);
  drawItemElement(g); g.generateTexture('item_element', 26, 26);
  // UI 矢量图标（取代跨端字形不一致的 emoji：🏅/🔒，append-only 新增 key）
  drawIconMedal(g); g.generateTexture('icon_medal', 26, 26);
  drawIconLock(g); g.generateTexture('icon_lock', 26, 26);
  drawBulletPlayer(g); g.generateTexture('bullet_player', 12, 24); // 安全回退（保留）
  drawBulletPulse(g); g.generateTexture('bullet_pulse', 10, 28);
  drawBulletScatter(g); g.generateTexture('bullet_scatter', 14, 14);
  drawBulletMissile(g); g.generateTexture('bullet_missile', 14, 22);
  drawBulletBomb(g); g.generateTexture('bullet_bomb', 18, 18);
  // 元素弹（战斗机元素主炮替换纹理，仅纯追加 key，不改既有 key）
  drawBulletFire(g); g.generateTexture('bullet_fire', 10, 28);
  drawBulletIce(g); g.generateTexture('bullet_ice', 10, 28);
  drawBulletThunder(g); g.generateTexture('bullet_thunder', 10, 28);
  // 可选：激光辉光核叠加图（激光束为实时双层矩形，此图备用）
  drawBeamGlow(g); g.generateTexture('beam_glow', 24, 64);
  drawBulletEnemy(g); g.generateTexture('bullet_enemy', 18, 18);
  drawPowerup(g); g.generateTexture('powerup', 26, 26);
  drawParticle(g); g.generateTexture('particle', 6, 6);
  // 粒子多纹理（UI P2）：圆点/长条/星形，供 VFX 按用途分派（可 tint 复用）
  drawParticleDot(g); g.generateTexture('particle_dot', 8, 8);
  drawParticleStreak(g); g.generateTexture('particle_streak', 8, 24);
  drawParticleSpark(g); g.generateTexture('particle_spark', 16, 16);
  drawStar(g); g.generateTexture('star', 4, 4);
  drawBgNebula(g); g.generateTexture('bg_nebula', 256, 256);
  drawBgCloud(g); g.generateTexture('bg_cloud', 160, 80);
  drawBgAsteroid(g); g.generateTexture('bg_asteroid', 48, 40);
  drawBgBuilding(g); g.generateTexture('bg_building', 64, 120);
  drawGlowSoft(g); g.generateTexture('glow_soft', 512, 512);    // P3 柔光贴图（光效纪律白名单：机/弹/爆/拾取）
  drawBgGlowband(g); g.generateTexture('bg_glowband', 512, 96); // P3 背景底部地平线光带

  g.destroy();
}

// ─── 玩家战机：体积渐变 + 双层描边 + 高光（48×54）────────────────
function drawPlayer(g) {
  g.clear();
  // 外发光（柔光晕）
  g.fillStyle(COLORS.player, 0.16);
  g.fillTriangle(24, -2, 2, 52, 46, 52);
  // 后掠翼（翼根深、翼尖亮）
  g.fillStyle(C.playerWing, 1);
  g.fillTriangle(24, 14, 1, 47, 19, 44);
  g.fillTriangle(24, 14, 47, 47, 29, 44);
  // 翼尖亮点
  g.fillStyle(0xeaffff, 0.9);
  g.fillCircle(4, 46, 1.8);
  g.fillCircle(44, 46, 1.8);
  // 主机身（体积渐变：浅->深）
  g.fillGradientStyle(C.playerLight, C.playerMid, C.playerMid, C.playerDeep, 1);
  g.fillTriangle(24, 3, 14, 50, 34, 50);
  // 机腹加深色阴影带
  g.fillStyle(C.playerDeep, 0.45);
  g.fillTriangle(24, 30, 16, 50, 32, 50);
  // 中线细长能量核心（亮）
  g.fillStyle(0xeaffff, 1);
  g.fillRoundedRect(22.5, 10, 3, 30, 1.5);
  g.fillStyle(0xffffff, 0.9);
  g.fillRoundedRect(23.5, 12, 1, 22, 0.5);
  // 座舱
  g.fillStyle(0x0a2a44, 1);
  g.fillEllipse(24, 24, 13, 17);
  g.fillStyle(C.neonPlayer, 1);
  g.fillEllipse(24, 22, 8, 12);
  // 座舱玻璃白高光点
  g.fillStyle(0xffffff, 0.95);
  g.fillEllipse(21, 18, 3, 5);
  // 双喷口（内白外彩双圈）
  g.fillStyle(C.playerMid, 1);
  g.fillCircle(16, 50, 4.2);
  g.fillCircle(32, 50, 4.2);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(16, 50, 1.8);
  g.fillCircle(32, 50, 1.8);
  // 双层描边：外发光(宽,低透) + 主霓虹(细,亮)
  g.lineStyle(3, C.neonPlayer, 0.28);
  g.strokeTriangle(24, 3, 14, 50, 34, 50);
  g.strokeTriangle(24, 14, 1, 47, 19, 44);
  g.strokeTriangle(24, 14, 47, 47, 29, 44);
  g.lineStyle(2, C.neonPlayer, 0.95);
  g.strokeTriangle(24, 3, 14, 50, 34, 50);
}

// ─── 小型敌机「侦察机」：机体阴影 + 中线高光 + 双层描边（32×30）──
function drawEnemySmall(g) {
  g.clear();
  // 外发光（红）
  g.fillStyle(COLORS.enemy, 0.2);
  g.fillTriangle(2, 0, 30, 0, 16, 30);
  // 轻薄机身（细长三角）
  g.fillGradientStyle(C.enemyLight, C.enemyMid, C.enemyMid, C.enemyDeep, 1);
  g.fillTriangle(5, 2, 27, 2, 16, 28);
  // 机体阴影层（下部更深）
  g.fillStyle(C.enemyDeep, 0.4);
  g.fillTriangle(16, 14, 9, 27, 23, 27);
  // 中线高光
  g.fillStyle(0xffe2e6, 0.85);
  g.fillEllipse(16, 13, 3, 13);
  // 座舱 + 反光白点
  g.fillStyle(0x5a0f1a, 1);
  g.fillCircle(16, 13, 3.2);
  g.fillStyle(0xfff0c0, 1);
  g.fillCircle(16, 12, 1.6);
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(15, 11, 0.9);
  // 小引擎光点
  g.fillStyle(0x8fe3ff, 1);
  g.fillCircle(16, 26, 1.8);
  // 双层描边
  g.lineStyle(2.4, C.neonEnemy, 0.3);
  g.strokeTriangle(5, 2, 27, 2, 16, 28);
  g.lineStyle(1.3, C.neonEnemy, 0.9);
  g.strokeTriangle(5, 2, 27, 2, 16, 28);
}

// ─── 中型敌机「轰炸机」：装甲斜面高光 + 炮口红芯 + 能量环（48×44）──
function drawEnemyMid(g) {
  g.clear();
  const cx = 24, cy = 22;
  const diamond = [
    { x: cx, y: 2 }, { x: 46, y: cy }, { x: cx, y: 42 }, { x: 2, y: cy },
  ];
  // 外发光
  g.fillStyle(0xff8a3d, 0.2);
  g.fillPoints(diamond.map((p) => ({ x: cx + (p.x - cx) * 1.08, y: cy + (p.y - cy) * 1.08 })), true);
  // 宽扁装甲机身
  g.fillGradientStyle(C.enemyMidLight, C.enemyMidMid, C.enemyMidMid, C.enemyMidDeep, 1);
  g.fillPoints(diamond, true);
  // 菱形机身 4 角暗角
  g.fillStyle(C.enemyMidDeep, 0.5);
  g.fillTriangle(cx, 2, cx - 6, 9, cx + 6, 9);
  g.fillTriangle(46, cy, 39, cy - 6, 39, cy + 6);
  g.fillTriangle(cx, 42, cx - 6, 35, cx + 6, 35);
  g.fillTriangle(2, cy, 9, cy - 6, 9, cy + 6);
  // 装甲块斜面高光
  g.fillStyle(C.enemyMidLight, 0.85);
  g.fillRect(8, 22, 7, 9);
  g.fillRect(33, 22, 7, 9);
  // 双炮口红芯
  g.fillStyle(0x3a1204, 1);
  g.fillCircle(11.5, 34, 3);
  g.fillCircle(36.5, 34, 3);
  g.fillStyle(0xff3a2a, 1);
  g.fillCircle(11.5, 34, 1.6);
  g.fillCircle(36.5, 34, 1.6);
  // 中央脉动能量环（外圈 + 白芯）
  g.lineStyle(2.4, C.enemyMidCore, 0.9);
  g.strokeCircle(cx, cy, 9);
  g.fillStyle(C.enemyMidCore, 1);
  g.fillCircle(cx, cy, 5);
  g.fillStyle(0xfff3d0, 1);
  g.fillCircle(cx, cy, 2.2);
  // 双层描边
  g.lineStyle(2.6, C.neonEnemyMid, 0.3);
  g.strokePoints(diamond, true);
  g.lineStyle(2, C.neonEnemyMid, 0.85);
  g.strokePoints(diamond, true);
}

// ─── Boss：近白/灰基底，便于 setTint(关卡色) 染色（160×140）──────
function drawBoss(g) {
  g.clear();
  const R = 64, cx = 80, cy = 70;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.82 });
  }
  // 外缘 1px ADD 外发光层（低透白，setTint 后呈关卡色光晕）
  g.fillStyle(0xffffff, 0.1);
  g.fillPoints(pts.map((p) => ({ x: cx + (p.x - cx) * 1.08, y: cy + (p.y - cy) * 1.08 })), true);
  g.lineStyle(4, 0xffffff, 0.12);
  g.strokePoints(pts.map((p) => ({ x: cx + (p.x - cx) * 1.08, y: cy + (p.y - cy) * 1.08 })), true);
  // 机体
  g.fillStyle(C.bossBody, 1);
  g.fillPoints(pts, true);
  const inner = pts.map((p) => ({ x: cx + (p.x - cx) * 0.62, y: cy + (p.y - cy) * 0.62 }));
  g.fillStyle(C.bossInner, 1);
  g.fillPoints(inner, true);
  // 内发光核心（中心白圆 + 光晕）
  g.fillStyle(0xffffff, 0.18);
  g.fillCircle(cx, cy, 40);
  g.fillStyle(0xffffff, 0.32);
  g.fillCircle(cx, cy, 26);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(cx, cy, 20);
  g.fillStyle(0xcfe0f0, 1);
  g.fillCircle(cx, cy, 11);
  // 6 炮座充能环
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const tx = cx + Math.cos(a) * 46, ty = cy + Math.sin(a) * 36;
    g.fillStyle(C.bossMount, 1);
    g.fillCircle(tx, ty, 8);
    g.fillStyle(C.bossMountLit, 1);
    g.fillCircle(tx, ty, 4);
    g.lineStyle(1.5, 0xffffff, 0.7);
    g.strokeCircle(tx, ty, 8);
  }
  // 主描边
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

// ─── 玩家元素炸弹：螺旋能量纹 + 脉动白芯 + 三色点（18×18）──────
function drawBulletBomb(g) {
  g.clear();
  // 外发光
  g.fillStyle(0xff7a3a, 0.3);
  g.fillCircle(9, 9, 9);
  // 球体渐变
  g.fillGradientStyle(0xffd0a0, 0xff7a3a, 0xff5a3c, 0xd93420, 1);
  g.fillCircle(9, 9, 7);
  // 螺旋能量纹（两段弧）
  g.lineStyle(1.4, 0xffe14a, 0.9);
  g.beginPath();
  g.arc(9, 9, 4.5, 0, Math.PI * 1.3);
  g.strokePath();
  g.lineStyle(1.4, 0xffffff, 0.8);
  g.beginPath();
  g.arc(9, 9, 4.5, Math.PI * 1.3, Math.PI * 2);
  g.strokePath();
  // 脉动白芯
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(9, 9, 2.4);
  // 三色点（暗示元素）
  g.fillStyle(0xffe14a, 0.9);
  g.fillCircle(5, 6, 1.2);
  g.fillStyle(0x6fd6ff, 0.9);
  g.fillCircle(13, 7, 1.2);
  g.fillStyle(0xff7a3a, 0.9);
  g.fillCircle(9, 13, 1.2);
}

// ─── 玩家子弹：青色能量弹（明显柔光晕，作安全回退；P3 辉光+10%/亮芯收窄）─
function drawBulletPlayer(g) {
  g.clear();
  // 更明显的青色柔光晕（双层；alpha +10%）
  g.fillStyle(0x66ccff, 0.24);
  g.fillRoundedRect(0, 0, 12, 24, 6);
  g.fillStyle(COLORS.playerBullet, 0.37);
  g.fillRoundedRect(1, 1, 10, 22, 6);
  // 核心渐变
  g.fillGradientStyle(0xffffff, 0xffffff, 0x8fe3ff, 0x66ccff, 1);
  g.fillRoundedRect(2, 1, 8, 22, 4);
  // 亮芯线（width 4→2.8，收窄 30%）
  g.fillStyle(0xffffff, 0.95);
  g.fillRoundedRect(4.6, 3, 2.8, 14, 1.4);
}

// ─── 敌弹：红橙发光球 + 白亮核（P3：外发光提亮扩大 + 亮核收窄提亮）──────
function drawBulletEnemy(g) {
  g.clear();
  // 外发光（红橙，0.34→0.42 提亮，9→11px 扩大）
  g.fillStyle(COLORS.enemyBullet, 0.42);
  g.fillCircle(9, 9, 11);
  // 球体渐变 红→橙
  g.fillGradientStyle(0xffd0a0, 0xff7a3c, 0xff5a3c, 0xd93420, 1);
  g.fillCircle(9, 9, 7);
  // 脉冲内圈
  g.fillStyle(0xff5a3c, 0.5);
  g.fillCircle(9, 9, 5);
  // 白色亮核（2.2→1.6px 收窄提亮，更聚焦）
  g.fillStyle(0xffffff, 1);
  g.fillCircle(6.5, 6.5, 1.6);
}

// ─── 道具：火力(P)（橙金圆盘 + 闪电符号） ───────────────────────
function drawItemPower(g) {
  g.clear();
  // 外发光
  g.fillStyle(0xffb84a, 0.3);
  g.fillCircle(13, 13, 13);
  // 橙金圆盘底盘
  g.fillGradientStyle(0xffe9a0, 0xffc04a, 0xff9a3a, 0xd96620, 1);
  g.fillCircle(13, 13, 11);
  g.lineStyle(2, 0xffe9c0, 0.95);
  g.strokeCircle(13, 13, 11);
  // 闪电符号（火力）
  g.fillStyle(0x3a1a06, 1);
  g.fillPoints([
    { x: 15, y: 3 }, { x: 7, y: 14 }, { x: 12, y: 14 },
    { x: 10, y: 24 }, { x: 19, y: 11 }, { x: 13, y: 11 },
  ], true);
}

// ─── 道具：元素核心（三色元素球：火橙 / 冰青 / 雷黄） ──────────
function drawItemElement(g) {
  g.clear();
  const cx = 13, cy = 13, R = 11;
  const deg = Phaser.Math.DegToRad;
  // 三色弧形扇区拼成球体
  g.fillStyle(0xff7a3a, 1);
  g.slice(cx, cy, R, deg(-90), deg(30), false);
  g.fillPath();
  g.fillStyle(0x6fd6ff, 1);
  g.slice(cx, cy, R, deg(30), deg(150), false);
  g.fillPath();
  g.fillStyle(0xffe14a, 1);
  g.slice(cx, cy, R, deg(150), deg(270), false);
  g.fillPath();
  // 白芯 + 描边
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(cx, cy, 4);
  g.lineStyle(1.5, 0xffffff, 0.65);
  g.strokeCircle(cx, cy, R);
}

// ─── UI 图标：成就勋章（金牌 + 五角星，霓虹描边） ─────────────
function drawIconMedal(g) {
  g.clear();
  // 外发光
  g.fillStyle(0xffd54a, 0.3);
  g.fillCircle(13, 16, 12);
  // 左右绶带（红）
  g.fillStyle(0xff5566, 1);
  g.fillTriangle(5, 2, 12, 12, 10, 2);
  g.fillTriangle(21, 2, 14, 12, 16, 2);
  // 金牌圆盘
  g.fillGradientStyle(0xfff3b0, 0xffe27a, 0xe0a91f, 0xb8860b, 1);
  g.fillCircle(13, 16, 10);
  g.lineStyle(1.5, 0xfff3b0, 0.95);
  g.strokeCircle(13, 16, 10);
  // 五角星（白，中心高光）
  const cx = 13, cy = 16, R = 5.6, r = 2.4;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
  }
  g.fillStyle(0xffffff, 0.95);
  g.fillPoints(pts, true);
}

// ─── UI 图标：锁定（灰蓝挂锁 + 亮色锁梁） ─────────────────────
function drawIconLock(g) {
  g.clear();
  // 外发光
  g.fillStyle(0x9fb8cc, 0.25);
  g.fillRoundedRect(2, 9, 22, 15, 4);
  // 锁体（竖向渐变）
  g.fillGradientStyle(0xeaf3fb, 0xc7d9e8, 0x9fb8cc, 0x5f7a92, 1);
  g.fillRoundedRect(3, 10, 20, 14, 4);
  g.lineStyle(1, 0xffffff, 0.4);
  g.strokeRoundedRect(3, 10, 20, 14, 4);
  // 锁梁（U 形亮环）
  g.lineStyle(4, 0xd9e8f2, 1);
  g.beginPath();
  g.arc(13, 10, 6, Math.PI, 0);
  g.strokePath();
  // 锁孔
  g.fillStyle(0x2a3a4a, 1);
  g.fillCircle(13, 17, 2.6);
  g.fillStyle(0xffffff, 0.7);
  g.fillRect(12.6, 17, 0.9, 4);
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

// ─── 圆点粒子 softDot（8×8 径向柔光，爆炸/冲击波用，可 tint）────
function drawParticleDot(g) {
  g.clear();
  const cx = 4, cy = 4;
  for (let r = 4; r > 0.4; r -= 0.4) {
    const t = 1 - r / 4; // 中心亮、边缘透明
    g.fillStyle(0xffffff, 0.10 + t * 0.80);
    g.fillCircle(cx, cy, r);
  }
}

// ─── 长条粒子 streak（8×24 竖向柔光尾迹，尾焰/拖尾用，可 tint）──
function drawParticleStreak(g) {
  g.clear();
  const cx = 4, cy = 12;
  for (let w = 6; w > 0.5; w -= 0.8) {
    const t = 1 - w / 6; // 中间宽亮、外缘细透
    g.fillStyle(0xffffff, 0.05 + t * 0.55);
    g.fillRoundedRect(cx - w / 2, cy - 12, w, 24, w / 2);
  }
}

// ─── 星形粒子 sparkStar（16×16 四角火花，受击/枪口闪光用）───────
function drawParticleSpark(g) {
  g.clear();
  const cx = 8, cy = 8;
  g.fillStyle(0xffffff, 0.30);
  g.fillCircle(cx, cy, 6);   // 柔和光晕
  g.fillStyle(0xffffff, 1);
  g.fillPoints([
    { x: cx, y: 0.5 }, { x: cx + 2.4, y: 5.6 }, { x: 15.5, y: cy },
    { x: cx + 2.4, y: 10.4 }, { x: cx, y: 15.5 },
    { x: 5.6, y: 10.4 }, { x: 0.5, y: cy },
    { x: 5.6, y: 5.6 },
  ], true);
}

// ─── 背景星点 ────────────────────────────────────────────────────
function drawStar(g) {
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(2, 2, 2);
}

// ─── 俯冲机「diver」：前掠翼分色 + 机身品红能量线（36×40）────────
function drawEnemyDiver(g) {
  g.clear();
  // 外发光（品红）
  g.fillStyle(0xff3df0, 0.18);
  g.fillTriangle(18, -2, -2, 42, 38, 42);
  // 前掠翼：翼根深、翼尖亮（分色）
  g.fillStyle(0xc11fc0, 1);
  g.fillTriangle(14, 12, 2, 32, 14, 28);
  g.fillTriangle(22, 12, 34, 32, 22, 28);
  g.fillStyle(0xff9af2, 1);
  g.fillTriangle(8, 22, 2, 32, 11, 28);
  g.fillTriangle(28, 22, 34, 32, 25, 28);
  // 细长机身
  g.fillGradientStyle(0xff9af2, 0xff3df0, 0xff3df0, 0x8a106f, 1);
  g.fillTriangle(18, 3, 12, 34, 24, 34);
  // 机身品红能量线（细长）
  g.fillStyle(0xffaef5, 0.9);
  g.fillRoundedRect(17, 8, 2, 22, 1);
  // 座舱（反光）
  g.fillStyle(0x2a0820, 1);
  g.fillEllipse(18, 18, 7, 11);
  g.fillStyle(0xffd0f5, 1);
  g.fillEllipse(18, 17, 3.4, 6);
  g.fillStyle(0xffffff, 0.85);
  g.fillEllipse(16.5, 14, 1.4, 2.6);
  // 引擎光
  g.fillStyle(0xff7af0, 1);
  g.fillCircle(18, 35, 2);
  // 双层描边（品红）
  g.lineStyle(2.6, 0xff3df0, 0.3);
  g.strokeTriangle(18, 3, 12, 34, 24, 34);
  g.lineStyle(1.5, 0xff9af2, 0.9);
  g.strokeTriangle(18, 3, 12, 34, 24, 34);
}

// ─── 玩家脉冲弹：青白核心 + 外层柔晕（P3：辉光壳 +10%，亮芯收窄 30%）────
function drawBulletPulse(g) {
  g.clear();
  // 外层柔晕（alpha 0.25→0.275，+10%）
  g.fillStyle(0x66ccff, 0.275);
  g.fillRoundedRect(0, 0, 10, 28, 5);
  // 核心渐变
  g.fillGradientStyle(0xffffff, 0xffffff, 0x8fe3ff, 0x66ccff, 1);
  g.fillRoundedRect(2, 1, 6, 26, 3);
  // 亮芯线（width 2→1.4，收窄 30% 更聚焦）
  g.fillStyle(0xffffff, 0.95);
  g.fillRoundedRect(4.3, 3, 1.4, 22, 0.7);
}

// ─── 玩家散射弹：圆环 + 白芯浅蓝（14×14）──────────────────────
function drawBulletScatter(g) {
  g.clear();
  // 柔光晕
  g.fillStyle(0x9fd8ff, 0.3);
  g.fillCircle(7, 7, 7);
  // 球体
  g.fillGradientStyle(0xffffff, 0xbfe8ff, 0x9fd8ff, 0x66ccff, 1);
  g.fillCircle(7, 7, 5);
  // 环
  g.lineStyle(2, 0x66ccff, 0.95);
  g.strokeCircle(7, 7, 5);
  // 白芯高光
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(5.5, 5.5, 1.8);
}

// ─── 玩家追踪导弹：尾翼分色 + 尖弹头 + 橙能量纹（14×22）────────
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
  // 橙能量纹（纵向）
  g.fillStyle(0xff8a3d, 1);
  g.fillRect(6, 7, 2, 9);
  // 尾翼（深/亮分色）
  g.fillStyle(0xffcc44, 1);
  g.fillTriangle(2, 14, 0, 20, 4, 18);
  g.fillTriangle(12, 14, 14, 20, 10, 18);
  g.fillStyle(0xff7a3a, 1);
  g.fillTriangle(2, 14, 0, 20, 4, 20);
  g.fillTriangle(12, 14, 14, 20, 10, 20);
  // 高光芯
  g.fillStyle(0xffffff, 0.95);
  g.fillRoundedRect(5, 8, 3, 9, 1.5);
}

// ─── 玩家元素弹（火）：橙焰（10×28）────────────────────────────
function drawBulletFire(g) {
  g.clear();
  // 外发光
  g.fillStyle(0xff7a3a, 0.25);
  g.fillRoundedRect(0, 0, 10, 28, 5);
  // 火焰外焰（橙）
  g.fillGradientStyle(0xffe14a, 0xffc04a, 0xff7a3a, 0xd93420, 1);
  g.fillTriangle(5, 1, 1, 20, 9, 20);
  g.fillRoundedRect(1, 14, 8, 13, 4);
  // 内焰（亮）
  g.fillStyle(0xffd9a0, 1);
  g.fillTriangle(5, 5, 3, 19, 7, 19);
  // 白炽核心
  g.fillStyle(0xffffff, 0.95);
  g.fillRoundedRect(4, 8, 2, 14, 1);
}

// ─── 玩家元素弹（冰）：冰青晶（10×28）──────────────────────────
function drawBulletIce(g) {
  g.clear();
  // 外发光
  g.fillStyle(0x6fd6ff, 0.25);
  g.fillRoundedRect(0, 0, 10, 28, 5);
  // 冰晶（菱形主体）
  g.fillGradientStyle(0xbfefff, 0xeafbff, 0x6fd6ff, 0x3aa0d8, 1);
  g.fillTriangle(5, 1, 1, 14, 9, 14);
  g.fillTriangle(5, 27, 1, 14, 9, 14);
  // 晶体高光（亮线）
  g.fillStyle(0xffffff, 0.9);
  g.fillRect(4.6, 4, 0.8, 20);
  // 晶面反光点
  g.fillStyle(0xeafbff, 0.95);
  g.fillCircle(3.4, 10, 1.1);
}

// ─── 玩家元素弹（雷）：紫电 + 白色闪电折线（10×28）──────────────
function drawBulletThunder(g) {
  g.clear();
  // 外发光
  g.fillStyle(0xb98bff, 0.25);
  g.fillRoundedRect(0, 0, 10, 28, 5);
  // 紫电外晕
  g.fillStyle(0xb98bff, 0.9);
  g.fillRoundedRect(2, 2, 6, 24, 3);
  // 紫电外晕（宽，低透）
  g.lineStyle(3.4, 0xffe14a, 0.3);
  g.beginPath();
  g.moveTo(5, 2);
  g.lineTo(3, 11);
  g.lineTo(6, 13);
  g.lineTo(4, 26);
  g.strokePath();
  // 白色闪电核心
  g.lineStyle(2, 0xffffff, 1);
  g.beginPath();
  g.moveTo(5, 2);
  g.lineTo(3, 11);
  g.lineTo(6, 13);
  g.lineTo(4, 26);
  g.strokePath();
}

// ─── 可选：激光辉光核叠加图（24×64 柔青竖向光带）───────────────
function drawBeamGlow(g) {
  g.clear();
  for (let r = 12; r > 0; r--) {
    const t = 1 - r / 12;
    g.fillStyle(0x9ff0ff, 0.05 + t * 0.04);
    g.fillRoundedRect(12 - r, 0, r * 2, 64, r);
  }
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

// ─── 柔光贴图（512×512 径向白→透明，P3 光效纪律：机/弹/爆/拾取）──────
function drawGlowSoft(g) {
  g.clear();
  const cx = 256, cy = 256;
  for (let r = 256; r > 0; r -= 2) {
    const t = 1 - r / 256; // 中心亮、边缘透明
    g.fillStyle(0xffffff, 0.015 + t * 0.55);
    g.fillCircle(cx, cy, r);
  }
}

// ─── 背景底部地平线光带（512×96 横向柔光带，白色基底便于 tint）────
function drawBgGlowband(g) {
  g.clear();
  const cx = 256, cy = 48;
  for (let r = 48; r > 0; r -= 3) {
    const t = 1 - r / 48; // 中心亮、边缘透明
    g.fillStyle(0xffffff, 0.02 + t * 0.07);
    g.fillEllipse(cx, cy, 512 * (0.92 + t * 0.08), r * 2);
  }
}
