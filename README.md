# Lunar South Pole Site Explorer

**Is this landing site and date viable — and what changes if the date slips?**
A web app for the NASA Space Apps 2026 challenge *CLPS Lunar Mission Browser*: pick a south-polar
site (catalogue or any coordinates) and a date, see the Sun and the Earth against the **real
LOLA terrain horizon**, get time-to-sunset / Earthset, power and direct-to-Earth metrics, and
compare up to four scenarios side by side — including "what if the launch slips by N days".

- **Map** — OpenLayers in south polar stereographic (no Web Mercator) with a custom WebGL2 engine:
  terrain lit live by the real Sun, ray-traced shadows with the finite solar disk, interval
  illumination %, Earth visibility %, longest night, slope and a transparent suitability score.
- **Sky plot** — terrain horizon silhouette (±1σ from LOLA error maps), Sun and Earth tracks,
  true-aspect close-ups of the discs being clipped by ridges, libration "Earth wobble".
- **Panorama** — first-person view on the 5 m LOLA terrain with ray-marched soft shadows,
  Sun/Earth discs at true angular size (Earth with phase), WASD walking.
- **Warm-up** — a 9-second, skippable fly-in to the pole lit by the actual Sun direction.

Everything in the challenge core runs **client-side** (static hosting works); the optional
FastAPI `compute` service accelerates region-scale heatmaps and robustness Monte-Carlo.

## From an empty machine — one command

Only **git, make and Docker** (Docker Desktop on macOS/Windows, Docker Engine + compose plugin on
Linux) are needed; Python and Node run inside containers.

```bash
git clone https://github.com/3-15-team/lunar-south-pole-explorer.git
cd lunar-south-pole-explorer
make bootstrap            # full data: ~2.5 GB download, 5 m site DEMs; needs ~10 GB disk, ~6 GB Docker RAM
# or
make bootstrap DATA=min   # smallest working set: ~0.4 GB download (80 m DEM), ~4 GB disk, much faster
```

It checks prerequisites (disk, Docker daemon/RAM, port), builds the pipeline toolchain image,
downloads every source file with live progress (plan first: files / total / already present, then
`[i/N] file … % MB/s ETA | all …%`), builds each data product with its own progress
(`(k/n) dem_tiles — …`), starts the stack, waits until it answers, runs the smoke test and prints
a timing summary and **http://localhost:8642**. Safe to re-run or interrupt: downloads resume,
finished files and products are skipped. Another port: `make bootstrap COMPOSE_PORT=8650`.

Variants: `make bootstrap-native` (no Docker; python3 ≥ 3.11 + node ≥ 20 on the machine; ends with
`make dev`) and `make data-docker` (only download + build `data/` in Docker).

## Quick start

Prerequisites: Node ≥ 20, Python 3.12, (optional) Docker; ~3 GB free disk for the minimal data set.

```bash
cd lunar-south-pole-explorer
make setup        # .venv + Python deps + npm install
make data-min     # NAIF kernels + LOLA 80 m DEM → ephemeris tables, DEM tiles, sites, PSRs (~15 min, PGDA is slow)
make dev          # web on http://localhost:5173 (+ compute API on :8000)
```

Primary demo (works offline once data is built):

```bash
make up           # docker compose: nginx (SPA + /data) + compute → http://localhost:8642
make smoke        # check key endpoints
make down
```

Panorama relief rendering is configurable at runtime (no rebuild; `?interp=…&raa=…` in the page URL
overrides it for one tab):

- `PANO_TERRAIN_INTERP` = `bilinear` (original) | `catmull` (default; Catmull-Rom, passes through every
  DEM sample, C1) | `mitchell` | `bspline` (C2, smoothest) — height-field interpolation for mesh, camera
  height and shading normals.
- `PANO_RELIEF_AA` = relief prefilter width as a multiple of the true pixel footprint on the ground
  (default `1`; `2` = smoother relief; `0` = the original isotropic estimate). Filters relief detail only;
  the image is not blurred.
- `PANO_MICRO` = amplitude of the statistical sub-DEM micro-relief (default `1`; `0.6` = calmer; `0` = off →
  the old procedural texture). Built by `make data-micro` (seconds; part of `make data` / `data-min`)
  into `data/web/micro/`; without it the panorama silently uses the procedural texture.
- The map shows the whole southern hemisphere: outside the high-res polar data (80°S, dashed ring) the
  Moon is drawn from the LOLA global 16 px/deg DEM (`make data-outer`, seconds) with the same live Sun
  shading and ray-marched shadows, slightly dimmer/cooler and without analysis layers.
- Micro-relief can be switched on/off in the panorama ("Micro-relief" button). Its initial state defaults
  to **on**; the single place to change that default is `DEFAULT_CONFIG.panoMicroDefault` in
  `apps/web/src/config.ts`; per deployment `make up PANO_MICRO_DEFAULT=off`, per link `?micro=off`.
- Map Earth visibility / Suitability for the **antenna height** (left panel) costs a second GPU horizon
  pass, so it runs only on demand: `layer` (default) — automatically while one of those layers is shown
  and antenna ≠ observer height; `button` — only after "Use the … antenna" in the layer panel. Default in
  `DEFAULT_CONFIG.mapEarthAntenna`; per deployment `make up MAP_EARTH_ANTENNA=button`, per link `?earthant=button`.

Example: `make up PANO_TERRAIN_INTERP=bspline PANO_RELIEF_AA=1.5`, or
`http://localhost:8642/?interp=bilinear&raa=0#m=pano` for the original look.

Other useful targets (`make help` lists all):

| target | what |
|---|---|
| `make doctor` | tools, versions, disk, data presence/checksums, ports |
| `make verify` | ruff + pytest + tsc + vitest + build (+ smoke if a stack is up) — the handoff gate |
| `make data` | everything incl. 40 m DEM, 5 m site DEMs, region horizon maps, pre-baked heatmaps |
| `make data-pull DATA_BASE_URL=…` | restore processed products from any static host instead of recomputing |
| `make validate` | ephemeris vs JPL Horizons + reference illumination maps → `docs/VALIDATION.md` |
| `make dist` / `make serve-dist` | self-contained static bundle (SPA + data) in `dist-static/` |
| `make deploy DEPLOY_TARGET=static\|gcp\|azure` | provider-agnostic hooks (stubs; nothing runs until configured) |

Keyboard: `Space` play/pause · `←/→` ±1 h (`Shift` ±1 day) on the playhead · `M` map · `P` panorama ·
in the panorama `W A S D` walk (1.4 m/s, `Shift` 25 m/s), drag to look.

## Continuous integration

[GitHub Actions CI](.github/workflows/ci.yml) runs on every push and pull request,
and can also be started manually. Independent jobs use Python 3.12 and Node 22
(matching the web container) to run Ruff, Python tests, TypeScript checks, Vitest,
the production build, and HTTP smoke checks for the compute API and web preview.
The frontend build is saved as the `web-dist` artifact for seven days; it does not
include the separately generated scientific data and is not a standalone demo.

CI does not download NASA datasets or SPICE kernels. Tests requiring generated data
are skipped by the existing suites; synthetic-terrain and shared golden-vector
checks still run. Full data validation and the data-backed stack smoke test remain
local gates (`make validate`, `make smoke`). No deployment or secrets are required.

## How it works (short)

- **Ephemerides**: SPICE (DE440 + lunar PA/ME frames) → Sun & Earth positions in MOON_ME,
  2026–2036 every 30 min (float32 per year, ~4 MB). Topocentric correction in the browser.
  Validated against JPL Horizons (`docs/VALIDATION.md`).
- **Terrain**: LOLA 80/40 m polar DEM + 5 m site DEMs → our LPS-2560 tile pyramid (`docs/DATA.md`).
- **Horizon**: multi-resolution ray-march out to 300 km with exact spherical geometry; 1440
  azimuths per site in a Web Worker (~0.1 s); 64 azimuths per pixel on the GPU for map layers.
- **Metrics**: visible fraction of the solar/Earth **disk** (not a point), events refined to
  1 minute, interval statistics — definitions in `docs/METRICS.md`, twin TS/Python implementations
  cross-checked by shared golden vectors.
- **Suitability**: hard slope limit + weighted utilities (presets: short lander / long-term base),
  confidence = rank stability under Monte-Carlo perturbation. No black-box model.

Docs: `docs/ARCHITECTURE.md`, `docs/DATA.md`, `docs/METRICS.md`, `docs/VALIDATION.md`,
`docs/DECISIONS.md`, `docs/DEMO.md`, `docs/REFERENCES.md`, `docs/STATE.md` (handoff state).

## Data & licence

Code: Apache-2.0 (`LICENSE`). Data: NASA LRO LOLA (PGDA) and NAIF SPICE kernels (US public domain).
Surface texture detail is procedural and labelled as synthetic. Full list: `docs/REFERENCES.md`.
