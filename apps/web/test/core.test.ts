import { describe, expect, it } from 'vitest';
import {
  DEG,
  R_MOON_M,
  azEl,
  dot,
  enuAt,
  gridAzimuth,
  gridDirection,
  latLonToUnit,
  latLonToXY,
  parseLatLon,
  sampleTanElevation,
  xyToLatLon,
  xyToUnit,
  type Vec3,
} from '../src/core/geo';
import { diskFraction, edgeFraction } from '../src/core/disk';
import { computeHorizon, profileAt, type DemSampler } from '../src/core/horizon';
import { metricsFromFractions } from '../src/core/metrics';
import { decodeState, encodeState } from '../src/state/url';
import { score, PRESETS, rankStability, type Candidate } from '../src/core/suitability';

describe('geo', () => {
  it('projection round-trips and puts lon 0 at +y', () => {
    for (const [lat, lon] of [
      [-89.5, 0],
      [-85, 90],
      [-80.2, -135.5],
      [-89.99, 179],
    ]) {
      const { x, y } = latLonToXY(lat, lon);
      const b = xyToLatLon(x, y);
      expect(b.lat).toBeCloseTo(lat, 9);
      expect(b.lon).toBeCloseTo(lon, 9);
    }
    const p = latLonToXY(-89, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeGreaterThan(0);
    expect(latLonToXY(-89, 90).x).toBeGreaterThan(0);
  });

  it('trig-free unit vector equals the spherical one', () => {
    for (const [lat, lon] of [
      [-88, 30],
      [-80, -170],
      [-89.9, 45],
    ]) {
      const { x, y } = latLonToXY(lat, lon);
      const a = xyToUnit(x, y);
      const b = latLonToUnit(lat, lon);
      for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 12);
    }
  });

  it('ENU is orthonormal and right-handed; azimuth/grid direction agree', () => {
    const lat = -87.3;
    const lon = 61.2;
    const f = enuAt(lat, lon);
    expect(dot(f.east, f.north)).toBeCloseTo(0, 12);
    expect(dot(f.east, f.up)).toBeCloseTo(0, 12);
    const cross: Vec3 = [
      f.east[1] * f.north[2] - f.east[2] * f.north[1],
      f.east[2] * f.north[0] - f.east[0] * f.north[2],
      f.east[0] * f.north[1] - f.east[1] * f.north[0],
    ];
    for (let i = 0; i < 3; i++) expect(cross[i]).toBeCloseTo(f.up[i], 12);
    // a point 1 km away along grid direction of azimuth A must appear at azimuth A
    const { x, y } = latLonToXY(lat, lon);
    const uo = xyToUnit(x, y);
    for (const A of [0, 45, 90, 200, 333]) {
      const { dx, dy } = gridDirection(lon, A);
      const ut = xyToUnit(x + dx * 1000, y + dy * 1000);
      const v: Vec3 = [ut[0] - uo[0], ut[1] - uo[1], ut[2] - uo[2]];
      const dA = ((azEl(v, f).az - A + 540) % 360) - 180;
      expect(Math.abs(dA)).toBeLessThan(0.005);
      expect(gridAzimuth(lon, dx, dy)).toBeCloseTo(A, 9);
    }
  });

  it('elevation formula matches a direct 3-D computation', () => {
    const { x, y } = latLonToXY(-88.5, 20);
    const uo = xyToUnit(x, y);
    const ut = xyToUnit(x + 30000, y - 12000);
    const ho = 1500;
    const h = 2600;
    const t = sampleTanElevation(uo, ho, ut, h);
    const Po = uo.map((c) => c * (R_MOON_M + ho));
    const Pt = ut.map((c) => c * (R_MOON_M + h));
    const d = Pt.map((c, i) => c - Po[i]);
    const vert = d[0] * uo[0] + d[1] * uo[1] + d[2] * uo[2];
    const hor = Math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - vert ** 2);
    expect(Math.atan(t)).toBeCloseTo(Math.atan2(vert, hor), 9);
  });

  it('parses coordinates', () => {
    expect(parseLatLon('89.45S 137.3W')).toEqual({ lat: -89.45, lon: -137.3 });
    expect(parseLatLon('-85.5, 30')).toEqual({ lat: -85.5, lon: 30 });
    expect(parseLatLon('nonsense')).toBeNull();
  });
});

describe('disk fraction', () => {
  it('straight edge limits and symmetry', () => {
    expect(edgeFraction(-1)).toBe(0);
    expect(edgeFraction(1)).toBe(1);
    expect(edgeFraction(0)).toBeCloseTo(0.5, 12);
    for (const z of [0.1, 0.37, 0.8]) expect(edgeFraction(z) + edgeFraction(-z)).toBeCloseTo(1, 12);
  });
  it('slice integration equals the straight edge for a flat horizon', () => {
    const H = () => 0.2;
    for (const z of [-0.95, -0.5, -0.1, 0, 0.3, 0.7, 0.95]) {
      const r = 0.2666;
      expect(Math.abs(diskFraction(H, 123, 0.2 + z * r, r) - edgeFraction(z))).toBeLessThan(1e-9);
    }
  });
  it('handles a sloping ridge across the disk', () => {
    const H = (az: number) => 1 + (az - 100) * 1.0; // 45° ridge across the disc
    const f = diskFraction(H, 100, 1, 0.27);
    expect(f).toBeGreaterThan(0.45);
    expect(f).toBeLessThan(0.55);
  });
});

function analytic(fn: (x: number, y: number) => number, res = 20): DemSampler {
  return { finestRes: () => res, height: (x, y) => fn(x, y), maxRho: 400000 };
}

describe('horizon', () => {
  it('flat sphere: horizon dip = −acos(R/(R+h))', () => {
    const h = 2;
    const p = computeHorizon(analytic(() => 0), 1000, 50000, { naz: 36, hObs: h, maxDist: 20000 });
    const dip = -Math.acos(R_MOON_M / (R_MOON_M + h)) / DEG;
    for (let k = 0; k < 36; k++) expect(p.elev[k]).toBeCloseTo(dip, 2);
    expect(p.dist[0]).toBeGreaterThan(1500);
    expect(p.dist[0]).toBeLessThan(4000);
  });
  it('single Gaussian peak: elevation and azimuth of the summit', () => {
    const { x, y } = latLonToXY(-88, 0);
    // peak 20 km "north" (azimuth 0 = away from the pole) of the site, 1500 m high
    const { dx, dy } = gridDirection(0, 0);
    const px = x + dx * 20000;
    const py = y + dy * 20000;
    const fn = (qx: number, qy: number) => 1500 * Math.exp(-((qx - px) ** 2 + (qy - py) ** 2) / (2 * 1500 ** 2));
    const p = computeHorizon(analytic(fn), x, y, { naz: 720, hObs: 2, maxDist: 60000 });
    const k = 1 + (x * x + y * y) / (4 * R_MOON_M * R_MOON_M);
    const d = 20000 / k;
    const expected = Math.atan((1500 - 2 - (d * d) / (2 * R_MOON_M)) / d) / DEG;
    expect(profileAt(p.elev, 0)).toBeCloseTo(expected, 1);
    expect(profileAt(p.elev, 180)).toBeLessThan(0);
  });
  it('ramp: horizon follows the slope uphill', () => {
    const { x, y } = latLonToXY(-86, 45);
    const { dx, dy } = gridDirection(45, 90);
    const fn = (qx: number, qy: number) => Math.max(0, ((qx - x) * dx + (qy - y) * dy) * Math.tan(5 * DEG));
    const p = computeHorizon(analytic(fn, 10), x, y, { naz: 360, hObs: 0.01, maxDist: 5000 });
    expect(profileAt(p.elev, 90)).toBeGreaterThan(4.5);
    expect(profileAt(p.elev, 90)).toBeLessThan(5.1);
  });
});

describe('interval metrics', () => {
  it('counts sunsets, darkness and censoring', () => {
    // 1 h steps: 10 h light, 5 h dark, 5 h light, ends in 3 h dark (censored)
    const f = [...Array(10).fill(1), ...Array(5).fill(0), ...Array(5).fill(0.5), ...Array(3).fill(0)];
    const e = f.map((_, i) => (i < 12 ? 1 : 0));
    const m = metricsFromFractions(f, e, 1, 0.5);
    expect(m.nSunsets).toBe(2);
    expect(m.longestDarkH).toBe(5);
    expect(m.longestDarkCensored).toBe(false);
    expect(m.illumFrac).toBeCloseTo((10 + 2.5) / 23, 12);
    expect(m.sunlitHours).toBeCloseTo(12.5, 12);
    expect(m.anySunHours).toBe(15);
    expect(m.earthFrac).toBeCloseTo(12 / 23, 12);
    expect(m.longestNoCommsH).toBe(11);
    expect(m.longestNoCommsCensored).toBe(true);
  });
});

describe('url state', () => {
  it('round-trips the shareable state', () => {
    const s = {
      site: { kind: 'custom' as const, lat: -89.45, lon: -137.3, name: 'Ridge A' },
      time: Date.UTC(2026, 11, 3, 5, 30),
      interval: [Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 15)] as [number, number],
      hObs: 6,
      layer: 'illum' as const,
      scenarios: [{ id: 'a', site: { kind: 'catalog' as const, id: 'site01' }, t0: Date.UTC(2027, 0, 1), t1: Date.UTC(2027, 0, 15) }],
      slipDays: -7,
      view: { x: 1000, y: -2000, res: 12.5 },
    };
    const d = decodeState(encodeState(s));
    expect(d.site).toEqual(s.site);
    expect(d.time).toBe(s.time);
    expect(d.interval).toEqual(s.interval);
    expect(d.hObs).toBe(6);
    expect(d.layer).toBe('illum');
    expect(d.scenarios?.[0].site).toEqual({ kind: 'catalog', id: 'site01' });
    expect(d.slipDays).toBe(-7);
    expect(d.view).toEqual(s.view);
  });
  it('keeps every pinned scenario (no 4-scenario cap)', () => {
    const scenarios = Array.from({ length: 6 }, (_, k) => ({
      id: `s${k}`,
      site: { kind: 'catalog' as const, id: `site0${k + 1}` },
      t0: Date.UTC(2027, 0, 1 + k),
      t1: Date.UTC(2027, 0, 15 + k),
    }));
    const d = decodeState(encodeState({ scenarios }));
    expect(d.scenarios?.map((c) => c.site)).toEqual(scenarios.map((c) => c.site));
  });
});

describe('suitability', () => {
  const pr = PRESETS.lander;
  const f = { slopeMax: 4, slopeMean: 2, relief: 1, illum: 0.8, dark: 20, earth: 0.7 };
  it('hard slope constraint excludes', () => {
    expect(score({ ...f, slopeMax: 12 }, pr.weights, 50, 10, pr.darkRef)).toBe(-1);
    const s = score(f, pr.weights, 50, 10, pr.darkRef);
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThanOrEqual(1);
  });
  it('rank stability is 1 for a dominant candidate', () => {
    const pool: Candidate[] = Array.from({ length: 50 }, (_, i) => ({ i, x: i, y: 0, score: 0, features: { ...f, illum: 0.3 + i * 0.001, earth: 0.2 } }));
    pool[49].features = { ...f, illum: 0.95, earth: 0.9, dark: 0 };
    const st = rankStability(pool, [pool[49]], pr.weights, 50, 10, pr.darkRef, 50, 1);
    expect(st[0]).toBe(1);
  });
});
