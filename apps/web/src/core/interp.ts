// Cubic interpolation kernels shared by the DEM client (worker-safe: no DOM) and the panorama.

/** Mitchell–Netravali kernel k(x) for parameters (B, C); weights of the 4 taps sum to 1. */
export function mnKernel(x: number, B: number, C: number): number {
  x = Math.abs(x);
  if (x < 1) return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6;
  if (x < 2) return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x ** 2 + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
  return 0;
}
