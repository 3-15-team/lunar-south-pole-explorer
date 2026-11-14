import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, DEFAULT_CONFIG, loadConfig, PANO_AA_SIGMA_ORIGINAL, parseAA } from '../src/config';

const json = (body: unknown, ok = true) =>
  ({ ok, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body }) as unknown as Response;

describe('runtime config', () => {
  afterEach(() => {
    Object.assign(config, DEFAULT_CONFIG);
    vi.unstubAllGlobals();
  });

  it('default panorama AA sigma is twice the original (0.5 px -> 1.0 px)', () => {
    expect(DEFAULT_CONFIG.panoAASigma).toBe(2 * PANO_AA_SIGMA_ORIGINAL);
  });

  it('parseAA clamps and rejects junk', () => {
    expect(parseAA('1.5')).toBe(1.5);
    expect(parseAA(100)).toBe(4);
    expect(parseAA('-1')).toBe(0);
    expect(parseAA('abc')).toBeUndefined();
    expect(parseAA(null)).toBeUndefined();
  });

  it('config.json overrides the default, URL overrides config.json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ panoAASigma: 3 })));
    expect((await loadConfig('/config.json', '')).panoAASigma).toBe(3);
    expect((await loadConfig('/config.json', '?aa=1.5')).panoAASigma).toBe(1.5);
  });

  it('missing or non-JSON config keeps defaults', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await loadConfig('/config.json', '')).panoAASigma).toBe(1);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) }) as Response));
    expect((await loadConfig('/config.json', '')).panoAASigma).toBe(1);
  });
});
