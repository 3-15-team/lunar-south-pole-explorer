// Shared application state (signals). Every mode (warm-up, map, panorama) reads and
// writes this store; the URL hash mirrors the shareable part (state/url.ts).
import type { AntennaSeries } from '../core/antenna';
import { computed, signal } from '@preact/signals';
import type { Ephemeris } from '../core/ephemeris';
import type { Instant, Transition, IntervalMetrics } from '../core/metrics';
import type { HorizonProfile } from '../core/horizon';
import type { DemClient } from '../data/dem';
import { refKey, resolveSite, type ResolvedSite, type Site, type SiteRef } from '../data/sites';
import type { PlotSeries } from '../workers/protocol';
import type { SiteClient } from '../workers/siteClient';

export type Mode = 'map' | 'pano';
export type Layer = 'relief' | 'shadow' | 'illum' | 'earth' | 'dark' | 'slope' | 'suit';
export type Audience = 'explorer' | 'planner';
export type Preset = 'lander' | 'base';

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export interface Scenario {
  id: string;
  site: SiteRef;
  t0: number;
  t1: number;
  label?: string;
}

export interface SiteResult {
  key: string;
  site: ResolvedSite;
  profile: HorizonProfile;
}

export interface MetricsState {
  key: string;
  t0: number;
  t1: number;
  metrics: IntervalMetrics;
  plot: PlotSeries;
  sunNext: Transition | null;
  earthNext: Transition | null;
  noons: number[];
  now: Instant;
  /** Needed Earth-antenna height over the interval (core/antenna.ts). */
  antenna: AntennaSeries | null;
}

export interface ScenarioResult {
  base?: MetricsState;
  slipped?: MetricsState;
  error?: string;
  loading?: boolean;
}

const hourFloor = (t: number) => Math.floor(t / HOUR) * HOUR;

// --- runtime services (set once in main.tsx)
export const services = {
  dataBase: '/data/',
  computeBase: '/api/',
  client: null as SiteClient | null,
  eph: null as Ephemeris | null,
  dem: null as DemClient | null,
};

// --- shareable state
export const catalog = signal<Site[]>([]);
export const catalogFallback = signal(false);
export const siteRef = signal<SiteRef>({ kind: 'catalog', id: 'site01' });
export const time = signal<number>(hourFloor(Date.now()));
export const interval = signal<[number, number]>([hourFloor(Date.now()), hourFloor(Date.now()) + 30 * DAY]);
export const hObs = signal(2);
/** Earth-link antenna height above the site's terrain, m (Earth visibility / DTE metrics; core/antenna.ts). */
export const hAnt = signal(2);
/** Map: user asked for the Earth layer from the antenna ("button" mode of config.mapEarthAntenna). */
export const mapEarthAntRequested = signal(false);
export const dte = signal(0.5);
export const layer = signal<Layer>('relief');
export const footprint = signal(50);
export const preset = signal<Preset>('lander');
export const slopeLimit = signal(10);
export const scenarios = signal<Scenario[]>([]);
export const slipDays = signal(10);
export const mode = signal<Mode>('map');
/** Panorama: request to turn the camera to the Sun / Earth (`n` re-triggers the same target). */
export const panoLookAt = signal<{ target: 'sun' | 'earth'; n: number } | null>(null);
export const requestPanoLook = (target: 'sun' | 'earth') => (panoLookAt.value = { target, n: (panoLookAt.peek()?.n ?? 0) + 1 });
export const audience = signal<Audience>('explorer');
export const lighting = signal<'enhanced' | 'realistic'>('enhanced');
/** Panorama statistical micro-relief on/off (UI toggle; initial value from config.panoMicroDefault). */
export const microRelief = signal<boolean>(true);
export const showPsr = signal(true);
export const mapView = signal<{ x: number; y: number; res: number } | null>(null);

// --- transient UI state
export const playing = signal(false);
export const playSpeed = signal(24); // simulated hours per real second
export const warmupDone = signal(false);
export const status = signal<string>('');
export const progress = signal<{ done: number; total: number } | null>(null);
export const ephRange = signal<[number, number] | null>(null);
export const hoverInfo = signal<string>('');
export const computeOnline = signal<boolean | null>(null);

// --- results
export const siteResult = signal<SiteResult | null>(null);
export const siteError = signal<string | null>(null);
export const metricsState = signal<MetricsState | null>(null);
export const instant = signal<Instant | null>(null);
export const scenarioResults = signal<Record<string, ScenarioResult>>({});
export const calendar = signal<{ dayStart: number; days: number; rows: { key: string; label: string; illum: Float32Array; earth: Float32Array }[] } | null>(null);

export const site = computed<ResolvedSite | null>(() => resolveSite(siteRef.value, catalog.value));

export function setInterval_(t0: number, t1: number): void {
  const a = Math.min(t0, t1);
  const b = Math.max(t0, t1);
  interval.value = [a, Math.max(b, a + HOUR)];
}

/**
 * Scenario card the left panel scrolls to: the one just pinned, or (flash) the existing copy when a
 * duplicate is pinned. `n` changes on every request so the same card can be revealed again.
 */
export const revealScenario = signal<{ id: string; n: number; flash: boolean } | null>(null);
const reveal = (id: string, flash: boolean) => (revealScenario.value = { id, n: (revealScenario.peek()?.n ?? 0) + 1, flash });

export function pinScenario(): void {
  const s = site.value;
  if (!s) return;
  const list = scenarios.value;
  const [t0, t1] = interval.value;
  // same site + same interval already pinned: don't add a copy, point at the existing card
  const key = refKey(s.ref);
  const dup = list.find((c) => refKey(c.site) === key && c.t0 === t0 && c.t1 === t1);
  if (dup) {
    reveal(dup.id, true);
    return;
  }
  const id = Math.random().toString(36).slice(2, 8);
  scenarios.value = [...list, { id, site: s.ref, t0, t1, label: s.name }];
  reveal(id, false);
}

export function removeScenario(id: string): void {
  scenarios.value = scenarios.value.filter((s) => s.id !== id);
}
