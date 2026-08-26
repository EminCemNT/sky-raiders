import Phaser from 'phaser';
import { GAME_WIDTH, EVENTS, LEVELS } from '../config/GameConfig.js';
import { EventBus } from '../utils/EventBus.js';

/**
 * 波次系统：驱动一关内的敌人生成节奏。
 * ---------------------------------------------------------------------------
 * 每关由 N 个波次组成，波次清空后进入下一波，最后一波后触发 Boss。
 * 目前是"程序化随机波次"骨架，后续可替换为手工编排的关卡数据表。
 *
 * 用法（GameScene）：
 *   this.waves = new WaveSystem(this, levelId);
 *   this.waves.update(time, dt);
 *   // 监听 EVENTS.LEVEL_CLEARED / BOSS_SPAWNED 做后续
 */
export default class WaveSystem {
  constructor(scene, levelId = 1, opts = {}) {
    this.scene = scene;
    this.endless = !!opts.endless; // P1 无尽 Score Attack：无限循环 + 难度递增，永不进 Boss
    // P1 留存·深空爬塔（无尽升级）：每 endlessBossEvery 波一个 Boss 波（0=关闭，其他模式零 diff）
    this.endlessBossEvery = Math.max(0, Number(opts.endlessBossEvery) || 0);
    // P1 留存·深空爬塔：每波清空后等待 scene 弹「3 选 1 增益」面板，选完调 continueAfterWave() 继续
    this.awaitBuff = !!opts.awaitBuff;
    this.level = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
    this.totalWaves = this.level.waves;
    this.currentWave = 0;
    this.state = 'idle';      // idle | spawning | waiting | boss | done
    this._spawnTimer = 0;
    this._toSpawn = 0;
    this._spawnGap = 600;
    this._nextWaveDelay = 1200;
    this._delayTimer = 0;
    this.bossSpawned = false;

    this.startNextWave();
  }

  startNextWave() {
    this.currentWave++;
    // 深空爬塔：每 N 波 Boss（无尽模式专用；wave=10 → 层 1，wave=20 → 层 2…）
    if (this.endless && this.endlessBossEvery > 0 && this.currentWave % this.endlessBossEvery === 0) {
      this.state = 'boss';
      const floor = Math.floor(this.currentWave / this.endlessBossEvery);
      if (this.scene.spawnTowerBoss) this.scene.spawnTowerBoss(floor);
      return;
    }
    // 无尽模式：无限循环，永不触发 Boss；普通模式走原有关卡 Boss 收尾
    if (!this.endless && this.currentWave > this.totalWaves) {
      // 所有波次完成 -> Boss
      this.state = 'boss';
      if (!this.bossSpawned) {
        this.bossSpawned = true;
        const bossCfg = this.level.boss || {};
        EventBus.emit(EVENTS.BOSS_SPAWNED, {
          key: this.level.bossKey,
          name: bossCfg.name || 'BOSS',
          color: bossCfg.color || 0xff3355,
        });
        if (this.scene.spawnBoss) this.scene.spawnBoss(this.level.bossKey);
      }
      return;
    }
    // 数据表驱动：优先读取本关 wavePlan（无尽模式不用，走程序化兜底）；缺失则程序化兜底
    const plan = this.endless ? null : this.level.wavePlan;
    const waveDef = plan && plan[this.currentWave - 1];
    if (waveDef) {
      this._toSpawn = waveDef.count;
      this._comp = waveDef.comp;
    } else {
      // 无尽模式：敌人数量随波次线性增长，形成持续压力
      this._toSpawn = 4 + this.currentWave * 2;
      this._comp = null;
    }
    // 无尽模式出生间隔压得更低，后期更密集
    this._spawnGap = Math.max(this.endless ? 200 : 260, 620 - this.currentWave * 25);
    this._spawnTimer = 0;
    this.state = 'spawning';
    EventBus.emit(EVENTS.WAVE_STARTED, {
      wave: this.currentWave,
      total: this.endless ? null : this.totalWaves,
      endless: this.endless,
    });
  }

  /** 当前波次难度系数：无尽模式每 5 波 +10%（相对关卡基础难度递增） */
  getDifficulty() {
    const base = this.level.difficulty || 1;
    if (!this.endless) return base;
    return base * (1 + Math.floor((this.currentWave - 1) / 5) * 0.1);
  }

  update(time, dt) {
    if (this.state === 'spawning') {
      this._spawnTimer += dt;
      if (this._spawnTimer >= this._spawnGap && this._toSpawn > 0) {
        this._spawnTimer = 0;
        this._toSpawn--;
        this.spawnOne();
      }
      if (this._toSpawn <= 0) {
        this.state = 'waiting';
        this._delayTimer = 0;
      }
    } else if (this.state === 'waiting') {
      // 等本波敌人基本清空 或 超时后进下一波
      this._delayTimer += dt;
      const aliveEnemies = this.scene.enemies
        ? this.scene.enemies.countActive(true) : 0;
      if (aliveEnemies === 0 || this._delayTimer > 6000) {
        const cleared = aliveEnemies === 0;
        if (cleared) EventBus.emit(EVENTS.WAVE_CLEARED, this.currentWave);
        this._delayTimer = 0;
        // 深空爬塔：波清空后暂停推进，等 scene 弹「3 选 1 增益」面板，选完调 continueAfterWave()
        if (this.awaitBuff && cleared) {
          this.state = 'idle';
          return;
        }
        this.state = 'idle';
        this.scene.time.delayedCall(this._nextWaveDelay, () => this.startNextWave());
      }
    }
  }

  /** 深空爬塔：3 选 1 增益选择完毕后调用，推进到下一波 */
  continueAfterWave() {
    if (this.state !== 'idle' && this.state !== 'boss') return;
    this.state = 'idle';
    this.scene.time.delayedCall(this._nextWaveDelay, () => this.startNextWave());
  }

  spawnOne() {
    if (!this.scene.spawnEnemy) return;
    let x = Phaser.Math.Between(40, GAME_WIDTH - 40);
    let typeKey = 'small';
    let moveMode = 'straight';
    let firePattern = null;
    if (this._comp && this._comp.length) {
      // 归一化 comp 条目：支持 [type, mode, weight, pattern] 元组 或 { typeKey, mode, pattern, weight } 对象
      const norm = (entry) => {
        if (Array.isArray(entry)) {
          return {
            typeKey: entry[0] || 'small',
            mode: entry[1] || 'straight',
            weight: entry[2] != null ? entry[2] : 1,
            pattern: entry[3] || null,
          };
        }
        return {
          typeKey: entry.typeKey || entry.type || 'small',
          mode: entry.mode || 'straight',
          weight: entry.weight != null ? entry.weight : 1,
          pattern: entry.pattern || null,
        };
      };
      const entries = this._comp.map(norm);
      let total = 0;
      for (const e of entries) total += e.weight;
      let r = Math.random() * total;
      let picked = entries[0];
      for (const e of entries) {
        if ((r -= e.weight) <= 0) { picked = e; break; }
      }
      typeKey = picked.typeKey;
      moveMode = picked.mode;
      firePattern = picked.pattern;
    } else {
      // 兜底：程序化随机（波次越高越难）；无尽模式 mid 占比上限略高
      const cap = this.endless ? 0.6 : 0.5;
      const midChance = Math.min(cap, 0.1 + this.currentWave * 0.06);
      typeKey = Math.random() < midChance ? 'mid' : 'small';
      const modes = ['straight', 'straight', 'sine', 'dive'];
      moveMode = modes[Phaser.Math.Between(0, modes.length - 1)];
    }
    // 难度系数传给敌人，作用到 HP / 速度
    // C3 敌机弹幕差异化：wavePlan 未显式指定 pattern 时按型号兜底
    // P1 新敌型默认 pattern：turret=aimed / summoner=ring / shield=spread
    if (!firePattern) {
      if (typeKey === 'mid') {
        const pats = ['straight', 'spread', 'tracking', 'burst'];
        firePattern = pats[Phaser.Math.Between(0, pats.length - 1)];
      } else if (typeKey === 'diver') {
        firePattern = Math.random() < 0.5 ? 'tracking' : 'straight';
      } else if (typeKey === 'turret') {
        firePattern = 'aimed';
      } else if (typeKey === 'summoner') {
        firePattern = 'ring';
      } else if (typeKey === 'shield') {
        firePattern = 'spread';
      } else {
        firePattern = 'straight';
      }
    }
    // P1 地面炮台：固定在地图底部两侧（出生即定位，moveMode='turret' 静止）
    let y = -40;
    if (typeKey === 'turret') {
      const side = Math.random() < 0.5 ? -1 : 1;
      x = side < 0
        ? Phaser.Math.Between(44, Math.floor(GAME_WIDTH * 0.38))
        : Phaser.Math.Between(Math.ceil(GAME_WIDTH * 0.62), GAME_WIDTH - 44);
      y = GAME_HEIGHT - Phaser.Math.Between(110, 170);
    }
    this.scene.spawnEnemy(x, y, typeKey, moveMode, this.getDifficulty(), firePattern);
  }
}
