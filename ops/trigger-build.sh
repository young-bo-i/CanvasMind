#!/usr/bin/env bash
# 触发 GitHub Actions 构建并推送镜像到 GHCR（docker-image.yml）。
#
# 用法：
#   bash ops/trigger-build.sh                # 触发 master 构建并监视到完成
#   bash ops/trigger-build.sh --tag v1.0.3   # 打版本 tag 触发（产出 :v1.0.3 镜像）
#   bash ops/trigger-build.sh --push         # 无 gh 时：用空提交 push 触发
#
# 优先使用 GitHub CLI（gh，需 `gh auth login`）走 workflow_dispatch（不产生提交）。
set -euo pipefail

REPO="young-bo-i/CanvasMind"
WORKFLOW="docker-image.yml"
REF="master"
MODE="dispatch"
TAG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag 需要版本号，如 v1.0.3}"; MODE="tag"; shift 2 ;;
    --push) MODE="push"; shift ;;
    --ref) REF="${2:?}"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

# 必须在仓库内执行
cd "$(git rev-parse --show-toplevel 2>/dev/null || true)" 2>/dev/null || {
  echo "请在 CanvasMind 仓库目录内运行此脚本。" >&2; exit 1; }

# ---- 模式：打 tag 触发 ----
if [ "$MODE" = "tag" ]; then
  echo "▶ 打版本 tag 触发构建：$TAG"
  git tag -a "$TAG" -m "release $TAG"
  git push origin "$TAG"
  echo "✅ 已推送 tag $TAG，前往 Actions 查看："
  echo "   https://github.com/$REPO/actions/workflows/$WORKFLOW"
  exit 0
fi

# ---- 模式：空提交 push 触发（无 gh 时的兜底）----
if [ "$MODE" = "push" ]; then
  echo "▶ 用空提交触发 master 构建"
  git commit --allow-empty -m "ci: 手动触发镜像构建 [skip-noop]"
  git push origin "$REF"
  echo "✅ 已 push，前往 Actions 查看："
  echo "   https://github.com/$REPO/actions/workflows/$WORKFLOW"
  exit 0
fi

# ---- 模式：gh workflow_dispatch（首选）----
if ! command -v gh >/dev/null 2>&1; then
  echo "未安装 GitHub CLI(gh)。两种选择：" >&2
  echo "  A) 安装并登录：brew install gh && gh auth login，再重跑本脚本" >&2
  echo "  B) 直接用空提交触发：bash ops/trigger-build.sh --push" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh 未登录。执行 gh auth login，或改用：bash ops/trigger-build.sh --push" >&2
  exit 1
fi

echo "▶ 触发 workflow_dispatch：$REPO / $WORKFLOW @ $REF"
gh workflow run "$WORKFLOW" --repo "$REPO" --ref "$REF"

# 等待 run 出现（dispatch 后可能有几秒延迟）
echo "⏳ 等待 workflow 启动..."
RUN_ID=""
for _ in $(seq 1 12); do
  sleep 3
  RUN_ID=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --branch "$REF" \
            --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)
  [ -n "$RUN_ID" ] && break
done
if [ -z "$RUN_ID" ]; then
  echo "⚠ 未取到 run id，手动查看：https://github.com/$REPO/actions"; exit 0
fi

echo "▶ Run: https://github.com/$REPO/actions/runs/$RUN_ID"
echo "⏳ 监视构建直至完成..."
if gh run watch "$RUN_ID" --repo "$REPO" --exit-status; then
  echo "✅ 构建成功！镜像已推送："
  echo "   ghcr.io/young-bo-i/canvasmind:latest"
  echo "   服务器更新：bash ops/server-update.sh"
else
  echo "❌ 构建失败。查看失败日志：gh run view $RUN_ID --repo $REPO --log-failed" >&2
  exit 1
fi
