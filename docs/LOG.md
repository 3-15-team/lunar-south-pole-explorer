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
