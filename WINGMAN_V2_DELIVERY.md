# 苍穹战机 · 僚机 AI 进阶 第二版 交付文档

- **项目**：D:\WorkBuddy\sky-raiders（Vite 5 + Phaser 3.90，竖版飞行射击）
- **交付 commit**：`fd16be7307849080104ce705724801e3c185e2cb`
- **状态**：✅ **已推送** —— 真测 125/125 全绿，独立 QA 复验 PASS，远端历史零丢失（详见第六节）
- **远端**：https://github.com/EminCemNT/sky-raiders （main = `fd16be7`）
- **团队**：许清楚（需求）/ 高见远（架构）/ 寇豆码（实现）/ 严过关（QA）/ 齐活林（编排与把关）

---

## 一、本期做了什么

第一版的僚机只会"跟着飞 + 自动开火"，是个装饰品。第二版让它变成**有生命、有分工、能配合**的战斗单位，共三条链路：

### A · 独立生存
僚机不再无敌摆设，会被敌弹打掉、会自己回来。

- 敌弹 ↔ 僚机 overlap → 掉血 → HP 归零被击落（带爆炸特效）→ 延时 4 秒在玩家槽位重生
- 重生后有 900ms 无敌期（`INVULN_MS`），防止刚出生就被弹幕帧秒
- **僚机被击落不扣玩家血、不断玩家连击、不计入 `damageTaken`**（这条是红线，详见第三节）

### B · 战术分工 AI
1~4 架僚机按数量自动分配作战角色，不再是复读机。

| 角色 | 射速倍率 | 索敌方式 | 编队偏移倍率 | 定位 |
|---|---|---|---|---|
| suppress 压制 | ×1.0 | 最近敌人 | x1.0 / y1.0 | 稳定输出 |
| support 支援 | ×1.15 | 优先同元素敌人 | x0.8 / y1.2 | 高射速贴身 |
| flank 侧翼 | ×0.9 | 最近敌人 | x1.6 / y0.4 | 拉开横向覆盖面 |

分配表 `ROLE_BY_COUNT`：1 架纯压制；2 架压制+支援；3 架压制+支援+侧翼；4 架再补一个支援。角色变化会同步影响编队站位（偏移量乘以 `offMul`），视觉上能直接看出分工。

### C · 元素协同 combo
玩家与僚机**交替**命中同一元素，攒够次数触发全体增伤。

- 窗口 `WINDOW_MS` 1200ms 内，玩家↔僚机来源必须交替才计数（同一来源连打不累加）
- 中途换元素或超窗 → 链条重起
- 累计 **5 次**（`TRIGGER`）触发：全体伤害 **×1.35**，持续 3 秒，子弹染色提示
- 触发时广播 `EVENTS.WINGMAN_COMBO`，接入成就系统

新增 2 个成就：
- `combo_element_5` —— 单局触发 **3** 次元素协同
- `combo_element_50` —— 累计触发 **30** 次（跨局持久化，存档字段 `elementCombos`）

> **关于 id 与阈值不一致**：两个成就 id 里的数字 `5` / `50` 是**历史代号**，不代表阈值。
> id 是存档解锁记录的主键（`SaveManager.unlockAchievement(def.id)`），改 id 会让老玩家已解锁
> 记录失效并重复弹解锁提示，因此保持不变。**实际阈值一律以 `desc` / `condition` / `progress`
> 为准（3 次 / 30 次）。**
> 取值依据：`TRIGGER` 由 3 上调到 5 后，触发 N 次协同需要 5N 次交替命中。3 / 30 是按
> "改动前 15 / 150 次交替命中"精确还原的等价值 —— 玩家侧成本与上调 `TRIGGER` 之前完全一致。
> （上面第 3 条里的「累计 **5 次**（`TRIGGER`）触发」说的是单次协同的触发条件，与此无关。）

### 数值一览（`GameConfig.js` WINGMAN 段）

```
BASE_HP     : 1        RESPAWN_MS : 4000 (第一版 6000)
HIT_DMG     : 1        INVULN_MS  : 900   (新增)
COMBO.WINDOW_MS : 1200    COMBO.TRIGGER : 5
COMBO.BUFF_MS   : 3000    COMBO.DMG_MUL : 1.35    COMBO.MAX_COUNT : 9
```

### 改动文件

| 文件 | 改动 |
|---|---|
| `src/config/GameConfig.js` | WINGMAN 段扩充：HIT_DMG / INVULN_MS / ROLES / ROLE_BY_COUNT / COMBO |
| `src/entities/Wingman.js` | `invulnUntil` 字段、`setRole()`、takeDamage 无敌判定、respawn 写无敌期 |
| `src/systems/WingmanSystem.js` | `_deadCount` 维护、`_assignRoles()`、`reportHit()` combo 状态机、`getComboMul/Tint()`、`_tickRespawn()` |
| `src/scenes/GameScene.js` | `setupWingmanCollider()`、`wingmanHit()`、combo 事件转发、killBullet 池不变量 |
| `src/systems/AchievementManager.js` | 2 个新成就、`reportElementCombo()`、reset 一致性 |
| `src/entities/Player.js` | 仅 1 行视觉修正（贴图池不变量，见第二节 P1-2） |
| `src/utils/SaveManager.js` | 存档新增 `achievementStats.elementCombos` |

---

## 二、缺陷与修复全记录

本版一共经历 **3 轮缺陷收敛**。这一节值得细看——它说明了"自测全绿"为什么不等于"没问题"。

### 第 1 轮：实现者自查（寇豆码）

| 编号 | 缺陷 | 说明 |
|---|---|---|
| P0 | `byWingman` / `element` 在 killBullet 后被读取 | GameScene 的 playerBullets↔enemies 回调里，`registerKill` 与 `reportHit` 读的 `bullet.byWingman` 已被 `killBullet()` 复位成 false，导致**真实僚机击杀与元素协同永久丢失**。修复：回调开头先快照 `byWm/el/dmg`，再做后续处理。 |

### 第 2 轮：QA 独立审计（严过关）—— 在"38/38 自测全绿"下抓出 7 个

这轮最能说明问题：实现者自测全绿，QA 靠边界探测照样挖出 4 个 P1。

| 编号 | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| **P1-1** | `killBullet` 未复位 rotation | 僚机斜角弹回收后，主炮复用该对象会残留旋转，实测最大偏 43.5° | 末尾补 `b.setRotation(0)` |
| **P1-2** | `Player.fire` 不重设 texture | 主炮可能射出 `bullet_scatter` 的外观 | fire() 中按 key 判等 `setTexture`，且**必须置于读 `bw/bh` 之前**——否则"贴图错"会变成更隐蔽的"碰撞框错" |
| **P1-3** | 玩家阵亡后僚机仍被击落 | endGame 间隙 overlap 继续触发，结算画面背后还在放爆炸 | `wingmanHit` 首行 `if (!this.player \|\| !this.player.active) return;` |
| **P1-4** | `AchievementManager.reset()` 清理不全 | 只清了 `elementCombosRun`，重置后陈旧 run 计数会让刚清掉的成就**重新解锁** | 清全部 11 个 run 字段 + 重调 `loadCumulative()` |
| **P2-1** | 无敌期"免费护盾" | 先 killBullet 再 takeDamage，无敌期挡了血也吃掉了弹，违背"僚机不拦截弹幕"的设计红线 | 无敌判定提前到 killBullet **之前**，让敌弹真正穿过去 |
| **P2-2** | 重生点越界 | 玩家贴屏边时 `p.x + offset.x` 会把僚机生到屏外 | `Clamp(x, 18, 522)` / `Clamp(y, 40, 940)` |
| **P2-3** | combo 半常驻 | `TRIGGER: 3` 太低，"协同爆发"变成常态背景 | 交付总监拍板 `TRIGGER: 3 → 5`。**同口径对比**：真实波次 12s 占空比由约 **32%**（TRIGGER=3）降至约 **17%**（TRIGGER=5，4 次采样均值，单次波动 0~34%）；满接敌压力测试下仍接近常亮（93%→91%），属场景上限，不作为平衡指标 |

### 第 3 轮：交付总监磁盘核对（齐活林）

不照单全收实现者的"已全部修复"自报，逐行核对磁盘，结果：**产品代码 7 项全部属实、零返工**，但揪出两处测试侧遗漏——

| 编号 | 遗漏 | 危害 |
|---|---|---|
| T-1 | `test_wingman_v2.mjs:352` 断言期望值仍是 TRIGGER=3 时代的 `3200`（真值已变 `3400`） | `\|3400-3200\| = 200` 靠 210 容差侥幸通过，**余量只剩 10ms**，任何时序微调都会变成莫名其妙的假失败 |
| T-2 | `qa_probes/qa_probe_combo_chain.mjs:60` 循环仍是 `i < 3` | TRIGGER=5 后该探针永远走不到触发点，`activeUntil` 恒为 0，"验证真实链路能触发增益"这个核心目的**彻底失效** |

修复后实测真值 `activeUntilDelta = 3400`，容差收紧至 60；探针改投 5 发后实测 `mul: 1.35`、`activeUntil: 8392.8 > 0`，真实 overlap 链路确实把增益打了出来。

### 一个被推翻的误报

寇豆码曾报遗留风险 H2「旧 WingmanSystem destroy 后事件串台」。交付总监追链路后判定为**误报**，闭环完整：

```
GameScene:177  events.once('shutdown') → cleanup()
   cleanup()   → EventBus.off(WINGMAN_COMBO) + wingmanSystem.destroy()
     destroy() → EventBus.off(WINGMAN_DESTROYED / WINGMAN_RESPAWNED)
```

绑定与解绑均使用 `this._onDestroyed` / `this._onRespawned` 同一实例引用，`off` 能正确匹配摘除；而 `scene.start(RESULT)` 会先 shutdown 调用者，`cleanup` 必然执行。

---

## 三、兼容性红线（全程守护）

这几条一旦破了会造成难以察觉的连锁伤害，全程重点看守：

1. **`wingmanHit` 绝不调用 `playerHit`** —— 否则僚机挨打会计入 `stats.damageTaken`，误伤"无伤通关"成就，同时错误地扣玩家血、断玩家连击。
2. **`byWingman` / `element` 链路贯穿** —— 僚机重生后射出的第一发子弹仍须正确携带标记，否则击杀统计与元素协同静默丢失。
3. **`Player.js` 主战机手感零改动** —— 本版只放行了 1 行贴图池不变量修正，移动、射速、判定圈一律不动。
4. **池不变量** —— `killBullet` 必须无条件复位 `byWingman` / `clearTint()` / `setRotation(0)`；取弹时必须先 `setTexture` 再读尺寸算 body。
5. **僚机数硬上限 4，0 架静默降级** —— 0 架时 update / `_tickRespawn` / `reportHit` 全部安全短路，不空转、不抛错。

---

## 四、真测结论

原则：**build 通过 ≠ 运行不崩**。全部结论以 Playwright + 系统 Chrome 真跑为准（端口 5059；5060/5061 是 Chrome 不安全端口，会 `ERR_UNSAFE_PORT`）。

| 测试套件 | 断言数 | 结果 |
|---|---|---|
| `test_wingman_v2.mjs`（第二版：生存/分工/协同） | 65 | **65 通过 / 0 失败** |
| `test_wingman.mjs`（第一版兼容回归） | 45 | **45 通过 / 0 失败** |
| `test_achievements.mjs`（成就系统） | 15 | **15 通过 / 0 失败** |
| **合计** | **125** | **125 / 0** |

- 零 pageerror、零 console error、零 404（favicon 除外）——三套各自都有独立断言看守
- 上述结果由**交付总监亲自复跑**验证，非采信实现者自报

### 独立复验（严过关）—— **Verdict: PASS，可合并**

QA **独立重跑**了官方三套件（非采信实现者或交付总监的结论），同样 125/125 全绿、零 pageerror。在此之上做了行为级实证与主动找茬：

**7 项缺陷逐项行为实证**（读码不算数，全部实测行为）：

- P1-1 —— 回收池 rotation 非零计数 = 0；僚机斜弹 rotation ≈ -1.32 已被收口，主炮 rotation 全部为 0
- P1-2 —— 主炮贴图 = `bullet_pulse`，且 **body 尺寸按新贴图计算**：实测 6×19.6，匹配 pulse(10×28) 的 0.6/0.7 系数，且**不等于** scatter 误算值(8×0.6=4.8) —— 顺序陷阱确认未踩
- P1-3 —— 玩家阵亡后 5 发敌弹压身，僚机 alive=true、hp=3、`_deadCount`=0
- P1-4 —— reset 后 `wingman_first` 不被 `_checkLive` 复活，`wingmanKillsRun`=0
- P2-1 —— 无敌期敌弹**仍 active、不被消、hp 不变**（真穿过去了，不是"免费护盾"）；越过 900ms 后恢复常态
- P2-2 —— 玩家贴左缘(x=18)/右缘(x=522)重生均在屏内
- P2-3 —— **同口径**真实波次 12s 增益占空比由约 32%（TRIGGER=3）降至约 **17%**（TRIGGER=5，4 次采样均值，单次波动 0~34%）；满接敌压力场景下仍接近常亮（93%→91%），属场景上限、不作为平衡指标；5 次交替仍能触发，触发后 count 正确清零

**主动边界探测 5 组，零新缺陷**：

| 探测 | 结论 |
|---|---|
| 无敌窗口边界 | 900ms 精确：`t+899` 挡血 / `t+900` 边界即失效 / `t+901` 受伤；无敌期内 5 发连击 hp 不变 |
| `WINDOW_MS` 1200 断链 | 超窗(1300ms)后 count 正确重起为 1，不累加 |
| combo 激活期僚机全灭 | 增益为时间驱动，全灭后正常延续；全灭后 `reportHit` 不抛异常 |
| 角色动态重分配 | 1→2→3→4 角色序列精确，第 5 架被硬上限正确拦下 |
| **红线复查** | 僚机被击落时玩家 HP 100→100、`damageTaken`=0、连击不断 —— flawless 类成就不受污染 |

**H2 误报钉死**：QA 主动推翻了自己上一轮的错误判断（原以为旧 System 销毁后 `_deadCount` 应保持不变，实际 `destroy()` 会清零，是这个误解导致了误报）。行为实证：重开后旧 System `_deadCount`=0（已清零无悬挂），新局再击落 1 架，**旧 System 仍为 0（无泄漏 handler 自增）、新 System 精确 =1（无叠加成 2）**。确认无跨局串台、无内存泄漏。

**探针资产**：本次新增 `qa_probes/qa_probe_yanguoguan_final.mjs`（21 项行为断言，复验主探针）与 `qa_probe_inv_debug.mjs`（无敌窗口原始数值取证），已随交付入库，可作为后续回归资产复用。

---

## 五、遗留 / 第三版范围

| 项 | 说明 |
|---|---|
| D 域：导弹 / 激光僚机弹 | 第二版评估后主动排除，避免一次性引入过多弹种破坏平衡 |
| HUD 僚机状态指示 | 目前僚机 HP / 重生倒计时只能从画面观察，无 UI 呈现 |
| combo 视觉与数值精调 | 真实波次同口径占空比已由约 32% 降至约 17%（满接敌压力场景仍 ~91%，属场景上限），但 1.35 倍率与 3 秒时长仍可再打磨 |
| ~~**成就阈值需 PM 复评**（QA 提出）~~ **已闭环** | `TRIGGER: 3→5` 的连带影响：`combo_element_5` / `combo_element_50` 的交替命中成本被动上浮 67%（15→25 / 150→250 次）。PM 复评拍板**按算术精确还原**：target 5→**3**、50→**30**（3×5=15、30×5=150，与上调前等价）。`TRIGGER` 保持 5 不变，成就 id 保持不变（存档兼容）。已配套更新 `test_wingman_v2.mjs` 断言与 `qa_probe_yanguoguan_v2.mjs` 的 E2 守门口径 |
| 僚机 AI 进阶（第三版） | 走位规避、集火指令、护航模式 |
| 每日任务 / 教程引导 | 更早期就列入待办，一直未做 |

---

## 六、git 仓库与推送说明 ⚠️

**这一节请务必看，涉及一个不可逆操作的规避。**

第一版交付时本地 `.git` 对象库损坏（4 个 commit 对象丢失），当时用 `commit-tree`（**无父节点**）外科手术重建。后果是：**本地目前是一个孤立的 root commit，与远端 `EminCemNT/sky-raiders` 的 main 没有共同祖先。**

- 直接 `git push` → 会被拒（non-fast-forward）
- `git push --force` → 能推上去，但会**把远端 2026-07-29 那次的历史整个冲掉**

所以本次**不做 force push**。已准备无损方案，落地为脚本 `push_when_online.sh`：

```bash
# 思路：把远端 main 认作父节点，用当前工作树的 tree 重新生成 commit
#      内容一字不变，历史变成「远端历史 + 1 个新 commit」，push 是普通快进
git fetch origin main
TREE=$(git rev-parse HEAD^{tree})
NEW=$(git commit-tree $TREE -p origin/main -m "<原 commit message>")
git reset --hard $NEW
git push origin main        # 快进，无需 force，远端历史零丢失
```

脚本内置了 5 道安全检查：工作树干净校验、网络探测、共同祖先判断（若已是祖先则直接快进不嫁接）、**会丢失文件的差异预览**、嫁接后 tree 一致性校验（内容被改动则中止）。并保留回滚锚点。

用法：

```bash
bash push_when_online.sh          # 预演，只看差异不推送
bash push_when_online.sh --push   # 确认无误后执行
```

### 「断网」的真实原因（已解决）

一开始 `curl https://github.com` 一直返回 HTTP 000，判断为断网。实际排查下来根本不是网络问题：

```
HTTP_PROXY  = http://127.0.0.1:10793/
HTTPS_PROXY = http://127.0.0.1:10793/
WORKBUDDY_PROXY_SOURCE = system
→ 但 netstat 显示 10793 端口无任何进程监听（代理软件未启动）
```

所有出站请求都被导向一个不存在的代理，必然失败。**绕过代理直连 github.com 是 HTTP 200、0.35 秒。**

脚本因此增加了代理自动降级：先试代理，不通则自动改用直连，两者都不通才判定为真断网。顺带修掉脚本自身一个 bug —— `curl -w "%{http_code}"` 在内部重试时会输出 `000000` 这类拼接值，原先的字符串等值判断会漏判成"可达"，已改为模式匹配。

### 推送结果 ✅

```
=== 3. 共同祖先检查 ===   本地与远端无共同祖先 —— 执行嫁接
=== 4. 差异预览 ===       ✅ 无文件会丢失
=== 5. 改动规模 ===       27 files changed, 4279 insertions(+), 110 deletions(-)
=== 6. 执行嫁接 ===       新 commit fd16be7 (parent = 440b428)，tree 校验通过
=== 7. 推送 ===           440b428..fd16be7  main -> main   （快进，非 force）
```

推送后校验：

- 远端 `refs/heads/main` = `fd16be7307849080104ce705724801e3c185e2cb`
- 本地 `HEAD` == `FETCH_HEAD`，工作树干净
- 远端历史深度 1 → 2，原有的 `440b428「初始版本入库」`**完整保留**，本次成果作为新 commit 追加

恢复备份 `D:/WorkBuddy/sky-raiders-RECOVERY-BACKUP/` 仍在原处。推送已成功且校验通过，**确认无误后可自行回收**（脚本不会自动删）。
