"""Region horizon map + footprint features (server-side work products, docs/DATA.md §7).

    python -m pipeline.jobs.horizon_maps [--res 240] [--extent 200160] [--naz 64] [--alpha 0.01] [--zmax 6]
                                         [--block 24] [--force] [--bench]

* ``data/work/horizon_{res}m.npy``: uint8[ny][nx][naz], elevation e = -5 + 0.1 v (v = 255: >= 20.45 deg or
  outside), azimuth k*360/naz clockwise from local North, observer 2 m above the terrain, cells with
  rho <= extent; ``.json`` sidecar with the grid; ``horizon_{res}m_hterr.npy`` terrain heights.
  Resumable: finished row blocks are recorded in ``horizon_{res}m.progress.json``.
* ``data/work/features_{res}m.npz``: slopeMax/slopeMean/relief for footprint boxes of 1 and 3 DEM cells
  (finest global DEM: 40 m if present else 80 m), terrain height and the PSR mask, on the same grid.
"""

from __future__ import annotations

import argparse
import json
import math
import time

import numpy as np

from lunarcore import horizon as H
from lunarcore import suitability as S
from lunarcore import tiles as T
from lunarcore.geo import R_MOON, scale_factor

from ._common import WEB, WORK, log, now_iso, record_product, write_json

JOB = "pipeline/jobs/horizon_maps.py"


def grid(res: float, extent: float) -> tuple[np.ndarray, np.ndarray]:
    n = int(round(2 * extent / res))
    c = -extent + (np.arange(n) + 0.5) * res
    return c.copy(), c[::-1].copy()  # xs ascending (columns), ys descending (rows, top first)


def load_pyramid(zmax: int):
    store = T.TileStore(WEB / "dem")
    if not store.exists:
        raise SystemExit("no DEM tiles - run: python -m pipeline.jobs.dem_tiles")
    levels = [z for z in store.levels() if z <= zmax]
    t0 = time.time()
    pyr = store.pyramid_all(zmax=max(levels))
    log("horizon_maps", f"pyramid z{min(levels)}-z{max(levels)}: {pyr.ntiles} tiles loaded in {time.time() - t0:.1f} s")
    return pyr, max(levels)


def compute_features(xs: np.ndarray, ys: np.ndarray, res: float, out_path) -> dict:
    """Footprint features from the finest global DEM mosaic, sampled at the analysis cell centres."""
    from .dem_tiles import MOSAIC

    z = 6 if (MOSAIC / "dem_z6.npy").exists() else 5
    dem = np.load(MOSAIC / f"dem_z{z}.npy", mmap_mode="r")
    r = T.res(z)
    # DEM pixel index nearest to each analysis cell centre
    jj = np.clip(np.round((xs - T.X0) / r - 0.5).astype(int), 0, dem.shape[1] - 1)
    ii = np.clip(np.round((T.Y0 - ys) / r - 0.5).astype(int), 0, dem.shape[0] - 1)
    out = {f"{k}_{nb}": np.full((ys.size, xs.size), np.nan, np.float32)
           for k in ("slopeMax", "slopeMean", "relief") for nb in (1, 3)}
    out["height"] = np.full((ys.size, xs.size), np.nan, np.float32)
    strip = 256  # analysis rows per strip
    for a0 in range(0, ys.size, strip):
        a1 = min(ys.size, a0 + strip)
        r0 = max(0, ii[a0:a1].min() - 4)
        r1 = min(dem.shape[0], ii[a0:a1].max() + 5)
        c0 = max(0, jj.min() - 4)
        c1 = min(dem.shape[1], jj.max() + 5)
        sub = np.asarray(dem[r0:r1, c0:c1], dtype=np.float64)
        X = T.X0 + (np.arange(c0, c1) + 0.5) * r
        Y = T.Y0 - (np.arange(r0, r1) + 0.5) * r
        k = scale_factor(X[None, :], Y[:, None])
        sl = S.slope_deg(sub, r, k)
        rows = ii[a0:a1] - r0
        cols = jj - c0
        out["height"][a0:a1] = sub[np.ix_(rows, cols)]
        for nb in (1, 3):
            out[f"slopeMax_{nb}"][a0:a1] = S.box_max(sl, nb)[np.ix_(rows, cols)]
            out[f"slopeMean_{nb}"][a0:a1] = S.box_mean(sl, nb)[np.ix_(rows, cols)]
            out[f"relief_{nb}"][a0:a1] = (S.box_max(sub, nb) - S.box_min(sub, nb))[np.ix_(rows, cols)]
    out["psr"] = psr_mask(xs, ys, res)
    meta = {"demZ": z, "demRes": r, "boxes": [1, 3]}
    np.savez_compressed(out_path, **out, meta=json.dumps(meta))
    return meta


def psr_mask(xs: np.ndarray, ys: np.ndarray, res: float) -> np.ndarray:
    """1 where the cell centre lies in a mapped PSR polygon (data/web/psr.geojson)."""
    from PIL import Image, ImageDraw

    p = WEB / "psr.geojson"
    img = Image.new("L", (xs.size, ys.size), 0)
    if not p.exists():
        return np.zeros((ys.size, xs.size), np.uint8)
    d = ImageDraw.Draw(img)
    x0, y0 = xs[0] - res / 2, ys[0] + res / 2

    def px(ring):
        return [((x - x0) / res - 0.5, (y0 - y) / res - 0.5) for x, y in ring]

    for f in json.loads(p.read_text())["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            d.polygon(px(poly[0]), fill=1)
            for hole in poly[1:]:
                d.polygon(px(hole), fill=0)
    return np.asarray(img, dtype=np.uint8)


def build_map(a, pyr, zfine, xs, ys, blocks, prog, prog_p, hp_part, tp_part) -> bool:
    """Compute missing row blocks into the *.partial.npy memmaps; returns True when all blocks are done."""
    n = xs.size
    mode = "r+" if hp_part.exists() and prog["done"] else "w+"
    hm = np.lib.format.open_memmap(hp_part, mode=mode, dtype=np.uint8, shape=(n, n, a.naz))
    ht = np.lib.format.open_memmap(tp_part, mode=mode, dtype=np.float32, shape=(n, n))
    if mode == "w+":
        hm[:] = 255
        ht[:] = np.nan
    done = set(prog["done"])
    t_start = time.time()
    for b0 in blocks:
        if b0 in done:
            continue
        b1 = min(n, b0 + a.block)
        if np.abs(ys[b0:b1]).min() > a.extent:  # smallest rho in a row is |y|
            done.add(b0)
            continue
        ymin = np.abs(ys[b0:b1]).min()
        half = math.sqrt(max(0.0, a.extent ** 2 - ymin ** 2))
        cols = np.flatnonzero(np.abs(xs) <= half + a.res)  # columns that intersect rho <= extent
        out = np.full((b1 - b0, cols.size, a.naz), 255, np.uint8)
        hh = np.full((b1 - b0, cols.size), np.nan)
        H.region_rows(pyr.index, pyr.stack, zfine, xs[cols], ys[b0:b1], a.hobs, a.naz, a.alpha, 300e3, R_MOON,
                      pyr.hmax, pyr.hmin, out, hh)
        rr = np.hypot(xs[cols][None, :], ys[b0:b1][:, None])
        out[rr > a.extent] = 255
        hh[rr > a.extent] = np.nan
        hm[b0:b1, cols[0]:cols[-1] + 1] = out
        ht[b0:b1, cols[0]:cols[-1] + 1] = hh
        hm.flush()
        ht.flush()
        done.add(b0)
        prog["done"] = sorted(done)
        write_json(prog_p, prog)
        log("horizon_maps", f"rows {b0}-{b1} done ({len(done)}/{len(blocks)} blocks, "
                            f"{(time.time() - t_start) / 60:.1f} min elapsed)")
    prog["runtimeS"] = prog.get("runtimeS", 0.0) + (time.time() - t_start)
    write_json(prog_p, prog)
    del hm, ht
    return len(done) == len(blocks)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--res", type=float, default=240.0)
    ap.add_argument("--extent", type=float, default=200160.0, help="half-width of the square grid (m)")
    ap.add_argument("--naz", type=int, default=64)
    ap.add_argument("--alpha", type=float, default=0.01)
    ap.add_argument("--zmax", type=int, default=6)
    ap.add_argument("--hobs", type=float, default=2.0)
    ap.add_argument("--block", type=int, default=24, help="rows per resumable block")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--bench", action="store_true", help="time one block near the pole and exit")
    ap.add_argument("--features-only", action="store_true")
    a = ap.parse_args(argv)
    tag = f"{int(a.res)}m"
    xs, ys = grid(a.res, a.extent)
    n = xs.size
    WORK.mkdir(parents=True, exist_ok=True)
    hp, tp = WORK / f"horizon_{tag}.npy", WORK / f"horizon_{tag}_hterr.npy"
    hp_part, tp_part = WORK / f"horizon_{tag}.partial.npy", WORK / f"horizon_{tag}_hterr.partial.npy"
    prog_p, meta_p = WORK / f"horizon_{tag}.progress.json", WORK / f"horizon_{tag}.json"
    fp = WORK / f"features_{tag}.npz"
    if not a.features_only:
        pyr, zfine = load_pyramid(a.zmax)
        params = {"res": a.res, "extent": a.extent, "naz": a.naz, "alpha": a.alpha, "zfine": zfine, "hobs": a.hobs}
        if a.bench:
            rows = np.arange(n // 2 - 4, n // 2 + 4)
            out = np.zeros((rows.size, n, a.naz), np.uint8)
            ht = np.zeros((rows.size, n), np.float64)
            H.region_rows(pyr.index, pyr.stack, zfine, xs[:8], ys[rows], a.hobs, a.naz, a.alpha, 300e3, R_MOON,
                          pyr.hmax, pyr.hmin, out[:, :8], ht[:, :8])  # compile
            t0 = time.time()
            H.region_rows(pyr.index, pyr.stack, zfine, xs, ys[rows], a.hobs, a.naz, a.alpha, 300e3, R_MOON,
                          pyr.hmax, pyr.hmin, out, ht)
            dt = time.time() - t0
            inside = np.hypot(*np.meshgrid(xs, ys)) <= a.extent
            log("horizon_maps", f"bench: {rows.size}x{n} cells in {dt:.2f} s -> full map ~"
                                f"{dt * inside.sum() / (rows.size * n) / 60:.1f} min")
            return
        prog = json.loads(prog_p.read_text()) if prog_p.exists() and not a.force else {}
        if prog.get("params") != params:
            prog = {"params": params, "done": []}
        blocks = list(range(0, n, a.block))
        up_to_date = (len(prog["done"]) == len(blocks) and hp.exists() and tp.exists() and meta_p.exists()
                      and not hp_part.exists())
        if up_to_date:
            log("horizon_maps", f"horizon map up to date ({hp.name}); use --force to rebuild")
        else:
            if not hp_part.exists():
                prog["done"] = []
            if not build_map(a, pyr, zfine, xs, ys, blocks, prog, prog_p, hp_part, tp_part):
                log("horizon_maps", "incomplete - rerun to resume")
                return
            hp_part.replace(hp)  # atomic: readers never see a half-built map
            tp_part.replace(tp)
            meta = {"version": 1, "res": a.res, "bbox": [float(xs[0] - a.res / 2), float(ys[-1] - a.res / 2),
                                                          float(xs[-1] + a.res / 2), float(ys[0] + a.res / 2)],
                    "width": n, "height": n, "naz": a.naz, "e0": H.MAP_E0, "de": H.MAP_DE, "obsHeight": a.hobs,
                    "alpha": a.alpha, "dmax": 300e3, "zfine": zfine, "finestRes": T.res(zfine), "maxRho": a.extent,
                    "layout": "uint8[row(y desc)][col(x asc)][az k*360/naz]", "complete": True,
                    "runtimeS": round(prog["runtimeS"], 1), "generated": now_iso(), "job": JOB}
            write_json(meta_p, meta)
            record_product(f"horizon_{tag}", hp, JOB)
            log("horizon_maps", f"horizon map {n}x{n}x{a.naz} complete, total {prog['runtimeS'] / 60:.1f} min")
    t0 = time.time()
    fmeta = compute_features(xs, ys, a.res, fp)
    record_product(f"features_{tag}", fp, JOB)
    log("horizon_maps", f"features ({fmeta}) in {time.time() - t0:.1f} s -> {fp.name}")


if __name__ == "__main__":
    main()
