// Earth link vs antenna height (docs/METRICS.md "Antenna height").
//
// For a terrain sample k on an azimuth ray the exact elevation seen from height h above the site's
// terrain is tan e = (Z_k − h) / D_k with
//   Z_k = h_k − h_t − (R + h_k)·c²/2,  D_k = (R + h_k)·c·√(1 − c²/4)    (geo.sampleTanElevation)
// — Z and D do not depend on h. So
//   horizon(h)            = max_k (Z_k − h) / D_k
//   height needed for t   = max_k (Z_k − D_k·t)        (to see elevation e = atan t over the ray)
// The second is the upper envelope of lines in t. One ray march per azimuth (the one the horizon
// already does) keeps only the envelope lines over the useful t range; every antenna height and
// every "how high must it be" question is then exact and needs no DEM access.

import { diskFraction } from './disk';

const DEG = Math.PI / 180;

/** Elevation range the envelope is exact over (Earth from 80–90°S stays within ±18°). */
export const HULL_T_MIN = Math.tan(-35 * DEG);
export const HULL_T_MAX = Math.tan(35 * DEG);
/** Above this the answer is "no link": an antenna that tall is not a design option. */
export const ANT_CAP_M = 1000;
export const ANT_MIN_M = 1;

/** Per-azimuth upper envelopes: lines [off[k], off[k+1]) of azimuth k; Z, D in metres. */
export interface HorizonHull {
  naz: number;
  off: Int32Array;
  Z: Float32Array;
  D: Float32Array;
}

/** Collects one ray's samples (in march order, D increasing) and keeps its envelope lines. */
export class HullBuilder {
  private zs: Float64Array;
  private ds: Float64Array;
  private n = 0;
  private stZ: Float64Array;
  private stD: Float64Array;
  private Z: number[] = [];
  private D: number[] = [];
  private off: number[] = [0];

  constructor(
    readonly naz: number,
    maxSamples: number,
  ) {
    this.zs = new Float64Array(maxSamples);
    this.ds = new Float64Array(maxSamples);
    this.stZ = new Float64Array(maxSamples);
    this.stD = new Float64Array(maxSamples);
  }

  push(z: number, d: number): void {
    this.zs[this.n] = z;
    this.ds[this.n] = d;
    this.n++;
  }

  /** Close the current azimuth: upper envelope of y = Z − D·t, trimmed to [HULL_T_MIN, HULL_T_MAX]. */
  endRay(): void {
    // slopes −D ascending ⇔ D descending ⇔ reverse march order
    const sZ = this.stZ;
    const sD = this.stD;
    let m = 0;
    // l2 is useless if l1 and l3 meet at or left of where l1 and l2 meet
    const cross = (z1: number, d1: number, z2: number, d2: number) => (z1 - z2) / (d1 - d2); // t where equal
    for (let i = this.n - 1; i >= 0; i--) {
      const z = this.zs[i];
      const d = this.ds[i];
      if (m > 0 && d === sD[m - 1]) {
        if (z <= sZ[m - 1]) continue;
        m--;
      }
      while (m >= 2 && cross(sZ[m - 2], sD[m - 2], z, d) <= cross(sZ[m - 2], sD[m - 2], sZ[m - 1], sD[m - 1])) m--;
      sZ[m] = z;
      sD[m] = d;
      m++;
    }
    // line j is on top over [x(j−1, j), x(j, j+1)]
    for (let j = 0; j < m; j++) {
      const lo = j > 0 ? cross(sZ[j - 1], sD[j - 1], sZ[j], sD[j]) : -Infinity;
      const hi = j < m - 1 ? cross(sZ[j], sD[j], sZ[j + 1], sD[j + 1]) : Infinity;
      if (hi < HULL_T_MIN || lo > HULL_T_MAX) continue;
      this.Z.push(sZ[j]);
      this.D.push(sD[j]);
    }
    this.off.push(this.Z.length);
    this.n = 0;
  }

  finish(): HorizonHull {
    return { naz: this.naz, off: Int32Array.from(this.off), Z: Float32Array.from(this.Z), D: Float32Array.from(this.D) };
  }
}

/** Horizon elevation (deg) of azimuth bin k seen from `h` m above the site's terrain. */
export function hullElevation(hull: HorizonHull, k: number, h: number): number {
  let best = -Infinity;
  for (let i = hull.off[k]; i < hull.off[k + 1]; i++) {
    const t = (hull.Z[i] - h) / hull.D[i];
    if (t > best) best = t;
  }
  return best === -Infinity ? -90 : Math.atan(best) / DEG;
}

/** Full horizon profile (deg per azimuth bin) at height `h`. */
export function hullProfile(hull: HorizonHull, h: number, out = new Float32Array(hull.naz)): Float32Array {
  for (let k = 0; k < hull.naz; k++) out[k] = hullElevation(hull, k, h);
  return out;
}

export interface EarthPos {
  az: number;
  el: number;
  r: number;
}

/** Visible fraction of the Earth disk at height h (exact horizon from the hull, sliced disk). */
export function fractionAt(hull: HorizonHull, h: number, p: EarthPos): number {
  const n = hull.naz;
  const cache = new Map<number, number>();
  const bin = (i: number) => {
    let v = cache.get(i);
    if (v === undefined) cache.set(i, (v = hullElevation(hull, i, h)));
    return v;
  };
  const H = (azDeg: number) => {
    const f = ((((azDeg % 360) + 360) % 360) * n) / 360;
    const i0 = Math.floor(f) % n;
    const w = f - Math.floor(f);
    return bin(i0) * (1 - w) + bin((i0 + 1) % n) * w;
  };
  return diskFraction(H, p.az, p.el, p.r);
}

/**
 * Lowest antenna height (m above the site's terrain) giving a link (≥ `dte` of the Earth disk):
 * ANT_MIN_M if already visible from 1 m, Infinity if not even from ANT_CAP_M. Exact up to the
 * bisection tolerance (0.1 %); visibility is monotone in height (every sample's angle drops).
 */
export function neededHeight(hull: HorizonHull, p: EarthPos, dte: number): number {
  const ok = (h: number) => fractionAt(hull, h, p) >= dte;
  if (ok(ANT_MIN_M)) return ANT_MIN_M;
  if (!ok(ANT_CAP_M)) return Infinity;
  let lo = ANT_MIN_M;
  let hi = ANT_CAP_M;
  for (let i = 0; i < 18; i++) {
    const mid = Math.sqrt(lo * hi);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Needed height over the interval at evenly spaced times (the distribution's raw data). */
export interface AntennaSeries {
  t: Float64Array;
  need: Float32Array; // m; Infinity = no link up to ANT_CAP_M
  capM: number;
  minM: number;
}

/** Share of the series with a link for an antenna of height h. */
export function linkShare(need: ArrayLike<number>, h: number): number {
  if (!need.length) return 0;
  let ok = 0;
  for (let i = 0; i < need.length; i++) if (need[i] <= h) ok++;
  return ok / need.length;
}

/** Lowest height giving a link for at least `q` of the time; null = not reachable ≤ ANT_CAP_M. */
export function neededForShare(need: ArrayLike<number>, q: number): number | null {
  if (!need.length) return null;
  const s = Float64Array.from(need).sort();
  const v = s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length - 1e-9) - 1))];
  return Number.isFinite(v) ? v : null;
}

/** Needed height at time t by linear interpolation of the series (null outside it). */
export function neededAt(a: AntennaSeries, t: number): number | null {
  const n = a.t.length;
  if (!n || t < a.t[0] || t > a.t[n - 1]) return null;
  let i = 1;
  while (i < n - 1 && a.t[i] < t) i++;
  const v0 = a.need[i - 1];
  const v1 = a.need[i];
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return t - a.t[i - 1] < a.t[i] - t ? v0 : v1;
  const w = (t - a.t[i - 1]) / Math.max(1, a.t[i] - a.t[i - 1]);
  return v0 + (v1 - v0) * w;
}
