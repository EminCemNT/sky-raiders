# OPT-15 V 系纯视觉五项实现规格（架构方案 · 开发/QA 引用版）

> 作者：高见远（arch-opt / 架构师）｜日期：2026-09-01
> 状态：**已拍板，待开发实现**（V 系纯视觉轮产出）
> 范围：V 系纯视觉五项 = V2 擦弹火花 / V4 单位待机动效 / V3 波次清空庆祝 / V5 关卡环境叙事层 / V7 暂停氛围 —— 全部**函数级实现规格**，供 coder-opt 直接照做。
> 代码基线：HEAD = ed37a44（OPT-14 画面质感已推送）。工作树干净。只出规格，不改任何代码。
> 引用说明：worker 以本文件为唯一实现规格来源；正文完整、无「见其他文档」引用（行号为当前基线核对值，开发以实际为准）。
> 导入补充：新增配置块（`GRAZE_SPARK`/`IDLE_AURA`/`WAVE_CLEAR`/`ENV_NARRATIVE`/`PAUSE_ATMO`）需按各节「改动文件」在对应文件 import 行追加；`VFX.js` 已 `import *` 无需改（`VFX.grazeSpark` 等直接可用）。

---

## 〇、红线总览（五项逐一确认，零触碰）

| 红线项 | 结论 |
|---|---|
| `GameConfig.js` `WINGMAN.COMBO` 五字段（L699-705） | **零触碰**。V4 只读 `WINGMAN.DEPTH/SCALE`（实体显示用），**不读写 COMBO 块**。 |
| `AchievementManager.js` 26 个成就 id | **零改动**。五项纯视觉，不触碰成就条件/进度。 |
| `WingmanSystem.js` | **零触碰**。V4 僚机待机动效在 **`Wingman.js` 实体**（非红线文件）内做 + VFX 辅助函数，WingmanSystem 仅被 `getMembers()` 只读（既有公开 API，零改动）。 |
| `FloatingText.js` | **只读不改**。V2 擦弹火花用 VFX 粒子池，不走飘字；`FloatingText.js` diff 为空。 |
| `SaveManager.js` | **零改动**。本规格不新增存档字段（全部为运行时/配置级改动）。 |
| 零外部资源 | 全部程序纹理 + 现有纹理（`glow_soft`/`vignette-perm`/`particle_spark`/`particle_dot`）+ Graphics/Text；**零图片/音频/网络/字体依赖**。 |
| 纯视觉 / 零业务逻辑 | V2/V4/V3/V5/V7 均为纯表现层；**不触碰任何伤害/数值/流程/存档**。V2 的火花只在擦弹检测点追加一行视觉调用，`_grantGraze`（结算函数）diff 为空。 |
| 性能纪律 | 尽量复用现有池/纹理；**不新增资源、不新增每帧全量扫描**。V4 用「每单位一条持久 tween」，V2/V3 复用 vfxPool emitter，V5 全静态，V7 仅暂停时两条 tween。 |

> 检查方式：开发 PR 自检 + QA 回归（尤其：`WINGMAN.COMBO` 未改、成就 id 集合未变、`WingmanSystem.js` / `FloatingText.js` / `SaveManager.js` diff 为空）。

---

## 一、实现顺序表（推荐）

| 顺序 | 条目 | 理由 |
|---|---|---|
| 1 | V2 擦弹火花 | 最小改动（VFX 池 + GameScene 1 行）、观感收益直接、零风险；为 V3/V5 的 GameScene 批改铺路 |
| 2 | V3 波次清空庆祝 | 复用 vfxPool emitter + UIScene 脉冲，独立小改，可与 V2 同批 |
| 3 | V5 关卡环境叙事层 | GameScene 静态构建，零每帧成本；趁 GameScene 已改一并做 |
| 4 | V7 暂停氛围 | UIScene 独立改造，配置级，可随时做 |
| 5 | V4 单位待机动效 | 改动面最大（VFX 辅助 + Enemy/Boss/Wingman 三实体），含对象池复用清理风险，**最后做**（不阻塞其它项） |

---

## 第 V2 条：擦弹火花（graze 反馈 · 弹幕手感强化）

### 背景 / 目标
当前擦弹成功（`_updateGraze` L1497-1513 判定）只结算数值：回能 + 得分 + 飘字 + 广播 `GRAZE_CHANGED`（`_grantGraze` L1516-1539），**擦弹点无任何视觉反馈**——弹幕玩家在弹雨中"贴弹擦过"是核心爽点，缺少火花反馈导致手感发闷。目标：擦弹成功时在擦弹点迸发一小簇青白火花/闪光微粒（对应擦弹环 `0x33ffff` 语义），**纯视觉，不碰数值**。

### 改动文件 + 函数签名
- `src/systems/VFX.js`
  - `createVfxPool(scene)`（L304-333）：返回值增加第三个 emitter `grazeSpark`（offscreen、`emitting:false`，青白 tint）——**复用池机制**，不新建每帧 emitter；
  - 新增 `poolGrazeSpark(scene, pool, x, y)`（镜像 `poolSpark` L371-379：quantity 按画质档缩放 + 每帧并发 cap）；
  - 新增 `grazeSpark(scene, x, y)`（池化优先 wrapper，镜像 `hitSpark` L272-290）；
  - 模块级计数 `let _grazeSparkCount = 0`（**累计发射次数**，仿 `_localIllumTotal`；探针只读）。
- `src/scenes/GameScene.js` — `_updateGraze(time)` L1510-1511 之间追加 1 行（**结算函数 `_grantGraze` 保持 diff 为空**）。
- `src/config/GameConfig.js` — 新增 `GRAZE_SPARK` 配置块（append-only，置于 `GRAZE` 块 L137-147 之后）。

```js
// VFX.js createVfxPool 内（在 return 前追加第三个 emitter，镜像 hitSpark L318-328）
const grazeSpark = scene.add.particles(0, 0, 'particle_spark', {
  speed: { min: GRAZE_SPARK.speedMin, max: GRAZE_SPARK.speedMax },
  lifespan: GRAZE_SPARK.lifespan,
  scale: { start: GRAZE_SPARK.scale, end: 0 },
  alpha: { start: GRAZE_SPARK.alpha, end: 0 },
  quantity: GRAZE_SPARK.quantity,
  blendMode: 'ADD',
  tint: GRAZE_SPARK.tint,
  emitting: false,
});
grazeSpark.setDepth(GRAZE_SPARK.depth);
grazeSpark.poolUseCount = 0; grazeSpark.lastQuantity = 0; grazeSpark._burstFrame = -1; grazeSpark._burstCount = 0;
return { explosion, hitSpark, grazeSpark };
```

```js
// VFX.js 新增
export function poolGrazeSpark(scene, pool, x, y) {
  if (prefersReduced || !pool || !pool.grazeSpark) return;
  const gs = pool.grazeSpark;
  // 每帧并发 cap：密集弹幕同帧多次擦弹不迸发过量火花（如超载 5 连擦）
  const frame = (scene.game && scene.game.loop) ? scene.game.loop.frame : -1;
  if (frame === gs._burstFrame) {
    gs._burstCount = (gs._burstCount || 0) + 1;
    if (gs._burstCount > GRAZE_SPARK.maxPerFrame) return;
  } else {
    gs._burstFrame = frame; gs._burstCount = 1;
  }
  const qs = _qualityScale(scene);
  const qty = Math.max(1, Math.floor(GRAZE_SPARK.quantity * qs));
  gs.poolUseCount = (gs.poolUseCount || 0) + 1;
  gs.lastQuantity = qty;
  _grazeSparkCount++;
  gs.emitParticleAt(x, y, qty);
}
// grazeSpark(scene, x, y)：池化优先；无池时降级为直接 return（静默，火花是增益不是必需）
export function grazeSpark(scene, x, y) {
  if (prefersReduced) return;
  if (scene && scene.vfxPool) { poolGrazeSpark(scene, scene.vfxPool, x, y); return; }
}
```

```js
// GameScene.js _updateGraze 内（L1510 之后、L1511 之前）
b._grazedAt = time;
VFX.grazeSpark(this, b.x, b.y);   // 【V2 新增】擦弹点火花（纯视觉，零数值）
this._grantGraze(b.x, b.y);
```

### 精确语义
- **触发点**：`_updateGraze` 中 `b._grazedAt = time` 之后——即「该弹本次确认为一次新擦弹」的瞬间；`_grantGraze`（回能/得分/飘字/广播/进度）**零改动**。
- **同弹冷却天然生效**：`RE_GRAZE_MS=400` 保证同一颗弹 400ms 内只擦一次 → 火花不会对同一颗弹连刷。
- **每帧 cap**：`maxPerFrame=3`，用 `scene.game.loop.frame` 计数；超载 5 连擦同帧时只迸 3 簇（其余静默丢弃），防过量粒子。
- **外观**：青白火花（tint `0x66ffff`，呼应擦弹环 `0x33ffff`）、6 粒/次（high 档；mid×0.7→4、low×0.45→2）、lifespan 160ms、scale 0.5→0、ADD 混合、depth 55（与 hitSpark 同层，被 gameplay 层 60 覆盖其上的判定无冲突）。
- **生命周期**：复用 emitter（offscreen），粒子寿命结束自动回收 `dead` 池；无新增 emitter 创建/销毁 → 零 GC 抖动。
- 与命中火花（hitSpark，橙红）区分：擦弹火花是青白、更小更快（speed 20-70 vs hit 25-100、lifespan 160 vs 150、scale 0.5 vs 0.7），弹雨中可辨识「擦到了」与「打中了」。

### 参数表（append-only，默认值）
```js
// GameConfig 新增
export const GRAZE_SPARK = {
  enabled: true,
  quantity: 6,        // 单次粒子量（high 档；×qualityScale 缩放）
  maxPerFrame: 3,     // 每帧并发 cap（防同帧连擦过量）
  tint: 0x66ffff,     // 青白（呼应擦弹环）
  speedMin: 20, speedMax: 70,
  lifespan: 160,
  scale: 0.5,
  alpha: 0.9,
  depth: 55,          // 与 hitSpark 同层
};
```

### 降级策略
| 档位 | 行为 |
|---|---|
| high | 6 粒/次，每帧 cap 3 |
| mid | 4 粒/次（×0.7），cap 3 |
| low | 2 粒/次（×0.45），cap 3（火花是低成本反馈，保留但减量） |
| reduced-motion | **完全关闭**（`grazeSpark` 首行 return；且 reduced 下 `createVfxPool` 返回 null，池内无 grazeSpark） |
| Canvas | 粒子为 `particle_spark` 纹理 + ADD，无 postFX 依赖 → 双模式一致 |

### 风险与回归点
- **误触结算红线**：唯一改动点是 `_updateGraze` 追加一行视觉调用；`_grantGraze` diff 必须为空（QA 断言 diff）。
- **同帧过量**：若 cap 实现漏判 frame，超载 5 连擦可能迸 5×6=30 粒 → 必须带 cap 逻辑；回归用超载触发场景观察。
- **观感**：青白火花与擦弹环同色系，弹幕密集时可能被误认为敌弹 → alpha 0.9 起始、160ms 快速衰减，肉眼可辨；若过强可调低 `alpha`/`quantity`（配置级）。
- 回归：擦弹计分/回能/飘字/`GRAZE_CHANGED` 数值不变；`__SKY.grazeCount` 链式增量探针（qa_p2）仍通过。

### 探针建议
- 进战斗贴弹擦弹一次 → `window.__SKY.vfxPool.grazeSpark.poolUseCount > 0`、`lastQuantity` 符合档位；reduced/low 分支 pool 为 null 或 count 不增。
- `window.__GAME._dynLight` 扩展只读字段 `grazeSparkCount`（累计发射次数）——reduced 下恒 0。
- 数值回归：qa_p2 链式擦弹探针（同帧 5 连擦每段 +2 增量保持原值）全绿。

---

## 第 V4 条：单位待机动效（敌机/Boss/僚机 · 能量环呼吸）

### 背景 / 目标
当前敌机/僚机静态贴图（敌机只有精英 `_eliteGlow`，Boss 有相位能量环 `fxG`），Boss 战前、待机波、僚机编队都"死板"。目标：给普通敌机 / Boss / 僚机加**轻量待机动效**（能量环呼吸/悬浮脉动），与射击/受击/死亡互不干扰，**避免每帧全量 tween**（每单位一条持久 tween，yoyo repeat -1）。

### 改动文件 + 函数签名
- `src/systems/VFX.js` — 新增 `idleAura(sprite, color, opts)`（参考 `glowTarget` L685-707 与 `bossAmbient` L812-828 模式）；模块级计数 `let _idleAuraActive = 0;`（置于 L41 `_afterglowActive` 旁，探针只读）。
- `src/entities/Enemy.js` — `spawn()` L73-160 内挂 aura + 新增 `_attachIdleAura()/_clearIdleAura()` 私有方法；`recycle()` L585-608 清理。
- `src/entities/Boss.js` — constructor L43 后挂 aura；`die()` L687-715 清理。
- `src/entities/Wingman.js`（**非红线文件**）— constructor L26-52 挂 aura；`setElement()` L81-84 换色。
- `src/config/GameConfig.js` — 新增 `IDLE_AURA` 配置块（append-only）。

```js
// VFX.js 新增（返回可控句柄，stop() 用于对象池回收清理，杜绝监听泄漏）
/**
 * 待机能量环呼吸：glow_soft 贴目标下方一层，随目标移动/显隐，alpha+scale 缓慢呼吸。
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {number} color
 * @param {{radius?:number, alpha?:number, depthOff?:number, ms?:number, scalePulse?:number}} opts
 * @returns {{glow: Phaser.GameObjects.Image, stop():void}|null} reduced/非法输入返回 null
 */
export function idleAura(sprite, color, opts = {}) {
  if (!sprite || !sprite.scene || prefersReduced) return null;
  const scene = sprite.scene;
  const radius = opts.radius ?? 1.0;
  const alpha = opts.alpha ?? 0.10;
  const depthOff = opts.depthOff ?? -1;
  const ms = opts.ms ?? 1500;
  const scalePulse = opts.scalePulse ?? 0.12;
  const glow = scene.add.image(sprite.x, sprite.y, 'glow_soft')
    .setDepth(sprite.depth + depthOff)
    .setAlpha(alpha)
    .setTint(color)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(radius, radius);
  _idleAuraActive++;
  const sync = () => {
    if (!glow.active) return;
    glow.setPosition(sprite.x, sprite.y);
    glow.setVisible(!!(sprite.active && sprite.visible));
  };
  scene.events.on('update', sync);
  const tween = scene.tweens.add({
    targets: glow,
    alpha: { from: alpha, to: alpha + scalePulse * 0.5 },
    scaleX: { from: radius, to: radius * (1 + scalePulse) },
    scaleY: { from: radius, to: radius * (1 + scalePulse) },
    duration: ms, yoyo: true, repeat: -1, ease: EASE.breathe,
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    scene.events.off('update', sync);
    scene.tweens.killTweensOf(glow);
    if (glow.active) glow.destroy();
    _idleAuraActive = Math.max(0, _idleAuraActive - 1);
  };
  return { glow, stop };
}
```

```js
// Enemy.js —— spawn() 内（精英 glow 分支 L122-130 之后追加）
if (this._idleAura) { this._idleAura.stop(); this._idleAura = null; }   // 防御性清理（recycle 已清，双保险）
if (!this.isElite && !PREFERS_REDUCED && (this.scene.qualityScale || 1) >= IDLE_AURA.minQuality
    && this.typeKey !== 'kamikaze') {
  this._idleAura = VFX.idleAura(this, this.getColor(), IDLE_AURA.enemy);
}
// recycle() 内（_eliteGlow 清理 L601-607 之后追加）
if (this._idleAura) { this._idleAura.stop(); this._idleAura = null; }
// constructor（L62-63 附近）初始化字段：this._idleAura = null;
```

```js
// Boss.js —— constructor 内（_syncPhaseVisuals() L43 之后追加）
this._idleAura = null;
if ((this.scene.qualityScale || 1) >= IDLE_AURA.minQuality) {
  this._idleAura = VFX.idleAura(this, this.color, IDLE_AURA.boss);
}
// die() 内（L693 死亡演出前追加）
if (this._idleAura) { this._idleAura.stop(); this._idleAura = null; }
```

```js
// Wingman.js（需在 import 行追加：import { ELEMENTS } from '../config/GameConfig.js'; 与 import * as VFX from '../systems/VFX.js';）
// constructor 内（this.element = null 之后追加）
this._idleAura = null;
this._syncIdleAura();
// 新增私有方法（reduced-motion 判定沿用文件内既有 matchMedia 常量，可复用模块顶部定义）
_syncIdleAura() {
  if (!this.scene || PREFERS_REDUCED) return;
  const c = (ELEMENTS[this.element] && ELEMENTS[this.element].color) || 0x9ff0ff;
  if (this._idleAura && this._idleAura.glow && this._idleAura.glow.active) {
    this._idleAura.glow.setTint(c);          // 换元素即换光环色
  } else if ((this.scene.qualityScale || 1) >= IDLE_AURA.minQuality) {
    this._idleAura = VFX.idleAura(this, c, IDLE_AURA.wingman);
  }
}
// setElement() 末尾追加：this._syncIdleAura();
// 说明：击落/重生由 idleAura 内部 sync 自动显隐（die() 置 active=false/visible=false、respawn() 置回），无需改 die/respawn。
```

### 精确语义
- **互不干扰（关键）**：待机动效只作用于**独立 glow 子对象**（非机体本身 scale/alpha/rotation）→ 与 `_flinch`（scale 挤压）、死亡演出（scale 归零）、精英 `_eliteGlow`、Boss `fxG` 脉动**零冲突**。
- **每单位一条持久 tween**（yoyo repeat -1），创建于 spawn/构造时一次；**不逐帧建 tween**（满足「避免每帧全量 tween」）。
- **跟随**：`idleAura` 内部 `scene.events.on('update', sync)` 每帧 setPosition + 显隐跟随（与 `glowTarget`/`bossAmbient` 同模式）；敌机对象池回收 → `recycle()` 调 `stop()` 解绑监听 + kill tween + 销毁 glow → **无监听泄漏**。
- **豁免清单**：kamikaze（高速冲脸无待机态）不加；elite 已有 `_eliteGlow` 不再叠（避免双光环）；Boss 始终加（每关唯一，成本可忽略）。
- **僚机**：aura 颜色随 `setElement` 换（火橙/冰青/雷金），击落/重生由 `idleAura` 的 sync 自动显隐（`die()` 置 active=false/visible=false、`respawn()` 置回）——**不改 WingmanSystem.js**。
- **深度**：敌机 aura = 15-1=14、Boss aura = 18-2=16、僚机 aura = 18-1=17；均在 gameplay 层（≤60）内、本体之下。
- 品质门槛：`qualityScale < 0.6`（low 档）不创建 aura。

### 参数表（append-only，默认值）
```js
// GameConfig 新增
export const IDLE_AURA = {
  minQuality: 0.6,      // qualityScale < 0.6（low 档）不创建
  enemy:   { radius: 1.0, alpha: 0.10, depthOff: -1, ms: 1500, scalePulse: 0.12 },
  boss:    { radius: 1.9, alpha: 0.10, depthOff: -2, ms: 2000, scalePulse: 0.08 },
  wingman: { radius: 0.8, alpha: 0.14, depthOff: -1, ms: 1400, scalePulse: 0.15 },
};
```

### 降级策略
| 档位 | 行为 |
|---|---|
| high | 三实体全开（敌机豁免 kamikaze/elite） |
| mid | 全开（alpha 维持；aura 成本极低，mid 不额外削减） |
| low | **不创建**（`minQuality:0.6` 门槛短路；敌机/Boss/僚机均无 aura） |
| reduced-motion | **完全关闭**（`idleAura` 首行 return null） |
| Canvas | glow_soft 纹理 + ADD + tween，无 postFX 依赖 → 双模式一致 |

### 风险与回归点
- **对象池监听泄漏（最高风险）**：敌机走池复用（recycle 不 destroy），若 `recycle()` 漏调 `stop()`，每个回收敌机残留一条 `scene.events.on('update', sync)` → 同屏 60 上限敌机反复回收会累积监听（违背「不新增每帧全量扫描」）。**必须**在 `recycle()` 清理；QA 用 `window.__GAME._dynLight.idleAuraActive` 断言回收后归零。
- **视觉叠加**：Boss 已有 `fxG` 相位环脉动 + aura 呼吸，两层呼吸叠加可能偏"花" → Boss aura alpha 压低至 0.10、scalePulse 0.08；QA 目测 Boss 战不喧宾夺主。
- **与受击/死亡冲突**：aura 是独立对象，但死亡演出中敌机 scale→0 时 aura 仍在呼吸 → 由 recycle/die 的 stop() 兜底（视觉上 aura 随死亡在 ~100ms 内被清）。
- 回归：射击/受击/死亡/精英 glow/Boss 相位脉动行为不变；敌机/僚机命中判定不受 aura 影响（aura 无 body、depth 低于本体）。

### 探针建议
- `window.__GAME._dynLight` 扩展只读字段 `idleAuraActive`：战斗中存在普通敌机时 >0；击杀/回收后回落；reduced/low 下恒 0。
- 目测断言：普通敌机脚下有缓慢呼吸光环（alpha/scale 周期变化）、Boss 有第二层大光环、僚机随元素换色；reduced 下无任何光环。
- 监听泄漏断言：连续 spawn+recycle 30 次敌机后，`idleAuraActive` 不为 30（证明 stop() 生效）。

---

## 第 V3 条：波次清空庆祝（克制演出 · 区别于 Boss 战）

### 背景 / 目标
当前波次全清只在 `WaveSystem.js` L166 发 `EVENTS.WAVE_CLEARED`，GameScene `_onWaveCleared`（L596-604）仅处理爬塔增益面板，**普通波次清空无任何视觉反馈**。目标：一波全清时给一段**克制庆祝演出**（区别于 Boss 战的大横幅/屏震/定格）：玩家周围一小簇主题色环 + 小型粒子爆点 + HUD 波次文字脉冲。**不新增横幅、不屏震、不定格、不放 camera.flash**。

### 改动文件 + 函数签名
- `src/systems/VFX.js` — 新增 `waveClearCelebrate(scene, x, y, accent)`；模块计数 `_waveClearCount`。
- `src/scenes/GameScene.js` — `_onWaveCleared`（L596-604）顶部追加一行。
- `src/scenes/UIScene.js` — bindEvents（L484 `WAVE_STARTED` 绑定旁）新增 `_onWaveClearUi` 监听 + unbind（L928 区域）。
- `src/config/GameConfig.js` — 新增 `WAVE_CLEAR` 配置块（append-only）。

```js
// VFX.js 新增
export function waveClearCelebrate(scene, x, y, accent) {
  if (!scene) return;
  _waveClearCount++;
  const color = accent || 0x66ccff;
  // 克制：1 圈主题色环（shockwaveRing 内部已处理 reduced → 静态）
  shockwaveRing(scene, x, y, color, { radius: WAVE_CLEAR.ringRadius, duration: WAVE_CLEAR.ringMs, depth: 54 });
  if (prefersReduced) return;
  // 小型粒子爆点：复用 vfxPool.explosion emitter（poolExplode 已按画质档缩放 quantity、可换色）
  if (scene.vfxPool) {
    poolExplode(scene, scene.vfxPool, x, y, color, { scale: WAVE_CLEAR.burstScale });
  }
}
```

```js
// GameScene.js _onWaveCleared 顶部追加（L596 进入即执行，先庆祝再走既有爬塔/推进逻辑）
this._onWaveCleared = () => {
  VFX.waveClearCelebrate(this,
    this.player && this.player.active ? this.player.x : GAME_WIDTH / 2,
    this.player && this.player.active ? this.player.y : GAME_HEIGHT / 2,
    (this.level && this.level.theme && this.level.theme.accent) || 0x66ccff);
  if (this.isTower && !this.gameEnded) { /* 既有逻辑不变 */ }
  // …（其余原样）
};
```

```js
// UIScene.js bindEvents 新增（reduced-motion 下不脉冲，纯 HUD 微反馈）
this._onWaveClearUi = () => {
  if (PREFERS_REDUCED || !this.waveText || !this.waveText.active) return;
  this.tweens.killTweensOf(this.waveText);
  this.waveText.setScale(1);
  this.tweens.add({ targets: this.waveText, scale: 1.12, duration: 140, yoyo: true, ease: EASE.feedback });
};
EventBus.on(EVENTS.WAVE_CLEARED, this._onWaveClearUi);
// unbind() 内追加：EventBus.off(EVENTS.WAVE_CLEARED, this._onWaveClearUi);
```

### 精确语义
- **触发点**：`WaveSystem.update` 'waiting' 态 `aliveEnemies===0` 且非超时（L164-166）时发 `WAVE_CLEARED`；**Boss 波不会触发**（Boss 波走 state='boss'，不经过 waiting 清空判定；Boss 胜利走 `BOSS_DEFEATED`）→ 庆祝只属于普通波次，天然区别于 Boss 战。
- **演出量**：1 圈主题色环（radius 46、340ms、depth 54）+ 复用爆炸 emitter 的小型爆点（`poolExplode(scale 0.5)` → high≈11 粒、mid≈8、low≈5，主题色 accent）+ HUD 波次文字 140ms 脉冲。
- **位置**：玩家位置（庆祝围绕玩家展开；玩家死亡/不活跃时回落屏中）。
- **克制性红线**：无 `flashCenter` 横幅、无 `camera.flash`、无 `shake`、无 `hitStop`、无大爆炸五层——只此一段小演出，避免每波都打断战斗节奏。
- **爬塔兼容**：爬塔每波清空也发 `WAVE_CLEARED` → 庆祝 + 3 选 1 面板照常弹出（庆祝先于面板，无冲突）。
- **无尽/活动**：`endless` 模式每波也发 `WAVE_CLEARED` → 庆祝照常（纯视觉，不碰得分/进度）。

### 参数表（append-only，默认值）
```js
// GameConfig 新增
export const WAVE_CLEAR = {
  ringRadius: 46,
  ringMs: 340,
  burstScale: 0.5,   // poolExplode scale：high≈11 粒 / mid≈8 / low≈5
  uiPulse: true,     // HUD 波次文字脉冲开关
};
```

### 降级策略
| 档位 | 行为 |
|---|---|
| high | 环 + 爆点（~11 粒）+ HUD 脉冲 |
| mid | 环 + 爆点（~8 粒）+ HUD 脉冲 |
| low | 环 + 爆点（~5 粒）+ HUD 脉冲（粒子本已按 qs 缩） |
| reduced-motion | 仅静态环（`shockwaveRing` reduced 分支）+ HUD 文字**不脉冲**（纯静态） |
| Canvas | 环是 Graphics circle + ADD、爆点是粒子 + ADD，无 postFX 依赖 → 双模式一致 |

### 风险与回归点
- **每波打断感**：若演出过强（环太大/粒子太多）会每 1-2s 打断一次 → 参数已压低（radius 46、scale 0.5）；QA 目测 6 波连续清空不喧宾夺主。
- **与爬塔面板时序**：`_onWaveCleared` 顶部新增演出，不改变 `showTowerBuffPanel()` 调用与 `continueAfterWave()` 推进（QA 回归爬塔波推进不卡）。
- **Boss 波不误触发**：回归断言 Boss 战结束（`BOSS_DEFEATED`）不出现波次庆祝环。
- 回归：`WAVE_CLEARED` 既有消费方（GameScene 爬塔 + UIScene 若已有监听）行为不变；得分/波次推进数值不变。

### 探针建议
- `window.__GAME._dynLight` 扩展只读字段 `waveClearCount`：每波全清 +1；Boss 战结束不 +1；reduced 下环仍出现（静态）但 `waveClearCount` 仍计数。
- 击杀本波最后一只敌机 → 1s 内玩家位置出现 depth 54 主题色环 + vfxPool.explosion.poolUseCount 增量。

---

## 第 V5 条：关卡环境叙事层（主题文字/环境徽记/进度叙事）

### 背景 / 目标
当前每关只有背景渐变 + 星空染色 + 顶部主光，关卡身份感弱（第 1 关与第 2 关除了色调几乎无区别）。目标：加一层**低干扰纯视觉**的环境叙事：左下角关卡主题文字 + 环境徽记（矢量盾徽），底部一条随波次推进的细进度线——全静态/事件驱动，零每帧成本，不挡玩法。

### 改动文件 + 函数签名
- `src/scenes/GameScene.js`
  - `create()` L148（`VFX.addKeyLight(this)`）之后调用 `this._buildEnvNarrative(theme);`
  - 新增 `_buildEnvNarrative(theme)` 方法（建 watermark/emblem/progress 三件套，全静态）；
  - bindEvents（L605 附近）注册 `_onWaveStartedEnv`（`EVENTS.WAVE_STARTED`）+ shutdown（L2607 附近）解绑。
- `src/config/GameConfig.js` — 新增 `ENV_NARRATIVE` 配置块（append-only）。

```js
// GameScene.js 新增
_buildEnvNarrative(theme) {
  const acc = (theme && theme.accent) || 0x66ccff;
  const lvl = this.level || {};
  const isBossRush = this.mode === 'bossrush';
  // 1) 主题文字（左下角，低 alpha；静态零成本）
  const hex = `#${(acc & 0xffffff).toString(16).padStart(6, '0')}`;
  const name = t(`levelName_${lvl.id}`) !== `levelName_${lvl.id}` ? t(`levelName_${lvl.id}`) : (lvl.name || '');
  const watermark = this.add.text(14, GAME_HEIGHT - 26, name, {
    fontFamily: 'sans-serif', fontSize: `${ENV_NARRATIVE.watermark.size}px`, fontStyle: '700', color: hex,
  }).setOrigin(0, 1).setAlpha(ENV_NARRATIVE.watermark.alpha).setDepth(ENV_NARRATIVE.watermark.depth);
  // 2) 环境徽记：矢量盾徽（Graphics 一次绘制，零每帧成本）
  const emblem = this.add.graphics().setDepth(ENV_NARRATIVE.emblem.depth).setAlpha(ENV_NARRATIVE.emblem.alpha);
  const ex = 30, ey = GAME_HEIGHT - 52, es = ENV_NARRATIVE.emblem.size;
  emblem.lineStyle(1.5, acc, 1);
  emblem.strokePoints([
    { x: ex, y: ey - es }, { x: ex + es * 0.8, y: ey - es * 0.55 },
    { x: ex + es * 0.8, y: ey + es * 0.35 }, { x: ex, y: ey + es },
    { x: ex - es * 0.8, y: ey + es * 0.35 }, { x: ex - es * 0.8, y: ey - es * 0.55 },
  ], true);
  emblem.lineBetween(ex - es * 0.35, ey, ex + es * 0.35, ey);
  // 3) 进度叙事：底部细进度线（事件驱动，非无尽/非 BossRush 显示）
  let progress = null;
  if (!this.eventCfg && !isBossRush) {
    const y = ENV_NARRATIVE.progress.y;
    const bar = this.add.graphics().setDepth(ENV_NARRATIVE.progress.depth);
    const w = GAME_WIDTH - 32;
    bar.fillStyle(0xffffff, ENV_NARRATIVE.progress.bgAlpha).fillRect(16, y, w, ENV_NARRATIVE.progress.h);
    const setRatio = (r) => {
      const rr = Phaser.Math.Clamp(r || 0, 0, 1);
      bar.fillStyle(acc, ENV_NARRATIVE.progress.fillAlpha).fillRect(16, y, Math.max(1, w * rr), ENV_NARRATIVE.progress.h);
    };
    progress = { setRatio };
    if (this.waves) setRatio((this.waves.currentWave || 1) / (this.level.waves || 1));
  }
  this._envNarrative = { watermark, emblem, progress, accent: acc };
}
// bindEvents 内注册：
this._onWaveStartedEnv = (p) => {
  if (this._envNarrative && this._envNarrative.progress && p && p.total) {
    this._envNarrative.progress.setRatio(p.wave / p.total);
  }
};
EventBus.on(EVENTS.WAVE_STARTED, this._onWaveStartedEnv);
// shutdown 解绑：EventBus.off(EVENTS.WAVE_STARTED, this._onWaveStartedEnv);
```

### 精确语义
- **主题文字**：左下角（14, GAME_HEIGHT-26），12px、700、主题色、alpha 0.18、depth 4——位于 gameplay 层（60）之下、星空之上，不挡弹幕/拾取（拾取多在屏中）。
- **环境徽记**：矢量六边形盾徽（Graphics 一次绘制），位于文字上方（30, GAME_HEIGHT-52），主题色描边、alpha 0.22、depth 4，零每帧成本。
- **进度线**：屏底 y=GAME_HEIGHT-10、高 2px、宽 GAME_WIDTH-32；底色白 0.06 + 主题色填充 0.35；`setRatio(wave/total)` 由 `WAVE_STARTED` 事件驱动（波次开始即更新，当前波占比显示"已进行到第 N 波"）；**无尽/活动/BossRush 不显示**（无 total 语义）。
- **零每帧成本**：三件套全部静态或事件驱动；`GameScene.update` 无新增扫描。
- **i18n**：主题文字优先走 `t('levelName_{id}')`，缺失回退 `lvl.name`（中文名）。
- **纯视觉**：不读写任何数值/存档/成就。

### 参数表（append-only，默认值）
```js
// GameConfig 新增
export const ENV_NARRATIVE = {
  watermark: { alpha: 0.18, size: 12, depth: 4 },
  emblem:    { alpha: 0.22, depth: 4, size: 12 },
  progress:  { y: GAME_HEIGHT - 10, h: 2, bgAlpha: 0.06, fillAlpha: 0.35, depth: 4 },
};
```

### 降级策略
| 档位 | 行为 |
|---|---|
| high / mid / low | **三档一致**（三件套全是静态/事件驱动，零每帧成本，无档位差异） |
| reduced-motion | **不影响**（全静态，本无动画） |
| Canvas | Text + Graphics，无 postFX 依赖 → 双模式一致 |

### 风险与回归点
- **遮挡玩法**：文字/徽记/进度线都在屏边缘（y≥GAME_HEIGHT-26 / y=GAME_HEIGHT-10）且 depth 4（低于 gameplay 60）→ 弹幕/拾取/爆炸绘制在其上，不遮挡；QA 目测敌弹掠过左下角不遮挡关键信息。
- **`levelName_{id}` 词条缺失**：回退 `lvl.name`，不会显示 raw key（探针断言 watermark 文本不是 `levelName_*` 字面量）。
- **无尽/BossRush 进度线**：必须隐藏（无 total），回归断言两模式无底部进度线。
- 回归：背景渐变/星空/顶光不变；`WAVE_STARTED` 既有消费方（UIScene 波次文本）不变。

### 探针建议
- `window.__SKY._envNarrative`：断言 `{watermark, emblem, progress}` 存在；无尽/BossRush 下 `progress === null`。
- 触发一关第 1 波 → `_envNarrative.progress` 内部 fill 矩形宽度 >0 且随波次增长；watermark 文本非 raw key。

---

## 第 V7 条：暂停氛围（遮罩雾化/暗角加深/标题辉光）

### 背景 / 目标
当前暂停面板（`pauseOverlay` L206-222）只有一层平铺黑遮罩（dim 0x000000 0.62）+ 标题 + 按钮，画面"平面"。目标：进入暂停叠加**氛围层**——暗角加深（复用 `vignette-perm` 纹理）+ 标题辉光（`glow_soft` 呼吸），恢复即清；兼容 reduced-motion（无呼吸，纯静态）。

### 改动文件 + 函数签名
- `src/scenes/UIScene.js`
  - 新增 `_ensurePauseAtmosphere()` / `_startPausePulse()` / `_stopPausePulse()` 私有方法；
  - `togglePause()`（L424-436）暂停分支调 `_ensurePauseAtmosphere()+_startPausePulse()`、恢复分支调 `_stopPausePulse()`；
  - 测试钩子 `window.__PAUSE`（只读）。
- `src/config/GameConfig.js` — 新增 `PAUSE_ATMO` 配置块（append-only）。

```js
// UIScene.js 新增
_ensurePauseAtmosphere() {
  if (this._pauseAtmo) return;
  // 懒创建：确保 'vignette-perm' 已存在（_buildFilmLayers L238 在 pauseOverlay 创建之后运行，
  // 首次暂停必然晚于 create → 纹理必已生成；仍兜底生成以防极端时序）
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
_startPausePulse() {
  if (!this._pauseAtmo) return;
  if (PREFERS_REDUCED) return;                       // reduced：静态氛围，无呼吸
  const { fog, glow } = this._pauseAtmo;
  this._pauseTweens = [
    this.tweens.add({ targets: fog, alpha: this._pauseAtmo.baseFog + PAUSE_ATMO.fogPulse,
      duration: PAUSE_ATMO.fogMs, yoyo: true, repeat: -1, ease: EASE.breathe }),
    this.tweens.add({ targets: glow, alpha: this._pauseAtmo.baseGlow + PAUSE_ATMO.glowPulse,
      duration: PAUSE_ATMO.glowMs, yoyo: true, repeat: -1, ease: EASE.breathe }),
  ];
}
_stopPausePulse() {
  if (this._pauseTweens) { this._pauseTweens.forEach((tw) => tw && tw.stop()); this._pauseTweens = null; }
  if (this._pauseAtmo) {
    this._pauseAtmo.fog.setAlpha(this._pauseAtmo.baseFog);
    this._pauseAtmo.glow.setAlpha(this._pauseAtmo.baseGlow);
  }
}
// togglePause() 修改：
//   暂停分支（_paused=true 前）：this._ensurePauseAtmosphere(); this._startPausePulse();
//   恢复分支（_paused=false 前）：this._stopPausePulse();
// 测试钩子（bindEvents 或 create 末尾）：
//   if (typeof window !== 'undefined') Object.defineProperty(window, '__PAUSE', {
//     configurable: true, get: () => this._pauseAtmo ? {
//       paused: this._paused, fogAlpha: this._pauseAtmo.fog.alpha,
//       glowAlpha: this._pauseAtmo.glow.alpha, pulsing: !!this._pauseTweens,
//     } : { paused: this._paused, fogAlpha: 0, glowAlpha: 0, pulsing: false },
//   });
```

### 精确语义
- **进入暂停叠加**：首次暂停懒建 fog（`vignette-perm` 暗角纹理，alpha 0.22）与标题辉光（`glow_soft`，alpha 0.16、tint 标题色、ADD、scale 0.6≈307px 覆盖标题区），插入 pauseOverlay（fog 在 dim 之上加深边缘、glow 在 pTitle 之下）；随后启动两条呼吸 tween（fog 0.22↔0.30、glow 0.16↔0.26）。
- **恢复即清**：`togglePause` 恢复分支 `_stopPausePulse()` kill 两条 tween + 复位 alpha；`pauseOverlay.setVisible(false)` 一并隐藏 fog/glow（二者是容器子对象）→ 画面完全还原。
- **reduced-motion**：`_startPausePulse` 直接 return（无呼吸），fog/glow 静态 alpha 保留（暂停氛围仍在，只是不呼吸）。
- **与低血暗角/常驻暗角叠加**：暂停时屏缘 = 常驻 0.16 + 低血（若有）+ dim 0.62 + fog 0.22，边缘更暗 → 即「暗角加深」预期；中心区不受影响（vignette 中心透明）。
- **零每帧成本**：仅暂停期间两条 tween；恢复后 kill。

### 参数表（append-only，默认值）
```js
// GameConfig 新增
export const PAUSE_ATMO = {
  fogAlpha: 0.22, fogPulse: 0.08, fogMs: 2000,
  glowAlpha: 0.16, glowPulse: 0.10, glowMs: 2200,
  glowScale: 0.6,   // glow_soft 512px × 0.6 ≈ 307px，覆盖标题区
};
```

### 降级策略
| 档位 | 行为 |
|---|---|
| high / mid | fog + glow 呼吸（两条 tween） |
| low | fog + glow 静态（不呼吸，省 tween 开销；仍叠加氛围） |
| reduced-motion | fog + glow 静态（无 tween） |
| Canvas | 纯 Image + ADD（glow）与 NORMAL（vignette），无 postFX 依赖 → 双模式一致 |

### 风险与回归点
- **`vignette-perm` 时序（最高风险）**：pauseOverlay 创建（L206-222）早于 `_buildFilmLayers`（L238）→ 不能在建面板时直接用该纹理；必须**懒创建**（首次暂停时 `_ensurePauseAtmosphere`，此时纹理必已存在）+ 兜底生成。QA 断言首次暂停无纹理缺失报错。
- **恢复还原**：恢复后若 `_stopPausePulse` 漏 kill 或漏复位 alpha，下一帧画面仍带氛围 → 回归断言恢复瞬间 fog/glow alpha 回到 base、`__PAUSE.pulsing===false`。
- **按钮可点性**：fog/glow 插在 dim 之上、按钮之下 → 不影响 resume/quit/hitbox 按钮点击（容器深度 200，按钮容器在 glow 之后）。QA 目测按钮仍可点。
- 回归：暂停/恢复既有行为（`scene.pause/resume(GAME)`、BGM 暂停/恢复、HUD 显隐）不变。

### 探针建议
- `window.__PAUSE`：暂停时 `paused:true`、`fogAlpha≈0.22-0.30`、`glowAlpha≈0.16-0.26`、`pulsing:true`（reduced/low 为 false）；恢复后 `paused:false`、`pulsing:false`、alpha 回 base。
- 首次暂停后断言 `scene.textures.exists('vignette-perm')` 为 true；无控制台报错。

---

## 末尾：回归清单 + 探针脚本思路

### 全量回归清单（QA 验收用）
1. `WINGMAN.COMBO`（GameConfig L699-705）grep 断言未改；成就 id 集合未变；`WingmanSystem.js` / `FloatingText.js` / `SaveManager.js` diff 为空。
2. V2：贴弹擦弹 → `vfxPool.grazeSpark.poolUseCount>0`、青白火花出现、160ms 内消失；超载 5 连擦同帧 ≤3 簇；qa_p2 链式擦弹数值探针全绿；reduced/low 下无火花或按档减量。
3. V4：普通敌机（非 kamikaze/精英）有呼吸光环、Boss 有第二层光环、僚机随元素换色；`_dynLight.idleAuraActive` 回收后归零（无监听泄漏）；受击/死亡/精英 glow/Boss 相位脉动不变；reduced/low 无 aura。
4. V3：每波全清在玩家位置出现主题色环 + 小爆点 + HUD 波次文字脉冲；Boss 战结束不出现；爬塔波推进不卡；无横幅/屏震/定格。
5. V5：左下角主题文字 + 盾徽 + 底部进度线；无尽/BossRush 无进度线；watermark 非 raw key；三档一致。
6. V7：暂停时暗角加深 + 标题辉光呼吸；恢复即清（`__PAUSE.pulsing:false`、alpha 回 base）；reduced/low 静态；无纹理缺失报错；按钮可点。
7. 全局性能：无新增每帧全量扫描（V4 aura 按单位监听、V2/V3 复用池、V5 静态、V7 仅暂停两条 tween）；`_dynLight` 只读字段为 append（不破坏既有探针断言）。

### 探针脚本思路
- `qa_probes/test_visual_v2.mjs`：进战斗 → 贴弹擦弹 → 读 `window.__SKY.vfxPool.grazeSpark.poolUseCount`/`lastQuantity` + `window.__GAME._dynLight.grazeSparkActive`；reduced 分支断言 0。
- `qa_probes/test_visual_v3.mjs`：击杀本波最后敌机 → 读 `_dynLight.waveClearCount` +1；Boss 战结束断言不 +1；`pool.explosion.poolUseCount` 增量。
- `qa_probes/test_visual_v4.mjs`：战斗存在普通敌机 → `_dynLight.idleAuraActive>0`；连杀/回收后回落；reduced/low 恒 0；spawn+recycle 30 次后不为 30（防泄漏）。
- `qa_probes/test_visual_v5.mjs`：读 `window.__SKY._envNarrative`（watermark/emblem/progress）；无尽/BossRush 断言 progress null；wave 推进宽度增长。
- `qa_probes/test_visual_v7.mjs`：触发暂停 → 读 `window.__PAUSE`（paused/pulsing/alpha）；恢复 → pulsing false、alpha 回 base；reduced/low 下 pulsing false。
- 复用既有 `window.__SKY` / `window.__GAME._dynLight` / `window.__FILM` 钩子模式，**新增钩子仅 append（不破坏现有探针断言）**。

---

## 附：红线重申（开发 PR 自检清单）
- [ ] `GameConfig.js` `WINGMAN.COMBO`（L699-705）diff 为空
- [ ] `AchievementManager.js` 26 成就 id diff 为空
- [ ] `WingmanSystem.js` diff 为空（V4 僚机光环在 `Wingman.js` 实体 + VFX 辅助内实现）
- [ ] `FloatingText.js` diff 为空（V2 火花走粒子池，不走飘字）
- [ ] `SaveManager.js` diff 为空（无新增存档字段）
- [ ] 零外部资源（无图片/字体/网络/音频新增）
- [ ] 纯视觉零业务逻辑（不触碰伤害/数值/流程/存档）
- [ ] 性能纪律：复用现有池/纹理；不新增资源；不新增每帧全量扫描
