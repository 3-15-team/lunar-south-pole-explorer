"""Site catalog -> data/web/sites.json (docs/DATA.md §4).

    python -m pipeline.jobs.sites [--no-remote]

Reads the curated pipeline/config/sites.json and enriches it: PGDA 5 m sites get their centre and bbox
from the DEM GeoTIFF header (local file, else a remote header read via GDAL /vsicurl/, cached in
data/work/site_headers.json); every site gets SPS x/y, terrain height from the tile pyramid and the
``inCoverage`` flag; sites with z9 tiles get ``hiRes``.
"""

from __future__ import annotations

import argparse
import json
import math
import os

from lunarcore import tiles as T
from lunarcore.geo import ll_to_xy, xy_to_ll

from ._common import CONFIG, RAW, WEB, WORK, log, now_iso, record_product, write_json

JOB = "pipeline/jobs/sites.py"
PGDA_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/{s}/{s}_final_adj_5mpp_surf.tif"


def dem_header(site: str, remote: bool, cache: dict) -> dict | None:
    import rasterio

    local = sorted((RAW / "lola5" / site).glob("*_surf.tif"))
    src = str(local[0]) if local else None
    if src is None:
        if site in cache:
            return cache[site]
        if not remote:
            return None
        os.environ.setdefault("GDAL_HTTP_TIMEOUT", "30")
        os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
        src = "/vsicurl/" + PGDA_URL.format(s=site)
    try:
        with rasterio.open(src) as ds:
            b = ds.bounds
            info = {"bbox": [b.left, b.bottom, b.right, b.top], "res": ds.transform.a, "local": bool(local)}
    except Exception as e:  # noqa: BLE001 - network/IO
        log("sites", f"{site}: cannot read DEM header ({e})")
        return None
    if not local:
        cache[site] = info
    return info


def dem_summit(site: str, bbox: list[float], store: T.TileStore, frac: float = 0.6) -> dict | None:
    """Highest DEM point inside the central ``frac`` of the site DEM (5 m GeoTIFF when downloaded, else the finest
    global tile level over the same window). Ties -> first in row-major order (reproducible)."""
    import numpy as np
    import rasterio

    m = (1.0 - frac) / 2.0
    local = sorted((RAW / "lola5" / site).glob("*_surf.tif"))
    if local:
        with rasterio.open(local[0]) as ds:
            r0, r1 = int(round(ds.height * m)), int(round(ds.height * (1 - m)))
            c0, c1 = int(round(ds.width * m)), int(round(ds.width * (1 - m)))
            a = ds.read(1, window=((r0, r1), (c0, c1))).astype(np.float64)
            if ds.nodata is not None and not math.isnan(ds.nodata):
                a[a == ds.nodata] = np.nan
            k = int(np.nanargmax(a))
            i, j = divmod(k, a.shape[1])
            t = ds.transform
            x = t.c + (c0 + j + 0.5) * t.a
            y = t.f + (r0 + i + 0.5) * t.e
            return {"x": x, "y": y, "h": float(a[i, j]), "res": t.a, "from": "5 m site DEM"}
    zs = [z for z in store.levels() if z <= 6]
    if not zs:
        return None
    z = max(zs)
    w = bbox[2] - bbox[0]
    hgt = bbox[3] - bbox[1]
    xmin, xmax = bbox[0] + m * w, bbox[2] - m * w
    ymin, ymax = bbox[1] + m * hgt, bbox[3] - m * hgt
    best = None
    for tx, ty in T.tiles_in_bbox(z, xmin, ymin, xmax, ymax):
        a = store.load(z, tx, ty)
        if a is None:
            continue
        xs, ys = T.pixel_centres(z, tx, ty)
        X, Y = np.meshgrid(xs, ys)
        inside = (X >= xmin) & (X <= xmax) & (Y >= ymin) & (Y <= ymax) & np.isfinite(a)
        if not inside.any():
            continue
        v = np.where(inside, a, -np.inf)
        k = int(np.argmax(v))
        i, j = divmod(k, a.shape[1])
        if best is None or v[i, j] > best["h"]:
            best = {"x": float(xs[j]), "y": float(ys[i]), "h": float(v[i, j]), "res": T.res(z),
                    "from": f"{T.res(z):.0f} m global DEM tiles (5 m DEM not downloaded yet)"}
    return best


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--no-remote", action="store_true", help="do not read headers of not-downloaded DEMs")
    a = ap.parse_args(argv)
    cfg = json.loads((CONFIG / "sites.json").read_text())
    cache_path = WORK / "site_headers.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    store = T.TileStore(WEB / "dem")
    dem_index = store.index or {}
    z9_sites = set((dem_index.get("sites") or {}).keys()) if 9 in store.levels() else set()
    out = []
    for s in cfg["sites"]:
        e = {k: v for k, v in s.items() if k != "pgda"}
        pg = s.get("pgda")
        if pg:
            hdr = dem_header(pg, not a.no_remote, cache)
            if hdr:
                bx = hdr["bbox"]
                cx, cy = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2
                clat, clon = xy_to_ll(cx, cy)
                e["demCentre"] = {"lat": round(float(clat), 5), "lon": round(float(clon), 5),
                                  "x": round(cx, 1), "y": round(cy, 1)}
                e["demBbox"] = bx
                e["hiRes"] = {"z": 9, "bbox": bx} if pg in z9_sites else None
                e["dem"] = pg
                top = dem_summit(pg, bx, store)
                if top is not None:
                    lat, lon = xy_to_ll(top["x"], top["y"])
                    e["lat"], e["lon"] = round(float(lat), 5), round(float(lon), 5)
                    e["coordQuality"] = "dem-summit"
                    e["note"] = (f"{e.get('note', '').replace(' Centre of the 5 m LOLA DEM.', '')} Point = highest "
                                 f"terrain within the central 60% of the PGDA 5 m DEM ({top['from']}): "
                                 f"{top['h']:.0f} m; DEM centre kept in demCentre.").strip()
                else:
                    e["lat"], e["lon"] = e["demCentre"]["lat"], e["demCentre"]["lon"]
                    e["coordQuality"] = "dem-centre"
            else:
                e["coordQuality"] = "approx"
                e["note"] = (e.get("note", "") + " (DEM header unavailable; centre from the published DEM listing)").strip()
                e["hiRes"] = None
        else:
            e["hiRes"] = None
        x, y = ll_to_xy(e["lat"], e["lon"])
        x, y = float(x), float(y)
        h = float("nan")
        if e["lat"] <= -75.0 and store.exists:
            z = store.finest_level_at(x, y)
            if z >= 0:
                pyr = store.pyramid([(z, *T.tile_of(z, x, y))] + [(z, *t) for t in T.tiles_in_bbox(z, x - 50, y - 50,
                                                                                                    x + 50, y + 50)])
                h = pyr.sample(z, x, y)
        e["inCoverage"] = bool(math.isfinite(h))
        e["x"], e["y"] = (round(x, 1), round(y, 1)) if e["lat"] <= -60 else (None, None)
        e["heightM"] = round(h, 1) if math.isfinite(h) else None
        out.append(e)
    write_json(cache_path, cache)
    doc = {"version": 1, "generated": now_iso(), "job": JOB,
           "frame": "MOON_ME (DE421 ME for LOLA products); lon east-positive; heights above R = 1737.4 km",
           "sites": out}
    path = WEB / "sites.json"
    write_json(path, doc)
    record_product("sites", path, JOB)
    n_cov = sum(1 for e in out if e["inCoverage"])
    n_hi = sum(1 for e in out if e.get("hiRes"))
    log("sites", f"{len(out)} sites ({n_cov} in coverage, {n_hi} with 5 m tiles) -> {path}")


if __name__ == "__main__":
    main()
