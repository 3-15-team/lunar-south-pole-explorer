# METRICS — exact definitions (implemented identically in TS and Python)

TS: `apps/web/src/core/` (`geo.ts`, `horizon.ts`, `disk.ts`, `metrics.ts`).
Python: `libs/lunarcore/lunarcore/` (`geo.py`, `horizon.py`, `disk.py`, `metrics.py`).
Shared golden test vectors: `libs/lunarcore/tests/golden/*.json` (both test suites load them).

## Inputs

- Site: lat φ, lon λ (MOON_ME, degrees), terrain height `h_t` (m above R = 1737.4 km, from
  the DEM), observer height `h_o` above terrain (default **2 m**, UI range 1–100 m on a logarithmic slider, ADR-120).
  Observer position `P = (R + h_t + h_o)·u(φ,λ)`.
- Body vectors from the ephemeris table (Moon-centred, MOON_ME, km): `S(t)`, `E(t)`.
  Topocentric vectors `s = S − P`, `e = E − P` (P in km).
- Angular radii: `r_sun = asin(695700 / |s|)`, `r_earth = asin(6371.0084 / |e|)`.
- Local ENU at the site (DATA.md §1); elevation `el = asin(v·Up/|v|)`,
  azimuth `az = atan2(v·East, v·North)` wrapped to [0°, 360°).

## Horizon profile H(A)

- `naz = 1440` azimuths (0.25°) for site metrics and the sky plot; 64 in the GPU map
  engine and in server-side region maps.
- For each azimuth a ray is marched in the projection plane from the observer with
  geometric steps `s_{k+1} = s_k·(1+α)`, `s_0 = 0.5·res_finest`, `α = 0.01` (CPU) /
  `0.02` (GPU), out to `D_max = 300 km` or the end of coverage.
- DEM level used at step k: the finest available level with `res ≤ max(s_k·α, res_finest)`
  (clipmap rule); bilinear interpolation inside the level.
- Elevation of terrain sample at unit vector `u_t`, height `h` (exact on the sphere,
  cancellation-free): `c = |u_t − u_o|`, `Δv = (h − h_t − h_o) − (R + h)·c²/2`,
  `Δh = (R + h)·c·sqrt(1 − c²/4)`, `tan e = Δv/Δh`. `H(A) = max_k e_k` (≥ −90°).
- Straight rays in the projection deviate from great circles by < 0.1° in azimuth
  within 150 km of the pole — documented approximation.
- Also stored per azimuth: distance to the horizon-defining point `D(A)` and, when error
  tiles exist, `σ_H(A) = atan(σ_z(p*)/D(A))` (1-σ band on the sky plot).

## Visible disk fraction f ∈ [0, 1]

Visible area fraction of the body's disk above the horizon profile.
- **CPU (site metrics, sky plot)**: the disk (angular radius r, centre (az, el)) is split
  into 16 vertical slices; slice i at horizontal offset `δ_i` spans
  `el ± sqrt(r² − δ_i²)` and is compared with `H(az + δ_i / cos el)`; visible chord lengths
  are summed with weights `sqrt(r² − δ_i²)`-consistent area integration.
- **GPU (maps)**: straight-edge approximation with `z = (el − H(az))/r` clamped to [−1, 1]:
  `f = 1 − (acos z − z·sqrt(1 − z²))/π`.
- Light from a disk partially below the horizon is counted proportionally (power).

## Events and states

- Sun **up** ⇔ `f_sun > 0`. **Sunrise/sunset** = transitions of `f_sun` through 0, refined by
  bisection to 1 minute. "Time to sunset" = time from `t` to the next sunset (or
  "sunrise in …" if currently dark). Search horizon 60 days.
- Earth **visible for DTE** ⇔ `f_earth ≥ θ_DTE` (default θ_DTE = 0.5, configurable 0.05–1).
  **Earthrise/Earthset** = transitions through θ_DTE. "Time to Earthset" analogous.

## Interval metrics over [t0, t1] (uniform step Δt, default 10 min; 2 min for ≤ 2 days)

| metric | definition |
|---|---|
| `illumFrac` | mean of `f_sun` over samples (0–1) — "illumination %" |
| `sunlitHours` | `Σ f_sun·Δt` (hours of full-disk-equivalent sunlight) |
| `anySunHours` | `Σ [f_sun > 0]·Δt` |
| `longestDarkH` | longest run of consecutive samples with `f_sun < 0.05`, hours (a run touching an interval end is flagged `censored`) |
| `nSunsets` | number of sunsets in the interval |
| `earthFrac` | mean of `[f_earth ≥ θ_DTE]` — "Earth visibility %" |
| `dteWindows` | list of `[start, end]` with `f_earth ≥ θ_DTE` |
| `longestNoCommsH` | longest run with `f_earth < θ_DTE`, hours |
| `sunElStats` | min / mean / max of the Sun-centre elevation while `f_sun > 0` (deg) |
| `earthElStats` | min / mean / max of the Earth-centre elevation (deg) |
| `powerVertical` | mean of `f_sun·cos(el_sun)·(1 AU/|s|)²` — vertical panel that tracks Sun azimuth |
| `powerHorizontal` | mean of `f_sun·max(0, sin el_sun)·(1 AU/|s|)²` — flat panel |
| `powerRatio` | `powerVertical / max(powerHorizontal, 1e-6)` — why polar arrays are vertical |
| `shadowLen2m` | length of the shadow of a 2 m pole at the current Sun elevation = `2/tan(el)` m |

All percentages shown in the UI are these fractions ×100. Metrics are computed on demand
in a Web Worker (`apps/web/src/workers/site.worker.ts`).

## Antenna height for the Earth link (ADR-121)

Earth visibility (DTE share, comms gaps, Earthrise/Earthset, "Earth now") is evaluated from a
separate **antenna height** `h_a` above the site's terrain (UI 1–100 m, default 2 m = the observer
height); Sun metrics, the panorama and the map layers keep the observer height `h_o`.

Exact for any height without re-marching the DEM: for every ray sample the elevation seen from
height `h` is `tan e = (Z − h)/D` with `Z = h_k − h_t − (R + h_k)c²/2`, `D = (R + h_k)c√(1 − c²/4)`
(same geometry as H(A)), both independent of `h`. Hence

* horizon from `h`: `H_h(A) = atan max_k (Z_k − h)/D_k`;
* height needed to see elevation `e` along A: `max_k (Z_k − D_k tan e)` — the upper envelope of
  lines in `tan e`.

The march keeps only each azimuth's envelope lines over |e| ≤ 35° (typically tens of lines;
`apps/web/src/core/antenna.ts`). **Needed antenna height** at time t = lowest `h ∈ [1 m, 1 km]`
with `f_earth(h) ≥ DTE threshold` (sliced disk on `H_h`, log bisection to 0.1 %; visibility is
monotone in `h`). Reported over the interval at ≤ 1200 evenly spaced times: the series, its
distribution (share of the interval with a link vs height) and quantiles (50 / 90 / 100 %).
Above **1 km** the answer is "no link" — not an engineering option; it also covers the Earth being
below the astronomical horizon (libration), where no mast helps.
Check: share with a link at 2 m from the series = the DTE metric at 2 m (all 22 catalogue sites,
±1 % sampling).

## Libration

The Earth's topocentric (az, el) track over a month is a small loop (±~7° in longitude,
±~6.7° in latitude) because the ephemeris is in MOON_ME; exposed in the sky plot as the
"Earth wobble" trace with a plain-language tooltip.

## Suitability score (footprint L × L, L ∈ [5, 100] m)

Features per candidate square (box filters / summed-area tables on the analysis grid;
when the grid is coarser than L the UI warns "approximate at this zoom"):

| feature | definition |
|---|---|
| `slopeMax` | max slope (deg) of DEM cells inside the square (conservative p100) |
| `slopeMean` | mean slope inside the square |
| `relief` | max − min height inside the square (m) |
| `illum` | mean `illumFrac` over the square for the selected interval |
| `dark` | `longestDarkH` at the square centre |
| `earth` | mean `earthFrac` over the square |
| `psr` | 1 if the centre lies in a mapped PSR (> 1 km²) |

Hard constraints (fail ⇒ excluded, drawn transparent): `slopeMax > slopeLimit`
(default 10°, configurable 5–20°), no DEM data. Soft utilities in [0, 1]:

- `u_illum = clamp((illum − 0.2)/(0.9 − 0.2))`
- `u_dark = 1 − clamp(dark / darkRef)` (darkRef: 96 h lander, 240 h base)
- `u_earth = clamp(earth / 0.8)`
- `u_slope = 1 − clamp(slopeMean / slopeLimit)`
- `u_relief = 1 − clamp(relief / (0.2·L + 1 m))`

`score = Σ w_i·u_i / Σ w_i`. Presets (weights illum, dark, earth, slope, relief):

| preset | weights | slopeLimit | darkRef |
|---|---|---|---|
| `lander` — short mission (≤ 14 d) | 0.30, 0.30, 0.25, 0.10, 0.05 | 10° | 96 h |
| `base` — long-term base | 0.35, 0.30, 0.10, 0.10, 0.15 | 8° | 240 h |

**Confidence = robustness**, never a probability:
1. Data quality: mean LOLA 1-σ height error and shot count (where available) in the footprint.
2. Rank stability: Monte-Carlo (N = 200) with weights ~ Dirichlet(50·w) and DEM heights
   perturbed by N(0, σ_z) (horizon recomputed server-side) — share of draws in which the
   candidate stays in the top-k (k = 10). Client-side quick mode perturbs weights only.

No trained model is used. A future ML surrogate would have to be labelled as such.
