// LUNAR:SPS — south polar stereographic on the 1737.4 km sphere (docs/DATA.md §1).
import Projection from 'ol/proj/Projection';
import { addProjection, get as getProjection } from 'ol/proj';
import { R_MOON_M, latLonToXY } from '../core/geo';

export const GRID_EXTENT: [number, number, number, number] = [-327680, -327680, 327680, 327680];

export function spsProjection(): Projection {
  const have = getProjection('LUNAR:SPS');
  if (have) return have;
  const p = new Projection({
    code: 'LUNAR:SPS',
    units: 'm',
    extent: GRID_EXTENT,
    global: false,
    // true ground resolution: grid distance / k (k = 1 + ρ²/4R²)
    getPointResolution: (res: number, c: number[]) => res / (1 + (c[0] * c[0] + c[1] * c[1]) / (4 * R_MOON_M * R_MOON_M)),
  });
  addProjection(p);
  return p;
}

/** Circle of latitude as a closed ring of SPS coordinates. */
export function latitudeRing(lat: number, n = 180): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const { x, y } = latLonToXY(lat, (i / n) * 360 - 180);
    out.push([x, y]);
  }
  return out;
}

export function meridian(lon: number, latFrom = -80, latTo = -89.9, n = 40): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const { x, y } = latLonToXY(latFrom + ((latTo - latFrom) * i) / n, lon);
    out.push([x, y]);
  }
  return out;
}

/** Square footprint of side L (true metres) centred at (x, y), axis-aligned to local E/N. */
export function footprintSquare(x: number, y: number, L: number): number[][] {
  const k = 1 + (x * x + y * y) / (4 * R_MOON_M * R_MOON_M);
  const h = (L * k) / 2;
  const lon = Math.atan2(x, y);
  const e = [Math.cos(lon), -Math.sin(lon)];
  const nn = [Math.sin(lon), Math.cos(lon)];
  const pts = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  return pts.map(([a, b]) => [x + h * (a * e[0] + b * nn[0]), y + h * (a * e[1] + b * nn[1])]);
}
