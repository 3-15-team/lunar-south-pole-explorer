// Terrain horizon profile by multi-resolution ray marching (docs/METRICS.md).
import { HullBuilder, type HorizonHull } from './antenna';
import { R_MOON_M, RAD, gridDirection, sampleTanElevation, wrap360, xyToLatLon, xyToUnit, type Vec3 } from './geo';

/** Height source. Implemented by the DEM tile client (worker) and by analytic test terrains. */
export interface DemSampler {
  /** Finest grid resolution (m/px) available around (x, y). */
  finestRes(x: number, y: number): number;
  /** Height (m above R) at SPS (x, y) using data no finer than ~`res` m; NaN when no data. */
  height(x: number, y: number, res: number): number;
  /** 1-σ height error (m) at (x, y), if known. */
  errorAt?(x: number, y: number): number;
  /** Rays stop beyond this distance from the pole (end of coverage), m. */
  maxRho: number;
}

export interface HorizonOptions {
  naz?: number; // azimuth samples (default 1440 = 0.25°)
  alpha?: number; // geometric step growth (default 0.01)
  maxDist?: number; // grid metres (default 300 km)
  hObs?: number; // observer height above terrain, m (default 2)
  farFrom?: number; // also compute the horizon formed only by terrain beyond this distance
  hull?: boolean; // also keep per-azimuth envelopes for any observer/antenna height (core/antenna.ts)
}

export interface HorizonProfile {
  naz: number;
  elev: Float32Array; // deg, max elevation of terrain per azimuth (−90 if none)
  dist: Float32Array; // m, distance to the horizon-defining sample
  sigma?: Float32Array; // deg, 1-σ of elev (from DEM error), when available
  elevFar?: Float32Array; // deg, horizon from terrain beyond `farFrom` only
  farFrom?: number;
  x: number;
  y: number;
  lat: number;
  lon: number;
  hTerrain: number;
  hObs: number;
  finestRes: number;
  /** Envelopes for exact horizons at any height (worker-side only; never posted to the UI). */
  hull?: HorizonHull;
  /** Horizon seen from the Earth antenna (deg per azimuth); Earth visibility uses it when present. */
  elevEarth?: Float32Array;
  /** Antenna height above the site's terrain, m. */
  hAnt?: number;
}

/** Distances and DEM resolutions of the ray-march steps. */
export function marchSteps(finestRes: number, alpha: number, maxDist: number): { d: Float64Array; res: Float64Array } {
  const minStep = 0.5 * finestRes;
  const d: number[] = [];
  const res: number[] = [];
  let s = minStep;
  while (s <= maxDist) {
    const step = Math.max(alpha * s, minStep);
    d.push(s);
    res.push(Math.max(finestRes, step));
    s += step;
  }
  return { d: Float64Array.from(d), res: Float64Array.from(res) };
}

export function computeHorizon(sampler: DemSampler, x: number, y: number, o: HorizonOptions = {}): HorizonProfile {
  const naz = o.naz ?? 1440;
  const alpha = o.alpha ?? 0.01;
  const maxDist = o.maxDist ?? 300e3;
  const hObs = o.hObs ?? 2;
  const farFrom = o.farFrom;
  const fr = sampler.finestRes(x, y);
  const hT = sampler.height(x, y, fr);
  if (!Number.isFinite(hT)) throw new Error('No DEM data at this location (outside coverage).');
  const ho = hT + hObs;
  const uo = xyToUnit(x, y);
  const { lat, lon } = xyToLatLon(x, y);
  const { d, res } = marchSteps(fr, alpha, maxDist);
  const elev = new Float32Array(naz);
  const dist = new Float32Array(naz);
  const elevFar = farFrom !== undefined ? new Float32Array(naz) : undefined;
  const sigma = sampler.errorAt ? new Float32Array(naz) : undefined;
  const ut: Vec3 = [0, 0, 0];
  const rho2 = sampler.maxRho * sampler.maxRho;
  const hb = o.hull ? new HullBuilder(naz, d.length) : null;
  for (let k = 0; k < naz; k++) {
    const { dx, dy } = gridDirection(lon, (k * 360) / naz);
    let best = -Infinity;
    let bestFar = -Infinity;
    let bestD = 0;
    let bx = x;
    let by = y;
    for (let j = 0; j < d.length; j++) {
      const px = x + dx * d[j];
      const py = y + dy * d[j];
      if (px * px + py * py > rho2) break;
      const h = sampler.height(px, py, res[j]);
      if (h !== h) continue; // NaN: no data
      xyToUnit(px, py, ut);
      const t = sampleTanElevation(uo, ho, ut, h);
      if (hb) {
        // same geometry as sampleTanElevation, split into the height-independent Z and D
        const ex = ut[0] - uo[0];
        const ey = ut[1] - uo[1];
        const ez = ut[2] - uo[2];
        const c2 = ex * ex + ey * ey + ez * ez;
        const rh = R_MOON_M + h;
        hb.push(h - hT - (rh * c2) / 2, rh * Math.sqrt(c2) * Math.sqrt(1 - c2 / 4));
      }
      if (t > best) {
        best = t;
        bestD = d[j];
        bx = px;
        by = py;
      }
      if (elevFar && d[j] >= (farFrom as number) && t > bestFar) bestFar = t;
    }
    hb?.endRay();
    elev[k] = best === -Infinity ? -90 : Math.atan(best) * RAD;
    dist[k] = bestD;
    if (elevFar) elevFar[k] = bestFar === -Infinity ? -90 : Math.atan(bestFar) * RAD;
    if (sigma && bestD > 0 && sampler.errorAt) {
      const sz = sampler.errorAt(bx, by);
      sigma[k] = Number.isFinite(sz) ? Math.atan(sz / bestD) * RAD : 0;
    }
  }
  return { naz, elev, dist, sigma, elevFar, farFrom, x, y, lat, lon, hTerrain: hT, hObs, finestRes: fr, hull: hb?.finish() };
}

/** Linear interpolation of a profile array at azimuth (deg). */
export function profileAt(arr: Float32Array, azDeg: number): number {
  const n = arr.length;
  const f = (wrap360(azDeg) * n) / 360;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  return arr[i0] * (1 - t) + arr[i1] * t;
}

export function horizonFn(p: { elev: Float32Array }): (az: number) => number {
  return (az: number) => profileAt(p.elev, az);
}

/** Resample a profile to fewer azimuths (max-pooling keeps peaks), e.g. for the GPU. */
export function downsampleProfile(arr: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n);
  const m = arr.length / n;
  for (let i = 0; i < n; i++) {
    let v = -90;
    const a = Math.floor((i - 0.5) * m);
    const b = Math.ceil((i + 0.5) * m);
    for (let j = a; j <= b; j++) v = Math.max(v, arr[((j % arr.length) + arr.length) % arr.length]);
    out[i] = v;
  }
  return out;
}
