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
  /**
   * Statistical micro-relief amplitude in the panorama (data/web/micro, pipeline/jobs/micro_relief.py):
   * heights below the DEM grid drawn from crater/boulder size distributions; drives normals and short
   * self-shadows with the real Sun. 1 = as generated, 0 = off (procedural bump fallback).
   */
  panoMicro: number;
  /**
   * Initial state of the panorama "Micro-relief" toggle (the user can flip it in the UI).
   * Env PANO_MICRO_DEFAULT=on|off (→ /config.json) or URL ?micro=on|off override this default.
   */
  panoMicroDefault: boolean;
  /**
   * When the map's Earth-visibility (and Suitability) layer is recomputed for the antenna height
   * (ADR-122; costs a second GPU horizon pass, so it is never done for other layers):
   *   layer  — automatically while such a layer is shown and the antenna ≠ observer height;
   *   button — only after the user presses "Use antenna" in the layer panel.
   * Env MAP_EARTH_ANTENNA=layer|button (→ /config.json) or URL ?earthant=layer|button.
   */
  mapEarthAntenna: MapEarthAntenna;
}

export type MapEarthAntenna = 'layer' | 'button';
export function parseEarthAntenna(v: unknown): MapEarthAntenna | undefined {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'layer' || s === 'button' ? s : undefined;
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  panoTerrainInterp: 'catmull',
  panoReliefAA: 1,
  panoMicro: 1,
  // ▼ THE default for the micro-relief toggle (ADR-118). Single source of truth: infra passes nothing
  //   unless PANO_MICRO_DEFAULT is set explicitly.
  panoMicroDefault: true,
  // ▼ THE default for the map's antenna Earth layer (ADR-122); infra writes it only when set
  mapEarthAntenna: 'layer',
};

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

/** Parse the micro-relief amplitude; clamped to [0, 3]. */
export function parseMicro(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? Math.min(3, Math.max(0, x)) : undefined;
}

/** Parse an on/off flag ('on'|'off'|'1'|'0'|'true'|'false'|'yes'|'no'); undefined otherwise. */
export function parseOnOff(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : typeof v === 'number' ? String(v) : '';
  if (['on', '1', 'true', 'yes'].includes(s)) return true;
  if (['off', '0', 'false', 'no'].includes(s)) return false;
  return undefined;
}

/** Merge /config.json and the URL overrides (?interp=…, ?raa=…, ?micro=…, ?earthant=…) into `config`. Never throws. */
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
      const mc = parseMicro(j.panoMicro);
      if (mc !== undefined) config.panoMicro = mc;
      const md = parseOnOff(j.panoMicroDefault);
      if (md !== undefined) config.panoMicroDefault = md;
      const ea = parseEarthAntenna(j.mapEarthAntenna);
      if (ea) config.mapEarthAntenna = ea;
    }
  } catch {
    // no runtime config (vite dev, static hosting): keep defaults
  }
  const q = parseInterp(new URLSearchParams(search).get('interp'));
  if (q) config.panoTerrainInterp = q;
  const qa = parseReliefAA(new URLSearchParams(search).get('raa'));
  if (qa !== undefined) config.panoReliefAA = qa;
  // ?micro=on|off → initial toggle state; ?micro=<number> → amplitude (0 = feature off)
  const qmRaw = new URLSearchParams(search).get('micro');
  const qOn = qmRaw !== null && /^[a-z]+$/i.test(qmRaw.trim()) ? parseOnOff(qmRaw) : undefined;
  const qm = qOn === undefined ? parseMicro(qmRaw) : undefined;
  if (qOn !== undefined) config.panoMicroDefault = qOn;
  if (qm !== undefined) config.panoMicro = qm;
  const qea = parseEarthAntenna(new URLSearchParams(search).get('earthant'));
  if (qea) config.mapEarthAntenna = qea;
  return config;
}

export { mnKernel } from './core/interp';
