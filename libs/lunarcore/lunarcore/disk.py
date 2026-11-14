"""Visible fraction of a body's disk above the terrain horizon (METRICS.md "Visible disk fraction").

Two methods:

* ``fraction_straight(z)`` - GPU/map method, straight horizon edge at the disk centre azimuth:
  ``z = (el - H(az)) / r`` clamped to [-1, 1], ``f = 1 - (acos z - z sqrt(1 - z^2)) / pi``.
* ``fraction_slices(...)`` - CPU/site method (ADR-101): the disk (radius r, centre az/el) is cut into
  16 equal-width vertical slices ``[a_i, a_i + w]``, ``w = 2r/16``; slice i (centre offset ``d_i``) sees the
  horizon height ``H_i = H(az + d_i / cos el)`` (profile linearly interpolated, periodic) and its visible
  part above the line ``y = H_i - el`` is integrated *exactly* with
  ``G(x) = (x sqrt(r^2 - x^2) + r^2 asin(x/r)) / 2`` (area under the chord-length function
  ``2 sqrt(r^2 - x^2)``). ``f = sum(area_i) / (pi r^2)``. For a flat horizon this equals the straight-edge
  formula to machine precision.

Angles in degrees; the disk is treated in the local tangent plane of the sky (r < 1 deg).
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit

NSLICES = 16


@njit(cache=True)
def fraction_straight(z):
    if z >= 1.0:
        return 1.0
    if z <= -1.0:
        return 0.0
    return 1.0 - (math.acos(z) - z * math.sqrt(1.0 - z * z)) / math.pi


@njit(cache=True)
def _G(x, r):
    if x > r:
        x = r
    elif x < -r:
        x = -r
    return 0.5 * (x * math.sqrt(max(r * r - x * x, 0.0)) + r * r * math.asin(x / r))


@njit(cache=True)
def slice_area(a, b, y0, r):
    """Area of {a <= x <= b, y >= y0, x^2 + y^2 <= r^2} (disk centred at the origin)."""
    if b <= a or y0 >= r:
        return 0.0
    if y0 <= -r:
        return 2.0 * (_G(b, r) - _G(a, r))
    w = math.sqrt(r * r - y0 * y0)
    area = 0.0
    lo = max(a, -w)
    hi = min(b, w)
    if hi > lo:
        area += (_G(hi, r) - _G(lo, r)) - y0 * (hi - lo)
    if y0 < 0.0:  # outside |x| < w the whole chord is above the line
        if a < -w:
            area += 2.0 * (_G(min(b, -w), r) - _G(a, r))
        if b > w:
            area += 2.0 * (_G(b, r) - _G(max(a, w), r))
    return area


@njit(cache=True)
def interp_profile(prof, az_deg):
    """Linear, periodic interpolation of a horizon profile sampled at k*360/naz."""
    naz = prof.shape[0]
    a = (az_deg % 360.0) * naz / 360.0
    k = int(math.floor(a))
    f = a - k
    k = k % naz
    return prof[k] * (1.0 - f) + prof[(k + 1) % naz] * f


@njit(cache=True)
def fraction_slices(prof, az_deg, el_deg, r_deg, nslices=NSLICES):
    if r_deg <= 0.0:
        return 1.0 if el_deg > interp_profile(prof, az_deg) else 0.0
    cosel = max(math.cos(math.radians(el_deg)), 1e-6)
    w = 2.0 * r_deg / nslices
    total = 0.0
    for i in range(nslices):
        a = -r_deg + i * w
        d = a + 0.5 * w
        h = interp_profile(prof, az_deg + d / cosel)
        total += slice_area(a, a + w, h - el_deg, r_deg)
    f = total / (math.pi * r_deg * r_deg)
    if f < 0.0:
        return 0.0
    if f > 1.0:
        return 1.0
    return f


@njit(cache=True)
def fractions_slices(prof, az, el, r, nslices=NSLICES):
    out = np.empty(az.shape[0])
    for i in range(az.shape[0]):
        out[i] = fraction_slices(prof, az[i], el[i], r[i], nslices)
    return out


@njit(cache=True)
def fractions_straight(prof, az, el, r):
    out = np.empty(az.shape[0])
    for i in range(az.shape[0]):
        out[i] = fraction_straight((el[i] - interp_profile(prof, az[i])) / r[i])
    return out


def fraction_flat(z: float) -> float:
    """Convenience: straight-edge fraction for a flat horizon (python float)."""
    return float(fraction_straight(float(z)))
