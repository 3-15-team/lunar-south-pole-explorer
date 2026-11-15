// Wiring: URL hash <-> store, and reactive computation (site worker + main-thread instant values).
import { batch, effect } from '@preact/signals';
import { makeSiteFrame } from '../core/ephemeris';
import { evalAt } from '../core/metrics';
import { resolveSite, refKey } from '../data/sites';
import { SiteClient } from '../workers/siteClient';
import { eventsValid } from './countdown';
import { decodeState, encodeState } from './url';
import {
  DAY,
  audience,
  calendar,
  catalog,
  dte,
  footprint,
  hAnt,
  hObs,
  instant,
  interval,
  layer,
  mapView,
  metricsState,
  mode,
  preset,
  progress,
  scenarioResults,
  scenarios,
  services,
  site,
  siteError,
  siteRef,
  siteResult,
  slipDays,
  slopeLimit,
  status,
  time,
  type MetricsState,
  type ScenarioResult,
} from './store';

let lastHash = '';

export function applyHash(hash: string): void {
  const u = decodeState(hash);
  batch(() => {
    if (u.site) siteRef.value = u.site;
    if (u.time !== undefined) time.value = u.time;
    if (u.interval) interval.value = u.interval;
    if (u.hObs !== undefined) hObs.value = u.hObs;
    if (u.hAnt !== undefined) hAnt.value = u.hAnt;
    if (u.dte !== undefined) dte.value = u.dte;
    if (u.layer) layer.value = u.layer;
    if (u.footprint !== undefined) footprint.value = u.footprint;
    if (u.preset) preset.value = u.preset;
    if (u.slopeLimit !== undefined) slopeLimit.value = u.slopeLimit;
    if (u.slipDays !== undefined) slipDays.value = u.slipDays;
    if (u.scenarios) scenarios.value = u.scenarios;
    if (u.mode) mode.value = u.mode;
    if (u.audience) audience.value = u.audience;
    if (u.view) mapView.value = u.view;
  });
}

export function initUrlSync(): void {
  applyHash(location.hash);
  let timer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const h = encodeState({
      site: siteRef.value,
      time: time.value,
      interval: interval.value,
      hObs: hObs.value,
      hAnt: hAnt.value,
      dte: dte.value,
      layer: layer.value,
      footprint: footprint.value,
      preset: preset.value,
      slopeLimit: slopeLimit.value,
      scenarios: scenarios.value,
      slipDays: slipDays.value,
      mode: mode.value,
      audience: audience.value,
      view: mapView.value ?? undefined,
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (h !== lastHash) {
        lastHash = h;
        history.replaceState(null, '', '#' + h);
      }
    }, 250);
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.replace(/^#/, '');
    if (h !== lastHash) {
      lastHash = h;
      applyHash(h);
    }
  });
}

function debounce<T extends unknown[]>(fn: (...a: T) => void, ms: number): (...a: T) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: T) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function initCompute(client: SiteClient): void {
  client.onProgress = (_k, done, total) => {
    progress.value = done >= total ? null : { done, total };
  };

  // 1) site / observer height → horizon profile (worker)
  let profileToken = 0;
  effect(() => {
    const s = site.value;
    const h = hObs.value;
    const ha = hAnt.value;
    const token = ++profileToken;
    if (!s) return;
    if (s.inCoverage === false || s.lat > -79.9) {
      batch(() => {
        siteResult.value = null;
        metricsState.value = null;
        siteError.value = `${s.name} is outside the LOLA polar DEM coverage (80°S–90°S): no terrain horizon can be computed.`;
      });
      return;
    }
    siteError.value = null;
    status.value = `Computing terrain horizon for ${s.name}…`;
    client
      .profile(s.x, s.y, h, ha)
      .then((r) => {
        if (token !== profileToken) return;
        siteResult.value = { key: r.key, site: s, profile: r.profile };
        status.value = `Horizon ready · ${r.tiles} DEM tiles · ${Math.round(r.msLoad)} ms load · ${Math.round(r.msCalc)} ms ray-march`;
      })
      .catch((e: Error) => {
        if (token !== profileToken) return;
        siteResult.value = null;
        siteError.value = e.message;
        status.value = '';
      });
  });

  // 2) interval metrics + events (worker)
  let metricsToken = 0;
  // `settled` runs before metricsState is assigned (the assignment synchronously re-runs effects)
  const fetchMetrics = (key: string, t0: number, t1: number, now: number, d: number, settled?: () => void): void => {
    const token = ++metricsToken;
    client
      .metrics(key, t0, t1, now, d)
      .then((m) => {
        settled?.();
        if (token !== metricsToken) return;
        metricsState.value = { ...m, key } as MetricsState;
      })
      .catch((e: Error) => {
        settled?.();
        status.value = 'Metrics failed: ' + e.message;
      });
  };
  // interval / DTE / site edits arrive in bursts (slider drags): debounce
  const runMetrics = debounce((key: string, t0: number, t1: number, now: number, d: number) => fetchMetrics(key, t0, t1, now, d), 120);
  effect(() => {
    const sr = siteResult.value;
    const [t0, t1] = interval.value;
    const d = dte.value;
    if (!sr) return;
    runMetrics(sr.key, t0, t1, time.peek(), d);
  });
  // Events (next sunset/sunrise, Earthset/rise) are relative to the playhead: refresh as soon as the
  // playhead leaves [m.now.t, next event). NOT debounced: during Play the playhead moves every frame,
  // so a trailing debounce would be postponed forever and the countdown would run negative. Instead
  // at most one request is in flight; the effect also tracks metricsState, so each result re-checks
  // the window against the current playhead and catches up if Play has already moved past it.
  let eventsBusy = false;
  effect(() => {
    const t = time.value;
    const m = metricsState.value;
    const sr = siteResult.peek();
    if (!sr || !m || m.key !== sr.key || eventsBusy) return;
    if (eventsValid(m, t)) return;
    eventsBusy = true;
    const [t0, t1] = interval.peek();
    fetchMetrics(sr.key, t0, t1, t, dte.peek(), () => (eventsBusy = false));
  });

  // 3) instant values at the playhead (main thread, cheap)
  effect(() => {
    const sr = siteResult.value;
    const t = time.value;
    const eph = services.eph;
    if (!sr || !eph) {
      instant.value = null;
      return;
    }
    const frame = makeSiteFrame(sr.profile.lat, sr.profile.lon, sr.profile.hTerrain, sr.profile.hObs);
    const run = () => (instant.value = evalAt({ frame, profile: sr.profile, eph }, t));
    if (eph.isLoaded(t) && eph.isLoaded(t + eph.stepMs)) run();
    else eph.ensureRange(t, t + eph.stepMs).then(run).catch(() => (instant.value = null));
  });

  // 4) scenarios: base + slipped metrics
  effect(() => {
    const list = scenarios.value;
    const slip = slipDays.value * DAY;
    const d = dte.value;
    const h = hObs.value;
    const ha = hAnt.value;
    const cat = catalog.value;
    const next: Record<string, ScenarioResult> = {};
    for (const sc of list) next[sc.id] = { loading: true, ...scenarioResults.peek()[sc.id] };
    scenarioResults.value = next;
    for (const sc of list) {
      const s = resolveSite(sc.site, cat);
      const set = (r: ScenarioResult) => (scenarioResults.value = { ...scenarioResults.peek(), [sc.id]: r });
      if (!s || s.lat > -79.9) {
        set({ error: 'outside DEM coverage' });
        continue;
      }
      client
        .profile(s.x, s.y, h, ha)
        .then((p) =>
          Promise.all([
            client.metrics(p.key, sc.t0, sc.t1, sc.t0, d),
            client.metrics(p.key, sc.t0 + slip, sc.t1 + slip, sc.t0 + slip, d),
          ]),
        )
        .then(([a, b]) => set({ base: a as MetricsState, slipped: b as MetricsState }))
        .catch((e: Error) => set({ error: e.message }));
    }
  });
}

/** Date × site heat calendar for the scenario sites (or current site + PGDA sites). */
export async function computeCalendar(client: SiteClient, days = 60): Promise<void> {
  const cat = catalog.peek();
  const refs = scenarios.peek().length
    ? scenarios.peek().map((s) => s.site)
    : [siteRef.peek(), ...cat.filter((s) => s.kind === 'pgda-5m' && s.inCoverage !== false).slice(0, 7).map((s) => ({ kind: 'catalog' as const, id: s.id }))];
  const uniq = [...new Map(refs.map((r) => [refKey(r), r])).values()];
  const h = hObs.peek();
  const ha = hAnt.peek();
  const rows: { key: string; label: string }[] = [];
  for (const r of uniq) {
    const s = resolveSite(r, cat);
    if (!s || s.lat > -79.9) continue;
    try {
      const p = await client.profile(s.x, s.y, h, ha);
      rows.push({ key: p.key, label: s.name });
    } catch {
      /* skip */
    }
  }
  const dayStart = Math.floor(interval.peek()[0] / DAY) * DAY;
  const res = await client.calendar(rows.map((r) => r.key), dayStart, days, dte.peek());
  calendar.value = {
    dayStart,
    days,
    rows: res.rows.map((row, i) => ({ ...row, label: rows[i].label })),
  };
}
