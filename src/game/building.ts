// Battle Royale construction: grid-aligned pieces made of voxels with per-
// block HP, strict placement rules, structural collapse and tree felling.

import * as THREE from 'three';
import { B, BLOCKS, IS_SOLID, isBuilt, isLog, isLeaves, isReplaceable, buildBlockFor, type BuildMat, RENDER } from '../world/blocks';
import type { VoxelWorld } from '../world/world';
import type { Combatant } from './combatant';

export type Piece = 'wall' | 'floor' | 'ramp' | 'block';
export const PIECES: Piece[] = ['wall', 'floor', 'ramp', 'block'];
export const PIECE_COST: Record<Piece, number> = { wall: 10, floor: 10, ramp: 10, block: 2 };
export const PIECE_LABEL: Record<Piece, string> = { wall: 'Wall', floor: 'Floor', ramp: 'Ramp', block: 'Block' };

export interface Placement {
  blocks: { x: number; y: number; z: number }[];
  valid: boolean;
  reason: string;
  cost: number;
}

interface Host {
  world: VoxelWorld;
  combatants: Combatant[];
  onBlockDestroyed(x: number, y: number, z: number, id: number, by: Combatant | null, silent?: boolean): void;
}

const DIRS4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

export class BuildSystem {
  constructor(private host: Host) {}

  /** facing index 0..3 from yaw (0 = -Z) */
  static facing(yaw: number) {
    const a = ((-yaw / (Math.PI / 2)) % 4 + 4) % 4;
    return Math.round(a) % 4;
  }

  compute(c: Combatant, piece: Piece, rot: number, mat: BuildMat): Placement {
    const w = this.host.world;
    const eye = c.eye();
    const dir = c.aimDir();
    const face = (BuildSystem.facing(c.yaw) + rot) % 4;
    const [fx, fz] = DIRS4[face];
    const [rx, rz] = DIRS4[(face + 1) % 4];
    const hit = w.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 6.5, (id) => IS_SOLID[id] === 1);
    let cx: number, cy: number, cz: number;
    if (hit) {
      cx = hit.x + hit.nx;
      cy = hit.y + hit.ny;
      cz = hit.z + hit.nz;
    } else {
      const p = eye.clone().addScaledVector(dir, 4.5);
      cx = Math.floor(p.x);
      cy = Math.floor(p.y);
      cz = Math.floor(p.z);
    }
    const blocks: { x: number; y: number; z: number }[] = [];
    if (piece === 'block') {
      blocks.push({ x: cx, y: cy, z: cz });
    } else {
      // walls & ramps start at ground level beneath the target cell
      let by = cy;
      if (piece !== 'floor') {
        let g = 0;
        while (g < 4 && !IS_SOLID[w.get(cx, by - 1, cz)]) {
          by--;
          g++;
        }
        if (piece === 'wall' && hit && hit.ny === 0) by = Math.min(by, cy);
      }
      // walls go in front of the player; avoid standing inside them
      let bx = cx, bz = cz;
      if (piece === 'wall') {
        const px = Math.floor(c.body.pos.x), pz = Math.floor(c.body.pos.z);
        const dx = (cx - px) * fx + (cz - pz) * fz;
        if (dx < 1) {
          bx = px + fx * 1;
          bz = pz + fz * 1;
        }
        for (let i = -1; i <= 1; i++) for (let j = 0; j < 3; j++) blocks.push({ x: bx + rx * i, y: by + j, z: bz + rz * i });
      } else if (piece === 'floor') {
        for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) blocks.push({ x: bx + rx * i + fx * k, y: by, z: bz + rz * i + fz * k });
      } else if (piece === 'ramp') {
        // start the ramp one cell ahead of the player, rising away
        const px = Math.floor(c.body.pos.x), pz = Math.floor(c.body.pos.z);
        const dd = (cx - px) * fx + (cz - pz) * fz;
        if (dd < 1) {
          bx = px + fx;
          bz = pz + fz;
          by = Math.floor(c.body.pos.y + 0.01);
        }
        for (let d = 0; d < 3; d++) for (let i = -1; i <= 1; i++) blocks.push({ x: bx + fx * d + rx * i, y: by + d, z: bz + fz * d + rz * i });
      }
    }
    return this.validate(c, blocks, piece);
  }

  private validate(c: Combatant, list: { x: number; y: number; z: number }[], piece: Piece): Placement {
    const w = this.host.world;
    const cost = PIECE_COST[piece];
    const res: Placement = { blocks: [], valid: false, reason: '', cost };
    const eye = c.eye();
    for (const b of list) {
      if (b.x < 2 || b.z < 2 || b.x >= w.sx - 2 || b.z >= w.sz - 2) continue;
      if (b.y < 1 || b.y >= w.buildCeiling) continue;
      if (!isReplaceable(w.get(b.x, b.y, b.z))) continue;
      res.blocks.push(b);
    }
    if (!res.blocks.length) {
      res.reason = 'No space';
      return res;
    }
    const tooHigh = list.some((b) => b.y >= w.buildCeiling);
    if (tooHigh && res.blocks.length < list.length) {
      res.reason = 'Build height limit';
    }
    // distance
    const centre = res.blocks[Math.floor(res.blocks.length / 2)];
    if (Math.hypot(centre.x + 0.5 - eye.x, centre.y + 0.5 - eye.y, centre.z + 0.5 - eye.z) > 8) {
      res.reason = 'Too far';
      return res;
    }
    // never inside a combatant
    for (const o of this.host.combatants) {
      if (!o.alive) continue;
      const p = o.body.pos;
      const h = o.body.height;
      for (const b of res.blocks) {
        if (b.x + 1 > p.x - 0.32 && b.x < p.x + 0.32 && b.z + 1 > p.z - 0.32 && b.z < p.z + 0.32 && b.y + 1 > p.y + 0.02 && b.y < p.y + h) {
          res.reason = o === c ? 'Blocked by you' : 'Blocked by a player';
          return res;
        }
      }
    }
    // must attach to something solid (no floating structures)
    const set = new Set(res.blocks.map((b) => `${b.x},${b.y},${b.z}`));
    let supported = false;
    for (const b of res.blocks) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = `${b.x + dx},${b.y + dy},${b.z + dz}`;
        if (set.has(k)) continue;
        const id = w.get(b.x + dx, b.y + dy, b.z + dz);
        if (IS_SOLID[id] && id !== B.BARRIER) {
          supported = true;
          break;
        }
      }
      if (supported) break;
    }
    if (!supported) {
      res.reason = 'Needs support';
      return res;
    }
    if (!res.reason) res.valid = true;
    return res;
  }

  place(c: Combatant, p: Placement, mat: BuildMat): boolean {
    if (!p.valid) return false;
    if (c.mats[mat] < p.cost) return false;
    const w = this.host.world;
    const id = buildBlockFor(mat);
    w.setMany(p.blocks.map((b) => ({ ...b, id })));
    for (const b of p.blocks) w.builtOwner.set(w.idx(b.x, b.y, b.z), c.id);
    c.mats[mat] -= p.cost;
    c.stats.built++;
    return true;
  }

  /** Apply damage to a block. Returns true if destroyed. Natural blocks are immune except fragile/harvestable when allowed. */
  damageBlock(x: number, y: number, z: number, amount: number, by: Combatant | null, opts: { harvest?: boolean; explosion?: boolean } = {}): boolean {
    const w = this.host.world;
    const id = w.get(x, y, z);
    const def = BLOCKS[id];
    if (!def) return false;
    const i = w.idx(x, y, z);
    if (isBuilt(id)) {
      const hp = (w.builtHP.get(i) ?? def.built!.hp) - amount;
      if (hp <= 0) {
        this.destroy(x, y, z, id, by);
        return true;
      }
      w.builtHP.set(i, hp);
      return false;
    }
    if (def.fragile) {
      this.destroy(x, y, z, id, by);
      return true;
    }
    if (opts.harvest && def.harvest) {
      const hp = (w.fragileHP.get(i) ?? def.harvest.hp) - amount;
      if (hp <= 0) {
        w.fragileHP.delete(i);
        if (def.harvest.fell && isLog(id)) this.fellTree(x, y, z, by);
        else this.destroy(x, y, z, id, by, def.harvest.becomes);
        return true;
      }
      w.fragileHP.set(i, hp);
    }
    return false;
  }

  private destroy(x: number, y: number, z: number, id: number, by: Combatant | null, becomes = 0) {
    const w = this.host.world;
    w.set(x, y, z, becomes);
    this.host.onBlockDestroyed(x, y, z, id, by);
    if (isBuilt(id)) this.collapseCheck(x, y, z, by);
  }

  /** Remove built blocks no longer connected to natural ground. */
  collapseCheck(x: number, y: number, z: number, by: Combatant | null) {
    const w = this.host.world;
    const seeds: [number, number, number][] = [];
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (isBuilt(w.get(x + dx, y + dy, z + dz))) seeds.push([x + dx, y + dy, z + dz]);
    }
    const checked = new Set<number>();
    for (const s of seeds) {
      const k0 = w.idx(s[0], s[1], s[2]);
      if (checked.has(k0)) continue;
      // flood through built blocks; supported if touching any non-built solid
      const comp: [number, number, number][] = [];
      const stack = [s];
      const seen = new Set<number>([k0]);
      let supported = false;
      while (stack.length && comp.length < 600) {
        const [cx, cy, cz] = stack.pop()!;
        comp.push([cx, cy, cz]);
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          const id = w.get(nx, ny, nz);
          if (isBuilt(id)) {
            const k = w.idx(nx, ny, nz);
            if (!seen.has(k)) {
              seen.add(k);
              stack.push([nx, ny, nz]);
            }
          } else if (IS_SOLID[id] && id !== B.BARRIER && RENDER[id] !== 2) supported = true;
        }
      }
      for (const k of seen) checked.add(k);
      if (!supported || comp.length >= 600) {
        if (supported) continue;
        const list = comp.map(([a, b, c2]) => ({ x: a, y: b, z: c2, id: 0 }));
        for (const b of list) this.host.onBlockDestroyed(b.x, b.y, b.z, w.get(b.x, b.y, b.z), by, true);
        w.setMany(list);
      }
    }
  }

  /** Remove a whole tree (connected logs + nearby leaves). Returns wood gained. */
  fellTree(x: number, y: number, z: number, by: Combatant | null): number {
    const w = this.host.world;
    const logs: [number, number, number][] = [];
    const stack: [number, number, number][] = [[x, y, z]];
    const seen = new Set<number>();
    while (stack.length && logs.length < 60) {
      const [cx, cy, cz] = stack.pop()!;
      const k = w.idx(cx, cy, cz);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!isLog(w.get(cx, cy, cz))) continue;
      if (cy < y) continue;
      logs.push([cx, cy, cz]);
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]]) stack.push([cx + dx, cy + dy, cz + dz]);
    }
    const removed: { x: number; y: number; z: number; id: number }[] = logs.map(([a, b, c2]) => ({ x: a, y: b, z: c2, id: 0 }));
    // leaves within reach of the logs
    const leafSet = new Set<number>();
    for (const [lx, ly, lz] of logs) {
      for (let dx = -4; dx <= 4; dx++)
        for (let dy = -2; dy <= 4; dy++)
          for (let dz = -4; dz <= 4; dz++) {
            const nx = lx + dx, ny = ly + dy, nz = lz + dz;
            if (!isLeaves(w.get(nx, ny, nz))) continue;
            const k = w.idx(nx, ny, nz);
            if (leafSet.has(k)) continue;
            leafSet.add(k);
            removed.push({ x: nx, y: ny, z: nz, id: 0 });
          }
    }
    for (const b of removed) this.host.onBlockDestroyed(b.x, b.y, b.z, w.get(b.x, b.y, b.z), by, true);
    w.setMany(removed);
    return logs.length;
  }

  /** Damage every built / fragile block in a sphere. */
  explode(center: THREE.Vector3, radius: number, damage: number, by: Combatant | null) {
    const r = Math.ceil(radius);
    const cx = Math.floor(center.x), cy = Math.floor(center.y), cz = Math.floor(center.z);
    const w = this.host.world;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const x = cx + dx, y = cy + dy, z = cz + dz;
          const id = w.get(x, y, z);
          if (!isBuilt(id) && !BLOCKS[id]?.fragile) continue;
          const d = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y, z + 0.5 - center.z);
          if (d > radius) continue;
          this.damageBlock(x, y, z, damage * (1 - d / radius) + damage * 0.15, by, { explosion: true });
        }
  }
}
