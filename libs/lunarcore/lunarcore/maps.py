"""Grid kernels over region horizon maps: interval illumination / Earth visibility / longest dark run.

Map path = straight-edge disk fraction with the horizon interpolated linearly between the naz bins of the
uint8 horizon map (e = -5 + 0.1 v), exactly like the GPU map engine (METRICS.md). Sun and Earth directions
are topocentric for every cell (P = (R + h + h_obs) u).
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

from .disk import fraction_straight
from .geo import EARTH_RADIUS_KM, R_MOON, SUN_RADIUS_KM
from .horizon import MAP_DE, MAP_E0


@njit(cache=True)
def _interp_u8(prof, az_deg):
    naz = prof.shape[0]
    a = (az_deg % 360.0) * naz / 360.0
    k = int(math.floor(a))
    f = a - k
    k = k % naz
    v0 = MAP_E0 + MAP_DE * prof[k]
    v1 = MAP_E0 + MAP_DE * prof[(k + 1) % naz]
    return v0 * (1.0 - f) + v1 * f


@njit(cache=True)
def _frame(x, y, R):
    q = (x * x + y * y) / (4.0 * R * R)
    d = 1.0 + q
    ux = (y / R) / d
    uy = (x / R) / d
    uz = -(1.0 - q) / d
    lon = math.atan2(x, y)
    so = math.sin(lon)
    co = math.cos(lon)
    sl = uz
    cl = math.sqrt(ux * ux + uy * uy)
    return ux, uy, uz, -so, co, -sl * co, -sl * so, cl


@njit(cache=True)
def _azel(vx, vy, vz, ux, uy, uz, ex, ey, nx_, ny_, nz_):
    d = math.sqrt(vx * vx + vy * vy + vz * vz)
    vu = (vx * ux + vy * uy + vz * uz) / d
    if vu > 1.0:
        vu = 1.0
    elif vu < -1.0:
        vu = -1.0
    el = math.degrees(math.asin(vu))
    az = math.degrees(math.atan2(vx * ex + vy * ey, vx * nx_ + vy * ny_ + vz * nz_)) % 360.0
    return az, el, d


@njit(parallel=True, cache=True)
def interval_maps(hmap, hterr, xs, ys, S, E, h_obs, dte, dark_f, out_illum, out_dark, out_earth, out_pv):
    """Per cell: mean f_sun, longest run (samples) of f_sun < dark_f, share of samples with f_earth >= dte and
    the vertical-panel power proxy mean f_sun cos(el) (AU/d)^2."""
    ny = hterr.shape[0]
    nx = hterr.shape[1]
    n = S.shape[0]
    R = R_MOON
    au = 149597870.7
    for i in prange(ny):
        for j in range(nx):
            h = hterr[i, j]
            if h != h:
                out_illum[i, j] = np.nan
                out_dark[i, j] = np.nan
                out_earth[i, j] = np.nan
                out_pv[i, j] = np.nan
                continue
            ux, uy, uz, ex, ey, nx_, ny_, nz_ = _frame(xs[j], ys[i], R)
            pr = (R + h + h_obs) / 1000.0
            px, py, pz = pr * ux, pr * uy, pr * uz
            prof = hmap[i, j]
            acc_s = 0.0
            acc_e = 0.0
            acc_p = 0.0
            run = 0
            best = 0
            for k in range(n):
                az, el, d = _azel(S[k, 0] - px, S[k, 1] - py, S[k, 2] - pz, ux, uy, uz, ex, ey, nx_, ny_, nz_)
                r = math.degrees(math.asin(SUN_RADIUS_KM / d))
                fs = fraction_straight((el - _interp_u8(prof, az)) / r)
                acc_s += fs
                acc_p += fs * math.cos(math.radians(el)) * (au / d) ** 2
                if fs < dark_f:
                    run += 1
                    if run > best:
                        best = run
                else:
                    run = 0
                az, el, d = _azel(E[k, 0] - px, E[k, 1] - py, E[k, 2] - pz, ux, uy, uz, ex, ey, nx_, ny_, nz_)
                r = math.degrees(math.asin(EARTH_RADIUS_KM / d))
                fe = fraction_straight((el - _interp_u8(prof, az)) / r)
                if fe >= dte:
                    acc_e += 1.0
            out_illum[i, j] = acc_s / n
            out_dark[i, j] = best
            out_earth[i, j] = acc_e / n
            out_pv[i, j] = acc_p / n


@njit(parallel=True, cache=True)
def draw_metrics(profiles, sun_az, sun_el, sun_r, earth_az, earth_el, earth_r, dte, dark_f, out_illum, out_dark,
                 out_earth):
    """profiles[m, n_draws, naz] (deg) with per-candidate topocentric tracks [m, T] -> metrics [m, n_draws]."""
    m = profiles.shape[0]
    nd = profiles.shape[1]
    T = sun_az.shape[1]
    for idx in prange(m * nd):
        c = idx // nd
        d = idx % nd
        prof = profiles[c, d]
        naz = prof.shape[0]
        acc_s = 0.0
        acc_e = 0.0
        run = 0
        best = 0
        for k in range(T):
            a = (sun_az[c, k] % 360.0) * naz / 360.0
            i0 = int(math.floor(a))
            f = a - i0
            i0 = i0 % naz
            hh = prof[i0] * (1.0 - f) + prof[(i0 + 1) % naz] * f
            fs = fraction_straight((sun_el[c, k] - hh) / sun_r[c, k])
            acc_s += fs
            if fs < dark_f:
                run += 1
                if run > best:
                    best = run
            else:
                run = 0
            a = (earth_az[c, k] % 360.0) * naz / 360.0
            i0 = int(math.floor(a))
            f = a - i0
            i0 = i0 % naz
            hh = prof[i0] * (1.0 - f) + prof[(i0 + 1) % naz] * f
            if fraction_straight((earth_el[c, k] - hh) / earth_r[c, k]) >= dte:
                acc_e += 1.0
        out_illum[c, d] = acc_s / T
        out_dark[c, d] = best
        out_earth[c, d] = acc_e / T


def run_interval_maps(hmap: np.ndarray, hterr: np.ndarray, xs: np.ndarray, ys: np.ndarray, S: np.ndarray,
                      E: np.ndarray, h_obs: float = 2.0, dte: float = 0.5, dark_f: float = 0.05) -> dict:
    shape = hterr.shape
    out = {k: np.empty(shape, np.float64) for k in ("illum", "darkSamples", "earth", "powerVertical")}
    interval_maps(np.ascontiguousarray(hmap), np.ascontiguousarray(hterr, dtype=np.float64),
                  np.ascontiguousarray(xs, dtype=np.float64), np.ascontiguousarray(ys, dtype=np.float64),
                  np.ascontiguousarray(S, dtype=np.float64), np.ascontiguousarray(E, dtype=np.float64),
                  float(h_obs), float(dte), float(dark_f), out["illum"], out["darkSamples"], out["earth"],
                  out["powerVertical"])
    return out
