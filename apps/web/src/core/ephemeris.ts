// Sun/Earth ephemeris tables (MOON_ME, Moon-centred, km; docs/DATA.md §3) and
// topocentric az/el/angular radius for a site.
import {
  AU_KM,
  EARTH_RADIUS_KM,
  R_MOON_KM,
  RAD,
  SUN_RADIUS_KM,
  azEl,
  enuAt,
  latLonToUnit,
  type Enu,
  type Vec3,
} from './geo';

export interface EphemYear {
  year: number;
  url: string;
  records: number;
  sha256?: string;
}

export interface EphemIndex {
  version: number;
  frame: string;
  frameRealization?: string;
  stepSeconds: number;
  startUtc: string;
  endUtc: string;
  years: EphemYear[];
  sunRadiusKm?: number;
  earthRadiusKm?: number;
}

type Fetcher = (url: string) => Promise<ArrayBuffer>;

const defaultFetcher: Fetcher = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ephemeris: ${url} → HTTP ${r.status}`);
  return r.arrayBuffer();
};

export class Ephemeris {
  readonly stepMs: number;
  readonly startMs: number;
  readonly endMs: number;
  private years = new Map<number, Float32Array>();
  private pending = new Map<number, Promise<Float32Array>>();

  constructor(
    readonly index: EphemIndex,
    private baseUrl: string,
    private fetcher: Fetcher = defaultFetcher,
  ) {
    this.stepMs = index.stepSeconds * 1000;
    this.startMs = Date.parse(index.startUtc);
    this.endMs = Date.parse(index.endUtc);
  }

  static async load(baseUrl: string, fetchJson?: (u: string) => Promise<EphemIndex>, fetcher?: Fetcher): Promise<Ephemeris> {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const idx = fetchJson
      ? await fetchJson(base + 'index.json')
      : await fetch(base + 'index.json').then((r) => {
          if (!r.ok) throw new Error(`ephemeris index HTTP ${r.status}`);
          return r.json() as Promise<EphemIndex>;
        });
    return new Ephemeris(idx, base, fetcher);
  }

  /** Inject a year table directly (tests, workers sharing buffers). */
  setYear(year: number, data: Float32Array): void {
    this.years.set(year, data);
  }

  covers(t: number): boolean {
    return t >= this.startMs && t < this.endMs - this.stepMs;
  }

  clamp(t: number): number {
    return Math.min(Math.max(t, this.startMs), this.endMs - this.stepMs - 1);
  }

  private loadYear(year: number): Promise<Float32Array> {
    const have = this.years.get(year);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(year);
    if (!p) {
      const meta = this.index.years.find((y) => y.year === year);
      if (!meta) return Promise.reject(new Error(`ephemeris: year ${year} not available`));
      p = this.fetcher(this.baseUrl + meta.url).then((buf) => {
        const a = new Float32Array(buf);
        if (a.length !== meta.records * 6) throw new Error(`ephemeris ${year}: bad length ${a.length}`);
        this.years.set(year, a);
        this.pending.delete(year);
        return a;
      });
      this.pending.set(year, p);
    }
    return p;
  }

  /** Load every year needed to evaluate [t0, t1] (inclusive of the next record). */
  async ensureRange(t0: number, t1: number): Promise<void> {
    const a = new Date(this.clamp(Math.min(t0, t1))).getUTCFullYear();
    const b = new Date(this.clamp(Math.max(t0, t1) + this.stepMs)).getUTCFullYear();
    const jobs: Promise<Float32Array>[] = [];
    for (let y = a; y <= b; y++) if (this.index.years.some((m) => m.year === y)) jobs.push(this.loadYear(y));
    await Promise.all(jobs);
  }

  isLoaded(t: number): boolean {
    const y = new Date(t).getUTCFullYear();
    return this.years.has(y);
  }

  private record(year: number, k: number): { a: Float32Array; o: number } {
    let a = this.years.get(year);
    if (!a) throw new Error(`ephemeris: year ${year} not loaded`);
    if (k * 6 >= a.length) {
      const next = this.years.get(year + 1);
      if (next) return { a: next, o: 0 };
      return { a, o: a.length - 6 };
    }
    return { a, o: k * 6 };
  }

  /** Moon-centred MOON_ME position (km) of Sun (out[0..2]) and Earth (out[3..5]) at t (ms UTC). */
  at(t: number, out: Float64Array = new Float64Array(6)): Float64Array {
    const tc = this.clamp(t);
    const year = new Date(tc).getUTCFullYear();
    const k = (tc - Date.UTC(year, 0, 1)) / this.stepMs;
    const i0 = Math.floor(k);
    const f = k - i0;
    const r0 = this.record(year, i0);
    const r1 = this.record(year, i0 + 1);
    for (let j = 0; j < 6; j++) out[j] = r0.a[r0.o + j] * (1 - f) + r1.a[r1.o + j] * f;
    return out;
  }
}

/** A site (observer) in MOON_ME with its local ENU frame. */
export interface SiteFrame {
  lat: number;
  lon: number;
  hTerrain: number; // m above R
  hObs: number; // m above terrain
  enu: Enu;
  pKm: Vec3; // observer position, km, MOON_ME
}

export function makeSiteFrame(lat: number, lon: number, hTerrain: number, hObs: number): SiteFrame {
  const u = latLonToUnit(lat, lon);
  const rk = R_MOON_KM + (hTerrain + hObs) / 1000;
  return { lat, lon, hTerrain, hObs, enu: enuAt(lat, lon), pKm: [u[0] * rk, u[1] * rk, u[2] * rk] };
}

export interface BodyTopo {
  az: number; // deg
  el: number; // deg (centre of the disk, geometric, no refraction)
  r: number; // angular radius, deg
  distKm: number;
}

const tmp: Vec3 = [0, 0, 0];

/** Topocentric az/el/radius of body (Moon-centred km vector at offset `o` in `v`). */
export function topo(frame: SiteFrame, v: ArrayLike<number>, o: number, bodyRadiusKm: number): BodyTopo {
  tmp[0] = v[o] - frame.pKm[0];
  tmp[1] = v[o + 1] - frame.pKm[1];
  tmp[2] = v[o + 2] - frame.pKm[2];
  const d = Math.hypot(tmp[0], tmp[1], tmp[2]);
  const { az, el } = azEl(tmp, frame.enu);
  return { az, el, r: Math.asin(Math.min(1, bodyRadiusKm / d)) * RAD, distKm: d };
}

export function sunTopo(frame: SiteFrame, v: ArrayLike<number>): BodyTopo {
  return topo(frame, v, 0, SUN_RADIUS_KM);
}

export function earthTopo(frame: SiteFrame, v: ArrayLike<number>): BodyTopo {
  return topo(frame, v, 3, EARTH_RADIUS_KM);
}

/** Inverse-square solar flux factor relative to 1 AU. */
export function fluxFactor(sunDistKm: number): number {
  const r = AU_KM / sunDistKm;
  return r * r;
}

/** Sub-solar longitude (deg) — used for "local noon" ticks of the lunar day. */
export function subSolarLon(v: ArrayLike<number>): number {
  return Math.atan2(v[1], v[0]) * RAD;
}

/**
 * Illuminated fraction of the Earth's disk seen from the Moon (Earth phase),
 * from the Sun–Earth–observer angle.
 */
export function earthPhase(v: ArrayLike<number>, pKm: Vec3): number {
  const ex = v[3] - pKm[0], ey = v[4] - pKm[1], ez = v[5] - pKm[2]; // observer → Earth
  const sx = v[0] - v[3], sy = v[1] - v[4], sz = v[2] - v[5]; // Earth → Sun
  const cosA = -(ex * sx + ey * sy + ez * sz) / (Math.hypot(ex, ey, ez) * Math.hypot(sx, sy, sz));
  return (1 + cosA) / 2; // cosA: angle at Earth between Sun and observer
}
