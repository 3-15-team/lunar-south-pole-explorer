import { describe, expect, it } from 'vitest';
import { DemClient, key, TILE } from '../src/data/dem';

// One z0 tile only; z1+ requested levels must fall back to bilinear (or cubic) at z0, never to
// nearest-neighbour blocks (ADR-116, mirrors lunarcore.tiles.sample_clip).
function planeClient(): { dem: DemClient; plane: (x: number, y: number) => number } {
  const res0 = 100;
  const dem = new DemClient(
    { grid: { x0: 0, y0: TILE * res0, res0 }, levels: [{ z: 0, tiles: [[0, 0]] }] } as never,
    '/data/',
  );
  const plane = (x: number, y: number) => 0.3 * x - 0.2 * y + 1000;
  const t = new Float32Array(TILE * TILE);
  for (let r = 0; r < TILE; r++)
    for (let c = 0; c < TILE; c++) t[r * TILE + c] = plane((c + 0.5) * res0, TILE * res0 - (r + 0.5) * res0);
  (dem as unknown as { cache: Map<number, Float32Array> }).cache.set(key(0, 0, 0), t);
  return { dem, plane };
}

describe('DEM coarse-level fallback', () => {
  it('requested finer level without tiles → exact bilinear at the coarse level (no plateaus)', () => {
    const { dem, plane } = planeClient();
    for (const [x, y] of [[5012.5, 9000.3], [12345.6, 20000.1], [777.7, 25000]]) {
      expect(dem.heightAtLevel(3, x, y)).toBeCloseTo(plane(x, y), 2);
      expect(dem.height(x, y, 12.5)).toBeCloseTo(plane(x, y), 2);
    }
    // neighbouring fine samples inside one coarse pixel differ (old nearest fallback made them equal)
    expect(dem.heightAtLevel(3, 5010, 9000)).not.toBeCloseTo(dem.heightAtLevel(3, 5022.5, 9000), 3);
  });

  it('cubic upsampling reproduces a plane (linear precision) for every kernel', () => {
    const { dem, plane } = planeClient();
    for (const [B, C] of [[0, 0.5], [1 / 3, 1 / 3], [1, 0]]) expect(dem.heightCubic(9876.5, 14321.2, 5, B, C)).toBeCloseTo(plane(9876.5, 14321.2), 2);
  });

  it('missing coverage at every level → NaN', () => {
    const { dem } = planeClient();
    expect(dem.heightAtLevel(2, -500, 100)).toBeNaN();
  });
});
