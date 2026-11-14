"""Analytic synthetic terrains for tests and golden vectors (heights as functions of SPS x, y).

Spec dictionaries (also used in tests/golden/horizon.json):

* ``{"type": "flat", "h": h}``                                    h(x, y) = h
* ``{"type": "ramp", "h0": h0, "gx": gx, "gy": gy}``              h(x, y) = h0 + gx*x + gy*y
* ``{"type": "gauss", "base": b, "h0": A, "sigma": s, "xc": xc, "yc": yc}``
  h(x, y) = b + A*exp(-((x-xc)^2 + (y-yc)^2) / (2 s^2))
"""

from __future__ import annotations

import math

import numpy as np

from .geo import R_MOON, terrain_elevation_deg, xy_to_unit


def dem_function(spec: dict):
    t = spec["type"]
    if t == "flat":
        h = float(spec["h"])
        return lambda X, Y: np.full(np.shape(X), h, dtype=np.float64)
    if t == "ramp":
        h0, gx, gy = float(spec["h0"]), float(spec["gx"]), float(spec["gy"])
        return lambda X, Y: h0 + gx * np.asarray(X, dtype=np.float64) + gy * np.asarray(Y, dtype=np.float64)
    if t == "gauss":
        b, a, s = float(spec["base"]), float(spec["h0"]), float(spec["sigma"])
        xc, yc = float(spec["xc"]), float(spec["yc"])

        def f(X, Y):
            X = np.asarray(X, dtype=np.float64)
            Y = np.asarray(Y, dtype=np.float64)
            return b + a * np.exp(-((X - xc) ** 2 + (Y - yc) ** 2) / (2.0 * s * s))

        return f
    raise ValueError(f"unknown synthetic DEM type {t!r}")


def ray_max_elevation(spec: dict, x0: float, y0: float, h_t: float, h_o: float, az_deg: float,
                      dmax: float = 300e3, R: float = R_MOON) -> tuple[float, float]:
    """Reference horizon elevation (deg) and grid distance of its maximum along the straight grid ray of
    azimuth az, by dense sampling of the analytic surface (0.25 m steps to 10 km, 2 m beyond)."""
    fn = dem_function(spec)
    lam = math.atan2(x0, y0)
    a = math.radians(az_deg)
    dx, dy = math.sin(lam + a), math.cos(lam + a)
    d = np.concatenate([np.arange(0.25, 10000.0, 0.25), np.arange(10000.0, dmax, 2.0)])
    X = x0 + d * dx
    Y = y0 + d * dy
    e = terrain_elevation_deg(xy_to_unit(x0, y0, R), h_t, h_o, xy_to_unit(X, Y, R), fn(X, Y), R)
    k = int(np.argmax(e))
    return float(e[k]), float(d[k])


def azimuth_towards(x0: float, y0: float, x1: float, y1: float) -> float:
    """Azimuth (deg, clockwise from local North) of the grid direction from (x0, y0) to (x1, y1)."""
    lam = math.degrees(math.atan2(x0, y0))
    return (math.degrees(math.atan2(x1 - x0, y1 - y0)) - lam) % 360.0
