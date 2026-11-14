// Promise wrapper around site.worker.ts (one shared worker; requests are cached by key).
import type { CalendarResult, MetricsResult, ProfileResult, WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class SiteClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private profiles = new Map<string, Promise<ProfileResult>>();
  onProgress?: (key: string, done: number, total: number) => void;
  ready: Promise<{ ephStart: number; ephEnd: number }>;

  constructor(dataBase: string) {
    this.worker = new Worker(new URL('./site.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        this.onProgress?.(m.key, m.done, m.total);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
    };
    this.ready = this.call({ type: 'init', dataBase }) as Promise<{ ephStart: number; ephEnd: number }>;
  }

  private call(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  static siteKey(x: number, y: number, hObs: number): string {
    return `${Math.round(x)}:${Math.round(y)}:${hObs.toFixed(1)}`;
  }

  profile(x: number, y: number, hObs: number): Promise<ProfileResult> {
    const key = SiteClient.siteKey(x, y, hObs);
    let p = this.profiles.get(key);
    if (!p) {
      p = this.ready.then(() => this.call({ type: 'profile', key, x, y, hObs }) as Promise<ProfileResult>);
      p.catch(() => this.profiles.delete(key));
      this.profiles.set(key, p);
    }
    return p;
  }

  metrics(key: string, t0: number, t1: number, now: number, dte: number, stepMin = 10): Promise<MetricsResult> {
    return this.call({ type: 'metrics', key, t0, t1, now, dte, stepMin }) as Promise<MetricsResult>;
  }

  calendar(keys: string[], dayStart: number, days: number, dte: number): Promise<CalendarResult> {
    return this.call({ type: 'calendar', keys, dayStart, days, dte, stepMin: 30 }) as Promise<CalendarResult>;
  }

  terrain(x: number, y: number): Promise<{ lat: number; lon: number; h: number; res: number }> {
    return this.call({ type: 'terrain', x, y }) as Promise<{ lat: number; lon: number; h: number; res: number }>;
  }
}
