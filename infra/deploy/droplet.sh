#!/usr/bin/env bash
# DigitalOcean droplet (any Ubuntu/Debian VM): code + built data -> `make up` -> Caddy (HTTPS).
#   make deploy DEPLOY_TARGET=droplet DROPLET=root@203.0.113.7 [DOMAIN=lunar.example.org]
# DOMAIN defaults to <ip>.nip.io (works without owning a domain). Data is built locally
# (make data) and copied, so the droplet never downloads from NASA servers.
set -euo pipefail
: "${DROPLET:?set DROPLET, e.g. DROPLET=root@203.0.113.7}"
DIR="${REMOTE_DIR:-/srv/lunar}"
HOST="${DROPLET#*@}"
DOMAIN="${DOMAIN:-$HOST.nip.io}"
[ -f data/web/dem/index.json ] || { echo "data/web missing: run make data (or make data-min) first" >&2; exit 1; }

echo "== 1/4 server packages (docker, make, rsync) =="
ssh "$DROPLET" 'command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
  command -v make >/dev/null && command -v rsync >/dev/null || { apt-get update -q && apt-get install -yq make rsync; }'

echo "== 2/4 code + data -> $DROPLET:$DIR =="
ssh "$DROPLET" "mkdir -p $DIR/data"
git ls-files -z | tar --null -T - -czf - | ssh "$DROPLET" "tar -xzf - -C $DIR"   # tracked files only
rsync -az --progress data/web data/work data/manifest.json "$DROPLET:$DIR/data/"   # incremental on re-deploy

echo "== 3/4 make up (app on 127.0.0.1:8642, only Caddy is public) =="
ssh "$DROPLET" "cd $DIR && make up COMPOSE_PORT=127.0.0.1:8642"

echo "== 4/4 Caddy: https://$DOMAIN -> app =="
ssh "$DROPLET" "docker rm -f caddy >/dev/null 2>&1; docker run -d --name caddy --restart unless-stopped --network host \
  -v caddy_data:/data caddy:2 caddy reverse-proxy --from $DOMAIN --to 127.0.0.1:8642 >/dev/null
  command -v ufw >/dev/null && ufw allow 22/tcp >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null || true"

for _ in $(seq 30); do curl -fsS -o /dev/null "https://$DOMAIN/" && break; sleep 2; done
bash infra/scripts/smoke.sh "https://$DOMAIN" || true
echo "deployed: https://$DOMAIN"
