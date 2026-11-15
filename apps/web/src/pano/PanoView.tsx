// Panorama mode (lazy). Uses the shared store: site, time, observer height, lighting.
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dte, hObs, instant, lighting, metricsState, microRelief, mode, services, siteResult, time } from '../state/store';
import { config } from '../config';
import { countdownMs } from '../state/countdown';
import { fmtCountdown, fmtDate, fmtDeg, fmtPct } from '../ui/format';
import { PanoScene } from './scene';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function PanoView() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState('Preparing panorama…');
  const [heading, setHeading] = useState(0);
  const [micro, setMicro] = useState(false);
  const [microMissing, setMicroMissing] = useState(false);
  const sr = siteResult.value;

  useEffect(() => {
    const dem = services.dem;
    const eph = services.eph;
    if (!sr || !dem || !eph || !canvas.current || !wrap.current) {
      setMsg(sr ? 'Terrain data not available.' : 'Select a site inside 80°S–90°S first (the horizon is computed per site).');
      return;
    }
    let disposed = false;
    let raf = 0;
    const p = sr.profile;
    const scene = new PanoScene(canvas.current, dem, eph, { x: sr.site.x, y: sr.site.y, lat: p.lat, lon: p.lon, hTerrain: p.hTerrain }, p);
    scene.eyeHeight = hObs.peek();
    const keys = new Set<string>();
    let dirty = true;
    let drag: { id: number; x: number; y: number } | null = null;
    const el = canvas.current;
    const onDown = (e: PointerEvent) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.focus();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      scene.yaw -= (e.clientX - drag.x) * 0.003;
      scene.pitch = Math.max(-1.4, Math.min(1.4, scene.pitch + (e.clientY - drag.y) * 0.003));
      drag.x = e.clientX;
      drag.y = e.clientY;
      dirty = true;
    };
    const onUp = () => (drag = null);
    const KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)) return;
      const k = e.key.toLowerCase();
      if (!KEYS.includes(k)) return;
      if (e.type === 'keydown') {
        keys.add(k);
        e.preventDefault();
      } else keys.delete(k);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const blur = () => keys.clear();
    window.addEventListener('blur', blur);
    const ro = new ResizeObserver(() => (dirty = true));
    ro.observe(wrap.current);

    const stops = [
      effect(() => {
        time.value;
        lighting.value;
        scene.eyeHeight = hObs.value;
        dirty = true;
      }),
      effect(() => {
        const want = microRelief.value;
        scene.setMicro(want).then((active) => {
          if (disposed) return;
          setMicro(active);
          setMicroMissing(want && !active && config.panoMicro > 0);
          dirty = true;
        });
      }),
    ];

    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const f = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
      const s = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      if (f || s) {
        scene.move(f, s, dt, keys.has('shift'));
        dirty = true;
      }
      if (!dirty || document.hidden) return;
      dirty = false;
      const w = wrap.current?.clientWidth ?? 800;
      const h = wrap.current?.clientHeight ?? 600;
      scene.update(time.peek(), lighting.peek() === 'enhanced' ? 0.05 : 0);
      scene.render(w, h);
      setHeading(scene.state.heading);
    };

    scene
      .build((m) => !disposed && setMsg(m))
      .then(() => {
        if (disposed) return;
        scene.update(time.peek(), 0.035);
        scene.lookAtAzimuth(scene.state.sunEl > -3 ? scene.state.sunAz : scene.state.earthAz);
        setMsg('');
        raf = requestAnimationFrame(loop);
      })
      .catch((e: Error) => setMsg('Panorama failed: ' + e.message));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      stops.forEach((d) => d());
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', blur);
      scene.dispose();
    };
  }, [sr?.key]);

  const now = instant.value;
  const m = metricsState.value;
  const t = time.value;
  const sunUp = now ? now.fSun > 0 : false;
  const earthUp = now ? now.fEarth >= dte.value : false;
  return (
    <div class="pano fade-in" ref={wrap}>
      <canvas ref={canvas} tabIndex={0} aria-label="First-person view of the lunar surface. Drag to look around, W A S D to walk, Shift to move fast." />
      <div class="compass" aria-hidden="true">
        {COMPASS[Math.round(heading / 45) % 8]} {Math.round(heading)}°
      </div>
      <div class="pano-hud">
        <div class="hud-box">
          <div class="hud-big">{m?.sunNext ? `${sunUp ? 'Sunset' : 'Sunrise'} in ${fmtCountdown(countdownMs(m, m.sunNext, t))}` : sunUp ? 'Sun up for 60+ d' : 'No Sun for 60+ d'}</div>
          <div>
            ☀ el {fmtDeg(now?.sunEl)} · {fmtPct(now?.fSun)} of disk
          </div>
        </div>
        <div class="hud-box">
          <div class="hud-big">{m?.earthNext ? `${earthUp ? 'Earthset' : 'Earthrise'} in ${fmtCountdown(countdownMs(m, m.earthNext, t))}` : earthUp ? 'Earth up for 60+ d' : 'No Earth for 60+ d'}</div>
          <div>
            🜨 el {fmtDeg(now?.earthEl)} · {fmtPct(now?.fEarth)} visible
          </div>
        </div>
        <div class="hud-box muted">{fmtDate(t)}</div>
      </div>
      <div class="pano-tools">
        <div class="seg small">
          <button class={lighting.value === 'enhanced' ? 'on' : ''} onClick={() => (lighting.value = 'enhanced')}>
            Enhanced
          </button>
          <button class={lighting.value === 'realistic' ? 'on' : ''} onClick={() => (lighting.value = 'realistic')}>
            Realistic
          </button>
        </div>
        {config.panoMicro > 0 && (
          <button
            class={'btn small' + (microRelief.value && !microMissing ? ' on' : '')}
            aria-pressed={microRelief.value && !microMissing}
            disabled={microMissing}
            title={
              microMissing
                ? 'Micro-relief tiles are not built (make data-micro)'
                : 'Synthetic sub-DEM relief: craters and rocks drawn from published size distributions, lit by the real Sun (not imagery)'
            }
            onClick={() => (microRelief.value = !microRelief.value)}
          >
            Micro-relief {microRelief.value && !microMissing ? 'on' : 'off'}
          </button>
        )}
        <button class="btn small" onClick={() => (mode.value = 'map')}>
          ← Map
        </button>
      </div>
      {msg && <div class="loading">{msg}</div>}
      <div class="pano-help">Drag to look · WASD walk 1.4 m/s · Shift 25 m/s · LOLA 5–20 m terrain{micro ? ' + synthetic sub-DEM relief (statistical crater/boulder model, not imagery)' : ', procedural (synthetic) surface texture'}</div>
    </div>
  );
}
