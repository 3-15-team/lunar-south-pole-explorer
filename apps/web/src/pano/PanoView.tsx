// Panorama mode (lazy). Uses the shared store: site, time, observer height, lighting.
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dte, hAnt, hObs, instant, lighting, metricsState, microRelief, mode, services, siteRef, siteResult, time } from '../state/store';
import { customFromXY, refKey } from '../data/sites';
import { config } from '../config';
import { formatLatLon } from '../core/geo';
import { countdownMs } from '../state/countdown';
import { fmtCountdown, fmtDate, fmtDeg, fmtDistance, fmtPct } from '../ui/format';
import { FAST_SPEED, PanoScene, WALK_SPEED } from './scene';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function PanoView() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState('Preparing panorama…');
  const [heading, setHeading] = useState(0);
  const [micro, setMicro] = useState(false);
  const [microMissing, setMicroMissing] = useState(false);
  const [here, setHere] = useState('');
  const [hover, setHover] = useState('');
  const sr = siteResult.value;
  const metricsKey = metricsState.value?.key;
  // A double-click selects the target as the site right away, so its horizon and metrics are
  // computed during the flight. The scene itself (sceneSr) is rebuilt around the new site only
  // once the flight is over and the metrics are in: the rebuild is heavy main-thread work and
  // would otherwise interrupt the animation and hold back the right panel. Site changes from
  // elsewhere (list, map, URL) still rebuild at once.
  const [sceneSr, setSceneSr] = useState(sr);
  const [flying, setFlying] = useState(false);
  const ownMoves = useRef(new Set<string>()); // refKeys of sites selected by our double-clicks
  const adoptingOwn = useRef(false);
  // viewer pose carried across an own-move rebuild, in grid coordinates (frame-independent)
  const carry = useRef<{ heading: [number, number]; pitch: number; grid: [number, number] } | null>(null);

  useEffect(() => {
    if (sr?.key === sceneSr?.key) return;
    const own = !!sr && ownMoves.current.has(refKey(sr.site.ref));
    if (own && (flying || metricsKey !== sr.key)) return; // wait: flight still running / metrics pending
    adoptingOwn.current = own;
    if (own && refKey(sr.site.ref) === refKey(siteRef.peek())) ownMoves.current.clear();
    setSceneSr(sr);
  }, [sr, sceneSr, flying, metricsKey]);

  useEffect(() => {
    const sr = sceneSr;
    const dem = services.dem;
    const eph = services.eph;
    if (!sr || !dem || !eph || !canvas.current || !wrap.current) {
      setMsg(sr ? 'Terrain data not available.' : 'Select a site inside 80°S–90°S first (the horizon is computed per site).');
      return;
    }
    let disposed = false;
    let ready = false; // scene built and showing (its pose is meaningful)
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
    const geoText = (e: number, n: number) => {
      const g = scene.geoAt(e, n);
      return `${formatLatLon(g.lat, g.lon, 3)} · ${Math.round(g.h)} m`;
    };
    let lastHover = 0;
    const onHover = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const hit = scene.groundHit(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      scene.setMarker(scene.flying ? null : hit); // every move, so it sticks to the cursor; hidden in flight
      dirty = true;
      const t = performance.now();
      if (t - lastHover < 60) return; // the text readout is throttled
      lastHover = t;
      setHover(hit ? `${geoText(hit.x, hit.y)} · ${fmtDistance(hit.distanceTo(scene.pos))} away` : '');
    };
    const onLeave = () => {
      setHover('');
      scene.setMarker(null);
      dirty = true;
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return onHover(e);
      scene.setMarker(null); // looking around: the world turns under a still cursor
      scene.yaw -= (e.clientX - drag.x) * 0.003;
      scene.pitch = Math.max(-1.4, Math.min(1.4, scene.pitch + (e.clientY - drag.y) * 0.003));
      drag.x = e.clientX;
      drag.y = e.clientY;
      dirty = true;
    };
    const onUp = () => (drag = null);
    const onDblClick = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const hit = scene.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (!hit) return;
      if (scene.geoAt(hit.x, hit.y).lat > -80) return; // outside the polar DEM: no horizon there
      scene.setMarker(null); // hide before moving; it returns on the next mouse move after the flight
      scene.flyTo(hit, performance.now());
      setFlying(true);
      dirty = true;
      // select the target now so horizon + metrics are computed while we fly
      const [x, y] = scene.toGrid(hit.x, hit.y);
      const ref = customFromXY(x, y);
      ownMoves.current.add(refKey(ref));
      siteRef.value = ref;
    };
    scene.onFlightEnd = () => setFlying(false);
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
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('pointerleave', onLeave);
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
        scene.cancelFlight();
        scene.move(f, s, dt, keys.has('shift'));
        dirty = true;
      } else if (scene.stepFlight(now)) dirty = true;
      if (!dirty || document.hidden) return;
      dirty = false;
      const w = wrap.current?.clientWidth ?? 800;
      const h = wrap.current?.clientHeight ?? 600;
      scene.update(time.peek(), lighting.peek() === 'enhanced' ? 0.05 : 0);
      scene.render(w, h);
      setHeading(scene.state.heading);
      const off = scene.pos.length();
      setHere(`${geoText(scene.pos.x, scene.pos.y)} · ${off < 1 ? 'at the site' : `${fmtDistance(off)} from the site`}`);
    };

    scene
      .build((m) => !disposed && setMsg(m))
      .then(() => {
        if (disposed) return;
        scene.update(time.peek(), 0.035);
        const c = carry.current;
        carry.current = null;
        if (c) {
          // same spot and direction as before the rebuild (camera may have walked off the target)
          scene.pos.copy(scene.fromGrid(c.grid[0], c.grid[1]));
          scene.clampToWalk();
          scene.setGridHeading(c.heading);
          scene.pitch = c.pitch;
        } else scene.lookAtAzimuth(scene.state.sunEl > -3 ? scene.state.sunAz : scene.state.earthAz);
        setMsg('');
        ready = true;
        raf = requestAnimationFrame(loop);
      })
      .catch((e: Error) => setMsg('Panorama failed: ' + e.message));

    return () => {
      if (adoptingOwn.current && ready) {
        carry.current = { heading: scene.gridHeading(), pitch: scene.pitch, grid: scene.toGrid(scene.pos.x, scene.pos.y) };
      }
      adoptingOwn.current = false;
      disposed = true;
      cancelAnimationFrame(raf);
      stops.forEach((d) => d());
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', blur);
      scene.dispose();
    };
  }, [sceneSr?.key]);

  const now = instant.value;
  const m = metricsState.value;
  const t = time.value;
  const sunUp = now ? now.fSun > 0 : false;
  const earthUp = now ? now.fEarth >= dte.value : false;
  return (
    <div class="pano fade-in" ref={wrap}>
      <canvas ref={canvas} tabIndex={0} aria-label="First-person view of the lunar surface. Drag to look around, double-click the ground or a mountain to move there, W A S D to walk, Shift to move fast." />
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
            🜨 el {fmtDeg(now?.earthEl)} · {fmtPct(now?.fEarth)} visible{hAnt.value !== hObs.value ? ` from the ${hAnt.value} m antenna` : ''}
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
      {!msg && (
        <div class="pano-coords">
          <div class="readout">You: {here}</div>
          <div class="readout">{hover ? `Cursor: ${hover}` : 'Move the cursor over the terrain'}</div>
        </div>
      )}
      {msg && <div class="loading">{msg}</div>}
      <div class="pano-help">Drag to look · Double-click to go there · WASD walk {WALK_SPEED} m/s · Shift {FAST_SPEED} m/s · LOLA 5–20 m terrain{micro ? ' + synthetic sub-DEM relief (statistical crater/boulder model, not imagery)' : ', procedural (synthetic) surface texture'}</div>
    </div>
  );
}
