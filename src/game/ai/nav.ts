// Voxel pathfinding for AI. A cell (x,y,z) is standable when the block below
// supports it and two blocks of headroom are free. Moves: 8-way, step up 1,
// drop up to 3. Searches are budgeted and time-sliced across bots.

import * as THREE from 'three';
import { IS_SOLID, B } from '../../world/blocks';
import type { VoxelWorld } from '../../world/world';

export function passable(w: VoxelWorld, x: number, y: number, z: number) {
  return !IS_SOLID[w.get(x, y, z)];
}

export function standable(w: VoxelWorld, x: number, y: number, z: number) {
  if (!passable(w, x, y, z) || !passable(w, x, y + 1, z)) return false;
  const below = w.get(x, y - 1, z);
  return IS_SOLID[below] === 1 || below === B.WATER || w.get(x, y, z) === B.WATER;
}

/** find a standable y near a column position */
export function snapStand(w: VoxelWorld, x: number, y: number, z: number): number | null {
  for (let d = 0; d <= 4; d++) {
    if (standable(w, x, y - d, z)) return y - d;
    if (d > 0 && standable(w, x, y + d, z)) return y + d;
  }
  return null;
}

class Heap {
  items: number[] = [];
  pri: number[] = [];
  push(v: number, p: number) {
    const it = this.items;
    const pr = this.pri;
    let i = it.length;
    it.push(v);
    pr.push(p);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pr[par] <= pr[i]) break;
      [it[i], it[par]] = [it[par], it[i]];
      [pr[i], pr[par]] = [pr[par], pr[i]];
      i = par;
    }
  }
  pop(): number {
    const it = this.items;
    const pr = this.pri;
    const top = it[0];
    const lastV = it.pop()!;
    const lastP = pr.pop()!;
    if (it.length) {
      it[0] = lastV;
      pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < it.length && pr[l] < pr[m]) m = l;
        if (r < it.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[i], it[m]] = [it[m], it[i]];
        [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export interface PathResult {
  points: THREE.Vector3[];
  complete: boolean;
}

export function findPath(w: VoxelWorld, from: THREE.Vector3, to: THREE.Vector3, budget = 3000, avoid?: (x: number, z: number) => number): PathResult | null {
  const sx = Math.floor(from.x), sz = Math.floor(from.z);
  let sy = snapStand(w, sx, Math.floor(from.y + 0.1), sz);
  if (sy === null) sy = Math.floor(from.y + 0.1);
  const gx = Math.floor(to.x), gz = Math.floor(to.z);
  const gyRaw = Math.floor(to.y + 0.1);
  const gy = snapStand(w, gx, gyRaw, gz) ?? gyRaw;
  const key = (x: number, y: number, z: number) => (z * w.sx + x) * w.sy + y;
  const startK = key(sx, sy, sz);
  const goalK = key(gx, gy, gz);
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const open = new Heap();
  const h = (x: number, y: number, z: number) => {
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(y - gy) * 0.5;
  };
  g.set(startK, 0);
  open.push(startK, h(sx, sy, sz));
  let best = startK;
  let bestH = h(sx, sy, sz);
  let expanded = 0;
  const dec = (k: number) => {
    const y = k % w.sy;
    const col = (k - y) / w.sy;
    const x = col % w.sx;
    const z = (col - x) / w.sx;
    return [x, y, z];
  };
  while (open.size && expanded < budget) {
    const cur = open.pop();
    if (cur === goalK) {
      best = cur;
      bestH = 0;
      break;
    }
    expanded++;
    const [x, y, z] = dec(cur);
    const cg = g.get(cur)!;
    const inWater = w.get(x, y, z) === B.WATER;
    for (const [dx, dz, cost] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 1 || nz < 1 || nx >= w.sx - 1 || nz >= w.sz - 1) continue;
      if (dx !== 0 && dz !== 0) {
        // no corner cutting
        if (!passable(w, x + dx, y, z) || !passable(w, x, y, z + dz) || !passable(w, x + dx, y + 1, z) || !passable(w, x, y + 1, z + dz)) continue;
      }
      let ny = -1;
      if (standable(w, nx, y, nz)) ny = y;
      else if (standable(w, nx, y + 1, nz) && passable(w, x, y + 2, z)) ny = y + 1;
      else {
        for (let d = 1; d <= 3; d++) {
          if (!passable(w, nx, y - d + 1, nz)) break;
          if (standable(w, nx, y - d, nz)) {
            ny = y - d;
            break;
          }
        }
      }
      if (ny < 0) continue;
      const nk = key(nx, ny, nz);
      let c = cost + (ny > y ? 0.6 : 0) + (inWater || w.get(nx, ny, nz) === B.WATER ? 2.5 : 0);
      if (avoid) c += avoid(nx, nz);
      const ng = cg + c;
      const old = g.get(nk);
      if (old !== undefined && old <= ng) continue;
      g.set(nk, ng);
      came.set(nk, cur);
      const hh = h(nx, ny, nz);
      if (hh < bestH) {
        bestH = hh;
        best = nk;
      }
      open.push(nk, ng + hh * 1.15);
    }
  }
  if (best === startK) return null;
  const pts: THREE.Vector3[] = [];
  let k: number | undefined = best;
  while (k !== undefined && k !== startK) {
    const [x, y, z] = dec(k);
    pts.push(new THREE.Vector3(x + 0.5, y, z + 0.5));
    k = came.get(k);
  }
  pts.reverse();
  return { points: smooth(w, from, pts), complete: best === goalK };
}

/** walkable straight line check (same height or gentle) */
function clearLine(w: VoxelWorld, a: THREE.Vector3, b: THREE.Vector3): boolean {
  if (Math.abs(a.y - b.y) > 0.5) return false;
  const d = a.distanceTo(b);
  const steps = Math.ceil(d * 2.5);
  const y = Math.floor(a.y + 0.1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    for (const ox of [-0.3, 0.3])
      for (const oz of [-0.3, 0.3]) {
        const cx = Math.floor(x + ox), cz = Math.floor(z + oz);
        if (!passable(w, cx, y, cz) || !passable(w, cx, y + 1, cz)) return false;
        if (!IS_SOLID[w.get(cx, y - 1, cz)] && w.get(cx, y - 1, cz) !== B.WATER) return false;
      }
  }
  return true;
}

function smooth(w: VoxelWorld, from: THREE.Vector3, pts: THREE.Vector3[]): THREE.Vector3[] {
  if (pts.length < 3) return pts;
  const out: THREE.Vector3[] = [];
  let anchor = new THREE.Vector3(from.x, Math.floor(from.y + 0.1), from.z);
  let i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 12);
    while (j > i && !clearLine(w, anchor, pts[j])) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}

/** Shared time-sliced queue so many bots don't path in the same frame. */
export class NavService {
  private queue: { from: THREE.Vector3; to: THREE.Vector3; budget: number; cb: (r: PathResult | null) => void; avoid?: (x: number, z: number) => number }[] = [];
  constructor(public world: VoxelWorld) {}
  request(from: THREE.Vector3, to: THREE.Vector3, cb: (r: PathResult | null) => void, budget = 2500, avoid?: (x: number, z: number) => number) {
    this.queue.push({ from: from.clone(), to: to.clone(), budget, cb, avoid });
  }
  get pending() {
    return this.queue.length;
  }
  update(maxMs = 3) {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < maxMs) {
      const r = this.queue.shift()!;
      r.cb(findPath(this.world, r.from, r.to, r.budget, r.avoid));
    }
  }
  clear() {
    this.queue = [];
  }
}
