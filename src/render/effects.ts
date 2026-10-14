// GPU-instanced effects: voxel debris & shell casings, billboard flashes,
// fire and smoke, bullet tracers, bullet-hole decals and block crack overlays.

import * as THREE from 'three';
import { COMMON, shared } from './shaderlib';
import { FX_LAYER } from './chunkRenderer';
import type { VoxelWorld } from '../world/world';
import { IS_SOLID, BLOCKS } from '../world/blocks';
import { buildTextures } from './textures';

// ---------------------------------------------------------------- debris cubes
const CUBE_VS = /* glsl */ `
${COMMON}
in vec4 aColorE;
out vec3 vColor;
out float vEmis;
out vec3 vN;
out vec3 vW;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vColor = aColorE.rgb;
  vEmis = aColorE.a;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CUBE_FS = /* glsl */ `
${COMMON}
in vec3 vColor;
in float vEmis;
in vec3 vN;
in vec3 vW;
void main() {
  if (uShadowPass > 0.5) { gl_FragColor = vec4(1.0); return; }
  vec3 N = normalize(vN);
  vec3 c = vColor * (uLightColor * max(dot(N, uLightDir), 0.0) * 0.8 + mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5) * 0.9 + vec3(0.03));
  c = mix(c, vColor * 4.0, vEmis);
  c = applyFog(c, vW);
  gl_FragColor = vec4(c, 1.0);
}
`;

interface Debris {
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  size: number;
  life: number;
  max: number;
  color: THREE.Color;
  emis: number;
  bounce: number;
  collide: boolean;
  gravity: number;
}

// ---------------------------------------------------------------- billboards
const BB_VS = /* glsl */ `
in vec4 aPosSize;
in vec4 aColor;
in vec4 aParams;
out vec2 vUv;
out vec4 vColor;
out vec4 vParams;
out vec3 vW;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float r = aParams.x;
  vec2 c = position.xy;
  vec2 rc = vec2(c.x * cos(r) - c.y * sin(r), c.x * sin(r) + c.y * cos(r));
  vec3 wp = aPosSize.xyz + (right * rc.x + up * rc.y) * aPosSize.w;
  vW = wp;
  vUv = position.xy + 0.5;
  vColor = aColor;
  vParams = aParams;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const BB_FS = /* glsl */ `
${COMMON}
in vec2 vUv;
in vec4 vColor;
in vec4 vParams;
in vec3 vW;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float kind = vParams.y;
  float age = vParams.z;
  float a = 0.0;
  vec3 col = vColor.rgb;
  if (kind < 0.5) {
    a = smoothstep(1.0, 0.0, d);
    a *= a;
  } else if (kind < 1.5) {
    // muzzle flash star
    float ang = atan(p.y, p.x);
    float spikes = pow(abs(cos(ang * 3.0 + vParams.w)), 8.0);
    a = smoothstep(1.0, 0.0, d / (0.35 + spikes * 0.65));
    a = max(a, smoothstep(0.45, 0.0, d));
  } else if (kind < 2.5) {
    // smoke
    float n = texture(uNoiseTex, vUv * 0.5 + vParams.w + vec2(age * 0.1, 0.0)).r;
    a = smoothstep(1.0, 0.2, d + (n - 0.5) * 0.7);
    vec3 lit = uAmbientSky * 0.9 + uLightColor * 0.35 + uBlockLightColor * 0.05;
    col = vColor.rgb * lit;
    col = applyFog(col, vW);
  } else if (kind < 3.5) {
    // fire
    float n = texture(uNoiseTex, vUv * 0.6 + vParams.w + vec2(0.0, -age * 0.4)).r;
    float m = smoothstep(1.0, 0.0, d + (n - 0.5) * 0.9);
    a = m;
    col = mix(vec3(4.0, 0.9, 0.2), vec3(9.0, 6.0, 2.5), m * (1.0 - age)) * (1.0 - age * 0.6);
  } else {
    // shockwave ring
    a = smoothstep(0.12, 0.0, abs(d - 0.85)) ;
  }
  a *= vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * (kind > 1.5 && kind < 2.5 ? 1.0 : a), kind > 1.5 && kind < 2.5 ? a : a);
}
`;

interface Billboard {
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: number;
  grow: number;
  life: number;
  max: number;
  color: THREE.Color;
  alpha: number;
  kind: number;
  rot: number;
  spin: number;
  seed: number;
  drag: number;
  rise: number;
}

class BillboardSystem {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  items: Billboard[] = [];
  aPosSize: THREE.InstancedBufferAttribute;
  aColor: THREE.InstancedBufferAttribute;
  aParams: THREE.InstancedBufferAttribute;
  constructor(public cap: number, additive: boolean) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.aPosSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aPosSize, this.aColor, this.aParams]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPosSize', this.aPosSize);
    this.geo.setAttribute('aColor', this.aColor);
    this.geo.setAttribute('aParams', this.aParams);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: BB_VS,
      fragmentShader: BB_FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    if (!additive) {
      mat.blending = THREE.NormalBlending;
      mat.premultipliedAlpha = false;
    }
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(FX_LAYER);
  }
  add(b: Billboard) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(b);
  }
  update(dt: number, camPos: THREE.Vector3) {
    const keep: Billboard[] = [];
    for (const b of this.items) {
      b.life -= dt;
      if (b.life <= 0) continue;
      b.v.multiplyScalar(Math.exp(-b.drag * dt));
      b.v.y += b.rise * dt;
      b.p.addScaledVector(b.v, dt);
      b.size += b.grow * dt;
      b.rot += b.spin * dt;
      keep.push(b);
    }
    this.items = keep;
    // sort alpha back-to-front for smoke
    if (this.mesh.material && !(this.mesh.material as THREE.ShaderMaterial).blending.toString().includes('Add')) {
      keep.sort((a, b) => b.p.distanceToSquared(camPos) - a.p.distanceToSquared(camPos));
    }
    const n = keep.length;
    const ps = this.aPosSize.array as Float32Array;
    const cs = this.aColor.array as Float32Array;
    const pr = this.aParams.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const b = keep[i];
      const age = 1 - b.life / b.max;
      const fade = b.kind === 2 ? Math.min(1, age * 6) * (1 - age) : b.kind === 3 ? 1 - age * age : 1 - age;
      ps[i * 4] = b.p.x;
      ps[i * 4 + 1] = b.p.y;
      ps[i * 4 + 2] = b.p.z;
      ps[i * 4 + 3] = b.size;
      cs[i * 4] = b.color.r;
      cs[i * 4 + 1] = b.color.g;
      cs[i * 4 + 2] = b.color.b;
      cs[i * 4 + 3] = b.alpha * fade;
      pr[i * 4] = b.rot;
      pr[i * 4 + 1] = b.kind;
      pr[i * 4 + 2] = age;
      pr[i * 4 + 3] = b.seed;
    }
    this.geo.instanceCount = n;
    this.aPosSize.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aParams.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- tracers
const TR_VS = /* glsl */ `
in vec3 aA;
in vec3 aB;
in vec4 aCol;
out vec4 vCol;
out float vAlong;
out float vSide;
void main() {
  vec3 p = mix(aA, aB, position.x);
  vec3 dir = normalize(aB - aA);
  vec3 camPos = cameraPosition;
  vec3 toCam = normalize(camPos - p);
  vec3 side = normalize(cross(dir, toCam));
  float w = aCol.a > 0.0 ? 0.03 : 0.03;
  p += side * position.y * w * (1.0 + length(camPos - p) * 0.004);
  vCol = aCol;
  vAlong = position.x;
  vSide = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const TR_FS = /* glsl */ `
in vec4 vCol;
in float vAlong;
in float vSide;
void main() {
  float a = (1.0 - abs(vSide)) * smoothstep(0.0, 0.3, vAlong) * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a);
}
`;

interface Tracer {
  a: THREE.Vector3;
  b: THREE.Vector3;
  life: number;
  max: number;
  color: THREE.Color;
  speed: number;
  len: number;
  t: number;
  total: number;
}

// ---------------------------------------------------------------- decals
const DC_VS = /* glsl */ `
in vec3 aPos;
in vec4 aN;
out vec2 vUv;
out float vSeed;
out vec3 vW;
void main() {
  vec3 n = aN.xyz;
  vec3 t = abs(n.y) > 0.5 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), n));
  vec3 b = cross(n, t);
  vec3 wp = aPos + n * 0.006 + (t * position.x + b * position.y) * 0.16;
  vUv = position.xy + 0.5;
  vSeed = aN.w;
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const DC_FS = /* glsl */ `
in vec2 vUv;
in float vSeed;
in vec3 vW;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float ang = atan(p.y, p.x);
  float r = length(p) + sin(ang * 5.0 + vSeed * 10.0) * 0.08;
  float hole = smoothstep(0.42, 0.3, r);
  float ring = smoothstep(0.9, 0.4, r) * 0.45;
  float a = max(hole, ring);
  if (a < 0.02) discard;
  vec3 c = mix(vec3(0.12, 0.1, 0.09), vec3(0.01), hole);
  gl_FragColor = vec4(c * 0.2, a * 0.9);
}
`;

// ---------------------------------------------------------------- crack overlay
const CK_VS = /* glsl */ `
in vec4 aBlock;
out vec2 vUv;
flat out float vLayer;
void main() {
  vec3 p = position * 1.004 + aBlock.xyz + 0.5;
  vec3 n = normal;
  vUv = abs(n.y) > 0.5 ? p.xz : (abs(n.x) > 0.5 ? p.zy : p.xy);
  vLayer = aBlock.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const CK_FS = /* glsl */ `
uniform sampler2DArray uAlbedo;
in vec2 vUv;
flat in float vLayer;
void main() {
  vec4 c = texture(uAlbedo, vec3(vUv, vLayer));
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.75);
}
`;

export class Effects {
  group = new THREE.Group();
  debris: Debris[] = [];
  cubeMesh: THREE.InstancedMesh;
  cubeColor: THREE.InstancedBufferAttribute;
  add: BillboardSystem;
  alpha: BillboardSystem;
  tracers: Tracer[] = [];
  trGeo: THREE.InstancedBufferGeometry;
  trA: THREE.InstancedBufferAttribute;
  trB: THREE.InstancedBufferAttribute;
  trC: THREE.InstancedBufferAttribute;
  trMesh: THREE.Mesh;
  decalGeo: THREE.InstancedBufferGeometry;
  decalPos: THREE.InstancedBufferAttribute;
  decalN: THREE.InstancedBufferAttribute;
  decalCount = 0;
  decalNext = 0;
  decalBlocks: number[] = [];
  crackGeo: THREE.InstancedBufferGeometry;
  crackAttr: THREE.InstancedBufferAttribute;
  crackMesh: THREE.Mesh;
  private dummy = new THREE.Object3D();
  private CAP = 3000;
  private DECALS = 320;
  private crackLayer0 = 0;

  constructor(public world: VoxelWorld | null) {
    // cubes
    const cg = new THREE.BoxGeometry(1, 1, 1);
    const cm = new THREE.ShaderMaterial({ uniforms: { ...shared }, vertexShader: CUBE_VS, fragmentShader: CUBE_FS });
    this.cubeMesh = new THREE.InstancedMesh(cg, cm, this.CAP);
    this.cubeColor = new THREE.InstancedBufferAttribute(new Float32Array(this.CAP * 4), 4);
    this.cubeColor.setUsage(THREE.DynamicDrawUsage);
    cg.setAttribute('aColorE', this.cubeColor);
    this.cubeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cubeMesh.count = 0;
    this.cubeMesh.frustumCulled = false;
    this.group.add(this.cubeMesh);

    this.add = new BillboardSystem(900, true);
    this.alpha = new BillboardSystem(900, false);
    this.group.add(this.add.mesh, this.alpha.mesh);

    // tracers
    const tq = new THREE.BufferGeometry();
    tq.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    tq.setIndex([0, 1, 2, 0, 2, 3]);
    this.trGeo = new THREE.InstancedBufferGeometry();
    this.trGeo.index = tq.index;
    this.trGeo.setAttribute('position', tq.getAttribute('position'));
    this.trA = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
    this.trB = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
    this.trC = new THREE.InstancedBufferAttribute(new Float32Array(400 * 4), 4);
    this.trGeo.setAttribute('aA', this.trA);
    this.trGeo.setAttribute('aB', this.trB);
    this.trGeo.setAttribute('aCol', this.trC);
    this.trGeo.instanceCount = 0;
    this.trMesh = new THREE.Mesh(
      this.trGeo,
      new THREE.ShaderMaterial({ vertexShader: TR_VS, fragmentShader: TR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.trMesh.frustumCulled = false;
    this.trMesh.layers.set(FX_LAYER);
    this.group.add(this.trMesh);

    // decals
    const dq = new THREE.PlaneGeometry(1, 1);
    this.decalGeo = new THREE.InstancedBufferGeometry();
    this.decalGeo.index = dq.index;
    this.decalGeo.setAttribute('position', dq.getAttribute('position'));
    this.decalPos = new THREE.InstancedBufferAttribute(new Float32Array(this.DECALS * 3), 3);
    this.decalN = new THREE.InstancedBufferAttribute(new Float32Array(this.DECALS * 4), 4);
    this.decalGeo.setAttribute('aPos', this.decalPos);
    this.decalGeo.setAttribute('aN', this.decalN);
    this.decalGeo.instanceCount = 0;
    const dm = new THREE.Mesh(
      this.decalGeo,
      new THREE.ShaderMaterial({ vertexShader: DC_VS, fragmentShader: DC_FS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    dm.frustumCulled = false;
    dm.layers.set(FX_LAYER);
    this.group.add(dm);

    // crack overlay
    const tex = buildTextures();
    this.crackLayer0 = tex.layers.get('crack_0') ?? 0;
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.crackGeo = new THREE.InstancedBufferGeometry();
    this.crackGeo.index = box.index;
    this.crackGeo.setAttribute('position', box.getAttribute('position'));
    this.crackGeo.setAttribute('normal', box.getAttribute('normal'));
    this.crackAttr = new THREE.InstancedBufferAttribute(new Float32Array(512 * 4), 4);
    this.crackGeo.setAttribute('aBlock', this.crackAttr);
    this.crackGeo.instanceCount = 0;
    this.crackMesh = new THREE.Mesh(
      this.crackGeo,
      new THREE.ShaderMaterial({
        uniforms: { uAlbedo: { value: tex.albedo } },
        vertexShader: CK_VS,
        fragmentShader: CK_FS,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    this.crackMesh.frustumCulled = false;
    this.crackMesh.layers.set(FX_LAYER);
    this.group.add(this.crackMesh);
  }

  setWorld(w: VoxelWorld | null) {
    this.world = w;
    this.clear();
  }

  clear() {
    this.debris = [];
    this.add.items = [];
    this.alpha.items = [];
    this.tracers = [];
    this.decalCount = 0;
    this.decalNext = 0;
    this.decalBlocks = [];
    this.decalGeo.instanceCount = 0;
    this.crackGeo.instanceCount = 0;
  }

  // ------------------------------------------------------------ spawners
  cube(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, opts: Partial<Debris> = {}) {
    if (this.debris.length >= this.CAP) this.debris.shift();
    this.debris.push({
      p: p.clone(),
      v: v.clone(),
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      size,
      life,
      max: life,
      color: color.clone(),
      emis: 0,
      bounce: 0.35,
      collide: true,
      gravity: 22,
      ...opts,
    });
  }

  blockBreak(x: number, y: number, z: number, blockId: number, count = 14) {
    const col = new THREE.Color().setRGB(...(BLOCKS[blockId]?.color.map((c) => Math.pow(c / 255, 2.2)) as [number, number, number]));
    for (let i = 0; i < count; i++) {
      const p = new THREE.Vector3(x + Math.random(), y + Math.random(), z + Math.random());
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 5 + 1, (Math.random() - 0.5) * 5);
      const c = col.clone().multiplyScalar(0.75 + Math.random() * 0.5);
      this.cube(p, v, c, 0.1 + Math.random() * 0.14, 1.2 + Math.random() * 1.2);
    }
    this.puff(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), col.clone().lerp(new THREE.Color(0.6, 0.6, 0.6), 0.5), 3, 1.1);
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, blockId: number, strong = false) {
    const def = BLOCKS[blockId];
    const col = def ? new THREE.Color().setRGB(...(def.color.map((c) => Math.pow(c / 255, 2.2)) as [number, number, number])) : new THREE.Color(0.4, 0.4, 0.4);
    const k = strong ? 2 : 1;
    for (let i = 0; i < 4 * k; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3));
      this.cube(p, v, col.clone().multiplyScalar(0.7 + Math.random() * 0.4), 0.04 + Math.random() * 0.05, 0.5 + Math.random() * 0.6);
    }
    const metal = def && (def.sound === 'metal' || def.sound === 'stone');
    if (metal) {
      for (let i = 0; i < 3 * k; i++) {
        const v = n.clone().multiplyScalar(4 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6));
        this.cube(p, v, new THREE.Color(6, 3.5, 1.2), 0.02, 0.18 + Math.random() * 0.2, { emis: 1, bounce: 0.5 });
      }
    }
    this.alpha.add({
      p: p.clone().addScaledVector(n, 0.08), v: n.clone().multiplyScalar(0.8), size: 0.18, grow: 0.9, life: 0.7, max: 0.7,
      color: col.clone().lerp(new THREE.Color(0.7, 0.68, 0.65), 0.5), alpha: 0.7, kind: 2, rot: Math.random() * 6, spin: 1, seed: Math.random(), drag: 2, rise: 0.4,
    });
  }

  flesh(p: THREE.Vector3, dir: THREE.Vector3, armor: boolean) {
    if (armor) {
      for (let i = 0; i < 6; i++) {
        const v = dir.clone().multiplyScalar(-2).add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5));
        this.cube(p, v, new THREE.Color(0.4, 1.4, 3.2), 0.035, 0.35, { emis: 1, collide: false });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const v = dir.clone().multiplyScalar(2.5).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3));
        this.cube(p, v, new THREE.Color(0.35, 0.02, 0.02), 0.05 + Math.random() * 0.04, 0.6 + Math.random() * 0.5);
      }
    }
  }

  puff(p: THREE.Vector3, color: THREE.Color, count: number, size: number, life = 1.4) {
    for (let i = 0; i < count; i++) {
      this.alpha.add({
        p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size)),
        v: new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5),
        size: size * (0.6 + Math.random() * 0.5), grow: size * 0.8, life, max: life, color, alpha: 0.55, kind: 2,
        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 1.5, seed: Math.random(), drag: 1.5, rise: 0.3,
      });
    }
  }

  muzzleFlash(p: THREE.Vector3, dir: THREE.Vector3, scale = 1, color = new THREE.Color(9, 6, 2.6)) {
    this.add.add({
      p: p.clone(), v: dir.clone().multiplyScalar(2), size: 0.42 * scale, grow: 0.6, life: 0.05, max: 0.05, color, alpha: 1, kind: 1,
      rot: Math.random() * 6, spin: 0, seed: Math.random() * 6, drag: 0, rise: 0,
    });
    this.add.add({
      p: p.clone().addScaledVector(dir, 0.12 * scale), v: dir.clone().multiplyScalar(3), size: 0.32 * scale, grow: 0.5, life: 0.06, max: 0.06,
      color: color.clone().multiplyScalar(0.6), alpha: 1, kind: 0, rot: 0, spin: 0, seed: 0, drag: 0, rise: 0,
    });
    this.alpha.add({
      p: p.clone().addScaledVector(dir, 0.15), v: dir.clone().multiplyScalar(1.2).add(new THREE.Vector3(0, 0.3, 0)), size: 0.12 * scale, grow: 0.9,
      life: 0.6, max: 0.6, color: new THREE.Color(0.8, 0.8, 0.8), alpha: 0.25, kind: 2, rot: Math.random() * 6, spin: 1, seed: Math.random(), drag: 2.5, rise: 0.5,
    });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color = new THREE.Color(3.5, 2.6, 1.2), speed = 380) {
    const total = a.distanceTo(b);
    this.tracers.push({ a: a.clone(), b: b.clone(), life: total / speed + 0.06, max: total / speed + 0.06, color, speed, len: Math.min(6, total * 0.5), t: 0, total });
  }

  explosion(p: THREE.Vector3, radius: number) {
    for (let i = 0; i < 14; i++) {
      this.add.add({
        p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius * 0.5, (Math.random() - 0.3) * radius * 0.4, (Math.random() - 0.5) * radius * 0.5)),
        v: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6),
        size: radius * (0.35 + Math.random() * 0.3), grow: radius * 0.5, life: 0.5 + Math.random() * 0.35, max: 0.85,
        color: new THREE.Color(1, 1, 1), alpha: 1, kind: 3, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 2, seed: Math.random(), drag: 3, rise: 2,
      });
    }
    this.add.add({ p: p.clone(), v: new THREE.Vector3(), size: radius * 0.5, grow: radius * 5, life: 0.35, max: 0.35, color: new THREE.Color(2, 1.6, 1.2), alpha: 0.8, kind: 4, rot: 0, spin: 0, seed: 0, drag: 0, rise: 0 });
    this.add.add({ p: p.clone(), v: new THREE.Vector3(), size: radius * 1.6, grow: 0, life: 0.12, max: 0.12, color: new THREE.Color(8, 6, 3), alpha: 1, kind: 0, rot: 0, spin: 0, seed: 0, drag: 0, rise: 0 });
    for (let i = 0; i < 14; i++) {
      this.alpha.add({
        p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius, Math.random() * radius * 0.5, (Math.random() - 0.5) * radius)),
        v: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3),
        size: radius * 0.4, grow: radius * 0.45, life: 3 + Math.random() * 2.5, max: 5.5, color: new THREE.Color(0.22, 0.2, 0.19), alpha: 0.75, kind: 2,
        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.6, seed: Math.random(), drag: 1.2, rise: 0.25,
      });
    }
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8 + 0.2, (Math.random() - 0.5)).normalize().multiplyScalar(6 + Math.random() * 10);
      this.cube(p, v, new THREE.Color(7, 3, 0.8), 0.04 + Math.random() * 0.04, 0.4 + Math.random() * 0.8, { emis: 1, bounce: 0.3 });
    }
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8 + 0.3, (Math.random() - 0.5)).normalize().multiplyScalar(5 + Math.random() * 6);
      this.cube(p, v, new THREE.Color(0.08, 0.07, 0.06), 0.1 + Math.random() * 0.1, 1.5 + Math.random());
    }
  }

  smokeCloud(p: THREE.Vector3, life: number) {
    for (let i = 0; i < 46; i++) {
      const off = new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 3.2, (Math.random() - 0.5) * 7);
      this.alpha.add({
        p: p.clone().add(off).add(new THREE.Vector3(0, 0.3, 0)), v: off.clone().multiplyScalar(0.25), size: 1.6 + Math.random() * 1.4, grow: 0.35,
        life: life * (0.75 + Math.random() * 0.3), max: life, color: new THREE.Color(0.82, 0.84, 0.86), alpha: 0.92, kind: 2,
        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.25, seed: Math.random(), drag: 0.9, rise: 0.02,
      });
    }
  }

  casing(p: THREE.Vector3, v: THREE.Vector3, kind: 'small' | 'rifle' | 'shotgun') {
    const color = kind === 'shotgun' ? new THREE.Color(0.55, 0.05, 0.04) : new THREE.Color(0.75, 0.52, 0.16);
    const s = kind === 'rifle' ? 0.045 : kind === 'shotgun' ? 0.06 : 0.035;
    this.cube(p, v, color, s, 1.6, { bounce: 0.4, gravity: 18 });
  }

  decal(p: THREE.Vector3, n: THREE.Vector3, bx: number, by: number, bz: number) {
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % this.DECALS;
    this.decalCount = Math.min(this.DECALS, this.decalCount + 1);
    const pa = this.decalPos.array as Float32Array;
    const na = this.decalN.array as Float32Array;
    pa[i * 3] = p.x;
    pa[i * 3 + 1] = p.y;
    pa[i * 3 + 2] = p.z;
    na[i * 4] = n.x;
    na[i * 4 + 1] = n.y;
    na[i * 4 + 2] = n.z;
    na[i * 4 + 3] = Math.random();
    this.decalBlocks[i] = this.world ? this.world.idx(bx, by, bz) : -1;
    this.decalGeo.instanceCount = this.decalCount;
    this.decalPos.needsUpdate = true;
    this.decalN.needsUpdate = true;
  }

  /** remove decals sitting on a block that changed */
  clearDecalsAt(idx: number) {
    const pa = this.decalPos.array as Float32Array;
    let changed = false;
    for (let i = 0; i < this.decalCount; i++) {
      if (this.decalBlocks[i] === idx) {
        pa[i * 3 + 1] = -9999;
        changed = true;
      }
    }
    if (changed) this.decalPos.needsUpdate = true;
  }

  setCracks(list: { x: number; y: number; z: number; stage: number }[]) {
    const a = this.crackAttr.array as Float32Array;
    const n = Math.min(512, list.length);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      a[i * 4] = c.x;
      a[i * 4 + 1] = c.y;
      a[i * 4 + 2] = c.z;
      a[i * 4 + 3] = this.crackLayer0 + Math.max(0, Math.min(4, c.stage));
    }
    this.crackGeo.instanceCount = n;
    this.crackAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------ update
  update(dt: number, camPos: THREE.Vector3) {
    const w = this.world;
    const keep: Debris[] = [];
    for (const d of this.debris) {
      d.life -= dt;
      if (d.life <= 0) continue;
      d.v.y -= d.gravity * dt;
      const np = d.p.clone().addScaledVector(d.v, dt);
      if (d.collide && w && IS_SOLID[w.getF(np.x, np.y, np.z)]) {
        // bounce on the axis that entered a block
        if (IS_SOLID[w.getF(d.p.x, np.y, d.p.z)]) {
          d.v.y = -d.v.y * d.bounce;
          d.v.x *= 0.6;
          d.v.z *= 0.6;
          np.y = d.p.y;
          d.spin.multiplyScalar(0.5);
        }
        if (IS_SOLID[w.getF(np.x, d.p.y, d.p.z)]) {
          d.v.x = -d.v.x * d.bounce;
          np.x = d.p.x;
        }
        if (IS_SOLID[w.getF(d.p.x, d.p.y, np.z)]) {
          d.v.z = -d.v.z * d.bounce;
          np.z = d.p.z;
        }
      }
      d.p.copy(np);
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;
      keep.push(d);
    }
    this.debris = keep;
    const n = keep.length;
    const ca = this.cubeColor.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const d = keep[i];
      const s = d.size * Math.min(1, d.life / (d.max * 0.3));
      this.dummy.position.copy(d.p);
      this.dummy.rotation.copy(d.rot);
      this.dummy.scale.setScalar(Math.max(0.001, s));
      this.dummy.updateMatrix();
      this.cubeMesh.setMatrixAt(i, this.dummy.matrix);
      ca[i * 4] = d.color.r;
      ca[i * 4 + 1] = d.color.g;
      ca[i * 4 + 2] = d.color.b;
      ca[i * 4 + 3] = d.emis;
    }
    this.cubeMesh.count = n;
    this.cubeMesh.instanceMatrix.needsUpdate = true;
    this.cubeColor.needsUpdate = true;

    this.add.update(dt, camPos);
    this.alpha.update(dt, camPos);

    // tracers travel along their path
    const tk: Tracer[] = [];
    for (const t of this.tracers) {
      t.life -= dt;
      t.t += dt;
      if (t.life <= 0) continue;
      tk.push(t);
    }
    this.tracers = tk.slice(-400);
    const A = this.trA.array as Float32Array;
    const Bt = this.trB.array as Float32Array;
    const C = this.trC.array as Float32Array;
    const dir = new THREE.Vector3();
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      dir.subVectors(t.b, t.a).normalize();
      const head = Math.min(t.total, t.t * t.speed);
      const tail = Math.max(0, head - t.len);
      const a = t.a.clone().addScaledVector(dir, tail);
      const b = t.a.clone().addScaledVector(dir, head);
      A[i * 3] = a.x; A[i * 3 + 1] = a.y; A[i * 3 + 2] = a.z;
      Bt[i * 3] = b.x; Bt[i * 3 + 1] = b.y; Bt[i * 3 + 2] = b.z;
      C[i * 4] = t.color.r; C[i * 4 + 1] = t.color.g; C[i * 4 + 2] = t.color.b; C[i * 4 + 3] = Math.min(1, t.life / t.max * 2);
    }
    this.trGeo.instanceCount = this.tracers.length;
    this.trA.needsUpdate = true;
    this.trB.needsUpdate = true;
    this.trC.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- ghost preview
export class GhostBlocks {
  mesh: THREE.InstancedMesh;
  edges: THREE.LineSegments;
  mat: THREE.MeshBasicMaterial;
  private dummy = new THREE.Object3D();
  constructor(cap = 64) {
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.7, 1.4), transparent: true, opacity: 0.28, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(FX_LAYER);
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01));
    this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 0.9, 2), transparent: true, opacity: 0.8 }));
    this.edges.frustumCulled = false;
    this.edges.layers.set(FX_LAYER);
    (this.edges as any).baseEdge = eg;
  }
  set(blocks: { x: number; y: number; z: number }[], valid: boolean) {
    const n = Math.min(blocks.length, 64);
    for (let i = 0; i < n; i++) {
      this.dummy.position.set(blocks[i].x + 0.5, blocks[i].y + 0.5, blocks[i].z + 0.5);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mat.color.set(valid ? new THREE.Color(0.3, 0.75, 1.5) : new THREE.Color(1.6, 0.25, 0.2));
    (this.edges.material as THREE.LineBasicMaterial).color.set(valid ? new THREE.Color(0.6, 1.0, 2.2) : new THREE.Color(2.2, 0.4, 0.3));
    // merge edges
    const base = (this.edges as any).baseEdge as THREE.BufferGeometry;
    const bp = base.getAttribute('position').array as Float32Array;
    const out = new Float32Array(bp.length * n);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < bp.length; k += 3) {
        out[i * bp.length + k] = bp[k] + blocks[i].x + 0.5;
        out[i * bp.length + k + 1] = bp[k + 1] + blocks[i].y + 0.5;
        out[i * bp.length + k + 2] = bp[k + 2] + blocks[i].z + 0.5;
      }
    this.edges.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    this.edges.geometry = g;
    this.mesh.visible = n > 0;
    this.edges.visible = n > 0;
  }
  hide() {
    this.mesh.visible = false;
    this.edges.visible = false;
  }
}
