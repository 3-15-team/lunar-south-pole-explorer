// Site metrics over time: events, interval statistics (docs/METRICS.md).
import { diskFraction } from './disk';
import { Ephemeris, earthTopo, fluxFactor, subSolarLon, sunTopo, type SiteFrame } from './ephemeris';
import { DEG, wrap180 } from './geo';
import { profileAt, type HorizonProfile } from './horizon';

export const DARK_THRESHOLD = 0.05; // f_sun below this counts as "dark" for longest-dark runs
export const HOUR = 3600e3;
export const DAY = 86400e3;
export const SYNODIC_MONTH_MS = 29.530589 * DAY;

export interface SiteContext {
  frame: SiteFrame;
  profile: HorizonProfile;
  eph: Ephemeris;
}

export interface Instant {
  t: number;
  sunAz: number;
  sunEl: number;
  sunR: number;
  sunDistKm: number;
  fSun: number;
  earthAz: number;
  earthEl: number;
  earthR: number;
  earthDistKm: number;
  fEarth: number;
  horizonAtSun: number;
  horizonAtEarth: number;
}

const buf = new Float64Array(6);

export function evalAt(ctx: SiteContext, t: number): Instant {
  const v = ctx.eph.at(t, buf);
  const s = sunTopo(ctx.frame, v);
  const e = earthTopo(ctx.frame, v);
  const H = (az: number) => profileAt(ctx.profile.elev, az);
  return {
    t,
    sunAz: s.az,
    sunEl: s.el,
    sunR: s.r,
    sunDistKm: s.distKm,
    fSun: diskFraction(H, s.az, s.el, s.r),
    earthAz: e.az,
    earthEl: e.el,
    earthR: e.r,
    earthDistKm: e.distKm,
    fEarth: diskFraction(H, e.az, e.el, e.r),
    horizonAtSun: H(s.az),
    horizonAtEarth: H(e.az),
  };
}

export interface Series {
  n: number;
  t0: number;
  stepMs: number;
  sunAz: Float32Array;
  sunEl: Float32Array;
  fSun: Float32Array;
  sunFlux: Float32Array; // (1 AU / d)^2
  earthAz: Float32Array;
  earthEl: Float32Array;
  fEarth: Float32Array;
}

export function sampleSeries(ctx: SiteContext, t0: number, t1: number, stepMs: number): Series {
  const n = Math.max(2, Math.floor((t1 - t0) / stepMs) + 1);
  const s: Series = {
    n,
    t0,
    stepMs,
    sunAz: new Float32Array(n),
    sunEl: new Float32Array(n),
    fSun: new Float32Array(n),
    sunFlux: new Float32Array(n),
    earthAz: new Float32Array(n),
    earthEl: new Float32Array(n),
    fEarth: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const x = evalAt(ctx, t0 + i * stepMs);
    s.sunAz[i] = x.sunAz;
    s.sunEl[i] = x.sunEl;
    s.fSun[i] = x.fSun;
    s.sunFlux[i] = fluxFactor(x.sunDistKm);
    s.earthAz[i] = x.earthAz;
    s.earthEl[i] = x.earthEl;
    s.fEarth[i] = x.fEarth;
  }
  return s;
}

export interface Stats {
  min: number;
  mean: number;
  max: number;
}

export interface FractionMetrics {
  illumFrac: number;
  sunlitHours: number;
  anySunHours: number;
  longestDarkH: number;
  longestDarkCensored: boolean;
  nSunsets: number;
  nSunrises: number;
  earthFrac: number;
  longestNoCommsH: number;
  longestNoCommsCensored: boolean;
}

export interface IntervalMetrics extends FractionMetrics {
  hours: number;
  dteWindows: [number, number][];
  sunElStats: Stats | null;
  earthElStats: Stats;
  powerVertical: number;
  powerHorizontal: number;
  powerRatio: number;
}

/** Core interval statistics from sampled fractions (shared with golden tests). */
export function metricsFromFractions(fSun: ArrayLike<number>, fEarth: ArrayLike<number>, dtHours: number, dte = 0.5): FractionMetrics {
  const n = fSun.length;
  let sum = 0;
  let any = 0;
  let nSunsets = 0;
  let nSunrises = 0;
  let earthOk = 0;
  let run = 0;
  let runStart = 0;
  let longest = 0;
  let longestCens = false;
  let crun = 0;
  let crunStart = 0;
  let clongest = 0;
  let clongestCens = false;
  for (let i = 0; i < n; i++) {
    const f = fSun[i];
    sum += f;
    if (f > 0) any++;
    if (i > 0 && fSun[i - 1] > 0 && f <= 0) nSunsets++;
    if (i > 0 && fSun[i - 1] <= 0 && f > 0) nSunrises++;
    if (f < DARK_THRESHOLD) {
      if (run === 0) runStart = i;
      run++;
      if (run > longest) {
        longest = run;
        longestCens = runStart === 0 || i === n - 1;
      }
    } else run = 0;
    const ok = fEarth[i] >= dte;
    if (ok) earthOk++;
    if (!ok) {
      if (crun === 0) crunStart = i;
      crun++;
      if (crun > clongest) {
        clongest = crun;
        clongestCens = crunStart === 0 || i === n - 1;
      }
    } else crun = 0;
  }
  return {
    illumFrac: n ? sum / n : 0,
    sunlitHours: sum * dtHours,
    anySunHours: any * dtHours,
    longestDarkH: longest * dtHours,
    longestDarkCensored: longest > 0 && longestCens,
    nSunsets,
    nSunrises,
    earthFrac: n ? earthOk / n : 0,
    longestNoCommsH: clongest * dtHours,
    longestNoCommsCensored: clongest > 0 && clongestCens,
  };
}

export function intervalMetrics(s: Series, dte = 0.5): IntervalMetrics {
  const dtH = s.stepMs / HOUR;
  const base = metricsFromFractions(s.fSun, s.fEarth, dtH, dte);
  const windows: [number, number][] = [];
  let open = -1;
  let elMin = Infinity, elMax = -Infinity, elSum = 0, elN = 0;
  let eMin = Infinity, eMax = -Infinity, eSum = 0;
  let pv = 0, ph = 0;
  for (let i = 0; i < s.n; i++) {
    const t = s.t0 + i * s.stepMs;
    const ok = s.fEarth[i] >= dte;
    if (ok && open < 0) open = t;
    if (!ok && open >= 0) {
      windows.push([open, t]);
      open = -1;
    }
    const f = s.fSun[i];
    const el = s.sunEl[i];
    if (f > 0) {
      elMin = Math.min(elMin, el);
      elMax = Math.max(elMax, el);
      elSum += el;
      elN++;
    }
    const ee = s.earthEl[i];
    eMin = Math.min(eMin, ee);
    eMax = Math.max(eMax, ee);
    eSum += ee;
    pv += f * Math.cos(el * DEG) * s.sunFlux[i];
    ph += f * Math.max(0, Math.sin(el * DEG)) * s.sunFlux[i];
  }
  if (open >= 0) windows.push([open, s.t0 + (s.n - 1) * s.stepMs]);
  pv /= s.n;
  ph /= s.n;
  return {
    ...base,
    hours: ((s.n - 1) * s.stepMs) / HOUR,
    dteWindows: windows,
    sunElStats: elN ? { min: elMin, mean: elSum / elN, max: elMax } : null,
    earthElStats: { min: eMin, mean: eSum / s.n, max: eMax },
    powerVertical: pv,
    powerHorizontal: ph,
    powerRatio: pv / Math.max(ph, 1e-6),
  };
}

export type Body = 'sun' | 'earth';

function isUp(ctx: SiteContext, t: number, body: Body, dte: number): boolean {
  const x = evalAt(ctx, t);
  return body === 'sun' ? x.fSun > 0 : x.fEarth >= dte;
}

export interface Transition {
  t: number;
  kind: 'rise' | 'set';
}

/** Next change of state (Sun up ⇔ f>0; Earth up ⇔ f ≥ θ_DTE), refined to 1 minute. */
export function nextTransition(ctx: SiteContext, t: number, body: Body, dte = 0.5, maxDays = 60): Transition | null {
  const step = 10 * 60e3;
  const end = Math.min(t + maxDays * DAY, ctx.eph.endMs - 2 * ctx.eph.stepMs);
  const start = isUp(ctx, t, body, dte);
  let a = t;
  for (let b = t + step; b <= end; b += step) {
    if (isUp(ctx, b, body, dte) !== start) {
      let lo = a;
      let hi = b;
      while (hi - lo > 60e3) {
        const mid = (lo + hi) / 2;
        if (isUp(ctx, mid, body, dte) === start) lo = mid;
        else hi = mid;
      }
      return { t: hi, kind: start ? 'set' : 'rise' };
    }
    a = b;
  }
  return null;
}

/** Daily mean Sun fraction and Earth-visibility fraction for `days` days from dayStart. */
export function dailyFractions(ctx: SiteContext, dayStart: number, days: number, stepMin = 30, dte = 0.5): { illum: Float32Array; earth: Float32Array } {
  const illum = new Float32Array(days);
  const earth = new Float32Array(days);
  const per = Math.round((24 * 60) / stepMin);
  for (let d = 0; d < days; d++) {
    let si = 0;
    let se = 0;
    for (let k = 0; k < per; k++) {
      const x = evalAt(ctx, dayStart + d * DAY + k * stepMin * 60e3);
      si += x.fSun;
      if (x.fEarth >= dte) se++;
    }
    illum[d] = si / per;
    earth[d] = se / per;
  }
  return { illum, earth };
}

/** Times of local noon (sub-solar longitude crosses the site longitude) in [t0, t1]. */
export function localNoons(eph: Ephemeris, lonDeg: number, t0: number, t1: number): number[] {
  const out: number[] = [];
  const step = 3 * HOUR;
  const v = new Float64Array(6);
  let prev = wrap180(subSolarLon(eph.at(t0, v)) - lonDeg);
  for (let t = t0 + step; t <= t1; t += step) {
    const cur = wrap180(subSolarLon(eph.at(t, v)) - lonDeg);
    if (prev > 0 && cur <= 0 && prev - cur < 90) {
      out.push(t - step * (cur / (cur - prev)));
    }
    prev = cur;
  }
  return out;
}
