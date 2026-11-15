"""Lazy, read-only access to the data products (env DATA_DIR; default <repo>/data). Used by the compute
service and by pipeline jobs that reuse its analyses."""

from __future__ import annotations

import hashlib
import json
import os
import threading
from functools import cached_property
from pathlib import Path

import numpy as np

from .ephemeris import Ephemeris
from .tiles import TileStore

ANALYSIS_VERSION = "lunarcore-analysis-1"  # bump when analysis results change for the same inputs


class DataUnavailable(RuntimeError):
    """A product needed for the request has not been built (HTTP 503)."""


def data_dir() -> Path:
    env = os.environ.get("DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[3] / "data"


class DataStore:
    def __init__(self, root: Path | None = None, region_res: int | None = None):
        self.root = Path(root) if root else data_dir()
        self.web = self.root / "web"
        self.work = self.root / "work"
        self.cache_dir = self._writable_cache(Path(os.environ.get("CACHE_DIR", self.work / "cache")))
        self._lock = threading.Lock()
        self._region_res = region_res or int(os.environ.get("REGION_RES", "240"))

    @staticmethod
    def _writable_cache(p: Path) -> Path:
        """Content-addressed cache dir; falls back to /tmp when DATA_DIR is mounted read-only."""
        try:
            p.mkdir(parents=True, exist_ok=True)
            probe = p / ".probe"
            probe.write_text("")
            probe.unlink()
            return p
        except OSError:
            fb = Path(os.environ.get("TMPDIR", "/tmp")) / "compute-cache"
            fb.mkdir(parents=True, exist_ok=True)
            return fb

    # ---------------------------------------------------------------- products
    @cached_property
    def eph(self) -> Ephemeris | None:
        p = self.web / "ephem"
        return Ephemeris.load(p) if (p / "index.json").exists() else None

    @cached_property
    def dem(self) -> TileStore:
        return TileStore(self.web / "dem", cache_size=4096)

    @cached_property
    def err(self) -> TileStore:
        return TileStore(self.web / "err", cache_size=2048)

    @cached_property
    def region(self) -> dict | None:
        tag = f"{self._region_res}m"
        hp, mp, tp = self.work / f"horizon_{tag}.npy", self.work / f"horizon_{tag}.json", self.work / f"horizon_{tag}_hterr.npy"
        if not (hp.exists() and mp.exists() and tp.exists()):
            return None
        meta = json.loads(mp.read_text())
        n = meta["width"]
        x0, y0, x1, y1 = meta["bbox"]
        res = meta["res"]
        xs = x0 + (np.arange(n) + 0.5) * res
        ys = y1 - (np.arange(meta["height"]) + 0.5) * res
        out = {"meta": meta, "hmap": np.load(hp, mmap_mode="r"), "hterr": np.load(tp, mmap_mode="r"), "xs": xs, "ys": ys}
        fp = self.work / f"features_{tag}.npz"
        if fp.exists():
            z = np.load(fp)
            out["features"] = {k: z[k] for k in z.files if k != "meta"}
            out["featuresMeta"] = json.loads(str(z["meta"]))
        return out

    def require_eph(self) -> Ephemeris:
        if self.eph is None:
            raise DataUnavailable("ephemeris tables missing (just data ephem)")
        return self.eph

    def require_dem(self) -> TileStore:
        if not self.dem.exists:
            raise DataUnavailable("DEM tiles missing (just data tiles)")
        return self.dem

    def require_region(self) -> dict:
        r = self.region
        if r is None or "features" not in r:
            raise DataUnavailable("region horizon map / features missing (just data horizon)")
        return r

    # ---------------------------------------------------------------- versioning
    @cached_property
    def version(self) -> str:
        """Hash of the products this service reads (cache keys change when data are rebuilt)."""
        h = hashlib.sha256(ANALYSIS_VERSION.encode())
        man = self.root / "manifest.json"
        inputs = {"ephem", "dem", "err", f"horizon_{self._region_res}m", f"features_{self._region_res}m"}
        if man.exists():
            prods = json.loads(man.read_text()).get("products", {})
            for k in sorted(inputs & set(prods)):
                h.update(f"{k}:{prods[k].get('sha256', '')};".encode())
        for p in (self.work / f"horizon_{self._region_res}m.json", self.web / "dem" / "index.json"):
            if p.exists():
                h.update(p.read_bytes())
        return h.hexdigest()[:16]

    def info(self) -> dict:
        eph = self.eph
        reg = self.region
        out = {
            "dataDir": str(self.root),
            "version": self.version,
            "ephemeris": None if eph is None else {
                "startUtc": eph.meta.get("startUtc"), "endUtc": eph.meta.get("endUtc"),
                "frame": eph.meta.get("frame"), "stepSeconds": eph.meta.get("stepSeconds")},
            "dem": {"available": self.dem.exists, "levels": self.dem.levels() if self.dem.exists else []},
            "errorTiles": {"available": self.err.exists, "levels": self.err.levels() if self.err.exists else []},
            "regionHorizon": None if reg is None else {
                k: reg["meta"].get(k) for k in ("res", "bbox", "width", "height", "naz", "complete", "finestRes",
                                                "maxRho", "generated")},
            "features": None if reg is None or "featuresMeta" not in reg else reg["featuresMeta"],
            "prebakedHeatmaps": self.prebaked_index(),
        }
        out["capabilities"] = {
            "siteMetrics": eph is not None and self.dem.exists,
            "heatmap": eph is not None and reg is not None and "features" in reg,
            "robustness": eph is not None and reg is not None and "features" in reg and self.dem.exists,
        }
        return out

    def prebaked_index(self) -> list:
        p = self.web / "heatmaps" / "index.json"
        if not p.exists():
            return []
        return json.loads(p.read_text()).get("items", [])
