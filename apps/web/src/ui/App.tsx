import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { audience, mode, playing, progress, siteError, status, warmupDone } from '../state/store';
import { HeatCalendar } from './HeatCalendar';
import { EduPanel, MetricRail, MetricTiles, Verdict } from './Metrics';
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

function ShareButton() {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      prompt('Copy this link', location.href);
    }
  };
  return (
    <button class="btn small" onClick={copy} title="Copy a link to exactly this site, time, interval and scenario set">
      {done ? '✓ Copied' : '🔗 Share'}
    </button>
  );
}

type Side = 'left' | 'right';

// Panel collapse is a per-browser layout preference, not shareable state, so it lives in
// localStorage rather than the URL hash.
function usePanelCollapsed(side: Side) {
  const key = `lspe.panel.${side}.collapsed`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable: keep in-memory only */
    }
  }, [collapsed]);
  const toggle = () => setCollapsed((v) => !v);
  return [collapsed, toggle] as const;
}

// Panels stack vertically below this width (see styles.css), so collapsing makes no sense there.
const WIDE_QUERY = '(min-width: 1101px)';
function useWideLayout() {
  const [wide, setWide] = useState(() => matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const m = matchMedia(WIDE_QUERY);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function SidebarIcon({ side }: { side: Side }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1.75" y="2.75" width="14.5" height="12.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" />
      <rect x={side === 'left' ? 4 : 10.5} y="5" width="3.5" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

function PanelToggle({ side, collapsed, onToggle }: { side: Side; collapsed: boolean; onToggle: () => void }) {
  const name = side === 'left' ? 'sites & scenarios' : 'metrics';
  const key = side === 'left' ? '[' : ']';
  return (
    <div class="panel-bar">
      <button
        class="panel-toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name} panel`}
        title={`${collapsed ? 'Expand' : 'Collapse'} ${name} panel (${key})`}
      >
        <SidebarIcon side={side} />
      </button>
    </div>
  );
}

export function App() {
  const [leftCollapsedPref, toggleLeft] = usePanelCollapsed('left');
  const [rightCollapsedPref, toggleRight] = usePanelCollapsed('right');
  const wide = useWideLayout();
  const leftCollapsed = wide && leftCollapsedPref;
  const rightCollapsed = wide && rightCollapsedPref;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (/INPUT|SELECT|TEXTAREA/.test(tag) || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('button,[role=slider]')) {
        e.preventDefault();
        playing.value = !playing.value;
      } else if (e.key === 'm' && !e.metaKey && !e.ctrlKey) mode.value = 'map';
      else if (e.key === 'p' && !e.metaKey && !e.ctrlKey && mode.value !== 'pano') mode.value = 'pano';
      else if ((e.key === '[' || e.key === ']') && !e.metaKey && !e.ctrlKey && matchMedia(WIDE_QUERY).matches) {
        if (e.key === '[') toggleLeft();
        else toggleRight();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const prog = progress.value;
  return (
    <div class={`app aud-${audience.value}${leftCollapsed ? ' l-collapsed' : ''}${rightCollapsed ? ' r-collapsed' : ''}`}>
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
          <ShareButton />
          <button class="btn small" onClick={() => (warmupDone.value = false)} title="Replay the intro">
            ↺ Intro
          </button>
        </div>
      </header>
      <aside class={`left${leftCollapsed ? ' collapsed' : ''}`}>
        {wide && <PanelToggle side="left" collapsed={leftCollapsed} onToggle={toggleLeft} />}
        {!leftCollapsed && (
          <>
            <SitePanel />
            <ScenarioPanel />
          </>
        )}
      </aside>
      <main class="center" aria-label={mode.value === 'map' ? 'Map of the lunar south pole' : 'First-person panorama'}>
        {mode.value === 'map' ? <Lazy which="map" /> : <Lazy which="pano" />}
        {prog && (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
            Loading terrain {prog.done}/{prog.total}
          </div>
        )}
      </main>
      <aside class={`right${rightCollapsed ? ' collapsed' : ''}`}>
        {wide && <PanelToggle side="right" collapsed={rightCollapsed} onToggle={toggleRight} />}
        {rightCollapsed ? (
          <MetricRail />
        ) : (
          <>
            <Verdict />
            <SkyPlot />
            <MetricTiles />
            <EduPanel />
          </>
        )}
      </aside>
      <footer class="bottom">
        <Timeline />
        <HeatCalendar />
        <div class="statusline" aria-live="polite">
          <span>{siteError.value ? '' : status.value}</span>
          <span class="provenance">
            Terrain: NASA LRO/LOLA (PGDA, Barker et al.; outside 80°S: LOLA global 16 px/deg, context only) · Ephemeris: JPL DE440 + lunar ME frame via NAIF SPICE · Surface texture is procedural (synthetic), not imagery
          </span>
        </div>
      </footer>
      {!warmupDone.value && <Lazy which="warmup" />}
    </div>
  );
}
