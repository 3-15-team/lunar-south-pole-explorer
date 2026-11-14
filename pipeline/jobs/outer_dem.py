"""Context Moon outside the polar coverage -> data/web/outer/{index.json, dem.bin}.

    python -m pipeline.jobs.outer_dem [--force]

Resamples the LOLA global 16 px/deg DEM (data/raw/lola_global/ldem_16.img) into the map's south polar
stereographic frame (docs/DATA.md §1) out to the equator: one 2048² LDT1 raster (~3.4 km/px, gzip).
Display only: the map draws the rest of the southern hemisphere with the same live Sun shading and
ray-marched shadows as the coverage, so the 80°S data edge no longer reads as the Moon's limb.
Heights are above the same 1737.4 km sphere as every other product. Never used by any metric.
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from lunarcore import tiles as T
from lunarcore.geo import R_MOON, xy_to_ll

from ._common import DATA, WEB, log, now_iso, record_tree, write_json

JOB = "pipeline/jobs/outer_dem.py"
VERSION = 1
SRC = DATA / "raw" / "lola_global" / "ldem_16.img"
PPD = 16  # pixels per degree; 5760 x 2880, sample j centre lon = (j + 0.5)/16 E, line i centre lat = 90 - (i + 0.5)/16
N = 2048
HALF = 3_480_000.0  # m; equator is at rho = 2R = 3 474 800 m
LAT_MAX = 0.0  # southern hemisphere only


def load_ldem(path=SRC) -> np.ndarray:
    a = np.fromfile(path, dtype="<i2").reshape(180 * PPD, 360 * PPD)
    return a.astype(np.float32) * 0.5


def sample_ldem(dem: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Bilinear sample of the cylindrical grid; longitude wraps, latitude clamps."""
    rows, cols = dem.shape
    fi = (90.0 - lat) * PPD - 0.5
    fj = np.mod(lon, 360.0) * PPD - 0.5
    i0 = np.clip(np.floor(fi).astype(np.int64), 0, rows - 2)
    j0 = np.floor(fj).astype(np.int64)
    wi = np.clip(fi - i0, 0.0, 1.0)
    wj = fj - j0
    j0 %= cols
    j1 = (j0 + 1) % cols
    top = dem[i0, j0] * (1 - wj) + dem[i0, j1] * wj
    bot = dem[i0 + 1, j0] * (1 - wj) + dem[i0 + 1, j1] * wj
    return top * (1 - wi) + bot * wi


def build(dem: np.ndarray, n: int = N, half: float = HALF, sub: int = 3) -> np.ndarray:
    """SPS raster [n][n] (row 0 = +y edge), each pixel the mean of sub x sub point samples (prefilter)."""
    res = 2 * half / n
    out = np.zeros((n, n), dtype=np.float64)
    offs = (np.arange(sub) + 0.5) / sub
    cols = -half + np.arange(n) * res
    rows = half - np.arange(n) * res
    for oy in offs:
        y = (rows - oy * res)[:, None]
        for ox in offs:
            x = (cols + ox * res)[None, :]
            lat, lon = xy_to_ll(np.broadcast_to(x, (n, n)), np.broadcast_to(y, (n, n)), R_MOON)
            out += sample_ldem(dem, lat, lon)
    out /= sub * sub
    lat_c, _ = xy_to_ll(np.broadcast_to((cols + 0.5 * res)[None, :], (n, n)),
                        np.broadcast_to((rows - 0.5 * res)[:, None], (n, n)), R_MOON)
    out[lat_c > LAT_MAX] = np.nan
    return out.astype(np.float32)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    out_dir = WEB / "outer"
    idx = out_dir / "index.json"
    if idx.exists() and not a.force and json.loads(idx.read_text()).get("version") == VERSION:
        log(JOB, f"{idx} is current (version {VERSION}); --force to rebuild")
        return
    if not SRC.exists():
        raise SystemExit(f"{SRC} missing: python pipeline/jobs/download.py --only ldem-global")
    out_dir.mkdir(parents=True, exist_ok=True)
    h = build(load_ldem())
    (out_dir / "dem.bin").write_bytes(T.encode_tile(h))
    write_json(idx, {
        "version": VERSION, "generated": now_iso(), "file": "dem.bin", "format": "LDT1 (gzip), row 0 = +y edge",
        "x0": -HALF, "y0": HALF, "res": 2 * HALF / N, "n": N, "maxRho": 2 * R_MOON, "latMax": LAT_MAX,
        "source": "LOLA LDEM_16 (PDS GDR, 16 px/deg, heights above 1737.4 km), 3x3 point-sample mean per pixel",
        "use": "map context outside the polar coverage only; never used by metrics",
    })
    finite = np.isfinite(h)
    log(JOB, f"outer DEM {N}² @ {2 * HALF / N:.0f} m, h {np.nanmin(h):.0f}..{np.nanmax(h):.0f} m, {finite.mean():.1%} valid")
    record_tree("outer_dem", out_dir, JOB, pattern="*.bin")


if __name__ == "__main__":
    main()
