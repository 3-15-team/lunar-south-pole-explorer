import { describe, expect, it } from 'vitest';
import { ANT_CAP_M, ANT_MIN_M, fractionAt, hullElevation, hullProfile, linkShare, neededAt, neededForShare, neededHeight } from '../src/core/antenna';
import { diskFraction } from '../src/core/disk';
import { gridDirection, latLonToXY, R_MOON_M } from '../src/core/geo';
import { computeHorizon, profileAt, type DemSampler } from '../src/core/horizon';

const DEG = Math.PI / 180;
const analytic = (fn: (x: number, y: number) => number, res = 20): DemSampler => ({ finestRes: () => res, height: (x, y) => fn(x, y), maxRho: 400000 });

// rough terrain: two Gaussian ridges + a ripple, site at 88°S
const { x: sx, y: sy } = latLonToXY(-88, 0);
const peak = (cx: number, cy: number, h: number, s: number) => (qx: number, qy: number) => h * Math.exp(-((qx - cx) ** 2 + (qy - cy) ** 2) / (2 * s * s));
const n0 = gridDirection(0, 0);
const e0 = gridDirection(0, 90);
const ridgeN = peak(sx + n0.dx * 8000, sy + n0.dy * 8000, 900, 1200);
const ridgeE = peak(sx + e0.dx * 30000, sy + e0.dy * 30000, 2500, 4000);
const terrain = (qx: number, qy: number) => ridgeN(qx, qy) + ridgeE(qx, qy) + 40 * Math.sin(qx / 900) * Math.cos(qy / 1300);

describe('antenna: horizon envelopes', () => {
  const p = computeHorizon(analytic(terrain), sx, sy, { naz: 360, hObs: 2, maxDist: 80000, hull: true });
  const hull = p.hull!;
  it('reproduce the marched horizon at the observer height exactly', () => {
    const prof = hullProfile(hull, 2);
    for (let k = 0; k < 360; k++) expect(prof[k]).toBeCloseTo(p.elev[k], 4);
  });
  it('match a direct march at other heights', () => {
    for (const h of [1, 10, 60, 400]) {
      const q = computeHorizon(analytic(terrain), sx, sy, { naz: 360, hObs: h, maxDist: 80000 });
      for (let k = 0; k < 360; k += 7) expect(hullElevation(hull, k, h)).toBeCloseTo(q.elev[k], 4);
    }
  });
  it('keep few lines per azimuth', () => {
    expect(hull.Z.length / 360).toBeLessThan(80);
  });
});

describe('antenna: needed height', () => {
  // a flat plain and one straight, steep wall of height W at distance L across azimuth 0 (north)
  const { x, y } = latLonToXY(-88, 0);
  const L = 5000;
  const W = 300;
  const wall = (qx: number, qy: number) => {
    // signed distance along local north from the site
    const along = (qx - x) * n0.dx + (qy - y) * n0.dy;
    return along > L && along < L + 200 ? W : 0;
  };
  const p = computeHorizon(analytic(wall, 10), x, y, { naz: 720, hObs: 2, maxDist: 20000, hull: true });
  const hull = p.hull!;
  it('closed form for a disk centre just above the wall top (50 % of the disk)', () => {
    // seeing elevation e over the wall's near top edge needs h = Z − D·tan e (Z ≈ W − D²/2R)
    for (const el of [0, 1, 2]) {
      const h = neededHeight(hull, { az: 0, el, r: 0.95 }, 0.5);
      const D = L + 200; // far top edge is the binding one for e ≥ 0 (higher Z − D tan e only if tan e < 0)
      const near = W - L ** 2 / (2 * R_MOON_M) - L * Math.tan(el * DEG);
      const far = W - D ** 2 / (2 * R_MOON_M) - D * Math.tan(el * DEG);
      expect(h).toBeGreaterThan(Math.max(near, far) * 0.97);
      expect(h).toBeLessThan(Math.max(near, far) * 1.03);
      // and that height really gives ≥ 50 % of the disk, a bit less does not
      expect(fractionAt(hull, h * 1.002, { az: 0, el, r: 0.95 })).toBeGreaterThanOrEqual(0.5);
      expect(fractionAt(hull, h * 0.98, { az: 0, el, r: 0.95 })).toBeLessThan(0.5);
    }
  });
  it('1 m when already visible, Infinity when not even from the cap', () => {
    expect(neededHeight(hull, { az: 180, el: 1, r: 0.95 }, 0.5)).toBe(ANT_MIN_M);
    expect(neededHeight(hull, { az: 0, el: -20, r: 0.95 }, 0.5)).toBe(Infinity);
    expect(ANT_CAP_M).toBe(1000);
  });
  it('consistent with the sliced-disk fraction on the hull profile', () => {
    const e = { az: 3, el: 1.5, r: 0.95 };
    const h = neededHeight(hull, e, 0.5);
    const prof = hullProfile(hull, h * 1.001);
    expect(diskFraction((a) => profileAt(prof, a), e.az, e.el, e.r)).toBeGreaterThanOrEqual(0.5 - 1e-3);
  });
});

describe('antenna: distribution helpers', () => {
  const need = Float32Array.from([1, 1, 5, 20, 20, 80, Infinity, 300, 1, 2]);
  it('share and quantiles', () => {
    expect(linkShare(need, 1)).toBeCloseTo(0.3);
    expect(linkShare(need, 20)).toBeCloseTo(0.7);
    expect(linkShare(need, 1000)).toBeCloseTo(0.9);
    expect(neededForShare(need, 0.5)).toBe(5);
    expect(neededForShare(need, 0.9)).toBe(300);
    expect(neededForShare(need, 1)).toBeNull();
  });
  it('interpolates in time', () => {
    const a = { t: Float64Array.from([0, 10, 20]), need: Float32Array.from([1, 11, Infinity]), capM: 1000, minM: 1 };
    expect(neededAt(a, 5)).toBeCloseTo(6);
    expect(neededAt(a, 19)).toBe(Infinity);
    expect(neededAt(a, 25)).toBeNull();
  });
});
