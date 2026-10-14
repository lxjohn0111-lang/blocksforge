// Minecraft-style light propagation: 4-bit sky light + 4-bit block light per
// voxel, flood-filled with a BFS. Supports re-lighting a bounded region after
// edits so building and destruction update light locally.

import { IS_OPAQUE, ATTEN, EMIT } from './blocks';
import type { VoxelWorld } from './world';
import { CHUNK } from './world';

class IntQueue {
  buf: Int32Array;
  head = 0;
  tail = 0;
  constructor(cap = 1 << 16) {
    this.buf = new Int32Array(cap);
  }
  push(v: number) {
    if (this.tail === this.buf.length) {
      if (this.head > this.buf.length / 2) {
        this.buf.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      } else {
        const nb = new Int32Array(this.buf.length * 2);
        nb.set(this.buf.subarray(this.head, this.tail));
        this.tail -= this.head;
        this.head = 0;
        this.buf = nb;
      }
    }
    this.buf[this.tail++] = v;
  }
  get size() {
    return this.tail - this.head;
  }
  pop() {
    return this.buf[this.head++];
  }
  reset() {
    this.head = this.tail = 0;
  }
}

const queue = new IntQueue(1 << 18);

export function computeAllLight(w: VoxelWorld) {
  relightRegion(w, 0, 0, w.sx - 1, w.sz - 1, true);
}

/**
 * Recompute light inside [x0..x1]x[z0..z1] (full height). Cells outside keep
 * their values and act as boundary sources. Returns chunk indices whose light
 * changed.
 */
export function relightRegion(w: VoxelWorld, x0: number, z0: number, x1: number, z1: number, full = false): Set<number> {
  x0 = Math.max(0, x0);
  z0 = Math.max(0, z0);
  x1 = Math.min(w.sx - 1, x1);
  z1 = Math.min(w.sz - 1, z1);
  const changed = new Set<number>();
  if (x1 < x0 || z1 < z0) return changed;
  const sx = w.sx;
  const sy = w.sy;
  const sz = w.sz;
  const blocks = w.blocks;
  const light = w.light;
  const W = x1 - x0 + 1;
  const D = z1 - z0 + 1;

  let old: Uint8Array | null = null;
  if (!full) {
    old = new Uint8Array(W * D * sy);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const base = (z * sx + x) * sy;
        old.set(light.subarray(base, base + sy), ((z - z0) * W + (x - x0)) * sy);
      }
  }

  // column pass
  const sunTop = new Int16Array(W * D);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const base = (z * sx + x) * sy;
      let sky = 15;
      let top = 0;
      let topSet = false;
      for (let y = sy - 1; y >= 0; y--) {
        const id = blocks[base + y];
        if (IS_OPAQUE[id]) sky = 0;
        else if (ATTEN[id]) sky = Math.max(0, sky - ATTEN[id]);
        if (sky < 15 && !topSet) {
          top = y + 1;
          topSet = true;
        }
        light[base + y] = (sky << 4) | EMIT[id];
      }
      sunTop[(z - z0) * W + (x - x0)] = topSet ? top : 0;
    }

  queue.reset();
  // seed sky light spreading sideways + partially lit cells + emitters
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const ci = (z - z0) * W + (x - x0);
      const st = sunTop[ci];
      let maxN = st;
      if (x > x0) maxN = Math.max(maxN, sunTop[ci - 1]);
      if (x < x1) maxN = Math.max(maxN, sunTop[ci + 1]);
      if (z > z0) maxN = Math.max(maxN, sunTop[ci - W]);
      if (z < z1) maxN = Math.max(maxN, sunTop[ci + W]);
      const base = (z * sx + x) * sy;
      for (let y = st; y < maxN && y < sy; y++) queue.push(base + y);
      for (let y = 0; y < st; y++) {
        const v = light[base + y];
        if (v >> 4 > 1 || (v & 15) > 1) queue.push(base + y);
      }
    }

  if (!full) {
    // boundary ring outside the region feeds light inward
    const pushCol = (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= sx || z >= sz) return;
      const base = (z * sx + x) * sy;
      for (let y = 0; y < sy; y++) {
        const v = light[base + y];
        if (v >> 4 > 1 || (v & 15) > 1) queue.push(base + y);
      }
    };
    for (let x = x0; x <= x1; x++) {
      pushCol(x, z0 - 1);
      pushCol(x, z1 + 1);
    }
    for (let z = z0; z <= z1; z++) {
      pushCol(x0 - 1, z);
      pushCol(x1 + 1, z);
    }
  }

  const inRegion = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

  while (queue.size > 0) {
    const i = queue.pop();
    const v = light[i];
    const s = v >> 4;
    const b = v & 15;
    if (s <= 1 && b <= 1) continue;
    const y = i % sy;
    const col = (i - y) / sy;
    const x = col % sx;
    const z = (col - x) / sx;
    // 6 neighbours
    for (let n = 0; n < 6; n++) {
      let nx = x, ny = y, nz = z;
      if (n === 0) nx++;
      else if (n === 1) nx--;
      else if (n === 2) ny++;
      else if (n === 3) ny--;
      else if (n === 4) nz++;
      else nz--;
      if (ny < 0 || ny >= sy || nx < 0 || nz < 0 || nx >= sx || nz >= sz) continue;
      if (!inRegion(nx, nz)) continue;
      const j = (nz * sx + nx) * sy + ny;
      const id = blocks[j];
      if (IS_OPAQUE[id]) continue;
      const att = ATTEN[id];
      const ns = s - 1 - att;
      const nb = b - 1 - att;
      const cur = light[j];
      const cs = cur >> 4;
      const cb = cur & 15;
      if (ns > cs || nb > cb) {
        light[j] = ((ns > cs ? ns : cs) << 4) | (nb > cb ? nb : cb);
        queue.push(j);
      }
    }
  }

  if (old) {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const base = (z * sx + x) * sy;
        const obase = ((z - z0) * W + (x - x0)) * sy;
        let diff = false;
        for (let y = 0; y < sy; y++)
          if (light[base + y] !== old[obase + y]) {
            diff = true;
            break;
          }
        if (!diff) continue;
        // mark this chunk and any neighbour that samples this column
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const cx = Math.floor((x + dx) / CHUNK);
            const cz = Math.floor((z + dz) / CHUNK);
            if (cx < 0 || cz < 0 || cx >= w.chunksX || cz >= w.chunksZ) continue;
            changed.add(cz * w.chunksX + cx);
          }
      }
  }
  return changed;
}
