#!/usr/bin/env bash
# ============================================================================
# 苍穹战机 · 无损推送脚本
#
# 背景一（历史断裂）：本地 .git 对象库曾损坏，第一版交付时用 `commit-tree`
#       （无父节点）外科手术重建，导致本地是一个孤立 root commit，与远端 main
#       没有共同祖先。直接 push 会被拒；`--force` 能推上去但会冲掉远端历史。
#       本脚本改用「嫁接」：把远端 main 认作父节点、用当前工作树的 tree 重新
#       生成 commit（内容一字不变），于是变成普通快进推送，远端历史零丢失。
#
# 背景二（代理陷阱）：环境变量 HTTP_PROXY/HTTPS_PROXY 指向 127.0.0.1:10793，
#       但该端口常常没有进程监听（代理软件未启动），导致所有出站请求失败、
#       看起来像"断网"。本脚本会自动探测并在必要时降级为直连。
#
# 用法：
#   bash push_when_online.sh          # 预演，只看差异不推送
#   bash push_when_online.sh --push   # 真正执行嫁接并推送
# ============================================================================
set -euo pipefail

REPO="/d/WorkBuddy/sky-raiders"
BRANCH="main"
DO_PUSH="${1:-}"

cd "$REPO"

echo "=== 0. 前置检查 ==="
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作树不干净，请先提交或清理后再跑。"
  git status --short
  exit 1
fi
echo "✅ 工作树干净"
echo "   本地 HEAD : $(git rev-parse --short HEAD)  ($(git rev-list --count HEAD) 个 commit)"

echo
echo "=== 1. 网络探测（含代理自动降级）==="
NOPROXY_ENV="env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy"

probe() {  # $1 = 前缀命令；返回 0 表示通
  local out
  out=$($1 curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://github.com 2>/dev/null || true)
  case "$out" in *200*|*301*|*302*) return 0 ;; *) return 1 ;; esac
}

GIT="git"
if [ -n "${HTTPS_PROXY:-}${HTTP_PROXY:-}" ]; then
  echo "   检测到代理设置: ${HTTPS_PROXY:-${HTTP_PROXY:-}}"
  if probe ""; then
    echo "✅ 经代理可达 github.com"
  elif probe "$NOPROXY_ENV"; then
    echo "⚠️  代理不可用（端口无监听？），已自动降级为直连"
    GIT="$NOPROXY_ENV git"
  else
    echo "❌ 代理与直连均不可达，网络确实有问题。稍后再试。"
    exit 1
  fi
else
  if probe ""; then
    echo "✅ 直连可达 github.com"
  else
    echo "❌ github.com 不可达。稍后再试。"
    exit 1
  fi
fi

echo
echo "=== 2. 拉取远端引用 ==="
$GIT fetch origin "$BRANCH"
REMOTE=$(git rev-parse FETCH_HEAD)
echo "   远端 origin/$BRANCH : $(git rev-parse --short "$REMOTE")"
echo "   远端历史深度        : $(git rev-list --count "$REMOTE") 个 commit"

echo
echo "=== 3. 共同祖先检查 ==="
if git merge-base --is-ancestor "$REMOTE" HEAD 2>/dev/null; then
  echo "✅ 远端已是本地祖先，可直接快进推送，无需嫁接。"
  if [ "$DO_PUSH" = "--push" ]; then
    $GIT push origin "$BRANCH"
    echo "✅ 推送完成"
  else
    echo "（预演模式，未推送。加 --push 执行）"
  fi
  exit 0
fi
echo "⚠️  本地与远端无共同祖先（预期内，因 .git 曾重建）——将执行嫁接。"

echo
echo "=== 4. 差异预览：远端有、本地没有的文件（嫁接后这些会从远端消失）==="
LOST=$(git diff --name-only --diff-filter=D "$REMOTE" HEAD || true)
if [ -z "$LOST" ]; then
  echo "✅ 无文件会丢失，本地工作树是远端的超集或等价集。"
else
  echo "$LOST" | sed 's/^/   ⚠️  /'
  echo
  echo "   ↑ 请确认这些文件确实应被删除（已重命名/已废弃）。"
  echo "     若仍需要，请先从远端取回再跑本脚本。"
fi

echo
echo "=== 5. 改动规模 ==="
git diff --stat "$REMOTE" HEAD | tail -3

if [ "$DO_PUSH" != "--push" ]; then
  echo
  echo "──────────────────────────────────────────────────"
  echo "预演结束，未做任何修改。确认无误后执行："
  echo "    bash push_when_online.sh --push"
  echo "──────────────────────────────────────────────────"
  exit 0
fi

echo
echo "=== 6. 执行嫁接 ==="
SAFETY=$(git rev-parse HEAD)
echo "   安全网：嫁接前 HEAD = $SAFETY（出问题可 git reset --hard $SAFETY 回滚）"

TREE=$(git rev-parse 'HEAD^{tree}')
MSG=$(git log -1 --pretty=%B)
NEW=$(git commit-tree "$TREE" -p "$REMOTE" -m "$MSG")
echo "   新 commit: $(git rev-parse --short "$NEW")  (parent = $(git rev-parse --short "$REMOTE"))"

if [ "$(git rev-parse "$NEW^{tree}")" != "$TREE" ]; then
  echo "❌ 嫁接后 tree 不一致，中止。"
  exit 1
fi
echo "✅ tree 校验通过（内容与嫁接前完全一致）"

git reset --hard "$NEW"
echo "✅ 本地已指向嫁接后的 commit，历史深度: $(git rev-list --count HEAD)"

echo
echo "=== 7. 推送（快进，非 force）==="
$GIT push origin "$BRANCH"
echo
echo "✅ 推送完成：https://github.com/EminCemNT/sky-raiders"
echo "   远端历史完整保留，本次成果作为新 commit 追加。"
echo
echo "提示：确认无误后可回收恢复备份目录："
echo "   D:/WorkBuddy/sky-raiders-RECOVERY-BACKUP/"
