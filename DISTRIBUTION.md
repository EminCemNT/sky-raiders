# 苍穹战机 Sky Raiders · 分发上线指南

> 本文档汇总 itch.io 与 CrazyGames 的上架流程、命令、材料清单与已知适配坑。
> 当前状态：GitHub Pages 已自动部署（`https://emincemnt.github.io/sky-raiders/`）；生产构建 `dist/` 已通过真测（`qa_dist_smoke.mjs`：零 pageerror、资源全 200、可进 GameScene）。

---

## 0. 构建产物速览（已验证）

```
dist/
├── index.html                      2.36 kB   (gzip 1.18 kB)
└── assets/
    ├── index-D7QgQVjh.js         125.76 kB  (gzip 38.91 kB)  ← 业务代码
    └── phaser-Pd2ESoD5.js       1478.94 kB  (gzip 339.71 kB) ← Phaser 引擎
```

- **总体积**：gzip 后 ≈ 380 KB（远低于 CrazyGames 50 MB 硬限）
- **文件数**：3 个（远低于 CrazyGames 1500 文件硬限）
- **相对路径**：`vite.config.js` 已设 `base: './'`，`index.html` 在根，资源用相对引用 → 适配 itch.io 子路径 / CrazyGames iframe / 任意静态目录
- **已备发布包**：`sky-raiders-web.zip`（根目录，网页上传直接用；butler 也可直接推 `dist/` 目录）

---

## 1. itch.io（✅ 推荐首发，门槛最低）

itch.io 无审批门槛、无 SDK、原生支持竖屏、可免费"Pay What You Want"。

### 1.1 创建项目（一次性，浏览器）
1. 注册并开启开发者模式：`itch.io` → Settings → Developer → Enable Developer Mode
2. Dashboard → **Create New Game**
   - Title / URL slug：建议 `sky-raiders`
   - Kind of project：**HTML**（浏览器游玩）
   - Viewport size：**540 × 960**（竖屏，匹配游戏逻辑分辨率）
   - 勾选 "This file will be played in the browser"
3. 填写分类/标签（见 1.4）、上传截图（≥3，建议 6）、封面图（630×500 或 315×250）

### 1.2 上传方式 A：butler 命令行（推荐 CI/重复发布）
```bash
# 1) 安装 butler（Windows: scoop install butler；或 https://itch.io/butler 下载）
# 2) 登录（浏览器授权，一次性）
butler login
# 3) 推送（dist/ 目录或 zip 均可；channel 用 html5）
butler push dist/ <itch-username>/sky-raiders:html5 --userversion 1.0.0
```
- **API key（CI 用，非 butler login）**：`itch.io → Settings → API Keys` 生成 `BUTLER_API_KEY`（注意是 butler 专用 key，不是普通 API key）
- CI 自动发布（GitHub Actions 片段，可选）：
  ```yaml
  # .github/workflows/itch.yml  （on: push: tags: ['v*.*.*']）
  - uses: remarkablegames/setup-butler@v2
  - run: butler push ./dist <username>/sky-raiders:html5 --userversion "${GITHUB_REF_NAME}"
    env: { BUTLER_API_KEY: ${{ secrets.BUTLER_API_KEY }} }
  ```

### 1.3 上传方式 B：纯网页上传（最简，无需 butler）
项目页面 → **Upload** → 直接传 `sky-raiders-web.zip`（根目录已备好）。

### 1.4 推荐元数据
- 短描述：*Vertical-scrolling bullet-hell shooter with wingmen, elements & combo system.*
- 标签：`shooter` `bullet-hell` `pixel-art` `sci-fi` `vertical` `arcade`
- 截图：实际 gameplay（菜单+战斗+连击 HUD+Boss），别只截菜单

---

## 2. CrazyGames（⚠️ 两阶段，需先评估竖屏 + 英文）

CrazyGames 是 3500 万 MAU 的网页游戏平台，但**有两处硬伤**需先解决（见 2.4）。

### 2.1 两阶段发布流程
1. **Basic Launch**（7–21 天，限流受众）：**不需 SDK**、无变现、仅 Basic QA 审查。需满 7 天且 ≥500 plays 才进 Full。
2. **Full Launch**（全球、可变现）：**必须集成 CrazyGames SDK**（轻量 JS API，处理广告/云存档/分析）。

### 2.2 硬限制（Basic 即需满足）
- 初始下载 ≤ 50 MB（✓ 我们 ~380 KB gzip）、文件数 ≤ 1500（✓ 3 个）
- 16:9 响应式 iframe，关键尺寸：907×510 / 1216×684 / 1077×606 / 821×462（桌面非全屏）、1366×768 / 1920×1080 / 1536×864 / 1280×720（桌面全屏）、800×450（移动）、1080×607（平板）
- **PEGI 12** 合规（13+ 受众）
- **英文本地化**（强制，按 locale 切换，缺失回退英文）
- 物理用 delta time（✓ Phaser 默认）
- 全屏由 CG 自动提供，**禁止自定义全屏按钮**
- 无交叉推广（菜单不能有外链/导流到外部游戏平台）

### 2.3 提交流程
1. 开发者门户 `developers.crazygames.com` → Submit a game
2. 上传 HTML5 build（zip 或提供 URL）+ 标题 / 描述 / 标签 / 图标 / 截图 / 可选 trailer
3. 用 **Preview 工具** 先在 CG 环境实测显示与触控
4. 提交 → QA 审查 → Basic Launch

### 2.4 ⚠️ 两大适配硬伤（上线前必须拍板）
| 问题 | 现状 | 影响 | 解法 |
|------|------|------|------|
| **竖屏 540×960** | CG 主流 iframe 是 16:9 横屏 | 竖屏游戏在横屏 iframe 会黑边/缩放异常，可读性存疑 | 用 Preview 工具实测；必要时容器 letterbox 或确认 CG 竖屏支持 |
| **纯中文 UI** | 游戏全中文 | CG **强制英文本地化** + 按 locale 切换 | 需加英文（所有 UI 文本 + i18n 切换），属真实内容工作量 |

> 建议：**先发 itch.io**（零门槛、竖屏友好）；CrazyGames 待竖屏实测 + 英文本地化拍板后再提交 Basic Launch。Full Launch 的 SDK 集成是可后续追加的代码改动。

---

## 3. 质量验证记录
- 探针 `qa_probes/qa_dist_smoke.mjs`：自带静态服托管 `dist/` + Playwright 系统 Chrome 真跑
- 结果 **PASS**：静态服启动 ✓ / canvas 渲染 ✓ / 进 GameScene ✓ / 资源全 200 ✓ / 零 pageerror+console error ✓
- 红线未碰：`GameConfig` COMBO 块五字段、成就 id 键均只读未改

---

## 4. 待爸爸手动操作清单
- [ ] **itch.io**：注册开发者 + 创建项目（或提供 `BUTLER_API_KEY` 让我配 CI 自动 push）
- [ ] **CrazyGames**：是否要为上线做**英文本地化**？（拍板后我实现 i18n + 英文文本）
- [ ] **CrazyGames**：竖屏在 CG iframe 的实测（用其 Preview 工具）是否可接受？
- [ ] 本文档 `DISTRIBUTION.md` 是否进版本库（参考 `OPTIMIZATION_ROADMAP.md` 故意不上库惯例，暂未入库；`sky-raiders-web.zip` 为发布包，不进 git）
