#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/project-progress-platform}"
export PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin

cd "$APP_DIR"
git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm run build

sudo systemctl restart project-progress-platform
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl --no-pager --full status project-progress-platform
