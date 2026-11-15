// Left column: site catalogue + custom coordinates, pinned scenario cards with
// "what if it slips" deltas.
import { useState } from 'preact/hooks';
import { formatLatLon, parseLatLon } from '../core/geo';
import { KIND_LABEL, resolveSite, type Site, type SiteKind } from '../data/sites';
import {
  MAX_SCENARIOS,
  SCENARIO_COLORS,
  audience,
  catalog,
  catalogFallback,
  hObs,
  interval,
  pinScenario,
  removeScenario,
  scenarioResults,
  scenarios,
  siteRef,
  site,
  slipDays,
  time,
  type MetricsState,
} from '../state/store';
import { delta, fmtDate, fmtHours, fmtPct } from './format';
import { fmtHeight, H_TICKS, heightToPos, POS_MAX, POS_MIN, POS_STEP, posToHeight, tickPos } from './heightScale';

/**
 * Observer (camera / solar array / mast top) height above the local surface, 1–100 m, log scale.
 * The readout follows the drag; the horizon is recomputed once on release.
 */
function HeightSlider() {
  const [drag, setDrag] = useState<number | null>(null);
  const h = drag ?? hObs.value;
  const pos = (e: Event) => posToHeight(+(e.target as HTMLInputElement).value);
  return (
    <label
      class="slider-row"
      title="Height of the camera / solar array above the local surface at the site (not above a datum). Logarithmic: fine steps up to 10 m, coarser up to 100 m. Masts gain hours of sunlight at the pole."
    >
      <span>Height above surface</span>
      <input
        type="range"
        min={POS_MIN}
        max={POS_MAX}
        step={POS_STEP}
        list="height-ticks"
        value={heightToPos(h)}
        aria-valuetext={fmtHeight(h)}
        onInput={(e) => setDrag(pos(e))}
        onChange={(e) => {
          hObs.value = pos(e);
          setDrag(null);
        }}
      />
      <datalist id="height-ticks">
        {H_TICKS.map((t) => (
          <option key={t} value={tickPos(t)} label={`${t}`} />
        ))}
      </datalist>
      <output>{fmtHeight(h)}</output>
      <span class="scale-labels" aria-hidden="true">
        {[1, 10, 100].map((t) => (
          <span key={t} style={{ '--p': (heightToPos(t) - POS_MIN) / (POS_MAX - POS_MIN) }}>
            {t === 100 ? '100 m' : t}
          </span>
        ))}
      </span>
    </label>
  );
}

const ORDER: SiteKind[] = ['pgda-5m', 'artemis', 'clps', 'mission', 'reference'];

export function SitePanel() {
  const [q, setQ] = useState('');
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
        {groups.map((g) => (
          <div class="site-group">
            <div class="site-group-title">{KIND_LABEL[g.k]}</div>
            {g.items.map((s) => {
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
        ))}
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
      <HeightSlider />
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
  return (
    <section class="panel scenarios" aria-label="Scenario comparison">
      <div class="panel-title">
        Compare scenarios <span class="muted">({list.length}/{MAX_SCENARIOS})</span>
      </div>
      <button class="btn primary wide" onClick={pinScenario} disabled={list.length >= MAX_SCENARIOS || !site.value}>
        + Pin current site & interval
      </button>
      <label class="slider-row slip" title="Shift every pinned scenario's interval and compare">
        <span>What if it slips?</span>
        <input type="range" min={-30} max={30} step={1} value={slip} onInput={(e) => (slipDays.value = +(e.target as HTMLInputElement).value)} aria-label="Slip in days" />
        <output>
          {slip > 0 ? '+' : ''}
          {slip} d
        </output>
      </label>
      {list.length === 0 && <div class="hint">Pin up to four site/date scenarios to compare them side by side, then drag the slip slider.</div>}
      <div class="cards">
        {list.map((sc, i) => {
          const r = res[sc.id] ?? {};
          const s = resolveSite(sc.site, catalog.value);
          const a = r.base?.metrics;
          const b = r.slipped?.metrics;
          return (
            <article class="card" style={{ '--c': SCENARIO_COLORS[i % 4] } as Record<string, string>}>
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
                  <span class="chip" />
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
