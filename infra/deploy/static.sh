#!/usr/bin/env bash
# Static hosting: rsync dist-static/ to STATIC_DEST (any web server, NAS, VM, …).
set -euo pipefail
: "${STATIC_DEST:?set STATIC_DEST, e.g. user@host:/var/www/lunar}"
[ -d dist-static ] || make dist
rsync -az --delete dist-static/ "$STATIC_DEST"
echo "deployed static bundle to $STATIC_DEST"
