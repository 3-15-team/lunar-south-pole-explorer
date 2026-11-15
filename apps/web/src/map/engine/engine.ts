// WebGL2 terrain engine for the map (ADR-010): far/near DEM textures, progressive
// viewport horizon maps, interval illumination integrals, footprint features and a
// display pass with live Sun shading and ray-marched soft shadows.
import type { Ephemeris } from '../../core/ephemeris';
import { EARTH_RADIUS_KM, SUN_RADIUS_KM, AU_KM } from '../../core/geo';
import { score, type Features, type Weights } from '../../core/suitability';
import { DemClient, TILE, decodeTile, inflateIfGzip } from '../../data/dem';
import { DISPLAY_FRAG, FEATURE_FRAG, HORIZON_FRAG, INTERVAL_FRAG, VERT } from './shaders';

export type EngineLayer = 'relief' | 'shadow' | 'illum' | 'earth' | 'dark' | 'slope' | 'suit';
const LAYER_ID: Record<EngineLayer, number> = { relief: 0, shadow: 1, illum: 2, earth: 3, dark: 4, slope: 5, suit: 6 };
const NEEDS_GRID: EngineLayer[] = ['illum', 'earth', 'dark', 'suit'];
/** Layers whose Earth share comes from the antenna pass when one is requested (ADR-122). */
const ANT_LAYERS: EngineLayer[] = ['earth', 'suit'];

/** Earth-from-antenna pass: off (not requested / same height), computing, or ready. */
export type AntennaPassState = { state: 'off' } | { state: 'computing'; h: number; pct: number } | { state: 'ready'; h: number };

export interface EngineParams {
  time: number;
  interval: [number, number];
  layer: EngineLayer;
  obsH: number;
  /** Antenna height for the Earth share of the earth/suit layers; null = not requested (ADR-122). */
  antH: number | null;
  dte: number;
  footprint: number;
  weights: Weights;
  slopeLimit: number;
  darkRef: number;
  lighting: 'enhanced' | 'realistic';
}

export interface FrameLike {
  size: number[];
  pixelRatio: number;
  extent: number[];
  viewState: { center: number[]; resolution: number };
  viewHints: number[];
}

const SENTINEL = -30000;
const NAZ = 64;
const GROUPS = NAZ / 4;

type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
type Grid = { x0: number; yTop: number; sp: number; nx: number; ny: number; key: string; obsH: number };

export class TerrainEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly hw: boolean;
  onNeedRender: () => void = () => {};
  onStatus: (s: string) => void = () => {};
  params: EngineParams | null = null;
  gridValid = false;
  featValid = false;

  private progs: Record<'display' | 'horizon' | 'interval' | 'feature', Prog>;
  private vao: WebGLVertexArrayObject;
  private farTex: WebGLTexture;
  private farRect: [number, number, number, number] = [0, 0, 1, 1];
  private farMaxLod = 0;
  /** Context Moon outside the polar coverage (data/web/outer, LOLA LDEM_16): display pass only. */
  private outerTex: WebGLTexture | null = null;
  private outerRect: [number, number, number, number] = [0, 0, 1, 1];
  private outerMaxLod = 0;
  private outerRho = 0;
  /** Outermost map coordinate the view may show (equator when the context Moon is available). */
  static readonly OUTER_HALF = 3_480_000;
  private near: { tex: WebGLTexture; z: number; tx0: number; ty0: number; n: number; valid: boolean; maxLod: number; mipDirty: boolean; gen: number; pending: number; uploads: number } | null = null;
  private grid: Grid | null = null;
  private pendingGrid: Grid | null = null;
  private resultSize = '';
  private horTex: WebGLTexture | null = null;
  private horPend: WebGLTexture | null = null;
  private horSize = [0, 0];
  private horGroup = GROUPS;
  private intTex: WebGLTexture | null = null;
  private featTex: WebGLTexture | null = null;
  private fb: WebGLFramebuffer;
  private ephTex: WebGLTexture;
  private intKey = '';
  private featKey = '';
  /** Second horizon set + interval result on the same grid, from the antenna height (on demand). */
  private antPend: WebGLTexture | null = null;
  private antHor: WebGLTexture | null = null;
  private antSize = [0, 0];
  private antGroup = GROUPS;
  private antJobKey = '';
  private antDoneKey = '';
  private intAntTex: WebGLTexture | null = null;
  private intAntKey = '';
  private antValid = false;
  private antState: AntennaPassState = { state: 'off' };
  onAntenna: (s: AntennaPassState) => void = () => {};
  private ephKey = '';
  private ephK = 0;
  private lastInteractAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private dem: DemClient,
    private eph: Ephemeris,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is required for the map.');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required.');
    this.hw = !!gl.getExtension('OES_texture_float_linear');
    this.progs = {
      display: this.program(DISPLAY_FRAG(this.hw)),
      horizon: this.program(HORIZON_FRAG(this.hw)),
      interval: this.program(INTERVAL_FRAG(this.hw)),
      feature: this.program(FEATURE_FRAG(this.hw)),
    };
    this.vao = gl.createVertexArray()!;
    this.fb = gl.createFramebuffer()!;
    this.ephTex = gl.createTexture()!;
    this.farTex = gl.createTexture()!;
    this.initFar();
    this.initOuter().catch(() => {
      /* no context Moon: the map ends at the coverage edge as before */
    });
  }

  // ------------------------------------------------------------ GL helpers
  private program(frag: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return { p, u: new Map() };
  }

  private use(pr: Prog): (name: string) => WebGLUniformLocation | null {
    this.gl.useProgram(pr.p);
    return (name: string) => {
      if (!pr.u.has(name)) pr.u.set(name, this.gl.getUniformLocation(pr.p, name));
      return pr.u.get(name)!;
    };
  }

  private demTex(n: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = this.hw ? Math.floor(Math.log2(n)) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.R32F, n, n);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.hw ? gl.LINEAR_MIPMAP_NEAREST : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.hw ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // fill with sentinel
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearBufferfv(gl.COLOR, 0, [SENTINEL, 0, 0, 0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }

  private floatTex(w: number, h: number, fmt: number, layers = 0): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    const target = layers ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
    gl.bindTexture(target, t);
    if (layers) gl.texStorage3D(target, 1, fmt, w, h, layers);
    else gl.texStorage2D(target, 1, fmt, w, h);
    const filt = fmt === gl.RGBA16F || this.hw ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private static clean(src: Float32Array): Float32Array {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] === src[i] ? src[i] : SENTINEL;
    return out;
  }

  private upload(tex: WebGLTexture, ox: number, oy: number, data: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, ox, oy, TILE, TILE, gl.RED, gl.FLOAT, TerrainEngine.clean(data));
  }

  // ------------------------------------------------------------ far texture (whole coverage, z ≤ 3)
  private initFar(): void {
    const zf = Math.min(3, Math.max(...[...this.dem.levels.keys()]));
    const n = TILE * 2 ** zf;
    this.farTex = this.demTex(n);
    this.farRect = [this.dem.x0, this.dem.y0, this.dem.res(zf), n];
    this.farMaxLod = this.hw ? Math.floor(Math.log2(n)) : 0;
    const tiles = this.dem.levels.get(zf)?.tiles ?? [];
    let left = tiles.length;
    for (const [tx, ty] of tiles) {
      this.dem.fetchTile(zf, tx, ty).then((d) => {
        if (d) this.upload(this.farTex, tx * TILE, ty * TILE, d);
        if (--left === 0) {
          if (this.hw) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.farTex);
            this.gl.generateMipmap(this.gl.TEXTURE_2D);
          }
          this.invalidateGrid();
          this.onNeedRender();
        }
      });
    }
  }

  // ------------------------------------------------------------ outer texture (context Moon)
  private async initOuter(): Promise<void> {
    const base = this.dem.baseUrl + 'outer/';
    const r = await fetch(base + 'index.json');
    if (!r.ok) return;
    const idx = (await r.json()) as { file: string; x0: number; y0: number; res: number; n: number; maxRho: number };
    const b = await fetch(base + idx.file);
    if (!b.ok) return;
    const h = decodeTile(await inflateIfGzip(await b.arrayBuffer()));
    const gl = this.gl;
    const t = this.demTex(idx.n);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, idx.n, idx.n, gl.RED, gl.FLOAT, TerrainEngine.clean(h));
    if (this.hw) gl.generateMipmap(gl.TEXTURE_2D);
    this.outerTex = t;
    this.outerRect = [idx.x0, idx.y0, idx.res, idx.n];
    this.outerMaxLod = this.hw ? Math.floor(Math.log2(idx.n)) : 0;
    this.outerRho = idx.maxRho;
    this.onNeedRender();
  }

  /** True once the context Moon outside the coverage is loaded. */
  get hasOuter(): boolean {
    return !!this.outerTex;
  }

  // ------------------------------------------------------------ near texture (view level)
  private updateNear(fs: FrameLike): void {
    const [minx, miny, maxx, maxy] = fs.extent;
    const span = Math.max(maxx - minx, maxy - miny) * 1.3;
    const mpp = fs.viewState.resolution / fs.pixelRatio;
    const N = 2048;
    const zFit = Math.floor(Math.log2((this.dem.res0 * N) / span));
    const zPix = Math.floor(Math.log2(this.dem.res0 / (0.75 * mpp)));
    const z = Math.min(9, zFit, zPix);
    const zFar = Math.round(Math.log2(this.dem.res0 / this.farRect[2]));
    if (z <= zFar) {
      if (this.near) this.near.valid = false;
      return;
    }
    const res = this.dem.res(z);
    const cx = (fs.viewState.center[0] - this.dem.x0) / res / TILE;
    const cy = (this.dem.y0 - fs.viewState.center[1]) / res / TILE;
    const nt = N / TILE;
    const inside = (n: NonNullable<TerrainEngine['near']>) => {
      const x0 = this.dem.x0 + n.tx0 * TILE * res;
      const y0 = this.dem.y0 - n.ty0 * TILE * res;
      const w = N * res;
      return minx > x0 && maxx < x0 + w && maxy < y0 && miny > y0 - w;
    };
    if (this.near && this.near.z === z && this.near.valid && inside(this.near)) return;
    const tx0 = Math.round(cx - nt / 2);
    const ty0 = Math.round(cy - nt / 2);
    if (!this.near) this.near = { tex: this.demTex(N), z, tx0, ty0, n: N, valid: true, maxLod: this.hw ? 11 : 0, mipDirty: true, gen: 0, pending: 0, uploads: 0 };
    else {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.near.tex, 0);
      gl.clearBufferfv(gl.COLOR, 0, [SENTINEL, 0, 0, 0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      Object.assign(this.near, { z, tx0, ty0, valid: true, mipDirty: true, pending: 0 });
    }
    const gen = ++this.near.gen;
    for (let j = 0; j < nt; j++)
      for (let i = 0; i < nt; i++) {
        const tx = tx0 + i;
        const ty = ty0 + j;
        this.near.pending++;
        this.tileData(z, tx, ty).then((d) => {
          if (!this.near || this.near.gen !== gen) return;
          this.near.pending--;
          if (d) {
            this.upload(this.near.tex, i * TILE, j * TILE, d);
            this.near.uploads++;
            this.near.mipDirty = true;
          }
          if (this.near.pending === 0) this.invalidateGrid();
          this.onNeedRender();
        });
      }
  }

  /** Tile at level z, or an upsampled ancestor when that level has no tile here. */
  private async tileData(z: number, tx: number, ty: number): Promise<Float32Array | null> {
    if (tx < 0 || ty < 0 || tx >= 2 ** z || ty >= 2 ** z) return null;
    for (let zz = z; zz >= 0; zz--) {
      const s = z - zz;
      const ax = tx >> s;
      const ay = ty >> s;
      if (!this.dem.hasTile(zz, ax, ay)) continue;
      const d = await this.dem.fetchTile(zz, ax, ay);
      if (!d) return null;
      if (s === 0) return d;
      const f = 2 ** s;
      const out = new Float32Array(TILE * TILE);
      const offx = (tx - (ax << s)) * (TILE / f);
      const offy = (ty - (ay << s)) * (TILE / f);
      for (let r = 0; r < TILE; r++) {
        const fy = Math.min(TILE - 1.001, Math.max(0, offy + (r + 0.5) / f - 0.5));
        const y0 = Math.floor(fy);
        const wy = fy - y0;
        for (let c = 0; c < TILE; c++) {
          const fx = Math.min(TILE - 1.001, Math.max(0, offx + (c + 0.5) / f - 0.5));
          const x0 = Math.floor(fx);
          const wx = fx - x0;
          const i = y0 * TILE + x0;
          out[r * TILE + c] = (d[i] * (1 - wx) + d[i + 1] * wx) * (1 - wy) + (d[i + TILE] * (1 - wx) + d[i + TILE + 1] * wx) * wy;
        }
      }
      return out;
    }
    return null;
  }

  // ------------------------------------------------------------ analysis grid
  invalidateGrid(): void {
    this.grid = null;
    this.pendingGrid = null;
    this.horGroup = GROUPS;
    this.gridValid = false;
    this.featValid = false;
    this.intKey = '';
    this.featKey = '';
    this.antJobKey = '';
    this.antDoneKey = '';
    this.intAntKey = '';
    this.antValid = false;
  }

  private wantGrid(fs: FrameLike): void {
    const p = this.params;
    if (!p || !NEEDS_GRID.includes(p.layer)) return;
    // analysis exists only inside the polar coverage: never spend the grid on the context Moon
    const R = this.dem.maxRho;
    const minx = Math.max(fs.extent[0], -R);
    const miny = Math.max(fs.extent[1], -R);
    const maxx = Math.min(fs.extent[2], R);
    const maxy = Math.min(fs.extent[3], R);
    if (minx >= maxx || miny >= maxy) return;
    const mx = (maxx - minx) * 0.08;
    const my = (maxy - miny) * 0.08;
    const w = maxx - minx + 2 * mx;
    const h = maxy - miny + 2 * my;
    const G = 512;
    const dres = this.near?.valid ? this.dem.res(this.near.z) : this.farRect[2];
    const sp = Math.max(Math.max(w, h) / G, dres * 0.5, 2.5);
    const nx = Math.max(8, Math.round(w / sp));
    const ny = Math.max(8, Math.round(h / sp));
    const x0 = minx - mx;
    const yTop = maxy + my;
    if (this.near?.valid && this.near.pending > 0) return; // wait for the view's DEM tiles
    const obsH = p.obsH;
    // keep a grid while the view stays inside it at a similar scale
    const fits = (c: Grid | null) =>
      !!c &&
      c.obsH === obsH &&
      minx >= c.x0 &&
      maxx <= c.x0 + c.nx * c.sp &&
      maxy <= c.yTop &&
      miny >= c.yTop - c.ny * c.sp &&
      c.sp <= sp * 1.6 &&
      c.sp >= sp / 1.6;
    if (this.pendingGrid ? fits(this.pendingGrid) : fits(this.grid)) return;
    const key = `${x0.toFixed(0)}:${yTop.toFixed(0)}:${sp.toFixed(2)}:${nx}:${ny}:${obsH}:${this.near?.uploads ?? 0}`;
    this.pendingGrid = { x0, yTop, sp, nx, ny, key, obsH };
    if (this.horSize[0] !== nx || this.horSize[1] !== ny || !this.horPend) {
      const gl = this.gl;
      for (const t of [this.horPend]) if (t) gl.deleteTexture(t);
      this.horPend = this.floatTex(nx, ny, gl.RGBA16F, GROUPS);
      if (this.horTex && (this.horSize[0] !== nx || this.horSize[1] !== ny)) {
        gl.deleteTexture(this.horTex);
        this.horTex = null;
        this.grid = null;
        this.gridValid = false;
      }
      this.horSize = [nx, ny];
    }
    this.horGroup = 0;
  }

  private bindDem(u: (n: string) => WebGLUniformLocation | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.farTex);
    gl.uniform1i(u('uFar'), 0);
    gl.uniform4fv(u('uFarRect'), this.farRect);
    gl.uniform1f(u('uFarMaxLod'), this.farMaxLod);
    gl.activeTexture(gl.TEXTURE1);
    const n = this.near;
    gl.bindTexture(gl.TEXTURE_2D, n ? n.tex : this.farTex);
    gl.uniform1i(u('uNear'), 1);
    const res = n ? this.dem.res(n.z) : 1;
    gl.uniform4fv(u('uNearRect'), n ? [this.dem.x0 + n.tx0 * TILE * res, this.dem.y0 - n.ty0 * TILE * res, res, n.n] : [0, 0, 1, 1]);
    gl.uniform1f(u('uNearMaxLod'), n ? n.maxLod : 0);
    gl.uniform1f(u('uNearValid'), n?.valid ? 1 : 0);
    gl.uniform1f(u('uMaxRho'), this.dem.maxRho);
  }

  /** Ray-trace `count` azimuth groups of grid `g` from height `obsH` into layered texture `tex`. */
  private drawHorizonGroups(g: Grid, tex: WebGLTexture, from: number, count: number, obsH: number): number {
    const gl = this.gl;
    const u = this.use(this.progs.horizon);
    this.bindDem(u);
    gl.uniform4f(u('uGrid'), g.x0, g.yTop, g.sp, 0);
    gl.uniform1f(u('uNaz'), NAZ);
    gl.uniform1f(u('uObsH'), obsH);
    gl.uniform1f(u('uAlpha'), 0.02);
    gl.uniform1f(u('uMaxDist'), 200000);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, g.nx, g.ny);
    gl.bindVertexArray(this.vao);
    let k = from;
    for (; k < from + count && k < GROUPS; k++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, k);
      gl.uniform1i(u('uGroup'), k);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return k;
  }

  private runHorizonGroups(count: number): void {
    const g = this.pendingGrid;
    if (!g || !this.horPend || this.horGroup >= GROUPS) return;
    this.horGroup = this.drawHorizonGroups(g, this.horPend, this.horGroup, count, this.params?.obsH ?? 2);
    this.onStatus(this.horGroup < GROUPS ? `Ray-tracing horizons ${Math.round((100 * this.horGroup) / GROUPS)}%` : 'Horizons ready');
    if (this.horGroup >= GROUPS) {
      const t = this.horTex;
      this.horTex = this.horPend;
      this.horPend = t;
      this.grid = g;
      this.pendingGrid = null;
      this.intKey = '';
      this.featKey = '';
      this.antValid = false;
    }
  }

  private setAntState(s: AntennaPassState): void {
    const a = this.antState;
    const same =
      a.state === s.state && (a.state === 'off' || (a as { h: number }).h === (s as { h: number }).h) && (a.state !== 'computing' || (a as { pct: number }).pct === (s as { pct: number }).pct);
    if (same) return;
    this.antState = s;
    this.onAntenna(s);
  }

  /**
   * Earth share from the antenna height (ADR-122): a second horizon set on the current grid and a
   * second interval pass, only while requested (params.antH) and an Earth-using layer is shown.
   * Returns true while work remains.
   */
  private runAntenna(): boolean {
    const p = this.params!;
    const g = this.grid;
    const h = p.antH;
    if (h === null || h === p.obsH || !ANT_LAYERS.includes(p.layer) || !g || !this.horTex) {
      this.antValid = false;
      this.setAntState({ state: 'off' });
      return false;
    }
    const job = `${g.key}|${h}`;
    if (this.antDoneKey !== job) {
      this.antValid = false;
      const gl = this.gl;
      if (this.antJobKey !== job) {
        if (!this.antPend || this.antSize[0] !== g.nx || this.antSize[1] !== g.ny) {
          if (this.antPend) gl.deleteTexture(this.antPend);
          if (this.antHor) gl.deleteTexture(this.antHor);
          this.antPend = this.floatTex(g.nx, g.ny, gl.RGBA16F, GROUPS);
          this.antHor = null;
          this.antSize = [g.nx, g.ny];
        }
        this.antJobKey = job;
        this.antGroup = 0;
      }
      this.antGroup = this.drawHorizonGroups(g, this.antPend!, this.antGroup, 2, h);
      const pct = Math.round((100 * this.antGroup) / GROUPS);
      this.onStatus(this.antGroup < GROUPS ? `Ray-tracing horizons from the ${h} m antenna ${pct}%` : 'Antenna horizons ready');
      this.setAntState({ state: 'computing', h, pct });
      if (this.antGroup < GROUPS) return true;
      const t = this.antHor;
      this.antHor = this.antPend;
      this.antPend = t ?? this.floatTex(g.nx, g.ny, this.gl.RGBA16F, GROUPS);
      this.antDoneKey = job;
      this.intAntKey = '';
    }
    const [t0, t1] = p.interval;
    const key = `${job}|${t0}|${t1}|${p.dte}`;
    if (key !== this.intAntKey) {
      const K = this.prepEph(t0, t1);
      if (K === null) return true;
      this.ensureResultTex();
      this.drawInterval(g, this.antHor!, this.intAntTex!, h, p.dte, K, (t1 - t0) / (K - 1));
      this.intAntKey = key;
    }
    this.antValid = true;
    this.setAntState({ state: 'ready', h });
    return false;
  }

  private ensureResultTex(): void {
    const g = this.grid!;
    const gl = this.gl;
    const sizeKey = `${g.nx}x${g.ny}`;
    if (this.resultSize !== sizeKey) {
      if (this.intTex) gl.deleteTexture(this.intTex);
      if (this.featTex) gl.deleteTexture(this.featTex);
      if (this.intAntTex) gl.deleteTexture(this.intAntTex);
      this.intTex = this.floatTex(g.nx, g.ny, gl.RGBA32F);
      this.featTex = this.floatTex(g.nx, g.ny, gl.RGBA32F);
      this.intAntTex = this.floatTex(g.nx, g.ny, gl.RGBA32F);
      this.resultSize = sizeKey;
      this.intKey = '';
      this.featKey = '';
      this.intAntKey = '';
      this.antValid = false;
    }
  }

  /** Upload Sun/Earth positions for [t0, t1] (cached); K samples, or null while loading. */
  private prepEph(t0: number, t1: number): number | null {
    const k = `${t0}|${t1}`;
    if (k === this.ephKey) return this.ephK;
    if (!this.eph.isLoaded(t0) || !this.eph.isLoaded(t1)) {
      this.eph.ensureRange(t0, t1).then(() => this.onNeedRender());
      return null;
    }
    const K = Math.max(16, Math.min(2048, Math.ceil((t1 - t0) / 1800e3) + 1));
    const step = (t1 - t0) / (K - 1);
    const data = new Float32Array(K * 2 * 4);
    const v = new Float64Array(6);
    for (let i = 0; i < K; i++) {
      this.eph.at(t0 + i * step, v);
      const ds = Math.hypot(v[0], v[1], v[2]);
      const de = Math.hypot(v[3], v[4], v[5]);
      data.set([v[0], v[1], v[2], Math.asin(SUN_RADIUS_KM / ds)], i * 4);
      data.set([v[3], v[4], v[5], Math.asin(EARTH_RADIUS_KM / de)], (K + i) * 4);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.ephTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, K, 2, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.ephKey = k;
    this.ephK = K;
    return K;
  }

  private drawInterval(g: Grid, hor: WebGLTexture, out: WebGLTexture, obsH: number, dte: number, K: number, step: number): void {
    const gl = this.gl;
    const u = this.use(this.progs.interval);
    this.bindDem(u);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, hor);
    gl.uniform1i(u('uHor'), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ephTex);
    gl.uniform1i(u('uEph'), 3);
    gl.uniform4f(u('uGrid'), g.x0, g.yTop, g.sp, 0);
    gl.uniform2f(u('uGridSize'), g.nx, g.ny);
    gl.uniform1i(u('uK'), K);
    gl.uniform1f(u('uStepH'), step / 3600e3);
    gl.uniform1f(u('uDte'), dte);
    gl.uniform1f(u('uNaz'), NAZ);
    gl.uniform1f(u('uObsH'), obsH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, g.nx, g.ny);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private runInterval(): boolean {
    const p = this.params!;
    const g = this.grid!;
    const [t0, t1] = p.interval;
    const key = `${g.key}|${t0}|${t1}|${p.dte}|${p.obsH}`;
    if (key === this.intKey) return true;
    const K = this.prepEph(t0, t1);
    if (K === null) return false;
    this.ensureResultTex();
    this.drawInterval(g, this.horTex!, this.intTex!, p.obsH, p.dte, K, (t1 - t0) / (K - 1));
    this.intKey = key;
    this.gridValid = true;
    return true;
  }

  private runFeatures(): void {
    const p = this.params!;
    const g = this.grid!;
    const key = `${g.key}|${p.footprint}|${this.near?.uploads ?? 0}`;
    if (key === this.featKey) return;
    this.ensureResultTex();
    const gl = this.gl;
    const u = this.use(this.progs.feature);
    this.bindDem(u);
    gl.uniform4f(u('uGrid'), g.x0, g.yTop, g.sp, 0);
    gl.uniform1f(u('uFoot'), p.footprint);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.featTex, 0);
    gl.viewport(0, 0, g.nx, g.ny);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.featKey = key;
    this.featValid = true;
  }

  // ------------------------------------------------------------ frame
  render(fs: FrameLike): HTMLCanvasElement {
    const gl = this.gl;
    const p = this.params;
    const w = Math.round(fs.size[0] * fs.pixelRatio);
    const h = Math.round(fs.size[1] * fs.pixelRatio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (!p) return this.canvas;
    const interacting = fs.viewHints[0] > 0 || fs.viewHints[1] > 0;
    if (interacting) this.lastInteractAt = performance.now();
    this.updateNear(fs);
    if (this.near?.mipDirty && this.hw) {
      gl.bindTexture(gl.TEXTURE_2D, this.near.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.near.mipDirty = false;
    }
    let more = false;
    if (!interacting && performance.now() - this.lastInteractAt > 250) {
      this.wantGrid(fs);
      if (this.pendingGrid && this.horGroup < GROUPS) {
        this.runHorizonGroups(2);
        more = true;
      }
      if (this.grid && this.horTex && NEEDS_GRID.includes(p.layer)) {
        if (!this.runInterval()) more = true;
        else if (this.runAntenna()) more = true;
        if (p.layer === 'suit') this.runFeatures();
      }
    } else if (NEEDS_GRID.includes(p.layer)) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.onNeedRender(), 300);
    }
    // display
    const u = this.use(this.progs.display);
    this.bindDem(u);
    const v = this.eph.isLoaded(p.time) ? this.eph.at(p.time) : null;
    if (!v) this.eph.ensureRange(p.time, p.time + 3600e3).then(() => this.onNeedRender());
    const sx = v ? v[0] : 1e8;
    const sy = v ? v[1] : 0;
    const sz = v ? v[2] : 0;
    const ds = Math.hypot(sx, sy, sz);
    gl.uniform4f(u('uView'), fs.viewState.center[0], fs.viewState.center[1], fs.viewState.resolution / fs.pixelRatio, 0);
    gl.uniform2f(u('uCanvas'), w, h);
    gl.uniform1i(u('uLayer'), LAYER_ID[p.layer]);
    gl.uniform4f(u('uSun'), sx, sy, sz, Math.asin(SUN_RADIUS_KM / ds));
    gl.uniform1f(u('uFlux'), (AU_KM / ds) ** 2);
    gl.uniform1f(u('uExposure'), 22);
    gl.uniform1f(u('uAmbient'), p.lighting === 'enhanced' ? 0.09 : 0.0);
    gl.uniform1i(u('uShadows'), 1);
    gl.uniform1f(u('uShadowAlpha'), interacting ? 0.06 : 0.025);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.intTex);
    gl.uniform1i(u('uInt'), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.featTex);
    gl.uniform1i(u('uFeat'), 3);
    const g = this.grid;
    gl.uniform4f(u('uGrid'), g?.x0 ?? 0, g?.yTop ?? 0, g?.sp ?? 1, 0);
    gl.uniform2f(u('uGridSize'), g?.nx ?? 1, g?.ny ?? 1);
    gl.uniform1f(u('uGridValid'), this.gridValid && this.intTex ? 1 : 0);
    gl.uniform1f(u('uFeatValid'), this.featValid ? 1 : 0);
    gl.uniform4f(u('uW'), p.weights.illum, p.weights.dark, p.weights.earth, p.weights.slope);
    gl.uniform1f(u('uWRelief'), p.weights.relief);
    gl.uniform1f(u('uFootM'), p.footprint);
    gl.uniform1f(u('uSlopeLimit'), p.slopeLimit);
    gl.uniform1f(u('uDarkRef'), p.darkRef);
    // Earth share from the antenna pass for earth/suit when requested and ready (ADR-122)
    const antOn = this.antValid && !!this.intAntTex && ANT_LAYERS.includes(p.layer);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, antOn ? this.intAntTex : this.intTex);
    gl.uniform1i(u('uIntAnt'), 5);
    gl.uniform1f(u('uAntValid'), antOn ? 1 : 0);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.outerTex ?? this.farTex);
    gl.uniform1i(u('uOuter'), 4);
    gl.uniform4fv(u('uOuterRect'), this.outerRect);
    gl.uniform1f(u('uOuterMaxLod'), this.outerMaxLod);
    gl.uniform1f(u('uOuterValid'), this.outerTex ? 1 : 0);
    gl.uniform1f(u('uOuterRho'), this.outerRho);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (more) requestAnimationFrame(() => this.onNeedRender());
    return this.canvas;
  }

  // ------------------------------------------------------------ read-back
  private readTex(tex: WebGLTexture, x: number, y: number, w: number, h: number): Float32Array {
    const gl = this.gl;
    const out = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  /** Interval + feature values at map coordinate (x, y), when the analysis grid covers it. */
  valuesAt(x: number, y: number): { illum: number; earth: number; dark: number; power: number; slopeMax?: number; relief?: number; earthAntH?: number } | null {
    const g = this.grid;
    if (!g || !this.gridValid || !this.intTex) return null;
    const i = Math.floor((x - g.x0) / g.sp);
    const j = Math.floor((g.yTop - y) / g.sp);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
    const a = this.readTex(this.intTex, i, j, 1, 1);
    if (a[0] < 0) return null;
    const r: { illum: number; earth: number; dark: number; power: number; slopeMax?: number; relief?: number; earthAntH?: number } = { illum: a[0], earth: a[1], dark: a[2], power: a[3] };
    if (this.antValid && this.intAntTex && this.params && ANT_LAYERS.includes(this.params.layer)) {
      r.earth = this.readTex(this.intAntTex, i, j, 1, 1)[1];
      r.earthAntH = this.params.antH ?? undefined;
    }
    if (this.featValid && this.featTex) {
      const f = this.readTex(this.featTex, i, j, 1, 1);
      r.slopeMax = f[0];
      r.relief = f[2];
    }
    return r;
  }

  /** Top suitability candidates (non-maximum suppression) + competitor pool for robustness. */
  candidates(n = 8, poolSize = 400): { cands: { x: number; y: number; score: number; f: Features }[]; pool: { x: number; y: number; score: number; f: Features }[] } | null {
    const g = this.grid;
    const p = this.params;
    if (!g || !p || !this.gridValid || !this.featValid || !this.intTex || !this.featTex) return null;
    const A = this.readTex(this.intTex, 0, 0, g.nx, g.ny);
    const F = this.readTex(this.featTex, 0, 0, g.nx, g.ny);
    if (this.antValid && this.intAntTex && ANT_LAYERS.includes(p.layer)) {
      const E = this.readTex(this.intAntTex, 0, 0, g.nx, g.ny);
      for (let k = 0; k < g.nx * g.ny; k++) A[k * 4 + 1] = E[k * 4 + 1];
    }
    const all: { i: number; s: number }[] = [];
    const sc = new Float32Array(g.nx * g.ny).fill(-1);
    // only inside the high-res polar coverage (the 80°S circle); the grid is its bounding square
    const R2 = this.dem.maxRho * this.dem.maxRho;
    for (let k = 0; k < g.nx * g.ny; k++) {
      if (A[k * 4] < 0 || F[k * 4 + 3] <= -10000) continue;
      const cx = g.x0 + ((k % g.nx) + 0.5) * g.sp;
      const cy = g.yTop - (Math.floor(k / g.nx) + 0.5) * g.sp;
      if (cx * cx + cy * cy > R2) continue;
      const f: Features = { illum: A[k * 4], earth: A[k * 4 + 1], dark: A[k * 4 + 2], slopeMax: F[k * 4], slopeMean: F[k * 4 + 1], relief: F[k * 4 + 2] };
      const s = score(f, p.weights, p.footprint, p.slopeLimit, p.darkRef);
      sc[k] = s;
      if (s >= 0) all.push({ i: k, s });
    }
    all.sort((a, b) => b.s - a.s);
    const toObj = (k: number) => ({
      x: g.x0 + ((k % g.nx) + 0.5) * g.sp,
      y: g.yTop - (Math.floor(k / g.nx) + 0.5) * g.sp,
      score: sc[k],
      f: { illum: A[k * 4], earth: A[k * 4 + 1], dark: A[k * 4 + 2], slopeMax: F[k * 4], slopeMean: F[k * 4 + 1], relief: F[k * 4 + 2] },
    });
    const minSep = Math.max(3, Math.round(Math.min(g.nx, g.ny) / 12));
    const chosen: number[] = [];
    for (const c of all) {
      if (chosen.length >= n) break;
      const ci = c.i % g.nx;
      const cj = Math.floor(c.i / g.nx);
      if (chosen.every((k) => Math.hypot((k % g.nx) - ci, Math.floor(k / g.nx) - cj) >= minSep)) chosen.push(c.i);
    }
    return { cands: chosen.map(toObj), pool: all.slice(0, poolSize).map((c) => toObj(c.i)) };
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
