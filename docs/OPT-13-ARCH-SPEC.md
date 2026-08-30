# OPT-13 游戏本体优化实现规格（架构方案 · 开发/QA 引用版）

> 作者：高见远（arch-plan / 架构师）｜日期：2026-08-30
> 状态：**已拍板，待开发实现**（Phase 1b 产出）
> 范围：13 条游戏本体优化（批次A 技术快赢 1-5 + 产品 6-9 / 批次B 内容深度 10-15）的**函数级实现规格**
> 代码基线：HEAD = 22ee56e（P2 视觉四件套 QA 全绿）。存档基线：SaveManager 现有字段全部保留，**只可 append-only 新增**。
> 产品语义对齐：本规格产品向条目与 `docs/OPT-10-PM-REQUIREMENTS.md` 语义一致（救济局口径 / 变异间隔 / 昵称策略 / 免疫门槛 / 狂暴 DPS 检查均已按 PM 拍板写入本文）。
> 引用说明：worker 以本文件为唯一实现规格来源；正文完整、无「见其他文档」引用（行号为当前基线核对值，开发以实际为准）。

---

## 〇、红线总览（13 条逐一确认，零触碰）

| 红线项 | 结论 |
|---|---|
| `GameConfig.js` `WINGMAN.COMBO` 五字段（WINDOW_MS:1200 / TRIGGER:5 / BUFF_MS:3000 / DMG_MUL:1.35 / MAX_COUNT:9，L567-573） | **零触碰**。13 条均不读写该块。B11 连击蓄力用的是 `GameScene.registerKill` 的击杀 combo（`this.combo`），与僚机元素协同 combo（WINGMAN.COMBO / WINGMAN_COMBO 事件）**完全无关**，是两套系统。 |
| `AchievementManager.js` 26 个成就 id 及 condition/progress（L21-130） | **零改动 id**。A9 救济局采用**附加式抑制开关**（relief 标记，使本次 run 的 `_checkLive/_checkAll` 不解锁）；B11 只动「当前连击」，峰值 `maxCombo`/`comboPeak` 只增不减，combo_15/combo_30 判定不受影响。 |
| `WingmanSystem.js` | **零触碰**。元素免疫门控落在 `Enemy.hit/applyReaction` + `ElementReaction` 的伤害门控，不碰僚机系统。 |
| `FloatingText.js` | 只新增浮字/横幅（附加式），不改既有 `damageNumber` 行为。 |
| `SaveManager` 旧字段结构 | **全部保留**；仅 append-only 新增：`nickname` / `failStreak` / `reliefRuns` / `codex` / `codexDecor` / `lastScore` / `prevScore`（`title` 视实现可选，PM 语义为纯派生可零字段）。 |
| 零外部资源 | TextureFactory 程序纹理 + WebAudio 合成；**零图片 / 音频 / 网络依赖**（纯本地 canvas / 本地存档）。 |
| 纯视觉 / 零业务逻辑 | 称号 / 分享卡 / 图鉴装饰 / 免疫标记 / 狂暴演出等展示类内容**不得携带任何业务数值逻辑**；业务逻辑只在既有机制上叠加配置。 |

> 检查方式：实现阶段由开发 PR 自检；QA 验收按上表逐项回归（尤其 R1/R2/R5 需 grep 断言：`WINGMAN.COMBO` 未被修改、成就 id 集合未变、SaveManager 旧字段写入点未变）。

---

## 一、实现顺序表（推荐）

### 批次A（纯技术无玩法风险，稳定基线）

| 顺序 | 条目 | 前置理由 |
|---|---|---|
| 1 | A3 EVENTS 事件契约补登记 | 最小改动，后续多条依赖新事件登记 |
| 2 | A5 激光扫射递归取消 | 小改快验，独立 |
| 3 | A1 SaveManager 存档降频 | 批次B 全部存档字段依赖；需先行稳定 |
| 4 | A4 对象池纪律加固 | B14 全屏风暴弹幕池依赖 |
| 5 | A2 checkBeamHits 性能优化 | 独立可并行 |
| 6 | A6 主线波次变体（含精英承载） | 批次B 依赖（B10 精英 / B14 免疫敌人承载） |
| 7 | A7 Boss 狂暴终结技 | 独立 |
| 8 | A8 无尽变异规则 | 独立 |
| 9 | A9 连续失败救济局 | 依赖 A1（failStreak 落盘） |

### 批次B（依赖 A1 存档降频 / A4 弹幕池 / A6 变体承载精英）

| 顺序 | 条目 | 依赖 |
|---|---|---|
| 1 | B10 精英敌人 mini-boss | A6（变体承载精英） |
| 2 | B11 连击蓄力爆发 | 独立（读 `this.combo`） |
| 3 | B12 称号系统 | 纯派生可零存档；如需落盘称号依赖 A1 |
| 4 | B14 元素免疫 + 全屏风暴 | A4（弹幕池）/ A6（免疫敌人数据承载） |
| 5 | B13 图鉴收藏系统 | A1（codex 落盘）/ A6（敌人类型） |
| 6 | B15 分享卡升级 | B12（称号）/ A1（nickname/lastScore） |

---

## 第 A1 条：SaveManager 存档降频（技术快赢 · 基础）

### 涉及文件
- `src/utils/SaveManager.js`（914 行）— `save()` L206-213、`set()` L219-222、`addCoins()` L224-229、`load()` L114-204
- `src/scenes/GameScene.js`（2077 行）— `collectCoin()` L919-930（每金币 `addCoins(1)` 触发写盘）、`endGame()` L1825-1993（L1935 `SaveManager.save()`）
- `src/config/GameConfig.js` — EVENTS 补登记 `SAVE_FAILED`（见 A3）

### 现状（函数级）
- `save()`：`JSON.stringify` 全量 + `setItem` 静默 catch；全库调用点实测 **32 处**。
- `addCoins()`：每金币 `+1` 即触发写盘，高频写盘有性能与配额风险。
- `load()`：深合并兜底 + 合法性清洗（已有）。

### 改动点（函数级）
1. `save()` 改为**脏标记 + rAF/微任务合并写**：首次改动置 `_dirty=true` 并调度一次 flush，同帧多次 `save()` 合并为一次写盘。
2. **无 `requestAnimationFrame` 环境（Node 头测 `qa_probes`）退化为同步写**，保证既有探针不破。
3. 新增 `flushNow()`：立即同步写盘并清脏（`endGame()` L1935 改调 `flushNow()`，保证结算数据不丢）。
4. 新增 `isPersistBroken()`：`localStorage` 写入抛 QuotaExceeded/不可用时置 `_broken=true`，仅首次经 `EVENTS.SAVE_FAILED` 一次性提示，避免刷屏。
5. `addCoins()` 内部改为累加后触发 `save()`（不再每金币一次）；金额实时性由 HUD 事件保证、落盘合并。

### 新增接口签名
```js
// SaveManager
save(): void            // 签名不变；内部改脏标记 + rAF 合并写（无 rAF 同步写）
flushNow(): void        // 新增：立即同步写盘并清脏
isPersistBroken(): boolean // 新增：是否处于持久化降级态
```

### 数据结构 / 配置表（append-only）
```js
// 存档顶层新增（仅示例键名，语义见各消费条目）
nickname: '',            // B15 分享卡昵称（默认 + 随机后缀）
lastScore: 0,            // B15 上次分数（结算后更新）
prevScore: 0,            // B15 上上次分数（滚动保留，供 deltaPct）
title: '',               // B12 当前称号 id（可选：PM 语义纯派生可零字段）
failStreak: {},          // A9 救济局：{levelId: n} 各关连续失败计数
reliefRuns: 0,           // A9 救济局累计次数（统计用）
codex: {                 // B13 图鉴
  enemies: {}, bosses: {}, weapons: {}, elements: {}
},
codexDecor: []           // B13 图鉴装饰购买记录
```

### reduced-motion / 性能档 / i18n
- 合并写天然降低主线程抖动，无需分档；无新 UI/动效/文案 → 三项 N/A。

### 风险与回归点（衔接既有系统）
- **Node 头测兼容**：`qa_probes/test_*.mjs` 无 rAF 且同步读 localStorage → 无 rAF 环境退化同步写兜底，既有探针不破。
- **结算不丢**：`endGame()` 必须改调 `flushNow()`，否则结算数据（topScores/勋章/成就解锁）可能未落盘。
- 回归：存档读写、金币累加、排行榜分数、成就解锁写盘、32 处既有调用点行为等价。

---

## 第 A2 条：checkBeamHits 每帧热点优化（技术快赢）

### 涉及文件
- `src/scenes/GameScene.js` — `update()` L565-690（`checkBeamHits` 每帧调用 L612）、`checkBeamHits()` L693-723（`getBounds()`×5 分配热点）、`checkBossHits()` L726-758
- `src/config/GameConfig.js` — `COMBAT_PERF` 配置块（append-only）

### 现状（函数级）
- `checkBeamHits()` 每帧 O(beams×enemies)，内部 `getBounds()`×5 高频分配（Phaser Rectangle 对象），是明显 GC/CPU 热点。

### 改动点（函数级）
1. **手算 AABB**：用 `x/y/width/height` 手写矩形相交判定替换 `getBounds()` 调用，消除每帧对象分配。
2. **降频**：按 `COMBAT_PERF.HIT_CHECK_EVERY`（默认每 N 帧一次）执行命中检测。
3. **跳帧精度补偿**：跳帧期间累积 dt，结算时 `damage × (累积 dt / 单帧 dt)` 补偿 DPS，避免降频后伤害失真。
4. `checkBossHits()` 同法评估（可选同批优化，保持 Boss 盾判定等价）。

### 新增接口签名
```js
// GameConfig append-only
COMBAT_PERF: {
  HIT_CHECK_EVERY: 2   // 每 2 帧检测一次（可调 1/2/3；1=旧行为）
}
```

### 数据结构 / 配置表
见上（append-only）。

### reduced-motion / 性能档 / i18n
- `HIT_CHECK_EVERY=1` 等价旧行为；低端机可调 3。无新 UI/文案 → reduced-motion / i18n N/A。

### 风险与回归点（衔接既有系统）
- 降频导致 DPS 不精确 → 跳帧累积 dt 补偿。
- **Boss 激光扫射（`_patternLaserSweep`）不属于 checkBeamHits 路径**（走点到线段距离判定），QA「Boss 激光扫射不丢帧」验证点不受 A2 影响。
- 回归：光束命中判定、伤害结算数值、Boss 盾判定（checkBossHits 同法评估）。

---

## 第 A3 条：EVENTS 事件契约补登记（技术快赢 · 最先做）

### 涉及文件
- `src/config/GameConfig.js` — `EVENTS` 契约 L25-78（缺 `'__hud_score'` / `'__hud_bombs'` 登记）
- `src/scenes/GameScene.js` — `_onScore()` L459-465（emit `'__hud_score'` L464）、L1332（emit `'__hud_score'`）、`addBomb()` L1081-1084（emit `'__hud_bombs'` L1083）、`useBomb()` L1654-1676（emit `'__hud_bombs'` L1658）
- `src/scenes/UIScene.js` — `bindEvents()` L432（on `'__hud_score'` L438 / `'__hud_bombs'` L447）、`unbind()` L856-880（off `'__hud_score'` L857 / `'__hud_bombs'` L859）

### 现状（函数级）
- 8 处裸字符串事件名（GameScene emit×4 + UIScene on/off×4），未登记在 EVENTS 契约。

### 改动点（函数级）
1. `GameConfig.EVENTS` 补登记：`HUD_SCORE` / `HUD_BOMBS`（**值保持原字符串**，零回归），并为本方案后续事件预留登记位：`SAVE_FAILED` / `BURST_CHANGED` / `BURST_ACTIVATED` / `MUTATION_CHANGED`。
2. GameScene/UIScene 中 8 处裸字符串改为引用 `EVENTS.HUD_SCORE` / `EVENTS.HUD_BOMBS`。

### 新增接口
无新增接口，纯常量引用替换。

### 数据结构 / 配置表（append-only）
```js
// GameConfig.EVENTS 追加（保持既有条目不动）
HUD_SCORE: '__hud_score',        // 值不变，防回归
HUD_BOMBS: '__hud_bombs',        // 值不变，防回归
SAVE_FAILED: '__save_failed',    // A1 使用
BURST_CHANGED: '__burst_changed',// B11 使用
BURST_ACTIVATED: '__burst_activated', // B11 使用
MUTATION_CHANGED: '__mutation_changed' // A8 使用
```

### reduced-motion / 性能档 / i18n
- 事件名常量值不变，无运行期降级；无 UI/文案 → 三项 N/A。

### 风险与回归点（衔接既有系统）
- 8 处字符串必须逐一替换且值不变；遗漏任何一处会导致 HUD 不刷新。
- 回归：分数/炸弹 HUD 显示、炸弹使用、事件监听解绑（unbind 对称）。

---

## 第 A4 条：对象池纪律加固（技术快赢）

### 涉及文件
- `src/scenes/GameScene.js` — 对象池创建 L133-140（`enemyBullets` maxSize:400 未预填、`playerBeams` 裸 group 无 maxSize）、预填循环 L142-146、`recycleBullets()` L1802-1823、`cleanup()` L2052-2076
- `src/entities/Enemy.js` — `recycle()` L478-484
- `src/entities/Player.js` — `_ensureLaserBeam()` L306-325、`_emitBullet()` L261-303（`get()` null 判定 L273）、`fire()` L227-258

### 现状（函数级）
- `enemyBullets` 池未预填（首帧冷启动创建开销）；`playerBeams` 为裸 `this.physics.add.group()` 无 maxSize（无上限增长）。
- `Group.get()` 满时返回 null，未判空会抛错；池复用不复位自定义字段会泄漏状态。

### 改动点（函数级）
1. `enemyBullets`：创建时预填 maxSize:400（预填循环 L142-146 对齐）。
2. `playerBeams`：改为 `this.physics.add.group({ maxSize: 64 })` 或与现有池对齐的上限。
3. 全量排查 `group.get()` 调用点补 null 判空（`Player._emitBullet` L273 已有，补齐其余）。
4. **池复用复位契约**：`Enemy.recycle` / 子弹回收必须复位全部自定义字段——`byWingman / pierce / _lastHit / _wmTinted / scale / rotation` 等。

### 新增接口
无新增对外接口；补充内部复位方法（如 `resetPooled()`）。

### 数据结构 / 配置表（append-only）
```js
POOL: {
  enemyBullets: 400,
  playerBeams: 64
}
```

### reduced-motion / 性能档 / i18n
- 低性能档可降低预填数量与 maxSize；无 UI/文案 → reduced-motion / i18n N/A。

### 风险与回归点（衔接既有系统）
- 池复用不复位是状态泄漏主因，回归需覆盖：僚机子弹（`byWingman`）、穿透弹（`pierce`）、命中冷却（`_lastHit`）、元素染色（`_wmTinted`）、缩放/旋转复位。
- QA：长局战斗对象数量稳定、无内存增长、无「子弹不消失 / 错误染色」。

---

## 第 A5 条：激光扫射递归取消（技术快赢）

### 涉及文件
- `src/entities/Enemy.js` — `_laserSweep()` L309-360（递归 delayedCall L356）、`update()` L116-179、`spawn()` L64-114、`recycle()` L478-484、`die()` L445-476
- `src/entities/Boss.js` — `_patternLaserSweep`（同款递归，建议一并加固）

### 现状（函数级）
- `_laserSweep()` 每 16ms 递归 delayedCall 自调度，`recycle()` 时无显式取消；敌人回收后若扫射链仍存活会持续 tick 空引用 / 幽灵特效，且与对象池复用叠加会污染下一个复用实例。

### 改动点（函数级）
1. `Enemy` 增加实例标志 `this._sweeping = false`；`_laserSweep()` 进入即置 true，退出（或目标不再 active / 场景 shutdown）置 false。
2. 递归调度前检查 `if (!this._sweeping || !this.active) return;`。
3. `recycle()` / `die()` / `spawn()` 复位 `_sweeping = false` 并持有 beam/glow/warn 引用，回收时 `beam.setActive(false)` 等清理。
4. `Boss._patternLaserSweep` 同款加固。

### 新增接口
无对外新增；内部私有字段 `_sweeping`。

### 数据结构
私有字段，无需配置表。

### reduced-motion / 性能档 / i18n
- 激光预警条属于战斗核心信息，不建议关闭；仅关闭屏幕震动类演出（若有）。激光光束粒子数按 PERFORMANCE 档位削减。无文案 → i18n N/A。

### 风险与回归点（衔接既有系统）
- QA「Boss 激光扫射不丢帧」验证点不受影响（走点到线段距离判定，不走 checkBeamHits 路径）。
- 回归：各类激光敌人（laserSweep 敌人 + Boss）在死亡/回收/切场景后无幽灵光束、无空引用报错。

---

## 第 A6 条：主线关卡波次变体随机化（含精英承载 · 产品）

### 涉及文件
- `src/systems/WaveSystem.js`（204 行）— `startNextWave()` L38-83（L64 `const plan = this.endless ? null : this.level.wavePlan`）、`getDifficulty()` L86-90、`update()` L92-122、`spawnOne()` L131-203（comp 归一化 L139-154，support[type,mode,weight,pattern] 元组）
- `src/config/GameConfig.js` — `LEVELS` L171-283（wavePlan L190/216/243/271）、`ELITE` 配置块（append-only）
- `src/scenes/GameScene.js` — `spawnEnemy()` L799-806
- `src/entities/Enemy.js` — `TYPES` L19-32、`spawn()` L64-114

### 现状（函数级）
- `startNextWave()` 从 `this.level.wavePlan` 取唯一波次表，重复刷关千篇一律；`spawnOne()` 按 comp 权重抽取敌人。

### 改动点（函数级）
1. `WaveSystem` 新增 `_pickVariantPlan()`：在 wavePlan 基础上按局随机锁定 1 套变体（同局内不换表）；`getVariantId()` 返回当前变体 id 供调试/展示。
2. comp 支持可选字段：`comp = [type, weight, hpMul, speedMul, elite?]`，归一化 L139-154 透传。
3. `GameScene.spawnEnemy()` 参数扩展：elite 与既有 hpMul/speedMul 参数序对齐（见签名）。
4. **精英承载机制**：数据驱动（comp 条目可选 `elite:true`）+ 兜底随机（每关第 2 波起，每波较低概率追加 1 只精英，如 8%）；休闲档不出现。精英数值/掉落细节见 B10。

### 新增接口签名
```js
// WaveSystem
_pickVariantPlan(level, difficulty): PlanVariant   // 局随机锁定 1 套变体表
getVariantId(): string                             // 当前变体 id

// GameScene
spawnEnemy(x, y, typeKey, moveMode, difficulty, firePattern, elite = false, hpMul = 1, speedMul = 1): Enemy
// 注：elite 与既有 hpMul/speedMul 参数序对齐，调用方按新签名传参

// Enemy
spawn(x, y, typeKey, moveMode, difficulty, firePattern, hpMul, speedMul, elite): Enemy
```

### 数据结构 / 配置表（append-only）
```js
// LEVELS[i] 追加（与 wavePlan 同构数组，缺省回退既有 wavePlan，零回归）
waveVariants: [
  [{ count: 3, comp: [['small',1],['diver',0.5]] }, /* ... */],
  [{ count: 3, comp: [['mid',1],['turret',0.3]] },  /* ... */]
]

// GameConfig append-only
ELITE: {
  hpMul: 5, dmgMul: 1.3, scoreMul: 3,
  dropChance: 1.0,            // 击杀必掉 1 个 BOSS_DROP_TABLE 道具（B10）
  spawnChance: 0.08,          // 兜底追加概率（每关第 2 波起）
  tint: 0xffd24a
}
```

### reduced-motion / 性能档 / i18n
- 精英发光走既有 glowTarget（low 档自动关闭）；无新增动画。精英前缀文案 `elitePrefix`（精英· / ELITE·）走 i18n。

### 风险与回归点（衔接既有系统）
- **参数序扩展高风险**：`spawnEnemy()` / `Enemy.spawn()` 所有既有调用点必须按新签名对齐，回归全量敌人生成。
- 某关无 `waveVariants`（旧配置）→ 回退既有 `wavePlan`，行为逐帧等价（零回归）。
- 无尽/爬塔/BossRush/活动模式不受影响（无尽本就程序化随机；BossRush 无波次）。

---

## 第 A7 条：Boss 狂暴终结技（产品）

### 涉及文件
- `src/entities/Boss.js`（556 行）— 构造 L20-103（`_entering` 入场仪式、shieldPart 独立盾）、`update()` L188-224（三阶段 fireGap 900/650/420）、`firePattern()` L226-241、`spawnBulletAt()` L254-264、`hit()` L465-505（阶段机 L475-486、slowAt50/25 L489-496）、`die()` L517-544
- `src/scenes/UIScene.js` — `BOSS_PHASE` 处理 L490-494（『狂暴』文案已有）
- `src/config/GameConfig.js` — `ENRAGE` / `RAGE` 配置块（append-only）

### 现状（函数级）
- Boss 三阶段按 `ratio = hp/maxHp`（>0.66 / >0.33 / else）切 fireGap；无低血量终局演出。

### 改动点（函数级）
1. 新增实例字段：`_enrageTriggered / _enraging / _enrageDmgAcc / _enrageEscUntil`。
2. 新增 `_triggerEnrage()`：`hp < maxHp × 15%` 且非死亡时进入狂暴态（叠加在既有 phase 3 之上；主线/爬塔/BossRush 复用，数值按各自 maxHp 比例）。
3. 新增 `_patternEnrageStorm()`：狂暴专属全屏弹幕（3 组轮换，每组间 ≥0.5s 间歇，**每组含旋转安全缝隙**——缺口宽 ≥ 玩家机身 3 倍，地狱难度也有解）。
4. 新增 `_updateEnrage(dt)`：驱动 `RAGE_WINDOW` DPS 检查——窗口内造成 `maxHp×10%` 伤害 → 破绽 2s（受击 ×2 + 硬直）；失败 → 回血至 `maxHp×20%` + 释放一次全屏弹幕，狂暴态继续（可重复触发）。
5. 狂暴中 Boss 横移速度降 50%（便于集火）；击杀仍走正常 `die()` → `BOSS_DEFEATED`（成就/掉落/爬塔层数链路不变，不双触发）。
6. UIScene `BOSS_PHASE` L490-494 已有『狂暴』文案，接线 enrage 状态即可。

### 新增接口签名
```js
// Boss 内部
_triggerEnrage(): void
_patternEnrageStorm(): void
_updateEnrage(dt): void
```

### 数据结构 / 配置表（append-only）
```js
RAGE: {
  hpThreshold: 0.15,   // hp < maxHp × 15% 触发
  windowMs: 8000,      // DPS 检查窗口
  needDmgRatio: 0.10,  // 需造成 maxHp × 10%
  failHealRatio: 0.20, // 失败回血至 maxHp × 20%
  staggerMs: 2000,     // 破绽持续
  dmgMulOnStagger: 2,  // 破绽受击 ×2
  moveSpeedMul: 0.5,   // 狂暴期横移 -50%
  gapMul: 3,           // 安全缝隙 ≥ 玩家机身 3 倍
  fireGapMs: 500       // 弹幕组间歇
}
```

### reduced-motion / 性能档 / i18n
- 狂暴演出（红屏闪烁/全屏粒子/弹幕密度）在 reduced-motion 下降级：静态横幅 + 弹幕密度减半 + 无红屏频闪；性能档 low 下弹幕密度减半、粒子关闭，保证可玩。
- i18n：`rageTitle`（狂暴终结技！/ RAGE MODE!）、`rageDps`（{sec}s 内造成 {dmg} 伤害）、`rageSuccess`（破绽！）、`rageFail`（狂暴回涌）等中英文案。

### 风险与回归点（衔接既有系统）
- **不动阶段机阈值**：0.66/0.33 阈值与既有 phase 1/2/3 行为零改动；狂暴是 `<15%` 的附加子状态。
- `hitShieldPart` 独立盾不触发阶段（独立盾逻辑不动）。
- 逃生窗口是**硬性设计红线**：禁止无缝隙全屏弹幕；失败惩罚为「回血+弹幕」，不是秒杀。
- 回归：Boss 三阶段切阶段、盾牌部件、慢速特效（slowAt50/25）、BOSS_DEFEATED 链路单次触发。

---

## 第 A8 条：无尽变异规则（产品）

### 涉及文件
- `src/config/Mutations.js`（**新建**）— import `TOWER_BUFFS` spread，新增 `POSITIVE`/`NEGATIVE` 表，`MUTATION_EVERY_LAYERS: 5`
- `src/scenes/GameScene.js` — `applyMutation()` / `_mutationMul()`（新增）、`applyTowerBuff()` L1606-1641（幂等叠加参照）、`spawnTowerBoss()` L895-908（爬塔层数来源）
- `src/config/GameConfig.js` — EVENTS 加 `MUTATION_CHANGED`
- `src/scenes/UIScene.js` — 监听 `MUTATION_CHANGED` 展示变异横幅 + 顶部状态图标（纯视觉）

### 现状（函数级）
- 爬塔已有 TOWER_BUFFS 3 选 1 增益（`applyTowerBuff` / `rollTowerBuffOptions`）；无全局变异层。

### 改动点（函数级）
1. 新建 `Mutations.js`：`import { TOWER_BUFFS } from './GameConfig.js'` spread 后追加 `POSITIVE`（5 个）/ `NEGATIVE`（4 个）两表；`MUTATION_EVERY_LAYERS: 5` 常量（`towerFloor % 5 === 0` 触发，即 Boss 波通关后进入第 5/10/15… 层）。
2. `GameScene.applyMutation()`：每 5 层 roll 一个变异（正负比例建议 55/45，可配置），幂等叠加到当前局状态（同 towerBonuses，局内临时不入存档）。
3. `_mutationMul()`：返回当前变异对伤害/血量/速度/弹速/擦弹环/受击的倍率系数（**新配置键，不改既有字段默认值**，标准路径全 1.0）。
4. 触发时 emit `EVENTS.MUTATION_CHANGED`；UIScene 横幅 + 顶部状态图标；**负面变异在生效前 1 秒先出警示文字**（不可静默生效）。

### 新增接口签名
```js
// GameScene
applyMutation(): MutationResult   // { id, polarity, desc, stats }
_mutationMul(): { dmg, hp, speed, bulletSpeed, grazeRadius, incomingDmg }

// Mutations.js
MUTATION_EVERY_LAYERS: 5
POSITIVE: { [id]: { desc, dmg?, hp?, speed?, fireGap?, coinMul?, ... } }
NEGATIVE: { [id]: { desc, bulletSpeed?, grazeRadius?, incomingDmg?, spawnMul?, ... } }
```

### 数据结构 / 配置表（append-only）
```js
// 变异表（正面 5 + 负面 4；id/name/desc/apply 复用 TOWER_BUFFS 框架）
POSITIVE: {
  magnetStorm: { desc: '磁力风暴', apply: 'buffs.magnetUntil' },
  doubleCoin:  { desc: '双倍金币', apply: 'coinMul' },
  rapidFire:   { desc: '急速射击', apply: 'fireRateMul 1.2' },
  overshield:  { desc: '过载护盾', apply: 'shield + waveHeal 10' },
  grazeWell:   { desc: '擦弹之泉', apply: 'grazeEnergyX2' }
}
NEGATIVE: {
  swiftBullets: { desc: '弹速风暴', apply: 'enemyBulletSpeedMul 1.2' },
  tinyRing:     { desc: '擦弹环缩小', apply: 'grazeRadiusMul 0.7' },
  glassCannon:  { desc: '玻璃大炮', apply: 'incomingDmgMul 1.3' },
  swarm:        { desc: '蜂群', apply: 'spawnMul 1.3' }
}
```

### reduced-motion / 性能档 / i18n
- 变异横幅动画 reduced-motion 下为静态文本；负面警示同样静态化但保留文字（信息无障碍优先）。
- 性能档：变异不新增粒子；「蜂群」敌人数量在 low 档可下调系数（性能优先）。
- i18n：新增 9 条变异名/描述中英文案（`mut_*`）+ `mutWarning`（变异警示）。

### 风险与回归点（衔接既有系统）
- 只 import spread **不修改原 TOWER_BUFFS 条目**；`applyTowerBuff` switch id 幂等叠加不受影响。
- 变异不触碰 WINGMAN.COMBO / 成就 / 存档；不改变 Boss 波与 3 选 1 增益既有流程（变异是叠在其上的全局层）。
- 负面变异必须可反制（有预警 + 玩家可走位/擦弹/技能应对），不得制造无解局面。
- 普通关 / BossRush / 活动模式零变异逻辑生效（零回归）。

---

## 第 A9 条：连续失败自适应救济局（产品）

### 涉及文件
- `src/scenes/GameScene.js` — `_reliefRun` / `_shouldRecordPersist()`（新增）、`endGame()` L1825-1993（L1935 `SaveManager.save()`、`addTopScore()` L1901、`recordLevelStars()` L1847、`recordLevelMedals()` L1951、`recordLeagueScore()` L1895、`reportRun()` L1979）
- `src/systems/AchievementManager.js`（315 行）— `startRun` / `reportRun()` L225-242（写盘 unlock）、`_checkLive()` L244-253 / `_checkAll()` L255-264
- `src/config/GameConfig.js` — `RELIEF` 配置块（append-only）
- `src/utils/SaveManager.js` — append-only 字段 `failStreak` / `reliefRuns`

### 现状（函数级）
- `endGame()` 无条件执行排行榜/勋章/星级/周赛/成就上报链路；无失败救济机制。

### 改动点（函数级）
1. `GameScene` 新增 `_reliefRun` 标志与全局守卫 `_shouldRecordPersist()`：救济局开局置 true，该局所有「写盘/成就/排行/勋章」链路短路。
2. `AchievementManager.startRun` / `reportRun` 支持 `{ ignore }` 上下文：ignore 时短路成就写盘与解锁（`reportRun` ctx.ignore 短路写盘与 unlock；`_checkLive/_checkAll` 不解锁）。
3. `endGame()` 拦截清单（PM 已拍板口径）：救济局**不计** `topScores / levelMedals / levelStars / league / bestScore / 每日任务 / 新手计划`；**仅** `failStreak / reliefRuns` 计数；**金币照常入账**。
4. 救济触发：`failStreak[levelId] >= 3`（normal 主线）时，下一局开局弹「救济提示」面板三选一：降低难度（session 覆盖，不写 `selectedDifficulty`）/ 临时增益（+10% 攻击或 +1 命）/ 拒绝。
5. 复活福利：救济局内 `respawnPlayer` 追加「临时火力 +1 持续 2 秒」（独立临时字段 `tempFireBonusUntil`，**不写入 powerLevel**，避免污染火力拾取/受击-1 链路）。
6. `SaveManager` append-only：`failStreak = {}`（{levelId: n}，normal 专用；胜利归 0 / 失败 +1）、`reliefRuns = 0`（统计用）。

### 新增接口签名
```js
// GameScene
_shouldRecordPersist(): boolean   // 救济局为 false，其余 true

// AchievementManager
startRun({ difficulty, ignore }): void   // ignore=true 时本局不计成就
reportRun(ctx): void                     // ctx.ignore 短路写盘与解锁
```

### 数据结构 / 配置表（append-only）
```js
RELIEF: {
  failStreakThreshold: 3,   // 连败 3 次触发救济提示
  lowerDiff: 'casual',      // 选项 A：session 覆盖难度（不写 selectedDifficulty）
  tempBuffAtk: 0.10,        // 选项 B：攻击 +10%
  tempBuffLife: 1,          // 选项 B：+1 命（默认）
  reviveFireBonusMs: 2000,  // 复活临时火力 +1 持续 2 秒
  fireBonus: 1
}
// SaveManager append-only
failStreak: {},   // {levelId: n}
reliefRuns: 0
```

### reduced-motion / 性能档 / i18n
- 救济提示面板为静态弹窗 + 按钮（无粒子），reduced-motion 下无弹跳动画；性能档 N/A。
- i18n：`reliefTitle`（连续失败，需要帮助吗？）、`reliefLowerDiff`、`reliefTempBuff`、`reliefDecline`、`reliefBuffLife`、`reliefBuffAtk`、`reliefFireBonus`（复活火力+1）等中英文案。

### 风险与回归点（衔接既有系统）
- **救济局虚高 bestScore**：PM 已拍板口径——bestScore **不更新**（救济有加成，避免刷最高分），实现上 `endGame()` 拦截清单连 `recordBestScore` 一并跳过。
- 成就链路 ignore 参数必须覆盖 `startRun` 与 `reportRun` 双入口，否则救济局仍会解锁成就。
- 救济仅 normal 主线；无尽/爬塔/BossRush/活动模式不触发（无尽已有广告复活兜底）。
- 回归：正常局成就/排行/勋章全链路不受影响；`selectedDifficulty` 存档语义不变（降难度是 session 覆盖）。

---

## 第 B10 条：精英敌人 mini-boss（内容深度）

### 涉及文件
- `src/entities/Enemy.js` — `TYPES` L19-32、`spawn()` L64-114（第 9 参 elite）、`update()` L116-179、`die()` L445-476、`recycle()` L478-484
- `src/scenes/GameScene.js` — `spawnEnemy()` L799-806（elite 透传）、`spawnEliteDrops()`（新增）、`registerKill()` L1203-1225（击杀计数）
- `src/systems/WaveSystem.js` — `spawnOne()` L131-203（comp 第 5 位 elite 标记）
- `src/config/Items.js`（32 行）— `BOSS_DROP_TABLE` / `ITEM_DROP_WEIGHTS`（复用，不新增掉落表）
- `src/config/GameConfig.js` — `ELITE` 配置块（A6 已建，本条目消费）

### 现状（函数级）
- 敌人无精英态；`die()` 掉落走既有通用掉落链路。

### 改动点（函数级）
1. `Enemy` 增加 `isElite` 标记字段（第 9 参 elite 透传）；spawn 时套用 `ELITE.hpMul ×5`（在既有 difficulty × 难度档系数之上再 ×5）、弹幕强化（复用既有 firePattern，射速 ×1.5 或换高难弹种）、发光描边 + 放大约 1.2 倍（复用 VFX.glowTarget，质量档自动降级）。
2. `GameScene.spawnEliteDrops()`：精英死亡**必掉 1 个 `BOSS_DROP_TABLE` 高价值道具**（energy/heal/wingman/bomb/weapon 等，复用 spawnItem）。
3. 击杀语义：精英**是敌机不是 Boss**——走正常 `registerKill`（击杀数 +1、连击 +1、得分 ×3），**不触发** BOSS_SPAWNED / BOSS_DEFEATED / bossesDefeated / 屠龙者类成就。
4. 难度门槛：休闲档不出现（新手保护）；标准/困难/地狱出现（hard/hell 概率更高，可配置）；每关第 1 波不刷精英（避免开局突袭）。

### 新增接口签名
```js
// GameScene
spawnEliteDrops(x, y, enemyType): void   // 击杀精英必掉 BOSS_DROP_TABLE 1 件

// Enemy
spawn(x, y, typeKey, moveMode, difficulty, firePattern, hpMul, speedMul, elite): Enemy
```

### 数据结构 / 配置表
复用 A6 `ELITE` 配置块（hpMul:5 / dropChance:1.0 / tint 等）；**不新增敌人类型、不新增纹理**（发光靠既有 glowTarget）。

### reduced-motion / 性能档 / i18n
- 精英发光外观走既有 glowTarget（low 档自动关闭）；无新增动画。
- i18n：`elitePrefix`（精英· / ELITE·）用于浮字/血条旁标注。

### 风险与回归点（衔接既有系统）
- **不新增敌人类型实体**：复用现有 Enemy + 标记字段（`isElite` + 数值倍率），避免 TYPES 表膨胀与纹理新增（红线 R6 零外部资源）。
- 精英不改变 Boss 战与 Boss 掉落；不影响 wavePlan 的既有敌人数量（精英是追加/替换，数量仍受波次表控制）。
- 不做精英成就、不做精英图鉴条目（图鉴仍按基础类型解锁——击杀精英也解锁对应基础类型条目，一次解锁即可）。
- 回归：击杀/连击/得分/掉落链路、每日任务 kills、`bossesDefeated` 不变。

---

## 第 B11 条：连击蓄力爆发（内容深度）

### 涉及文件
- `src/scenes/GameScene.js` — `registerKill()` L1203-1225（combo++、maxCombo、`reportComboPeak` 调用点）、`useBurst()`（新增）、`breakCombo()`（既有）、`useBomb()` L1654-1676（清屏逻辑复用）、`useSuper()` L1679-1708、`useOverdrive()` L1724-1736、`_updateOverdrive()` L1749-1755（临时增益参照）
- `src/scenes/Player.js` — `addEnergy()` / `ENERGY_MAX`（回能复用）、临时增益机制（强化射击复用）
- `src/scenes/UIScene.js` — HUD 新增「蓄力」按钮 + 键盘键（如 C）；监听 `BURST_CHANGED` / `BURST_ACTIVATED`
- `src/config/GameConfig.js` — `COMBO_BURST` 配置块（append-only）、EVENTS 加 `BURST_CHANGED` / `BURST_ACTIVATED`
- `src/config/Skills.js`（26 行）— `ENERGY_MAX=100`（只读引用）

### 现状（函数级）
- `registerKill()` 维护击杀 combo（`this.combo`）与峰值（`maxCombo`），并喂 `AchievementManager.reportComboPeak`（只读 `session.comboPeak`）；无消耗连击的主动资源。

### 改动点（函数级）
1. **消耗连击语义**：基于 `GameScene.registerKill` 的击杀 combo（`this.combo`），**与 WINGMAN.COMBO 完全无关**。
2. `registerKill()` 在 `reportComboPeak` 之后追加里程碑判定（**不 reset `this.combo` / `maxCombo`**，只在达到阈值时增加蓄力资源）。
3. 新增 `useBurst()`：读 `this.combo`，触发后调 `breakCombo()`（broadcast `COMBO_CHANGED 0`）+ 应用三档效果：
   - 强化射击（≥10）：3 秒伤害 ×1.5 或临时火力 +1（复用 Player 临时增益机制）；
   - 清屏（≥15）：清除全场敌弹 + 全场敌机中等伤害（复用 `useBomb` 清屏逻辑，**不耗炸弹**）；
   - 回能（≥20）：能量槽直接充满（复用 `addEnergy` / `ENERGY_MAX`）。
4. **峰值只增不减**：`this.maxCombo` 与 `session.comboPeak` 绝不因消耗而降低 → combo_15/combo_30 成就（判定 peak）不受影响、不重复弹提示。
5. HUD「蓄力」按钮 + 键盘键（如 C）；当前 `combo < 阈值` 置灰；不占用空格（炸弹）与技能键位、FOCUS_TOGGLE。
6. emit `BURST_CHANGED`（蓄力值变化）与 `BURST_ACTIVATED`（激活），UIScene 纯视觉展示。

### 新增接口签名
```js
// GameScene
useBurst(): boolean          // 当前 combo >= 阈值则消耗并激活，返回是否成功
getBurstGauge(): number      // 当前可触发档位 0/1/2/3（用于按钮置灰）
```

### 数据结构 / 配置表（append-only）
```js
COMBO_BURST: {
  tiers: [
    { needCombo: 10, kind: 'power',   desc: '强化射击' },  // 3s 伤害 ×1.5
    { needCombo: 15, kind: 'clear',   desc: '清屏' },       // 复用 useBomb 清屏，不耗炸弹
    { needCombo: 20, kind: 'energy',  desc: '回能' }        // 复用 addEnergy / ENERGY_MAX
  ]
}
```

### reduced-motion / 性能档 / i18n
- 蓄力触发光效（充能环/粒子）在 reduced-motion 下降级为静态提示；性能档 low 下减粒子密度。
- i18n：`chargeBtn`（蓄力）、`chargePower`（强化射击）、`chargeClear`（清屏）、`chargeEnergy`（回能）、`chargeNeed`（还需 {n} 连击）等中英文案。

### 风险与回归点（衔接既有系统）
- **与 comboPeak 成就冲突风险**：蓄力是独立资源，**绝不 reset `this.combo` / `maxCombo`**，只在 `reportComboPeak` 之后追加里程碑判定；combo_15/combo_30 判定（读 peak）不受影响。
- 不触碰 WINGMAN.COMBO 状态机（`reportHit`/`getComboMul`/`getComboTint`）与 `WINGMAN_COMBO` 事件；每日任务 `combos` 指标（= 元素协同）不受影响。
- 不新增成就、不改任何成就 condition；不新增存档字段（连击为局内状态）。
- 回归：连击计数、comboPeak 成就、overdrive/super 互斥、炸弹数量不变、HUD 蓄力条、键位冲突。

---

## 第 B12 条：称号系统（内容深度）

### 涉及文件
- `src/systems/TitleSystem.js`（**新建**）
- `src/scenes/ResultScene.js`（382 行）— 结算页展示当前称号（标题下方/连击峰值面板旁一行）
- `src/config/GameConfig.js` — `TITLES` 配置块（append-only）
- `src/utils/SaveManager.js` — 可选 append-only 字段 `title`（PM 语义纯派生可零字段，推荐读时计算、自愈）
- `src/scenes/MenuScene.js` — 称号展示入口（可选，复用面板模式）

### 现状（函数级）
- 无称号概念；存档已有 `achievements`（26 id）、`levelMedals`/`medalCount`、`towerTop`、`league`、`totalKills`、`levelStars`、`bossesDefeated`、`newbiePlan.progress.grazes` 等持久化字段。

### 改动点（函数级）
1. 新建 `TitleSystem.js`：称号表 + 解锁判定 + 当前称号派生（**读时计算**，从既有持久化字段派生，不新增存档依赖）。
2. 称号表（示例 8 个，按稀有度升序）：rookie 苍穹新兵 / veteran 百战老兵 / grazer 擦弹大师 / climber 深空攀登者 / slayer 屠龙者 / maniac 连击狂人 / perfectionist 完美主义者 / skyOverlord 苍穹霸主（legendary 最高阶）。
3. 派生规则：当前称号 = 按稀有度（legendary > epic > rare > common）取最高已解锁；同稀有度按表序取前者。**纯派生，不做手动装备**（v1 最小成本）。
4. 展示位置：ResultScene 结算页（标题下方/连击峰值面板旁一行）+ 分享卡（B15 复用）。

### 新增接口签名
```js
// TitleSystem
getTitle(id): TitleDef
getUnlockedTitles(stats): TitleDef[]      // 从存档既有字段派生
getCurrentTitle(stats): TitleDef          // 稀有度最高已解锁
// 可选（若需落盘装备）
equipTitle(id): boolean                   // 校验已解锁后写 SaveManager.title
```

### 数据结构 / 配置表（append-only）
```js
TITLES: {
  rookie:        { name: '苍穹新兵 / Sky Rookie',      rarity: 'common',    cond: { type: 'levelStars', any: true } },
  veteran:       { name: '百战老兵 / Veteran',         rarity: 'rare',      cond: { or: [{ type: 'totalKills', n: 500 }, { type: 'achievement', id: 'kill_500' }] } },
  grazer:        { name: '擦弹大师 / Graze Master',    rarity: 'rare',      cond: { type: 'grazes', n: 300 } },
  climber:       { name: '深空攀登者 / Tower Climber', rarity: 'rare',      cond: { type: 'towerTop', n: 10 } },
  slayer:        { name: '屠龙者 / Dragon Slayer',     rarity: 'epic',      cond: { type: 'achievement', id: 'boss_all' } },
  maniac:        { name: '连击狂人 / Combo Maniac',    rarity: 'epic',      cond: { type: 'achievement', id: 'combo_30' } },
  perfectionist: { name: '完美主义者 / Perfectionist', rarity: 'epic',      cond: { type: 'achievement', id: 'three_star' } },
  skyOverlord:   { name: '苍穹霸主 / Sky Overlord',    rarity: 'legendary', cond: { and: [{ type: 'achievement', id: 'all_clear' }, { type: 'medalCount', n: 6 }, { type: 'towerTop', n: 10 }] } }
}
```

### reduced-motion / 性能档 / i18n
- 展示为静态文本；解锁瞬间轻提示动画在 reduced-motion 下静默（无弹跳/缩放）。
- 性能档无粒子新增，N/A。
- i18n：`title_rookie`…`title_skyOverlord` 等 8 组中英文案（含 desc）。

### 风险与回归点（衔接既有系统）
- **只读派生，零写入**：只读成就/勋章/爬塔/周赛/击杀/擦弹字段，**零写入**；零触碰 COMBO 块 / 成就 id / WingmanSystem / FloatingText。
- 不依赖未持久化的局内字段（如单局 comboPeak、局内 grazeCount——禁止用作称号来源；改用持久化的 `newbiePlan.progress.grazes` 等）。
- 不新增成就 id；称号等级不参与战力计算（`calcPower` 不动）。
- 回归：结算页展示、成就 id 集合不变、存档读写（若零字段则无存档改动）。

---

## 第 B13 条：图鉴收藏系统（内容深度）

### 涉及文件
- `src/systems/Codex.js`（**新建**）
- `src/utils/SaveManager.js` — append-only 字段 `codex` / `codexDecor`
- `src/scenes/GameScene.js` — `registerKill()` L1203-1225（敌机/元素击杀埋点，`meta.enemyType` / `meta.element` 已有）、`_onBossDefeated()` L484-519（`bossKey` 已有）、`collectCoin()` L919-930
- `src/systems/AchievementManager.js` — `reportWeaponUsed`（已有，武器埋点挂钩）
- `src/scenes/MenuScene.js` — `openCodex()` 新面板（复用 openCheckIn/openDailyQuest/openNewbiePlan/openLeaderboard 面板模式）

### 现状（函数级）
- 击杀/使用事件点已有元数据（enemyType / element / bossKey / weapon），未做收集记录。

### 改动点（函数级）
1. 新建 `Codex.js`：`codex` 数据读写（SaveManager append-only）、条目解锁判定、完成度统计、`codexDecor` 装饰购买（金币出口，纯展示）。
2. **解锁触发点（埋点，全在既有事件上挂钩，不新增战斗数值）**：
   - 敌机：首次击杀该类型（`registerKill` 的 `meta.enemyType` 已有）；
   - Boss：首次击败（`_onBossDefeated` 的 `bossKey` 已有；annihilator 也计入——注意现有 `bossesDefeated` 只记 3 个 Boss 的成就，图鉴用独立字段）；
   - 武器：首次使用（`AchievementManager.reportWeaponUsed` 已有，事件点挂钩）；
   - 元素：首次用该元素击杀（`registerKill` 的 `meta.element` 已有）。
3. 图鉴条目共 18 条：敌机 7（small/mid/diver/turret/kamikaze/summoner/shield）、Boss 4（boss_sentinel/crusher/overlord/annihilator）、武器 4（pulse/missile/laser/bomb）、元素 3（fire/ice/thunder）。
4. MenuScene `openCodex()` 新面板：四分类网格，已解锁显示名称+简介+小图标（复用现有纹理），未解锁显示「???」剪影；提供 2 款可购买装饰（金币出口，纯展示）。

### 新增接口签名
```js
// Codex
record(type: 'enemies'|'bosses'|'weapons'|'elements', key: string): void
isUnlocked(type: CodexType, key: string): boolean
getProgress(type: CodexType): { unlocked: number, total: number, pct: number }
getCodex(): CodexData
buyDecor(decorId: string): boolean   // 金币足够则扣款并记录，返回是否成功
```

### 数据结构 / 配置表（append-only）
```js
// SaveManager append-only
codex: { enemies: {}, bosses: {}, weapons: {}, elements: {} },  // 键=条目 id，值 true
codexDecor: []                                                  // 装饰购买记录
// 装饰定价（配置常量）
CODEX_DECOR: { frame_1: { price: 300 }, frame_2: { price: 600 } }
```

### reduced-motion / 性能档 / i18n
- 条目解锁闪光/点亮动画在 reduced-motion 下降级为静态（无缩放/粒子）；性能档 low 下不新增粒子。
- i18n：`codexTitle`、分类名、18 条条目名/简介、装饰名、购买文案等中英文案（敌机名此前无词表，需新增：小型机/中型机/俯冲机/炮台/自爆机/召唤机/护盾机等）。

### 风险与回归点（衔接既有系统）
- 纯展示 + 收集：**不动战斗数值**；图鉴解锁不影响敌人/Boss 行为、不掉落、不加成。
- 图鉴解锁不影响成就（不新增成就 id；图鉴与成就系统并行）。
- Boss 图鉴用独立 `codex.bosses`，**不**复用 `bossesDefeated`（后者被成就语义占用，避免污染）。
- 挂接点只增不改，绝不改动 `registerKill`/`collectCoin`/`_onBossDefeated` 原有返回值与计数（红线 R2/R4 不受影响）。
- 回归：击杀/拾取/武器使用链路、成就、掉落、存档读写。

---

## 第 B14 条：元素免疫敌人 + 全屏元素风暴（内容深度）

### 涉及文件
- `src/entities/Enemy.js` — `TYPES` L19-32（elemental 类，immune 数组）、`spawn()` L64-114、`hit()` L363-383（`elementReaction.onHit` 在 applyElement 之前）、`applyElement()` L401-428、`applyReaction()` L437-443、`die()` L445-476、`recycle()` L478-484
- `src/systems/ElementReaction.js`（71 行）— `onHit()` L23-34（REACT_CD 冷却）、`_chain()` L37-53、`_aoe()` L56-70——**只调用不修改**
- `src/config/ElementReactions.js`（12 行）— `ELEMENT_REACTIONS`（REACT_CD:1200；thunder/fire/ice）——**绝不 import 引用 WINGMAN.COMBO**
- `src/scenes/GameScene.js` — `elementStorm()`（新增）、`_elem` 同挂检测、元素核心轮换（既有 `rotatePlayerElement`）
- `src/systems/WaveSystem.js` — `spawnOne()` L131-203（comp 透传 `immune` 标记）
- `src/config/GameConfig.js` — `ELEMENT_STORM` 配置块（append-only）

### 现状（函数级）
- `Enemy.hit()` L363-383 在 applyElement 之前调用 `scene.elementReaction.onHit`（REACT_CD=1200ms 冷却）；元素反应链（thunder/fire/ice）由 ElementReactions 配置驱动；无免疫与风暴。

### 改动点（函数级）
1. **免疫敌人（困难档起）**：`Enemy.TYPES` 追加 `elemental` 类（带 `immune` 数组）；仅当 `selectedDifficulty ∈ {hard, hell}` 时波次才可能刷出（休闲/标准绝不出现，新手保护）。免疫标记数据驱动：wavePlan comp 条目可带可选字段 `immune:'fire'|'ice'|'thunder'`，`WaveSystem.spawnOne` 透传（无该字段 = 普通敌人，零回归）。
2. **免疫语义**：免疫敌人对该元素**伤害免疫（0 伤害）**，含该元素 DoT（火免疫则灼烧 0）与该元素触发的二段反应伤害（`ElementReaction` 对免疫目标伤害归 0）；其他元素伤害正常。非免疫元素的元素状态（如对火免疫敌人挂冰减速/雷麻痹）**正常生效**（减速/麻痹仍能控场，避免无解）。
3. **反制 = 元素核心轮换**：玩家需拾取 `element_core` 轮换到非免疫元素（既有 `rotatePlayerElement` 已实现）。
4. **全屏元素风暴**：场上 active 敌机**同时存在 fire / ice / thunder 三种元素状态**（读 `Enemy._elem`）时触发一次风暴：
   - 效果：对所有敌机造成大额**非元素伤害（穿透免疫）** + 清除全场敌弹 + 大额得分 + 全屏演出；
   - 冷却：`STORM_CD = 15s`（防连环触发）；触发后清除触发敌机的元素状态（避免同帧再触发）；
   - Boss 战也可触发（对 Boss 造成固定伤害）。
5. 免疫敌人**不出现于 Boss 战**（Boss 不加免疫标记，避免地狱 Boss 无解）。
6. `elementStorm()` 内伤害结算：**已拍板**——走 `ElementReaction.onHit` 尊重 REACT_CD=1200ms 冷却（`bypassCooldown: false`，保持既有反应节奏，不做 bypass）；风暴触发频率由独立 `STORM_CD=15000ms` 控制防连环触发。风暴伤害用 `applyReaction` 直接结算，保证三元素同屏都有伤害面。

### 新增接口签名
```js
// Enemy
isImmuneTo(el): boolean   // elemental 类免疫判定
spawn(..., immune?: string): Enemy   // 第 10 参可选（与 A6/B10 参数序对齐）

// GameScene
elementStorm(): void      // 触发全屏三元素风暴（纯演出 + 既有元素伤害链路）
```

### 数据结构 / 配置表（append-only）
```js
// Enemy.TYPES 追加（不改既有 7 类）
elemental: { hp: 90, speed: 90, score: 120, immune: ['fire'], /* 困难档起 */ }

// GameConfig append-only
ELEMENT_STORM: {
  cdMs: 15000,        // STORM_CD 防连环触发
  dmg: 50,            // 非元素穿透免疫伤害
  score: 500,
  clearBullets: true,
  bypassCooldown: false  // 已拍板：false=尊重 ElementReaction.REACT_CD（不做 bypass）；风暴频率由 cdMs 控制
}
```

### reduced-motion / 性能档 / i18n
- 免疫标记为静态图标/文字；风暴全屏粒子在 reduced-motion 下降级为静态闪光 + 文字横幅，low 档减粒子密度。
- i18n：`immuneFire`（免疫火）、`immuneIce`、`immuneThunder`、`stormTitle`（元素风暴！）等中英文案。

### 风险与回归点（衔接既有系统）
- **红线**：`ElementReaction.js` 只调用不修改；`ElementReactions.js` 绝不 import 引用 `WINGMAN.COMBO`（L12 文件红线）。
- **REACT_CD=1200ms 与全屏风暴关系**：已拍板 `bypassCooldown=false` —— 风暴伤害走 `onHit` 尊重冷却，不 bypass；风暴频率由独立 `STORM_CD=15000ms` 控制（防连环触发）。
- 免疫标记不改敌机 HP/速度/掉落；击杀仍走正常 `registerKill`（计入击杀/连击/元素成就的**非免疫元素**击杀）。
- **活性守卫**：三元素同挂检测读 `Enemy._elem`，需注意元素状态过期/敌机死亡的即时清理，避免死敌残留造成误触发（实现方加活性守卫，QA 专项断言）。
- 回归：元素反应链、三元素同屏、元素核心轮换、Boss 战免疫（不出现）、休闲/标准零免疫。

---

## 第 B15 条：分享卡升级（内容深度）

### 涉及文件
- `src/scenes/ResultScene.js`（382 行）— `buildShareCard()` L257-315（canvas 540×720，背景硬编码 `'#0b1c33→#040a16'`）、`downloadShareCard()` L318-332、`_initShareHooks()` L356-366（`__RESULT_SHARE` 测试钩子）、`_shareText`（copyShareText 文本摘要）
- `src/utils/SaveManager.js` — append-only 字段 `nickname` / `lastScore` / `prevScore`（A1 已建）
- `src/systems/TitleSystem.js` — `getCurrentTitle(stats)`（B12 已建）
- `src/config/GameConfig.js` — `LEVELS[i].theme`（skyTop/skyBottom/accent 已存在，零新增）

### 现状（函数级）
- `buildShareCard()` L257-315 背景硬编码 `'#0b1c33→#040a16'`；无昵称/称号/历史对比行；`_initShareHooks` L356-366 测试钩子。

### 改动点（函数级）
1. 背景改用 `r.theme`（`LEVELS[i].theme` 的 skyTop/skyBottom/accent，零新增数据）；难度档可叠加边框强调色（hard=橙 / hell=红，casual/standard=默认青）。
2. 新增昵称行（`nickname`：本批「默认昵称 + 随机后缀」（如 飞行员·42），存 `SaveManager.nickname`，值为生成后的昵称；**昵称编辑文本框后置 P2**）+ 称号行（B12 `getCurrentTitle` 派生结果）。
3. 历史对比：与「同关 + 同模式」的历史最高分对比（数据源：`topScores` 中同 levelId+mode 的最高分，排除本局），显示「比上次 +X%」；无历史 → 「首秀 / First Run」；破纪录 → 沿用「★新纪录」。
4. `lastScore`/`prevScore` 滚动维护（A1 已建字段）：结算后 `lastScore ← 本次`、`prevScore ← 旧 lastScore`（供 deltaPct 计算）。
5. `copyShareText` 的文本摘要同步加入昵称/称号/对比行（同步更新 `_shareText`）。
6. `_initShareHooks` L356-366 测试钩子保持兼容。

### 新增接口签名
```js
// ResultScene 内部
buildShareCard(deltaPct: number, nickname: string, title: string): HTMLCanvasElement
```

### 数据结构 / 配置表
复用 A1 的 `nickname`/`lastScore`/`prevScore`、B12 的称号派生（均 append-only/读时派生，**无新字段**）；背景色复用 `LEVELS[i].theme`。

### reduced-motion / 性能档 / i18n
- 分享卡为静态 canvas，无动画 → reduced-motion N/A；性能档 N/A（一次性渲染）。
- i18n：`nicknameLabel`、`shareVsLast`（比上次 +{pct}%）、`shareFirstRun`（首秀）、`nicknameDefault` 等中英文案。

### 风险与回归点（衔接既有系统）
- canvas 尺寸 540×720 与下载/复制逻辑不变（`downloadShareCard` L318-332 / `copyShareText`）；`__RESULT_SHARE` 测试钩子保持兼容。
- **纯视觉展示，零业务逻辑**：不得影响结算/排行/成就（红线 R7）；历史对比只读 `topScores`，零写入。
- 不做敏感词过滤（本地单机）；无昵称/称号时省略对应行；prevScore=0 时不显示百分比。
- 回归：分享卡生成/下载/复制、主题色切换、测试钩子。

---

## 附录 A：新增存档字段汇总（全部 append-only）

| 字段 | 类型/默认 | 所属条目 | 说明 |
|---|---|---|---|
| `nickname` | `''`（展示回退「飞行员·随机后缀」） | B15 | 本批生成「默认昵称 + 随机后缀」写入；编辑后置 P2 |
| `lastScore` / `prevScore` | `0` / `0` | B15 | 历史分数滚动（deltaPct 用） |
| `title` | `''`（可选） | B12 | 当前称号 id（PM 语义纯派生可零字段，推荐读时计算） |
| `failStreak` | `{}`（{levelId: n}） | A9 | 各关连续失败计数，normal 专用 |
| `reliefRuns` | `0` | A9 | 救济局累计次数（统计用） |
| `codex` | `{ enemies:{}, bosses:{}, weapons:{}, elements:{} }` | B13 | 图鉴解锁记录（键=条目 id，值 true） |
| `codexDecor` | `[]` | B13 | 图鉴装饰购买记录（金币出口） |

> 其余条目（A2/A3/A4/A5/A6/A7/A8/B10/B11/B14 或部分 B12）**零存档改动**。

---

## 附录 B：新增配置块汇总（GameConfig / 新文件，全部 append-only）

| 配置块 | 位置 | 所属条目 |
|---|---|---|
| `COMBAT_PERF.HIT_CHECK_EVERY` | GameConfig | A2 |
| `POOL` | GameConfig | A4 |
| `ELITE` | GameConfig | A6 / B10 |
| `RAGE` | GameConfig | A7 |
| `MUTATION_EVERY_LAYERS` + `POSITIVE`/`NEGATIVE` | Mutations.js（新建） | A8 |
| `RELIEF` | GameConfig | A9 |
| `COMBO_BURST.tiers` | GameConfig | B11 |
| `TITLES` | GameConfig | B12 |
| `CODEX_DECOR` | Codex.js / GameConfig | B13 |
| `ELEMENT_STORM` | GameConfig | B14 |
| `LEVELS[i].waveVariants` | GameConfig | A6 |

---

## 附录 C：风险与开放问题

1. ✅ 已拍板（PM）：救济局口径——不计 topScores/levelMedals/levelStars/league/bestScore/每日任务/新手计划，仅 failStreak/reliefRuns 计数，金币照常（A9）。
2. ✅ 已拍板（PM）：变异间隔每 5 层 + 常量 `MUTATION_EVERY_LAYERS: 5`（A8）。
3. ✅ 已拍板（PM）：分享卡昵称本批「默认+随机后缀」，编辑后置 P2（B15）。
4. ✅ 已拍板（主理人）：B14 全屏元素风暴冷却选型——`bypassCooldown: false`（默认尊重 `ElementReaction.REACT_CD=1200ms`，保持既有反应节奏，**不做 bypass**）；风暴触发频率由独立 `STORM_CD=15000ms` 控制防连环触发。与 PM 需求文档第 8 条语义一致，开发可直接按此实现。
5. **参数序扩展**：`spawnEnemy()` / `Enemy.spawn()` 的 elite/immune 参数扩展必须与既有 hpMul/speedMul 参数序对齐，所有既有调用点一次性迁移（A6/B10/B14 相关）。
6. **B14 活性守卫**：三元素同挂检测读 `Enemy._elem`，需元素状态过期/敌机死亡的即时清理，避免死敌残留误触发（实现方加活性守卫，QA 专项断言）。

---

## 附录 D：红线确认清单（开发 / QA 对照检查）

| # | 红线项 | 要求 | 13 条结论 |
|---|---|---|---|
| R1 | `WINGMAN.COMBO` 五字段 | **零触碰**，禁止读写/修改 | ✅ 全绿（B11 用的是击杀 combo，与僚机协同 combo 无关） |
| R2 | 26 个成就 id 及 condition/progress | **零改动**；救济抑制只加附加式 relief 标记 | ✅ 全绿 |
| R3 | `WingmanSystem` | **零触碰**（免疫门控落在 Enemy/ElementReaction） | ✅ 全绿 |
| R4 | `FloatingText`（damageNumber） | 只新增浮字/横幅，不改既有行为 | ✅ 全绿 |
| R5 | `SaveManager` 旧字段语义 | **全部保留**；仅 append-only 新增（见附录 A） | ✅ 全绿 |
| R6 | 外部资源 / 网络 / 后端 | **零新增外部资源、零网络依赖** | ✅ 全绿（精英发光/纹理全程序化） |
| R7 | 纯视觉 / 零业务逻辑 | 展示类内容不得携带业务数值逻辑；业务逻辑只在既有机制上叠加配置 | ✅ 全绿 |

> 检查方式：实现阶段由架构师/开发在 PR 自检，QA 验收时按 R1~R7 逐项回归（尤其 R1/R2/R5 需 grep 断言：`WINGMAN.COMBO` 未被修改、成就 id 集合未变、SaveManager 旧字段写入点未变）。
