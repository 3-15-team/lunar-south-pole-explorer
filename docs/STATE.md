# STATE — single source of truth (≤ 200 lines)

- Updated: 2026-11-14 13:25 UTC (17:25 Yerevan) · session #2 · first session in the split repo
- Pitch: **Sun 2026-11-15 18:00 Yerevan (14:00 UTC)** · freeze **Sun 14:30 Yerevan (10:30 UTC)**
- Hours until freeze at update: **21.1 h**. Phase: P1–P3 done; P4 (video, submission page, polish) remains.

## Phase & tasks

P0 — bootstrap
- [x] T-001 docs skeleton + ADRs + kickoff copy
- [x] T-002 data downloads — all tier 0/1 sources incl. 40 m DEM, 80 m error map, 10 PGDA 5 m sites (+ error maps)
- [x] T-003 Makefile + infra (compose, Dockerfiles, nginx, deploy hooks, doctor/verify/smoke/dist scripts)
- [x] T-004 Trek WMTS checked (ADR-018): hillshade layer with CORS exists; not used (baked shadows)

P1 — walking skeleton
- [x] T-010 `libs/lunarcore` geo/tiles/ephemeris + golden vectors (Python agent)
- [x] T-011 ephemeris tables 2026–2149 (`data/web/ephem`) — Horizons validation: see `docs/VALIDATION.md`
- [x] T-012 DEM tiles z0–z9: 8259 tiles, 993 MB (+ error tiles z0–z5, 82 MB); sources align with LPS-2560, no resampling
- [x] T-013 PSR GeoJSON (1531 polygons) + catalog (29 sites, 22 in coverage; PGDA points = DEM summit, Site04 56 m from Mazarico Site 4)
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
- [x] T-031 compute service (site-metrics, heatmap, robustness, cache) + 4 pre-baked heatmaps; client overlay (server → static fallback) verified
- [x] T-032 panorama (Three.js; soft shadows, far horizon ring, Sun glare, Earth phase, stars, WASD)
- [x] T-033 warm-up fly-in (real Sun direction, skippable, reduced-motion aware)

P4 — finish
- [x] T-040 docs: README, DEMO (real numbers), REFERENCES, SUBMISSION, VALIDATION, API
- [x] T-041 `make verify` green; `make up` → http://localhost:8642 all smoke checks green
- [~] T-043 configurable panorama anti-aliasing — merged as PR #3, then **reverted** (ADR-114)
- [x] T-044 panorama relief AA (ADR-115): cubic height interpolation `PANO_TERRAIN_INTERP` + footprint-correct relief prefilter `PANO_RELIEF_AA`
- [x] T-045 DEM fallback bug (ADR-116): TS coarse-level fallback = Python `sample_clip` (no more nearest-neighbour plateaus outside 5 m DEMs)
- [x] T-046 statistical micro-relief for the panorama (ADR-117): `make data-micro`, `PANO_MICRO`/`?micro=`
- [x] T-047 micro-relief UI toggle (ADR-118); default on — change in `apps/web/src/config.ts` `DEFAULT_CONFIG.panoMicroDefault`
- [x] T-048 context Moon outside 80°S on the map (ADR-119): `make data-outer`, LOLA LDEM_16
- [ ] T-042 demo video + English subtitles (team; script in `docs/DEMO.md`)

## NEXT ACTION

0. ~~New repo bootstrap~~ done in session #2 (data copied, `.venv`/`node_modules` present, compose runs from this path, verify green).
1. Paste the official challenge text into `docs/CHALLENGE.md`; re-check scope/catalogue against it.
2. Record the demo video from `docs/DEMO.md` (demo link there) + English subtitles; fill `docs/SUBMISSION.md` links.
3. Optional polish (cut list order applies): panorama look, VR (cut), texture L2 (out).

## Environment facts

- Project root: repo `lunar-south-pole-explorer` (`…/2026-lunar-landing/lunar-south-pole-explorer`, branch `main`, remote `origin` = `git@github.com:3-15-team/lunar-south-pole-explorer.git` — ADR-019). Split from `3-15-team/explorer` `sandbox/dima`; the old copy there is frozen.
- macOS arm64 (M1 Max), Node 26.13, Python 3.12.12 (`.venv`), Docker 29.8 (OrbStack), GNU make 3.81.
- Ports: web dev **5173** · compute **8000** · compose **8642** (8080, 8088, 8090, 5001 are taken by another local stack — do not touch it).
- Data: `data/raw` (downloads, manifest-tracked), `data/work` (server-only), `data/web` (served at `/data`).
- Disk free ≈ 13 GB after downloads/tiles (watch it: 40 m DEM + z6 tiles ≈ +1 GB).
- Headless visual check: `node <scratchpad>/pw/shot.mjs` (playwright-core driving installed Chrome; real GPU via ANGLE Metal).
- Panorama relief: `make up PANO_TERRAIN_INTERP=bilinear|catmull|mitchell|bspline PANO_RELIEF_AA=1` (→ `/config.json`), browser overrides `?interp=…&raa=…`; `bilinear` + `0` = original look.
- Demo scenario scan: `cd apps/web && npx vite-node scripts/demo-scan.ts`.

## Performance (measured, M1 Max, Chrome)

- Site horizon (1440 az, 300 km): 50 DEM tiles, 90–210 ms load + 110–130 ms ray-march (worker).
- Bundles: main 72 KB (28 KB gz) · map 339 KB (100 KB gz) · panorama 487 KB (124 KB gz) · warm-up 6 KB.
- Map GPU horizon grid 512² × 64 az: progressive, 2 of 16 groups per frame (full timing TODO).

## Open questions

- Official challenge text still not pasted → `docs/CHALLENGE.md` = kickoff §3 summary.

## Known issues

- Artemis III region points are approximate (LROC mosaic centres); Slater Plain omitted (no citable coordinate); Chang'e-7 approximate.
- Connecting-ridge summit (5 m crest) vs Mazarico 60 m pixel: 0.82 vs 0.44 (scale mismatch, see VALIDATION).
- Panorama far-field occlusion uses the observer's far horizon for all fragments (≤ 2.5 km walk radius) — documented approximation.
- Restart the compute service after rebuilding data; `data/work/mosaic` (1.7 GB) is a deletable cache; **≈ 4 GB disk free** (doctor warns < 10 GB); `data/raw/lola/LDEM_80S_80MPP_ADJ.TIF.part` (22 MB) is a stale partial download.
- First `pytest` run in a fresh checkout once aborted (`Abort trap: 6`, cold numba JIT cache); reruns pass — rerun `make verify` before treating it as red.

## Last `make verify`

- 2026-11-14 13:22 UTC (session #2, split repo): **green** — ruff ✓, pytest 61 passed, tsc ✓, vitest 22 passed, vite build ✓, smoke http://localhost:8642 ✓ (9/9). (First attempt: pytest aborted once, see Known issues.)
