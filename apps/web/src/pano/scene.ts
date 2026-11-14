// First-person panorama (ADR-012): LOLA heightfield mesh in the site's local ENU frame,
// fragment-shader ray-marched soft shadows (finite solar disk) + far-field occlusion
// from the site horizon profile, Sun/Earth discs at true angular size (Earth with phase),
// procedural stars rotating with the Moon, procedural regolith texture (labelled synthetic).
import * as THREE from 'three';
import type { Ephemeris } from '../core/ephemeris';
import { EARTH_RADIUS_KM, R_MOON_KM, R_MOON_M, SUN_RADIUS_KM, AU_KM, enuAt, latLonToUnit, type Enu } from '../core/geo';
import type { HorizonProfile } from '../core/horizon';
import type { DemClient } from '../data/dem';
import { mulberry32 } from '../core/suitability';
import { config, PANO_AA_SIGMA_ORIGINAL } from '../config';

export interface PanoSite {
  x: number;
  y: number;
  lat: number;
  lon: number;
  hTerrain: number;
}

const FINE_N = 1024;
const COARSE_N = 1024;
const SKY_D = 50000;

const terrainVert = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const terrainFrag = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform sampler2D uFine; uniform float uFineHalf;
uniform sampler2D uCoarse; uniform float uCoarseHalf;
uniform sampler2D uFarH;
uniform vec3 uSun; uniform float uSunR; uniform float uFlux;
uniform vec3 uEarth; uniform float uEarthPhase;
uniform float uAmbient; uniform float uExposure; uniform vec3 uCam;
uniform float uAA;   // prefilter width: multiplier of the pixel footprint (1 = original; = sigma / 0.5)
const float TAU = 6.28318530718;
const float PI = 3.14159265359;
float hf(vec2 en) {
  vec2 a = abs(en);
  if (max(a.x, a.y) < uFineHalf * 0.995) { vec2 uv = en / uFineHalf * 0.5 + 0.5; return texture2D(uFine, vec2(uv.x, 1.0 - uv.y)).r; }
  vec2 uv = clamp(en / uCoarseHalf * 0.5 + 0.5, 0.0, 1.0);
  return texture2D(uCoarse, vec2(uv.x, 1.0 - uv.y)).r;
}
float edgeFrac(float z) { z = clamp(z, -1.0, 1.0); return 1.0 - (acos(z) - z * sqrt(1.0 - z * z)) / PI; }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 x) { vec2 i = floor(x); vec2 f = fract(x); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float regolith(vec2 p, float px) {
  float v = 0.0, amp = 0.5, wl = 64.0;
  for (int i = 0; i < 9; i++) { float vis = smoothstep(1.5 * px, 4.0 * px, wl); v += amp * vis * (vnoise(p / wl + float(i) * 7.3) - 0.5); wl *= 0.5; amp *= 0.6; }
  return v;
}
void main() {
  vec2 en = vec2(vPos.x, -vPos.z);
  float dist = length(vPos - uCam);
  float px = max(0.01, dist * 0.0012 * uAA);
  float d = max(0.5, px);
  vec2 g = vec2(hf(en + vec2(d, 0.0)) - hf(en - vec2(d, 0.0)), hf(en + vec2(0.0, d)) - hf(en - vec2(0.0, d))) / (2.0 * d);
  float e = max(px, 0.02);
  float n0 = regolith(en, px);
  vec2 bump = vec2(regolith(en + vec2(e, 0.0), px) - n0, regolith(en + vec2(0.0, e), px) - n0) / e * 0.35;
  vec3 nE = normalize(vec3(-(g.x + bump.x), -(g.y + bump.y), 1.0));      // (e, n, u)
  vec3 s = normalize(vec3(uSun.x, -uSun.z, uSun.y));                       // world → ENU
  float lambert = max(dot(nE, s), 0.0);
  float sunEl = asin(clamp(s.z, -1.0, 1.0));
  bool sunUp = lambert > 0.0 && sunEl + uSunR > -0.05;
  float z = -1.0;   // (sunEl - occluder) / sun radius, clamped; -1 = fully hidden
  if (sunUp) {
    vec2 dir = normalize(s.xy);
    float tanStop = tan(sunEl + uSunR * 1.2);
    float best = -1e6;
    float t = 1.5;
    float base = vPos.y + 0.25;
    for (int i = 0; i < 280; i++) {
      vec2 q = en + dir * t;
      if (max(abs(q.x), abs(q.y)) > uCoarseHalf) break;
      best = max(best, (hf(q) - base) / t);
      if (best > tanStop) break;
      t += max(0.75, t * 0.035);
    }
    float az = atan(s.x, s.y);
    float farEl = texture2D(uFarH, vec2(fract(az / TAU), 0.5)).r;
    z = clamp((sunEl - max(atan(best), farEl)) / uSunR, -1.0, 1.0);
  }
  // analytic shadow-edge AA: where the edge is sharper than ~uAA pixels on screen, widen the
  // disk-occlusion transition to that width; resolvable physical penumbrae are untouched.
  // fwidth must run in uniform control flow, hence outside the branch above.
  float w = max(1.0, 0.5 * uAA * fwidth(z));
  float fS = sunUp ? edgeFrac(z / w) : 0.0;
  float slope = degrees(acos(clamp(normalize(vec3(-g, 1.0)).z, -1.0, 1.0)));
  float albedo = 0.12 * (1.0 + 0.45 * n0) * (1.0 + 0.2 * smoothstep(15.0, 35.0, slope));
  vec3 eDir = normalize(vec3(uEarth.x, -uEarth.z, uEarth.y));
  float earthshine = 2.0e-4 * uEarthPhase * max(dot(nE, eDir), 0.0);
  vec2 sh = length(s.xy) > 1e-6 ? normalize(s.xy) : vec2(0.0, 1.0);
  float fill = uAmbient * (0.3 + 0.7 * max(dot(nE, vec3(-sh * 0.819, 0.574)), 0.0));
  float rad = albedo * (lambert * fS * uFlux + fill + earthshine);
  vec3 col = vec3(1.0 - exp(-uExposure * rad)) * vec3(1.0, 0.985, 0.965);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

const discVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const sunFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uDiscFrac;   // disc radius as a fraction of the quad half-size
void main() {
  float r = length(vUv);
  float disc = 1.0 - smoothstep(uDiscFrac * 0.97, uDiscFrac, r);
  float glare = (0.55 * exp(-(r / uDiscFrac - 1.0) * 0.9) + 0.25 * exp(-(r / uDiscFrac - 1.0) * 0.25)) * step(uDiscFrac, r);
  float limb = 0.75 + 0.25 * sqrt(max(0.0, 1.0 - (r / uDiscFrac) * (r / uDiscFrac)));
  vec3 c = vec3(1.0, 0.97, 0.9) * disc * limb + vec3(1.0, 0.85, 0.6) * glare;
  float a = max(disc, glare);
  if (a < 0.003) discard;
  gl_FragColor = vec4(c, a);
}`;

const earthFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uLight;   // Sun direction (from Earth) in the quad frame (x right, y up, z towards viewer)
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 x) { vec2 i = floor(x); vec2 f = fract(x); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec3 n = vec3(vUv, sqrt(1.0 - r2));
  float lit = smoothstep(-0.03, 0.08, dot(n, normalize(uLight)));
  float cloud = smoothstep(0.55, 0.8, vnoise(vUv * 4.0 + 3.1) * 0.6 + vnoise(vUv * 9.0) * 0.4);
  vec3 base = mix(vec3(0.05, 0.18, 0.45), vec3(0.15, 0.32, 0.18), smoothstep(0.55, 0.7, vnoise(vUv * 3.0 + 11.0)));
  vec3 c = mix(base, vec3(0.95), cloud) * lit + vec3(0.02, 0.03, 0.06) * (1.0 - lit);
  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

const SRGB = /* glsl */ `
vec3 srgbEncode(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }`;
const starVert = /* glsl */ `
attribute vec3 color;
uniform float uSize;
varying vec3 vCol;
void main() { vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`;
const starFrag = /* glsl */ `
precision highp float;
varying vec3 vCol;
${SRGB}
void main() { gl_FragColor = vec4(srgbEncode(vCol), 1.0); }`;
const skirtVert = /* glsl */ `
attribute vec3 color;
varying vec3 vCol;
void main() { vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skirtFrag = starFrag;

// Anti-aliasing resolve (separable Gaussian, one axis per pass). Source texels are fetched exactly;
// weights use the distance from the destination pixel centre mapped into source texel space.
const resolveVert = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const resolveFrag = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform vec2 uDstSize;
uniform vec2 uAxis;       // (1,0) horizontal or (0,1) vertical
uniform float uSigma;     // in source texels
uniform int uRadius;      // taps each side
uniform int uDecode;      // source is sRGB-encoded
uniform int uEncode;      // write sRGB-encoded
${SRGB}
vec3 srgbDecode(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec2 sp = gl_FragCoord.xy * uSrcSize / uDstSize;      // destination pixel centre in source texel coords
  float c = dot(sp, uAxis);
  float base = floor(c - 0.5);
  ivec2 other = ivec2(floor(sp * (1.0 - uAxis)));
  ivec2 mx = ivec2(uSrcSize) - 1;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = -24; k <= 25; k++) {
    if (k < -uRadius || k > uRadius + 1) continue;
    float t = base + float(k);
    float d = t + 0.5 - c;
    float w = exp(-0.5 * d * d / (uSigma * uSigma));
    ivec2 ij = clamp(other + ivec2(uAxis) * int(t), ivec2(0), mx);
    vec3 v = texelFetch(uSrc, ij, 0).rgb;
    acc += w * (uDecode == 1 ? srgbDecode(v) : v);
    wsum += w;
  }
  vec3 col = acc / wsum;
  gl_FragColor = vec4(uEncode == 1 ? srgbEncode(col) : col, 1.0);
}`;

/** Supersampled frame budget (render-target pixels) and maximum per-axis supersampling. */
const SS_BUDGET_PX = 8.3e6;
const SS_MAX = 2;

export interface PanoState {
  sunAz: number;
  sunEl: number;
  earthAz: number;
  earthEl: number;
  earthPhase: number;
  heading: number;
}

export class PanoScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private enu: Enu;
  private k: number;
  private eG: [number, number];
  private nG: [number, number];
  private fine: Float32Array | null = null;
  private coarse: Float32Array | null = null;
  private fineHalf = 2560;
  private coarseHalf = 10240;
  private terrainMat: THREE.ShaderMaterial;
  private sun: THREE.Mesh;
  private earth: THREE.Mesh;
  private stars: THREE.Points;
  private skirt: THREE.Mesh | null = null;
  eyeHeight = 2;
  yaw = 0;
  pitch = 0.02;
  pos = new THREE.Vector2(0, 0); // (e, n) metres from the site
  ambient = 0.03;
  /** AA Gaussian sigma in CSS px (config); <= PANO_AA_SIGMA_ORIGINAL renders directly (original path). */
  readonly aaSigma = config.panoAASigma;
  private rtScene: THREE.WebGLRenderTarget | null = null;
  private rtPass: THREE.WebGLRenderTarget | null = null;
  private resolveMat: THREE.ShaderMaterial | null = null;
  private resolveScene: THREE.Scene | null = null;
  private resolveCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  state: PanoState = { sunAz: 0, sunEl: 0, earthAz: 0, earthEl: 0, earthPhase: 0, heading: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    private dem: DemClient,
    private eph: Ephemeris,
    readonly site: PanoSite,
    private profile: HorizonProfile,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 1);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 60000);
    this.enu = enuAt(site.lat, site.lon);
    this.k = 1 + (site.x * site.x + site.y * site.y) / (4 * R_MOON_M * R_MOON_M);
    const lon = Math.atan2(site.x, site.y);
    this.eG = [Math.cos(lon), -Math.sin(lon)];
    this.nG = [Math.sin(lon), Math.cos(lon)];
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: terrainVert,
      fragmentShader: terrainFrag,
      uniforms: {
        uFine: { value: null },
        uFineHalf: { value: this.fineHalf },
        uCoarse: { value: null },
        uCoarseHalf: { value: this.coarseHalf },
        uFarH: { value: null },
        uSun: { value: new THREE.Vector3(0, 0.01, -1) },
        uSunR: { value: 0.0046 },
        uFlux: { value: 1 },
        uEarth: { value: new THREE.Vector3(0, 0.1, -1) },
        uEarthPhase: { value: 0.5 },
        uAmbient: { value: 0.03 },
        uExposure: { value: 11 },
        uCam: { value: new THREE.Vector3() },
        uAA: { value: Math.max(0.25, this.aaSigma / PANO_AA_SIGMA_ORIGINAL) },
      },
    });
    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ vertexShader: discVert, fragmentShader: sunFrag, uniforms: { uDiscFrac: { value: 0.12 } }, transparent: true, depthWrite: false }),
    );
    this.earth = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ vertexShader: discVert, fragmentShader: earthFrag, uniforms: { uLight: { value: new THREE.Vector3(1, 0, 0) } }, depthWrite: false }),
    );
    this.stars = this.makeStars();
    this.scene.add(this.stars, this.sun, this.earth);
  }

  /** SPS grid coordinates of local (e, n). */
  private toGrid(e: number, n: number): [number, number] {
    return [this.site.x + this.k * (e * this.eG[0] + n * this.nG[0]), this.site.y + this.k * (e * this.eG[1] + n * this.nG[1])];
  }

  private async sampleField(half: number, n: number, onProgress?: (f: number) => void): Promise<Float32Array> {
    const sp = (2 * half) / n;
    const z = this.dem.levelFor(sp);
    // tiles needed: bounding box of the rotated square
    const corners = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ].map(([e, nn]) => this.toGrid(e, nn));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const list: number[][] = [];
    for (let zz = z; zz >= Math.max(0, z - 4); zz--) {
      const [a, b] = this.dem.tileOf(zz, Math.min(...xs), Math.max(...ys));
      const [c, d] = this.dem.tileOf(zz, Math.max(...xs), Math.min(...ys));
      let any = false;
      for (let tx = a; tx <= c; tx++)
        for (let ty = b; ty <= d; ty++)
          if (this.dem.hasTile(zz, tx, ty)) {
            list.push([zz, tx, ty]);
            any = true;
          }
      if (any && zz < z - 1) break;
    }
    await this.dem.loadAll(list, 8, 'dem', (dn, tot) => onProgress?.(dn / tot));
    const out = new Float32Array(n * n);
    for (let r = 0; r < n; r++) {
      const nn = half - (r + 0.5) * sp;
      for (let c = 0; c < n; c++) {
        const e = -half + (c + 0.5) * sp;
        const [x, y] = this.toGrid(e, nn);
        const h = this.dem.height(x, y, sp);
        out[r * n + c] = (Number.isFinite(h) ? h : this.site.hTerrain) - this.site.hTerrain - (e * e + nn * nn) / (2 * R_MOON_M);
      }
    }
    return out;
  }

  private static tex(data: Float32Array, n: number): THREE.DataTexture {
    const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  heightAt(e: number, n: number): number {
    const f = this.fine;
    const half = Math.abs(e) < this.fineHalf * 0.99 && Math.abs(n) < this.fineHalf * 0.99 ? this.fineHalf : this.coarseHalf;
    const data = half === this.fineHalf ? f : this.coarse;
    const N = half === this.fineHalf ? FINE_N : COARSE_N;
    if (!data) return 0;
    const sp = (2 * half) / N;
    const fc = (e + half) / sp - 0.5;
    const fr = (half - n) / sp - 0.5;
    const c0 = Math.max(0, Math.min(N - 2, Math.floor(fc)));
    const r0 = Math.max(0, Math.min(N - 2, Math.floor(fr)));
    const wx = Math.min(1, Math.max(0, fc - c0));
    const wy = Math.min(1, Math.max(0, fr - r0));
    const i = r0 * N + c0;
    return (data[i] * (1 - wx) + data[i + 1] * wx) * (1 - wy) + (data[i + N] * (1 - wx) + data[i + N + 1] * wx) * wy;
  }

  async build(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Loading 5 m terrain…');
    this.fine = await this.sampleField(this.fineHalf, FINE_N, (f) => onProgress?.(`Loading near terrain ${Math.round(f * 100)}%`));
    this.coarse = await this.sampleField(this.coarseHalf, COARSE_N, (f) => onProgress?.(`Loading surroundings ${Math.round(f * 100)}%`));
    const u = this.terrainMat.uniforms;
    u.uFine.value = PanoScene.tex(this.fine, FINE_N);
    u.uCoarse.value = PanoScene.tex(this.coarse, COARSE_N);
    const far = this.profile.elevFar ?? this.profile.elev;
    const farRad = new Float32Array(far.length);
    for (let i = 0; i < far.length; i++) farRad[i] = (far[i] * Math.PI) / 180;
    const ft = new THREE.DataTexture(farRad, far.length, 1, THREE.RedFormat, THREE.FloatType);
    ft.magFilter = ft.minFilter = THREE.LinearFilter;
    ft.wrapS = THREE.RepeatWrapping;
    ft.needsUpdate = true;
    u.uFarH.value = ft;
    onProgress?.('Building mesh…');
    this.scene.add(this.makeTerrainMesh());
    this.skirt = this.makeSkirt(far);
    this.scene.add(this.skirt);
    onProgress?.('');
  }

  private makeTerrainMesh(): THREE.Mesh {
    const N = 640;
    const S = this.coarseHalf * 0.98;
    const a = 4.2;
    const coord = (i: number) => (S * Math.sinh(a * ((2 * i) / (N - 1) - 1))) / Math.sinh(a);
    const pos = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) {
      const n = coord(j);
      for (let i = 0; i < N; i++) {
        const e = coord(i);
        const k = (j * N + i) * 3;
        pos[k] = e;
        pos[k + 1] = this.heightAt(e, n);
        pos[k + 2] = -n;
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let p = 0;
    for (let j = 0; j < N - 1; j++)
      for (let i = 0; i < N - 1; i++) {
        const a0 = j * N + i;
        // counter-clockwise seen from above (+Y): normals point up
        idx[p++] = a0;
        idx[p++] = a0 + 1;
        idx[p++] = a0 + N;
        idx[p++] = a0 + 1;
        idx[p++] = a0 + N + 1;
        idx[p++] = a0 + N;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.terrainMat);
    m.frustumCulled = false;
    return m;
  }

  /** Distant terrain beyond the mesh, drawn as a silhouette ring at the far-horizon elevation. */
  private makeSkirt(farDeg: Float32Array): THREE.Mesh {
    const n = farDeg.length;
    const D = 30000;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const col = new Float32Array((n + 1) * 2 * 3);
    for (let i = 0; i <= n; i++) {
      const az = ((i % n) / n) * Math.PI * 2;
      const el = Math.max(-5, farDeg[i % n]) * (Math.PI / 180);
      const e = Math.sin(az) * D;
      const nn = Math.cos(az) * D;
      const top = D * Math.tan(el) + this.eyeHeight;
      pos.set([e, top, -nn, e, -D * 0.12, -nn], i * 6);
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: skirtVert, fragmentShader: skirtFrag, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    return m;
  }

  private makeStars(): THREE.Points {
    const rnd = mulberry32(7);
    const n = 5000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(t) * SKY_D, r * Math.sin(t) * SKY_D, z * SKY_D], i * 3);
      const b = Math.pow(rnd(), 6) * 0.9 + 0.08;
      const tint = rnd();
      col.set([b * (0.85 + 0.15 * tint), b * 0.9, b * (1.05 - 0.15 * tint)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const p = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: starVert, fragmentShader: starFrag, uniforms: { uSize: { value: 1.6 } }, depthWrite: false }));
    p.matrixAutoUpdate = false;
    p.frustumCulled = false;
    return p;
  }

  /** MOON_ME direction → three world (x = E, y = U, z = −N). */
  private toWorld(v: [number, number, number]): THREE.Vector3 {
    const e = v[0] * this.enu.east[0] + v[1] * this.enu.east[1] + v[2] * this.enu.east[2];
    const n = v[0] * this.enu.north[0] + v[1] * this.enu.north[1] + v[2] * this.enu.north[2];
    const u = v[0] * this.enu.up[0] + v[1] * this.enu.up[1] + v[2] * this.enu.up[2];
    return new THREE.Vector3(e, u, -n);
  }

  update(t: number, ambient: number): void {
    if (!this.eph.isLoaded(t)) return;
    const v = this.eph.at(t);
    const up = latLonToUnit(this.site.lat, this.site.lon);
    const rk = R_MOON_KM + (this.site.hTerrain + this.eyeHeight) / 1000;
    const P: [number, number, number] = [up[0] * rk, up[1] * rk, up[2] * rk];
    const s: [number, number, number] = [v[0] - P[0], v[1] - P[1], v[2] - P[2]];
    const e: [number, number, number] = [v[3] - P[0], v[4] - P[1], v[5] - P[2]];
    const ds = Math.hypot(...s);
    const de = Math.hypot(...e);
    const sw = this.toWorld(s).normalize();
    const ew = this.toWorld(e).normalize();
    const rS = Math.asin(SUN_RADIUS_KM / ds);
    const rE = Math.asin(EARTH_RADIUS_KM / de);
    const u = this.terrainMat.uniforms;
    u.uSun.value.copy(sw);
    u.uSunR.value = rS;
    u.uFlux.value = (AU_KM / ds) ** 2;
    u.uEarth.value.copy(ew);
    u.uAmbient.value = ambient;
    // Earth phase: angle at Earth between Sun and observer
    const es: [number, number, number] = [v[0] - v[3], v[1] - v[4], v[2] - v[5]];
    const cosA = -(e[0] * es[0] + e[1] * es[1] + e[2] * es[2]) / (de * Math.hypot(...es));
    const phase = (1 + cosA) / 2;
    u.uEarthPhase.value = phase;
    // discs at true angular size (quad = 8 radii for glare)
    const place = (m: THREE.Mesh, dir: THREE.Vector3, r: number, quadRadii: number) => {
      m.position.copy(this.camera.position).addScaledVector(dir, SKY_D * 0.95);
      const size = 2 * SKY_D * 0.95 * Math.tan(r * quadRadii);
      m.scale.set(size, size, 1);
      m.lookAt(this.camera.position);
    };
    place(this.sun, sw, rS, 24);
    (this.sun.material as THREE.ShaderMaterial).uniforms.uDiscFrac.value = 1 / 24;
    place(this.earth, ew, rE, 1);
    // Sun direction seen from Earth, expressed in the Earth quad's frame
    this.earth.updateMatrixWorld();
    const sunFromEarth = this.toWorld(es).normalize();
    const inv = new THREE.Matrix4().copy(this.earth.matrixWorld).invert();
    const l = sunFromEarth.clone().transformDirection(inv);
    (this.earth.material as THREE.ShaderMaterial).uniforms.uLight.value.copy(l);
    // stars: inertial directions rotating with the Moon (sidereal month), mapped to ENU
    const theta = (-2 * Math.PI * (t / 86400e3)) / 27.321661;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const E = this.enu.east;
    const N = this.enu.north;
    const U = this.enu.up;
    // world = M_enu · Rz(theta) · p   (p in a Moon-fixed frame at t = 0)
    const rz = (a: number[]) => [a[0] * c - a[1] * sn, a[0] * sn + a[1] * c, a[2]];
    const ex = rz([1, 0, 0]);
    const ey = rz([0, 1, 0]);
    const ez = [0, 0, 1];
    const col = (b: number[]) => [b[0] * E[0] + b[1] * E[1] + b[2] * E[2], b[0] * U[0] + b[1] * U[1] + b[2] * U[2], -(b[0] * N[0] + b[1] * N[1] + b[2] * N[2])];
    const X = col(ex);
    const Y = col(ey);
    const Z = col(ez);
    this.stars.matrix.set(X[0], Y[0], Z[0], this.camera.position.x, X[1], Y[1], Z[1], this.camera.position.y, X[2], Y[2], Z[2], this.camera.position.z, 0, 0, 0, 1);
    this.stars.matrixWorldNeedsUpdate = true;
    // far silhouette shading: lit when the Sun shines from behind the observer
    if (this.skirt) {
      const colAttr = this.skirt.geometry.getAttribute('color') as THREE.BufferAttribute;
      const sunAz = Math.atan2(sw.x, -sw.z);
      const sunUp = Math.asin(Math.max(-1, Math.min(1, sw.y)));
      const n = colAttr.count / 2 - 1;
      for (let i = 0; i <= n; i++) {
        const az = ((i % n) / n) * Math.PI * 2;
        const lit = Math.max(0, -Math.cos(az - sunAz)) * (sunUp > -0.02 ? 1 : 0);
        const g = 0.02 + 0.3 * lit;
        colAttr.setXYZ(i * 2, g, g * 0.98, g * 0.95);
        colAttr.setXYZ(i * 2 + 1, g * 0.4, g * 0.4, g * 0.4);
      }
      colAttr.needsUpdate = true;
    }
    const azOf = (w: THREE.Vector3) => ((Math.atan2(w.x, -w.z) * 180) / Math.PI + 360) % 360;
    this.state = {
      sunAz: azOf(sw),
      sunEl: (Math.asin(sw.y) * 180) / Math.PI,
      earthAz: azOf(ew),
      earthEl: (Math.asin(ew.y) * 180) / Math.PI,
      earthPhase: phase,
      heading: ((this.yaw * 180) / Math.PI + 360) % 360,
    };
  }

  /** Walk on the terrain (clamped to the 5 m field). */
  move(forward: number, strafe: number, dt: number, fast: boolean): void {
    const v = (fast ? 25 : 1.4) * dt;
    const fx = Math.sin(this.yaw);
    const fy = Math.cos(this.yaw);
    this.pos.x += (fx * forward + fy * strafe) * v;
    this.pos.y += (fy * forward - fx * strafe) * v;
    const lim = this.fineHalf - 50;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.y = Math.max(-lim, Math.min(lim, this.pos.y));
  }

  render(width: number, height: number): void {
    const r = this.renderer;
    const cw = r.domElement.width / r.getPixelRatio();
    if (Math.abs(cw - width) > 1 || Math.abs(r.domElement.height / r.getPixelRatio() - height) > 1) {
      r.setSize(width, height, false);
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
    }
    const h = this.heightAt(this.pos.x, this.pos.y);
    this.camera.position.set(this.pos.x, h + this.eyeHeight, -this.pos.y);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this.terrainMat.uniforms.uCam.value.copy(this.camera.position);
    const dpr = r.getPixelRatio();
    const W = r.domElement.width;
    const H = r.domElement.height;
    if (this.aaSigma <= PANO_AA_SIGMA_ORIGINAL || W < 2 || H < 2) {
      (this.stars.material as THREE.ShaderMaterial).uniforms.uSize.value = 1.6 * dpr;
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      return;
    }
    // supersample (≤ SS_MAX per axis, within the pixel budget), then resolve with a Gaussian of
    // sigma = aaSigma CSS px: horizontal pass into rtPass (dst width × src height), vertical to canvas
    const ss = Math.max(1, Math.min(SS_MAX, Math.sqrt(SS_BUDGET_PX / (W * H))));
    const sw = Math.round(W * ss);
    const sh = Math.round(H * ss);
    this.ensureTargets(sw, sh, W);
    (this.stars.material as THREE.ShaderMaterial).uniforms.uSize.value = 1.6 * dpr * ss;
    r.setRenderTarget(this.rtScene);
    r.render(this.scene, this.camera);
    const sigmaSrc = this.aaSigma * dpr * ss;
    const radius = Math.min(24, Math.ceil(3 * sigmaSrc));
    const u = this.resolveMat!.uniforms;
    u.uSigma.value = sigmaSrc;
    u.uRadius.value = radius;
    u.uSrc.value = this.rtScene!.texture;
    u.uSrcSize.value.set(sw, sh);
    u.uDstSize.value.set(W, sh);
    u.uAxis.value.set(1, 0);
    u.uDecode.value = 1;
    u.uEncode.value = 0;
    r.setRenderTarget(this.rtPass);
    r.render(this.resolveScene!, this.resolveCam);
    u.uSrc.value = this.rtPass!.texture;
    u.uSrcSize.value.set(W, sh);
    u.uDstSize.value.set(W, H);
    u.uAxis.value.set(0, 1);
    u.uSigma.value = sigmaSrc; // vertical source spacing is still the supersampled one
    u.uDecode.value = 0;
    u.uEncode.value = 1;
    r.setRenderTarget(null);
    r.render(this.resolveScene!, this.resolveCam);
  }

  private ensureTargets(sw: number, sh: number, W: number): void {
    if (!this.rtScene) {
      this.rtScene = new THREE.WebGLRenderTarget(sw, sh, { samples: 4, depthBuffer: true });
      this.rtPass = new THREE.WebGLRenderTarget(W, sh, { type: THREE.HalfFloatType, depthBuffer: false });
      for (const t of [this.rtScene.texture, this.rtPass.texture]) {
        t.minFilter = t.magFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
      }
      this.resolveMat = new THREE.ShaderMaterial({
        vertexShader: resolveVert,
        fragmentShader: resolveFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uSrc: { value: null },
          uSrcSize: { value: new THREE.Vector2() },
          uDstSize: { value: new THREE.Vector2() },
          uAxis: { value: new THREE.Vector2(1, 0) },
          uSigma: { value: 1 },
          uRadius: { value: 3 },
          uDecode: { value: 0 },
          uEncode: { value: 0 },
        },
      });
      this.resolveScene = new THREE.Scene();
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolveMat);
      quad.frustumCulled = false;
      this.resolveScene.add(quad);
    }
    if (this.rtScene.width !== sw || this.rtScene.height !== sh) this.rtScene.setSize(sw, sh);
    if (this.rtPass!.width !== W || this.rtPass!.height !== sh) this.rtPass!.setSize(W, sh);
  }

  lookAtAzimuth(azDeg: number): void {
    this.yaw = (azDeg * Math.PI) / 180;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    this.rtScene?.dispose();
    this.rtPass?.dispose();
    this.resolveMat?.dispose();
    this.renderer.dispose();
  }
}
