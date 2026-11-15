// GLSL for the map terrain engine. Geometry mirrors core/geo.ts (docs/DATA.md §1),
// horizon/disk/metrics mirror docs/METRICS.md, score mirrors core/suitability.ts.

export const VERT = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

const HEADER = (hw: boolean) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
${hw ? '#define HW_FILTER 1' : ''}
`;

const COMMON = /* glsl */ `
const float R = 1737400.0;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float NODATA = -10000.0;
uniform sampler2D uFar;  uniform vec4 uFarRect;  uniform float uFarMaxLod;
uniform sampler2D uNear; uniform vec4 uNearRect; uniform float uNearMaxLod; uniform float uNearValid;
uniform float uMaxRho;
// context Moon outside the coverage (display pass only; analysis passes never set gOuter)
uniform sampler2D uOuter; uniform vec4 uOuterRect; uniform float uOuterMaxLod; uniform float uOuterValid; uniform float uOuterRho;
bool gOuter = false;   // this fragment lies outside the polar coverage → its rays may use uOuter

float texDem(sampler2D t, vec4 rect, float maxLod, vec2 p, float res) {
  vec2 uv = vec2(p.x - rect.x, rect.y - p.y) / (rect.z * rect.w);
  float lod = clamp(log2(max(res, rect.z) / rect.z), 0.0, maxLod);
#ifdef HW_FILTER
  return textureLod(t, uv, lod).r;
#else
  int l = int(lod);
  vec2 sz = vec2(textureSize(t, l));
  vec2 f = uv * sz - 0.5;
  vec2 i = floor(f);
  vec2 w = f - i;
  ivec2 mx = ivec2(sz) - 1;
  ivec2 a0 = clamp(ivec2(i), ivec2(0), mx);
  ivec2 a1 = clamp(ivec2(i) + 1, ivec2(0), mx);
  float a = texelFetch(t, a0, l).r;
  float b = texelFetch(t, ivec2(a1.x, a0.y), l).r;
  float c = texelFetch(t, ivec2(a0.x, a1.y), l).r;
  float d = texelFetch(t, a1, l).r;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
#endif
}
bool inRect(vec4 rect, vec2 p, float inset) {
  vec2 uv = vec2(p.x - rect.x, rect.y - p.y) / (rect.z * rect.w);
  return all(greaterThan(uv, vec2(inset))) && all(lessThan(uv, vec2(1.0 - inset)));
}
bool useOuter(vec2 p) {
  float b = uMaxRho - 3.0 * uFarRect.z;   // stay clear of the polar raster's nodata edge
  return gOuter && dot(p, p) > b * b;
}
float demHeight(vec2 p, float res) {
  if (useOuter(p)) return texDem(uOuter, uOuterRect, uOuterMaxLod, p, res);
  if (uNearValid > 0.5 && inRect(uNearRect, p, 0.0005)) {
    float h = texDem(uNear, uNearRect, uNearMaxLod, p, res);
    if (h > NODATA) return h;
  }
  return texDem(uFar, uFarRect, uFarMaxLod, p, res);
}
float demRes(vec2 p) {
  if (useOuter(p)) return uOuterRect.z;
  return (uNearValid > 0.5 && inRect(uNearRect, p, 0.0005)) ? uNearRect.z : uFarRect.z;
}
vec3 unitFromXY(vec2 p) {
  float q = dot(p, p) / (4.0 * R * R);
  return vec3(p.y / R, p.x / R, -(1.0 - q)) / (1.0 + q);
}
float elevTan(vec3 uo, float ho, vec2 q, float h) {
  vec3 d = unitFromXY(q) - uo;
  float c2 = dot(d, d);
  float rh = R + h;
  return ((h - ho) - rh * c2 * 0.5) / (rh * sqrt(c2) * sqrt(max(1.0 - 0.25 * c2, 0.0)) + 1e-12);
}
// max tan(elevation) of terrain along grid direction dir; stops early once above tanStop
float marchMaxTan(vec2 p, vec3 uo, float ho, vec2 dir, float s0, float minStep, float alpha, float maxDist, float tanStop) {
  float best = -1e6;
  float s = s0;
  for (int j = 0; j < 640; j++) {
    if (s > maxDist) break;
    vec2 q = p + dir * s;
    float lim = gOuter ? uOuterRho : uMaxRho;
    if (dot(q, q) > lim * lim) break;
    float st = max(alpha * s, minStep);
    float h = demHeight(q, st);
    if (h > NODATA) {
      best = max(best, elevTan(uo, ho, q, h));
      if (best > tanStop) break;
    }
    s += st;
  }
  return best;
}
float edgeFrac(float z) {
  z = clamp(z, -1.0, 1.0);
  return 1.0 - (acos(z) - z * sqrt(1.0 - z * z)) / PI;
}
`;

/** Horizon pass: 4 azimuths per texel into one RGBA16F layer (radians). */
export const HORIZON_FRAG = (hw: boolean) =>
  HEADER(hw) +
  COMMON +
  /* glsl */ `
uniform vec4 uGrid;      // x0, yTop, spacing, -
uniform int uGroup;      // azimuth group (4 azimuths)
uniform float uNaz;
uniform float uObsH;
uniform float uAlpha;
uniform float uMaxDist;
out vec4 o;
void main() {
  vec2 p = vec2(uGrid.x + gl_FragCoord.x * uGrid.z, uGrid.y - gl_FragCoord.y * uGrid.z);
  float res = demRes(p);
  float ht = demHeight(p, res);
  if (ht <= NODATA) { o = vec4(-1.5); return; }
  vec3 uo = unitFromXY(p);
  float lon = atan(p.x, p.y);
  float minStep = 0.5 * max(res, uGrid.z * 0.5);
  vec4 r;
  for (int a = 0; a < 4; a++) {
    float az = float(uGroup * 4 + a) / uNaz * TAU;
    vec2 dir = vec2(sin(lon + az), cos(lon + az));
    r[a] = atan(marchMaxTan(p, uo, ht + uObsH, dir, minStep, minStep, uAlpha, uMaxDist, 1e6));
  }
  o = r;
}
`;

/** Interval pass: mean f_sun, Earth DTE fraction, longest dark (h), mean vertical-panel power. */
export const INTERVAL_FRAG = (hw: boolean) =>
  HEADER(hw) +
  COMMON +
  /* glsl */ `
uniform vec4 uGrid;
uniform vec2 uGridSize;
uniform sampler2DArray uHor;
uniform sampler2D uEph;   // K x 2 RGBA32F: row0 sun (km, w = ang. radius rad), row1 earth
uniform int uK;
uniform float uStepH;
uniform float uDte;
uniform float uNaz;
uniform float uObsH;
out vec4 o;
float sel(vec4 v, int i) { return dot(v, vec4(equal(ivec4(i), ivec4(0, 1, 2, 3)))); }
float horizonAt(vec2 uv, float az) {
  float k = fract(az / TAU) * uNaz;
  float k0 = floor(k);
  float f = k - k0;
  int i0 = int(k0);
  int i1 = int(mod(k0 + 1.0, uNaz));
  float h0 = sel(texture(uHor, vec3(uv, float(i0 / 4))), i0 - (i0 / 4) * 4);
  float h1 = sel(texture(uHor, vec3(uv, float(i1 / 4))), i1 - (i1 / 4) * 4);
  return mix(h0, h1, f);
}
void main() {
  vec2 p = vec2(uGrid.x + gl_FragCoord.x * uGrid.z, uGrid.y - gl_FragCoord.y * uGrid.z);
  vec2 uv = gl_FragCoord.xy / uGridSize;
  float h = demHeight(p, uGrid.z);
  if (h <= NODATA) { o = vec4(-1.0); return; }
  vec3 up = unitFromXY(p);
  float lon = atan(p.x, p.y);
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = cross(up, east);
  vec3 P = up * (R + h + uObsH) * 0.001;
  float sumF = 0.0, earthOk = 0.0, run = 0.0, longest = 0.0, pv = 0.0;
  for (int i = 0; i < 4096; i++) {
    if (i >= uK) break;
    vec4 S = texelFetch(uEph, ivec2(i, 0), 0);
    vec4 E = texelFetch(uEph, ivec2(i, 1), 0);
    vec3 s = S.xyz - P;
    float sl = length(s);
    float el = asin(clamp(dot(s, up) / sl, -1.0, 1.0));
    float az = atan(dot(s, east), dot(s, north));
    if (az < 0.0) az += TAU;
    float f = edgeFrac((el - horizonAt(uv, az)) / S.w);
    float flux = 149597870.7 / sl;
    sumF += f;
    pv += f * cos(el) * flux * flux;
    run = f < 0.05 ? run + 1.0 : 0.0;
    longest = max(longest, run);
    vec3 e = E.xyz - P;
    float ee = asin(clamp(dot(e, up) / length(e), -1.0, 1.0));
    float ea = atan(dot(e, east), dot(e, north));
    if (ea < 0.0) ea += TAU;
    float fe = edgeFrac((ee - horizonAt(uv, ea)) / E.w);
    earthOk += fe >= uDte ? 1.0 : 0.0;
  }
  float k = float(uK);
  o = vec4(sumF / k, earthOk / k, longest * uStepH, pv / k);
}
`;

/** Footprint features: max/mean slope (deg) and relief (m) over an L×L square; height. */
export const FEATURE_FRAG = (hw: boolean) =>
  HEADER(hw) +
  COMMON +
  /* glsl */ `
uniform vec4 uGrid;
uniform float uFoot;   // footprint side, true metres
out vec4 o;
void main() {
  vec2 p = vec2(uGrid.x + gl_FragCoord.x * uGrid.z, uGrid.y - gl_FragCoord.y * uGrid.z);
  float res = demRes(p);
  float hc = demHeight(p, res);
  if (hc <= NODATA) { o = vec4(99.0, 99.0, 9999.0, NODATA); return; }
  float k = 1.0 + dot(p, p) / (4.0 * R * R);
  float span = uFoot * k;               // grid metres
  float st = span / 6.0;
  float smax = 0.0, ssum = 0.0, hmin = 1e9, hmax = -1e9;
  for (int i = 0; i < 7; i++) {
    for (int j = 0; j < 7; j++) {
      vec2 q = p + (vec2(float(i), float(j)) - 3.0) * st;
      float hx1 = demHeight(q + vec2(res, 0.0), res);
      float hx0 = demHeight(q - vec2(res, 0.0), res);
      float hy1 = demHeight(q + vec2(0.0, res), res);
      float hy0 = demHeight(q - vec2(0.0, res), res);
      float hq = demHeight(q, res);
      vec2 g = vec2(hx1 - hx0, hy1 - hy0) / (2.0 * res) * k;
      float sl = degrees(atan(length(g)));
      smax = max(smax, sl);
      ssum += sl;
      hmin = min(hmin, hq);
      hmax = max(hmax, hq);
    }
  }
  o = vec4(smax, ssum / 49.0, hmax - hmin, hc);
}
`;

/** Display pass: live Sun shading + ray-marched soft shadows + analysis layers. */
export const DISPLAY_FRAG = (hw: boolean) =>
  HEADER(hw) +
  COMMON +
  /* glsl */ `
uniform vec4 uView;       // centre x, centre y, metres per device pixel, -
uniform vec2 uCanvas;     // device pixels
uniform int uLayer;       // 0 relief, 1 shadow, 2 illum, 3 earth, 4 dark, 5 slope, 6 suit
uniform vec4 uSun;        // MOON_ME km, w = angular radius (rad)
uniform float uFlux;
uniform float uExposure;
uniform float uAmbient;
uniform int uShadows;
uniform float uShadowAlpha;
uniform sampler2D uInt;
uniform sampler2D uIntAnt;   // interval result from the antenna height (Earth share only, ADR-122)
uniform float uAntValid;
uniform sampler2D uFeat;
uniform vec4 uGrid;
uniform vec2 uGridSize;
uniform float uGridValid;
uniform float uFeatValid;
uniform vec4 uW;          // weights illum, dark, earth, slope
uniform float uWRelief;
uniform float uFootM;
uniform float uSlopeLimit;
uniform float uDarkRef;
out vec4 o;

uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hash2(ivec2 c) { return float(pcg(uint(c.x) * 1597334677u ^ pcg(uint(c.y)))) / 4294967295.0; }
float vnoise(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = hash2(c), b = hash2(c + ivec2(1, 0)), d = hash2(c + ivec2(0, 1)), e = hash2(c + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
// Procedural regolith (L1): octaves finer than the pixel fade out (no aliasing)
float regolith(vec2 p, float px) {
  float v = 0.0, amp = 0.5, wl = 400.0;
  for (int i = 0; i < 7; i++) {
    float vis = smoothstep(1.5 * px, 4.0 * px, wl);
    v += amp * vis * (vnoise(mod(p, 65536.0) / wl + float(i) * 17.0) - 0.5);
    wl *= 0.5; amp *= 0.62;
  }
  return v;
}
vec3 cividis(float x) {
  x = clamp(x, 0.0, 1.0) * 6.0;
  vec3 c0 = vec3(0.0, 34.0, 78.0), c1 = vec3(53.0, 63.0, 108.0), c2 = vec3(87.0, 92.0, 109.0), c3 = vec3(124.0, 123.0, 120.0);
  vec3 c4 = vec3(166.0, 157.0, 117.0), c5 = vec3(212.0, 193.0, 99.0), c6 = vec3(253.0, 232.0, 69.0);
  vec3 c = x < 1.0 ? mix(c0, c1, x) : x < 2.0 ? mix(c1, c2, x - 1.0) : x < 3.0 ? mix(c2, c3, x - 2.0) : x < 4.0 ? mix(c3, c4, x - 3.0) : x < 5.0 ? mix(c4, c5, x - 4.0) : mix(c5, c6, x - 5.0);
  return c / 255.0;
}
vec3 slopeColor(float s) {
  // sequential, colour-blind safe (light → dark purple), class edges 5/10/15/20/30°
  if (s < 5.0) return vec3(0.94, 0.95, 0.87);
  if (s < 10.0) return vec3(0.75, 0.87, 0.62);
  if (s < 15.0) return vec3(0.99, 0.80, 0.36);
  if (s < 20.0) return vec3(0.96, 0.55, 0.24);
  if (s < 30.0) return vec3(0.80, 0.25, 0.32);
  return vec3(0.42, 0.10, 0.45);
}
float clamp01(float x) { return clamp(x, 0.0, 1.0); }

void main() {
  vec2 p = uView.xy + (gl_FragCoord.xy - 0.5 * uCanvas) * uView.z;
  float px = uView.z;
  gOuter = uOuterValid > 0.5 && dot(p, p) > uMaxRho * uMaxRho;
  float h = demHeight(p, px);
  float lim = gOuter ? uOuterRho : uMaxRho;
  if (h <= NODATA || dot(p, p) > lim * lim) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float dres = demRes(p);
  float d = max(px, dres);
  float k = 1.0 + dot(p, p) / (4.0 * R * R);
  vec2 g = vec2(demHeight(p + vec2(d, 0.0), d) - demHeight(p - vec2(d, 0.0), d),
                demHeight(p + vec2(0.0, d), d) - demHeight(p - vec2(0.0, d), d)) / (2.0 * d) * k;
  float lon = atan(p.x, p.y);
  vec2 Eg = vec2(cos(lon), -sin(lon));
  vec2 Ng = vec2(sin(lon), cos(lon));
  // procedural micro-relief only where we are magnified beyond the DEM grid
  float detail = gOuter ? 0.0 : smoothstep(1.0, 4.0, dres / px);
  vec2 bump = vec2(0.0);
  if (detail > 0.0) {
    float e = max(px, 0.5);
    float n0 = regolith(p, px);
    bump = vec2(regolith(p + vec2(e, 0.0), px) - n0, regolith(p + vec2(0.0, e), px) - n0) / e * 0.6 * detail;
  }
  vec3 nE = normalize(vec3(-dot(g + bump, Eg), -dot(g + bump, Ng), 1.0));
  float slopeDeg = degrees(acos(clamp(normalize(vec3(-dot(g, Eg), -dot(g, Ng), 1.0)).z, -1.0, 1.0)));
  vec3 up = unitFromXY(p);
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = cross(up, east);
  vec3 P = up * (R + h + 1.0) * 0.001;
  vec3 sd = normalize(uSun.xyz - P);
  vec3 sE = vec3(dot(sd, east), dot(sd, north), dot(sd, up));
  float sunEl = asin(clamp(sE.z, -1.0, 1.0));
  float lambert = max(dot(nE, sE), 0.0);
  float fS = 0.0;
  if (sunEl + uSun.w > -0.2 && lambert > 0.0) {
    fS = 1.0;
    if (uShadows == 1) {
      float az = atan(sE.x, sE.y);
      vec2 dir = vec2(sin(lon + az), cos(lon + az));
      float s0 = 1.5 * d;
      float mt = marchMaxTan(p, up, h + 1.0, dir, s0, 0.5 * d, uShadowAlpha, 250000.0, tan(sunEl + uSun.w));
      fS = edgeFrac((sunEl - atan(mt)) / uSun.w);
    } else {
      fS = edgeFrac(sunEl / uSun.w);
    }
  }
  float albedo = 0.12 * (1.0 + 0.35 * regolith(p, px)) * (1.0 + 0.25 * smoothstep(15.0, 35.0, slopeDeg));
  // Enhanced mode: faint fill light from the anti-solar azimuth at 35° (moves with the Sun; readability only)
  vec2 sh = length(sE.xy) > 1e-6 ? normalize(sE.xy) : vec2(0.0, 1.0);
  vec3 fillDir = vec3(-sh * 0.819, 0.574);
  float fill = uAmbient * (0.3 + 0.7 * max(dot(nE, fillDir), 0.0));
  float rad = albedo * (lambert * fS * uFlux + fill);
  vec3 lit = vec3(1.0 - exp(-uExposure * rad));
  lit *= vec3(1.0, 0.985, 0.96);
  vec3 col = lit;
  if (uLayer == 1) {
    if (lambert > 0.0 && fS < 0.02) col = mix(col, vec3(0.12, 0.22, 0.5), 0.55);
    else if (lambert > 0.0 && fS < 0.98) col = mix(col, vec3(1.0, 0.6, 0.15), 0.45);
  } else if (uLayer >= 2 && gOuter) {
    col *= 0.7;   // analysis layers exist only inside the coverage; context Moon stays lit relief
  } else if (uLayer >= 2) {
    float neutral = 0.18 + 0.5 * clamp01(1.0 - slopeDeg / 40.0) + 0.25 * regolith(p, px);
    vec3 base = vec3(neutral);
    vec3 lc = base;
    float alpha = 0.0;
    vec2 guv = vec2(p.x - uGrid.x, uGrid.y - p.y) / (uGrid.z * uGridSize);
    bool inGrid = all(greaterThan(guv, vec2(0.0))) && all(lessThan(guv, vec2(1.0)));
    if (uLayer == 5) {
      lc = slopeColor(slopeDeg); alpha = 0.85;
    } else if (inGrid && uGridValid > 0.5) {
      vec4 iv = texture(uInt, guv);
      if (uAntValid > 0.5) iv.g = texture(uIntAnt, guv).g;
      if (iv.r >= 0.0) {
        if (uLayer == 2) { lc = cividis(iv.r); alpha = 0.85; }
        else if (uLayer == 3) { lc = cividis(iv.g); alpha = 0.85; }
        else if (uLayer == 4) { lc = cividis(1.0 - clamp01(iv.b / uDarkRef)); alpha = 0.85; }
        else if (uLayer == 6 && uFeatValid > 0.5) {
          vec4 fv = texture(uFeat, guv);
          if (fv.r > uSlopeLimit || fv.w <= NODATA) {
            float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 8.0));
            lc = mix(base * 0.6, vec3(0.25), hatch * 0.5); alpha = 0.7;
          } else {
            float ui = clamp01((iv.r - 0.2) / 0.7);
            float ud = 1.0 - clamp01(iv.b / uDarkRef);
            float ue = clamp01(iv.g / 0.8);
            float us = 1.0 - clamp01(fv.g / uSlopeLimit);
            float ur = 1.0 - clamp01(fv.b / (0.2 * uFootM + 1.0));
            float sw = uW.x + uW.y + uW.z + uW.w + uWRelief;
            float sc = (uW.x * ui + uW.y * ud + uW.z * ue + uW.w * us + uWRelief * ur) / sw;
            lc = cividis(sc); alpha = 0.9;
          }
        }
      }
    } else {
      alpha = 0.0;
    }
    col = mix(base * 0.85, lc, alpha);
  }
  // context Moon: same light and shadows, slightly dimmer and cooler so the data edge reads as such
  if (gOuter) col = mix(col, vec3(dot(col, vec3(0.333))) * vec3(0.92, 0.95, 1.05), 0.6) * 0.82;
  o = vec4(col, 1.0);
}
`;
