// Runtime display settings. Precedence: URL query (?aa=…) > /config.json (written by the web
// container from env at start, see infra/web-config.sh) > built-in defaults. Nothing here touches
// physics or metrics; these are rendering-quality knobs only.

/** Gaussian σ (CSS px) equivalent to the original panorama look: 1-px pixel filter, no supersampling. */
export const PANO_AA_SIGMA_ORIGINAL = 0.5;

export interface RuntimeConfig {
  /**
   * Panorama anti-aliasing smoothness: σ of the Gaussian reconstruction filter in CSS pixels.
   * ≤ 0.5 = the original renderer (no supersampling); larger = supersampled frame resolved with
   * this Gaussian, and the terrain shader's prefilters widened by σ / 0.5. Default 1.0 (= 2×).
   */
  panoAASigma: number;
}

export const DEFAULT_CONFIG: RuntimeConfig = { panoAASigma: 2 * PANO_AA_SIGMA_ORIGINAL };
const AA_RANGE: [number, number] = [0, 4];

export const config: RuntimeConfig = { ...DEFAULT_CONFIG };

/** Parse a σ value; undefined if missing or not a finite number. Clamped to [0, 4] px. */
export function parseAA(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(x)) return undefined;
  return Math.min(AA_RANGE[1], Math.max(AA_RANGE[0], x));
}

/** Merge /config.json and the URL override into `config`. Never throws; missing file → defaults. */
export async function loadConfig(url: string, search = window.location.search, timeoutMs = 1500): Promise<RuntimeConfig> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const j = (await r.json()) as Partial<Record<keyof RuntimeConfig, unknown>>;
      const aa = parseAA(j.panoAASigma);
      if (aa !== undefined) config.panoAASigma = aa;
    }
  } catch {
    // no runtime config (vite dev, static hosting): keep defaults
  }
  const q = parseAA(new URLSearchParams(search).get('aa'));
  if (q !== undefined) config.panoAASigma = q;
  return config;
}
