"""Permanently shadowed regions -> data/web/psr.geojson (docs/DATA.md §5).

    python -m pipeline.jobs.psr [--tolerance 20]

Source: LPSR_80S_20MPP_ADJ_1km2 shapefile (PGDA, Barker et al.), already in the south polar stereographic
projection on the 1737.4 km sphere (= LUNAR:SPS). Polygons are simplified with Douglas-Peucker
(topology preserving) to <= 20 m and written with coordinates in SPS metres and ``{area_km2}``.
"""

from __future__ import annotations

import argparse
import json
import time

from ._common import RAW, WEB, log, now_iso, record_product

JOB = "pipeline/jobs/psr.py"
SRC = RAW / "psr" / "LPSR_80S_20MPP_ADJ_1km2.SHP"


def _round(coords, nd=1):
    if isinstance(coords[0], (float, int)):
        return [round(float(coords[0]), nd), round(float(coords[1]), nd)]
    return [_round(c, nd) for c in coords]


def check_projection() -> None:
    prj = SRC.with_suffix(".PRJ").read_text()
    for tok in ("Stereographic_South_Pole", "1737400", "Central_Meridian\",0.0"):
        if tok not in prj:
            raise SystemExit(f"unexpected PSR projection (missing {tok}): {prj[:200]}")


def main(argv=None) -> None:
    import shapefile
    from shapely.geometry import mapping, shape

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tolerance", type=float, default=20.0)
    a = ap.parse_args(argv)
    if not SRC.exists():
        raise SystemExit(f"missing {SRC} - python pipeline/jobs/download.py --only psr")
    check_projection()
    t0 = time.time()
    r = shapefile.Reader(str(SRC))
    names = [f[0] for f in r.fields[1:]]
    feats = []
    n_in = n_out = 0
    for sr in r.iterShapeRecords():
        rec = dict(zip(names, sr.record))
        geom = shape(sr.shape.__geo_interface__)
        n_in += len(sr.shape.points)
        simp = geom.simplify(a.tolerance, preserve_topology=True)
        if simp.is_empty:
            continue
        gj = mapping(simp)
        coords = _round(gj["coordinates"])
        n_out += sum(len(ring) for poly in (coords if gj["type"] == "MultiPolygon" else [coords]) for ring in poly)
        try:
            area = round(float(str(rec.get("area_km2", "")).strip()), 3)
        except ValueError:
            area = round(geom.area / 1e6, 3)
        props = {"area_km2": area, "id": str(rec.get("name", rec.get("gid", ""))).strip().strip('"')}
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": gj["type"], "coordinates": coords}})
    out = {"type": "FeatureCollection", "name": "psr",
           "crs": {"type": "name", "properties": {"name": "LUNAR:SPS"}},
           "metadata": {"source": SRC.name, "simplifyToleranceM": a.tolerance, "units": "SPS metres",
                        "count": len(feats), "generated": now_iso(), "job": JOB},
           "features": feats}
    path = WEB / "psr.geojson"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    record_product("psr", path, JOB)
    log("psr", f"{len(feats)} polygons, vertices {n_in} -> {n_out}, {path.stat().st_size / 1e6:.1f} MB, "
               f"{time.time() - t0:.1f} s")


if __name__ == "__main__":
    main()
