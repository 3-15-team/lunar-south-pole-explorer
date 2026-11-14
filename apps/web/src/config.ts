// Runtime display settings. Precedence: URL query > /config.json (written by the web container from
// env at start, see infra/web-config.sh) > built-in defaults. Rendering-quality knobs only: nothing
// here changes metrics (horizons, illumination, scores are computed from the DEM tiles directly).

/**
 * Height-field interpolation for the panorama terrain (mesh vertices, camera height, shading normals).
 * Cubic modes are the Mitchell–Netravali family k(B, C):
 *   bilinear — original (C0 surface: normals jump at every DEM cell edge → faceted/stepped shading)
 *   catmull  — Catmull-Rom (B 0, C ½): interpolating, C1 (passes through every DEM sample)
 *   mitchell — Mitchell (B ⅓, C ⅓): near-interpolating, mild smoothing, C1
 *   bspline  — cubic B-spline (B 1, C 0): C2, smoothest; slightly flattens single-cell features
 */
export type TerrainInterp = 'bilinear' | 'catmull' | 'mitchell' | 'bspline';
export const TERRAIN_INTERPS: readonly TerrainInterp[] = ['bilinear', 'catmull', 'mitchell', 'bspline'];
export const INTERP_BC: Record<Exclude<TerrainInterp, 'bilinear'>, [number, number]> = {
  catmull: [0, 0.5],
  mitchell: [1 / 3, 1 / 3],
  bspline: [1, 0],
};

export interface RuntimeConfig {
  panoTerrainInterp: TerrainInterp;
  /**
   * Relief anti-aliasing strength for the panorama: scale of the true pixel footprint on the ground
   * (major axis of the screen-space derivatives) used to prefilter relief detail — DEM-derived normals
   * and the procedural micro-relief. 1 = exactly one pixel; larger = smoother relief; 0 = the legacy
   * isotropic estimate (distance × 0.0012), which under-filters grazing views (sparkle at low Sun).
   * Only relief/shading is filtered; the image itself is not blurred.
   */
  panoReliefAA: number;
}

export const DEFAULT_CONFIG: RuntimeConfig = { panoTerrainInterp: 'catmull', panoReliefAA: 1 };

export const config: RuntimeConfig = { ...DEFAULT_CONFIG };

export function parseInterp(v: unknown): TerrainInterp | undefined {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (TERRAIN_INTERPS as readonly string[]).includes(s) ? (s as TerrainInterp) : undefined;
}

/** Parse the relief AA scale; undefined if not a finite number; clamped to [0, 8]. */
export function parseReliefAA(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? Math.min(8, Math.max(0, x)) : undefined;
}

/** Merge /config.json and the URL overrides (?interp=…, ?raa=…) into `config`. Never throws. */
export async function loadConfig(url: string, search = window.location.search, timeoutMs = 1500): Promise<RuntimeConfig> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const j = (await r.json()) as Partial<Record<keyof RuntimeConfig, unknown>>;
      const m = parseInterp(j.panoTerrainInterp);
      if (m) config.panoTerrainInterp = m;
      const a = parseReliefAA(j.panoReliefAA);
      if (a !== undefined) config.panoReliefAA = a;
    }
  } catch {
    // no runtime config (vite dev, static hosting): keep defaults
  }
  const q = parseInterp(new URLSearchParams(search).get('interp'));
  if (q) config.panoTerrainInterp = q;
  const qa = parseReliefAA(new URLSearchParams(search).get('raa'));
  if (qa !== undefined) config.panoReliefAA = qa;
  return config;
}

export { mnKernel } from './core/interp';
