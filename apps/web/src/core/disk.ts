// Visible fraction of a solar/terrestrial disk above a terrain horizon (docs/METRICS.md,
// slice method per ADR-101 — identical to libs/lunarcore/lunarcore/disk.py).
import { DEG } from './geo';

/** Straight-edge approximation: z = (el − H)/r; fraction of a unit disk above a line at −z. */
export function edgeFraction(z: number): number {
  if (z >= 1) return 1;
  if (z <= -1) return 0;
  return 1 - (Math.acos(z) - z * Math.sqrt(1 - z * z)) / Math.PI;
}

export type HorizonFn = (azDeg: number) => number;

/** ∫ sqrt(r² − x²) dx */
function G(x: number, r: number): number {
  const xc = Math.max(-r, Math.min(r, x));
  return (xc * Math.sqrt(Math.max(0, r * r - xc * xc)) + r * r * Math.asin(xc / r)) / 2;
}

/** Exact visible area of the disk strip x ∈ [a, b] above the line y = y0 (disk centred at 0, radius r). */
function stripArea(a: number, b: number, y0: number, r: number): number {
  if (y0 >= r) return 0;
  if (y0 <= -r) return 2 * (G(b, r) - G(a, r));
  const w0 = Math.sqrt(r * r - y0 * y0);
  let area = 0;
  const lo = Math.max(a, -w0);
  const hi = Math.min(b, w0);
  if (hi > lo) area += G(hi, r) - G(lo, r) - y0 * (hi - lo);
  if (y0 < 0) {
    // outside [-w0, w0] the whole chord lies above the line
    if (a < -w0) area += 2 * (G(Math.min(b, -w0), r) - G(a, r));
    if (b > w0) area += 2 * (G(b, r) - G(Math.max(a, w0), r));
  }
  return area;
}

/**
 * Slice integration over the disk (centre az/el, angular radius r — all degrees) against an
 * arbitrary horizon H(az): 16 equal-width vertical slices, each with its own horizon height
 * H(az + d_i/cos el), integrated exactly. Equals edgeFraction for a flat horizon.
 */
export function diskFraction(H: HorizonFn, az: number, el: number, r: number, slices = 16): number {
  const hc = H(az);
  if (el - r > hc + 3) return 1;
  if (el + r < hc - 3) return 0;
  const cosEl = Math.max(Math.cos(el * DEG), 1e-6);
  const w = (2 * r) / slices;
  let area = 0;
  for (let i = 0; i < slices; i++) {
    const a = -r + i * w;
    const d = a + w / 2;
    area += stripArea(a, a + w, H(az + d / cosEl) - el, r);
  }
  return Math.min(1, Math.max(0, area / (Math.PI * r * r)));
}
