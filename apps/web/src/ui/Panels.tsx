// Left column: site catalogue + custom coordinates, pinned scenario cards with
// "what if it slips" deltas.
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatLatLon, parseLatLon } from '../core/geo';
import { KIND_LABEL, resolveSite, type Site, type SiteKind } from '../data/sites';
import {
  audience,
  catalog,
  catalogFallback,
  interval,
  pinScenario,
  removeScenario,
  revealScenario,
  scenarioResults,
  scenarios,
  siteRef,
  site,
  slipDays,
  time,
  type MetricsState,
} from '../state/store';
import { scenarioSuit } from '../state/scenarioSuit';
import { delta, fmtDate, fmtHours, fmtPct } from './format';

const ORDER: SiteKind[] = ['pgda-5m', 'artemis', 'clps', 'mission', 'reference'];

// Collapsed catalogue groups: a per-browser layout preference (localStorage, not the URL).
const GROUPS_KEY = 'lspe.sites.collapsed';
function loadCollapsed(): SiteKind[] {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function SitePanel() {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<SiteKind[]>(loadCollapsed);
  const toggleGroup = (k: SiteKind) => {
    const next = collapsed.includes(k) ? collapsed.filter((c) => c !== k) : [...collapsed, k];
    setCollapsed(next);
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: keep in-memory only */
    }
  };
  const [coord, setCoord] = useState('');
  const [coordErr, setCoordErr] = useState('');
  const cur = site.value;
  const list = catalog.value.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.id.includes(q.toLowerCase()));
  const groups = ORDER.map((k) => ({ k, items: list.filter((s) => s.kind === k) })).filter((g) => g.items.length);
  const pick = (s: Site) => (siteRef.value = { kind: 'catalog', id: s.id });
  const submit = (e: Event) => {
    e.preventDefault();
    const ll = parseLatLon(coord);
    if (!ll) return setCoordErr('Use “89.45S 137.3W” or “-89.45, -137.3”.');
    if (ll.lat > -80) setCoordErr('Outside the 80°S–90°S DEM: metrics unavailable.');
    else setCoordErr('');
    siteRef.value = { kind: 'custom', lat: ll.lat, lon: ll.lon };
  };
  return (
    <section class="panel sites" aria-label="Sites">
      <div class="panel-title">Sites</div>
      {catalogFallback.value && <div class="notice small">Catalogue file missing — showing built-in reference points.</div>}
      <input class="search" type="search" placeholder="Search sites…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search sites" />
      <div class="site-list" role="listbox" aria-label="Site catalogue">
        {groups.map((g) => {
          // a search shows every match, so collapsing applies only to the unfiltered list
          const shut = !q && collapsed.includes(g.k);
          return (
          <div class="site-group">
            <button type="button" class="site-group-title" aria-expanded={!shut} onClick={() => toggleGroup(g.k)}>
              <span class="disclosure" aria-hidden="true">{shut ? '▸' : '▾'}</span>
              {KIND_LABEL[g.k]}
              {shut && <span class="site-group-count">{g.items.length}</span>}
            </button>
            {!shut && g.items.map((s) => {
              const active = cur?.id === s.id;
              const out = s.inCoverage === false;
              return (
                <button role="option" aria-selected={active} class={`site-item ${active ? 'active' : ''} ${out ? 'out' : ''}`} onClick={() => pick(s)} title={s.note ?? ''}>
                  <span class="site-name">{s.name}</span>
                  <span class="site-meta">
                    {formatLatLon(s.lat, s.lon, 2)}
                    {out && <span class="badge">outside coverage</span>}
                    {s.coordQuality === 'approx' && <span class="badge">approx.</span>}
                    {s.hiRes && <span class="badge good">5 m DEM</span>}
                  </span>
                </button>
              );
            })}
          </div>
          );
        })}
      </div>
      <form class="coord-form" onSubmit={submit}>
        <label for="coord">Custom coordinates</label>
        <div class="row">
          <input id="coord" placeholder="89.45S 137.3W" value={coord} onInput={(e) => setCoord((e.target as HTMLInputElement).value)} />
          <button class="btn" type="submit">
            Go
          </button>
        </div>
        {coordErr && <div class="field-error">{coordErr}</div>}
        <div class="hint">…or click anywhere on the map.</div>
      </form>
    </section>
  );
}

function row(label: string, a: number | undefined, b: number | undefined, kind: 'pct' | 'hours', goodUp: boolean, showSlip: boolean) {
  const fmt = kind === 'pct' ? fmtPct : fmtHours;
  const d = a !== undefined && b !== undefined ? delta(a, b, kind, goodUp) : null;
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{a !== undefined ? fmt(a) : '…'}</td>
      {showSlip && <td>{b !== undefined ? fmt(b) : '…'}</td>}
      {showSlip && <td class={`delta ${d?.cls ?? ''}`}>{d?.text ?? ''}</td>}
    </tr>
  );
}

function verdict(a?: MetricsState, b?: MetricsState): string {
  if (!a || !b) return '';
  const di = b.metrics.illumFrac - a.metrics.illumFrac;
  const dd = b.metrics.longestDarkH - a.metrics.longestDarkH;
  const de = b.metrics.earthFrac - a.metrics.earthFrac;
  const parts: string[] = [];
  if (Math.abs(di) >= 0.05) parts.push(`${di > 0 ? 'more' : 'less'} sunlight (${fmtPct(a.metrics.illumFrac)} → ${fmtPct(b.metrics.illumFrac)})`);
  if (Math.abs(dd) >= 6) parts.push(`longest night ${fmtHours(a.metrics.longestDarkH)} → ${fmtHours(b.metrics.longestDarkH)}`);
  if (Math.abs(de) >= 0.05) parts.push(`Earth contact ${fmtPct(a.metrics.earthFrac)} → ${fmtPct(b.metrics.earthFrac)}`);
  return parts.length ? parts.join('; ') : 'little change';
}

export function ScenarioPanel() {
  const list = scenarios.value;
  const res = scenarioResults.value;
  const slip = slipDays.value;
  const planner = audience.value === 'planner';
  const shown = revealScenario.value;
  const suits = scenarioSuit.value;
  const cardsRef = useRef<HTMLDivElement>(null);
  // scroll the left panel to the card just pinned (or to the existing copy of a duplicate). Cards
  // change height while their metrics load (pinning recomputes every scenario), which moves the
  // target, so keep it in view while the list resizes — for a short while only, so a manual
  // scroll afterwards isn't fought.
  useEffect(() => {
    const list = cardsRef.current;
    if (!shown || !list) return;
    const show = () => list.querySelector(`[data-id="${shown.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    show();
    const ro = new ResizeObserver(show);
    ro.observe(list);
    for (const c of list.children) ro.observe(c);
    const stop = setTimeout(() => ro.disconnect(), 3000);
    return () => {
      clearTimeout(stop);
      ro.disconnect();
    };
  }, [shown?.n]);
  return (
    <section class="panel scenarios" aria-label="Scenario comparison">
      {/* sticks to the top of the left panel while scrolling a long card list, so Pin stays reachable */}
      <div class="scen-head">
        <div class="panel-title">
          Compare scenarios <span class="muted">({list.length})</span>
        </div>
        <button class="btn primary wide" onClick={pinScenario} disabled={!site.value}>
          + Pin current site & interval
        </button>
      </div>
      <label class="slider-row slip" title="Shift every pinned scenario's interval and compare">
        <span>What if it slips?</span>
        <input type="range" min={-30} max={30} step={1} value={slip} onInput={(e) => (slipDays.value = +(e.target as HTMLInputElement).value)} aria-label="Slip in days" />
        <output>
          {slip > 0 ? '+' : ''}
          {slip} d
        </output>
      </label>
      {list.length === 0 && <div class="hint">Pin site/date scenarios to compare them side by side, then drag the slip slider.</div>}
      <div class="cards" ref={cardsRef}>
        {list.map((sc) => {
          const r = res[sc.id] ?? {};
          const s = resolveSite(sc.site, catalog.value);
          const a = r.base?.metrics;
          const b = r.slipped?.metrics;
          const flashing = !!shown?.flash && shown.id === sc.id;
          const suit = suits[sc.id];
          return (
            <article
              // a new key on each repeat restarts the flash animation
              key={flashing ? `${sc.id}:${shown.n}` : sc.id}
              data-id={sc.id}
              class={`card${flashing ? ' flash' : ''}`}
              // chip + stripe colour = the point's Suitability score on the map's cividis ramp
              style={{ '--c': suit?.color ?? 'var(--line)' } as Record<string, string>}
            >
              <header>
                <button
                  class="card-title"
                  onClick={() => {
                    siteRef.value = sc.site;
                    interval.value = [sc.t0, sc.t1];
                    time.value = sc.t0;
                  }}
                  title="Show this scenario"
                >
                  <span class="chip" title={suit?.label} aria-label={suit?.label} />
                  {s?.name ?? sc.label ?? 'Scenario'}
                </button>
                <button class="icon" aria-label="Remove scenario" onClick={() => removeScenario(sc.id)}>
                  ×
                </button>
              </header>
              <div class="card-dates">
                {fmtDate(sc.t0, false)} → {fmtDate(sc.t1, false)}
              </div>
              {r.error ? (
                <div class="notice small warn">{r.error}</div>
              ) : (
                <>
                  <table class="cmp">
                    {slip !== 0 && (
                      <thead>
                        <tr>
                          <th />
                          <th>plan</th>
                          <th>
                            {slip > 0 ? '+' : ''}
                            {slip} d
                          </th>
                          <th />
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {row('Sunlight', a?.illumFrac, b?.illumFrac, 'pct', true, slip !== 0)}
                      {row('Longest night', a?.longestDarkH, b?.longestDarkH, 'hours', false, slip !== 0)}
                      {row('Earth contact', a?.earthFrac, b?.earthFrac, 'pct', true, slip !== 0)}
                      {planner && row('Comms gap', a?.longestNoCommsH, b?.longestNoCommsH, 'hours', false, slip !== 0)}
                      {planner && row('Vertical PV', a?.powerVertical, b?.powerVertical, 'pct', true, slip !== 0)}
                    </tbody>
                  </table>
                  {slip !== 0 && <div class="verdict">{r.base && r.slipped ? `Slip ${slip > 0 ? '+' : ''}${slip} d: ${verdict(r.base, r.slipped)}.` : 'computing…'}</div>}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
