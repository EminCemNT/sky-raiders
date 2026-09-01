# OPT-16 泛优化·技术快赢批实现规格（架构方案 · 开发/QA 引用版）

> 作者：高见远（arch-opt / 架构师）｜日期：2026-09-01
> 状态：**已拍板，待开发实现**（泛优化·技术快赢轮产出）
> 范围：T1-T12 技术/性能/工程质量优化项（存档钳位 / 存档损坏自愈 / 池遍历合并 / glowTarget 合帧 / i18n 审计 / 事件契约 / 监听泄漏 / 仓库卫生 / 探针钩子 / 首帧预填 / 分配热点 / 魔法值收敛）——全部**函数级实现规格**，供 coder-opt 直接照做。
> 代码基线：HEAD = 653914f（OPT-14/OPT-15 视觉批已推送）。工作树干净。只出规格，不改任何代码。
> 引用说明：worker 以本文件为唯一实现规格来源；正文完整、无「见其他文档」引用（行号为当前基线核对值，开发以实际为准）。
> 导入补充：新增文件 `src/utils/SaveSanitizer.js`；新增配置块（`HUD_I18N`/`SANITIZE`/`EVENT_CONTRACT`/`PROBE`/`MAGIC`）需按各节在对应文件 import 行追加。

---

## 〇、红线总览（十二项逐一确认，零触碰）

| 红线项 | 结论 |
|---|---|
| `GameConfig.js` `WINGMAN.COMBO` 五字段（L699-705） | **零触碰**。T1-T12 均不读写该块。 |
| `AchievementManager.js` 26 个成就 id | **零改动**。T1 存档钳位只**只读**该集合做白名单校验（非法 key 清理），**绝不写/改**任何成就 id/condition/progress。 |
| `WingmanSystem.js` | **零触碰**。 |
| `FloatingText.js` | **零触碰**（diff 为空）。T4 合帧不含 FloatingText；T5 不涉及。 |
| `SaveManager.js` | **零触碰**（diff 为空）。T1/T2 存档钳位/自愈**不下沉 SaveManager**，改为**新建 `SaveManager.js` 之外的独立文件 `src/utils/SaveSanitizer.js`** + `main.js` 启动挂接；只调用 SaveManager 既有公开 API（`load()/save()/set()`），不新增字段、不改旧字段语义。 |
| 零外部资源 | 全部程序内改动；**零图片/音频/网络/字体依赖**。 |
| 纯工程质量 / 不碰玩法平衡 | T1-T12 均为工程质量/性能/技术债清理；**不触碰任何伤害/数值/流程/存档字段语义**。T3/T11 只改遍历与分配（行为等价）；T10 只改预填；T12 纯常量替换。 |

> 检查方式：开发 PR 自检 + QA 回归（尤其：`WINGMAN.COMBO` 未改、成就 id 集合未变、`WingmanSystem.js` / `FloatingText.js` / `SaveManager.js` diff 为空、`SaveSanitizer.js` 为新建文件且不 import 红线逻辑）。

---

## 一、实现顺序表（推荐，按风险/依赖排序）

| 顺序 | 条目 | 理由 |
|---|---|---|
| 1 | T8 仓库卫生 | 零风险，先清场（git status 干净 → 后续 diff 复核才有基准） |
| 2 | T6 事件/键名契约审计 | 低风险，纯引用收口（值不变） |
| 3 | T9 测试钩子规范化 | 低风险，为后续各项探针铺路（append-only 契约） |
| 4 | T1 存档钳位统一 | 低风险，基础数据层（新建 SaveSanitizer，SaveManager 零改动） |
| 5 | T2 存档损坏分级自愈 | 依赖 T1 的 SaveSanitizer 框架（同一文件扩展） |
| 6 | T5 i18n 审计补全 | 低风险，独立（UIScene 硬编码 → t()） |
| 7 | T12 硬编码魔法值收敛 | 低风险，独立（纯常量替换） |
| 8 | T7 事件监听泄漏审计 | 中低风险，依赖 T9 探针（场景切换监听计数） |
| 9 | T10 首帧冷启动收口 | 低风险，独立（_prewarm + warmup） |
| 10 | T3 池遍历合并 | **中风险**，性能热路径（enemyBullets 三处遍历合并，语义等价） |
| 11 | T11 每帧分配热点审计 | **中风险**，依赖 T3 之后的 update 热路径评估 |
| 12 | T4 glowTarget 合帧 | **中风险**，VFX 热路径 + 与 OPT-15 V4 idleAura 共存，**最后做**（不阻塞其它项） |

---

## 第 T1 条：存档数值钳位统一（SaveSanitizer.js 新建 · 数据层基础）

### 背景 / 目标
`SaveManager.load()`（L144-249）已对 **部分** 字段做类型+钳位（sensitivity/touchOffset/lang/towerTop/lastScore/prevScore/reliefRuns 等），但仍有字段未收口：`coins` 无上限、`upgrades` 五字段无上限/无类型校验（脏数据可为负数/NaN/字符串）、`levelStars` 未校验 1~3、`achievements` 未按 26 id 白名单校验（脏 key 混入）、`achievementStats.elementKills` 未钳位、`moduleInv` 元素未校验 schema、`topScores` 元素未校验。**红线要求 SaveManager.js diff 为空** → 钳位下沉到新建独立文件。

**目标**：启动时对存档做一次**统一钳位清洗**（非法值自愈为安全默认，合法值零改动），提升脏数据鲁棒性；SaveManager.js 零触碰。

### 改动文件 + 函数签名
- `src/utils/SaveSanitizer.js`（**新建**）
- `src/main.js` — L14 `initLocale(...)` 之后追加 1 行挂接（启动清洗）
- `src/config/GameConfig.js` — 新增 `SANITIZE` 配置块（append-only）

```js
// SaveSanitizer.js（新建；只 import GameConfig 只读常量 + 只调用 SaveManager 既有公开 API）
import { SANITIZE, DIFFICULTIES, PERFORMANCE, UPGRADE_TREE } from '../config/GameConfig.js';
import { SaveManager } from './SaveManager.js';
// 只读成就 id 白名单来源：AchievementManager（仅遍历读取，零写入）
import { getAchievementIds } from '../systems/AchievementManager.js';

export function clampInt(v, min, max, def) { /* Number 化 + 整数 + 越界回 def */ }
export function sanitizeSave(save) {          // 纯函数：返回清洗后的存档对象（浅拷贝改字段，不改原对象结构）
  // 1) coins：>=0 整数，越界/NaN 回 0
  // 2) upgrades：五字段（firepower/hull/shield/magnet/wingman/wingmanFirepower）clamp 0..max
  // 3) levelStars：{levelId: 1..3}，非法值剔除/回 0
  // 4) achievements：仅保留白名单 26 id（只读集合），非法 key 剔除（零写成就）
  // 5) achievementStats.elementKills：fire/ice/thunder clamp >=0
  // 6) moduleInv：元素 {key,slot,quality} schema 校验，非法元素剔除
  // 7) topScores：元素 {score,levelId,mode,date} 校验，score clamp >=0，超 10 条截断
  return save;
}
export function installSanitizer() {          // main.js 挂接：load → sanitize → save（仅首启一次性）
  const s = SaveManager.load();
  const cleaned = sanitizeSave(s);
  if (cleaned !== s) SaveManager.save();      // 有实际改动才写盘（save 已做脏标记合并写）
}
```

```js
// GameConfig 新增（append-only）
export const SANITIZE = {
  coinsMax: 999999999,
  upgradeMax: 99,          // 各升级项上限（UPGRADE_TREE.max 之上限，防溢出）
  levelStarsMax: 3,
  topScoresMax: 10,
  moduleInvMax: 200,
};
```

### 精确语义
- `sanitizeSave` 为**纯函数**：读入 cache，输出清洗后对象；**不调用 SaveManager.save()**（由 `installSanitizer` 统一触发一次写盘），避免启动时重复写。
- 白名单校验：`getAchievementIds()` 返回 26 个合法 id 的**只读集合**；`achievements` 中不在集合内的 key 直接剔除（**零写成就 id/condition/progress**，符合红线）。
- **合法值零改动**：只修「越界/非数字/类型错误」，不重算、不重排、不改变任何合法值语义 → 既有存档逐字段等价。
- `main.js` 挂接点：`initLocale(...)`（L14）之后、Phaser.Game 创建之前调用 `installSanitizer()`（一次性）。

### 参数表（append-only）
见上 `SANITIZE` 块；`DIFFICULTIES`/`PERFORMANCE`/`UPGRADE_TREE` 复用既有（零改动）。

### 降级策略
- **reduced-motion**：不影响（纯数据清洗，无 UI/动效）。
- **性能三档**：三档一致启用（启动一次性，非每帧）。
- **Node 头测**：`installSanitizer` 在无 localStorage 环境静默跳过（SaveManager.load 已兜底 freshSave）。

### 风险与回归点
- **误钳合法值**：白名单/上限只针对「越界与非法类型」，合法值零改动 → QA 用正常存档回归全部字段值不变。
- **成就 id 集合**：只读遍历 26 id，绝无写入；QA grep 断言 `AchievementManager.js` diff 为空。
- **SaveManager 零改动**：新文件不 import/修改 SaveManager 内部私有状态（_dirty/_broken/cache）；只调 `load()/save()` 公开 API。
- 回归：存档读写、金币/升级/星级/成就/图鉴/模块/排行榜全链路行为等价；`qa_probes` 既有存档探针全绿。

### 探针建议
- `qa_probes/test_tech_t1.mjs`：构造含脏数据（coins=-5/upgrades.firepower='abc'/levelStars{1:9}/achievements{'fake':true}）的 localStorage → 启动 → 断言清洗后 coins=0/upgrades=0/levelStars 1..3/achievements 不含 fake；正常存档断言零改动。
- 断言 `SaveManager.js` / `AchievementManager.js` / `FloatingText.js` / `WingmanSystem.js` diff 为空（git diff 复核）。

---

## 第 T2 条：存档损坏分级自愈（SaveSanitizer 扩展）

### 背景 / 目标
`SaveManager.load()` 的 try/catch（L245-247）对**任意**解析异常统一 `cache = freshSave()`（整档重置）。JSON 局部损坏（如单个字段被截断为非法类型）本可字段级自愈，却整档归零丢进度。**红线 SaveManager.js 零改动** → 分级自愈逻辑放 SaveSanitizer。

**目标**：区分「整档损坏（JSON 不可解析，SaveManager 已兜底 freshSave）」与「字段级非法（可解析但值脏，SaveSanitizer.sanitize 已修复）」；对可解析存档做字段级自愈，最大限度保留玩家进度。

### 改动文件 + 函数签名
- `src/utils/SaveSanitizer.js`（扩展：新增 `analyzeSave` 与 `sanitizeSave` 加强）
- `src/main.js` — 挂接点不变（T1 的 `installSanitizer` 内部增强）

```js
// SaveSanitizer.js 新增
export function analyzeSave(raw) {
  // 返回 { structurallyBroken: boolean, fieldIssues: string[] }
  // 1) JSON.parse 抛错 → structurallyBroken=true（SaveManager 既有 freshSave 兜底，不改）
  // 2) 可解析 → 逐字段走 T1 sanitize 校验，收集字段级 issue 清单（仅统计，不写入）
  //    fieldIssues 供 QA 探针观测（window.__SAVE_SANITIZE = { issues: [...] }）
}
// installSanitizer 增强：先 analyze（记录 fieldIssues），再 sanitize + save（T1 不变）
```

### 精确语义
- `analyzeSave` **只读**：不修改存档，仅返回诊断；`sanitizeSave` 才实际修复。
- 整档损坏路径 **不动**（SaveManager.load 的 catch → freshSave 兜底保留，SaveManager.js 零改动）。
- 字段级非法：T1 sanitize 修复（合法值零改动），玩家其余进度保留。
- 探针钩子：`window.__SAVE_SANITIZE = { issues, sanitized }`（append-only，只读观测）。

### 参数表
复用 T1 `SANITIZE` 块；无新增。

### 降级策略
- 三档/reduced-motion N/A（纯数据层）。

### 风险与回归点
- **整档损坏仍整档重置**（既有行为，不因本项变化）→ QA 确认 catch 分支不变。
- 字段级自愈不改变合法值 → 正常存档零 diff。
- 回归：损坏 JSON → freshSave；脏字段 → 自愈；正常存档 → 零改动。

### 探针建议
- `qa_probes/test_tech_t2.mjs`：写损坏 JSON → 启动 → 断言 freshSave 生效（structurallyBroken=true）；写可解析但字段脏 → 断言 sanitized=true 且进度保留；读 `window.__SAVE_SANITIZE.issues`。

---

## 第 T3 条：GameScene 每帧池遍历合并（性能 · 弹幕热路径）

### 背景 / 目标
`GameScene.update()`（L674-799）对同一敌弹池 `this.enemyBullets` 存在**多处 children.each 遍历**：
- `recycleBullets()`（L2393）**每帧**遍历回收越界/死亡子弹；
- `_updateGraze()`（L1565）**每 GRAZE.CHECK_EVERY 帧**遍历做擦弹判定；
- 敌弹尾迹 `enemyGlow.emitParticleAt`（L789）**每 2 帧**遍历（与玩家弹尾迹 L781 在同一节流块）。

密集弹幕（POOL.enemyBullets=400 上限）下同一 group 每帧被迭代 1~3 次，是 CPU/GC 热点。

**目标**：把三处对 `enemyBullets` 的遍历**合并为单次 children.each**，内部按节流标志分派（回收/擦弹/尾迹），减少重复迭代；语义逐帧等价。

### 改动文件 + 函数签名
- `src/scenes/GameScene.js` — `update()` L756-761 区域、`recycleBullets()` L2383-2398、`_updateGraze()` L1560-1580、尾迹块 L776-794
- `src/config/GameConfig.js` — 复用 `GRAZE.CHECK_EVERY` / `COMBAT_PERF`（零新增）

```js
// GameScene 新增（合并三处遍历为单次）
_updateEnemyBullets(time) {
  if (!this.enemyBullets || !this.enemyBullets.children || this.enemyBullets.children.size === 0) return;
  this._grazeTick = (this._grazeTick || 0) + 1;
  const doGraze = this._grazeTick % GRAZE.CHECK_EVERY === 0;
  const doTrail = (this._trailTick = (this._trailTick || 0) + 1) % 2 === 0;
  const hasGlow = !!(this.enemyGlow);
  this.enemyBullets.children.each((b) => {
    if (!b.active) return;
    // 1) 每帧：越界/死亡回收（原 recycleBullets 单子弹判定，迁移为内联）
    if (b.y > GAME_HEIGHT + 40 || b.y < -40 || b.x < -40 || b.x > GAME_WIDTH + 40 || b._dead) {
      this.killBullet(b); return;
    }
    // 2) 每 N 帧：擦弹判定（原 _updateGraze 单子弹判定，迁移为内联；玩家存活守卫保持）
    if (doGraze && this.player.active) { /* 原 _updateGraze 的判定体 */ }
    // 3) 每 2 帧：敌弹尾迹（原 enemyGlow 分支）
    if (doTrail && hasGlow) this.enemyGlow.emitParticleAt(b.x, b.y);
  });
}
// update() L756-761 改为：
//   this._updateEnemyBullets(time);
//   // recycleBullets() / _updateGraze(time) / 尾迹 enemyGlow 分支不再各自遍历（逻辑内联）
```

### 精确语义
- **行为等价**：回收判定（越界/死亡）、擦弹判定（同弹冷却 RE_GRAZE_MS、玩家存活守卫、_grazedAt 赋值）、尾迹（每 2 帧）**原语义逐条保留**，仅收敛遍历。
- 玩家弹尾迹遍历（L781 `playerBullets`）**不在合并范围**（不同 group），保持原样。
- `recycleBullets()` 对外保留（若其它调用点存在则保留为空转或委托 `_updateEnemyBullets` 内联逻辑；确认无其它调用点后内联）。
- **节流语义不变**：回收每帧、擦弹每 N 帧、尾迹每 2 帧。

### 参数表
无新增（复用 GRAZE.CHECK_EVERY / POOL）。

### 降级策略
- **reduced-motion**：尾迹 emitter 本就 null（prefersReduced 短路）→ `hasGlow=false` 天然跳过。
- **性能三档**：三档同一路径（合并是收益不是成本）；low 档弹幕上限本就更低。

### 风险与回归点
- **行为漂移**：合并时若漏抄判定分支会导致回收/擦弹/尾迹异常 → QA 专项：长局弹幕回收、擦弹计数、敌弹尾迹可见性。
- **killBullet 内联时序**：回收分支与擦弹分支的先后顺序保持原逻辑（先回收越界再判擦弹）。
- 回归：敌弹越界回收、擦弹手感（qa_p2 链式擦弹探针）、敌弹尾迹、弹幕数量稳定。

### 探针建议
- `qa_probes/test_tech_t3.mjs`：战斗生成弹幕 → 断言 `_updateEnemyBullets` 单次遍历（可在遍历入口加计数钩子 `window.__SKY._bulletLoopCount`）；擦弹数值探针（qa_p2）全绿；越界回收后 active 回落。

---

## 第 T4 条：VFX 跟随型光效合帧（性能 · glowTarget 合帧）

### 背景 / 目标
`VFX.js` 中跟随型光效各自注册 `scene.events.on('update', sync)`（每实例一个回调）：
- `glowTarget`（L769）：玩家（GameScene L233）、Boss（L1027）、掉落物（L308 items.each）、精英 `_eliteGlow`（Enemy）等；
- `idleAura`（L806，OPT-15 V4）：敌机/Boss/僚机待机光环；
- `playerLight`（L892）：玩家光源；
- `bossAmbient`（L945）：Boss 环境光。

场上同时存在 N 个跟随光效时，每帧 N 个 EventEmitter 回调派发 + N 次闭包调用，是 VFX 热路径开销。

**目标**：合帧为**每场景 1 个 update 监听** + 模块级 registry 单次遍历；行为等价、探针计数不变、destroy/shutdown 清理等价。

### 改动文件 + 函数签名
- `src/systems/VFX.js` — `glowTarget`（L753-775）、`idleAura`（L786-824）、`playerLight`（L861-912）、`bossAmbient`（L916-970）改为走 registry；新增 `_glowRegistry` / `_ensureSceneGlowSync` / `_syncGlowLayer`

```js
// VFX.js 模块级（新增）
const _glowRegistry = new Map();   // key=scene → [{ glow, getTarget(){sprite}, visible, remove() }]
function _ensureSceneGlowSync(scene) {
  if (!scene || _glowRegistry.has(scene)) return;   // 幂等：每场景只注册 1 个 update 监听
  _glowRegistry.set(scene, []);
  scene.events.on('update', _syncGlowLayer);
  scene.events.once('shutdown', () => {
    _glowRegistry.delete(scene);                    // shutdown 清 registry + 已由各 remove 清理监听
    scene.events.off('update', _syncGlowLayer);
  });
}
function _syncGlowLayer() {
  // 遍历当前场景 registry：glow.setPosition(target.x, target.y); glow.setVisible(!!(target.active && target.visible));
}
// 每个跟随光效改为：
//   _ensureSceneGlowSync(scene);
//   const entry = { glow, getTarget: () => sprite, visible: () => !!(sprite.active && sprite.visible), remove() { /* destroy glow + 从数组移除 */ } };
//   _glowRegistry.get(scene).push(entry);
//   sprite.once('destroy', entry.remove);   // 保持既有销毁语义
// 返回句柄（glow / {glow, stop}）签名不变
```

### 精确语义
- **幂等注册**：`_ensureSceneGlowSync` 用 Map 判重，重复调用只注册一次；场景 shutdown 自动清理（off update + 删 registry），**零跨场景泄漏**。
- **行为等价**：合帧遍历内每实例做与原先 `sync` 完全相同的 `setPosition` / `setVisible`；`idleAura` 的呼吸 tween（alpha/scale）**不合并**（tween 由 Phaser 管理，只合帧位置跟随），V4 呼吸节奏不变。
- **清理等价**：`glowTarget` 原 destroy 解绑（L770-773）、`idleAura.stop()`（L815-822）语义保留（从 registry 移除 + destroy glow）；playerLight/bossAmbient 的既有 shutdown 清理保留。
- **探针不变**：`_localIllumActive`/`_afterglowActive`/`_idleAuraActive`/`_dynLight` getter **零改动**（合帧只改 update 跟随机制）。

### 参数表
无新增配置（沿用各光效既有 opts）。

### 降级策略
- **reduced-motion**：既有短路不变（prefersReduced 时不创建光效 → registry 空 → 合帧遍历空转零开销）。
- **性能三档**：三档同一合帧路径（收益统一）；low 档光效本就减少/关闭。

### 风险与回归点
- **destroy 时序**：sprite 先 destroy → glow 后 destroy 的既有顺序保持（entry.remove 在 sprite.once('destroy') 触发，与旧逻辑一致）；防「glow 悬挂未清」。
- **场景切换**：shutdown 清 registry + off 监听 → QA 场景往返 20 次监听数不增长（配合 T7 探针）。
- **V4 aura 共存**：idleAura 合帧后呼吸 tween 不变 → QA 敌机/Boss/僚机待机光环可见且呼吸正常。
- 回归：玩家/精英/Boss/掉落物光效跟随、V4 aura、`_dynLight` 计数、OPT-14 Bloom 层不受影响。

### 探针建议
- `qa_probes/test_tech_t4.mjs`：战斗存在光效实例 → 断言 `_glowRegistry.size<=场景数`、每场景仅 1 个 update 监听（`scene.events.listenerCount('update')` 稳定）；destroy 后 registry 长度回落；`_dynLight.idleAuraActive` 归零。

---

## 第 T5 条：展示层 i18n 审计补全（工程质量 · 英文版前置）

### 背景 / 目标
`Locale.js`（1145+ 行）词表已相当完整，GameScene/Enemy 已大量走 `t()`；但 **UIScene 仍有多处硬编码中文**（切英文版会漏翻）：
- `'命 ×'`（L62）、`'火力 Lv0'`（L67）、`'擦弹 0'`（L77）、`'能量 0%'`（L89）；
- `'主炮 · 脉冲'`（L164 创建、L659-660 更新）、`'武器'`（L658/829 fallback）、`'武器 · xxx'`（L661/831 模板）；
- 元素名 `火/冰/雷`（L426 INFO 表）、技能名 `def.name`（L679/825，SKILLS.name 是否 i18n 待审计）。

**目标**：UIScene 硬编码展示文案收敛到 `t()`，补 Locale 中英文案；同批审计 MenuScene/ResultScene 残留（审计面见精确语义）。

### 改动文件 + 函数签名
- `src/scenes/UIScene.js` — L62/L67/L77/L89/L164/L426/L658-661/L668/L679/L825/L829-831 等硬编码改 `t()`
- `src/config/Locale.js` — 新增词条（append-only，zh/en 双语）
- `src/config/GameConfig.js` — 新增 `HUD_I18N` 配置块（元素名/武器名映射表，append-only）

```js
// Locale.js 新增词条（zh/en 各一）
hud_lives: '命 ×{n}',        hud_lives_en: 'Lives ×{n}',
hud_power: '火力 Lv{n}',     hud_power_en: 'Power Lv{n}',
hud_graze: '擦弹 {n}',       hud_graze_en: 'Graze {n}',
hud_energy: '能量 {n}%',     hud_energy_en: 'Energy {n}%',
hud_weaponMain: '主炮 · {w}', hud_weaponMain_en: 'Main · {w}',
hud_weapon: '武器 · {w}',     hud_weapon_en: 'Weapon · {w}',
weaponFallback: '武器',       weaponFallback_en: 'Weapon',
elemFire: '火', elemFire_en: 'Fire', elemIce: '冰', elemIce_en: 'Ice',
elemThunder: '雷', elemThunder_en: 'Thunder',
overdriveS: '过载 {n}s',      overdriveS_en: 'OD {n}s',

// UIScene 用法示例
this.powerText = this.add.text(HUD_RIGHT, 84, t('hud_power', { n: 0 }), { ... });
// _onWeapon 更新：
this.weaponText.setText(w === 'pulse'
  ? t('hud_weaponMain', { w: t('weapon_pulse') })
  : t('hud_weapon', { w: short, n: ... }));
// L426 元素表：{ fire: [t('elemFire'), '#ff7a3a'], ice: [t('elemIce'), ...], thunder: [t('elemThunder'), ...] }
```

### 精确语义
- **只改展示文案**：不改布局坐标/字号/事件/字体；`t()` 缺 key 时回退原中文字符串（`Locale.t` 已有回退语义，零回归）。
- **动态模板**：`{n}`/`{w}` 模板替换沿用 `t(key, params)` 既有机制。
- **审计面**：同批 grep `src/scenes/MenuScene.js` / `ResultScene.js` / `src/entities/Wingman.js` 等剩余硬编码中文（`['"\u4e00-\u9fa5]`），逐处决定改 t() 或确认无需 i18n（纯符号/数字）；**审计结果写入本规格附录 A**。
- 语言切换后 HUD 刷新：`UIScene` 的 setText 路径在 `setLocale` 后经场景重启重绘（既有机制），本项只保证文案源走 t()。

### 参数表
`HUD_I18N` 配置块（元素色/武器 short 映射，append-only；可选，若现有 WEAPONS/ELEMENTS 已含 short 则直接复用）。

### 降级策略
- **reduced-motion / 性能三档**：不影响（文本静态）。
- **缺词条回退**：zh 为主语言，新增词条 zh 值 = 原硬编码字符串，**默认语言逐字等价**。

### 风险与回归点
- **漏改/错改**：某处硬编码漏改 → 英文版仍露中文；QA 切 en 全 HUD 扫描。
- **模板值错**：`{n}`/`{w}` 占位符不匹配 → 显示原文；QA 检查 火力/擦弹/能量/武器/命 数值正确。
- **默认语言零回归**：zh 值与原字符串一致 → 中文版视觉零变化。
- 回归：HUD 全部文本（命/火力/擦弹/能量/武器/元素/过载）、技能名、武器名在 zh/en 下正确。

### 探针建议
- `qa_probes/test_tech_t5.mjs`：切 en → 断言 HUD 文本为英文（读 `window.__UI.hud` 快照或 canvas 文本）；切回 zh → 断言与原硬编码一致；grep 断言 UIScene 剩余硬编码中文为 0（白名单符号除外）。

---

## 第 T6 条：事件/键名契约审计（工程质量 · 散落字符串收口）

### 背景 / 目标
EventBus 裸字符串已全部收口到 `EVENTS.*`（OPT-13 A3 成果，本基线 grep 无匹配）。剩余散落字符串键：
- `scene.events.on('update', ...)`（框架标准用法，**不需收口**）；
- 纹理 key（`'glow_soft'`/`'particle_spark'`/`'particle_dot'`/`'bullet_'` 前缀）散落在 VFX/GameScene；
- localStorage `SAVE_KEY` 已集中（GameConfig）；`window.__SKY` 等钩子命名散落（T9 处理）。

**目标**：把**高复用纹理 key 与自定义事件名**收口到 GameConfig 常量（值不变，纯引用替换），形成键名契约；框架标准用法（scene.events 'update'/'shutdown'）不做变更。

### 改动文件 + 函数签名
- `src/config/GameConfig.js` — 新增 `TEXTURE_KEYS` / `EVENT_CONTRACT` 配置块（append-only）
- `src/systems/VFX.js`、`src/scenes/GameScene.js` — 纹理 key 改引用常量（值不变）

```js
// GameConfig 新增
export const TEXTURE_KEYS = {
  glowSoft: 'glow_soft', particleSpark: 'particle_spark', particleDot: 'particle_dot',
  vignettePerm: 'vignette-perm', bulletPrefix: 'bullet_',
};
// EVENT_CONTRACT（登记既有自定义事件名，值=字符串原值；供审计对照，非运行时必需）
```

### 精确语义
- 只改引用，**字符串值不变** → 纹理查找/事件名逐字节等价，零回归。
- `scene.events.on('update'|'shutdown'|'destroy')` 等 Phaser 框架事件**不**收口（标准生命周期，收口反而增加维护成本）。
- 审计产出：`EVENT_CONTRACT` 登记表（新增自定义事件名 + 值 + 使用文件），供 QA/后续开发对照。

### 参数表
见上（append-only）。

### 降级策略
- 三档/reduced-motion N/A（编译期常量）。

### 风险与回归点
- **漏替换/错替换**：grep 断言替换点值一致；QA 纹理/粒子正常显示。
- 回归：全部纹理显示、粒子特效、弹幕纹理。

### 探针建议
- `qa_probes/test_tech_t6.mjs`：grep 断言 `'glow_soft'` 等字符串仅出现在 GameConfig（或白名单）；运行时 `window.__SKY.textures.exists(TEXTURE_KEYS.glowSoft)` 为 true。

---

## 第 T7 条：事件监听泄漏审计（工程质量 · 防跨场景泄漏）

### 背景 / 目标
BloomFX（L116/118/144）、FilmFX（L96/102）、VFX（L230/769/806/884/892/936/945/1014）已做对称 on/off 与 shutdown 清理；GameScene `shutdown`（L2607 区域）、UIScene `unbind`（L928 区域）已存在。但仍需**全量审计**：所有 `scene.events.on` / `EventBus.on` / `this.time.delayedCall` / `tweens` 是否在 shutdown/unbind 对称清理；场景往返切换后监听数是否增长。

**目标**：审计并补齐缺失解绑点；新增「场景切换监听数不增长」探针（配合 T9 钩子）。

### 改动文件 + 函数签名
- 审计面：`src/scenes/*.js`、`src/systems/*.js`、`src/utils/*.js`（on/off 对称）
- `src/scenes/UIScene.js` — `bindEvents()`（L484 区域）与 `unbind()`（L928 区域）补对称 off
- `src/scenes/GameScene.js` — `shutdown()` 补未清理监听（若有）
- `src/utils/SaveSanitizer.js` — 无（不注册监听）

```js
// 审计规则（写入 QA 探针）：对每个 EventBus.on / scene.events.on / emitter.on，
// 必须存在对应 off（shutdown/unbind/destroy 路径）。缺失清单写入本规格附录 B。
// 补 off 示例（UIScene.unbind 内追加）：
//   EventBus.off(EVENTS.WEAPON_CHANGED, this._onWeapon);
//   EventBus.off(EVENTS.GRAZE_CHANGED, this._onGraze);
//   EventBus.off(EVENTS.SKILL_SWITCHED, this._onSkillSwitched);
//   EventBus.off(EVENTS.COMBO_CHANGED, this._onCombo);
//   ...（逐一对应 bindEvents 中的 on）
```

### 精确语义
- **对称原则**：bindEvents 中每个 `EventBus.on(...)` 在 unbind 中有对应 `EventBus.off(...)`（同一 handler 引用）；`scene.events.on` 在 shutdown/destroy 中 off。
- **只补缺失**：已有对称的（BloomFX/FilmFX/VFX 大部分）不动，避免回归。
- **探针**：`window.__PROBE._listenerCount = { eventBus: EventBus.listenerCount?.(), scene: scene.events.listenerCount('update') }`（append-only，T9 钩子）。

### 参数表
无新增配置。

### 降级策略
- 三档/reduced-motion N/A（内存/工程质量）。

### 风险与回归点
- **补 off 破坏功能**：若 handler 引用不一致（on 用箭头闭包、off 用不同引用）会解绑失败/误解绑 → 只用「bindEvents 中已保存的命名 handler」做 off；QA 场景往返 20 次功能正常（HUD 仍响应）。
- 回归：场景切换（Menu↔Game↔Result）、HUD 事件、Bloom/Film 清理、VFX 清理。

### 探针建议
- `qa_probes/test_tech_t7.mjs`：Menu→Game→Menu→Result 往返 20 次 → 断言 `EventBus`/`scene.events` listenerCount 不增长（相对首轮）；`_dynLight` 计数不累积。

---

## 第 T8 条：仓库卫生（工程质量 · 清理与收口）

### 背景 / 目标
`.gitignore` 已覆盖 node_modules/dist/*.log/.DS_Store/.vite/shot_*.png/shots/AGENT_HANDOFF.md/.git_broken_*/qa_yan/qa_probes/_*.txt/.workbuddy/sky-raiders-web.zip。存在 `qa_probes/_opt15_diff_vfx.txt` 等已忽略临时产物；需复核无未跟踪文件/未提交变更，保证后续各项 diff 复核有干净基准。

**目标**：清理临时产物、补 .gitignore 条目、复核 `git status` 干净（无未跟踪/未提交）。

### 改动文件
- `.gitignore`（append-only，补 `docs/_*.md` / `qa_probes/*_diff_*.txt` / `*.tmp`）
- 删除可删临时文件：`qa_probes/_opt15_diff_vfx.txt`（及同类已忽略 `_*.txt` 按需清理，**不删探针源码**）

```bash
# .gitignore 追加
docs/_*.md
qa_probes/*_diff_*.txt
*.tmp
```

### 精确语义
- 只动 .gitignore 与**已忽略**临时文件；**不删除** `qa_probes/test_*.mjs` 探针源码、不删 docs 规格文档。
- 复核命令：`git status --porcelain` 为空（无未跟踪/未提交）。

### 参数表
无。

### 降级策略
- 三档/reduced-motion N/A。

### 风险与回归点
- **误删探针/文档**：只删 `_*.txt`/`*_diff_*.txt` 前缀临时产物；QA 确认 `qa_probes/test_*.mjs`、`docs/*.md` 完整。
- 回归：构建、git status 干净。

### 探针建议
- QA 复核：`git status --porcelain` 为空；`git check-ignore qa_probes/_opt15_diff_vfx.txt` 命中。

---

## 第 T9 条：测试钩子规范化（工程质量 · window.* 契约）

### 背景 / 目标
现存探针钩子：`window.__SKY`（GameScene 测试面）、`window.__GAME._dynLight`（VFX getter，append-only）、`window.__FILM`、`window.__PAUSE`（OPT-15 V7）、`window.__RESULT_SHARE`（ResultScene）、`window.__BLOOM`（OPT-14）。需审计：命名/只读性/生命周期一致性；确保 append-only（新增字段不破坏既有断言）；shutdown 清理避免跨场景残留。

**目标**：钩子契约文档化（写入本规格附录 C）；补齐缺失的只读/清理语义；新增 `window.__PROBE`（T7/T3 共用计数）。

### 改动文件 + 函数签名
- 审计面：各钩子安装点（GameScene/UIScene/ResultScene/VFX/BloomFX/FilmFX）
- `src/systems/VFX.js` — `installLightProbes`（L1025-1053）保持 append-only，`_dynLight` getter 只读不变
- `src/scenes/GameScene.js` / `src/scenes/UIScene.js` — 钩子安装处补 `Object.defineProperty(writable:false, configurable:true)`（只读契约）

```js
// 统一钩子安装规范（写入附录 C，逐钩子核对）：
//   window.__SKY / __FILM / __PAUSE / __RESULT_SHARE / __BLOOM / __GAME._dynLight / __PROBE / __SAVE_SANITIZE
//   1) defineProperty 只读（writable:false, configurable:true）防业务误写
//   2) 挂到 game（随 Phaser 生命周期存在），不挂 window 顶层全局变量（避免泄漏到其它页面）
//   3) append-only：新增字段不删除/不改既有字段名与类型（既有探针断言不破）
// GameScene 新增（T3 共用）：
//   Object.defineProperty(this.game, '_probe', { get() { return { bulletLoopCount, prewarmMs }; }, configurable: true });
```

### 精确语义
- **只读契约**：钩子对象只读（getter 或 frozen），业务代码**不写**钩子字段。
- **append-only**：新增字段（如 `_dynLight.grazeSparkCount`/`idleAuraActive` 等 OPT-15 已加）只增不减。
- **生命周期**：钩子挂 `game`（与 Phaser 共存），场景 shutdown **不删除**（跨场景可读），但钩子内部状态（registry/计数）由各系统清理。
- 文档化：附录 C 列全钩子清单 + 字段 + 读法。

### 参数表
无新增配置（`PROBE` 配置块可选，默认空）。

### 降级策略
- 三档/reduced-motion N/A（测试基础设施，不参与玩法）。

### 风险与回归点
- **钩子改动破坏既有探针**：只做只读化/文档化，**不改字段名/类型**；QA 全量既有探针（qa_p2/qa_juice_visual_p3/qa_y06_hardening 等）全绿。
- 回归：`_dynLight`、`__SKY`、`__FILM`、`__PAUSE`、`__BLOOM` 既有断言。

### 探针建议
- `qa_probes/test_tech_t9.mjs`：遍历附录 C 钩子清单 → 断言存在且只读（写入抛错或静默失败）；既有 `qa_probes` 全量跑绿。

---

## 第 T10 条：首帧冷启动与池预填收口（性能）

### 背景 / 目标
`GameScene.create` 已分散预填：`enemyBullets`（L167 POOL.enemyBullets）、`playerBeams`（L158 POOL.playerBeams）、`bulletGlow`（L311）、`vfxPool`（L301）、`residuePool`（L303）；`VFX.warmup`（L627）存在但调用点待确认。首帧大量分散 add/创建造成冷启动卡顿。

**目标**：把 create 中分散预填/预热收口为 `_prewarm()`（GameScene 私有方法）；确认/补 `VFX.warmup` 调用；记录预填耗时（探针）；低性能档按 `PERFORMANCE.scale` 降低预填量。

### 改动文件 + 函数签名
- `src/scenes/GameScene.js` — 新增 `_prewarm()`（create 末尾调用）；把 L152-175/L301-311 预填逻辑收口
- `src/systems/VFX.js` — 确认 `warmup(scene)`（L627）在 `_prewarm` 内调用（若尚未调用）
- `src/config/GameConfig.js` — 复用 `POOL`/`PERFORMANCE`（零新增或 `POOL.prewarmScale` append-only）

```js
// GameScene 新增
_prewarm() {
  const t0 = performance.now();
  // 1) 敌弹池预填（原 L167 循环）→ 数量按 qualityScale 缩放（low 降量）
  // 2) 玩家弹池预填（原 L158 maxSize 已建，按需预填）
  // 3) bulletGlow 池预填（原 L311 循环）
  // 4) vfxPool / residuePool 创建（原 L301/L303）
  // 5) VFX.warmup(this) 调用（确认已有，无则补）
  this._prewarmMs = Math.round(performance.now() - t0);
  Object.defineProperty(this.game, '_probe', { get: () => ({ prewarmMs: this._prewarmMs, ... }), configurable: true }); // 配合 T9
}
// create() 末尾：this._prewarm();
```

### 精确语义
- **行为等价**：预填数量/容量语义不变（`POOL.enemyBullets` 等）；只把分散创建收口到单一方法 + 统一计时。
- **低档降量**：low 档按 `PERFORMANCE.scale`（0.45）缩放预填量（`Math.max(1, Math.floor(n * qs))`），不改变 maxSize 语义。
- **计时探针**：`_prewarmMs` 只读观测，不影响玩法。

### 参数表
`POOL.prewarmScale`（可选，默认 1.0；low 档 0.45 由 qualityScale 驱动）。

### 降级策略
- **reduced-motion**：不影响（无动效）。
- **性能三档**：high=全量预填；mid=0.7 缩放；low=0.45 缩放（减少冷启动创建量）。

### 风险与回归点
- **预填不足**：降量后首帧 `Group.get()` 仍可能触发现有扩容路径（已有 maxSize + get null 兜底）→ 行为安全，只是首帧可能少几个预创建对象；QA 确认首帧/首波弹幕正常。
- 回归：首帧流畅度、弹幕池容量、vfxPool/residuePool 功能。

### 探针建议
- `qa_probes/test_tech_t10.mjs`：进入 GameScene → 断言 `window.__GAME._probe.prewarmMs` 存在且 < 阈值（如 200ms，宽松）；低档 `qualityScale=0.45` 时预填量按比例。

---

## 第 T11 条：每帧分配热点审计（性能 · update 热路径）

### 背景 / 目标
OPT-13 A2 已修 `checkBeamHits` 的 `getBounds()` 分配（手算 AABB + 降频）。剩余 update 热路径仍可能每帧新建对象：`steerHomingBullets()`（L764）、`steerEnemyBullets()`（L766）、`updateMagnet()`（L745）、`_updateGraze`（L1565，临时对象）、`starfield.update`（L697）等。

**目标**：审计 update 路径每帧新建对象（数组/对象字面量/箭头闭包/Phaser 临时 Rectangle/Vector2），对明确热点复用模块级临时对象或改手算；**行为逐帧等价**。

### 改动文件 + 函数签名
- `src/scenes/GameScene.js` — 审计并修复热点：`steerHomingBullets` / `steerEnemyBullets` / `updateMagnet` / `_updateGraze`
- `src/entities/Player.js`、`src/entities/Enemy.js` — 若 update 内发现明确分配热点（临时对象），同法修复

```js
// 修复范式（模块级/实例级复用临时对象，避免每帧 new）：
// GameScene 模块级：const _tmpVec = new Phaser.Math.Vector2();（或复用既有 this._vec 若存在）
// steerHomingBullets 内：用 _tmpVec 做距离计算/方向归一，不 new Vector2
// _updateGraze 内：避免每弹 new 对象（原实现若用临时数组/对象则改为标量累计）
```

### 精确语义
- **只改分配，不变语义**：数值结果、转向/磁力/擦弹判定逐帧等价；QA 用数值探针（qa_p2 擦弹、转向命中）回归。
- **审计清单**：本规格附录 D 列全部待审计函数 + 现状 + 处置（修复 / 确认无热点 / 低优先级）。
- 性能收益：减少每帧 GC 抖动；不改变任何玩法数值。

### 参数表
无新增（复用既有常量）。

### 降级策略
- 三档/reduced-motion：收益统一，无分支。

### 风险与回归点
- **改分配引入数值漂移**：复用临时对象若在循环内残留状态会污染下次计算 → 每处复用前必须重置/全赋值；QA 转向/磁力/擦弹数值探针全绿。
- 回归：追踪导弹转向、敌弹追踪、磁力吸附、擦弹判定。

### 探针建议
- `qa_probes/test_tech_t11.mjs`：战斗长局（30s+）→ 断言无每帧新增对象泄漏（可挂 `__PROBE._allocTick` 计数或在 dev 构建下用内存快照粗测）；qa_p2 擦弹探针全绿。

---

## 第 T12 条：硬编码魔法值收敛（工程质量 · 配置集中）

### 背景 / 目标
GameConfig 已集中大量配置（PERFORMANCE/POOL/COMBAT_PERF/ELITE/RAGE/RELIEF/COMBO_BURST/BLOOM/FILM/EASE/LIGHTS/GRAZE_SPARK/IDLE_AURA 等）；但代码中仍散落魔法值（如 UIScene 坐标/颜色、GameScene `_stormTick % 30` 风暴节流、`_trailTick % 2` 尾迹节流、HUD 布局坐标等）。

**目标**：审计散落高价值魔法值 → 收敛到 GameConfig append-only 配置块（纯常量替换，值不变）。

### 改动文件 + 函数签名
- `src/config/GameConfig.js` — 新增 `MAGIC` 配置块（append-only，含 `STORM_TICK_EVERY:30` / `TRAIL_TICK_EVERY:2` / `HUD_LIVES_Y:64` 等）
- `src/scenes/GameScene.js`、`src/scenes/UIScene.js` — 魔法值改引用 `MAGIC.*`（值不变）

```js
// GameConfig 新增（append-only；只登记「高复用/跨文件」魔法值，单处局部常量不入表）
export const MAGIC = {
  stormTickEvery: 30, trailTickEvery: 2, grazeCheckEvery: GRAZE.CHECK_EVERY,
  hudLivesY: 64, hudPowerY: 84, hudElementY: 104, hudGrazeY: 124, hudEnergyX: 204,
};
```

### 精确语义
- 纯常量替换：`this._stormTick % 30` → `this._stormTick % MAGIC.stormTickEvery`；值不变，逐帧等价。
- **只收口高复用/跨文件魔法值**；函数内单处局部常量（如一次性动画时长）不收口（避免过度工程）。
- 审计面附录 E：列出已收口项 + 评估为「不收口」项及理由。

### 参数表
见上 `MAGIC`（append-only）。

### 降级策略
- 三档/reduced-motion N/A（编译期常量）。

### 风险与回归点
- **错引常量**：替换值必须与原魔法值完全一致；QA grep 断言原数值不再散落（白名单除外）。
- 回归：风暴节流、尾迹节流、HUD 布局。

### 探针建议
- `qa_probes/test_tech_t12.mjs`：grep 断言 `% 30`/`% 2` 等已收敛（白名单）；运行时 `window.__SKY._stormTick % MAGIC.stormTickEvery === 0` 触发风暴。

---

## 末尾：全量回归清单 + 探针脚本思路

### 全量回归清单（QA 验收用）
1. 红线：`WINGMAN.COMBO`（GameConfig L699-705）grep 未改；成就 id 集合未变；`WingmanSystem.js` / `FloatingText.js` / `SaveManager.js` diff 为空；`SaveSanitizer.js` 为新建文件且不 import 红线逻辑。
2. T1/T2：脏存档清洗（coins 负/upgrades 非数字/levelStars 越界/achievements 假 key）自愈；正常存档零改动；整档损坏仍 freshSave；`window.__SAVE_SANITIZE` 可读。
3. T3：敌弹回收/擦弹/尾迹行为等价；qa_p2 链式擦弹探针全绿；`__PROBE.bulletLoopCount` 单次遍历。
4. T4：玩家/精英/Boss/掉落物光效跟随正常；V4 aura 呼吸不变；场景往返 20 次 `scene.events` 监听数稳定；`_dynLight` 计数归零无泄漏。
5. T5：切 en 后 HUD 全英文（命/火力/擦弹/能量/武器/元素/过载）；切回 zh 与原文一致；MenuScene/ResultScene 审计面记录在案。
6. T6/T12：纹理 key / 魔法值替换后值一致，grep 复核；纹理/粒子/风暴/尾迹功能正常。
7. T7：场景往返 20 次监听数不增长；HUD 事件仍响应。
8. T8：`git status --porcelain` 为空；临时产物已清理；探针源码与 docs 完整。
9. T9：附录 C 钩子清单存在且只读；既有全量探针（qa_p2/qa_juice_visual_p3/qa_y06_hardening 等）全绿。
10. T10：`__GAME._probe.prewarmMs` 存在；low 档预填按比例降量；首帧/首波弹幕正常。
11. T11：长局无分配泄漏；转向/磁力/擦弹数值探针全绿。

### 探针脚本思路
- `qa_probes/test_tech_t1.mjs` / `test_tech_t2.mjs`：localStorage 注入脏数据 → 启动 → 断言清洗/自愈/零改动。
- `qa_probes/test_tech_t3.mjs`：战斗 → `__PROBE.bulletLoopCount` 单次遍历；qa_p2 全绿。
- `qa_probes/test_tech_t4.mjs`：`_glowRegistry` 规模、`listenerCount('update')` 稳定、`_dynLight.idleAuraActive` 归零。
- `qa_probes/test_tech_t5.mjs`：en 切语言 HUD 英文；zh 与原文一致；grep 硬编码中文为 0。
- `qa_probes/test_tech_t6.mjs`：纹理 key 常量引用；`textures.exists` 为 true。
- `qa_probes/test_tech_t7.mjs`：场景往返 20 次监听计数不增长。
- `qa_probes/test_tech_t8.mjs`：git status 空 + check-ignore 命中。
- `qa_probes/test_tech_t9.mjs`：钩子清单存在 + 只读 + 既有探针全绿。
- `qa_probes/test_tech_t10.mjs`：`prewarmMs` 阈值 + 低档预填量。
- `qa_probes/test_tech_t11.mjs`：长局分配稳定 + 数值探针全绿。
- `qa_probes/test_tech_t12.mjs`：grep 魔法值收敛 + 运行时触发。
- 复用既有 `window.__SKY` / `window.__GAME._dynLight` / `window.__FILM` / `window.__PAUSE` 钩子模式，**新增钩子仅 append（不破坏现有探针断言）**。

---

## 附录 A：i18n 审计面（T5 配套）
- 已定位（UIScene）：`命 ×`（L62）/`火力 Lv0`（L67）/`擦弹 0`（L77、L668）/`能量 0%`（L89）/`主炮 · 脉冲`（L164、L659-660）/`武器`（L658、L829 fallback）/`武器 · xxx`（L661、L831）/元素 火·冰·雷（L426）/`过载 {n}s`（L822）。
- 待审计（同批 grep）：`MenuScene.js` / `ResultScene.js` / `Wingman.js` 等 `['"\u4e00-\u9fa5]`；逐处决定改 t() 或确认为符号/数字白名单。
- 验收：en 版 HUD 无中文；zh 版逐字等价；审计结果回填本表。

## 附录 B：事件监听审计清单（T7 配套）
- 规则：每个 `EventBus.on`/`scene.events.on` 必须有对应 off（shutdown/unbind/destroy 路径）。
- 已确认对称：BloomFX（L116/118/144）、FilmFX（L96/102）、VFX glowTarget/idleAura/playerLight/bossAmbient/localIllum（L230/769/771/806/818/884/892/936/945/969/1005/1014）。
- 待补（UIScene bindEvents→unbind 对称）：`WEAPON_CHANGED`/`GRAZE_CHANGED`/`SKILL_SWITCHED`/`COMBO_CHANGED`/`ELEMENT_CHANGED` 等（实现时逐一核对）。
- 验收：场景往返 20 次监听数不增长。

## 附录 C：测试钩子契约清单（T9 配套）
| 钩子 | 挂载点 | 说明 | 只读 |
|---|---|---|---|
| `window.__SKY` | GameScene | 战斗测试面 | 是 |
| `window.__GAME._dynLight` | VFX.installLightProbes | 动态光影计数（getter，append-only） | 是 |
| `window.__FILM` | FilmFX | 电影层状态 | 是 |
| `window.__PAUSE` | UIScene（OPT-15 V7） | 暂停氛围状态 | 是 |
| `window.__RESULT_SHARE` | ResultScene | 分享卡钩子 | 是 |
| `window.__BLOOM` | BloomFX（OPT-14） | Bloom 状态 | 是 |
| `window.__SAVE_SANITIZE` | SaveSanitizer（T2） | 存档清洗诊断 | 是 |
| `window.__GAME._probe` | GameScene（T3/T10） | 遍历/预填计数 | 是 |
| `window.__PROBE` | 全局（T7） | 监听计数 | 是 |

## 附录 D：每帧分配热点审计清单（T11 配套）
| 函数 | 现状 | 处置 |
|---|---|---|
| `checkBeamHits` | 已手算 AABB + 降频（OPT-13 A2） | 保持 |
| `steerHomingBullets`（GameScene L764） | 待审计（可能每帧临时对象） | 复用临时 Vector2 |
| `steerEnemyBullets`（L766） | 待审计 | 同法 |
| `updateMagnet`（L745） | 待审计 | 标量累计 |
| `_updateGraze`（L1565） | 待审计（每弹临时对象） | 标量累计 |
| `starfield.update`（L697） | 待审计 | 按实测 |
| 其它 update 路径 | 全量 grep `new ` 复核 | 按实测 |

## 附录 E：魔法值收敛清单（T12 配套）
- 收口：`_stormTick % 30`、`_trailTick % 2`、HUD 布局坐标（64/84/104/124/204）。
- 不收口（理由）：单处局部动画时长、单函数一次性偏移（过度工程）。

---

## 附：红线重申（开发 PR 自检清单）
- [ ] `GameConfig.js` `WINGMAN.COMBO`（L699-705）diff 为空
- [ ] `AchievementManager.js` 26 成就 id diff 为空（T1 只读白名单，零写入）
- [ ] `WingmanSystem.js` diff 为空
- [ ] `FloatingText.js` diff 为空
- [ ] `SaveManager.js` diff 为空（T1/T2 钳位/自愈下沉到新建 `SaveSanitizer.js` + `main.js` 挂接，只调既有公开 API）
- [ ] 零外部资源（无图片/字体/网络/音频新增）
- [ ] 纯工程质量零玩法平衡（不触碰伤害/数值/流程/存档字段语义）
- [ ] 性能纪律：T3/T4/T11 只合并/复用分配，不新增每帧全量扫描；T10 只改预填
