// Elevation range of the sky plot: everything drawn (horizon silhouette, Sun/Earth tracks, current
// discs) must fit, so nothing is clipped at the bottom (low-latitude sites put the Sun 6–11° below
// the astronomical horizon). Bounds are padded and capped to keep the plot readable.

export const SKY_HI_MIN = 6;
export const SKY_HI_MAX = 35;
export const SKY_LO_MAX = -3; // never less than this below 0° (the dashed astronomical horizon)
export const SKY_LO_MIN = -20;

type Num = ArrayLike<number>;

function extent(arrays: Num[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

/**
 * [lo, hi] in degrees. `horizon` = profile elevations; `tracks` = Sun/Earth elevation series;
 * `discs` = [elevation, radius] of the current Sun/Earth discs.
 */
export function skyElRange(horizon: Num | null, tracks: Num[], discs: [number, number][]): [number, number] {
  const [hLo, hHi] = horizon ? extent([horizon]) : [Infinity, -Infinity];
  const [tLo, tHi] = extent(tracks);
  let lo = Math.min(hLo, tLo);
  let hi = Math.max(hHi + 0.5, tHi);
  for (const [el, r] of discs) {
    if (!Number.isFinite(el)) continue;
    lo = Math.min(lo, el - r);
    hi = Math.max(hi, el + r);
  }
  hi = Math.min(SKY_HI_MAX, Math.max(SKY_HI_MIN, hi + 1));
  lo = Math.max(SKY_LO_MIN, Math.min(SKY_LO_MAX, Math.floor(lo - 1)));
  return [lo, hi];
}
