# STATE — single source of truth (≤ 200 lines)

- Updated: 2026-11-14 12:10 UTC (16:10 Yerevan) · session #1 · account 1
- Pitch: **Sun 2026-11-15 18:00 Yerevan (14:00 UTC)** · freeze **Sun 14:30 Yerevan (10:30 UTC)**
- Hours until freeze at update: **22.3 h**. Phase: P1 + most of P2/P3 done in parallel; P4 docs started.

## Phase & tasks

P0 — bootstrap
- [x] T-001 docs skeleton + ADRs + kickoff copy (`docs/KICKOFF_PROMPT.md`)
- [~] T-002 data downloads — tier 0 + 80 m ERR + 5 m sites done; **40 m DEM still downloading** (PGDA ≈ 0.3 MB/s) → z6 tiles missing until it lands (`make data-tiles` afterwards)
- [x] T-003 Makefile + infra (compose, Dockerfiles, nginx, deploy hooks, doctor/verify/smoke/dist scripts)
- [x] T-004 Trek WMTS checked (ADR-018): hillshade layer with CORS exists; not used (baked shadows)

P1 — walking skeleton
- [x] T-010 `libs/lunarcore` geo/tiles/ephemeris + golden vectors (Python agent)
- [x] T-011 ephemeris tables 2026–2036 (`data/web/ephem`) — Horizons validation: see `docs/VALIDATION.md`
- [x] T-012 DEM tiles z0–z5, z7–z9 (z6 pending 40 m download)
- [x] T-013 PSR GeoJSON + site catalog (PGDA site points being switched to DEM summit — Python agent)
- [x] T-014 web skeleton: Vite 6 / Preact 10 / TS 5.9, signals store + URL hash codec
- [x] T-015 map: OL `LUNAR:SPS` + WebGL2 terrain layer (live Sun shading + ray-marched soft shadows)

P2 — challenge core
- [x] T-020 site worker: 1440-az horizon (+σ, far-only), interval metrics, events (1-min bisection)
- [x] T-021 sky plot + true-aspect Sun/Earth close-ups + metric tiles + time-to-sunset/Earthset
- [x] T-022 timeline: playhead, interval handles, Sun/Earth strips, local-noon ticks, play
- [x] T-023 scenario cards (≤ 4) + "what if it slips" deltas + verdict line
- [x] T-024 GPU engine: viewport horizon pass (64 az), interval illumination / Earth / longest night
- [x] T-025 date × site heat calendar (60 days)

P3 — wow layer
- [x] T-030 slope + suitability layer + footprint/slope/preset controls + candidates + rank stability (client MC)
- [~] T-031 compute service + pre-baked heatmaps — Python agent working; client overlay wired (server → static fallback)
- [x] T-032 panorama (Three.js; soft shadows, far horizon ring, Sun glare, Earth phase, stars, WASD)
- [x] T-033 warm-up fly-in (real Sun direction, skippable, reduced-motion aware)

P4 — finish
- [~] T-040 docs: README, DEMO (real numbers), REFERENCES, SUBMISSION done; VALIDATION by Python agent
- [ ] T-041 `make verify` green + `make up` end-to-end (web image builds: 55.7 MB; compute image pending)
- [ ] T-042 demo video + English subtitles (team; script in `docs/DEMO.md`)

## NEXT ACTION

1. Wait for the Python agent report → review `services/compute`, `docs/VALIDATION.md`, re-run `make verify`.
2. When `LDEM_80S_40MPP_ADJ.TIF` finishes: `make data-tiles` (adds z6), re-check map at 40 m.
3. `make up` end-to-end + `make smoke`; then UX pass on the demo link in `docs/DEMO.md`.

## Environment facts

- Project root: `sandbox/dima/` (repo `3-15-team/explorer`, branch `dima`, local commits only — ADR-001).
- macOS arm64 (M1 Max), Node 26.13, Python 3.12.12 (`.venv`), Docker 29.8 (OrbStack), GNU make 3.81.
- Ports: web dev **5173** · compute **8000** · compose **8088** (8080 is taken by another OrbStack container).
- Data: `data/raw` (downloads, manifest-tracked), `data/work` (server-only), `data/web` (served at `/data`).
- Disk free ≈ 13 GB after downloads/tiles (watch it: 40 m DEM + z6 tiles ≈ +1 GB).
- Headless visual check: `node <scratchpad>/pw/shot.mjs` (playwright-core driving installed Chrome; real GPU via ANGLE Metal).
- Demo scenario scan: `cd apps/web && npx vite-node scripts/demo-scan.ts`.

## Performance (measured, M1 Max, Chrome)

- Site horizon (1440 az, 300 km): 50 DEM tiles, 90–210 ms load + 110–130 ms ray-march (worker).
- Bundles: main 72 KB (28 KB gz) · map 339 KB (100 KB gz) · panorama 487 KB (124 KB gz) · warm-up 6 KB.
- Map GPU horizon grid 512² × 64 az: progressive, 2 of 16 groups per frame (full timing TODO).

## Open questions

- Official challenge text still not pasted → `docs/CHALLENGE.md` = kickoff §3 summary.

## Known issues

- PGDA downloads are slow (≈ 0.3 MB/s); 40 m DEM pending.
- Compute API absent in dev → browser logs one 500 for `/api/v1/info` (expected; UI shows "offline").
- Panorama far-field occlusion uses the observer's far horizon for all fragments (≤ 2.5 km walk radius) — documented approximation.

## Last `make verify`

- not run end-to-end yet; vitest 22/22 green, tsc clean, vite build OK (12:00 UTC).
