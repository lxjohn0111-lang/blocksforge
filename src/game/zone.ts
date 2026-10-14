// Battle Royale storm: alternating hold/shrink phases with rising damage.

import * as THREE from 'three';
import { RNG } from '../core/rng';
import type { VoxelWorld } from '../world/world';
import { FX_LAYER } from '../render/chunkRenderer';
import { shared } from '../render/shaderlib';

export interface ZonePhase {
  wait: number;
  shrink: number;
  frac: number;
  dps: number;
}

export const PHASES: ZonePhase[] = [
  { wait: 70, shrink: 45, frac: 0.6, dps: 1 },
  { wait: 50, shrink: 40, frac: 0.38, dps: 2 },
  { wait: 45, shrink: 35, frac: 0.22, dps: 4 },
  { wait: 40, shrink: 30, frac: 0.11, dps: 6 },
  { wait: 30, shrink: 25, frac: 0.045, dps: 9 },
  { wait: 20, shrink: 25, frac: 0.0, dps: 12 },
];

const WALL_VS = /* glsl */ `
out vec3 vW;
out vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const WALL_FS = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoiseTex;
uniform vec3 uCamPos;
in vec3 vW;
in vec2 vUv;
void main() {
  float n = texture(uNoiseTex, vec2(vUv.x * 6.0 + uTime * 0.02, vW.y * 0.01 - uTime * 0.03)).r;
  float n2 = texture(uNoiseTex, vec2(vUv.x * 14.0 - uTime * 0.04, vW.y * 0.025 + uTime * 0.05)).g;
  float bands = smoothstep(0.35, 0.65, fract(vW.y * 0.08 - uTime * 0.25 + n * 2.0));
  float a = 0.16 + n * 0.25 + bands * 0.12 + n2 * 0.1;
  float d = length(uCamPos - vW);
  a *= smoothstep(1.0, 12.0, d) * 0.85 + 0.15;
  vec3 col = mix(vec3(0.45, 0.18, 1.0), vec3(1.0, 0.45, 1.4), n2) * (1.2 + bands);
  gl_FragColor = vec4(col * a, a);
}
`;

export class Zone {
  center = new THREE.Vector2();
  radius: number;
  from = new THREE.Vector2();
  fromR: number;
  to = new THREE.Vector2();
  toR: number;
  phase = -1;
  timer = 0;
  shrinking = false;
  dps = 0;
  mesh: THREE.Mesh;
  private rng: RNG;
  /** true while the final circle has fully closed */
  closed = false;

  constructor(private world: VoxelWorld, mapCenter: THREE.Vector2, startRadius: number, seed: number) {
    this.rng = new RNG(seed);
    this.center.copy(mapCenter);
    this.radius = startRadius;
    this.from.copy(mapCenter);
    this.fromR = startRadius;
    this.to.copy(mapCenter);
    this.toR = startRadius;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uNoiseTex: shared.uNoiseTex, uCamPos: shared.uCamPos },
      vertexShader: WALL_VS,
      fragmentShader: WALL_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.layers.set(FX_LAYER);
    this.mesh.frustumCulled = false;
    this.planNext();
  }

  /** plan the circle that phase `next` shrinks to */
  private planNext(next = this.phase + 1) {
    if (next >= PHASES.length) return;
    const p = PHASES[next];
    const mapR = Math.min(this.world.sx, this.world.sz) * 0.5;
    const r = Math.max(0, mapR * p.frac);
    // pick a centre inside the current circle so the new one fits, prefer land
    let best = this.center.clone();
    let bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const maxOff = Math.max(0, this.toR - r);
      const a = this.rng.next() * Math.PI * 2;
      const d = Math.sqrt(this.rng.next()) * maxOff * 0.85;
      const c = new THREE.Vector2(this.to.x + Math.cos(a) * d, this.to.y + Math.sin(a) * d);
      const h = this.world.height(c.x, c.y);
      const land = h > this.world.seaLevel ? 1 : 0;
      const inside = c.x > 30 && c.y > 30 && c.x < this.world.sx - 30 && c.y < this.world.sz - 30 ? 1 : 0;
      const score = land * 2 + inside + this.rng.next() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.from.copy(this.to);
    this.fromR = this.toR;
    this.to.copy(best);
    this.toR = r;
  }

  /** Seconds until the next shrink starts (or ends while shrinking). */
  get countdown() {
    if (this.phase >= PHASES.length) return 0;
    const p = PHASES[Math.max(0, this.phase)];
    return this.shrinking ? p.shrink - this.timer : (this.phase < 0 ? PHASES[0].wait : p.wait) - this.timer;
  }

  start() {
    this.phase = 0;
    this.timer = 0;
    this.shrinking = false;
    this.dps = PHASES[0].dps;
  }

  update(dt: number): 'shrink_start' | 'phase_end' | null {
    let ev: 'shrink_start' | 'phase_end' | null = null;
    if (this.phase < 0 || this.phase >= PHASES.length) {
      this.syncMesh();
      return null;
    }
    const p = PHASES[this.phase];
    this.timer += dt;
    if (!this.shrinking) {
      if (this.timer >= p.wait) {
        this.shrinking = true;
        this.timer = 0;
        ev = 'shrink_start';
      }
    } else {
      const t = Math.min(1, this.timer / p.shrink);
      this.center.lerpVectors(this.from, this.to, t);
      this.radius = this.fromR + (this.toR - this.fromR) * t;
      if (t >= 1) {
        this.shrinking = false;
        this.timer = 0;
        this.phase++;
        ev = 'phase_end';
        if (this.phase < PHASES.length) {
          this.dps = PHASES[this.phase].dps;
          this.planNext(this.phase);
        } else {
          this.closed = this.radius < 1;
          this.dps = 15;
        }
      }
    }
    this.syncMesh();
    return ev;
  }

  syncMesh() {
    this.mesh.position.set(this.center.x, -10, this.center.y);
    this.mesh.scale.set(Math.max(0.5, this.radius), 140, Math.max(0.5, this.radius));
  }

  outside(x: number, z: number) {
    return Math.hypot(x - this.center.x, z - this.center.y) > this.radius;
  }

  distOutside(x: number, z: number) {
    return Math.hypot(x - this.center.x, z - this.center.y) - this.radius;
  }

  /** distance from point to next safe circle edge (negative inside) */
  distToNext(x: number, z: number) {
    return Math.hypot(x - this.to.x, z - this.to.y) - this.toR;
  }
}
