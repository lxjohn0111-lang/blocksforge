// Shared GLSL used by every world material: atmosphere, fog, cascaded shadow
// sampling, cloud shadows, dynamic point lights and the surface lighting model.

import * as THREE from 'three';

export const MAX_POINT_LIGHTS = 8;

/** Uniform objects shared (by reference) across all world materials. */
export const shared = {
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uMoonDir: { value: new THREE.Vector3(-0.4, -0.8, -0.3).normalize() },
  uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uLightColor: { value: new THREE.Color(3, 2.8, 2.5) },
  uSkyZenith: { value: new THREE.Color(0.18, 0.36, 0.75) },
  uSkyHorizon: { value: new THREE.Color(0.65, 0.78, 0.92) },
  uSkyGround: { value: new THREE.Color(0.3, 0.3, 0.32) },
  uSunGlow: { value: new THREE.Color(1.0, 0.8, 0.5) },
  uAmbientSky: { value: new THREE.Color(0.5, 0.6, 0.8) },
  uAmbientGround: { value: new THREE.Color(0.25, 0.22, 0.18) },
  uBlockLightColor: { value: new THREE.Color(1.6, 1.0, 0.5) },
  uNight: { value: 0 },
  uWetness: { value: 0 },
  uFogDensity: { value: 0.006 },
  uFogHeight: { value: 0.035 },
  uFogBase: { value: 30 },
  uFogColorBoost: { value: new THREE.Color(1, 1, 1) },
  uViewDist: { value: 240 },
  uCloudCover: { value: 0.45 },
  uCloudHeight: { value: 180 },
  uWind: { value: new THREE.Vector2(1.5, 0.6) },
  uWindStrength: { value: 1 },
  uNoiseTex: { value: null as THREE.Texture | null },
  uShadowMap0: { value: null as THREE.Texture | null },
  uShadowMap1: { value: null as THREE.Texture | null },
  uShadowMat0: { value: new THREE.Matrix4() },
  uShadowMat1: { value: new THREE.Matrix4() },
  uShadowParams: { value: new THREE.Vector4(1 / 2048, 1 / 2048, 1, 0) },
  uShadowRange: { value: new THREE.Vector2(40, 200) },
  uShadowsOn: { value: 1 },
  uShadowPass: { value: 0 },
  uPL: { value: Array.from({ length: MAX_POINT_LIGHTS * 2 }, () => new THREE.Vector4()) },
  uPLCount: { value: 0 },
  uUnderwater: { value: 0 },
  uLightning: { value: 0 },
};

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec3 uSunGlow;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform vec3 uBlockLightColor;
uniform float uNight;
uniform float uWetness;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogBase;
uniform vec3 uFogColorBoost;
uniform float uViewDist;
uniform float uCloudCover;
uniform float uCloudHeight;
uniform vec2 uWind;
uniform float uWindStrength;
uniform sampler2D uNoiseTex;
uniform float uShadowPass;
uniform float uUnderwater;
uniform float uLightning;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float noiseT(vec2 p) { return texture(uNoiseTex, p).r; }
float fbmT(vec2 p) {
  return texture(uNoiseTex, p).r * 0.55 + texture(uNoiseTex, p * 2.03 + 0.31).g * 0.3 + texture(uNoiseTex, p * 4.1 + 0.73).b * 0.15;
}

// ---------------------------------------------------------------- sky
vec3 skyBase(vec3 dir) {
  float y = dir.y;
  float h = saturate(y);
  vec3 col = mix(uSkyHorizon, uSkyZenith, pow(h, 0.42));
  if (y < 0.0) col = mix(uSkyHorizon, uSkyGround, saturate(-y * 2.5));
  float sd = max(dot(dir, uSunDir), 0.0);
  float day = 1.0 - uNight;
  col += uSunGlow * (pow(sd, 5.0) * 0.28 + pow(sd, 28.0) * 0.55) * day;
  // warm horizon band toward the sun
  col += uSunGlow * 0.22 * pow(1.0 - abs(y), 10.0) * pow(sd * 0.5 + 0.5, 4.0) * day;
  // moon glow
  float md = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.25, 0.32, 0.45) * pow(md, 24.0) * 0.25 * uNight;
  col += vec3(0.6, 0.65, 0.9) * uLightning * 0.6;
  return col;
}

// cloud density for a world-space xz position (shared by sky and cloud shadows)
float cloudDensity(vec2 xz) {
  vec2 p = xz * 0.0011 + uWind * uTime * 0.0009;
  float n = fbmT(p);
  float n2 = texture(uNoiseTex, p * 3.7 - uWind * uTime * 0.0004).a;
  n = n * 0.8 + n2 * 0.2;
  float cover = mix(0.72, 0.28, uCloudCover);
  return smoothstep(cover, cover + 0.22, n);
}

float cloudShadow(vec3 wp) {
  if (uCloudCover < 0.01) return 1.0;
  vec3 L = uLightDir;
  float t = (uCloudHeight - wp.y) / max(L.y, 0.15);
  vec2 xz = wp.xz + L.xz * t;
  float d = cloudDensity(xz);
  return 1.0 - d * 0.62;
}

// ---------------------------------------------------------------- fog
vec3 fogColor(vec3 dir) {
  vec3 c = skyBase(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.6 + 0.015, dir.z)));
  // looking down, the haze picks up the ground/sky ambient instead of the bright horizon
  float down = saturate(-dir.y * 2.2);
  c = mix(c, (uSkyHorizon * 0.55 + uSkyZenith * 0.25 + uAmbientSky * 0.2), down * 0.55);
  return c * uFogColorBoost;
}

vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - uCamPos;
  float dist = length(d);
  vec3 dir = d / max(dist, 0.001);
  if (uUnderwater > 0.5) {
    float f = 1.0 - exp(-dist * 0.09);
    return mix(col, vec3(0.03, 0.12, 0.16) * (uAmbientSky + uLightColor * 0.15), f);
  }
  // height-based fog integral
  float k = uFogHeight;
  float camH = uCamPos.y - uFogBase;
  float dy = dir.y;
  float heightTerm = exp(-k * camH) * ((abs(dy) > 0.001) ? (1.0 - exp(-k * dy * dist)) / (k * dy) : dist);
  float fogAmt = 1.0 - exp(-uFogDensity * max(heightTerm, 0.0));
  // ensure everything melts into the sky before the far plane
  float edge = smoothstep(uViewDist * 0.84, uViewDist, dist);
  fogAmt = max(fogAmt, edge);
  vec3 fc = fogColor(dir);
  // sun in-scatter
  float sd = max(dot(dir, uSunDir), 0.0);
  fc += uSunGlow * pow(sd, 8.0) * 0.35 * (1.0 - uNight) * fogAmt;
  return mix(col, fc, saturate(fogAmt));
}
`;

export const SHADOW = /* glsl */ `
uniform sampler2DShadow uShadowMap0;
uniform sampler2DShadow uShadowMap1;
uniform mat4 uShadowMat0;
uniform mat4 uShadowMat1;
uniform vec4 uShadowParams; // texel0, texel1, strength, unused
uniform vec2 uShadowRange;  // cascade0 radius, cascade1 radius
uniform float uShadowsOn;

const vec2 POISSON[10] = vec2[](
  vec2(-0.2069, 0.7512), vec2(0.6337, 0.5012), vec2(-0.8064, 0.0601), vec2(0.0911, -0.2071),
  vec2(0.6979, -0.4412), vec2(-0.4325, -0.6713), vec2(0.2412, 0.2023), vec2(-0.3901, 0.2802),
  vec2(0.1607, -0.9171), vec2(0.9333, 0.0610)
);

float sampleCascade(sampler2DShadow sm, vec3 c, float texel, float radius, float rot) {
  float s = 0.0;
  float cr = cos(rot), sr = sin(rot);
  for (int i = 0; i < 10; i++) {
    vec2 o = POISSON[i];
    o = vec2(o.x * cr - o.y * sr, o.x * sr + o.y * cr);
    s += texture(sm, vec3(c.xy + o * texel * radius, c.z));
  }
  return s * 0.1;
}

// returns visibility in [0,1]; skyFallback is used beyond shadow range
float shadowVisibility(vec3 wp, vec3 N, float skyFallback) {
  if (uShadowsOn < 0.5) return skyFallback;
  float dist = length(wp - uCamPos);
  float NdotL = dot(N, uLightDir);
  float rot = ign(gl_FragCoord.xy) * 6.2831;
  if (dist < uShadowRange.x) {
    vec3 p = wp + N * (0.03 + 0.06 * (1.0 - abs(NdotL)));
    vec4 c = uShadowMat0 * vec4(p, 1.0);
    vec3 sc = c.xyz;
    sc.z -= 0.0006;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0) {
      float v = sampleCascade(uShadowMap0, sc, uShadowParams.x, 1.6, rot);
      float fade = smoothstep(uShadowRange.x * 0.8, uShadowRange.x, dist);
      if (fade < 0.001) return v;
      vec4 c1 = uShadowMat1 * vec4(wp + N * 0.18, 1.0);
      float v1 = sampleCascade(uShadowMap1, c1.xyz - vec3(0.0, 0.0, 0.0012), uShadowParams.y, 1.2, rot);
      return mix(v, v1, fade);
    }
  }
  if (dist < uShadowRange.y) {
    vec3 p = wp + N * (0.12 + 0.2 * (1.0 - abs(NdotL)));
    vec4 c = uShadowMat1 * vec4(p, 1.0);
    vec3 sc = c.xyz;
    sc.z -= 0.0012;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0) {
      float v = sampleCascade(uShadowMap1, sc, uShadowParams.y, 1.2, rot);
      float fade = smoothstep(uShadowRange.y * 0.8, uShadowRange.y, dist);
      return mix(v, skyFallback, fade);
    }
  }
  return skyFallback;
}
`;

export const POINT_LIGHTS = /* glsl */ `
uniform vec4 uPL[${MAX_POINT_LIGHTS * 2}];
uniform int uPLCount;
vec3 pointLights(vec3 wp, vec3 N) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    if (i >= uPLCount) break;
    vec4 a = uPL[i * 2];
    vec4 b = uPL[i * 2 + 1];
    vec3 Ld = a.xyz - wp;
    float d = length(Ld);
    float att = saturate(1.0 - d / a.w);
    att *= att;
    acc += b.rgb * att * (0.35 + 0.65 * max(dot(N, Ld / max(d, 0.001)), 0.0));
  }
  return acc;
}
`;

/** Full surface model. sky/blk are 0..1 light levels. */
export const LIGHTING = /* glsl */ `
vec3 shadeSurface(vec3 albedo, vec3 N, vec3 V, vec3 wp, float sky, float blk, float ao, float smoothness, float sss, float emissive) {
  float NdotL = dot(N, uLightDir);
  float skyCurve = sky * sky * (3.0 - 2.0 * sky);
  // direct light visibility: shadow map, faded to sky-light estimate further out
  float skyGate = smoothstep(0.35, 0.95, sky);
  float vis = shadowVisibility(wp, N, skyGate);
  vis *= mix(0.25, 1.0, skyGate);
  vis *= cloudShadow(wp);
  float diff = max(NdotL, 0.0);
  // foliage translucency
  float back = sss * pow(max(dot(-V, uLightDir), 0.0), 3.0) * 1.4 + sss * max(-NdotL, 0.0) * 0.35;
  vec3 direct = uLightColor * (diff + back) * vis;

  // sky ambient with hemisphere term + bounce
  float up = N.y * 0.5 + 0.5;
  vec3 amb = mix(uAmbientGround, uAmbientSky, up) * skyCurve;
  // cheap bounce light from the sunlit ground
  amb += uLightColor * 0.045 * skyCurve * (1.0 - up) ;
  amb *= ao;
  // minimum cave light so interiors are readable
  amb += vec3(0.012, 0.013, 0.016) * ao;

  float bl = pow(blk, 2.4);
  vec3 blockL = uBlockLightColor * bl * 1.5 * (0.55 + 0.45 * ao);
  blockL += pointLights(wp, N);

  // wetness from rain on exposed upward surfaces
  float wet = uWetness * saturate(N.y) * skyGate;
  albedo *= mix(1.0, 0.62, wet);
  smoothness = mix(smoothness, 0.88, wet * 0.8);

  vec3 col = albedo * (direct + amb + blockL);

  // specular (Blinn-Phong energy-normalised-ish)
  vec3 H = normalize(uLightDir + V);
  float shin = mix(6.0, 320.0, smoothness * smoothness);
  float spec = pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / 25.0;
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col += uLightColor * spec * smoothness * 0.35 * vis * mix(0.06, 1.0, fres) * step(0.0, NdotL);
  // sky reflection on smooth / wet surfaces
  vec3 R = reflect(-V, N);
  col += skyBase(R) * fres * smoothness * smoothness * skyCurve * 0.5;

  col += albedo * emissive * 3.2;
  return col;
}
`;

export function makeNoiseTexture(size = 256): THREE.DataTexture {
  // tileable value-noise octaves in RGBA
  const data = new Uint8Array(size * size * 4);
  const lattice = (period: number, seed: number) => {
    const g = new Float32Array(period * period);
    let s = seed >>> 0;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    return g;
  };
  const sample = (g: Float32Array, period: number, x: number, y: number) => {
    const fx = (x / size) * period;
    const fy = (y / size) * period;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const G = (ix: number, iy: number) => g[((iy % period) + period) % period * period + (((ix % period) + period) % period)];
    const a = G(x0, y0), b = G(x0 + 1, y0), c = G(x0, y0 + 1), d = G(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const chans = [
    [8, 16, 32, 64],
    [16, 32, 64],
    [32, 64, 128],
    [4, 8, 16, 32],
  ];
  const lats = chans.map((ps, ci) => ps.map((p, k) => lattice(p, 1000 + ci * 97 + k * 13)));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        let v = 0;
        let amp = 1;
        let norm = 0;
        chans[c].forEach((p, k) => {
          v += sample(lats[c][k], p, x, y) * amp;
          norm += amp;
          amp *= 0.5;
        });
        data[(y * size + x) * 4 + c] = Math.round((v / norm) * 255);
      }
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
