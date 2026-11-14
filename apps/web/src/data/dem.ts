// DEM tile client for the LPS-2560 pyramid (docs/DATA.md §2): fetch, inflate, decode,
// LRU cache and fast multi-level sampling. Used by the site worker, the map engine
// and the panorama.
import type { DemSampler } from '../core/horizon';

export interface DemLevel {
  z: number;
  res: number;
  source?: string;
  native?: boolean;
  tiles: [number, number][];
}

export interface DemIndex {
  version: number;
  grid: { name: string; x0: number; y0: number; tileSize: number; res0: number; radius: number; proj4?: string };
  coverage?: { maxRho: number; minLatDeg?: number };
  levels: DemLevel[];
  heightRange?: [number, number];
  error?: { available: boolean; maxZ: number; path: string };
}

export const TILE = 256;
export const MAX_Z = 9;

export const key = (z: number, tx: number, ty: number): number => z * 1048576 + tx * 1024 + ty;

export async function inflateIfGzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (b.length === 2 && b[0] === 0x1f && b[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
  }
  return buf;
}

/** Decode an LDT1 payload into heights (m); nodata → NaN. */
export function decodeTile(payload: ArrayBuffer): Float32Array {
  const dv = new DataView(payload);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'LDT1') throw new Error('bad tile magic ' + magic);
  const base = dv.getFloat32(4, true);
  const scale = dv.getFloat32(8, true);
  const w = dv.getUint16(12, true);
  const h = dv.getUint16(14, true);
  const n = w * h;
  const out = new Float32Array(n);
  const v = new Int16Array(payload.slice(16, 16 + n * 2));
  for (let i = 0; i < n; i++) out[i] = v[i] === -32768 ? NaN : base + scale * v[i];
  return out;
}

export class DemClient implements DemSampler {
  readonly x0: number;
  readonly y0: number;
  readonly res0: number;
  readonly maxRho: number;
  readonly available = new Set<number>();
  readonly levels = new Map<number, DemLevel>();
  readonly errAvailableMaxZ: number;
  private cache = new Map<number, Float32Array>();
  private errCache = new Map<number, Float32Array>();
  private inflight = new Map<number, Promise<Float32Array | null>>();
  private lastKey = -1;
  private lastTile: Float32Array | null = null;
  maxCacheTiles = 1500;
  onTile?: (z: number, tx: number, ty: number) => void;

  constructor(
    readonly index: DemIndex,
    readonly baseUrl: string,
  ) {
    this.x0 = index.grid.x0;
    this.y0 = index.grid.y0;
    this.res0 = index.grid.res0;
    this.maxRho = index.coverage?.maxRho ?? 304000;
    for (const l of index.levels) {
      this.levels.set(l.z, l);
      for (const [tx, ty] of l.tiles) this.available.add(key(l.z, tx, ty));
    }
    this.errAvailableMaxZ = index.error?.available ? index.error.maxZ : -1;
  }

  static async load(baseUrl: string): Promise<DemClient> {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const r = await fetch(base + 'dem/index.json');
    if (!r.ok) throw new Error(`DEM index HTTP ${r.status}`);
    return new DemClient((await r.json()) as DemIndex, base);
  }

  res(z: number): number {
    return this.res0 / 2 ** z;
  }

  /** Coarsest level whose resolution is ≤ `res` (clamped to existing levels). */
  levelFor(res: number): number {
    const z = Math.ceil(Math.log2(this.res0 / Math.max(res, 1e-6)) - 1e-9);
    return Math.max(0, Math.min(MAX_Z, z));
  }

  tileOf(z: number, x: number, y: number): [number, number] {
    const span = TILE * this.res(z);
    return [Math.floor((x - this.x0) / span), Math.floor((this.y0 - y) / span)];
  }

  hasTile(z: number, tx: number, ty: number): boolean {
    return this.available.has(key(z, tx, ty));
  }

  /** Finest level with a tile covering (x, y). */
  finestLevelAt(x: number, y: number): number {
    for (let z = MAX_Z; z >= 0; z--) {
      const [tx, ty] = this.tileOf(z, x, y);
      if (this.hasTile(z, tx, ty)) return z;
    }
    return -1;
  }

  finestRes(x: number, y: number): number {
    const z = this.finestLevelAt(x, y);
    return z < 0 ? this.res0 : this.res(z);
  }

  getLoaded(z: number, tx: number, ty: number): Float32Array | undefined {
    return this.cache.get(key(z, tx, ty));
  }

  async fetchTile(z: number, tx: number, ty: number, kind: 'dem' | 'err' = 'dem'): Promise<Float32Array | null> {
    const k = key(z, tx, ty) + (kind === 'err' ? 0.5 : 0);
    const cache = kind === 'dem' ? this.cache : this.errCache;
    const have = cache.get(Math.floor(k));
    if (have) return have;
    if (kind === 'dem' && !this.hasTile(z, tx, ty)) return null;
    let p = this.inflight.get(k);
    if (!p) {
      const url = `${this.baseUrl}${kind}/${z}/${tx}/${ty}.bin`;
      p = fetch(url)
        .then(async (r) => {
          if (!r.ok) return null;
          const data = decodeTile(await inflateIfGzip(await r.arrayBuffer()));
          cache.set(Math.floor(k), data);
          this.evict();
          if (kind === 'dem') this.onTile?.(z, tx, ty);
          return data;
        })
        .catch(() => null)
        .finally(() => this.inflight.delete(k));
      this.inflight.set(k, p);
    }
    return p;
  }

  private evict(): void {
    if (this.cache.size <= this.maxCacheTiles) return;
    const drop = this.cache.size - this.maxCacheTiles;
    let i = 0;
    for (const k of this.cache.keys()) {
      if (i++ >= drop) break;
      this.cache.delete(k);
    }
    this.lastKey = -1;
  }

  /** Value at global pixel (gx, gy) of level z, falling back to coarser levels. */
  pixel(z: number, gx: number, gy: number): number {
    for (let zz = z; zz >= 0; zz--) {
      const s = z - zz;
      const px = gx >> s;
      const py = gy >> s;
      const k = key(zz, px >> 8, py >> 8);
      let t: Float32Array | null | undefined = k === this.lastKey ? this.lastTile : this.cache.get(k);
      if (t) {
        this.lastKey = k;
        this.lastTile = t;
        return t[(py & 255) * TILE + (px & 255)];
      }
    }
    return NaN;
  }

  /** Bilinear height at level z (pixel-is-area centres); NaN if missing. */
  heightAtLevel(z: number, x: number, y: number): number {
    const r = this.res(z);
    const fx = (x - this.x0) / r - 0.5;
    const fy = (this.y0 - y) / r - 0.5;
    const gx = Math.floor(fx);
    const gy = Math.floor(fy);
    const ax = fx - gx;
    const ay = fy - gy;
    const h00 = this.pixel(z, gx, gy);
    const h10 = this.pixel(z, gx + 1, gy);
    const h01 = this.pixel(z, gx, gy + 1);
    const h11 = this.pixel(z, gx + 1, gy + 1);
    const v = (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
    if (v === v) return v;
    // edge of data: nearest valid neighbour
    const c = [h00, h10, h01, h11].filter((q) => q === q);
    return c.length ? c[0] : NaN;
  }

  /** DemSampler: coarsest loaded level with res ≤ requested (falls back to coarser ones). */
  height(x: number, y: number, res: number): number {
    return this.heightAtLevel(this.levelFor(res), x, y);
  }

  errorAt(x: number, y: number): number {
    if (this.errAvailableMaxZ < 0) return NaN;
    for (let z = this.errAvailableMaxZ; z >= 0; z--) {
      const [tx, ty] = this.tileOf(z, x, y);
      const t = this.errCache.get(key(z, tx, ty));
      if (t) {
        const r = this.res(z);
        const gx = Math.floor((x - this.x0) / r) - tx * TILE;
        const gy = Math.floor((this.y0 - y) / r) - ty * TILE;
        return t[Math.min(255, Math.max(0, gy)) * TILE + Math.min(255, Math.max(0, gx))];
      }
    }
    return NaN;
  }

  /** Tiles a horizon ray-march from (x, y) will touch (dry run of the step pattern). */
  tilesForHorizon(x: number, y: number, steps: { d: Float64Array; res: Float64Array }, naz = 360): number[][] {
    const need = new Set<number>();
    const add = (z: number, px: number, py: number) => {
      for (let zz = z; zz >= 0; zz--) {
        const [tx, ty] = this.tileOf(zz, px, py);
        if (this.hasTile(zz, tx, ty)) {
          need.add(key(zz, tx, ty));
          return;
        }
      }
    };
    const lon = Math.atan2(x, y);
    for (let k = 0; k < naz; k++) {
      const a = lon + (k * 2 * Math.PI) / naz;
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      let lastZ = -1;
      let lastT = -1;
      for (let j = 0; j < steps.d.length; j++) {
        const px = x + dx * steps.d[j];
        const py = y + dy * steps.d[j];
        if (px * px + py * py > this.maxRho * this.maxRho) break;
        const z = this.levelFor(steps.res[j]);
        const [tx, ty] = this.tileOf(z, px, py);
        const t = key(z, tx, ty);
        if (z === lastZ && t === lastT) continue;
        lastZ = z;
        lastT = t;
        add(z, px, py);
        // bilinear neighbours can cross the tile edge: include the next pixel's tile
        add(z, px + this.res(z), py - this.res(z));
      }
    }
    // the site's own neighbourhood at the finest level
    const zf = this.finestLevelAt(x, y);
    if (zf >= 0) for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) add(zf, x + ox * this.res(zf) * 2, y + oy * this.res(zf) * 2);
    return [...need].map((k) => [Math.floor(k / 1048576), Math.floor((k % 1048576) / 1024), k % 1024]);
  }

  async loadAll(list: number[][], concurrency = 8, kind: 'dem' | 'err' = 'dem', onProgress?: (done: number, total: number) => void): Promise<void> {
    let i = 0;
    let done = 0;
    const worker = async () => {
      while (i < list.length) {
        const [z, tx, ty] = list[i++];
        await this.fetchTile(z, tx, ty, kind);
        done++;
        onProgress?.(done, list.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  }

  /** Error tiles matching a DEM tile list (z clamped to the error pyramid). */
  errTilesFor(list: number[][]): number[][] {
    if (this.errAvailableMaxZ < 0) return [];
    const s = new Set<number>();
    for (const [z, tx, ty] of list) {
      const zz = Math.min(z, this.errAvailableMaxZ);
      const sh = z - zz;
      s.add(key(zz, tx >> sh, ty >> sh));
    }
    return [...s].map((k) => [Math.floor(k / 1048576), Math.floor((k % 1048576) / 1024), k % 1024]);
  }
}
