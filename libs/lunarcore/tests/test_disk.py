import math

import numpy as np
from conftest import golden

from lunarcore import disk


def test_straight_edge_limits_and_symmetry():
    assert disk.fraction_straight(1.0) == 1.0
    assert disk.fraction_straight(-1.0) == 0.0
    assert disk.fraction_straight(5.0) == 1.0
    assert math.isclose(disk.fraction_straight(0.0), 0.5, abs_tol=1e-15)
    for z in np.linspace(-1, 1, 41):
        assert math.isclose(disk.fraction_straight(z) + disk.fraction_straight(-z), 1.0, abs_tol=1e-12)
    zs = np.linspace(-1, 1, 101)
    assert np.all(np.diff([disk.fraction_straight(z) for z in zs]) > 0)


def test_slices_equal_straight_edge_for_flat_horizon():
    prof = np.full(1440, 0.3)
    worst = 0.0
    for r in (0.2666, 0.95):
        for el in np.linspace(0.3 - 1.2 * r, 0.3 + 1.2 * r, 97):
            fs = disk.fraction_slices(prof, 123.4, el, r)
            fz = disk.fraction_straight((el - 0.3) / r)
            worst = max(worst, abs(fs - fz))
    assert worst < 1e-3  # METRICS.md requirement
    assert worst < 1e-9  # exact per-slice segment areas (ADR-101)


def test_slice_area_partition():
    r = 0.7
    for y0 in (-0.9, -0.69, -0.3, 0.0, 0.25, 0.69, 0.71):
        edges = np.linspace(-r, r, 17)
        tot = sum(disk.slice_area(a, b, y0, r) for a, b in zip(edges[:-1], edges[1:]))
        z = -y0 / r
        assert math.isclose(tot / (math.pi * r * r), disk.fraction_straight(z), abs_tol=1e-12)


def test_slices_partial_horizon_between_extremes():
    az = np.arange(3600) * 0.1
    prof = np.where(az < 179.95, 5.0, -5.0)  # wall on the left half of the sky, sharp at 0.1 deg bins
    f_mid = disk.fraction_slices(prof, 180.0, 0.0, 0.5)
    assert 0.4 < f_mid < 0.6
    assert disk.fraction_slices(prof, 90.0, 0.0, 0.5) == 0.0
    assert disk.fraction_slices(prof, 270.0, 0.0, 0.5) == 1.0


def test_interp_profile_periodic():
    prof = np.array([0.0, 1.0, 2.0, 3.0])  # 90 deg bins
    assert math.isclose(disk.interp_profile(prof, 45.0), 0.5)
    assert math.isclose(disk.interp_profile(prof, 315.0), 1.5)  # between bin 3 (3.0) and bin 0 (0.0)
    assert math.isclose(disk.interp_profile(prof, -45.0), 1.5)


def test_golden_disk():
    g = golden("disk")
    for c in g["cases"]:
        assert math.isclose(disk.fraction_flat(c["z"]), c["f"], abs_tol=1e-10)
    profs = {k: np.array(v) for k, v in g["sliceProfiles"].items()}
    for c in g["sliceCases"]:
        f = disk.fraction_slices(profs[c["profile"]], c["azDeg"], c["elDeg"], c["radiusDeg"])
        assert math.isclose(f, c["f"], abs_tol=1e-9)
