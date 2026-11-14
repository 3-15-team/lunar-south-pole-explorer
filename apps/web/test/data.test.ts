// Tests against generated products (skipped when `make data-min` has not run) and the
// Python golden vectors (libs/lunarcore/tests/golden) to keep TS and Python in agreement.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ephemeris, earthTopo, makeSiteFrame, sunTopo } from '../src/core/ephemeris';
import { diskFraction, edgeFraction } from '../src/core/disk';
import { latLonToXY, xyToUnit, enuAt } from '../src/core/geo';
import { metricsFromFractions } from '../src/core/metrics';
import { computeHorizon, profileAt, type DemSampler } from '../src/core/horizon';
import { decodeTile } from '../src/data/dem';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(__dirname, '../../..');
const EPH = resolve(ROOT, 'data/web/ephem');
const GOLD = resolve(ROOT, 'libs/lunarcore/tests/golden');
const DEM = resolve(ROOT, 'data/web/dem');

async function loadEph(): Promise<Ephemeris> {
  const idx = JSON.parse(readFileSync(resolve(EPH, 'index.json'), 'utf8'));
  return Ephemeris.load('mem/', async () => idx, async (url) => {
    const b = readFileSync(resolve(EPH, url.replace('mem/', '')));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
}

describe.skipIf(!existsSync(resolve(EPH, 'index.json')))('ephemeris tables', () => {
  it('distances and interpolation are sane', async () => {
    const eph = await loadEph();
    const t0 = Date.UTC(2026, 10, 14);
    await eph.ensureRange(t0, t0 + 40 * 86400e3);
    let prevDir: number[] | null = null;
    for (let i = 0; i < 40 * 24; i++) {
      const v = eph.at(t0 + i * 3600e3);
      const ds = Math.hypot(v[0], v[1], v[2]);
      const de = Math.hypot(v[3], v[4], v[5]);
      expect(ds).toBeGreaterThan(1.45e8);
      expect(ds).toBeLessThan(1.53e8);
      expect(de).toBeGreaterThan(355000);
      expect(de).toBeLessThan(407000);
      const dir = [v[0] / ds, v[1] / ds, v[2] / ds];
      if (prevDir) {
        // the Sun moves ≈ 0.51°/h in MOON_ME (one synodic month)
        const ang = Math.acos(Math.min(1, dir[0] * prevDir[0] + dir[1] * prevDir[1] + dir[2] * prevDir[2])) * (180 / Math.PI);
        expect(ang).toBeGreaterThan(0.45);
        expect(ang).toBeLessThan(0.57);
      }
      prevDir = dir;
      // Sun's latitude in MOON_ME never exceeds the 1.54° obliquity (+ small parallax)
      expect(Math.abs(Math.asin(dir[2]) * (180 / Math.PI))).toBeLessThan(1.6);
    }
  });
  it('agrees with the Python topocentric golden vectors', async () => {
    const f = resolve(GOLD, 'topo.json');
    if (!existsSync(f)) return;
    const eph = await loadEph();
    const g = JSON.parse(readFileSync(f, 'utf8'));
    for (const c of g.cases) {
      const t = Date.parse(c.utc);
      await eph.ensureRange(t, t + 3600e3);
      const fr = makeSiteFrame(c.lat, c.lon, c.hM ?? 0, 0);
      const v = eph.at(t);
      const s = sunTopo(fr, v);
      const e = earthTopo(fr, v);
      const dAz = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
      expect(dAz(s.az, c.sun.azDeg) * Math.cos((s.el * Math.PI) / 180)).toBeLessThan(0.01);
      expect(Math.abs(s.el - c.sun.elDeg)).toBeLessThan(0.01);
      expect(Math.abs(e.el - c.earth.elDeg)).toBeLessThan(0.01);
    }
  });
});

describe.skipIf(!existsSync(GOLD))('python golden vectors', () => {
  const files = existsSync(GOLD) ? readdirSync(GOLD) : [];
  it('disk.json', () => {
    if (!files.includes('disk.json')) return;
    const g = JSON.parse(readFileSync(resolve(GOLD, 'disk.json'), 'utf8'));
    for (const c of g.cases) expect(edgeFraction(c.z)).toBeCloseTo(c.f, 9);
    const profiles = g.sliceProfiles as Record<string, number[]>;
    for (const c of g.sliceCases ?? []) {
      const prof = profiles[c.profile];
      const H = (az: number) => {
        const n = prof.length;
        const f = ((((az % 360) + 360) % 360) * n) / 360;
        const i0 = Math.floor(f) % n;
        const t = f - Math.floor(f);
        return prof[i0] * (1 - t) + prof[(i0 + 1) % n] * t;
      };
      expect(Math.abs(diskFraction(H, c.azDeg, c.elDeg, c.radiusDeg) - c.f)).toBeLessThan(1e-9);
    }
  });
  it('geo.json', () => {
    if (!files.includes('geo.json')) return;
    const g = JSON.parse(readFileSync(resolve(GOLD, 'geo.json'), 'utf8'));
    for (const c of g.cases) {
      const p = latLonToXY(c.lat, c.lon);
      expect(p.x).toBeCloseTo(c.x, 3);
      expect(p.y).toBeCloseTo(c.y, 3);
      const u = xyToUnit(p.x, p.y);
      for (let i = 0; i < 3; i++) expect(u[i]).toBeCloseTo(c.u[i], 9);
      if (c.east) {
        const f = enuAt(c.lat, c.lon);
        for (let i = 0; i < 3; i++) {
          expect(f.east[i]).toBeCloseTo(c.east[i], 9);
          expect(f.north[i]).toBeCloseTo(c.north[i], 9);
        }
      }
    }
  });
  it('metrics.json', () => {
    if (!files.includes('metrics.json')) return;
    const g = JSON.parse(readFileSync(resolve(GOLD, 'metrics.json'), 'utf8'));
    for (const c of g.cases) {
      const m = metricsFromFractions(c.fSun, c.fEarth, c.dtHours, c.dte ?? 0.5);
      for (const [k, v] of Object.entries(c.expect)) {
        const got = (m as unknown as Record<string, number | boolean>)[k];
        if (typeof v === 'boolean') expect(got).toBe(v);
        else expect(got as number).toBeCloseTo(v as number, 6);
      }
    }
  });
  it('horizon.json', () => {
    if (!files.includes('horizon.json')) return;
    const g = JSON.parse(readFileSync(resolve(GOLD, 'horizon.json'), 'utf8'));
    for (const c of g.cases) {
      const d = c.dem;
      const fn = (x: number, y: number): number => {
        if (d.type === 'flat') return d.h;
        if (d.type === 'ramp') return d.h0 + d.gx * x + d.gy * y;
        if (d.type === 'gauss') return d.base + d.h0 * Math.exp(-((x - d.xc) ** 2 + (y - d.yc) ** 2) / (2 * d.sigma ** 2));
        return NaN;
      };
      const s: DemSampler = { finestRes: () => c.finestRes ?? 20, height: (x, y) => fn(x, y), maxRho: 1e7 };
      const p = computeHorizon(s, c.observer.x, c.observer.y, { naz: 1440, hObs: c.observer.hObs, alpha: c.alpha ?? 0.01, maxDist: c.dmaxM ?? 300000 });
      for (const e of c.expect) expect(Math.abs(profileAt(p.elev, e.azDeg) - e.elDeg)).toBeLessThanOrEqual(e.tolDeg + 1e-9);
    }
  });
});

describe.skipIf(!existsSync(resolve(DEM, 'index.json')))('DEM tiles', () => {
  it('decode a z5 tile near the pole', () => {
    const idx = JSON.parse(readFileSync(resolve(DEM, 'index.json'), 'utf8'));
    const lvl = idx.levels.find((l: { z: number }) => l.z === 5) ?? idx.levels[idx.levels.length - 1];
    const { x, y } = latLonToXY(-89.9, 0);
    const span = 256 * (2560 / 2 ** lvl.z);
    const tx = Math.floor((x - idx.grid.x0) / span);
    const ty = Math.floor((idx.grid.y0 - y) / span);
    const f = resolve(DEM, `${lvl.z}/${tx}/${ty}.bin`);
    expect(existsSync(f)).toBe(true);
    const raw = readFileSync(f);
    const buf = raw[0] === 0x1f ? gunzipSync(raw) : raw;
    const h = decodeTile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(h.length).toBe(65536);
    const finite = h.filter((v) => Number.isFinite(v));
    expect(finite.length).toBeGreaterThan(60000);
    expect(Math.min(...finite)).toBeGreaterThan(-6000);
    expect(Math.max(...finite)).toBeLessThan(7000);
  });
});
