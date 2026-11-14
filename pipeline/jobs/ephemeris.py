"""Sun/Earth ephemeris tables in MOON_ME -> data/web/ephem/{YYYY}.bin + index.json (docs/DATA.md §3).

    python -m pipeline.jobs.ephemeris [--years 2026 2036] [--force]

spkpos(target, et, "MOON_ME", "LT+S", "MOON") for SUN and EARTH on a uniform UTC grid (1800 s),
float32-le records [sunX, sunY, sunZ, earthX, earthY, earthZ] (km). Also measures the linear
interpolation error at mid-samples against direct SPICE and stores it in data/work/ephem_check.json.
"""

from __future__ import annotations

import argparse
import time

import numpy as np

from lunarcore.ephemeris import STEP_SECONDS, iso_utc, records_in_year, year_start_unix

from ._common import RAW, WEB, WORK, log, now_iso, record_tree, sha256_file, write_json

JOB = "pipeline/jobs/ephemeris.py"
KERNELS = ["naif0012.tls", "pck00011.tpc", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf", "de440s.bsp"]
FRAME = "MOON_ME"
ABCORR = "LT+S"


def furnsh_all():
    import spiceypy as sp

    sp.kclear()
    for k in KERNELS:
        p = RAW / "naif" / k
        if not p.exists():
            raise SystemExit(f"missing kernel {p} - run: python pipeline/jobs/download.py --tier 0")
        sp.furnsh(str(p))
    return sp


def utc_to_et(sp, t_unix: np.ndarray) -> np.ndarray:
    strs = [time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(int(t))) + f".{int(round((t % 1) * 1e6)):06d}"
            for t in t_unix]
    return np.asarray(sp.str2et(strs), dtype=np.float64)


def positions(sp, et: np.ndarray, target: str) -> np.ndarray:
    pos, _lt = sp.spkpos(target, et, FRAME, ABCORR, "MOON")
    return np.asarray(pos, dtype=np.float64)


def angle_arcsec(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Angle between row vectors (robust atan2 form), arcsec."""
    cross = np.linalg.norm(np.cross(a, b), axis=1)
    dot = np.sum(a * b, axis=1)
    return np.degrees(np.arctan2(cross, dot)) * 3600.0


def interpolation_check(sp, years: list[int], tables: dict[int, np.ndarray], every: int = 3) -> dict:
    """Direct SPICE at t_k + 900 s vs linear interpolation of the float32 records."""
    out = {}
    errs = {"sun": [], "earth": []}
    rel = {"sun": [], "earth": []}
    node_err = {"sun": [], "earth": []}
    for y in years:
        rec = tables[y].astype(np.float64)
        k = np.arange(0, rec.shape[0] - 1, every)
        t_mid = year_start_unix(y) + (k + 0.5) * STEP_SECONDS
        et = utc_to_et(sp, t_mid)
        interp = 0.5 * (rec[k] + rec[k + 1])
        for name, sl, target in (("sun", slice(0, 3), "SUN"), ("earth", slice(3, 6), "EARTH")):
            direct = positions(sp, et, target)
            errs[name].append(angle_arcsec(direct, interp[:, sl]))
            rel[name].append(np.abs(np.linalg.norm(interp[:, sl], axis=1) / np.linalg.norm(direct, axis=1) - 1))
        # float32 quantisation at the nodes (first 2000 records of the year)
        kk = np.arange(0, min(2000, rec.shape[0]))
        et_n = utc_to_et(sp, year_start_unix(y) + kk * STEP_SECONDS)
        for name, sl, target in (("sun", slice(0, 3), "SUN"), ("earth", slice(3, 6), "EARTH")):
            node_err[name].append(angle_arcsec(positions(sp, et_n, target), rec[kk][:, sl]))
    for name in ("sun", "earth"):
        e = np.concatenate(errs[name])
        r = np.concatenate(rel[name])
        q = np.concatenate(node_err[name])
        out[name] = {"midSamples": int(e.size), "maxArcsec": float(e.max()), "meanArcsec": float(e.mean()),
                     "p99Arcsec": float(np.percentile(e, 99)), "maxRelDistErr": float(r.max()),
                     "float32NodeMaxArcsec": float(q.max())}
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--years", nargs=2, type=int, default=[2026, 2036])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--check-every", type=int, default=3, help="check every n-th mid-sample (1 = all)")
    a = ap.parse_args(argv)
    t_start = time.time()
    sp = furnsh_all()
    out_dir = WEB / "ephem"
    out_dir.mkdir(parents=True, exist_ok=True)
    years = list(range(a.years[0], a.years[1] + 1))
    tables: dict[int, np.ndarray] = {}
    entries = []
    for y in years:
        n = records_in_year(y)
        path = out_dir / f"{y}.bin"
        if path.exists() and path.stat().st_size == n * 24 and not a.force:
            tables[y] = np.fromfile(path, dtype="<f4").reshape(n, 6)
            log("ephemeris", f"{y}: exists ({n} records)")
        else:
            t = year_start_unix(y) + np.arange(n, dtype=np.float64) * STEP_SECONDS
            et = utc_to_et(sp, t)
            rec = np.hstack([positions(sp, et, "SUN"), positions(sp, et, "EARTH")]).astype("<f4")
            tmp = path.with_suffix(".tmp")
            rec.tofile(tmp)
            tmp.replace(path)
            tables[y] = rec
            log("ephemeris", f"{y}: wrote {n} records")
        entries.append({"year": y, "url": f"{y}.bin", "records": n, "sha256": sha256_file(path)})
    sun_r = float(sp.bodvrd("SUN", "RADII", 3)[1][0])
    earth_r = float(np.mean(sp.bodvrd("EARTH", "RADII", 3)[1]))
    log("ephemeris", f"radii from pck00011: Sun {sun_r} km, Earth (mean of 3 axes) {earth_r:.4f} km")
    index = {
        "version": 1, "frame": FRAME, "frameRealization": "MOON_ME_DE440_ME421",
        "observer": "MOON (301) centre", "aberration": ABCORR, "units": "km", "stepSeconds": STEP_SECONDS,
        "record": ["sunX", "sunY", "sunZ", "earthX", "earthY", "earthZ"], "dtype": "float32-le",
        "startUtc": iso_utc(year_start_unix(years[0])), "endUtc": iso_utc(year_start_unix(years[-1] + 1)),
        "years": entries, "kernels": KERNELS, "sunRadiusKm": 695700.0, "earthRadiusKm": 6371.0084,
        "generated": now_iso(), "job": JOB,
    }
    write_json(out_dir / "index.json", index)
    log("ephemeris", "checking linear interpolation at mid-samples against direct SPICE ...")
    check = interpolation_check(sp, years, tables, every=a.check_every)
    check["generated"] = now_iso()
    write_json(WORK / "ephem_check.json", check)
    for k in ("sun", "earth"):
        c = check[k]
        log("ephemeris", f"{k}: interp max {c['maxArcsec']:.4f}\" mean {c['meanArcsec']:.4f}\" "
                         f"(n={c['midSamples']}), float32 node max {c['float32NodeMaxArcsec']:.4f}\"")
    record_tree("ephem", out_dir, JOB)
    log("ephemeris", f"done in {time.time() - t_start:.1f} s -> {out_dir}")


if __name__ == "__main__":
    main()
