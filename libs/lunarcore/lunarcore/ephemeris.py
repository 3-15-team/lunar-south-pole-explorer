"""Sun/Earth ephemeris tables (docs/DATA.md §3) and topocentric directions (METRICS.md "Inputs").

Tables: per calendar year ``{YYYY}.bin`` = float32-le records ``[sunX, sunY, sunZ, earthX, earthY, earthZ]``
(km, MOON_ME, apparent LT+S, observer = Moon centre) on a uniform UTC grid with step 1800 s starting
at ``Date.UTC(Y, 0, 1)``. Years are contiguous, so all years together form one uniform grid; consumers
interpolate linearly between records.
"""

from __future__ import annotations

import calendar
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from .geo import EARTH_RADIUS_KM, R_MOON, SUN_RADIUS_KM, az_el, enu_basis, observer_position_km

STEP_SECONDS = 1800
START_UTC = "2026-01-01T00:00:00Z"
END_UTC = "2150-01-01T00:00:00Z"


def parse_utc(s: str | float | int | datetime) -> float:
    """ISO-8601 (``Z`` or offset; naive = UTC) / datetime / unix seconds -> unix seconds (float)."""
    if isinstance(s, (int, float, np.floating, np.integer)):
        return float(s)
    if isinstance(s, datetime):
        dt = s
    else:
        txt = s.strip().replace(" ", "T")
        if txt.endswith("Z") or txt.endswith("z"):
            txt = txt[:-1] + "+00:00"
        dt = datetime.fromisoformat(txt)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.timestamp()


def iso_utc(t: float) -> str:
    """unix seconds -> ``YYYY-MM-DDTHH:MM:SSZ`` (rounded to the second)."""
    return datetime.fromtimestamp(round(float(t)), tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def year_start_unix(year: int) -> int:
    return calendar.timegm((year, 1, 1, 0, 0, 0))


def records_in_year(year: int) -> int:
    return (366 if calendar.isleap(year) else 365) * 48


@dataclass
class Topo:
    """Topocentric Sun/Earth quantities, arrays over time (degrees, km)."""

    sun_az: np.ndarray
    sun_el: np.ndarray
    sun_radius: np.ndarray
    sun_dist_km: np.ndarray
    earth_az: np.ndarray
    earth_el: np.ndarray
    earth_radius: np.ndarray
    earth_dist_km: np.ndarray


class Ephemeris:
    """In-memory concatenation of the yearly tables (11 years = 4.6 MB float32)."""

    def __init__(self, t0_unix: float, step: float, records: np.ndarray, meta: dict | None = None):
        self.t0 = float(t0_unix)
        self.step = float(step)
        self.rec = np.asarray(records, dtype=np.float64)
        self.meta = meta or {}

    @classmethod
    def load(cls, root: Path | str) -> Ephemeris:
        root = Path(root)
        idx = json.loads((root / "index.json").read_text())
        parts = []
        years = sorted(idx["years"], key=lambda y: y["year"])
        expect_t = parse_utc(idx["startUtc"])
        for y in years:
            if year_start_unix(y["year"]) != expect_t:
                raise ValueError(f"ephemeris years are not contiguous at {y['year']}")
            a = np.fromfile(root / y["url"], dtype="<f4").reshape(-1, 6)
            if a.shape[0] != y["records"]:
                raise ValueError(f"{y['url']}: {a.shape[0]} records, index says {y['records']}")
            parts.append(a)
            expect_t += a.shape[0] * idx["stepSeconds"]
        return cls(parse_utc(idx["startUtc"]), idx["stepSeconds"], np.concatenate(parts), idx)

    @property
    def t_end(self) -> float:
        return self.t0 + (self.rec.shape[0] - 1) * self.step

    def covers(self, t0: float, t1: float) -> bool:
        return self.t0 <= t0 and t1 <= self.t_end

    def vectors(self, t_unix) -> tuple[np.ndarray, np.ndarray]:
        """Linear interpolation -> (S [...,3], E [...,3]) km, Moon-centred MOON_ME."""
        t = np.asarray(t_unix, dtype=np.float64)
        g = (t - self.t0) / self.step
        n = self.rec.shape[0]
        if np.any(g < -1e-9) or np.any(g > n - 1 + 1e-9):
            raise ValueError("time outside the ephemeris table range")
        k = np.clip(np.floor(g).astype(np.int64), 0, n - 2)
        f = (g - k)[..., None]
        v = self.rec[k] * (1.0 - f) + self.rec[k + 1] * f
        return v[..., 0:3], v[..., 3:6]

    def topo(self, lat_deg: float, lon_deg: float, h_terrain_m: float, h_obs_m: float, t_unix) -> Topo:
        S, E = self.vectors(t_unix)
        return topocentric(S, E, lat_deg, lon_deg, h_terrain_m, h_obs_m)


def topocentric(S, E, lat_deg, lon_deg, h_terrain_m, h_obs_m=2.0, R: float = R_MOON) -> Topo:
    """Body vectors from the Moon centre (km) -> topocentric az/el/angular radius/distance."""
    P = observer_position_km(lat_deg, lon_deg, h_terrain_m, h_obs_m, R)
    east, north, up = enu_basis(lat_deg, lon_deg)
    s = np.asarray(S, dtype=np.float64) - P
    e = np.asarray(E, dtype=np.float64) - P
    ds = np.linalg.norm(s, axis=-1)
    de = np.linalg.norm(e, axis=-1)
    saz, sel = az_el(s, east, north, up)
    eaz, eel = az_el(e, east, north, up)
    return Topo(
        sun_az=saz, sun_el=sel, sun_radius=np.degrees(np.arcsin(SUN_RADIUS_KM / ds)), sun_dist_km=ds,
        earth_az=eaz, earth_el=eel, earth_radius=np.degrees(np.arcsin(EARTH_RADIUS_KM / de)), earth_dist_km=de,
    )


def default_root() -> Path:
    import os

    return Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[3] / "data")) / "web" / "ephem"
