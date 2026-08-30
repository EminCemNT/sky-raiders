# OPT-14 画面质感 Top5 实现规格（架构方案 · 开发/QA 引用版）

> 作者：高见远（arch-opt / 架构师）｜日期：2026-08-31
> 状态：**已拍板，待开发实现**（画面质感轮产出）
> 范围：画面质感 Top5 = A1 Bloom 排除 UI / A2 Bloom 下采样+脏标记 / A3 FILM 电影层全场景统一 / C1 缓动表统一 / B2 爆炸残像拖尾 —— 全部**函数级实现规格**，供 coder-opt 直接照做。
> 代码基线：HEAD = 2b398f4（OPT-13 批B QA 全绿）。工作树干净。只出规格，不改任何代码。
> 引用说明：worker 以本文件为唯一实现规格来源；正文完整、无「见其他文档」引用（行号为当前基线核对值，开发以实际为准）。

---

## 〇、红线总览（五项逐一确认，零触碰）

| 红线项 | 结论 |
|---|---|
| `GameConfig.js` `WINGMAN.COMBO` 五字段（L699-704） | **零触碰**。五项均不读写该块。 |
| `AchievementManager.js` 26 个成就 id | **零改动**。五项纯视觉，不触碰成就条件/进度。 |
| `WingmanSystem.js` | **零触碰**。 |
| `FloatingText.js` | **只读不改**。A1 仅在 BloomFX redraw 侧按 depth 跳过其渲染进辉光层；**不改 FloatingText 任何逻辑/字段**。 |
| `SaveManager` 旧字段结构 | **零改动**。本规格不新增存档字段（全部为运行时/配置级改动）。 |
| 零外部资源 | 全部程序纹理 + 现有工具函数；**零图片/音频/网络/字体依赖**。C1 不引入外部字体。 |
| 纯视觉 / 零业务逻辑 | A1/A2/A3/C1/B2 均为纯表现层；**不触碰任何伤害/数值/流程/存档**。 |

> 检查方式：开发 PR 自检 + QA 回归（尤其：`WINGMAN.COMBO` 未改、成就 id 集合未变、`FloatingText.js` diff 为空、`SaveManager.js` diff 为空）。

---

## 一、实现顺序表（推荐）

| 顺序 | 条目 | 理由 |
|---|---|---|
| 1 | A1 Bloom 排除 UI 层 | 最小改动、观感收益最大、零风险；A2 的 redraw 改造以 A1 后的 redraw 为基线 |
| 2 | A3 FILM 电影层全场景统一 | 独立小改，抽取复用函数；与 A1 可同批 |
| 3 | A2 Bloom 下采样 + 脏标记 | 依赖 A1 后的 redraw；含 Phaser RT 缩放语义验证（见 A2 附注） |
| 4 | C1 缓动表统一 | 独立；替换清单长但均为字符串等价替换，可与 A2 并行 |
| 5 | B2 爆炸残像拖尾 | 独立小改，最后做（不阻塞其它项） |

---

## 第 A1 条：Bloom 排除 UI 层（画面锐度 · 真实短板修复）

### 背景 / 目标
`src/utils/BloomFX.js` 的 `redraw()`（L64-76）每帧把 `scene.children.getChildren()` 全部子节点画进 RenderTexture（仅排除 RT 自身与 `ParticleEmitter`/`Zone`），再以 ADD + `rtAlpha` 叠加在场景之上。实测 **GameScene 内**：
- 飘字（`FloatingText` DEPTH=80）会被画进辉光层 → 飘字边缘泛光发糊；
- 战斗弹窗（教程/救济/爬塔容器 depth 600/800/801）会被二次辉光 → 面板泛光；
- 同时每帧把这些文本/图形重栅格化进 RT（隐藏的每帧成本）。
- HUD 在独立 `UIScene`（并行场景，显示列表不属于 GameScene）→ **天然不进 GameScene 的 RT**，已锐利；这反而造成同屏「HUD 锐、飘字糊、弹窗泛光」的观感不一致。

**目标**：让辉光层只覆盖 gameplay 层（≤60），UI 层（飘字 80 / 弹窗 600+）保持锐利；顺带减少每帧 RT 绘制内容。

### 改动文件 + 函数签名
- `src/utils/BloomFX.js` — `enableSceneBloom(scene, quality)` 内部 `redraw()`（L64-76）
- `src/config/GameConfig.js` — `BLOOM` 配置块（L1056-1069，append-only）

```js
// BloomFX.js redraw 内（精确语义见下）
const redraw = () => {
  if (!rt || !rt.active || !rt.visible) return;
  rt.clear();
  const children = scene.children.getChildren();
  const entries = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c === rt) continue;                                    // 防递归（原逻辑保留）
    if (c && (c.type === 'ParticleEmitter' || c.type === 'Zone')) continue; // 粒子不进辉光层（原逻辑保留）
    if (BLOOM.excludeUI && c.depth > BLOOM.excludeUIDepth) continue; // 【新增】跳过 UI 层
    entries.push(c);
  }
  if (entries.length) rt.draw(entries, 0, 0, 1);
};
```

### 精确语义（阈值依据，已实测）
- 遍历判定条件：`c.depth > BLOOM.excludeUIDepth` 则**不进 entries**（不绘制进辉光层）。
- **阈值定值 `excludeUIDepth: 64`**（默认）。依据（当前基线实际 depth 分布）：
  - gameplay 层最高 = **60**（GameScene L2275 元素风暴中心 `setDepth(60)`）、59（L2282 星暴光环）、58（VFX.flashCore）、56（VFX.localIllum）、55（hitSpark）、54（shockwaveRing）、52（reactionRing）、51（conductionArc）、50（explosion）、46（debris）、44（smoke）—— 全部 ≤ 60；
  - 飘字 = 80（FloatingText DEPTH=80）→ >64 被排除 ✓；
  - 战斗弹窗 = 600/800/801 → >64 被排除 ✓；
  - 顶部 keyLight depth 8、残骸 scorch 6、玩家 20、Boss 18、敌机 0、子弹尾迹 15-19、`_bulletGlowPool` 17 —— 均 ≤ 60，保留 ✓。
  - 留 4px 缓冲（60→64），未来新增 gameplay 特效 ≤ 63 不误伤。
- `BLOOM.excludeUI` 默认 **true**（这是本项核心收益，不设默认关）。
- **UIScene 的 HUD / 暂停遮罩 / 低血红框 / FILM 层不属于 GameScene.children，天然不受影响**，无需处理；不要试图跨场景过滤。

### 参数表（append-only，默认值）
```js
// GameConfig.BLOOM 追加
BLOOM.excludeUI: true,       // 是否跳过 UI 层进辉光
BLOOM.excludeUIDepth: 64,    // depth 阈值：>64 视为 UI 层，不画进 RT
```

### 降级策略
- **reduced-motion**：不影响（静态渲染判定，纯绘制内容过滤）。
- **性能三档**：三档一致启用（跳过 UI 是收益不是成本）；low 档本就 bloom 关闭（`qualityGate='mid'`），本项无额外分支。
- **Canvas 模式**：`enableSceneBloom` 已判 WebGL 返回 null，本项不产生 Canvas 路径差异。

### 风险与回归点
- **误伤 gameplay**：若某 gameplay 对象 depth > 64 会被错误排除 → 阈值为 64（含 60+4 缓冲）；回归时确认元素风暴/星暴/Boss 死亡特效仍发光。
- **飘字观感变化**：飘字不再泛光（由糊变锐），属预期收益；QA 确认飘字仍清晰可见（在 HUD 之下、玩法之上）。
- 回归：`__BLOOM` 探针（`pipelines` 节点数不变）；高亮辉光强度（RT 内容减少但 ADD 叠加语义不变）。

### 探针建议
- `qa_probes`：进入战斗击杀一次 → `window.__BLOOM.rt` 的 redraw 内 entries 中**不含 depth>64 对象**；飘字存在时其 depth 80 不在 RT 绘制列表（可通过探针在 redraw 后读 RT 内容像素或用计数钩子）。
- 简单断言：`__BLOOM.rt.active` 仍 true、`__BLOOM.enabled` 仍 true、`window.__SKY` 战斗对象深度分布含 60（未被误排）。

---

## 第 A2 条：Bloom 下采样 + 静态场景脏标记（soft bloom · 性能约 4x）

### 背景 / 目标
当前 RT 全分辨率（540×960）且**每帧** `clear + draw` 全部子节点；MenuScene 等静止菜单也在每帧烧成本，且全分辨率辉光偏「硬」。目标：
1. RT 降到 1/2~1/4 分辨率（soft bloom 商业观感 + RT 绘制带宽降约 4x）；
2. 静态场景加脏标记，避免每帧重绘；
3. 战斗等动态层仍每帧刷新。

### Phaser 3.90 RT 缩放语义验证结论（已读 node_modules 源码，可直接落地）
- **`rt.camera` 是公开字段**（`RenderTexture.js` L95：`this.camera = this.texture.camera`；官方注释「You can scroll, zoom and rotate this Camera … only impacts the placement of Game Objects that you then draw to this texture」）。
- 绘制链路：`rt.draw(entries,…)` → `DynamicTexture.draw` → `batchGroup` → `batchGameObject(entry, entry.x + x, entry.y + y)`，使用 `this.camera`（`DynamicTexture.js` L1324 `entry.willRender(this.camera)`、L1350 `var camera = this.camera`、WebGL 路径 `batchTextureFrame` 用 `this.camera.matrix` L1451）。
- **camera 的 `zoom` 进入 `camera.matrix`（view 矩阵）** → `rt.camera.setZoom(0.5)` 会把绘制进 RT 的对象**整体缩小 0.5**（世界坐标 0..540 → RT 像素 0..270）；`willRender` 的视口剔除也基于 zoom 后的 `worldView`，不会误裁剪。
- **可落地做法（正确）**：
  ```js
  const d = downscale; // 2 或 4
  const rt = scene.add.renderTexture(0, 0, GAME_WIDTH / d, GAME_HEIGHT / d)
    .setOrigin(0)
    .setDepth(4990)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha(rtAlpha);
  rt.camera.setZoom(1 / d);          // 关键：内部绘制缩放（把全分辨率世界装进低分辨率 framebuffer）
  // 显示时放大铺满屏幕（origin(0) 已设，从 (0,0) 放大 d 倍）
  rt.setScale(d, d);
  ```
  - GAME_WIDTH=540 / GAME_HEIGHT=960 **均为偶数**，`d=2` → 270×480、`d=4` → 135×240 均偶数，`forceEven` 无取偶偏差。
  - 纹理采样默认 Linear（Phaser 默认 `LINEAR`），放大显示 = 双线性插值 → **柔和（soft bloom 目的）**。
- **明确排除的错误做法**：
  - `rt.setScale(0.5)`（不配合尺寸缩小）：只改显示缩放、不改 framebuffer，**无性能收益**，且 origin(0) 下会显示偏移/只占半屏 —— 不是下采样。
  - `rt.resize(w/2, h/2)` 但不设 camera zoom：只重建 framebuffer，绘制坐标仍按全分辨率 → 内容裁剪/错位。
- **「会不会糊」**：本体场景仍全分辨率渲染；RT 只是 ADD 叠加层。半分辨率叠加层放大后整体柔化，但 `rtAlpha` 低（0.2 量级），且辉光本就应柔 → 观感为「更柔的辉光」，可接受；若觉过柔，用 `downscale.rtAlpha` 微调补偿（0.24→0.20~0.22）。

### 改动文件 + 函数签名
- `src/utils/BloomFX.js` — `enableSceneBloom(scene, quality, opts)`（L42 起）；新增 `_applyDownscale(rt, d)` 内部辅助
- `src/config/GameConfig.js` — `BLOOM` 配置块（append-only）

```js
// BloomFX.js
export function enableSceneBloom(scene, quality, opts = {}) {
  // 现有开关判定不变（bloomEnabledForQuality / isWebGL）
  const d = (BLOOM.downscale && BLOOM.downscale.enabled) ? (BLOOM.downscale.factor || 2) : 1;
  const rt = scene.add.renderTexture(0, 0, GAME_WIDTH / d, GAME_HEIGHT / d)
    .setOrigin(0).setDepth(4990)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha((BLOOM.downscale && BLOOM.downscale.enabled)
      ? (BLOOM.downscale.rtAlpha != null ? BLOOM.downscale.rtAlpha : BLOOM.rtAlpha)
      : BLOOM.rtAlpha);
  if (d > 1) {
    rt.camera.setZoom(1 / d);
    rt.setScale(d, d);
  }
  // postFX.addBloom 参数不变；redraw 逻辑沿用（含 A1 的 UI 排除）
}
```

### 脏标记精确语义（静态场景不每帧重绘）
- `enableSceneBloom(scene, quality, opts)` 增加第三参 `opts`：`{ staticMode?: boolean }`（默认 **false** → 战斗场景行为不变，每帧重绘，弹幕/爆炸实时）。
- `staticMode === true` 时 redraw 改为：
  ```js
  let frame = 0;
  const redraw = () => {
    frame++;
    if (BLOOM.downscale && BLOOM.downscale.enabled && opts.staticMode) {
      if (this._bloomDirty !== true && frame % BLOOM.downscale.staticEveryNFrames !== 0) return; // 脏标记或到周期才重绘
      this._bloomDirty = false;
    }
    // …原 redraw 逻辑（含 A1 UI 排除）
  };
  ```
  - `_bloomDirty`：场景内需要立即反映的变更（如弹出面板、切换选中态）时由**调用方置 `__BLOOM.dirty = true`**（探针友好）或在场景 update 中调用 `ctl.markDirty()`。
  - 兜底：`staticEveryNFrames` 默认 **5**（≈83ms 一次，静态场景呼吸 tween 3400ms 周期内多次刷新，观感连续；星field 5 帧移动 ≈6px，ADD 0.2 叠加下不可见跳变）。
- 接入点：`MenuScene` / `ResultScene` / `HangarScene` 调用 `enableSceneBloom(this, quality, { staticMode: true })`；`GameScene` 不传（默认 false）。

### 参数表（append-only，默认值）
```js
// GameConfig.BLOOM 追加
BLOOM.downscale: {
  enabled: true,          // 总开关
  factor: 2,              // 2=1/2 分辨率(270×480) / 4=1/4 分辨率(135×240)；推荐 2
  rtAlpha: 0.20,          // 下采样后叠加 alpha 补偿（原 0.24 → 0.20，防整体过柔）
  staticEveryNFrames: 5,  // staticMode 脏标记兜底重绘周期
}
```

### 降级策略
- **性能三档**：`high` = factor 2（或 4，观感优先取 2）；`mid` = factor 4（性能优先）；`low` = bloom 关闭（既有 `qualityGate='mid'`），N/A。
- **reduced-motion**：不影响（静态渲染）。
- **Canvas 模式**：bloom 已短路（无 postFX），N/A。
- **降级兜底（若验证发现 camera 私有性/兼容问题）**：`enabled:false` 一键回退到「全分辨率 RT + 仅 A1 UI 排除 + 静态脏标记」——保留大部分性能收益与锐度收益，放弃 soft bloom 柔和度。**该降级是配置级，不改代码结构**。

### 风险与回归点
- RT 尺寸减半后 `rt.draw` 的坐标空间由 camera zoom 校正 → **必须同时设置 `rt.camera.setZoom(1/d)`**，否则内容错位（QA 重点断言：辉光仍居中、无偏移）。
- 下采样后辉光更柔 → `rtAlpha` 补偿；回归对比「爆炸时辉光不过曝 / 暗部不泛白」。
- 静态场景脏标记 → 弹窗/选中态变化需 `markDirty()`，否则 5 帧内不刷新（延迟 ≤83ms，可接受，但面板弹出场景应置 dirty）。
- 回归：`__BLOOM.pipelines` 节点数不变；`rt.width/height` 变化为 270×480（探针断言）。

### 探针建议
- 断言 `window.__BLOOM.rt.width === GAME_WIDTH / factor`、`rt.camera.zoom === 1/factor`、`rt.scaleX === factor`。
- 静态场景：记录 redraw 调用计数，1 秒内应 ≤ `60/staticEveryNFrames + 少量 dirty` 次（如 factor=2 时 ≤ ~15 次/秒），战斗场景不受限。
- 视觉：战斗爆炸瞬间截图对比高/低档辉光强度（rtAlpha 补偿后无过曝）。

---

## 第 A3 条：FILM 电影层全场景统一（消除菜单/结算观感断层）

### 背景 / 目标
当前常驻暗角 + 胶片颗粒只在战斗 `UIScene._buildFilmLayers()`（L861-892）；`MenuScene` / `ResultScene` / `HangarScene` 只开 bloom、无 film → 战斗有电影感、菜单/结算发「平」。目标：抽 `applyFilmLayer()` 复用函数，四场景统一；**菜单颗粒做静态纹理防每帧抖动**（观感关键：动态颗粒在静止菜单上会明显闪）。

### 改动文件 + 函数签名
- 新增 `src/utils/FilmFX.js` — `applyFilmLayer(scene, opts)` / `setFilmGrainStatic(ctl, on)`
- `src/scenes/UIScene.js` — `_buildFilmLayers()` L861-892 改为调用 `applyFilmLayer(this, { key:'combat', grainSpeed:true })`（战斗保持动态颗粒）
- `src/scenes/MenuScene.js` / `ResultScene.js` / `HangarScene.js` — create 中接入 `applyFilmLayer(this, { key:'menu'|'result'|'hangar' })`
- `src/config/GameConfig.js` — `FILM` 配置块扩展（append-only）

```js
// FilmFX.js（新文件）
/**
 * 常驻暗角 + 胶片颗粒（电影感，纯视觉零业务）。
 * @param {Phaser.Scene} scene
 * @param {{key?:string, vignetteAlpha?:number, grainAlpha?:number, grainSpeed?:boolean}} opts
 *   key 预置档：'combat'|'menu'|'result'|'hangar'（查 FILM.presets）；显式传 alpha 覆盖。
 * @returns {{vignette, grain, setGrainStatic(on), destroy}|null}
 */
export function applyFilmLayer(scene, opts = {}) { … }
```

### 精确语义
- `vignette-perm` / `grain_tex` 纹理若不存在则由 TextureFactory 生成（现已有 `makeGrainTexture` L1140；vignette 在 UIScene L866-878 程序生成——**抽到 FilmFX 内首次调用时生成**，后续场景复用纹理，不重复建）。
- 各场景接入后：
  - 战斗（UIScene）：vignette depth 88、grain depth 96（现状）；`grainSpeed:true` → 每帧 update 抖动 1-2px（现状 L736）。
  - 菜单/结算/机库：vignette depth 88、grain depth 96；`grainSpeed:false` → **不注册每帧抖动**（静态纹理铺满，防闪烁；这是观感关键）。
- `setGrainStatic(ctl, on)`：true 时移除 update 抖动监听（若已注册）；false 时恢复。
- destroy：移除 update 监听 + 销毁 image（场景 shutdown 自动清理，保持对称）。

### 参数表（append-only，默认值）
```js
// GameConfig.FILM 扩展（保留原字段不动）
FILM.presets: {
  combat: { vignetteAlpha: 0.16, grainAlpha: 0.04, grainSpeed: true  },
  menu:   { vignetteAlpha: 0.10, grainAlpha: 0.02, grainSpeed: false },
  result: { vignetteAlpha: 0.12, grainAlpha: 0.025, grainSpeed: false },
  hangar: { vignetteAlpha: 0.11, grainAlpha: 0.02, grainSpeed: false },
},
// FILM 原字段（vignetteAlpha 0.16 / grainAlpha 0.04 / grainSpeed true / grainLowAlpha 0.02）保留，
// 作为 combat 档的兼容默认（applyFilmLayer 未传 key 时回退原字段）。
```

### 降级策略
- **性能三档**：`low` 档 grainAlpha 减半（沿用 `grainLowAlpha` 语义：combat 0.02、menu/result/hangar 0.01）；暗角保留（成本极低）。三档均**静态场景 grainSpeed=false**（不抖动），战斗仍按档位决定是否抖动。
- **reduced-motion**：`grainSpeed` 强制 false（静态颗粒，现状已如此 L736 `!PREFERS_REDUCED` 判定），暗角保留。
- Canvas/WebGL 均可用（纯 Image 叠加，无 postFX 依赖）。

### 风险与回归点
- 菜单/结算/机库新增暗角+颗粒 → 轻微压暗画面；alpha 已压低（0.10-0.12 vignette / 0.02-0.025 grain），QA 确认文字/按钮对比度不受影响（尤其结算数据行）。
- **菜单颗粒静态是红线**：不要给静态场景启用每帧抖动（闪烁观感）。
- 回归：战斗 film 行为不变（UIScene 仍动态颗粒）；`grain_tex`/`vignette-perm` 纹理 key 不冲突（首次生成后复用）。

### 探针建议
- 断言四场景 `scene` 上存在 vignette/grain image（depth 88/96）；菜单场景 grain image 无 update 抖动（`setGrainStatic` 后每帧 alpha/xy 不变）；战斗场景抖动存在。
- `window.__FILM` 测试钩子：暴露各场景 film ctl（`{vignetteAlpha, grainAlpha, grainStatic}`）。

---

## 第 C1 条：缓动表统一（整体手感一致）

### 背景 / 目标
抽查全库 tween：`Sine.easeInOut` 呼吸、`Back.easeOut` 弹跳、`Cubic.out` 入场、`Quad.easeOut` 反馈已大致规范，但按钮按压（`UIWidgets.js` NeonButton L210 / makeIconButton L286）**未指定 ease（默认 Linear）**，部分 duration 散落；`Cubic.in`/`Quad.easeInOut` 等混用无统一语义。目标：GameConfig 增加 `EASE` 表，全库按语义替换（**仅改 ease 字符串，不动 duration/yoyo/delay/onComplete**）。

### 改动文件 + 函数签名
- `src/config/GameConfig.js` — 新增 `EASE` 常量（append-only）
- `src/utils/UIWidgets.js` — NeonButton / makeIconButton 按压 tween 补 ease
- 三场景 + 系统文件逐处替换（见替换清单）

```js
// GameConfig 新增
export const EASE = {
  enter:    'Cubic.easeOut',  // 入场/推进（从动到静）：面板、横幅、光效
  pop:      'Back.easeOut',   // 弹跳强调：星级、按钮、卡片、飘字
  breathe:  'Sine.easeInOut', // 呼吸脉动：标题、光晕、星云、能量环
  feedback: 'Quad.easeOut',   // 按压/受击微反馈：按钮按下、受击缩放
  exit:     'Cubic.easeIn',   // 离场/坠落：飘字离场、星暴上浮、闪光消失
};
```
> 注：Phaser 3 中 `'Cubic.out'` 与 `'Cubic.easeOut'` 等价；替换统一用完整形式（行为零变化）。

### 替换清单（文件:行:旧 → 新；仅替换 ease 值）

**A. 明确替换（语义吻合）**

| 文件:行 | 旧 | 新 | 语义 |
|---|---|---|---|
| `UIWidgets.js:210`（NeonButton pointerdown） | （无，默认 Linear） | `EASE.feedback` | 按压缩放 |
| `UIWidgets.js:286`（makeIconButton pointerdown） | （无，默认 Linear） | `EASE.feedback` | 按压缩放 |
| `UIWidgets.js:207/208`（hover glow alpha） | （无） | `EASE.breathe` | 辉光淡入淡出 |
| `UIWidgets.js:249`（setSelected glow） | （无） | `EASE.breathe` | 选中辉光 |
| `Enemy.js:493`（受击缩放） | `Quad.easeOut` | `EASE.feedback` | 受击反馈 |
| `Enemy.js:575`（死亡弹跳） | `Back.easeOut` | `EASE.pop` | 死亡强调 |
| `Enemy.js:578`（死亡收缩） | `Back.easeIn` | `EASE.exit` | 离场 |
| `Boss.js:102`（入场） | `Back.easeOut` | `EASE.pop` | Boss 入场弹入 |
| `Boss.js:650/651`（狂暴鼓动） | `Quad.easeOut` | `EASE.feedback` | 状态鼓动 |
| `Boss.js:696`（死亡弹跳） | `Back.easeOut` | `EASE.pop` | 死亡强调 |
| `Boss.js:699`（死亡收缩） | `Back.easeIn` | `EASE.exit` | 离场 |
| `Boss.js:705`（死亡鼓动） | `Back.easeOut` | `EASE.pop` | 死亡强调 |
| `GameScene.js:1388`（拾取缩放） | `Quad.easeOut` | `EASE.feedback` | 拾取反馈 |
| `GameScene.js:2284`（星暴上浮） | `Cubic.in` | `EASE.exit` | 星暴离场 |
| `MenuScene.js:965`（图标反馈） | `Quad.out` | `EASE.feedback` | 图标反馈 |
| `MenuScene.js:1209`（面板入场） | `Cubic.out` | `EASE.enter` | 面板入场 |
| `ResultScene.js:76`（胜利爆闪淡出） | `Cubic.out` | `EASE.exit` | 爆闪离场 |
| `ResultScene.js:252`（星级弹入） | `Back.out` | `EASE.pop` | 星级弹入 |
| `ResultScene.js:258`（星级光圈） | `Cubic.out` | `EASE.enter` | 光圈扩散 |
| `UIScene.js:279`（弹窗入场） | `Back.easeOut` | `EASE.pop` | 弹窗弹入 |
| `UIScene.js:568`（combo 弹入） | `Back.easeOut` | `EASE.pop` | combo 强调 |
| `UIScene.js:723`（burst 环扩散） | `Cubic.out` | `EASE.enter` | 光效扩散 |
| `UIScene.js:947`（飘字入场 y:100） | `Cubic.out` | `EASE.enter` | 飘字入场 |
| `UIScene.js:951`（飘字离场 y:-60） | `Cubic.in` | `EASE.exit` | 飘字离场 |
| `FloatingText.js:98`（飘字淡出） | `Cubic.out` | `EASE.exit` | 飘字离场 |
| `FloatingText.js:104`（飘字弹入） | `Back.easeOut` | `EASE.pop` | 飘字弹入 |
| `FloatingText.js:108`（飘字上飘离场） | `Cubic.out` | `EASE.exit` | 飘字离场 |
| `FloatingText.js:166`（横幅出场） | `Cubic.out` | `EASE.enter` | 横幅出场 |
| `VFX.js:108`（shockwaveRing 扩散） | `Cubic.out` | `EASE.enter` | 冲击波扩散 |
| `VFX.js:520`（reactionRing 扩散） | `Cubic.out` | `EASE.enter` | 元素环扩散 |
| `VFX.js:814`（localIllum 扩散） | `Cubic.out` | `EASE.enter` | 局部照亮扩散 |

**B. 替换为 EASE.breathe（呼吸类，原已是 Sine 系，字符串统一）**

| 文件:行 | 旧 | 新 |
|---|---|---|
| `HangarScene.js:62/63/174/175`、`MenuScene.js:52/53/59/67/1199`、`UIScene.js:112/200`、`Starfield.js:222`、`VFX.js:707/762` | `Sine.easeInOut`（或 `Sine.inOut`） | `EASE.breathe` |

**C. 明确不替换（保留原语义，理由注明）**
- `VFX.js:776`（Boss 死亡环境光 2s 回落）、`VFX.js:954`（焦痕 fade）：**Linear** 线性淡出是正确语义（均匀老化），不换。
- `TransitionManager.js:292`（wipe 扫描带）：`Quad.easeInOut` 对称扫过是 wipe 专用手感，不换（或换 `EASE.breathe` 等价，但保持独立更稳）。
- `Starfield.js:246`（流星）：`Sine.easeIn` 加速坠落是物理感，不换。
- `GameScene.js:2284` 已在上表替换为 exit；无其它遗漏。

### 降级策略
- 纯字符串等价替换（`Cubic.out` ≡ `Cubic.easeOut`），**零运行期行为变化** → reduced-motion / 性能三档 / Canvas 均无影响。
- 若某处替换后观感不理想，可回退该处原字符串（替换清单可单独 revert，互不依赖）。

### 风险与回归点
- 最大风险是**误改非 ease 参数**：规格明确「只改 ease 字符串，不动 duration/yoyo/delay/onComplete/targets」；开发 diff 需逐行核对。
- 等价写法 `'Cubic.out'`→`'Cubic.easeOut'` 在 Phaser 3 内部经 `EaseMap` 归一化，行为一致（QA 可断言 tween 时长/终值不变）。
- 回归：按钮按压手感、面板入场、飘字、Boss 入场/死亡演出、星级弹入等既有动效时长与终值不变（仅曲线语义统一）。

### 探针建议
- 静态断言：grep 全库 `ease:` 后，除「不替换」白名单外均引用 `EASE.*`（或等价字符串）；`UIWidgets.js` 按压 tween 存在 ease。
- 运行时：触发按钮按压/星级弹入，确认 tween 正常完成（无报错、无卡死），时长与替换前一致。

---

## 第 B2 条：爆炸残像拖尾（motion smear · 爆炸观感提升）

### 背景 / 目标
爆炸已有五层（白闪核心→冲击波环→粒子→残骸→烟尘），缺商业 STG 常见「炸开后短暂残像/泛光拖尾」：爆炸点残留 1-2 个低 alpha、慢衰减、逐帧上浮的 glow_soft 副本，强化"爆炸的余温与体积感"。

### 改动文件 + 函数签名
- `src/systems/VFX.js` — `explosionLayered(scene, x, y, color, opts)`（L162-189）末尾追加 `_spawnExplosionAfterglow(scene, x, y, color, tier)` 私有函数
- `src/config/GameConfig.js` — 可加 `VFX_COLORS`/专用 `AFTERGLOW` 配置（append-only；或并入 `LIGHTS.illum` 语义，建议独立小块）

```js
// VFX.js
function _spawnExplosionAfterglow(scene, x, y, color, tier) {
  if (prefersReduced) return;                    // reduced-motion 跳过
  const qs = _qualityScale(scene);
  if (qs < 0.6) return;                          // low 档不生成（纯视觉优先保帧）
  const n = (tier === 'boss') ? 2 : 1;           // small/mid=1，boss=2
  for (let i = 0; i < n; i++) {
    const delay = 40 + i * 60;                   // 残影错峰：40ms / 100ms
    const img = scene.add.image(
      x + Phaser.Math.Between(-8, 8),
      y + Phaser.Math.Between(-4, 6),
      'glow_soft')
      .setDepth(49)                              // 在 explosion(50) 之下，作底光
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(0.1, 0.1)
      .setAlpha(0);
    scene.tweens.add({
      targets: img,
      delay,
      scaleX: 0.9 + i * 0.4,                     // 残影1≈0.9，残影2≈1.3（更大更淡）
      scaleY: 0.9 + i * 0.4,
      y: img.y - (10 + i * 6),                   // 上浮 10~16px
      alpha: (tier === 'boss' ? 0.28 : 0.22) - i * 0.06, // 起始 alpha（残影2更淡）
      duration: 260 + i * 60,                    // 衰减 260~320ms
      ease: 'Cubic.easeOut',
      onComplete: () => { if (img && img.active) img.destroy(); },
    });
  }
}
// explosionLayered 末尾（L189 setTimeout(spawnResidueLater,160) 之后）追加：
//   _spawnExplosionAfterglow(scene, x, y, color, tier);
```

### 精确语义
- **触发点**：`explosionLayered()` 末尾（与 `spawnResidueLater` 同级，不依赖 setTimeout——残影用 Phaser tween，reduced 已短路）。
- **数量**：small/mid = 1，boss = 2（Boss 连环爆炸观感更重）。
- **alpha 曲线**：`0.22→0`（boss 0.28 起）、`Cubic.easeOut` 衰减（前快后慢，余温感）。
- **衰减时长**：260ms（残影1）/ 320ms（残影2）。
- **偏移**：x ±8px、y -4~+6px 初始散布；上浮 10~16px。
- **混合**：ADD；**depth 49**（explosion 粒子 50 之下 → 残影作爆炸底光，不遮挡粒子本体）。
- 生命周期：tween 完成 destroy；场景 shutdown 时 tween 被 kill 不触发 onComplete → **沿用 localIllum 的 shutdown 兜底模式**（`scene.events.once('shutdown', cleanup)` 销毁残影并防泄漏，见 VFX.js L808 同款）。

### 参数表（append-only，默认值）
```js
// GameConfig 新增 AFTERGLOW（或并入 VFX 配置）
AFTERGLOW: {
  small: { count: 1, alpha: 0.22, scale: 0.9, ms: 260, rise: 10 },
  mid:   { count: 1, alpha: 0.22, scale: 0.9, ms: 260, rise: 10 },
  boss:  { count: 2, alpha: 0.28, scale: [0.9, 1.3], ms: [260, 320], rise: [10, 16] },
  depth: 49,
}
```
（实现可将 `_spawnExplosionAfterglow` 内部值直接引用 AFTERGLOW，避免散落魔法数。）

### 降级策略
- **reduced-motion**：直接 `return`（不创建残影）。
- **性能三档**：low 档（`qs < 0.6`）不生成；mid/high 按 tier 数量。
- Canvas 模式：glow_soft 纹理可用（纯 Image + ADD），无 postFX 依赖 → 双模式一致。

### 风险与回归点
- **残影生命周期泄漏**：必须带 shutdown 兜底（tween 被 kill 不触发 onComplete 时销毁残影），否则跨场景残留 glow 对象。
- depth 49 在 explosion(50) 之下：确认不遮挡爆炸粒子本体、不与 debris(46)/smoke(44) 冲突。
- reduced/low 不生成：回归确认降档后无残影、无报错。
- 回归：爆炸五层时序不变（残影是附加层，不改变 flashCore→shockwaveRing→explosion→debris→smoke 既有延迟）。

### 探针建议
- 击杀敌机后断言：爆炸点附近 depth 49 的 ADD glow_soft 残影对象在 400ms 内存在且 alpha 递减、1s 内全部销毁；reduced/low 下残影数为 0。
- `window.__SKY` 可加 `afterglowActive` 计数（只读 getter，仿 `_dynLight` 模式）。

---

## 末尾：回归清单 + 探针脚本思路

### 全量回归清单（QA 验收用）
1. `WINGMAN.COMBO`（GameConfig L699-704）grep 断言未改；成就 id 集合未变；`FloatingText.js` / `SaveManager.js` diff 为空。
2. A1：战斗击杀飘字清晰（无泛光）；元素风暴/星暴/Boss 死亡特效仍发光；`__BLOOM.enabled` true、pipelines 节点数不变。
3. A2：`__BLOOM.rt.width===270`、`camera.zoom===0.5`、`scaleX===2`；辉光居中无偏移；爆炸不过曝；静态场景 redraw 频率 ≤ ~15/s，战斗每帧。
4. A3：四场景均有 film 层（depth 88/96）；菜单/结算/机库颗粒**静态**（不抖动）；战斗颗粒动态；low 档 grainAlpha 减半。
5. C1：按钮按压/面板入场/飘字/Boss 演出/星级动效时长与终值不变；全库 ease 引用规范（白名单除外）。
6. B2：击杀敌机残影 1（Boss 2）出现、alpha 递减、1s 内销毁；reduced/low 无残影；无跨场景 glow 泄漏。

### 探针脚本思路
- `qa_probes/test_visual_a1.mjs`：进战斗 → 击杀 → 读 `__BLOOM` + `__SKY` → 断言 redraw entries 无 depth>64 对象。
- `qa_probes/test_visual_a2.mjs`：读 `__BLOOM.rt` 尺寸/zoom/scale + 计数 redraw 频率（静态场景 vs 战斗）。
- `qa_probes/test_visual_a3.mjs`：遍历四场景断言 film 层存在 + `setGrainStatic` 状态。
- `qa_probes/test_visual_b2.mjs`：击杀 → 断言残影计数与销毁（reduced/low 分支）。
- 复用既有 `window.__SKY` / `window.__BLOOM` / `window.__TRANSITION` 钩子模式，**新增钩子仅 append（不破坏现有探针断言）**。

---

## 附：红线重申（开发 PR 自检清单）
- [ ] `GameConfig.js` `WINGMAN.COMBO`（L699-704）diff 为空
- [ ] `AchievementManager.js` 26 成就 id diff 为空
- [ ] `WingmanSystem.js` diff 为空
- [ ] `FloatingText.js` diff 为空（A1 只在 BloomFX 侧按 depth 过滤，不改 FloatingText）
- [ ] `SaveManager.js` diff 为空（无新增存档字段）
- [ ] 零外部资源（无图片/字体/网络/音频新增）
- [ ] 纯视觉零业务逻辑（不触碰伤害/数值/流程/存档）
