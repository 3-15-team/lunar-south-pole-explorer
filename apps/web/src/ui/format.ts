export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const neg = ms < 0;
  let m = Math.round(Math.abs(ms) / 60000);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  const s = d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
  return neg ? '−' + s : s;
}

export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return '—';
  return h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(h < 10 ? 1 : 0)} h`;
}

export const fmtPct = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(100 * x).toFixed(digits)}%`;

export const fmtDeg = (x: number | null | undefined, digits = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x.toFixed(digits)}°`;

export function fmtDate(t: number, withTime = true): string {
  const iso = new Date(t).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.slice(0, 10);
}

export function fmtShortDate(t: number): string {
  const d = new Date(t);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export function fmtDistance(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

/** Signed delta with arrow; `goodWhenUp` decides colour class. */
export function delta(a: number, b: number, kind: 'pct' | 'hours', goodWhenUp: boolean): { text: string; cls: string } {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { text: '—', cls: '' };
  const d = b - a;
  const eps = kind === 'pct' ? 0.005 : 0.5;
  if (Math.abs(d) < eps) return { text: '±0', cls: 'same' };
  const up = d > 0;
  const text = kind === 'pct' ? `${up ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(0)} pts` : `${up ? '▲' : '▼'} ${fmtHours(Math.abs(d))}`;
  return { text, cls: up === goodWhenUp ? 'good' : 'bad' };
}

/** datetime-local value (UTC) helpers */
export const toInputValue = (t: number): string => new Date(t).toISOString().slice(0, 16);
export const fromInputValue = (s: string): number => Date.parse(s + 'Z');

/** Colour-blind-safe sequential map (cividis-like), x ∈ [0,1] → css rgb */
const CIVIDIS: [number, number, number][] = [
  [0, 34, 78],
  [53, 63, 108],
  [87, 92, 109],
  [124, 123, 120],
  [166, 157, 117],
  [212, 193, 99],
  [253, 232, 69],
];
export function cividis(x: number): string {
  if (!Number.isFinite(x)) return 'transparent';
  const t = Math.min(1, Math.max(0, x)) * (CIVIDIS.length - 1);
  const i = Math.min(CIVIDIS.length - 2, Math.floor(t));
  const f = t - i;
  const c = CIVIDIS[i].map((v, k) => Math.round(v + (CIVIDIS[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
