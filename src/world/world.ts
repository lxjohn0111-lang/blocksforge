import { B, BLOCKS, IS_SOLID, IS_OPAQUE, RENDER, isBuilt } from './blocks';
import { relightRegion } from './lighting';

export const CHUNK = 16;

export interface RayHit {
  x: number;
  y: number;
  z: number;
  id: number;
  /** face normal of the entry face */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
  px: number;
  py: number;
  pz: number;
}

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  prev: number;
  next: number;
}

export class VoxelWorld {
  readonly blocks: Uint8Array;
  readonly light: Uint8Array;
  readonly heights: Int16Array;
  readonly chunksX: number;
  readonly chunksZ: number;
  readonly dirty = new Set<number>();
  /** chunks whose lighting changed (lower priority remesh) */
  readonly lightDirty = new Set<number>();
  readonly builtHP = new Map<number, number>();
  readonly builtOwner = new Map<number, number>();
  readonly fragileHP = new Map<number, number>();
  seaLevel = 0;
  listeners: ((c: BlockChange) => void)[] = [];
  /** Max Y a player may build to */
  buildCeiling = 80;

  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    const n = sx * sy * sz;
    this.blocks = new Uint8Array(n);
    this.light = new Uint8Array(n);
    this.heights = new Int16Array(sx * sz).fill(-1);
    this.chunksX = Math.ceil(sx / CHUNK);
    this.chunksZ = Math.ceil(sz / CHUNK);
  }

  idx(x: number, y: number, z: number) {
    return (z * this.sx + x) * this.sy + y;
  }

  inBounds(x: number, y: number, z: number) {
    return x >= 0 && z >= 0 && y >= 0 && x < this.sx && z < this.sz && y < this.sy;
  }

  /** Out-of-bounds horizontally reads as barrier, below 0 as bedrock, above as air. */
  get(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= this.sy) return B.AIR;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return B.BARRIER;
    return this.blocks[(z * this.sx + x) * this.sy + y];
  }

  getF(x: number, y: number, z: number) {
    return this.get(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  isSolid(x: number, y: number, z: number) {
    return IS_SOLID[this.get(x, y, z)] === 1;
  }

  skyLight(x: number, y: number, z: number) {
    if (y >= this.sy) return 15;
    if (!this.inBounds(x, y, z)) return 15;
    return this.light[this.idx(x, y, z)] >> 4;
  }
  blockLight(x: number, y: number, z: number) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.light[this.idx(x, y, z)] & 15;
  }

  /** Raw write used during map generation (no lighting / remesh bookkeeping). */
  setRaw(x: number, y: number, z: number, id: number) {
    if (!this.inBounds(x, y, z)) return;
    this.blocks[(z * this.sx + x) * this.sy + y] = id;
  }

  getRaw(x: number, y: number, z: number) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.blocks[(z * this.sx + x) * this.sy + y];
  }

  chunkIndex(cx: number, cz: number) {
    return cz * this.chunksX + cx;
  }

  markDirtyAt(x: number, z: number, immediate = true) {
    const target = immediate ? this.dirty : this.lightDirty;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const add = (a: number, b: number) => {
      if (a < 0 || b < 0 || a >= this.chunksX || b >= this.chunksZ) return;
      target.add(this.chunkIndex(a, b));
    };
    add(cx, cz);
    const lx = x - cx * CHUNK;
    const lz = z - cz * CHUNK;
    if (lx === 0) add(cx - 1, cz);
    if (lx === CHUNK - 1) add(cx + 1, cz);
    if (lz === 0) add(cx, cz - 1);
    if (lz === CHUNK - 1) add(cx, cz + 1);
    if (lx === 0 && lz === 0) add(cx - 1, cz - 1);
    if (lx === CHUNK - 1 && lz === 0) add(cx + 1, cz - 1);
    if (lx === 0 && lz === CHUNK - 1) add(cx - 1, cz + 1);
    if (lx === CHUNK - 1 && lz === CHUNK - 1) add(cx + 1, cz + 1);
  }

  /** Gameplay write: updates heights, lighting, dirty chunks, listeners. */
  set(x: number, y: number, z: number, id: number, relight = true) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.idx(x, y, z);
    const prev = this.blocks[i];
    if (prev === id) return false;
    this.blocks[i] = id;
    if (isBuilt(prev)) {
      this.builtHP.delete(i);
      this.builtOwner.delete(i);
    }
    this.fragileHP.delete(i);
    if (isBuilt(id)) this.builtHP.set(i, BLOCKS[id].built!.hp);
    this.updateHeight(x, z);
    this.markDirtyAt(x, z, true);
    if (relight) this.relightAround(x, y, z);
    for (const l of this.listeners) l({ x, y, z, prev, next: id });
    return true;
  }

  /** Apply several block writes and relight once. */
  setMany(list: { x: number; y: number; z: number; id: number }[]) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    let changed = false;
    for (const b of list) {
      if (this.set(b.x, b.y, b.z, b.id, false)) {
        changed = true;
        minX = Math.min(minX, b.x);
        maxX = Math.max(maxX, b.x);
        minZ = Math.min(minZ, b.z);
        maxZ = Math.max(maxZ, b.z);
      }
    }
    if (changed) this.relightBox(minX, minZ, maxX, maxZ);
  }

  relightAround(x: number, _y: number, z: number) {
    this.relightBox(x, z, x, z);
  }

  relightBox(x0: number, z0: number, x1: number, z1: number) {
    const m = 15;
    const changedChunks = relightRegion(this, x0 - m, z0 - m, x1 + m, z1 + m);
    for (const c of changedChunks) if (!this.dirty.has(c)) this.lightDirty.add(c);
  }

  updateHeight(x: number, z: number) {
    const base = (z * this.sx + x) * this.sy;
    let h = -1;
    for (let y = this.sy - 1; y >= 0; y--) {
      const id = this.blocks[base + y];
      if (id !== B.AIR && RENDER[id] !== 3) {
        h = y;
        break;
      }
    }
    this.heights[z * this.sx + x] = h;
  }

  recomputeHeights() {
    for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) this.updateHeight(x, z);
  }

  height(x: number, z: number) {
    x = Math.floor(x);
    z = Math.floor(z);
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return 0;
    return this.heights[z * this.sx + x];
  }

  /** Highest solid (walkable) block y at column; ignores leaves canopy if requested. */
  groundY(x: number, z: number, fromY = this.sy - 1, ignoreLeaves = true): number {
    x = Math.floor(x);
    z = Math.floor(z);
    for (let y = Math.min(fromY, this.sy - 1); y >= 0; y--) {
      const id = this.get(x, y, z);
      if (IS_SOLID[id] && !(ignoreLeaves && RENDER[id] === 2 && id !== B.GLASS)) return y;
    }
    return -1;
  }

  /**
   * Voxel DDA raycast. `stop(id)` decides which blocks end the ray.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
    stop: (id: number, x: number, y: number, z: number) => boolean = (id) => IS_SOLID[id] === 1,
  ): RayHit | null {
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    // starting block
    {
      const id = this.get(x, y, z);
      if (id !== B.AIR && stop(id, x, y, z)) {
        return { x, y, z, id, nx: 0, ny: 0, nz: 0, dist: 0, px: ox, py: oy, pz: oz };
      }
    }
    for (let guard = 0; guard < 2048; guard++) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) return null;
      if (y < -1 || y > this.sy + 1) {
        if ((y < 0 && dy < 0) || (y >= this.sy && dy > 0)) return null;
      }
      const id = this.get(x, y, z);
      if (id !== B.AIR && stop(id, x, y, z)) {
        return { x, y, z, id, nx, ny, nz, dist: t, px: ox + dx * t, py: oy + dy * t, pz: oz + dz * t };
      }
    }
    return null;
  }

  /** Line of sight test between two points (opaque + solid blocks block). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, seeThroughLeaves = false): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.001) return true;
    const hit = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, (id) => {
      if (id === B.BARRIER) return true;
      if (RENDER[id] === 2) return !seeThroughLeaves && id !== B.GLASS && id !== B.GLASS_PANE_DARK && id !== B.IRON_BARS;
      return IS_OPAQUE[id] === 1;
    });
    return hit === null;
  }

  countChunks() {
    return this.chunksX * this.chunksZ;
  }
}
