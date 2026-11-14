"""DEM tile pyramid LPS-2560 -> data/web/dem/{z}/{tx}/{ty}.bin + index.json (docs/DATA.md §2).

    python -m pipeline.jobs.dem_tiles [--force] [--levels 0 1 ... 9] [--workers 8] [--no-err]

* z5 = LDEM_80S_80MPP_ADJ.TIF (native, aligned check), z0-z4 = 2x2 nanmean chain;
* z6 = LDEM_80S_40MPP_ADJ.TIF when present (else skipped and recorded in index.json -> rerun later
  with ``--levels 6 7 8 9 --force``);
* z9 = 5 m site DEMs (``data/raw/lola5/*/*_surf.tif``), z8/z7 = 2x2 mean chain; pixels not covered by a
  site DEM are filled from z6 (else z5) by bilinear interpolation so every tile is complete;
* error tiles (1-sigma, m) from ``*_ERR.TIF`` for z <= 5 -> data/web/err/.

Idempotent: existing tiles are kept unless --force. Grid mosaics are cached as .npy in data/work/mosaic
(memory-mapped by the worker processes).
"""

from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import time
from pathlib import Path

import numpy as np

from lunarcore import tiles as T

from ._common import RAW, WEB, WORK, log, now_iso, record_tree, write_json

JOB = "pipeline/jobs/dem_tiles.py"
MOSAIC = WORK / "mosaic"
SRC80 = RAW / "lola" / "LDEM_80S_80MPP_ADJ.TIF"
SRC40 = RAW / "lola" / "LDEM_80S_40MPP_ADJ.TIF"
SRC80_ERR = RAW / "lola" / "LDEM_80S_80MPP_ADJ_ERR.TIF"
SITES_DIR = RAW / "lola5"


# --------------------------------------------------------------------------- mosaics
def _check_crs(ds) -> None:
    p = ds.crs.to_proj4() if ds.crs else ""
    for tok in ("+proj=stere", "+lat_0=-90", "+R=1737400"):
        if tok not in p:
            raise SystemExit(f"{ds.name}: unexpected CRS {p}")


def grid_offset(ds, z: int) -> tuple[int, int] | None:
    """(row, col) offset of the source in the level-z grid, or None when not aligned."""
    t = ds.transform
    r = T.res(z)
    if abs(t.a - r) > 1e-6 or abs(t.e + r) > 1e-6 or t.b != 0 or t.d != 0:
        return None
    col = (t.c - T.X0) / r
    row = (T.Y0 - t.f) / r
    if abs(col - round(col)) > 1e-6 or abs(row - round(row)) > 1e-6:
        return None
    return int(round(row)), int(round(col))


def build_mosaic(src: Path, z: int, name: str, force: bool = False) -> Path:
    """Place a GeoTIFF on the full level-z grid (float32 .npy, NaN outside), resampling only if needed."""
    import rasterio
    from rasterio.warp import Resampling, reproject

    out = MOSAIC / f"{name}.npy"
    meta = MOSAIC / f"{name}.json"
    st = src.stat()
    stamp = {"source": src.name, "size": st.st_size, "mtime": st.st_mtime, "z": z}
    if out.exists() and meta.exists() and not force and json.loads(meta.read_text()).get("size") == st.st_size:
        return out
    MOSAIC.mkdir(parents=True, exist_ok=True)
    n = T.TILE << z
    arr = np.lib.format.open_memmap(out.with_suffix(".tmp.npy"), mode="w+", dtype=np.float32, shape=(n, n))
    arr[:] = np.nan
    with rasterio.open(src) as ds:
        _check_crs(ds)
        off = grid_offset(ds, z)
        nod = ds.nodata
        if off is not None:
            r0, c0 = off
            log("dem_tiles", f"{src.name}: aligned with LPS-2560 z{z} at row/col offset {r0}/{c0} (native copy)")
            step = 512
            for i in range(0, ds.height, step):
                h = min(step, ds.height - i)
                block = ds.read(1, window=((i, i + h), (0, ds.width))).astype(np.float32)
                if nod is not None and not (isinstance(nod, float) and math.isnan(nod)):
                    block[block == nod] = np.nan
                rr0, cc0 = r0 + i, c0
                # clip to the grid
                ri0, ci0 = max(0, rr0), max(0, cc0)
                ri1, ci1 = min(n, rr0 + h), min(n, cc0 + ds.width)
                if ri1 > ri0 and ci1 > ci0:
                    arr[ri0:ri1, ci0:ci1] = block[ri0 - rr0:ri1 - rr0, ci0 - cc0:ci1 - cc0]
            stamp["resampled"] = False
        else:
            log("dem_tiles", f"{src.name}: NOT aligned with LPS-2560 z{z} -> bilinear reprojection")
            from rasterio.transform import Affine

            dst = np.full((n, n), np.nan, dtype=np.float32)
            reproject(source=rasterio.band(ds, 1), destination=dst,
                      dst_transform=Affine(T.res(z), 0, T.X0, 0, -T.res(z), T.Y0), dst_crs=ds.crs,
                      dst_nodata=np.nan, resampling=Resampling.bilinear)
            arr[:] = dst
            stamp["resampled"] = True
    arr.flush()
    del arr
    out.with_suffix(".tmp.npy").replace(out)
    write_json(meta, stamp)
    return out


def nanmean2x2(a: np.ndarray) -> np.ndarray:
    n = a.shape[0] // 2
    b = np.asarray(a, dtype=np.float32).reshape(n, 2, n, 2)
    s = np.nansum(b, axis=(1, 3), dtype=np.float64)
    c = np.sum(np.isfinite(b), axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (s / c).astype(np.float32)
    out[c == 0] = np.nan
    return out


def build_down_chain(src_npy: Path, z_src: int, prefix: str, force: bool) -> dict[int, Path]:
    paths = {z_src: src_npy}
    cur = None
    for z in range(z_src - 1, -1, -1):
        p = MOSAIC / f"{prefix}_z{z}.npy"
        if p.exists() and not force and p.stat().st_mtime >= src_npy.stat().st_mtime:
            paths[z] = p
            cur = None
            continue
        if cur is None:
            cur = np.load(paths[z + 1], mmap_mode="r")
        cur = nanmean2x2(cur)
        np.save(p, cur)
        paths[z] = p
    return paths


# --------------------------------------------------------------------------- tile workers
_MM: dict[str, np.ndarray] = {}
_DS: dict[str, object] = {}


def _mm(path: str) -> np.ndarray:
    if path not in _MM:
        _MM[path] = np.load(path, mmap_mode="r")
    return _MM[path]


def _write_level_tiles(args) -> list[tuple[int, int, int]]:
    """Worker: cut tiles of one level from a mosaic; returns (tx, ty, bytes) of tiles present."""
    z, npy, root, keys, force = args
    a = _mm(npy)
    out = []
    for tx, ty in keys:
        p = T.tile_path(Path(root), z, tx, ty)
        if p.exists() and not force:
            out.append((tx, ty, p.stat().st_size))
            continue
        h = np.asarray(a[ty * 256:(ty + 1) * 256, tx * 256:(tx + 1) * 256], dtype=np.float32)
        if not np.isfinite(h).any():
            if p.exists():
                p.unlink()
            continue
        out.append((tx, ty, T.write_tile(Path(root), z, tx, ty, h)))
    return out


def bilinear_from_mosaic(a: np.ndarray, z: int, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Bilinear sample of a level-z mosaic at the grid points (xs[cols] x ys[rows])."""
    from scipy.ndimage import map_coordinates

    r = T.res(z)
    gx = (xs - T.X0) / r - 0.5
    gy = (T.Y0 - ys) / r - 0.5
    j0 = max(0, int(math.floor(gx.min())) - 2)
    j1 = min(a.shape[1], int(math.ceil(gx.max())) + 3)
    i0 = max(0, int(math.floor(gy.min())) - 2)
    i1 = min(a.shape[0], int(math.ceil(gy.max())) + 3)
    sub = np.asarray(a[i0:i1, j0:j1], dtype=np.float64)
    GY, GX = np.meshgrid(gy - i0, gx - j0, indexing="ij")
    return map_coordinates(sub, [GY, GX], order=1, mode="nearest").astype(np.float32)


def _site_ds(path: str):
    import rasterio

    if path not in _DS:
        _DS[path] = rasterio.open(path)
    return _DS[path]


def _write_site_tile(args) -> tuple[int, int, int, int]:
    """Worker: one z9 tile from the site DEMs covering it, gaps filled from the fill mosaic."""
    tx, ty, site_paths, fill_npy, fill_z, root, force = args
    p = T.tile_path(Path(root), 9, tx, ty)
    if p.exists() and not force and p.stat().st_mtime >= max(Path(sp).stat().st_mtime for sp in site_paths):
        return tx, ty, p.stat().st_size, -1
    xs, ys = T.pixel_centres(9, tx, ty)
    h = np.full((256, 256), np.nan, dtype=np.float32)
    for sp in site_paths:
        ds = _site_ds(sp)
        t = ds.transform
        col0 = int(round((xs[0] - 2.5 - t.c) / 5.0))
        row0 = int(round((t.f - (ys[0] + 2.5)) / 5.0))
        r0, c0 = max(0, row0), max(0, col0)
        r1, c1 = min(ds.height, row0 + 256), min(ds.width, col0 + 256)
        if r1 <= r0 or c1 <= c0:
            continue
        blk = ds.read(1, window=((r0, r1), (c0, c1))).astype(np.float32)
        if ds.nodata is not None and not math.isnan(ds.nodata):
            blk[blk == ds.nodata] = np.nan
        sub = h[r0 - row0:r1 - row0, c0 - col0:c1 - col0]
        m = np.isnan(sub) & np.isfinite(blk)
        sub[m] = blk[m]
    nfill = int(np.isnan(h).sum())
    if nfill:
        fill = bilinear_from_mosaic(_mm(fill_npy), fill_z, xs, ys)
        m = np.isnan(h)
        h[m] = fill[m]
    return tx, ty, T.write_tile(Path(root), 9, tx, ty, h), nfill


def _write_parent_tile(args) -> tuple[int, int, int]:
    """Worker: level-z tile = 2x2 mean of its z+1 children; missing children filled from the fill mosaic."""
    z, tx, ty, children, fill_npy, fill_z, root, force = args
    p = T.tile_path(Path(root), z, tx, ty)
    if p.exists() and not force:
        newest = max(T.tile_path(Path(root), z + 1, cx, cy).stat().st_mtime for cx, cy in children)
        if p.stat().st_mtime >= newest:
            return tx, ty, p.stat().st_size
    big = np.full((512, 512), np.nan, dtype=np.float32)
    have = set(map(tuple, children))
    for dy in range(2):
        for dx in range(2):
            cx, cy = 2 * tx + dx, 2 * ty + dy
            if (cx, cy) in have:
                c = T.read_tile(Path(root), z + 1, cx, cy)
                if c is not None:
                    big[dy * 256:(dy + 1) * 256, dx * 256:(dx + 1) * 256] = c
    h = nanmean2x2(big)
    if np.isnan(h).any():
        xs, ys = T.pixel_centres(z, tx, ty)
        fill = bilinear_from_mosaic(_mm(fill_npy), fill_z, xs, ys)
        m = np.isnan(h)
        h[m] = fill[m]
    return tx, ty, T.write_tile(Path(root), z, tx, ty, h)


# --------------------------------------------------------------------------- driver
def run_levels(pool, root: Path, paths: dict[int, Path], levels: list[int], force: bool) -> dict[int, list]:
    res = {}
    for z in sorted(levels):
        if z not in paths:
            continue
        n = 1 << z
        keys = [(tx, ty) for ty in range(n) for tx in range(n)]
        chunks = [keys[i:i + 64] for i in range(0, len(keys), 64)]
        t0 = time.time()
        out = []
        for part in pool.imap_unordered(_write_level_tiles, [(z, str(paths[z]), str(root), c, force) for c in chunks]):
            out.extend(part)
        out.sort()
        res[z] = out
        log("dem_tiles", f"{root.name} z{z}: {len(out)} tiles, {sum(o[2] for o in out) / 1e6:.1f} MB, "
                         f"{time.time() - t0:.1f} s")
    return res


def site_dems() -> list[Path]:
    return sorted(p for p in SITES_DIR.glob("*/*_surf.tif") if p.is_file())


def site_bboxes(paths: list[Path]) -> dict[str, list[float]]:
    import rasterio

    out = {}
    for p in paths:
        with rasterio.open(p) as ds:
            _check_crs(ds)
            if grid_offset(ds, 9) is None:
                raise SystemExit(f"{p.name}: 5 m site DEM not aligned with LPS-2560 z9")
            b = ds.bounds
            out[p.parent.name] = [b.left, b.bottom, b.right, b.top]
    return out


def existing_level(root: Path, z: int) -> list[tuple[int, int, int]]:
    d = root / str(z)
    return sorted((int(p.parent.name), int(p.stem), p.stat().st_size) for p in d.glob("*/*.bin"))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--levels", nargs="*", type=int, default=list(range(10)))
    ap.add_argument("--force", action="store_true", help="rewrite existing tiles of the selected levels")
    ap.add_argument("--workers", type=int, default=max(1, min(8, (mp.cpu_count() or 2) - 2)))
    ap.add_argument("--no-err", action="store_true")
    a = ap.parse_args(argv)
    t_start = time.time()
    if not SRC80.exists():
        raise SystemExit(f"missing {SRC80} - python pipeline/jobs/download.py --only ldem-80s-80m")
    dem_root = WEB / "dem"
    err_root = WEB / "err"
    dem_root.mkdir(parents=True, exist_ok=True)
    levels = set(a.levels)

    z5 = build_mosaic(SRC80, 5, "dem_z5", force=False)
    paths = build_down_chain(z5, 5, "dem", force=False)
    have40 = SRC40.exists()
    if have40:
        paths[6] = build_mosaic(SRC40, 6, "dem_z6", force=False)
    else:
        log("dem_tiles", "40 m DEM not present yet -> z6 skipped (rerun with --levels 6 7 8 9 --force later)")
    fill_z = 6 if have40 else 5
    fill_npy = str(paths[fill_z])
    force_sites = a.force
    old_index = dem_root / "index.json"
    if old_index.exists():
        old_fill = json.loads(old_index.read_text()).get("fillLevel")
        if old_fill is not None and old_fill != fill_z:
            log("dem_tiles", f"fill level changed z{old_fill} -> z{fill_z}: rewriting z7-z9")
            force_sites = True

    ctx = mp.get_context("spawn")
    levels_meta = {}
    with ctx.Pool(a.workers) as pool:
        done = run_levels(pool, dem_root, paths, [z for z in levels if z <= 6], a.force)
        for z in range(0, 7):
            if z not in done and (dem_root / str(z)).exists():
                done[z] = existing_level(dem_root, z)
        # ---- 5 m sites -> z9, z8, z7
        sites = site_dems()
        bboxes = site_bboxes(sites) if sites else {}
        if sites and {7, 8, 9} & levels:
            t0 = time.time()
            cover: dict[tuple[int, int], list[str]] = {}
            for p in sites:
                b = bboxes[p.parent.name]
                for tx, ty in T.tiles_in_bbox(9, b[0] + 0.01, b[1] + 0.01, b[2] - 0.01, b[3] - 0.01):
                    cover.setdefault((tx, ty), []).append(str(p))
            tasks = [(tx, ty, sp, fill_npy, fill_z, str(dem_root), force_sites) for (tx, ty), sp in sorted(cover.items())]
            out9 = sorted(pool.imap_unordered(_write_site_tile, tasks, chunksize=8))
            done[9] = [(tx, ty, nb) for tx, ty, nb, _ in out9]
            log("dem_tiles", f"z9: {len(out9)} tiles from {len(sites)} site DEMs, "
                             f"{sum(o[2] for o in out9) / 1e6:.1f} MB, {time.time() - t0:.1f} s")
            for z in (8, 7):
                t0 = time.time()
                parents: dict[tuple[int, int], list] = {}
                for tx, ty, _ in done[z + 1]:
                    parents.setdefault((tx // 2, ty // 2), []).append((tx, ty))
                tasks = [(z, tx, ty, ch, fill_npy, fill_z, str(dem_root), force_sites)
                         for (tx, ty), ch in sorted(parents.items())]
                done[z] = sorted(pool.map(_write_parent_tile, tasks, chunksize=4))
                log("dem_tiles", f"z{z}: {len(done[z])} tiles, {sum(o[2] for o in done[z]) / 1e6:.1f} MB, "
                                 f"{time.time() - t0:.1f} s")
        else:
            for z in (7, 8, 9):
                if (dem_root / str(z)).exists():
                    done[z] = existing_level(dem_root, z)
        # ---- error tiles
        err_meta = {"available": False, "maxZ": 5, "path": "err"}
        if not a.no_err and SRC80_ERR.exists():
            e5 = build_mosaic(SRC80_ERR, 5, "err_z5", force=False)
            epaths = build_down_chain(e5, 5, "err", force=False)
            err_root.mkdir(parents=True, exist_ok=True)
            edone = run_levels(pool, err_root, epaths, [0, 1, 2, 3, 4, 5], a.force)
            write_json(err_root / "index.json", {
                "version": 1, "grid": T.GRID, "kind": "height-error-1sigma-m",
                "levels": [{"z": z, "res": T.res(z), "source": SRC80_ERR.name if z == 5 else "2x2 mean",
                            "native": z == 5, "tiles": [[tx, ty] for tx, ty, _ in edone[z]]} for z in sorted(edone)],
                "generated": now_iso(), "job": JOB})
            err_meta["available"] = True
            record_tree("err", err_root, JOB)
        elif (err_root / "index.json").exists():
            err_meta["available"] = True

    z5a = np.load(paths[5], mmap_mode="r")
    hr = [float(np.nanmin(z5a)), float(np.nanmax(z5a))]
    src_name = {5: SRC80.name, 6: SRC40.name}
    for z, items in sorted(done.items()):
        if not items:
            continue
        if z == 9:
            src, native = "5 m site DEMs (" + ", ".join(sorted(bboxes)) + f"); gaps filled from z{fill_z} bilinear", True
        elif z in (7, 8):
            src, native = f"2x2 mean of z{z + 1}; gaps filled from z{fill_z} bilinear", False
        elif z in src_name:
            src, native = src_name[z], True
        else:
            src, native = "2x2 mean of z" + str(z + 1) + " (nanmean chain from z5)", False
        levels_meta[z] = {"z": z, "res": T.res(z), "source": src, "native": native,
                          "tiles": [[tx, ty] for tx, ty, _ in items]}
    index = {
        "version": 1, "grid": T.GRID,
        "coverage": {"maxRho": 304000, "minLatDeg": -80.0, "dataSquare": [-304000, -304000, 304000, 304000]},
        "levels": [levels_meta[z] for z in sorted(levels_meta)],
        "heightRange": [round(hr[0], 1), round(hr[1], 1)],
        "error": err_meta,
        "z6": {"available": have40, "note": "" if have40 else "40 m source not downloaded yet; z7-z9 gaps filled from z5"},
        "sites": {k: {"bbox": v} for k, v in sorted(bboxes.items())},
        "fillLevel": fill_z,
        "generated": now_iso(), "job": JOB,
    }
    write_json(dem_root / "index.json", index)
    total = sum(sum(o[2] for o in v) for v in done.values())
    ntiles = sum(len(v) for v in done.values())
    record_tree("dem", dem_root, JOB)
    log("dem_tiles", f"done: {ntiles} tiles, {total / 1e6:.1f} MB in {time.time() - t_start:.1f} s")


if __name__ == "__main__":
    main()
