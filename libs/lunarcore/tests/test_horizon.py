import math

import numpy as np
import pytest
from conftest import golden

from lunarcore import horizon as H
from lunarcore import synthetic
from lunarcore import tiles as T
from lunarcore.geo import R_MOON

XO, YO = 10000.0, 20000.0


def _pyr(spec, x=XO, y=YO, zfine=7):
    return T.pyramid_from_function(synthetic.dem_function(spec), x, y, zfine)


@pytest.mark.parametrize("h_obs", [2.0, 10.0])
def test_flat_sphere_dip(h_obs):
    pyr = _pyr({"type": "flat", "h": 0.0})
    hz = H.profile_from_pyramid(pyr, 7, XO, YO, h_obs=h_obs, naz=32)
    expect = -math.degrees(math.sqrt(2 * h_obs / R_MOON))
    assert np.allclose(hz.elev_deg, expect, atol=0.002)
    assert np.allclose(hz.dist_m, math.sqrt(2 * R_MOON * h_obs), rtol=0.05)


def test_ramp_uphill_and_sideways():
    g = 0.1
    spec = {"type": "ramp", "h0": -g * XO, "gx": g, "gy": 0.0}
    pyr = _pyr(spec)
    up = synthetic.azimuth_towards(XO, YO, XO + 1, YO)
    e_up, d_up = H.ray_elevation(pyr, 7, XO, YO, 0.0, 2.0, up)
    # tan e* ~ g - sqrt(2 h_o / R) (small-angle sphere); dense reference below
    assert math.isclose(e_up, math.degrees(math.atan(g - math.sqrt(4.0 / R_MOON))), abs_tol=0.01)
    ref, _ = synthetic.ray_max_elevation(spec, XO, YO, 0.0, 2.0, up)
    assert math.isclose(e_up, ref, abs_tol=0.005)
    side, _ = H.ray_elevation(pyr, 7, XO, YO, 0.0, 2.0, (up + 90) % 360)
    assert math.isclose(side, -math.degrees(math.sqrt(4.0 / R_MOON)), abs_tol=0.002)


def test_single_gaussian_peak():
    spec = {"type": "gauss", "base": 0.0, "h0": 2000.0, "sigma": 3000.0, "xc": XO + 30000.0, "yc": YO}
    pyr = _pyr(spec)
    az = synthetic.azimuth_towards(XO, YO, spec["xc"], spec["yc"])
    e, d = H.ray_elevation(pyr, 7, XO, YO, 0.0, 2.0, az)
    ref, dref = synthetic.ray_max_elevation(spec, XO, YO, 0.0, 2.0, az)
    # analytic estimate for the summit: atan((h0 - h_o - L^2/2R)/L)
    approx = math.degrees(math.atan((2000.0 - 2.0 - 30000.0**2 / (2 * R_MOON)) / 30000.0))
    assert abs(ref - approx) < 0.05
    assert math.isclose(e, ref, abs_tol=0.02)
    assert abs(d - dref) < 1500.0
    away, _ = H.ray_elevation(pyr, 7, XO, YO, 0.0, 2.0, (az + 180) % 360)
    assert away < -0.08


def test_region_rows_match_site_profile():
    spec = {"type": "gauss", "base": 0.0, "h0": 1500.0, "sigma": 4000.0, "xc": XO + 20000.0, "yc": YO - 5000.0}
    pyr = _pyr(spec, zfine=5)
    xs = np.array([XO])
    ys = np.array([YO])
    out = np.zeros((1, 1, 64), dtype=np.uint8)
    hterr = np.zeros((1, 1))
    H.region_rows(pyr.index, pyr.stack, 5, xs, ys, 2.0, 64, 0.01, 300e3, R_MOON, pyr.hmax, pyr.hmin, out, hterr)
    hz = H.profile_from_pyramid(pyr, 5, XO, YO, naz=64)
    assert np.allclose(H.decode_map(out[0, 0]), np.clip(hz.elev_deg, -5, 20.5), atol=0.051)


def test_golden_horizon():
    for c in golden("horizon")["cases"]:
        o = c["observer"]
        zfine = int(round(math.log2(T.RES0 / c["finestRes"])))
        pyr = T.pyramid_from_function(synthetic.dem_function(c["dem"]), o["x"], o["y"], zfine)
        for ex in c["expect"]:
            e, _ = H.ray_elevation(pyr, zfine, o["x"], o["y"], o["hTerrain"], o["hObs"], ex["azDeg"],
                                   alpha=c["alpha"], dmax=c["dmaxM"])
            assert abs(e - ex["elDeg"]) <= ex["tolDeg"], (c["name"], ex, e)
