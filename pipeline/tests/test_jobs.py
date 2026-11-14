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
