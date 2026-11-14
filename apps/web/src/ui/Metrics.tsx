// Metric tiles (always-visible "time to sunset / Earthset") and the educational panel.
import { audience, dte, instant, metricsState, site, siteError, siteResult, time } from '../state/store';
import { fmtDate, fmtDeg, fmtDuration, fmtHours, fmtPct } from './format';

function Tile(props: { label: string; value: string; sub?: string; tone?: 'sun' | 'earth' | 'warn' | 'good'; hint?: string; big?: boolean }) {
  return (
    <div class={`tile ${props.tone ?? ''} ${props.big ? 'big' : ''}`} title={props.hint}>
      <div class="tile-label">{props.label}</div>
      <div class="tile-value">{props.value}</div>
      {props.sub && <div class="tile-sub">{props.sub}</div>}
    </div>
  );
}

export function MetricTiles() {
  const s = site.value;
  const err = siteError.value;
  const now = instant.value;
  const m = metricsState.value;
  const sr = siteResult.value;
  const t = time.value;
  const planner = audience.value === 'planner';
  if (err) return <div class="notice warn">{err}</div>;
  if (!s || !sr) return <div class="notice">Computing the terrain horizon… (first site loads ~70 DEM tiles)</div>;
  const mm = m?.metrics;
  const sunUp = now ? now.fSun > 0 : false;
  const earthUp = now ? now.fEarth >= dte.value : false;
  const sunNext = m?.sunNext;
  const earthNext = m?.earthNext;
  const sunCount = sunNext ? sunNext.t - t : null;
  const earthCount = earthNext ? earthNext.t - t : null;
  const shadow = now && now.sunEl > 0.05 ? 2 / Math.tan((now.sunEl * Math.PI) / 180) : null;
  return (
    <div class="tiles" aria-live="polite">
      <Tile
        big
        tone={sunUp ? 'sun' : 'warn'}
        label={sunUp ? 'Sunset in' : 'Sunrise in'}
        value={sunNext ? fmtDuration(sunCount) : '> 60 d'}
        sub={sunNext ? fmtDate(sunNext.t) : 'no change within 60 days'}
        hint="Time until the solar disk fully disappears behind (or first appears above) the real terrain horizon."
      />
      <Tile
        big
        tone={earthUp ? 'earth' : 'warn'}
        label={earthUp ? 'Earthset in' : 'Earthrise in'}
        value={earthNext ? fmtDuration(earthCount) : '> 60 d'}
        sub={earthNext ? fmtDate(earthNext.t) : 'no change within 60 days'}
        hint={`Direct-to-Earth comms need ≥ ${Math.round(dte.value * 100)}% of Earth's disk above the horizon.`}
      />
      <Tile
        tone="sun"
        label="Sun now"
        value={now ? `${fmtPct(now.fSun)} visible` : '—'}
        sub={now ? `elevation ${fmtDeg(now.sunEl)} · horizon ${fmtDeg(now.horizonAtSun)}` : ''}
        hint="Fraction of the solar disk above the terrain horizon (partial occlusion is normal at the pole)."
      />
      <Tile
        tone="earth"
        label="Earth now"
        value={now ? `${fmtPct(now.fEarth)} visible` : '—'}
        sub={now ? `elevation ${fmtDeg(now.earthEl)} · az ${now.earthAz.toFixed(0)}°` : ''}
        hint="The Earth hangs almost fixed in the lunar sky; libration makes it wobble by several degrees."
      />
      <Tile tone="sun" label="Illumination (interval)" value={mm ? fmtPct(mm.illumFrac) : '…'} sub={mm ? `${fmtHours(mm.sunlitHours)} of sunlight` : ''} hint="Mean visible solar-disk fraction over the selected interval." />
      <Tile
        tone={mm && mm.longestDarkH > 72 ? 'warn' : 'good'}
        label="Longest darkness"
        value={mm ? fmtHours(mm.longestDarkH) + (mm.longestDarkCensored ? '+' : '') : '…'}
        sub={mm ? `${mm.nSunsets} sunset${mm.nSunsets === 1 ? '' : 's'} in interval` : ''}
        hint="Longest continuous period with < 5% of the Sun visible — the battery/survival driver. '+' = runs past the interval edge."
      />
      <Tile tone="earth" label="Earth visibility (DTE)" value={mm ? fmtPct(mm.earthFrac) : '…'} sub={mm ? `longest gap ${fmtHours(mm.longestNoCommsH)}` : ''} hint="Share of time with direct-to-Earth line of sight." />
      <Tile
        label="Vertical vs flat panel"
        value={mm ? `×${mm.powerRatio >= 100 ? '100+' : mm.powerRatio.toFixed(0)}` : '…'}
        sub={mm ? `vertical ${fmtPct(mm.powerVertical, 1)} · flat ${fmtPct(mm.powerHorizontal, 1)} of 1 AU` : ''}
        hint="Mean output relative to a panel facing the Sun at 1 AU. With the Sun skimming the horizon, flat panels collect almost nothing."
      />
      {planner && (
        <>
          <Tile label="Sun elevation (interval)" value={mm?.sunElStats ? `${fmtDeg(mm.sunElStats.min, 1)} … ${fmtDeg(mm.sunElStats.max, 1)}` : '—'} sub={mm?.sunElStats ? `mean ${fmtDeg(mm.sunElStats.mean)}` : 'never above the horizon'} />
          <Tile label="Earth elevation (interval)" value={mm ? `${fmtDeg(mm.earthElStats.min, 1)} … ${fmtDeg(mm.earthElStats.max, 1)}` : '—'} sub="libration wobble" />
          <Tile label="Shadow of a 2 m mast" value={shadow ? `${shadow >= 1000 ? (shadow / 1000).toFixed(1) + ' km' : Math.round(shadow) + ' m'}` : '∞'} sub="at the current Sun elevation" />
          <Tile label="Site" value={`${fmtDeg(sr.profile.lat, 3)}, ${fmtDeg(sr.profile.lon, 3)}`} sub={`terrain ${Math.round(sr.profile.hTerrain)} m · mast ${sr.profile.hObs} m · DEM ${sr.profile.finestRes} m/px`} />
        </>
      )}
      {planner && mm && mm.dteWindows.length > 0 && (
        <div class="tile wide">
          <div class="tile-label">DTE windows in interval ({mm.dteWindows.length})</div>
          <ul class="windows">
            {mm.dteWindows.slice(0, 6).map(([a, b]) => (
              <li>
                {fmtDate(a)} → {fmtDate(b)} <span class="muted">({fmtDuration(b - a)})</span>
              </li>
            ))}
            {mm.dteWindows.length > 6 && <li class="muted">…</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function EduPanel() {
  const now = instant.value;
  const m = metricsState.value?.metrics;
  const shadow = now && now.sunEl > 0.05 ? 2 / Math.tan((now.sunEl * Math.PI) / 180) : null;
  return (
    <details class="edu" open={audience.value === 'explorer'}>
      <summary>Why the lunar south pole is different</summary>
      <ul>
        <li>
          <b>The Sun skims the horizon.</b> The Moon's axis is tilted only 1.5°, so at the pole the Sun never climbs more than ~1.5° (plus the local slope).
          {now && now.sunEl > -5 && (
            <>
              {' '}
              Right now it is at <b>{fmtDeg(now.sunEl)}</b>
              {shadow ? (
                <>
                  {' '}
                  — a 2 m astronaut casts a <b>{shadow >= 1000 ? (shadow / 1000).toFixed(1) + ' km' : Math.round(shadow) + ' m'}</b> shadow.
                </>
              ) : (
                '.'
              )}
            </>
          )}
        </li>
        <li>
          <b>Mountains decide day and night.</b> A ridge 50 km away can hide the Sun for days. That is why we ray-trace the real LOLA terrain out to 300 km.
        </li>
        <li>
          <b>Solar panels stand upright.</b> {m ? <>Here a vertical panel collects ×{m.powerRatio >= 100 ? '100+' : m.powerRatio.toFixed(0)} more than a flat one.</> : 'A flat panel sees almost no light.'}
        </li>
        <li>
          <b>Earth wobbles, it does not set (much).</b> The Earth stays near the same spot in the lunar sky; libration moves it by ±7°, enough to dip behind nearby hills — and cut direct-to-Earth radio.
        </li>
        <li>
          <b>A lunar day lasts 29.5 Earth days.</b> At the pole the Sun circles the horizon once per lunar day instead of rising and setting.
        </li>
      </ul>
    </details>
  );
}

type Grade = 'good' | 'fair' | 'poor';
const grade = (v: number, good: number, fair: number, higherBetter = true): Grade =>
  higherBetter ? (v >= good ? 'good' : v >= fair ? 'fair' : 'poor') : v <= good ? 'good' : v <= fair ? 'fair' : 'poor';

/** One-glance verdict for the selected site and interval (the "first 5 seconds"). */
export function Verdict() {
  const m = metricsState.value?.metrics;
  const s = site.value;
  if (!m || !s) return null;
  const gi = grade(m.illumFrac, 0.7, 0.4);
  const gd = grade(m.longestDarkH, 24, 72, false);
  const ge = grade(m.earthFrac, 0.5, 0.2);
  const order: Record<Grade, number> = { good: 0, fair: 1, poor: 2 };
  const worst = [gi, gd, ge].reduce((a, b) => (order[b] > order[a] ? b : a));
  const headline = worst === 'good' ? 'Viable window' : worst === 'fair' ? 'Marginal window' : 'Risky window';
  return (
    <div class={`verdict-box ${worst}`} role="status">
      <div class="verdict-head">{headline}</div>
      <div class="verdict-chips">
        <span class={`vchip ${gi}`}>☀ {fmtPct(m.illumFrac)} sunlight</span>
        <span class={`vchip ${gd}`}>☾ longest night {fmtHours(m.longestDarkH)}</span>
        <span class={`vchip ${ge}`}>🜨 Earth {fmtPct(m.earthFrac)}</span>
      </div>
    </div>
  );
}
