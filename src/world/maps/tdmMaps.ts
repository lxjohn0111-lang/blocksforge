// Hand-designed Team Deathmatch arenas. Each is mirror-symmetric for balance
// with three lanes, elevated positions and protected spawn courtyards.

import { B } from '../blocks';
import { VoxelWorld } from '../world';
import { MapBuilder, type MapData, type SpawnPoint } from './builder';
import { hash2 } from '../../core/rng';

export interface TDMMapInfo {
  id: string;
  name: string;
  blurb: string;
  time: string;
  build: () => MapData;
}

function baseTerrain(mb: MapBuilder, W: number, D: number, G: number, top: number, under: number, edge = 5, hill = 2.2, bumps = 0) {
  const w = mb.w;
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      const d = Math.min(x, z, W - 1 - x, D - 1 - z);
      let h = G;
      if (d < edge) h += Math.round((edge - d) * hill + mb.noise.noise2(x * 0.2, z * 0.2) * 1.5);
      if (bumps > 0 && d >= edge) h += Math.round(Math.max(0, mb.noise.noise2(x * 0.07, z * 0.07)) * bumps);
      const base = (z * W + x) * w.sy;
      for (let y = 0; y <= h && y < w.sy; y++) {
        let id: number = B.STONE;
        if (y === 0) id = B.BEDROCK;
        else if (y === h) id = top;
        else if (y > h - 3) id = under;
        w.blocks[base + y] = id;
      }
    }
}

function spawnsIn(x0: number, z0: number, x1: number, z1: number, y: number, team: number, yaw: number, n = 6): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * (i % 2 === 0 ? 0.3 : 0.7);
    const z = z0 + (z1 - z0) * t;
    out.push({ x: Math.floor(x) + 0.5, y, z: Math.floor(z) + 0.5, yaw, team });
  }
  return out;
}

function mirrorX(W: number, x: number) {
  return W - 1 - x;
}

function stall(mb: MapBuilder, x: number, z: number, y: number, color: number) {
  for (const [dx, dz] of [[0, 0], [3, 0], [0, 2], [3, 2]]) mb.fill(x + dx, y, z + dz, x + dx, y + 2, z + dz, B.SPRUCE_LOG);
  mb.fill(x, y + 3, z, x + 3, y + 3, z + 2, color);
  mb.fill(x + 1, y, z, x + 2, y, z, B.CRATE);
  mb.coverHints.push({ x: x + 1.5, y, z: z + 1 });
}

// ------------------------------------------------------------------ HAMLET
export function buildHamlet(): MapData {
  const W = 104, D = 72, H = 48, G = 10;
  const w = new VoxelWorld(W, H, D);
  w.seaLevel = 4;
  w.buildCeiling = 0;
  const mb = new MapBuilder(w, 701);
  mb.glass = B.AIR;
  baseTerrain(mb, W, D, G, B.GRASS, B.DIRT, 5, 2.4);
  const Y = G + 1;
  // perimeter hedge + trees
  for (let x = 2; x < W - 2; x += 4) {
    for (const z of [2, D - 3]) if (hash2(x, z, 3) > 0.3) mb.oak(x, mb.surface(x, z) + 1, z, false);
  }
  for (let z = 2; z < D - 2; z += 5) for (const x of [2, W - 3]) if (hash2(x, z, 4) > 0.3) mb.spruce(x, mb.surface(x, z) + 1, z);

  const both = (f: (mx: (x: number) => number, flip: boolean) => void) => {
    f((x) => x, false);
    f((x) => mirrorX(W, x), true);
  };
  // spawn courtyards
  both((mx, flip) => {
    const x0 = Math.min(mx(6), mx(17)), x1 = Math.max(mx(6), mx(17));
    mb.fill(x0, G, 27, x1, G, 44, B.STONE_BRICKS);
    mb.walls(x0, Y, 27, x1, Y + 2, 44, B.COBBLE);
    // exits
    const ex = flip ? x0 : x1;
    mb.clear(ex, Y, 33, ex, Y + 2, 38);
    mb.clear(mx(11), Y, 27, mx(12), Y + 2, 27);
    mb.clear(mx(11), Y, 44, mx(12), Y + 2, 44);
    // barracks shelter
    const bx = Math.min(mx(7), mx(10));
    mb.fill(bx, Y, 29, bx + 3, Y + 3, 29, B.DARK_PLANKS);
    mb.fill(bx, Y + 3, 29, bx + 3, Y + 3, 33, B.WOOL_WHITE);
    mb.lampPost(mx(15), Y, 29);
    mb.lampPost(mx(15), Y, 42);
    mb.set(mx(8), Y, 41, B.CRATE);
    mb.set(mx(9), Y, 41, B.CRATE);
    mb.set(mx(8), Y + 1, 41, B.CRATE);
    // team banner blocks
    mb.fill(mx(6), Y + 3, 34, mx(6), Y + 5, 37, flip ? B.WOOL_RED : B.WOOL_BLUE);
  });
  // north street
  mb.fill(16, G, 13, W - 17, G, 17, B.PATH);
  const houses: [number, number, number, number, number, 'n' | 's', number][] = [
    [20, 3, 8, 7, 1, 's', B.OAK_PLANKS],
    [30, 2, 7, 8, 2, 's', B.SPRUCE_PLANKS],
    [40, 3, 7, 7, 1, 's', B.BRICKS],
    [22, 20, 7, 6, 1, 'n', B.BIRCH_LOG],
  ];
  for (const [x, z, ww, dd, fl, door, wall] of houses) {
    mb.house(x, z, ww, dd, Y, { floors: fl, door, wall, glass: false, chestTier: null });
    const mx0 = mirrorX(W, x + ww - 1);
    mb.house(mx0, z, ww, dd, Y, { floors: fl, door, wall, glass: false, chestTier: null });
  }
  // plaza
  mb.fill(34, G, 27, W - 35, G, 45, B.COBBLE);
  for (let x = 34; x <= W - 35; x++) for (let z = 27; z <= 45; z++) if ((x * 3 + z) % 5 === 0) mb.set(x, G, z, B.STONE_BRICKS);
  // bell tower in the middle (4x4)
  const tx = 50, tz = 34, TH = 13;
  mb.walls(tx, Y, tz, tx + 3, Y + TH, tz + 3, B.STONE_BRICKS);
  mb.clear(tx + 1, Y, tz, tx + 2, Y + 1, tz); // north door
  mb.clear(tx + 1, Y, tz + 3, tx + 2, Y + 1, tz + 3); // south door
  const path = [[1, 1], [2, 1], [2, 2], [1, 2]];
  for (let i = 0; i < TH - 1; i++) {
    const [px, pz] = path[i % 4];
    mb.set(tx + px, Y + i, tz + pz, B.STONE_BRICKS);
    if (i > 1) mb.clear(tx + path[(i + 1) % 4][0], Y + i, tz + path[(i + 1) % 4][1], tx + path[(i + 1) % 4][0], Y + i + 1, tz + path[(i + 1) % 4][1]);
  }
  mb.fill(tx, Y + TH, tz, tx + 3, Y + TH, tz + 3, B.SPRUCE_PLANKS);
  mb.set(tx + path[(TH - 1) % 4][0], Y + TH, tz + path[(TH - 1) % 4][1], B.AIR);
  mb.set(tx + path[TH % 4][0], Y + TH, tz + path[TH % 4][1], B.AIR);
  for (const [ox, oz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) mb.fill(tx + ox, Y + TH + 1, tz + oz, tx + ox, Y + TH + 3, tz + oz, B.STONE_BRICKS);
  mb.fill(tx - 1, Y + TH + 4, tz - 1, tx + 4, Y + TH + 4, tz + 4, B.ROOF);
  mb.fill(tx, Y + TH + 5, tz, tx + 3, Y + TH + 5, tz + 3, B.ROOF);
  mb.set(tx + 1, Y + TH + 3, tz + 1, B.LAMP);
  // parapet around the top, low so you can shoot over while crouched
  for (let i = 0; i <= 3; i++) {
    mb.set(tx + i, Y + TH + 1, tz, B.STONE_BRICKS);
    mb.set(tx + i, Y + TH + 1, tz + 3, B.STONE_BRICKS);
  }
  mb.clear(tx + 1, Y + TH + 1, tz, tx + 2, Y + TH + 1, tz);
  // stalls & cover in plaza (mirrored)
  both((mx) => {
    stall(mb, Math.min(mx(38), mx(41)), 29, Y, B.WOOL_RED);
    stall(mb, Math.min(mx(38), mx(41)), 41, Y, B.WOOL_BLUE);
    mb.coverWall(Math.min(mx(45), mx(46)), 31, Math.max(mx(45), mx(46)), 31, Y, B.HAY, 1);
    mb.coverWall(Math.min(mx(45), mx(46)), 41, Math.max(mx(45), mx(46)), 41, Y, B.HAY, 1);
    mb.lampPost(mx(35), Y, 28);
    mb.lampPost(mx(35), Y, 44);
    // field cover between spawn and plaza
    mb.coverWall(Math.min(mx(25), mx(27)), 31, Math.max(mx(25), mx(27)), 31, Y, B.MOSSY_COBBLE, 2);
    mb.coverWall(Math.min(mx(23), mx(23)), 39, Math.max(mx(23), mx(24)), 40, Y, B.HAY, 1);
    mb.set(mx(29), Y, 36, B.HAY);
    mb.set(mx(29), Y, 37, B.HAY);
    mb.set(mx(29), Y + 1, 36, B.HAY);
    mb.fill(Math.min(mx(30), mx(32)), Y, 26, Math.max(mx(30), mx(32)), Y, 26, B.SPRUCE_PLANKS);
  });
  // well at plaza south
  mb.walls(50, Y, 42, 53, Y, 44, B.COBBLE);
  mb.fill(51, G - 2, 43, 52, G, 43, B.WATER);
  // stream with bridges
  for (let x = 12; x < W - 12; x++)
    for (let z = 53; z <= 58; z++) {
      const deep = z >= 54 && z <= 57;
      const y0 = deep ? G - 2 : G - 1;
      mb.clear(x, y0 + 1, z, x, G + 2, z);
      for (let y = y0 + 1; y <= G - 1; y++) mb.set(x, y, z, B.WATER);
      mb.set(x, y0, z, deep ? (hash2(x, z, 9) > 0.5 ? B.GRAVEL : B.SAND) : B.SAND);
    }
  both((mx) => {
    const bx0 = Math.min(mx(30), mx(33)), bx1 = Math.max(mx(30), mx(33));
    mb.bridge(bx0, 52, bx1, 59, G, B.SPRUCE_PLANKS, B.SPRUCE_LOG);
  });
  // stepping stones in the middle
  for (let z = 53; z <= 58; z += 2) mb.set(51 + (z % 4 === 1 ? 1 : 0), G, z, B.COBBLE);
  // south orchard + mill
  mb.house(46, 61, 12, 7, Y, { floors: 2, door: 'n', wall: B.STONE_BRICKS, frame: B.DARK_PLANKS, glass: false, chestTier: null });
  both((mx) => {
    for (const [x, z] of [[20, 62], [26, 66], [33, 61], [38, 66], [17, 48], [40, 49]]) {
      const xx = mx(x);
      mb.oak(xx, mb.surface(xx, z) + 1, z, false);
    }
    mb.coverWall(Math.min(mx(24), mx(27)), 49, Math.max(mx(24), mx(27)), 49, Y, B.OAK_LOG, 1);
  });
  mb.decorateGround(6, 4, W - 7, D - 5, 0.14, 0.05);
  w.recomputeHeights();
  const spawns = [...spawnsIn(7, 29, 15, 42, Y, 0, -Math.PI / 2), ...spawnsIn(mirrorX(W, 15), 29, mirrorX(W, 7), 42, Y, 1, Math.PI / 2)];
  const lanesA = [
    [{ x: 18, z: 15 }, { x: 35, z: 15 }, { x: 52, z: 15 }, { x: 68, z: 15 }, { x: 86, z: 15 }],
    [{ x: 18, z: 36 }, { x: 36, z: 37 }, { x: 52, z: 39 }, { x: 68, z: 37 }, { x: 86, z: 36 }],
    [{ x: 18, z: 48 }, { x: 31, z: 55 }, { x: 52, z: 64 }, { x: 72, z: 55 }, { x: 86, z: 48 }],
  ];
  return {
    world: w, name: 'Hamlet', lootSpots: [], chests: [], landmarks: [{ name: 'Bell Tower', x: 52, z: 36, major: true }, { name: 'Mill', x: 52, z: 64, major: false }, { name: 'High Street', x: 52, z: 15, major: false }],
    spawns, dropTargets: [], seaLevel: 4, coverHints: mb.coverHints,
    preset: { time: 18.15, weather: 'clear', timeScale: 0 },
    bounds: { x0: 4, z0: 4, x1: W - 4, z1: D - 4 },
    tdm: {
      spawnZones: [{ team: 0, x0: 4, z0: 25, x1: 18, z1: 46 }, { team: 1, x0: mirrorX(W, 18), z0: 25, x1: mirrorX(W, 4), z1: 46 }],
      lanes: lanesA,
      perches: [{ x: 51.5, y: Y + TH + 1, z: 35.5 }, { x: 33, y: Y + 4, z: 5 }, { x: mirrorX(W, 33), y: Y + 4, z: 5 }],
    },
  };
}

// ------------------------------------------------------------------ QUARRY
export function buildQuarry(): MapData {
  const W = 96, D = 96, H = 56, G = 24;
  const w = new VoxelWorld(W, H, D);
  w.seaLevel = 4;
  w.buildCeiling = 0;
  const mb = new MapBuilder(w, 909);
  mb.glass = B.AIR;
  baseTerrain(mb, W, D, G, B.GRASS, B.DIRT, 6, 2.6, 0);
  const Y = G + 1;
  const cx = 47.5, cz = 47.5;
  // terraced pit
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      const r = Math.hypot(x - cx, (z - cz) * 1.0) + mb.noise.noise2(x * 0.15, z * 0.15) * 1.2;
      let floor = -1;
      if (r < 9) floor = G - 12;
      else if (r < 16) floor = G - 8;
      else if (r < 23) floor = G - 4;
      if (floor < 0) continue;
      for (let y = floor + 1; y <= G; y++) mb.set(x, y, z, B.AIR);
      mb.set(x, floor, z, hash2(x, z, 3) > 0.75 ? B.GRAVEL : B.STONE);
      // terrace lips get cobble
      for (let y = floor - 2; y < floor; y++) mb.set(x, y, z, B.STONE);
    }
  // ores in the pit walls
  for (let x = 20; x < 76; x++)
    for (let z = 20; z < 76; z++)
      for (let y = G - 12; y <= G; y++) {
        if (mb.get(x, y, z) !== B.STONE) continue;
        const exposed = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => mb.get(x + dx, y, z + dz) === B.AIR);
        if (!exposed) continue;
        const r = hash2(x * 5 + y, z, 77);
        if (r < 0.05) mb.set(x, y, z, B.COAL_ORE);
        else if (r < 0.07) mb.set(x, y, z, B.IRON_ORE);
        else if (r < 0.075) mb.set(x, y, z, B.GOLD_ORE);
      }
  // ramps between terraces (4 cardinal, stairs of single blocks)
  const ramp = (sx: number, sz: number, dx: number, dz: number, fromY: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      const x = sx + dx * i, z = sz + dz * i;
      for (let k = -1; k <= 1; k++) {
        const xx = x + (dz !== 0 ? k : 0), zz = z + (dx !== 0 ? k : 0);
        mb.fill(xx, fromY - i - 3, zz, xx, fromY - i, zz, B.COBBLE);
        mb.clear(xx, fromY - i + 1, zz, xx, fromY - i + 4, zz);
      }
    }
  };
  ramp(47, 25, 0, 1, G, 4);
  ramp(47, 70, 0, -1, G, 4);
  ramp(25, 48, 1, 0, G, 4);
  ramp(70, 48, -1, 0, G, 4);
  ramp(47, 32, 0, 1, G - 4, 4);
  ramp(47, 63, 0, -1, G - 4, 4);
  ramp(32, 48, 1, 0, G - 4, 4);
  ramp(63, 48, -1, 0, G - 4, 4);
  ramp(47, 39, 0, 1, G - 8, 4);
  ramp(47, 56, 0, -1, G - 8, 4);
  // puddle at bottom
  mb.fill(44, G - 12, 44, 51, G - 12, 51, B.WATER);
  mb.fill(44, G - 13, 44, 51, G - 13, 51, B.GRAVEL);
  // gantry bridge west-east at deck G, plus a central tower
  mb.fill(18, G, 46, 77, G, 49, B.METAL_PLATE);
  for (let x = 18; x <= 77; x++) {
    mb.set(x, G + 1, 46, x % 3 === 0 ? B.METAL_PLATE : B.IRON_BARS);
    mb.set(x, G + 1, 49, x % 3 === 0 ? B.METAL_PLATE : B.IRON_BARS);
  }
  for (let x = 22; x <= 74; x += 8) for (const z of [46, 49]) mb.fill(x, G - 12, z, x, G - 1, z, B.HAZARD);
  // central crane tower 4x4 rising from the gantry
  const tx = 46, tz = 46;
  for (let y = G + 1; y < G + 13; y++)
    for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) mb.set(tx + dx, y, tz + dz, B.HAZARD);
  const tpath = [[1, 1], [2, 1], [2, 2], [1, 2]];
  for (let i = 0; i < 11; i++) {
    const [px, pz] = tpath[i % 4];
    mb.set(tx + px, G + 1 + i, tz + pz, B.METAL_PLATE);
  }
  mb.fill(tx - 1, G + 12, tz - 1, tx + 4, G + 12, tz + 4, B.METAL_PLATE);
  mb.set(tx + tpath[11 % 4][0], G + 12, tz + tpath[11 % 4][1], B.AIR);
  mb.set(tx + tpath[10 % 4][0], G + 12, tz + tpath[10 % 4][1], B.AIR);
  for (let i = -1; i <= 4; i++) {
    mb.set(tx + i, G + 13, tz - 1, B.IRON_BARS);
    mb.set(tx + i, G + 13, tz + 4, B.IRON_BARS);
  }
  mb.fill(tx + 4, G + 15, tz + 1, tx + 18, G + 15, tz + 2, B.HAZARD);
  mb.fill(tx + 1, G + 13, tz + 1, tx + 2, G + 15, tz + 2, B.HAZARD);
  mb.set(tx + 1, G + 16, tz + 1, B.LAMP);
  const both = (f: (mz: (z: number) => number, flip: boolean) => void) => {
    f((z) => z, false);
    f((z) => D - 1 - z, true);
  };
  both((mz, flip) => {
    // spawn compound
    const z0 = Math.min(mz(3), mz(13)), z1 = Math.max(mz(3), mz(13));
    mb.fill(34, G, z0, 61, G, z1, B.CONCRETE);
    mb.walls(34, Y, z0, 61, Y + 2, z1, B.METAL_PLATE);
    const ez = flip ? z0 : z1;
    mb.clear(44, Y, ez, 51, Y + 2, ez);
    mb.clear(34, Y, Math.min(mz(7), mz(9)), 34, Y + 2, Math.max(mz(7), mz(9)));
    mb.clear(61, Y, Math.min(mz(7), mz(9)), 61, Y + 2, Math.max(mz(7), mz(9)));
    mb.fill(36, Y, Math.min(mz(5), mz(6)), 38, Y + 1, Math.max(mz(5), mz(6)), B.CRATE);
    mb.lampPost(40, Y, mz(4));
    mb.lampPost(55, Y, mz(4));
    mb.fill(47, Y + 3, z0, 48, Y + 4, z0, flip ? B.WOOL_RED : B.WOOL_BLUE);
    // warehouses (open-ended) on the west & east flanks
    const wz0 = Math.min(mz(18), mz(34)), wz1 = Math.max(mz(18), mz(34));
    for (const [x0, x1] of [[6, 18], [77, 89]]) {
      mb.fill(x0, G, wz0, x1, G, wz1, B.CONCRETE);
      mb.walls(x0, Y, wz0, x1, Y + 4, wz1, B.METAL_PLATE);
      mb.fill(x0, Y + 5, wz0, x1, Y + 5, wz1, B.METAL_PLATE);
      mb.clear(x0 + 4, Y, wz0, x1 - 4, Y + 2, wz0);
      mb.clear(x0 + 4, Y, wz1, x1 - 4, Y + 2, wz1);
      mb.clear(x1, Y, wz0 + 6, x1, Y + 2, wz0 + 9);
      mb.clear(x0, Y, wz0 + 6, x0, Y + 2, wz0 + 9);
      for (let x = x0 + 2; x < x1 - 1; x += 4) mb.set(x, Y + 4, Math.floor((wz0 + wz1) / 2), B.LIGHT_PANEL);
      mb.fill(x0 + 2, Y, wz0 + 3, x0 + 3, Y + 1, wz0 + 4, B.CRATE);
      mb.fill(x1 - 3, Y, wz1 - 4, x1 - 2, Y, wz1 - 3, B.CRATE);
      mb.set(Math.floor((x0 + x1) / 2), Y, Math.floor((wz0 + wz1) / 2), B.CRATE);
    }
    // containers along the rim
    mb.container(22, Math.min(mz(16), mz(18)), Y, true, B.TERRACOTTA_RED);
    mb.container(66, Math.min(mz(16), mz(18)), Y, true, B.WOOL_BLUE);
    mb.coverWall(30, mz(21), 33, mz(21), Y, B.CONCRETE, 2);
    mb.coverWall(62, mz(21), 65, mz(21), Y, B.CONCRETE, 2);
    mb.coverWall(45, mz(17), 50, mz(17), Y, B.HAZARD, 1);
  });
  // boulders & trees outside the pit
  for (const [x, z] of [[12, 48], [84, 48], [24, 30], [72, 66], [24, 66], [72, 30]]) mb.boulder(x, mb.surface(x, z) + 1, z, 1.6);
  for (const [x, z] of [[9, 12], [86, 12], [9, 84], [86, 84], [16, 40], [80, 56]]) mb.oak(x, mb.surface(x, z) + 1, z, false);
  mb.decorateGround(6, 6, W - 7, D - 7, 0.1, 0.03);
  w.recomputeHeights();
  const spawns = [...spawnsIn(36, 5, 59, 11, Y, 0, Math.PI), ...spawnsIn(36, D - 12, 59, D - 6, Y, 1, 0)].map((s, i) => ({ ...s, x: 37.5 + (i % 6) * 4, z: s.team === 0 ? 7.5 + (i % 2) * 2 : D - 9.5 - (i % 2) * 2 }));
  return {
    world: w, name: 'Quarry', lootSpots: [], chests: [], landmarks: [{ name: 'Crane', x: 48, z: 48, major: true }, { name: 'West Shed', x: 12, z: 48, major: false }, { name: 'East Shed', x: 83, z: 48, major: false }],
    spawns, dropTargets: [], seaLevel: 4, coverHints: mb.coverHints,
    preset: { time: 12.4, weather: 'clear', timeScale: 0 },
    bounds: { x0: 5, z0: 5, x1: W - 5, z1: D - 5 },
    tdm: {
      spawnZones: [{ team: 0, x0: 33, z0: 2, x1: 62, z1: 14 }, { team: 1, x0: 33, z0: D - 15, x1: 62, z1: D - 3 }],
      lanes: [
        [{ x: 40, z: 15 }, { x: 12, z: 26 }, { x: 12, z: 48 }, { x: 12, z: 70 }, { x: 40, z: 80 }],
        [{ x: 48, z: 15 }, { x: 47, z: 30 }, { x: 48, z: 48 }, { x: 47, z: 66 }, { x: 48, z: 80 }],
        [{ x: 56, z: 15 }, { x: 83, z: 26 }, { x: 83, z: 48 }, { x: 83, z: 70 }, { x: 56, z: 80 }],
      ],
      perches: [{ x: 47.5, y: G + 13, z: 47.5 }],
    },
  };
}

// ------------------------------------------------------------------ FROSTBITE
export function buildFrostbite(): MapData {
  const W = 96, D = 80, H = 48, G = 12;
  const w = new VoxelWorld(W, H, D);
  w.seaLevel = 4;
  w.buildCeiling = 0;
  const mb = new MapBuilder(w, 4242);
  mb.glass = B.GLASS_PANE_DARK;
  baseTerrain(mb, W, D, G, B.SNOW, B.DIRT, 6, 2.5, 2);
  // flatten the playable centre a bit
  for (let x = 6; x < W - 6; x++)
    for (let z = 6; z < D - 6; z++) {
      const h = mb.surface(x, z);
      if (h > G + 1) {
        for (let y = G + 2; y <= h; y++) mb.set(x, y, z, B.AIR);
        mb.set(x, G + 1, z, B.SNOW);
      }
    }
  const Y = G + 1;
  // frozen lake with an island station
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      const r = Math.hypot((x - 47.5) / 1.25, z - 39.5);
      if (r < 13) {
        for (let y = G - 2; y <= G + 2; y++) mb.set(x, y, z, B.AIR);
        mb.set(x, G - 3, z, B.GRAVEL);
        mb.fill(x, G - 2, z, x, G - 1, z, B.WATER);
        mb.set(x, G, z, r < 5.5 ? B.SNOW : B.ICE);
      }
    }
  // radar dome on the island
  for (let x = 42; x <= 53; x++)
    for (let z = 34; z <= 45; z++)
      for (let y = Y; y <= Y + 6; y++) {
        const d = Math.hypot(x - 47.5, (y - Y) * 1.15, z - 39.5);
        if (d > 5.6 && d < 6.6) mb.set(x, y, z, (x + y + z) % 4 === 0 ? B.GLASS_PANE_DARK : B.METAL_PLATE);
      }
  mb.clear(46, Y, 33, 49, Y + 2, 34);
  mb.clear(46, Y, 45, 49, Y + 2, 46);
  mb.clear(41, Y, 38, 42, Y + 2, 41);
  mb.clear(53, Y, 38, 54, Y + 2, 41);
  mb.set(47, Y + 5, 39, B.LAMP);
  mb.fill(46, Y, 39, 49, Y + 1, 40, B.SERVER);
  const both = (f: (mx: (x: number) => number, flip: boolean) => void) => {
    f((x) => x, false);
    f((x) => mirrorX(W, x), true);
  };
  both((mx, flip) => {
    // spawn hut compound
    const x0 = Math.min(mx(5), mx(16)), x1 = Math.max(mx(5), mx(16));
    mb.fill(x0, G, 30, x1, G, 49, B.PATH);
    mb.walls(x0, Y, 30, x1, Y + 2, 49, B.SPRUCE_LOG);
    const ex = flip ? x0 : x1;
    mb.clear(ex, Y, 36, ex, Y + 2, 43);
    mb.clear(mx(10), Y, 30, mx(11), Y + 2, 30);
    mb.clear(mx(10), Y, 49, mx(11), Y + 2, 49);
    mb.fill(Math.min(mx(6), mx(9)), Y + 3, 31, Math.max(mx(6), mx(9)), Y + 3, 48, B.SPRUCE_PLANKS);
    for (const z of [33, 39, 45]) mb.set(mx(8), Y + 2, z, B.LAMP);
    mb.fill(mx(5), Y + 3, 37, mx(5), Y + 5, 42, flip ? B.WOOL_RED : B.WOOL_BLUE);
    // north lane: spruce woods + cabin
    for (const [x, z] of [[20, 12], [26, 18], [31, 10], [36, 20], [24, 26], [40, 12], [18, 22], [33, 26]]) mb.spruce(mx(x), mb.surface(mx(x), z) + 1, z, hash2(x, z, 1) > 0.5);
    mb.house(Math.min(mx(28), mx(35)), 4, 8, 6, Y, { door: 's', wall: B.SPRUCE_PLANKS, frame: B.SPRUCE_LOG, roof: B.DARK_PLANKS, chestTier: null });
    // south labs with a skybridge to the middle
    const lx0 = Math.min(mx(22), mx(35));
    mb.bunkerBuilding(lx0, 56, 14, 10, Y, 2, { door: 'n', wall: B.CONCRETE_WHITE, roofAccess: true });
    // cover on the approach
    mb.coverWall(Math.min(mx(20), mx(21)), 36, Math.max(mx(20), mx(21)), 38, Y, B.SNOW, 1);
    mb.coverWall(Math.min(mx(25), mx(26)), 42, Math.max(mx(25), mx(26)), 44, Y, B.CRATE, 2);
    mb.coverWall(Math.min(mx(30), mx(31)), 32, Math.max(mx(30), mx(31)), 33, Y, B.ICE, 2);
    mb.lampPost(mx(19), Y, 28, 3);
    mb.lampPost(mx(19), Y, 51, 3);
    mb.lampPost(mx(33), Y, 50, 3);
  });
  // skybridge between labs at second floor
  mb.fill(36, Y + 3, 60, W - 37, Y + 3, 62, B.METAL_PLATE);
  for (let x = 36; x <= W - 37; x++) {
    mb.set(x, Y + 4, 60, B.IRON_BARS);
    mb.set(x, Y + 4, 62, B.IRON_BARS);
  }
  for (let x = 40; x <= W - 41; x += 6) mb.fill(x, Y, 61, x, Y + 2, 61, B.METAL_PLATE);
  mb.lampPost(47, Y, 54, 4);
  mb.lampPost(47, Y, 24, 4);
  // ice boulders mid-north
  for (const [x, z] of [[47, 16], [41, 22], [54, 22]]) mb.fill(x, Y, z, x + 1, Y + 1, z + 1, B.ICE);
  w.recomputeHeights();
  const spawns = [...spawnsIn(7, 32, 14, 47, Y, 0, -Math.PI / 2), ...spawnsIn(mirrorX(W, 14), 32, mirrorX(W, 7), 47, Y, 1, Math.PI / 2)];
  return {
    world: w, name: 'Frostbite', lootSpots: [], chests: [], landmarks: [{ name: 'Radar Dome', x: 48, z: 40, major: true }, { name: 'Labs', x: 48, z: 61, major: false }, { name: 'Pinewood', x: 48, z: 16, major: false }],
    spawns, dropTargets: [], seaLevel: 4, coverHints: mb.coverHints,
    preset: { time: 22.6, weather: 'snow', timeScale: 0 },
    bounds: { x0: 5, z0: 5, x1: W - 5, z1: D - 5 },
    tdm: {
      spawnZones: [{ team: 0, x0: 4, z0: 29, x1: 17, z1: 50 }, { team: 1, x0: mirrorX(W, 17), z0: 29, x1: mirrorX(W, 4), z1: 50 }],
      lanes: [
        [{ x: 18, z: 30 }, { x: 28, z: 16 }, { x: 48, z: 16 }, { x: 68, z: 16 }, { x: 78, z: 30 }],
        [{ x: 18, z: 40 }, { x: 34, z: 40 }, { x: 48, z: 32 }, { x: 62, z: 40 }, { x: 78, z: 40 }],
        [{ x: 18, z: 50 }, { x: 30, z: 54 }, { x: 48, z: 61 }, { x: 66, z: 54 }, { x: 78, z: 50 }],
      ],
      perches: [{ x: 28, y: Y + 9, z: 60 }, { x: mirrorX(W, 28), y: Y + 9, z: 60 }],
    },
  };
}

export const TDM_MAPS: TDMMapInfo[] = [
  { id: 'hamlet', name: 'Hamlet', blurb: 'Village streets, a bell tower and a sunset stream.', time: 'Sunset', build: buildHamlet },
  { id: 'quarry', name: 'Quarry', blurb: 'Terraced pit with a crane gantry and flanking sheds.', time: 'Noon', build: buildQuarry },
  { id: 'frostbite', name: 'Frostbite', blurb: 'Snowbound outpost around a frozen radar lake.', time: 'Night · Snow', build: buildFrostbite },
];
