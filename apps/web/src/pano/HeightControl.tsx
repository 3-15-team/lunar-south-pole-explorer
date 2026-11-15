// Panorama height control (bottom-right): a square button that opens into a vertical slider for
// the height above the surface (hObs — the panorama eye, Sun metrics and map layers). Log scale
// 1–100 m (ui/heightScale.ts); the value applies on release (horizon recompute).
import { useEffect, useState } from 'preact/hooks';
import { hObs } from '../state/store';
import { fmtHeight, heightToPos, keyStepHeight, POS_MAX, POS_MIN, POS_STEP, posToHeight } from '../ui/heightScale';

function HeightIcon() {
  // arrow rising from a ground line: "height above the surface"
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 17h14" />
      <path d="M10 14V3.5M6.5 7 10 3.5 13.5 7" />
    </svg>
  );
}

export function HeightControl() {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const h = drag ?? hObs.value;
  const pos = (e: Event) => posToHeight(+(e.target as HTMLInputElement).value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div class={`pano-height${open ? ' open' : ''}`}>
      {open && (
        <div class="ph-body">
          <output class="ph-value">{fmtHeight(h)}</output>
          <div class="ph-track">
            <input
              type="range"
              class="ph-range"
              min={POS_MIN}
              max={POS_MAX}
              step={POS_STEP}
              value={heightToPos(h)}
              aria-label="Height above surface"
              aria-orientation="vertical"
              aria-valuetext={fmtHeight(h)}
              onKeyDown={(e) => {
                const next = keyStepHeight(hObs.peek(), e.key);
                if (next === null) return;
                e.preventDefault();
                if (next !== hObs.peek()) hObs.value = next;
              }}
              onInput={(e) => setDrag(pos(e))}
              onChange={(e) => {
                hObs.value = pos(e);
                setDrag(null);
              }}
            />
            <span class="ph-labels" aria-hidden="true">
              {[100, 10, 1].map((t) => (
                <span key={t} style={{ '--p': (heightToPos(t) - POS_MIN) / (POS_MAX - POS_MIN) }}>
                  {t}
                </span>
              ))}
            </span>
          </div>
        </div>
      )}
      <button
        class="ph-btn"
        aria-expanded={open}
        aria-label={`Height above surface: ${fmtHeight(h)}`}
        title={`Height above surface: ${fmtHeight(h)} (camera / solar array, not above a datum)`}
        onClick={() => setOpen(!open)}
      >
        <HeightIcon />
      </button>
    </div>
  );
}
