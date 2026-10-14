// Procedural, original 16x16 block textures. Each texture produces albedo +
// alpha, a height field (for normal maps), per-pixel smoothness and an
// emissive mask. Everything is uploaded into two DataArrayTextures.

import * as THREE from 'three';
import { BLOCKS, BLOCK_COUNT } from '../world/blocks';
import { hash2, mulberry32, hashString } from '../core/rng';

export const TEX = 16;
type RGB = [number, number, number];

function hex(h: number): RGB {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
function mixc(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function mul(a: RGB, f: number): RGB {
  return [a[0] * f, a[1] * f, a[2] * f];
}
function pal(cols: number[], t: number): RGB {
  t = Math.max(0, Math.min(0.9999, t));
  const f = t * (cols.length - 1);
  const i = Math.floor(f);
  return mixc(hex(cols[i]), hex(cols[Math.min(i + 1, cols.length - 1)]), f - i);
}

class Img {
  rgb = new Float32Array(TEX * TEX * 3);
  a = new Float32Array(TEX * TEX).fill(1);
  h = new Float32Array(TEX * TEX).fill(-1); // -1 = derive from luminance
  s = new Float32Array(TEX * TEX);
  e = new Float32Array(TEX * TEX);
  normalStrength = 1.2;
  rnd: () => number;
  seed: number;
  constructor(public name: string, smooth: number) {
    this.seed = hashString(name);
    this.rnd = mulberry32(this.seed);
    this.s.fill(smooth);
  }
  set(x: number, y: number, c: RGB, a = 1) {
    x = ((x % TEX) + TEX) % TEX;
    y = ((y % TEX) + TEX) % TEX;
    const i = y * TEX + x;
    this.rgb[i * 3] = c[0];
    this.rgb[i * 3 + 1] = c[1];
    this.rgb[i * 3 + 2] = c[2];
    this.a[i] = a;
  }
  get(x: number, y: number): RGB {
    x = ((x % TEX) + TEX) % TEX;
    y = ((y % TEX) + TEX) % TEX;
    const i = y * TEX + x;
    return [this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]];
  }
  alpha(x: number, y: number) {
    return this.a[(((y % TEX) + TEX) % TEX) * TEX + (((x % TEX) + TEX) % TEX)];
  }
  setH(x: number, y: number, v: number) {
    this.h[(((y % TEX) + TEX) % TEX) * TEX + (((x % TEX) + TEX) % TEX)] = v;
  }
  setS(x: number, y: number, v: number) {
    this.s[(((y % TEX) + TEX) % TEX) * TEX + (((x % TEX) + TEX) % TEX)] = v;
  }
  setE(x: number, y: number, v: number) {
    this.e[(((y % TEX) + TEX) % TEX) * TEX + (((x % TEX) + TEX) % TEX)] = v;
  }
  r(x: number, y: number, salt = 0) {
    return hash2(x, y, this.seed + salt * 7919);
  }
  fill(f: (x: number, y: number) => RGB) {
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) this.set(x, y, f(x, y));
  }
}

/** Tileable value noise with integer period. */
function tnoise(x: number, y: number, period: number, seed: number) {
  const fx = (x / TEX) * period;
  const fy = (y / TEX) * period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const g = (ix: number, iy: number) => hash2(((ix % period) + period) % period, ((iy % period) + period) % period, seed);
  const a = g(x0, y0);
  const b = g(x0 + 1, y0);
  const c = g(x0, y0 + 1);
  const d = g(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable Voronoi (cell id + edge distance) */
function voronoi(x: number, y: number, pts: [number, number][]) {
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const dx = pts[i][0] + ox * TEX - x;
        const dy = pts[i][1] + oy * TEX - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = i;
        } else if (d < d2) d2 = d;
      }
  }
  return { id, edge: d2 - d1, d: d1 };
}

function randPts(img: Img, n: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i < n; i++) p.push([img.rnd() * TEX, img.rnd() * TEX]);
  return p;
}

// ---------------------------------------------------------------- generators
const G: Record<string, (img: Img) => void> = {};
const SMOOTH: Record<string, number> = {};

function def(name: string, smooth: number, f: (img: Img) => void) {
  G[name] = f;
  SMOOTH[name] = smooth;
}

function grassTop(img: Img) {
  img.fill((x, y) => {
    const n = tnoise(x, y, 4, img.seed) * 0.5 + tnoise(x, y, 8, img.seed + 3) * 0.3;
    const r = img.r(x, y);
    let t = 0.2 + n * 0.55 + (r - 0.5) * 0.35;
    if (r > 0.94) t += 0.25;
    if (r < 0.05) t -= 0.25;
    return pal([0x355e1f, 0x467c27, 0x58942f, 0x6aab3a, 0x86c24f], t);
  });
}
def('grass_top', 0.22, grassTop);

function dirtFill(img: Img, cols = [0x4a3221, 0x5e4029, 0x6f4c31, 0x7f5a3b, 0x8f6845]) {
  img.fill((x, y) => {
    const n = tnoise(x, y, 4, img.seed + 11);
    const r = img.r(x, y);
    let t = 0.25 + n * 0.4 + (r - 0.5) * 0.45;
    if (r > 0.96) t = 0.95;
    if (r < 0.04) t = 0.02;
    return pal(cols, t);
  });
}
def('dirt', 0.08, (img) => dirtFill(img));

def('grass_side', 0.15, (img) => {
  dirtFill(img);
  const g = new Img('grass_top', 0.2);
  grassTop(g);
  for (let x = 0; x < TEX; x++) {
    const depth = 3 + Math.floor(img.r(x, 0, 5) * 2.6) + (img.r(x, 1, 6) > 0.8 ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      const c = g.get(x, y + 4);
      img.set(x, y, y === depth - 1 ? mul(c, 0.82) : c);
      img.setH(x, y, 0.75 - y * 0.03);
    }
    img.setH(x, depth, 0.35);
  }
});

def('grass_snow_side', 0.2, (img) => {
  dirtFill(img);
  for (let x = 0; x < TEX; x++) {
    const depth = 3 + Math.floor(img.r(x, 0, 5) * 2.4);
    for (let y = 0; y < depth; y++) {
      const t = img.r(x, y, 2);
      img.set(x, y, pal([0xc9d8e2, 0xe4edf3, 0xf6fbff], 0.4 + t * 0.6 - y * 0.08));
      img.setH(x, y, 0.8);
    }
  }
});

function stoneFill(img: Img, cols = [0x5c5c5e, 0x6b6b6d, 0x7a7a7c, 0x89898b, 0x9a9a9c]) {
  img.fill((x, y) => {
    const n = tnoise(x, y, 4, img.seed) * 0.6 + tnoise(x, y, 8, img.seed + 1) * 0.4;
    const r = img.r(x, y);
    return pal(cols, 0.15 + n * 0.6 + (r - 0.5) * 0.3);
  });
  // cracks
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(img.rnd() * TEX);
    let y = Math.floor(img.rnd() * TEX);
    const len = 3 + Math.floor(img.rnd() * 4);
    for (let i = 0; i < len; i++) {
      img.set(x, y, mul(img.get(x, y), 0.72));
      img.setH(x, y, 0.1);
      x += img.rnd() > 0.5 ? 1 : 0;
      y += img.rnd() > 0.4 ? 1 : -1;
    }
  }
}
def('stone', 0.18, (img) => stoneFill(img));

function cobbleFill(img: Img, moss = false) {
  const pts = randPts(img, 9);
  const shades = pts.map(() => 0.25 + img.rnd() * 0.6);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const v = voronoi(x + 0.5, y + 0.5, pts);
      const r = img.r(x, y);
      if (v.edge < 1.1) {
        img.set(x, y, pal([0x3a3a3c, 0x4a4a4c], r));
        img.setH(x, y, 0.05);
      } else {
        // bevel highlight toward upper-left of each stone
        const c = pts[v.id];
        const dx = x + 0.5 - c[0];
        const dy = y + 0.5 - c[1];
        const bevel = Math.max(-0.2, Math.min(0.2, -(dx + dy) * 0.04));
        let col = pal([0x5d5d60, 0x707073, 0x858588, 0x9b9b9e, 0xadadb0], shades[v.id] + bevel + (r - 0.5) * 0.18);
        if (moss) {
          const m = tnoise(x, y, 4, img.seed + 77);
          if (m > 0.55 && r > 0.25) col = mixc(col, pal([0x3f6a2a, 0x557f34, 0x6a9640], r), 0.75);
        }
        img.set(x, y, col);
        img.setH(x, y, 0.5 + Math.min(v.edge, 3) * 0.12 + bevel);
      }
    }
}
def('cobble', 0.15, (img) => cobbleFill(img));
def('mossy_cobble', 0.18, (img) => cobbleFill(img, true));

def('sand', 0.12, (img) => {
  img.fill((x, y) => {
    const r = img.r(x, y);
    const n = tnoise(x, y, 4, img.seed);
    let t = 0.35 + n * 0.3 + (r - 0.5) * 0.35;
    if (r > 0.97) t = 0.05;
    return pal([0xc6b07a, 0xd4c08a, 0xdfcd98, 0xe8d9a8, 0xf0e4b8], t);
  });
  img.normalStrength = 0.8;
});

def('gravel', 0.1, (img) => {
  const pts = randPts(img, 22);
  const tones = pts.map(() => img.rnd());
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const v = voronoi(x + 0.5, y + 0.5, pts);
      const t = tones[v.id];
      let c = t < 0.33 ? pal([0x5e5752, 0x766e68], img.r(x, y)) : t < 0.7 ? pal([0x80807f, 0x9c9a98], img.r(x, y)) : pal([0x6d5f52, 0x8a7a6a], img.r(x, y));
      if (v.edge < 0.8) c = mul(c, 0.6);
      img.set(x, y, c);
      img.setH(x, y, Math.min(1, v.edge * 0.4));
    }
});

def('water', 0.95, (img) => {
  img.fill((x, y) => pal([0x2b5a9a, 0x3a6db0, 0x4a80c0], tnoise(x, y, 4, img.seed)));
});

function logSide(img: Img, cols: number[], dark: number) {
  for (let x = 0; x < TEX; x++) {
    const colTone = img.r(x, 0, 3);
    for (let y = 0; y < TEX; y++) {
      const n = tnoise(x * 0.5, y * 2, 8, img.seed);
      let t = 0.2 + colTone * 0.35 + n * 0.35 + (img.r(x, y) - 0.5) * 0.2;
      if (x % 4 === 0 || (x % 5 === 2 && img.r(x, y, 9) > 0.5)) t -= 0.3;
      img.set(x, y, pal(cols, t));
      img.setH(x, y, t);
    }
  }
  for (let k = 0; k < 3; k++) {
    const x = Math.floor(img.rnd() * TEX);
    const y = Math.floor(img.rnd() * TEX);
    img.set(x, y, hex(dark));
    img.set(x, y + 1, hex(dark));
  }
}
function logTop(img: Img, rings: number[], bark: number[]) {
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const dx = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const edge = dx > 6.6;
      if (edge) {
        img.set(x, y, pal(bark, img.r(x, y)));
        img.setH(x, y, 0.7);
      } else {
        const ring = Math.floor(dx + img.r(x, y) * 0.6) % 2;
        img.set(x, y, pal(rings, ring * 0.6 + img.r(x, y) * 0.35));
        img.setH(x, y, 0.4 + ring * 0.15);
      }
    }
}
def('oak_log', 0.2, (img) => logSide(img, [0x3f2c1a, 0x543b23, 0x684a2d, 0x7a5a37], 0x2e2012));
def('oak_log_top', 0.2, (img) => logTop(img, [0x8f6a3e, 0xae8a55, 0xbf9c66], [0x4a3420, 0x624528]));
def('spruce_log', 0.2, (img) => logSide(img, [0x2a1c10, 0x3a2716, 0x4a331d, 0x5a3f25], 0x1c120a));
def('spruce_log_top', 0.2, (img) => logTop(img, [0x6c4f2e, 0x86653d, 0x95734a], [0x2c1e12, 0x3b2817]));
def('birch_log', 0.25, (img) => {
  img.fill((x, y) => pal([0xbdb8aa, 0xd2cdc0, 0xe2ded2, 0xefece2], 0.3 + img.r(x, y) * 0.6));
  for (let k = 0; k < 7; k++) {
    const y = Math.floor(img.rnd() * TEX);
    const x0 = Math.floor(img.rnd() * TEX);
    const len = 2 + Math.floor(img.rnd() * 4);
    for (let i = 0; i < len; i++) {
      img.set(x0 + i, y, pal([0x1f1d1a, 0x3a3631], img.r(x0 + i, y)));
      img.setH(x0 + i, y, 0.1);
    }
  }
});
def('birch_log_top', 0.2, (img) => logTop(img, [0xb79c6c, 0xcdb582, 0xd9c494], [0xd6d1c4, 0xe8e4d8]));

function leaves(img: Img, cols: number[], holes: number) {
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const n = tnoise(x, y, 4, img.seed);
      const r = img.r(x, y);
      const clump = tnoise(x, y, 8, img.seed + 5);
      let t = 0.15 + n * 0.45 + clump * 0.3 + (r - 0.5) * 0.3;
      const hole = r < holes && clump < 0.55;
      img.set(x, y, pal(cols, t), hole ? 0 : 1);
      img.setH(x, y, t);
    }
}
def('oak_leaves', 0.38, (img) => leaves(img, [0x23481a, 0x2f5f21, 0x3e7a2a, 0x4e9134, 0x62a83f], 0.2));
def('birch_leaves', 0.38, (img) => leaves(img, [0x3a6526, 0x4c7f30, 0x5f973a, 0x74ab46, 0x8abf55], 0.2));
def('spruce_leaves', 0.38, (img) => leaves(img, [0x1a3424, 0x22432e, 0x2c5438, 0x376444, 0x427450], 0.16));

function planks(img: Img, cols: number[], seamDark = 0.62) {
  for (let board = 0; board < 4; board++) {
    const tone = img.r(board, 0, 4);
    const joint = Math.floor(img.r(board, 1, 4) * TEX);
    for (let yy = 0; yy < 4; yy++) {
      const y = board * 4 + yy;
      for (let x = 0; x < TEX; x++) {
        const grain = tnoise(x * 0.4, y * 3, 8, img.seed + board);
        let t = 0.25 + tone * 0.3 + grain * 0.3 + (img.r(x, y) - 0.5) * 0.12;
        let c = pal(cols, t);
        let h = 0.6 + grain * 0.2;
        if (yy === 3) {
          c = mul(c, seamDark);
          h = 0.05;
        } else if (x === joint) {
          c = mul(c, 0.7);
          h = 0.2;
        } else if (yy === 0) {
          c = mul(c, 1.08);
        }
        img.set(x, y, c);
        img.setH(x, y, h);
      }
    }
  }
}
def('oak_planks', 0.25, (img) => planks(img, [0x7a5a33, 0x8f6c3f, 0xa47e4b, 0xb48d57, 0xc29c63]));
def('spruce_planks', 0.25, (img) => planks(img, [0x4a3420, 0x5a4027, 0x6a4c2f, 0x785737, 0x86623e]));
def('dark_planks', 0.25, (img) => planks(img, [0x2c1d11, 0x3a2717, 0x46301c, 0x523921, 0x5d4126]));

def('glass', 0.95, (img) => {
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const frame = x === 0 || y === 0 || x === TEX - 1 || y === TEX - 1;
      if (frame) img.set(x, y, pal([0xbcd3dc, 0xd7e9ef], img.r(x, y)), 1);
      else img.set(x, y, [210, 235, 245], 0);
    }
  const streak = (x0: number, y0: number, len: number) => {
    for (let i = 0; i < len; i++) img.set(x0 + i, y0 - i, [235, 248, 252], 1);
  };
  streak(3, 6, 3);
  streak(4, 7, 2);
  streak(9, 12, 3);
  img.normalStrength = 0.2;
});
def('glass_dark', 0.95, (img) => {
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const frame = x === 0 || y === 0 || x === TEX - 1 || y === TEX - 1;
      if (frame) img.set(x, y, pal([0x2c3438, 0x3c464b], img.r(x, y)), 1);
      else img.set(x, y, [40, 60, 70], 0);
    }
  for (let i = 0; i < 3; i++) img.set(3 + i, 7 - i, [120, 150, 160], 1);
  img.normalStrength = 0.2;
});

def('bricks', 0.15, (img) => {
  for (let row = 0; row < 4; row++) {
    const off = row % 2 === 0 ? 0 : 4;
    for (let yy = 0; yy < 4; yy++) {
      const y = row * 4 + yy;
      for (let x = 0; x < TEX; x++) {
        const bx = Math.floor((x + off) / 8);
        const inBrickX = (x + off) % 8;
        const mortar = yy === 3 || inBrickX === 7;
        if (mortar) {
          img.set(x, y, pal([0x9a9184, 0xb2aa9c], img.r(x, y)));
          img.setH(x, y, 0.1);
        } else {
          const tone = hash2(bx, row, img.seed);
          let c = pal([0x7a3a2c, 0x8e4634, 0xa0533e, 0xb0624a], tone * 0.7 + img.r(x, y) * 0.3);
          if (yy === 0) c = mul(c, 1.1);
          img.set(x, y, c);
          img.setH(x, y, 0.7 + img.r(x, y) * 0.15);
        }
      }
    }
  }
});

def('stone_bricks', 0.15, (img) => {
  stoneFill(img, [0x66666a, 0x737377, 0x808084, 0x8d8d91, 0x9a9a9e]);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const row = Math.floor(y / 8);
      const off = row % 2 ? 4 : 0;
      const bx = (x + off) % 8;
      const by = y % 8;
      img.setH(x, y, 0.6 + img.r(x, y) * 0.1);
      if (by === 7 || bx === 7) {
        img.set(x, y, pal([0x404043, 0x4c4c50], img.r(x, y)));
        img.setH(x, y, 0.05);
      } else if (by === 0 || bx === 0) {
        img.set(x, y, mul(img.get(x, y), 1.12));
        img.setH(x, y, 0.75);
      }
    }
});

function concrete(img: Img, cols: number[]) {
  img.fill((x, y) => {
    const n = tnoise(x, y, 2, img.seed) * 0.6 + tnoise(x, y, 8, img.seed + 2) * 0.4;
    return pal(cols, 0.3 + n * 0.35 + (img.r(x, y) - 0.5) * 0.12);
  });
  img.normalStrength = 0.6;
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(img.rnd() * TEX);
    const y = Math.floor(img.rnd() * TEX);
    img.set(x, y, mul(img.get(x, y), 0.9));
  }
}
def('concrete', 0.3, (img) => concrete(img, [0x76797c, 0x818487, 0x8b8e91, 0x95989b]));
def('concrete_white', 0.3, (img) => concrete(img, [0xb9bcbf, 0xc5c8cb, 0xd0d3d5, 0xdadcdf]));

def('metal_plate', 0.6, (img) => {
  img.fill((x, y) => {
    const streak = tnoise(x * 0.2, y * 4, 8, img.seed);
    return pal([0x5e656c, 0x6c737a, 0x7a8289, 0x8a9299], 0.3 + streak * 0.45 + (img.r(x, y) - 0.5) * 0.1);
  });
  for (let i = 0; i < TEX; i++) {
    img.set(i, 0, mul(img.get(i, 0), 1.2));
    img.set(0, i, mul(img.get(0, i), 1.15));
    img.set(i, TEX - 1, mul(img.get(i, TEX - 1), 0.65));
    img.set(TEX - 1, i, mul(img.get(TEX - 1, i), 0.7));
    img.setH(i, TEX - 1, 0.1);
    img.setH(TEX - 1, i, 0.1);
  }
  const rivet = (x: number, y: number) => {
    img.set(x, y, hex(0xb4bcc4));
    img.set(x + 1, y + 1, hex(0x3f454b));
    img.setH(x, y, 1);
    img.setS(x, y, 0.85);
  };
  rivet(2, 2);
  rivet(12, 2);
  rivet(2, 12);
  rivet(12, 12);
});

function ore(img: Img, cols: number[], hi: number, count: number, shine: number) {
  stoneFill(img);
  for (let k = 0; k < count; k++) {
    const cx = Math.floor(img.rnd() * 13) + 1;
    const cy = Math.floor(img.rnd() * 13) + 1;
    const n = 2 + Math.floor(img.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const x = cx + Math.floor(img.rnd() * 3) - 1;
      const y = cy + Math.floor(img.rnd() * 3) - 1;
      img.set(x, y, pal(cols, img.r(x, y)));
      img.setH(x, y, 0.85);
      img.setS(x, y, shine);
    }
    img.set(cx, cy, hex(hi));
    img.setS(cx, cy, shine);
  }
}
def('coal_ore', 0.18, (img) => ore(img, [0x1b1b1b, 0x2b2b2b, 0x3a3a3a], 0x4a4a4a, 5, 0.4));
def('iron_ore', 0.18, (img) => ore(img, [0xa77f62, 0xc29a78, 0xd5b08f], 0xe8c6a8, 4, 0.55));
def('gold_ore', 0.18, (img) => ore(img, [0xc79a1f, 0xe2b832, 0xf5d24d], 0xfff19a, 4, 0.8));
def('diamond_ore', 0.18, (img) => ore(img, [0x2aa5a5, 0x49c9c6, 0x75e6e0], 0xd8fffb, 3, 0.95));

def('snow', 0.35, (img) => {
  img.fill((x, y) => pal([0xd2dee8, 0xe2ebf2, 0xeef4f8, 0xf8fbfe], 0.4 + tnoise(x, y, 4, img.seed) * 0.4 + (img.r(x, y) - 0.5) * 0.2));
  img.normalStrength = 0.5;
});
def('ice', 0.85, (img) => {
  img.fill((x, y) => pal([0x7fb0e0, 0x92c0ea, 0xa8d0f2], 0.3 + tnoise(x, y, 2, img.seed) * 0.5));
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(img.rnd() * TEX);
    let y = Math.floor(img.rnd() * TEX);
    for (let i = 0; i < 6; i++) {
      img.set(x, y, hex(0xd6ecff));
      img.setH(x, y, 0.2);
      x += 1;
      y += img.rnd() > 0.5 ? 1 : 0;
    }
  }
  img.normalStrength = 0.4;
});
def('terracotta', 0.12, (img) => {
  img.fill((x, y) => pal([0x8f4c2a, 0x9c5530, 0xa65d36], 0.3 + tnoise(x, y, 4, img.seed) * 0.4 + (img.r(x, y) - 0.5) * 0.2));
  img.normalStrength = 0.5;
});
def('terracotta_red', 0.12, (img) => {
  img.fill((x, y) => pal([0x7c3326, 0x89392b, 0x944030], 0.3 + tnoise(x, y, 4, img.seed) * 0.4 + (img.r(x, y) - 0.5) * 0.2));
  img.normalStrength = 0.5;
});
def('sandstone_top', 0.12, (img) => {
  img.fill((x, y) => pal([0xcdb882, 0xd8c58e, 0xe0ce9a], 0.3 + tnoise(x, y, 4, img.seed) * 0.4 + (img.r(x, y) - 0.5) * 0.15));
  img.normalStrength = 0.5;
});
def('sandstone_side', 0.12, (img) => {
  img.fill((x, y) => {
    const band = y < 3 ? 0.75 : y > 12 ? 0.2 : 0.45 + Math.sin(y * 1.3) * 0.1;
    return pal([0xb9a26a, 0xcbb47e, 0xd8c58e, 0xe4d39e], band + (img.r(x, y) - 0.5) * 0.15);
  });
  for (let x = 0; x < TEX; x++) {
    img.set(x, 3, mul(img.get(x, 3), 0.8));
    img.setH(x, 3, 0.1);
    img.set(x, 12, mul(img.get(x, 12), 0.85));
    img.setH(x, 12, 0.1);
  }
});
def('bedrock', 0.1, (img) => {
  img.fill((x, y) => pal([0x1e1e1e, 0x3a3a3a, 0x555555, 0x707070], img.r(x, y) * 0.8 + tnoise(x, y, 4, img.seed) * 0.2));
});

// cross plants -----------------------------------------------------------
function clearImg(img: Img) {
  for (let i = 0; i < TEX * TEX; i++) img.a[i] = 0;
}
def('tall_grass', 0.3, (img) => {
  clearImg(img);
  for (let b = 0; b < 9; b++) {
    let x = 1 + Math.floor(img.rnd() * 14);
    const h = 6 + Math.floor(img.rnd() * 9);
    const lean = img.rnd() > 0.5 ? 1 : -1;
    for (let i = 0; i < h; i++) {
      const y = TEX - 1 - i;
      img.set(x, y, pal([0x2f5d1f, 0x4a8a2e, 0x6aab3f, 0x88c457], i / h + img.r(x, y) * 0.2), 1);
      if (i > h * 0.5 && img.rnd() > 0.65) x += lean;
      x = Math.max(0, Math.min(TEX - 1, x));
    }
  }
});
def('fern', 0.3, (img) => {
  clearImg(img);
  for (let f = 0; f < 4; f++) {
    const bx = 3 + f * 3;
    const top = 3 + Math.floor(img.rnd() * 4);
    for (let y = TEX - 1; y >= top; y--) {
      const x = bx + Math.round((TEX - y) * (f < 2 ? -0.15 : 0.15));
      img.set(x, y, hex(0x2f6a28), 1);
      if (y % 2 === 0 && y < TEX - 2) {
        img.set(x - 1, y, pal([0x3d7d31, 0x58a046], img.r(x, y)), 1);
        img.set(x + 1, y - 1, pal([0x3d7d31, 0x58a046], img.r(x, y, 2)), 1);
      }
    }
  }
});
function flower(img: Img, petal: number[], center: number) {
  clearImg(img);
  for (let y = 7; y < TEX; y++) img.set(7, y, pal([0x2d5e22, 0x3f7a2b], img.r(7, y)), 1);
  img.set(6, 11, hex(0x4a8a33), 1);
  img.set(8, 12, hex(0x4a8a33), 1);
  img.set(5, 10, hex(0x4a8a33), 1);
  const pts = [
    [6, 4], [7, 4], [8, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [5, 6], [6, 6], [8, 6], [9, 6], [6, 7], [7, 7], [8, 7],
  ];
  for (const [x, y] of pts) img.set(x, y, pal(petal, img.r(x, y)), 1);
  img.set(7, 6, hex(center), 1);
  for (const [x, y] of pts) img.setS(x, y, 0.5);
}
def('flower_red', 0.4, (img) => flower(img, [0xa81e1e, 0xcf2c2c, 0xe84a3c], 0x2a1a10));
def('flower_yellow', 0.4, (img) => flower(img, [0xd9b51c, 0xf0d23a, 0xffe76a], 0xb07a10));
def('dead_bush', 0.2, (img) => {
  clearImg(img);
  const branch = (x: number, y: number, dx: number, len: number) => {
    for (let i = 0; i < len; i++) {
      img.set(x, y, pal([0x5a3c1e, 0x7a5430, 0x8f6a3e], img.r(x, y)), 1);
      y--;
      if (img.rnd() > 0.5) x += dx;
    }
    return [x, y];
  };
  const [x1, y1] = branch(7, 15, 0, 5);
  branch(x1, y1, -1, 6);
  branch(x1, y1, 1, 7);
  branch(x1 - 1, y1 + 2, -1, 4);
});
def('wheat', 0.3, (img) => {
  clearImg(img);
  for (let s = 0; s < 5; s++) {
    const x = 2 + s * 3;
    const top = 2 + Math.floor(img.rnd() * 3);
    for (let y = TEX - 1; y >= top; y--) {
      if (y < top + 5) img.set(x + (y % 2), y, pal([0xc49a2e, 0xdcb542, 0xeccb5c], img.r(x, y)), 1);
      else img.set(x, y, pal([0x8c8a3a, 0xa8a24a], img.r(x, y)), 1);
    }
  }
});

// emissive ---------------------------------------------------------------
def('lamp', 0.6, (img) => {
  const pts = randPts(img, 8);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const v = voronoi(x + 0.5, y + 0.5, pts);
      const t = Math.min(1, v.d / 5);
      const c = v.edge < 0.9 ? pal([0x8a5a20, 0xa06a28], img.r(x, y)) : pal([0xfff4c8, 0xffd27a, 0xe8a640], t + img.r(x, y) * 0.2);
      img.set(x, y, c);
      img.setE(x, y, v.edge < 0.9 ? 0.25 : 1 - t * 0.4);
      img.setH(x, y, v.edge < 0.9 ? 0.1 : 0.7);
    }
});
def('light_panel', 0.7, (img) => {
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const frame = x < 2 || y < 2 || x > 13 || y > 13;
      if (frame) {
        img.set(x, y, pal([0x5c636a, 0x737a82], img.r(x, y)));
        img.setH(x, y, 0.8);
      } else {
        img.set(x, y, pal([0xd7ecff, 0xf2f9ff], img.r(x, y) * 0.4 + (y % 4 === 0 ? 0 : 0.6)));
        img.setE(x, y, 1);
        img.setH(x, y, 0.4);
      }
    }
});
def('server', 0.5, (img) => {
  img.fill((x, y) => pal([0x22272c, 0x2d3339, 0x363d44], img.r(x, y) * 0.5 + (y % 4 === 3 ? 0 : 0.5)));
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 1;
    for (let x = 2; x < 14; x++) {
      img.set(x, y + 1, mul(img.get(x, y + 1), 0.6));
      img.setH(x, y + 1, 0.1);
    }
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(img.rnd() * 6);
      const green = img.rnd() > 0.35;
      img.set(x, y, green ? hex(0x5cff8a) : hex(0x5ab8ff));
      img.setE(x, y, 1);
    }
  }
});

// containers / props ------------------------------------------------------
function framedWood(img: Img, cols: number[], frame: number[], brace: boolean) {
  planks(img, cols, 0.7);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const onFrame = x < 2 || y < 2 || x > 13 || y > 13;
      const onBrace = brace && (Math.abs(x - y) < 1.5 || Math.abs(x - (15 - y)) < 1.5) && !onFrame;
      if (onFrame || onBrace) {
        let c = pal(frame, img.r(x, y) * 0.6 + (x === 0 || y === 0 ? 0.4 : 0));
        if (x === 15 || y === 15) c = mul(c, 0.7);
        img.set(x, y, c);
        img.setH(x, y, 0.9);
      }
    }
}
def('crate', 0.2, (img) => framedWood(img, [0x8a6a3e, 0x9c7b4a, 0xad8b56], [0x5d4428, 0x6e5232, 0x7f603b], true));
def('crate_top', 0.2, (img) => framedWood(img, [0x8a6a3e, 0x9c7b4a, 0xad8b56], [0x5d4428, 0x6e5232, 0x7f603b], false));
def('chest_side', 0.25, (img) => {
  framedWood(img, [0x9a6a28, 0xb07c32, 0xc28c3c], [0x4e3416, 0x5e401c], false);
  for (let x = 0; x < TEX; x++) {
    img.set(x, 5, hex(0x3a2610));
    img.setH(x, 5, 0.05);
  }
});
def('chest_top', 0.25, (img) => framedWood(img, [0x9a6a28, 0xb07c32, 0xc28c3c], [0x4e3416, 0x5e401c], false));
def('chest_front', 0.3, (img) => {
  G['chest_side'](img);
  for (let y = 4; y < 9; y++)
    for (let x = 6; x < 10; x++) {
      img.set(x, y, pal([0x9aa3ab, 0xc8d0d6], img.r(x, y) + (y === 4 ? 0.4 : 0)));
      img.setS(x, y, 0.8);
      img.setH(x, y, 1);
    }
  img.set(7, 6, hex(0x2a2a2a));
  img.set(8, 6, hex(0x2a2a2a));
  // golden trim to read as loot
  for (let x = 2; x < 14; x++) {
    img.set(x, 2, hex(0xe6b847));
    img.setS(x, 2, 0.8);
  }
});
def('chest_open_top', 0.2, (img) => {
  framedWood(img, [0x5e4220, 0x6e4e28, 0x7a5830], [0x3a2812, 0x46301a], false);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) img.set(x, y, pal([0x1d140b, 0x2a1d10], img.r(x, y)));
});
def('chest_open_front', 0.2, (img) => {
  framedWood(img, [0x5e4220, 0x6e4e28, 0x7a5830], [0x3a2812, 0x46301a], false);
  for (let y = 0; y < 4; y++) for (let x = 0; x < TEX; x++) img.set(x, y, pal([0x140d07, 0x221810], img.r(x, y)));
  for (let y = 6; y < 9; y++) for (let x = 6; x < 10; x++) img.set(x, y, pal([0x6b7278, 0x8a9198], img.r(x, y)));
});
def('hay_top', 0.15, (img) => {
  img.fill((x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const ring = Math.sqrt(dx * dx + dy * dy);
    return pal([0x9c7c20, 0xb8962c, 0xd0ae3c, 0xe2c454], 0.3 + Math.sin(ring * 1.6) * 0.2 + img.r(x, y) * 0.35);
  });
});
def('hay_side', 0.15, (img) => {
  img.fill((x, y) => pal([0x9c7c20, 0xb8962c, 0xd0ae3c, 0xe2c454], img.r(x, 0) * 0.5 + img.r(x, y) * 0.35 + 0.1));
  for (const by of [3, 12]) for (let x = 0; x < TEX; x++) {
    img.set(x, by, pal([0x6a3a1c, 0x7c4824], img.r(x, by)));
    img.setH(x, by, 0.9);
  }
});
function wool(img: Img, cols: number[]) {
  img.fill((x, y) => pal(cols, 0.35 + tnoise(x, y, 4, img.seed) * 0.3 + ((x + y) % 3 === 0 ? 0.12 : 0) + (img.r(x, y) - 0.5) * 0.15));
  img.normalStrength = 0.7;
}
def('wool_red', 0.05, (img) => wool(img, [0x7e1f1c, 0x952824, 0xaa302b, 0xbd3a33]));
def('wool_blue', 0.05, (img) => wool(img, [0x1f3478, 0x27408e, 0x2f4ca2, 0x3a58b4]));
def('wool_white', 0.05, (img) => wool(img, [0xbfc2c4, 0xd2d4d6, 0xe2e4e5, 0xf0f1f2]));
def('path_top', 0.1, (img) => dirtFill(img, [0x6e5232, 0x80623e, 0x917249, 0xa08052, 0xae8e5c]));
def('asphalt', 0.2, (img) => {
  img.fill((x, y) => {
    const r = img.r(x, y);
    return pal([0x2c2e30, 0x35373a, 0x3e4043, 0x4a4c4f], 0.3 + tnoise(x, y, 4, img.seed) * 0.3 + (r - 0.5) * 0.4 + (r > 0.95 ? 0.4 : 0));
  });
  img.normalStrength = 0.6;
});
def('hazard', 0.4, (img) => {
  img.fill((x, y) => {
    const stripe = Math.floor((x + y) / 4) % 2 === 0;
    const base = stripe ? pal([0xd2a51c, 0xe6b82a], img.r(x, y)) : pal([0x1e1e1e, 0x2a2a2a], img.r(x, y));
    return mul(base, 0.9 + tnoise(x, y, 4, img.seed) * 0.2);
  });
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) img.setH(x, y, 0.5 + img.r(x, y) * 0.1);
});
def('bookshelf', 0.2, (img) => {
  planks(img, [0x7a5a33, 0x8f6c3f, 0xa47e4b]);
  const bookCols = [0x7a2a24, 0x2a4a7a, 0x2a6a3a, 0x8a6a2a, 0x5a2a6a, 0x6a6a6a];
  for (const shelf of [1, 9]) {
    let x = 1;
    while (x < 15) {
      const w = 1 + Math.floor(img.rnd() * 2);
      const c = hex(bookCols[Math.floor(img.rnd() * bookCols.length)]);
      const top = shelf + Math.floor(img.rnd() * 2);
      for (let xx = x; xx < Math.min(15, x + w); xx++)
        for (let y = top; y < shelf + 6; y++) {
          img.set(xx, y, mul(c, 0.8 + img.r(xx, y) * 0.3));
          img.setH(xx, y, 0.8);
        }
      x += w;
    }
  }
});
def('boulder', 0.2, (img) => {
  img.fill((x, y) => {
    const n = tnoise(x, y, 4, img.seed) * 0.5 + tnoise(x, y, 8, img.seed + 1) * 0.5;
    const r = img.r(x, y);
    let c = pal([0x6c665e, 0x7e776e, 0x908a80, 0xa29c92, 0xb6b0a6], 0.2 + n * 0.5 + (r - 0.5) * 0.4);
    if (r > 0.9) c = hex(0x5a544c);
    if (tnoise(x, y, 4, img.seed + 50) > 0.7 && r > 0.3) c = mixc(c, hex(0x8a9a52), 0.5);
    return c;
  });
});
def('tile_floor', 0.55, (img) => {
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const tile = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      const grout = x % 8 === 7 || y % 8 === 7;
      let c = tile ? pal([0xb8babd, 0xc6c8cb], img.r(x, y)) : pal([0xd8dadc, 0xe4e6e8], img.r(x, y));
      if (grout) c = hex(0x8a8c8f);
      img.set(x, y, c);
      img.setH(x, y, grout ? 0.1 : 0.6);
    }
});
def('vent', 0.5, (img) => {
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const frame = x === 0 || y === 0 || x === 15 || y === 15;
      const slot = !frame && y % 3 === 1;
      img.set(x, y, slot ? pal([0x111315, 0x1a1c1f], img.r(x, y)) : pal([0x5e656c, 0x737a82], img.r(x, y) + (y % 3 === 2 ? 0.3 : 0)));
      img.setH(x, y, slot ? 0 : 0.8);
    }
});
def('iron_bars', 0.6, (img) => {
  clearImg(img);
  for (let y = 0; y < TEX; y++)
    for (const x of [1, 5, 10, 14]) {
      img.set(x, y, pal([0x5a5e62, 0x7a7e82], img.r(x, y)), 1);
      img.set(x + 1, y, pal([0x3a3e42, 0x4a4e52], img.r(x, y)), 1);
    }
  for (let x = 0; x < TEX; x++) for (const y of [1, 14]) img.set(x, y, pal([0x5a5e62, 0x7a7e82], img.r(x, y)), 1);
});
def('cactus_side', 0.3, (img) => {
  img.fill((x, y) => pal([0x2f5e22, 0x3d742b, 0x4c8a34, 0x5a9a3c], (x % 4 === 1 ? 0.8 : 0.35) + (img.r(x, y) - 0.5) * 0.3));
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(img.rnd() * TEX);
    const y = Math.floor(img.rnd() * TEX);
    img.set(x, y, hex(0xe6e0b0));
    img.setH(x, y, 1);
  }
});
def('cactus_top', 0.3, (img) => {
  img.fill((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    return pal([0x2f5e22, 0x4c8a34, 0x6aa848], d < 3 ? 0.9 : d > 6.5 ? 0.1 : 0.5 + (img.r(x, y) - 0.5) * 0.3);
  });
});
def('roof', 0.2, (img) => {
  for (let row = 0; row < 4; row++)
    for (let yy = 0; yy < 4; yy++) {
      const y = row * 4 + yy;
      for (let x = 0; x < TEX; x++) {
        const off = row % 2 ? 2 : 0;
        const sh = Math.floor((x + off) / 4);
        const tone = hash2(sh, row, img.seed);
        let c = pal([0x4a2620, 0x5c3028, 0x6e3a30, 0x7e4436], tone * 0.6 + img.r(x, y) * 0.3 + (3 - yy) * 0.05);
        if (yy === 3) c = mul(c, 0.55);
        if ((x + off) % 4 === 3) c = mul(c, 0.8);
        img.set(x, y, c);
        img.setH(x, y, yy === 3 ? 0.05 : 0.5 + (3 - yy) * 0.1);
      }
    }
});

// player-built panels -------------------------------------------------------
def('build_wood', 0.25, (img) => {
  framedWood(img, [0xa47e4b, 0xb48d57, 0xc49c63, 0xd2ab70], [0x7a5530, 0x8a6238, 0x9a7042], true);
});
def('build_stone', 0.2, (img) => {
  G['stone_bricks'](img);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      if (x < 1 || y < 1 || x > 14 || y > 14) {
        img.set(x, y, pal([0xa8a8a6, 0xbababa], img.r(x, y)));
        img.setH(x, y, 1);
      }
    }
});
def('build_metal', 0.65, (img) => {
  img.fill((x, y) => {
    const tread = (x + y * 2) % 6 === 0 || (x * 2 - y + 32) % 6 === 0;
    return pal([0x5a6672, 0x6b7884, 0x7c8a96, 0x8e9ca8], 0.35 + (tread ? 0.4 : 0) + (img.r(x, y) - 0.5) * 0.15);
  });
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const tread = (x + y * 2) % 6 === 0 || (x * 2 - y + 32) % 6 === 0;
      img.setH(x, y, tread ? 0.8 : 0.4);
      if (x < 1 || y < 1 || x > 14 || y > 14) {
        img.set(x, y, pal([0x9aa8b4, 0xb0bcc6], img.r(x, y)));
        img.setH(x, y, 1);
      }
    }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) {
    img.set(x, y, hex(0xd0d8de));
    img.setS(x, y, 0.9);
  }
});

// damage overlay stages (used by the block crack overlay) --------------------
for (let stage = 0; stage < 5; stage++) {
  def(`crack_${stage}`, 0, (img) => {
    clearImg(img);
    const r = mulberry32(99);
    const lines = 2 + stage * 2;
    for (let l = 0; l < lines; l++) {
      let x = 7 + Math.floor(r() * 3) - 1;
      let y = 7 + Math.floor(r() * 3) - 1;
      const len = 3 + stage * 2;
      const dx = r() > 0.5 ? 1 : -1;
      const dy = r() > 0.5 ? 1 : -1;
      for (let i = 0; i < len; i++) {
        img.set(x, y, [20, 20, 20], 1);
        if (r() > 0.4) x += dx;
        else y += dy;
      }
    }
  });
}

// ------------------------------------------------------------------ build
export interface TextureSet {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  layers: Map<string, number>;
  images: Map<string, Img>;
  count: number;
}

export const FACE_LAYER = new Uint8Array(BLOCK_COUNT * 6);
let SET: TextureSet | null = null;

function toByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function buildTextures(): TextureSet {
  if (SET) return SET;
  const names = Object.keys(G);
  const n = names.length;
  const albedo = new Uint8Array(TEX * TEX * 4 * n);
  const normal = new Uint8Array(TEX * TEX * 4 * n);
  const layers = new Map<string, number>();
  const images = new Map<string, Img>();
  names.forEach((name, layer) => {
    const img = new Img(name, SMOOTH[name]);
    G[name](img);
    layers.set(name, layer);
    images.set(name, img);
    const base = layer * TEX * TEX * 4;
    // alpha bleeding: transparent texels take the average opaque colour so
    // mipmaps of cutout textures don't darken toward black
    {
      let r = 0, g = 0, b = 0, c = 0;
      for (let i = 0; i < TEX * TEX; i++) if (img.a[i] > 0.5) { r += img.rgb[i * 3]; g += img.rgb[i * 3 + 1]; b += img.rgb[i * 3 + 2]; c++; }
      if (c > 0 && c < TEX * TEX) {
        r /= c; g /= c; b /= c;
        for (let i = 0; i < TEX * TEX; i++) if (img.a[i] <= 0.5) { img.rgb[i * 3] = r; img.rgb[i * 3 + 1] = g; img.rgb[i * 3 + 2] = b; }
      }
    }
    // height: explicit or luminance
    const hgt = new Float32Array(TEX * TEX);
    for (let i = 0; i < TEX * TEX; i++) {
      const lum = (img.rgb[i * 3] * 0.3 + img.rgb[i * 3 + 1] * 0.59 + img.rgb[i * 3 + 2] * 0.11) / 255;
      hgt[i] = img.h[i] >= 0 ? img.h[i] : lum;
    }
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const src = y * TEX + x;
        // flip rows so v=1 samples the top of the image
        const dst = base + ((TEX - 1 - y) * TEX + x) * 4;
        albedo[dst] = toByte(img.rgb[src * 3]);
        albedo[dst + 1] = toByte(img.rgb[src * 3 + 1]);
        albedo[dst + 2] = toByte(img.rgb[src * 3 + 2]);
        albedo[dst + 3] = img.a[src] > 0.5 ? 255 : 0;
        const H = (xx: number, yy: number) => hgt[(((yy + TEX) % TEX) * TEX) + ((xx + TEX) % TEX)];
        const s = img.normalStrength * 2.2;
        const dhdu = (H(x + 1, y) - H(x - 1, y)) * 0.5;
        const dhdv = (H(x, y - 1) - H(x, y + 1)) * 0.5;
        let nx = -dhdu * s;
        let ny = -dhdv * s;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        normal[dst] = toByte((nx * 0.5 + 0.5) * 255);
        normal[dst + 1] = toByte((ny * 0.5 + 0.5) * 255);
        normal[dst + 2] = toByte(img.s[src] * 255);
        normal[dst + 3] = toByte(img.e[src] * 255);
      }
  });

  const mk = (data: Uint8Array) => {
    const t = new THREE.DataArrayTexture(data as unknown as BufferSource, TEX, TEX, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const albedoTex = mk(albedo);
  const normalTex = mk(normal);
  normalTex.minFilter = THREE.LinearMipmapLinearFilter;

  for (let id = 0; id < BLOCK_COUNT; id++) {
    const d = BLOCKS[id];
    if (!d) continue;
    for (let f = 0; f < 6; f++) {
      const name = d.tex[f];
      FACE_LAYER[id * 6 + f] = name && layers.has(name) ? layers.get(name)! : 0;
    }
  }
  SET = { albedo: albedoTex, normal: normalTex, layers, images, count: n };
  return SET;
}

/** Render a texture to a canvas for UI usage (icons, item previews). */
export function textureCanvas(name: string, scale = 4): HTMLCanvasElement {
  const set = buildTextures();
  const img = set.images.get(name);
  const c = document.createElement('canvas');
  c.width = TEX * scale;
  c.height = TEX * scale;
  const ctx = c.getContext('2d')!;
  if (!img) return c;
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      if (img.a[i] < 0.5) continue;
      ctx.fillStyle = `rgb(${toByte(img.rgb[i * 3])},${toByte(img.rgb[i * 3 + 1])},${toByte(img.rgb[i * 3 + 2])})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  return c;
}

/** Average colour of a texture (used for particles & minimap). */
export function textureAverage(name: string): [number, number, number] {
  const set = buildTextures();
  const img = set.images.get(name);
  if (!img) return [128, 128, 128];
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < TEX * TEX; i++) {
    if (img.a[i] < 0.5) continue;
    r += img.rgb[i * 3];
    g += img.rgb[i * 3 + 1];
    b += img.rgb[i * 3 + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

/** Draw an isometric block icon (top + two sides) for UI. */
export function blockIconCanvas(blockId: number, size = 64): HTMLCanvasElement {
  const set = buildTextures();
  const d = BLOCKS[blockId];
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const top = textureCanvas(d.tex[2], 1);
  const left = textureCanvas(d.tex[4], 1);
  const right = textureCanvas(d.tex[0], 1);
  const s = size / 2 / TEX; // half width per tile
  const h = size * 0.5;
  // top face
  ctx.save();
  ctx.translate(size / 2, size * 0.04);
  ctx.transform(s, s * 0.5, -s, s * 0.5, 0, 0);
  ctx.drawImage(top, 0, 0);
  ctx.restore();
  // left face
  ctx.save();
  ctx.translate(0, size * 0.04 + h * 0.5);
  ctx.transform(s, s * 0.5, 0, s * 1.0, 0, 0);
  ctx.drawImage(left, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, TEX, TEX);
  ctx.restore();
  // right face
  ctx.save();
  ctx.translate(size / 2, size * 0.04 + h);
  ctx.transform(s, -s * 0.5, 0, s * 1.0, 0, 0);
  ctx.drawImage(right, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, TEX, TEX);
  ctx.restore();
  void set;
  return c;
}
