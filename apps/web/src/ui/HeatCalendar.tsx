// Date × site heat calendar: daily mean sunlight per site (colour), Earth contact on hover.
import { useEffect, useRef, useState } from 'preact/hooks';
import { computeCalendar } from '../state/sync';
import { DAY, calendar, interval, services, setInterval_, time } from '../state/store';
import { cividis, fmtPct, fmtShortDate } from './format';

export function HeatCalendar() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState('');
  const cal = calendar.value;
  const LABEL_W = 150;

  useEffect(() => {
    const c = ref.current;
    if (!c || !cal) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const rowH = 16;
    const H = cal.rows.length * rowH + 18;
    c.style.height = `${H}px`;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cw = (W - LABEL_W) / cal.days;
    g.font = '11px system-ui, sans-serif';
    cal.rows.forEach((r, i) => {
      g.fillStyle = '#c9d1db';
      g.fillText(r.label.length > 24 ? r.label.slice(0, 23) + '…' : r.label, 4, i * rowH + 12);
      for (let d = 0; d < cal.days; d++) {
        g.fillStyle = cividis(r.illum[d]);
        g.fillRect(LABEL_W + d * cw, i * rowH + 1, Math.max(1, cw - 1), rowH - 2);
        if (r.earth[d] < 0.5) {
          g.fillStyle = 'rgba(0,0,0,0.55)';
          g.fillRect(LABEL_W + d * cw, i * rowH + rowH - 4, Math.max(1, cw - 1), 2);
        }
      }
    });
    g.fillStyle = '#8b95a3';
    for (let d = 0; d < cal.days; d += 7) g.fillText(fmtShortDate(cal.dayStart + d * DAY), LABEL_W + d * cw, H - 4);
  }, [cal]);

  const run = async () => {
    if (!services.client) return;
    setBusy(true);
    try {
      await computeCalendar(services.client, 60);
    } finally {
      setBusy(false);
    }
  };

  const cell = (e: MouseEvent) => {
    const c = ref.current;
    if (!c || !cal) return null;
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left - LABEL_W;
    const row = Math.floor((e.clientY - r.top) / 16);
    const d = Math.floor((x / (r.width - LABEL_W)) * cal.days);
    if (x < 0 || row < 0 || row >= cal.rows.length || d < 0 || d >= cal.days) return null;
    return { row, d };
  };

  return (
    <details class="calendar">
      <summary>Date × site calendar (60 days of daily sunlight)</summary>
      <div class="cal-bar">
        <button class="btn small" onClick={run} disabled={busy}>
          {busy ? 'Computing…' : cal ? 'Recompute' : 'Compute calendar'}
        </button>
        <span class="muted">Colour = daily mean sunlight (cividis, 0–100%); dark underline = Earth contact &lt; 50% of the day. Click a day to jump there.</span>
      </div>
      {cal && (
        <>
          <canvas
            ref={ref}
            class="cal-canvas"
            onMouseMove={(e) => {
              const c = cell(e);
              setTip(c ? `${cal.rows[c.row].label} · ${fmtShortDate(cal.dayStart + c.d * DAY)}: sunlight ${fmtPct(cal.rows[c.row].illum[c.d])}, Earth ${fmtPct(cal.rows[c.row].earth[c.d])}` : '');
            }}
            onClick={(e) => {
              const c = cell(e);
              if (!c) return;
              const [a, b] = interval.peek();
              const t0 = cal.dayStart + c.d * DAY;
              setInterval_(t0, t0 + (b - a));
              time.value = t0;
            }}
          />
          <div class="cal-tip" aria-live="polite">
            {tip || ' '}
          </div>
        </>
      )}
    </details>
  );
}
