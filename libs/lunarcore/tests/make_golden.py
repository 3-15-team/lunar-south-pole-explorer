"""Regenerate the golden vectors shared with the TypeScript twin.

    python libs/lunarcore/tests/make_golden.py

Expected values come from closed forms (geo, disk straight edge), dense sampling of analytic terrains
(horizon), the reference implementation of the definitions (metrics, disk slices) and the ephemeris
tables in data/web/ephem (topo; skipped when absent). See golden/README.md.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from lunarcore import disk, geo, metrics, synthetic
from lunarcore.ephemeris import Ephemeris, default_root, parse_utc, topocentric

OUT = Path(__file__).resolve().parent / "golden"


def r(v, n=12):
    return [round(float(a), n) for a in np.ravel(v)]


def make_geo() -> dict:
    pts = [(-90.0, 0.0), (-89.5, 0.0), (-89.5, 90.0), (-89.45, -137.3), (-88.8, 123.4), (-87.0, 179.0),
           (-86.0, -0.3), (-85.0, 45.0), (-84.79, 29.2), (-80.0, -120.0), (-80.13, 1.44), (-83.6, -68.8)]
    cases = []
    for lat, lon in pts:
        x, y = geo.ll_to_xy(lat, lon)
        u = geo.ll_to_unit(lat, lon)
        assert np.allclose(u, geo.xy_to_unit(x, y), atol=1e-14)
        e, n, up = geo.enu_basis(lat, lon)
        cases.append({"lat": lat, "lon": lon, "x": round(float(x), 6), "y": round(float(y), 6),
                      "u": r(u, 15), "east": r(e, 15), "north": r(n, 15), "up": r(up, 15)})
    return {"R": geo.R_MOON, "cases": cases}


def make_disk() -> dict:
    zs = [-1.2, -1.0, -0.999, -0.9, -0.75, -0.5, -0.25, -0.1, 0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1.0, 1.2]
    cases = [{"z": z, "f": round(disk.fraction_flat(z), 12)} for z in zs]
    # slice-method cases on explicit 360-bin profiles (pins the CPU method, ADR-101)
    az = np.arange(360, dtype=np.float64)
    profiles = {
        "step-1deg-at-180": np.where(az < 180, 1.0, 0.0),
        "sine-0.3": 0.3 * np.sin(np.radians(3 * az)),
        "flat-0.1": np.full(360, 0.1),
    }
    slice_cases = []
    for name, prof in profiles.items():
        for body_az, el, rad in ((180.0, 0.5, 0.2666), (179.8, 0.2, 0.2666), (35.0, 0.15, 0.9505),
                                 (300.0, -0.1, 0.2700), (90.0, 0.33, 0.2666)):
            f = disk.fraction_slices(prof, body_az, el, rad)
            slice_cases.append({"profile": name, "azDeg": body_az, "elDeg": el, "radiusDeg": rad, "f": round(float(f), 12)})
    return {"cases": cases, "sliceProfiles": {k: r(v, 9) for k, v in profiles.items()}, "sliceCases": slice_cases,
            "nslices": disk.NSLICES}


def make_horizon() -> dict:
    xo, yo = 10000.0, 20000.0
    cases = []

    def add(name, spec, x, y, h_obs, azs, tol, finest_res=20.0):
        fn = synthetic.dem_function(spec)
        ht = float(fn(np.array(x), np.array(y)))
        exp = []
        for a in azs:
            e, d = synthetic.ray_max_elevation(spec, x, y, ht, h_obs, a)
            exp.append({"azDeg": round(a, 6), "elDeg": round(e, 6), "tolDeg": tol, "distM": round(d, 1)})
        cases.append({"name": name, "dem": spec, "observer": {"x": x, "y": y, "hTerrain": round(ht, 6), "hObs": h_obs},
                      "finestRes": finest_res, "alpha": 0.01, "dmaxM": 300000.0, "expect": exp})

    lam = math.degrees(math.atan2(xo, yo))
    up = (90.0 - lam) % 360.0  # azimuth of grid +x from (xo, yo)
    add("flat-h2", {"type": "flat", "h": 0.0}, xo, yo, 2.0, [0.0, 90.0, 180.0, 270.0, up], 0.002)
    add("flat-h10", {"type": "flat", "h": 1500.0}, xo, yo, 10.0, [0.0, 123.0, 250.0], 0.002)
    add("flat-pole", {"type": "flat", "h": 0.0}, 0.0, 0.0, 2.0, [0.0, 45.0, 180.0, 315.0], 0.002)
    add("ramp-0.1", {"type": "ramp", "h0": -0.1 * xo, "gx": 0.1, "gy": 0.0}, xo, yo, 2.0,
        [up, (up + 90.0) % 360.0, (up + 270.0) % 360.0], 0.01)
    add("ramp-diag-0.05", {"type": "ramp", "h0": -(0.03 * xo + 0.04 * yo), "gx": 0.03, "gy": 0.04}, xo, yo, 2.0,
        [synthetic.azimuth_towards(xo, yo, xo + 0.6, yo + 0.8)], 0.01)
    g = {"type": "gauss", "base": 0.0, "h0": 2000.0, "sigma": 3000.0, "xc": xo + 30000.0, "yc": yo}
    add("gauss-30km", g, xo, yo, 2.0, [synthetic.azimuth_towards(xo, yo, g["xc"], g["yc"]), (up + 180.0) % 360.0], 0.02)
    g2 = {"type": "gauss", "base": 0.0, "h0": 5000.0, "sigma": 8000.0, "xc": -60000.0, "yc": 90000.0}
    add("gauss-far-massif", g2, xo, yo, 2.0, [synthetic.azimuth_towards(xo, yo, g2["xc"], g2["yc"])], 0.02)
    return {"cases": cases}


def make_metrics() -> dict:
    raw = [
        ("sunset-crossing", 1.0, [1, 1, 1, 0.6, 0.2, 0, 0, 0, 0, 0.3, 1, 1],
         [1, 1, 0.6, 0.5, 0.49, 0.2, 0, 0, 0.5, 0.7, 1, 1], 0.5),
        ("censored-dark-both-ends", 0.5, [0, 0, 0, 0.5, 1, 0.04, 0.01, 0], [0, 0, 1, 1, 1, 1, 0, 0], 0.5),
        ("always-lit-no-earth", 2.0, [1.0] * 6, [0.0] * 6, 0.5),
        ("thresholds-exact", 0.25, [0.05, 0.05, 0.0, 0.0, 0.049, 0.05], [0.5, 0.499, 0.5, 0.2, 0.2, 0.2], 0.5),
        ("dte-0.9", 1.0, [0.5, 0.0, 0.5, 0.0, 0.5], [0.95, 0.9, 0.89, 1.0, 0.0], 0.9),
    ]
    cases = []
    for name, dt, fs, fe, dte in raw:
        m = metrics.interval_metrics(dt, fs, fe, dte)
        cases.append({"name": name, "dtHours": dt, "fSun": fs, "fEarth": fe, "dte": dte,
                      "expect": {k: m[k] for k in ("illumFrac", "sunlitHours", "anySunHours", "longestDarkH",
                                                   "longestDarkCensored", "nSunsets", "nSunrises", "earthFrac",
                                                   "longestNoCommsH", "longestNoCommsCensored")}})
    return {"darkThreshold": metrics.DARK_F, "cases": cases}


def make_topo() -> dict | None:
    root = default_root()
    if not (root / "index.json").exists():
        return None
    eph = Ephemeris.load(root)
    sites = [(-89.45, -137.3, 1956.0), (-85.44, 37.37, 6000.0), (-86.0, 0.3, 4500.0), (-80.13, 1.44, 2581.0),
             (-88.8, 123.4, 1500.0), (-89.99, 0.0, 1300.0)]
    times = ["2026-01-01T00:00:00Z", "2026-12-06T12:07:30Z", "2027-06-15T03:33:00Z", "2030-03-20T00:00:00Z",
             "2036-12-31T23:00:00Z"]
    cases = []
    for lat, lon, h in sites:
        for ts in times:
            S, E = eph.vectors(parse_utc(ts))
            tp = topocentric(S, E, lat, lon, h, 0.0)
            cases.append({"lat": lat, "lon": lon, "hM": h, "utc": ts,
                          "sun": {"azDeg": round(float(tp.sun_az), 9), "elDeg": round(float(tp.sun_el), 9),
                                  "radiusDeg": round(float(tp.sun_radius), 9), "distKm": round(float(tp.sun_dist_km), 3)},
                          "earth": {"azDeg": round(float(tp.earth_az), 9), "elDeg": round(float(tp.earth_el), 9),
                                    "radiusDeg": round(float(tp.earth_radius), 9),
                                    "distKm": round(float(tp.earth_dist_km), 3)}})
    return {"ephemeris": "data/web/ephem (float32 tables, linear interpolation)", "tolDeg": 1e-6, "cases": cases}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in (("geo", make_geo), ("disk", make_disk), ("horizon", make_horizon), ("metrics", make_metrics),
                     ("topo", make_topo)):
        obj = fn()
        if obj is None:
            print(f"skip {name} (no ephemeris tables)")
            continue
        (OUT / f"{name}.json").write_text(json.dumps(obj, indent=1) + "\n")
        print(f"wrote golden/{name}.json ({len(obj['cases'])} cases)")


if __name__ == "__main__":
    main()
