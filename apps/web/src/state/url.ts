// URL hash <-> state codec: every scenario is shareable as a link (static hosting friendly).
import type { SiteRef } from '../data/sites';
import { snapHeight } from '../ui/heightScale';
import type { Audience, Layer, Mode, Preset, Scenario } from './store';

export interface UrlState {
  site?: SiteRef;
  time?: number;
  interval?: [number, number];
  hObs?: number;
  dte?: number;
  layer?: Layer;
  footprint?: number;
  preset?: Preset;
  slopeLimit?: number;
  scenarios?: Scenario[];
  slipDays?: number;
  mode?: Mode;
  audience?: Audience;
  view?: { x: number; y: number; res: number };
}

const LAYERS: Layer[] = ['relief', 'shadow', 'illum', 'earth', 'dark', 'slope', 'suit'];

export const isoMin = (t: number): string => new Date(t).toISOString().slice(0, 16) + 'Z';

function parseTime(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.length === 16 ? s + 'Z' : s);
  return Number.isFinite(t) ? t : undefined;
}

export function encodeSite(ref: SiteRef): string {
  if (ref.kind === 'catalog') return ref.id;
  const base = `${ref.lat.toFixed(5)},${ref.lon.toFixed(5)}`;
  return ref.name ? `${base},${encodeURIComponent(ref.name)}` : base;
}

export function decodeSite(s: string): SiteRef | undefined {
  const m = s.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(.*))?$/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (lat < -90 || lat > 90 || lon < -360 || lon > 360) return undefined;
    return { kind: 'custom', lat, lon, name: m[3] ? decodeURIComponent(m[3]) : undefined };
  }
  return /^[\w.:-]+$/.test(s) ? { kind: 'catalog', id: s } : undefined;
}

export function encodeState(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.site) p.set('s', encodeSite(s.site));
  if (s.time !== undefined) p.set('t', isoMin(s.time));
  if (s.interval) p.set('i', `${isoMin(s.interval[0])}~${isoMin(s.interval[1])}`);
  if (s.hObs !== undefined && s.hObs !== 2) p.set('h', String(s.hObs));
  if (s.dte !== undefined && s.dte !== 0.5) p.set('dte', String(s.dte));
  if (s.layer && s.layer !== 'relief') p.set('l', s.layer);
  if (s.footprint !== undefined && s.footprint !== 50) p.set('fp', String(s.footprint));
  if (s.preset && s.preset !== 'lander') p.set('p', s.preset);
  if (s.slopeLimit !== undefined && s.slopeLimit !== 10) p.set('sl', String(s.slopeLimit));
  if (s.slipDays !== undefined && s.slipDays !== 10) p.set('slip', String(s.slipDays));
  if (s.scenarios?.length)
    p.set('c', s.scenarios.map((c) => `${encodeSite(c.site)}@${isoMin(c.t0)}~${isoMin(c.t1)}`).join(';'));
  if (s.mode && s.mode !== 'map') p.set('m', s.mode);
  if (s.audience && s.audience !== 'explorer') p.set('a', s.audience);
  if (s.view) p.set('v', `${Math.round(s.view.x)},${Math.round(s.view.y)},${+s.view.res.toPrecision(4)}`);
  return p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%7E/gi, '~').replace(/%40/g, '@').replace(/%3B/g, ';');
}

export function decodeState(hash: string): UrlState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: UrlState = {};
  const s = p.get('s');
  if (s) out.site = decodeSite(s);
  out.time = parseTime(p.get('t'));
  const i = p.get('i');
  if (i) {
    const [a, b] = i.split('~').map(parseTime);
    if (a !== undefined && b !== undefined && b > a) out.interval = [a, b];
  }
  const num = (k: string, lo: number, hi: number) => {
    const v = p.get(k);
    if (v === null) return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
  };
  const h = num('h', 1, 100); // height above the local surface, m (ui/heightScale.ts)
  out.hObs = h === undefined ? undefined : snapHeight(h);
  out.dte = num('dte', 0.05, 1);
  const l = p.get('l') as Layer | null;
  if (l && LAYERS.includes(l)) out.layer = l;
  out.footprint = num('fp', 5, 100);
  const pr = p.get('p');
  if (pr === 'lander' || pr === 'base') out.preset = pr;
  out.slopeLimit = num('sl', 3, 25);
  out.slipDays = num('slip', -60, 60);
  const c = p.get('c');
  if (c) {
    out.scenarios = c
      .split(';')
      .map((item, k) => {
        const [site, range] = item.split('@');
        const ref = site ? decodeSite(site) : undefined;
        const [a, b] = (range ?? '').split('~').map(parseTime);
        if (!ref || a === undefined || b === undefined) return null;
        return { id: `u${k}`, site: ref, t0: a, t1: b } as Scenario;
      })
      .filter((x): x is Scenario => !!x)
      .slice(0, 4);
  }
  const m = p.get('m');
  if (m === 'map' || m === 'pano') out.mode = m;
  const a = p.get('a');
  if (a === 'explorer' || a === 'planner') out.audience = a;
  const v = p.get('v');
  if (v) {
    const [x, y, res] = v.split(',').map(parseFloat);
    if ([x, y, res].every(Number.isFinite) && res > 0) out.view = { x, y, res };
  }
  return out;
}
