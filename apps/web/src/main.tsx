import { render } from 'preact';
import { Ephemeris } from './core/ephemeris';
import { DemClient } from './data/dem';
import { loadCatalog } from './data/sites';
import {
  catalog,
  catalogFallback,
  computeOnline,
  ephRange,
  interval,
  services,
  siteRef,
  status,
  time,
  DAY,
} from './state/store';
import { initCompute, initUrlSync } from './state/sync';
import { SiteClient } from './workers/siteClient';
import { App } from './ui/App';
import './styles.css';

const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? new URL('data/', document.baseURI).pathname;
const COMPUTE_BASE = (import.meta.env.VITE_COMPUTE_BASE as string | undefined) ?? new URL('api/', document.baseURI).pathname;

async function boot(): Promise<void> {
  services.dataBase = DATA_BASE;
  services.computeBase = COMPUTE_BASE;
  initUrlSync();
  render(<App />, document.getElementById('app')!);

  const cat = await loadCatalog(DATA_BASE);
  catalog.value = cat.sites;
  catalogFallback.value = cat.fallback;
  const ref = siteRef.peek();
  if (ref.kind === 'catalog' && !cat.sites.some((s) => s.id === ref.id)) {
    const pick =
      cat.sites.find((s) => s.id === 'site01') ??
      cat.sites.find((s) => s.kind === 'pgda-5m' && s.inCoverage !== false) ??
      cat.sites.find((s) => s.inCoverage !== false) ??
      cat.sites[0];
    if (pick) siteRef.value = { kind: 'catalog', id: pick.id };
  }

  try {
    const [eph, dem] = await Promise.all([Ephemeris.load(DATA_BASE + 'ephem/'), DemClient.load(DATA_BASE)]);
    services.eph = eph;
    services.dem = dem;
    ephRange.value = [eph.startMs, eph.endMs];
    // keep the playhead and interval inside the ephemeris coverage
    const t = eph.clamp(time.peek());
    if (t !== time.peek()) time.value = t;
    const [a, b] = interval.peek();
    if (!eph.covers(a) || !eph.covers(b)) interval.value = [eph.clamp(a), eph.clamp(Math.max(b, a + DAY))];
  } catch (e) {
    status.value = `Data not found (${(e as Error).message}). Build it with \`make data-min\`.`;
    return;
  }
  const client = new SiteClient(DATA_BASE);
  services.client = client;
  client.ready.catch((e: Error) => (status.value = 'Worker init failed: ' + e.message));
  initCompute(client);
  fetch(COMPUTE_BASE + 'v1/info')
    .then((r) => (computeOnline.value = r.ok))
    .catch(() => (computeOnline.value = false));
}

boot();
