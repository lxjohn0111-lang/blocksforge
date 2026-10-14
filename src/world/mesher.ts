// Greedy voxel mesher with per-vertex ambient occlusion and smooth lighting.
// Faces merge only when their per-corner AO/light stay exact under
// interpolation, so lighting quality is identical to per-face meshing.

import { B, RENDER, IS_OPAQUE, AO_CASTER, BLOCKS } from './blocks';
import { FACE_LAYER } from '../render/textures';
import type { VoxelWorld } from './world';
import { CHUNK } from './world';
import { hash2 } from '../core/rng';

export interface MeshArrays {
  position: Float32Array;
  uv: Float32Array;
  data: Uint8Array;
  index: Uint32Array;
}

export interface ChunkMesh {
  opaque: MeshArrays | null;
  cutout: MeshArrays | null;
  water: MeshArrays | null;
  yMax: number;
}

class GeoBuilder {
  pos = new Float32Array(4096 * 3);
  uv = new Float32Array(4096 * 2);
  data = new Uint8Array(4096 * 4);
  idx = new Uint32Array(6144);
  vc = 0;
  ic = 0;
  reset() {
    this.vc = 0;
    this.ic = 0;
  }
  ensure(nv: number) {
    if ((this.vc + nv) * 3 > this.pos.length) {
      const cap = Math.max(this.pos.length * 2, (this.vc + nv) * 3);
      const p = new Float32Array(cap);
      p.set(this.pos);
      this.pos = p;
      const u = new Float32Array((cap / 3) * 2);
      u.set(this.uv);
      this.uv = u;
      const d = new Uint8Array((cap / 3) * 4);
      d.set(this.data);
      this.data = d;
    }
    if (this.ic + (nv / 4) * 6 > this.idx.length) {
      const ni = new Uint32Array(Math.max(this.idx.length * 2, this.ic + nv * 2));
      ni.set(this.idx);
      this.idx = ni;
    }
  }
  vert(x: number, y: number, z: number, u: number, v: number, d0: number, d1: number, d2: number, d3: number) {
    const i = this.vc++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.data[i * 4] = d0;
    this.data[i * 4 + 1] = d1;
    this.data[i * 4 + 2] = d2;
    this.data[i * 4 + 3] = d3;
    return i;
  }
  quadIdx(a: number, b: number, c: number, d: number, flip: boolean) {
    const I = this.idx;
    let k = this.ic;
    if (flip) {
      I[k++] = b; I[k++] = c; I[k++] = d;
      I[k++] = b; I[k++] = d; I[k++] = a;
    } else {
      I[k++] = a; I[k++] = b; I[k++] = c;
      I[k++] = a; I[k++] = c; I[k++] = d;
    }
    this.ic = k;
  }
  export(): MeshArrays | null {
    if (this.ic === 0) return null;
    return {
      position: this.pos.slice(0, this.vc * 3),
      uv: this.uv.slice(0, this.vc * 2),
      data: this.data.slice(0, this.vc * 4),
      index: this.idx.slice(0, this.ic),
    };
  }
}

const opaqueB = new GeoBuilder();
const cutoutB = new GeoBuilder();
const waterB = new GeoBuilder();

const PX = CHUNK + 2;
let lb = new Uint8Array(PX * PX * 100);
let ll = new Uint8Array(PX * PX * 100);
const maskA = new Int32Array(CHUNK * 128);
const maskL = new Int32Array(CHUNK * 128);

// axis configuration per face direction
const FACE_AXIS = [0, 0, 1, 1, 2, 2];
const FACE_U = [2, 2, 0, 0, 0, 0];
const FACE_V = [1, 1, 2, 2, 1, 1];
const FACE_SIGN = [1, -1, 1, -1, 1, -1];
// whether U x V == normal (CCW in c0,c1,c2,c3 order)
const FACE_NATURAL = [false, true, false, true, true, false];

function uvFor(face: number, x: number, y: number, z: number, out: number[]) {
  switch (face) {
    case 0: out[0] = -z; out[1] = y; break;
    case 1: out[0] = z; out[1] = y; break;
    case 2: out[0] = x; out[1] = -z; break;
    case 3: out[0] = x; out[1] = z; break;
    case 4: out[0] = x; out[1] = y; break;
    default: out[0] = -x; out[1] = y; break;
  }
}

const tmpUV = [0, 0];

export function meshChunk(world: VoxelWorld, cx: number, cz: number): ChunkMesh {
  const X0 = cx * CHUNK;
  const Z0 = cz * CHUNK;
  const sy = world.sy;
  // vertical extent of interesting content
  let yTop = 0;
  for (let z = 0; z < CHUNK; z++)
    for (let x = 0; x < CHUNK; x++) {
      const wx = X0 + x;
      const wz = Z0 + z;
      if (wx >= world.sx || wz >= world.sz) continue;
      const h = world.heights[wz * world.sx + wx];
      if (h + 1 > yTop) yTop = h + 1;
    }
  yTop = Math.min(yTop, sy - 1);
  const PY = yTop + 3;
  const need = PX * PX * PY;
  if (lb.length < need) {
    lb = new Uint8Array(need);
    ll = new Uint8Array(need);
  }
  // fill padded copy
  for (let lz = -1; lz <= CHUNK; lz++)
    for (let lx = -1; lx <= CHUNK; lx++) {
      const wx = X0 + lx;
      const wz = Z0 + lz;
      const base = ((lz + 1) * PX + (lx + 1)) * PY;
      if (wx < 0 || wz < 0 || wx >= world.sx || wz >= world.sz) {
        lb.fill(B.STONE, base, base + PY);
        ll.fill(0xf0, base, base + PY);
        continue;
      }
      lb[base] = B.BEDROCK;
      ll[base] = 0;
      const wbase = (wz * world.sx + wx) * sy;
      for (let y = 0; y <= yTop + 1; y++) {
        if (y >= sy) {
          lb[base + y + 1] = B.AIR;
          ll[base + y + 1] = 0xf0;
        } else {
          lb[base + y + 1] = world.blocks[wbase + y];
          ll[base + y + 1] = world.light[wbase + y];
        }
      }
    }

  const sX = PY;
  const sZ = PX * PY;
  const stride = [sX, 1, sZ];
  const li = (x: number, y: number, z: number) => ((z + 1) * PX + (x + 1)) * PY + (y + 1);

  opaqueB.reset();
  cutoutB.reset();
  waterB.reset();

  const Hc = yTop + 1;
  const dims = [CHUNK, Hc, CHUNK];

  for (let face = 0; face < 6; face++) {
    const a = FACE_AXIS[face];
    const U = FACE_U[face];
    const V = FACE_V[face];
    const sign = FACE_SIGN[face];
    const Un = dims[U];
    const Vn = dims[V];
    const nStride = sign * stride[a];
    const uS = stride[U];
    const vS = stride[V];
    const pos = [0, 0, 0];
    for (let s = 0; s < dims[a]; s++) {
      // build mask
      let any = false;
      for (let v = 0; v < Vn; v++)
        for (let u = 0; u < Un; u++) {
          pos[a] = s;
          pos[U] = u;
          pos[V] = v;
          const pi = li(pos[0], pos[1], pos[2]);
          const b = lb[pi];
          const r = RENDER[b];
          const mi = v * Un + u;
          maskA[mi] = 0;
          if (r !== 1 && r !== 2) continue;
          const qi = pi + nStride;
          const nb = lb[qi];
          if (IS_OPAQUE[nb]) continue;
          if (r === 2 && nb === b) continue;
          // corners: c0(-,-) c1(+,-) c2(+,+) c3(-,+)
          let ao = 0;
          let lt = 0;
          for (let c = 0; c < 4; c++) {
            const du = c === 1 || c === 2 ? 1 : -1;
            const dv = c >= 2 ? 1 : -1;
            const i1 = qi + du * uS;
            const i2 = qi + dv * vS;
            const ic = i1 + dv * vS;
            const o1 = AO_CASTER[lb[i1]];
            const o2 = AO_CASTER[lb[i2]];
            const oc = AO_CASTER[lb[ic]];
            const aoV = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
            ao |= aoV << (c * 2);
            // smooth light
            let ss = ll[qi] >> 4;
            let bs = ll[qi] & 15;
            let n = 1;
            const op1 = IS_OPAQUE[lb[i1]];
            const op2 = IS_OPAQUE[lb[i2]];
            if (!op1) {
              ss += ll[i1] >> 4;
              bs += ll[i1] & 15;
              n++;
            }
            if (!op2) {
              ss += ll[i2] >> 4;
              bs += ll[i2] & 15;
              n++;
            }
            if (!(op1 && op2) && !IS_OPAQUE[lb[ic]]) {
              ss += ll[ic] >> 4;
              bs += ll[ic] & 15;
              n++;
            }
            const sl = Math.round(ss / n);
            const bl = Math.round(bs / n);
            lt |= ((sl << 4) | bl) << (c * 8);
          }
          const layer = FACE_LAYER[b * 6 + face];
          const def = BLOCKS[b];
          maskA[mi] = 1 + (layer | (r << 8) | ((def.macro ? 1 : 0) << 10) | (def.wave << 11) | (ao << 12));
          maskL[mi] = lt;
          any = true;
        }
      if (!any) continue;
      // greedy merge
      for (let v = 0; v < Vn; v++)
        for (let u = 0; u < Un; ) {
          const mi = v * Un + u;
          const k = maskA[mi];
          if (k === 0) {
            u++;
            continue;
          }
          const l = maskL[mi];
          const ao = ((k - 1) >> 12) & 255;
          const a0 = ao & 3, a1 = (ao >> 2) & 3, a2 = (ao >> 4) & 3, a3 = (ao >> 6) & 3;
          const l0 = l & 255, l1 = (l >>> 8) & 255, l2 = (l >>> 16) & 255, l3 = (l >>> 24) & 255;
          const uUniform = a0 === a1 && a3 === a2 && l0 === l1 && l3 === l2;
          const vUniform = a0 === a3 && a1 === a2 && l0 === l3 && l1 === l2;
          let w = 1;
          if (uUniform) while (u + w < Un && maskA[mi + w] === k && maskL[mi + w] === l) w++;
          let h = 1;
          if (vUniform) {
            outer: while (v + h < Vn) {
              const row = (v + h) * Un + u;
              for (let i = 0; i < w; i++) if (maskA[row + i] !== k || maskL[row + i] !== l) break outer;
              h++;
            }
          }
          for (let dv = 0; dv < h; dv++) for (let du = 0; du < w; du++) maskA[(v + dv) * Un + u + du] = 0;

          // emit
          const info = k - 1;
          const layer = info & 255;
          const r = (info >> 8) & 3;
          const macro = (info >> 10) & 1;
          const wave = (info >> 11) & 1;
          const builder = r === 2 ? cutoutB : opaqueB;
          builder.ensure(4);
          const plane = s + (sign > 0 ? 1 : 0);
          const corners = [
            [u, v],
            [u + w, v],
            [u + w, v + h],
            [u, v + h],
          ];
          const aos = [a0, a1, a2, a3];
          const lts = [l0, l1, l2, l3];
          const order = FACE_NATURAL[face] ? [0, 1, 2, 3] : [0, 3, 2, 1];
          const vi: number[] = [];
          for (const c of order) {
            const p = [0, 0, 0];
            p[a] = plane;
            p[U] = corners[c][0];
            p[V] = corners[c][1];
            const wx = X0 + p[0];
            const wy = p[1];
            const wz = Z0 + p[2];
            uvFor(face, wx, wy, wz, tmpUV);
            vi.push(
              builder.vert(wx, wy, wz, tmpUV[0], tmpUV[1], layer, face | (wave << 3), aos[c] | (macro << 3), lts[c]),
            );
          }
          const oa = [aos[order[0]], aos[order[1]], aos[order[2]], aos[order[3]]];
          builder.quadIdx(vi[0], vi[1], vi[2], vi[3], oa[0] + oa[2] > oa[1] + oa[3]);
          u += w;
        }
    }
  }

  // cross plants and water
  const wTop = new Int32Array(CHUNK * CHUNK);
  for (let y = 0; y <= yTop; y++) {
    let anyWaterTop = false;
    for (let z = 0; z < CHUNK; z++)
      for (let x = 0; x < CHUNK; x++) {
        const pi = li(x, y, z);
        const b = lb[pi];
        const r = RENDER[b];
        if (r === 3) emitCross(b, X0 + x, y, Z0 + z, ll[pi]);
        else if (r === 4) {
          const above = lb[pi + 1];
          const surface = above !== B.WATER;
          const top = surface ? 0.875 : 1;
          wTop[z * CHUNK + x] = 0;
          if (surface && !IS_OPAQUE[above]) {
            wTop[z * CHUNK + x] = 1 + (ll[pi + 1] & 255);
            anyWaterTop = true;
          }
          // sides
          for (const face of [0, 1, 4, 5]) {
            const a = FACE_AXIS[face];
            const qi = pi + FACE_SIGN[face] * stride[a];
            const nb = lb[qi];
            if (nb === B.WATER || IS_OPAQUE[nb]) continue;
            emitWaterSide(face, X0 + x, y, Z0 + z, top, ll[qi]);
          }
          const below = lb[pi - 1];
          if (below !== B.WATER && !IS_OPAQUE[below]) emitWaterBottom(X0 + x, y, Z0 + z, ll[pi - 1]);
        } else wTop[z * CHUNK + x] = 0;
      }
    if (!anyWaterTop) continue;
    // greedy merge water tops on this layer
    for (let z = 0; z < CHUNK; z++)
      for (let x = 0; x < CHUNK; ) {
        const k = wTop[z * CHUNK + x];
        if (k === 0) {
          x++;
          continue;
        }
        let w = 1;
        while (x + w < CHUNK && wTop[z * CHUNK + x + w] === k) w++;
        let h = 1;
        outer: while (z + h < CHUNK) {
          for (let i = 0; i < w; i++) if (wTop[(z + h) * CHUNK + x + i] !== k) break outer;
          h++;
        }
        for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) wTop[(z + dz) * CHUNK + x + dx] = 0;
        const light = k - 1;
        const yy = y + 0.875;
        const wx = X0 + x;
        const wz = Z0 + z;
        waterB.ensure(4);
        // +Y face: CCW order c0,c3,c2,c1 in (x,z)
        const v0 = waterB.vert(wx, yy, wz, wx, -wz, 0, 2, 0, light);
        const v1 = waterB.vert(wx, yy, wz + h, wx, -(wz + h), 0, 2, 0, light);
        const v2 = waterB.vert(wx + w, yy, wz + h, wx + w, -(wz + h), 0, 2, 0, light);
        const v3 = waterB.vert(wx + w, yy, wz, wx + w, -wz, 0, 2, 0, light);
        waterB.quadIdx(v0, v1, v2, v3, false);
        x += w;
      }
  }

  return { opaque: opaqueB.export(), cutout: cutoutB.export(), water: waterB.export(), yMax: yTop + 1 };
}

function emitCross(b: number, x: number, y: number, z: number, light: number) {
  const layer = FACE_LAYER[b * 6 + 2];
  const ox = (hash2(x, z, 11) - 0.5) * 0.3;
  const oz = (hash2(x, z, 23) - 0.5) * 0.3;
  const hgt = b === B.TALL_GRASS || b === B.FERN ? 0.75 + hash2(x, z, 5) * 0.3 : 1;
  const macro = BLOCKS[b].macro ? 1 : 0;
  const cx = x + 0.5 + ox;
  const cz = z + 0.5 + oz;
  const r = 0.45;
  const planes = [
    [cx - r, cz - r, cx + r, cz + r],
    [cx - r, cz + r, cx + r, cz - r],
  ];
  cutoutB.ensure(16);
  for (const [x0, z0, x1, z1] of planes) {
    // front
    const a = cutoutB.vert(x0, y, z0, 0, 0, layer, 6, 1 | (macro << 3), light);
    const bb = cutoutB.vert(x1, y, z1, 1, 0, layer, 6, 1 | (macro << 3), light);
    const c = cutoutB.vert(x1, y + hgt, z1, 1, 1, layer, 6 | (1 << 4), 3 | (macro << 3), light);
    const d = cutoutB.vert(x0, y + hgt, z0, 0, 1, layer, 6 | (1 << 4), 3 | (macro << 3), light);
    cutoutB.quadIdx(a, bb, c, d, false);
    cutoutB.quadIdx(bb, a, d, c, false);
  }
}

function emitWaterSide(face: number, x: number, y: number, z: number, top: number, light: number) {
  waterB.ensure(4);
  let p: number[][];
  switch (face) {
    case 0: p = [[x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + top, z], [x + 1, y + top, z + 1]]; break;
    case 1: p = [[x, y, z], [x, y, z + 1], [x, y + top, z + 1], [x, y + top, z]]; break;
    case 4: p = [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + top, z + 1], [x, y + top, z + 1]]; break;
    default: p = [[x + 1, y, z], [x, y, z], [x, y + top, z], [x + 1, y + top, z]]; break;
  }
  const vi = p.map((q) => {
    uvFor(face, q[0], q[1], q[2], tmpUV);
    return waterB.vert(q[0], q[1], q[2], tmpUV[0], tmpUV[1], 0, face, 0, light);
  });
  waterB.quadIdx(vi[0], vi[1], vi[2], vi[3], false);
}

function emitWaterBottom(x: number, y: number, z: number, light: number) {
  waterB.ensure(4);
  const a = waterB.vert(x, y, z, x, z, 0, 3, 0, light);
  const b = waterB.vert(x + 1, y, z, x + 1, z, 0, 3, 0, light);
  const c = waterB.vert(x + 1, y, z + 1, x + 1, z + 1, 0, 3, 0, light);
  const d = waterB.vert(x, y, z + 1, x, z + 1, 0, 3, 0, light);
  waterB.quadIdx(a, b, c, d, false);
}
