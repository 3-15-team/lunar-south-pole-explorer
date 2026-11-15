#!/usr/bin/env bash
# Provider-agnostic deploy hook (ADR-004). Nothing cloud-specific runs unless a target
# script exists AND its required variables are set. Add a provider = add infra/deploy/<name>.sh.
#   make deploy DEPLOY_TARGET=static   STATIC_DEST=user@host:/var/www/lunar   (rsync)
#   make deploy DEPLOY_TARGET=droplet  DROPLET=root@<ip> [DOMAIN=…]   (make up + Caddy HTTPS)
#   make deploy DEPLOY_TARGET=gcp      (see gcp.sh — fill the variables first)
#   make deploy DEPLOY_TARGET=azure    (see azure.sh — fill the variables first)
cd "$(dirname "$0")/../.." || exit 1
TARGET=${1:-none}
if [ "$TARGET" = "none" ]; then
  cat <<TXT
No deploy target configured (DEPLOY_TARGET=none). Options:
  make dist && make serve-dist           # local static bundle (what any host would serve)
  make deploy DEPLOY_TARGET=static STATIC_DEST=...   # rsync the bundle anywhere
  make deploy DEPLOY_TARGET=droplet DROPLET=root@<ip> # VM: make up + Caddy (HTTPS)
  make deploy DEPLOY_TARGET=gcp|azure    # stubs in infra/deploy/, fill variables first
The primary demo is local: make up  →  http://localhost:8642
TXT
  exit 0
fi
SCRIPT="infra/deploy/$TARGET.sh"
[ -f "$SCRIPT" ] || { echo "unknown deploy target '$TARGET' (no $SCRIPT)"; exit 2; }
exec bash "$SCRIPT"
