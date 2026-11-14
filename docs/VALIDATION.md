# VALIDATION

How we check that our numbers are right. Sections marked *generated* are rewritten by the pipeline jobs
(`make validate`); text outside the markers is hand-written. Reference rasters are used **only** as a
sanity check — every product shown in the app is computed by us.

## Summary

| check | result | how |
|---|---|---|
| Ephemeris table interpolation (30 min, float32, linear) | Sun ≤ 0.017″, Earth ≤ 0.121″ (direction) | `pipeline/jobs/ephemeris.py` vs direct SPICE at 64 288 mid-samples per body 2026–2036 |
| Topocentric Sun/Earth az/el vs JPL Horizons | Sun ≤ 0.012″, Earth ≤ 0.115″ (max separation, 84 comparisons) | `pipeline/jobs/validate_horizons.py`, section below |
| Long-term Sun / Earth visibility vs Mazarico et al. maps | bias −0.020 / −0.002, RMS 0.034 / 0.050, r 0.977 / 0.972 (150 random points, ρ ≤ 150 km) | `pipeline/jobs/validate_reference.py`, section below |
| Catalog site points vs published points | Site01 summit 23 m from Gläser's best-lit spot (ours 85.9 % vs published 88.1 % at 2 m); Site04 56 m from Mazarico/Boazman Site 4 | `pipeline/config/site_refs.json`, section below |
| Geometry, tiles, horizon, disk, metrics, suitability | unit tests + golden vectors shared with the TypeScript twin | `pytest -q libs/lunarcore/tests pipeline/tests services/compute/tests` |

The Earth interpolation figure is slightly above the "< 0.1″" stated in DATA.md §3: the Earth's direction in
MOON_ME accelerates with the optical libration (a·Δt²/8 ≈ 0.08–0.12″ for Δt = 30 min). It is 3·10⁻⁵ of the
Earth's angular radius and irrelevant for visibility.

## Unit tests and golden vectors (hand-written)

- **Frames/projection** (`test_geo.py`): projection round trip, trig-free unit vector = trigonometric one,
  ENU orthonormal and right-handed, grid ray of azimuth A has azimuth A in the local ENU frame (1 m step,
  < 1e-4°), grid North points away from the pole, scale factor k = 1 + q against chord distances.
- **Tiles** (`test_tiles.py`): LDT1 round trip within scale/2, nodata, raw (un-gzipped) payloads, grid
  math, clipmap level rule (ADR-102), bilinear exact for planes across tile edges, missing-tile fallback.
- **Horizon** (`test_horizon.py`) on analytic terrain: flat sphere → dip −acos(R/(R+h)) (−0.0869° for 2 m,
  −0.1943° for 10 m) and horizon distance √(2Rh); planar ramp uphill → atan(g) − dip, sideways → dip;
  single Gaussian peak → dense reference maximum (and ≈ atan((h₀ − h_o − L²/2R)/L)); region-map path ==
  site path at 64 azimuths within the 0.1° code step.
- **Disk** (`test_disk.py`): straight edge at z = ±1, 0, symmetry f(z) + f(−z) = 1, monotonic; slice method
  == straight edge for flat horizons (< 1e-9, requirement 1e-3); slice areas partition the disk.
- **Metrics** (`test_metrics.py`): interval crossing a sunset, censored dark runs at both ends, inclusive
  thresholds (f = 0.05 not dark, f_earth = θ visible), power proxies, events bisected to ≤ 60 s against a
  1 s brute-force scan on a synthetic ephemeris, "time to next" consistent with the event list.
- **Suitability** (`test_suitability.py`): utilities at 0, ½, 1, presets, hard slope constraint, footprint
  statistics on a plane (slope = atan g, relief = g·(nb−1)·res), box filters vs brute force, Dirichlet weight
  means, rank stability, non-maximum suppression.
- **Golden vectors** (`libs/lunarcore/tests/golden/*.json`, spec in its README): geo (12), disk (17 + 15 slice
  cases), horizon (7 analytic terrains), metrics (5), topo (30 = 6 sites × 5 epochs from the shipped tables).
  The same files are asserted by pytest and by the web app's vitest suite.
- **Service** (`services/compute/tests`): schema/validation errors, site metrics, heatmap PNG/JSON, cache
  hits, robustness invariants (Σ rank stability = k), skipped when data are not built.

## Known limitations (hand-written)

- Straight rays in the projection plane instead of great circles (< 0.1° azimuth error within 150 km of the
  pole); DEM levels are 2×2 means, so distant peaks are slightly smoothed (≤ ~0.01–0.02° on synthetic peaks).
- The region heatmaps use 64-azimuth horizons, a 240 m analysis grid and the straight-edge disk formula
  (map path); site metrics use 1440 azimuths and the slice method (CPU path).
- No atmosphere, no refraction (airless body); no diffuse/scattered light; Earth radius = mean radius.

<!-- BEGIN:horizons -->
## Ephemeris vs JPL Horizons (generated)

_Generated 2026-11-14T10:37:13Z by `pipeline/jobs/validate_horizons.py` (cached responses in `data/work/horizons/`)._

6 polar sites × 7 epochs (2026–2036) × Sun and Earth = 84 comparisons of our topocentric apparent azimuth/elevation (float32 tables, linear interpolation, site vector subtracted, local ENU) with JPL Horizons (`CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `QUANTITIES='4'`, `APPARENT='AIRLESS'`, `EXTRA_PREC='YES'`). Separation = great-circle angle between the two directions.

| body | n | max sep (″) | mean sep (″) | max \|Δel\| (″) | max \|Δaz·cos el\| (″) |
|---|---|---|---|---|---|
| sun | 42 | 0.012 | 0.006 | 0.012 | 0.005 |
| earth | 42 | 0.115 | 0.066 | 0.113 | 0.034 |

Horizons header (what Horizons uses for the observer frame):

- `Center body name`: Moon (301)                      {source: DE441}
- `Center-site name`: (user defined site below)
- `Center pole/equ`: MEAN_ME (high precision)        {East-longitude positive}
- `Center radii`: 1737.4, 1737.4, 1737.4 km       {Equator_a, b, pole_c}
- `Atmos refraction`: NO (AIRLESS)

Ours: kernels `naif0012.tls`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf` (`MOON_ME` = `MOON_ME_DE440_ME421`), `spkpos(..., 'MOON_ME', 'LT+S', 'MOON')` from the Moon centre, then `s = S − P` with `P = (R + h)·u(lat, lon)`, R = 1737.4 km. Horizons additionally applies light-time and aberration from the site itself and gravitational deflection (all ≪ 0.1″ here).

Table interpolation (direct SPICE at every 3rd mid-sample 2026–2036 vs linear interpolation of the float32 records): Sun max 0.017″ (mean 0.009″), Earth max 0.121″ (mean 0.065″); float32 quantisation at the nodes ≤ 0.008″.

Largest five differences:

| site | body | UTC | Horizons az/el (°) | ours az/el (°) | sep (″) |
|---|---|---|---|---|---|
| Malapert massif | earth | 2031-09-09T09:09:00Z | 4.072008 / 0.136162 | 4.072002 / 0.136194 | 0.115 |
| de Gerlache rim | earth | 2031-09-09T09:09:00Z | 71.701629 / -3.445146 | 71.701623 / -3.445114 | 0.115 |
| IM-1 Odysseus | earth | 2031-09-09T09:09:00Z | 2.413612 / 6.004277 | 2.413605 / 6.004308 | 0.115 |
| Connecting ridge | earth | 2031-09-09T09:09:00Z | 141.311620 / -4.276848 | 141.311614 / -4.276817 | 0.115 |
| Shackleton rim | earth | 2031-09-09T09:09:00Z | 175.712894 / -4.089862 | 175.712888 / -4.089831 | 0.114 |
<!-- END:horizons -->

<!-- BEGIN:reference -->
## Long-term Sun/Earth visibility vs Mazarico et al. reference maps (generated)

_Generated 2026-11-14T11:00:28Z by `pipeline/jobs/validate_reference.py`; reference = Mazarico et al. (2011) PGDA maps `AVGVISIB_85S_060M_201608` (Sun) and `..._EARTH`, used **only** as a sanity check._

Ours: own 1440-azimuth horizon from our tile pyramid (finest level at the point), observer height 0 m, our ephemeris 2026-01-01 – 2036-12-31 at 2 h steps; Sun = mean visible fraction of the solar disk (slice method); Earth = share of time with **any** part of the disk visible (the reference definition; our app's DTE metric uses ≥ 50 %). Reference: hourly average over an 18.6-year nutation cycle, 60 m pixels (value of the pixel containing the point, and the min–max of its 3×3 neighbourhood).

| site | lat, lon | Sun ours | Sun ref (3×3 range) | Earth ours | Earth ref (3×3 range) |
|---|---|---|---|---|---|
| Connecting ridge | -89.439, -137.144 | 0.816 | 0.443 (0.44–0.75) | 0.586 | 0.539 (0.50–0.58) |
| Shackleton rim | -89.780, -156.197 | 0.793 | 0.852 (0.06–0.85) | 0.568 | 0.550 (0.29–0.55) |
| Nobile rim 1 | -85.243, 36.746 | 0.603 | 0.590 (0.54–0.63) | 0.752 | 0.753 (0.70–0.76) |
| Peak near Shackleton | -88.808, 123.718 | 0.656 | 0.542 (0.54–0.86) | 0.553 | 0.544 (0.46–0.57) |
| de Gerlache rim | -88.664, -68.388 | 0.779 | 0.827 (0.38–0.83) | 0.618 | 0.614 (0.27–0.61) |
| Leibnitz beta plateau | -85.405, 31.707 | 0.624 | 0.627 (0.19–0.63) | 0.780 | 0.695 (0.51–0.82) |
| Malapert massif | -85.988, 2.068 | 0.571 | 0.555 (0.52–0.60) | 0.889 | 0.876 (0.75–0.90) |
| Haworth | -86.443, -22.823 | 0.334 | 0.341 (0.16–0.40) | 0.000 | 0.000 (0.00–0.17) |
| Shoemaker | -87.174, 61.048 | 0.458 | 0.562 (0.37–0.58) | 0.451 | 0.447 (0.45–0.45) |
| Haworth (Artemis III region) | -86.700, -23.700 | 0.314 | 0.321 (0.32–0.32) | 0.305 | 0.303 (0.29–0.31) |
| Malapert Massif (Artemis III region) | -86.000, 0.300 | 0.235 | 0.321 (0.29–0.42) | 0.396 | 0.372 (0.23–0.54) |
| Mons Mouton / Nobile Rim 1 | -85.400, 35.300 | 0.115 | 0.142 (0.13–0.15) | 0.634 | 0.638 (0.62–0.64) |
| de Gerlache Rim (Artemis III region) | -88.500, -66.700 | 0.326 | 0.355 (0.34–0.36) | 0.609 | 0.606 (0.60–0.61) |
| Chang'e-7 planned target | -88.800, 123.400 | 0.402 | 0.500 (0.40–0.54) | 0.569 | 0.587 (0.45–0.61) |
| Lunar south pole (90 S) | -90.000, 0.000 | 0.229 | 0.275 (0.00–0.31) | 0.262 | 0.315 (0.00–0.39) |

Random points (n = 150, uniform in ρ ≤ 150 km, seed 42):

| quantity | bias (ours − ref) | median \|Δ\| | RMS | Pearson r | ours within ref 3×3 range ±0.02 |
|---|---|---|---|---|---|
| Sun visibility | -0.020 | 0.019 | 0.034 | 0.977 | 83 % |
| Earth visibility (any part) | -0.002 | 0.003 | 0.050 | 0.972 | 97 % |

Mismatches > 0.10 at catalog sites: Connecting ridge (Sun +0.37, Earth +0.05), Peak near Shackleton (Sun +0.11, Earth +0.01), Shoemaker (Sun -0.10, Earth +0.00).

Likely causes of differences (none of them is a defect we could fix by tuning): (1) averaging period — 11 years (2026–2036) vs a full 18.6-year cycle; (2) topography — LOLA 2023 (Barker et al.) 80/40/5 m products vs the 2016 maps used for the reference, and point-vs-60 m-pixel sampling on steep rims where illumination changes over tens of metres (see the 3×3 ranges); (3) horizon method — our clipmap ray march (1 % steps, mean pyramid) vs the reference horizon computation; (4) unknown reference observer height (we use 0 m here; the app defaults to 2 m).
<!-- END:reference -->

<!-- BEGIN:sitepoints -->
## Catalog site points vs published points (generated)

_Generated 2026-11-14T11:00:28Z by `pipeline/jobs/validate_reference.py` from `pipeline/config/site_refs.json`._

Catalog points of the PGDA 5 m sites are the highest terrain inside the central 60 % of each 5 m DEM (ADR-110). Published points are of different kinds (region centres, illumination maxima, landing points), so distances of a few hundred metres are expected; where a source prints an average illumination we recompute it at the same point with our horizon and ephemeris (2026–2036; the sources average over an 18.6-year cycle).

| site | published point | lat, lon | distance to our point (m) | ref inside 5 m DEM | published illum. | ours at that point |
|---|---|---|---|---|---|---|
| Connecting ridge | [Mazarico et al. 2011 Site 1 point (as reproduced by Glaeser 2014, Table 7)](https://depositonce.tu-berlin.de/bitstream/11303/4603/2/glaeser_philipp.pdf) | -89.4500, -137.3100 | 340 | yes | 89.0 % (h = 0 m) | 25.9 % |
| Connecting ridge | [De Rosa et al. 2012 CR1 (region centre, Table 2)](https://arxiv.org/pdf/1208.5587) | -89.4679, -137.4110 | 882 | yes | – | – |
| Connecting ridge | [Glaeser 2014 CR1 best spot at 2 m (Table 7)](https://depositonce.tu-berlin.de/bitstream/11303/4603/2/glaeser_philipp.pdf) | -89.4395, -137.1934 | 23 | yes | 88.1 % (h = 2 m) | 85.9 % |
| Shackleton rim | [Boazman et al. 2022 site 004 (= Mazarico Site 4)](https://iopscience.iop.org/article/10.3847/PSJ/aca590/pdf) | -89.7800, -155.7300 | 56 | yes | – | – |
| Shackleton rim | [De Rosa et al. 2012 SR1 (region centre, Table 2)](https://arxiv.org/pdf/1208.5587) | -89.7755, -156.4480 | 151 | yes | – | – |
| Peak near Shackleton | [De Rosa et al. 2012 SV1 (region centre, Table 2)](https://arxiv.org/pdf/1208.5587) | -88.8247, 124.1359 | 566 | yes | – | – |
| de Gerlache rim | [De Rosa et al. 2012 GR1 (region centre, Table 2)](https://arxiv.org/pdf/1208.5587) | -88.6952, -68.2846 | 951 | yes | – | – |
| de Gerlache rim | [Kumari et al. 2022 Site 011 station L1 (landing point, Table 3)](https://iopscience.iop.org/article/10.3847/PSJ/ac88c2) | -88.6500, -67.1200 | 996 | yes | – | – |
| Leibnitz beta plateau | [De Rosa et al. 2012 LP1 (name match only)](https://arxiv.org/pdf/1208.5587) | -85.4596, 31.7805 | 1,677 | yes | – | – |
| Malapert massif | [De Rosa et al. 2012 MP1 (name match only)](https://arxiv.org/pdf/1208.5587) | -85.9756, -2.1124 | 8,889 | yes | – | – |
| Malapert massif | [De Rosa et al. 2012 MP2 (name match only)](https://arxiv.org/pdf/1208.5587) | -86.0265, 2.7580 | 1,873 | yes | – | – |
| Nobile rim 2 | [Pena-Asensio et al. 2024 #1-ranked landing point on DM2 (Table 3)](https://arxiv.org/pdf/2406.19863) | -84.2016, 60.6999 | 9,424 | yes | – | – |

Notes on large differences:

- Mazarico et al. 2011 Site 1 point (as reproduced by Glaeser 2014, Table 7): printed to 0.01 deg (about +-150 m in latitude) on a ridge crest a few hundred metres wide, so the rounded point can fall on the flank; the 4-decimal point of Glaeser 2014 (23 m from our summit) agrees within ~2 percentage points.
- De Rosa et al. 2012 LP1 (name match only): matched by name only (no source assigns it to the PGDA site); region centre, not a summit.
- De Rosa et al. 2012 MP1 (name match only): matched by name only (no source assigns it to the PGDA site); region centre, not a summit.
- De Rosa et al. 2012 MP2 (name match only): matched by name only (no source assigns it to the PGDA site); region centre, not a summit.
- Pena-Asensio et al. 2024 #1-ranked landing point on DM2 (Table 3): a ranked landing point inside the DM2 DEM, not a site centre or summit.

Our points: Connecting ridge -89.4389, -137.1436 (1959.5 m); Shackleton rim -89.7804, -156.1969 (1739.1 m); Nobile rim 1 -85.2434, 36.7462 (6798.1 m); Peak near Shackleton -88.8081, 123.7176 (1648.7 m); de Gerlache rim -88.6639, -68.3883 (1816.0 m); Leibnitz beta plateau -85.4046, 31.7073 (6463.9 m); Malapert massif -85.9877, 2.0681 (5173.6 m); Haworth -86.4433, -22.8234 (2637.2 m); Shoemaker -87.1735, 61.0483 (713.6 m); Nobile rim 2 -84.1176, 57.7589 (1636.3 m).
<!-- END:sitepoints -->
