import math

import numpy as np
from conftest import golden

from lunarcore import geo


def test_projection_roundtrip():
    rng = np.random.default_rng(1)
    lat = rng.uniform(-90, -60, 500)
    lon = rng.uniform(-180, 180, 500)
    x, y = geo.ll_to_xy(lat, lon)
    lat2, lon2 = geo.xy_to_ll(x, y)
    assert np.allclose(lat2, lat, atol=1e-10)
    dlon = (lon2 - lon + 180) % 360 - 180
    assert np.allclose(dlon, 0, atol=1e-9)


def test_lon0_points_up_lon90_points_right():
    x, y = geo.ll_to_xy(-85.0, 0.0)
    assert abs(x) < 1e-9 and y > 0
    x, y = geo.ll_to_xy(-85.0, 90.0)
    assert x > 0 and abs(y) < 1e-6
    # rho = 2R tan(c/2), c = 5 deg
    assert math.isclose(x, 2 * geo.R_MOON * math.tan(math.radians(2.5)), rel_tol=1e-12)


def test_unit_vector_trig_free_matches_trig():
    rng = np.random.default_rng(2)
    lat = rng.uniform(-90, -70, 200)
    lon = rng.uniform(-180, 180, 200)
    x, y = geo.ll_to_xy(lat, lon)
    assert np.allclose(geo.xy_to_unit(x, y), geo.ll_to_unit(lat, lon), atol=1e-14)


def test_enu_orthonormal_right_handed():
    rng = np.random.default_rng(3)
    for lat, lon in zip(rng.uniform(-89.99, -70, 50), rng.uniform(-180, 180, 50)):
        e, n, u = geo.enu_basis(lat, lon)
        m = np.stack([e, n, u])
        assert np.allclose(m @ m.T, np.eye(3), atol=1e-14)
        assert np.allclose(np.cross(e, n), u, atol=1e-14)


def test_grid_north_points_away_from_pole_and_ray_azimuths():
    lat, lon = -87.3, 61.0
    x, y = geo.ll_to_xy(lat, lon)
    e, n, u = geo.enu_basis(lat, lon)
    for az in (0.0, 37.0, 90.0, 180.0, 271.5):
        dx, dy = geo.ray_direction(lon, az)
        ds = 1.0  # 1 m step along the grid ray
        p1 = geo.xy_to_unit(x + ds * dx, y + ds * dy)
        d = p1 - geo.xy_to_unit(x, y)
        a, el = geo.az_el(d, e, n, u)
        assert abs(((a - az + 180) % 360) - 180) < 1e-4
    nx, ny = geo.grid_north(lon)
    lat2, _ = geo.xy_to_ll(x + 100 * nx, y + 100 * ny)
    assert lat2 > lat  # away from the pole = north


def test_az_el_basic_vectors():
    e, n, u = geo.enu_basis(-88.0, 20.0)
    assert np.allclose(geo.az_el(n, e, n, u), (0.0, 0.0), atol=1e-12)
    a, el = geo.az_el(e, e, n, u)
    assert math.isclose(a, 90.0, abs_tol=1e-12) and abs(el) < 1e-12
    a, el = geo.az_el(-e + u, e, n, u)
    assert math.isclose(a, 270.0, abs_tol=1e-12) and math.isclose(el, 45.0, abs_tol=1e-12)


def test_scale_factor_true_distance():
    x, y = geo.ll_to_xy(-82.0, 10.0)
    k = geo.scale_factor(x, y)
    d_true = geo.great_circle_m(x, y, x + 100.0, y)
    assert math.isclose(d_true * k, 100.0, rel_tol=1e-6)


def test_dip_formula():
    assert math.isclose(geo.horizon_dip_deg(2.0), -math.degrees(math.sqrt(2 * 2.0 / geo.R_MOON)), rel_tol=1e-5)


def test_golden_geo():
    g = golden("geo")
    assert g["R"] == geo.R_MOON
    for c in g["cases"]:
        x, y = geo.ll_to_xy(c["lat"], c["lon"])
        assert math.isclose(x, c["x"], abs_tol=1e-5) and math.isclose(y, c["y"], abs_tol=1e-5)
        assert np.allclose(geo.xy_to_unit(c["x"], c["y"]), c["u"], atol=1e-12)
        e, n, u = geo.enu_basis(c["lat"], c["lon"])
        assert np.allclose(e, c["east"], atol=1e-12)
        assert np.allclose(n, c["north"], atol=1e-12)
        assert np.allclose(u, c["up"], atol=1e-12)
