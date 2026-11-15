# ARCHITECTURE

```
lunar-south-pole-explorer/          (repository root; split from 3-15-team/explorer sandbox/dima, ADR-019)
├── apps/web/                      Vite + TypeScript + Preact SPA (static, works without any server)
│   └── src/
│       ├── core/                  pure TS physics: geo, ephemeris, horizon, disk, metrics, time
│       ├── data/                  DEM tile client (fetch, inflate, LRU cache, sampling)
│       ├── workers/               site.worker.ts: horizon profile + interval metrics off the UI thread
│       ├── state/                 signal store + URL hash codec (shareable scenarios)
│       ├── ui/                    shell, panels, sky plot, timeline, scenario cards, heat calendar
│       ├── map/      (lazy)       OpenLayers view in LUNAR:SPS + custom WebGL2 terrain engine
│       ├── pano/     (lazy)       Three.js first-person panorama (Sun/Earth discs, soft shadows, WASD)
│       └── warmup/   (lazy)       ≤10 s skippable fly-in (raw WebGL2), hides tile prefetch
├── libs/lunarcore/                Python twin of core/ (numpy + numba): geo, ephemeris, horizon,
│                                  disk, metrics, suitability, tile IO — used by pipeline AND compute
├── pipeline/                      offline jobs (`just data-min`): download → ephemeris → DEM tiles →
│                                  PSR → sites → horizon maps → pre-baked heatmaps → validation
├── services/compute/              FastAPI, CPU-only, stateless, content-addressed cache:
│                                  region heatmaps, robustness Monte-Carlo, site metrics (cross-check)
├── services/texgen/               unused optional stub; not part of the local runtime
├── compose.yaml                  complete local runtime with automatic real-data initialization
├── justfile                      Compose wrappers and optional native development tasks
├── tools/                        portable task orchestration, smoke checks, static export
├── infra/                         Dockerfiles and nginx; cloud deployment remains undecided
├── data/  (gitignored)            raw/ work/ web/ — see DATA.md; manifest.json is committed
└── docs/                          STATE, DECISIONS, LOG, DATA, METRICS, VALIDATION, REFERENCES, ...
```

## Runtime topology

```
browser ──/──────────▶ web (nginx: SPA + /data static)          ← primary demo: docker compose up
        ──/api/──────▶ compute (FastAPI :8000) ──▶ data/work (horizon maps, cache)
static-only fallback: any static host serving apps/web/dist + data/web  (no /api → pre-baked heatmaps)
```

Compose uses a persistent named volume. The data initializer downloads/generates and verifies
products before starting compute, then web. See [LOCAL.md](./LOCAL.md) for the one-command
entry point, offline restarts, default-resolution limits, and containerized checks.

- **One SPA, three lazy modules** sharing one state store (site, time, interval, observer
  height, layer, scenarios). Modes are not containers (ADR-007).
- **Graceful degradation**: everything in the challenge core (horizon, Sun/Earth tracks,
  shadows, interval metrics, scenario comparison, time-to-sunset) runs client-side.
  The compute service only accelerates region-scale heatmaps / robustness; when it is
  down the UI uses `data/web/heatmaps/*` and says so.

## Client compute paths

1. **Site path (CPU, Web Worker)** — DEM tiles (clipmap by distance) → 1440-azimuth horizon
   profile (+ distance + uncertainty) → per-time Sun/Earth topocentric az/el/radius →
   disk fractions → events and interval metrics. ~100–300 ms per site.
2. **Map path (GPU, WebGL2)** — `map/engine/`:
   - far DEM texture (z3, 320 m, whole coverage) + near DEM texture (view level, ≤ 2048²);
   - **horizon pass** for an analysis grid covering the view (≤ 768², 64 azimuths packed
     as 16 RGBA16F layers; progressive, a few layers per frame, recomputed when the view
     settles);
   - **illumination pass**: for t (instant) or K samples in [t0, t1] (interval) using the
     ephemeris samples in a float texture → f_sun, f_earth, longest dark, power;
   - **feature/score pass**: slope, footprint box filters, suitability;
   - **display pass**: per-screen-pixel normals from the near DEM, live Lambert shading
     under the real Sun × computed shadow, L1 procedural regolith, colormaps.
3. **Panorama (GPU, Three.js)** — near DEM mesh (5–10 m, ≤ 5 km) with fragment-shader
   ray-marched soft shadows (finite solar disk), far-field occlusion from the site
   horizon profile, Sun/Earth discs at true angular size (Earth with correct phase),
   procedural stars, WASD walking clamped to terrain.

## Server/offline compute

`libs/lunarcore` implements the same formulas (METRICS.md) with numba; golden vectors
keep TS and Python in agreement. The pipeline pre-computes region horizon maps
(`data/work/horizon_*.npy`) so that any interval heatmap is a cheap pass over them.

## Interfaces the panorama module consumes (teammate-compatible)

```ts
interface PanoInputs {
  site: { lat: number; lon: number; x: number; y: number; heightM: number };  // SPS + DEM height
  enu: EnuFrame;                                     // core/geo.ts
  dem: DemClient;                                    // tiles at several LODs (data/dem.ts)
  sunEarth(tUnixMs: number): SunEarthTopo;           // az/el/radius/distance for Sun & Earth
  horizon: HorizonProfile;                           // far-field occlusion (core/horizon.ts)
  time: Signal<number>; interval: Signal<[number, number]>; observerHeight: Signal<number>;
}
// outputs: canvas + 'pano:events' (sunset/earthset countdowns) via the store
```
