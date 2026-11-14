"""Reference frame, south polar stereographic projection and local ENU frames.

Exactly as docs/DATA.md §1:

* body-fixed frame MOON_ME, reference sphere R = 1737400 m, heights above R;
* projection LUNAR:SPS ``+proj=stere +lat_0=-90 +lon_0=0 +k=1 +R=1737400``:
  ``c = 90° + lat``, ``rho = 2R tan(c/2)``, ``x = rho sin(lon)``, ``y = rho cos(lon)``;
* unit vector without trig: ``q = rho²/4R²``, ``u = ((y/R)/(1+q), (x/R)/(1+q), -(1-q)/(1+q))``;
* local frame: Up = u, East = (-sin lon, cos lon, 0), North = (-sin lat cos lon, -sin lat sin lon, cos lat);
  azimuth clockwise from North, ``az = atan2(v·E, v·N)`` in [0, 360), ``el = asin(v·U/|v|)``.

All functions accept scalars or numpy arrays (broadcasting) and work in float64.
"""

from __future__ import annotations

import math

import numpy as np

R_MOON = 1737400.0  # m, reference sphere of every height in this project
PROJ4_SPS = "+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
SUN_RADIUS_KM = 695700.0
EARTH_RADIUS_KM = 6371.0084
AU_KM = 149597870.7


def ll_to_xy(lat_deg, lon_deg, R: float = R_MOON):
    """(lat, lon east-positive) in degrees -> SPS (x, y) metres."""
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    c = 0.5 * np.pi + lat
    rho = 2.0 * R * np.tan(0.5 * c)
    return rho * np.sin(lon), rho * np.cos(lon)


def xy_to_ll(x, y, R: float = R_MOON):
    """SPS (x, y) metres -> (lat, lon) degrees, lon in (-180, 180]."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    rho = np.hypot(x, y)
    c = 2.0 * np.arctan(rho / (2.0 * R))
    return np.degrees(c) - 90.0, np.degrees(np.arctan2(x, y))


def scale_factor(x, y, R: float = R_MOON):
    """Projection scale factor k = 1 + q (grid distance = k * true distance)."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    return 1.0 + (x * x + y * y) / (4.0 * R * R)


def xy_to_unit(x, y, R: float = R_MOON):
    """Unit vector (MOON_ME) of an SPS point, trig-free. Returns array [..., 3]."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    q = (x * x + y * y) / (4.0 * R * R)
    d = 1.0 + q
    return np.stack([(y / R) / d, (x / R) / d, -(1.0 - q) / d], axis=-1)


def ll_to_unit(lat_deg, lon_deg):
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def enu_basis(lat_deg, lon_deg):
    """(east, north, up) unit vectors in MOON_ME, each array [..., 3]."""
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    sl, cl = np.sin(lat), np.cos(lat)
    so, co = np.sin(lon), np.cos(lon)
    east = np.stack([-so, co, np.zeros_like(so)], axis=-1)
    north = np.stack([-sl * co, -sl * so, cl], axis=-1)
    up = np.stack([cl * co, cl * so, sl], axis=-1)
    return east, north, up


def enu_basis_xy(x, y, R: float = R_MOON):
    lat, lon = xy_to_ll(x, y, R)
    return enu_basis(lat, lon)


def az_el(v, east, north, up):
    """Azimuth (deg, clockwise from North, [0, 360)) and elevation (deg) of vectors v [..., 3]."""
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v, axis=-1)
    ve = np.sum(v * east, axis=-1)
    vn = np.sum(v * north, axis=-1)
    vu = np.sum(v * up, axis=-1)
    el = np.degrees(np.arcsin(np.clip(vu / n, -1.0, 1.0)))
    az = np.mod(np.degrees(np.arctan2(ve, vn)), 360.0)
    return az, el


def grid_north(lon_deg):
    """Local North as a grid direction (sin lon, cos lon): radially away from the pole."""
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    return np.sin(lon), np.cos(lon)


def ray_direction(lon_deg, az_deg):
    """Grid direction of a ray with azimuth A at longitude lon: (sin(lon+A), cos(lon+A))."""
    a = np.radians(np.asarray(lon_deg, dtype=np.float64) + np.asarray(az_deg, dtype=np.float64))
    return np.sin(a), np.cos(a)


def observer_position_km(lat_deg, lon_deg, h_terrain_m, h_obs_m=2.0, R: float = R_MOON):
    """Observer position P = (R + h_t + h_o) u in km (MOON_ME)."""
    u = ll_to_unit(lat_deg, lon_deg)
    r = (R + np.asarray(h_terrain_m, dtype=np.float64) + np.asarray(h_obs_m, dtype=np.float64)) / 1000.0
    return u * np.asarray(r)[..., None]


def great_circle_m(x1, y1, x2, y2, R: float = R_MOON):
    """Surface distance (m on the reference sphere) between two SPS points (chord form)."""
    u1 = xy_to_unit(x1, y1, R)
    u2 = xy_to_unit(x2, y2, R)
    c = np.linalg.norm(u1 - u2, axis=-1)
    return R * 2.0 * np.arcsin(np.clip(c / 2.0, 0.0, 1.0))


def terrain_elevation_deg(u_obs, h_t, h_o, u_tgt, h, R: float = R_MOON):
    """Elevation angle (deg) of a terrain point seen from an observer (METRICS.md, cancellation-free)."""
    c = np.linalg.norm(np.asarray(u_tgt) - np.asarray(u_obs), axis=-1)
    dv = (h - h_t - h_o) - (R + h) * c * c / 2.0
    dh = (R + h) * c * np.sqrt(1.0 - c * c / 4.0)
    return np.degrees(np.arctan2(dv, dh))


def horizon_dip_deg(h_obs_m: float, R: float = R_MOON) -> float:
    """Geometric dip of the horizon of a smooth sphere seen from height h: -acos(R/(R+h))."""
    return -math.degrees(math.acos(R / (R + h_obs_m)))
