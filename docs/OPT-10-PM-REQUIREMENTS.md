# 苍穹战机 · 产品向 10 条优化需求规格（开发 / QA 引用版）

> 作者：许清楚（product-manager / pm-req）｜日期：2026-08-30
> 状态：**已拍板定稿**（A+B 全做，10 条）
> 范围：本文只定义「做什么 / 怎么算做对」，不写实现细节（落点标注供架构师参考，非实现方案）。
> 代码基线：HEAD = 22ee56e（P2 视觉四件套 QA 全绿）。存档基线：SaveManager 现有字段全部保留，只可 append-only 新增。
> 引用说明：worker 以本文件为唯一规格来源；正文完整、无「见其他文档」引用。

---

## 〇、本次拍板结论（开发 / QA 必须遵守）

| # | 决策项 | 拍板结论 |
|---|---|---|
| ① | 救济局数据口径（第 4 条） | 救济局 = **不计** `topScores / levelMedals / levelStars / league / bestScore / 每日任务 / 新手计划`；**仅** `failStreak / reliefRuns` 计数；金币照常入账。与 A9 语义统一，防救济局刷榜刷任务。 |
| ② | 无尽变异间隔（第 7 条） | 按需求原文**每 5 层**执行，用配置常量表达 `MUTATION_EVERY_LAYERS: 5`；真测后如需调整**只改常量、不改框架**。 |
| ③ | 分享卡昵称（第 3 条） | 本批先做**「默认昵称 + 随机后缀」**（如 飞行员·42），分享卡显示昵称；昵称编辑文本框**后置 P2**（不阻塞本批交付）。 |

---

## 一、红线总览（10 条逐一确认）

| 红线项 | 结论 |
|---|---|
| `WINGMAN.COMBO` 五字段（WINDOW_MS/TRIGGER/BUFF_MS/DMG_MUL/MAX_COUNT） | **零触碰**。10 条均不读写该块。第 6 条「连击蓄力」用的是 `GameScene.registerKill` 的击杀 combo（`this.combo`），与僚机元素协同 combo（WINGMAN.COMBO / WINGMAN_COMBO 事件）**完全无关**，二者是两套系统。 |
| 26 个成就 id（含 combo_15 / combo_30 / comboPeak 链路） | **零改动 id**。第 4 条救济局需要「不记成就」，采用**附加式抑制开关**（AchievementManager 新增 relief 标记，使本次 run 的 `_checkLive/_checkAll` 不解锁），不改任何 id 与 condition。第 6 条消耗连击只动「当前连击」，**峰值 maxCombo/comboPeak 只增不减**，combo_15/combo_30 判定不受影响。 |
| `WingmanSystem` | 零触碰。第 8 条免疫逻辑落在 `Enemy.hit/applyReaction` + `ElementReaction` 的伤害门控，不碰僚机系统。 |
| `FloatingText`（damageNumber 等） | 只新增浮字/横幅（附加式），不改既有 `damageNumber` 行为。 |
| `SaveManager` 旧字段 | 全部保留；新增字段仅：`nickname`（第 3 条）、`failStreak` + `reliefRuns`（第 4 条）、`codex` + `codexDecor`（第 5 条）。其余 6 条**零存档改动**。 |
| 四档难度 / 元素核心 / 擦弹 / 过载 / 爬塔 / 周赛 / BossRush 既有机制 | 全部保留；新增内容均以「同难度/同数值」或「仅新档位」方式叠加，标准档行为逐字段等价（零回归）。 |

---

## 第 1 条：主线关卡波次变体随机化

### 用户故事
作为反复刷关的玩家，我想要每次进同一关时波次敌人组合有变化，以便重复刷关不再千篇一律、保持新鲜感。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 1.1 | 关卡配置含 `waveVariants`（每关 2~3 套同难度变体波次表，纯数据，追加在 `LEVELS[i]`） | 玩家进入该关，局开始 | 系统按局随机锁定 1 套变体，本局所有波次均用该套表（同局内不换表） |
| 1.2 | 连续两次重开同一关 | 对比两次的波次敌人组合 | 至少 40% 概率（抽到不同变体时）两次组合不同；两套变体均为同难度系数（difficulty 不变、敌人血量/速度/弹速系数不变） |
| 1.3 | 第 N 波使用变体表 | 波次生成 | 敌人数与敌人组合（count/comp）与所选变体的第 N 项一致（沿用 WaveSystem 既有权重抽取，仅替换数据来源） |
| 1.4 | 某关没有 `waveVariants`（旧配置/兜底） | 进关 | 回退到既有 `wavePlan`，行为与现状逐帧等价（零回归） |
| 1.5 | 无尽 / 爬塔 / BossRush / 活动模式 | 进局 | 不受影响（无尽本就程序化随机；BossRush 无波次） |

### 边界 / 排除
- 只换「波次敌人组合」，**不**改 Boss 配置、关卡主题、难度系数、波次数目（waves 字段不变）。
- 变体表结构 = 与 `wavePlan` 同构的数组（`[{count, comp:[...]}]`），可复用 WaveSystem 全部既有逻辑。
- 不做局内动态换表、不做玩家可选的波次表、不做跨局记忆（随机即可，不入存档）。

### 红线确认
- 零触碰 COMBO 块 / 26 成就 id / WingmanSystem / FloatingText / SaveManager（纯局内随机，无需持久化）。
- 数据驱动：只加 `LEVELS[i].waveVariants`，不改既有 `wavePlan` 键语义。

### reduced-motion / 性能档 / i18n
- 无新 UI、无动效、无新增文案 → 三项均 N/A（若后续加「本局使用第 N 套波次表」调试显示，才需 i18n）。

---

## 第 2 条：称号系统

### 用户故事
作为有积累的高玩，我想要基于历史战绩自动派生专属称号，并在结算页与分享卡展示，以便向朋友炫耀长期投入。

### 判定数据来源（只读，不写）
全部取自**既有持久化字段**（不新增存档字段）：
`achievements`（26 个 id）、`levelMedals`/`medalCount`、`towerTop`、`league`（周赛 rank/score）、`totalKills`、`levelStars`、`bossesDefeated`、`newbiePlan.progress.grazes`（累计擦弹，已是持久化进度字段）。

### 称号表（示例 8 个，含解锁条件；按稀有度升序）

| 称号 id | 名称（zh / en） | 解锁条件（全部为既有字段派生） | 稀有度 |
|---|---|---|---|
| rookie | 苍穹新兵 / Sky Rookie | 通关任意 1 关（levelStars 非空） | common |
| veteran | 百战老兵 / Veteran | `totalKills >= 500` 或成就 kill_500 | rare |
| grazer | 擦弹大师 / Graze Master | `newbiePlan.progress.grazes >= 300` | rare |
| climber | 深空攀登者 / Tower Climber | `towerTop >= 10` | rare |
| slayer | 屠龙者 / Dragon Slayer | 成就 boss_all（3 Boss 各 1 次） | epic |
| maniac | 连击狂人 / Combo Maniac | 成就 combo_30 | epic |
| perfectionist | 完美主义者 / Perfectionist | 成就 three_star | epic |
| skyOverlord | 苍穹霸主 / Sky Overlord（**最高阶**） | `achievements.all_clear` + `medalCount >= 6` + `towerTop >= 10` 三者同时满足 | legendary |

### 展示规则
- 「当前称号」= 按稀有度（legendary > epic > rare > common）取最高已解锁称号；同稀有度按上表顺序取前者。纯派生，**不做手动装备**（v1 最小成本）。
- 展示位置：ResultScene 结算页（标题下方/连击峰值面板旁一行）+ 分享卡（第 3 条）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 2.1 | 存档满足 skyOverlord 三项条件 | 结算页加载 | 显示「苍穹霸主 / Sky Overlord」称号 |
| 2.2 | 存档仅满足 combo_30 | 结算页加载 | 显示「连击狂人 / Combo Maniac」（不因更高阶未达成而空白） |
| 2.3 | 存档为全新账号（无任何达成） | 结算页加载 | 不显示称号或显示「苍穹新兵」（取决于是否通关过一关），不报错 |
| 2.4 | 结算页展示称号 | 分享卡生成 | 卡片上包含同一称号文本 |
| 2.5 | 语言为 en | 结算页/分享卡展示称号 | 使用英文称号名 |

### 边界 / 排除
- 纯展示：不解锁新机制、不发放奖励、不改任何数值/判定。
- 不做手动装备/更换（v1）；称号等级不参与战力计算（calcPower 不动）。
- 不新增存档字段（称号全部由既有字段派生，读时计算、自愈）。

### 红线确认
- 只读成就/勋章/爬塔/周赛/击杀/擦弹字段，**零写入**；零触碰 COMBO 块 / 成就 id / WingmanSystem / FloatingText。
- 不依赖未持久化的局内字段（如单局 comboPeak、局内 grazeCount——这些不入存档，禁止用作称号来源；改用持久化的 `newbiePlan.progress.grazes` 等）。

### reduced-motion / 性能档 / i18n
- 展示为静态文本，解锁瞬间的轻提示动画在 reduced-motion 下静默（无弹跳/缩放）。
- 性能档无粒子新增，N/A。
- i18n：新增 `title_rookie`…`title_skyOverlord` 等 8 组中英文案（见附录词表）。

---

## 第 3 条：分享卡升级

### 用户故事
作为玩家，我想要分享卡带上我的昵称、称号、关卡/难度背景与历史对比，以便分享更有个人标识与传播力。

### 新增能力
- **昵称**（拍板③）：本批用「默认昵称 + 随机后缀」（如 飞行员·42），存 `SaveManager.nickname`（append-only，值为生成后的昵称）；**昵称编辑文本框后置 P2**。
- **称号**：复用第 2 条派生结果。
- **背景随关卡/难度变化**：背景渐变/主色改用该关 `LEVELS[i].theme`（skyTop/skyBottom/accent 已存在，零新增数据）；难度档可叠加边框强调色（hard=橙 / hell=红，casual/standard=默认青）。
- **历史对比**：与「同关 + 同模式」的历史最高分对比（数据源：`topScores` 中同 levelId+mode 的最高分，排除本局），显示「比上次 +X%」；无历史 → 显示「首秀 / First Run」；破纪录 → 沿用「★新纪录」。
- 复用现有 canvas 渲染链路（buildShareCard/downloadShareCard/copyShareText），不换技术栈。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 3.1 | 存档已保存昵称「阿飞」 | buildShareCard 生成画布 | 画布文本包含「阿飞」；未设置时显示默认「飞行员·随机后缀」 |
| 3.2 | 玩家已解锁某称号 | buildShareCard | 画布包含该称号文本（与结算页一致） |
| 3.3 | 第 3 关（敌方要塞）通关 | buildShareCard | 画布背景渐变使用第 3 关 theme 的 skyTop/skyBottom 色值（断言 canvas 像素或数据源） |
| 3.4 | 本局分数 > 同关同模式历史最高分 | buildShareCard | 显示「比上次 +{pct}%」（pct=向上取整百分比）或「★新纪录」 |
| 3.5 | 无同关同模式历史记录 | buildShareCard | 显示「首秀」，不报错、不显示异常百分比 |

### 边界 / 排除
- 不接后端、不做社交平台直发，保持纯本地 canvas 下载/复制。
- 不改既有 buildShareCard 的 540×720 尺寸与霓虹边框风格基线；新增内容按布局空间追加，不遮挡分数主视觉。
- copyShareText 的文本摘要同步加入昵称/称号/对比行（同步更新 `_shareText`）。
- 昵称默认「飞行员 + 随机后缀」；不做敏感词过滤（本地单机）。

### 红线确认
- SaveManager 仅 append-only 新增 `nickname`（默认 ''→展示层回退「飞行员·随机后缀」）；不碰旧字段。
- 历史对比只读 `topScores`，零写入；零触碰 COMBO / 成就 id / WingmanSystem / FloatingText。

### reduced-motion / 性能档 / i18n
- 分享卡为静态 canvas，无动画 → reduced-motion N/A；性能档 N/A（一次性渲染）。
- i18n：新增 `nicknameLabel`、`shareVsLast`（比上次 +{pct}%）、`shareFirstRun`（首秀）、`nicknameDefault` 等中英文案。

---

## 第 4 条：连续失败自适应救济

### 用户故事
作为卡关玩家，我想要在同一关连续失败多次后获得「降难度 / 临时增益」的选择与复活小福利，以便不因挫败弃坑、继续体验游戏内容。

### 设计语义（已拍板）
- **连续失败计数**：`SaveManager.failStreak = { [levelId]: n }`（append-only），仅 normal 模式按关记录；该关胜利 → 归 0；失败 → +1。
- **触发点**：本关 `failStreak[levelId] >= 3` 时，下一局开局弹「救济提示」面板，二选一：
  - 选项 A「降低难度」：本局临时切到休闲档系数（session 覆盖，**不写** `selectedDifficulty`）；
  - 选项 B「临时增益」：本局攻击 +10% 或 +1 命（二选一由玩家点选，默认 +1 命）。
  - 另设「拒绝」：本局不救济，按原难度硬刚（计数保留）。
- **复活福利**：救济局内，任何一次命数复活（respawnPlayer）追加「临时火力 +1，持续 2 秒」（临时 buff，不改变局内 powerLevel 数值与 POWER_CHANGED 语义，避免污染火力拾取/受击-1 链路）。
- **救济局标记**：本局 `reliefRun = true`（session），并累计 `SaveManager.reliefRuns`（append-only 计数，仅供统计）。

### 救济局「不计入」清单（硬性，主理人已拍板）

| 系统 | 救济局行为 |
|---|---|
| 排行榜 topScores | 不入榜 |
| 关卡勋章 levelMedals / 星级 levelStars | 不记录 |
| 成就（26 个，含 live 成就） | 全程抑制解锁（AchievementManager 附加式 relief 标记，`_checkLive/_checkAll` 不解锁；不改任何 id） |
| 无尽周赛 league | 不写 score |
| 最高分 bestScore | 不更新（救济有加成，避免刷最高分） |
| 每日任务 / 新手计划进度 | 跳过（防刷），金币照常入账（打得不算白打） |
| failStreak / reliefRuns | **唯一**计数：本局仍计入连续失败统计与救济局累计（恢复逻辑照常） |

- **恢复**：救济局结束（胜/负）后 reliefRun 归 false；该关胜利 → `failStreak[levelId]` 归 0，下次进关不再弹提示；该关再失败 → 计数继续 +1（可再次触发救济）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 4.1 | 玩家 normal 第 2 关连续失败 3 次 | 再次进入第 2 关 | 弹出救济提示面板（含「降低难度 / 临时增益 / 拒绝」三个选项） |
| 4.2 | 玩家选择「临时增益→+1 命」 | 本局开始 | 本局命数 +1 且攻击加成（若选 +10%）本局生效；下一局重新开始时无残留 |
| 4.3 | 救济局中玩家复活 | 复活完成 | 追加临时火力 +1 持续 2 秒，2 秒后恢复原火力（局内 powerLevel 数值不变） |
| 4.4 | 救济局胜利 | 结算完成 | topScores / levelMedals / levelStars / achievements / league / bestScore / 每日任务 / 新手计划均无本局记录，`failStreak[levelId]` 归 0 |
| 4.5 | 玩家在救济提示选「降低难度」 | 本局进行 | 敌人/Boss 系数按休闲档；`selectedDifficulty` 存档值不变 |

### 边界 / 排除
- 救济仅 normal 主线；无尽/爬塔/BossRush/活动模式不触发（无尽已有广告复活兜底）。
- 救济加成只作用于本局，不持久化、不叠加（每次救济局独立结算）。
- 不新增「跳过失败」「直接通关」类强救济；只做「降难度 / 轻增益」，保持挑战底线。
- 复活临时火力用独立临时字段（如 `tempFireBonusUntil`），**不**写入 powerLevel。

### 红线确认
- COMBO 块零触碰；26 成就 id 零改动（AchievementManager 只加 relief 抑制标记，属于 append-only 方法，不动 condition/progress/id）。
- SaveManager 仅 append-only 新增 `failStreak: {}` 与 `reliefRuns: 0`。
- 不得修改 `selectedDifficulty` 存档语义；降难度是 session 覆盖。

### reduced-motion / 性能档 / i18n
- 救济提示面板为静态弹窗 + 按钮（无粒子），reduced-motion 下无弹跳动画；性能档 N/A。
- i18n：新增 `reliefTitle`（连续失败，需要帮助吗？）、`reliefLowerDiff`、`reliefTempBuff`、`reliefDecline`、`reliefBuffLife`、`reliefBuffAtk`、`reliefFireBonus`（复活火力+1）等中英文案。

---

## 第 5 条：图鉴收藏系统

### 用户故事
作为收集型玩家，我想要一个图鉴记录我击落/收集过的敌机、Boss、武器与元素，以便有长期收集目标，并为皮肤/模块等金币消费提供动机。

### 图鉴条目（共 18 条）

| 分类 | 条目 | 数量 |
|---|---|---|
| 敌机 | small / mid / diver / turret / kamikaze / summoner / shield | 7 |
| Boss | boss_sentinel / boss_crusher / boss_overlord / boss_annihilator | 4 |
| 武器 | pulse / missile / laser / bomb | 4 |
| 元素 | fire / ice / thunder | 3 |

### 解锁触发点（埋点，全在既有事件上挂钩，不新增战斗数值）
- 敌机：首次击杀该类型（`GameScene.registerKill` 的 `meta.enemyType` 已有）。
- Boss：首次击败（`_onBossDefeated` 的 `bossKey` 已有；annihilator 也计入——注意现有 `bossesDefeated` 只记了 3 个 Boss 的成就，图鉴用独立字段，不依赖 bossesDefeated 的键集合语义）。
- 武器：首次使用（`AchievementManager.reportWeaponUsed` 已有，事件点挂钩）。
- 元素：首次用该元素击杀（`registerKill` 的 `meta.element` 已有）。

### 存档（append-only）
- `SaveManager.codex = { enemies: {}, bosses: {}, weapons: {}, elements: {} }`，键为条目 id，值为 true；首次触发写入并 save。
- `SaveManager.codexDecor = []`：图鉴页装饰（边框/背景）购买记录，纯展示金币出口（每款定价见配置，如 300/600 金币），不改变收集解锁。

### 展示
- 菜单新增「图鉴」入口 → CodexScene：四分类网格，已解锁显示名称+简介+小图标（复用现有纹理），未解锁显示「???」剪影。
- 图鉴页提供 2 款可购买装饰（金币出口），纯展示。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 5.1 | 玩家首次击杀 turret | 击杀结算完成 | `codex.enemies.turret = true` 且图鉴页该条目点亮 |
| 5.2 | 玩家首次击败 boss_annihilator | Boss 击败 | `codex.bosses.boss_annihilator = true` |
| 5.3 | 玩家首次使用 laser 武器 | 武器切换 | `codex.weapons.laser = true` |
| 5.4 | 图鉴页加载 | 渲染条目 | 已解锁条目显示名称，未解锁显示「???」，计数（已解锁 12/18）正确 |
| 5.5 | 玩家购买图鉴装饰 | 金币足够 | 扣金币、`codexDecor` 追加记录、图鉴页样式变化；金币不足时不扣不记 |

### 边界 / 排除
- 纯展示 + 收集：**不动战斗数值**；图鉴解锁不影响敌人/Boss 行为、不掉落、不加成。
- 图鉴解锁不影响成就（不新增成就 id；图鉴与成就系统并行）。
- Boss 图鉴用独立 `codex.bosses`，**不**复用 `bossesDefeated`（后者被成就语义占用，避免污染）。
- 金币出口仅限图鉴页装饰（显示层），不开放「金币直接解锁条目」（保持收集纯粹性）。

### 红线确认
- COMBO 块零触碰；26 成就 id 零改动；WingmanSystem 零触碰；FloatingText 零改动。
- SaveManager 仅 append-only 新增 `codex`、`codexDecor`。

### reduced-motion / 性能档 / i18n
- 条目解锁闪光/点亮动画在 reduced-motion 下降级为静态（无缩放/粒子）；性能档 low 下不新增粒子。
- i18n：新增 `codexTitle`、分类名、18 条条目名/简介、装饰名、购买文案等中英文案（敌机名此前无词表，需新增：小型机/中型机/俯冲机/炮台/自爆机/召唤机/护盾机等）。

---

## 第 6 条：连击蓄力爆发

### 用户故事
作为弹幕玩家，我想要连击到阈值后手动消耗连击数，兑换强化射击/清屏/回能，以便主动决策资源、制造爆发爽点。

### 「消耗连击」语义（重要，已明确）
- 本功能基于 **GameScene 击杀连击**（`registerKill` 维护的 `this.combo`），**与** WINGMAN.COMBO（僚机元素协同）**完全无关**。
- **消耗后当前连击归零**：调用现有 `breakCombo()`（broadcast `COMBO_CHANGED 0`），随后玩家需重新积累。
- **峰值只增不减**：`this.maxCombo`（以及 `AchievementManager.reportComboPeak` 喂的 `session.comboPeak`）**绝不因消耗而降低**。
  - 因此 combo_15 / combo_30 成就（判定 `comboPeak >= 15/30`，即「峰值」）**不受影响**：只要曾经达到过 15/30，成就已解锁，消耗后峰值仍保留。
  - 结论：消耗连击**不会**导致已解锁成就回滚，也**不会**改变成就进度来源字段的语义（progress 一直读 peak）。
- 触发方式：HUD 新增「蓄力」按钮 + 键盘键（如 C）；只有当前 `combo >= 阈值` 才可点按（未达标置灰）。

### 三档效果（消耗阈值，数值可调）

| 档位 | 消耗连击 | 效果 | 复用机制 |
|---|---|---|---|
| 强化射击 | ≥10 | 3 秒伤害 ×1.5（或临时火力+1） | 复用 Player 临时增益机制 |
| 清屏 | ≥15 | 清除全场敌弹 + 对全场敌机造成中等伤害 | 复用 useBomb 的清屏逻辑（不耗炸弹） |
| 回能 | ≥20 | 能量槽直接充满 | 复用 addEnergy / ENERGY_MAX |

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 6.1 | 当前连击 ≥10 且玩家点按「蓄力→强化射击」 | 触发 | 当前连击归 0（HUD 显示 0），强化射击 buff 生效 3 秒 |
| 6.2 | 当前连击 ≥15 且触发「清屏」 | 触发 | 全场敌弹清除、全场敌机受中等伤害、当前连击归 0、炸弹数量不变 |
| 6.3 | 当前连击 ≥20 且触发「回能」 | 触发 | 能量槽充满、当前连击归 0 |
| 6.4 | 本局此前峰值已达 30（combo_30 已解锁） | 玩家消耗连击至 0 | `session.comboPeak` 保持 30，combo_30 仍为已解锁、不重复弹提示 |
| 6.5 | 当前连击 <10 | 玩家点按蓄力 | 不触发任何效果（按钮置灰/无响应），连击不被消耗 |

### 边界 / 排除
- 不触碰 WINGMAN.COMBO 状态机（`reportHit`/`getComboMul`/`getComboTint`）与 `WINGMAN_COMBO` 事件；每日任务 `combos` 指标（= 元素协同）不受影响。
- 不新增成就、不改任何成就 condition；不新增存档字段（连击为局内状态）。
- 「清屏」不耗炸弹、不与 `useBomb` 的炸弹数联动；「回能」不叠加能量上限。
- 蓄力按钮不影响既有空格（炸弹）与技能键位；与 FOCUS_TOGGLE/技能切换键不冲突。

### 红线确认
- COMBO 块（WINGMAN.COMBO）零触碰；成就 id 零改动；`maxCombo`/`comboPeak` 只增不减；SaveManager 零改动。
- 仅新增：GameScene 一个蓄力方法（读 `this.combo`，触发后调 `breakCombo()` + 应用效果）+ HUD 按钮/键位 + 飘字。

### reduced-motion / 性能档 / i18n
- 蓄力触发光效（充能环/粒子）在 reduced-motion 下降级为静态提示；性能档 low 下减粒子密度。
- i18n：新增 `chargeBtn`（蓄力）、`chargePower`（强化射击）、`chargeClear`（清屏）、`chargeEnergy`（回能）、`chargeNeed`（还需 {n} 连击）等中英文案。

---

## 第 7 条：无尽变异规则

### 用户故事
作为无尽/爬塔玩家，我想要每隔几层出现一次全局变异（正面或负面），以便高风险高收益、长线变化不断。

### 设计语义
- **范围**：无尽爬塔（`isTower`）专用；普通关/BossRush/活动模式不受影响。
- **间隔（拍板②）**：每 5 层触发一次全局变异，配置常量 `MUTATION_EVERY_LAYERS: 5`（`towerFloor % 5 === 0`，即 Boss 波通关后进入第 5/10/15… 层）。⚠️ 注：按 TOWER.BOSS_EVERY=10 波/层，5 层 ≈ 50 波，节奏偏长；真测后如偏慢**只改常量**（如改为每 5 波），不改框架。
- **提示方式**：变异生效时全屏横幅 + 顶部状态图标（持续期间常驻小图标）；负面变异在**生效前 1 秒**先出警示文字（不可静默生效）。
- **持久化**：局内临时（同 towerBonuses），不入存档。

### 变异表（正面 5 + 负面 4，配置常量 `MUTATIONS`，复用 TOWER_BUFFS 的 id/name/desc/apply 框架）

| 方向 | id | 名称（zh / en） | 效果 | 复用机制 |
|---|---|---|---|---|
| 正面 | magnetStorm | 磁力风暴 / Magnet Storm | 磁力常驻（持续至下次变异） | `buffs.magnetUntil` |
| 正面 | doubleCoin | 双倍金币 / Double Coins | 本段金币 ×2 | 结算/局内 coinMul |
| 正面 | rapidFire | 急速射击 / Rapid Fire | 射速 +20% | `player.setFireRateMul` |
| 正面 | overshield | 过载护盾 / Overshield | 护盾常驻 + 每波回血 10 | 护盾 buff + 回复 |
| 正面 | grazeWell | 擦弹之泉 / Graze Well | 擦弹回能 ×2 | GRAZE.ENERGY_GAIN 翻倍 |
| 负面 | swiftBullets | 弹速风暴 / Swift Bullets | 敌弹速 +20% | 新增敌弹速度全局系数 |
| 负面 | tinyRing | 擦弹环缩小 / Tiny Ring | 擦弹环半径 −30% | `player.getGrazeCircle` 系数 |
| 负面 | glassCannon | 玻璃大炮 / Glass Cannon | 玩家受伤 +30% | 受击伤害系数 |
| 负面 | swarm | 蜂群 / Swarm | 敌人数量 +30% | 波次 _toSpawn 系数 |

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 7.1 | 爬塔层数到达 5 | 进入第 5 层 | 弹出变异横幅并随机应用 1 个正面或负面变异（正负比例建议 55/45，可配置） |
| 7.2 | 正面变异「磁力风暴」生效 | 玩家附近有金币 | 金币被磁力吸附（磁力效果持续至下次变异） |
| 7.3 | 负面变异「弹速风暴」生效 | 敌人开火 | 敌弹速度 ×1.2；生效前出现 ≥1 秒警示文字 |
| 7.4 | 爬塔层数到达 10 | 进入第 10 层 | 上一变异结束、新变异生效（可相同可不同） |
| 7.5 | 普通关 / BossRush / 活动模式 | 进局 | 无任何变异逻辑生效（零回归） |

### 边界 / 排除
- 变异不触碰 WINGMAN.COMBO / 成就 / 存档；不改变 Boss 波与 3 选 1 增益（TOWER_BUFFS）既有流程（变异是叠在其上的全局层）。
- 负面变异必须可反制（有预警 + 玩家可走位/擦弹/技能应对），不得制造无解局面。
- 新增的负面效果（弹速系数/擦弹环系数/受击系数）为**新配置键**，不改既有字段默认值（标准路径全 1.0）。

### 红线确认
- COMBO 块零触碰；成就 id 零改动；WingmanSystem 零触碰；SaveManager 零改动（局内临时）。
- TOWER_BUFFS 既有 6 条零改动；MUTATIONS 为独立新增表。

### reduced-motion / 性能档 / i18n
- 变异横幅动画 reduced-motion 下为静态文本；负面警示同样静态化但保留文字（信息无障碍优先）。
- 性能档：变异不新增粒子；「蜂群」敌人数量在 low 档可下调系数（性能优先）。
- i18n：新增 9 条变异名/描述中英文案。

---

## 第 8 条：元素免疫敌人 + 全屏元素风暴

### 用户故事
作为进阶玩家，我想要遇到免疫某元素的敌人，并可通过全屏元素风暴反制，以便元素核心轮换更有策略深度。

### 设计语义
- **免疫敌人门槛**：仅当 `selectedDifficulty ∈ {hard, hell}`（困难档起）时，波次才可能刷出免疫敌人；休闲/标准**绝不出现**（新手保护）。免疫标记数据驱动：`wavePlan` comp 条目可带可选字段 `immune:'fire'|'ice'|'thunder'`，WaveSystem.spawnOne 透传（无该字段 = 普通敌人，零回归）。
- **免疫语义**：免疫敌人对该元素**伤害免疫（0 伤害）**，含该元素 DoT（火免疫则灼烧 0）与该元素触发的二段反应伤害（ElementReaction 对免疫目标伤害归 0）；其他元素伤害正常。非免疫元素的元素状态（如对火免疫敌人挂冰减速/雷麻痹）**正常生效**（减速/麻痹仍能控场，避免无解）。
- **反制 = 元素核心轮换**：玩家需拾取 `element_core` 轮换到非免疫元素（既有 rotatePlayerElement 已实现）。
- **全屏元素风暴**：场上 active 敌机**同时存在 fire / ice / thunder 三种元素状态**（读 `Enemy._elem`）时触发一次风暴：
  - 效果：对所有敌机造成大额**非元素伤害（穿透免疫）** + 清除全场敌弹 + 大额得分 + 全屏演出；
  - 冷却：`STORM_CD = 15s`（防连环触发）；
  - 触发后清除触发敌机的元素状态（避免同帧再触发）；
  - Boss 战也可触发（对 Boss 造成固定伤害）。
- **免疫敌人不出现于 Boss 战**（Boss 不加免疫标记，避免地狱 Boss 无解）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 8.1 | selectedDifficulty = casual 或 standard | 任意波次生成 | 不出现任何带免疫标记的敌人 |
| 8.2 | selectedDifficulty = hard/hell 且 wavePlan 某条目带 `immune:'fire'` | 该敌人生成 | 敌人体表显示「免疫火」标记，且被火元素/火 DoT/火反应命中时伤害为 0 |
| 8.3 | 同一火免疫敌人被冰元素命中 | 命中结算 | 冰伤害正常、减速状态正常生效 |
| 8.4 | 场上 active 敌机同时存在 fire/ice/thunder 三种 `_elem` | 条件满足 | 触发全屏元素风暴（清敌弹 + 穿透免疫伤害 + 得分），且 15 秒内不重复触发 |
| 8.5 | 风暴冷却中 | 再次满足三元素同挂 | 不触发，待冷却结束后可再次触发 |

### 边界 / 排除
- 免疫敌人只在数据表显式标记时出现（默认波次不变）；休闲/标准彻底关闭，保证新手零卡关。
- 全屏风暴是**奖励性反制**，不是「必须触发才能过关」的硬门槛；不触发也能靠元素轮换正常通关。
- 免疫标记不改敌机 HP/速度/掉落；击杀仍走正常 registerKill（计入击杀/连击/元素成就的**非免疫元素**击杀）。
- 不触碰 WINGMAN.COMBO（僚机弹对免疫敌人同样按元素判定，但僚机系统本身零改动）。

### 红线确认
- COMBO 块零触碰；成就 id 零改动（元素击杀成就只记录「击杀时的归属元素」，免疫归零不产生击杀，自然不污染统计）；WingmanSystem 零触碰。
- SaveManager 零改动；ElementReaction 只加免疫门控（对免疫目标伤害归 0），不改既有反应数值。

### reduced-motion / 性能档 / i18n
- 免疫标记为静态图标/文字；风暴全屏粒子在 reduced-motion 下降级为静态闪光 + 文字横幅，low 档减粒子密度。
- i18n：新增 `immuneFire`（免疫火）、`immuneIce`、`immuneThunder`、`stormTitle`（元素风暴！）等中英文案。

---

## 第 9 条：精英敌人 mini-boss

### 用户故事
作为玩家，我想要偶尔遭遇精英版敌机（高血量/强化弹幕/稀有掉落/发光外观），以便小怪与 Boss 之间有梯度惊喜与收获感。

### 设计语义
- **出现方式**：数据驱动可配置（wavePlan 条目可选 `elite:true`）+ 兜底随机（每关第 2 波起，每波有较低概率追加 1 只精英，如 8%）。
- **难度门槛**：休闲档**不出现**精英（新手保护）；标准/困难/地狱出现（hard/hell 概率更高，可配置）。
- **数值（控制在小怪与 Boss 之间）**：血量 ×5（在既有 difficulty × 难度档系数之上再 ×5）；弹幕强化（复用既有 firePattern，射速 ×1.5 或换高难弹种）；得分/金币按类型 ×3；**击杀必掉 1 个高价值道具**（从 `BOSS_DROP_TABLE` 随机 1 个：energy/heal/wingman/bomb/weapon 等，复用 spawnItem）。
- **外观**：发光描边 + 放大约 1.2 倍（复用 VFX.glowTarget，质量档自动降级）。
- **语义**：精英**是敌机不是 Boss**：击杀走 `registerKill`（计入击杀/连击/掉落/每日任务 kills），**不触发** BOSS_SPAWNED / BOSS_DEFEATED / bossesDefeated / 屠龙者类成就。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 9.1 | selectedDifficulty = standard/hard/hell 且某波刷出精英 | 敌人生成 | 该敌机体型略大、带发光描边、血量 = 基础 ×5 × 关卡难度 × 难度档 |
| 9.2 | 精英被击杀 | 击杀结算 | 走正常 registerKill（击杀数 +1、连击 +1、得分 ×3），不触发任何 Boss 事件，`bossesDefeated` 不变 |
| 9.3 | 精英被击杀 | 掉落结算 | 必掉 1 个 BOSS_DROP_TABLE 高价值道具（energy/heal/wingman/bomb/weapon 之一） |
| 9.4 | selectedDifficulty = casual | 任意波次生成 | 不出现精英 |
| 9.5 | 第 1 波（每关开局波） | 生成 | 不刷精英（避免开局突袭） |

### 边界 / 排除
- 精英不是新敌型实体：复用现有 Enemy + 标记字段（`isElite` + 数值倍率），**不新增敌人类型**、不新增纹理（发光靠既有 glowTarget）。
- 精英不改变 Boss 战与 Boss 掉落；不影响 wavePlan 的既有敌人数量（精英是追加/替换，数量仍受波次表控制）。
- 不做精英成就、不做精英图鉴条目（图鉴仍按基础类型解锁——击杀精英也解锁对应基础类型条目，一次解锁即可）。

### 红线确认
- COMBO 块零触碰；成就 id 零改动（击杀精英仍计普通击杀，不新增任何成就来源）；WingmanSystem 零触碰；SaveManager 零改动。

### reduced-motion / 性能档 / i18n
- 精英发光外观走既有 glowTarget（low 档自动关闭）；无新增动画。
- i18n：新增 `elitePrefix`（精英· / ELITE·）用于浮字/血条旁标注。

---

## 第 10 条：Boss 狂暴终结技

### 用户故事
作为弹幕玩家，我想要 Boss 低血量时进入有仪式感的狂暴终局（全屏弹幕 + 限时 DPS 检查 + 专属演出），并且始终有明确逃生窗口，以便终局既刺激又公平（地狱难度不无解）。

### 设计语义
- **触发**：Boss `hp < maxHp × 15%` 且非死亡时进入狂暴态（叠加在既有 phase 3 之上；Boss 实体同时用于主线/爬塔/BossRush，狂暴对所有复用场景生效，数值按各自 maxHp 比例）。
- **演出**：入场演出约 1.2s（红屏渐显 + 标题「狂暴终结技！」+ 专属音效）；reduced-motion 下只显示静态横幅。
- **全屏弹幕 + 逃生窗口（硬性）**：
  - 狂暴期 Boss 横移速度降 50%（便于集火）；
  - 弹幕按「3 组全屏弹幕轮换」释放，每组之间 ≥0.5s 间歇；
  - **每组弹幕含旋转安全缝隙**（缺口宽 ≥ 玩家机身 3 倍，随相位旋转），保证任意时刻存在可穿行通道——地狱难度也有解。
- **DPS 检查（限时）**：狂暴开始即开启 `RAGE_WINDOW = 8s`，玩家需在窗口内对 Boss 造成 `maxHp × 10%` 伤害：
  - **成功** → Boss「破绽」2s：受击伤害 ×2 + 短暂硬直（奖励）；
  - **失败** → 惩罚：Boss 回复至 maxHp × 20%（退回狂暴线上方）并释放一次全屏弹幕，狂暴态继续（玩家需再次压血线触发，可重复）。
- **击杀链路**：狂暴中 Boss 被击杀仍走正常 `die()` → `BOSS_DEFEATED`（成就/掉落/爬塔层数链路不变，不双触发）。

### 验收标准（G/W/T）

| # | Given | When | Then |
|---|---|---|---|
| 10.1 | Boss hp 降至 maxHp × 15% 以下 | 本次命中结算 | Boss 进入狂暴态：入场演出 ≥1.2s、红屏 + 标题提示、DPS 检查开始（横幅显示「8 秒内造成 X 伤害」） |
| 10.2 | 狂暴态持续 | 观察弹幕 | 任意时刻存在可穿行的安全缝隙（缺口宽 ≥ 玩家机身 3 倍），且每两组全屏弹幕间有 ≥0.5s 间歇 |
| 10.3 | 玩家在 8s 窗口内造成 ≥ maxHp×10% 伤害 | 窗口结束 | Boss 进入「破绽」2s（受击 ×2、硬直） |
| 10.4 | 玩家未在窗口内达成 DPS | 窗口结束 | Boss 回复至 maxHp × 20% 并释放一次全屏弹幕；之后被再次压至 15% 可重新进入狂暴（不卡死） |
| 10.5 | 狂暴态中 Boss 被击杀 | 死亡结算 | 走正常 BOSS_DEFEATED 流程：掉落/成就/爬塔层数各只记一次，不重复 |

### 边界 / 排除
- 狂暴态不改变 Boss 阶段机（phase 1/2/3）与护盾部位逻辑；是 `<15%` 的附加子状态。
- 狂暴不新增存档字段、不新增成就（Boss 击杀仍是既有 boss_* 成就链路）。
- 逃生窗口是硬性设计红线：**禁止**出现无缝隙全屏弹幕；DPS 检查失败惩罚为「回血+弹幕」，不是「直接击杀/秒杀」。
- 演出时长（1.2s）与 DPS 窗口（8s）、所需伤害（10%）、回血（20%）均为配置常量（RAGE 配置块），真测后可由主理人调参，不改框架。

### 红线确认
- COMBO 块零触碰；成就 id 零改动（BOSS_DEFEATED 链路原样）；WingmanSystem 零触碰；FloatingText 零改动（新增横幅是附加式）；SaveManager 零改动。

### reduced-motion / 性能档 / i18n
- 狂暴演出（红屏闪烁/全屏粒子/弹幕密度）在 reduced-motion 下降级：静态横幅 + 弹幕密度减半 + 无红屏频闪；性能档 low 下弹幕密度减半、粒子关闭，保证可玩。
- i18n：新增 `rageTitle`（狂暴终结技！/ RAGE MODE!）、`rageDps`（{sec}s 内造成 {dmg} 伤害）、`rageSuccess`（破绽！）、`rageFail`（狂暴回涌）等中英文案。

---

## 附录 A：新增存档字段汇总（全部 append-only）

| 字段 | 类型/默认 | 所属条目 | 说明 |
|---|---|---|---|
| `nickname` | `''`（展示回退「飞行员·随机后缀」） | 3 | 本批生成「默认昵称 + 随机后缀」写入；编辑文本框后置 P2 |
| `failStreak` | `{}`（{levelId: n}） | 4 | 各关连续失败计数，normal 专用 |
| `reliefRuns` | `0` | 4 | 救济局累计次数（统计用） |
| `codex` | `{ enemies:{}, bosses:{}, weapons:{}, elements:{} }` | 5 | 图鉴解锁记录（键=条目 id，值 true） |
| `codexDecor` | `[]` | 5 | 图鉴装饰购买记录（金币出口） |

> 其余 5 条（1 波次变体 / 2 称号 / 6 连击蓄力 / 7 无尽变异 / 8 免疫风暴 / 9 精英 / 10 狂暴）**零存档改动**。

---

## 附录 B：新增 i18n 词表（zh/en，开发落地时补入 Locale.js，全部 append-only）

- 第 2 条：`title_rookie / title_veteran / title_grazer / title_climber / title_slayer / title_maniac / title_perfectionist / title_skyOverlord` + desc。
- 第 3 条：`nicknameLabel / nicknameDefault / shareVsLast / shareFirstRun / shareDiffLabel`。
- 第 4 条：`reliefTitle / reliefLowerDiff / reliefTempBuff / reliefDecline / reliefBuffLife / reliefBuffAtk / reliefFireBonus`。
- 第 5 条：`codexTitle / codexEnemies / codexBosses / codexWeapons / codexElements / codexLocked / codexCount / codexEntry_*`（敌机/Boss/武器/元素 18 条名+简介，含敌机名：小型机/中型机/俯冲机/炮台/自爆机/召唤机/护盾机）/ `codexDecor_*`。
- 第 6 条：`chargeBtn / chargePower / chargeClear / chargeEnergy / chargeNeed / fl_charge_*`。
- 第 7 条：`mut_magnetStorm / mut_doubleCoin / mut_rapidFire / mut_overshield / mut_grazeWell / mut_swiftBullets / mut_tinyRing / mut_glassCannon / mut_swarm` + desc + `mutWarning`（变异警示）。
- 第 8 条：`immuneFire / immuneIce / immuneThunder / stormTitle / stormDesc`。
- 第 9 条：`elitePrefix`。
- 第 10 条：`rageTitle / rageDps / rageSuccess / rageFail / rageWindow`。

---

## 附录 C：风险与开放问题（已拍板项已更新）

1. ✅ 已拍板：第 4 条救济局口径（见第 0 节①）：不计 topScores/levelMedals/levelStars/league/bestScore/每日任务/新手计划，仅 failStreak/reliefRuns 计数。
2. ✅ 已拍板：第 7 条变异间隔每 5 层 + 常量 `MUTATION_EVERY_LAYERS: 5`（见第 0 节②）。
3. ✅ 已拍板：第 3 条昵称本批「默认+随机后缀」，编辑后置 P2（见第 0 节③）。
4. 第 4 条救济提示「降低难度」与既有四档难度选单并存：救济降难度是 session 覆盖，返回菜单后恢复玩家原选择（体验一致）。
5. 第 8 条三元素同挂风暴的「元素状态」读 `Enemy._elem`，需注意元素状态过期/敌机死亡的即时清理，避免死敌残留造成误触发（**实现方加活性守卫，QA 专项断言**——主理人已确认写入实现规格）。

---

## 附录 D：红线确认清单（开发 / QA 对照检查）

| # | 红线项 | 要求 | 10 条结论 |
|---|---|---|---|
| R1 | `WINGMAN.COMBO` 五字段（WINDOW_MS/TRIGGER/BUFF_MS/DMG_MUL/MAX_COUNT） | **零触碰**，禁止读写/修改 | ✅ 全绿（第 6 条用的是击杀 combo，与僚机协同 combo 无关） |
| R2 | 26 个成就 id 及 condition/progress | **零改动**；救济抑制只加附加式 relief 标记 | ✅ 全绿 |
| R3 | `WingmanSystem` | **零触碰**（免疫门控落在 Enemy/ElementReaction） | ✅ 全绿 |
| R4 | `FloatingText`（damageNumber） | 只新增浮字/横幅，不改既有行为 | ✅ 全绿 |
| R5 | `SaveManager` 旧字段语义 | **全部保留**；仅 append-only 新增 nickname/failStreak/reliefRuns/codex/codexDecor | ✅ 全绿 |
| R6 | 外部资源 / 网络 / 后端 | **零新增外部资源、零网络依赖**（纯本地 canvas/本地存档） | ✅ 全绿 |
| R7 | 纯视觉 / 零业务逻辑 | 新增展示类内容（称号/分享卡/图鉴装饰/免疫标记/狂暴演出）**不得携带任何业务数值逻辑**；业务逻辑只在既有机制上叠加配置 | ✅ 全绿 |

> 检查方式：实现阶段由架构师/开发在 PR 自检，QA 验收时按 R1~R7 逐项回归（尤其 R1/R2/R5 需 grep 断言：`WINGMAN.COMBO` 未被修改、成就 id 集合未变、SaveManager 旧字段写入点未变）。
