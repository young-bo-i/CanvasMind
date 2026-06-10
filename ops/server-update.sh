#!/usr/bin/env bash
# 在 Linux 服务器上更新到最新镜像并重启（不影响数据卷）。
#
# 用法（在部署目录内，需有 .env）：
#   bash ops/server-update.sh
#   DEPLOY_DIR=/opt/canvasmind bash ops/server-update.sh
#
# 流程：拉取最新代码/编排 -> docker compose pull -> 停旧起新 -> 清理悬空镜像 -> 健康检查。
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
COMPOSE_FILE="compose.server.yml"
RAW_BASE="https://raw.githubusercontent.com/young-bo-i/CanvasMind/master"

cd "$DEPLOY_DIR"
echo "▶ 部署目录：$DEPLOY_DIR"

if [ ! -f .env ]; then
  echo "❌ 缺少 .env（先 cp .env.server.example .env 并修改）" >&2
  exit 1
fi

# 1) 拉取最新「代码/编排」
if [ -d .git ]; then
  echo "▶ git pull 最新代码 ..."
  git pull --ff-only
else
  echo "▶ 刷新 $COMPOSE_FILE ..."
  curl -fsSL "$RAW_BASE/$COMPOSE_FILE" -o "$COMPOSE_FILE"
fi

[ -f "$COMPOSE_FILE" ] || { echo "❌ 找不到 $COMPOSE_FILE" >&2; exit 1; }

# 2) 拉取最新镜像
echo "▶ 拉取最新镜像 ..."
docker compose -f "$COMPOSE_FILE" pull

# 3) 停旧容器、用新镜像起新容器（数据卷保留，不加 -v）
echo "▶ 停止并重启容器 ..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# 4) 清理悬空旧镜像，释放磁盘
echo "▶ 清理旧镜像 ..."
docker image prune -f >/dev/null 2>&1 || true

# 5) 状态 + 健康检查
echo "▶ 当前状态："
docker compose -f "$COMPOSE_FILE" ps

PORT="$(awk -F= '/^APP_PORT=/{v=$2} END{print v}' .env)"; PORT="${PORT:-5409}"
echo "▶ 健康检查 http://127.0.0.1:${PORT}/api/health（最多等 60s）..."
for _ in $(seq 1 12); do
  if curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "✅ 更新完成，应用就绪：端口 ${PORT}"
    exit 0
  fi
  sleep 5
done

echo "⚠ 健康检查超时。查看日志：docker compose -f $COMPOSE_FILE logs --tail 100 app" >&2
exit 1
