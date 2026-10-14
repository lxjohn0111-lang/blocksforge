// Box-list voxel models (Blockbench-style) used for weapons, characters,
// loot and props. Boxes are authored in "pixels" (default 1/32 block) and
// rendered with bevelled edges, per-voxel grain, camo and optional skinning.

import * as THREE from 'three';
import { COMMON, SHADOW, POINT_LIGHTS, LIGHTING, shared } from './shaderlib';

export type MatKind = 'matte' | 'metal' | 'polymer' | 'wood' | 'glass' | 'emissive' | 'rubber' | 'cloth' | 'skin' | 'gold';

export interface VBox {
  min: [number, number, number];
  max: [number, number, number];
  color: number;
  mat?: MatKind;
  bone?: number;
  /** take the camo pattern */
  camo?: boolean;
}

const MAT_PARAMS: Record<MatKind, [number, number, number]> = {
  // smoothness, metallic, emissive
  matte: [0.15, 0, 0],
  metal: [0.62, 1, 0],
  polymer: [0.32, 0, 0],
  wood: [0.28, 0, 0],
  glass: [0.95, 0.3, 0.15],
  emissive: [0.4, 0, 1],
  rubber: [0.08, 0, 0],
  cloth: [0.05, 0, 0],
  skin: [0.22, 0, 0],
  gold: [0.75, 1, 0],
};

function srgb(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
}

/**
 * Build a geometry. `scale` converts pixels to world units; `origin` (in
 * pixels) is subtracted so models can be authored around a pivot.
 */
export function buildVoxelGeometry(boxes: VBox[], scale = 1 / 32, origin: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const mat: number[] = [];
  const face: number[] = [];
  const bone: number[] = [];
  const obj: number[] = [];
  const idx: number[] = [];
  let hasBone = false;
  for (const b of boxes) {
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) continue;
    const c = srgb(b.color);
    const mp = MAT_PARAMS[b.mat ?? 'matte'];
    const bn = b.bone ?? 0;
    if (b.bone !== undefined) hasBone = true;
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    // faces: [normal, corners (CCW from outside), sizeU, sizeV]
    const faces: [number[], number[][], number, number][] = [
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], sz, sy],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], sz, sy],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], sx, sz],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], sx, sz],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], sx, sy],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], sx, sy],
    ];
    for (const [n, corners, su, sv] of faces) {
      const base = pos.length / 3;
      const uvs = [
        [0, 0],
        [su, 0],
        [su, sv],
        [0, sv],
      ];
      for (let k = 0; k < 4; k++) {
        const p = corners[k];
        pos.push((p[0] - origin[0]) * scale, (p[1] - origin[1]) * scale, (p[2] - origin[2]) * scale);
        obj.push(p[0], p[1], p[2]);
        nrm.push(n[0], n[1], n[2]);
        col.push(c[0], c[1], c[2]);
        mat.push(mp[0], mp[1], mp[2], b.camo ? 1 : 0);
        face.push(uvs[k][0], uvs[k][1], su, sv);
        bone.push(bn);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 4));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 4));
  g.setAttribute('aObj', new THREE.Float32BufferAttribute(obj, 3));
  if (hasBone) g.setAttribute('aBone', new THREE.Float32BufferAttribute(bone, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const ENTITY_VS = /* glsl */ `
${COMMON}
in vec3 aColor;
in vec4 aMat;
in vec4 aFace;
in vec3 aObj;
#ifdef SKINNED
in float aBone;
uniform mat4 uBones[10];
#endif
out vec3 vColor;
out vec4 vMat;
out vec4 vFace;
out vec3 vObj;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef SKINNED
  mat4 bm = uBones[int(aBone + 0.5)];
  p = bm * p;
  n = mat3(bm) * n;
#endif
  vec4 wp = modelMatrix * p;
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vColor = aColor;
  vMat = aMat;
  vFace = aFace;
  vObj = aObj;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ENTITY_FS = /* glsl */ `
${COMMON}
${SHADOW}
${POINT_LIGHTS}
${LIGHTING}
uniform vec2 uLocalLight;     // sky, block (0..1)
uniform vec3 uFlash;          // additive hit flash
uniform float uOpacity;
uniform vec3 uCamoA;
uniform vec3 uCamoB;
uniform vec3 uCamoC;
uniform float uCamoMode;      // 0 none, 1 woodland blobs, 2 digital, 3 stripes, 4 solid tint
uniform float uCamoScale;
uniform float uShadowOverride; // <0: use maps, else fixed visibility
uniform float uEmissiveBoost;
in vec3 vColor;
in vec4 vMat;
in vec4 vFace;
in vec3 vObj;
in vec3 vNormal;
in vec3 vWorld;

float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

vec3 camo(vec3 base, vec3 cell) {
  if (uCamoMode < 0.5) return base;
  if (uCamoMode > 3.5) return mix(base, uCamoA, 0.85);
  vec3 q = cell / uCamoScale;
  float n;
  if (uCamoMode < 1.5) {
    n = texture(uNoiseTex, q.xz * 0.11 + q.y * 0.07).r * 0.7 + texture(uNoiseTex, q.zy * 0.13 + 0.5).g * 0.3;
  } else if (uCamoMode < 2.5) {
    vec3 c = floor(q * 0.5);
    n = h3(c) * 0.6 + texture(uNoiseTex, c.xz * 0.05 + c.y * 0.03).r * 0.4;
  } else {
    n = fract((q.x + q.y * 0.6 + q.z) * 0.12) ;
  }
  vec3 c = n < 0.38 ? uCamoA : (n < 0.66 ? uCamoB : uCamoC);
  return c;
}

void main() {
  if (uOpacity < 1.0) {
    float d = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (d > uOpacity) discard;
  }
  if (uShadowPass > 0.5) { gl_FragColor = vec4(1.0); return; }
  vec3 N = normalize(vNormal);
  // per-voxel grain
  vec3 cell = floor(vObj - N * 0.01);
  float grain = h3(cell);
  vec3 albedo = vColor;
  if (vMat.w > 0.5) albedo = camo(albedo, cell);
  albedo *= 0.9 + grain * 0.18;
  // bevel highlight along box edges
  vec2 uv = vFace.xy;
  vec2 sz = vFace.zw;
  float e = min(min(uv.x, sz.x - uv.x), min(uv.y, sz.y - uv.y));
  float bevel = 1.0 - smoothstep(0.0, 0.45, e);
  albedo *= 1.0 + bevel * 0.22;
  float smoothness = vMat.x;
  float metal = vMat.y;
  float emissive = vMat.z * uEmissiveBoost;
  vec3 V = normalize(uCamPos - vWorld);
  float sky = uLocalLight.x;
  float blk = uLocalLight.y;
  vec3 col;
  if (metal > 0.5) {
    // metals: darker diffuse, tinted specular, strong sky reflection
    vec3 base = albedo;
    col = shadeSurface(base * 0.45, N, V, vWorld, sky, blk, 1.0, smoothness, 0.0, 0.0);
    vec3 R = reflect(-V, N);
    float fres = 0.5 + 0.5 * pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += skyBase(R) * base * fres * 0.55 * sky * sky;
    vec3 H = normalize(uLightDir + V);
    col += uLightColor * base * pow(max(dot(N, H), 0.0), 60.0) * 1.2 * max(dot(N, uLightDir), 0.0);
  } else {
    col = shadeSurface(albedo, N, V, vWorld, sky, blk, 1.0 - bevel * 0.0, smoothness, 0.0, 0.0);
  }
  col += albedo * emissive * 6.0;
  col += uFlash;
#ifndef NOFOG
  col = applyFog(col, vWorld);
#endif
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface EntityMatOptions {
  skinned?: boolean;
  fog?: boolean;
}

export function createEntityMaterial(opts: EntityMatOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, number> = {};
  if (opts.skinned) defines.SKINNED = 1;
  if (opts.fog === false) defines.NOFOG = 1;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uLocalLight: { value: new THREE.Vector2(1, 0) },
      uFlash: { value: new THREE.Color(0, 0, 0) },
      uOpacity: { value: 1 },
      uCamoA: { value: new THREE.Color(0.2, 0.25, 0.15) },
      uCamoB: { value: new THREE.Color(0.35, 0.3, 0.2) },
      uCamoC: { value: new THREE.Color(0.1, 0.1, 0.08) },
      uCamoMode: { value: 0 },
      uCamoScale: { value: 1 },
      uShadowOverride: { value: -1 },
      uEmissiveBoost: { value: 1 },
      ...(opts.skinned ? { uBones: { value: Array.from({ length: 10 }, () => new THREE.Matrix4()) } } : {}),
    },
    vertexShader: ENTITY_VS,
    fragmentShader: ENTITY_FS,
    defines,
  });
  return mat;
}

/** Simple additive / alpha "unlit" material for effects. */
export function createFxMaterial(opts: { additive?: boolean; color?: THREE.Color; opacity?: number } = {}) {
  return new THREE.MeshBasicMaterial({
    color: opts.color ?? new THREE.Color(1, 1, 1),
    transparent: true,
    opacity: opts.opacity ?? 1,
    depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
