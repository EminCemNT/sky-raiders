# 苍穹战机 · 打击手感与 Game Feel 优化路线图

> 调研日期：2026-08-12｜范围：竖版飞行射击（shmup / danmaku）手感优化
> 调研来源：Vlambeer《Juice It or Lose It》、gamejuice.co.uk《30 Juice Techniques》、
> Mykola Veremiev/Anton Slashcev《Game Juice Tips》、tigerabrodi《Juice is the difference》、
> 以及 CAVE / Raiden / Ikaruga / Touhou 等标杆作品评测。
> 红线重申：COMBO 块五字段（WINDOW_MS/TRIGGER/BUFF_MS/DMG_MUL/MAX_COUNT）与成就 id 存档键**绝不可动**。
> 以下优化均不触碰红线。

---

## 一、调研摘要

飞行射击的「手感」不是画面堆料，而是**用最小成本制造「我这一下打中了、而且打得很重」的感官确认**。
业界共识（Vlambeer、gamejuice.co.uk 等）是：游戏好不好玩在机制，但**好不好玩得下去在 juice**——
一帧命中瞬间可同时触发：屏幕微震(3 帧) + 命中定格 hit pause(2 帧) + 敌人白闪(1 帧) + 红闪(3 帧) +
粒子迸发(10 帧) + 伤害飘字(30 帧) + 枪口后坐(5 帧) + 音效(枪声+命中+弹壳)。**多渠道冗余反馈**让玩家
即使没盯着血条也瞬间知道「命中了 / 我挨打了」。

标杆作品的招牌做法：
- **CAVE 系（怒首领蜂 / 虫姬 / Espgaluda）**：极致可读的弹幕 + 爆炸打击感 + **巨大的得分数字**（虫姬 BIG numbers）+ 击中时的「慢动作弹幕」帮助精密走位。
- **斑鸠 Ikaruga**：蓄力/吸收机制、对称美学；判定点极小且**射击时显示判定点并减速**——把「精准」变成手感的一部分。
- **雷电 Raiden**：经典分层爆炸音 + 导弹/激光差异反馈，武器手感区分度极高。
- **东方 Touhou**：高能量 BGM 与弹幕节奏绑定，音乐即反馈语言。

---

## 二、本项目现状对标（已做 / 可优化）

| 技巧 | 现状 | 落点 / 说明 |
|---|---|---|
| 命中定格 hit pause | ✅ 已做 | `GameScene.requestHitStop`，击杀/炸弹/Boss 触发，70ms 冷却 |
| 屏幕震动 screen shake | ✅ 已有（散落） | 玩家受击/死亡/Boss 爆炸/VFX，但**无统一分级档位** |
| 命中闪白 hit flash | ✅ 已做 | `Enemy.hit` 里 `setTintFill(0xffffff)` 40ms |
| 命中火花 hitSpark | ✅ 已做 | `VFX.hitSpark` 在子弹命中点迸发 |
| 子弹拖尾 trail | ✅ 已做 | `GameScene` 逻辑像素每隔帧加拖尾 |
| 程序 BGM | ✅ 已做 | `AudioSystem.startBgm` 低音 pad + 琶音循环 |
| **命中音效 enemyHit** | ✅ **本轮新增** | 轻脆高频(1300~1800Hz) + 音高随机化 + 35ms 节流 + 与噪声分层；致命一击交给爆炸音 |
| 伤害飘字 Damage Numbers | 🔲 缺 | 受击飘数字（业界 Tier1 必做项，本项目完全没有） |
| 敌人受击位移 flinch/knockback | 🔲 缺 | 目前仅闪白，无物理反馈，敌人像「打不动」 |
| 音效音高随机化（全局） | 🔲 部分 | 仅 enemyHit 做了；shoot/explosion 等高频音仍可统一 ±7% |
| 分级震动语言 tiered shake | 🔲 缺 | 无 light/medium/heavy/catastrophic 四档统一映射 |
| 低血量 vignette / 去饱和 | 🔲 缺 | 低血量时无屏幕反馈（claudepluginhub low-HP 必做） |
| 可见判定点 visible hitbox | 🔲 缺 | 斑鸠/虫姬招牌；可加「显示判定点」选项 |
| 致命一击 death freeze + 弹性缩放 | 🔲 缺 | `die()` 直接 recycle，缺死亡确认演出 |
| 普通命中轻震 | 🔲 缺 | 目前 shake 仅在重击/死亡，普通命中无声无震 |
| Boss/战斗动态音乐切换 | 🔲 缺 | BGM 单一循环，未随阶段/血量变化 |

---

## 三、推荐优化路线（按优先级）

### P0 · 见效快 · 零红线风险（建议下一步直接做）

1. **伤害飘字 Damage Numbers**
   - 做什么：敌机每次受击在头顶飘出伤害数字，向上漂移 + 轻微放大后淡出（30 帧）。
   - 为什么：gamejuice.co.uk Tier1 概念、tigerabrodi「progress」感；虫姬 BIG numbers 是招牌。
     玩家爱看数字跳动，是最廉价的「反馈密度」提升。
   - 落点：`Enemy.hit` 内 `VFX.damageText(x, y, Math.round(dmg))`（新增 `VFX.damageText`）。
   - 风险：极低；注意小敌机密集时飘字堆叠 → 加「同屏最多 N 个」「数字过小不显示」节流。

2. **敌人受击 flinch / 轻微 knockback**
   - 做什么：受击瞬间敌人朝被击方向轻微位移（如 6~10px）+ 快速回弹 tween（4~8 帧）。
   - 为什么：gamejuice.co.uk #11「enemies that don't react feel invincible」；claudepluginhub knockback。
   - 落点：`Enemy.hit` 里 `this.scene.tweens.add({ targets:this, x: this.x + dir*8, duration:60, yoyo:true })`（dir 由子弹方向或简单随机）。
   - 风险：低；避免位移把敌人挤出屏幕或卡路径 → 幅度小、yoyo 回原位。

3. **全局音效音高随机化（±7%）**
   - 做什么：shoot / explosion / pickup 等高频音效统一加 ±7% 随机音高（enemyHit 已示范）。
   - 为什么：gamejuice.co.uk Tier1 #2「machine gun audio problem」——同音快速重复最显廉价。
   - 落点：在 `AudioSystem._tone` 调用处传入随机化，或 `_tone` 内部对 `freq` 做 `*(0.93~1.07)`。
   - 风险：极低。

4. **分级震动语言（tiered shake）**
   - 做什么：封装 `shake(tier)`：light(2~3px/80ms) / medium / heavy / catastrophic，全游戏事件统一映射。
   - 为什么：gamejuice.co.uk #6「consistency turns shakes into a readable language」；如果什么都震，等于什么都不震。
   - 落点：新增 `GameScene.shake(tier)`，替换散落的 `cameras.main.shake(...)`。
   - 风险：低（重构震动调用，不改行为幅度太多）。

### P1 · 中等投入（手感质变区）

5. **低血量 vignette / 去饱和**
   - 做什么：玩家血量低于阈值（如 30%）时，屏幕边缘渐显暗角 + 轻微去饱和；恢复后消失。
   - 为什么：claudepluginhub low-HP、gamejuice.co.uk #12；用 peripherals 传达危险，不抢中心视野。
   - 落点：`UIScene` 叠一个 vignette 渐变图层，`GameScene` 血量变化事件驱动 alpha。
   - 风险：中（需测试可读性 + 给「减弱特效」开关，照顾光敏用户）。

6. **可见判定点 visible hitbox 选项**
   - 做什么：设置里加「显示判定点」，开启时玩家机身中心显示小圆点（斑鸠/虫姬同款），并联动减速。
   - 为什么：CAVE 招牌，显著降低新手挫败、提升精准操作上限。
   - 落点：`Player` 持有一个小判定点 sprite，`Settings` 开关控制显隐（可不动移动速度，先只显隐）。
   - 风险：中（判定点尺寸需与真实碰撞体严格一致，避免「看着没中却死了」的信任崩塌）。

7. **致命一击 death freeze + 弹性缩放**
   - 做什么：敌机血量归零时先冻结 5 帧（hitStop 小档）再播放 scale-to-zero 弹性消失 + 爆炸。
   - 为什么：tigerabrodi「Death freeze = finality，那一击是致命的」；目前 `die()` 直接 recycle 偏「行政化」。
   - 落点：`Enemy.die` 前置一个短 `requestHitStop` + tween scale，再 recycle。注意与现有 hitStop 冷却协调。
   - 风险：中（与现有 hitStop/爆炸时序需联调，避免连环卡顿）。

8. **普通命中轻震 + 枪口微后坐**
   - 做什么：玩家主炮命中时极轻 shake（light 档 2px/60ms）+ 玩家机轻微后坐 2px。
   - 为什么：claudepluginhub「impact juice」「recoil on attacker」；让每次开火都有「力」的回馈。
   - 落点：bullet↔enemy overlap 回调命中时调 `shake('light')`；Player 加 2px yoyo tween。
   - 风险：低（注意节流，避免高射速下持续抖）。

9. **Boss / 战斗动态音乐**
   - 做什么：Boss 战 / 低血量时 BGM 切到更激烈段（或提速、加鼓点）。
   - 为什么：东方/Bullet Hell 音乐即反馈；CAVE「音乐反映关卡节奏」。
   - 落点：`AudioSystem` 扩展 `startBgm('boss'|'stage')` 两个 loop，事件切换。
   - 风险：中（需设计两段音乐素材或参数化，程序合成可行但工作量大）。

### P2 · 大工程 / 可选（谨慎评估 ROI）

10. **敌人受击 squash & stretch**：弹幕游戏敌人极小，形变效果有限，优先级低。
11. **击杀连击数 / 分数 popup 强化**：虫姬风格 BIG numbers，需配合分数系统设计。
12. **输入缓冲 / coyote**：飞行射击无平台跳跃，基本不适用，可忽略。

---

## 四、执行建议

- **下一步直接做 P0 四项**（伤害飘字 + 敌人 flinch + 全局音高随机 + 分级震动），单项均 < 2 小时、
  真测零 pageerror 即可交付，且全部零红线风险。这四项叠加，打击手感会从「能玩」跨到「上头」。
- 每项落地沿用本项目的纪律：**代码改动 → 配套 QA 探针真测（Playwright+系统Chrome 端口 5059）→
  零 pageerror → 中文 commit → 推送 + 修正本地 origin/main 指针**。
- 所有震动/闪屏/去饱和类效果，**务必给「减弱特效 / 无障碍」开关**，照顾光敏与低耐受玩家（业界共识）。
