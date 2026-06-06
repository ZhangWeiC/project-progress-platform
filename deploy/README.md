# 阿里云 ECS 原生部署

所有组件部署在同一台 Linux ECS，不使用 Docker：

- Nginx：提供 Web/H5 静态页面，并将 `/api` 代理到 Node.js
- Node.js + Fastify：仅监听 `127.0.0.1:4000`
- SQLite：存放于 `/var/lib/project-progress-platform/app.db`
- systemd：管理 Node 服务并设置开机自启

## 1. ECS 准备

建议配置：

- 操作系统：Alibaba Cloud Linux 3 或 Ubuntu 22.04/24.04
- 规格：2 vCPU / 4 GiB 起步
- 系统盘：40 GiB 起步
- Node.js：20 LTS
- 安全组：公网只开放 `80`、`443`；`22` 仅允许管理员固定 IP

安装基础软件：

```bash
# Alibaba Cloud Linux 3
sudo dnf install -y git nginx gcc-c++ make python3

# Ubuntu
sudo apt update
sudo apt install -y git nginx build-essential python3
```

安装 Node.js 20 后确认：

```bash
node --version
corepack enable
corepack prepare pnpm@9.15.5 --activate
pnpm --version
```

systemd 文件默认使用 `/usr/bin/node`，如果 `command -v node` 输出其他路径，需要同步修改服务文件中的 `ExecStart`。

## 2. 拉取和构建

```bash
sudo mkdir -p /opt/project-progress-platform
sudo chown "$USER":"$USER" /opt/project-progress-platform
git clone git@github.com:ZhangWeiC/project-progress-platform.git /opt/project-progress-platform
cd /opt/project-progress-platform
pnpm install --frozen-lockfile
pnpm run build
```

## 3. 配置系统服务

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin project-progress 2>/dev/null || true
sudo mkdir -p /var/lib/project-progress-platform
sudo chown project-progress:project-progress /var/lib/project-progress-platform

sudo cp deploy/project-progress-platform.service /etc/systemd/system/
sudo cp .env.example /etc/project-progress-platform.env
sudo chmod 600 /etc/project-progress-platform.env
sudo vi /etc/project-progress-platform.env
```

至少将 `INITIAL_USER_PASSWORD` 替换为 12 位以上的强密码。它会用于新账号，并替换数据库中仍为 `123456` 的旧密码。

启动 API：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now project-progress-platform
sudo systemctl status project-progress-platform
curl http://127.0.0.1:4000/api/health
```

## 4. 配置 Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/project-progress-platform.conf

# Ubuntu 默认站点会占用 80 端口，需要禁用
sudo rm -f /etc/nginx/sites-enabled/default

# 如果 /etc/nginx/conf.d/default.conf 存在且也是默认站点，请先备份再禁用
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

浏览器访问：

- Web：`http://ECS公网IP/`
- H5：`http://ECS公网IP/m`
- 健康检查：`http://ECS公网IP/healthz`

初始管理员账号为 `admin`。

## 5. 迁移当前数据

本地数据库包含 WAL 增量，不能只复制 `server/data/app.db`。先在本地生成一致性备份：

```bash
npm run backup:data -- /tmp/project-progress-app.db
scp /tmp/project-progress-app.db ECS用户@ECS公网IP:/tmp/project-progress-app.db
```

在 ECS 上恢复：

```bash
sudo systemctl stop project-progress-platform
sudo install -o project-progress -g project-progress -m 600 \
  /tmp/project-progress-app.db /var/lib/project-progress-platform/app.db
sudo systemctl start project-progress-platform
sudo journalctl -u project-progress-platform -n 100 --no-pager
```

服务启动时会自动执行数据库结构升级，并按照环境变量替换仍为默认值的登录密码。

## 6. 日常更新

```bash
cd /opt/project-progress-platform
./deploy/update.sh
```

## 7. 数据备份

```bash
sudo mkdir -p /var/backups/project-progress-platform
sudo chown project-progress:project-progress /var/backups/project-progress-platform
sudo -u project-progress env DATA_DIR=/var/lib/project-progress-platform \
  node /opt/project-progress-platform/scripts/backup-db.mjs \
  "/var/backups/project-progress-platform/app-$(date +%Y%m%d-%H%M%S).db"
```

建议再用阿里云云盘快照或 OSS 保存异机副本。

## 8. 域名与 HTTPS

中国内地 ECS 使用域名对外提供 Web 服务前，需要按规定完成 ICP 备案。备案完成后，再将域名解析到 ECS 公网 IP，并配置 HTTPS 证书和 `443` 监听。
