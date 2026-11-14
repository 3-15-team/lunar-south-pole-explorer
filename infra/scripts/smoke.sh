#!/usr/bin/env bash
# make smoke [BASE_URL=...] — key endpoints of a running stack (static data required, API optional)
BASE=${1:-http://localhost:8088}
fail=0
check() { # url, required(1/0)
  code=$(curl -s -o /dev/null -m 10 -w "%{http_code}" "$BASE$1")
  if [ "$code" = "200" ]; then printf "  \033[32m✓\033[0m %-32s %s\n" "$1" "$code"
  elif [ "$2" = "1" ]; then printf "  \033[31m✗\033[0m %-32s %s\n" "$1" "$code"; fail=1
  else printf "  \033[33m!\033[0m %-32s %s (optional)\n" "$1" "$code"; fi
}
echo "Smoke test $BASE"
check / 1
check /data/ephem/index.json 1
check /data/dem/index.json 1
check /data/sites.json 1
check /data/dem/0/0/0.bin 1
check /data/psr.geojson 0
check /data/heatmaps/index.json 0
check /health 0
check /api/v1/info 0
exit $fail
