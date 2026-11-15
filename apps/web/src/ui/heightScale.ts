// Observer height above the local surface (terrain under the site, not a datum): 1–100 m on a
// logarithmic slider, so 1–10 m gets as much travel as 10–100 m. Values snap to 0.1 m below 10 m
// and to 1 m above. Horizon (and so every illumination/DTE metric), map layers and panorama all add
// it to the terrain height at the point.

export const H_MIN = 1;
export const H_MAX = 100;
/** Slider position = log10(h); 500 steps over two decades (≈ 0.9 % per step: every 0.1 m below 10 m and every 1 m above is reachable). */
export const POS_MIN = Math.log10(H_MIN);
export const POS_MAX = Math.log10(H_MAX);
export const POS_STEP = 0.004;
/** Tick marks on the slider. */
export const H_TICKS = [1, 2, 5, 10, 20, 50, 100];

export function clampHeight(h: number): number {
  return Math.min(H_MAX, Math.max(H_MIN, h));
}

/** Snap to the scale's resolution: 0.1 m below 10 m, 1 m from 10 m up. */
export function snapHeight(h: number): number {
  const c = clampHeight(h);
  return c < 10 ? Math.round(c * 10) / 10 : Math.round(c);
}

export function heightToPos(h: number): number {
  return Math.log10(clampHeight(h));
}

export function posToHeight(pos: number): number {
  return snapHeight(10 ** Math.min(POS_MAX, Math.max(POS_MIN, pos)));
}

/** Tick position snapped to a slider step (browsers only draw datalist ticks that sit on a step). */
export function tickPos(h: number): number {
  return POS_MIN + Math.round((heightToPos(h) - POS_MIN) / POS_STEP) * POS_STEP;
}

/**
 * Keyboard step for the log sliders. A native range step (POS_STEP) is finer than the 0.1 m / 1 m
 * snap, so an arrow press would snap straight back to the same height; step by the snap instead.
 * Arrows: ±0.1 m below 10 m, ±1 m above; PageUp/PageDown: next tick; Home/End: 1 / 100 m.
 * Returns null for keys the slider should not handle.
 */
export function keyStepHeight(h: number, key: string): number | null {
  const up = key === 'ArrowUp' || key === 'ArrowRight';
  const down = key === 'ArrowDown' || key === 'ArrowLeft';
  if (up) return snapHeight(h + (h < 10 ? 0.1 : 1));
  if (down) return snapHeight(h - (h <= 10 ? 0.1 : 1));
  if (key === 'PageUp') return H_TICKS.find((t) => t > h + 1e-9) ?? H_MAX;
  if (key === 'PageDown') return [...H_TICKS].reverse().find((t) => t < h - 1e-9) ?? H_MIN;
  if (key === 'Home') return H_MIN;
  if (key === 'End') return H_MAX;
  return null;
}

export function fmtHeight(h: number): string {
  return h < 10 ? `${h.toFixed(1)} m` : `${Math.round(h)} m`;
}
