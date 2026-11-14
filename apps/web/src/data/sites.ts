// Site catalog (docs/DATA.md §4) and site references used by the store / URL.
import { formatLatLon, latLonToXY, xyToLatLon } from '../core/geo';

export type SiteKind = 'pgda-5m' | 'artemis' | 'clps' | 'mission' | 'reference' | 'custom';

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: SiteKind;
  coordQuality?: 'dem-centre' | 'published' | 'approx';
  inCoverage?: boolean;
  hiRes?: { z: number; bbox: [number, number, number, number] } | null;
  note?: string;
  source?: string;
}

export type SiteRef = { kind: 'catalog'; id: string } | { kind: 'custom'; lat: number; lon: number; name?: string };

export interface ResolvedSite extends Site {
  x: number;
  y: number;
  ref: SiteRef;
}

/** Minimal built-in fallback used only if data/web/sites.json is missing. */
export const FALLBACK_SITES: Site[] = [
  {
    id: 'pole',
    name: 'Lunar south pole (90°S)',
    lat: -90,
    lon: 0,
    kind: 'reference',
    coordQuality: 'published',
    inCoverage: true,
    note: 'The geographic south pole lies on the rim region of Shackleton crater.',
  },
  {
    id: 'shackleton-rim-crop',
    name: 'Shackleton rim (high point of PGDA Site04 DEM)',
    lat: -89.7804,
    lon: -156.19,
    kind: 'pgda-5m',
    coordQuality: 'dem-centre',
    inCoverage: true,
    note: 'Highest rim point in the 5 m LOLA DEM crop used by the team prototype.',
    source: 'https://pgda.gsfc.nasa.gov/products/78',
  },
];

export const KIND_LABEL: Record<SiteKind, string> = {
  'pgda-5m': 'LOLA 5 m sites (PGDA)',
  artemis: 'Artemis III candidate regions',
  clps: 'CLPS deliveries',
  mission: 'Other missions',
  reference: 'Reference points',
  custom: 'Custom',
};

export async function loadCatalog(dataBase: string): Promise<{ sites: Site[]; fallback: boolean }> {
  try {
    const r = await fetch(dataBase + 'sites.json');
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { sites: Site[] };
    if (!Array.isArray(j.sites) || !j.sites.length) throw new Error('empty');
    return { sites: j.sites, fallback: false };
  } catch {
    return { sites: FALLBACK_SITES, fallback: true };
  }
}

export function resolveSite(ref: SiteRef, catalog: Site[]): ResolvedSite | null {
  if (ref.kind === 'catalog') {
    const s = catalog.find((c) => c.id === ref.id);
    if (!s) return null;
    const { x, y } = latLonToXY(s.lat, s.lon);
    return { ...s, x, y, ref };
  }
  const { x, y } = latLonToXY(ref.lat, ref.lon);
  return {
    id: `custom:${ref.lat.toFixed(4)},${ref.lon.toFixed(4)}`,
    name: ref.name ?? `Custom ${formatLatLon(ref.lat, ref.lon, 3)}`,
    lat: ref.lat,
    lon: ref.lon,
    kind: 'custom',
    coordQuality: 'published',
    inCoverage: ref.lat <= -80,
    x,
    y,
    ref,
  };
}

export function customFromXY(x: number, y: number, name?: string): SiteRef {
  const { lat, lon } = xyToLatLon(x, y);
  return { kind: 'custom', lat: +lat.toFixed(5), lon: +lon.toFixed(5), name };
}

export function refKey(ref: SiteRef): string {
  return ref.kind === 'catalog' ? ref.id : `${ref.lat.toFixed(5)},${ref.lon.toFixed(5)}`;
}
