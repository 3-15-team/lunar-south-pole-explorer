// Scan for a compelling "slip by 10 days" demo scenario using the app's own TS core.
// run: cd apps/web && npx vite-node scripts/demo-scan.ts  (needs data/web)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const WEB = resolve(__dirname, '../../../data/web') + '/';
(globalThis as any).fetch = async (url: string) => {
  const p = resolve(WEB, url.replace(/^\/?data\//, ''));
  try {
    const b = readFileSync(p);
    return new Response(b, { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
};
const { Ephemeris, makeSiteFrame } = await import('../src/core/ephemeris.ts');
const { DemClient } = await import('../src/data/dem.ts');
const { computeHorizon, marchSteps } = await import('../src/core/horizon.ts');
const { sampleSeries, intervalMetrics, DAY } = await import('../src/core/metrics.ts');
const { latLonToXY } = await import('../src/core/geo.ts');

const eph = await Ephemeris.load('data/ephem/');
const dem = await DemClient.load('data/');
const sites = JSON.parse(readFileSync(WEB + 'sites.json', 'utf8')).sites.filter((s: any) => s.lat < -84 && s.inCoverage !== false);
const t0 = Date.UTC(2026, 10, 15);
const t1 = Date.UTC(2027, 5, 1);
await eph.ensureRange(t0, t1 + 30 * DAY);
const SPAN = 14 * DAY;
const SLIP = 10 * DAY;
for (const s of sites.slice(0, 12)) {
  const { x, y } = latLonToXY(s.lat, s.lon);
  const zf = dem.finestLevelAt(x, y);
  if (zf < 0) continue;
  const tiles = dem.tilesForHorizon(x, y, marchSteps(dem.res(zf), 0.01, 300e3), 720);
  await dem.loadAll(tiles, 16);
  const p = computeHorizon(dem, x, y, { naz: 720, hObs: 2 });
  const ctx = { frame: makeSiteFrame(p.lat, p.lon, p.hTerrain, 2), profile: p, eph };
  let best = { d: 0, a: 0, b: 0, t: 0, da: 0, db: 0 };
  let sum = 0;
  let n = 0;
  for (let t = t0; t < t1; t += 2 * DAY) {
    const a = intervalMetrics(sampleSeries(ctx, t, t + SPAN, 30 * 60e3));
    const b = intervalMetrics(sampleSeries(ctx, t + SLIP, t + SLIP + SPAN, 30 * 60e3));
    sum += a.illumFrac;
    n++;
    const d = a.illumFrac - b.illumFrac;
    if (d > best.d) best = { d, a: a.illumFrac, b: b.illumFrac, t, da: a.longestDarkH, db: b.longestDarkH };
  }
  console.log(
    `${s.id.padEnd(18)} ${s.name.slice(0, 28).padEnd(28)} mean14d=${(100 * sum / n).toFixed(0)}%  worstSlip: start ${new Date(best.t).toISOString().slice(0, 10)} illum ${(100 * best.a).toFixed(0)}% -> ${(100 * best.b).toFixed(0)}%  night ${best.da.toFixed(0)}h -> ${best.db.toFixed(0)}h`,
  );
}
