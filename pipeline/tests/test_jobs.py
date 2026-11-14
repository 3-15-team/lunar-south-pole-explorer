import json
import math
from types import SimpleNamespace

import numpy as np
import pytest

from lunarcore import tiles as T
from pipeline.jobs import _common, dem_tiles, pull, validation_doc
from pipeline.jobs.ephemeris import angle_arcsec


def test_nanmean2x2():
    a = np.array([[1, 3, np.nan, np.nan], [5, 7, np.nan, 2], [0, 0, 0, 0], [0, 0, 0, 4]], dtype=np.float32)
    m = dem_tiles.nanmean2x2(a)
    assert m.shape == (2, 2)
    assert m[0, 0] == 4 and m[0, 1] == 2 and m[1, 0] == 0 and m[1, 1] == 1


def test_grid_offset_alignment():
    ok = SimpleNamespace(transform=SimpleNamespace(a=80.0, b=0.0, c=-304000.0, d=0.0, e=-80.0, f=304000.0))
    assert dem_tiles.grid_offset(ok, 5) == (296, 296)
    shifted = SimpleNamespace(transform=SimpleNamespace(a=80.0, b=0.0, c=-303990.0, d=0.0, e=-80.0, f=304000.0))
    assert dem_tiles.grid_offset(shifted, 5) is None
    wrong_res = SimpleNamespace(transform=SimpleNamespace(a=60.0, b=0.0, c=-304000.0, d=0.0, e=-60.0, f=304000.0))
    assert dem_tiles.grid_offset(wrong_res, 5) is None


def test_bilinear_from_mosaic_is_exact_for_planes():
    n = 256 << 2
    j = np.arange(n)
    xs = T.X0 + (j + 0.5) * T.res(2)
    ys = T.Y0 - (j + 0.5) * T.res(2)
    a = (0.001 * xs[None, :] - 0.002 * ys[:, None]).astype(np.float64)
    qx, qy = T.pixel_centres(4, 7, 9)
    got = dem_tiles.bilinear_from_mosaic(a, 2, qx, qy)
    want = 0.001 * qx[None, :] - 0.002 * qy[:, None]
    assert np.allclose(got, want, atol=1e-3)


def test_validation_doc_sections(tmp_path, monkeypatch):
    p = tmp_path / "VALIDATION.md"
    monkeypatch.setattr(validation_doc, "PATH", p)
    validation_doc.update_section("a", "Alpha", "one")
    validation_doc.update_section("b", "Beta", "two")
    validation_doc.update_section("a", "Alpha", "uno")
    t = p.read_text()
    assert t.count("BEGIN:a") == 1 and "uno" in t and "one" not in t and "two" in t


def test_site_config_schema():
    cfg = json.loads((_common.CONFIG / "sites.json").read_text())
    ids = [s["id"] for s in cfg["sites"]]
    assert len(ids) == len(set(ids))
    for s in cfg["sites"]:
        assert s["kind"] in {"pgda-5m", "artemis", "clps", "mission", "reference"}
        assert s["coordQuality"] in {"dem-centre", "dem-summit", "published", "approx"}
        assert s["source"].startswith("https://")
        assert -90 <= s["lat"] <= 90 and -180 <= s["lon"] <= 180
        if s["coordQuality"] == "approx":
            assert len(s["note"]) > 20


def test_pull_requires_base_url(monkeypatch):
    monkeypatch.delenv("DATA_BASE_URL", raising=False)
    with pytest.raises(SystemExit) as e:
        pull.main([])
    assert "DATA_BASE_URL" in str(e.value)


def test_angle_arcsec():
    a = np.array([[1.0, 0.0, 0.0]])
    b = np.array([[math.cos(1e-6), math.sin(1e-6), 0.0]])
    assert math.isclose(angle_arcsec(a, b)[0], math.degrees(1e-6) * 3600, rel_tol=1e-6)


def test_tables_match_spice_at_nodes():
    if not (_common.RAW / "naif" / "de440s.bsp").exists() or not (_common.WEB / "ephem" / "index.json").exists():
        pytest.skip("kernels / tables not present")
    from pipeline.jobs import ephemeris as job

    sp = job.furnsh_all()
    t = np.array([1767225600.0 + 1800.0 * k for k in (0, 1, 4321, 17519)])
    et = job.utc_to_et(sp, t)
    rec = np.fromfile(_common.WEB / "ephem" / "2026.bin", dtype="<f4").reshape(-1, 6)
    for i, k in enumerate((0, 1, 4321, 17519)):
        s = job.positions(sp, et[i:i + 1], "SUN")[0]
        assert np.allclose(rec[k, :3], s, rtol=1e-6)


def test_horizon_map_builder_resumable(tmp_path):
    from lunarcore import horizon as H
    from lunarcore import synthetic
    from pipeline.jobs import horizon_maps as hm

    a = SimpleNamespace(res=20000.0, extent=40000.0, naz=8, alpha=0.02, hobs=2.0, block=2)
    xs, ys = hm.grid(a.res, a.extent)
    pyr = T.pyramid_from_function(synthetic.dem_function({"type": "flat", "h": 100.0}), 0.0, 0.0, 3, alpha=0.02,
                                  dmax=300e3)
    blocks = list(range(0, xs.size, a.block))
    prog = {"params": {}, "done": [blocks[0]]}  # pretend the first block was done by an interrupted run
    hp, tp, pp = tmp_path / "h.partial.npy", tmp_path / "t.partial.npy", tmp_path / "p.json"
    np.lib.format.open_memmap(hp, mode="w+", dtype=np.uint8, shape=(xs.size, xs.size, a.naz))[:] = 7
    np.lib.format.open_memmap(tp, mode="w+", dtype=np.float32, shape=(xs.size, xs.size))[:] = np.nan
    assert hm.build_map(a, pyr, 3, xs, ys, blocks, prog, pp, hp, tp)
    out = np.load(hp)
    assert np.all(out[:2] == 7)  # resumed: finished block untouched
    dip = H.encode_map_elev(-math.degrees(math.sqrt(2 * 2.0 / 1737400.0)))
    inside = np.hypot(*np.meshgrid(xs, ys))[2:] <= a.extent
    assert np.all(out[2:][inside] == dip) and json.loads(pp.read_text())["done"] == blocks


def test_micro_relief_tiles_are_periodic_deterministic_and_follow_the_sfd():
    from pipeline.jobs import micro_relief as M

    rng = np.random.default_rng(1)
    d = M.truncated_pareto(rng, 200_000, 0.1, 10.0, 3.0)
    assert d.min() >= 0.1 and d.max() <= 10.0
    # cumulative N(>D) ∝ D^-3 → log-log slope ≈ -3 well inside the range
    n1, n2 = (d > 0.2).sum(), (d > 0.4).sum()
    assert math.log(n2 / n1) / math.log(2) == pytest.approx(-3.0, abs=0.1)

    spec = dict(M.TILES["fine"], size=128)
    g1, r1, _ = M.build_tile("t", spec)
    g2, r2, _ = M.build_tile("t", spec)
    assert np.array_equal(g1, g2) and np.array_equal(r1, r2)  # fixed seed
    assert abs(g1.mean()) < 1e-9 and r1.min() >= 0.0
    # seamless: the wrap-around step is no larger than typical interior steps
    step = np.abs(np.diff(g1, axis=1)).mean()
    assert np.abs(g1[:, 0] - g1[:, -1]).mean() < 3 * step
    levels = M.mip_chain(np.stack([g1, r1], -1))
    assert [lv.shape[0] for lv in levels] == [128, 64, 32, 16, 8, 4, 2, 1]
    assert levels[-1][0, 0, 0] == pytest.approx(g1.mean(), abs=1e-6)


def test_outer_dem_resampling_wraps_longitude_and_masks_the_north():
    from pipeline.jobs import outer_dem as O

    rows, cols = 180 * O.PPD, 360 * O.PPD
    lat = 90.0 - (np.arange(rows) + 0.5) / O.PPD
    lon = (np.arange(cols) + 0.5) / O.PPD
    dem = (100.0 * lat[:, None] + 0.0 * lon[None, :]).astype(np.float32)  # h = 100 m per degree latitude
    # bilinear in latitude is exact for a linear field; longitude wraps across 0/360
    v = O.sample_ldem(dem, np.array([-45.3, -45.3]), np.array([359.99, -0.01]))
    assert v == pytest.approx([-4530.0, -4530.0], abs=1e-3)
    h = O.build(dem, n=64, half=O.HALF, sub=2)
    assert np.isnan(h[0, 0])  # corner: beyond the equator
    c = h[32, 32]  # pixel touching the pole (108 km wide): mean lat ≈ -87…-88°
    assert -9000.0 < c < -8500.0
