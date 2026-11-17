# Compute API (`services/compute`)

FastAPI, CPU-only, stateless; results are cached by content (`sha256` of the canonical request + the
versions of the input products) under `data/work/cache/` (`CACHE_DIR`; falls back to `/tmp` when the data
volume is read-only). CORS: any origin, `GET`/`POST`. The browser app works without this service
(static pre-baked heatmaps, client-side site metrics); the service accelerates region-scale work.

Run: `cd services/compute && python -m uvicorn app.main:app --port 8000` (or `make compute-dev`), or the
image `docker build -f services/compute/Dockerfile .` (context = project root) with `-v $PWD/data:/data`.
Environment: `DATA_DIR` (default `<repo>/data`, `/data` in the image), `CACHE_DIR`, `REGION_RES` (240),
`NUMBA_CACHE_DIR`. Interactive schema: `GET /docs` (OpenAPI). Products are loaded lazily and kept in memory:
restart the service after rebuilding data (`make data-*`) so it picks up the new products and cache keys.

Conventions: times are ISO-8601 UTC strings (`2026-12-01T00:00:00Z`); coordinates are MOON_ME lat/lon
(degrees, east-positive) or LUNAR:SPS metres (`x`, `y`, DATA.md §1); azimuth clockwise from local North.
Errors: `422` schema violation, `400` invalid values (e.g. `t1 <= t0`, outside the ephemeris range
2026-01-01…2150-01-01, outside DEM coverage, too many samples), `503` a data product is not built yet
(message says which `make` target builds it), `404` unknown heatmap id. Responses carry `X-Cache: hit|miss`.

## `GET /health`
`{"status": "ok", "version": "1.0.0"}`

## `GET /api/v1/info`
Data availability: `ephemeris` (range, frame), `dem` / `errorTiles` (levels), `regionHorizon` (grid, naz,
complete), `features`, `prebakedHeatmaps` (= `data/web/heatmaps/index.json` items), `capabilities`
(`siteMetrics`, `heatmap`, `robustness` booleans), `version` (input-data hash used in cache keys).

## `POST /api/v1/site-metrics`
Request:
```json
{"lat": -89.4389, "lon": -137.1436, "obsHeight": 2, "t0": "2026-12-01T00:00:00Z", "t1": "2026-12-31T00:00:00Z",
 "stepMin": 10, "dteThreshold": 0.5, "naz": 1440, "includeSeries": false}
```
`lat` ∈ [-90, -75], `obsHeight` 0–10 m, `stepMin` 0.5–360, `dteThreshold` 0.05–1, ≤ 200 000 samples.

Response:
- `site`: `{lat, lon, x, y, hTerrain, obsHeight, finestDemRes}`
- `interval`: `{t0, t1, samples, stepSeconds}` — N = round((t1−t0)/step) samples at t0 + k·dt, dt = (t1−t0)/N.
- `horizon`: `{naz, elevDeg[naz], distKm[naz], sigmaDeg[naz]?, hTerrain, finestRes}` — H(A) at A = k·360/naz,
  distance of the horizon-defining point, 1-σ band from the LOLA height-error tiles.
- `metrics`: every METRICS.md interval metric: `illumFrac, sunlitHours, anySunHours, longestDarkH,
  longestDarkCensored, longestDarkStart, nSunsets, nSunrises, earthFrac, longestNoCommsH,
  longestNoCommsCensored, longestNoCommsStart, dteWindows [[startUtc, endUtc]], sunElStats {min,mean,max},
  earthElStats, powerVertical, powerHorizontal, powerRatio, samples, dtHours, dteThreshold`.
- `events`: `[{"type": "sunrise|sunset|earthrise|earthset", "t": unix, "utc"}]`, bisection to ≤ 1 min.
- `now` (state at t0): `sun {azDeg, elDeg, radiusDeg, f, up, next: {t, utc, inHours, event}}`,
  `earth {…, dte, next}` (next transition within 60 days, else `null`), `shadowLen2m`.
- `series` (only with `includeSeries`): `t[], fSun[], fEarth[], sunAz[], sunEl[], earthAz[], earthEl[]`.
- `timing`.

Physics: 1440-azimuth clipmap ray march over the LPS-2560 pyramid (incl. 5 m tiles at sites), slice-method
disk fractions (ADR-101), topocentric Sun/Earth from the shipped ephemeris tables — identical to the
browser worker (golden vectors in `libs/lunarcore/tests/golden`).

## `POST /api/v1/heatmap`
Request:
```json
{"bbox": [-40000, -40000, 40000, 40000], "t0": "2026-12-01T00:00:00Z", "t1": "2026-12-15T00:00:00Z",
 "preset": "lander", "weights": {"illum": 0.4}, "footprintM": 50, "slopeLimitDeg": 10, "dteThreshold": 0.5,
 "stepHours": 2, "candidates": 10}
```
`bbox` (SPS m, optional, default = whole region map, ρ ≤ 200 km at 240 m), `preset` `lander|base`
(METRICS.md), `weights` overrides preset weights (keys `illum, dark, earth, slope, relief`), `footprintM`
5–100, `slopeLimitDeg` 5–20 (default from preset), `stepHours` 0.25–24 (default 2 h for intervals > 5 days,
else 0.5 h), ≤ 20 000 time samples.

Response: `{"id", "png": "/api/v1/heatmap/<id>.png", "json": ".../<id>.json", "scoreBin": ".../<id>.score.bin",
"meta"}` where `meta` follows DATA.md §6: `bbox, res, width, height, params` (resolved weights, slope limit,
dark reference, interval, footprint box, `diskMethod: "straight-edge"`, horizon map info), `legend`
(`cividis`, 0–1), `candidates [{x, y, lat, lon, score, rankStability, rankStabilityMode: "weights-only", illum,
darkH, earth, slopeMax}]` (non-maximum suppression, ≥ 2 km apart), `stats`.
- Per cell (cell centre = footprint centre): illumination = mean straight-edge f_sun with the 64-azimuth
  region horizon (observer 2 m), `dark` = longest run with f_sun < 0.05 (h), `earth` = share of samples with
  f_earth ≥ θ; slope/relief from the finest global DEM (40 m, else 80 m) with box = ceil(L/res) rounded to
  odd cells (ADR-105) → `approximate: true` when the footprint is smaller than the DEM cell or the 240 m
  analysis cell.
- PNG: RGBA, transparent where a hard constraint fails or there is no data. `score.bin`: gzip of
  float32[height][width], NaN = excluded.

## `GET /api/v1/heatmap/<id>.png | <id>.json | <id>.score.bin`
Files of a computed heatmap; ids of the pre-baked set (`data/web/heatmaps`) are served too.

## `POST /api/v1/robustness`
Request: the heatmap scoring parameters plus
```json
{"candidates": [{"x": 12345.0, "y": -2345.0}, {"lat": -89.78, "lon": -156.2}], "n": 200, "k": 10, "seed": 0}
```
Response: `{"params", "method", "n", "k", "candidates": [{index, x, y, score (nominal), rankStability,
scoreMean, scoreStd, medianRank, excluded, illum, darkH, earth, dataQuality: {sigmaZ, sigmaHorizonMeanDeg}}]}`.
Monte-Carlo per draw: weights ~ Dirichlet(50·w); horizon perturbed per azimuth by the LOLA 1-σ height error
at the horizon-defining point (σ_H = atan(σ_z/D)) and by the observer's own height error (−σ_z,obs/D);
64-azimuth horizons recomputed at each candidate; `rankStability` = share of draws in which the candidate
is in the top-k **of the submitted candidates** (all candidates trivially stable when there are ≤ k). This is
robustness, not a probability (METRICS.md).
