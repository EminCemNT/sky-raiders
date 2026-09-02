# OPT-16 产品体验批 C1–C11 实现规格（架构方案 · 开发/QA 引用版）

> 作者：高见远（arch-opt / 架构师）｜日期：2026-09-01
> 状态：**待开发实现**（产品体验轮产出，建议按 PM 优先级分批）
> 范围：C1-C11 产品体验项（难度门禁 / 昵称编辑器 / 战后复盘 / 存档导出导入 / 每日种子挑战 / 暂停重开 / 移动端震动 / 存档清除 / 战术提示 / Boss 高难终局改型 / 第 4 架战机）——全部**函数级实现规格**，供 coder-opt 直接照做、qa-opt 验收。
> 代码基线：HEAD = d455af6（OPT-16 技术快赢批 T1–T12 已推送）。工作树干净。只出规格，不改任何代码。
> 引用说明：worker 以本文件为唯一实现规格来源；正文完整、无「见其他文档」引用（行号为当前基线核对值，开发以实际为准）。
> 存档纪律：SaveManager 旧字段语义**全部保留、零改动**；仅 C5 新增 `dailyChallenge`、C7 新增 `haptics`（append-only）；C2 复用既有 `nickname`；C4/C8 走独立文件 `SaveTransfer.js`（SaveSanitizer 先例，只调公开 API）；C1/C3/C6/C9/C10/C11 零存档改动。

---

## 〇、红线总览（十一项逐一确认）

| 红线项 | 结论 |
|---|---|
| `GameConfig.js` `WINGMAN.COMBO` 五字段 | **零触碰**。C1–C11 均不读写该块。 |
| `AchievementManager.js` 26 个成就 id | **零改动**。C1–C11 不新增/修改任何成就 id/condition/progress；C5 每日挑战奖励走金币，不产出新成就；C10/C11 不新增成就来源。 |
| `WingmanSystem.js` | **零触碰**。 |
| `FloatingText.js` | 只允许附加式新增浮字/横幅（C3/C9 提示类），**不改既有 damageNumber 行为**。 |
| `SaveManager.js` 旧字段语义 | **全部保留**；C1–C11 仅 C5 新增 `dailyChallenge`、C7 新增 `haptics`（append-only）；C2 复用既有 `nickname`；C4/C8 独立文件（SaveTransfer.js，只调 `load()/save()/set()/flushNow()` 公开 API）。SaveManager.js diff 允许为「仅 DEFAULT_SAVE + load() 深合并处 append 两个新字段」的最小改动。 |
| 既有系统（四档难度/元素/擦弹/过载/爬塔/周赛/勋章/救济局/BossRush/事件/每日任务/新手计划） | **全部保留、零回归**；C1 只读 `selectedDifficulty`/`countMedals()`；C5/C6 用「独立结算域/局内重进」附加式接入；C10 只追加 pattern；C11 只追加 SHIPS 条目。 |
| 零外部资源 | 全部程序内改动；**零图片/音频/网络/字体**；C7 只用 `navigator.vibrate`（标准 Web API）。 |
| 存量玩家进度 / 存档兼容 | **默认不改变**。C1 存量豁免（已选 hard/hell 不回退）；C11 存量默认免费可选第 4 架。 |
| 性能纪律 | 本批均为静态面板 / 低频事件 / 一次性数据操作；C7 震动不参与渲染；C10 pattern 沿用狂暴降级（low 档密度减半）；无新增每帧热点。 |
| reduced-motion | 新增动效（C9 提示淡入 / C10 形态切换）在 prefers-reduced-motion 下为静态；C7 震动与视觉解耦（PM 默认假设）。 |
| i18n | 所有新增用户可见文案走 `t(key, params)`（zh/en 双语 append-only，zh 值=原文逐字等价；缺词条回退 zh/原 key）。 |

> 检查方式：开发 PR 自检 + QA 回归（尤其：`WINGMAN.COMBO` 未改、成就 id 集合未变、`WingmanSystem.js` / `FloatingText.js` diff 为空、SaveManager 旧字段写入点未变、C1 存量豁免、C10 狂暴共存性专项断言）。

---

## 一、实现顺序表（推荐，按 PM 优先级 P0→P2 分批；任意子集可直接开发）

| 顺序 | 条目 | PM 优先级 | 理由 |
|---|---|---|---|
| 1 | C3 战后复盘 | P0 | 纯展示零业务，改动面最小（ResultScene + GameScene payload 只读字段），先立标杆 |
| 2 | C2 昵称编辑器 | P0 | 纯 UI，复用既有 nickname，独立（MenuScene 设置面板 + Locale） |
| 3 | C9 主菜单轮换战术提示 | P0 | 纯展示零业务，独立（MenuScene + GameConfig 数组 + Locale） |
| 4 | C6 暂停面板重开本局 | P0 | 流程 QoL，局内操作（UIScene + GameScene 重进参数透传） |
| 5 | C1 难度门禁 | P1 | 半业务，依赖 countMedals/MEDALS.THRESHOLD（只读），MenuScene 拦截 + i18n |
| 6 | C4 存档导出/导入 | P1 | 工具类，独立文件 SaveTransfer.js（C8 同文件扩展） |
| 7 | C8 存档清除 | P1 | 依赖 C4 的 SaveTransfer 框架 + 强确认弹窗 |
| 8 | C7 移动端震动 | P1 | SaveManager append `haptics` + 事件点接入（低频、不参与渲染） |
| 9 | C5 每日种子挑战 | P1 | 半业务：SaveManager append `dailyChallenge` + 独立结算域 + 种子复用 `_dailySeed` |
| 10 | C11 第 4 架战机 | P2 | 内容新增：SHIPS/SHIP_SKINS/TextureFactory/Locale 四处 append |
| 11 | C10 Boss 高难终局（改型方案 A） | P2 | **最高风险**，依赖 Boss.js 既有 pattern 表 append + 狂暴共存评审，最后做 |

---

## 第 C3 条：战后复盘（结算页详情补全 · 纯展示零业务）

### 背景 / 目标
ResultScene 已显示 分数/击杀/金币/波次/勋章/新成就/连击峰值（数据行 `lines` L119-160、动态下移 L161-176）；GameScene 局内已累计 `stats.kills/coins/damageTaken`、`grazeCount`（L84）、`maxCombo`（L69）、`_levelStartTime`（L126），但结算 payload（L2616-2639）**未透传** grazeCount / 局时长 / 受击。

**目标**：结算 payload 追加只读字段；ResultScene 数据行区追加「擦弹/局时长/受击」详情行（纯展示，零业务、零存档、零判定影响）。

### 改动文件 + 函数签名
- `src/scenes/GameScene.js` — `endGame(victory)` 结算 payload（L2616 起）追加 3 个只读字段
- `src/scenes/ResultScene.js` — `buildResult(r)` 数据行数组（L119-160）追加 3 行；新增私有 `_fmtDuration(ms)`
- `src/config/Locale.js` — 新增词条（append-only，zh/en）

```js
// GameScene.js endGame payload 追加（只读透传，不入存档）
grazes: this.grazeCount || 0,          // 本局擦弹数（与 HUD 一致）
elapsedMs: Math.max(0, this.time.now - (this._levelStartTime || this.time.now)), // 局时长 ms
damageTaken: this.stats.damageTaken || 0, // 本局受击次数（Player.hit 每次 +dmg，见 stats）

// ResultScene.js buildResult 内新增私有方法
_fmtDuration(ms) {                      // 95_000 → '1:35'；<1min → '0:42'
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// lines 数组追加（放在 resBest 之前，普通关/无尽/活动均显示；normal 勋章判定行保持既有条件渲染）
lines.push({ label: t('resGrazes'), value: r.grazes || 0 });
lines.push({ label: t('resTime'),   value: this._fmtDuration(r.elapsedMs) });
lines.push({ label: t('resHits'),   value: r.damageTaken || 0 });
```

### 精确语义
- **数据行只追加**：新增 3 行插入到 `lines.push({ label: t('resBest') ...})`（L160）**之前**，与既有行同格式 `{label, value}`；完成度条/连击面板/按钮 Y 已按 `lines.length` 动态下移（L172-175），行数增加自动让位，**零布局冲突**。
- **Boss 击杀数**：PM 文案「如已有统计」——经核对 endGame payload 无局内 Boss 击杀计数（`bossesDefeated` 为累计存档、非本局），**本批不新增**该行（避免造新统计语义），详情区为 擦弹/局时长/受击 三行。
- **mode 差异**：无尽模式既有 `resWave`/`resTowerFloor` 行保留；普通关胜利的勋章判定行（L153-159）保留；新增 3 行全模式一致（擦弹/时长/受击在任何模式都有语义）。
- **时长口径**：`elapsedMs = time.now - _levelStartTime`（`_levelStartTime` 在 create L126 置为开局时刻）；`damageTaken` 为 `stats.damageTaken`（Player 实际受击累加，护盾吸收/无敌穿过不累加，见 L2277-2285）——与 HUD/成就同口径，纯展示。
- **零业务**：本方法只读 payload 与布局；不触发结算/排行/成就/勋章，不入存档。

### 参数表（append-only）
见上方 3 个 payload 字段（只读，非存档）；无新增配置。
i18n 词条（zh/en）：`resGrazes`=擦弹 / Grazes；`resTime`=局时长 / Time；`resHits`=受击 / Hits Taken。

### 降级策略
- **reduced-motion / 性能三档**：N/A（静态文本行）。
- **en**：词条走 Locale append-only；缺词条回退 zh（PM 附录 B 已列）。

### 风险与回归点
- **布局遮挡**：行数 +3 后 `barY/comboY/btnY` 自动下移 → 常规关 3→6 行（endless 5→8 行）仍 < 屏幕高（GAME_HEIGHT=960，dataStartY=400 + 8×40=720 + 按钮 ~240 → 可控）。QA 在 无尽/普通/活动 三种结算页断言按钮可点、不越界。
- **payload 兼容**：ResultScene 旧调用（如分享钩子直接 buildShareCard）不依赖新增字段 → 缺省 `|| 0` 兜底，零回归。
- 回归：既有数据行、连击面板、完成度条、分享卡、按钮回调行为不变。

### 探针建议
- `qa_probes/test_prod_c3.mjs`：mock GameScene stats（grazeCount=37/_levelStartTime 前移 95s/damageTaken=3）→ endGame → 断言 ResultScene 详情文本含 `擦弹 37`、`1:35`、`受击 3`；切 en 断言英文；断言 SaveManager diff 为空（无新字段写入）。

---

## 第 C2 条：昵称编辑器（设置面板自定义昵称 · 复用既有 nickname）

### 背景 / 目标
现状：`SaveManager.nickname = ''` 默认空（SaveManager L86/load L230 仅字符串有效），ResultScene `_resolveNickname()`（L289-298）在分享卡生成时写「飞行员·随机后缀」；**无用户编辑入口**。ResultScene 分享卡/结算已显示昵称（buildShareCard L371-374/copyShareText 均读 nickname）——保存新昵称后此链路自动生效。

**目标**：MenuScene 设置面板新增「昵称」编辑入口：点击 → 文本输入（纯本地，无后端）→ 校验（1–12 字符，中文/字母/数字/下划线/短横线）→ 写入既有 `nickname` → 结算/分享卡立即生效。昵称本身不翻译。

### 改动文件 + 函数签名
- `src/scenes/MenuScene.js` — `openSettings()` 追加昵称行（建议放语言行 L352 之后 / 触控行附近，或音量行之前空位）；新增 `_openNicknameEditor(ov, cx)` 与 `_validateNickname(raw)`
- `src/config/Locale.js` — 新增词条（append-only）
- `src/scenes/ResultScene.js` — `_resolveNickname()` 保持（昵称非空即用用户值，零改动）——**不新增逻辑**，仅核对既有 `_resolveNickname` 已满足 C2.3/C2.4。

```js
// MenuScene.js
_validateNickname(raw) {
  // 返回 { ok:true, value } 或 { ok:false, reason:'len'|'char' }
  const v = String(raw == null ? '' : raw).trim();
  if (v.length < 1 || v.length > 12) return { ok: false, reason: 'len' };
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(v)) return { ok: false, reason: 'char' };
  return { ok: true, value: v };
}
_openNicknameEditor() {
  // 弹半透明浮层（复用 openSettings 的 addPanel/fadeInPanel 体例）：
  //   1) addPanel(ov, cx) + 标题 t('nicknameEdit')
  //   2) 输入框：Phaser 文本交互最小实现 = DOM <input> 覆盖（本项目纯本地单机，
  //      与 ResultScene 分享卡 download/clipboard 的 DOM 使用同权限面；无网络）
  //      或 NeonButton 键盘式简易输入（若主理人偏好纯 Canvas，见降级策略）
  //   3) 确定按钮：_validateNickname → 合法则 SaveManager.set('nickname', value) + 关闭 + flashToast(t('saveOk'))
  //      非法则 flashToast(t('nicknameLenErr', {n:12}) / t('nicknameCharErr'))
  //   4) 取消按钮：不改存档
}
```

### 精确语义
- **入口位置**：设置面板内新增一行（标签 `t('nicknameEdit')` + 当前值展示 `nickname==='' ? t('nicknameDefault')+随机后缀展示规则 : nickname` + 编辑按钮）。**展示当前值**：空值显示「飞行员·随机后缀」（与结算页回退规则一致，纯展示不写档）；用户已设置则显示其昵称。
- **校验规则**：`trim` 后 1–12 字符；字符集 `中文字母数字_-`（PM 假设；如需改字符集只改正则，不改框架）。非法 → 拒绝写入并提示，`nickname` 不变（C2.2）。
- **写入**：合法 → `SaveManager.set('nickname', value)`（load() 深合并 + save 脏标记写盘，L230 语义保留）；面板展示更新。
- **零新增存档字段**：复用既有 `nickname`（append-only 字段语义不变）。
- **不做**：清空回默认按钮（C8 重置覆盖）、敏感词/后端/重名检测、昵称参与数值/排序（PM 边界）。

### 参数表（append-only）
i18n 词条（zh/en）：`nicknameEdit`=编辑昵称 / Edit Nickname；`nicknamePlaceholder`=输入昵称… / Enter nickname…；`nicknameLenErr`=昵称需 1–{n} 个字符 / Nickname must be 1–{n} chars；`nicknameCharErr`=含不支持的字符 / Unsupported characters；`saveOk`=已保存 / Saved。

### 降级策略
- **DOM 输入 vs 纯 Canvas**：推荐 DOM `<input>` overlay（移动端虚拟键盘自动弹出，交互成本最低）。若环境禁用 DOM（纯 Canvas 纪律），备选 NeonButton 字母表输入（成本高，需主理人拍板）——本批规格默认 DOM，仅在实现受阻时回退方案并通知 team-lead。
- **reduced-motion / 性能三档**：N/A（静态输入面板）。
- **en**：界面文案双语；昵称原样显示不翻译（C2.5）。

### 风险与回归点
- **输入框焦点**：DOM input 与 Phaser 场景共存需防键盘监听冲突（ESC/Enter 处理）——确认保存后移除 DOM 节点；QA 真机/桌面分别验证。
- **默认昵称回退**：`_resolveNickname` 在 ResultScene 仍写随机后缀**仅当 nickname 为空**；用户设置后走用户值。QA 断言 C2.3/C2.4。
- 回归：分享卡/结算昵称行、`_rollLastScore`/`_resolveTitle` 不变；SaveManager 既有 nickname 读写不变。

### 探针建议
- `qa_probes/test_prod_c2.mjs`：设置面板触发昵称编辑 → 输入「阿飞」→ 断言 `SaveManager.load().nickname==='阿飞'`；输入超长/非法字符 → 断言拒绝且值不变；清空 nickname → buildShareCard 显示默认「飞行员·NN」；切 en 断言界面英文。

---

## 第 C9 条：主菜单轮换战术提示（纯展示零业务）

### 背景 / 目标
现状：主菜单底部只有 controlsHint（MenuScene L191-194，`GAME_HEIGHT-20`）与版本号；无战术 tips。存档 `tutorialDone`（SaveManager L34）区分新手/老玩家。

**目标**：MenuScene 新增一条轮换战术提示：每次进菜单按 `tutorialDone` 从对应 tips 池取一条（相邻不重复），可点击「下一条」手动换；纯展示，不加奖励/状态，不挡按钮。

### 改动文件 + 函数签名
- `src/config/GameConfig.js` — 新增 `TIPS` 配置块（append-only）
- `src/scenes/MenuScene.js` — `create()` 追加 tips 行与轮换状态；新增 `_renderTip()` / `_pickTip(forceNext)`
- `src/config/Locale.js` — 新增 `tip_*` 词条（zh/en，约 8+8 条，PM 附录 B 示例）

```js
// GameConfig.js 新增（append-only）
export const TIPS = {
  novice:   ['tip_nov_mov', 'tip_nov_shot', 'tip_nov_focus', 'tip_nov_bomb', 'tip_nov_shield', 'tip_nov_power', 'tip_nov_graze', 'tip_nov_coin'],   // 基础池（tutorialDone=false）
  advanced: ['tip_adv_grazeEnergy', 'tip_adv_combo', 'tip_adv_element', 'tip_adv_magnet', 'tip_adv_tower', 'tip_adv_medal', 'tip_adv_overcharge', 'tip_adv_skill'], // 进阶池
};

// MenuScene.js
_renderTip() {
  const s = SaveManager.load();
  const poolKey = s.tutorialDone ? 'advanced' : 'novice';
  const pool = (TIPS[poolKey] || []);
  if (!pool.length) { if (this.tipText) this.tipText.setVisible(false); return; }  // C9.5 空池静默
  const prev = this._lastTipKey;
  let idx = (this._tipIdx == null) ? Math.floor(Math.random() * pool.length) : this._tipIdx;
  // 相邻不重复（C9.3）：随机取，若与上次相同则顺移 1
  const key = pool[idx];
  this._tipIdx = (key === prev) ? (idx + 1) % pool.length : idx;
  this._lastTipKey = pool[this._tipIdx];
  const txt = t(this._lastTipKey);
  if (!txt || txt === this._lastTipKey) { /* 词条缺失 → 静默隐藏 */ }
  this.tipText.setText(txt).setVisible(true);
}
_nextTip() { this._tipIdx = ((this._tipIdx == null ? 0 : this._tipIdx) + 1) % pool.length; this._renderTip(); }
```

### 精确语义
- **布局**：tips 行放主菜单标题下方空隙（建议 y≈318，标题/副标题 L50-63 之下、图鉴按钮 L74 之上）或存档信息（GAME_HEIGHT-44）与 controlsHint（GAME_HEIGHT-20）之间空隙；**不遮挡**按钮（主按钮 y=480 起）与 controlsHint/版本号。带一个「下一条」小按钮（NeonButton 小号 或 点击 tips 文本）。
- **分流**：`tutorialDone=false` → novice 池；`true` → advanced 池（C9.1/C9.2）。只读 `SaveManager.load().tutorialDone`，不写档。
- **轮换**：每次进入菜单随机一条且与上次不同（`_lastTipKey` 会话级即可）；可点击下一条顺序换（C9.3）。
- **静默降级**：空池 / 词条缺失 → 隐藏该行不报错，不影响其它 UI（C9.5）。
- **入场动画**：淡入动画 reduced-motion 下为静态文本；FloatingText 不参与（纯场景文本，避免触碰红线）。

### 参数表（append-only）
`TIPS` 块（数组 key 列表）+ `tip_*` 词条（zh/en）。文案长度建议 ≤ 22 字/行（GAME_WIDTH 内一行）。

### 降级策略
- **reduced-motion**：入场淡入省略（直接静态显示）。
- **性能三档**：N/A（单文本 + 单按钮，非每帧）。
- **en**：词条双语；缺词条回退 zh/key。

### 风险与回归点
- **布局冲突**：新增行不得与既有按钮重叠——QA 在 900×960 / 小屏宽度断言无遮挡。
- **词条缺失**：静默隐藏（C9.5），不弹错。
- 回归：主菜单全部按钮、controlsHint、版本号、存档信息行不变。

### 探针建议
- `qa_probes/test_prod_c9.mjs`：新档（tutorialDone=false）进菜单 → 断言显示 novice 池词条；置 tutorialDone=true → 重进断言 advanced 池；点击下一条 → 断言文案变化；mock 空池 → 断言隐藏且无 console 报错；切 en 断言英文。

---

## 第 C6 条：暂停面板「重开本局」（QoL · 局内重进）

### 背景 / 目标
现状：暂停面板只有「继续/退出/判定点开关」（UIScene pauseOverlay L207-225：resume y=440 / quit y=530 / hitbox y=620），无重开；退出回菜单再手动进关是唯一路径。

**目标**：暂停面板新增「重开本局」按钮（放「继续」下方、quit 上方，建议 y≈485）→ 二次确认 → 以**与本局相同参数**重进 GameScene（levelId/mode/eventCfg/救济 session 覆盖/机体皮肤），等同「Quit 后手动 Start」但一次点击完成。重开为主动放弃：不累计 failStreak、不触发救济提示、不写结算/排行/成就；金币本局已收集不保留。

### 改动文件 + 函数签名
- `src/scenes/UIScene.js` — `create()` 暂停面板加「重开本局」按钮 + `_restartLevel()`；新增 `_confirmRestart()` 二次确认弹窗
- `src/scenes/GameScene.js` — 新增公开方法 `getRunParams()`（供 UIScene 读当前 run 参数）；`init(data)` 保持参数语义（重进复用同 data）

```js
// UIScene.js pauseOverlay 内（resumeBtn y=440 之下）
const restartBtn = this.makePauseButton(GAME_WIDTH / 2, 485, t('uiRestart'), () => this._confirmRestart());
this.pauseOverlay.add([dim, pTitle, resumeBtn, restartBtn, quitBtn, hbBtn.container]);

_confirmRestart() {
  // 二次确认：半透明确认容器（同 _flashToast/addPanel 风格，静态文本 + 确定/取消）
  //   title: t('restartConfirmTitle')  desc: t('restartConfirmDesc')  确定: 执行 _doRestart() 取消: 关闭容器
}
_doRestart() {
  const g = this.scene.get(SCENES.GAME);
  if (!g || !g.getRunParams) return;
  const params = g.getRunParams();          // { mode, levelId, eventCfg? 由 mode 隐含, ... }
  this._paused = false;
  this.pauseOverlay.setVisible(false);
  this.scene.stop(SCENES.UI);
  this.scene.stop(SCENES.GAME);
  transition.goto(this, SCENES.GAME, params, { /* 淡入淡出与 quit 一致 */ });
}

// GameScene.js 新增
getRunParams() {
  // 以与本局相同参数重进（C6.2/C6.3/C6.4）：
  return {
    mode: this.mode,                     // 'normal' | 'endless' | 'bossrush' | 'coin_rush' | 'survival' | 'daily'(C5)
    levelId: this.levelId,
    // A9 救济局（C6.4）：session 覆盖保留 → init 恢复 _reliefRun/_reliefCombatMul/_reliefAtkPicked
    reliefRun: !!this._reliefRun,
    reliefCombatMul: this._reliefCombatMul || null,
    reliefAtkPicked: !!this._reliefAtkPicked,
    // 机体/皮肤由 SaveManager.selectedShip/skins 在 GameScene.create 重新读取（与 Quit 后 Start 等价）
  };
}
```

### 精确语义
- **参数透传**：GameScene.create 读取 `SaveManager.selectedShip`/皮肤（L191-217）→ 重开自动同机体皮肤，**无需**在 params 里带 ship（与 Quit→Start 行为一致）。
- **救济保留（C6.4）**：重开 payload 带 `reliefRun/reliefCombatMul/reliefAtkPicked`；`init(data)` 需在救济相关状态初始化处（L104-116）读取恢复：
  ```js
  // GameScene.init 救济状态恢复（append-only 读取，不影响正常进入=全 false/null）
  this._reliefRun = !!(data && data.reliefRun);
  this._reliefCombatMul = (data && data.reliefCombatMul) || null;
  this._reliefAtkPicked = !!(data && data.reliefAtkPicked);
  ```
  救济面板弹窗（create 中按 failStreak 判定）仅在新局判定时触发；重开带 relief 标记则跳过重复弹窗（实现：`_reliefRun` 初始为 true 时 `_reliefEligible` 仍按 failStreak 判定，但若 `_reliefRun` 已 true 不重复弹面板）。
- **不计 failStreak**：重开是主动放弃 → `_shouldRecordPersist()` 不因重开触发（重开根本不进 endGame）；无「死亡失败」计数。C6.5 取消 → 返回暂停，无状态改变。
- **确认文案**：`restartConfirmTitle`/`restartConfirmDesc`（本局进度将丢失，确定重开？）；静态面板，reduced-motion N/A。
- **不做**：检查点软重开、回到上一波（PM 边界）。

### 参数表（append-only）
i18n 词条（zh/en）：`uiRestart`=重开本局 / Restart Run；`restartConfirmTitle`=重开本局？/ Restart Run?；`restartConfirmDesc`=本局进度将丢失，确定重开？/ Progress will be lost. Restart?；`restartCancel`=取消 / Cancel。

### 降级策略
- **reduced-motion / 性能三档**：N/A（静态按钮/确认面板 + 一次场景切换）。
- **无 GameScene**：`scene.get` 返回空或方法缺失 → 静默返回（防御）。

### 风险与回归点
- **暂停状态**：重开前必须复位 `_paused=false` + 隐藏 overlay + stop 两个场景，否则 HUD 残留暂停态；QA 重开后断言 HUD 恢复。
- **救济双弹**：若 init 恢复 `_reliefRun` 后 create 又判定 eligible 弹面板 → 需在救济弹窗逻辑加「已 reliefRun 不弹」。QA 专测救济局重开（C6.4）。
- **活动/无尽**：endless 重开 = 从第 1 波开始（与 Quit→Start 等价）；event mode 由 mode 隐含 eventCfg。
- 回归：「继续/退出/判定点开关」行为不变；键盘 P/ESC 暂停不变；UIScene bindEvents/探针 `__PAUSE` 不变。

### 探针建议
- `qa_probes/test_prod_c6.mjs`：进入 normal L2 standard 战斗 → 暂停 → 重开 → 确认 → 断言 GameScene 以 levelId=2/mode=normal 重启、命/能量回初始；endless 重开从 wave1；救济局（failStreak≥3 接受 A）→ 暂停重开 → 断言 `_reliefRun` 保留且不重复弹面板；取消 → 断言本局继续、无写盘。

---

## 第 C1 条：难度门禁（勋章阈值解锁困难/地狱）

### 背景 / 目标
现状：`MEDALS.THRESHOLD=6`（GameConfig L779）；MenuScene 关卡选择面板已显示「累计勋章+高难解锁提示」（L493-507，仅展示）；设置面板四档难度当前**全部可自由点击**（L271-283，onDown 直接 `SaveManager.set('selectedDifficulty', d.id)` L277）。

**目标**：把「展示」补成「选择闭环」——`countMedals() < MEDALS.THRESHOLD` 时点击「困难/地狱」拦截并弹提示（含还差几枚 + 可跳关卡面板）；`>= THRESHOLD` 正常可选。**存量豁免**：老存档已选 hard/hell 不回退（C1.3）；休闲/标准永不拦截（C1.4）。门禁只作用于设置面板手动选择。

### 改动文件 + 函数签名
- `src/scenes/MenuScene.js` — 难度按钮 onDown 改走 `_trySelectDifficulty(id)`；新增 `_trySelectDifficulty(id)` / `_showDiffLocked(need)`（弹提示 + 「去关卡面板」跳转）
- `src/config/Locale.js` — 新增词条（append-only）

```js
// MenuScene.js 难度按钮 onDown（L275-279）改造：
// 原：audio.sfx('ui'); SaveManager.set('selectedDifficulty', d.id); this.refreshDifficultySelect();
// 新：
onDown: () => { this._trySelectDifficulty(d.id); },

_trySelectDifficulty(id) {
  audio.sfx('ui');
  if (id === 'hard' || id === 'hell') {
    const total = SaveManager.countMedals();        // 派生重算（SaveManager L539，只读）
    if (total < MEDALS.THRESHOLD) { this._showDiffLocked(MEDALS.THRESHOLD - total); return; }  // 拦截
  }
  SaveManager.set('selectedDifficulty', id);        // 正常写入（与现状一致）
  this.refreshDifficultySelect();
},
_showDiffLocked(need) {
  // 半透明提示容器（同 addPanel/fadeInPanel 风格）：
  //   标题 t('diffLockedTitle')；正文 t('diffLockedNeed', { n: need })；
  //   主按钮「去关卡面板看勋章目标」t('diffLockedHint') → closeSettings + openLevelSelect()（L422）；
  //   次按钮「知道了」→ 关闭提示。
  // 不改 selectedDifficulty；当前选中档高亮不变（refreshDifficultySelect 未调用）。
}
```

### 精确语义
- **门禁判定**：只对 `hard`/`hell` 拦截；`casual`/`standard` 任意勋章数可点（C1.4）。
- **勋章口径**：`SaveManager.countMedals()`（L539，实时从 levelMedals 重算派生 medalCount 并自愈）——与关卡面板提示（L495）同一来源，同口径。
- **存量豁免（C1.3）**：`_trySelectDifficulty` 只拦**新点击**；老存档 `selectedDifficulty='hard'` 已存 → `refreshDifficultySelect()`（L401-404）照常高亮 hard，进入战斗按 hard 系数（`create` L137 只读）——零改动既有读取路径。
- **提示内容**：标题「高难未解锁」+ 正文「集齐 {n} 枚勋章解锁高难」+ 主按钮跳关卡面板（closeSettings 后 openLevelSelect，让玩家看勋章目标行 L493-507）；次按钮关闭。
- **救济局无关**：A9 救济局 session 覆盖（_reliefCombatMul）与本门禁无关（PM 边界）；门禁只拦截设置面板手动选择。

### 参数表（append-only）
i18n 词条（zh/en）：`diffLockedTitle`=高难未解锁 / Hard modes locked；`diffLockedNeed`=集齐 {n} 枚勋章解锁高难 / Collect {n} medals to unlock；`diffLockedHint`=前往关卡面板查看勋章目标 / View medal goals。

### 降级策略
- **reduced-motion / 性能三档**：N/A（静态面板文本）。
- **存量豁免**：硬性默认——已选 high/hell 老档**绝不**自动回退、不弹拦截（只在用户主动新点击时拦）。

### 风险与回归点
- **误伤存量**：门禁只在「新点击选择」路径生效；`refreshDifficultySelect`/`openSettings` 只读展示不触发拦截 → QA 专测 C1.3（hard 老档打开设置=hard 高亮、进战斗 hard 系数）。
- **救济/活动**：不触碰 `_reliefCombatMul` 与活动模式自身难度语义。
- 回归：四档难度选择、难度系数进入战斗、关卡面板勋章提示（L493-507 显示逻辑不变）、`selectedDifficulty` 存档读写。

### 探针建议
- `qa_probes/test_prod_c1.mjs`：mock `levelMedals={}`（countMedals=0）→ 点击 hard → 断言 selectedDifficulty 仍 standard + 提示容器出现；补 levelMedals 使 ≥6 → 点击 hard 正常写入；老档 selectedDifficulty='hard'+勋章<6 → openSettings 断言 hard 高亮且无拦截；点击 casual/standard 任意勋章数 → 正常。

---

## 第 C4 条：存档导出 / 导入（备份与迁移 · 独立文件）

### 背景 / 目标
现状：存档 = `localStorage[SAVE_KEY]`（'sky_raiders_save_v1'，GameConfig L554）；SaveManager 注释要求「所有读写走这里，别在别处直接碰 localStorage」；OPT-16 T1/T2 已有 `SaveSanitizer.sanitizeSave/analyzeSave`（SaveSanitizer.js 全文件）可复用导入校验。

**目标**：新建独立文件 `SaveTransfer.js`（SaveSanitizer 先例）：
- **导出**：整档 JSON 包装 `{ app:'sky-raiders', version, exportedAt, save }`，提供「复制到剪贴板」与「下载 .json」两条路径（复用 ResultScene clipboard/download 范式）。
- **导入**：粘贴/选文件 → 解析 → **先备份**当前存档（内存）→ `sanitizeSave` 校验清洗 → 通过后整体覆盖；失败不破坏当前存档。
- SaveManager.js 只走公开 API，**零触碰**（SaveSanitizer 已 import GameConfig/SaveManager/AchievementManager，只读成就 id 白名单）。

### 改动文件 + 函数签名
- `src/utils/SaveTransfer.js`（**新建**）
- `src/scenes/MenuScene.js` — 设置面板（或关卡面板）加入口按钮 + 导入确认弹窗
- `src/config/GameConfig.js` — 新增 `SAVE_EXPORT` 配置块（append-only，可选）
- `src/config/Locale.js` — 新增词条（append-only）

```js
// SaveTransfer.js（新建；只 import GameConfig 只读常量 + SaveManager/SaveSanitizer 公开 API）
import { SAVE_KEY } from '../config/GameConfig.js';
import { SaveManager } from './SaveManager.js';
import { sanitizeSave, analyzeSave } from './SaveSanitizer.js';

export const SAVE_EXPORT_APP = 'sky-raiders';
export const SAVE_EXPORT_VERSION = 1;

export function exportSaveText() {   // 导出：包装 JSON 字符串（含 exportedAt）
  const save = SaveManager.load();   // 公开 API 读（深合并后完整档）
  return JSON.stringify({
    app: SAVE_EXPORT_APP,
    version: SAVE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    save,
  }, null, 2);
}
export function parseImport(text) {   // 解析 + 校验结构（不写档）
  // 返回 { ok:true, payload } 或 { ok:false, reason:'json'|'app'|'version'|'empty' }
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, reason: 'json' }; }
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'empty' };
  if (obj.app !== SAVE_EXPORT_APP) return { ok: false, reason: 'app' };
  // version：>=1 允许（向前兼容）；更高 version 也可导入（未知字段保留，SaveManager deep-merge 兜底）
  if (!Number.isInteger(obj.version) || obj.version < 1) return { ok: false, reason: 'version' };
  if (!obj.save || typeof obj.save !== 'object') return { ok: false, reason: 'empty' };
  return { ok: true, payload: obj };
}
export function importSave(text) {    // 导入（含 sanitize 清洗 + 整体覆盖；失败不破坏当前档）
  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const backup = JSON.parse(JSON.stringify(SaveManager.load())); // 先备份（内存）
  try {
    // sanitize：就地清洗脏字段（复用 T1 规则，返回是否改动；非法字段归默认，不整档拒绝 C4.4）
    const incoming = parsed.payload.save;
    sanitizeSave(incoming);
    // 整体覆盖：SaveManager 公开 API —— 先对 DEFAULT 深合并兜底未知/缺失字段再写入。
    // 说明：SaveManager 无「整档覆盖」公开 API，本文件采用「load→字段赋值→save」等价路径：
    //   先 reset 到 fresh 再逐字段合并会触碰内部；更稳妥做法（推荐）：
    //   SaveManager.js 增加一个 append-only 公开方法 replaceSave(next)（见下），本文件只调它。
    SaveManager.replaceSave(incoming);
    return { ok: true };
  } catch (e) {
    // 失败不破坏当前档：由于 replaceSave 在备份后失败才回滚 —— 实现见 replaceSave 语义
    return { ok: false, reason: 'apply' };
  }
}
```

```js
// SaveManager.js 追加（append-only 公开方法；不改旧字段语义/不碰私有 _dirty 机制）
replaceSave(next) {
  // 语义：以 DEFAULT_SAVE 为底深合并 next（缺字段兜底默认、数组/对象深拷贝防污染），
  //       然后 cache = merged；this.save()。
  // 设计对齐 load() 的深合并（L150-233）——复用同一套字段级兜底，保证导入后 load() 再次返回等价。
  // 失败安全：在调用方（SaveTransfer.importSave）先备份；replaceSave 只在 merge 成功才 save()。
}
```

### 精确语义
- **导出内容**：`SaveManager.load()` 返回完整档（含全部既有字段 + append-only dailyChallenge/haptics 若已存在）；包装含 `exportedAt`（ISO）。剪贴板/下载文件内容一致（C4.1）。
- **导入流程（C4.2）**：parseImport 结构校验 → backup → sanitize 清洗 → replaceSave 覆盖 → 重启后字段一致。
- **非法 JSON/结构损坏（C4.3）**：parseImport 返回 `reason:'json'` → 拒绝并提示 `saveImportFail`，当前档不变。
- **字段脏（C4.4）**：可解析 + 结构合法 → 经 sanitize 清洗后导入（coins=-5→0 等），不整档拒绝。
- **备份（C4.5）**：backup 在 replaceSave 前内存备份；replaceSave 失败（throw）→ 回滚 backup（replaceSave 内 catch 或调用方 catch）。导入成功后无持久备份文件（临时内存，PM 语义）。
- **入口**：MenuScene 设置面板新增「导出存档 / 导入存档」行（放面板底部 close 按钮前）；导出点击即复制（flashToast `saveExportOk`），长按/次按钮下载 .json；导入点击弹「粘贴文本」DOM 输入（同 C2 DOM 先例）→ parse → 确认弹窗 `saveImportConfirm` → 执行。

### 参数表（append-only）
i18n 词条（zh/en）：`saveExport`=导出存档 / Export Save；`saveImport`=导入存档 / Import Save；`saveExportOk`=存档已复制 / Save copied；`saveImportOk`=导入成功 / Import OK；`saveImportFail`=存档格式无效 / Invalid save format；`saveImportConfirm`=导入将覆盖当前进度，是否继续？/ Import will overwrite progress. Continue?

### 降级策略
- **剪贴板 API 缺失**：`navigator.clipboard` 不可用（非安全上下文）→ 回退 textarea 选中复制或仅下载文件路径；不 crash。
- **reduced-motion / 性能三档**：N/A（一次性文本/文件操作）。
- **Node 头测**：无 localStorage/DOM → 方法抛错由探针 catch（SaveManager.load 兜底 freshSave）。

### 风险与回归点
- **整档覆盖安全**：replaceSave 深合并必须与 load() 同兜底（缺字段默认），否则导入旧版档会丢新字段默认 → QA 断言导入旧版（无 dailyChallenge）后 load() 含默认 dailyChallenge。
- **SaveManager diff**：仅 append `replaceSave` 公开方法（允许）；旧字段语义零改动。QA grep 断言无旧字段写入点变更。
- **sanitize 复用**：不新增清洗规则（T1 规则复用），脏字段按既有规则处理。
- 回归：正常启动 sanitize（installSanitizer）、导出后再导入 → 全字段一致。

### 探针建议
- `qa_probes/test_prod_c4.mjs`：mock 存档 → exportSaveText() → 断言含 coins/upgrades/levelMedals/exportedAt；importSave(合法) → 断言字段一致；importSave('not json') → 拒绝且当前档不变；importSave(可解析脏档 coins=-5) → 断言 coins=0（sanitize）；断言 SaveManager 旧字段写入点未变。

---

## 第 C8 条：存档清除（重置进度 · 强确认 · 独立文件扩展）

### 背景 / 目标
现状：无用户主动清除入口；SaveManager 只有损坏兜底 freshSave 与 `reset()`（L728-731 整档 freshSave，非用户可见）。

**目标**：设置面板新增「重置进度」入口（面板底部低风险区）：强二次确认 → 提示「建议先导出（C4）」→ 清除**进度/收藏类**字段回默认，**保留设置/手感类**字段（lang/quality/sensitivity/touchOffset/showHitbox/haptics/noAds）。实现放 `SaveTransfer.js`（与 C4 同文件）新增 `resetProgress()`，SaveManager.js 建议只走公开 API。

### 改动文件 + 函数签名
- `src/utils/SaveTransfer.js`（扩展：新增 `RESET_KEEP_KEYS` 与 `resetProgress()`）
- `src/scenes/MenuScene.js` — 设置面板底部「重置进度」入口 + 强确认（二次弹窗，PM：二次弹窗+延时即可，不做输入 DELETE）
- `src/config/Locale.js` — 新增词条（append-only）

```js
// SaveTransfer.js 扩展
export const RESET_KEEP_KEYS = ['lang', 'quality', 'sensitivity', 'touchOffset', 'showHitbox', 'noAds', 'haptics']; // 设置/手感 + C7

export function resetProgress() {
  // 1) 备份当前设置类字段（RESET_KEEP_KEYS）
  // 2) 构造默认档（引用 DEFAULT_SAVE 语义 → 通过 SaveManager 公开路径：见下）
  // 3) 进度/收藏类字段归默认（coins=0/unlockedLevel=1/levelMedals={}/achievements={}/topScores=[]/nickname=''/...）
  // 4) 写回保留字段
  // 推荐实现：读 DEFAULT_SAVE 是不可行的（未导出）→ 走 SaveManager 公开 API：
  //   const s = SaveManager.load();
  //   const keep = {}; RESET_KEEP_KEYS.forEach(k => keep[k] = s[k]);
  //   SaveManager.replaceSave({ /* 由 replaceSave 深合并兜底到 freshSave 等价 */ ...keep });
  //   说明：replaceSave({...keep}) 以 DEFAULT_SAVE 兜底 → 所有进度字段回默认 + 保留字段写回 = 目标状态。
  //        （DEFAULT_SAVE 已在 SaveManager.js L10-89 定义；replaceSave 深合并天然实现「清进度保设置」）
  return { ok: true };
}
```

### 精确语义
- **入口**：设置面板底部（close 按钮上方，建议 y≈770 或独立低风险区）加「重置进度」NeonButton（低饱和描边，弱化视觉）。
- **强确认（C8.1）**：点击 → 第一层确认弹窗（title `resetConfirmTitle`；desc `resetConfirmDesc` 含「将清除全部进度与收藏，保留设置；不可撤销」；附加提示 `resetExportTip`「建议先导出备份」+「去导出」按钮跳 C4 导出）→ 第二层确认（或延时按钮 2s 后可点）→ 执行 resetProgress()。
- **取消（C8.2）**：任一层取消 → 存档零改动。
- **重置范围（C8.3）**：进度/收藏类全回默认（coins=0/unlockedLevel=1/levelStars={}/levelMedals={}/achievements={}/achievementStats 默认/bossesDefeated={}/totalKills=0/checkinStreak=0/topScores=[]/bestScore=0/league 重置/towerTop=0/dailyActs 重置/dailyQuest 重置/newbiePlan 重置/modules/moduleInv 重置/skins/ownedSkins 重置/codex 重置/nickname=''/lastScore/prevScore=0/failStreak={}/reliefRuns=0/dailyChallenge 重置（C5））；**保留** lang/quality/sensitivity/touchOffset/showHitbox/haptics/noAds（RESET_KEEP_KEYS）。
- **tutorialDone（C8.5）**：默认保留 `tutorialDone=false` 语义——进度清空后新档应重新可看教程 → tutorialDone 不在 RESET_KEEP_KEYS，重置回 false。
- **回菜单（C8.4）**：重置完成后刷新存档信息文案（MenuScene `saveInfoText.setText(this._saveInfoLabel())` L635 范式），显示 0 金币/第 1 关/默认昵称。
- **与 T2 自愈无关**：resetProgress 是用户主动操作，与损坏 freshSave 互不影响。

### 参数表（append-only）
i18n 词条（zh/en）：`resetProgress`=重置进度 / Reset Progress；`resetConfirmTitle`=重置进度？/ Reset Progress?；`resetConfirmDesc`=将清除全部进度与收藏，保留设置；不可撤销 / Clears progress & collection, keeps settings. Cannot undo；`resetExportTip`=建议先导出备份 / Export backup first；`resetDone`=已重置 / Progress reset。

### 降级策略
- **reduced-motion / 性能三档**：N/A（静态弹窗）。
- **强确认**：二次弹窗 + 延时防误触（PM 假设）；不做高成本输入 DELETE。

### 风险与回归点
- **保留字段语义**：RESET_KEEP_KEYS 与 PM C8.3 列表必须一致；新增设置类字段时需同步（注释标注）。QA 断言 lang/quality 等保留、coins 等清零。
- **tutorialDone**：默认清回 false → 新档重看教程（C8.5）。
- **nickname 重置**：清回 '' → 分享卡昵称回默认（C8.4），与 C2 回退规则一致。
- 回归：损坏自愈（T2）不受影响；既有存档加载零回归。

### 探针建议
- `qa_probes/test_prod_c8.mjs`：mock 高进度存档 → resetProgress() → 断言 coins=0/unlockedLevel=1/levelMedals={}/nickname=''/lang 保留/quality 保留；取消路径断言零改动；重置后 tutorialDone=false。

---

## 第 C7 条：移动端震动反馈（触觉反馈 · append-only haptics）

### 背景 / 目标
现状：全仓无 `navigator.vibrate` 调用；音频反馈已有。

**目标**：新增事件→震动映射工具（仅支持震动平台生效），在受击/敌机击破/Boss 击破/炸弹清屏/Boss 演出等事件点调用；设置面板新增「震动」开关（默认平台：移动端开/桌面端关——桌面无 vibrate 时开关隐藏或置灰）；持久化到 SaveManager append-only `haptics`（默认 true，老档缺省回退 true）。震动不参与任何判定/数值，关闭后完全无感。

### 改动文件 + 函数签名
- `src/utils/Haptics.js`（**新建**，工具门控）
- `src/config/GameConfig.js` — 新增 `HAPTICS` 配置块（append-only）
- `src/utils/SaveManager.js` — DEFAULT_SAVE + load() 深合并 append `haptics`（仅此 2 处最小改动）
- `src/scenes/GameScene.js` — 事件点接入（受击 `playerHit` L2275 / 敌机击破 `registerKill` L1493 / Boss 击破 `_onBossDefeated` L595 / 炸弹 `useBomb` L2288 / 擦弹 `_grantGraze` L1641 可选）
- `src/scenes/MenuScene.js` — 设置面板「震动」开关行（label + 开关，同 noAds/touchOffset 行体例 L312-339）
- `src/config/Locale.js` — 新增词条（append-only）

```js
// Haptics.js（新建）
import { HAPTICS } from '../config/GameConfig.js';
import { SaveManager } from './SaveManager.js';

export function hapticsSupported() {           // 平台支持 + 非 reduced-motion 联动开关（默认不联动）
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}
export function hapticsEnabled() {             // 存档开关（老档缺省 true）
  const v = SaveManager.load().haptics;
  return v !== false;                          // undefined/true → 开；false → 关
}
export function vibrate(kind) {                // kind 映射 HAPTICS.patterns[kind]
  if (!hapticsSupported() || !hapticsEnabled()) return;
  const pat = HAPTICS.patterns[kind];
  if (!pat) return;
  try { navigator.vibrate(pat); } catch (e) { /* 静默：权限/环境异常不 crash */ }
}
```

```js
// GameConfig.js 新增（append-only）
export const HAPTICS = {
  // 事件 → 震动模式（ms；数组=节奏）。数值可调，仅配置常量。
  patterns: {
    hit:    80,          // 受击（中）
    kill:   [15, 30, 15],// 敌机/Boss 击破（中短三连）
    clear:  [20, 40, 60],// 炸弹/过载清屏（短+中）
    boss:   50,          // Boss 阶段/演出（短）
    graze:  8,           // 擦弹（极短，可选——默认接入与否见降级）
  },
};
```

```js
// SaveManager.js —— 两处最小 append：
// DEFAULT_SAVE 追加（L89 附近）：
haptics: true,  // OPT-16 C7 震动开关（append-only；老档缺省回退 true，见 load）
// load() 深合并追加（L232 附近，nickname 之后）：
haptics: (parsed.haptics !== false), // 语义=开关；缺省/undefined → true；false → 关
```

```js
// GameScene.js 事件点接入（各 1 行，低频、非每帧）：
// L2275 playerHit(dmg) —— 受击已落地（护盾/无敌穿过不震）：
if (landed) vibrate('hit');                       // landed 判定已存在 L2281
// L1493 registerKill —— 每击杀触发会过频：接入处需频控（HAPTICS 内部 120ms 节流）或只接 Boss/精英；
//   建议：vibrate('kill') 由 Haptics.js 内置节流（同帧多次只震一次最短间隔 ≥120ms）
// L595 _onBossDefeated —— Boss 击破：vibrate('kill')
// L2288 useBomb —— 清屏：vibrate('clear')
// L1641 _grantGraze（可选）：擦弹极短震动默认关闭（避免高频震动，PM 可选）
```

```js
// MenuScene.js 设置面板「震动」开关（与 noAds 行同体例，放语言行前/后空位）：
//   const hapLabel = this.add.text(cx - 150, y, t('haptics'), {...}); ov.add(hapLabel);
//   开关按钮 label = SaveManager.load().haptics !== false ? t('hapticsOn') : t('hapticsOff')
//   onDown: SaveManager.set('haptics', !(SaveManager.load().haptics !== false)); 刷新 label+selected
//   平台不支持 vibrate（hapticsSupported() false）→ 该行隐藏或按钮置灰（C7.4），不报错。
```

### 精确语义
- **映射表**：`HAPTICS.patterns`（hit/kill/clear/boss/graze），数值走 GameConfig 可调（PM：数值可调，不改框架）。
- **平台门控（C7.4）**：`hapticsSupported()` false → 开关行隐藏/置灰，不报错。
- **开关（C7.3）**：关闭后 `vibrate()` 直接 return，任何受击/击破不再震。
- **老档缺省（C7.5）**：`load().haptics !== false` → 老档缺省 true（移动端默认开）；零报错。
- **静默异常**：`navigator.vibrate` 调用包 try/catch（权限/隐私模式）。
- **频控**：registerKill 高频 → Haptics.js 内置 120ms 节流（同一次清屏多杀只震一次），避免轰炸式震动。
- **reduced-motion 解耦（PM 假设）**：震动不因 reduced-motion 自动关闭（触觉≠视觉）；如需联动由主理人追加配置。

### 参数表（append-only）
`HAPTICS.patterns`（如上）；SaveManager append `haptics`（默认 true）；i18n 词条（zh/en）：`haptics`=震动反馈 / Haptics；`hapticsOn`=开 / On；`hapticsOff`=关 / Off。

### 降级策略
- **桌面/无权限**：`hapticsSupported()` false → 不调用、开关隐藏；零回归（C7.4）。
- **性能档**：N/A（非渲染；震动不参与每帧）。
- **reduced-motion**：默认解耦（保留震动）。

### 风险与回归点
- **高频震动**：无节流会「每杀一震」——Haptics.js 内置节流（120ms）为硬性；QA 断言单帧多杀只一次 vibrate。
- **开关默认**：老档缺省 true → 桌面（不支持）隐藏开关、移动端默认开；QA 断言 `load().haptics` 缺省行为。
- **零判定**：震动不改变任何伤害/流程；QA 断言开关关闭后战斗数据与开启时完全一致。
- 回归：受击/击杀/炸弹/Boss 链路行为不变（震动为附加调用）。

### 探针建议
- `qa_probes/test_prod_c7.mjs`：mock `navigator.vibrate` spy → 受击（landed）断言 vibrate('hit') 参数一致；单帧多杀断言只调 1 次（节流）；`SaveManager.set('haptics', false)` 后任何事件不再调；mock 无 vibrate → 开关隐藏且不报错。

---

## 第 C5 条：每日种子挑战（独立结算域 · append-only dailyChallenge）

### 背景 / 目标
现状：SaveManager 已有确定性日期种子 `_dailySeed(str)`（L462-469，FNV-1a）与每日任务用它保证「同一天同组任务」（L472-483）；每日任务跨天重置逻辑（date 比对）是现成范式。

**目标**：菜单新增「今日挑战」入口 → 一局固定种子挑战（建议固定 standard 难度 + 固定关卡 wavePlan；同一天所有人同图）→ 局内播报「今日种子 #xxx」→ 结算只记当日最佳分/是否达成目标（`dailyChallenge` append-only），**不污染** topScores/levelMedals/league/成就/每日任务/新手计划（防刷）；达成当日目标领 1 次金币（跨天重置）。

### 改动文件 + 函数签名
- `src/utils/SaveManager.js` — DEFAULT_SAVE + load() 深合并 append `dailyChallenge`；新增方法 `getDailyChallenge()/recordDailyChallenge(result)/claimDailyChallenge()`（append-only 方法）
- `src/scenes/GameScene.js` — `init(data)` 识别 `mode:'daily'` + `dailySeed`；create 按 daily 分支固定 wavePlan（标准难度、不计入持久化）；endGame 结算域拦截
- `src/scenes/MenuScene.js` — 「今日挑战」入口（放每日任务/活动区：`openDailyQuest` 面板加页签或活动面板入口；菜单已满 10+ 按钮 → PM 假设：合并进活动/每日任务入口页签，避免裸按钮）
- `src/config/GameConfig.js` — 新增 `DAILY_CHALLENGE` 配置块（append-only）
- `src/config/Locale.js` — 新增词条（append-only）

```js
// GameConfig.js 新增（append-only）
export const DAILY_CHALLENGE = {
  levelId: 1,            // 固定关卡（同一天所有人同图；可用种子轮换关卡，见语义）
  difficulty: 'standard',// 固定难度档（PM 假设：公平）
  seedSalt: 'sky-daily', // 种子盐（与 _dailySeed 复用 FNV-1a）
  targetScore: 60000,    // 当日目标分数（达成 → cleared → 领 1 次金币）
  rewardCoins: 500,      // 达成奖励
};
```

```js
// SaveManager.js —— 最小 append：
// DEFAULT_SAVE 追加：dailyChallenge: { date: '', bestScore: 0, cleared: false },
// load() 深合并追加（L232 附近）：
dailyChallenge: {
  date: '', bestScore: 0, cleared: false,
  ...((parsed.dailyChallenge) || {}),
},
// 新增方法（append-only 公开方法）：
getDailyChallenge() {
  const s = this.load();
  const today = this._todayStr();
  if (s.dailyChallenge.date !== today) {           // 跨天自动重置（C5.4）
    s.dailyChallenge = { date: today, bestScore: 0, cleared: false };
    this.save();
  }
  return { ...s.dailyChallenge };
}
recordDailyChallenge(score, cleared) {  // 结算调用：更高才覆盖 bestScore；cleared 幂等
  const s = this.load();
  const today = this._todayStr();
  if (s.dailyChallenge.date !== today) this.getDailyChallenge();  // 确保当日态
  const dc = s.dailyChallenge;
  const v = Math.max(0, Math.floor(Number(score) || 0));
  if (v > dc.bestScore) dc.bestScore = v;
  if (cleared) dc.cleared = true;
  this.save();
  return { ...dc };
}
claimDailyChallenge() {                 // 达成且未领 → 发金币；已领/未达成 → 不重复
  const s = this.load();
  const today = this._todayStr();
  if (s.dailyChallenge.date !== today) this.getDailyChallenge();
  const dc = s.dailyChallenge;
  if (!dc.cleared) return { claimed: false, reason: 'not-cleared' };
  if (dc.claimed) return { claimed: false, reason: 'claimed' };   // 幂等（同日再次达成不重复发）
  s.coins = (s.coins || 0) + (DAILY_CHALLENGE.rewardCoins || 500);
  dc.claimed = true;
  this.save();
  return { claimed: true, reward: DAILY_CHALLENGE.rewardCoins || 500 };
}
// 说明：cleared 与 claimed 分开 —— cleared=true 表示「当日曾达成」（展示用），claimed 表示「已领奖」。
// 跨天重置两者。字段结构 = { date, bestScore, cleared, claimed:false }（PM 附录 A 的 dailyChallenge 扩展 claimed，append-only）。
```

```js
// GameScene.js —— init(data) 追加识别：
this.dailyRun = (data && data.mode === 'daily') || false;
this.dailySeed = this.dailyRun ? (data && data.dailySeed) : null;
// create() 分支（waves 创建 L261-267 前）：
if (this.dailyRun) {
  this.difficultyCfg = getDifficulty(DAILY_CHALLENGE.difficulty) || DIFFICULTIES[1];  // 固定 standard
  // 种子 → 波次确定性：挑战复用 WaveSystem，但用「固定关卡 + 固定 wavePlan」（data 表驱动，
  //   天然同一天同图）；seed 用于局内展示编号 + 可选 roll 变化（wavePlan 无 Math.random 变体时）。
  //   A6 waveVariants（WaveSystem L34-45）在本模式应禁用/固定 variant 0，保证同图。
}
// endGame 结算域拦截（与救济局 _shouldRecordPersist 同构，L2045-2046）：
//   在 endGame 顶部（L2475 recordPersist 计算处）追加：
const dailyRecord = this.dailyRun;
const recordPersist = !this._reliefRun && !dailyRecord;   // 挑战局：不写 topScores/levelMedals/league/成就/每日任务/新手计划
//   结算星等/勋章/排行等持久化判断处加 !dailyRecord 短路（复用救济局同款附加式抑制）。
//   最高分/排行（L2543/2547/2561/2571/2579-2594）在 recordPersist=false 时已天然跳过。
//   金币照常入账（打得不白打，PM 边界）。
//   endGame 末尾（成就 reportRun L2644-2651 前）追加：
if (dailyRecord) {
  const cleared = victory && scaledScore >= (DAILY_CHALLENGE.targetScore || 60000);
  const dc = SaveManager.recordDailyChallenge(scaledScore, cleared);
  if (cleared) SaveManager.claimDailyChallenge();        // 达成 → 发 1 次金币（claimed 幂等）
  result.daily = { seed: this.dailySeed, bestScore: dc.bestScore, cleared: dc.cleared, claimed: !!dc.claimed, goal: DAILY_CHALLENGE.targetScore };
}
// ResultScene 展示：结算页若有 result.daily → 追加一行「今日种子 #xxx · 目标 N · 最佳分 M」。
```

```js
// MenuScene.js「今日挑战」入口（建议放 openDailyQuest 面板页签 或 活动入口旁）：
//   进入：const dc = SaveManager.getDailyChallenge();
//   transition.goto(this, SCENES.GAME, { mode: 'daily', levelId: DAILY_CHALLENGE.levelId, dailySeed: seedStr });
//   seedStr = SaveManager._dailySeed(DAILY_CHALLENGE.seedSalt + '_' + SaveManager._todayStr())  // 同一天全局一致
```

### 精确语义
- **种子口径**：`dailySeed = _dailySeed('sky-daily_2026-09-01')`（salt + date）——同一天所有设备同一 seed（C5.1）；显示「今日种子 #<seed 十进制前 6 位>`。
- **同图**：挑战固定 `levelId=DAILY_CHALLENGE.levelId` + 固定 `difficulty='standard'` + **禁用 A6 waveVariants 随机**（固定 variant）→ 同一天两次进入波次一致（C5.1）。若后续要「每天换关」，可把 levelId 由 `(dailySeed % LEVELS.length)+1` 派生（配置决定，默认固定 1）。
- **独立结算域（C5.2/C5.5）**：`recordPersist=false` → topScores/levelMedals/levelStars/league/bestScore/成就/每日任务/新手计划全部不计（复用救济局附加式抑制 L2045-2046 思路，**不改既有写盘路径**——在持久化判断处加短路）。
- **奖励（C5.3）**：达成目标（victory 且 score≥target）→ `cleared=true` + `claimDailyChallenge()` 发 1 次金币；同日再次达成不重复（claimed 幂等）；跨天 date 变化重置（C5.4）。
- **金币入账**：挑战局局内拾取金币照常（endGame 不因 daily 扣回）；只是不计榜/不计成就。
- **存档**：仅 append-only `dailyChallenge`（date/bestScore/cleared/claimed）；seed 不入档（局内参数透传）。
- **零新成就**：不产出任何成就 id（红线）。

### 参数表（append-only）
`DAILY_CHALLENGE` 配置块（levelId/difficulty/seedSalt/targetScore/rewardCoins）；`dailyChallenge` 存档字段（date/bestScore/cleared/claimed，claimed 为 PM 附录 A 之外的 append-only 补充——若主理人要求严格对齐 PM 附录 A 三字段，可将 claimed 并入 cleared 语义：cleared=true 即已领；本规格默认含 claimed 以免「达成展示」与「已领」混淆，属 append-only 增字段，不阻塞）；i18n 词条：`dailyChallenge`=今日挑战 / Daily Challenge；`dailySeedLabel`=今日种子 # / Seed #；`dailyChallengeGoal`=目标 {score} / Goal {score}；`dailyChallengeReward`=奖励 {coins} 金币 / Reward {coins} coins；`dailyChallengeDone`=今日已领取 / Claimed today。

### 降级策略
- **reduced-motion / 性能三档**：挑战局同 normal 波次渲染，无新粒子 → N/A。
- **同图降级**：若 WaveSystem 变体随机无法禁用（实现阻碍），退化为「固定关卡 + 同 seed 展示编号」（同图性放宽为尽力而为）——需 team-lead 知悉；本规格默认要求固定 variant。

### 风险与回归点
- **结算域污染**：挑战局若漏短路会写榜/写成就 → 硬性在 endGame 持久化判断统一短路；QA 专测挑战局后 topScores/levelMedals/achievements 无变化（C5.2）。
- **奖励重复**：claimed 幂等；QA 同日两次达成断言只发一次。
- **跨天**：date 变化重置；QA mock 日期跨天断言。
- **wavePlan 一致性**：挑战固定关卡固定 variant；QA 两次进入断言第一波敌人类型/顺序一致（C5.1）。
- 回归：每日任务 `_dailySeed`/date 重置/存档既有字段不变；救济局不计入逻辑不受影响。

### 探针建议
- `qa_probes/test_prod_c5.mjs`：mock 日期 → 进入 daily → 断言 seed 与 `_dailySeed(salt+date)` 一致、difficulty=standard；挑战结束 → 断言 topScores/levelMedals/achievements 无新增、`dailyChallenge.bestScore` 只增不降；达成目标 → 断言 cleared=true 且 coins+reward 一次；二次达成 → 不重复发；跨天 → bestScore/cleared 重置。

---

## 第 C11 条：新增第 4 架战机（内容新增 · 免费可选 MVP）

### 背景 / 目标
现状：SHIPS 3 架（GameConfig L578-585，苍鹰/赤焰/寒霜，各绑 武器+元素+被动）；SHIP_SKINS 每架 3 款（L593-609）；皮肤纹理 `player_skin_{shipId}_{skinId}` 由 TextureFactory 程序化生成（L48-53 三层循环 shipId 0..2）；机库选择 `selectedShip` 索引（HangarScene L192 用 `% n` 循环切换，天然支持长度变化）；玩家开局读 SHIPS[selectedShip]（GameScene L191-217）+ `scene.shipPassive` 在 Enemy.applyElement 消费（Enemy L515-528，按 element 匹配 dotMul/slowMul/stunMul）。

**目标**（MVP 低风险）：新增第 4 架战机（shipId=3），**复用现有武器与元素**，配一个新被动（沿用 passive 结构：element + 系数，如「冰减速更强」或复用现有三元素之一做差异化系数组合）；新增 3 款皮肤（TextureFactory 程序化，shipSkinKey 命名）；默认**免费可选**（与既有 3 架一致），不改既有 3 架任何字段/被动/皮肤；存量零感知。

### 改动文件 + 函数签名
- `src/config/GameConfig.js` — `SHIPS` 追加 id=3 条目；`SHIP_SKINS` 追加 shipId=3（3 款皮肤）
- `src/utils/TextureFactory.js` — `SKIN_PALETTES` 追加第 4 组（3 款配色）；`generateAll()` 皮肤循环 shipId 上限 3→SHIPS.length（或常量 4）
- `src/config/Locale.js` — 新增 `shipName_3/shipDesc_3/passive_*/skin_3_0..2` 词条（append-only）
- `src/scenes/HangarScene.js` — 核对机库循环/展示对 length=4 兼容（已 `% n`；皮肤行 3 款已适配）；若等分卡布局写死 3 列需评估（见语义）
- `src/scenes/GameScene.js` — 核对（L191-217 按 selectedShip 读取，自动支持 id=3）

```js
// GameConfig.js —— SHIPS 追加（append-only，不改既有 3 条）：
{ id: 3, name: '霆光', weapon: 'pulse', element: 'thunder', tint: 0xffe14a, desc: '速射机·雷暴双麻痹',
  passive: { element: 'thunder', name: '连锁雷', desc: '麻痹时长 +30%', stunMul: 1.3 } },
// 说明：MVP 新被动沿用 passive 结构（element+系数），与既有三架差异化数值（stunMul 1.3 vs 苍鹰 1.15），
//       不改 Enemy.applyElement 消费链路（Enemy L515-528 自动生效）。数值由主理人真测调参，仅配置常量。

// SHIP_SKINS 追加（append-only）：
{ shipId: 3, name: '霆光', skins: [
  { id: 0, name: '雷黄', accent: 0xffe14a },
  { id: 1, name: '紫电', accent: 0xb26bff },
  { id: 2, name: '墨青', accent: 0x2fd4c8 },
] },

// TextureFactory.js：
// SKIN_PALETTES 追加第 4 组（3 款配色对象，字段与既有同构）：
[ // 霆光：雷黄 / 紫电 / 墨青
  { light: 0xfff3c0, mid: 0xffe14a, deep: 0x9a7a10, wing: 0xd9b52a, neon: 0xfff0a0, core: 0xfff8dc, cockpit: 0x3a2a08, tip: 0xffffff, glow: 0xffe14a, variant: 0 },
  { light: 0xeadcff, mid: 0xb26bff, deep: 0x5a2a9a, wing: 0x8a4bd0, neon: 0xcfbfff, core: 0xf0e6ff, cockpit: 0x1c0f33, tip: 0xffffff, glow: 0xb26bff, variant: 1 },
  { light: 0xd2fff8, mid: 0x2fd4c8, deep: 0x0f6a62, wing: 0x22b3a8, neon: 0xa8fff6, core: 0xeafffc, cockpit: 0x0a2a26, tip: 0xffffff, glow: 0x2fd4c8, variant: 2 },
],
// generateAll() 皮肤循环（L48）shipId < 3 → shipId < SHIPS.length（或常量 SHIP_COUNT=4）
```

```js
// Locale.js 新增词条（zh/en）：shipName_3=霆光 / Thunderflash；shipDesc_3=速射机·雷暴双麻痹；
// passive_3=连锁雷（被动名，en: Chain Bolt）；passiveDesc_3=麻痹时长 +30%；skin_3_0=雷黄；skin_3_1=紫电；skin_3_2=墨青。
```

### 精确语义
- **数据 append**：SHIPS 只追加第 4 条，不改既有 3 条字段/被动/皮肤；SHIP_SKINS/TextureFactory 同 append（C11.1 既有展示不变）。
- **免费可选（MVP）**：不加 `ownedShips`（PM 假设）；`selectedShip=3` 用既有 int 字段，机库直接可选（C11.4 老存档/新选择均安全）。若主理人改「购买解锁」需追加 ownedShips（append-only，存量默认已解锁），本批不依赖。
- **被动生效**：沿用 passive 结构 → GameScene L194 `shipPassive` → Enemy.applyElement（L515-528）自动按 element 乘系数（C11.2：霆光 thunder + stunMul 1.3）。
- **皮肤链路**：TextureFactory 生成 `player_skin_3_0..2` → GameScene L207-212/SaveManager.getSkin/ownsSkin/equipSkin 既有链路自动支持（C11.3：3 款皮肤 800 金币购买沿用 SKIN_PRICE/ownedSkins）。
- **越界防御（C11.4）**：所有读 selectedShip 处均有 `SHIPS[idx] || SHIPS[0]` 回退（GameScene L192/HangarScene L285/ResultScene 立绘 L88-89 用 `_ship.id`），id=3 正常不越界。
- **机库布局（C11.1 展示）**：HangarScene 战机切换用 `% n`（L192）天然支持 length=4；皮肤预览/模块/机库等级区按选中战机读取（L284/L582/L695）自动适配。若机库主区存在「3 卡等分」写死布局需改为动态（核对后实现；验收以「4 架均可选可预览」为准，PM C11 边界）。
- **武器选择**：第 4 架 weapon='pulse' 与苍鹰相同（复用现有武器，零新增武器类型）；开局若 `startWeapon` 覆盖则用覆盖（既有语义）。
- **成就/图鉴**：零新增成就/图鉴条目（红线）。

### 参数表（append-only）
SHIPS[3] / SHIP_SKINS shipId=3 / SKIN_PALETTES[3] / i18n 词条（如上）。无存档新增字段。

### 降级策略
- **纹理缺失**：HangarScene/ResultScene 对 `player_skin_3_x` 缺失已回退 'player'/tint（既有 fallback L217 等）→ 零崩溃。
- **reduced-motion / 性能三档**：程序化纹理一次性生成，非每帧；N/A。

### 风险与回归点
- **对象池/引用**：SHIPS.length 变化影响遍历点（如有 `for i<3` 硬编码需改 length）——QA grep `SHIPS[` 与 `.length` 断言既有 3 架读取不受影响。
- **被动数值**：stunMul 1.3 仅配置常量；平衡由主理人调参，不改框架。
- **皮肤购买**：新机 3 款皮肤购买/装备走既有 ownedSkins 链路（`3:0/3:1/3:2`），QA 断言第 0 款默认自带、1/2 购买后可用。
- **存档兼容**：老存档 selectedShip=0/1/2 不变（C11.5）；selectedShip=3 为既有 int 字段正常。
- 回归：苍鹰/赤焰/寒霜 的武器/元素/被动/皮肤/立绘/分享卡显示不变。

### 探针建议
- `qa_probes/test_prod_c11.mjs`：断言 SHIPS.length===4 且既有 3 条字段零改动；进入机库 → 4 架均可切换、第 4 架展示正确；选择霆光开局 → 断言 defaultWeapon='pulse'/shipElement='thunder'/shipPassive.stunMul=1.3；对 thunder 敌人命中断言麻痹时长按 1.3；皮肤 3 款纹理存在（textures.exists('player_skin_3_x')）；selectedShip=3 存档进结算 → 立绘正常无越界报错。

---

## 第 C10 条：Boss 高难终局（改型方案 A：高难专属形态增强 · 最高风险条目）

### 背景 / 目标 + 架构决策
PM 已标注：**不建议原样做「第 4 阶段」**（现状 3 阶段 0.66/0.33 + A7 狂暴 RAGE hp<15% 已是「低血量终局」，直接加第 4 阶段会与狂暴时间轴冲突、触碰 Boss.js 阶段机风险高）。本规格按 PM 推荐**改型方案 A**：
- **仅 `hell`（或 hard+hell，由配置决定，默认仅 hell）** 在 phase 3 血量档内新增 1–2 个**附加弹幕 pattern**（追加到 Boss 既有 pattern 表，**不改阶段机、不改 0.66/0.33 血量阈值、不改 RAGE 触发语义**）；
- 视觉上 phase 3 换色/换态（复用既有 `_syncPhaseVisuals` L200 加一档 hell 视觉），狂暴逻辑不动；
- 若主理人最终拍板「第 4 阶段」原案：边界必须是 append-only 叠加在 phase 3 之上（不吞狂暴）——需重新评审，本规格不展开。

### 改动文件 + 函数签名
- `src/config/GameConfig.js` — 新增 `BOSS_HARD` 配置块（append-only）
- `src/entities/Boss.js` — 新增 hell 专属 pattern 方法（追加，不改既有 phase 判定/RAGE）；`_syncPhaseVisuals` 加 hell 档视觉分支（append-only）
- `src/scenes/GameScene.js` — `spawnBoss()`（L1048-1059）向 Boss 传难度档 id（`hell` 标记）
- `src/config/Locale.js` — 新增 `bossHardPhase_*` 词条（若形态有命名）

```js
// GameConfig.js 新增（append-only）
export const BOSS_HARD = {
  difficulty: 'hell',        // 仅 hell 启用（'hell' | 'hard' | null）
  phase3Patterns: [          // phase 3 内追加的高难 pattern（值与 Boss 既有 pattern 名一致）
    'spiral',                // 例：高难螺旋（复用既有 pattern 实现，密度/速度增强见语义）
    'cross',                 // 例：高难十字
  ],
  visualKey: 'hell',         // _syncPhaseVisuals 的 hell 档 key（换色分支）
  densityMul: 1.2,           // 高难 pattern 弹量系数（low 档仍按既有 _density 降级减半，见风险）
  speedMul: 1.1,             // 高难 pattern 弹速系数（必须保证可应对缝隙）
};
```

```js
// GameScene.js spawnBoss 改造（L1056-1059）：在 Boss config 传难度档 id
this.boss = new Boss(this, bossKey, {
  ...cfg,
  difficulty: baseDifficulty * bossBulletMul,
  hardPhase: this.difficultyCfg && this.difficultyCfg.id === (BOSS_HARD.difficulty), // true=hell（C10.1）
});

// Boss.js —— 追加字段 + 高难 pattern（不改既有 phase 判定/RAGE）：
// constructor 内：this.hardPhase = !!config.hardPhase;（默认 false = 既有行为零回归）
// 在 _fire 的 switch（L262-272）之前加 hell 档分支（仅 phase 3 且非狂暴时）：
_fire() {
  // ...既有 _enraging/RAGE 判断（狂暴优先，L290-380 不改）
  if (this._enraging) { this._patternEnrageStorm(); ... return; }   // 狂暴让位（C10.4）
  // 高难附加（C10.1/C10.2）：仅 hell 档 + phase>=3 时，从 BOSS_HARD.phase3Patterns 轮换
  if (this.hardPhase && this.phase >= 3) {
    this._fireHardPattern();       // 新增：按 _hardPatIdx 轮换 BOSS_HARD.phase3Patterns
    return;
  }
  switch (this.pattern) { ... }    // 既有 pattern 表不变
}
_fireHardPattern() {
  // 复用既有 pattern 方法 + 高难系数（密度/速度由 BOSS_HARD 系数在生成处乘）
  // 例如：_patternSpiral({ densityMul: BOSS_HARD.densityMul, speedMul: BOSS_HARD.speedMul })
  // 硬性红线：与狂暴同款「禁止无解」——保证安全缝隙（缺口宽度 ≥ 玩家机身 × RAGE.gapMul，复用 L321-331 断言）
}
// _syncPhaseVisuals（L200）加 hell 档换色/换态（append-only）：
//   if (this.hardPhase && this.phase >= 3) → 形态视觉增强（换 accent/光晕/纹样），不动既有 phase 1/2 视觉。
```

### 精确语义
- **触发条件（C10.1）**：`difficultyCfg.id === 'hell'`（spawnBoss 传 hardPhase=true）+ Boss `phase>=3`（血量 ≤0.33 档）→ 高难附加 pattern 轮换（每次 fire 轮换 spiral/cross）。视觉增强同步。
- **非 hell 不出现（C10.2）**：casual/standard/hard 时 `hardPhase=false` → 既有行为完全一致（零回归）。
- **可应对性（C10.3）**：高难 pattern 复用既有 pattern 的弹幕生成骨架，仅乘密度/速度系数；沿用「禁止无解」硬性红线（RAGE.gapMul 缺口断言逻辑可复用于高难 pattern）。
- **狂暴共存（C10.4）**：`_enraging`（hp<maxHp×15%）分支**优先**——高难 pattern 只存在于 phase 3 且非狂暴时；血量 <15% 后 RAGE 链路原样执行（A7 零回归）。
- **死亡结算（C10.5）**：Boss 死亡仍走既有 BOSS_DEFEATED 事件 → `_onBossDefeated`（GameScene L595）→ 成就/掉落/爬塔各记一次，不双触发。
- **不改**：0.66/0.33 阶段阈值、RAGE 配置/触发语义、既有 Boss 纹理/HP/掉落、成就/图鉴。

### 参数表（append-only）
`BOSS_HARD` 配置块（如上）；`_fireHardPattern` 内部 `_hardPatIdx`（局内轮换游标，不入存档）；i18n 词条 `bossHardPhase_*`（若 hell 形态有独立命名展示，可追加）。

### 降级策略
- **reduced-motion**：形态切换演出静态化（换色/换态，不加动画）。
- **性能三档**：low 档 `_density()` 已有减半逻辑（Boss L342/407 等 `this._density()`），高难 pattern 沿用 → 弹量自动降级；若需更严格可让 BOSS_HARD.densityMul 在 low 档不生效（实现按既有 _density 纪律）。
- **非 hell**：功能整体关闭（hardPhase=false）。

### 风险与回归点
- **狂暴共存（最高风险）**：高难 pattern 必须让位于狂暴 → QA 专项断言：hell 档 Boss 血量 <15% 时狂暴专属弹幕仍触发、高难 pattern 不再叠加（C10.4）。
- **阶段机零改动**：Boss.js diff 仅追加（constructor 字段/`_fire` 前置分支/`_fireHardPattern`/`_syncPhaseVisuals` hell 分支）；QA grep 断言 0.66/0.33 判定与 RAGE 触发行未改。
- **可应对性**：高难 pattern 不得无解（沿用缺口红线）；QA 用自动化玩家位置采样断言存在安全缝隙。
- **非 hell 零回归**：casual/standard/hard Boss 行为逐帧等价。
- 回归：四 Boss 阶段、狂暴、BossRush/爬塔 Boss、掉落/成就链路。

### 探针建议
- `qa_probes/test_prod_c10.mjs`：hell 档进入 phase 3 → 断言附加 pattern 出现（_hardPatIdx 轮换/BOSS_HARD.phase3Patterns）；casual/standard/hard 同场景断言无附加 pattern；血量压 <15% → 断言 _enraging 触发且高难 pattern 让位；Boss 死亡 → 断言 BOSS_DEFEATED 只触发一次；断言 Boss.js 既有 phase/RAGE 阈值行 diff 为空。

---

## 附录 A：新增存档字段汇总（全部 append-only，语义零改动）

| 字段 | 类型/默认 | 所属条目 | 说明 |
|---|---|---|---|
| `dailyChallenge` | `{ date:'', bestScore:0, cleared:false, claimed:false }` | C5 | 每日种子挑战当日最佳分/是否达成/是否已领（跨天按 date 重置；`claimed` 为 PM 附录 A 之外的 append-only 补充） |
| `haptics` | `true` | C7 | 震动开关（老存档缺省回退 true；平台不支持仅隐藏 UI） |

> 其余 9 条（C1/C2/C3/C4/C6/C8/C9/C10/C11）**零存档改动**：
> - C1：只读 `selectedDifficulty` + `countMedals()`（派生）；C2：复用既有 `nickname`；C3：结算 payload 只读字段（非存档）；C4：整档读写（replaceSave 公开方法）；C6：局内重进（参数透传，不入档）；C8：值回默认（replaceSave 公开方法）；C9：只读 `tutorialDone`；C10：局内/config 追加；C11：复用既有 `selectedShip`/`skins`/`ownedSkins`。
> - SaveManager.js 追加的公开方法（append-only）：`replaceSave(next)`（C4/C8）、`getDailyChallenge()/recordDailyChallenge()/claimDailyChallenge()`（C5）——均为新方法，不改旧字段语义。

---

## 附录 B：新增 i18n 词表汇总（zh/en，开发补入 Locale.js，全部 append-only）

- C1：`diffLockedTitle / diffLockedNeed / diffLockedHint`
- C2：`nicknameEdit / nicknamePlaceholder / nicknameLenErr / nicknameCharErr / saveOk`
- C3：`resGrazes / resTime / resHits`
- C4：`saveExport / saveImport / saveExportOk / saveImportOk / saveImportFail / saveImportConfirm`
- C5：`dailyChallenge / dailySeedLabel / dailyChallengeGoal / dailyChallengeReward / dailyChallengeDone`
- C6：`uiRestart / restartConfirmTitle / restartConfirmDesc / restartCancel`
- C7：`haptics / hapticsOn / hapticsOff`
- C8：`resetProgress / resetConfirmTitle / resetConfirmDesc / resetExportTip / resetDone`
- C9：`tip_nov_*`（基础 8 条）/ `tip_adv_*`（进阶 8 条）
- C10：`bossHardPhase_*`（若 hell 形态有独立命名）
- C11：`shipName_3 / shipDesc_3 / passive_3 / passiveDesc_3 / skin_3_0 / skin_3_1 / skin_3_2`

---

## 附录 C：全量回归清单（开发完成 + QA 验收对照）

| 回归面 | 相关条目 | 断言 |
|---|---|---|
| 存档读写/启动 sanitize | C1-C11 | `WINGMAN.COMBO` 未改、成就 id 集合未变、`WingmanSystem.js`/`FloatingText.js` diff 为空、SaveManager 旧字段写入点未变；正常存档字段逐字段等价 |
| 四档难度选择与系数 | C1/C10 | 难度门禁不影响存量（C1.3）；hard/hell 战斗系数不变；Boss hell 形态只在 hell 出现 |
| 结算页布局 | C2/C3 | 数据行追加后按钮可点不越界；昵称/详情双语正确；分享卡昵称同步 |
| 救济局 | C6 | 重开保留 reliefRun、不重复弹面板、不计 failStreak；不计入榜单语义不变 |
| 狂暴共存 | C10 | hell phase3 高难 pattern 下狂暴仍正常触发（专项） |
| 机库/战机/皮肤 | C11 | 既有 3 架展示零变化；第 4 架可选/皮肤可购/立绘正常 |
| 每日任务/挑战 | C5 | 每日任务既有种子/领取不变；挑战局独立结算域不污染排行榜/勋章/成就 |
| i18n zh/en | 全部 | 新增词条双语；zh 默认逐字等价；缺词条回退 zh/key |
| 主菜单/设置面板 | C1/C2/C4/C7/C8/C9 | 新入口不遮挡既有按钮；面板开合/场景重启无残留 |

---

## 附录 D：红线重申 PR 自检清单（开发提交前 grep 断言）

1. `WINGMAN.COMBO` 未改：grep `WINGMAN` diff 为空。
2. 成就 id 集合未变：`AchievementManager.js` diff 为空（C5 不加成就、C10/C11 不新增成就来源）。
3. `WingmanSystem.js` / `FloatingText.js` diff 为空（或仅附加式新增，不碰既有行为）。
4. `SaveManager.js` 旧字段写入点未变：diff 仅允许 DEFAULT_SAVE/load() 深合并 append `dailyChallenge`/`haptics` + 新增公开方法 `replaceSave/getDailyChallenge/recordDailyChallenge/claimDailyChallenge`；旧字段赋值行零改动。
5. `Boss.js` 阶段机 0.66/0.33 与 RAGE 触发行未改（C10 只允许追加）。
6. 零外部资源：无图片/音频/网络/字体依赖新增（C7 仅 `navigator.vibrate`）。
7. C1 存量豁免 / C6 救济保留 / C5 独立结算域：专项断言（QA 探针）。
