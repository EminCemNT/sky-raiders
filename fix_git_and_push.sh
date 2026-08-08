#!/usr/bin/env bash
# ============================================================================
# 苍穹战机 · git 对象库损坏恢复 + 提交推送
#
# 用途：.git/objects 被中断的 auto-gc 打坏（fatal: bad object HEAD）时，
#       从远端 clone 一份干净的 .git 换回来，工作树原样保留。
#
# 设计原则：
#   1. 只替换 .git，绝不触碰工作树文件（代码是真值，远端历史也是真值）
#   2. 坏的 .git 改名保留，不删除（随时可回退）
#   3. 不做任何 force 操作，远端历史零风险
#   4. 默认只恢复不提交；要提交推送需显式加 --push
#
# 用法：
#   bash fix_git_and_push.sh            # 只恢复 .git，然后人工检查
#   bash fix_git_and_push.sh --push     # 恢复 + 提交 + 推送
# ============================================================================
set -u

REPO="/d/WorkBuddy/sky-raiders"
REMOTE_URL="https://github.com/EminCemNT/sky-raiders.git"
TMP="/d/WorkBuddy/_gitfix_tmp"
STAMP="$(date +%Y%m%d_%H%M%S)"
DO_PUSH=0
[ "${1:-}" = "--push" ] && DO_PUSH=1

COMMIT_MSG="feat: 苍穹战机 - 元素协同成就阈值精确还原（combo_element_5→3 / _50→30）

TRIGGER 从 3 上调到 5 后，两个成就 target 未同步，导致达成成本被动上浮 67%。
按算术精确还原：3x5=15、30x5=150，与上调前完全等价。

- AchievementManager.js: 两条成就 desc/condition/progress 共 6 处数字同步
- 成就 id 保持不变（存档解锁主键，改动会使老玩家记录失效）
- GameConfig.js 零改动，TRIGGER 仍为 5
- 新增边界值断言与交替命中成本断言（第14次未解锁/第15次恰好解锁）
- E2 探针判定改为「交替命中次数」口径，不再受帧率与接敌率影响"

say() { echo "[$(date +%H:%M:%S)] $*"; }
die() { echo "[错误] $*" >&2; exit 1; }

# ---------------------------------------------------------------- 网络探测
# 环境陷阱：HTTP_PROXY/HTTPS_PROXY 常指向 127.0.0.1:10793 但该端口无进程监听，
# 造成"假性断网"。这里先试代理，不通则自动降级为直连。
# 双保险绕过：既清环境变量，也清 git 内置 http.proxy/https.proxy。
# 实测两者单独使用都能绕过假死代理，一起用最稳。
NOPROXY="env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy"
DIRECT="$NOPROXY git -c http.proxy= -c https.proxy="
GIT_CMD="git"

probe() {
  local i
  # 网络有波动，同一姿势可能这一秒不通下一秒通，所以每种方式各重试 3 次
  for i in 1 2 3; do
    say "探测网络（第 $i 轮）..."
    if git ls-remote "$REMOTE_URL" HEAD >/dev/null 2>&1; then
      say "  → 代理可用"
      GIT_CMD="git"
      return 0
    fi
    if $DIRECT ls-remote "$REMOTE_URL" HEAD >/dev/null 2>&1; then
      say "  → 直连可用（代理假死，已绕过）"
      GIT_CMD="$DIRECT"
      return 0
    fi
    say "  → 本轮不通"
    [ "$i" -lt 3 ] && sleep 3
  done
  return 1
}

probe || die "网络确实不通（代理与直连都失败）。稍后重试，代码资产是安全的。"

REMOTE_MAIN=$($GIT_CMD ls-remote "$REMOTE_URL" main | awk '{print $1}')
[ -n "$REMOTE_MAIN" ] || die "拿不到远端 main 的 hash"
say "远端 main = $REMOTE_MAIN"

# ---------------------------------------------------------------- 前置校验
[ -d "$REPO" ] || die "仓库目录不存在: $REPO"
cd "$REPO" || die "无法进入 $REPO"

# 确认工作树里的改动确实还在（防止在错误的状态下操作）
grep -q "elementCombosRun >= 3" src/systems/AchievementManager.js \
  || die "工作树里没有找到 target=3 的改动，状态不对，中止"
grep -q "TRIGGER: 5," src/config/GameConfig.js \
  || die "GameConfig 的 TRIGGER 不是 5，红线被破坏，中止"
say "工作树校验通过：阈值改动在位，TRIGGER 红线完好"

# ---------------------------------------------------------------- clone
rm -rf "$TMP" 2>/dev/null
mkdir -p "$TMP" || die "无法创建临时目录"
say "从远端 clone 干净的 .git ..."
$GIT_CMD clone "$REMOTE_URL" "$TMP/sky-raiders" >/dev/null 2>&1 \
  || die "clone 失败"
[ -d "$TMP/sky-raiders/.git" ] || die "clone 出来没有 .git"

CLONED_HEAD=$(cd "$TMP/sky-raiders" && git rev-parse HEAD)
say "clone 完成，HEAD = $CLONED_HEAD"
[ "$CLONED_HEAD" = "$REMOTE_MAIN" ] || die "clone 的 HEAD 与远端 main 不一致，中止"

# ---------------------------------------------------------------- 换 .git
say "备份损坏的 .git → .git_broken_$STAMP"
mv "$REPO/.git" "$REPO/.git_broken_$STAMP" || die "备份旧 .git 失败"
say "移入干净的 .git"
mv "$TMP/sky-raiders/.git" "$REPO/.git" || {
  mv "$REPO/.git_broken_$STAMP" "$REPO/.git"
  die "移入新 .git 失败，已回滚"
}

# 立刻禁用 auto-gc —— 本仓库已被 auto-gc 打坏两次
git config gc.auto 0
git config gc.autoDetach false
say "已对本仓库禁用 auto-gc（这是它第二次被 auto-gc 打坏）"

# ---------------------------------------------------------------- 验证
say "验证 git 恢复情况..."
git rev-parse HEAD >/dev/null 2>&1 || die "恢复后 HEAD 仍读不出来"
say "  HEAD = $(git rev-parse --short HEAD)"
say "  改动文件："
git status --porcelain | sed 's/^/    /'

CHANGED=$(git status --porcelain | wc -l)
[ "$CHANGED" -gt 0 ] || say "  [注意] 工作树无改动，可能改动已在远端"

# 红线复查：GameConfig 不允许出现在改动列表里
if git status --porcelain | grep -q "src/config/GameConfig.js"; then
  echo ""
  echo "[警告] GameConfig.js 出现在改动列表中，本次不应改它！"
  echo "       请人工检查 git diff src/config/GameConfig.js 后再决定是否提交。"
  DO_PUSH=0
fi

# ---------------------------------------------------------------- 提交推送
if [ "$DO_PUSH" -eq 1 ]; then
  say "提交并推送..."
  git add -A || die "git add 失败"
  git commit -m "$COMMIT_MSG" || die "commit 失败"
  NEW=$(git rev-parse HEAD)
  say "  新 commit = $NEW"
  $GIT_CMD push origin main || die "push 失败（本地 commit 已生成，可稍后重试 push）"
  say "推送成功"
  say "  远端 main 现在 = $($GIT_CMD ls-remote "$REMOTE_URL" main | awk '{print $1}')"
else
  echo ""
  say "已恢复 .git，未提交。人工检查无误后执行："
  echo "    cd $REPO"
  echo "    git diff                 # 看改动"
  echo "    bash fix_git_and_push.sh --push   # 或直接重跑本脚本带 --push"
fi

echo ""
say "损坏的旧 .git 保留在: $REPO/.git_broken_$STAMP"
say "确认一切正常后可手动删除它"
rm -rf "$TMP" 2>/dev/null
say "完成"
