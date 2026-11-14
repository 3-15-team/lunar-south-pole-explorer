import math

import numpy as np
import pytest

from lunarcore import suitability as S


def test_presets_and_utilities():
    for name, p in S.PRESETS.items():
        assert math.isclose(sum(p["weights"].values()), 1.0)
    u = S.utilities(0.9, 0.0, 0.8, 0.0, 0.0, 50.0, 10.0, 96.0)
    assert all(math.isclose(float(v), 1.0) for v in u.values())
    u = S.utilities(0.2, 96.0, 0.0, 10.0, 11.0, 50.0, 10.0, 96.0)
    assert all(math.isclose(float(v), 0.0) for v in u.values())
    u = S.utilities(0.55, 48.0, 0.4, 5.0, 5.5, 50.0, 10.0, 96.0)
    assert all(math.isclose(float(v), 0.5) for v in u.values())


def test_score_and_hard_constraint():
    p = S.resolve("lander")
    feat = {"illum": np.array([0.9, 0.9, 0.5]), "dark": np.array([0.0, 0.0, 50.0]), "earth": np.array([0.8, 0.8, 0.4]),
            "slopeMax": np.array([5.0, 12.0, 3.0]), "slopeMean": np.array([0.0, 0.0, 2.0]),
            "relief": np.array([0.0, 0.0, 1.0])}
    s, ex = S.score(feat, p, 50.0)
    assert math.isclose(s[0], 1.0) and np.isnan(s[1]) and ex[1] and 0 < s[2] < 1
    p2 = S.resolve("lander", slope_limit=15.0)
    assert not S.score(feat, p2, 50.0)[1][1]
    with pytest.raises(ValueError):
        S.resolve("nope")


def test_footprint_statistics_on_a_plane():
    res = 10.0
    g = 0.1
    ny, nx = 40, 50
    X = np.arange(nx) * res
    dem = np.tile(g * X, (ny, 1))
    f = S.footprint_features(dem, res, 30.0)
    assert f["box"] == 3
    interior = (slice(3, -3), slice(3, -3))
    assert np.allclose(f["slopeMax"][interior], math.degrees(math.atan(g)))
    assert np.allclose(f["slopeMean"][interior], math.degrees(math.atan(g)))
    assert np.allclose(f["relief"][interior], g * 2 * res)  # (nb - 1) cells across
    assert S.box_size(5.0, 40.0) == 1 and S.box_size(60.0, 40.0) == 3 and S.box_size(100.0, 40.0) == 3


def test_box_filters_match_brute_force():
    rng = np.random.default_rng(4)
    a = rng.normal(size=(20, 23))
    a[3, 4] = np.nan
    for nb in (1, 3, 5):
        mx, mn, me = S.box_max(a, nb), S.box_min(a, nb), S.box_mean(a, nb)
        h = nb // 2
        for i in (0, 5, 19):
            for j in (0, 4, 22):
                w = a[max(0, i - h):i + h + 1, max(0, j - h):j + h + 1]
                assert math.isclose(mx[i, j], np.nanmax(w)) and math.isclose(mn[i, j], np.nanmin(w))
                assert math.isclose(me[i, j], np.nanmean(w))


def test_rank_stability_and_dirichlet():
    rng = np.random.default_rng(0)
    w = S.dirichlet_weights(S.PRESETS["base"]["weights"], 4000, 50.0, rng)
    assert np.allclose(w.mean(axis=0), [S.PRESETS["base"]["weights"][k] for k in S.FEATURES], atol=0.01)
    scores = np.tile(np.linspace(1, 0, 30), (100, 1)) + rng.normal(0, 0.001, (100, 30))
    st = S.rank_stability(scores, k=10)
    assert np.all(st[:9] == 1.0) and np.all(st[12:] == 0.0)
    assert np.all(S.rank_stability(np.ones((5, 3)), k=10) == 1.0)


def test_top_candidates_nms():
    g = np.zeros((50, 50))
    g[10, 10], g[11, 11], g[40, 40] = 1.0, 0.9, 0.8
    assert S.top_candidates(g, n=2, min_sep_px=5) == [(10, 10), (40, 40)]
