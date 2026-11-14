# STATE — single source of truth (≤ 200 lines)

- Updated: 2026-11-14 10:15 UTC (14:15 Yerevan) · session #1 · account 1
- Pitch: **Sun 2026-11-15 18:00 Yerevan (14:00 UTC)** · freeze **Sun 14:30 Yerevan (10:30 UTC)**
- Hours until freeze at update: **24.3 h** (≈ 17 h of user-awake time). Budget scaling: P0 1.5 h · P1 4 h · P2 6 h · P3 6 h · P4 rest (relative sizes, compressed by parallel agents).

## Phase & tasks

P0 — bootstrap
- [x] T-001 docs skeleton + ADRs + kickoff copy (`docs/KICKOFF_PROMPT.md`)
- [ ] T-002 data downloads tier 0/1 — **doing** (background `pipeline/jobs/download.py`, logs `data/raw/download-*.log`; PGDA ≈ 0.4 MB/s total; 40 m DEM paused until 80 m finishes — resume: `python3 pipeline/jobs/download.py --only ldem-80s-40m`)
- [ ] T-003 Makefile + infra (compose, Dockerfiles, nginx, deploy hooks)
- [ ] T-004 Trek WMTS south-pole layers + CORS check (record result; we bake our own tiles regardless)

P1 — walking skeleton
- [ ] T-010 `libs/lunarcore` (geo, tiles IO, horizon numba, disk, metrics) + tests + golden vectors
- [ ] T-011 ephemeris job → `data/web/ephem/` + Horizons validation → `docs/VALIDATION.md`
- [ ] T-012 DEM tiles job (z0–z6 + z7–z9 sites) → `data/web/dem/`
- [ ] T-013 PSR GeoJSON + site catalog job
- [ ] T-014 web skeleton: Vite/Preact/TS, store + URL codec, core geo/ephemeris/time, DEM client
- [ ] T-015 map: OL `LUNAR:SPS` + WebGL terrain layer (live Sun shading)

P2 — challenge core
- [ ] T-020 site worker: horizon profile + interval metrics + events
- [ ] T-021 sky plot + metric tiles + time-to-sunset/Earthset
- [ ] T-022 timeline: playhead, interval handles, lunar-day ticks, play
- [ ] T-023 scenario cards (≤ 4) + "what if it slips" deltas
- [ ] T-024 GPU engine: viewport horizon pass, instant shadows, interval illumination / Earth layers
- [ ] T-025 date × site heat calendar

P3 — wow layer
- [ ] T-030 slope + suitability layer + footprint slider + presets + candidates + quick robustness
- [ ] T-031 compute service (heatmap, robustness, cache) + pre-baked heatmaps
- [ ] T-032 panorama (Three.js)
- [ ] T-033 warm-up fly-in

P4 — finish
- [ ] T-040 VALIDATION, README, DEMO script, SUBMISSION, REFERENCES complete
- [ ] T-041 `make verify` green, `docker compose up` verified end-to-end
- [ ] T-042 demo video + English subtitles (team)

## NEXT ACTION

Write Makefile + infra (T-003); Python side (T-010…T-013) delegated to a sub-agent working in
`libs/`, `pipeline/`, `services/compute/` per `docs/DATA.md` + `docs/METRICS.md`; main agent
builds `apps/web` (T-014, T-015, T-020…).

## Environment facts

- Project root: `sandbox/dima/` (repo `3-15-team/explorer`, branch `dima`, local commits only).
- macOS 26.7 arm64 (M1 Max, 10 cores, 32 GB), Node 26.13 / npm 11.20, Python 3.12.12 (pyenv),
  Docker 29.8 (OrbStack), GNU make 3.81. No gcloud/az/firebase/gh. Disk free ≈ 20 GB.
- Ports: web dev 5173 · compute 8000 · compose web 8080.
- Data: `data/raw` (downloads), `data/work` (server-only), `data/web` (served at `/data`).
- Python venv: `.venv` (`make setup`). Web: `apps/web` (`npm ci`).

## Open questions

- Official challenge text not yet pasted → `docs/CHALLENGE.md` holds the kickoff §3 summary.
- Catalog coordinates for CLPS / Artemis regions are approximate until verified (flagged in data).

## Known issues

- PGDA downloads are slow (≈ 0.4 MB/s aggregate).

## Last `make verify`

- not run yet
