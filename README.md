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

## Quick start — Docker Compose

Install Docker with Compose, then run this **single command** from a clean checkout:

```text
docker compose up --build --wait --wait-timeout 3600
```

Open **http://localhost:8642**. No host Python, Node, GNU Make, Bash, or cloud account is needed.
The first run downloads real NASA data, generates scientific products, verifies them, and starts
Nginx plus the compute API. Downloads and results persist in a named volume. First setup can take
many minutes; inspect progress with `docker compose logs --follow data-init`. Subsequent starts reuse
verified data and work offline once images and data exist.

Defaults: **80 m terrain (tier 0), 1920 m region overview**, no 5 m sites or height-error maps.
For the larger scientific tier set `DATA_TIER=1` and `REGION_RES=240` in an optional root `.env`.
This requires more disk, memory and generation time. See [complete local operation](docs/LOCAL.md)
for settings, limitations, data persistence and containerized checks.

```text
docker compose --profile tools run --build --rm smoke
docker compose down
```

The smoke check tests real data and every compute operation; shutdown preserves the data volume.
Cloud deployment remains undecided. The local stack uses no provider-specific services.

## Just commands

[Just](https://just.systems/) is the task interface (1.59+, tested with 1.59). GNU Make is no longer used.
With only Just and Docker installed:

```text
just compose-up
just compose-check
just compose-smoke
just compose-down
```

`just --list` shows all commands, including logs, status, and data preparation. Compose recipes do not
invoke host Node/Python, and direct Docker Compose works without Just.

For optional native development, install Node 22, Just, and [uv](https://docs.astral.sh/uv/) for Python:

```text
just setup
just setup-py
just data-min
just dev
```

This starts Vite on :5173 and FastAPI on :8000. Native data lives under `data/`; Compose uses its
own persistent volume. `just web-dev` runs Vite alone. Native tasks run in PowerShell on Windows
and use portable Node/Python helpers instead of Bash, rsync or hardcoded virtualenv paths.

| Command | Purpose |
|---|---|
| `just check` | Frontend typecheck, tests, production build |
| `just lint` / `just test-py` | Native Python lint / tests |
| `just data status` | Native dataset status |
| `just data <job>` | Individual pipeline job (see `just --list`) |
| `just validate` | Native JPL Horizons / reference-map validation |
| `just dist` / `just serve-dist` | Export / serve frontend plus native data as a static bundle |
| `just compose-data-status` | Dataset status inside Compose |

Panorama settings are configured in `.env` and take effect on container startup without rebuilding:
`PANO_TERRAIN_INTERP=bilinear|catmull|mitchell|bspline`, `PANO_RELIEF_AA=1`, `PANO_MICRO=1`,
`PANO_MICRO_DEFAULT=on|off`. Browser query overrides remain available (`?interp=…&raa=…&micro=…`).

Keyboard: `Space` play/pause · `←/→` ±1 h (`Shift` ±1 day) · `M` map · `P` panorama;
`W A S D` walk, `Shift` accelerates, drag to look.

## Continuous integration

[CI](.github/workflows/ci.yml) runs native Just checks on Windows and Linux, plus containerized Python
and frontend checks on Linux. It installs dependencies, runs Ruff/Pytest, TypeScript/Vitest, the
production build and a real compute HTTP startup check. The frontend build is retained as an artifact.

CI does not download NASA datasets. Data-dependent tests skip when products are absent; synthetic
and shared golden-vector checks still run. Full local verification uses `just compose-check` and
`just compose-smoke` after the automatic initializer completes. The build artifact excludes scientific
data; use a static bundle or Compose for a working deployment.

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
