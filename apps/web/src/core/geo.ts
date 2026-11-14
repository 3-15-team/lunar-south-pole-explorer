// Geometry on the lunar reference sphere and the south polar stereographic grid.
// Formulas: docs/DATA.md §1 (mirrored by libs/lunarcore/lunarcore/geo.py).

export const R_MOON_M = 1737400;
export const R_MOON_KM = 1737.4;
export const SUN_RADIUS_KM = 695700;
export const EARTH_RADIUS_KM = 6371.0084;
export const AU_KM = 149597870.7;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export type Vec3 = [number, number, number];

export interface LatLon {
  lat: number; // degrees, south negative
  lon: number; // degrees east, (-180, 180]
}

export interface XY {
  x: number; // SPS metres
  y: number;
}

export interface Enu {
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export function wrap360(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

export function wrap180(a: number): number {
  const r = wrap360(a + 180) - 180;
  return r === -180 ? 180 : r;
}

/** Forward south polar stereographic (sphere, true scale at the pole). */
export function latLonToXY(lat: number, lon: number): XY {
  const c = (90 + lat) * DEG;
  const rho = 2 * R_MOON_M * Math.tan(c / 2);
  return { x: rho * Math.sin(lon * DEG), y: rho * Math.cos(lon * DEG) };
}

export function xyToLatLon(x: number, y: number): LatLon {
  const rho = Math.hypot(x, y);
  const c = 2 * Math.atan(rho / (2 * R_MOON_M));
  const lat = c * RAD - 90;
  const lon = rho === 0 ? 0 : Math.atan2(x, y) * RAD;
  return { lat, lon };
}

/** Unit vector in MOON_ME of the sphere point that projects to (x, y); trig-free. */
export function xyToUnit(x: number, y: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const q = (x * x + y * y) / (4 * R_MOON_M * R_MOON_M);
  const d = 1 + q;
  out[0] = y / R_MOON_M / d;
  out[1] = x / R_MOON_M / d;
  out[2] = -(1 - q) / d;
  return out;
}

export function latLonToUnit(lat: number, lon: number): Vec3 {
  const p = lat * DEG;
  const l = lon * DEG;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

/** Projection scale factor k (true distance ≈ grid distance / k). */
export function scaleFactor(x: number, y: number): number {
  return 1 + (x * x + y * y) / (4 * R_MOON_M * R_MOON_M);
}

export function enuAt(lat: number, lon: number): Enu {
  const p = lat * DEG;
  const l = lon * DEG;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const sl = Math.sin(l);
  const cl = Math.cos(l);
  return {
    east: [-sl, cl, 0],
    north: [-sp * cl, -sp * sl, cp],
    up: [cp * cl, cp * sl, sp],
  };
}

/** Azimuth (deg, clockwise from local North, [0,360)) and elevation (deg) of a vector. */
export function azEl(v: Vec3, enu: Enu): { az: number; el: number } {
  const e = dot(v, enu.east);
  const n = dot(v, enu.north);
  const u = dot(v, enu.up);
  return { az: wrap360(Math.atan2(e, n) * RAD), el: Math.atan2(u, Math.hypot(e, n)) * RAD };
}

/** Grid direction (unit, SPS) of local azimuth `azDeg` at a point of longitude `lonDeg`. */
export function gridDirection(lonDeg: number, azDeg: number): { dx: number; dy: number } {
  const a = (lonDeg + azDeg) * DEG;
  return { dx: Math.sin(a), dy: Math.cos(a) };
}

/** Local azimuth of grid direction (dx, dy) at longitude lonDeg. */
export function gridAzimuth(lonDeg: number, dx: number, dy: number): number {
  return wrap360(Math.atan2(dx, dy) * RAD - lonDeg);
}

/**
 * Elevation angle (radians) of a terrain sample seen from an observer — exact on the
 * sphere and cancellation-free (docs/METRICS.md "Horizon profile").
 * uo: observer unit vector, hObsAbs: observer height above R (terrain + mast), m.
 */
export function sampleTanElevation(uo: Vec3, hObsAbs: number, ut: Vec3, h: number): number {
  const dx = ut[0] - uo[0];
  const dy = ut[1] - uo[1];
  const dz = ut[2] - uo[2];
  const c2 = dx * dx + dy * dy + dz * dz;
  const rh = R_MOON_M + h;
  const dv = h - hObsAbs - (rh * c2) / 2;
  const dh = rh * Math.sqrt(c2) * Math.sqrt(1 - c2 / 4);
  return dv / dh;
}

/** Great-circle distance (m) on the reference sphere. */
export function surfaceDistance(a: LatLon, b: LatLon): number {
  const ua = latLonToUnit(a.lat, a.lon);
  const ub = latLonToUnit(b.lat, b.lon);
  const c = Math.hypot(ua[0] - ub[0], ua[1] - ub[1], ua[2] - ub[2]);
  return 2 * R_MOON_M * Math.asin(Math.min(1, c / 2));
}

export function formatLatLon(lat: number, lon: number, digits = 3): string {
  const ns = lat < 0 ? 'S' : 'N';
  const ew = lon < 0 ? 'W' : 'E';
  return `${Math.abs(lat).toFixed(digits)}°${ns} ${Math.abs(lon).toFixed(digits)}°${ew}`;
}

/** Parse "89.5S 120E", "-89.5, 120", "-89.5 -60" etc. Returns null if invalid. */
export function parseLatLon(text: string): LatLon | null {
  const t = text.trim().toUpperCase().replace(/°/g, ' ');
  const m = t.match(/^([+-]?\d+(?:\.\d+)?)\s*([NS])?[\s,;]+([+-]?\d+(?:\.\d+)?)\s*([EW])?$/);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2] === 'S') lat = -Math.abs(lat);
  if (m[2] === 'N') lat = Math.abs(lat);
  if (m[4] === 'W') lon = -Math.abs(lon);
  if (m[4] === 'E') lon = Math.abs(lon);
  if (!(lat >= -90 && lat <= 90) || !(lon >= -360 && lon <= 360)) return null;
  return { lat, lon: wrap180(lon) };
}
