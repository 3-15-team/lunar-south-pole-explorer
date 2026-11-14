import type { Transition, IntervalMetrics, Instant } from '../core/metrics';
import type { HorizonProfile } from '../core/horizon';

export type WorkerRequest =
  | { id: number; type: 'init'; dataBase: string }
  | { id: number; type: 'profile'; key: string; x: number; y: number; hObs: number; naz?: number }
  | { id: number; type: 'metrics'; key: string; t0: number; t1: number; stepMin: number; dte: number; now: number; plotPoints?: number }
  | { id: number; type: 'calendar'; keys: string[]; dayStart: number; days: number; stepMin?: number; dte: number }
  | { id: number; type: 'terrain'; x: number; y: number };

export type WorkerResponse =
  | { type: 'result'; id: number; ok: true; result: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'progress'; key: string; done: number; total: number };

export interface ProfileResult {
  key: string;
  profile: HorizonProfile;
  tiles: number;
  msLoad: number;
  msCalc: number;
}

export interface PlotSeries {
  t: Float64Array;
  sunAz: Float32Array;
  sunEl: Float32Array;
  fSun: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
  fEarth: Float32Array;
}

export interface MetricsResult {
  key: string;
  t0: number;
  t1: number;
  stepMs: number;
  metrics: IntervalMetrics;
  plot: PlotSeries;
  now: Instant;
  sunNext: Transition | null;
  earthNext: Transition | null;
  noons: number[];
}

export interface CalendarResult {
  dayStart: number;
  days: number;
  rows: { key: string; illum: Float32Array; earth: Float32Array }[];
}
