# Lunar South Pole Site Explorer — Product Description

> **Is this landing site and date viable — and what changes if the launch slips?**

Lunar South Pole Site Explorer is a web application for comparing landing and base sites at the
lunar south pole. You pick a site from the catalogue or enter any coordinates, choose a date or time
interval, and the app shows how the Sun and the Earth move relative to the **real terrain horizon**:
how much sunlight the site gets (power), when the Earth is visible (direct-to-Earth communications),
the longest night, and the time left until sunset and Earthset. Up to four scenarios can be compared
side by side, including "what if the mission slips by N days".

Built for the NASA Space Apps Challenge 2026, challenge *CLPS Lunar Mission Browser*.

---

## 1. Why it matters

- At the lunar south pole the Sun is **never more than about 1.5° above the horizon**. It circles the
  horizon once every lunar day (29.5 Earth days).
- Whether a lander is lit is therefore decided by **ridges up to 100+ km away**, not by the local
  ground. A point-like "is the Sun above 0°?" model is wrong: the Sun is usually partly hidden.
- The Earth hangs almost fixed in the lunar sky, but **libration** moves it by about ±7°, enough to
  drop behind nearby hills and cut radio contact.
- A delay of a few days can turn a well-lit site into one facing a multi-day night. Planners need to
  see this risk at a glance; the public needs to understand why polar landings are hard.

## 2. Key features

| Feature | What it gives you |
|---|---|
| **Live-lit polar map** | LOLA terrain lit by the real Sun at the chosen moment; cast shadows ray-traced from the terrain, with partial (penumbra) shadows from the finite solar disk. No pre-baked shading. |
| **Analysis layers** | Illumination % over an interval, Earth visibility %, longest night, slope, and a transparent suitability score for an L×L m footprint (5–100 m). |
| **Sky plot** | The terrain horizon silhouette (with a ±1σ uncertainty band from LOLA error maps), the Sun and Earth tracks over the interval, and true-scale close-ups of each disc against the ridge. |
| **Metric tiles** | Sunset/sunrise countdown, Earthset/Earthrise countdown, current visible fraction of each disc, interval illumination, longest darkness, DTE visibility and longest communications gap, vertical vs flat solar-panel output. |
| **Scenario comparison** | Pin up to 4 site + interval scenarios; a "What if it slips?" slider (−30…+30 days) shows deltas and a plain-language verdict. |
| **Date × site calendar** | Daily sunlight for 60 days for several sites; click a day to jump to it. |
| **Best-spot search** | Finds the top locations in the current view, with **rank stability** under Monte-Carlo weight perturbation (robustness, not probability). |
| **Region overview** | Region-wide suitability heatmap from the compute server; falls back to pre-computed maps if the server is offline. |
| **First-person panorama** | Stand on 5 m LOLA terrain: Sun and Earth at true angular size (Earth with correct phase), soft terrain shadows, a rotating star field, WASD walking. |
| **Intro fly-in** | A 9-second, skippable fly-in to the pole, lit by the actual Sun direction; respects "reduced motion". |
| **Shareable state** | Site, time, interval, layer, scenarios and map view are stored in the URL; the **Share** button copies the link. |
| **Two audiences** | *Explorer* mode (plain language, fewer numbers) and *Planner* mode (full detail: elevation stats, DTE windows, site parameters). |

## 3. How it works

1. **Ephemerides.** Sun and Earth positions in the lunar body-fixed MOON_ME frame are computed offline
   with NASA/JPL SPICE (DE440 planetary ephemeris and the lunar orientation kernels) for 2026–2036 every
   30 minutes (~4 MB in total). The browser interpolates and corrects for the observer's position on the
   surface (topocentric parallax matters for the Earth: up to 0.26°).
2. **Terrain.** LOLA digital elevation models (80 m and 40 m for 80°S–90°S, 5 m around ten candidate
   sites) are converted into a tile pyramid in south polar stereographic projection (5 m to 2560 m per
   pixel, ~1 GB).
3. **Horizon.** For each site, rays are marched across the terrain up to 300 km in 1440 directions,
   using exact spherical geometry (Moon curvature included) and coarser terrain at larger distances.
   Takes about 0.1 s in a background thread.
4. **Disc visibility.** The Sun and the Earth are treated as **discs**, not points: the app computes
   which fraction of each disc is above the horizon.
5. **Metrics.** From the visible fractions over time: illumination %, sunlit hours, longest darkness,
   sunsets, Earth visibility %, communication windows, panel output. Events (sunset, Earthrise …) are
   refined to one minute.
6. **Map layers on the GPU.** For the visible map area, horizons are computed per pixel in 64
   directions on the graphics card; the interval integrals are then evaluated per pixel.
7. **Suitability.** A transparent multi-criteria score: hard slope limit plus weighted terms for
   sunlight, longest night, Earth contact, slope and roughness. Two presets: *short lander mission* and
   *long-term base*. No trained model is used — every term is documented in `docs/METRICS.md`.

## 4. Validation

| Check | Result |
|---|---|
| Ephemeris tables vs direct SPICE | Sun ≤ 0.017″, Earth ≤ 0.121″ |
| Topocentric Sun/Earth direction vs **JPL Horizons** (84 comparisons) | Sun ≤ 0.012″, Earth ≤ 0.115″ |
| Long-term Sun / Earth visibility vs Mazarico et al. reference maps | correlation 0.977 / 0.972 |
| Connecting ridge vs published best-lit point (Gläser 2014) | 85.9% vs 88.1% illumination |
| TypeScript vs Python implementations | identical on shared test vectors |

Details: `docs/VALIDATION.md`.

## 5. Technologies and libraries

**Frontend (browser)**
- TypeScript 5.9, Vite 6 (build), Vitest 3 (tests)
- Preact 10 + @preact/signals — UI and reactive state
- OpenLayers 10 — map view, interaction and vector overlays in a custom south polar stereographic projection
- WebGL2 with custom GLSL shaders — terrain lighting, ray-traced shadows, GPU horizon maps, interval integrals, suitability
- three.js 0.180 — first-person panorama
- Web Workers — horizon and metrics computation off the UI thread
- Canvas 2D — sky plot, timeline strips, calendar

**Backend and data pipeline (Python 3.12)**
- SpiceyPy (NASA NAIF SPICE) — ephemerides
- NumPy, Numba (parallel JIT), SciPy — horizon maps, metrics, suitability
- rasterio / GDAL — reading LOLA GeoTIFFs; pyshp, Shapely — PSR polygons
- Pillow — heatmap PNGs
- FastAPI, Uvicorn, Pydantic — compute service (site metrics, region heatmaps, robustness)
- pytest, ruff — tests and linting

**Infrastructure**
- Docker Compose: nginx (web app + static data) and the compute service; an optional `texgen` service (disabled)
- Makefile for setup, data, development, testing, Docker and a provider-agnostic deploy hook
- Static-hosting fallback: the core works without any server

**Data (NASA, public domain)**
- LRO LOLA polar DEMs 80 m / 40 m + error maps, permanently shadowed regions (PGDA product 90)
- LOLA 5 m site DEMs (PGDA product 78)
- Mazarico et al. illumination maps (PGDA product 69) — for validation only
- NAIF SPICE kernels (DE440, lunar frames), JPL Horizons API — for validation only

Surface micro-texture, the intro Moon, the star field and the Earth pattern are **procedural
(synthetic)** and labelled as such. No copyrighted imagery or music is used.

## 6. User interface guide

### Screen layout

```
┌ Header: title · Map | Panorama · Explorer | Planner · Share · Intro ──────────────┐
├ Left: sites,         ├ Centre: map or panorama           ├ Right: verdict,      ┤
│ coordinates,         │                                    │ sky plot, metric     │
│ mast height,         │                                    │ tiles, "Why the pole │
│ scenarios            │                                    │ is different"        │
├──────────────────────┴────────────────────────────────────┴──────────────────────┤
│ Bottom: timeline (play, time, interval, Sun/Earth strips) · date × site calendar │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Header
- **Map / Panorama** — switch the central view (keys `M` and `P`).
- **Explorer / Planner** — information density: plain language vs full numbers.
- **Share** — copies a link that restores exactly the current state.
- **Intro** — replays the fly-in.

### Left panel: sites and scenarios
- **Search sites** filters the catalogue. Groups: LOLA 5 m sites (PGDA), Artemis III candidate regions,
  CLPS deliveries, other missions, reference points. Badges: *5 m DEM* (high-resolution terrain),
  *approx.* (approximate published coordinate), *outside coverage* (beyond 80°S — no terrain horizon).
- **Custom coordinates**: type `89.45S 137.3W` or `-89.45, -137.3` and press **Go** — or simply click
  anywhere on the map.
- **Observer / mast height** (0–10 m): raising a camera or solar array often adds hours of sunlight.
- **+ Pin current site & interval** adds a scenario card (up to 4).
- **What if it slips?** shifts every pinned scenario by −30…+30 days. Each card shows plan vs slipped
  values (sunlight, longest night, Earth contact; in Planner mode also comms gap and panel output),
  coloured deltas and a one-line verdict. Click a card title to load it; × removes it.

### Centre: map
- Pan by dragging, zoom with the wheel or the +/− buttons; the scale bar is bottom right.
- **Click** a site marker to select it, or any point to make a custom site.
- **Layer switcher** (top left):
  - *Terrain (live light)* — terrain lit by the Sun at the playhead time.
  - *Shadows now* — blue: full shadow; orange: Sun disc partly hidden (penumbra).
  - *Illumination %*, *Earth visibility %*, *Longest night* — computed for the selected interval.
  - *Slope* — classes <5°, 5–10°, 10–15°, 15–20°, 20–30°, >30°.
  - *Suitability* — score from 0 to 1; hatched areas fail the slope limit.
- In **Suitability**: choose the preset, footprint size (5–100 m) and maximum slope;
  **Find best spots in view** lists the top locations with "% top-5" stability — click one to select it;
  **Region overview (server)** overlays a whole-region heatmap (or a pre-computed one if offline).
- **Stand here** (top right): click it, then click on the map — the view zooms in and opens the panorama.
- **Enhanced / Realistic**: Enhanced adds a faint fill light so shadowed relief stays readable;
  Realistic shows direct sunlight only.
- **PSRs (> 1 km²)** toggles permanently shadowed region outlines.
- Bottom left: coordinates, height and layer values under the cursor, plus computation progress.

### Centre: panorama
- Drag to look around; `W A S D` or arrow keys walk at 1.4 m/s, `Shift` moves at 25 m/s.
- The HUD shows the sunset/sunrise and Earthset/Earthrise countdowns, current elevations and visible
  fractions; the compass shows your heading.
- **Enhanced / Realistic** as on the map; **← Map** returns to the map.

### Right panel
- **Verdict** — *Viable / Marginal / Risky window* with three chips: sunlight, longest night, Earth.
- **Sky from the site** — horizontal axis: azimuth (N–E–S–W–N), vertical: elevation. Grey: terrain
  silhouette (lighter band = uncertainty); yellow: Sun track; blue: Earth track (the libration loop);
  dashed line: 0° astronomical horizon. Hover to read the horizon height and the distance to the ridge.
- **Close-ups** of the Sun and Earth discs at true scale against the local horizon (with a 1° scale bar).
- **Metric tiles** — hover any tile for a plain-language explanation.
- **Why the lunar south pole is different** — short educational notes using live numbers.

### Bottom: timeline and calendar
- **▶ Play / ❚❚ Pause** (`Space`) animates time inside the interval; the speed selector offers
  1 h/s, 6 h/s, 1 day/s, 3 days/s.
- **Time (UTC)**, **From**, **To** — exact date-time inputs; quick buttons set the interval to
  *14 d*, *1 lunar day*, *90 d*, *1 yr*.
- On the track: drag the white **playhead**, the yellow **handles** (interval start/end) or the whole
  interval. Strips show when the Sun (yellow) and the Earth (blue) are visible; *☀ noon* ticks mark
  local noon of each lunar day.
- Keyboard on the playhead: `←/→` ±1 hour, `Shift+←/→` ±1 day, `PageUp/PageDown` ±1 day,
  `Home/End` interval start/end. On the interval handles: `←/→` ±1 day, `Shift` ±7 days.
- **Date × site calendar** (expand) → **Compute calendar**: 60 days of daily sunlight per site
  (colour) with a dark underline where Earth contact is below 50% of the day. Click a cell to jump there.

## 7. Running it

```bash
cd lunar-south-pole-explorer
make setup      # Python environment + npm install
make data-min   # minimal data set (or `make data` for everything)
make dev        # http://localhost:5173 (+ compute API on :8000)
make up         # Docker: http://localhost:8642 — the primary demo
```

Code licence: Apache-2.0.
