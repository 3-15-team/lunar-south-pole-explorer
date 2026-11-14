#!/usr/bin/env bash
# make doctor — tools, versions, disk, data presence/checksums, ports. Never fails hard.
cd "$(dirname "$0")/../.." || exit 1
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$*"; }
echo "Tools"
for t in node npm python3 docker make git; do
  if command -v "$t" >/dev/null 2>&1; then ok "$t $($t --version 2>&1 | head -1)"; else bad "$t missing"; fi
done
[ -x .venv/bin/python ] && ok "venv .venv ($(.venv/bin/python --version 2>&1))" || warn "no .venv — run: make setup-py"
[ -d apps/web/node_modules ] && ok "apps/web/node_modules present" || warn "web deps missing — run: make setup-web"
docker info >/dev/null 2>&1 && ok "docker daemon reachable" || warn "docker daemon not reachable (needed for make up)"
echo "Disk"
free=$(df -k . | awk 'NR==2{print int($4/1024/1024)}')
[ "${free:-0}" -ge 10 ] && ok "free disk ${free} GB" || warn "free disk ${free} GB (< 10 GB)"
echo "Data (docs/DATA.md)"
for f in data/web/ephem/index.json data/web/dem/index.json data/web/sites.json data/web/psr.geojson data/web/heatmaps/index.json; do
  [ -f "$f" ] && ok "$f" || warn "$f missing — run: make data-min (or make data-pull)"
done
if [ -f data/web/dem/index.json ]; then
  python3 - <<'PY'
import json
i = json.load(open('data/web/dem/index.json'))
print("    DEM levels: " + ", ".join(f"z{l['z']}:{len(l['tiles'])}" for l in i['levels']))
PY
fi
if [ -f data/manifest.json ]; then
  python3 - <<'PY'
import json, os
m = json.load(open('data/manifest.json'))
bad = [k for k, v in m.get('files', {}).items() if not os.path.exists(os.path.join('data', v['path'])) or os.path.getsize(os.path.join('data', v['path'])) != v['size']]
print(f"    manifest: {len(m.get('files', {}))} source files, {len(m.get('products', {}))} products, {len(bad)} missing/size-mismatch" + (f" ({', '.join(bad[:5])})" if bad else ""))
PY
fi
echo "Ports"
for p in 5173 8000 8642; do
  if lsof -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then warn "port $p in use"; else ok "port $p free"; fi
done
exit 0
