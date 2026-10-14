// Authoring toolkit for hand-designed maps: primitives, trees, furniture and
// building blueprints. Maps call these at authored coordinates.

import { B, IS_SOLID, RENDER } from '../blocks';
import { VoxelWorld } from '../world';
import { Noise } from '../../core/noise';
import { RNG } from '../../core/rng';

export type LootTier = 'common' | 'rare' | 'epic';

export interface Landmark {
  name: string;
  x: number;
  z: number;
  /** importance for minimap labels */
  major: boolean;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  team?: number;
}

export interface MapData {
  world: VoxelWorld;
  name: string;
  lootSpots: { x: number; y: number; z: number; tier: LootTier }[];
  chests: { x: number; y: number; z: number; tier: LootTier }[];
  landmarks: Landmark[];
  spawns: SpawnPoint[];
  /** BR only: points where bots like to land */
  dropTargets: { x: number; z: number; weight: number }[];
  seaLevel: number;
  /** cover/peek points for AI */
  coverHints: { x: number; y: number; z: number }[];
  preset: { time: number; weather: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow'; timeScale: number };
  bounds: { x0: number; z0: number; x1: number; z1: number };
  /** TDM extras for AI and spawning */
  tdm?: {
    spawnZones: { team: number; x0: number; z0: number; x1: number; z1: number }[];
    lanes: { x: number; z: number }[][];
    perches: { x: number; y: number; z: number }[];
  };
  /** tutorial stations */
  stations?: Record<string, { x: number; y: number; z: number }>;
}

export type Facing = 'n' | 's' | 'e' | 'w';

export class MapBuilder {
  noise: Noise;
  rng: RNG;
  lootSpots: MapData['lootSpots'] = [];
  chests: MapData['chests'] = [];
  landmarks: Landmark[] = [];
  coverHints: MapData['coverHints'] = [];
  glass = B.GLASS as number;

  constructor(public w: VoxelWorld, seed: number) {
    this.noise = new Noise(seed);
    this.rng = new RNG(seed ^ 0x5bd1e995);
  }

  get(x: number, y: number, z: number) {
    return this.w.getRaw(x, y, z);
  }
  set(x: number, y: number, z: number, id: number) {
    this.w.setRaw(x, y, z, id);
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const az = Math.min(z0, z1), bz = Math.max(z0, z1);
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) this.set(x, y, z, id);
  }

  /** Hollow box: walls only (no floor/ceiling). */
  walls(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) {
    this.fill(x0, y0, z0, x1, y1, z0, id);
    this.fill(x0, y0, z1, x1, y1, z1, id);
    this.fill(x0, y0, z0, x0, y1, z1, id);
    this.fill(x1, y0, z0, x1, y1, z1, id);
  }

  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.fill(x0, y0, z0, x1, y1, z1, B.AIR);
  }

  /** Top-most solid block (ignoring leaves & plants). */
  surface(x: number, z: number): number {
    for (let y = this.w.sy - 1; y >= 0; y--) {
      const id = this.get(x, y, z);
      if (id !== B.AIR && IS_SOLID[id] && RENDER[id] !== 2) return y;
      if (id === B.WATER) return y;
    }
    return 0;
  }

  /** Flatten terrain in a rectangle to height y (top block = top), blending edges. */
  flatten(x0: number, z0: number, x1: number, z1: number, y: number, top = B.GRASS as number, under = B.DIRT as number, margin = 4) {
    for (let x = x0 - margin; x <= x1 + margin; x++)
      for (let z = z0 - margin; z <= z1 + margin; z++) {
        if (x < 0 || z < 0 || x >= this.w.sx || z >= this.w.sz) continue;
        const dx = Math.max(x0 - x, 0, x - x1);
        const dz = Math.max(z0 - z, 0, z - z1);
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > margin) continue;
        const cur = this.surface(x, z);
        const t = margin === 0 ? 1 : 1 - d / margin;
        const s = t * t * (3 - 2 * t);
        const target = Math.round(cur + (y - cur) * s);
        for (let yy = 1; yy < this.w.sy; yy++) {
          if (yy < target - 3) {
            if (this.get(x, yy, z) === B.AIR || this.get(x, yy, z) === B.WATER) this.set(x, yy, z, B.STONE);
          } else if (yy < target) this.set(x, yy, z, under);
          else if (yy === target) this.set(x, yy, z, d <= 0 ? top : this.get(x, yy, z) === B.AIR || yy > cur ? top : top);
          else this.set(x, yy, z, B.AIR);
        }
      }
  }

  // ------------------------------------------------------------- vegetation
  leafBlob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, id: number, sparse = 0.12) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
          if (d > 1) continue;
          if (d > 0.7 && this.rng.chance(sparse * 2)) continue;
          if (this.get(x, y, z) === B.AIR) this.set(x, y, z, id);
        }
  }

  oak(x: number, y: number, z: number, big = false) {
    const h = big ? this.rng.int(7, 9) : this.rng.int(4, 6);
    for (let i = 0; i < h; i++) this.set(x, y + i, z, B.OAK_LOG);
    const top = y + h;
    if (big) {
      this.leafBlob(x + 0.5, top - 1, z + 0.5, 4.2, 3, 4.2, B.OAK_LEAVES);
      // branches
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (this.rng.chance(0.6)) {
          this.set(x + dx, top - 3, z + dz, B.OAK_LOG);
          this.set(x + dx * 2, top - 2, z + dz * 2, B.OAK_LOG);
          this.leafBlob(x + dx * 3 + 0.5, top - 1, z + dz * 3 + 0.5, 2.5, 1.8, 2.5, B.OAK_LEAVES);
        }
      }
      this.set(x + 1, y, z, B.OAK_LOG);
      this.set(x, y, z + 1, B.OAK_LOG);
    } else {
      // classic layered canopy
      for (let ly = top - 3; ly <= top; ly++) {
        const r = ly >= top - 1 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (ly === top || this.rng.chance(0.5))) continue;
            if (this.get(x + dx, ly, z + dz) === B.AIR) this.set(x + dx, ly, z + dz, B.OAK_LEAVES);
          }
      }
      this.set(x, top, z, B.OAK_LEAVES);
    }
  }

  birch(x: number, y: number, z: number) {
    const h = this.rng.int(6, 8);
    for (let i = 0; i < h; i++) this.set(x, y + i, z, B.BIRCH_LOG);
    const top = y + h;
    for (let ly = top - 3; ly <= top; ly++) {
      const r = ly >= top - 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && this.rng.chance(0.7)) continue;
          if (this.get(x + dx, ly, z + dz) === B.AIR) this.set(x + dx, ly, z + dz, B.BIRCH_LEAVES);
        }
    }
    this.set(x, top + 1, z, B.BIRCH_LEAVES);
  }

  spruce(x: number, y: number, z: number, tall = false) {
    const h = tall ? this.rng.int(11, 15) : this.rng.int(7, 10);
    for (let i = 0; i < h; i++) this.set(x, y + i, z, B.SPRUCE_LOG);
    const top = y + h;
    let r = tall ? 3 : 2;
    let toggle = false;
    for (let ly = y + 2; ly <= top; ly++) {
      const layer = top - ly;
      const rad = Math.min(r, Math.floor(layer / 2) + (toggle ? 0 : 1));
      toggle = !toggle;
      for (let dx = -rad; dx <= rad; dx++)
        for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > rad + 0.5) continue;
          if (this.get(x + dx, ly, z + dz) === B.AIR) this.set(x + dx, ly, z + dz, B.SPRUCE_LEAVES);
        }
    }
    this.set(x, top, z, B.SPRUCE_LEAVES);
    this.set(x, top + 1, z, B.SPRUCE_LEAVES);
    void r;
  }

  cactus(x: number, y: number, z: number) {
    const h = this.rng.int(2, 4);
    for (let i = 0; i < h; i++) this.set(x, y + i, z, B.CACTUS);
  }

  boulder(x: number, y: number, z: number, r = 1.6) {
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -1; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++) {
          const d = (dx * dx) / (r * r) + (dy * dy) / ((r * 0.8) ** 2) + (dz * dz) / (r * r);
          if (d <= 1 + this.rng.next() * 0.25) {
            const cur = this.get(x + dx, y + dy, z + dz);
            if (cur === B.AIR || RENDER[cur] === 3 || cur === B.GRASS || cur === B.DIRT || cur === B.SAND)
              this.set(x + dx, y + dy, z + dz, this.rng.chance(0.15) ? B.MOSSY_COBBLE : B.BOULDER);
          }
        }
  }

  plant(x: number, y: number, z: number, id: number) {
    if (this.get(x, y, z) === B.AIR) this.set(x, y, z, id);
  }

  // ------------------------------------------------------------- props
  lamp(x: number, y: number, z: number) {
    this.set(x, y, z, B.LAMP);
  }

  lampPost(x: number, y: number, z: number, h = 3) {
    for (let i = 0; i < h; i++) this.set(x, y + i, z, B.DARK_PLANKS);
    this.set(x, y + h, z, B.LAMP);
  }

  chest(x: number, y: number, z: number, tier: LootTier = 'common') {
    this.set(x, y, z, B.CHEST);
    this.chests.push({ x, y, z, tier });
  }

  loot(x: number, y: number, z: number, tier: LootTier = 'common') {
    this.lootSpots.push({ x: x + 0.5, y, z: z + 0.5, tier });
  }

  table(x: number, y: number, z: number) {
    this.set(x, y, z, B.OAK_PLANKS);
  }

  bed(x: number, y: number, z: number, dir: 'x' | 'z', color = B.WOOL_RED as number) {
    this.set(x, y, z, color);
    if (dir === 'x') this.set(x + 1, y, z, B.WOOL_WHITE);
    else this.set(x, y, z + 1, B.WOOL_WHITE);
  }

  // ------------------------------------------------------------- buildings
  /**
   * Cottage with interior: floor at y (ground level), walls up `floors*4`.
   * Door is cut on the given side. Adds loot spots and maybe a chest.
   */
  house(x0: number, z0: number, w: number, d: number, y: number, opts: {
    floors?: number;
    wall?: number;
    frame?: number;
    roof?: number;
    floor?: number;
    door?: Facing;
    chestTier?: LootTier | null;
    glass?: boolean;
    lamp?: boolean;
  } = {}) {
    const floors = opts.floors ?? 1;
    const wall = opts.wall ?? B.OAK_PLANKS;
    const frame = opts.frame ?? B.OAK_LOG;
    const roof = opts.roof ?? B.ROOF;
    const floorB = opts.floor ?? B.SPRUCE_PLANKS;
    const door = opts.door ?? 's';
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const H = floors * 4;
    // foundation
    this.fill(x0, y - 3, z0, x1, y - 1, z1, B.COBBLE);
    this.fill(x0, y - 1, z0, x1, y - 1, z1, floorB);
    this.clear(x0, y, z0, x1, y + H + Math.ceil(Math.min(w, d) / 2) + 1, z1);
    // walls
    this.walls(x0, y, z0, x1, y + H - 1, z1, wall);
    // corner posts
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) this.fill(cx, y - 1, cz, cx, y + H - 1, cz, frame);
    // floors between storeys
    for (let f = 1; f < floors; f++) {
      const fy = y + f * 4 - 1;
      this.fill(x0 + 1, fy, z0 + 1, x1 - 1, fy, z1 - 1, floorB);
      this.fill(x0, fy, z0, x1, fy, z0, frame);
      this.fill(x0, fy, z1, x1, fy, z1, frame);
      this.fill(x0, fy, z0, x0, fy, z1, frame);
      this.fill(x1, fy, z0, x1, fy, z1, frame);
      // stair opening + steps along the -x wall interior
      const sx = x0 + 1;
      const sz0 = z0 + 1;
      for (let s = 0; s < 4; s++) {
        this.set(sx, y + (f - 1) * 4 + s, sz0 + s, B.OAK_PLANKS);
        this.fill(sx, y + (f - 1) * 4 + s, sz0 + s + 1, sx, y + (f - 1) * 4 + s, sz0 + s + 1, B.AIR);
      }
      this.fill(sx, fy, sz0, sx + 1, fy, sz0 + 4, B.AIR);
      this.set(sx, fy, sz0 + 3, B.OAK_PLANKS);
    }
    // ceiling
    this.fill(x0, y + H - 1, z0, x1, y + H - 1, z1, wall);
    this.fill(x0, y + H - 1, z0, x1, y + H - 1, z0, frame);
    this.fill(x0, y + H - 1, z1, x1, y + H - 1, z1, frame);
    // windows
    const win = opts.glass === false ? B.AIR : this.glass;
    for (let f = 0; f < floors; f++) {
      const wy = y + f * 4 + 1;
      for (let x = x0 + 2; x <= x1 - 2; x += 3) {
        this.set(x, wy, z0, win);
        this.set(x, wy, z1, win);
        if (w > 6) {
          this.set(x, wy + 1, z0, win);
          this.set(x, wy + 1, z1, win);
        }
      }
      for (let z = z0 + 2; z <= z1 - 2; z += 3) {
        this.set(x0, wy, z, win);
        this.set(x1, wy, z, win);
      }
    }
    // door (2 high, 1 or 2 wide)
    const mx = Math.floor((x0 + x1) / 2);
    const mz = Math.floor((z0 + z1) / 2);
    const dw = w >= 7 ? 1 : 0;
    if (door === 's') this.clear(mx, y, z1, mx + dw, y + 1, z1);
    if (door === 'n') this.clear(mx, y, z0, mx + dw, y + 1, z0);
    if (door === 'e') this.clear(x1, y, mz, x1, y + 1, mz + dw);
    if (door === 'w') this.clear(x0, y, mz, x0, y + 1, mz + dw);
    // second door on opposite side for bigger houses
    if (w * d >= 50) {
      if (door === 's' || door === 'n') this.clear(x1, y, mz, x1, y + 1, mz);
      else this.clear(mx, y, z0, mx, y + 1, z0);
    }
    // roof: stepped gable along longer axis
    const ry = y + H;
    if (w >= d) {
      const half = Math.ceil(d / 2);
      for (let i = 0; i <= half; i++) {
        this.fill(x0 - 1, ry + i, z0 - 1 + i, x1 + 1, ry + i, z0 - 1 + i, roof);
        this.fill(x0 - 1, ry + i, z1 + 1 - i, x1 + 1, ry + i, z1 + 1 - i, roof);
        if (z0 + i <= z1 - i) {
          this.fill(x0, ry + i, z0 + i, x0, ry + i, z1 - i, wall);
          this.fill(x1, ry + i, z0 + i, x1, ry + i, z1 - i, wall);
        }
      }
    } else {
      const half = Math.ceil(w / 2);
      for (let i = 0; i <= half; i++) {
        this.fill(x0 - 1 + i, ry + i, z0 - 1, x0 - 1 + i, ry + i, z1 + 1, roof);
        this.fill(x1 + 1 - i, ry + i, z0 - 1, x1 + 1 - i, ry + i, z1 + 1, roof);
        if (x0 + i <= x1 - i) {
          this.fill(x0 + i, ry + i, z0, x1 - i, ry + i, z0, wall);
          this.fill(x0 + i, ry + i, z1, x1 - i, ry + i, z1, wall);
        }
      }
    }
    // furniture + loot
    if (opts.lamp !== false) this.lamp(mx, y + 2, mz === z0 + 1 ? mz + 1 : mz);
    this.set(mx, y + 3, mz, B.LAMP);
    this.set(mx, y + 2, mz, B.AIR);
    this.set(x1 - 1, y, z0 + 1, B.BOOKSHELF);
    this.set(x1 - 1, y + 1, z0 + 1, B.BOOKSHELF);
    this.table(x0 + 2, y, z1 - 2);
    if (w >= 6 && d >= 6) this.bed(x1 - 2, y, z1 - 2, 'x');
    this.loot(x0 + 2, y, mz, 'common');
    if (floors > 1) this.loot(x1 - 2, y + 4, mz, 'common');
    if (opts.chestTier !== null) {
      const tier = opts.chestTier ?? (this.rng.chance(0.25) ? 'rare' : 'common');
      if (this.rng.chance(0.7)) this.chest(x1 - 1, y + (floors > 1 ? 4 : 0), z1 - 1, tier);
    }
  }

  /** Concrete/industrial building with flat roof and roof access. */
  bunkerBuilding(x0: number, z0: number, w: number, d: number, y: number, floors = 1, opts: { wall?: number; floor?: number; door?: Facing; roofAccess?: boolean } = {}) {
    const wall = opts.wall ?? B.CONCRETE;
    const floorB = opts.floor ?? B.TILE_FLOOR;
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const H = floors * 4;
    this.fill(x0, y - 3, z0, x1, y - 1, z1, B.STONE);
    this.fill(x0, y - 1, z0, x1, y - 1, z1, floorB);
    this.clear(x0, y, z0, x1, y + H + 1, z1);
    this.walls(x0, y, z0, x1, y + H - 1, z1, wall);
    this.fill(x0, y + H, z0, x1, y + H, z1, wall);
    // parapet
    this.walls(x0, y + H + 1, z0, x1, y + H + 1, z1, wall);
    for (let f = 1; f < floors; f++) {
      const fy = y + f * 4 - 1;
      this.fill(x0 + 1, fy, z0 + 1, x1 - 1, fy, z1 - 1, floorB);
      // stairs
      for (let s = 0; s < 4; s++) {
        this.set(x0 + 1 + s, y + (f - 1) * 4 + s, z0 + 1, B.METAL_PLATE);
        this.set(x0 + 1 + s, y + (f - 1) * 4 + s, z0 + 2, B.METAL_PLATE);
      }
      this.fill(x0 + 1, fy, z0 + 1, x0 + 5, fy, z0 + 2, B.AIR);
      this.fill(x0 + 4, fy, z0 + 1, x0 + 4, fy, z0 + 2, B.METAL_PLATE);
    }
    // windows: tinted strips
    for (let f = 0; f < floors; f++) {
      const wy = y + f * 4 + 1;
      for (let x = x0 + 2; x <= x1 - 2; x++) if ((x - x0) % 4 !== 0) {
        this.set(x, wy, z0, B.GLASS_PANE_DARK);
        this.set(x, wy, z1, B.GLASS_PANE_DARK);
      }
      for (let z = z0 + 2; z <= z1 - 2; z++) if ((z - z0) % 4 !== 0) {
        this.set(x0, wy, z, B.GLASS_PANE_DARK);
        this.set(x1, wy, z, B.GLASS_PANE_DARK);
      }
      // ceiling lights
      for (let x = x0 + 3; x < x1 - 1; x += 5) for (let z = z0 + 3; z < z1 - 1; z += 5) this.set(x, y + f * 4 + 3, z, B.LIGHT_PANEL);
    }
    const mx = Math.floor((x0 + x1) / 2);
    const mz = Math.floor((z0 + z1) / 2);
    const door = opts.door ?? 's';
    if (door === 's') this.clear(mx, y, z1, mx + 1, y + 1, z1);
    if (door === 'n') this.clear(mx, y, z0, mx + 1, y + 1, z0);
    if (door === 'e') this.clear(x1, y, mz, x1, y + 1, mz + 1);
    if (door === 'w') this.clear(x0, y, mz, x0, y + 1, mz + 1);
    // opposite side door
    if (door === 's' || door === 'n') this.clear(door === 's' ? mx : mx, y, door === 's' ? z0 : z1, mx, y + 1, door === 's' ? z0 : z1);
    else this.clear(door === 'e' ? x0 : x1, y, mz, door === 'e' ? x0 : x1, y + 1, mz);
    if (opts.roofAccess !== false) {
      // ladder-stairs to roof in a corner
      const top = y + H;
      const sx = x1 - 1;
      for (let s = 0; s < 4; s++) {
        this.set(sx, top - 4 + s, z1 - 1 - s, B.METAL_PLATE);
      }
      this.fill(sx, top, z1 - 4, sx, top, z1 - 2, B.AIR);
    }
    // interior props
    this.set(x0 + 1, y, z1 - 1, B.CRATE);
    this.set(x0 + 2, y, z1 - 1, B.CRATE);
    this.set(x0 + 1, y + 1, z1 - 1, B.CRATE);
    this.set(x1 - 1, y, z0 + 1, B.SERVER);
    this.set(x1 - 1, y + 1, z0 + 1, B.SERVER);
    this.loot(mx, y, mz, 'common');
    this.loot(x0 + 2, y, z0 + 4, 'rare');
    if (floors > 1) {
      this.loot(mx, y + 4, mz, 'rare');
      this.chest(x1 - 2, y + 4, z1 - 1, 'rare');
    } else this.chest(x1 - 2, y, z1 - 1, 'common');
  }

  /** Open wooden watchtower with stairs. */
  watchtower(x: number, z: number, y: number, h = 12) {
    const post = B.SPRUCE_LOG;
    for (const [dx, dz] of [[0, 0], [4, 0], [0, 4], [4, 4]]) this.fill(x + dx, y, z + dz, x + dx, y + h, z + dz, post);
    // spiral stairs inside footprint
    const path = [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]];
    for (let i = 0; i < h; i++) {
      const [px, pz] = path[i % path.length];
      this.set(x + px, y + i, z + pz, B.SPRUCE_PLANKS);
    }
    // platform
    this.fill(x - 1, y + h, z - 1, x + 5, y + h, z + 5, B.SPRUCE_PLANKS);
    const [lx, lz] = path[(h - 1) % path.length];
    this.set(x + lx, y + h, z + lz, B.AIR);
    const [nx, nz] = path[h % path.length];
    this.set(x + nx, y + h, z + nz, B.AIR);
    // railing
    for (let i = -1; i <= 5; i++) {
      this.set(x + i, y + h + 1, z - 1, B.SPRUCE_PLANKS);
      this.set(x + i, y + h + 1, z + 5, B.SPRUCE_PLANKS);
      this.set(x - 1, y + h + 1, z + i, B.SPRUCE_PLANKS);
      this.set(x + 5, y + h + 1, z + i, B.SPRUCE_PLANKS);
    }
    // roof
    this.fill(x - 1, y + h + 4, z - 1, x + 5, y + h + 4, z + 5, B.DARK_PLANKS);
    this.fill(x, y + h + 5, z, x + 4, y + h + 5, z + 4, B.DARK_PLANKS);
    for (const [dx, dz] of [[-1, -1], [5, -1], [-1, 5], [5, 5]]) this.fill(x + dx, y + h + 1, z + dz, x + dx, y + h + 3, z + dz, post);
    this.lamp(x + 2, y + h + 3, z + 2);
    this.loot(x + 2, y + h + 1, z + 2, 'rare');
  }

  /** Simple flat bridge. */
  bridge(x0: number, z0: number, x1: number, z1: number, y: number, deck = B.SPRUCE_PLANKS as number, rail = B.SPRUCE_LOG as number) {
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    this.fill(x0, y, z0, x1, y, z1, deck);
    this.clear(x0, y + 1, z0, x1, y + 4, z1);
    if (alongX) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if ((x - x0) % 3 === 0) {
          this.set(x, y + 1, Math.min(z0, z1), rail);
          this.set(x, y + 1, Math.max(z0, z1), rail);
        }
      }
    } else {
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
        if ((z - z0) % 3 === 0) {
          this.set(Math.min(x0, x1), y + 1, z, rail);
          this.set(Math.max(x0, x1), y + 1, z, rail);
        }
      }
    }
  }

  /** Shipping container (hollow, open at one end). */
  container(x: number, z: number, y: number, alongX: boolean, color: number, open = true) {
    const L = 7;
    const x1 = alongX ? x + L - 1 : x + 2;
    const z1 = alongX ? z + 2 : z + L - 1;
    this.fill(x, y, z, x1, y + 2, z1, color);
    this.clear(alongX ? x + 1 : x + 1, y, alongX ? z + 1 : z + 1, alongX ? x1 - (open ? 0 : 1) : x1 - 1, y + 1, alongX ? z1 - 1 : z1 - (open ? 0 : 1));
    if (open) {
      if (alongX) this.clear(x1, y, z + 1, x1, y + 1, z + 1);
      else this.clear(x + 1, y, z1, x + 1, y + 1, z1);
    }
    this.loot(alongX ? x + 3 : x + 1, y, alongX ? z + 1 : z + 3, this.rng.chance(0.3) ? 'rare' : 'common');
  }

  /** Low wall of sandbags / cover. */
  coverWall(x0: number, z0: number, x1: number, z1: number, y: number, id = B.COBBLE as number, h = 1) {
    this.fill(x0, y, z0, x1, y + h - 1, z1, id);
    this.coverHints.push({ x: (x0 + x1) / 2, y, z: (z0 + z1) / 2 });
  }

  landmark(name: string, x: number, z: number, major = true) {
    this.landmarks.push({ name, x, z, major });
  }

  decorateGround(x0: number, z0: number, x1: number, z1: number, density = 0.25, flowers = 0.04) {
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const y = this.surface(x, z);
        if (this.get(x, y, z) !== B.GRASS) continue;
        if (this.get(x, y + 1, z) !== B.AIR) continue;
        const r = this.rng.next();
        if (r < flowers) this.set(x, y + 1, z, this.rng.chance(0.5) ? B.FLOWER_RED : B.FLOWER_YELLOW);
        else if (r < density) this.set(x, y + 1, z, this.rng.chance(0.85) ? B.TALL_GRASS : B.FERN);
      }
  }
}
