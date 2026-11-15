"""Show which data products exist (just data status).

    python -m pipeline.jobs.status
"""

from __future__ import annotations

import json

from ._common import DATA, MANIFEST, RAW, WEB, WORK


def _size(p) -> int:
    if p.is_file():
        return p.stat().st_size
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def _fmt(n: int) -> str:
    return f"{n / 1e6:9.1f} MB"


def main(argv=None) -> None:
    man = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"files": {}, "products": {}}
    print(f"DATA_DIR = {DATA}")
    print("\nraw downloads (manifest 'files'):")
    for k, v in sorted(man.get("files", {}).items()):
        p = DATA / v["path"]
        ok = p.exists() and p.stat().st_size == v["size"]
        print(f"  {'ok ' if ok else 'BAD'} {k:32s} {_fmt(v['size'])}  {v['path']}")
    parts = sorted(RAW.rglob("*.part"))
    for p in parts:
        print(f"  ..  in progress {p.relative_to(DATA)} {_fmt(p.stat().st_size)}")
    print("\nproducts:")
    rows = [("ephemeris tables", WEB / "ephem" / "index.json", WEB / "ephem"),
            ("DEM tiles", WEB / "dem" / "index.json", WEB / "dem"),
            ("height-error tiles", WEB / "err" / "index.json", WEB / "err"),
            ("site catalog", WEB / "sites.json", WEB / "sites.json"),
            ("PSR polygons", WEB / "psr.geojson", WEB / "psr.geojson"),
            ("pre-baked heatmaps", WEB / "heatmaps" / "index.json", WEB / "heatmaps")]
    for name, marker, root in rows:
        print(f"  {'ok ' if marker.exists() else '-- '} {name:22s} {_fmt(_size(root)) if marker.exists() else '':>12}  "
              f"{root.relative_to(DATA)}")
    idx = WEB / "dem" / "index.json"
    if idx.exists():
        d = json.loads(idx.read_text())
        lv = ", ".join(f"z{lv['z']}:{len(lv['tiles'])}" for lv in d["levels"])
        print(f"      levels {lv}; z6 available={d.get('z6', {}).get('available')}; sites={sorted(d.get('sites', {}))}")
    for p in sorted(WORK.glob("horizon_*m.json")):
        m = json.loads(p.read_text())
        print(f"  ok  region horizon map  {_fmt(_size(p.with_suffix('.npy')))}  {p.with_suffix('.npy').relative_to(DATA)}"
              f" ({m['width']}x{m['height']}x{m['naz']}, {m['res']:.0f} m, complete={m['complete']}, "
              f"{m.get('runtimeS', 0) / 60:.1f} min)")
    for p in sorted(WORK.glob("features_*m.npz")):
        print(f"  ok  features            {_fmt(_size(p))}  {p.relative_to(DATA)}")
    print(f"\nmanifest products recorded: {', '.join(sorted(man.get('products', {}))) or 'none'}")


if __name__ == "__main__":
    main()
