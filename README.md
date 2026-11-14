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
