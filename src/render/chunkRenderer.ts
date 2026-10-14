import * as THREE from 'three';
import type { VoxelWorld } from '../world/world';
import { CHUNK } from '../world/world';
import { meshChunk, type MeshArrays } from '../world/mesher';
import { createTerrainMaterial, createWaterMaterial } from './materials';
import { SHADOW_LAYER } from './shadows';

export const WATER_LAYER = 2;
export const FX_LAYER = 3;

interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  cutout: THREE.Mesh | null;
  water: THREE.Mesh | null;
  cx: number;
  cz: number;
}

export class ChunkRenderer {
  group = new THREE.Group();
  opaqueMat = createTerrainMaterial(false);
  cutoutMat = createTerrainMaterial(true);
  waterMat = createWaterMaterial();
  chunks: ChunkMeshes[] = [];
  viewDistance = 240;
  oceanMesh: THREE.Mesh | null = null;

  constructor(public world: VoxelWorld) {
    this.group.name = 'chunks';
    for (let cz = 0; cz < world.chunksZ; cz++)
      for (let cx = 0; cx < world.chunksX; cx++) this.chunks.push({ opaque: null, cutout: null, water: null, cx, cz });
  }

  private makeGeo(a: MeshArrays, cx: number, cz: number, yMax: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
    g.setAttribute('aData', new THREE.BufferAttribute(a.data, 4, false));
    g.setIndex(new THREE.BufferAttribute(a.index, 1));
    const cxw = cx * CHUNK + CHUNK / 2;
    const czw = cz * CHUNK + CHUNK / 2;
    const h = yMax / 2;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cxw, h, czw), Math.sqrt(CHUNK * CHUNK * 0.5 + h * h) + 1);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(cx * CHUNK - 1, -1, cz * CHUNK - 1), new THREE.Vector3((cx + 1) * CHUNK + 1, yMax + 1, (cz + 1) * CHUNK + 1));
    return g;
  }

  private replace(c: ChunkMeshes, key: 'opaque' | 'cutout' | 'water', arr: MeshArrays | null, yMax: number) {
    const old = c[key];
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      c[key] = null;
    }
    if (!arr) return;
    const mat = key === 'opaque' ? this.opaqueMat : key === 'cutout' ? this.cutoutMat : this.waterMat;
    const m = new THREE.Mesh(this.makeGeo(arr, c.cx, c.cz, yMax), mat);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    if (key === 'water') {
      m.layers.set(WATER_LAYER);
    } else {
      m.layers.set(0);
      m.layers.enable(SHADOW_LAYER);
    }
    c[key] = m;
    this.group.add(m);
  }

  rebuild(index: number) {
    const c = this.chunks[index];
    const res = meshChunk(this.world, c.cx, c.cz);
    this.replace(c, 'opaque', res.opaque, res.yMax);
    this.replace(c, 'cutout', res.cutout, res.yMax);
    this.replace(c, 'water', res.water, res.yMax);
  }

  async buildAll(onProgress?: (f: number) => void) {
    const n = this.chunks.length;
    let last = performance.now();
    for (let i = 0; i < n; i++) {
      this.rebuild(i);
      if (performance.now() - last > 30) {
        onProgress?.(i / n);
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
      }
    }
    this.world.dirty.clear();
    this.world.lightDirty.clear();
    onProgress?.(1);
  }

  /** Rebuild dirty chunks; light-only changes are spread across frames. */
  update(camX: number, camZ: number, budgetMs = 4) {
    const t0 = performance.now();
    if (this.world.dirty.size) {
      for (const i of this.world.dirty) {
        this.rebuild(i);
        this.world.lightDirty.delete(i);
      }
      this.world.dirty.clear();
    }
    if (this.world.lightDirty.size) {
      // nearest first
      const list = [...this.world.lightDirty].sort((a, b) => this.distTo(a, camX, camZ) - this.distTo(b, camX, camZ));
      for (const i of list) {
        if (performance.now() - t0 > budgetMs) break;
        this.rebuild(i);
        this.world.lightDirty.delete(i);
      }
    }
    // distance culling
    const vd = this.viewDistance + CHUNK;
    for (const c of this.chunks) {
      const dx = c.cx * CHUNK + CHUNK / 2 - camX;
      const dz = c.cz * CHUNK + CHUNK / 2 - camZ;
      const vis = dx * dx + dz * dz < vd * vd;
      if (c.opaque) c.opaque.visible = vis;
      if (c.cutout) c.cutout.visible = vis;
      if (c.water) c.water.visible = vis;
    }
  }

  private distTo(i: number, x: number, z: number) {
    const c = this.chunks[i];
    const dx = c.cx * CHUNK + 8 - x;
    const dz = c.cz * CHUNK + 8 - z;
    return dx * dx + dz * dz;
  }

  /** Infinite-looking ocean ring around the playable map. */
  addOcean(level: number) {
    const W = this.world.sx;
    const D = this.world.sz;
    const R = 3000;
    const y = level + 0.875;
    const quads = [
      [-R, -R, W + R, 0],
      [-R, D, W + R, D + R],
      [-R, 0, 0, D],
      [W, 0, W + R, D],
    ];
    const pos: number[] = [];
    const uv: number[] = [];
    const data: number[] = [];
    const idx: number[] = [];
    for (const [x0, z0, x1, z1] of quads) {
      const b = pos.length / 3;
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
      uv.push(x0, -z0, x0, -z1, x1, -z1, x1, -z0);
      for (let k = 0; k < 4; k++) data.push(0, 2, 0, 0xf0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aData', new THREE.BufferAttribute(new Uint8Array(data), 4, false));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, this.waterMat);
    m.layers.set(WATER_LAYER);
    m.frustumCulled = false;
    this.oceanMesh = m;
    this.group.add(m);
  }

  dispose() {
    for (const c of this.chunks) {
      for (const k of ['opaque', 'cutout', 'water'] as const) {
        const m = c[k];
        if (m) m.geometry.dispose();
      }
    }
    this.oceanMesh?.geometry.dispose();
    this.opaqueMat.dispose();
    this.cutoutMat.dispose();
    this.waterMat.dispose();
  }
}
