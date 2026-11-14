"""Analyses shared by services/compute and pipeline/jobs/prebake.py: site metrics, region heatmaps,
rank-stability robustness (docs/API.md)."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import time
from collections import OrderedDict
from pathlib import Path

import numpy as np

from . import maps, suitability
from .ephemeris import iso_utc, parse_utc, topocentric
from .geo import ll_to_xy, xy_to_ll
from .horizon import site_horizon
from .metrics import DARK_F, SiteModel, interval_metrics, shadow_length_m
from .products import DataStore, DataUnavailable  # noqa: F401 - re-exported for the service
from .tiles import tile_of

MAX_SAMPLES = 200_000
MAX_HEATMAP_SAMPLES = 20_000
# approximation of cividis (Nunez et al. 2018, colour-vision-deficiency friendly): 9 stops, linear in between
_CIVIDIS = np.array([
    (0, 34, 78), (17, 54, 108), (59, 73, 108), (89, 92, 109), (117, 113, 112), (147, 134, 113),
    (180, 157, 108), (216, 182, 94), (254, 232, 56)], dtype=np.float64)


class BadRequest(ValueError):
    """Invalid parameters (HTTP 400)."""


# --------------------------------------------------------------------------- helpers
def canonical_key(kind: str, params: dict, version: str) -> str:
    blob = json.dumps({"kind": kind, "params": params, "data": version}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def time_grid(t0s: str, t1s: str, step_s: float, eph, max_n: int) -> tuple[np.ndarray, float, float, float]:
    try:
        t0, t1 = parse_utc(t0s), parse_utc(t1s)
    except ValueError as e:
        raise BadRequest(f"bad time: {e}") from e
    if not t1 > t0:
        raise BadRequest("t1 must be after t0")
    if not eph.covers(t0, t1):
        raise BadRequest(f"interval outside the ephemeris range {iso_utc(eph.t0)} .. {iso_utc(eph.t_end)}")
    n = max(1, int(round((t1 - t0) / step_s)))
    if n > max_n:
        raise BadRequest(f"too many samples ({n} > {max_n}); increase the step")
    dt = (t1 - t0) / n
    return t0 + dt * np.arange(n), dt, t0, t1


def colorize(score: np.ndarray) -> bytes:
    """Score in [0, 1] (NaN = excluded) -> RGBA PNG (cividis, transparent where NaN)."""
    from PIL import Image

    s = np.clip(np.nan_to_num(score, nan=0.0), 0.0, 1.0) * (len(_CIVIDIS) - 1)
    i0 = np.floor(s).astype(int).clip(0, len(_CIVIDIS) - 2)
    f = (s - i0)[..., None]
    rgb = _CIVIDIS[i0] * (1 - f) + _CIVIDIS[i0 + 1] * f
    a = np.where(np.isfinite(score), 255, 0)
    img = np.dstack([rgb, a]).round().astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _f(v, nd=4):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)


# --------------------------------------------------------------------------- site metrics
def site_metrics(ds: DataStore, p: dict) -> dict:
    eph = ds.require_eph()
    dem = ds.require_dem()
    times, dt, t0, t1 = time_grid(p["t0"], p["t1"], p["stepMin"] * 60.0, eph, MAX_SAMPLES)
    lat, lon = float(p["lat"]), float(p["lon"])
    x, y = (float(v) for v in ll_to_xy(lat, lon))
    t_start = time.time()
    try:
        hz = site_horizon(dem, x, y, h_obs=p["obsHeight"], naz=p["naz"], err_store=ds.err if ds.err.exists else None)
    except ValueError as e:
        raise BadRequest(f"site outside DEM coverage ({e})") from e
    t_h = time.time() - t_start
    model = SiteModel(eph, hz.elev_deg, lat, lon, hz.h_terrain, p["obsHeight"])
    s = model.evaluate(times)
    dte = p["dteThreshold"]
    m = interval_metrics(dt / 3600.0, s.f_sun, s.f_earth, dte, s.topo.sun_el, s.topo.earth_el, s.topo.sun_dist_km, t0)
    events = model.events(s, dte)
    now = model.evaluate(t0)
    nxt_sun = model.next_transition(t0, "sun")
    nxt_earth = model.next_transition(t0, "earth", dte)
    sun_up = bool(now.f_sun[0] > 0)
    earth_ok = bool(now.f_earth[0] >= dte)
    out = {
        "site": {"lat": lat, "lon": lon, "x": round(x, 2), "y": round(y, 2), "hTerrain": round(hz.h_terrain, 2),
                 "obsHeight": p["obsHeight"], "finestDemRes": hz.to_json()["finestRes"]},
        "interval": {"t0": iso_utc(t0), "t1": iso_utc(t1), "samples": int(times.size), "stepSeconds": dt},
        "horizon": hz.to_json(),
        "metrics": m,
        "events": events,
        "now": {
            "utc": iso_utc(t0),
            "sun": {"azDeg": _f(now.topo.sun_az[0]), "elDeg": _f(now.topo.sun_el[0]),
                    "radiusDeg": _f(now.topo.sun_radius[0], 5), "f": _f(now.f_sun[0]), "up": sun_up,
                    "next": None if nxt_sun is None else {**nxt_sun, "event": "sunset" if sun_up else "sunrise"}},
            "earth": {"azDeg": _f(now.topo.earth_az[0]), "elDeg": _f(now.topo.earth_el[0]),
                      "radiusDeg": _f(now.topo.earth_radius[0], 5), "f": _f(now.f_earth[0]), "dte": earth_ok,
                      "next": None if nxt_earth is None else {**nxt_earth, "event": "earthset" if earth_ok else "earthrise"}},
            "shadowLen2m": _f(shadow_length_m(float(now.topo.sun_el[0])), 2),
        },
        "timing": {"horizonS": round(t_h, 3), "totalS": round(time.time() - t_start, 3)},
    }
    if p.get("includeSeries"):
        out["series"] = {"t": [iso_utc(t) for t in times], "fSun": np.round(s.f_sun, 4).tolist(),
                         "fEarth": np.round(s.f_earth, 4).tolist(), "sunAz": np.round(s.topo.sun_az, 3).tolist(),
                         "sunEl": np.round(s.topo.sun_el, 4).tolist(), "earthAz": np.round(s.topo.earth_az, 3).tolist(),
                         "earthEl": np.round(s.topo.earth_el, 4).tolist()}
    return out


# --------------------------------------------------------------------------- heatmap
def _region_window(reg: dict, bbox: list[float] | None):
    xs, ys = reg["xs"], reg["ys"]
    if bbox is None:
        return slice(0, ys.size), slice(0, xs.size)
    xmin, ymin, xmax, ymax = bbox
    if not (xmax > xmin and ymax > ymin):
        raise BadRequest("bbox must be [xmin, ymin, xmax, ymax] with xmax > xmin and ymax > ymin")
    cs = np.flatnonzero((xs >= xmin) & (xs <= xmax))
    rs = np.flatnonzero((ys >= ymin) & (ys <= ymax))
    if cs.size == 0 or rs.size == 0:
        raise BadRequest("bbox does not intersect the region horizon map")
    return slice(int(rs[0]), int(rs[-1]) + 1), slice(int(cs[0]), int(cs[-1]) + 1)


def _features(reg: dict, rs, cs, footprint: float) -> tuple[dict, dict]:
    fm = reg["featuresMeta"]
    nb = suitability.box_size(footprint, fm["demRes"])
    key = 1 if nb == 1 else 3
    F = reg["features"]
    feat = {k: np.asarray(F[f"{k}_{key}"][rs, cs], dtype=np.float64) for k in ("slopeMax", "slopeMean", "relief")}
    info = {"demRes": fm["demRes"], "boxCells": key, "boxM": key * fm["demRes"],
            "approximate": bool(footprint < fm["demRes"] or nb > 3 or reg["meta"]["res"] > footprint)}
    return feat, info


_LAYERS: OrderedDict = OrderedDict()  # interval layers shared by presets/weights/footprints (LRU, 4 entries)


def interval_layers(ds: DataStore, p: dict, rs, cs) -> tuple[dict, dict]:
    eph = ds.require_eph()
    reg = ds.require_region()
    span_h = (parse_utc(p["t1"]) - parse_utc(p["t0"])) / 3600.0
    step_h = p.get("stepHours") or (2.0 if span_h > 120 else 0.5)
    times, dt, t0, t1 = time_grid(p["t0"], p["t1"], step_h * 3600.0, eph, MAX_HEATMAP_SAMPLES)
    lkey = (ds.version, t0, t1, dt, p["dteThreshold"], rs.start, rs.stop, cs.start, cs.stop)
    if lkey in _LAYERS:
        _LAYERS.move_to_end(lkey)
        return _LAYERS[lkey]
    S, E = eph.vectors(times)
    hmap = np.asarray(reg["hmap"][rs, cs])
    hterr = np.asarray(reg["hterr"][rs, cs], dtype=np.float64)
    lay = maps.run_interval_maps(hmap, hterr, reg["xs"][cs], reg["ys"][rs], S, E, reg["meta"]["obsHeight"],
                                 p["dteThreshold"], DARK_F)
    lay["darkH"] = lay.pop("darkSamples") * dt / 3600.0
    out = (lay, {"t0": iso_utc(t0), "t1": iso_utc(t1), "samples": int(times.size), "stepHours": dt / 3600.0})
    _LAYERS[lkey] = out
    while len(_LAYERS) > 4:
        _LAYERS.popitem(last=False)
    return out


def heatmap(ds: DataStore, p: dict, out_dir: Path) -> dict:
    """Compute (or reuse) a heatmap; writes <id>.png, <id>.json, <id>.score.bin into out_dir."""
    key = canonical_key("heatmap", p, ds.version)
    hid = key[:24]
    meta_p = out_dir / f"{hid}.json"
    if meta_p.exists():
        return {"id": hid, "cached": True, "meta": json.loads(meta_p.read_text())}
    reg = ds.require_region()
    rs, cs = _region_window(reg, p.get("bbox"))
    t_start = time.time()
    lay, tinfo = interval_layers(ds, p, rs, cs)
    params = suitability.resolve(p["preset"], p.get("weights"), p.get("slopeLimitDeg"))
    feat, finfo = _features(reg, rs, cs, p["footprintM"])
    feat.update({"illum": lay["illum"], "dark": lay["darkH"], "earth": lay["earth"]})
    score, excluded = suitability.score(feat, params, p["footprintM"])
    res = reg["meta"]["res"]
    xs, ys = reg["xs"][cs], reg["ys"][rs]
    # candidates: non-maximum suppression, quick robustness = Dirichlet weight perturbation only
    pool = suitability.top_candidates(score, n=max(30, p.get("candidates", 10)), min_sep_px=max(2, int(2000 / res)))
    cands = []
    if pool:
        ii = np.array([c[0] for c in pool])
        jj = np.array([c[1] for c in pool])
        u = suitability.utilities(feat["illum"][ii, jj], feat["dark"][ii, jj], feat["earth"][ii, jj],
                                  feat["slopeMean"][ii, jj], feat["relief"][ii, jj], p["footprintM"],
                                  params["slopeLimit"], params["darkRef"])
        W = suitability.dirichlet_weights(params["weights"], 200, 50.0, np.random.default_rng(0))
        stab = suitability.rank_stability(suitability.score_matrix(u, W), k=10)
        for n_, (i, j) in enumerate(pool[:p.get("candidates", 10)]):
            lat, lon = xy_to_ll(xs[j], ys[i])
            cands.append({"x": round(float(xs[j]), 1), "y": round(float(ys[i]), 1), "lat": round(float(lat), 5),
                          "lon": round(float(lon), 5), "score": _f(score[i, j]),
                          "rankStability": _f(stab[n_], 3), "rankStabilityMode": "weights-only",
                          "illum": _f(feat["illum"][i, j]), "darkH": _f(feat["dark"][i, j], 2),
                          "earth": _f(feat["earth"][i, j]), "slopeMax": _f(feat["slopeMax"][i, j], 2)})
    valid = np.isfinite(score)
    stats = {"cells": int(score.size), "scored": int(valid.sum()), "excluded": int(excluded.sum()),
             "scoreMean": _f(np.nanmean(score)) if valid.any() else None,
             "scoreP90": _f(np.nanpercentile(score, 90)) if valid.any() else None,
             "illumMean": _f(np.nanmean(lay["illum"])), "earthMean": _f(np.nanmean(lay["earth"])),
             "computeS": round(time.time() - t_start, 2)}
    bbox = [float(xs[0] - res / 2), float(ys[-1] - res / 2), float(xs[-1] + res / 2), float(ys[0] + res / 2)]
    meta = {"id": hid, "bbox": bbox, "res": res, "width": int(xs.size), "height": int(ys.size),
            "params": {**p, **params, "interval": tinfo, "features": finfo, "diskMethod": "straight-edge",
                       "horizon": {"naz": reg["meta"]["naz"], "obsHeight": reg["meta"]["obsHeight"],
                                   "finestRes": reg["meta"]["finestRes"]}},
            "legend": {"min": 0, "max": 1, "colormap": "cividis"},
            "candidates": cands, "stats": stats, "generated": iso_utc(time.time())}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{hid}.png").write_bytes(colorize(score))
    (out_dir / f"{hid}.score.bin").write_bytes(gzip.compress(score.astype("<f4").tobytes(), mtime=0))
    tmp = meta_p.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta))
    tmp.replace(meta_p)
    return {"id": hid, "cached": False, "meta": meta}


# --------------------------------------------------------------------------- robustness
def robustness(ds: DataStore, p: dict) -> dict:
    eph = ds.require_eph()
    dem = ds.require_dem()
    reg = ds.require_region()
    span_h = (parse_utc(p["t1"]) - parse_utc(p["t0"])) / 3600.0
    step_h = p.get("stepHours") or (2.0 if span_h > 120 else 0.5)
    times, dt, t0, t1 = time_grid(p["t0"], p["t1"], step_h * 3600.0, eph, MAX_HEATMAP_SAMPLES)
    params = suitability.resolve(p["preset"], p.get("weights"), p.get("slopeLimitDeg"))
    S, E = eph.vectors(times)
    rng = np.random.default_rng(p.get("seed", 0))
    nd, naz = p["n"], 64
    cands = p["candidates"]
    m = len(cands)
    T = times.size
    tracks = {k: np.empty((m, T)) for k in ("sa", "se", "sr", "ea", "ee", "er")}
    profiles = np.empty((m, nd, naz))
    nominal = np.empty((m, naz))
    fixed = {k: np.empty(m) for k in ("slopeMax", "slopeMean", "relief")}
    quality = []
    feat_rs_cs = []
    for c, cd in enumerate(cands):
        if cd.get("x") is not None and cd.get("y") is not None:
            x, y = float(cd["x"]), float(cd["y"])
        else:
            xx, yy = ll_to_xy(cd["lat"], cd["lon"])
            x, y = float(xx), float(yy)
        lat, lon = (float(v) for v in xy_to_ll(x, y))
        try:
            hz = site_horizon(dem, x, y, h_obs=2.0, naz=naz, err_store=ds.err if ds.err.exists else None, zmax=6)
        except ValueError as e:
            raise BadRequest(f"candidate {c} outside DEM coverage") from e
        tp = topocentric(S, E, lat, lon, hz.h_terrain, 2.0)
        tracks["sa"][c], tracks["se"][c], tracks["sr"][c] = tp.sun_az, tp.sun_el, tp.sun_radius
        tracks["ea"][c], tracks["ee"][c], tracks["er"][c] = tp.earth_az, tp.earth_el, tp.earth_radius
        sig_h = np.nan_to_num(hz.sigma_deg if hz.sigma_deg is not None else np.zeros(naz), nan=0.0)
        sz_obs = 0.0
        if ds.err.exists:
            ez = max(z for z in ds.err.levels() if z <= 5)
            ep = ds.err.pyramid([(ez, *tile_of(ez, x, y))])
            v = ep.sample(ez, x, y)
            sz_obs = float(v) if np.isfinite(v) else 0.0
        dist = np.where(np.isfinite(hz.dist_m) & (hz.dist_m > 0), hz.dist_m, np.inf)
        nominal[c] = hz.elev_deg
        noise_t = np.tan(np.radians(sig_h))[None, :] * rng.standard_normal((nd, naz))
        noise_o = (sz_obs * rng.standard_normal((nd, 1))) / dist[None, :]
        profiles[c] = hz.elev_deg[None, :] + np.degrees(noise_t - noise_o)
        # footprint terrain features from the nearest analysis cell
        j = int(np.argmin(np.abs(reg["xs"] - x)))
        i = int(np.argmin(np.abs(reg["ys"] - y)))
        feat, finfo = _features(reg, slice(i, i + 1), slice(j, j + 1), p["footprintM"])
        for k in fixed:
            fixed[k][c] = feat[k][0, 0]
        feat_rs_cs.append((i, j))
        quality.append({"sigmaZ": _f(sz_obs, 2), "sigmaHorizonMeanDeg": _f(float(np.mean(sig_h)), 4)})
    out = {k: np.empty((m, nd)) for k in ("illum", "dark", "earth")}
    maps.draw_metrics(profiles, tracks["sa"], tracks["se"], tracks["sr"], tracks["ea"], tracks["ee"], tracks["er"],
                      p["dteThreshold"], DARK_F, out["illum"], out["dark"], out["earth"])
    nom = {k: np.empty((m, 1)) for k in ("illum", "dark", "earth")}
    maps.draw_metrics(nominal[:, None, :].copy(), tracks["sa"], tracks["se"], tracks["sr"], tracks["ea"], tracks["ee"],
                      tracks["er"], p["dteThreshold"], DARK_F, nom["illum"], nom["dark"], nom["earth"])
    dt_h = dt / 3600.0
    u = suitability.utilities(out["illum"].T, out["dark"].T * dt_h, out["earth"].T, fixed["slopeMean"][None, :],
                              fixed["relief"][None, :], p["footprintM"], params["slopeLimit"], params["darkRef"])
    W = suitability.dirichlet_weights(params["weights"], nd, 50.0, rng)
    scores = suitability.score_matrix({k: np.asarray(v) for k, v in u.items()}, W)  # [nd, m]
    excluded = fixed["slopeMax"] > params["slopeLimit"]
    scores[:, excluded] = np.nan
    stab = suitability.rank_stability(scores, p["k"])
    feat_nom = {"illum": nom["illum"][:, 0], "dark": nom["dark"][:, 0] * dt_h, "earth": nom["earth"][:, 0], **fixed}
    s_nom, _ = suitability.score(feat_nom, params, p["footprintM"])
    ranks = np.argsort(np.argsort(-np.where(np.isfinite(scores), scores, -np.inf), axis=1), axis=1) + 1
    res = []
    for c in range(m):
        sc = scores[:, c]
        res.append({"index": c, "x": cands[c].get("x"), "y": cands[c].get("y"), "score": _f(s_nom[c]),
                    "rankStability": _f(stab[c], 3), "scoreMean": _f(np.nanmean(sc)) if np.isfinite(sc).any() else None,
                    "scoreStd": _f(np.nanstd(sc)) if np.isfinite(sc).any() else None,
                    "medianRank": int(np.median(ranks[:, c])), "excluded": bool(excluded[c]),
                    "illum": _f(feat_nom["illum"][c]), "darkH": _f(feat_nom["dark"][c], 2),
                    "earth": _f(feat_nom["earth"][c]), "dataQuality": quality[c]})
    return {"params": {**p, **params, "interval": {"t0": iso_utc(t0), "t1": iso_utc(t1), "samples": int(T),
                                                   "stepHours": dt_h}},
            "method": ("Monte-Carlo: weights ~ Dirichlet(50 w); horizon H(A) + N(0, sigma_H(A)) per azimuth "
                       "(sigma_H = atan(sigma_z(p*)/D)) minus the observer-height error sigma_z(obs)/D; 64 azimuths, "
                       "straight-edge disk fractions; share of draws in which a candidate is in the top-k of the "
                       "submitted candidates."),
            "n": nd, "k": p["k"], "candidates": res}

