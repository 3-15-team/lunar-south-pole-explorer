#!/usr/bin/env bash
# make verify — lint + typecheck + unit tests + build (+ smoke if a stack answers). Handoff gate.
cd "$(dirname "$0")/../.." || exit 1
PY=${PY:-.venv/bin/python}
declare -a results
run() { # name, command...
  local name=$1; shift
  printf "\n\033[1m== %s\033[0m\n" "$name"
  if "$@"; then results+=("✓ $name"); else results+=("✗ $name"); FAILED=1; fi
}
FAILED=0
if [ -x "$PY" ]; then
  run "ruff" "$PY" -m ruff check libs pipeline services
  run "pytest" "$PY" -m pytest -q libs/lunarcore/tests pipeline/tests services/compute/tests
else
  results+=("! python checks skipped (no .venv; run make setup-py)")
fi
run "tsc" bash -c "cd apps/web && npx tsc --noEmit"
run "vitest" bash -c "cd apps/web && npx vitest run"
run "vite build" bash -c "cd apps/web && npx vite build --logLevel warn"
for base in http://localhost:8642 http://localhost:5173; do
  if curl -s -o /dev/null -m 3 "$base/"; then run "smoke $base" bash infra/scripts/smoke.sh "$base"; break; fi
done
printf "\n\033[1mverify summary\033[0m\n"
printf "  %s\n" "${results[@]}"
exit $FAILED
