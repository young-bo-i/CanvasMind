# 自有部署与分支说明（young-bo-i/CanvasMind）

本仓库是 [xpnobug/CanvasMind](https://github.com/xpnobug/CanvasMind) 的 fork，用于我们自己的线上改造与部署。

## 分支模型

| 分支 | 用途 | 谁来改 |
|---|---|---|
| `master` | **我们自己的改造分支**（默认分支），CI 据此构建镜像并部署 | 我们 |
| `upstream-sync` | **上游镜像分支**，始终对齐 `xpnobug/CanvasMind:master`，不直接改 | 自动化 |

### 同步上游更新

`.github/workflows/upstream-sync.yml` 每天定时（也可手动 `Run workflow`）执行：

1. 把上游 `xpnobug/CanvasMind` 的 `master` 强制对齐到本仓库 `upstream-sync` 分支；
2. 若有新提交，自动创建 PR：`upstream-sync -> master`。

我们审阅 PR、解决与自身改造的冲突后再合并进 `master`。`master` 永不被自动覆盖。

本地手动同步（等效）：

```bash
git fetch upstream
git checkout upstream-sync && git reset --hard upstream/master && git push origin upstream-sync
git checkout master && git merge upstream-sync   # 解决冲突后提交
```

remote 约定：`origin` = 我们的 fork，`upstream` = xpnobug 原仓库。

## 镜像构建（CI）

`.github/workflows/docker-image.yml`：push 到 `master` / 打 `v*` tag / 手动触发时，构建多架构镜像并推送到 **GHCR**：

```
ghcr.io/young-bo-i/canvasmind:latest
ghcr.io/young-bo-i/canvasmind:v<package.json 版本>
ghcr.io/young-bo-i/canvasmind:sha-<commit>
```

- 推送用仓库内置 `GITHUB_TOKEN`，**无需额外账号或密钥**。
- 首次运行后，到仓库 **Packages** 把 `canvasmind` 包设为 **Public**（服务器即可免登录拉取）；若保持 Private，则服务器需 `docker login ghcr.io`。

可选仓库变量（Settings → Secrets and variables → **Variables**）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `VITE_API_BASE_URL` | 前端访问后端地址；**同域部署留空**走同源 | 空 |
| `VITE_PROVIDER_DEFAULT_BASE_URL` | 默认上游厂商地址 | `https://api.chatfire.site/v1` |

> 注意：`VITE_*` 是**构建期**变量，改动需重新构建镜像才生效。

## 线上部署

### 方式 A：自动部署（`.github/workflows/deploy.yml`）

镜像构建成功后自动 SSH 到服务器执行 `docker compose pull && up -d`。需在仓库 **Secrets** 配置：

`SERVER_HOST`、`SERVER_USERNAME`、`SERVER_SSH_KEY`、`SERVER_PORT`（可选，默认 22）、`DEPLOY_PATH`、
`DATABASE_URL`、`PROVIDER_CONFIG_SECRET`、`STORAGE_CONFIG_SECRET`、`CORS_ALLOWED_ORIGINS`、`VITE_API_BASE_URL`、
`REDIS_ENABLED`、`REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`、`REDIS_DATABASE`。

> 若 GHCR 包为 Private，另配 `GHCR_USERNAME` + `GHCR_PAT`（含 `read:packages` 的 PAT），部署脚本会自动登录。

服务器上需要外部的 MySQL/MariaDB 与（可选）Redis —— 生产 `docker-compose.yml` 只起 app 容器，DB 走 `DATABASE_URL`。

### 方式 B：服务器手动部署

```bash
# 服务器上准备 docker-compose.yml 与 .env（参考 .env.docker.example）
docker login ghcr.io                # 若包为 Private
docker compose pull
docker compose up -d --force-recreate --remove-orphans
```

镜像 tag 可用环境变量覆盖：`APP_IMAGE=ghcr.io/young-bo-i/canvasmind:v1.0.2 docker compose up -d`

## 本地自测

```bash
# 用本仓库源码构建并起一整套（MariaDB + Redis + app）
docker compose -f compose.local.yml --env-file .env.local up -d --build
# 访问 http://localhost:5409 （首屏走"首次安装"设管理员，用户名 4–32 位、密码 8–64 位）
```

`.env.local` 含本地密钥，已被 `.gitignore`（`*.local`）忽略，不会提交。
