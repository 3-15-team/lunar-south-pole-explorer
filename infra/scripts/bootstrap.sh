#!/usr/bin/env bash
# From a fresh clone to a running app, nothing but git + make + Docker on the machine:
#
#   make bootstrap                 # full data (~2.5 GB download, 5 m site DEMs) -> http://localhost:8642
#   make bootstrap DATA=min        # smallest working set (~0.4 GB, 80 m DEM only), much faster
#   make bootstrap-native          # same without Docker: needs python3 >= 3.11 and node >= 20
#   make data-docker               # only download + build data/ in Docker (no local Python)
#
# Steps: check prerequisites -> pipeline toolchain -> download sources (per-file progress) ->
# build data products (per-job progress) -> start the stack -> wait until it answers -> smoke test.
# Re-runnable at any point: downloads resume, finished files and products are skipped.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

MODE="${1:-docker}"                    # docker | native | data (docker toolchain, no start)
DATA="${DATA:-full}"                   # full | min
PORT="${COMPOSE_PORT:-8642}"
IMAGE="lunar-explorer-pipeline"
case "$DATA" in full) TIER=1; NEED_GB=10 ;; min) TIER=0; NEED_GB=4 ;; *) echo "DATA must be full or min (got '$DATA')" >&2; exit 2 ;; esac
[ "$MODE" = native ] && NEED_GB=$((NEED_GB - 2))
case "$MODE" in docker | native | data) ;; *) echo "mode must be docker, native or data" >&2; exit 2 ;; esac
DOCKER=1
[ "$MODE" = native ] && DOCKER=0

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'; else B= G= Y= R= C= N=; fi
STEPS=6
[ "$MODE" = data ] && STEPS=4
STEP=0
T_ALL=$(date +%s)
TIMES=()
step() {
  STEP=$((STEP + 1))
  T_STEP=$(date +%s)
  printf '\n%s[%d/%d] %s%s\n' "$B" "$STEP" "$STEPS" "$*" "$N"
}
done_step() {
  local dt=$(($(date +%s) - T_STEP))
  TIMES+=("$(printf '%-34s %3d min %02d s' "$1" $((dt / 60)) $((dt % 60)))")
  printf '%s  ✓ %s (%d min %02d s)%s\n' "$G" "$1" $((dt / 60)) $((dt % 60)) "$N"
}
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die() {
  printf '\n  %s✗ %s%s\n' "$R" "$*" "$N" >&2
  exit 1
}
free_gb() { df -Pk "$ROOT" | awk 'NR==2{print int($4/1024/1024)}'; }

printf '%sLunar South Pole Site Explorer — bootstrap (%s, data: %s)%s\n' "$B" "$MODE" "$DATA" "$N"
[ -n "${DATA_DIR:-}" ] && [ "$(cd "${DATA_DIR}" 2>/dev/null && pwd)" != "$ROOT/data" ] && warn "DATA_DIR=$DATA_DIR is ignored: the stack serves ./data"
export DATA_DIR="$ROOT/data"

# ------------------------------------------------------------------ 1. prerequisites
step "Checking prerequisites"
command -v git >/dev/null && ok "git $(git --version | awk '{print $3}')" || warn "git missing (only needed to update the repo)"
fg=$(free_gb)
[ "${fg:-0}" -ge "$NEED_GB" ] && ok "free disk ${fg} GB (need ~${NEED_GB} GB)" || die "free disk ${fg} GB < ~${NEED_GB} GB needed for DATA=$DATA"
if [ "$DOCKER" = 1 ]; then
  command -v docker >/dev/null || die "Docker is not installed. Install Docker Desktop (macOS/Windows) or Docker Engine + compose plugin (Linux): https://docs.docker.com/get-docker/ — or use: make bootstrap-native"
  docker info >/dev/null 2>&1 || die "Docker is installed but the daemon is not running (start Docker Desktop / 'sudo systemctl start docker')"
  ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  docker compose version >/dev/null 2>&1 || die "'docker compose' (v2 plugin) missing: https://docs.docker.com/compose/install/"
  ok "$(docker compose version | head -1)"
  mem=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
  memg=$((mem / 1024 / 1024 / 1024))
  if [ "$DATA" = full ] && [ "$memg" -lt 6 ]; then warn "Docker has ${memg} GB RAM; the full DEM build wants ~6 GB+ (raise it in Docker Desktop → Resources, or use DATA=min)"; else ok "Docker memory ${memg} GB"; fi
fi
if [ "$MODE" = docker ]; then
  command -v curl >/dev/null || die "curl missing (used to check the running stack): install curl"
  if command -v lsof >/dev/null && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! docker compose -f infra/docker-compose.yml --project-directory "$ROOT" ps --status running -q 2>/dev/null | grep -q .; then
    die "port $PORT is taken by another program; choose another: make bootstrap COMPOSE_PORT=8650"
  fi
  ok "port $PORT available"
elif [ "$MODE" = native ]; then
  PYB="${PYTHON_BOOT:-python3}"
  command -v "$PYB" >/dev/null || die "python3 missing (need >= 3.11): https://www.python.org/downloads/"
  "$PYB" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || die "$($PYB --version) is too old (need >= 3.11)"
  ok "$($PYB --version)"
  command -v node >/dev/null || die "node missing (need >= 20): https://nodejs.org/"
  node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || die "node $(node --version) is too old (need >= 20)"
  ok "node $(node --version)"
fi
done_step "prerequisites"

# ------------------------------------------------------------------ 2. toolchain
if [ "$DOCKER" = 1 ]; then
  step "Building the data-pipeline image ($IMAGE; first time ~1–3 min)"
  docker build -q -f infra/pipeline.Dockerfile -t "$IMAGE" . >/dev/null
  ok "image $IMAGE ready"
  dock() { docker run --rm "$@"; }
  # files in ./data stay owned by the user; -t only for the live download bar
  run_py() { dock --user "$(id -u):$(id -g)" -v "$ROOT:/repo:ro" -v "$ROOT/data:/repo/data" "$IMAGE" python "$@"; }
  run_py_tty() { if [ -t 1 ]; then dock -t --user "$(id -u):$(id -g)" -v "$ROOT:/repo:ro" -v "$ROOT/data:/repo/data" "$IMAGE" python "$@"; else run_py "$@"; fi; }
else
  step "Installing Python (.venv) and web dependencies"
  make --no-print-directory setup
  run_py() { "$ROOT/.venv/bin/python" "$@"; }
  run_py_tty() { run_py "$@"; }
fi
mkdir -p "$ROOT/data/work"
done_step "toolchain"

# ------------------------------------------------------------------ 3. download
step "Downloading source data (NASA PDS / PGDA / NAIF; resumable)"
run_py_tty pipeline/jobs/download.py --tier "$TIER"
done_step "download"

# ------------------------------------------------------------------ 4. build products
JOBS=(ephemeris dem_tiles sites psr micro_relief outer_dem)
[ "$DATA" = full ] && JOBS+=(horizon_maps prebake)
what() { # bash 3.2 (macOS) has no associative arrays
  case "$1" in
    ephemeris) echo "Sun/Earth tables 2026–2036" ;;
    dem_tiles) echo "DEM tile pyramid (the longest step)" ;;
    sites) echo "site catalogue" ;;
    psr) echo "permanently shadowed regions" ;;
    micro_relief) echo "panorama micro-relief" ;;
    outer_dem) echo "context Moon outside 80°S" ;;
    horizon_maps) echo "region horizon maps (server analysis)" ;;
    prebake) echo "default suitability heatmaps" ;;
  esac
}
step "Building data products (${#JOBS[@]} jobs; finished ones are skipped)"
k=0
for j in "${JOBS[@]}"; do
  k=$((k + 1))
  t0=$(date +%s)
  printf '  %s(%d/%d) %s%s — %s\n' "$C" "$k" "${#JOBS[@]}" "$j" "$N" "$(what "$j")"
  run_py -m "pipeline.jobs.$j" 2>&1 | awk '{ print "      " $0; fflush() }'
  printf '      %s✓ %s in %ds%s\n' "$G" "$j" $(($(date +%s) - t0)) "$N"
done
du -sh "$ROOT/data/web" 2>/dev/null | awk '{print "  data/web: " $1}'
done_step "data products"
if [ "$MODE" = data ]; then
  printf '\n%sData ready in ./data.%s Start: make up  (or make dev with a local setup)\n' "$B" "$N"
  exit 0
fi

# ------------------------------------------------------------------ 5. start
if [ "$MODE" = docker ]; then
  step "Starting the stack (web + compute) on :$PORT"
  make --no-print-directory up
  printf '  waiting for http://localhost:%s ' "$PORT"
  for _ in $(seq 1 90); do
    if curl -fsS "http://localhost:$PORT/data/dem/index.json" -o /dev/null 2>/dev/null; then break; fi
    printf '.'
    sleep 2
  done
  echo
  curl -fsS "http://localhost:$PORT/" -o /dev/null || die "the stack did not answer on :$PORT — see: make logs"
  ok "http://localhost:$PORT is up"
else
  step "Building the web app"
  make --no-print-directory web-build
fi
done_step "start"

# ------------------------------------------------------------------ 6. smoke test
step "Smoke test"
if [ "$MODE" = docker ]; then
  bash infra/scripts/smoke.sh "http://localhost:$PORT" || warn "some optional endpoints failed (see above)"
else
  ok "skipped (no server started); run: make dev"
fi
done_step "smoke"

dt=$(($(date +%s) - T_ALL))
printf '\n%sDone in %d min %02d s.%s\n' "$B" $((dt / 60)) $((dt % 60)) "$N"
for t in "${TIMES[@]}"; do echo "  $t"; done
if [ "$MODE" = docker ]; then
  printf '\n  Open %shttp://localhost:%s%s   ·  stop: make down  ·  logs: make logs  ·  status: make ps\n' "$B" "$PORT" "$N"
else
  printf '\n  Start it: %smake dev%s  → http://localhost:5173  (or: make web-preview → :4173)\n' "$B" "$N"
fi
