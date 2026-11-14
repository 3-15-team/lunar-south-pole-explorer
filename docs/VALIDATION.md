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
