"""Synthetic lunar micro-relief tiles for the panorama -> data/web/micro/{index.json, <tile>.bin}.

    python -m pipeline.jobs.micro_relief [--force]

Below the DEM's 5 m grid we only know the *statistics* of the lunar surface, so this job draws
seamless (periodic) height fields from published size distributions instead of painting a picture:

* craters: cumulative N(>D) ∝ D^-2 (small-crater equilibrium), bowl + raised rim + ejecta falloff,
  depth/diameter 0.02–0.18, skewed to degraded (fresh^3);
* boulders / pebbles: cumulative N(>D) ∝ D^-3.5 / D^-3 (LROC boulder counts give exponents ≈ -3 … -4.5),
  half-buried ellipsoids, stored in a separate channel so the renderer can max-compose two rotated
  samplings without flattening rocks;
* regolith roughness: periodic fBm (Hurst 0.8) high-passed so it adds nothing at DEM wavelengths.

Heights only (metres, no albedo, nothing baked): the panorama derives normals and short-range
self-shadowing from them with the real Sun direction, so illumination stays physical. Output per tile:
float16, 2 channels (ground, rocks) interleaved, full mip chain (2x2 means) concatenated, gzip.
Deterministic (fixed seeds). Display only — never used by any metric.
"""

from __future__ import annotations

import argparse
import gzip
import math

import numpy as np

from ._common import WEB, log, now_iso, record_tree, write_json

JOB = "pipeline/jobs/micro_relief.py"
VERSION = 3

# size = pixels per side (power of two); meters = tile side
TILES = {
    "coarse": {
        "size": 1024, "meters": 32.0, "seed": 20261115,
        "fbm": {"hurst": 0.8, "cutoff_m": 4.0, "rms_slope_deg": 3.5, "baseline_m": 0.25},
        "craters": {"dmin": 0.25, "dmax": 5.0, "cum_exp": 2.0, "area_fraction": 0.45},
        "rocks": {"dmin": 0.15, "dmax": 2.0, "cum_exp": 3.5, "area_fraction": 0.012},
    },
    "fine": {
        "size": 1024, "meters": 4.0, "seed": 20261116,
        "fbm": {"hurst": 0.8, "cutoff_m": 1.0, "rms_slope_deg": 6.0, "baseline_m": 0.02},
        "craters": {"dmin": 0.04, "dmax": 0.6, "cum_exp": 2.0, "area_fraction": 0.35},
        "rocks": {"dmin": 0.012, "dmax": 0.15, "cum_exp": 3.0, "area_fraction": 0.025},
    },
}


def truncated_pareto(rng: np.random.Generator, n: int, dmin: float, dmax: float, b: float) -> np.ndarray:
    """Diameters with cumulative N(>D) ∝ D^-b on [dmin, dmax] (inverse CDF)."""
    u = rng.random(n)
    a0, a1 = dmin ** -b, dmax ** -b
    return (a0 - u * (a0 - a1)) ** (-1.0 / b)


def draw_until_area(rng, area: float, fraction: float, dmin: float, dmax: float, b: float) -> np.ndarray:
    """Draw diameters until their summed disc area reaches `fraction` of `area` (largest first)."""
    out: list[np.ndarray] = []
    total = 0.0
    while total < fraction * area:
        d = truncated_pareto(rng, 4096, dmin, dmax, b)
        cum = np.cumsum(math.pi / 4 * d * d) + total
        k = int(np.searchsorted(cum, fraction * area)) + 1
        out.append(d[:k])
        total = float(cum[min(k, len(cum)) - 1])
    d = np.concatenate(out)
    return np.sort(d)[::-1]


def fbm(rng, n: int, meters: float, hurst: float, cutoff_m: float, rms_slope_deg: float, baseline_m: float) -> np.ndarray:
    """Periodic fractional-Brownian surface, high-passed above `cutoff_m`, scaled to an RMS slope."""
    kx = np.fft.rfftfreq(n, d=meters / n)
    ky = np.fft.fftfreq(n, d=meters / n)
    k = np.hypot(ky[:, None], kx[None, :])
    k[0, 0] = 1.0
    amp = k ** -(hurst + 1.0) * (1.0 - np.exp(-((k * cutoff_m) ** 4)))
    amp[0, 0] = 0.0
    spec = amp * (rng.standard_normal(amp.shape) + 1j * rng.standard_normal(amp.shape))
    h = np.fft.irfft2(spec, s=(n, n))
    lag = max(1, round(baseline_m / (meters / n)))
    slope = (np.roll(h, -lag, axis=1) - h) / (lag * meters / n)
    h *= math.tan(math.radians(rms_slope_deg)) / float(np.sqrt(np.mean(slope**2)))
    return h - h.mean()


def _window(n: int, px: float, cx: float, cy: float, rad_px: float):
    """Periodic window around (cx, cy) in pixels: index arrays (wrapped) and offsets (unwrapped, px)."""
    x0, x1 = math.floor(cx - rad_px), math.ceil(cx + rad_px) + 1
    y0, y1 = math.floor(cy - rad_px), math.ceil(cy + rad_px) + 1
    xs = np.arange(x0, x1)
    ys = np.arange(y0, y1)
    dx = (xs + 0.5 - cx) * px
    dy = (ys + 0.5 - cy) * px
    return np.ix_(ys % n, xs % n), dx[None, :], dy[:, None]


def stamp_craters(h: np.ndarray, rng, meters: float, diam: np.ndarray) -> None:
    n = h.shape[0]
    px = meters / n
    for d in diam:
        cx, cy = rng.random(2) * n
        r = d / 2
        # most small craters are degraded: d/D skewed towards 0.04, a few fresh ones up to 0.18
        fresh = rng.random() ** 3
        depth = d * (0.02 + 0.16 * fresh)
        rim = d * 0.035 * (0.3 + 0.7 * fresh)
        if r < 1.5 * px:
            continue  # sub-pixel: the fBm already carries this scale
        idx, dx, dy = _window(n, px, cx, cy, 3 * r / px)
        rho = np.hypot(dx, dy) / r
        inner = -depth + (depth + rim) * rho**2
        outer = rim * np.maximum(rho, 1.0) ** -3 * np.clip((3.0 - rho) / 1.0, 0.0, 1.0)
        prof = np.where(rho < 1.0, inner, outer)
        h[idx] += prof


def stamp_rocks(h: np.ndarray, rng, meters: float, diam: np.ndarray) -> None:
    n = h.shape[0]
    px = meters / n
    for d in diam:
        cx, cy = rng.random(2) * n
        elong = rng.uniform(1.0, 1.6)
        ang = rng.uniform(0, math.pi)
        a = d / 2 * math.sqrt(elong)
        b = d / 2 / math.sqrt(elong)
        height = d * rng.uniform(0.25, 0.55)  # partly buried
        idx, dx, dy = _window(n, px, cx, cy, a / px + 1)
        c, s = math.cos(ang), math.sin(ang)
        u = (dx * c + dy * s) / a
        v = (-dx * s + dy * c) / b
        q = 1.0 - (u * u + v * v)
        bump = height * np.sqrt(np.clip(q, 0.0, None))
        h[idx] = np.maximum(h[idx], bump)


def mip_chain(rg: np.ndarray) -> list[np.ndarray]:
    """2x2-mean pyramid of an (n, n, c) periodic array down to 1x1."""
    levels = [rg]
    while levels[-1].shape[0] > 1:
        a = levels[-1]
        levels.append(0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]))
    return levels


def build_tile(name: str, spec: dict) -> tuple[np.ndarray, np.ndarray, dict]:
    n, meters = spec["size"], spec["meters"]
    rng = np.random.default_rng(spec["seed"])
    ground = fbm(rng, n, meters, **spec["fbm"])
    cr = spec["craters"]
    crater_d = draw_until_area(rng, meters * meters, cr["area_fraction"], cr["dmin"], cr["dmax"], cr["cum_exp"])
    stamp_craters(ground, rng, meters, crater_d)
    ground -= ground.mean()
    rocks = np.zeros((n, n))
    rk = spec["rocks"]
    rock_d = draw_until_area(rng, meters * meters, rk["area_fraction"], rk["dmin"], rk["dmax"], rk["cum_exp"])
    stamp_rocks(rocks, rng, meters, rock_d)
    stats = {
        "craters": int(len(crater_d)), "rocks": int(len(rock_d)),
        "groundRmsM": round(float(ground.std()), 4), "rocksMaxM": round(float(rocks.max()), 4),
        "rockCover": round(float((rocks > 0).mean()), 4),
    }
    log(JOB, f"{name}: {n}² over {meters} m, {stats}")
    return ground, rocks, stats


def write_tile(path, ground: np.ndarray, rocks: np.ndarray) -> list[int]:
    rg = np.stack([ground, rocks], axis=-1)
    levels = mip_chain(rg)
    payload = b"".join(lv.astype("<f2").tobytes() for lv in levels)
    path.write_bytes(gzip.compress(payload, 6))
    return [lv.shape[0] for lv in levels]


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="rebuild even if the same version exists")
    a = ap.parse_args(argv)
    out = WEB / "micro"
    index_path = out / "index.json"
    if index_path.exists() and not a.force:
        import json

        if json.loads(index_path.read_text()).get("version") == VERSION:
            log(JOB, f"{index_path} is current (version {VERSION}); --force to rebuild")
            return
    out.mkdir(parents=True, exist_ok=True)
    tiles = {}
    for name, spec in TILES.items():
        ground, rocks, stats = build_tile(name, spec)
        f = out / f"{name}.bin"
        sizes = write_tile(f, ground, rocks)
        tiles[name] = {"file": f.name, "size": spec["size"], "meters": spec["meters"], "levels": sizes,
                       "format": "float16 LE, channels [ground, rocks] interleaved, mips concatenated, gzip",
                       "params": {k: spec[k] for k in ("fbm", "craters", "rocks", "seed")}, "stats": stats}
    write_json(index_path, {
        "version": VERSION, "generated": now_iso(), "synthetic": True, "units": "m",
        "method": ("Statistical micro-relief (not imagery): crater N(>D)∝D^-2, boulders N(>D)∝D^-3..-3.5 "
                   "(LROC boulder-count exponents), fBm Hurst 0.8 high-passed above DEM scales; heights only."),
        "tiles": tiles,
    })
    record_tree("micro_relief", out, JOB, pattern="*.bin")


if __name__ == "__main__":
    main()
