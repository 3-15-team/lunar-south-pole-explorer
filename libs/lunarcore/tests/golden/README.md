# Golden vectors (shared by pytest and the TypeScript vitest suite)

Regenerate with `python libs/lunarcore/tests/make_golden.py` (`topo.json` needs `data/web/ephem`).
Units: metres, degrees, hours; azimuth clockwise from local North in [0, 360); longitudes east-positive.
R = 1737400 m. Definitions: `docs/DATA.md` §1 and `docs/METRICS.md`.

## geo.json
`{"R", "cases": [{"lat", "lon", "x", "y", "u":[3], "east":[3], "north":[3], "up":[3]}]}`
- `x, y`: LUNAR:SPS metres (`x = rho sin lon`, `y = rho cos lon`, `rho = 2R tan((90°+lat)/2)`).
- `u`: MOON_ME unit vector; the trig-free form from (x, y) must match to 1e-12.
- `east/north/up`: local ENU basis in MOON_ME. At the pole (x = y = 0) lon = atan2(0, 0) = 0.
- Suggested tolerance: 1e-5 m for x/y, 1e-12 for vectors.

## disk.json
- `cases: [{"z", "f"}]`: straight-edge visible fraction `f = 1 - (acos z - z sqrt(1 - z²))/pi`,
  `z = (el - H)/r` clamped to [-1, 1] (|z| > 1 cases test the clamp). Tolerance 1e-10.
- `sliceCases` + `sliceProfiles` + `nslices` (= 16): CPU slice method on explicit profiles of 360 bins
  (bin k at azimuth k°; the profile is interpolated linearly and periodically). Fields:
  `{"profile", "azDeg", "elDeg", "radiusDeg", "f"}`; tolerance 1e-9.
  **Slice method (ADR-101):** 16 equal-width vertical slices `[a_i, a_i + w]`, `w = 2r/16`,
  `a_i = -r + i w`; slice centre offset `d_i = a_i + w/2`; horizon for the slice
  `H_i = H(az + d_i / cos(el))`; visible area of the slice above the line `y = H_i - el` (disk centred at
  the origin, radius r) is integrated exactly with `G(x) = (x sqrt(r²-x²) + r² asin(x/r))/2`:
  for `y0 = H_i - el`: if `y0 >= r` -> 0; if `y0 <= -r` -> `2(G(b)-G(a))`; else with `w0 = sqrt(r²-y0²)`:
  `(G(hi)-G(lo)) - y0 (hi-lo)` on `[lo,hi] = [a,b] ∩ [-w0,w0]`, plus (only if `y0 < 0`) `2(G(.)-G(.))` on
  the parts of `[a,b]` outside `[-w0, w0]`. `f = Σ area_i / (pi r²)`, clamped to [0, 1].
  For a flat horizon this equals the straight-edge formula to machine precision.

## horizon.json
`{"cases": [{"name", "dem", "observer": {"x","y","hTerrain","hObs"}, "finestRes", "alpha", "dmaxM",
"expect": [{"azDeg", "elDeg", "tolDeg", "distM"}]}]}`
- `dem` is analytic (heights in m above R as a function of SPS x, y):
  - `{"type":"flat","h"}` -> `h`;
  - `{"type":"ramp","h0","gx","gy"}` -> `h0 + gx x + gy y`;
  - `{"type":"gauss","base","h0","sigma","xc","yc"}` -> `base + h0 exp(-((x-xc)²+(y-yc)²)/(2 sigma²))`.
- Rebuild the DEM by point-sampling the function at the pixel centres of the LPS-2560 tiles a clipmap
  march touches (`finestRes` = resolution of the finest level at the observer, i.e. `s0 = finestRes/2`),
  then march the single azimuth `azDeg` (grid direction `(sin(lon+A), cos(lon+A))`, `lon = atan2(x, y)`).
- `elDeg` is the reference maximum from dense sampling (0.25 m steps to 10 km, 2 m beyond) of the exact
  elevation formula along the straight grid ray of the analytic surface — independent of tiles and of
  the geometric step rule; `distM` is the grid distance of that maximum (informative only).
- Flat cases: `elDeg = -acos(R/(R + h_obs))` (dip of the horizon; -0.0869° for 2 m).
- Tolerances: 0.002° (flat), 0.01° (ramps), 0.02° (Gaussian peaks; covers clipmap smoothing).

## metrics.json
`{"darkThreshold": 0.05, "cases": [{"name", "dtHours", "fSun":[...], "fEarth":[...], "dte",
"expect": {"illumFrac", "sunlitHours", "anySunHours", "longestDarkH", "longestDarkCensored", "nSunsets",
"nSunrises", "earthFrac", "longestNoCommsH", "longestNoCommsCensored"}}]}`
- Each sample stands for `dtHours`; a run of n samples lasts `n * dtHours`.
- Sun up ⇔ `fSun > 0`; dark ⇔ `fSun < 0.05`; Earth visible (DTE) ⇔ `fEarth >= dte`.
- `nSunsets` = number of k with `up[k] && !up[k+1]` (`nSunrises` the reverse).
- Longest runs: ties pick the earliest run; `censored` = the run touches the first or last sample.
- Tolerance 1e-12 (exact arithmetic).

## topo.json
`{"ephemeris", "tolDeg": 1e-6, "cases": [{"lat", "lon", "hM", "utc", "sun": {"azDeg","elDeg","radiusDeg",
"distKm"}, "earth": {...}}]}`
- Uses the shipped tables `data/web/ephem/*.bin` with linear interpolation between records.
- `hM` = observer height above the reference sphere (terrain + mast), so
  `P = (R + hM)/1000 * u(lat, lon)` km; `s = S - P`, `e = E - P`; `radiusDeg = asin(695700/|s|)`
  (Sun) and `asin(6371.0084/|e|)` (Earth).
- Tolerance 1e-6° (angles), 1e-8° (radii).
