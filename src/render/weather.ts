// Rain and snow particles animated entirely on the GPU around the camera.
// A small height texture around the camera hides precipitation under roofs.

import * as THREE from 'three';
import { shared } from './shaderlib';
import { FX_LAYER } from './chunkRenderer';
import type { VoxelWorld } from '../world/world';
import { IS_SOLID } from '../world/blocks';

const N = 9000;
const BOX = 44;
const HM = 64;

const VS = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform float uSnow;
uniform float uIntensity;
uniform sampler2D uHeight;
uniform vec2 uHeightOrigin;
attribute vec4 aSeed;
varying float vAlpha;
varying float vSnow;
void main() {
  float box = ${BOX.toFixed(1)};
  float speed = mix(26.0, 2.2, uSnow) * (0.8 + aSeed.w * 0.4);
  vec3 p = aSeed.xyz * box;
  p.y -= uTime * speed;
  p.x += uSnow * sin(uTime * 0.7 + aSeed.w * 30.0) * 1.2 + uTime * 1.5 * (1.0 - uSnow) * 0.15;
  p.z += uSnow * cos(uTime * 0.6 + aSeed.w * 21.0) * 1.2;
  // wrap around camera
  vec3 rel = mod(p - uCamPos + box * 0.5, box) - box * 0.5;
  vec3 wp = uCamPos + rel;
  // hide below roofs / ground
  vec2 huv = (wp.xz - uHeightOrigin) / ${HM.toFixed(1)};
  float top = texture2D(uHeight, huv).r * 255.0;
  float under = step(wp.y, top + 1.0);
  float keep = step(aSeed.w, uIntensity);
  vAlpha = (1.0 - under) * keep * (1.0 - smoothstep(box * 0.35, box * 0.5, length(rel)));
  vSnow = uSnow;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = mix(46.0, 7.0, uSnow) * (1.0 / max(0.5, -mv.z)) * 6.0;
}
`;
const FS = /* glsl */ `
uniform vec3 uLightColor;
uniform vec3 uAmbientSky;
varying float vAlpha;
varying float vSnow;
void main() {
  if (vAlpha < 0.01) discard;
  vec2 c = gl_PointCoord - 0.5;
  float a;
  if (vSnow > 0.5) a = smoothstep(0.5, 0.15, length(c));
  else a = smoothstep(0.045, 0.0, abs(c.x)) * smoothstep(0.5, 0.2, abs(c.y));
  vec3 col = (uAmbientSky * 1.4 + uLightColor * 0.25) * (vSnow > 0.5 ? 1.6 : 0.9);
  gl_FragColor = vec4(col, a * vAlpha * (vSnow > 0.5 ? 0.9 : 0.42));
}
`;

export class Weather {
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  heightTex: THREE.DataTexture;
  private hmData = new Uint8Array(HM * HM * 4);
  private origin = new THREE.Vector2(-9999, -9999);
  world: VoxelWorld | null = null;

  constructor() {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.heightTex = new THREE.DataTexture(this.hmData, HM, HM, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uCamPos: shared.uCamPos,
        uLightColor: shared.uLightColor,
        uAmbientSky: shared.uAmbientSky,
        uSnow: { value: 0 },
        uIntensity: { value: 0 },
        uHeight: { value: this.heightTex },
        uHeightOrigin: { value: new THREE.Vector2() },
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.layers.set(FX_LAYER);
  }

  update(cam: THREE.Vector3, rain: number, snow: number) {
    const intensity = Math.max(rain, snow);
    this.mat.uniforms.uIntensity.value = intensity;
    this.mat.uniforms.uSnow.value = snow > rain ? 1 : 0;
    this.points.visible = intensity > 0.01;
    if (!this.points.visible || !this.world) return;
    const ox = Math.floor(cam.x) - HM / 2;
    const oz = Math.floor(cam.z) - HM / 2;
    if (Math.abs(ox - this.origin.x) >= 4 || Math.abs(oz - this.origin.y) >= 4) {
      this.origin.set(ox, oz);
      const w = this.world;
      for (let z = 0; z < HM; z++)
        for (let x = 0; x < HM; x++) {
          const wx = ox + x, wz = oz + z;
          let top = 0;
          if (wx >= 0 && wz >= 0 && wx < w.sx && wz < w.sz) {
            for (let y = w.sy - 1; y >= 0; y--) {
              const id = w.blocks[(wz * w.sx + wx) * w.sy + y];
              if (id && (IS_SOLID[id] || id === 7)) {
                top = y + 1;
                break;
              }
            }
          }
          this.hmData[(z * HM + x) * 4] = Math.min(255, top);
        }
      this.heightTex.needsUpdate = true;
      this.mat.uniforms.uHeightOrigin.value.set(ox, oz);
    }
  }
}
