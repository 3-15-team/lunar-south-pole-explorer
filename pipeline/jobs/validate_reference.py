"""Our long-term Sun/Earth visibility vs the Mazarico et al. (PGDA) reference maps -> docs/VALIDATION.md.

    python -m pipeline.jobs.validate_reference [--points 150] [--hobs 0]

REFERENCE ONLY: AVGVISIB_85S_060M_201608(.TIF/_EARTH.TIF) = solar illumination averaged hourly over an
18.6-year lunar nutation cycle and Earth visibility ("visible if any part of its disc is not obscured"),
60 m/px, polar stereographic R = 1737.4 km (int16, scale 4e-5). We compute, at catalog sites and at random
points (rho <= 150 km), the mean visible solar-disk fraction and the share of time with any part of the
Earth visible over our ephemeris span 2026-2036 (2 h steps), from our own 1440-azimuth horizons.
"""

from __future__ import annotations

import argparse
import json
import math
import time

import numpy as np

from lunarcore import tiles as T
from lunarcore.ephemeris import Ephemeris, iso_utc
from lunarcore.geo import ll_to_xy, xy_to_ll
from lunarcore.horizon import site_horizon
from lunarcore.metrics import SiteModel

from ._common import RAW, WEB, WORK, log, now_iso, write_json
from .validation_doc import update_section

JOB = "pipeline/jobs/validate_reference.py"
SUN = RAW / "illum" / "AVGVISIB_85S_060M_201608.TIF"
EARTH = RAW / "illum" / "AVGVISIB_85S_060M_201608_EARTH.TIF"


class RefMap:
    def __init__(self, path):
        import rasterio

        with rasterio.open(path) as ds:
            self.a = ds.read(1).astype(np.float64)
            nod = ds.nodata
            scale = ds.scales[0] if ds.scales and ds.scales[0] not in (None, 1.0) else 4e-5
            self.t = ds.transform
        self.a[self.a == nod] = np.nan
        self.a *= scale

    def at(self, x: float, y: float) -> tuple[float, float, float]:
        """(value of the pixel containing x,y, min and max of its 3x3 neighbourhood)."""
        c = int(math.floor((x - self.t.c) / self.t.a))
        r = int(math.floor((y - self.t.f) / self.t.e))
        if not (1 <= r < self.a.shape[0] - 1 and 1 <= c < self.a.shape[1] - 1):
            return math.nan, math.nan, math.nan
        w = self.a[r - 1:r + 2, c - 1:c + 2]
        return float(self.a[r, c]), float(np.nanmin(w)), float(np.nanmax(w))


def ours(store, err, eph, x, y, hobs, times):
    hz = site_horizon(store, x, y, h_obs=hobs, naz=1440, err_store=None)
    lat, lon = xy_to_ll(x, y)
    m = SiteModel(eph, hz.elev_deg, float(lat), float(lon), hz.h_terrain, hobs)
    s = m.evaluate(times)
    return float(s.f_sun.mean()), float((s.f_earth > 0).mean()), hz


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--points", type=int, default=150)
    ap.add_argument("--hobs", type=float, default=0.0)
    ap.add_argument("--step-hours", type=float, default=2.0)
    a = ap.parse_args(argv)
    if not (SUN.exists() and EARTH.exists()):
        raise SystemExit("reference maps missing - python pipeline/jobs/download.py --only mazarico")
    eph = Ephemeris.load(WEB / "ephem")
    store = T.TileStore(WEB / "dem")
    sun_ref, earth_ref = RefMap(SUN), RefMap(EARTH)
    t0, t1 = eph.t0, eph.t_end
    n = int((t1 - t0) // (a.step_hours * 3600))
    times = t0 + a.step_hours * 3600 * np.arange(n)
    sites = json.loads((WEB / "sites.json").read_text())["sites"]
    rows = []
    t_start = time.time()
    for s in sites:
        if not s.get("inCoverage") or s["lat"] > -85.05:
            continue
        x, y = (float(v) for v in ll_to_xy(s["lat"], s["lon"]))
        rs, re_ = sun_ref.at(x, y), earth_ref.at(x, y)
        if not math.isfinite(rs[0]):
            continue
        fs, fe, hz = ours(store, None, eph, x, y, a.hobs, times)
        rows.append({"id": s["id"], "name": s["name"], "lat": s["lat"], "lon": s["lon"], "sun": fs, "sunRef": rs[0],
                     "sunRef3x3": [rs[1], rs[2]], "earth": fe, "earthRef": re_[0], "earthRef3x3": [re_[1], re_[2]],
                     "finestRes": T.res(hz.zfine)})
    rng = np.random.default_rng(42)
    pts = []
    while len(pts) < a.points:
        x, y = rng.uniform(-150e3, 150e3, 2)
        if math.hypot(x, y) <= 150e3:
            pts.append((float(x), float(y)))
    rnd = []
    for x, y in pts:
        rs, re_ = sun_ref.at(x, y), earth_ref.at(x, y)
        if not (math.isfinite(rs[0]) and math.isfinite(re_[0])):
            continue
        fs, fe, _ = ours(store, None, eph, x, y, a.hobs, times)
        rnd.append((fs, rs[0], fe, re_[0], rs[1], rs[2], re_[1], re_[2]))
    rnd = np.array(rnd)
    dt_run = time.time() - t_start

    def stats(o, r, lo, hi):
        d = o - r
        inside = np.mean((o >= lo - 0.02) & (o <= hi + 0.02))
        return {"n": int(o.size), "bias": float(d.mean()), "mad": float(np.median(np.abs(d))),
                "rms": float(np.sqrt(np.mean(d * d))), "r": float(np.corrcoef(o, r)[0, 1]),
                "within3x3Range": float(inside)}

    st_sun = stats(rnd[:, 0], rnd[:, 1], rnd[:, 4], rnd[:, 5])
    st_earth = stats(rnd[:, 2], rnd[:, 3], rnd[:, 6], rnd[:, 7])
    write_json(WORK / "validate_reference.json", {"generated": now_iso(), "sites": rows, "random": {
        "sun": st_sun, "earth": st_earth}, "hobs": a.hobs, "period": [iso_utc(t0), iso_utc(t1)], "runtimeS": dt_run})
    md = [f"_Generated {now_iso()} by `{JOB}`; reference = Mazarico et al. (2011) PGDA maps "
          "`AVGVISIB_85S_060M_201608` (Sun) and `..._EARTH`, used **only** as a sanity check._", "",
          f"Ours: own 1440-azimuth horizon from our tile pyramid (finest level at the point), observer height "
          f"{a.hobs:g} m, our ephemeris {iso_utc(t0)[:10]} – {iso_utc(t1)[:10]} at {a.step_hours:g} h steps; Sun = mean "
          "visible fraction of the solar disk (slice method); Earth = share of time with **any** part of the disk "
          "visible (the reference definition; our app's DTE metric uses ≥ 50 %). Reference: hourly average over an "
          "18.6-year nutation cycle, 60 m pixels (value of the pixel containing the point, and the min–max of its 3×3 "
          "neighbourhood).", "",
          "| site | lat, lon | Sun ours | Sun ref (3×3 range) | Earth ours | Earth ref (3×3 range) |",
          "|---|---|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r['name']} | {r['lat']:.3f}, {r['lon']:.3f} | {r['sun']:.3f} | {r['sunRef']:.3f} "
                  f"({r['sunRef3x3'][0]:.2f}–{r['sunRef3x3'][1]:.2f}) | {r['earth']:.3f} | {r['earthRef']:.3f} "
                  f"({r['earthRef3x3'][0]:.2f}–{r['earthRef3x3'][1]:.2f}) |")
    md += ["", f"Random points (n = {st_sun['n']}, uniform in ρ ≤ 150 km, seed 42):", "",
           "| quantity | bias (ours − ref) | median \\|Δ\\| | RMS | Pearson r | ours within ref 3×3 range ±0.02 |",
           "|---|---|---|---|---|---|"]
    for nm, st in (("Sun visibility", st_sun), ("Earth visibility (any part)", st_earth)):
        md.append(f"| {nm} | {st['bias']:+.3f} | {st['mad']:.3f} | {st['rms']:.3f} | {st['r']:.3f} | "
                  f"{100 * st['within3x3Range']:.0f} % |")
    big = [r for r in rows if abs(r["sun"] - r["sunRef"]) > 0.1 or abs(r["earth"] - r["earthRef"]) > 0.1]
    md += ["", "Mismatches > 0.10 at catalog sites: " + (", ".join(f"{r['name']} (Sun {r['sun'] - r['sunRef']:+.2f}, "
                                                                   f"Earth {r['earth'] - r['earthRef']:+.2f})"
                                                                   for r in big) if big else "none") + ".", "",
           "Likely causes of differences (none of them is a defect we could fix by tuning): (1) averaging period — "
           "11 years (2026–2036) vs a full 18.6-year cycle; (2) topography — LOLA 2023 (Barker et al.) 80/40/5 m "
           "products vs the 2016 maps used for the reference, and point-vs-60 m-pixel sampling on steep rims where "
           "illumination changes over tens of metres (see the 3×3 ranges); (3) horizon method — our clipmap ray "
           "march (1 % steps, mean pyramid) vs the reference horizon computation; (4) unknown reference observer "
           "height (we use 0 m here; the app defaults to 2 m)."]
    update_section("reference", "Long-term Sun/Earth visibility vs Mazarico et al. reference maps", "\n".join(md))
    log("validate_reference", f"sites {len(rows)}, random {st_sun['n']}: Sun bias {st_sun['bias']:+.3f} rms "
                              f"{st_sun['rms']:.3f} r {st_sun['r']:.3f}; Earth bias {st_earth['bias']:+.3f} rms "
                              f"{st_earth['rms']:.3f} r {st_earth['r']:.3f}; {dt_run:.0f} s")


if __name__ == "__main__":
    main()
