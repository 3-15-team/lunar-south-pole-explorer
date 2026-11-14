#!/usr/bin/env bash
# make dist — self-contained static bundle (SPA + data/web) for any static host.
# Without the compute service the app uses pre-baked heatmaps (graceful degradation).
cd "$(dirname "$0")/../.." || exit 1
set -e
rm -rf dist-static
mkdir -p dist-static
cp -R apps/web/dist/. dist-static/
if [ -d data/web ]; then
  rsync -a --exclude '*.tmp' data/web/ dist-static/data/
else
  echo "warning: data/web missing — run make data-min first" >&2
fi
cat > dist-static/README.txt <<TXT
Lunar South Pole Site Explorer — static bundle.
Serve this folder with any static web server (e.g. python3 -m http.server).
/data/*.bin tiles are gzip-compressed on purpose; serve them as application/octet-stream
without Content-Encoding (the browser inflates them).
TXT
du -sh dist-static | awk '{print "dist-static size: "$1}'
