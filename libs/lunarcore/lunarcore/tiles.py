"""LPS-2560 DEM tile pyramid: grid math, LDT1 tile codec, file store and numba sampler.

Contract: docs/DATA.md §2.

* origin (top-left) X0 = -327680 m, Y0 = +327680 m, tile T = 256 px, res(z) = 2560 / 2^z;
* tile (z, tx, ty) covers x in [X0 + tx*T*res, X0 + (tx+1)*T*res], y in [Y0 - (ty+1)*T*res, Y0 - ty*T*res],
  row 0 is the top; pixel (i, j) centre x = X0 + (tx*T + j + 0.5)*res, y = Y0 - (ty*T + i + 0.5)*res;
* file = gzip(payload); payload = b"LDT1", f32 base, f32 scale, u16 width, u16 height, i16[h][w]
  (little-endian), -32768 = nodata, height = base + scale * value.

Sampling rule (METRICS.md "Horizon profile"): bilinear inside a level; the level used for a
target spacing ``r`` is the *coarsest* level whose resolution is still <= r (never finer than the
finest level available at the observer, ``zfine``); when that level has no tile at the point, the next
coarser level is used (z7-z9 tiles exist only around the 5 m sites).
"""

from __future__ import annotations

import gzip
import json
import math
import struct
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numba import njit

X0 = -327680.0
Y0 = 327680.0
TILE = 256
RES0 = 2560.0
ZMAX = 9
NODATA = -32768
MAGIC = b"LDT1"
HEADER = struct.Struct("<4sffHH")  # 16 bytes
LEVEL_OFFSETS = np.array([(4**z - 1) // 3 for z in range(ZMAX + 2)], dtype=np.int64)
INDEX_SIZE = int(LEVEL_OFFSETS[ZMAX + 1])
GRID = {
    "name": "LPS-2560",
    "x0": int(X0),
    "y0": int(Y0),
    "tileSize": TILE,
    "res0": int(RES0),
    "radius": 1737400,
    "proj4": "+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
}


# --------------------------------------------------------------------------- grid math
def res(z: int) -> float:
    return RES0 / (1 << z)


def tiles_per_side(z: int) -> int:
    return 1 << z


def tile_bounds(z: int, tx: int, ty: int) -> tuple[float, float, float, float]:
    """(xmin, ymin, xmax, ymax) of a tile in SPS metres."""
    span = TILE * res(z)
    xmin = X0 + tx * span
    ymax = Y0 - ty * span
    return xmin, ymax - span, xmin + span, ymax


def tile_of(z: int, x: float, y: float) -> tuple[int, int]:
    span = TILE * res(z)
    return int(math.floor((x - X0) / span)), int(math.floor((Y0 - y) / span))


def pixel_centres(z: int, tx: int, ty: int) -> tuple[np.ndarray, np.ndarray]:
    """1-D arrays: x of the 256 columns and y of the 256 rows of a tile."""
    r = res(z)
    j = np.arange(TILE, dtype=np.float64)
    xs = X0 + (tx * TILE + j + 0.5) * r
    ys = Y0 - (ty * TILE + j + 0.5) * r
    return xs, ys


def tiles_in_bbox(z: int, xmin: float, ymin: float, xmax: float, ymax: float) -> list[tuple[int, int]]:
    n = tiles_per_side(z)
    tx0, ty0 = tile_of(z, xmin, ymax)
    tx1, ty1 = tile_of(z, xmax, ymin)
    out = []
    for ty in range(max(0, ty0), min(n - 1, ty1) + 1):
        for tx in range(max(0, tx0), min(n - 1, tx1) + 1):
            out.append((tx, ty))
    return out


def tile_min_rho(z: int, tx: int, ty: int) -> float:
    """Smallest distance from the pole to any point of the tile."""
    xmin, ymin, xmax, ymax = tile_bounds(z, tx, ty)
    cx = min(max(0.0, xmin), xmax)
    cy = min(max(0.0, ymin), ymax)
    return math.hypot(cx, cy)


# --------------------------------------------------------------------------- codec
def quantize(h: np.ndarray) -> tuple[float, float, np.ndarray]:
    """Per-tile base/scale quantisation (float32 base/scale as stored, int16 values)."""
    h = np.asarray(h, dtype=np.float64)
    valid = np.isfinite(h)
    if not valid.any():
        return 0.0, 0.01, np.full(h.shape, NODATA, dtype=np.int16)
    mn = float(h[valid].min())
    mx = float(h[valid].max())
    base = float(np.float32((mn + mx) / 2.0))
    scale = float(np.float32(max(0.01, (mx - mn) / 65000.0)))
    v = np.zeros(h.shape, dtype=np.float64)
    v[valid] = np.round((h[valid] - base) / scale)
    v = np.clip(v, -32767, 32767).astype(np.int16)
    v[~valid] = NODATA
    return base, scale, v


def encode_tile(h: np.ndarray, compresslevel: int = 6) -> bytes:
    """Height array [256][256] (NaN = nodata) -> gzip(LDT1 payload)."""
    hh, ww = h.shape
    base, scale, v = quantize(h)
    payload = HEADER.pack(MAGIC, base, scale, ww, hh) + v.astype("<i2", copy=False).tobytes()
    return gzip.compress(payload, compresslevel=compresslevel, mtime=0)


def decode_tile(data: bytes) -> np.ndarray:
    """gzip(LDT1) or raw LDT1 bytes -> float32 [h][w] heights, NaN = nodata."""
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    magic, base, scale, w, h = HEADER.unpack_from(data, 0)
    if magic != MAGIC:
        raise ValueError("not an LDT1 tile")
    v = np.frombuffer(data, dtype="<i2", count=w * h, offset=HEADER.size).reshape(h, w)
    out = (base + scale * v.astype(np.float64)).astype(np.float32)
    out[v == NODATA] = np.nan
    return out


def tile_path(root: Path, z: int, tx: int, ty: int) -> Path:
    return Path(root) / str(z) / str(tx) / f"{ty}.bin"


def write_tile(root: Path, z: int, tx: int, ty: int, h: np.ndarray) -> int:
    p = tile_path(root, z, tx, ty)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = encode_tile(h)
    tmp = p.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(p)
    return len(data)


def read_tile(root: Path, z: int, tx: int, ty: int) -> np.ndarray | None:
    p = tile_path(root, z, tx, ty)
    if not p.exists():
        return None
    return decode_tile(p.read_bytes())


# --------------------------------------------------------------------------- numba sampler
@njit(cache=True)
def _pix(index, stack, z, i, j):
    """Height of global pixel (row i, col j) at level z; NaN = nodata/outside, -inf = tile missing."""
    n = 1 << z
    nn = n * 256
    if i < 0 or j < 0 or i >= nn or j >= nn:
        return np.nan
    slot = index[LEVEL_OFFSETS[z] + (i >> 8) * n + (j >> 8)]
    if slot < 0:
        return -np.inf
    return stack[slot, i & 255, j & 255]


@njit(cache=True)
def sample_level(index, stack, z, x, y):
    """Bilinear height at level z (pixel-is-area). NaN = nodata, -inf = no tile at this level."""
    r = RES0 / (1 << z)
    gx = (x - X0) / r - 0.5
    gy = (Y0 - y) / r - 0.5
    j0 = int(math.floor(gx))
    i0 = int(math.floor(gy))
    fx = gx - j0
    fy = gy - i0
    acc = 0.0
    wsum = 0.0
    for di in range(2):
        wy = fy if di == 1 else 1.0 - fy
        for dj in range(2):
            wx = fx if dj == 1 else 1.0 - fx
            v = _pix(index, stack, z, i0 + di, j0 + dj)
            if v == -np.inf:
                return -np.inf
            if v != v:  # NaN
                continue
            w = wx * wy
            acc += w * v
            wsum += w
    if wsum <= 1e-12:
        return np.nan
    return acc / wsum


@njit(cache=True)
def level_for_spacing(zfine, target_res):
    """Coarsest level with res <= target_res, but not finer than zfine."""
    z = zfine
    while z > 0 and RES0 / (1 << (z - 1)) <= target_res:
        z -= 1
    return z


@njit(cache=True)
def sample_clip(index, stack, zfine, target_res, x, y):
    """Clipmap sample: level from the spacing rule, falling back to coarser levels when missing."""
    z = level_for_spacing(zfine, target_res)
    while z >= 0:
        v = sample_level(index, stack, z, x, y)
        if v == -np.inf:
            z -= 1
            continue
        return v
    return np.nan


@njit(cache=True)
def finest_level_at(index, stack, zmax, x, y):
    for z in range(zmax, -1, -1):
        v = sample_level(index, stack, z, x, y)
        if v != -np.inf and v == v:
            return z
    return -1


# --------------------------------------------------------------------------- pyramid + store
@dataclass
class Pyramid:
    """Tiles packed for numba: ``index[LEVEL_OFFSETS[z] + ty*2^z + tx]`` -> slot in ``stack``."""

    index: np.ndarray  # int32[INDEX_SIZE]
    stack: np.ndarray  # float32[n, 256, 256]
    hmax: float
    hmin: float

    @property
    def ntiles(self) -> int:
        return int(self.stack.shape[0])

    def sample(self, z: int, x: float, y: float) -> float:
        return float(sample_level(self.index, self.stack, z, float(x), float(y)))

    def finest_level(self, x: float, y: float, zmax: int = ZMAX) -> int:
        return int(finest_level_at(self.index, self.stack, zmax, float(x), float(y)))

    def height(self, x: float, y: float, zmax: int = ZMAX) -> float:
        z = self.finest_level(x, y, zmax)
        return float("nan") if z < 0 else self.sample(z, x, y)


def pyramid_from_tiles(tiles: dict[tuple[int, int, int], np.ndarray]) -> Pyramid:
    index = np.full(INDEX_SIZE, -1, dtype=np.int32)
    n = max(1, len(tiles))
    stack = np.full((n, TILE, TILE), np.nan, dtype=np.float32)
    hmax, hmin = -1e9, 1e9
    for slot, ((z, tx, ty), arr) in enumerate(tiles.items()):
        index[LEVEL_OFFSETS[z] + ty * (1 << z) + tx] = slot
        stack[slot] = arr
        if np.isfinite(arr).any():
            hmax = max(hmax, float(np.nanmax(arr)))
            hmin = min(hmin, float(np.nanmin(arr)))
    if hmax < hmin:
        hmax, hmin = 0.0, 0.0
    return Pyramid(index=index, stack=stack, hmax=hmax, hmin=hmin)


def clipmap_keys(x: float, y: float, zfine: int, alpha: float = 0.01, dmax: float = 300e3, zmin: int = 0,
                 available=None) -> list[tuple[int, int, int]]:
    """Tiles a clipmap ray march from (x, y) can touch: level z serves distances < 2 res(z)/alpha."""
    keys = []
    for z in range(zmin, zfine + 1):
        radius = dmax if z == zmin else min(dmax, 2.0 * res(z) / alpha)
        radius = max(radius, 4 * res(z)) + 2 * res(z)
        for tx, ty in tiles_in_bbox(z, x - radius, y - radius, x + radius, y + radius):
            if available is None or available(z, tx, ty):
                keys.append((z, tx, ty))
    return keys


def pyramid_from_function(fn, x: float, y: float, zfine: int, alpha: float = 0.01, dmax: float = 300e3) -> Pyramid:
    """Point-sample an analytic height function ``fn(X, Y)`` (SPS metres, vectorised) at the pixel centres of
    every tile a march from (x, y) can touch (used by tests and golden vectors)."""
    tiles = {}
    for z, tx, ty in clipmap_keys(x, y, zfine, alpha, dmax):
        xs, ys = pixel_centres(z, tx, ty)
        X, Y = np.meshgrid(xs, ys)
        tiles[(z, tx, ty)] = np.asarray(fn(X, Y), dtype=np.float32)
    return pyramid_from_tiles(tiles)


class TileStore:
    """Lazy reader of ``data/web/{dem,err}/{z}/{tx}/{ty}.bin`` with an LRU cache of decoded tiles."""

    def __init__(self, root: Path | str, cache_size: int = 2048):
        self.root = Path(root)
        self.cache_size = cache_size
        self._cache: OrderedDict[tuple[int, int, int], np.ndarray | None] = OrderedDict()
        self.index = None
        self._avail: dict[int, set[tuple[int, int]]] | None = None
        ip = self.root / "index.json"
        if ip.exists():
            self.index = json.loads(ip.read_text())
            self._avail = {lv["z"]: {(int(t[0]), int(t[1])) for t in lv["tiles"]} for lv in self.index["levels"]}

    @property
    def exists(self) -> bool:
        return self.root.is_dir() and bool(self.levels())

    def levels(self) -> list[int]:
        if self._avail is not None:
            return sorted(z for z, s in self._avail.items() if s)
        return sorted(int(p.name) for p in self.root.glob("[0-9]*") if p.is_dir())

    def available(self, z: int, tx: int, ty: int) -> bool:
        if self._avail is not None:
            return (tx, ty) in self._avail.get(z, ())
        return tile_path(self.root, z, tx, ty).exists()

    def tiles(self, z: int) -> list[tuple[int, int]]:
        if self._avail is not None:
            return sorted(self._avail.get(z, ()))
        d = self.root / str(z)
        return sorted((int(p.parent.name), int(p.stem)) for p in d.glob("*/*.bin"))

    def load(self, z: int, tx: int, ty: int) -> np.ndarray | None:
        key = (z, tx, ty)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        arr = read_tile(self.root, z, tx, ty) if self.available(z, tx, ty) else None
        self._cache[key] = arr
        if len(self._cache) > self.cache_size:
            self._cache.popitem(last=False)
        return arr

    def pyramid(self, keys) -> Pyramid:
        tiles = {}
        for z, tx, ty in keys:
            a = self.load(z, tx, ty)
            if a is not None:
                tiles[(z, tx, ty)] = a
        return pyramid_from_tiles(tiles)

    def pyramid_all(self, zmax: int = 6) -> Pyramid:
        keys = [(z, tx, ty) for z in self.levels() if z <= zmax for tx, ty in self.tiles(z)]
        tiles = {}
        for k in keys:
            a = read_tile(self.root, *k)
            if a is not None:
                tiles[k] = a
        return pyramid_from_tiles(tiles)

    def finest_level_at(self, x: float, y: float, zmax: int = ZMAX) -> int:
        for z in sorted(self.levels(), reverse=True):
            if z > zmax:
                continue
            tx, ty = tile_of(z, x, y)
            if self.available(z, tx, ty):
                return z
        return -1

    def site_keys(self, x: float, y: float, dmax: float = 300e3, alpha: float = 0.01,
                  zmax: int = ZMAX) -> list[tuple[int, int, int]]:
        """Tiles a clipmap ray march from (x, y) can touch (incl. fallbacks), level by level."""
        zfine = self.finest_level_at(x, y, zmax)
        if zfine < 0:
            return []
        # coarser disks contain finer ones, so fallbacks to coarser levels are always covered
        return clipmap_keys(x, y, zfine, alpha, dmax, zmin=min(self.levels(), default=0), available=self.available)

    def site_pyramid(self, x: float, y: float, dmax: float = 300e3, alpha: float = 0.01,
                     zmax: int = ZMAX) -> tuple[Pyramid, int]:
        zfine = self.finest_level_at(x, y, zmax)
        return self.pyramid(self.site_keys(x, y, dmax, alpha, zmax)), zfine
