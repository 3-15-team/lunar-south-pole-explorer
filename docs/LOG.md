# LOG (append-only, one line per significant event, UTC)

- 2026-11-14 09:41 session #1, account 1, started; env probed (M1 Max, Node 26, Py 3.12, Docker/OrbStack, 20 GB free disk).
- 2026-11-14 09:50 open questions answered: pitch Sun 18:00; deploy provider-agnostic; local commits in `dima`; challenge text to be pasted.
- 2026-11-14 09:58 downloads started (NAIF kernels done in < 1 min; PGDA ≈ 0.4 MB/s).
- 2026-11-14 10:15 docs skeleton, DATA/METRICS/ARCHITECTURE contracts, ADR-001…017 written.
- 2026-11-14 10:20 Python sub-agent started (libs/lunarcore, pipeline, services/compute); main agent on apps/web.
- 2026-11-14 11:30 web app end-to-end in headless Chrome (real GPU): horizon 110 ms/site, map + shadows + illumination layers, scenarios, panorama.
- 2026-11-14 11:40 TS ↔ Python golden vectors agree (geo, disk slice method ADR-101, horizon, metrics, topo).
- 2026-11-14 11:50 bug fixed: panorama mesh winding (ground culled); PGDA site points moved from DEM centre to DEM summit (agent).
- 2026-11-14 12:05 demo scan: Connecting ridge 2027-04-28 +10 d slip → sunlight 89% → 24%, night 5 h → 108 h (docs/DEMO.md).
- 2026-11-14 12:10 infra: compose (port 8088), web image 55.7 MB builds; README/DEMO/REFERENCES/SUBMISSION written.
- 2026-11-14 13:20 Python agent done: tiles z0–z9 (993 MB), horizon_240m (17 min, 10 cores), 4 pre-baked heatmaps, compute + texgen images; Horizons max err Sun 0.012″ / Earth 0.115″; vs Mazarico r = 0.977 / 0.972.
- 2026-11-14 13:30 compose port moved to 8642 (8080/8088/8090/5001 used by another local stack — untouched); `make up` + smoke 9/9 green.
- 2026-11-14 13:35 `make verify` green end-to-end.
- 2026-11-14 12:40 repo split: `git subtree split --prefix=sandbox/dima` → new repo `lunar-south-pole-explorer` (main, no remote); session #1 ends here, resume via `prompts/03_NEW_REPO_PROMPT.md`.
- 2026-11-14 13:17 session #2, started; first session in the split repo, resumed from 4f7850d. Data/.venv/node_modules already in place; compose (:8642) already running from this path. Remote `origin` now set (3-15-team/lunar-south-pole-explorer).
- 2026-11-14 13:22 `make verify` green (first run: pytest `Abort trap: 6` once, cold numba cache; reruns pass).
