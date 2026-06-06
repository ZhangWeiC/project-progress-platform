# 阿里云 ECS 部署

推荐使用一台 Linux ECS 运行 Docker Compose：

- `web`：Nginx，提供 Web/H5 静态页面并代理 `/api`
- `api`：Node.js + Fastify，仅在容器网络内开放
- `app_data`：SQLite 持久卷，重新构建容器不会清空数据

## 1. ECS 准备

建议配置：

- 操作系统：Alibaba Cloud Linux 3 或 Ubuntu 22.04/24.04
- 规格：2 vCPU / 4 GiB 起步
- 系统盘：40 GiB 起步
- 安全组：公网只开放 `80`、`443`；`22` 仅允许管理员固定 IP

安装 Docker Engine 和 Docker Compose 插件后，确认：

```bash
docker --version
docker compose version
```

## 2. 拉取与配置

```bash
sudo mkdir -p /opt/project-progress-platform
sudo chown "$USER":"$USER" /opt/project-progress-platform
git clone git@github.com:ZhangWeiC/project-progress-platform.git /opt/project-progress-platform
cd /opt/project-progress-platform
cp .env.example .env
```

编辑 `.env`，至少替换：

```dotenv
APP_PORT=80
INITIAL_USER_PASSWORD=一个至少12位的强密码
TZ=Asia/Shanghai
```

`INITIAL_USER_PASSWORD` 会用于新建账号，也会替换已有数据库中仍为 `123456` 的账号密码。

## 3. 启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api
```

浏览器访问：

- Web：`http://ECS公网IP/`
- H5：`http://ECS公网IP/m`
- 健康检查：`http://ECS公网IP/healthz`

初始管理员账号为 `admin`，密码为 `.env` 中的 `INITIAL_USER_PASSWORD`。

## 4. 更新版本

```bash
cd /opt/project-progress-platform
git pull --ff-only
docker compose up -d --build
docker image prune -f
```

## 5. 数据备份

本地开发数据包含 WAL 增量，不能只复制 `server/data/app.db`。使用 SQLite 在线备份：

```bash
npm run backup:data -- /tmp/project-progress-app.db
```

把现有本地数据首次迁移到 ECS：

```bash
# 本地执行
scp /tmp/project-progress-app.db ECS用户@ECS公网IP:/tmp/project-progress-app.db

# ECS 执行
cd /opt/project-progress-platform
mkdir -p restore
mv /tmp/project-progress-app.db restore/app.db
docker compose stop api
docker compose run --rm -v "$PWD/restore:/restore:ro" api node -e \
  "const Database=require('better-sqlite3'); const db=new Database('/restore/app.db',{readonly:true}); db.backup('/app/data/app.db').then(()=>db.close())"
docker compose start api
rm -rf restore
```

线上日常备份：

```bash
cd /opt/project-progress-platform
mkdir -p backups
docker compose exec -T api node -e \
  "const Database=require('better-sqlite3'); const db=new Database('/app/data/app.db',{readonly:true}); db.backup('/app/data/app-backup.db').then(()=>db.close())"
docker compose cp api:/app/data/app-backup.db "backups/app-$(date +%Y%m%d-%H%M%S).db"
```

## 6. 域名与 HTTPS

中国内地 ECS 使用域名对外提供 Web 服务前，需要按规定完成 ICP 备案。备案完成后，再将域名解析到 ECS 公网 IP，并配置 HTTPS 证书和 `443` 监听。

未备案阶段可以先通过受控网络或公网 IP 做部署验收，不应以规避审核为目的对外提供未备案域名服务。
