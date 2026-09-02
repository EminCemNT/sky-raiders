# 苍穹战机 · OPT-16 产品体验批 C1–C11 需求规格（开发 / QA 引用版）

> 作者：许清楚（product-manager / pm-opt）｜日期：2026-09-01
> 状态：**产品需求规格（PM 建议优先级已标注；条目取舍/排期待主理人拍板）**
> 范围：本文只定义「做什么 / 怎么算做对」，不写实现细节（落点标注供架构师参考，非实现方案）。
> 代码基线：HEAD = d455af6（OPT-16 技术快赢批 T1–T12 已推送：SaveSanitizer 存档钳位/自愈、HUD i18n、glowTarget 合帧等）。
> 存档基线：SaveManager 既有字段语义**全部保留、零改动**；只可 **append-only 新增字段**；或走**独立文件**（`SaveSanitizer.js` 先例，只调 SaveManager 既有公开 API）。
> 红线底线：`WINGMAN.COMBO` 块 / 26 个成就 id / `WingmanSystem.js` / `FloatingText.js` = **零触碰**；**零外部资源**（无图片/字体/音频/网络/后端）；任何数值/解锁/流程类改动默认采用「**不改变既有玩家进度 / 存档兼容**」策略（见各条）。
> 引用说明：worker 以本文件为唯一产品需求来源；正文完整、无「见其他文档」引用。本文**不重复** OPT-13/14/15 已实现方向（波次变体/称号/救济局/图鉴/连击蓄力/无尽变异/免疫风暴/精英/Boss 狂暴/画面质感 V 系五项等均已落地）。

---

## 〇、产品批总览（PM 建议，供主理人拍板）

| 条目 | 一句话 | 类别 | PM 建议优先级 | 存档字段依赖 |
|---|---|---|---|---|
| C1 | 难度门禁：累计勋章达到阈值后才可选「困难/地狱」 | 半业务（解锁流程） | P1（先做提示闭环，门禁默认豁免存量） | 无新增（读既有 `medalCount` 派生 + `selectedDifficulty`） |
| C2 | 昵称编辑器：设置面板可自定义昵称，结算/分享卡同步 | 流程体验（纯 UI） | P0 | 复用既有 `nickname`（无新增） |
| C3 | 战后复盘：结算页补充擦弹/时长/受击等本局详情 | 纯展示零业务 | P0 | 无新增（局内 stats → 结算 payload 透传） |
| C4 | 存档导出/导入（备份/迁移），导入走 Sanitizer 校验 | 工具类 | P1（与 C8 成对） | 无新增（整档 JSON 包装） |
| C5 | 每日种子挑战：同一天所有人同一固定波次/种子，拼当日最高分 | 半业务（新玩法入口） | P1 | 新增 `dailyChallenge`（append-only） |
| C6 | 暂停面板增加「重开本局」 | 流程体验（QoL） | P0 | 无新增（局内重进，复用既有 run 参数） |
| C7 | 移动端震动反馈（受击/击杀/Boss 演出），可设置关闭 | 体验反馈 | P1 | 新增 `haptics`（append-only） |
| C8 | 存档清除（带二次确认，建议先导出再清） | 工具类 | P1（与 C4 成对） | 无新增（整档重置，独立文件） |
| C9 | 主菜单轮换战术提示（新手/进阶按 tutorialDone 分流） | 纯展示零业务 | P0 | 无新增 |
| C10 | Boss 第四阶段（高难专属强化终局） | 半业务（高风险战斗内容） | P2 / 建议改型后做 | 无新增 |
| C11 | 新增第 4 架战机（复用现有武器/元素 + 新被动） | 内容新增 | P2 | 无新增（默认免费可选，见边界） |

> 类别说明：纯展示零业务（爸爸偏好）＝ C3 / C9；流程体验＝ C2 / C6；半业务（解锁/数值/流程叠加）＝ C1 / C5 / C10；工具类＝ C4 / C8 / C7；内容新增＝ C11。
> ⚠️ 假设：以上优先级为 PM 建议，最终取舍/排期由主理人拍板；本文逐条均已给足验收标准，任意子集可直接开发。

---

## 一、红线总览（11 条逐一确认）

| 红线项 | 结论 |
|---|---|
| `GameConfig.js` `WINGMAN.COMBO` 五字段 | **零触碰**。C1–C11 均不读写该块。 |
| `AchievementManager.js` 26 个成就 id | **零改动**。C1–C11 不新增/修改任何成就 id/condition/progress；C5 每日挑战奖励走金币，不产出新成就。 |
| `WingmanSystem.js` | **零触碰**。 |
| `FloatingText.js` | 只允许附加式新增浮字/横幅（C3/C9 若有提示），**不改既有 damageNumber 行为**。 |
| `SaveManager.js` 旧字段语义 | **全部保留**；C1–C11 仅 C5 新增 `dailyChallenge`、C7 新增 `haptics`（均为 append-only）；C2 复用既有 `nickname`；C4/C8 走独立文件（`SaveTransfer.js` 先例，只调公开 API）。 |
| 既有系统（四档难度/元素/擦弹/过载/爬塔/周赛/勋章/救济局/BossRush/事件/每日任务/新手计划） | **全部保留、零回归**；新增均以「同难度/同数值叠加」或「仅新档位/新入口」方式接入，标准路径逐字段等价。 |
| 已实现方向 | OPT-13/14/15 与 T1–T12 已落地项**不重复提出**（C1 的勋章阈值展示已在 MenuScene L493-501 存在，本批只补「门禁闭环」，不是新概念）。 |
| 零外部资源 | 全部程序内改动；**零图片/音频/网络/字体**；C7 震动只用 `navigator.vibrate`（标准 Web API，无资源）。 |

---

## 第 C1 条：难度门禁（勋章阈值解锁困难/地狱）

### 用户故事
作为有一定勋章积累的玩家，我想要达到勋章阈值后才可选「困难/地狱」，以便难度档位有成长仪式感、新手不被高难劝退；同时老玩家已选的高难不被打断。

### 语义要点（对齐现状）
- 现状：`MEDALS.THRESHOLD = 6` 已在 GameConfig（L778-781）；MenuScene 关卡选择面板已显示「累计 X/6 · 高难挑战」提示（L493-501，注释明言「先做展示，高难解锁后续接入」）；设置面板四档难度**当前全部可自由点击**（MenuScene L262-284，直接写 `selectedDifficulty`）。
- 本批目标：把「展示提示」补成「选择闭环」——`medalCount < MEDALS.THRESHOLD` 时，设置面板点击「困难/地狱」被拦截并弹提示（含还差几枚勋章 + 入口跳转关卡面板看勋章目标）；`medalCount >= THRESHOLD` 后正常可选。
- **存量豁免（默认策略，红线要求）**：老存档若 `selectedDifficulty ∈ {hard, hell}` 且勋章不足，**不强制改回**，保留其已选难度（读值时只读、不写）；仅对「新点击选择」做门禁。这样既有玩家进度/存档零改动。
- 难度选择仍是全局持久设置（`selectedDifficulty`）；救济局「降难度」的 session 覆盖（A9）与本门禁**无关**、不受影响。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C1.1 | 存档 `medalCount < 6` | 在设置面板点击「困难」 | 不写入 `selectedDifficulty`，弹出提示「集齐 {6-n} 枚勋章解锁高难」+ 不改变当前选中档 |
| C1.2 | 存档 `medalCount >= 6` | 点击「困难/地狱」 | 正常写入并高亮选中（与现状一致） |
| C1.3 | 老存档 `selectedDifficulty = 'hard'` 且 `medalCount < 6` | 打开设置面板 | 面板显示 hard 为已选中（存量豁免，不自动改回 standard）；进入战斗按 hard 系数 |
| C1.4 | 休闲/标准档 | 任意勋章数下点击 | 始终可选（不受门禁影响） |
| C1.5 | 关卡选择面板勋章提示 | 渲染 | 与门禁同口径：`totalMedals >= 6` 显示「已解锁高难」，`< 6` 显示还差几枚（沿用既有词条/颜色） |

### 边界 / 排除
- 只做「选择时拦截 + 提示」，**不做**「已选高难玩家的战斗降级/惩罚」；存量豁免是硬性默认。
- 不新增存档字段；不改 `MEDALS.THRESHOLD` 数值语义（阈值调参只改 GameConfig 常量）。
- 门禁只作用于设置面板手动选择；救济局/活动模式自带的难度语义（如有）不受影响。
- 休闲/标准是新手保护区，永不拦截。

### 红线确认
- COMBO 块 / 成就 id / WingmanSystem / FloatingText 零触碰。
- SaveManager 零字段改动（读 `selectedDifficulty` 与派生 `medalCount`，均为只读）。

### reduced-motion / 性能档 / i18n
- 弹提示为静态面板文本，无动画 → reduced-motion N/A；性能档 N/A。
- i18n：新增 `diffLockedTitle`（高难未解锁）、`diffLockedNeed`（集齐 {n} 枚勋章解锁高难）、`diffLockedHint`（前往关卡面板查看勋章目标）等中英文案。

---

## 第 C2 条：昵称编辑器

### 用户故事
作为想有个人标识的玩家，我想要在设置里把默认昵称改成自己喜欢的名字，以便分享卡/结算页带上我的 ID，分享更有归属感。

### 语义要点（对齐现状）
- 现状：`SaveManager.nickname = ''`（默认空，展示层回退「飞行员·随机后缀」，见 SaveManager L86）；ResultScene 分享卡已显示昵称（buildShareCard/copyShareText 均读 nickname）。
- 本批目标：在设置面板新增「昵称」编辑入口：点击 → 文本输入（本地单机，无后端）；保存写入既有 `nickname`（**复用字段，不新增**）；校验长度与字符集；保存后结算页/分享卡立即生效。
- 默认昵称回退规则保持不变：`nickname === ''` → 显示「飞行员·随机后缀」；用户设置后显示自定义昵称。不做「清空回默认」按钮（最小成本；如需恢复默认由重置存档 C8 覆盖）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C2.1 | 设置面板点击昵称编辑 | 输入合法昵称「阿飞」并确认 | `SaveManager.nickname === '阿飞'` 且面板显示「阿飞」 |
| C2.2 | 输入长度 > 上限（建议 12 字符）或含非法字符 | 确认保存 | 拒绝保存并提示长度/字符限制，`nickname` 不变 |
| C2.3 | `nickname=''` | 结算页/分享卡生成 | 显示默认「飞行员·随机后缀」 |
| C2.4 | `nickname='阿飞'` | 结算页/分享卡生成 | 显示「阿飞」（与默认昵称区分，证明走用户值） |
| C2.5 | 切换语言 | 昵称编辑界面 | 界面文案双语（昵称本身不翻译，原样显示） |

### 边界 / 排除
- 纯本地单机：**不做敏感词过滤/后端校验/重名检测**。
- 不做头像/签名等扩展；昵称不参与任何玩法数值/排行榜排序键。
- 长度/字符规则：默认允许中文/字母/数字/下划线/短横线，1–12 字符（⚠️ 假设：如主理人有偏好字符集，仅改校验常量，不改框架）。

### 红线确认
- SaveManager 复用既有 `nickname`（append-only 字段语义不变）；零新增字段。
- COMBO / 成就 id / WingmanSystem / FloatingText 零触碰。

### reduced-motion / 性能档 / i18n
- 文本输入面板静态 → reduced-motion N/A；性能档 N/A。
- i18n：新增 `nicknameEdit`（编辑昵称）、`nicknamePlaceholder`、`nicknameLenErr`（昵称需 1–{n} 个字符）、`nicknameCharErr`（含不支持的字符）等中英文案。

---

## 第 C3 条：战后复盘（结算页详情补全）

### 用户故事
作为在意手感的弹幕玩家，我想要结算页看到本局更完整的复盘（擦弹/时长/受击/峰值连击等），以便复盘走位与成长、分享更有谈资。

### 语义要点（对齐现状）
- 现状：ResultScene 已显示 分数/击杀/金币/波次/爬塔层数/排行/勋章/新成就/连击峰值面板（L120-205）；GameScene 局内已累计 `stats.kills/coins/damageTaken`、`grazeCount`（L84）、`maxCombo`（L69）、`_levelStartTime`（结算耗时）等；结算 payload（L2616-2639）已透传 maxCombo，但**未透传** grazeCount/时长/受击。
- 本批目标：在既有结算页新增「本局详情」信息区（追加展示，不改现有行布局）：擦弹数、局时长（分:秒）、受击次数、连击峰值（已有面板则并入同区去重）、本局 Boss 击杀数（如已有统计）、每关勋章判定明细（若胜利）。
- 数据源：**局内 session 数据**，不持久化；结算 payload 追加只读字段即可（非存档字段）。
- 纯展示零业务：不做新数值、不发奖励、不影响任何判定。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C3.1 | 本局擦弹 37 次 | 结算页渲染 | 「擦弹」行显示 37（与 HUD 局内计数一致） |
| C3.2 | 本局耗时 95 秒 | 结算页渲染 | 「局时长」行显示 1:35 |
| C3.3 | 本局受击 3 次 | 结算页渲染 | 「受击」行显示 3 |
| C3.4 | 无尽模式通关结算 | 结算页渲染 | 详情区含无尽专属信息（波次/时长），普通关信息（勋章判定明细）不出现 |
| C3.5 | 语言为 en | 结算页渲染 | 详情区文案为英文 |

### 边界 / 排除
- 纯展示：不加新数值规则、不改结算/存档/排行/成就/勋章判定链路。
- 只读局内 stats；**不入存档**（复盘不需要跨局记忆；如需「历史最佳擦弹/时长」属新需求，另行评估）。
- 布局在既有结算页剩余空间内追加；若空间不足，采用「本局详情」可折叠/次级行，**不遮挡**分数主视觉与分享按钮。

### 红线确认
- COMBO 块 / 成就 id / WingmanSystem / FloatingText 零触碰（只加展示文本与 payload 只读字段）。
- SaveManager 零字段改动。

### reduced-motion / 性能档 / i18n
- 静态文本行 → reduced-motion N/A；性能档 N/A。
- i18n：新增 `resGrazes`（擦弹）、`resTime`（局时长）、`resHits`（受击）、`resBossKills`（Boss 击杀）等中英文案。

---

## 第 C4 条：存档导出 / 导入（备份与迁移）

### 用户故事
作为投入大量时间的玩家，我想要把自己的存档导出成文本/文件，并能在新设备或重置后导入回来，以便进度不丢、换设备可迁移。

### 语义要点（对齐现状）
- 现状：存档 = `localStorage[SAVE_KEY]`（GameConfig L554，'sky_raiders_save_v1'），SaveManager 注释要求「所有读写走这里，别在别处直接碰 localStorage」；OPT-16 T1/T2 已有 `SaveSanitizer.sanitizeSave/analyzeSave` 可做导入校验。
- 本批目标：
  - **导出**：把当前整档 JSON 包装为可分享文本 `{ app:'sky-raiders', version, exportedAt, save }`，提供「复制到剪贴板」与「下载 .json 文件」两条路径（复用 ResultScene 已有 clipboard/download 范式，纯本地）。
  - **导入**：粘贴/选文件 → 解析 → 先备份当前存档 → 经 `SaveSanitizer.sanitizeSave` 校验清洗 → 通过后整体覆盖；失败不破坏当前存档。
- 落点建议（供架构师参考，非实现方案）：**新建独立文件**（如 `SaveTransfer.js`，SaveSanitizer 先例），只调 SaveManager 既有公开 API（load/export 用 `load()` 读、import 用 `save()` 写），SaveManager.js 零触碰。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C4.1 | 点击「导出存档」 | 生成包装 JSON | 剪贴板/下载文件内容含当前 coins/upgrades/levelMedals 等全部字段与 `exportedAt` 时间戳 |
| C4.2 | 粘贴合法同版本存档并确认导入 | 导入校验通过 | 当前存档被该存档覆盖，重启后字段一致（QA 断言关键字段） |
| C4.3 | 粘贴格式非法（非 JSON / 结构损坏） | 导入 | 拒绝并提示「存档格式无效」，当前存档保持不变 |
| C4.4 | 粘贴可解析但字段脏（如 coins=-5） | 导入 | 经 sanitize 清洗后导入（coins 归 0 等），不整档拒绝 |
| C4.5 | 导入覆盖前 | 触发导入 | 先把当前存档完整保留为备份（临时），导入成功后再清理 |

### 边界 / 排除
- 纯本地工具：**零网络/云端**；不做自动云同步/多端漫游。
- 导出文本不含明文密码类内容（本地单机本就无账号）。
- 导入**不改字段语义**：非法/越界走 Sanitizer 既有规则（复用 T1/T2，不新增规则）。
- 跨版本导入：旧版存档缺新字段 → SaveManager 既有 deep-merge 兜底补默认；新版存档导到旧版（含未知字段）→ 保留未知字段不报错（⚠️ 假设：若主理人要求严格版本门槛，再加版本比对提示，不阻塞本批）。

### 红线确认
- SaveManager 旧字段语义零改动；独立文件实现，SaveManager.js 建议 diff 为空（允许走公开 API）。
- COMBO / 成就 id / WingmanSystem / FloatingText 零触碰。

### reduced-motion / 性能档 / i18n
- 静态文本/文件操作 → reduced-motion N/A；性能档 N/A。
- i18n：新增 `saveExport`（导出存档）、`saveImport`（导入存档）、`saveExportOk`、`saveImportOk`、`saveImportFail`（存档格式无效）、`saveImportConfirm`（导入将覆盖当前进度，是否继续？）等中英文案。

---

## 第 C5 条：每日种子挑战

### 用户故事
作为想跟「全世界同一天同一张图」比拼的玩家，我想要每天一个固定种子的挑战关，以便跟朋友/同好同题竞技、每日有固定打卡目标。

### 语义要点（对齐现状）
- 现状：SaveManager 已有确定性日期种子工具 `_dailySeed(str)`（L462-469），每日任务用它保证「同一天全平台抽到同一组任务」（L472-483）——本挑战复用同一套种子方案即可（零新概念）。
- 本批目标：菜单新增「今日挑战」入口 → 进入一局**固定种子**的挑战（建议：固定关卡 + 固定波次种子，难度取当前所选难度档或固定标准档——⚠️ 假设：默认固定 `standard`，同一天所有人同难度更公平，可后续调参）；本局播报「今日种子 #xxx」；结算只记「当日最佳分/是否达成目标」，不污染 topScores/levelMedals/league/成就/每日任务（防刷）。
- 奖励：达成当日目标（如「通关/达到 N 分」）领一次金币（每日 1 次，跨天重置）。
- 存档：新增 append-only `dailyChallenge = { date:'', bestScore:0, cleared:false }`（date 用既有 YYYY-MM-DD 口径，跨天自动重置）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C5.1 | 当天首次进入「今日挑战」 | 挑战局开始 | 生成与当天日期种子一致的波次（同一天两次进入布局一致）；显示今日种子编号 |
| C5.2 | 挑战局结束 | 结算 | 只更新 `dailyChallenge.bestScore`（更高才覆盖）；topScores/levelMedals/league/成就/每日任务/新手计划均无本局记录 |
| C5.3 | 达成当日目标且当日未领 | 结算 | `cleared=true` 并发放 1 次金币奖励；同日再次达成不重复发放 |
| C5.4 | 跨天后再进「今日挑战」 | 进入 | `date` 变化，bestScore/cleared 重置为当日空态，种子随新日期变化 |
| C5.5 | 挑战局中途退出/失败 | 结束 | 不写入任何排行榜/勋章/成就；bestScore 只按完成分更新 |

### 边界 / 排除
- 挑战局是「独立结算域」：与救济局不计入清单同构（topScores/levelMedals/levelStars/league/bestScore/每日任务/新手计划均不计），金币照常入账（打得不算白打）。
- 不新增成就 id（每日挑战不给成就，避免 26 成就 id 之外的新增）。
- 种子只在局内有效，**不入存档**；只存每日结果。
- 入口在菜单新增（放每日任务/活动区附近），但菜单已较满（10+ 按钮）→ ⚠️ 假设：建议合并进「活动/事件」入口的页签或每日任务面板内，避免再加裸按钮；若主理人要求独立入口，需同时评估菜单布局（可由 V6 主菜单精简批协同）。

### 红线确认
- 成就 id 零改动；SaveManager 仅 append-only 新增 `dailyChallenge`。
- 挑战局不计入既有结算链路（复用救济局「不计入」门控思路，附加式抑制，不修改既有写盘路径）。

### reduced-motion / 性能档 / i18n
- 入口/横幅静态 → reduced-motion N/A；性能档 N/A（同 normal 波次渲染，不新增粒子）。
- i18n：新增 `dailyChallenge`（今日挑战）、`dailySeedLabel`（今日种子 #）、`dailyChallengeGoal`、`dailyChallengeReward`、`dailyChallengeDone`（今日已领取）等中英文案。

---

## 第 C6 条：暂停面板「重开本局」

### 用户故事
作为想快速重试的玩家，我想要在暂停面板直接「重开本局」，以便开局不顺时不用退到菜单再层层点入，减少挫败与操作成本。

### 语义要点（对齐现状）
- 现状：暂停面板只有「继续 / 退出 / 判定点开关」（UIScene L211-225），没有重开；Quit 回菜单后再手动进关是唯一路径。
- 本批目标：暂停面板新增「重开本局」按钮（放在「继续」下方或旁侧）：
  - 点击 → 二次确认（重开将放弃本局进度）→ 以**与本局相同的参数**重进 GameScene：levelId / mode（normal/endless/tower/bossrush/event）/ 难度（含 A9 救济 session 覆盖若有）/ 机体与皮肤。
  - 重开是**主动放弃**，不累计 `failStreak`、不触发救济提示（等同「Quit 后手动 Start」，但一次点击完成）。
  - 重开不写任何结算/排行/成就；金币等本局已收集不保留（等同放弃）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C6.1 | 暂停面板 | 点击「重开本局」 | 弹出确认（含「本局进度将丢失」提示） |
| C6.2 | 确认重开 | 本局为 normal 第 2 关 standard 难度 | 以 levelId=2/mode=normal/standard 重进第 2 关开局，命/火力/能量等回初始 |
| C6.3 | 确认重开 | 本局为 endless/tower/bossrush/event | 以同 mode 同参数重开（无尽重开从第 1 波/对应模式起点开始，与 Quit 后 Start 等价） |
| C6.4 | 本局为 A9 救济局（session 覆盖休闲难度） | 重开 | 救济局标记保留（仍不计入 topScores 等，防利用重开刷掉救济口径） |
| C6.5 | 取消重开 | 点击「取消」 | 返回暂停面板，本局继续，无任何状态改变 |

### 边界 / 排除
- 不改变既有「继续 / 退出」行为；退出仍回菜单。
- 重开不累计 failStreak、不触发救济提示（主动放弃与「死亡失败」是不同语义）。
- 不做「回到上一波/检查点」类软重开（超出本批）。
- ⚠️ 假设/开放问题：A9 救济局重开是否保留 `reliefRun`（本规格默认**保留**，理由见 C6.4）；最终口径由主理人/架构师确认，不影响其余验收。

### 红线确认
- COMBO / 成就 id / WingmanSystem / FloatingText 零触碰。
- SaveManager 零字段改动（重开为局内操作；session 参数在场景切换时透传，不落盘）。

### reduced-motion / 性能档 / i18n
- 静态按钮/确认面板 → reduced-motion N/A；性能档 N/A。
- i18n：新增 `uiRestart`（重开本局）、`restartConfirmTitle`、`restartConfirmDesc`（本局进度将丢失，确定重开？）、`restartCancel` 等中英文案。

---

## 第 C7 条：移动端震动反馈

### 用户故事
作为移动端玩家，我想要命中/受击/Boss 演出时有轻震动反馈，以便即使不看屏幕也能感受到击打节奏；同时能一键关闭。

### 语义要点（对齐现状）
- 现状：无任何 `navigator.vibrate` 调用（grep 全仓无震动）；音频反馈已有。
- 本批目标（仅支持震动平台生效）：
  - 事件 → 震动映射（建议，数值可调）：受击（中）、敌机/Boss 被击破（中短）、炸弹/过载清屏（短+中）、波次/Boss 阶段演出（短）、擦弹（极短可选）。
  - 设置面板新增「震动」开关（默认随平台：移动端开/桌面端关——桌面无 vibrate 时开关隐藏或置灰）；持久化到 SaveManager。
  - 尊重系统偏好：检测 `navigator.vibrate` 存在才调用；调用异常静默捕获（不 crash）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C7.1 | 平台支持 `navigator.vibrate` 且开关开 | 玩家受击 | 触发对应震动（可断言调用了 vibrate，参数与映射表一致） |
| C7.2 | 平台支持且开关开 | Boss 被击破 | 触发 Boss 击破震动模式 |
| C7.3 | 设置面板关闭震动 | 之后任何受击/击破 | 不再调用 vibrate |
| C7.4 | 平台不支持 vibrate | 打开设置 | 震动开关不显示或置灰，不报错 |
| C7.5 | `SaveManager.haptics` 缺省（老存档） | 加载 | 默认按平台（移动端 true），零报错 |

### 边界 / 排除
- 震动是**触觉反馈**，不参与任何判定/数值/流程；关闭后完全无感。
- 不做强度分档（最小成本；如需强度滑杆后续追加，属 append-only 配置）。
- 桌面浏览器/无权限环境静默降级（零回归）。

### 红线确认
- COMBO / 成就 id / WingmanSystem / FloatingText 零触碰。
- SaveManager 仅 append-only 新增 `haptics`（默认 true；语义 = 开关，不承载其他含义）。

### reduced-motion / 性能档 / i18n
- 震动与视觉 reduced-motion 解耦（可保留震动）；若主理人希望「减少动效同时减少震动」，可让 reduced-motion 关闭震动——⚠️ 假设默认不联动（避免把触觉当视觉），可后续调。
- 性能档 N/A（非渲染）。
- i18n：新增 `haptics`（震动反馈）、`hapticsOn/Off` 等中英文案。

---

## 第 C8 条：存档清除（重置进度）

### 用户故事
作为想重开/想清理测试档的玩家，我想要一键重置存档，以便从零开始；同时有强确认与导出提示，避免误清。

### 语义要点（对齐现状）
- 现状：无用户主动清除入口；SaveManager 只有损坏兜底 freshSave（非用户可见操作）。
- 本批目标：设置面板新增「重置进度」入口（放面板底部，低风险区）：
  - 点击 → **强二次确认**（输入/长按确认或二次弹窗，防误触）→ 提示「建议先导出备份（C4）」→ 确认后清除进度类字段，回到新档。
  - 重置范围默认：进度/收藏类字段（coins/bestScore/upgrades/levelStars/unlockedLevel/totalKills/achievements/achievementStats/bossesDefeated/checkinStreak/levelMedals/newbiePlan/modules/moduleInv/skins/ownedSkins/league/towerTop/dailyActs/returnGift/topScores/failStreak/reliefRuns/codex/codexDecor/nickname/lastScore/prevScore/dailyQuest/dailyChallenge）归默认；**保留** 设置/手感类（lang/quality/sensitivity/touchOffset/showHitbox/haptics）与 noAds（如已购纯净）。
  - ⚠️ 假设：默认「保留设置、清进度」；若主理人要「连设置一起全清」，只是重置子集不同，框架不变。
- 落点建议：独立文件（SaveTransfer.js 同文件或 `SaveReset`），调 SaveManager 公开 API 写入默认子集；SaveManager.js 不建议直接改。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C8.1 | 设置面板点击「重置进度」 | 触发 | 弹出强确认（含「此操作不可撤销，建议先导出」文案） |
| C8.2 | 未完成强确认（取消） | 取消 | 存档不变，无任何字段被清 |
| C8.3 | 完成强确认 | 重置 | 进度/收藏字段回默认（coins=0/unlockedLevel=1/levelMedals={} 等），lang/quality/sensitivity/touchOffset/showHitbox/haptics 保留 |
| C8.4 | 重置完成 | 回菜单 | 保存信息显示新档（0 金币/第 1 关），分享卡昵称回默认 |
| C8.5 | 重置后再进游戏 | 首次战斗 | 等效全新档（新手引导 tutorialDone=false 若被清——⚠️ 假设默认保留 tutorialDone=false 语义：清进度后应重新可看教程） |

### 边界 / 排除
- 重置是**用户主动、强确认**操作，与 T2 损坏自愈（freshSave）互不影响。
- 不新增存档字段；清的是既有字段的「值」，不改字段语义/类型。
- 不做云删除/账号注销（本地单机无账号）。
- 强确认交互不做成「输入 DELETE」这种高成本形式，二次弹窗 + 延时即可（⚠️ 假设）。

### 红线确认
- SaveManager 旧字段语义零改动（重置 = 写回默认值，非改 schema）；独立文件实现建议。
- COMBO / 成就 id / WingmanSystem / FloatingText 零触碰。

### reduced-motion / 性能档 / i18n
- 静态弹窗 → reduced-motion N/A；性能档 N/A。
- i18n：新增 `resetProgress`（重置进度）、`resetConfirmTitle`、`resetConfirmDesc`（将清除全部进度与收藏，保留设置；不可撤销）、`resetExportTip`（建议先导出备份）、`resetDone` 等中英文案。

---

## 第 C9 条：主菜单轮换战术提示

### 用户故事
作为新玩家/回流玩家，我想要主菜单随机看到一条战术小贴士（擦弹回能、连击蓄力、元素克制等），以便潜移默化学会进阶技巧、降低学习门槛。

### 语义要点（对齐现状）
- 现状：主菜单底部只有操作提示 controlsHint（MenuScene L191-194）与版本号；无战术 tips。
- 本批目标：主菜单标题下方/底部新增一条**轮换战术提示**（每次进菜单随机/顺序取一条，短文案，可点「下一条」手动换）：新手期（`tutorialDone=false`）显示基础操作/生存类 tips；进阶期（`tutorialDone=true`）显示擦弹回能/连击蓄力/元素克制/磁力等进阶 tips。
- 纯展示零业务：不加奖励/不加状态/不影响流程。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C9.1 | 新档（tutorialDone=false）进主菜单 | 渲染 | 显示基础类 tip（如「长按减速可精细走位」），文案来自基础 tips 池 |
| C9.2 | 老档（tutorialDone=true）进主菜单 | 渲染 | 显示进阶类 tip（如「擦弹可为能量充能」），文案来自进阶 tips 池 |
| C9.3 | 每次回主菜单 | 渲染 | tip 与上次不同（随机不重复相邻）或可点击切换 |
| C9.4 | 语言为 en | 渲染 | tip 为英文 |
| C9.5 | 提示文案为空池/词条缺失 | 渲染 | 静默不显示该行，不报错、不影响其它 UI |

### 边界 / 排除
- 纯展示：不做「看完送金币」等激励（如需可后置，超出本批）。
- 不改 controlsHint 与版本号布局；tips 行在既有空隙处追加，不遮挡按钮。
- tips 池为 GameConfig append-only 配置（数组 + 分类），**不改既有配置键**。

### 红线确认
- COMBO / 成就 id / WingmanSystem / FloatingText 零触碰（FloatingText 若用于提示入场动画需为附加式）。
- SaveManager 零字段改动（读 tutorialDone 只读）。

### reduced-motion / 性能档 / i18n
- 提示入场淡入动画 reduced-motion 下为静态文本；性能档 N/A。
- i18n：新增 `tip_*`（约 8–10 条基础 + 8–10 条进阶，zh/en 双语，见附录 B 示例）。

---

## 第 C10 条：Boss 第四阶段（高难专属强化终局）

### 用户故事
作为高难玩家，我想要地狱/高难 Boss 有更长的第四阶段演出与更复杂弹幕，以便终局更有压迫感与成就峰值。

### 语义要点（对齐现状 + 风险提示）
- 现状：Boss 阶段机为 3 阶段（phase 1/2/3，0.66/0.33 血量档，Boss.js `this.phase`）+ A7 狂暴终局（`RAGE`，hp < maxHp×15%，Boss.js L290-330 已实现，含 DPS 窗口/破绽/回血）。**狂暴已经是「低血量终局」**——直接再加第 4 阶段会与狂暴在时间轴上冲突，属**高风险战斗内容**。
- PM 建议（供拍板）：**不建议原样做「第 4 阶段」**，理由：
  1. 现有 Boss 已经是 3 阶段 + 狂暴两套节奏，再加阶段会显著拉长 Boss 战且可能与狂暴判定重叠；
  2. 触碰 Boss.js 阶段机风险高（红线：不能破坏既有 0.66/0.33 与狂暴链路）。
  - **改型建议**（若仍要「更长 Boss 体验」）：
    - 方案 A（推荐，低风险）：**高难专属 Boss 形态增强**——仅 `hell` 档（或 hard+hell）在 phase 3 血量档内新增 1–2 个**附加弹幕 pattern**（追加到既有 pattern 表，不改阶段机/不改血量阈值），视觉上 Boss 在 phase 3 换色/换形态（复用既有 _syncPhaseVisuals 加一档），狂暴逻辑不动；
    - 方案 B（中风险，内容量大）：新增**独立 Boss 实体**（新 id/新纹理/专属 3 阶段），放在新关卡或 Boss Rush 扩展，作为「第 4 个 Boss」而非「第 4 阶段」。
- 若主理人仍拍板「第 4 阶段」：边界必须是 **append-only 叠加在既有 phase 3 之上**，不改 0.66/0.33 与 RAGE 触发线；只在 hell 档出现；狂暴仍只在 <15% 触发（第 4 阶段不得吞掉狂暴演出）。

### 验收标准（G/W/T，按推荐改型方案 A 写；若拍板原案请按上方边界重写）
| # | Given | When | Then |
|---|---|---|---|
| C10.1 | selectedDifficulty = hell 且 Boss 进入 phase 3 | Boss 血量 ≤ 0.33 档 | Boss 视觉形态增强（换色/换态），可释放新增高难 pattern |
| C10.2 | selectedDifficulty ∈ {casual, standard, hard} | Boss 战 | 不出现高难专属 pattern（hard 是否启用由配置决定，默认仅 hell） |
| C10.3 | 高难 pattern 生效中 | 任意时刻 | 弹幕仍有安全缝隙/可应对性（沿用狂暴同款「禁止无解」硬性设计红线） |
| C10.4 | Boss 血量 < maxHp×15% | 触发狂暴 | 狂暴链路原样执行（A7 行为不变），高难 pattern 让位于狂暴专属弹幕 |
| C10.5 | 高难 Boss 被击杀 | 死亡结算 | 走正常 BOSS_DEFEATED 链路（成就/掉落/爬塔层数各只记一次，不双触发） |

### 边界 / 排除
- 不改 0.66/0.33 阶段机、不改 RAGE 配置/触发语义（A7 已拍板项零回归）。
- 不改既有 Boss 纹理/HP/掉落（若走方案 B 新 Boss，则全部为新对象，不影响既有 4 Boss 与成就 boss_all 判定）。
- 不新增成就/图鉴条目（Boss 击杀仍走既有 boss_* 链路）。

### 红线确认
- 成就 id 零改动；Boss 阶段机 0.66/0.33 与 RAGE 链路零改动（只允许「追加 pattern / 追加新 Boss」）。
- SaveManager 零字段改动；COMBO / WingmanSystem / FloatingText 零触碰。
- ⚠️ 风险标注：本条为 11 条中**最高风险**，实现前需架构师评审（尤其与 A7 狂暴共存性）；QA 需专项断言狂暴在高难 pattern 下仍正常触发。

### reduced-motion / 性能档 / i18n
- 形态切换演出 reduced-motion 下为静态换色/换态；性能档 low 下高难 pattern 弹幕密度减半（沿用狂暴同款降级纪律）。
- i18n：若新增高难 pattern 名称/提示，需新增中英文案（如 `bossHardPhase` 形态名）。

---

## 第 C11 条：新增第 4 架战机（内容新增）

### 用户故事
作为老玩家，我想要机库多一架玩法不同的新战机（新被动组合），以便三架玩腻后仍有新鲜选择、增加长期内容。

### 语义要点（对齐现状）
- 现状：SHIPS 现有 3 架（苍鹰/赤焰/寒霜，GameConfig L578-585），每架绑定 默认武器+元素+被动；皮肤 3 款/架（SHIP_SKINS L593-609）；机库选择 `selectedShip`（索引）；`selectedShip` 默认可在 3 架间自由切换（无购买门槛，SKIN_PRICE 只用于皮肤）。
- 本批目标（MVP，低风险）：新增第 4 架战机（shipId=3），**复用现有武器与元素**，配一个**新被动**（沿用 passive 结构，如「磁力范围 +40%」或「擦弹回能 +50%」——具体数值待主理人/平衡确认，仅作为配置常量）；新增 3 款皮肤（TextureFactory 程序化纹理，沿用 shipSkinKey 命名）。
- 存量兼容默认：新战机默认**免费可选**（与既有 3 架一致），**不改既有 3 架任何字段/被动/皮肤**；存量玩家零感知（只是多一架）。
- ⚠️ 假设/开放问题：若主理人希望新机作「解锁内容」（金币/勋章购买），需新增 append-only `ownedShips` 且需同时定义存量玩家默认（建议：存量默认已解锁，新档走解锁），本批 MVP 按免费可选，不阻塞。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| C11.1 | 机库加载 | 渲染 | 出现第 4 架战机（名称/简介/默认武器/元素/被动展示正确），既有 3 架展示不变 |
| C11.2 | 选择第 4 架战机 | 开局 | 本局装备其默认武器与元素，被动生效（数值与配置一致） |
| C11.3 | 第 4 架战机选择皮肤 | 机库购买/装备 | 3 款皮肤可购/可换（沿用 SKIN_PRICE 与 ownedSkins 链路），纹理正常生成 |
| C11.4 | 存档 selectedShip 已为 3 | 进战斗/结算 | 正常运行（立绘/分享卡显示第 4 架），不因新索引越界报错 |
| C11.5 | 老存档（selectedShip=0/1/2） | 升级后首次进游戏 | 选中机体不变，无任何报错/回退 |

### 边界 / 排除
- 只新增 1 架机 + 3 款皮肤；**不新增武器类型**（新武器需改 Player 射击链路，风险高，另行评估）。
- 不改既有 3 架 SHIPS 条目/皮肤/纹理；`player` 基础纹理不动（皮肤用 `player_skin_3_*` 独立 key）。
- 机库 UI 需支持第 4 架展示（三架→四架布局，若当前布局为等分 3 卡需评估容量；⚠️ 假设：HangarScene 需支持 4 个槽位，若空间不足可用翻页/横向滚动，属实现适配，验收以「4 架均可选可预览」为准）。
- 数值（新被动/血量成长曲线）为配置常量，真测后由主理人调参，不改框架。

### 红线确认
- 成就 id 零改动（新机不新增成就/图鉴条目）；WingmanSystem 零触碰（新机被动若与僚机相关需在既有通道上配置，不改 WingmanSystem）。
- SaveManager 零字段改动（MVP 免费可选，`selectedShip=3` 用既有 int 字段即可；皮肤走既有 ownedSkins/skins）。

### reduced-motion / 性能档 / i18n
- 机库预览/入场特效 reduced-motion 下静态；性能档 N/A（程序化纹理一次性生成）。
- i18n：新增 `shipName_3`、`shipDesc_3`、被动名/描述、`skinName_3_x`（3 款皮肤）中英文案。

---

## 附录 A：新增存档字段汇总（全部 append-only，语义零改动）

| 字段 | 类型/默认 | 所属条目 | 说明 |
|---|---|---|---|
| `dailyChallenge` | `{ date:'', bestScore:0, cleared:false }` | C5 | 每日种子挑战当日最佳分/是否已领（跨天按 date 重置） |
| `haptics` | `true` | C7 | 震动开关（老存档缺省回退 true；平台不支持时仅隐藏 UI，不读错） |

> 其余 9 条（C1/C2/C3/C4/C6/C8/C9/C10/C11）**零存档改动**：
> - C1：只读 `selectedDifficulty` + 派生 `medalCount`；C2：复用既有 `nickname`（'' = 默认，非空 = 用户昵称）；C3：结算 payload 只读字段（非存档）；C4/C8：整档读写/重置，独立文件；C6：局内重进；C9：只读 `tutorialDone`；C10：局内/config 追加；C11：复用既有 `selectedShip`/`skins`/`ownedSkins`。
> - 若主理人把 C11 改为「购买解锁」，需追加 `ownedShips`（append-only，存量默认已解锁）——本规格 MVP 不依赖。

---

## 附录 B：新增 i18n 词表示例（zh/en，开发落地补入 Locale.js，全部 append-only）

- C1：`diffLockedTitle / diffLockedNeed / diffLockedHint`。
- C2：`nicknameEdit / nicknamePlaceholder / nicknameLenErr / nicknameCharErr`。
- C3：`resGrazes / resTime / resHits / resBossKills`。
- C4：`saveExport / saveImport / saveExportOk / saveImportOk / saveImportFail / saveImportConfirm`。
- C5：`dailyChallenge / dailySeedLabel / dailyChallengeGoal / dailyChallengeReward / dailyChallengeDone`。
- C6：`uiRestart / restartConfirmTitle / restartConfirmDesc / restartCancel`。
- C7：`haptics / hapticsOn / hapticsOff`。
- C8：`resetProgress / resetConfirmTitle / resetConfirmDesc / resetExportTip / resetDone`。
- C9：`tip_*`（基础 8–10 条：移动/射击/减速/炸弹/护盾拾取…；进阶 8–10 条：擦弹回能/连击蓄力/元素克制/磁力/爬塔 3 选 1…）。
- C10：`bossHardPhase_*`（若高难形态有独立命名）。
- C11：`shipName_3 / shipDesc_3 / passiveName_3 / passiveDesc_3 / skinName_3_0..2`。

---

## 附录 C：风险与开放问题（PM 标注，需主理人/架构师确认）

1. **C1 门禁口径**：存量豁免是默认（已选 hard/hell 的勋章不足玩家不强制改回）。若主理人要求「新档才可豁免/老档也拦截」，需加一次性迁移标记（会新增存档字段），默认不采用。
2. **C5 挑战难度档**：默认固定 `standard` 更公平；若要与玩家所选难度联动，挑战「同一天同图」就不成立（不同人难度不同），需主理人拍板。
3. **C6 救济局重开**：默认保留 `reliefRun` 标记（防利用重开刷掉不计入口径）；需架构师确认 A9 救济标记在场景重进时的传递方式。
4. **C7 reduced-motion 联动**：默认震动与视觉 reduced-motion 解耦；如需联动（减少动效时也关震动）可追加配置，不阻塞。
5. **C8 重置范围**：默认「保留设置/手感类字段、清进度/收藏类」；全清为备选子集。
6. **C10 第 4 阶段**：PM 建议改型（高难专属 pattern 或新 Boss），不建议直接加第 4 阶段（与 A7 狂暴时间轴冲突）；若拍板原案，需架构师评审共存性 + QA 专项断言狂暴仍正常。
7. **C11 机库布局**：第 4 架需机库 UI 支持 4 槽位（翻页/横向滚动适配）；新机默认免费可选，若改为解锁需追加 `ownedShips`。
8. 红线复核：任何实现 PR 需 grep 断言 `WINGMAN.COMBO` 未改、成就 id 集合未变、`WingmanSystem.js` / `FloatingText.js` / `SaveManager.js` 旧字段写入点未变（SaveManager.js 若被独立文件方案触碰，只允许 append-only 公开方法）。

---

## 附录 D：红线确认清单（开发 / QA 对照检查）

| # | 红线项 | 要求 | C1–C11 结论 |
|---|---|---|---|
| R1 | `WINGMAN.COMBO` 五字段 | **零触碰** | ✅ 全绿（11 条均不读写） |
| R2 | 26 个成就 id 及 condition/progress | **零改动** | ✅ 全绿（C5 不加成就；C10/C11 不新增成就来源） |
| R3 | `WingmanSystem` | **零触碰** | ✅ 全绿 |
| R4 | `FloatingText`（damageNumber） | 只允许附加式新增 | ✅ 全绿（C3/C9 提示类为新增展示，不改既有） |
| R5 | `SaveManager` 旧字段语义 | **全部保留**；仅 append-only 新增 dailyChallenge/haptics | ✅ 全绿（C2 复用 nickname；C4/C8 独立文件） |
| R6 | 外部资源 / 网络 / 后端 | **零新增**（纯本地） | ✅ 全绿（C7 仅 navigator.vibrate） |
| R7 | 既有系统零回归（难度/元素/擦弹/勋章/救济/狂暴等已拍板项） | **默认不改变既有玩家进度 / 存档兼容** | ✅ 全绿（C1 存量豁免；C5/C6 独立结算域/局内操作；C10/C11 只追加不改既有） |

> 检查方式：实现阶段由架构师/开发在 PR 自检，QA 验收时按 R1~R7 逐项回归（尤其 R1/R2/R5 需 grep 断言：`WINGMAN.COMBO` 未改、成就 id 集合未变、SaveManager 旧字段写入点未变；C1 存量豁免、C10 狂暴共存性需专项断言）。
