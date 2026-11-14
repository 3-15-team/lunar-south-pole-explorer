#!/bin/sh
# Runs from the nginx image's /docker-entrypoint.d/ at container start: writes the SPA's runtime
# config from env so display settings change with `make up PANO_AA_SIGMA=…` without rebuilding.
# Keys mirror apps/web/src/config.ts (the URL ?aa=… still overrides in the browser).
set -eu
sigma="${PANO_AA_SIGMA:-1.0}"
case "$sigma" in
  ''|*[!0-9.]*) echo "web-config: PANO_AA_SIGMA='$sigma' is not a number, using 1.0" >&2; sigma=1.0 ;;
esac
printf '{"panoAASigma": %s}\n' "$sigma" > /usr/share/nginx/html/config.json
echo "web-config: panoAASigma=$sigma"
