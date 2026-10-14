// HDR post-processing: scene copy for water refraction/SSR, bloom chain,
// screen-space god rays, filmic tonemapping + grading and FXAA.

import * as THREE from 'three';

const FS_VS = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function fsMat(fs: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FS_VS,
    fragmentShader: fs,
    depthTest: false,
    depthWrite: false,
  });
}

const COPY_DEPTH_FS = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
in vec2 vUv;
void main() {
  vec3 c = texture(tColor, vUv).rgb;
  float d = texture(tDepth, vUv).r;
  float z = d * 2.0 - 1.0;
  float viewZ = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  if (d >= 0.99999) viewZ = 60000.0;
  gl_FragColor = vec4(c, viewZ);
}
`;

const BRIGHT_FS = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0) / max(l, 0.0001);
  gl_FragColor = vec4(min(c * k, vec3(60.0)), 1.0);
}
`;

const DOWN_FS = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
in vec2 vUv;
void main() {
  vec3 c = texture(tColor, vUv).rgb * 4.0;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

const UP_FS = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tPrev;
uniform vec2 uTexel;
in vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture(tColor, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c /= 12.0;
  gl_FragColor = vec4(c + texture(tPrev, vUv).rgb, 1.0);
}
`;

const GOD_MASK_FS = /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D tColor;
uniform vec2 uSunUV;
uniform float uAspect;
in vec2 vUv;
void main() {
  float d = texture(tDepth, vUv).r;
  float sky = step(0.99999, d);
  vec2 dd = (vUv - uSunUV) * vec2(uAspect, 1.0);
  float fall = exp(-dot(dd, dd) * 4.0);
  vec3 c = texture(tColor, vUv).rgb;
  float lum = min(dot(c, vec3(0.3, 0.59, 0.11)), 4.0);
  gl_FragColor = vec4(vec3(sky * fall * (0.4 + lum * 0.4)), 1.0);
}
`;

const GOD_BLUR_FS = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uSunUV;
uniform float uStepScale;
in vec2 vUv;
void main() {
  vec2 delta = (uSunUV - vUv) * uStepScale / 40.0;
  vec2 uv = vUv;
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  uv += delta * jitter;
  for (int i = 0; i < 40; i++) {
    acc += texture(tColor, uv).rgb * illum;
    illum *= 0.965;
    uv += delta;
  }
  gl_FragColor = vec4(acc / 18.0, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tGod;
uniform float uExposure;
uniform float uBloom;
uniform float uGod;
uniform vec3 uGodColor;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uTint;
uniform float uVignette;
uniform float uDamage;
uniform float uZone;
uniform float uUnderwater;
uniform float uFlash;
uniform float uScope;
uniform float uTime;
uniform float uGrain;
uniform float uLowHealth;
uniform float uSpawnShield;
in vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) {
    uv += vec2(sin(uv.y * 30.0 + uTime * 2.0), cos(uv.x * 24.0 + uTime * 1.7)) * 0.0025;
  }
  vec3 c = texture(tScene, uv).rgb;
  if (uScope > 0.01) {
    // slight chromatic fringe through the scope glass
    vec2 dir = (uv - 0.5);
    float r = texture(tScene, uv - dir * 0.006 * uScope).r;
    float b = texture(tScene, uv + dir * 0.006 * uScope).b;
    c = vec3(r, c.g, b);
  }
  c += texture(tBloom, uv).rgb * uBloom;
  c += texture(tGod, uv).rgb * uGodColor * uGod;
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  // grading
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c *= uTint;
  if (uZone > 0.0) {
    float lz = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(c, vec3(lz) * vec3(0.75, 0.45, 1.05), uZone * 0.55);
  }
  if (uUnderwater > 0.5) c *= vec3(0.75, 0.95, 1.05);
  vec2 d = vUv - 0.5;
  float vig = 1.0 - dot(d, d) * uVignette;
  c *= vig;
  float edge = smoothstep(0.25, 0.75, length(d) * 1.4);
  c = mix(c, vec3(0.55, 0.02, 0.02), edge * uDamage * 0.7);
  c = mix(c, c * vec3(1.0, 0.75, 0.75), uLowHealth * edge * (0.5 + 0.5 * sin(uTime * 6.0)));
  c = mix(c, c + vec3(0.1, 0.3, 0.5) * edge, uSpawnShield * 0.5);
  c += vec3(uFlash);
  float g = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += g * uGrain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

const FXAA_FS = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
in vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 rgbNW = texture(tColor, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(tColor, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(tColor, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture(tColor, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 rgbM = texture(tColor, vUv).rgb;
  float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir;
  dir.x = -((lNW + lNE) - (lSW + lSE));
  dir.y = ((lNW + lSW) - (lNE + lSE));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 rgbA = 0.5 * (texture(tColor, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tColor, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(tColor, vUv + dir * -0.5).rgb + texture(tColor, vUv + dir * 0.5).rgb);
  float lB = luma(rgbB);
  gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}
`;

export interface PostSettings {
  bloom: boolean;
  godRays: boolean;
  fxaa: boolean;
  renderScale: number;
}

export class PostFX {
  sceneRT!: THREE.WebGLRenderTarget;
  copyRT!: THREE.WebGLRenderTarget;
  ldrRT!: THREE.WebGLRenderTarget;
  bloomDown: THREE.WebGLRenderTarget[] = [];
  bloomUp: THREE.WebGLRenderTarget[] = [];
  godA!: THREE.WebGLRenderTarget;
  godB!: THREE.WebGLRenderTarget;
  black: THREE.DataTexture;
  quad: THREE.Mesh;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  width = 1;
  height = 1;
  settings: PostSettings = { bloom: true, godRays: true, fxaa: true, renderScale: 1 };

  copyMat = fsMat(COPY_DEPTH_FS, { tColor: { value: null }, tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 500 } });
  brightMat = fsMat(BRIGHT_FS, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.2 } });
  downMat = fsMat(DOWN_FS, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
  upMat = fsMat(UP_FS, { tColor: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() } });
  godMaskMat = fsMat(GOD_MASK_FS, { tDepth: { value: null }, tColor: { value: null }, uSunUV: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
  godBlurMat = fsMat(GOD_BLUR_FS, { tColor: { value: null }, uSunUV: { value: new THREE.Vector2() }, uStepScale: { value: 1 } });
  compositeMat = fsMat(COMPOSITE_FS, {
    tScene: { value: null },
    tBloom: { value: null },
    tGod: { value: null },
    uExposure: { value: 1 },
    uBloom: { value: 0.08 },
    uGod: { value: 0.0 },
    uGodColor: { value: new THREE.Color(1, 0.85, 0.6) },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.55 },
    uDamage: { value: 0 },
    uZone: { value: 0 },
    uUnderwater: { value: 0 },
    uFlash: { value: 0 },
    uScope: { value: 0 },
    uTime: { value: 0 },
    uGrain: { value: 0.018 },
    uLowHealth: { value: 0 },
    uSpawnShield: { value: 0 },
  });
  fxaaMat = fsMat(FXAA_FS, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo, this.copyMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
  }

  get uniforms() {
    return this.compositeMat.uniforms;
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w * this.settings.renderScale));
    this.height = Math.max(1, Math.floor(h * this.settings.renderScale));
    const W = this.width;
    const H = this.height;
    this.dispose();
    const depth = new THREE.DepthTexture(W, H);
    depth.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType,
      depthTexture: depth,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.copyRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.bloomDown = [];
    this.bloomUp = [];
    let bw = Math.max(1, W >> 1);
    let bh = Math.max(1, H >> 1);
    for (let i = 0; i < 6; i++) {
      this.bloomDown.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
      this.bloomUp.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    const gw = Math.max(1, W >> 2);
    const gh = Math.max(1, H >> 2);
    this.godA = new THREE.WebGLRenderTarget(gw, gh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.godB = new THREE.WebGLRenderTarget(gw, gh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.fxaaMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  private pass(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }

  /** Copy scene colour + linear depth for water refraction / SSR. */
  copyForWater(renderer: THREE.WebGLRenderer, near: number, far: number) {
    this.copyMat.uniforms.tColor.value = this.sceneRT.texture;
    this.copyMat.uniforms.tDepth.value = this.sceneRT.depthTexture;
    this.copyMat.uniforms.uNear.value = near;
    this.copyMat.uniforms.uFar.value = far;
    this.pass(renderer, this.copyMat, this.copyRT);
  }

  render(renderer: THREE.WebGLRenderer, sunScreen: THREE.Vector3 | null, sunVisible: number) {
    const sceneTex = this.sceneRT.texture;
    // bloom
    let bloomTex: THREE.Texture = this.black;
    if (this.settings.bloom) {
      this.brightMat.uniforms.tColor.value = sceneTex;
      this.brightMat.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this.pass(renderer, this.brightMat, this.bloomDown[0]);
      for (let i = 1; i < this.bloomDown.length; i++) {
        const src = this.bloomDown[i - 1];
        this.downMat.uniforms.tColor.value = src.texture;
        this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(renderer, this.downMat, this.bloomDown[i]);
      }
      let prev: THREE.Texture = this.black;
      for (let i = this.bloomDown.length - 1; i >= 0; i--) {
        const src = i === this.bloomDown.length - 1 ? this.bloomDown[i] : this.bloomUp[i + 1];
        this.upMat.uniforms.tColor.value = src.texture;
        this.upMat.uniforms.tPrev.value = i === this.bloomDown.length - 1 ? this.black : this.bloomDown[i].texture;
        this.upMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(renderer, this.upMat, this.bloomUp[i]);
        prev = this.bloomUp[i].texture;
      }
      bloomTex = prev;
    }
    // god rays
    let godTex: THREE.Texture = this.black;
    if (this.settings.godRays && sunScreen && sunVisible > 0.01) {
      const su = new THREE.Vector2(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
      this.godMaskMat.uniforms.tDepth.value = this.sceneRT.depthTexture;
      this.godMaskMat.uniforms.tColor.value = sceneTex;
      this.godMaskMat.uniforms.uSunUV.value.copy(su);
      this.godMaskMat.uniforms.uAspect.value = this.width / this.height;
      this.pass(renderer, this.godMaskMat, this.godA);
      this.godBlurMat.uniforms.tColor.value = this.godA.texture;
      this.godBlurMat.uniforms.uSunUV.value.copy(su);
      this.godBlurMat.uniforms.uStepScale.value = 1.0;
      this.pass(renderer, this.godBlurMat, this.godB);
      godTex = this.godB.texture;
      this.compositeMat.uniforms.uGod.value = sunVisible;
    } else {
      this.compositeMat.uniforms.uGod.value = 0;
    }
    this.compositeMat.uniforms.tScene.value = sceneTex;
    this.compositeMat.uniforms.tBloom.value = bloomTex;
    this.compositeMat.uniforms.tGod.value = godTex;
    if (this.settings.fxaa) {
      this.pass(renderer, this.compositeMat, this.ldrRT);
      this.fxaaMat.uniforms.tColor.value = this.ldrRT.texture;
      this.pass(renderer, this.fxaaMat, null);
    } else {
      this.pass(renderer, this.compositeMat, null);
    }
  }

  dispose() {
    this.sceneRT?.dispose();
    this.sceneRT?.depthTexture?.dispose();
    this.copyRT?.dispose();
    this.ldrRT?.dispose();
    for (const r of this.bloomDown) r.dispose();
    for (const r of this.bloomUp) r.dispose();
    this.godA?.dispose();
    this.godB?.dispose();
  }
}
