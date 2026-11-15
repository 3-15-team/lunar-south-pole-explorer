// Sky plot: terrain horizon silhouette (+1σ band), Sun & Earth tracks over the
// interval, current discs, plus true-aspect close-ups of each disc against the ridge.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { makeSiteFrame } from '../core/ephemeris';
import { profileAt } from '../core/horizon';
import { evalAt, HOUR } from '../core/metrics';
import { instant, metricsState, services, siteResult, time } from '../state/store';
import { fmtDeg, fmtDistance, fmtPct } from './format';
import { skyElRange } from './skyRange';

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

/** Tracks drawn around the playhead when the interval tracks don't contain it (± this span). */
const LOCAL_SPAN = 36 * HOUR;
const LOCAL_STEP = 15 * 60e3;

interface Tracks {
  sunAz: Float32Array;
  sunEl: Float32Array;
  fSun: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
  fEarth: Float32Array;
}

export function SkyPlot() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ az: number; el: number; px: number } | null>(null);
  const [ephTick, setEphTick] = useState(0);
  const sr = siteResult.value;
  const m0 = metricsState.value;
  const now = instant.value;
  const t = time.value;

  // Interval tracks only if they belong to the current site/mast (metrics lag a site change)
  const m = m0 && sr && m0.key === sr.key ? m0 : null;
  const n = m ? m.plot.t.length : 0;
  const inside = !!m && n > 0 && t >= m.plot.t[0] && t <= m.plot.t[n - 1];
  // Playhead outside the interval (or interval tracks not ready): the discs would float off the
  // drawn curves, so recompute the tracks locally around the playhead (main thread, ~290 evals,
  // refreshed per hour of playhead motion).
  const bucket = Math.round(t / HOUR);
  const local = useMemo<Tracks | null>(() => {
    const eph = services.eph;
    if (!sr || inside || !eph) return null;
    const a = eph.clamp(bucket * HOUR - LOCAL_SPAN);
    const b = eph.clamp(bucket * HOUR + LOCAL_SPAN);
    if (!eph.isLoaded(a) || !eph.isLoaded(b + eph.stepMs)) {
      eph.ensureRange(a, b).then(() => setEphTick((k) => k + 1)).catch(() => {});
      return null;
    }
    const ctx = { frame: makeSiteFrame(sr.profile.lat, sr.profile.lon, sr.profile.hTerrain, sr.profile.hObs), profile: sr.profile, eph };
    const k = Math.max(2, Math.floor((b - a) / LOCAL_STEP) + 1);
    const tr: Tracks = {
      sunAz: new Float32Array(k), sunEl: new Float32Array(k), fSun: new Float32Array(k),
      earthAz: new Float32Array(k), earthEl: new Float32Array(k), fEarth: new Float32Array(k),
    };
    for (let i = 0; i < k; i++) {
      const x = evalAt(ctx, a + ((b - a) * i) / (k - 1));
      tr.sunAz[i] = x.sunAz;
      tr.sunEl[i] = x.sunEl;
      tr.fSun[i] = x.fSun;
      tr.earthAz[i] = x.earthAz;
      tr.earthEl[i] = x.earthEl;
      tr.fEarth[i] = x.fEarth;
    }
    return tr;
  }, [sr, inside, bucket, ephTick]);

  // y-range from content: nothing drawn may be clipped (horizon, tracks, current discs)
  const trackEls = [m?.plot.sunEl, m?.plot.earthEl, local?.sunEl, local?.earthEl].filter((a): a is Float32Array => !!a);
  const [lo, hi] = skyElRange(sr ? sr.profile.elev : null, trackEls, now ? [[now.sunEl, now.sunR], [now.earthEl, now.earthR]] : []);

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
    if (local) {
      // playhead outside the interval: ±36 h around it, dashed (not part of the analysed interval)
      g.setLineDash([4, 3]);
      track(local.earthAz, local.earthEl, local.fEarth, 'rgba(111,183,255,0.75)', 'rgba(111,183,255,0.25)');
      track(local.sunAz, local.sunEl, local.fSun, 'rgba(255,212,94,0.85)', 'rgba(255,212,94,0.25)');
      g.setLineDash([]);
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
      const tw = g.measureText(label).width;
      const lx = X(az) + ry + 3 + tw > L + pw ? X(az) - ry - 3 - tw : X(az) + ry + 3; // keep inside the plot
      g.fillText(label, lx, Math.max(T + 9, Y(el) - ry));
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
  }, [sr, m, local, now, lo, hi, hover]);

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
      {local && (
        <div class="sky-note muted">Playhead outside the interval: dashed tracks show ±36 h around it.</div>
      )}
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
