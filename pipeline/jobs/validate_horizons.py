"""Validate our table-based topocentric Sun/Earth az/el against JPL Horizons -> docs/VALIDATION.md.

    python -m pipeline.jobs.validate_horizons [--refresh]

Horizons API (https://ssd-api.jpl.nasa.gov/doc/horizons.html): observer table, CENTER='coord@301',
COORD_TYPE='GEODETIC', SITE_COORD='E-lon,lat,alt-km', QUANTITIES='4' (apparent azimuth/elevation),
APPARENT='AIRLESS', EXTRA_PREC='YES', TLIST of UT Julian dates. Requests are throttled (>= 1.2 s apart)
and cached in data/work/horizons/. Never called from the browser.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse
import urllib.request

import numpy as np

from lunarcore.ephemeris import Ephemeris, parse_utc, topocentric

from ._common import WEB, WORK, log, now_iso, write_json
from .validation_doc import update_section

JOB = "pipeline/jobs/validate_horizons.py"
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE = WORK / "horizons"
SITES = [  # name, lat, lon (E), altitude above R (km) ~ terrain height + 2 m
    ("Connecting ridge", -89.463, -137.490, 1.945),
    ("Shackleton rim", -89.767, -171.870, 0.772),
    ("de Gerlache rim", -88.683, -67.932, 1.796),
    ("Malapert massif", -85.995, -0.236, 4.787),
    ("Nobile rim 1", -85.438, 37.367, 5.949),
    ("IM-1 Odysseus", -80.13, 1.44, 2.594),
]
EPOCHS = ["2026-01-15T06:00:00Z", "2026-12-06T12:07:30Z", "2027-06-15T03:33:00Z", "2029-02-28T18:45:00Z",
          "2031-09-09T09:09:00Z", "2034-04-01T00:00:00Z", "2036-12-31T23:00:00Z"]
BODIES = {"sun": "10", "earth": "399"}


def jd_utc(t_unix: float) -> float:
    return t_unix / 86400.0 + 2440587.5


def query(body: str, lat: float, lon: float, alt_km: float, epochs: list[str]) -> dict:
    params = {
        "format": "json", "COMMAND": f"'{BODIES[body]}'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon:.6f},{lat:.6f},{alt_km:.4f}'",
        "TLIST": " ".join(f"'{jd_utc(parse_utc(e)):.9f}'" for e in epochs), "TLIST_TYPE": "'JD'",
        "TIME_TYPE": "'UT'", "QUANTITIES": "'4'", "ANG_FORMAT": "'DEG'", "APPARENT": "'AIRLESS'",
        "EXTRA_PREC": "'YES'", "CSV_FORMAT": "'YES'",
    }
    url = API + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-site-explorer-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def parse_result(text: str) -> tuple[list[tuple[float, float]], dict]:
    lines = text.splitlines()
    i0 = next(i for i, ln in enumerate(lines) if ln.strip() == "$$SOE")
    i1 = next(i for i, ln in enumerate(lines) if ln.strip() == "$$EOE")
    rows = []
    for ln in lines[i0 + 1:i1]:
        cols = [c.strip() for c in ln.split(",")]
        nums = [c for c in cols[1:] if c not in ("", "*", "C", "N", "A", "m", "r", "e", "t", "s")]
        rows.append((float(nums[-2]), float(nums[-1])))
    meta = {}
    for ln in lines[:i0]:
        for key in ("Center body name", "Center-site name", "Center geodetic", "Center cylindric", "Center pole/equ",
                    "Center radii", "Target body name", "Reference frame", "Atmos refraction", "RA format",
                    "Time format"):
            if ln.strip().startswith(key):
                meta[key] = ln.split(":", 1)[1].strip()
    return rows, meta


def sep_deg(az1, el1, az2, el2):
    """Great-circle separation on the sky between two (az, el) directions (deg)."""
    a1, e1, a2, e2 = map(np.radians, (az1, el1, az2, el2))
    h = np.sin((e2 - e1) / 2) ** 2 + np.cos(e1) * np.cos(e2) * np.sin((a2 - a1) / 2) ** 2
    return np.degrees(2 * np.arcsin(np.sqrt(np.clip(h, 0, 1))))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-query Horizons even when cached")
    a = ap.parse_args(argv)
    eph = Ephemeris.load(WEB / "ephem")
    CACHE.mkdir(parents=True, exist_ok=True)
    t_unix = np.array([parse_utc(e) for e in EPOCHS])
    S, E = eph.vectors(t_unix)
    rows_out = []
    meta_any = {}
    last = 0.0
    for name, lat, lon, alt in SITES:
        tp = topocentric(S, E, lat, lon, alt * 1000.0, 0.0)
        for body in ("sun", "earth"):
            cp = CACHE / f"{name.replace(' ', '_')}_{body}.json"
            if cp.exists() and not a.refresh:
                res = json.loads(cp.read_text())
            else:
                wait = 1.2 - (time.time() - last)
                if wait > 0:
                    time.sleep(wait)
                res = query(body, lat, lon, alt, EPOCHS)
                last = time.time()
                cp.write_text(json.dumps(res))
            hz, meta = parse_result(res["result"])
            meta_any.update({k: v for k, v in meta.items() if k not in meta_any})
            ours_az = tp.sun_az if body == "sun" else tp.earth_az
            ours_el = tp.sun_el if body == "sun" else tp.earth_el
            for k, (haz, hel) in enumerate(hz):
                daz = ((ours_az[k] - haz + 180.0) % 360.0) - 180.0
                rows_out.append({"site": name, "body": body, "utc": EPOCHS[k], "hzAz": haz, "hzEl": hel,
                                 "az": float(ours_az[k]), "el": float(ours_el[k]),
                                 "dAzCosElArcsec": float(daz * math.cos(math.radians(hel)) * 3600),
                                 "dElArcsec": float((ours_el[k] - hel) * 3600),
                                 "sepArcsec": float(sep_deg(ours_az[k], ours_el[k], haz, hel) * 3600)})
    summary = {}
    for body in ("sun", "earth"):
        rr = [r for r in rows_out if r["body"] == body]
        sep = np.array([r["sepArcsec"] for r in rr])
        de = np.array([abs(r["dElArcsec"]) for r in rr])
        da = np.array([abs(r["dAzCosElArcsec"]) for r in rr])
        summary[body] = {"n": len(rr), "maxSepArcsec": float(sep.max()), "meanSepArcsec": float(sep.mean()),
                         "maxDElArcsec": float(de.max()), "meanDElArcsec": float(de.mean()),
                         "maxDAzCosElArcsec": float(da.max())}
    write_json(WORK / "validate_horizons.json", {"generated": now_iso(), "summary": summary, "horizonsMeta": meta_any,
                                                 "rows": rows_out})
    check = WORK / "ephem_check.json"
    ec = json.loads(check.read_text()) if check.exists() else None
    md = [f"_Generated {now_iso()} by `{JOB}` (cached responses in `data/work/horizons/`)._", ""]
    md += [f"{len(SITES)} polar sites × {len(EPOCHS)} epochs (2026–2036) × Sun and Earth = {len(rows_out)} comparisons of "
           "our topocentric apparent azimuth/elevation (float32 tables, linear interpolation, site vector subtracted, "
           "local ENU) with JPL Horizons (`CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `QUANTITIES='4'`, "
           "`APPARENT='AIRLESS'`, `EXTRA_PREC='YES'`). Separation = great-circle angle between the two directions.", ""]
    md += ["| body | n | max sep (″) | mean sep (″) | max \\|Δel\\| (″) | max \\|Δaz·cos el\\| (″) |",
           "|---|---|---|---|---|---|"]
    for body, s in summary.items():
        md.append(f"| {body} | {s['n']} | {s['maxSepArcsec']:.3f} | {s['meanSepArcsec']:.3f} | {s['maxDElArcsec']:.3f} "
                  f"| {s['maxDAzCosElArcsec']:.3f} |")
    md += ["", "Horizons header (what Horizons uses for the observer frame):", ""]
    for k in ("Center body name", "Center-site name", "Center pole/equ", "Center radii", "Reference frame",
              "Atmos refraction"):
        if k in meta_any:
            md.append(f"- `{k}`: {meta_any[k]}")
    md += ["", "Ours: kernels `naif0012.tls`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf` "
           "(`MOON_ME` = `MOON_ME_DE440_ME421`), `spkpos(..., 'MOON_ME', 'LT+S', 'MOON')` from the Moon centre, then "
           "`s = S − P` with `P = (R + h)·u(lat, lon)`, R = 1737.4 km. Horizons additionally applies light-time and "
           "aberration from the site itself and gravitational deflection (all ≪ 0.1″ here).", ""]
    if ec:
        md += [f"Table interpolation (direct SPICE at every 3rd mid-sample 2026–2036 vs linear interpolation of the "
               f"float32 records): Sun max {ec['sun']['maxArcsec']:.3f}″ (mean {ec['sun']['meanArcsec']:.3f}″), "
               f"Earth max {ec['earth']['maxArcsec']:.3f}″ (mean {ec['earth']['meanArcsec']:.3f}″); float32 "
               f"quantisation at the nodes ≤ {max(ec['sun']['float32NodeMaxArcsec'], ec['earth']['float32NodeMaxArcsec']):.3f}″.",
               ""]
    worst = sorted(rows_out, key=lambda r: -r["sepArcsec"])[:5]
    md += ["Largest five differences:", "", "| site | body | UTC | Horizons az/el (°) | ours az/el (°) | sep (″) |",
           "|---|---|---|---|---|---|"]
    for r in worst:
        md.append(f"| {r['site']} | {r['body']} | {r['utc']} | {r['hzAz']:.6f} / {r['hzEl']:.6f} | "
                  f"{r['az']:.6f} / {r['el']:.6f} | {r['sepArcsec']:.3f} |")
    update_section("horizons", "Ephemeris vs JPL Horizons", "\n".join(md))
    for body, s in summary.items():
        log("validate_horizons", f"{body}: max sep {s['maxSepArcsec']:.3f}\" mean {s['meanSepArcsec']:.3f}\" "
                                 f"(n={s['n']})")
    log("validate_horizons", f"Horizons frame: {meta_any.get('Center pole/equ', '?')}")


if __name__ == "__main__":
    main()
