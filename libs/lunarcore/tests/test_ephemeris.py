import math

import numpy as np
from conftest import golden

from lunarcore import ephemeris as E
from lunarcore.geo import ll_to_unit


def test_parse_and_format_utc():
    t = E.parse_utc("2026-12-01T00:00:00Z")
    assert t == E.year_start_unix(2026) + 334 * 86400
    assert E.iso_utc(t) == "2026-12-01T00:00:00Z"
    assert E.parse_utc("2026-12-01T04:00:00+04:00") == t
    assert E.records_in_year(2028) == 366 * 48


def test_tables_contiguous_and_nodes_exact(eph):
    assert eph.t0 == E.year_start_unix(2026)
    assert eph.rec.shape[0] == sum(E.records_in_year(y) for y in range(2026, 2037))
    k = 12345
    S, Ea = eph.vectors(eph.t0 + k * 1800.0)
    assert np.array_equal(S, eph.rec[k, :3]) and np.array_equal(Ea, eph.rec[k, 3:])


def test_physical_ranges(eph):
    t = eph.t0 + 1800.0 * np.arange(0, eph.rec.shape[0] - 1, 97)
    S, Ea = eph.vectors(t)
    de = np.linalg.norm(Ea, axis=1)
    ds = np.linalg.norm(S, axis=1)
    assert 355000 < de.min() and de.max() < 408000
    assert 0.97 * 1.496e8 < ds.min() and ds.max() < 1.03 * 1.496e8
    # Sun elevation at the south pole stays within the ~1.54 deg obliquity band (+ small parallax)
    tp = E.topocentric(S, Ea, -90.0, 0.0, 0.0, 0.0)
    assert np.abs(tp.sun_el).max() < 1.65
    # libration keeps the Earth within ~8 deg of the lon-0 meridian as seen from the Moon centre
    lon = np.degrees(np.arctan2(Ea[:, 1], Ea[:, 0]))
    assert np.abs(lon).max() < 9.0


def test_earth_parallax_is_applied(eph):
    t = eph.t0 + 86400.0 * 100
    S, Ea = eph.vectors(t)
    tp = E.topocentric(S, Ea, -85.0, 0.0, 0.0, 0.0)
    tp0 = E.topocentric(S, Ea + 0.0, -85.0, 0.0, -1737400.0, 0.0)  # observer at the Moon centre
    d = abs(tp.earth_el - tp0.earth_el)
    assert 0.05 < d < 0.29
    u = ll_to_unit(-85.0, 0.0)
    assert math.isclose(np.linalg.norm(u), 1.0)


def test_golden_topo(eph):
    g = golden("topo")
    for c in g["cases"]:
        S, Ea = eph.vectors(E.parse_utc(c["utc"]))
        tp = E.topocentric(S, Ea, c["lat"], c["lon"], c["hM"], 0.0)
        for body, (az, el, rad) in (("sun", (tp.sun_az, tp.sun_el, tp.sun_radius)),
                                    ("earth", (tp.earth_az, tp.earth_el, tp.earth_radius))):
            ex = c[body]
            assert abs(((float(az) - ex["azDeg"] + 180) % 360) - 180) < 1e-6
            assert abs(float(el) - ex["elDeg"]) < 1e-6 and abs(float(rad) - ex["radiusDeg"]) < 1e-8
