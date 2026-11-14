"""Terrain horizon profiles and region horizon maps (METRICS.md "Horizon profile H(A)", DATA.md §7).

For each azimuth A a ray is marched in the projection plane from the observer along the grid direction
``(sin(lon+A), cos(lon+A))`` with geometric steps ``s_{k+1} = s_k (1 + alpha)``, ``s_0 = 0.5 res_finest``,
out to ``dmax`` (grid metres) or the end of the DEM. Heights come from the clipmap sampler in
``lunarcore.tiles`` (level = coarsest with res <= max(s alpha, res_finest), bilinear). The elevation of a
terrain sample is exact on the sphere and cancellation-free:

    c = |u_t - u_o|,  dv = (h - h_t - h_o) - (R + h) c^2 / 2,  dh = (R + h) c sqrt(1 - c^2/4),  tan e = dv/dh

``H(A) = max_k e_k`` (>= -90 deg). The march stops early once no remaining sample can exceed the
current maximum given the pyramid's maximum height (exact pruning, identical results).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numba import njit, prange

from .geo import R_MOON
from .tiles import RES0, Pyramid, TileStore, sample_clip, sample_level

ALPHA_CPU = 0.01
ALPHA_GPU = 0.02
DMAX = 300e3
NAZ_SITE = 1440
NAZ_MAP = 64
MAP_E0 = -5.0
MAP_DE = 0.1


@njit(cache=True)
def _unit(x, y, R):
    q = (x * x + y * y) / (4.0 * R * R)
    d = 1.0 + q
    return (y / R) / d, (x / R) / d, -(1.0 - q) / d


@njit(cache=True)
def _march(index, stack, zfine, x0, y0, h_t, h_o, az_rad, alpha, dmax, R, hmax, hmin):
    """One ray. Returns (tan e_max, chord c at the max, x*, y*); tan = -inf when no sample."""
    lam = math.atan2(x0, y0)
    ux, uy, uz = _unit(x0, y0, R)
    dx = math.sin(lam + az_rad)
    dy = math.cos(lam + az_rad)
    res_f = RES0 / (1 << zfine)
    s = 0.5 * res_f
    best = -np.inf
    bc = np.nan
    bx = np.nan
    by = np.nan
    hobs = h_t + h_o
    hmax = hmax + 0.5  # pad: bilinear results may exceed the stored extremes by rounding
    hmin = hmin - 0.5
    rlo = R + hmin
    rhi = R + hmax
    while s <= dmax:
        x = x0 + s * dx
        y = y0 + s * dy
        target = s * alpha
        if target < res_f:
            target = res_f
        h = sample_clip(index, stack, zfine, target, x, y)
        if h != h:
            break
        tx, ty, tz = _unit(x, y, R)
        ex = tx - ux
        ey = ty - uy
        ez = tz - uz
        c2 = ex * ex + ey * ey + ez * ez
        c = math.sqrt(c2)
        rh = R + h
        dv = (h - hobs) - rh * c2 / 2.0
        dh = rh * c * math.sqrt(1.0 - c2 / 4.0)
        if dh > 0.0:
            t = dv / dh
            if t > best:
                best = t
                bc = c
                bx = x
                by = y
            # exact pruning: c grows monotonically along the ray
            num = (hmax - hobs) - rlo * c2 / 2.0
            den = (rlo if num >= 0.0 else rhi) * c * math.sqrt(1.0 - c2 / 4.0)
            if den > 0.0 and num / den < best - 1e-12:
                break
        s *= 1.0 + alpha
    return best, bc, bx, by


@njit(cache=True)
def profile_numba(index, stack, zfine, x0, y0, h_t, h_o, naz, alpha, dmax, R, hmax, hmin):
    elev = np.empty(naz)
    dist = np.empty(naz)
    px = np.empty(naz)
    py = np.empty(naz)
    for a in range(naz):
        az = 2.0 * math.pi * a / naz
        best, bc, bx, by = _march(index, stack, zfine, x0, y0, h_t, h_o, az, alpha, dmax, R, hmax, hmin)
        if best == -np.inf:
            elev[a] = -90.0
            dist[a] = np.nan
        else:
            elev[a] = math.degrees(math.atan(best))
            dist[a] = R * 2.0 * math.asin(min(1.0, bc / 2.0))
        px[a] = bx
        py[a] = by
    return elev, dist, px, py


@njit(cache=True)
def terrain_height(index, stack, zfine, x, y):
    return sample_level(index, stack, zfine, x, y)


@dataclass
class Horizon:
    naz: int
    elev_deg: np.ndarray  # H(A) at A = k*360/naz
    dist_m: np.ndarray  # surface distance of the horizon-defining point
    sigma_deg: np.ndarray | None  # 1-sigma from height error tiles (None when unavailable)
    h_terrain: float
    zfine: int
    px: np.ndarray
    py: np.ndarray

    def to_json(self, decimals: int = 4) -> dict:
        def r(a):
            return [None if not np.isfinite(v) else round(float(v), decimals) for v in a]

        out = {"naz": self.naz, "elevDeg": r(self.elev_deg), "distKm": r(self.dist_m / 1000.0),
               "hTerrain": round(self.h_terrain, 2), "finestRes": RES0 / (1 << self.zfine)}
        if self.sigma_deg is not None:
            out["sigmaDeg"] = r(self.sigma_deg)
        return out


def profile_from_pyramid(pyr: Pyramid, zfine: int, x: float, y: float, h_obs: float = 2.0, naz: int = NAZ_SITE,
                         alpha: float = ALPHA_CPU, dmax: float = DMAX, R: float = R_MOON,
                         h_terrain: float | None = None) -> Horizon:
    if zfine < 0:
        raise ValueError("observer outside DEM coverage")
    h_t = float(terrain_height(pyr.index, pyr.stack, zfine, float(x), float(y))) if h_terrain is None else h_terrain
    if not math.isfinite(h_t):
        raise ValueError("no terrain height at the observer")
    elev, dist, px, py = profile_numba(pyr.index, pyr.stack, zfine, float(x), float(y), h_t, float(h_obs), int(naz),
                                       float(alpha), float(dmax), float(R), max(pyr.hmax, h_t), min(pyr.hmin, h_t))
    return Horizon(naz=naz, elev_deg=elev, dist_m=dist, sigma_deg=None, h_terrain=h_t, zfine=zfine, px=px, py=py)


def ray_elevation(pyr: Pyramid, zfine: int, x: float, y: float, h_t: float, h_o: float, az_deg: float,
                  alpha: float = ALPHA_CPU, dmax: float = DMAX, R: float = R_MOON) -> tuple[float, float]:
    """Horizon elevation (deg) and surface distance (m) for one azimuth."""
    best, bc, _, _ = _march(pyr.index, pyr.stack, zfine, float(x), float(y), float(h_t), float(h_o),
                            math.radians(az_deg), float(alpha), float(dmax), float(R), max(pyr.hmax, h_t),
                            min(pyr.hmin, h_t))
    if best == -np.inf:
        return -90.0, float("nan")
    return math.degrees(math.atan(best)), R * 2.0 * math.asin(min(1.0, bc / 2.0))


def site_horizon(store: TileStore, x: float, y: float, h_obs: float = 2.0, naz: int = NAZ_SITE,
                 alpha: float = ALPHA_CPU, dmax: float = DMAX, err_store: TileStore | None = None,
                 zmax: int = 9) -> Horizon:
    """1440-azimuth horizon of an SPS point from the tile store (+ 1-sigma band from error tiles)."""
    pyr, zfine = store.site_pyramid(x, y, dmax, alpha, zmax)
    hz = profile_from_pyramid(pyr, zfine, x, y, h_obs, naz, alpha, dmax)
    if err_store is not None and err_store.exists:
        hz.sigma_deg = horizon_sigma(err_store, hz)
    return hz


def horizon_sigma(err_store: TileStore, hz: Horizon) -> np.ndarray:
    """sigma_H(A) = atan(sigma_z(p*) / D(A)) with sigma_z from the error pyramid (finest level <= 5)."""
    zs = [z for z in err_store.levels() if z <= 5]
    if not zs:
        return np.full(hz.naz, np.nan)
    z = max(zs)
    out = np.full(hz.naz, np.nan)
    from .tiles import tile_of

    keys = {(z, *tile_of(z, float(x), float(y))) for x, y in zip(hz.px, hz.py) if np.isfinite(x)}
    pyr = err_store.pyramid(sorted(keys))
    for a in range(hz.naz):
        if not np.isfinite(hz.px[a]) or not np.isfinite(hz.dist_m[a]) or hz.dist_m[a] <= 0:
            continue
        sz = float(sample_level(pyr.index, pyr.stack, z, float(hz.px[a]), float(hz.py[a])))
        if np.isfinite(sz) and sz != -np.inf:
            out[a] = math.degrees(math.atan(sz / hz.dist_m[a]))
    return out


# --------------------------------------------------------------------------- region maps
@njit(cache=True)
def encode_map_elev(e_deg):
    v = round((e_deg - MAP_E0) / MAP_DE)
    if v < 0:
        return 0
    if v > 255:
        return 255
    return int(v)


def decode_map(v: np.ndarray) -> np.ndarray:
    return MAP_E0 + MAP_DE * np.asarray(v, dtype=np.float32)


@njit(parallel=True, cache=True)
def region_rows(index, stack, zfine, xs, ys, h_o, naz, alpha, dmax, R, hmax, hmin, out, hterr):
    """Fill out[i, j, a] (uint8 elevation code) and hterr[i, j] for grid rows ys x columns xs."""
    ny = ys.shape[0]
    nx = xs.shape[0]
    for i in prange(ny):
        for j in range(nx):
            x = xs[j]
            y = ys[i]
            h_t = sample_level(index, stack, zfine, x, y)
            if h_t != h_t or h_t == -np.inf:
                hterr[i, j] = np.nan
                for a in range(naz):
                    out[i, j, a] = 255
                continue
            hterr[i, j] = h_t
            for a in range(naz):
                az = 2.0 * math.pi * a / naz
                best, bc, bx, by = _march(index, stack, zfine, x, y, h_t, h_o, az, alpha, dmax, R, hmax, hmin)
                if best == -np.inf:
                    out[i, j, a] = 0
                else:
                    out[i, j, a] = encode_map_elev(math.degrees(math.atan(best)))
