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
                lat, lon = xy_to_ll(cx, cy)
                e["lat"], e["lon"] = round(float(lat), 5), round(float(lon), 5)
                e["coordQuality"] = "dem-centre"
                e["demBbox"] = bx
                e["hiRes"] = {"z": 9, "bbox": bx} if pg in z9_sites else None
                e["dem"] = pg
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
