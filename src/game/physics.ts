// Character movement shared by the player and AI: axis-separated AABB vs
// voxel collision, automatic 1-block step-up, swimming and fall tracking.

import * as THREE from 'three';
import { IS_SOLID, B } from '../world/blocks';
import type { VoxelWorld } from '../world/world';

export const GRAVITY = 28;
export const JUMP_V = 8.7;
export const STAND_H = 1.8;
export const CROUCH_H = 1.45;
export const HALF_W = 0.3;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.25;

export interface Body {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  height: number;
  half: number;
  onGround: boolean;
  inWater: boolean;
  headInWater: boolean;
  /** visual offset smoothing after step-ups */
  stepSmooth: number;
  /** highest y since leaving the ground */
  fallPeakY: number;
  lastGroundTime: number;
}

export function makeBody(x: number, y: number, z: number): Body {
  return {
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    height: STAND_H,
    half: HALF_W,
    onGround: false,
    inWater: false,
    headInWater: false,
    stepSmooth: 0,
    fallPeakY: y,
    lastGroundTime: 0,
  };
}

export function boxCollides(w: VoxelWorld, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const ax = Math.floor(x0), bx = Math.floor(x1 - 1e-6);
  const ay = Math.floor(y0), by = Math.floor(y1 - 1e-6);
  const az = Math.floor(z0), bz = Math.floor(z1 - 1e-6);
  for (let x = ax; x <= bx; x++)
    for (let z = az; z <= bz; z++)
      for (let y = ay; y <= by; y++) {
        if (IS_SOLID[w.get(x, y, z)]) return true;
      }
  return false;
}

export function bodyCollides(w: VoxelWorld, b: Body, px = b.pos.x, py = b.pos.y, pz = b.pos.z, h = b.height) {
  return boxCollides(w, px - b.half, py, pz - b.half, px + b.half, py + h, pz + b.half);
}

const EPS = 0.0015;

export interface MoveResult {
  landed: boolean;
  fallDist: number;
  hitWall: boolean;
  stepped: boolean;
}

/** Integrate body.vel over dt with collision. */
export function moveBody(w: VoxelWorld, b: Body, dt: number, allowStep: boolean, now: number): MoveResult {
  const res: MoveResult = { landed: false, fallDist: 0, hitWall: false, stepped: false };
  const wasGround = b.onGround;
  // horizontal axes
  for (const axis of [0, 2] as const) {
    const d = (axis === 0 ? b.vel.x : b.vel.z) * dt;
    if (d === 0) continue;
    const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.35));
    const sd = d / steps;
    for (let s = 0; s < steps; s++) {
      const nx = b.pos.x + (axis === 0 ? sd : 0);
      const nz = b.pos.z + (axis === 2 ? sd : 0);
      if (!bodyCollides(w, b, nx, b.pos.y, nz)) {
        b.pos.x = nx;
        b.pos.z = nz;
        continue;
      }
      // try stepping up one block
      if (allowStep && (wasGround || b.inWater) && b.vel.y <= 0.5) {
        const up = Math.floor(b.pos.y + 1.0001) - b.pos.y + EPS;
        if (up <= 1.05 && !bodyCollides(w, b, b.pos.x, b.pos.y + up, b.pos.z) && !bodyCollides(w, b, nx, b.pos.y + up, nz)) {
          b.pos.y += up;
          b.pos.x = nx;
          b.pos.z = nz;
          b.stepSmooth -= up;
          res.stepped = true;
          continue;
        }
      }
      // snap against the wall
      if (axis === 0) {
        if (sd > 0) b.pos.x = Math.floor(nx + b.half) - b.half - EPS;
        else b.pos.x = Math.floor(nx - b.half) + 1 + b.half + EPS;
        b.vel.x = 0;
      } else {
        if (sd > 0) b.pos.z = Math.floor(nz + b.half) - b.half - EPS;
        else b.pos.z = Math.floor(nz - b.half) + 1 + b.half + EPS;
        b.vel.z = 0;
      }
      res.hitWall = true;
      break;
    }
  }
  // vertical
  const dy = b.vel.y * dt;
  b.onGround = false;
  if (dy !== 0) {
    const steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.35));
    const sd = dy / steps;
    for (let s = 0; s < steps; s++) {
      const ny = b.pos.y + sd;
      if (!bodyCollides(w, b, b.pos.x, ny, b.pos.z)) {
        b.pos.y = ny;
        continue;
      }
      if (sd < 0) {
        b.pos.y = Math.floor(ny) + 1 + EPS;
        b.onGround = true;
      } else {
        b.pos.y = Math.floor(ny + b.height) - b.height - EPS;
      }
      b.vel.y = 0;
      break;
    }
  }
  // ground probe (standing still on ground)
  if (!b.onGround && b.vel.y <= 0 && bodyCollides(w, b, b.pos.x, b.pos.y - 0.02, b.pos.z)) b.onGround = true;

  if (b.onGround) {
    if (!wasGround) {
      res.landed = true;
      res.fallDist = Math.max(0, b.fallPeakY - b.pos.y);
    }
    b.fallPeakY = b.pos.y;
    b.lastGroundTime = now;
  } else {
    b.fallPeakY = Math.max(b.fallPeakY, b.pos.y);
  }
  // water state
  const feet = w.get(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.3), Math.floor(b.pos.z));
  const mid = w.get(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.9), Math.floor(b.pos.z));
  const head = w.get(Math.floor(b.pos.x), Math.floor(b.pos.y + b.height - 0.15), Math.floor(b.pos.z));
  b.inWater = feet === B.WATER || mid === B.WATER;
  b.headInWater = head === B.WATER;
  if (b.inWater) b.fallPeakY = b.pos.y;
  // decay step smoothing
  b.stepSmooth *= Math.exp(-dt * 18);
  if (Math.abs(b.stepSmooth) < 0.001) b.stepSmooth = 0;
  return res;
}

/** Push a body out if it ended up inside blocks (e.g. a block was placed). */
export function unstick(w: VoxelWorld, b: Body) {
  if (!bodyCollides(w, b)) return;
  for (let up = 1; up <= 4; up++) {
    if (!bodyCollides(w, b, b.pos.x, Math.floor(b.pos.y) + up + EPS, b.pos.z)) {
      b.pos.y = Math.floor(b.pos.y) + up + EPS;
      return;
    }
  }
}

export interface MoveIntent {
  forward: number;
  strafe: number;
  yaw: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  speedMult: number;
}

export interface MoveTuning {
  walk: number;
  sprint: number;
  crouch: number;
  swim: number;
  accelGround: number;
  accelAir: number;
  friction: number;
}

export const DEFAULT_TUNING: MoveTuning = { walk: 4.6, sprint: 6.7, crouch: 2.3, swim: 3.2, accelGround: 60, accelAir: 12, friction: 12 };

/** Apply an intent to velocity (does not integrate position). Returns true if a jump happened. */
export function applyIntent(b: Body, it: MoveIntent, dt: number, t: MoveTuning = DEFAULT_TUNING): boolean {
  const sy = Math.sin(it.yaw);
  const cy = Math.cos(it.yaw);
  // forward = -Z when yaw 0
  let wx = -sy * it.forward + cy * it.strafe;
  let wz = -cy * it.forward - sy * it.strafe;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  let speed = it.crouch ? t.crouch : it.sprint && it.forward > 0.3 ? t.sprint : t.walk;
  if (b.inWater) speed = t.swim;
  speed *= it.speedMult;
  const tx = wx * speed;
  const tz = wz * speed;
  const accel = b.onGround || b.inWater ? t.accelGround : t.accelAir;
  const dvx = tx - b.vel.x;
  const dvz = tz - b.vel.z;
  const dl = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dl > maxDv) {
    b.vel.x += (dvx / dl) * maxDv;
    b.vel.z += (dvz / dl) * maxDv;
  } else {
    b.vel.x = tx;
    b.vel.z = tz;
  }
  let jumped = false;
  if (b.inWater) {
    b.vel.y -= GRAVITY * 0.25 * dt;
    if (it.jump) b.vel.y += 22 * dt;
    if (it.crouch) b.vel.y -= 10 * dt;
    b.vel.y *= Math.exp(-dt * 3.5);
    // hop out of water onto ledges
    if (it.jump && !b.headInWater && it.forward > 0) b.vel.y = Math.max(b.vel.y, 5.5);
  } else {
    b.vel.y -= GRAVITY * dt;
    if (b.vel.y < -55) b.vel.y = -55;
    if (it.jump && b.onGround) {
      b.vel.y = JUMP_V;
      b.onGround = false;
      jumped = true;
    }
  }
  return jumped;
}
