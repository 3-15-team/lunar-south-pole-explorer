#!/bin/sh
# Runs from the nginx image's /docker-entrypoint.d/ at container start: writes the SPA's runtime config
# from env, so display settings change with `make up PANO_TERRAIN_INTERP=… PANO_RELIEF_AA=… PANO_MICRO=…` without a
# rebuild. Keys mirror apps/web/src/config.ts (URL ?interp=… / ?raa=… / ?micro=… still override in the browser).
set -eu
interp="${PANO_TERRAIN_INTERP:-catmull}"
case "$interp" in
  bilinear|catmull|mitchell|bspline) ;;
  *) echo "web-config: PANO_TERRAIN_INTERP='$interp' unknown (bilinear|catmull|mitchell|bspline), using catmull" >&2; interp=catmull ;;
esac
raa="${PANO_RELIEF_AA:-1}"
case "$raa" in
  ''|*[!0-9.]*) echo "web-config: PANO_RELIEF_AA='$raa' is not a number, using 1" >&2; raa=1 ;;
esac
micro="${PANO_MICRO:-1}"
case "$micro" in
  ''|*[!0-9.]*) echo "web-config: PANO_MICRO='$micro' is not a number, using 1" >&2; micro=1 ;;
esac
# initial state of the panorama micro-relief toggle: only written when set explicitly, so the single
# default lives in apps/web/src/config.ts (DEFAULT_CONFIG.panoMicroDefault)
mdef=""
case "${PANO_MICRO_DEFAULT:-}" in
  '') ;;
  on|off) mdef=", \"panoMicroDefault\": \"${PANO_MICRO_DEFAULT}\"" ;;
  *) echo "web-config: PANO_MICRO_DEFAULT='${PANO_MICRO_DEFAULT}' must be on|off, ignored" >&2 ;;
esac
# when the map's Earth layer is recomputed for the antenna height (ADR-122): layer|button; only
# written when set, the default lives in apps/web/src/config.ts (DEFAULT_CONFIG.mapEarthAntenna)
eant=""
case "${MAP_EARTH_ANTENNA:-}" in
  '') ;;
  layer|button) eant=", \"mapEarthAntenna\": \"${MAP_EARTH_ANTENNA}\"" ;;
  *) echo "web-config: MAP_EARTH_ANTENNA='${MAP_EARTH_ANTENNA}' must be layer|button, ignored" >&2 ;;
esac
printf '{"panoTerrainInterp": "%s", "panoReliefAA": %s, "panoMicro": %s%s%s}\n' "$interp" "$raa" "$micro" "$mdef" "$eant" > /usr/share/nginx/html/config.json
echo "web-config: $(cat /usr/share/nginx/html/config.json)"
