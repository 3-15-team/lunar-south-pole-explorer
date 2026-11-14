import gzip
import math

import numpy as np
import pytest

from lunarcore import tiles as T


def test_codec_roundtrip_and_quantisation_bound():
    rng = np.random.default_rng(0)
    h = (rng.normal(0, 800, (256, 256)) + 1500).astype(np.float64)
    h[10, 20] = np.nan
    data = T.encode_tile(h)
    assert data[:2] == b"\x1f\x8b"
    out = T.decode_tile(data)
    base, scale, _ = T.quantize(h)
    m = np.isfinite(h)
    assert np.isnan(out[10, 20])
    assert np.nanmax(np.abs(out[m] - h[m])) <= scale / 2 + 1e-3 * scale + 5e-4
    raw = gzip.decompress(data)
    assert raw[:4] == b"LDT1" and len(raw) == 16 + 2 * 256 * 256
    assert np.array_equal(np.isnan(T.decode_tile(raw)), np.isnan(out))  # un-gzipped payload accepted


def test_codec_flat_tile_min_scale():
    h = np.full((256, 256), 1234.5678)
    base, scale, v = T.quantize(h)
    assert scale == pytest.approx(0.01)
    assert np.allclose(T.decode_tile(T.encode_tile(h)), 1234.5678, atol=0.005 + 1e-4)


def test_all_nodata_tile():
    out = T.decode_tile(T.encode_tile(np.full((256, 256), np.nan)))
    assert np.isnan(out).all()


def test_grid_math():
    assert T.res(0) == 2560 and T.res(9) == 5
    assert T.tile_bounds(0, 0, 0) == (-327680, -327680, 327680, 327680)
    xs, ys = T.pixel_centres(5, 3, 7)
    assert xs[0] == T.X0 + (3 * 256 + 0.5) * 80 and ys[0] == T.Y0 - (7 * 256 + 0.5) * 80
    assert T.tile_of(5, xs[0], ys[0]) == (3, 7) and T.tile_of(5, xs[-1], ys[-1]) == (3, 7)
    assert T.tile_of(9, 0.1, 0.1) == (256, 255)


def test_level_for_spacing():
    assert T.level_for_spacing(9, 5.0) == 9
    assert T.level_for_spacing(9, 10.0) == 8
    assert T.level_for_spacing(9, 39.9) == 7
    assert T.level_for_spacing(9, 40.0) == 6
    assert T.level_for_spacing(9, 1e9) == 0
    assert T.level_for_spacing(5, 5.0) == 5


def test_bilinear_exact_for_planes_across_tile_edges():
    fn = lambda X, Y: 100.0 + 0.01 * X - 0.02 * Y  # noqa: E731
    pyr = T.pyramid_from_function(fn, 1000.0, -2000.0, zfine=7, dmax=20000.0)
    rng = np.random.default_rng(5)
    for z in (5, 6, 7):
        for _ in range(200):
            x, y = rng.uniform(-3000, 3000, 2) + (1000.0, -2000.0)
            v = T.sample_level(pyr.index, pyr.stack, z, x, y)
            assert math.isclose(v, fn(x, y), abs_tol=2e-3)


def test_missing_tile_falls_back_to_coarser_level():
    fine = {}
    coarse = {}
    for tx, ty in T.tiles_in_bbox(5, -5000, -5000, 5000, 5000):
        coarse[(5, tx, ty)] = np.full((256, 256), 10.0, dtype=np.float32)
    tx, ty = T.tile_of(9, 100.0, 100.0)
    fine[(9, tx, ty)] = np.full((256, 256), 20.0, dtype=np.float32)
    pyr = T.pyramid_from_tiles({**coarse, **fine})
    x0, _, _, y1 = T.tile_bounds(9, tx, ty)
    assert T.sample_clip(pyr.index, pyr.stack, 9, 5.0, x0 + 600, y1 - 600) == 20.0  # inside the z9 tile
    assert T.sample_clip(pyr.index, pyr.stack, 9, 5.0, 3000.0, 3000.0) == 10.0  # no z9..z6 -> z5
    assert T.finest_level_at(pyr.index, pyr.stack, 9, 3000.0, 3000.0) == 5


def test_tilestore_roundtrip(tmp_path):
    h = np.linspace(-100, 100, 256 * 256).reshape(256, 256)
    T.write_tile(tmp_path, 5, 16, 16, h)
    st = T.TileStore(tmp_path)
    assert st.levels() == [5] and st.available(5, 16, 16) and not st.available(5, 0, 0)
    assert np.allclose(st.load(5, 16, 16), h, atol=0.0051)  # scale floor 0.01 m
