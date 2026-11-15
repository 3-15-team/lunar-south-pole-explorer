// Transparent multi-criteria suitability score (docs/METRICS.md "Suitability score").
// Mirrored in GLSL (map/engine/shaders.ts) and Python (libs/lunarcore/suitability.py).

export interface Weights {
  illum: number;
  dark: number;
  earth: number;
  slope: number;
  relief: number;
}

export interface PresetDef {
  id: 'lander' | 'base';
  label: string;
  weights: Weights;
  slopeLimit: number;
  darkRef: number; // hours
}

export const PRESETS: Record<'lander' | 'base', PresetDef> = {
  lander: { id: 'lander', label: 'Short lander mission (≤ 14 d)', weights: { illum: 0.3, dark: 0.3, earth: 0.25, slope: 0.1, relief: 0.05 }, slopeLimit: 10, darkRef: 96 },
  base: { id: 'base', label: 'Long-term base', weights: { illum: 0.35, dark: 0.3, earth: 0.1, slope: 0.1, relief: 0.15 }, slopeLimit: 8, darkRef: 240 },
};

export interface Features {
  slopeMax: number; // deg
  slopeMean: number; // deg
  relief: number; // m
  illum: number; // 0..1
  dark: number; // hours
  earth: number; // 0..1
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function utilities(f: Features, footprintM: number, slopeLimit: number, darkRef: number): Weights {
  return {
    illum: clamp01((f.illum - 0.2) / (0.9 - 0.2)),
    dark: 1 - clamp01(f.dark / darkRef),
    earth: clamp01(f.earth / 0.8),
    slope: 1 - clamp01(f.slopeMean / slopeLimit),
    relief: 1 - clamp01(f.relief / (0.2 * footprintM + 1)),
  };
}

/** Score in [0,1], or −1 when a hard constraint fails. */
export function score(f: Features, w: Weights, footprintM: number, slopeLimit: number, darkRef: number): number {
  if (!(f.slopeMax <= slopeLimit) || !Number.isFinite(f.illum)) return -1;
  const u = utilities(f, footprintM, slopeLimit, darkRef);
  const sw = w.illum + w.dark + w.earth + w.slope + w.relief;
  return (w.illum * u.illum + w.dark * u.dark + w.earth * u.earth + w.slope * u.slope + w.relief * u.relief) / sw;
}

/**
 * The interval half of the score — sunlight, longest night, Earth link — with the same utilities
 * and preset weights, renormalised over those three terms. Needs only a site's interval metrics
 * (no terrain), e.g. to colour a scenario card; slope / relief and the slope cut are not included.
 */
export function intervalScore(f: Pick<Features, 'illum' | 'dark' | 'earth'>, w: Weights, darkRef: number): number {
  const u = utilities({ ...f, slopeMax: 0, slopeMean: 0, relief: 0 }, 1, 1, darkRef);
  return (w.illum * u.illum + w.dark * u.dark + w.earth * u.earth) / (w.illum + w.dark + w.earth);
}

/** Gamma(k,1) sampler (Marsaglia–Tsang), k ≥ 1 here. */
function gamma(k: number, rnd: () => number): number {
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = rnd();
      const u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dirichlet(conc·w) draw of weights. */
export function perturbWeights(w: Weights, conc: number, rnd: () => number): Weights {
  const keys = ['illum', 'dark', 'earth', 'slope', 'relief'] as const;
  const g = keys.map((k) => gamma(Math.max(1, conc * w[k]), rnd));
  const s = g.reduce((a, b) => a + b, 0);
  const out = {} as Weights;
  keys.forEach((k, i) => (out[k] = g[i] / s));
  return out;
}

export interface Candidate {
  i: number; // index in the pool
  x: number;
  y: number;
  score: number;
  features: Features;
  rankStability?: number; // share of draws in the top-k
}

/**
 * Quick client-side robustness: weights ~ Dirichlet(50·w); share of draws in which each
 * candidate stays in the top-k of the competitor pool. (DEM-error perturbation runs
 * server-side; see services/compute.)
 */
export function rankStability(pool: Candidate[], cands: Candidate[], w: Weights, footprintM: number, slopeLimit: number, darkRef: number, n = 200, k = 10, seed = 42): number[] {
  const rnd = mulberry32(seed);
  const hits = new Array(cands.length).fill(0);
  const scores = new Float64Array(pool.length);
  for (let d = 0; d < n; d++) {
    const ww = perturbWeights(w, 50, rnd);
    for (let i = 0; i < pool.length; i++) scores[i] = score(pool[i].features, ww, footprintM, slopeLimit, darkRef);
    const sorted = Array.from(scores).sort((a, b) => b - a);
    const thr = sorted[Math.min(k, sorted.length) - 1];
    cands.forEach((c, j) => {
      if (scores[c.i] >= thr) hits[j]++;
    });
  }
  return hits.map((h) => h / n);
}
