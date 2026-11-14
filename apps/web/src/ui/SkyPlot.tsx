// Sky plot: terrain horizon silhouette (+1σ band), Sun & Earth tracks over the
// interval, current discs, plus true-aspect close-ups of each disc against the ridge.
import { useEffect, useRef, useState } from 'preact/hooks';
import { profileAt } from '../core/horizon';
import { instant, metricsState, siteResult } from '../state/store';
import { fmtDeg, fmtDistance, fmtPct } from './format';

const SUN = '#FFD45E';
const EARTH = '#6FB7FF';
const GROUND = '#3a3d42';
const GROUND_EDGE = '#9aa3ad';

function setupCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

export function SkyPlot() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ az: number; el: number; px: number } | null>(null);
  const sr = siteResult.value;
  const m = metricsState.value;
  const now = instant.value;

  // y-range from content
  let hi = 6;
  if (sr) for (let i = 0; i < sr.profile.naz; i += 4) hi = Math.max(hi, sr.profile.elev[i] + 1.5);
  if (m) {
    hi = Math.max(hi, m.metrics.earthElStats.max + 1.5);
    if (m.metrics.sunElStats) hi = Math.max(hi, m.metrics.sunElStats.max + 1);
  }
  hi = Math.min(hi, 35);
  const lo = -3;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = setupCanvas(c);
    const W = c.clientWidth;
    const H = c.clientHeight;
    const L = 30;
    const R = 6;
    const T = 8;
    const B = 22;
    const pw = W - L - R;
    const ph = H - T - B;
    const X = (az: number) => L + (az / 360) * pw;
    const Y = (el: number) => T + ((hi - el) / (hi - lo)) * ph;
    g.clearRect(0, 0, W, H);
    const sky = g.createLinearGradient(0, T, 0, T + ph);
    sky.addColorStop(0, '#05070d');
    sky.addColorStop(1, '#141a2a');
    g.fillStyle = sky;
    g.fillRect(L, T, pw, ph);
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.fillStyle = '#8b95a3';
    g.font = '10px system-ui, sans-serif';
    g.lineWidth = 1;
    const stepEl = hi - lo > 20 ? 5 : hi - lo > 10 ? 2 : 1;
    for (let e = Math.ceil(lo / stepEl) * stepEl; e <= hi; e += stepEl) {
      g.beginPath();
      g.moveTo(L, Y(e) + 0.5);
      g.lineTo(L + pw, Y(e) + 0.5);
      g.stroke();
      g.fillText(`${e}°`, 2, Y(e) + 3);
    }
    ['N', 'E', 'S', 'W', 'N'].forEach((lab, i) => {
      const x = X(i * 90);
      g.beginPath();
      g.moveTo(x + 0.5, T);
      g.lineTo(x + 0.5, T + ph);
      g.stroke();
      g.fillText(lab, x - 3, H - 6);
    });
    // zero line (astronomical horizon)
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(L, Y(0));
    g.lineTo(L + pw, Y(0));
    g.stroke();
    g.setLineDash([]);
    if (sr) {
      const p = sr.profile;
      // uncertainty band
      if (p.sigma) {
        g.fillStyle = 'rgba(154,163,173,0.25)';
        g.beginPath();
        for (let i = 0; i <= pw; i++) {
          const az = (i / pw) * 360;
          g.lineTo(L + i, Y(profileAt(p.elev, az) + profileAt(p.sigma, az)));
        }
        for (let i = pw; i >= 0; i--) {
          const az = (i / pw) * 360;
          g.lineTo(L + i, Y(profileAt(p.elev, az) - profileAt(p.sigma, az)));
        }
        g.closePath();
        g.fill();
      }
      // terrain silhouette (max over the pixel's azimuth span keeps narrow peaks)
      g.fillStyle = GROUND;
      g.strokeStyle = GROUND_EDGE;
      g.beginPath();
      g.moveTo(L, T + ph);
      const per = p.naz / pw;
      for (let i = 0; i <= pw; i++) {
        let v = -90;
        const a = Math.floor(i * per);
        for (let k = a; k <= a + Math.ceil(per); k++) v = Math.max(v, p.elev[k % p.naz]);
        g.lineTo(L + i, Math.min(T + ph, Y(v)));
      }
      g.lineTo(L + pw, T + ph);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // tracks
    const track = (az: Float32Array, el: Float32Array, f: Float32Array | null, color: string, dimColor: string) => {
      g.lineWidth = 2;
      for (let i = 1; i < az.length; i++) {
        if (Math.abs(az[i] - az[i - 1]) > 180) continue;
        g.strokeStyle = f && f[i] <= 0 ? dimColor : color;
        g.beginPath();
        g.moveTo(X(az[i - 1]), Y(el[i - 1]));
        g.lineTo(X(az[i]), Y(el[i]));
        g.stroke();
      }
    };
    if (m) {
      track(m.plot.earthAz, m.plot.earthEl, m.plot.fEarth, 'rgba(111,183,255,0.75)', 'rgba(111,183,255,0.25)');
      track(m.plot.sunAz, m.plot.sunEl, m.plot.fSun, 'rgba(255,212,94,0.85)', 'rgba(255,212,94,0.25)');
    }
    // current discs
    const disc = (az: number, el: number, r: number, color: string, label: string) => {
      const ry = Math.max(4, (r / (hi - lo)) * ph);
      g.fillStyle = color;
      g.strokeStyle = '#000';
      g.beginPath();
      g.arc(X(az), Y(el), ry, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#e8edf3';
      g.fillText(label, X(az) + ry + 3, Y(el) - ry);
    };
    if (now) {
      disc(now.earthAz, now.earthEl, now.earthR, EARTH, 'Earth');
      disc(now.sunAz, now.sunEl, now.sunR, SUN, 'Sun');
    }
    if (hover) {
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.beginPath();
      g.moveTo(hover.px + 0.5, T);
      g.lineTo(hover.px + 0.5, T + ph);
      g.stroke();
    }
  }, [sr, m, now, hi, hover]);

  const onMove = (e: MouseEvent) => {
    const c = ref.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const px = e.clientX - r.left;
    const pw = c.clientWidth - 36;
    const az = ((px - 30) / pw) * 360;
    if (az < 0 || az > 360) return setHover(null);
    setHover({ az, el: 0, px });
  };

  const p = sr?.profile;
  return (
    <div class="skyplot">
      <div class="panel-title">
        Sky from the site <span class="muted">azimuth × elevation · terrain horizon from LOLA</span>
      </div>
      <canvas
        ref={ref}
        class="sky-canvas"
        role="img"
        aria-label="Sky plot: terrain horizon silhouette with the Sun and Earth tracks over the selected interval"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      <div class="sky-readout" aria-live="polite">
        {hover && p ? (
          <span>
            Az {hover.az.toFixed(1)}°: horizon {fmtDeg(profileAt(p.elev, hover.az))}
            {p.sigma ? ` ±${profileAt(p.sigma, hover.az).toFixed(2)}°` : ''} · ridge {fmtDistance(p.dist[Math.round((hover.az / 360) * p.naz) % p.naz])} away
          </span>
        ) : now ? (
          <span>
            <b class="c-sun">Sun</b> az {now.sunAz.toFixed(1)}° el {fmtDeg(now.sunEl)} · {fmtPct(now.fSun)} of disk visible ·{' '}
            <b class="c-earth">Earth</b> el {fmtDeg(now.earthEl)} · {fmtPct(now.fEarth)}
          </span>
        ) : (
          <span class="muted">Select a site inside 80°S–90°S to compute its horizon.</span>
        )}
      </div>
      <div class="closeups">
        <CloseUp body="sun" />
        <CloseUp body="earth" />
      </div>
    </div>
  );
}

/** True-aspect close-up of a disc against the local horizon (±2.5° window). */
function CloseUp({ body }: { body: 'sun' | 'earth' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sr = siteResult.value;
  const now = instant.value;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = setupCanvas(c);
    const W = c.clientWidth;
    const H = c.clientHeight;
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, W, H);
    if (!sr || !now) return;
    const az = body === 'sun' ? now.sunAz : now.earthAz;
    const el = body === 'sun' ? now.sunEl : now.earthEl;
    const r = body === 'sun' ? now.sunR : now.earthR;
    const half = Math.max(1.2, r * 3.5); // degrees shown vertically from the centre
    const s = H / (2 * half); // px per degree (same on both axes on the sky)
    const cosEl = Math.cos((el * Math.PI) / 180);
    const Y = (e: number) => H / 2 - (e - el) * s;
    // disc
    g.fillStyle = body === 'sun' ? SUN : EARTH;
    g.beginPath();
    g.arc(W / 2, H / 2, r * s, 0, Math.PI * 2);
    g.fill();
    // terrain in front (drawn after → occludes)
    g.fillStyle = GROUND;
    g.strokeStyle = GROUND_EDGE;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x++) {
      const dAz = (x - W / 2) / s / Math.max(cosEl, 0.05);
      g.lineTo(x, Y(profileAt(sr.profile.elev, az + dAz)));
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#e8edf3';
    g.font = '10px system-ui, sans-serif';
    g.fillText(`${body === 'sun' ? 'Sun' : 'Earth'} ${fmtPct(body === 'sun' ? now.fSun : now.fEarth)}`, 4, 12);
    // scale bar = 1°
    g.fillRect(W - 4 - s, H - 6, s, 2);
    g.fillText('1°', W - 4 - s, H - 9);
  }, [sr, now, body]);
  return <canvas ref={ref} class="closeup" role="img" aria-label={`${body} disc close-up against the terrain horizon`} />;
}
