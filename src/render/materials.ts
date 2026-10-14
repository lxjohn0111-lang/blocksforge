// World materials: voxel terrain (opaque + cutout), water with SSR/refraction,
// and the procedural sky dome. All share uniforms from shaderlib.shared.

import * as THREE from 'three';
import { COMMON, SHADOW, POINT_LIGHTS, LIGHTING, shared } from './shaderlib';
import { buildTextures } from './textures';

const TERRAIN_VS = /* glsl */ `
${COMMON}
in vec4 aData;
out vec2 vUv;
out vec3 vWorld;
out float vAO;
out vec2 vLight;
flat out float vLayer;
flat out int vFace;
flat out float vMacro;
out float vViewDist;

const float AO_CURVE[4] = float[](0.38, 0.6, 0.8, 1.0);

void main() {
  vec3 p = position;
  int d1 = int(aData.y + 0.5);
  int face = d1 & 7;
  int d2 = int(aData.z + 0.5);
  int lt = int(aData.w + 0.5);
  float gust = 0.6 + 0.4 * sin(uTime * 0.7 + p.x * 0.05 + p.z * 0.03);
  if ((d1 & 8) != 0) {
    float ph = dot(p, vec3(0.71, 0.33, 0.53)) + uTime * 1.9;
    vec3 off = vec3(sin(ph), sin(ph * 1.31 + 1.7) * 0.6, cos(ph * 0.87 + 0.4)) * 0.035;
    off.xz += uWind * 0.012 * gust;
    p += off * uWindStrength;
  }
  if ((d1 & 16) != 0) {
    float ph = dot(p.xz, vec2(0.9, 0.6)) + uTime * 2.6;
    vec2 sway = uWind * (0.05 + 0.05 * sin(ph)) * gust + vec2(sin(ph * 1.7), cos(ph * 1.3)) * 0.035;
    p.xz += sway * uWindStrength;
  }
  vUv = uv;
  vLayer = aData.x;
  vFace = face;
  vAO = AO_CURVE[d2 & 3];
  vMacro = float((d2 >> 3) & 1);
  vLight = vec2(float(lt >> 4), float(lt & 15)) / 15.0;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 vp = viewMatrix * wp;
  vViewDist = -vp.z;
  gl_Position = projectionMatrix * vp;
}
`;

const TERRAIN_FS = /* glsl */ `
${COMMON}
${SHADOW}
${POINT_LIGHTS}
${LIGHTING}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormalMap;
in vec2 vUv;
in vec3 vWorld;
in float vAO;
in vec2 vLight;
flat in float vLayer;
flat in int vFace;
flat in float vMacro;
in float vViewDist;

void tbn(int f, out vec3 N, out vec3 T, out vec3 B) {
  if (f == 0) { N = vec3(1,0,0); T = vec3(0,0,-1); B = vec3(0,1,0); }
  else if (f == 1) { N = vec3(-1,0,0); T = vec3(0,0,1); B = vec3(0,1,0); }
  else if (f == 2) { N = vec3(0,1,0); T = vec3(1,0,0); B = vec3(0,0,-1); }
  else if (f == 3) { N = vec3(0,-1,0); T = vec3(1,0,0); B = vec3(0,0,1); }
  else if (f == 4) { N = vec3(0,0,1); T = vec3(1,0,0); B = vec3(0,1,0); }
  else if (f == 5) { N = vec3(0,0,-1); T = vec3(-1,0,0); B = vec3(0,1,0); }
  else { N = vec3(0,1,0); T = vec3(1,0,0); B = vec3(0,0,1); }
}

void main() {
  vec4 alb = texture(uAlbedo, vec3(vUv, vLayer));
#ifdef CUTOUT
  float thr = vFace == 6 ? mix(0.5, 0.12, smoothstep(8.0, 48.0, vViewDist)) : 0.5;
  if (alb.a < thr) discard;
#endif
  if (uShadowPass > 0.5) { gl_FragColor = vec4(1.0); return; }
  vec3 albedo = srgbToLinear(alb.rgb);
  if (vMacro > 0.5) {
    float m = texture(uNoiseTex, vWorld.xz * 0.011).r;
    float m2 = texture(uNoiseTex, vWorld.xz * 0.057 + 0.37).g;
    albedo *= 0.84 + m * 0.3 + (m2 - 0.5) * 0.14;
    float green = step(albedo.r * 1.15, albedo.g);
    albedo = mix(albedo, albedo * vec3(1.18, 1.04, 0.7), smoothstep(0.52, 0.78, m) * 0.55 * green);
  }
  vec3 N, T, B;
  tbn(vFace, N, T, B);
  vec4 nm = texture(uNormalMap, vec3(vUv, vLayer));
  float smoothness = nm.b;
  float emissive = nm.a;
  vec3 V = normalize(uCamPos - vWorld);
  float sss = 0.0;
  if (vFace < 6) {
    vec2 nxy = nm.xy * 2.0 - 1.0;
    // fade normal detail with distance to avoid shimmer
    nxy *= 1.0 - smoothstep(30.0, 90.0, vViewDist) * 0.7;
    float nz = sqrt(max(1.0 - dot(nxy, nxy), 0.0));
    N = normalize(T * nxy.x + B * nxy.y + N * nz);
  } else {
    sss = 0.65;
    N = normalize(vec3(0.0, 1.0, 0.0) + V * 0.25);
  }
#ifdef CUTOUT
  if (vFace < 6 && alb.a > 0.5 && smoothness > 0.3 && smoothness < 0.5) sss = 0.5;
#endif
  vec3 col = shadeSurface(albedo, N, V, vWorld, vLight.x, vLight.y, vAO, smoothness, sss, emissive);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrainMaterial(cutout: boolean): THREE.ShaderMaterial {
  const tex = buildTextures();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uAlbedo: { value: tex.albedo },
      uNormalMap: { value: tex.normal },
    },
    vertexShader: TERRAIN_VS,
    fragmentShader: TERRAIN_FS,
    defines: cutout ? { CUTOUT: 1 } : {},
    side: THREE.FrontSide,
  });
  return mat;
}

// ---------------------------------------------------------------- water
const WATER_VS = /* glsl */ `
${COMMON}
in vec4 aData;
out vec3 vWorld;
out vec3 vViewPos;
out vec2 vLight;
flat out int vFace;
void main() {
  int lt = int(aData.w + 0.5);
  vLight = vec2(float(lt >> 4), float(lt & 15)) / 15.0;
  vFace = int(aData.y + 0.5) & 7;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 vp = viewMatrix * wp;
  vViewPos = vp.xyz;
  gl_Position = projectionMatrix * vp;
}
`;

const WATER_FS = /* glsl */ `
${COMMON}
${SHADOW}
${POINT_LIGHTS}
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uSSR;
uniform mat4 uProjMat;
in vec3 vWorld;
in vec3 vViewPos;
in vec2 vLight;
flat in int vFace;

float waterHeight(vec2 p) {
  float t = uTime;
  float h = texture(uNoiseTex, p * 0.045 + vec2(t * 0.012, t * 0.007)).r;
  h += texture(uNoiseTex, p * 0.09 - vec2(t * 0.017, -t * 0.011)).g * 0.6;
  h += texture(uNoiseTex, p * 0.21 + vec2(-t * 0.03, t * 0.024)).b * 0.25;
  return h;
}

vec3 waterNormal(vec2 p, float strength) {
  float e = 0.12;
  float h0 = waterHeight(p);
  float hx = waterHeight(p + vec2(e, 0.0));
  float hz = waterHeight(p + vec2(0.0, e));
  vec3 n = normalize(vec3((h0 - hx) * strength, e, (h0 - hz) * strength));
  // rain ripples
  if (uWetness > 0.01) {
    vec2 cell = floor(p * 1.5);
    vec2 f = fract(p * 1.5) - 0.5;
    float rnd = hash12(cell);
    float tt = fract(uTime * 0.9 + rnd);
    vec2 c = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
    float d = length(f - c * 0.6);
    float ring = sin((d - tt * 0.5) * 60.0) * smoothstep(0.5, 0.0, abs(d - tt * 0.5) * 6.0) * (1.0 - tt);
    n.xz += (f - c * 0.6) / max(d, 0.01) * ring * 0.25 * uWetness;
    n = normalize(n);
  }
  return n;
}

vec2 projectView(vec3 vp) {
  vec4 c = uProjMat * vec4(vp, 1.0);
  return (c.xy / c.w) * 0.5 + 0.5;
}

void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 V = normalize(uCamPos - vWorld);
  float dist = length(uCamPos - vWorld);
  bool top = vFace == 2;
  bool below = uCamPos.y < vWorld.y && top;
  vec3 N = vec3(0.0, 1.0, 0.0);
  if (top) {
    // calmer normals at grazing angles keep reflections readable instead of noisy
    float strength = mix(1.1, 0.35, smoothstep(10.0, 120.0, dist)) * mix(0.45, 1.0, smoothstep(0.05, 0.4, V.y));
    N = waterNormal(vWorld.xz, strength);
  } else if (vFace == 0) N = vec3(1,0,0);
  else if (vFace == 1) N = vec3(-1,0,0);
  else if (vFace == 4) N = vec3(0,0,1);
  else if (vFace == 5) N = vec3(0,0,-1);
  else if (vFace == 3) N = vec3(0,-1,0);
  if (below) N = -N;

  float fragDepth = -vViewPos.z;
  vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  // refraction
  // distortion fades out in very shallow water so the bottom stays readable
  float depth0 = max(texture(uScene, suv).a - fragDepth, 0.0);
  vec2 ruv = suv + Nv.xy * 0.035 * saturate(1.0 - dist / 80.0) * saturate(depth0 * 0.5);
  vec4 sceneR = texture(uScene, ruv);
  if (sceneR.a < fragDepth) { ruv = suv; sceneR = texture(uScene, suv); }
  float waterDepth = max(sceneR.a - fragDepth, 0.0);
  float sky = vLight.x;
  float skyCurve = sky * sky;
  vec3 ambient = (uAmbientSky * skyCurve + uBlockLightColor * pow(vLight.y, 2.4)) ;
  float vis = shadowVisibility(vWorld, vec3(0.0, 1.0, 0.0), smoothstep(0.4, 0.95, sky)) * cloudShadow(vWorld);
  vec3 sunL = uLightColor * max(uLightDir.y, 0.0) * vis;
  vec3 deepCol = vec3(0.012, 0.07, 0.085) * (ambient * 1.2 + sunL * 0.35);
  vec3 absorb = exp(-vec3(0.42, 0.11, 0.075) * waterDepth * 1.3);
  vec3 refr = sceneR.rgb * absorb + deepCol * (1.0 - exp(-waterDepth * 0.4));

  if (below) {
    // looking up at the surface from underwater: Snell window
    float cosT = dot(-V, vec3(0.0, -1.0, 0.0));
    vec3 skyC = skyBase(refract(-V, N, 1.33)) ;
    float window = smoothstep(0.62, 0.72, cosT);
    vec3 col = mix(deepCol * 2.0, skyC * 0.8, window);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // reflection
  vec3 R = reflect(-V, N);
  vec3 refl = skyBase(R) * mix(0.15, 1.0, skyCurve);
  // clouds in reflection (cheap)
  if (R.y > 0.0) {
    float t = (uCloudHeight - vWorld.y) / max(R.y, 0.05);
    float cd = cloudDensity(vWorld.xz + R.xz * t) * smoothstep(0.0, 0.2, R.y);
    refl = mix(refl, (uAmbientSky * 1.2 + uLightColor * 0.35) * skyCurve, cd * 0.8);
  }
  if (uSSR > 0.5 && top) {
    vec3 Nflat = normalize((viewMatrix * vec4(normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.45)), 0.0)).xyz);
    vec3 Rv = normalize(reflect(normalize(vViewPos), Nflat));
    vec3 p = vViewPos;
    float stepLen = 0.35 + fragDepth * 0.01;
    bool hit = false;
    vec2 huv = vec2(0.0);
    for (int i = 0; i < 28; i++) {
      p += Rv * stepLen;
      stepLen *= 1.16;
      vec2 uv = projectView(p);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || p.z > -0.05) break;
      float sd = texture(uScene, uv).a;
      float rd = -p.z;
      if (rd > sd + 0.03 && rd < sd + stepLen * 2.5 + 0.6) {
        // refine
        vec3 a = p - Rv * stepLen / 1.16;
        vec3 b = p;
        for (int j = 0; j < 5; j++) {
          vec3 m = (a + b) * 0.5;
          vec2 muv = projectView(m);
          if (-m.z > texture(uScene, muv).a) b = m; else a = m;
        }
        huv = projectView(b);
        hit = true;
        break;
      }
    }
    if (hit) {
      vec2 edge = smoothstep(vec2(0.0), vec2(0.08), huv) * smoothstep(vec2(1.0), vec2(0.92), huv);
      float fade = edge.x * edge.y;
      vec3 sc = texture(uScene, huv).rgb;
      refl = mix(refl, sc, fade);
    }
  }
  float NdotV = max(dot(normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5)), V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
  vec3 col = mix(refr, refl, F);
  // sun glint
  vec3 H = normalize(uLightDir + V);
  float spec = pow(max(dot(N, H), 0.0), 600.0) * 60.0 + pow(max(dot(N, H), 0.0), 90.0) * 1.2;
  col += uLightColor * spec * vis * 0.25;
  // shoreline foam
  if (top) {
    // thin foam line where the surface meets the shore
    float shore = 1.0 - smoothstep(0.0, 0.3, waterDepth);
    float fn = texture(uNoiseTex, vWorld.xz * 0.5 + vec2(uTime * 0.05, -uTime * 0.04)).r;
    float foam = shore * smoothstep(0.45, 0.7, fn + shore * 0.35);
    col = mix(col, (ambient + sunL * 0.9) * 0.85, foam * 0.6);
  }
  col += pointLights(vWorld, N) * 0.3;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uScene: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSSR: { value: 1 },
      uProjMat: { value: new THREE.Matrix4() },
    },
    vertexShader: WATER_VS,
    fragmentShader: WATER_FS,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- sky
const SKY_VS = /* glsl */ `
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
out vec3 vDir;
void main() {
  gl_Position = vec4(position.xy, 0.99999, 1.0);
  vec4 w = uInvViewProj * vec4(position.xy, 1.0, 1.0);
  vDir = w.xyz / w.w - uCamPos;
}
`;

const SKY_FS = /* glsl */ `
${COMMON}
in vec3 vDir;
uniform float uStarBright;
uniform float uMoonPhase;

vec3 starField(vec3 dir) {
  vec3 p = dir * 180.0;
  vec3 cell = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = hash12(cell.xy + cell.z * 17.13);
  if (h > 0.985) {
    vec3 off = vec3(hash12(cell.yz), hash12(cell.zx), hash12(cell.xy + 3.0)) - 0.5;
    float d = length(f - off * 0.6);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
    float b = smoothstep(0.12, 0.0, d) * tw * (h - 0.985) * 70.0;
    vec3 tint = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash12(cell.xy * 1.7));
    return tint * b;
  }
  return vec3(0.0);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);
  float day = 1.0 - uNight;
  // sun disk
  float sd = dot(dir, uSunDir);
  float horizonFade = smoothstep(-0.02, 0.03, dir.y);
  float disk = smoothstep(0.99950, 0.99972, sd);
  col += mix(vec3(30.0, 14.0, 5.0), vec3(40.0, 34.0, 26.0), saturate(uSunDir.y * 4.0)) * disk * horizonFade;
  // moon disk
  float md = dot(dir, uMoonDir);
  float moon = smoothstep(0.99925, 0.99945, md);
  if (moon > 0.0) {
    vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 my = cross(mx, uMoonDir);
    vec2 mp = vec2(dot(dir - uMoonDir, mx), dot(dir - uMoonDir, my)) * 300.0;
    float crater = texture(uNoiseTex, mp * 0.08 + 0.3).r;
    float phase = smoothstep(-0.2, 0.2, mp.x + uMoonPhase * 10.0);
    col += vec3(1.6, 1.7, 1.9) * moon * (0.65 + crater * 0.5) * mix(0.15, 1.0, phase) * horizonFade;
  }
  // stars
  if (uNight > 0.05 && dir.y > -0.05) {
    col += starField(dir) * uStarBright * uNight * (1.0 - uCloudCover * 0.8) * horizonFade;
  }
  // clouds
  if (dir.y > 0.005) {
    float t = (uCloudHeight - uCamPos.y) / dir.y;
    vec2 xz = uCamPos.xz + dir.xz * t;
    float d = cloudDensity(xz);
    float d2 = cloudDensity(xz + uSunDir.xz * 60.0 / max(uSunDir.y, 0.2));
    float lit = clamp(1.0 - d2 * 0.85, 0.15, 1.0);
    float sdp = max(sd, 0.0);
    vec3 sunTint = uLightColor * 0.42 + uSunGlow * 0.35;
    vec3 cloudCol = mix(uAmbientSky * 0.75 + uSkyHorizon * 0.15, sunTint + uAmbientSky * 0.4, lit);
    cloudCol += uSunGlow * pow(sdp, 10.0) * 1.4 * (1.0 - d) * day;
    float fade = smoothstep(0.005, 0.18, dir.y);
    float alpha = d * fade * 0.94;
    // haze toward horizon
    cloudCol = mix(cloudCol, skyBase(dir), 1.0 - smoothstep(0.02, 0.35, dir.y));
    col = mix(col, cloudCol, alpha);
  }
  if (uUnderwater > 0.5) col = vec3(0.03, 0.12, 0.16) * (uAmbientSky + uLightColor * 0.2);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSkyMesh(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uInvViewProj: { value: new THREE.Matrix4() },
      uStarBright: { value: 1 },
      uMoonPhase: { value: 0.3 },
    },
    vertexShader: SKY_VS,
    fragmentShader: SKY_FS,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, material };
}
