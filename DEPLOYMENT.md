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

## 运维脚本（ops/）

| 脚本 | 在哪运行 | 作用 |
|---|---|---|
| `ops/trigger-build.sh` | 本地/开发机 | 触发 GitHub 构建并推镜像到 GHCR |
| `ops/server-update.sh` | 线上服务器 | 拉最新镜像 → 停旧起新 → 健康检查（不动数据） |

```bash
# 本地：触发打包（优先用 gh workflow_dispatch，不产生提交）
bash ops/trigger-build.sh
bash ops/trigger-build.sh --tag v1.0.3   # 打版本 tag 触发，产出 :v1.0.3
bash ops/trigger-build.sh --push         # 没装/没登录 gh 时，用空提交触发

# 服务器：更新到最新镜像并重启
cd /opt/canvasmind && bash ops/server-update.sh
# 或：DEPLOY_DIR=/opt/canvasmind bash ops/server-update.sh
```

> `trigger-build.sh` 默认走 GitHub CLI（`gh auth login` 一次即可），无 gh 时加 `--push`。
> `server-update.sh` 若部署目录是 git 克隆会 `git pull`，否则只刷新 `compose.server.yml`；镜像本身通过 `docker compose pull` 更新。

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

## 线上部署（在自己的 Linux 服务器手动启动）

CI 只负责**构建镜像**，部署由你在服务器上手动执行。

### 推荐：自包含一键起（app + MariaDB + Redis）

```bash
# 服务器上任意目录
mkdir -p /opt/canvasmind && cd /opt/canvasmind

# 拉取编排与环境模板
curl -fsSLO https://raw.githubusercontent.com/young-bo-i/CanvasMind/master/compose.server.yml
curl -fsSL  https://raw.githubusercontent.com/young-bo-i/CanvasMind/master/.env.server.example -o .env

# 改 .env：数据库密码、加密密钥(openssl rand -hex 32)、CORS 访问地址
vi .env

# 启动（包已 Public，无需 docker login）
docker compose -f compose.server.yml up -d

# 查看
docker compose -f compose.server.yml ps
docker compose -f compose.server.yml logs -f app
```

访问 `http://<服务器IP或域名>:5409`，首屏走"首次安装"设管理员（用户名 4–32 位、密码 8–64 位）。

升级到最新镜像：

```bash
docker compose -f compose.server.yml pull && docker compose -f compose.server.yml up -d
```

固定版本：在 `.env` 把 `APP_IMAGE` 改成 `ghcr.io/young-bo-i/canvasmind:v1.0.2` 或 `:sha-xxxxxxx`。

### 备选：已有外部 MySQL/Redis

用仓库根目录的 `docker-compose.yml`（只起 app 容器），DB/Redis 走 `.env` 里的 `DATABASE_URL` / `REDIS_*` 指向你的外部服务。

> 生产建议在前面再挂一层 Nginx/Caddy 反代做 HTTPS，把 5409 收到内网。

## 本地自测

```bash
# 用本仓库源码构建并起一整套（MariaDB + Redis + app）
docker compose -f compose.local.yml --env-file .env.local up -d --build
# 访问 http://localhost:5409 （首屏走"首次安装"设管理员，用户名 4–32 位、密码 8–64 位）
```

`.env.local` 含本地密钥，已被 `.gitignore`（`*.local`）忽略，不会提交。
