// Earth link vs antenna height at the selected site (core/antenna.ts): the antenna height needed
// over the interval (time series) and its distribution (share of the interval with a link vs
// height), with the current antenna marked. Heights above ANT_CAP_M are reported as "no link".
import { useEffect, useRef } from 'preact/hooks';
import { linkShare, neededAt, neededForShare, type AntennaSeries } from '../core/antenna';
import { dte, hAnt, metricsState, siteResult, time } from '../state/store';
import { fmtDate, fmtPct } from './format';

const EARTH = '#6FB7FF';
const ANT = '#FFD45E';
const GRID = 'rgba(255,255,255,0.08)';
const LABEL = '#8b95a3';

export function fmtNeed(h: number | null, cap: number): string {
  if (h === null || !Number.isFinite(h) || h > cap) return `no link ≤ ${cap >= 1000 ? cap / 1000 + ' km' : cap + ' m'}`;
  if (h <= 1) return '≤ 1 m';
  return h < 10 ? `${h.toFixed(1)} m` : `${Math.round(h)} m`;
}

function setup(c: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = c.clientWidth;
  const H = c.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.font = '10px system-ui, sans-serif';
  return { g, W, H };
}

const L = 34;
const R = 8;
const T = 8;
const B = 18;
const DECADES = [1, 10, 100, 1000];
const logPos = (h: number, cap: number) => Math.log10(Math.min(cap, Math.max(1, h))) / Math.log10(cap);

/** Needed height over time (log y), "no link" band on top, antenna line, playhead. */
function drawSeries(c: HTMLCanvasElement, a: AntennaSeries, ant: number, t: number) {
  const { g, W, H } = setup(c);
  const pw = W - L - R;
  const ph = H - T - B;
  const t0 = a.t[0];
  const t1 = a.t[a.t.length - 1];
  const X = (x: number) => L + ((x - t0) / Math.max(1, t1 - t0)) * pw;
  const NO = T + 4; // "no link" lane, above the 1 km line
  const Y = (h: number) => T + 18 + (1 - logPos(h, a.capM)) * (ph - 18);
  g.fillStyle = '#0b0f16';
  g.fillRect(L, T, pw, ph);
  g.strokeStyle = GRID;
  g.fillStyle = LABEL;
  for (const d of DECADES) {
    g.beginPath();
    g.moveTo(L, Y(d) + 0.5);
    g.lineTo(L + pw, Y(d) + 0.5);
    g.stroke();
    g.fillText(d >= 1000 ? '1 km' : `${d} m`, 2, Y(d) + 3);
  }
  g.fillStyle = 'rgba(255,107,107,0.9)';
  g.fillText('none', 2, NO + 4);
  // needed height; Infinity → drawn in the "no link" lane
  g.lineWidth = 1.6;
  for (let i = 1; i < a.t.length; i++) {
    const v0 = a.need[i - 1];
    const v1 = a.need[i];
    const inf0 = !Number.isFinite(v0);
    const inf1 = !Number.isFinite(v1);
    g.strokeStyle = inf0 && inf1 ? 'rgba(255,107,107,0.9)' : EARTH;
    g.beginPath();
    g.moveTo(X(a.t[i - 1]), inf0 ? NO : Y(v0));
    g.lineTo(X(a.t[i]), inf1 ? NO : Y(v1));
    g.stroke();
  }
  // antenna height
  g.strokeStyle = ANT;
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(L, Y(ant));
  g.lineTo(L + pw, Y(ant));
  g.stroke();
  g.setLineDash([]);
  // playhead
  if (t >= t0 && t <= t1) {
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.moveTo(X(t) + 0.5, T);
    g.lineTo(X(t) + 0.5, T + ph);
    g.stroke();
  }
  g.fillStyle = LABEL;
  g.fillText(fmtDate(t0).slice(0, 10), L, H - 5);
  const end = fmtDate(t1).slice(0, 10);
  g.fillText(end, L + pw - g.measureText(end).width, H - 5);
}

/** Share of the interval with a link vs antenna height (log x), current antenna marked. */
function drawCdf(c: HTMLCanvasElement, a: AntennaSeries, ant: number) {
  const { g, W, H } = setup(c);
  const pw = W - L - R;
  const ph = H - T - B;
  const X = (h: number) => L + logPos(h, a.capM) * pw;
  const Y = (f: number) => T + (1 - f) * ph;
  g.fillStyle = '#0b0f16';
  g.fillRect(L, T, pw, ph);
  g.strokeStyle = GRID;
  g.fillStyle = LABEL;
  for (const f of [0, 0.5, 1]) {
    g.beginPath();
    g.moveTo(L, Y(f) + 0.5);
    g.lineTo(L + pw, Y(f) + 0.5);
    g.stroke();
    g.fillText(`${f * 100}%`, 2, Y(f) + 3);
  }
  for (const d of DECADES) {
    g.beginPath();
    g.moveTo(X(d) + 0.5, T);
    g.lineTo(X(d) + 0.5, T + ph);
    g.stroke();
    const s = d >= 1000 ? '1 km' : `${d} m`;
    g.fillText(s, Math.min(W - R - g.measureText(s).width, Math.max(L, X(d) - g.measureText(s).width / 2)), H - 5);
  }
  // empirical CDF of the needed height (step curve)
  const s = Float64Array.from(a.need).sort();
  const n = s.length;
  g.strokeStyle = EARTH;
  g.lineWidth = 1.8;
  g.beginPath();
  let f = linkShare(s, 1); // already linked from the lowest antenna
  g.moveTo(X(1), Y(f));
  for (let i = 0; i < n; i++) {
    if (s[i] <= 1) continue;
    if (!Number.isFinite(s[i]) || s[i] > a.capM) break;
    const fx = X(s[i]);
    g.lineTo(fx, Y(f));
    f = (i + 1) / n;
    g.lineTo(fx, Y(f));
  }
  g.lineTo(X(a.capM), Y(f));
  g.stroke();
  // antenna marker
  const fa = linkShare(s, ant);
  g.strokeStyle = ANT;
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(X(ant) + 0.5, T);
  g.lineTo(X(ant) + 0.5, T + ph);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = ANT;
  g.beginPath();
  g.arc(X(ant), Y(fa), 3.5, 0, Math.PI * 2);
  g.fill();
}

export function AntennaPanel() {
  const ms = metricsState.value;
  const sr = siteResult.value;
  const a = ms && sr && ms.key === sr.key ? ms.antenna : null;
  const ant = hAnt.value;
  const t = time.value;
  const seriesRef = useRef<HTMLCanvasElement>(null);
  const cdfRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!a) return;
    if (seriesRef.current) drawSeries(seriesRef.current, a, ant, t);
    if (cdfRef.current) drawCdf(cdfRef.current, a, ant);
  }, [a, ant, t]);
  if (!sr) return null;
  if (!a) return <div class="antenna panel-block muted">Earth link vs antenna height: computing…</div>;
  const now = neededAt(a, t);
  const share = linkShare(a.need, ant);
  const qs = [0.5, 0.9, 1].map((q) => ({ q, h: neededForShare(a.need, q) }));
  const neverPct = 1 - linkShare(a.need, a.capM);
  return (
    <section class="antenna panel-block" aria-label="Earth link versus antenna height">
      <div class="panel-title">
        Earth link vs antenna height <span class="muted">≥ {Math.round(dte.value * 100)}% of the disk · cap {a.capM / 1000} km</span>
      </div>
      <div class="ant-now">
        {now === null ? (
          <span class="muted">Move the playhead into the interval for the height needed now.</span>
        ) : (
          <span>
            Needed now: <b class={Number.isFinite(now) ? 'c-earth' : 'c-warn'}>{fmtNeed(now, a.capM)}</b>
            {Number.isFinite(now) && now > 1 && <span class="muted"> above the surface</span>}
          </span>
        )}
        <span class="muted">
          {' '}
          · your {ant < 10 ? ant.toFixed(1) : Math.round(ant)} m antenna: <b class="c-ant">{fmtPct(share)}</b> of the interval
        </span>
      </div>
      <canvas ref={seriesRef} class="ant-canvas" role="img" aria-label="Antenna height needed for an Earth link over the interval (log scale)" />
      <canvas ref={cdfRef} class="ant-canvas" role="img" aria-label="Share of the interval with an Earth link versus antenna height" />
      <table class="ant-q">
        <tbody>
          {qs.map(({ q, h }) => (
            <tr key={q}>
              <td>Link {q === 1 ? 'all' : `${Math.round(q * 100)}%`} of the time</td>
              <td class={h === null ? 'c-warn' : ''}>{h === null ? fmtNeed(null, a.capM) : h <= 1 ? 'any (≤ 1 m)' : `≥ ${fmtNeed(h, a.capM)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {neverPct > 0 && (
        <div class="hint">
          {fmtPct(neverPct)} of the interval has no link even from {a.capM / 1000} km: the Earth is below the horizon there (libration) or
          hidden by terrain an antenna cannot clear.
        </div>
      )}
    </section>
  );
}
