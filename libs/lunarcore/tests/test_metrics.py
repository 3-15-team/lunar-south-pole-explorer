import math

import numpy as np
import pytest
from conftest import golden

from lunarcore import metrics as M
from lunarcore.ephemeris import Ephemeris


def test_interval_crossing_a_sunset():
    fs = [1, 1, 1, 0.6, 0.2, 0, 0, 0, 0, 0.3, 1, 1]
    fe = [1, 1, 0.6, 0.5, 0.49, 0.2, 0, 0, 0.5, 0.7, 1, 1]
    m = M.interval_metrics(1.0, fs, fe, 0.5)
    assert m["nSunsets"] == 1 and m["nSunrises"] == 1
    assert m["longestDarkH"] == 4.0 and not m["longestDarkCensored"]
    assert math.isclose(m["sunlitHours"], sum(fs))
    assert math.isclose(m["illumFrac"], sum(fs) / 12)
    assert m["anySunHours"] == 8.0
    assert math.isclose(m["earthFrac"], 8 / 12)
    assert m["longestNoCommsH"] == 4.0
    assert m["dteWindows"] == [[0, 4], [8, 12]]


def test_censored_dark_runs():
    m = M.interval_metrics(0.5, [0, 0, 0, 0.5, 1, 0.04, 0.01, 0], [0, 0, 1, 1, 1, 1, 0, 0], 0.5)
    assert m["longestDarkH"] == 1.5 and m["longestDarkCensored"]
    assert m["nSunsets"] == 1  # 0.04 and 0.01 still count as "up" (f > 0)
    assert m["longestNoCommsCensored"]


def test_thresholds_are_inclusive_where_specified():
    m = M.interval_metrics(1.0, [0.05, 0.0], [0.5, 0.4999], 0.5)
    assert m["longestDarkH"] == 1.0  # 0.05 is not dark, 0.0 is
    assert m["earthFrac"] == 0.5  # f_earth == theta counts as visible


def test_longest_run_ties_pick_first():
    assert M.longest_run(np.array([1, 1, 0, 1, 1], dtype=bool)) == (2, 0, True)
    assert M.longest_run(np.array([0, 0], dtype=bool)) == (0, -1, False)


def test_power_proxies():
    el = np.array([1.0, 2.0])
    m = M.interval_metrics(1.0, [1.0, 1.0], [1, 1], 0.5, sun_el=el, earth_el=el, sun_dist_km=np.full(2, 149597870.7))
    assert math.isclose(m["powerVertical"], np.mean(np.cos(np.radians(el))))
    assert math.isclose(m["powerHorizontal"], np.mean(np.sin(np.radians(el))))
    assert m["powerRatio"] > 20  # vertical panels win at the pole
    assert math.isclose(M.shadow_length_m(1.0), 2.0 / math.tan(math.radians(1.0)))
    assert M.shadow_length_m(-0.5) is None


def test_golden_metrics():
    g = golden("metrics")
    assert g["darkThreshold"] == M.DARK_F
    for c in g["cases"]:
        m = M.interval_metrics(c["dtHours"], c["fSun"], c["fEarth"], c["dte"])
        for k, v in c["expect"].items():
            assert m[k] == pytest.approx(v, abs=1e-12), (c["name"], k)


def _synthetic_ephemeris():
    """Sun circling at 0.5 deg above the south-pole horizon once per 29.5 d; Earth fixed low in the sky."""
    t0, step = 1_800_000_000.0, 1800.0
    n = 2000
    t = t0 + step * np.arange(n)
    L = 2 * np.pi * (t - t0) / (29.5 * 86400)
    d = math.radians(-0.5)
    sun = 1.496e8 * np.stack([np.cos(d) * np.cos(L), np.cos(d) * np.sin(L), np.full(n, math.sin(d))], axis=1)
    earth = np.tile([384400.0 * math.cos(math.radians(-1.0)), 0.0, 384400.0 * math.sin(math.radians(-1.0))], (n, 1))
    return Ephemeris(t0, step, np.hstack([sun, earth]))


def test_events_bisection_to_one_minute():
    eph = _synthetic_ephemeris()
    az = np.arange(1440) * 0.25
    prof = np.where((az > 100) & (az < 140), 2.0, 0.0)  # a 40-degree-wide mountain
    model = M.SiteModel(eph, prof, -89.999, 0.0, 0.0, 0.0)
    s, dt = model.series(eph.t0, eph.t0 + 29.5 * 86400, 3600.0)
    ev = model.events(s)
    kinds = [e["type"] for e in ev if e["type"] in ("sunrise", "sunset")]
    assert kinds.count("sunset") == 1 and kinds.count("sunrise") == 1
    for e in ev:
        if e["type"] not in ("sunrise", "sunset"):
            continue
        fine = model.evaluate(e["t"] + np.arange(-120.0, 121.0, 1.0)).f_sun > 0
        k = int(np.flatnonzero(fine[1:] != fine[:-1])[0])
        t_true = e["t"] - 120.0 + k + 0.5
        assert abs(e["t"] - t_true) <= 60.0
    sunset = next(e for e in ev if e["type"] == "sunset")
    nxt = model.next_transition(sunset["t"] - 3 * 3600, "sun")
    assert nxt is not None and abs(nxt["t"] - sunset["t"]) <= 60.0 and nxt["toState"] is False
