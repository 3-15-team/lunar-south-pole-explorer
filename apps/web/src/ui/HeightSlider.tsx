import type { Signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { fmtHeight, H_TICKS, heightToPos, POS_MAX, POS_MIN, POS_STEP, posToHeight, tickPos } from './heightScale';

/**
 * Height above the local surface, 1–100 m, log scale (ui/heightScale.ts). The readout follows the
 * drag; the horizon is recomputed once on release.
 */
export function HeightSlider(props: { value: Signal<number>; label: string; title: string; id: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const h = drag ?? props.value.value;
  const pos = (e: Event) => posToHeight(+(e.target as HTMLInputElement).value);
  return (
    <label class="slider-row" title={props.title}>
      <span>{props.label}</span>
      <input
        type="range"
        min={POS_MIN}
        max={POS_MAX}
        step={POS_STEP}
        list={`${props.id}-ticks`}
        value={heightToPos(h)}
        aria-valuetext={fmtHeight(h)}
        onInput={(e) => setDrag(pos(e))}
        onChange={(e) => {
          props.value.value = pos(e);
          setDrag(null);
        }}
      />
      <datalist id={`${props.id}-ticks`}>
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
