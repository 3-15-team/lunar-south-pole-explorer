// Warm-up fly-in (≤ 10 s, skippable, honours prefers-reduced-motion). A procedural Moon
// (ray-cast sphere, synthetic albedo) lit by the REAL Sun direction at the playhead time;
// the map loads behind it, so this doubles as a loading screen.
import { useEffect, useRef, useState } from 'preact/hooks';
import { services, time, warmupDone } from '../state/store';

const DURATION = 9000;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uT; uniform vec3 uSun; uniform vec3 uCam; uniform vec3 uLook; uniform vec3 uUp;
out vec4 o;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * n3(p); p *= 2.03; a *= 0.5; } return v; }
float craters(vec3 p) {
  float h = 0.0;
  for (int s = 0; s < 3; s++) {
    float sc = 6.0 * pow(2.6, float(s));
    vec3 q = p * sc; vec3 c = floor(q);
    for (int k = 0; k < 27; k++) {
      vec3 o3 = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0;
      vec3 cc = c + o3; vec3 cp = cc + vec3(h3(cc), h3(cc + 3.1), h3(cc + 7.7));
      float r = 0.25 + 0.3 * h3(cc + 1.3);
      float d = length(q - cp) / r;
      if (d < 1.4) h += (d < 1.0 ? (d * d - 1.0) * 0.6 : 0.25 * (1.0 - smoothstep(1.0, 1.4, d))) / sc;
    }
  }
  return h;
}
float terrain(vec3 n) { return 0.004 * fbm(n * 8.0) + 0.02 * craters(n); }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 fw = normalize(uLook - uCam);
  vec3 rt = normalize(cross(fw, uUp));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.6 + uv.x * rt + uv.y * up);
  // stars
  vec3 sd = rd * 220.0; vec3 sc = floor(sd);
  float star = step(0.9965, h3(sc)) * smoothstep(0.35, 0.0, length(fract(sd) - 0.5)) * h3(sc + 2.0);
  vec3 col = vec3(star);
  // moon (unit sphere)
  float b = dot(uCam, rd); float c = dot(uCam, uCam) - 1.0; float disc = b * b - c;
  if (disc > 0.0) {
    float t = -b - sqrt(disc);
    if (t > 0.0) {
      vec3 p = uCam + rd * t; vec3 n = normalize(p);
      float e = 0.003;
      vec3 tx = normalize(cross(n, vec3(0.0, 0.0, 1.0) + 0.001)); vec3 ty = cross(n, tx);
      float h0 = terrain(n);
      vec3 gn = normalize(n - (tx * (terrain(normalize(n + tx * e)) - h0) + ty * (terrain(normalize(n + ty * e)) - h0)) / e * 1.5);
      float mare = smoothstep(0.55, 0.62, fbm(n * 2.2 + 4.0));
      float alb = mix(0.17, 0.09, mare) * (0.85 + 0.3 * fbm(n * 30.0));
      float lam = max(dot(gn, uSun), 0.0);
      col = vec3(alb * lam * 6.0 + 0.004);
      // highlight the south-polar study region (80°S–90°S)
      float ring = smoothstep(0.004, 0.0, abs(n.z + 0.9848)) * 0.6;
      col += vec3(1.0, 0.83, 0.37) * ring * uT;
    }
  }
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

const CAPTIONS = [
  { at: 0, text: ['The lunar south pole', 'Water ice in eternal shadow — and peaks in near-eternal light.'] },
  { at: 3000, text: ['The Sun never rises more than 1.5°', 'Ridges 50 km away decide when a lander sees the Sun and the Earth.'] },
  { at: 6000, text: ['Pick a site. Pick a date.', 'See how much light and Earth contact you get — and what a slip changes.'] },
];

export default function Warmup() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [cap, setCap] = useState(0);
  const [out, setOut] = useState(false);

  const finish = () => {
    setOut(true);
    setTimeout(() => (warmupDone.value = true), 700);
  };

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      warmupDone.value = true;
      return;
    }
    const c = ref.current!;
    const gl = c.getContext('webgl2');
    if (!gl) {
      warmupDone.value = true;
      return;
    }
    const sh = (t: number, s: string) => {
      const x = gl.createShader(t)!;
      gl.shaderSource(x, s);
      gl.compileShader(x);
      return x;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nconst vec2 P[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));void main(){gl_Position=vec4(P[gl_VertexID],0,1);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      warmupDone.value = true;
      return;
    }
    gl.useProgram(pr);
    gl.bindVertexArray(gl.createVertexArray());
    const U = (n: string) => gl.getUniformLocation(pr, n);
    const t0 = performance.now();
    let raf = 0;
    const sunDir = (): [number, number, number] => {
      const e = services.eph;
      if (e && e.isLoaded(time.peek())) {
        const v = e.at(time.peek());
        const l = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / l, v[1] / l, v[2] / l];
      }
      return [0.6, 0.8, -0.02];
    };
    const frame = (now: number) => {
      const el = now - t0;
      const t = Math.min(1, el / DURATION);
      const k = t * t * (3 - 2 * t);
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.round(c.clientWidth * dpr);
      const h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      gl.viewport(0, 0, w, h);
      // camera: from an oblique near-side view down to above the south pole
      const a0 = [Math.cos(-0.45), 0, Math.sin(-0.45)];
      const a1 = [0.02, 0, -1];
      const d = [a0[0] + (a1[0] - a0[0]) * k, a0[1] + (a1[1] - a0[1]) * k, a0[2] + (a1[2] - a0[2]) * k];
      const dl = Math.hypot(d[0], d[1], d[2]);
      const dist = 6.5 + (1.32 - 6.5) * Math.pow(k, 0.8);
      const cam = d.map((x) => (x / dl) * dist);
      const look = [0, 0, -k * 0.98];
      gl.uniform2f(U('uRes'), w, h);
      gl.uniform1f(U('uT'), Math.min(1, el / 2500));
      gl.uniform3fv(U('uSun'), sunDir());
      gl.uniform3fv(U('uCam'), cam);
      gl.uniform3fv(U('uLook'), look);
      // reference up: lunar north at the start → ME +X (lon 0, "up" on the map) at the end
      const ux = k;
      const uz = 1 - k;
      const ul = Math.hypot(ux, uz);
      gl.uniform3f(U('uUp'), ux / ul, 0, uz / ul);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      setCap(CAPTIONS.filter((cc) => el >= cc.at).length - 1);
      if (el >= DURATION) {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && ['Tab', 'Shift'].includes(e.key)) return;
      finish();
    };
    window.addEventListener('keydown', skip);
    c.addEventListener('pointerdown', skip);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  const cc = CAPTIONS[Math.max(0, cap)];
  return (
    <div class={`warmup ${out ? 'out' : ''}`} role="dialog" aria-label="Introduction">
      <canvas ref={ref} />
      <div class="warmup-text" aria-live="polite">
        <h2>{cc.text[0]}</h2>
        <p>{cc.text[1]}</p>
      </div>
      <button class="btn warmup-skip" onClick={finish} autoFocus>
        Skip intro ⏎
      </button>
    </div>
  );
}
