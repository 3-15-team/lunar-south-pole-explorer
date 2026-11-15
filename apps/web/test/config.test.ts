import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, DEFAULT_CONFIG, INTERP_BC, loadConfig, mnKernel, parseEarthAntenna, parseInterp, parseMicro, parseOnOff, parseReliefAA } from '../src/config';

const json = (body: unknown) =>
  ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body }) as unknown as Response;

describe('runtime config', () => {
  afterEach(() => {
    Object.assign(config, DEFAULT_CONFIG);
    vi.unstubAllGlobals();
  });

  it('parseInterp accepts known modes only', () => {
    expect(parseInterp(' BSpline ')).toBe('bspline');
    expect(parseInterp('bilinear')).toBe('bilinear');
    expect(parseInterp('lanczos')).toBeUndefined();
    expect(parseInterp(3)).toBeUndefined();
  });

  it('parseReliefAA clamps to [0, 8] and rejects junk', () => {
    expect(parseReliefAA('1.5')).toBe(1.5);
    expect(parseReliefAA(-2)).toBe(0);
    expect(parseReliefAA('99')).toBe(8);
    expect(parseReliefAA('x')).toBeUndefined();
  });

  it('micro-relief toggle default: config.json, then ?micro=on|off; numbers stay amplitudes', async () => {
    expect(parseOnOff('Off')).toBe(false);
    expect(parseOnOff('yes')).toBe(true);
    expect(parseOnOff('maybe')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => json({ panoMicroDefault: 'off' })));
    let c = await loadConfig('/config.json', '');
    expect([c.panoMicroDefault, c.panoMicro]).toEqual([false, 1]);
    c = await loadConfig('/config.json', '?micro=on');
    expect([c.panoMicroDefault, c.panoMicro]).toEqual([true, 1]);
    c = await loadConfig('/config.json', '?micro=0.5');
    expect([c.panoMicroDefault, c.panoMicro]).toEqual([false, 0.5]);
  });

  it('map antenna Earth layer mode: config.json, then ?earthant=', async () => {
    expect(parseEarthAntenna(' Button ')).toBe('button');
    expect(parseEarthAntenna('auto')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => json({ mapEarthAntenna: 'button' })));
    let c = await loadConfig('/config.json', '');
    expect(c.mapEarthAntenna).toBe('button');
    c = await loadConfig('/config.json', '?earthant=layer');
    expect(c.mapEarthAntenna).toBe('layer');
  });

  it('parseMicro clamps to [0, 3]', () => {
    expect(parseMicro('0.6')).toBe(0.6);
    expect(parseMicro(9)).toBe(3);
    expect(parseMicro('off')).toBeUndefined();
  });

  it('defaults: Catmull-Rom heights, one-pixel relief footprint, micro-relief on', () => {
    expect(DEFAULT_CONFIG).toEqual({ panoTerrainInterp: 'catmull', panoReliefAA: 1, panoMicro: 1, panoMicroDefault: true, mapEarthAntenna: 'layer' });
  });

  it('config.json overrides the default, URL overrides config.json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ panoTerrainInterp: 'mitchell', panoReliefAA: 2 })));
    let c = await loadConfig('/config.json', '');
    expect([c.panoTerrainInterp, c.panoReliefAA]).toEqual(['mitchell', 2]);
    c = await loadConfig('/config.json', '?interp=bilinear&raa=0&micro=0');
    expect([c.panoTerrainInterp, c.panoReliefAA, c.panoMicro]).toEqual(['bilinear', 0, 0]);
  });

  it('missing config keeps the default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await loadConfig('/config.json', '')).panoTerrainInterp).toBe(DEFAULT_CONFIG.panoTerrainInterp);
  });
});

describe('Mitchell-Netravali kernel', () => {
  const taps = (t: number, [B, C]: [number, number]) => [-1, 0, 1, 2].map((d) => mnKernel(d - t, B, C));
  it.each(Object.entries(INTERP_BC))('%s: weights sum to 1 and reproduce linear ramps', (_, bc) => {
    for (const t of [0, 0.1, 0.37, 0.5, 0.9]) {
      const w = taps(t, bc);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      // f(x) = 3x + 2 sampled at -1, 0, 1, 2 → exact at t
      expect(w.reduce((a, wi, i) => a + wi * (3 * (i - 1) + 2), 0)).toBeCloseTo(3 * t + 2, 12);
    }
  });
  it('Catmull-Rom interpolates the samples; B-spline smooths them', () => {
    expect(taps(0, INTERP_BC.catmull)).toEqual([0, 1, 0, 0].map((v) => expect.closeTo(v, 12)));
    expect(taps(0, INTERP_BC.bspline).map((v) => +v.toFixed(12))).toEqual([1 / 6, 2 / 3, 1 / 6, 0].map((v) => +v.toFixed(12)));
  });
});
