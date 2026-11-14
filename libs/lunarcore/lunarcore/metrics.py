"""Interval metrics, events and site time series (METRICS.md "Events and states", "Interval metrics").

Sample convention: an interval [t0, t1] is represented by N = max(1, round((t1 - t0)/step)) samples at
``t0 + k*dt`` with ``dt = (t1 - t0)/N`` (k = 0..N-1); each sample stands for ``dt`` of time, so
``sunlitHours = sum(f_sun) * dt`` and a run of n consecutive samples lasts ``n * dt``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .disk import fractions_slices, fractions_straight
from .ephemeris import Ephemeris, Topo, iso_utc
from .geo import AU_KM

DARK_F = 0.05  # f_sun below this counts as "dark" for longestDarkH
DTE_DEFAULT = 0.5
EVENT_TOL_S = 60.0
SEARCH_DAYS = 60.0


# --------------------------------------------------------------------------- run helpers
def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) index pairs of consecutive True samples."""
    m = np.asarray(mask, dtype=bool)
    if m.size == 0:
        return []
    d = np.diff(np.concatenate([[0], m.astype(np.int8), [0]]))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return list(zip(starts.tolist(), ends.tolist()))


def longest_run(mask: np.ndarray) -> tuple[int, int, bool]:
    """(length in samples, start index, censored) of the longest True run; censored = touches an end."""
    rr = runs(mask)
    if not rr:
        return 0, -1, False
    s, e = max(rr, key=lambda r: (r[1] - r[0], -r[0]))
    n = len(mask)
    return e - s, s, bool(s == 0 or e == n)


def _stats(v: np.ndarray) -> dict | None:
    v = np.asarray(v, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return None
    return {"min": float(v.min()), "mean": float(v.mean()), "max": float(v.max())}


# --------------------------------------------------------------------------- interval metrics
def interval_metrics(dt_hours: float, f_sun, f_earth, dte: float = DTE_DEFAULT, sun_el=None, earth_el=None,
                     sun_dist_km=None, t0: float | None = None) -> dict:
    """All METRICS.md interval metrics from per-sample arrays (times are only used for labels)."""
    fs = np.asarray(f_sun, dtype=np.float64)
    fe = np.asarray(f_earth, dtype=np.float64)
    n = fs.size
    dt = float(dt_hours)
    up = fs > 0.0
    dark_len, dark_start, dark_cens = longest_run(fs < DARK_F)
    vis = fe >= dte
    nc_len, nc_start, nc_cens = longest_run(~vis)
    out = {
        "samples": int(n), "dtHours": dt,
        "illumFrac": float(fs.mean()) if n else 0.0,
        "sunlitHours": float(fs.sum() * dt),
        "anySunHours": float(up.sum() * dt),
        "longestDarkH": float(dark_len * dt), "longestDarkCensored": dark_cens,
        "nSunsets": int(np.sum(up[:-1] & ~up[1:])) if n > 1 else 0,
        "nSunrises": int(np.sum(~up[:-1] & up[1:])) if n > 1 else 0,
        "earthFrac": float(vis.mean()) if n else 0.0,
        "longestNoCommsH": float(nc_len * dt), "longestNoCommsCensored": nc_cens,
        "dteThreshold": float(dte),
    }

    def label(k):
        return iso_utc(t0 + k * dt * 3600.0) if t0 is not None else k

    out["longestDarkStart"] = label(dark_start) if dark_len else None
    out["longestNoCommsStart"] = label(nc_start) if nc_len else None
    out["dteWindows"] = [[label(s), label(e)] for s, e in runs(vis)]
    if sun_el is not None:
        se = np.asarray(sun_el, dtype=np.float64)
        out["sunElStats"] = _stats(se[up])
        if sun_dist_km is not None:
            au2 = (AU_KM / np.asarray(sun_dist_km, dtype=np.float64)) ** 2
        else:
            au2 = 1.0
        rad = np.radians(se)
        pv = float(np.mean(fs * np.cos(rad) * au2)) if n else 0.0
        ph = float(np.mean(fs * np.maximum(0.0, np.sin(rad)) * au2)) if n else 0.0
        out["powerVertical"] = pv
        out["powerHorizontal"] = ph
        out["powerRatio"] = pv / max(ph, 1e-6)
    if earth_el is not None:
        out["earthElStats"] = _stats(earth_el)
    return out


def shadow_length_m(sun_el_deg: float, pole_m: float = 2.0) -> float | None:
    """Shadow of a vertical pole on level ground: pole / tan(el); None when the Sun is down."""
    if sun_el_deg <= 0:
        return None
    return pole_m / math.tan(math.radians(sun_el_deg))


# --------------------------------------------------------------------------- site model
@dataclass
class Series:
    t: np.ndarray
    f_sun: np.ndarray
    f_earth: np.ndarray
    topo: Topo


class SiteModel:
    """Sun/Earth visibility at a site: ephemeris + horizon profile (+ disk method)."""

    def __init__(self, eph: Ephemeris, profile_deg: np.ndarray, lat: float, lon: float, h_terrain: float,
                 h_obs: float = 2.0, method: str = "slices"):
        self.eph = eph
        self.prof = np.ascontiguousarray(profile_deg, dtype=np.float64)
        self.lat, self.lon, self.h_t, self.h_o = float(lat), float(lon), float(h_terrain), float(h_obs)
        self.method = method

    def evaluate(self, t) -> Series:
        t = np.atleast_1d(np.asarray(t, dtype=np.float64))
        topo = self.eph.topo(self.lat, self.lon, self.h_t, self.h_o, t)
        fn = fractions_slices if self.method == "slices" else fractions_straight
        fs = fn(self.prof, topo.sun_az, topo.sun_el, topo.sun_radius)
        fe = fn(self.prof, topo.earth_az, topo.earth_el, topo.earth_radius)
        return Series(t=t, f_sun=fs, f_earth=fe, topo=topo)

    def series(self, t0: float, t1: float, step_s: float) -> tuple[Series, float]:
        n = max(1, int(round((t1 - t0) / step_s)))
        dt = (t1 - t0) / n
        return self.evaluate(t0 + dt * np.arange(n)), dt

    def _state(self, t: float, body: str, thr: float) -> bool:
        s = self.evaluate(t)
        f = s.f_sun[0] if body == "sun" else s.f_earth[0]
        return bool(f > 0.0) if body == "sun" else bool(f >= thr)

    def bisect(self, ta: float, tb: float, body: str, thr: float, tol: float = EVENT_TOL_S) -> float:
        sa = self._state(ta, body, thr)
        while tb - ta > tol:
            tm = 0.5 * (ta + tb)
            if self._state(tm, body, thr) == sa:
                ta = tm
            else:
                tb = tm
        return 0.5 * (ta + tb)

    def events(self, s: Series, dte: float = DTE_DEFAULT) -> list[dict]:
        """Sunrise/sunset (f_sun through 0) and Earthrise/Earthset (f_earth through dte), 1-minute bisection."""
        out = []
        for body, f, thr, names in (("sun", s.f_sun, 0.0, ("sunrise", "sunset")),
                                    ("earth", s.f_earth, dte, ("earthrise", "earthset"))):
            st = f > 0.0 if body == "sun" else f >= thr
            for k in np.flatnonzero(st[1:] != st[:-1]):
                te = self.bisect(float(s.t[k]), float(s.t[k + 1]), body, thr)
                out.append({"type": names[0] if st[k + 1] else names[1], "t": te, "utc": iso_utc(te)})
        out.sort(key=lambda e: e["t"])
        return out

    def next_transition(self, t: float, body: str, thr: float = DTE_DEFAULT, max_days: float = SEARCH_DAYS,
                        scan_s: float = 600.0) -> dict | None:
        """Next change of state after t (scan every scan_s, then bisection); None if none within max_days."""
        t_end = min(t + max_days * 86400.0, self.eph.t_end)
        s0 = self._state(t, body, thr)
        chunk = 86400.0 * 5
        ta = t
        while ta < t_end:
            tb = min(ta + chunk, t_end)
            n = max(2, int(math.ceil((tb - ta) / scan_s)) + 1)
            ts = np.linspace(ta, tb, n)
            s = self.evaluate(ts)
            f = s.f_sun if body == "sun" else s.f_earth
            st = f > 0.0 if body == "sun" else f >= thr
            idx = np.flatnonzero(st != s0)
            if idx.size:
                k = int(idx[0])
                te = self.bisect(float(ts[k - 1]), float(ts[k]), body, thr) if k > 0 else float(ts[0])
                return {"t": te, "utc": iso_utc(te), "inHours": (te - t) / 3600.0, "toState": bool(not s0)}
            ta = tb
        return None
