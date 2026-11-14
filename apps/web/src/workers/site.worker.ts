/// <reference lib="webworker" />
// Site path (docs/ARCHITECTURE.md): horizon profile + interval metrics off the UI thread.
import { Ephemeris, makeSiteFrame } from '../core/ephemeris';
import { xyToLatLon } from '../core/geo';
import { computeHorizon, marchSteps, type HorizonProfile } from '../core/horizon';
import {
  DAY,
  dailyFractions,
  evalAt,
  intervalMetrics,
  localNoons,
  nextTransition,
  sampleSeries,
  type SiteContext,
} from '../core/metrics';
import { DemClient } from '../data/dem';
import type { WorkerRequest, WorkerResponse, ProfileResult, MetricsResult, CalendarResult } from './protocol';

let dem: DemClient | null = null;
let eph: Ephemeris | null = null;
const sites = new Map<string, SiteContext>();

const post = (m: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function init(dataBase: string): Promise<{ ephStart: number; ephEnd: number }> {
  [dem, eph] = await Promise.all([DemClient.load(dataBase), Ephemeris.load(dataBase + 'ephem/')]);
  return { ephStart: eph.startMs, ephEnd: eph.endMs };
}

async function profile(key: string, x: number, y: number, hObs: number, naz: number): Promise<ProfileResult> {
  if (!dem || !eph) throw new Error('worker not initialised');
  const zf = dem.finestLevelAt(x, y);
  if (zf < 0) throw new Error('Outside DEM coverage');
  const steps = marchSteps(dem.res(zf), 0.01, 300e3);
  const tiles = dem.tilesForHorizon(x, y, steps, naz);
  const t0 = performance.now();
  await dem.loadAll(tiles, 8, 'dem', (done, total) => {
    if (done % 8 === 0 || done === total) post({ type: 'progress', key, done, total });
  });
  await dem.loadAll(dem.errTilesFor(tiles), 8, 'err');
  const tLoad = performance.now() - t0;
  const p = computeHorizon(dem, x, y, { naz, hObs, farFrom: 2500 });
  const tCalc = performance.now() - t0 - tLoad;
  const frame = makeSiteFrame(p.lat, p.lon, p.hTerrain, hObs);
  sites.set(key, { frame, profile: p, eph });
  return { key, profile: p, tiles: tiles.length, msLoad: tLoad, msCalc: tCalc };
}

async function metrics(key: string, t0: number, t1: number, stepMin: number, dte: number, now: number, plotPoints: number): Promise<MetricsResult> {
  const ctx = sites.get(key);
  if (!ctx || !eph) throw new Error('profile not computed for ' + key);
  const span = Math.max(t1 - t0, 60e3);
  const stepMs = Math.max(stepMin * 60e3, span / 60000, span <= 2 * DAY ? 2 * 60e3 : 0);
  await eph.ensureRange(Math.min(t0, now), Math.max(t1, now + 61 * DAY));
  const s = sampleSeries(ctx, t0, t1, stepMs);
  const m = intervalMetrics(s, dte);
  // decimated plot series (keep extremes of fSun visible by max-pooling)
  const n = Math.min(plotPoints, s.n);
  const plot = {
    t: new Float64Array(n),
    sunAz: new Float32Array(n),
    sunEl: new Float32Array(n),
    fSun: new Float32Array(n),
    earthAz: new Float32Array(n),
    earthEl: new Float32Array(n),
    fEarth: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const j = Math.round((i * (s.n - 1)) / Math.max(1, n - 1));
    plot.t[i] = s.t0 + j * s.stepMs;
    plot.sunAz[i] = s.sunAz[j];
    plot.sunEl[i] = s.sunEl[j];
    plot.fSun[i] = s.fSun[j];
    plot.earthAz[i] = s.earthAz[j];
    plot.earthEl[i] = s.earthEl[j];
    plot.fEarth[i] = s.fEarth[j];
  }
  const sunNext = nextTransition(ctx, now, 'sun', dte);
  const earthNext = nextTransition(ctx, now, 'earth', dte);
  const noons = localNoons(eph, ctx.frame.lon, t0 - 31 * DAY, t1 + 31 * DAY);
  return { key, t0, t1, stepMs, metrics: m, plot, now: evalAt(ctx, now), sunNext, earthNext, noons };
}

async function calendar(keys: string[], dayStart: number, days: number, stepMin: number, dte: number): Promise<CalendarResult> {
  if (!eph) throw new Error('worker not initialised');
  await eph.ensureRange(dayStart, dayStart + days * DAY);
  const rows = keys.map((key) => {
    const ctx = sites.get(key);
    if (!ctx) return { key, illum: new Float32Array(days).fill(NaN), earth: new Float32Array(days).fill(NaN) };
    return { key, ...dailyFractions(ctx, dayStart, days, stepMin, dte) };
  });
  return { dayStart, days, rows };
}

function nearestTerrain(x: number, y: number): { lat: number; lon: number; h: number; res: number } {
  if (!dem) throw new Error('worker not initialised');
  const { lat, lon } = xyToLatLon(x, y);
  const res = dem.finestRes(x, y);
  return { lat, lon, h: dem.height(x, y, res), res };
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const r = ev.data;
  try {
    let result: unknown;
    switch (r.type) {
      case 'init':
        result = await init(r.dataBase);
        break;
      case 'profile':
        result = await profile(r.key, r.x, r.y, r.hObs, r.naz ?? 1440);
        break;
      case 'metrics':
        result = await metrics(r.key, r.t0, r.t1, r.stepMin, r.dte, r.now, r.plotPoints ?? 3000);
        break;
      case 'calendar':
        result = await calendar(r.keys, r.dayStart, r.days, r.stepMin ?? 30, r.dte);
        break;
      case 'terrain':
        result = nearestTerrain(r.x, r.y);
        break;
    }
    post({ type: 'result', id: r.id, ok: true, result });
  } catch (e) {
    post({ type: 'result', id: r.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

export type { HorizonProfile };
