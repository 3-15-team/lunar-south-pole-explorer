"""Pre-baked suitability heatmaps -> data/web/heatmaps/{index.json, <id>.png, <id>.json, <id>.score.bin}.

    python -m pipeline.jobs.prebake [--force]

Uses the same engine as POST /api/v1/heatmap (lunarcore.analysis.heatmap) on the region horizon map
(data/work/horizon_240m.npy) so the static fallback and the service agree (docs/DATA.md §6).
"""

from __future__ import annotations

import argparse
import json
import time

from lunarcore import analysis
from lunarcore.products import DataStore

from ._common import CONFIG, DATA, WEB, log, now_iso, record_tree, write_json

JOB = "pipeline/jobs/prebake.py"


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="recompute even if an item with the same id exists")
    a = ap.parse_args(argv)
    cfg = json.loads((CONFIG / "prebake.json").read_text())
    out_dir = WEB / "heatmaps"
    out_dir.mkdir(parents=True, exist_ok=True)
    ds = DataStore(DATA)
    ds.require_region()
    items = []
    for it in cfg["items"]:
        p = {**cfg["defaults"], **{k: v for k, v in it.items() if k != "label"}}
        p.setdefault("weights", None)
        p.setdefault("slopeLimitDeg", None)
        t0 = time.time()
        if a.force:
            hid = analysis.canonical_key("heatmap", p, ds.version)[:24]
            for ext in ("json", "png", "score.bin"):
                (out_dir / f"{hid}.{ext}").unlink(missing_ok=True)
        r = analysis.heatmap(ds, p, out_dir)
        hid = r["id"]
        meta = r["meta"]
        items.append({"id": hid, "label": it.get("label", hid), "preset": p["preset"], "t0": p["t0"], "t1": p["t1"],
                      "footprintM": p["footprintM"], "url": f"{hid}.png", "meta": f"{hid}.json",
                      "scoreBin": f"{hid}.score.bin", "bbox": meta["bbox"], "res": meta["res"]})
        log("prebake", f"{it.get('label', hid)}: {hid} {'cached' if r['cached'] else 'computed'} in "
                       f"{time.time() - t0:.1f} s (scored {meta['stats']['scored']} cells)")
    keep = {i["id"] for i in items}
    for f in out_dir.glob("*"):
        if f.name not in ("index.json", "SHA256SUMS") and f.name.split(".")[0] not in keep:
            f.unlink()
    write_json(out_dir / "index.json", {"version": 1, "generated": now_iso(), "job": JOB, "items": items})
    record_tree("heatmaps", out_dir, JOB)
    log("prebake", f"{len(items)} heatmaps -> {out_dir}")


if __name__ == "__main__":
    main()
