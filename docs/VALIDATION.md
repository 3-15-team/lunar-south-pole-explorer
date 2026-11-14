# VALIDATION

How we check that our numbers are right. Sections marked *generated* are rewritten by the pipeline jobs
(`make validate`); text outside the markers is hand-written. Reference rasters are used **only** as a
sanity check — every product shown in the app is computed by us.

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

_Generated 2026-11-14T10:47:44Z by `pipeline/jobs/validate_reference.py`; reference = Mazarico et al. (2011) PGDA maps `AVGVISIB_85S_060M_201608` (Sun) and `..._EARTH`, used **only** as a sanity check._

Ours: own 1440-azimuth horizon from our tile pyramid (finest level at the point), observer height 0 m, our ephemeris 2026-01-01 – 2036-12-31 at 2 h steps; Sun = mean visible fraction of the solar disk (slice method); Earth = share of time with **any** part of the disk visible (the reference definition; our app's DTE metric uses ≥ 50 %). Reference: hourly average over an 18.6-year nutation cycle, 60 m pixels (value of the pixel containing the point, and the min–max of its 3×3 neighbourhood).

| site | lat, lon | Sun ours | Sun ref (3×3 range) | Earth ours | Earth ref (3×3 range) |
|---|---|---|---|---|---|
| Connecting ridge | -89.439, -137.144 | 0.816 | 0.443 (0.44–0.75) | 0.586 | 0.539 (0.50–0.58) |
| Shackleton rim | -89.780, -156.197 | 0.793 | 0.852 (0.06–0.85) | 0.568 | 0.550 (0.29–0.55) |
| Nobile rim 1 | -85.243, 36.746 | 0.603 | 0.590 (0.54–0.63) | 0.752 | 0.753 (0.70–0.76) |
| Peak near Shackleton | -88.808, 123.718 | 0.656 | 0.542 (0.54–0.86) | 0.553 | 0.544 (0.46–0.57) |
| de Gerlache rim | -88.664, -68.388 | 0.779 | 0.827 (0.38–0.83) | 0.618 | 0.614 (0.27–0.61) |
| Leibnitz beta plateau | -85.405, 31.707 | 0.624 | 0.627 (0.19–0.63) | 0.780 | 0.695 (0.51–0.82) |
| Malapert massif | -85.988, 2.068 | 0.522 | 0.555 (0.52–0.60) | 0.878 | 0.876 (0.75–0.90) |
| Haworth | -86.443, -22.823 | 0.334 | 0.341 (0.16–0.40) | 0.000 | 0.000 (0.00–0.17) |
| Shoemaker | -87.172, 61.080 | 0.461 | 0.473 (0.36–0.57) | 0.450 | 0.446 (0.45–0.45) |
| Haworth (Artemis III region) | -86.700, -23.700 | 0.314 | 0.321 (0.32–0.32) | 0.306 | 0.303 (0.29–0.31) |
| Malapert Massif (Artemis III region) | -86.000, 0.300 | 0.285 | 0.321 (0.29–0.42) | 0.353 | 0.372 (0.23–0.54) |
| Mons Mouton / Nobile Rim 1 | -85.400, 35.300 | 0.115 | 0.142 (0.13–0.15) | 0.634 | 0.638 (0.62–0.64) |
| de Gerlache Rim (Artemis III region) | -88.500, -66.700 | 0.326 | 0.355 (0.34–0.36) | 0.609 | 0.606 (0.60–0.61) |
| Chang'e-7 planned target | -88.800, 123.400 | 0.402 | 0.500 (0.40–0.54) | 0.569 | 0.587 (0.45–0.61) |
| Lunar south pole (90 S) | -90.000, 0.000 | 0.230 | 0.275 (0.00–0.31) | 0.262 | 0.315 (0.00–0.39) |

Random points (n = 60, uniform in ρ ≤ 150 km, seed 42):

| quantity | bias (ours − ref) | median \|Δ\| | RMS | Pearson r | ours within ref 3×3 range ±0.02 |
|---|---|---|---|---|---|
| Sun visibility | -0.016 | 0.018 | 0.039 | 0.964 | 90 % |
| Earth visibility (any part) | +0.002 | 0.003 | 0.074 | 0.927 | 100 % |

Mismatches > 0.10 at catalog sites: Connecting ridge (Sun +0.37, Earth +0.05), Peak near Shackleton (Sun +0.11, Earth +0.01).

Likely causes of differences (none of them is a defect we could fix by tuning): (1) averaging period — 11 years (2026–2036) vs a full 18.6-year cycle; (2) topography — LOLA 2023 (Barker et al.) 80/40/5 m products vs the 2016 maps used for the reference, and point-vs-60 m-pixel sampling on steep rims where illumination changes over tens of metres (see the 3×3 ranges); (3) horizon method — our clipmap ray march (1 % steps, mean pyramid) vs the reference horizon computation; (4) unknown reference observer height (we use 0 m here; the app defaults to 2 m).
<!-- END:reference -->
