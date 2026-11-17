// Timeline: playhead + interval handles, Sun/Earth availability strips, day and
// lunar-day ("local noon") ticks, play/pause animation over the lunar day.
import { useEffect, useRef } from 'preact/hooks';
import { DAY, HOUR, ephRange, interval, metricsState, playSpeed, playing, setInterval_, site, siteResult, time } from '../state/store';
import { fmtDate, fmtDuration, fmtShortDate, fromInputValue, toInputValue } from './format';

const SPEEDS = [
  { v: 1, label: '1 h/s' },
  { v: 6, label: '6 h/s' },
  { v: 24, label: '1 d/s' },
  { v: 72, label: '3 d/s' },
];

const QUICK = [
  { label: '14 d', ms: 14 * DAY },
  { label: '1 lunar day', ms: 29.530589 * DAY },
  { label: '90 d', ms: 90 * DAY },
  { label: '1 yr', ms: 365.25 * DAY },
];

/** Double-click anywhere in a Time / From / To block opens that field's native date picker. */
function openPicker(e: MouseEvent) {
  showPicker((e.currentTarget as HTMLElement).querySelector('input'));
}

function showPicker(input: HTMLInputElement | null | undefined) {
  try {
    input?.showPicker();
  } catch {
    input?.focus(); // no showPicker (old browser) or not allowed: at least focus the field
  }
}

function clampEph(t: number): number {
  const r = ephRange.value;
  return r ? Math.min(Math.max(t, r[0]), r[1] - DAY) : t;
}

export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frozen = useRef<[number, number] | null>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  // double-click on an interval handle opens the From / To picker (not the track's "move playhead")
  const handlePicker = (input: { current: HTMLInputElement | null }) => (e: MouseEvent) => {
    e.stopPropagation();
    showPicker(input.current);
  };
  const [t0, t1] = interval.value;
  const t = time.value;
  const span = t1 - t0;
  const pad = Math.max(span * 0.15, DAY);
  const win: [number, number] = frozen.current ?? [Math.min(t0, t) - pad, Math.max(t1, t) + pad];
  const frac = (x: number) => (x - win[0]) / (win[1] - win[0]);
  // strips belong to one site: while the horizon / metrics of a newly picked point are computing, show none
  // instead of the previous point's Sun/Earth availability
  const ms0 = metricsState.value;
  const sr0 = siteResult.value;
  const m = ms0 && sr0 && ms0.key === sr0.key && sr0.site === site.value ? ms0 : null;

  // play loop
  useEffect(() => {
    if (!playing.value) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const [a, b] = interval.peek();
      let nt = time.peek() + playSpeed.peek() * HOUR * dt;
      if (nt > b) nt = a;
      time.value = nt;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing.value]);

  // strips + ticks
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const X = (x: number) => frac(x) * W;
    const sunY = 16;
    const earthY = 30;
    const sh = 12;
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, sunY, W, sh);
    g.fillRect(0, earthY, W, sh);
    if (m && m.plot.t.length > 1) {
      const n = m.plot.t.length;
      for (let i = 0; i < n - 1; i++) {
        const xa = X(m.plot.t[i]);
        const xb = Math.max(xa + 0.6, X(m.plot.t[i + 1]));
        const fs = m.plot.fSun[i];
        if (fs > 0) {
          g.fillStyle = `rgba(255,212,94,${0.25 + 0.75 * fs})`;
          g.fillRect(xa, sunY, xb - xa, sh);
        }
        if (m.plot.fEarth[i] >= 0.5) {
          g.fillStyle = `rgba(111,183,255,${0.35 + 0.65 * m.plot.fEarth[i]})`;
          g.fillRect(xa, earthY, xb - xa, sh);
        }
      }
      // local noon markers (lunar day)
      g.fillStyle = '#ffd45e';
      g.font = '9px system-ui, sans-serif';
      for (const nt of m.noons) {
        if (nt < win[0] || nt > win[1]) continue;
        const x = X(nt);
        g.fillRect(x - 0.5, 2, 1, 10);
        g.fillText('☀ noon', x + 2, 10);
      }
    }
    // day ticks + labels
    const days = (win[1] - win[0]) / DAY;
    const every = days > 400 ? 30 : days > 120 ? 7 : days > 40 ? 2 : 1;
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '10px system-ui, sans-serif';
    let lastLabelX = -1e9;
    for (let d = Math.ceil(win[0] / DAY) * DAY; d <= win[1]; d += DAY) {
      const di = Math.round(d / DAY);
      if (di % every) continue;
      const x = X(d);
      g.fillRect(x, 44, 1, 5);
      if (x - lastLabelX > 46) {
        g.fillText(fmtShortDate(d), x + 2, 58);
        lastLabelX = x;
      }
    }
    g.fillStyle = '#9aa5b1';
    g.fillText('Sun', 2, sunY + 10);
    g.fillText('Earth', 2, earthY + 10);
  }, [m, win[0], win[1]]);

  const tAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return clampEph(win[0] + f * (win[1] - win[0]));
  };

  const drag = (kind: 'time' | 'start' | 'end' | 'range') => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    frozen.current = win;
    const startX = tAt(e.clientX);
    const [a0, b0] = interval.peek();
    if (kind === 'time') time.value = startX;
    const move = (ev: PointerEvent) => {
      const x = tAt(ev.clientX);
      if (kind === 'time') time.value = x;
      else if (kind === 'start') setInterval_(Math.min(x, interval.peek()[1] - HOUR), interval.peek()[1]);
      else if (kind === 'end') setInterval_(interval.peek()[0], Math.max(x, interval.peek()[0] + HOUR));
      else setInterval_(a0 + (x - startX), b0 + (x - startX));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      frozen.current = null;
      interval.value = [...interval.peek()] as [number, number]; // re-render with new window
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const keyTime = (e: KeyboardEvent) => {
    const big = e.shiftKey ? DAY : HOUR;
    let d = 0;
    if (e.key === 'ArrowRight') d = big;
    else if (e.key === 'ArrowLeft') d = -big;
    else if (e.key === 'PageUp') d = DAY;
    else if (e.key === 'PageDown') d = -DAY;
    else if (e.key === 'Home') time.value = t0;
    else if (e.key === 'End') time.value = t1;
    else return;
    e.preventDefault();
    if (d) time.value = clampEph(time.peek() + d);
  };
  const keyHandle = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? (e.shiftKey ? 7 * DAY : DAY) : e.key === 'ArrowLeft' ? -(e.shiftKey ? 7 * DAY : DAY) : 0;
    if (!d) return;
    e.preventDefault();
    const [a, b] = interval.peek();
    if (which === 'start') setInterval_(Math.min(a + d, b - HOUR), b);
    else setInterval_(a, Math.max(b + d, a + HOUR));
  };

  const pct = (x: number) => `${(Math.min(1, Math.max(0, frac(x))) * 100).toFixed(3)}%`;
  return (
    <section class="timeline" aria-label="Time controls">
      <div class="tl-controls">
        <button class="btn primary" onClick={() => (playing.value = !playing.value)} aria-pressed={playing.value} title="Play/pause (Space)">
          {playing.value ? '❚❚ Pause' : '▶ Play'}
        </button>
        <select value={playSpeed.value} onChange={(e) => (playSpeed.value = +(e.target as HTMLSelectElement).value)} aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <option value={s.v}>{s.label}</option>
          ))}
        </select>
        <label class="tl-field" onDblClick={openPicker}>
          <span>Time (UTC)</span>
          <input type="datetime-local" value={toInputValue(t)} onChange={(e) => (time.value = clampEph(fromInputValue((e.target as HTMLInputElement).value)))} />
        </label>
        <label class="tl-field" onDblClick={openPicker}>
          <span>From</span>
          <input ref={fromRef} type="datetime-local" value={toInputValue(t0)} onChange={(e) => setInterval_(clampEph(fromInputValue((e.target as HTMLInputElement).value)), t1)} />
        </label>
        <label class="tl-field" onDblClick={openPicker}>
          <span>To</span>
          <input ref={toRef} type="datetime-local" value={toInputValue(t1)} onChange={(e) => setInterval_(t0, clampEph(fromInputValue((e.target as HTMLInputElement).value)))} />
        </label>
        <div class="tl-quick" role="group" aria-label="Interval length">
          {QUICK.map((q) => (
            <button class="btn small" onClick={() => setInterval_(t0, clampEph(t0 + q.ms))}>
              {q.label}
            </button>
          ))}
        </div>
        <span class="tl-span muted">{fmtDuration(span)}</span>
      </div>
      <div
        class="tl-track"
        ref={trackRef}
        onPointerDown={drag('time')}
        // double-click anywhere (also on the interval band, where a single press drags) moves the playhead there;
        // the handles stop it and open the From / To picker instead
        onDblClick={(e) => (time.value = tAt(e.clientX))}
      >
        <canvas ref={canvasRef} class="tl-canvas" aria-hidden="true" />
        <div class="tl-range" style={{ left: pct(t0), width: `calc(${pct(t1)} - ${pct(t0)})` }} onPointerDown={drag('range')} title="Drag to move the interval">
          <div class="tl-handle start" role="slider" tabIndex={0} aria-label="Interval start" aria-valuetext={fmtDate(t0)} onPointerDown={drag('start')} onKeyDown={keyHandle('start')} onDblClick={handlePicker(fromRef)} />
          <div class="tl-handle end" role="slider" tabIndex={0} aria-label="Interval end" aria-valuetext={fmtDate(t1)} onPointerDown={drag('end')} onKeyDown={keyHandle('end')} onDblClick={handlePicker(toRef)} />
        </div>
        <div class="tl-playhead" style={{ left: pct(t) }} role="slider" tabIndex={0} aria-label="Current time" aria-valuetext={fmtDate(t)} onPointerDown={drag('time')} onKeyDown={keyTime}>
          <span class="tl-playhead-label">{fmtDate(t)}</span>
        </div>
      </div>
    </section>
  );
}
