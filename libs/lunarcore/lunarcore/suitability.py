"""Transparent multi-criteria suitability score and rank-stability robustness (METRICS.md "Suitability").

Footprint statistics use a centred box of ``nb`` DEM cells, ``nb = ceil(L / res)`` rounded up to an odd
number (>= 1), so the box is never smaller than the footprint (conservative for slopeMax / relief).
"""

from __future__ import annotations

import math

import numpy as np

FEATURES = ("illum", "dark", "earth", "slope", "relief")
PRESETS = {
    "lander": {"label": "Short lander mission (<= 14 d)", "slopeLimit": 10.0, "darkRef": 96.0,
               "weights": {"illum": 0.30, "dark": 0.30, "earth": 0.25, "slope": 0.10, "relief": 0.05}},
    "base": {"label": "Long-term base", "slopeLimit": 8.0, "darkRef": 240.0,
             "weights": {"illum": 0.35, "dark": 0.30, "earth": 0.10, "slope": 0.10, "relief": 0.15}},
}


def resolve(preset: str = "lander", weights: dict | None = None, slope_limit: float | None = None,
            dark_ref: float | None = None) -> dict:
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset!r}")
    p = PRESETS[preset]
    w = dict(p["weights"])
    if weights:
        for k, v in weights.items():
            if k not in FEATURES:
                raise ValueError(f"unknown weight {k!r}")
            w[k] = float(v)
    if sum(w.values()) <= 0:
        raise ValueError("weights must not all be zero")
    return {"preset": preset, "weights": w,
            "slopeLimit": float(p["slopeLimit"] if slope_limit is None else slope_limit),
            "darkRef": float(p["darkRef"] if dark_ref is None else dark_ref)}


def clamp01(x):
    return np.clip(x, 0.0, 1.0)


def utilities(illum, dark, earth, slope_mean, relief, footprint_m: float, slope_limit: float,
              dark_ref: float) -> dict[str, np.ndarray]:
    return {
        "illum": clamp01((np.asarray(illum, dtype=np.float64) - 0.2) / (0.9 - 0.2)),
        "dark": 1.0 - clamp01(np.asarray(dark, dtype=np.float64) / dark_ref),
        "earth": clamp01(np.asarray(earth, dtype=np.float64) / 0.8),
        "slope": 1.0 - clamp01(np.asarray(slope_mean, dtype=np.float64) / slope_limit),
        "relief": 1.0 - clamp01(np.asarray(relief, dtype=np.float64) / (0.2 * footprint_m + 1.0)),
    }


def score(feat: dict, params: dict, footprint_m: float) -> tuple[np.ndarray, np.ndarray]:
    """(score in [0,1] with NaN where excluded, excluded mask). feat keys: illum, dark, earth, slopeMax,
    slopeMean, relief."""
    u = utilities(feat["illum"], feat["dark"], feat["earth"], feat["slopeMean"], feat["relief"], footprint_m,
                  params["slopeLimit"], params["darkRef"])
    w = params["weights"]
    wsum = sum(w.values())
    s = sum(w[k] * u[k] for k in FEATURES) / wsum
    excluded = ~np.isfinite(s) | ~np.isfinite(np.asarray(feat["slopeMax"], dtype=np.float64))
    excluded |= np.asarray(feat["slopeMax"], dtype=np.float64) > params["slopeLimit"]
    s = np.where(excluded, np.nan, s)
    return s, excluded


def score_matrix(u: dict[str, np.ndarray], weights: np.ndarray) -> np.ndarray:
    """Scores for many weight draws: u[k] arrays [m] (or [n, m]), weights [n, 5] -> [n, m]."""
    U = np.stack([np.broadcast_to(np.asarray(u[k], dtype=np.float64), np.shape(u[FEATURES[0]])) for k in FEATURES],
                 axis=-1)
    W = weights / weights.sum(axis=1, keepdims=True)
    if U.ndim == 2:  # [m, 5]
        return W @ U.T
    return np.einsum("nmk,nk->nm", U, W)


# --------------------------------------------------------------------------- footprint statistics
def box_size(footprint_m: float, res_m: float) -> int:
    nb = max(1, int(math.ceil(footprint_m / res_m - 1e-9)))
    return nb if nb % 2 == 1 else nb + 1


def slope_deg(dem: np.ndarray, res_m: float, k: np.ndarray | float = 1.0) -> np.ndarray:
    """Slope (deg) by central differences; ``k`` = projection scale factor (true spacing = res / k)."""
    gy, gx = np.gradient(np.asarray(dem, dtype=np.float64), res_m)
    return np.degrees(np.arctan(np.hypot(gx, gy) * k))


def _sat(a: np.ndarray) -> np.ndarray:
    s = np.zeros((a.shape[0] + 1, a.shape[1] + 1))
    s[1:, 1:] = np.cumsum(np.cumsum(a, axis=0), axis=1)
    return s


def box_mean(a: np.ndarray, nb: int) -> np.ndarray:
    """Centred nb x nb mean via a summed-area table; NaN-aware, edges use the valid part of the box."""
    a = np.asarray(a, dtype=np.float64)
    valid = np.isfinite(a)
    s = _sat(np.where(valid, a, 0.0))
    c = _sat(valid.astype(np.float64))
    h = nb // 2
    ny, nx = a.shape
    i0 = np.clip(np.arange(ny) - h, 0, ny)
    i1 = np.clip(np.arange(ny) + h + 1, 0, ny)
    j0 = np.clip(np.arange(nx) - h, 0, nx)
    j1 = np.clip(np.arange(nx) + h + 1, 0, nx)
    tot = s[i1][:, j1] - s[i0][:, j1] - s[i1][:, j0] + s[i0][:, j0]
    cnt = c[i1][:, j1] - c[i0][:, j1] - c[i1][:, j0] + c[i0][:, j0]
    with np.errstate(invalid="ignore", divide="ignore"):
        out = tot / cnt
    out[cnt == 0] = np.nan
    return out


def box_max(a: np.ndarray, nb: int) -> np.ndarray:
    from scipy.ndimage import maximum_filter

    a = np.asarray(a, dtype=np.float64)
    m = maximum_filter(np.where(np.isfinite(a), a, -np.inf), size=nb, mode="nearest")
    return np.where(np.isfinite(m), m, np.nan)


def box_min(a: np.ndarray, nb: int) -> np.ndarray:
    from scipy.ndimage import minimum_filter

    a = np.asarray(a, dtype=np.float64)
    m = minimum_filter(np.where(np.isfinite(a), a, np.inf), size=nb, mode="nearest")
    return np.where(np.isfinite(m), m, np.nan)


def footprint_features(dem: np.ndarray, res_m: float, footprint_m: float, k: np.ndarray | float = 1.0) -> dict:
    """slopeMax, slopeMean, relief for an L x L square centred on every DEM cell."""
    nb = box_size(footprint_m, res_m)
    sl = slope_deg(dem, res_m, k)
    return {"slopeMax": box_max(sl, nb), "slopeMean": box_mean(sl, nb),
            "relief": box_max(dem, nb) - box_min(dem, nb), "box": nb, "approximate": bool(res_m > footprint_m)}


# --------------------------------------------------------------------------- robustness
def dirichlet_weights(w: dict, n: int, concentration: float = 50.0, rng: np.random.Generator | None = None):
    """n draws of weights ~ Dirichlet(concentration * w / sum(w)) -> array [n, 5] in FEATURES order."""
    rng = rng or np.random.default_rng(0)
    base = np.array([w[k] for k in FEATURES], dtype=np.float64)
    base = base / base.sum()
    alpha = np.maximum(concentration * base, 1e-3)
    out = rng.dirichlet(alpha, size=n)
    out[:, base == 0] = 0.0
    return out / out.sum(axis=1, keepdims=True)


def rank_stability(scores: np.ndarray, k: int = 10) -> np.ndarray:
    """scores [n_draws, m] -> share of draws in which each candidate is among the top-k (NaN = excluded)."""
    s = np.where(np.isfinite(scores), scores, -np.inf)
    m = s.shape[1]
    if m <= k:
        return np.where(np.isfinite(scores).all(axis=0), 1.0, np.isfinite(scores).mean(axis=0))
    order = np.argsort(-s, axis=1, kind="stable")[:, :k]
    hits = np.zeros(m)
    for row in order:
        hits[row] += 1
    hits *= np.isfinite(scores).mean(axis=0) > 0
    return hits / s.shape[0]


def top_candidates(score_grid: np.ndarray, n: int = 10, min_sep_px: int = 8) -> list[tuple[int, int]]:
    """Greedy non-maximum suppression: up to n (row, col) maxima at least min_sep_px apart."""
    s = np.where(np.isfinite(score_grid), score_grid, -np.inf).copy()
    out = []
    order = np.argsort(-s, axis=None)
    taken = np.zeros(s.shape, dtype=bool)
    for flat in order:
        i, j = divmod(int(flat), s.shape[1])
        if s[i, j] == -np.inf or len(out) >= n:
            break
        if taken[i, j]:
            continue
        out.append((i, j))
        taken[max(0, i - min_sep_px):i + min_sep_px + 1, max(0, j - min_sep_px):j + min_sep_px + 1] = True
    return out
