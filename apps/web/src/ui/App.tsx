import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { audience, mode, playing, progress, siteError, status, warmupDone } from '../state/store';
import { HeatCalendar } from './HeatCalendar';
import { EduPanel, MetricTiles } from './Metrics';
import { ScenarioPanel, SitePanel } from './Panels';
import { SkyPlot } from './SkyPlot';
import { Timeline } from './Timeline';

type Loader = () => Promise<{ default: ComponentType }>;
const loaders: Record<'map' | 'pano' | 'warmup', Loader> = {
  map: () => import('../map/MapView'),
  pano: () => import('../pano/PanoView'),
  warmup: () => import('../warmup/Warmup'),
};

function Lazy({ which }: { which: keyof typeof loaders }) {
  const [C, setC] = useState<ComponentType | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loaders[which]()
      .then((m) => live && setC(() => m.default))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [which]);
  if (err) return <div class="notice warn">Failed to load the {which} module: {err}</div>;
  return C ? <C /> : <div class="loading">Loading {which}…</div>;
}

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (/INPUT|SELECT|TEXTAREA/.test(tag) || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('button,[role=slider]')) {
        e.preventDefault();
        playing.value = !playing.value;
      } else if (e.key === 'm' && !e.metaKey && !e.ctrlKey) mode.value = 'map';
      else if (e.key === 'p' && !e.metaKey && !e.ctrlKey && mode.value !== 'pano') mode.value = 'pano';
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const prog = progress.value;
  return (
    <div class={`app aud-${audience.value}`}>
      <header class="topbar">
        <div class="brand">
          <span class="logo" aria-hidden="true">◐</span>
          <div>
            <h1>Lunar South Pole Site Explorer</h1>
            <div class="tagline">Is this site and date viable — and what changes if the date slips?</div>
          </div>
        </div>
        <nav class="modes" role="tablist" aria-label="View mode">
          <button role="tab" aria-selected={mode.value === 'map'} class={mode.value === 'map' ? 'on' : ''} onClick={() => (mode.value = 'map')}>
            Map
          </button>
          <button role="tab" aria-selected={mode.value === 'pano'} class={mode.value === 'pano' ? 'on' : ''} onClick={() => (mode.value = 'pano')}>
            Panorama
          </button>
        </nav>
        <div class="right-tools">
          <div class="seg" role="group" aria-label="Information density">
            <button class={audience.value === 'explorer' ? 'on' : ''} aria-pressed={audience.value === 'explorer'} onClick={() => (audience.value = 'explorer')}>
              Explorer
            </button>
            <button class={audience.value === 'planner' ? 'on' : ''} aria-pressed={audience.value === 'planner'} onClick={() => (audience.value = 'planner')}>
              Planner
            </button>
          </div>
          <button class="btn small" onClick={() => (warmupDone.value = false)} title="Replay the intro">
            ↺ Intro
          </button>
        </div>
      </header>
      <aside class="left">
        <SitePanel />
        <ScenarioPanel />
      </aside>
      <main class="center" aria-label={mode.value === 'map' ? 'Map of the lunar south pole' : 'First-person panorama'}>
        {mode.value === 'map' ? <Lazy which="map" /> : <Lazy which="pano" />}
        {prog && (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
            Loading terrain {prog.done}/{prog.total}
          </div>
        )}
      </main>
      <aside class="right">
        <SkyPlot />
        <MetricTiles />
        <EduPanel />
      </aside>
      <footer class="bottom">
        <Timeline />
        <HeatCalendar />
        <div class="statusline" aria-live="polite">
          <span>{siteError.value ? '' : status.value}</span>
          <span class="provenance">
            Terrain: NASA LRO/LOLA (PGDA, Barker et al.) · Ephemeris: JPL DE440 + lunar ME frame via NAIF SPICE · Surface texture is procedural (synthetic), not imagery
          </span>
        </div>
      </footer>
      {!warmupDone.value && <Lazy which="warmup" />}
    </div>
  );
}
