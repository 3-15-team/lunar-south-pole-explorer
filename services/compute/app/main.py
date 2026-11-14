"""Compute service (FastAPI, CPU-only, stateless, content-addressed cache). API reference: docs/API.md.

    cd services/compute && python -m uvicorn app.main:app --port 8000
"""

from __future__ import annotations

import json
import threading
from contextlib import asynccontextmanager
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from lunarcore import analysis as compute
from lunarcore.products import DataStore, DataUnavailable

STORE = DataStore()
VERSION = "1.0.0"


def _warmup() -> None:
    """Compile the numba kernels in the background so the first request is fast."""
    try:
        from lunarcore import disk, maps, synthetic
        from lunarcore import horizon as H
        from lunarcore import tiles as T

        pyr = T.pyramid_from_function(synthetic.dem_function({"type": "flat", "h": 0.0}), 1000.0, 1000.0, 5,
                                      dmax=3000.0)
        H.profile_from_pyramid(pyr, 5, 1000.0, 1000.0, naz=8, dmax=3000.0)
        prof = np.zeros(64)
        disk.fractions_slices(prof, np.zeros(2), np.zeros(2), np.full(2, 0.27))
        hm = np.full((1, 1, 64), 50, np.uint8)
        maps.run_interval_maps(hm, np.zeros((1, 1)), np.array([1000.0]), np.array([1000.0]),
                               np.array([[1.5e8, 0, 0.0]]), np.array([[3.8e5, 0, 0.0]]))
        out = np.zeros((1, 1))
        maps.draw_metrics(np.zeros((1, 1, 64)), *(np.ones((1, 1)) for _ in range(6)), 0.5, 0.05, out, out.copy(),
                          out.copy())
    except Exception:  # noqa: BLE001 - warm-up is best effort
        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_warmup, daemon=True).start()
    yield


app = FastAPI(title="Lunar South Pole Site Explorer - compute", version=VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])


# --------------------------------------------------------------------------- models
class _Interval(BaseModel):
    t0: str = Field(..., description="ISO-8601 UTC start")
    t1: str = Field(..., description="ISO-8601 UTC end")


class SiteMetricsRequest(_Interval):
    lat: float = Field(..., ge=-90.0, le=-75.0)
    lon: float = Field(..., ge=-360.0, le=360.0)
    obsHeight: float = Field(2.0, ge=0.0, le=10.0)
    stepMin: float = Field(10.0, ge=0.5, le=360.0)
    dteThreshold: float = Field(0.5, ge=0.05, le=1.0)
    naz: int = Field(1440, ge=64, le=2880)
    includeSeries: bool = False


class _ScoreParams(_Interval):
    preset: Literal["lander", "base"] = "lander"
    weights: dict[str, float] | None = None
    footprintM: float = Field(50.0, ge=5.0, le=100.0)
    slopeLimitDeg: float | None = Field(None, ge=5.0, le=20.0)
    dteThreshold: float = Field(0.5, ge=0.05, le=1.0)
    stepHours: float | None = Field(None, ge=0.25, le=24.0)

    @field_validator("weights")
    @classmethod
    def _w(cls, v):
        if v is None:
            return v
        bad = set(v) - {"illum", "dark", "earth", "slope", "relief"}
        if bad:
            raise ValueError(f"unknown weight keys {sorted(bad)}")
        if any(x < 0 for x in v.values()):
            raise ValueError("weights must be >= 0")
        return v


class HeatmapRequest(_ScoreParams):
    bbox: list[float] | None = Field(None, min_length=4, max_length=4, description="[xmin, ymin, xmax, ymax] SPS m")
    candidates: int = Field(10, ge=0, le=50)


class Candidate(BaseModel):
    x: float | None = None
    y: float | None = None
    lat: float | None = None
    lon: float | None = None

    @model_validator(mode="after")
    def _xy_or_ll(self):
        if (self.x is None or self.y is None) and (self.lat is None or self.lon is None):
            raise ValueError("give x/y (SPS m) or lat/lon")
        return self


class RobustnessRequest(_ScoreParams):
    candidates: list[Candidate] = Field(..., min_length=1, max_length=50)
    n: int = Field(200, ge=10, le=2000)
    k: int = Field(10, ge=1, le=50)
    seed: int = 0


# --------------------------------------------------------------------------- routes
def _run(fn, *args):
    try:
        return fn(*args)
    except DataUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except compute.BadRequest as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/health")
def health():
    return {"status": "ok", "version": VERSION}


@app.get("/api/v1/info")
def info():
    return STORE.info()


@app.post("/api/v1/site-metrics")
def site_metrics(req: SiteMetricsRequest):
    p = req.model_dump()
    key = compute.canonical_key("site-metrics", p, STORE.version)
    cp = STORE.cache_dir / f"{key}.json"
    if cp.exists():
        return JSONResponse(json.loads(cp.read_text()), headers={"X-Cache": "hit"})
    out = _run(compute.site_metrics, STORE, p)
    STORE.cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = cp.with_suffix(".tmp")
    tmp.write_text(json.dumps(out))
    tmp.replace(cp)
    return JSONResponse(out, headers={"X-Cache": "miss"})


@app.post("/api/v1/heatmap")
def heatmap(req: HeatmapRequest):
    p = req.model_dump()
    r = _run(compute.heatmap, STORE, p, STORE.cache_dir)
    hid = r["id"]
    return JSONResponse({"id": hid, "png": f"/api/v1/heatmap/{hid}.png", "json": f"/api/v1/heatmap/{hid}.json",
                         "scoreBin": f"/api/v1/heatmap/{hid}.score.bin", "meta": r["meta"]},
                        headers={"X-Cache": "hit" if r["cached"] else "miss"})


_MEDIA = {"png": "image/png", "json": "application/json", "score.bin": "application/octet-stream"}


@app.get("/api/v1/heatmap/{name}")
def heatmap_file(name: str):
    ext = next((e for e in _MEDIA if name.endswith("." + e)), None)
    if ext is None:
        raise HTTPException(status_code=404, detail="use <id>.png, <id>.json or <id>.score.bin")
    media = _MEDIA[ext]
    hid = name[: -len(ext) - 1]
    if not hid.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="bad id")
    for d in (STORE.cache_dir, STORE.web / "heatmaps"):
        f = d / name
        if f.exists():
            return FileResponse(f, media_type=media, headers={"Cache-Control": "public, max-age=86400"})
    raise HTTPException(status_code=404, detail=f"heatmap {hid} not found")


@app.post("/api/v1/robustness")
def robustness(req: RobustnessRequest):
    p = req.model_dump()
    key = compute.canonical_key("robustness", p, STORE.version)
    cp = STORE.cache_dir / f"{key}.json"
    if cp.exists():
        return JSONResponse(json.loads(cp.read_text()), headers={"X-Cache": "hit"})
    out = _run(compute.robustness, STORE, p)
    STORE.cache_dir.mkdir(parents=True, exist_ok=True)
    cp.write_text(json.dumps(out))
    return JSONResponse(out, headers={"X-Cache": "miss"})
