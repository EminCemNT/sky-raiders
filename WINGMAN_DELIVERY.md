# 苍穹战机 · 僚机 AI 进阶 第一版 交付文档

> 提交：`5da0650`（本地 main，squash 合并；原实现 commit `852732c` 因 git 对象库损坏后重建）
> 测试：test_wingman.mjs 45 断言 + test_achievements.mjs 14 断言 + qa_probes/ P0 探针 4 项，均真测零 pageerror
> 状态：✅ 本地交付完成；⏳ push 待网络恢复（需 --force-with-lease，历史已重写）

---

## 一、本期做了什么

把原本「装饰性、左右排跟随、单发 pulse」的僚机，升级为**有编队、会躲弹、火力可成长**的智能僚机系统：

| 模块 | 文件 | 职责 |
|---|---|---|
| 僚机实体 | `src/entities/Wingman.js` | 继承 `Phaser.Physics.Arcade.Sprite`；编队插值 + 躲避偏移 + 开火节奏 + HP/受击/死亡骨架（role 恒 'suppress'，死亡/重生本期预留未接） |
| 僚机管理器 | `src/systems/WingmanSystem.js` | 读存档等级→数量(沿用 wingman.max=2)/编队槽位/武器等级；每 3 帧算共享快照（最近敌人 + 威胁弹列表）注入 `Wingman.update`；提供 `getGroup()`；0 架静默降级 |
| 场景接入 | `src/scenes/GameScene.js` | 删 `addWingman/updateWingmen`；`create()` 建 `wingmanSystem`；`update()` 调 `wingmanSystem.update`；新增 `spawnWingmanBullet`（复用 `playerBullets` 池，强制写 `byWingman=true` + `element`） |
| 配置 | `src/config/GameConfig.js` | 新增 `WINGMAN` 段（编队偏移表/各 weaponLv 参数）；升级项 `wingmanFirepower`（与数量项并存） |
| 机库 | `src/scenes/HangarScene.js` | `ORDER` 数组加 `wingmanFirepower` + 布局适配 |
| 存档 | `src/utils/SaveManager.js` | `upgrades.wingmanFirepower` 持久化 + 深合并兜底 + `load` 深合并 levelStars/achievements |

### 行为要点
- **编队**：1 架=后侧单点，2 架=对称槽位（由 `WINGMAN.FORMATIONS` 配置，非硬编码 ±48）。
- **智能走位**：排斥力场——每 3 帧筛威胁弹（仅 y<僚机.y 且平方距<120²、上限 4 颗、不开方剪枝），合成 `dodgeVec` 钳制 ±40px 叠加到编队目标点，仍走 `Linear 0.15`；僚机不脱离玩家 X 轴 ±屏宽 1/3。
- **火力进化**：僚机弹随 `weaponLv` 分级——0 单发脉冲 / 1 散射(2-3 路) / 2 穿透(穿过 1 敌，`_lastHit` 去重) / 3 元素弹(继承玩家元素、更高伤)。DPS 提升 ≤ 主武器同级 60%。

---

## 二、QA 独立审计（严过关）抓出的缺陷与修复

| 严重度 | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| **P0** | `wingman_50` 累计虚高且持久化不可逆 | `killBullet()` 复位漏 `b.byWingman`，僚机弹回收复用给主炮时脏标残留 → 主炮击杀误计僚机 | `killBullet` 补 `b.byWingman = false` |
| **P0** | 主炮哑火 | `recycleBullets()` 玩家子弹只判 `y < -30`，僚机朝下弹永不回收 → `playerBullets` 池(200)耗尽 | 改四边界剔除（`y<-30 \|\| y>H+30 \|\| x<-30 \|\| x>W+30`） |
| P2 | 老存档可能写脏 DEFAULT_SAVE | `SaveManager.load` 深合并未覆盖 `levelStars`/`achievements` | 补深拷贝兜底 |

> 注：P0 恰好是 coder 自测 38/38 全绿的盲区——自测未断言「僚机弹回收后 `byWingman` 复位」，也未按「僚机朝下发射」路径跑。主理人复跑综合套件后由 QA 走查锁定。

---

## 三、兼容性红线（已全程守护）
- ✅ `Player.js` 零改动，玩家主战机手感/逻辑不动。
- ✅ `spawnWingmanBullet` 与所有僚机弹 `b.byWingman=true` + `b.element=玩家元素`，`registerKill → AchievementManager.reportKill` 链路未动（`wingman_50`/`wingman_first`/`element_*` 统计口径不变）。
- ✅ 僚机数硬上限 4；子弹复用 `playerBullets` 现有池，不新建组、不新建 Timer；每帧新增开销 ≤ 4 实体 update + 每 3 帧一次威胁筛选。
- ✅ 0 架僚机时全部新逻辑静默降级，不报错不空转。

---

## 四、真测结论
- `test_wingman.mjs`：45/45 通过，零 pageerror / 零 console error / 零 404。
- `test_achievements.mjs`：14/14 通过（成就链路回归无退化）。
- `qa_probes/`：P0 探针 `qa_probe_byWingman`（主炮不误计）、`qa_probe_bulletleak`（池不耗尽）、`qa_probe_formation34`（编队重排）、`qa_probe_wingman50`（成就回归）全转 PASS。

---

## 五、遗留 / 第二版范围
- 独立生存：僚机有 HP、可被敌弹击落、自动重生（`Wingman.takeDamage/die/respawn` 骨架已预留，待接 overlap）。
- 战术分工 AI：多僚机 role 调度（压制/支援/绕后）+ 元素协同 combo 成就。
- 僚机弹进阶：导弹 / 激光僚机弹（W3）。
- 机库 UI 细节打磨（火力升级数值展示）。

---

## 六、git 仓库修复说明（本次额外处置）
本地 `.git` 对象库损坏（4 个 commit 对象丢失），主理人用纯 git 命令外科手术式重建：清空索引 → 全量重新哈希工作树 → `write-tree` → `commit-tree`（无父）→ `reset --hard` 指向新提交 `5da0650`。全程未删 `.git`（沙箱禁止批量删除），旧丢失对象仅变为无害悬空。保全备份在 `D:/WorkBuddy/sky-raiders-RECOVERY-BACKUP/`（push 成功后可回收）。
