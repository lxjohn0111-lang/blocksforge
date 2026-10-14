// "Ashcrown Isle" — the hand-designed Battle Royale map (320 x 320).
//
//   N: Frostspine Ridge (snow peaks) with the Deepvein Mine tunnels
//   NW: Whisperwood forest, Ranger Lookout, Timber Camp
//   NE: Site 7 research facility with an underground lab
//   C: Oakhollow village and farms, Crossroads checkpoint
//   E: Windmere Fields and the windmill farm
//   W: Mirror Lake, Old Lighthouse
//   SW: Dune Flats desert with the Sunken Temple
//   SE: Rustwater Docks
//   The Silvervein river runs from the ridge to the south coast.

import { B } from '../blocks';
import { VoxelWorld } from '../world';
import { MapBuilder, type MapData } from './builder';
import { clamp, smoothstep, lerp } from '../../core/mathx';
import { hash2 } from '../../core/rng';

export const BR_SIZE = 320;
export const BR_HEIGHT = 80;
const SEA = 24;

type P = [number, number];
const RIVER: P[] = [
  [196, 66], [200, 88], [208, 112], [214, 136], [212, 160], [204, 186], [190, 212], [172, 236], [156, 258], [146, 282], [140, 312],
];
const ROADS: P[][] = [
  [[160, 165], [190, 160], [214, 150], [240, 132], [262, 124]], // village -> Site 7
  [[160, 165], [158, 130], [150, 100], [150, 84]], // village -> mine
  [[160, 165], [184, 196], [212, 232], [236, 262]], // village -> docks
  [[160, 165], [128, 160], [100, 150], [62, 152]], // village -> forest camp
  [[160, 165], [140, 200], [112, 226], [92, 238]], // village -> desert
  [[160, 165], [210, 186], [250, 196]], // village -> windmill
];

function segDist(px: number, pz: number, a: P, b: P) {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
  const dx = px - (a[0] + vx * t);
  const dz = pz - (a[1] + vz * t);
  return { d: Math.sqrt(dx * dx + dz * dz), t };
}

function polyDist(px: number, pz: number, poly: P[]) {
  let best = 1e9;
  let along = 0;
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const s = segDist(px, pz, poly[i], poly[i + 1]);
    const len = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    if (s.d < best) {
      best = s.d;
      along = acc + s.t * len;
    }
    acc += len;
  }
  return { d: best, along, total: acc };
}

export function buildBRMap(onProgress?: (f: number, label: string) => void): MapData {
  const w = new VoxelWorld(BR_SIZE, BR_HEIGHT, BR_SIZE);
  w.seaLevel = SEA;
  w.buildCeiling = 74;
  const mb = new MapBuilder(w, 1337);
  const n = mb.noise;
  const N = BR_SIZE;

  // ------------------------------------------------------------ terrain
  const heightMap = new Float32Array(N * N);
  const biome = new Uint8Array(N * N); // 0 grass,1 forest,2 mountain,3 desert,4 beach,5 river,6 lake,7 fields
  const riverW = (along: number, total: number) => lerp(3.2, 7.5, along / total);

  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const dx = (x - 160) / 148;
      const dz = (z - 162) / 148;
      const r = Math.sqrt(dx * dx + dz * dz);
      const coast = n.fbm2(x * 0.011, z * 0.011, 3) * 0.16;
      const island = 1 - smoothstep(0.8 + coast, 0.97 + coast, r);
      let h = 27.5 + n.fbm2(x * 0.011, z * 0.011, 4) * 3.5 + n.fbm2(x * 0.045, z * 0.045, 2) * 1.1;
      let b = 0;
      // east rolling fields
      const fields = smoothstep(220, 250, x) * (1 - smoothstep(235, 250, Math.abs(z - 195) + 200));
      h += fields * Math.max(0, n.noise2(x * 0.03, z * 0.03)) * 3;
      if (fields > 0.5) b = 7;
      // forest: slightly hilly
      const forest = (1 - smoothstep(40, 70, Math.hypot(x - 66, z - 132)));
      h += forest * n.fbm2(x * 0.03, z * 0.03, 2) * 3;
      if (forest > 0.3) b = 1;
      // mountain ridge across the north
      const ridgeZ = 52 + Math.sin(x * 0.028) * 9 + Math.sin(x * 0.071 + 1.3) * 4;
      const md = Math.abs(z - ridgeZ);
      const mMask = (1 - smoothstep(12, 44, md)) * smoothstep(38, 80, x) * (1 - smoothstep(255, 292, x));
      if (mMask > 0) {
        const peaks = 20 + n.ridged2(x * 0.024, z * 0.024, 4) * 26 + n.fbm2(x * 0.06, z * 0.06, 2) * 3;
        h += mMask * peaks;
        if (mMask > 0.35) b = 2;
      }
      // desert
      const desert = 1 - smoothstep(55, 80, Math.hypot(x - 82, z - 250));
      if (desert > 0) {
        const dune = 27.2 + Math.abs(n.noise2(x * 0.025, z * 0.04)) * 3.2;
        h = lerp(h, dune, desert);
        if (desert > 0.4) b = 3;
      }
      // lake
      const lakeD = Math.hypot((x - 64) * 1.0, (z - 190) * 1.25) + n.noise2(x * 0.08, z * 0.08) * 3;
      if (lakeD < 26) {
        const t = smoothstep(26, 12, lakeD);
        h = lerp(h, SEA - 4.5, t);
        if (lakeD < 17) b = 6;
      }
      // river
      const rv = polyDist(x, z, RIVER);
      const rw = riverW(rv.along, rv.total);
      if (rv.d < rw + 7) {
        if (rv.d < rw) {
          h = Math.min(h, SEA - 2.6 - (1 - rv.d / rw) * 1.6);
          b = 5;
        } else {
          const t = (rv.d - rw) / 7;
          h = Math.min(h, lerp(SEA + 0.6, h, smoothstep(0, 1, t)));
        }
      }
      h = lerp(SEA - 9 + n.noise2(x * 0.05, z * 0.05) * 2, h, island);
      if (island < 0.98 && h < SEA + 2.2 && b !== 5) b = 4;
      heightMap[z * N + x] = h;
      biome[z * N + x] = b;
    }

  onProgress?.(0.15, 'Shaping terrain');
  // fill columns
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const h = Math.round(heightMap[z * N + x]);
      const b = biome[z * N + x];
      // slope for rock exposure
      const hx = heightMap[z * N + Math.min(N - 1, x + 1)] - heightMap[z * N + Math.max(0, x - 1)];
      const hz = heightMap[Math.min(N - 1, z + 1) * N + x] - heightMap[Math.max(0, z - 1) * N + x];
      const slope = Math.hypot(hx, hz) * 0.5;
      const base = (z * N + x) * BR_HEIGHT;
      for (let y = 0; y <= Math.min(h, BR_HEIGHT - 1); y++) {
        let id: number = B.STONE;
        const depth = h - y;
        if (y === 0) id = B.BEDROCK;
        else if (b === 3) id = depth < 4 ? B.SAND : depth < 8 ? B.SANDSTONE : B.STONE;
        else if (b === 4) id = depth < 3 ? B.SAND : B.STONE;
        else if (b === 5) id = depth < 2 ? (hash2(x, z, 9) > 0.5 ? B.GRAVEL : B.SAND) : B.STONE;
        else if (b === 6) id = depth < 2 ? (hash2(x, z, 4) > 0.3 ? B.SAND : B.GRAVEL) : B.STONE;
        else if (b === 2 || h > 52) {
          if (h > 60 && depth === 0) id = slope > 1.6 ? B.STONE : B.SNOW;
          else if (h > 57 && depth === 0) id = slope > 1.3 ? B.STONE : B.GRASS_SNOW;
          else if (slope > 1.1 || h > 50) id = B.STONE;
          else id = depth === 0 ? B.GRASS : depth < 3 ? B.DIRT : B.STONE;
        } else {
          id = depth === 0 ? (h <= SEA ? B.SAND : B.GRASS) : depth < 3 + (hash2(x, z, 1) > 0.5 ? 1 : 0) ? B.DIRT : B.STONE;
          if (slope > 2.2 && depth < 2) id = B.STONE;
        }
        w.blocks[base + y] = id;
      }
      for (let y = h + 1; y <= SEA; y++) w.blocks[base + y] = B.WATER;
      // ores visible in mountain faces
      if (b === 2 && h > 38) {
        for (let y = 30; y < h - 1; y++) {
          const r = hash2(x * 7 + y, z * 13 - y, 77);
          if (r < 0.012) w.blocks[base + y] = B.COAL_ORE;
          else if (r < 0.018) w.blocks[base + y] = B.IRON_ORE;
          else if (r < 0.0195) w.blocks[base + y] = B.GOLD_ORE;
        }
      }
    }
  // exposed ore on cliff faces
  for (let z = 1; z < N - 1; z++)
    for (let x = 1; x < N - 1; x++) {
      if (biome[z * N + x] !== 2) continue;
      const h = Math.round(heightMap[z * N + x]);
      for (let y = 32; y < h; y += 1) {
        if (w.getRaw(x, y, z) !== B.STONE) continue;
        const exposed = w.getRaw(x + 1, y, z) === B.AIR || w.getRaw(x - 1, y, z) === B.AIR || w.getRaw(x, y, z + 1) === B.AIR || w.getRaw(x, y, z - 1) === B.AIR;
        if (!exposed) continue;
        const r = hash2(x, z * 3 + y, 101);
        if (r < 0.03) w.setRaw(x, y, z, B.COAL_ORE);
        else if (r < 0.045) w.setRaw(x, y, z, B.IRON_ORE);
        else if (r < 0.05) w.setRaw(x, y, z, B.GOLD_ORE);
        else if (r < 0.052) w.setRaw(x, y, z, B.DIAMOND_ORE);
      }
    }

  onProgress?.(0.3, 'Raising landmarks');
  // ------------------------------------------------------------ roads
  const roadCells = new Uint8Array(N * N);
  for (const road of ROADS)
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 0.5) {
        const px = ax + ((bx - ax) * s) / len;
        const pz = az + ((bz - az) * s) / len;
        for (let ox = -1; ox <= 1; ox++)
          for (let oz = -1; oz <= 1; oz++) {
            const x = Math.round(px + ox);
            const z = Math.round(pz + oz);
            if (x < 0 || z < 0 || x >= N || z >= N) continue;
            roadCells[z * N + x] = 1;
          }
      }
    }

  // ------------------------------------------------------------ POIs
  buildVillage(mb);
  buildFacility(mb);
  buildMine(mb, heightMap);
  buildForestPOIs(mb);
  buildDesert(mb);
  buildDocks(mb);
  buildWindmill(mb);
  buildCheckpoint(mb);
  buildLighthouse(mb);
  buildBridges(mb);
  onProgress?.(0.45, 'Planting forests');

  // paint roads after flattening
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      if (!roadCells[z * N + x]) continue;
      const y = mb.surface(x, z);
      const id = w.getRaw(x, y, z);
      if (id === B.GRASS || id === B.DIRT || id === B.SAND || id === B.GRASS_SNOW) {
        w.setRaw(x, y, z, B.PATH);
        const above = w.getRaw(x, y + 1, z);
        if (above === B.TALL_GRASS || above === B.FERN || above === B.FLOWER_RED || above === B.FLOWER_YELLOW) w.setRaw(x, y + 1, z, B.AIR);
      }
    }

  // ------------------------------------------------------------ vegetation
  const rng = mb.rng;
  const occupied = (x: number, z: number, r: number) => {
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= N || zz >= N) return true;
        if (roadCells[zz * N + xx]) return true;
        const y = mb.surface(xx, zz);
        const id = w.getRaw(xx, y, zz);
        if (id !== B.GRASS && id !== B.SAND && id !== B.GRASS_SNOW && id !== B.SNOW && id !== B.DIRT) return true;
        if (w.getRaw(xx, y + 1, zz) !== B.AIR && w.getRaw(xx, y + 1, zz) !== B.TALL_GRASS) return true;
      }
    return false;
  };
  for (let i = 0; i < 9000; i++) {
    const x = rng.int(4, N - 5);
    const z = rng.int(4, N - 5);
    const b = biome[z * N + x];
    const y = mb.surface(x, z);
    if (y <= SEA) continue;
    const ground = w.getRaw(x, y, z);
    if (inPOI(x, z)) continue;
    const dens =
      b === 1 ? 0.55 : b === 2 ? (y < 56 ? 0.14 : 0.03) : b === 7 ? 0.015 : b === 3 ? 0.03 : b === 0 ? 0.07 : 0;
    if (rng.next() > dens) continue;
    if (b === 3) {
      if (ground === B.SAND && !occupied(x, z, 1)) {
        if (rng.chance(0.6)) mb.cactus(x, y + 1, z);
        else mb.plant(x, y + 1, z, B.DEAD_BUSH);
      }
      continue;
    }
    if (ground !== B.GRASS && ground !== B.GRASS_SNOW && ground !== B.SNOW) continue;
    if (occupied(x, z, 2)) continue;
    if (b === 2 || ground !== B.GRASS || z < 85) {
      mb.spruce(x, y + 1, z, rng.chance(0.3));
    } else if (b === 1) {
      const r = rng.next();
      if (z < 110 && r < 0.4) mb.spruce(x, y + 1, z, rng.chance(0.4));
      else if (r < 0.62) mb.oak(x, y + 1, z, rng.chance(0.12));
      else mb.birch(x, y + 1, z);
    } else {
      if (rng.chance(0.75)) mb.oak(x, y + 1, z, rng.chance(0.18));
      else mb.birch(x, y + 1, z);
    }
  }
  // boulders (harvestable stone)
  for (let i = 0; i < 160; i++) {
    const x = rng.int(10, N - 10);
    const z = rng.int(10, N - 10);
    const y = mb.surface(x, z);
    if (y <= SEA + 1 || inPOI(x, z) || roadCells[z * N + x]) continue;
    const b = biome[z * N + x];
    if (b === 4 || b === 5 || b === 6) continue;
    mb.boulder(x, y + 1, z, rng.range(1.2, 2.0));
  }
  // ground cover
  for (let z = 2; z < N - 2; z++)
    for (let x = 2; x < N - 2; x++) {
      const y = mb.surface(x, z);
      const g = w.getRaw(x, y, z);
      if (g !== B.GRASS || w.getRaw(x, y + 1, z) !== B.AIR) continue;
      const b = biome[z * N + x];
      const r = hash2(x, z, 555);
      const dens = b === 1 ? 0.38 : b === 7 ? 0.42 : 0.3;
      const patch = n.noise2(x * 0.06, z * 0.06) * 0.5 + 0.5;
      if (r < dens * patch) {
        const f = hash2(x, z, 556);
        if (f < 0.05) w.setRaw(x, y + 1, z, f < 0.025 ? B.FLOWER_RED : B.FLOWER_YELLOW);
        else w.setRaw(x, y + 1, z, b === 1 && f < 0.25 ? B.FERN : B.TALL_GRASS);
      }
    }

  // scattered open-world loot
  for (let i = 0; i < 70; i++) {
    const x = rng.int(30, N - 30);
    const z = rng.int(30, N - 30);
    const y = mb.surface(x, z);
    if (y <= SEA) continue;
    if (w.getRaw(x, y + 1, z) !== B.AIR && w.getRaw(x, y + 1, z) !== B.TALL_GRASS) continue;
    mb.loot(x, y + 1, z, rng.chance(0.15) ? 'rare' : 'common');
  }

  onProgress?.(0.55, 'Finishing');
  w.recomputeHeights();

  const dropTargets = [
    { x: 160, z: 165, weight: 4 },
    { x: 265, z: 115, weight: 3 },
    { x: 152, z: 80, weight: 2 },
    { x: 70, z: 130, weight: 2 },
    { x: 46, z: 152, weight: 1 },
    { x: 78, z: 252, weight: 2 },
    { x: 240, z: 278, weight: 2 },
    { x: 262, z: 196, weight: 2 },
    { x: 120, z: 116, weight: 1 },
    { x: 40, z: 214, weight: 1 },
    { x: 110, z: 226, weight: 1 },
    { x: 200, z: 140, weight: 1 },
  ];

  return {
    world: w,
    name: 'Ashcrown Isle',
    lootSpots: mb.lootSpots,
    chests: mb.chests,
    landmarks: mb.landmarks,
    spawns: [],
    dropTargets,
    seaLevel: SEA,
    coverHints: mb.coverHints,
    preset: { time: 16.2, weather: 'clear', timeScale: 0 },
    bounds: { x0: 8, z0: 8, x1: N - 8, z1: N - 8 },
  };
}

// rectangles reserved for structures (no trees)
const POI_RECTS: [number, number, number, number][] = [
  [124, 136, 200, 196], // village
  [232, 88, 298, 144], // facility
  [138, 70, 170, 96], // mine entrance
  [62, 120, 82, 140], // lookout
  [34, 140, 64, 166], // timber camp
  [50, 228, 104, 280], // temple
  [196, 256, 296, 304], // docks
  [244, 178, 284, 214], // windmill
  [108, 104, 134, 128], // checkpoint
  [28, 204, 52, 226], // lighthouse
];
function inPOI(x: number, z: number) {
  for (const [x0, z0, x1, z1] of POI_RECTS) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
  return false;
}

// ---------------------------------------------------------------- Oakhollow
function buildVillage(mb: MapBuilder) {
  const Y = 29;
  mb.flatten(126, 138, 198, 194, Y, B.GRASS, B.DIRT, 6);
  mb.landmark('Oakhollow', 162, 165);
  // plaza
  mb.fill(152, Y, 158, 170, Y, 172, B.COBBLE);
  for (let x = 152; x <= 170; x++) for (let z = 158; z <= 172; z++) if (((x + z) & 3) === 0) mb.set(x, Y, z, B.STONE_BRICKS);
  // well
  mb.walls(159, Y + 1, 163, 163, Y + 1, 167, B.COBBLE);
  mb.fill(160, Y - 3, 164, 162, Y, 166, B.WATER);
  for (const [x, z] of [[159, 163], [163, 163], [159, 167], [163, 167]]) mb.fill(x, Y + 2, z, x, Y + 3, z, B.SPRUCE_LOG);
  mb.fill(159, Y + 4, 163, 163, Y + 4, 167, B.ROOF);
  mb.lampPost(152, Y + 1, 158);
  mb.lampPost(170, Y + 1, 158);
  mb.lampPost(152, Y + 1, 172);
  mb.lampPost(170, Y + 1, 172);
  mb.loot(165, Y + 1, 170, 'common');
  // houses ring
  mb.house(134, 142, 8, 7, Y + 1, { door: 's' });
  mb.house(146, 140, 7, 7, Y + 1, { door: 's', wall: B.BIRCH_LOG, frame: B.SPRUCE_LOG });
  mb.house(176, 142, 9, 8, Y + 1, { door: 's', floors: 2, wall: B.STONE_BRICKS, frame: B.SPRUCE_LOG });
  mb.house(132, 160, 7, 9, Y + 1, { door: 'e', wall: B.SPRUCE_PLANKS });
  mb.house(132, 176, 8, 8, Y + 1, { door: 'e', floors: 2 });
  mb.house(146, 180, 7, 7, Y + 1, { door: 'n', wall: B.BRICKS, frame: B.DARK_PLANKS });
  mb.house(172, 180, 9, 7, Y + 1, { door: 'n', wall: B.OAK_PLANKS, roof: B.DARK_PLANKS });
  mb.house(186, 162, 8, 9, Y + 1, { door: 'w', floors: 2, wall: B.SPRUCE_PLANKS, frame: B.OAK_LOG });
  mb.house(186, 178, 7, 8, Y + 1, { door: 'w', wall: B.BIRCH_LOG, roof: B.ROOF });
  // church with bell tower
  church(mb, 150, 144, Y + 1);
  // farms
  for (let fz = 0; fz < 3; fz++) {
    const z0 = 186 + fz * 0;
    void z0;
  }
  for (let row = 0; row < 4; row++) {
    const x0 = 128 + row * 6;
    mb.fill(x0, Y, 188, x0 + 4, Y, 194, B.DIRT);
    mb.fill(x0 + 2, Y, 188, x0 + 2, Y, 194, B.WATER);
    for (let x = x0; x <= x0 + 4; x++) for (let z = 188; z <= 194; z++) if (x !== x0 + 2) mb.set(x, Y + 1, z, B.WHEAT);
  }
  // hay & crates
  for (const [x, z] of [[176, 190], [177, 190], [176, 191], [190, 152], [191, 152], [190, 153]]) mb.set(x, Y + 1, z, B.HAY);
  mb.set(176, Y + 2, 190, B.HAY);
  mb.coverWall(141, 168, 143, 168, Y + 1, B.HAY, 1);
  mb.coverWall(178, 166, 180, 166, Y + 1, B.CRATE, 1);
  mb.loot(144, Y + 1, 166, 'common');
  mb.loot(180, Y + 1, 168, 'common');
  mb.decorateGround(126, 138, 198, 196, 0.12, 0.05);
}

function church(mb: MapBuilder, x0: number, z0: number, y: number) {
  const w = 11, d = 8;
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  mb.fill(x0, y - 2, z0, x1, y - 1, z1, B.STONE_BRICKS);
  mb.clear(x0, y, z0, x1, y + 10, z1);
  mb.walls(x0, y, z0, x1, y + 5, z1, B.STONE_BRICKS);
  for (let x = x0 + 2; x < x1; x += 3) {
    mb.fill(x, y + 2, z0, x, y + 4, z0, B.GLASS);
    mb.fill(x, y + 2, z1, x, y + 4, z1, B.GLASS);
  }
  // roof
  for (let i = 0; i <= 4; i++) {
    mb.fill(x0 - 1, y + 6 + i, z0 - 1 + i, x1 + 1, y + 6 + i, z0 - 1 + i, B.DARK_PLANKS);
    mb.fill(x0 - 1, y + 6 + i, z1 + 1 - i, x1 + 1, y + 6 + i, z1 + 1 - i, B.DARK_PLANKS);
    if (z0 + i <= z1 - i) {
      mb.fill(x0, y + 6 + i, z0 + i, x0, y + 6 + i, z1 - i, B.STONE_BRICKS);
      mb.fill(x1, y + 6 + i, z0 + i, x1, y + 6 + i, z1 - i, B.STONE_BRICKS);
    }
  }
  mb.fill(x0, y + 5, z0, x1, y + 5, z1, B.STONE_BRICKS);
  mb.fill(x0 + 1, y + 5, z0 + 1, x1 - 1, y + 5, z1 - 1, B.AIR);
  // door
  mb.clear(x1, y, z0 + 3, x1, y + 2, z0 + 4);
  // pews
  for (let x = x0 + 2; x < x1 - 2; x += 2) {
    mb.set(x, y, z0 + 2, B.SPRUCE_PLANKS);
    mb.set(x, y, z0 + 5, B.SPRUCE_PLANKS);
  }
  mb.set(x0 + 1, y, z0 + 3, B.GOLD_ORE);
  mb.chest(x0 + 1, y, z0 + 4, 'rare');
  mb.lamp(x0 + 5, y + 4, z0 + 4);
  // bell tower on west end
  const tx = x0 - 4, tz = z0 + 2;
  mb.fill(tx - 1, y - 2, tz - 1, tx + 3, y - 1, tz + 3, B.STONE_BRICKS);
  mb.walls(tx - 1, y, tz - 1, tx + 3, y + 13, tz + 3, B.STONE_BRICKS);
  mb.clear(tx, y, tz, tx + 2, y + 16, tz + 2);
  mb.clear(tx + 3, y, tz + 1, tx + 3, y + 1, tz + 1);
  // spiral stairs
  const path = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
  for (let i = 0; i < 13; i++) {
    const [px, pz] = path[i % path.length];
    mb.set(tx + px, y + i, tz + pz, B.STONE_BRICKS);
  }
  // belfry openings & platform
  mb.fill(tx, y + 13, tz, tx + 2, y + 13, tz + 2, B.SPRUCE_PLANKS);
  mb.set(tx, y + 13, tz + 1, B.AIR);
  for (const [ox, oz] of [[1, -1], [1, 3], [-1, 1], [3, 1]]) mb.fill(tx + ox, y + 14, tz + oz, tx + ox, y + 15, tz + oz, B.AIR);
  mb.fill(tx - 1, y + 16, tz - 1, tx + 3, y + 16, tz + 3, B.STONE_BRICKS);
  mb.fill(tx, y + 17, tz, tx + 2, y + 17, tz + 2, B.DARK_PLANKS);
  mb.set(tx + 1, y + 18, tz + 1, B.DARK_PLANKS);
  mb.set(tx + 1, y + 15, tz + 1, B.GOLD_ORE);
  mb.loot(tx + 1, y + 14, tz + 1, 'rare');
  mb.landmark('Bell Tower', tx + 1, tz + 1, false);
}

// ---------------------------------------------------------------- Site 7
function buildFacility(mb: MapBuilder) {
  const Y = 32;
  mb.flatten(234, 90, 296, 142, Y, B.GRAVEL, B.STONE, 6);
  mb.landmark('Site 7', 265, 115);
  // ground: concrete yard
  for (let x = 236; x <= 294; x++) for (let z = 92; z <= 140; z++) mb.set(x, Y, z, (x * 7 + z * 3) % 11 === 0 ? B.GRAVEL : B.ASPHALT);
  // perimeter fence with gates
  for (let x = 236; x <= 294; x++)
    for (const z of [92, 140]) {
      mb.set(x, Y + 1, z, B.CONCRETE);
      mb.fill(x, Y + 2, z, x, Y + 3, z, B.IRON_BARS);
    }
  for (let z = 92; z <= 140; z++)
    for (const x of [236, 294]) {
      mb.set(x, Y + 1, z, B.CONCRETE);
      mb.fill(x, Y + 2, z, x, Y + 3, z, B.IRON_BARS);
    }
  mb.clear(236, Y + 1, 120, 236, Y + 3, 126); // west gate (road)
  mb.clear(260, Y + 1, 140, 266, Y + 3, 140); // south gate
  mb.clear(294, Y + 1, 112, 294, Y + 3, 116); // east gate
  // main lab building (2 floors)
  mb.bunkerBuilding(244, 96, 20, 13, Y + 1, 2, { door: 's', wall: B.CONCRETE_WHITE });
  mb.chest(262, Y + 1, 98, 'epic');
  // warehouse
  mb.bunkerBuilding(270, 116, 16, 12, Y + 1, 1, { door: 'w', wall: B.METAL_PLATE, floor: B.CONCRETE, roofAccess: true });
  for (let x = 273; x < 283; x += 3) {
    mb.fill(x, Y + 1, 119, x + 1, Y + 2, 120, B.CRATE);
    mb.set(x, Y + 3, 119, B.CRATE);
  }
  mb.loot(281, Y + 1, 124, 'rare');
  // radio tower (lattice)
  const tx = 284, tz = 98, th = 26;
  for (let i = 0; i < th; i++) {
    const inset = Math.floor(i / 9);
    const a = tx + inset, b = tx + 4 - inset;
    for (const [x, z] of [[a, tz + inset], [b, tz + inset], [a, tz + 4 - inset], [b, tz + 4 - inset]]) mb.set(x, Y + 1 + i, z, B.METAL_PLATE);
    if (i % 4 === 0) {
      mb.fill(a, Y + 1 + i, tz + inset, b, Y + 1 + i, tz + inset, B.IRON_BARS);
      mb.fill(a, Y + 1 + i, tz + 4 - inset, b, Y + 1 + i, tz + 4 - inset, B.IRON_BARS);
    }
  }
  mb.set(tx + 2, Y + th + 1, tz + 2, B.LAMP);
  mb.landmark('Radio Mast', tx + 2, tz + 2, false);
  // helipad
  mb.fill(248, Y, 116, 260, Y, 128, B.CONCRETE);
  for (let i = 0; i < 7; i++) {
    mb.set(251, Y, 119 + i, B.HAZARD);
    mb.set(257, Y, 119 + i, B.HAZARD);
    if (i === 3) for (let x = 251; x <= 257; x++) mb.set(x, Y, 122, B.HAZARD);
  }
  for (const [x, z] of [[248, 116], [260, 116], [248, 128], [260, 128]]) mb.set(x, Y + 1, z, B.LAMP);
  // cover: barriers and containers in the yard
  mb.container(240, 130, Y + 1, true, B.WOOL_BLUE);
  mb.container(264, 130, Y + 1, true, B.TERRACOTTA_RED);
  mb.coverWall(266, 112, 268, 112, Y + 1, B.CONCRETE, 2);
  mb.coverWall(242, 112, 242, 114, Y + 1, B.CONCRETE, 2);
  mb.coverWall(288, 132, 290, 132, Y + 1, B.HAZARD, 1);
  // bunker entrance -> underground lab
  const bx = 240, bz = 100;
  mb.fill(bx, Y + 1, bz, bx + 3, Y + 4, bz + 6, B.CONCRETE);
  mb.clear(bx + 1, Y + 1, bz + 1, bx + 2, Y + 3, bz + 6);
  mb.set(bx + 1, Y + 4, bz + 3, B.LIGHT_PANEL);
  // stairs going down along z
  const labY = Y - 9;
  for (let s = 0; s < 10; s++) {
    const z = bz + 1 + s;
    mb.clear(bx + 1, Y - s, z, bx + 2, Y + 3 - s, z);
    mb.fill(bx + 1, Y - 1 - s, z, bx + 2, Y - 1 - s, z, B.METAL_PLATE);
    mb.fill(bx, Y - 1 - s, z, bx, Y + 3 - s, z, B.CONCRETE);
    mb.fill(bx + 3, Y - 1 - s, z, bx + 3, Y + 3 - s, z, B.CONCRETE);
    mb.fill(bx + 1, Y + 4 - s, z, bx + 2, Y + 4 - s, z, B.CONCRETE);
  }
  // lab room
  const lx0 = bx - 4, lz0 = bz + 11, lx1 = bx + 12, lz1 = bz + 23;
  mb.fill(lx0 - 1, labY - 1, lz0 - 1, lx1 + 1, labY + 5, lz1 + 1, B.CONCRETE_WHITE);
  mb.fill(lx0, labY - 1, lz0, lx1, labY - 1, lz1, B.TILE_FLOOR);
  mb.clear(lx0, labY, lz0, lx1, labY + 4, lz1);
  mb.clear(bx + 1, labY, lz0 - 1, bx + 2, labY + 2, lz0 - 1);
  for (let x = lx0 + 2; x < lx1; x += 4) for (let z = lz0 + 2; z < lz1; z += 4) mb.set(x, labY + 4, z, B.LIGHT_PANEL);
  for (let x = lx0 + 1; x < lx1; x += 3) {
    mb.fill(x, labY, lz1 - 1, x, labY + 2, lz1 - 1, B.SERVER);
  }
  mb.fill(lx0 + 3, labY, lz0 + 4, lx0 + 8, labY, lz0 + 5, B.METAL_PLATE);
  mb.fill(lx1 - 5, labY, lz0 + 4, lx1 - 2, labY, lz0 + 5, B.GLASS_PANE_DARK);
  mb.chest(lx0 + 1, labY, lz0 + 1, 'epic');
  mb.loot(bx + 6, labY, lz0 + 8, 'epic');
  mb.loot(lx0 + 4, labY, lz1 - 3, 'rare');
  mb.landmark('Underground Lab', bx + 4, lz0 + 6, false);
  // second exit: vertical shaft with stairs at far end -> surface near (252, 132)
  const ex = lx1 - 1, ez = lz1 - 3;
  for (let s = 0; s < 10; s++) {
    mb.clear(ex - s, labY + s, ez, ex - s, labY + s + 3, ez + 1);
    mb.fill(ex - s, labY - 1 + s, ez, ex - s, labY - 1 + s, ez + 1, B.METAL_PLATE);
  }
  mb.clear(ex - 9, Y + 1, ez, ex - 9, Y + 2, ez + 1);
  mb.set(ex - 10, Y + 1, ez - 1, B.LAMP);
  mb.lootSpots.push({ x: 290, y: Y + 1, z: 136, tier: 'common' });
}

// ---------------------------------------------------------------- Deepvein Mine
function buildMine(mb: MapBuilder, hm: Float32Array) {
  const Y = 31;
  const ex = 152, ez = 86; // entrance (south face)
  mb.landmark('Deepvein Mine', ex, ez - 8);
  // ensure a mountain mass over the tunnel network
  for (let x = 128; x <= 178; x++)
    for (let z = 38; z <= 84; z++) {
      const top = mb.surface(x, z);
      if (top < Y + 9) {
        const extra = Y + 9 - top;
        for (let y = top + 1; y <= top + extra; y++) mb.set(x, y, z, B.STONE);
        mb.set(x, top + extra, z, B.GRASS);
      }
    }
  void hm;
  mb.flatten(ex - 7, ez, ex + 7, ez + 8, Y, B.GRAVEL, B.STONE, 4);
  const tunnel = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    mb.clear(Math.min(x0, x1), y, Math.min(z0, z1), Math.max(x0, x1), y + 3, Math.max(z0, z1));
    mb.fill(Math.min(x0, x1), y - 1, Math.min(z0, z1), Math.max(x0, x1), y - 1, Math.max(z0, z1), B.GRAVEL);
  };
  // main shaft north
  tunnel(ex - 1, 46, ex + 1, ez, Y);
  // supports + lamps
  for (let z = ez - 2; z > 46; z -= 6) {
    mb.fill(ex - 2, Y, z, ex - 2, Y + 3, z, B.SPRUCE_LOG);
    mb.fill(ex + 2, Y, z, ex + 2, Y + 3, z, B.SPRUCE_LOG);
    mb.fill(ex - 2, Y + 4, z, ex + 2, Y + 4, z, B.SPRUCE_PLANKS);
    mb.set(ex, Y + 3, z, B.LAMP);
  }
  // rails
  for (let z = 48; z < ez; z++) mb.set(ex, Y - 1, z, B.DARK_PLANKS);
  // west branch to cavern
  tunnel(126, 62, ex, 64, Y);
  // big cavern
  for (let x = 120; x <= 140; x++)
    for (let z = 50; z <= 74; z++)
      for (let y = Y - 1; y <= Y + 8; y++) {
        const d = ((x - 130) / 10.5) ** 2 + ((z - 62) / 12.5) ** 2 + ((y - (Y + 2)) / 7.5) ** 2;
        if (d < 1) mb.set(x, y, z, B.AIR);
        else if (d < 1.25 && mb.get(x, y, z) === B.STONE) {
          const r = hash2(x * 3 + y, z, 5);
          if (r < 0.06) mb.set(x, y, z, B.COAL_ORE);
          else if (r < 0.09) mb.set(x, y, z, B.IRON_ORE);
          else if (r < 0.1) mb.set(x, y, z, B.GOLD_ORE);
          else if (r < 0.104) mb.set(x, y, z, B.DIAMOND_ORE);
        }
      }
  mb.fill(121, Y - 2, 51, 139, Y - 2, 73, B.STONE);
  for (let x = 121; x <= 139; x++) for (let z = 51; z <= 73; z++) if (mb.get(x, Y - 1, z) === B.AIR && mb.get(x, Y - 2, z) !== B.AIR) mb.set(x, Y - 1, z, B.GRAVEL);
  for (const [x, z] of [[126, 56], [134, 56], [126, 68], [134, 68], [130, 62]]) mb.set(x, Y + 6, z, B.LAMP);
  mb.chest(130, Y, 62, 'epic');
  mb.loot(124, Y, 60, 'rare');
  mb.loot(136, Y, 66, 'rare');
  mb.landmark('Cavern', 130, 62, false);
  // east branch -> exit on the east slope
  tunnel(ex, 52, 182, 54, Y);
  for (let x = 160; x <= 190; x++) {
    const top = mb.surface(x, 53);
    if (top <= Y + 3) {
      mb.clear(x, Y, 52, x, Y + 3, 54);
      break;
    }
  }
  for (let x = ex + 4; x < 182; x += 7) mb.set(x, Y + 3, 53, B.LAMP);
  mb.loot(ex, Y, 50, 'rare');
  mb.loot(170, Y, 53, 'common');
  // entrance frame
  mb.fill(ex - 2, Y, ez, ex - 2, Y + 4, ez, B.SPRUCE_LOG);
  mb.fill(ex + 2, Y, ez, ex + 2, Y + 4, ez, B.SPRUCE_LOG);
  mb.fill(ex - 3, Y + 4, ez, ex + 3, Y + 4, ez, B.SPRUCE_PLANKS);
  mb.set(ex - 3, Y, ez + 2, B.CRATE);
  mb.set(ex - 3, Y + 1, ez + 2, B.LAMP);
  mb.set(ex + 3, Y, ez + 3, B.CRATE);
  mb.coverWall(ex + 4, ez + 5, ex + 5, ez + 5, Y + 1, B.CRATE, 1);
}

// ---------------------------------------------------------------- forest
function buildForestPOIs(mb: MapBuilder) {
  // Ranger lookout
  const ly = mb.surface(70, 128);
  mb.flatten(66, 124, 76, 134, ly, B.GRASS, B.DIRT, 3);
  mb.watchtower(68, 126, ly + 1, 16);
  mb.landmark('Ranger Lookout', 70, 128);
  mb.chest(66, ly + 1, 132, 'rare');
  // timber camp
  const cy = mb.surface(46, 152);
  mb.flatten(36, 142, 62, 164, cy, B.GRASS, B.DIRT, 4);
  mb.landmark('Timber Camp', 48, 152);
  mb.house(38, 144, 7, 6, cy + 1, { door: 'e', wall: B.SPRUCE_PLANKS, frame: B.SPRUCE_LOG, roof: B.DARK_PLANKS, glass: true });
  mb.house(52, 155, 8, 6, cy + 1, { door: 'n', wall: B.SPRUCE_PLANKS, frame: B.SPRUCE_LOG, roof: B.DARK_PLANKS });
  // log piles (cover)
  for (let i = 0; i < 6; i++) {
    mb.set(46 + i, cy + 1, 146, B.OAK_LOG);
    if (i < 4) mb.set(47 + i, cy + 2, 146, B.OAK_LOG);
  }
  mb.coverWall(40, 160, 43, 160, cy + 1, B.SPRUCE_LOG, 2);
  mb.lampPost(49, cy + 1, 151, 3);
  mb.loot(56, cy + 1, 148, 'common');
  mb.loot(42, cy + 1, 156, 'common');
}

// ---------------------------------------------------------------- desert
function buildDesert(mb: MapBuilder) {
  const Y = 28;
  mb.flatten(58, 234, 98, 274, Y, B.SAND, B.SANDSTONE, 6);
  mb.landmark('Sunken Temple', 78, 254);
  mb.landmark('Dune Flats', 92, 236, false);
  // pyramid 25x25
  const x0 = 66, z0 = 242, S = 25;
  for (let l = 0; l < 12; l++) {
    mb.fill(x0 + l, Y + 1 + l, z0 + l, x0 + S - 1 - l, Y + 1 + l, z0 + S - 1 - l, B.SANDSTONE);
  }
  // hollow interior
  mb.clear(x0 + 4, Y + 1, z0 + 4, x0 + S - 5, Y + 5, z0 + S - 5);
  mb.clear(x0 + 8, Y + 6, z0 + 8, x0 + S - 9, Y + 7, z0 + S - 9);
  mb.fill(x0 + 4, Y, z0 + 4, x0 + S - 5, Y, z0 + S - 5, B.SANDSTONE);
  for (let x = x0 + 4; x <= x0 + S - 5; x++) for (let z = z0 + 4; z <= z0 + S - 5; z++) if ((x + z) % 4 === 0) mb.set(x, Y, z, B.TERRACOTTA);
  // entrances N and S
  const mx = x0 + 12;
  mb.clear(mx - 1, Y + 1, z0, mx + 1, Y + 3, z0 + 4);
  mb.clear(mx - 1, Y + 1, z0 + S - 5, mx + 1, Y + 3, z0 + S - 1);
  mb.clear(x0, Y + 1, z0 + 12, x0 + 4, Y + 2, z0 + 12);
  // pillars + lamps
  for (const [px, pz] of [[x0 + 7, z0 + 7], [x0 + S - 8, z0 + 7], [x0 + 7, z0 + S - 8], [x0 + S - 8, z0 + S - 8]]) {
    mb.fill(px, Y + 1, pz, px, Y + 5, pz, B.TERRACOTTA_RED);
    mb.set(px, Y + 6, pz, B.LAMP);
  }
  mb.chest(mx, Y + 1, z0 + 12, 'epic');
  mb.fill(mx - 1, Y, z0 + 11, mx + 1, Y, z0 + 13, B.GOLD_ORE);
  mb.loot(x0 + 6, Y + 1, z0 + 12, 'rare');
  mb.loot(x0 + S - 7, Y + 1, z0 + 12, 'rare');
  // top platform
  mb.loot(mx, Y + 13, z0 + 12, 'common');
  // ruins
  const ruin = (x: number, z: number) => {
    const y = mb.surface(x, z);
    for (let i = 0; i < 6; i++) {
      const h = 1 + Math.floor(hash2(x + i, z, 3) * 4);
      mb.fill(x + i, y + 1, z, x + i, y + h, z, i % 2 ? B.SANDSTONE : B.TERRACOTTA);
    }
    for (let i = 0; i < 5; i++) {
      const h = 1 + Math.floor(hash2(x, z + i, 4) * 3);
      mb.fill(x, y + 1, z + i, x, y + h, z + i, B.SANDSTONE);
    }
    mb.loot(x + 2, y + 1, z + 2, 'common');
    mb.coverHints.push({ x: x + 2, y: y + 1, z: z + 2 });
  };
  ruin(108, 222);
  ruin(48, 276);
  ruin(98, 268);
  mb.landmark('Old Ruins', 110, 224, false);
}

// ---------------------------------------------------------------- docks
function buildDocks(mb: MapBuilder) {
  const Y = SEA + 2;
  mb.flatten(204, 262, 286, 286, Y, B.STONE_BRICKS, B.STONE, 5);
  mb.landmark('Rustwater Docks', 244, 276);
  for (let x = 204; x <= 286; x++) for (let z = 262; z <= 286; z++) mb.set(x, Y, z, (x + z) % 7 === 0 ? B.STONE : B.STONE_BRICKS);
  // piers into the sea
  for (const px of [214, 236, 258, 276]) {
    for (let z = 287; z <= 304; z++) {
      mb.fill(px, Y, z, px + 3, Y, z, B.SPRUCE_PLANKS);
      if (z % 4 === 0) {
        mb.fill(px, 14, z, px, Y - 1, z, B.SPRUCE_LOG);
        mb.fill(px + 3, 14, z, px + 3, Y - 1, z, B.SPRUCE_LOG);
      }
    }
    mb.set(px, Y + 1, 304, B.LAMP);
  }
  // warehouses
  mb.bunkerBuilding(208, 264, 14, 10, Y + 1, 1, { door: 's', wall: B.BRICKS, floor: B.CONCRETE });
  mb.bunkerBuilding(262, 264, 16, 10, Y + 1, 1, { door: 's', wall: B.METAL_PLATE, floor: B.CONCRETE });
  // containers stacked
  const cols = [B.TERRACOTTA_RED, B.WOOL_BLUE, B.CONCRETE, B.TERRACOTTA, B.WOOL_RED];
  let k = 0;
  for (let x = 226; x <= 254; x += 9) {
    mb.container(x, 277, Y + 1, true, cols[k++ % cols.length]);
    if (k % 2 === 0) mb.container(x, 277, Y + 4, true, cols[k % cols.length], false);
  }
  mb.container(244, 266, Y + 1, false, cols[3]);
  // crane
  const cx = 270, cz = 292;
  for (let y = Y; y < Y + 16; y++) {
    mb.set(cx, y, cz, B.HAZARD);
    mb.set(cx + 1, y, cz, B.METAL_PLATE);
  }
  mb.fill(cx - 10, Y + 16, cz, cx + 3, Y + 16, cz, B.HAZARD);
  mb.fill(cx - 9, Y + 10, cz, cx - 9, Y + 15, cz, B.IRON_BARS);
  mb.chest(cx + 1, Y + 17, cz, 'rare');
  mb.set(cx, Y + 17, cz, B.LAMP);
  // crane access stairs
  for (let s = 0; s < 16; s++) mb.set(cx + 2, Y + s, cz - 1 - (s % 2), B.METAL_PLATE);
  for (let x = 206; x <= 284; x += 12) mb.set(x, Y + 1, 286, B.LAMP);
  mb.coverWall(232, 272, 234, 272, Y + 1, B.CRATE, 2);
  mb.coverWall(256, 284, 258, 284, Y + 1, B.CRATE, 1);
}

// ---------------------------------------------------------------- windmill farm
function buildWindmill(mb: MapBuilder) {
  const Y = mb.surface(262, 196);
  mb.flatten(246, 180, 282, 212, Y, B.GRASS, B.DIRT, 5);
  mb.landmark('Windmere Fields', 264, 196);
  // windmill tower
  const tx = 258, tz = 186;
  for (let y = 0; y < 14; y++) {
    const r = y < 6 ? 3 : 2;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const edge = Math.abs(dx) === r || Math.abs(dz) === r;
        if (edge && !(Math.abs(dx) === r && Math.abs(dz) === r)) mb.set(tx + dx, Y + 1 + y, tz + dz, y < 6 ? B.COBBLE : B.OAK_PLANKS);
        else if (!edge) mb.set(tx + dx, Y + 1 + y, tz + dz, B.AIR);
      }
  }
  mb.clear(tx, Y + 1, tz + 3, tx, Y + 2, tz + 3);
  for (let s = 0; s < 12; s++) {
    const p = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]][s % 8];
    mb.set(tx + p[0], Y + 1 + s, tz + p[1], B.SPRUCE_PLANKS);
  }
  mb.fill(tx - 2, Y + 15, tz - 2, tx + 2, Y + 15, tz + 2, B.ROOF);
  mb.fill(tx - 1, Y + 16, tz - 1, tx + 1, Y + 16, tz + 1, B.ROOF);
  // blades (static, on the south face)
  const hy = Y + 11, hz = tz + 3;
  mb.set(tx, hy, hz, B.DARK_PLANKS);
  for (let i = 1; i <= 7; i++) {
    mb.set(tx + i, hy, hz + 1, B.WOOL_WHITE);
    mb.set(tx - i, hy, hz + 1, B.WOOL_WHITE);
    mb.set(tx, hy + i, hz + 1, B.WOOL_WHITE);
    if (hy - i > Y + 1) mb.set(tx, hy - i, hz + 1, B.WOOL_WHITE);
  }
  mb.loot(tx, Y + 13, tz, 'rare');
  // farmhouse + barn
  mb.house(266, 184, 9, 7, Y + 1, { door: 'w', floors: 2, wall: B.OAK_PLANKS, roof: B.ROOF });
  mb.house(250, 200, 12, 9, Y + 1, { door: 'n', wall: B.TERRACOTTA_RED, frame: B.DARK_PLANKS, roof: B.DARK_PLANKS, glass: false });
  for (let i = 0; i < 6; i++) mb.set(254 + i, Y + 1, 206, B.HAY);
  // fields
  for (let row = 0; row < 3; row++) {
    const z0 = 196 + row * 5;
    mb.fill(268, Y, z0, 280, Y, z0 + 3, B.DIRT);
    mb.fill(268, Y, z0 + 1, 280, Y, z0 + 1, B.WATER);
    for (let x = 268; x <= 280; x++) for (const z of [z0, z0 + 2, z0 + 3]) mb.set(x, Y + 1, z, B.WHEAT);
  }
  mb.coverWall(248, 192, 251, 192, Y + 1, B.HAY, 1);
}

// ---------------------------------------------------------------- checkpoint
function buildCheckpoint(mb: MapBuilder) {
  const Y = mb.surface(120, 116);
  mb.flatten(110, 106, 132, 126, Y, B.GRAVEL, B.DIRT, 4);
  mb.landmark('Crossroads', 121, 116);
  mb.watchtower(124, 108, Y + 1, 9);
  // sandbag walls (cobble)
  mb.coverWall(112, 112, 116, 112, Y + 1, B.COBBLE, 1);
  mb.coverWall(112, 120, 116, 120, Y + 1, B.COBBLE, 1);
  mb.coverWall(112, 112, 112, 120, Y + 1, B.COBBLE, 1);
  // tent
  mb.fill(116, Y + 1, 122, 122, Y + 1, 122, B.WOOL_WHITE);
  mb.fill(116, Y + 2, 123, 122, Y + 2, 123, B.WOOL_WHITE);
  mb.fill(116, Y + 1, 126, 122, Y + 1, 126, B.WOOL_WHITE);
  mb.fill(116, Y + 2, 125, 122, Y + 2, 125, B.WOOL_WHITE);
  mb.fill(116, Y + 3, 124, 122, Y + 3, 124, B.WOOL_WHITE);
  mb.chest(119, Y + 1, 124, 'common');
  mb.loot(114, Y + 1, 116, 'rare');
}

// ---------------------------------------------------------------- lighthouse
function buildLighthouse(mb: MapBuilder) {
  // find the coast on the west side near z=215
  let x = 20;
  while (x < 100 && mb.surface(x, 215) <= SEA) x++;
  const lx = x + 3;
  const lz = 215;
  const Y = Math.max(mb.surface(lx, lz), SEA + 2);
  mb.flatten(lx - 4, lz - 4, lx + 4, lz + 4, Y, B.STONE, B.STONE, 3);
  const H = 22;
  for (let y = 0; y < H; y++) {
    const band = Math.floor(y / 4) % 2 === 0 ? B.WOOL_WHITE : B.WOOL_RED;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        mb.set(lx + dx, Y + 1 + y, lz + dz, edge ? band : B.AIR);
      }
  }
  mb.clear(lx + 2, Y + 1, lz, lx + 2, Y + 2, lz);
  const path = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  for (let s = 0; s < H - 1; s++) mb.set(lx + path[s % 8][0], Y + 1 + s, lz + path[s % 8][1], B.STONE_BRICKS);
  mb.fill(lx - 3, Y + H, lz - 3, lx + 3, Y + H, lz + 3, B.STONE_BRICKS);
  const [px, pz] = path[(H - 2) % 8];
  mb.set(lx + px, Y + H, lz + pz, B.AIR);
  mb.fill(lx - 1, Y + H + 1, lz - 1, lx + 1, Y + H + 3, lz + 1, B.GLASS);
  mb.set(lx, Y + H + 2, lz, B.LAMP);
  mb.fill(lx - 1, Y + H + 4, lz - 1, lx + 1, Y + H + 4, lz + 1, B.DARK_PLANKS);
  mb.clear(lx + 1, Y + H + 1, lz, lx + 1, Y + H + 2, lz);
  mb.loot(lx + 2, Y + H + 1, lz + 2, 'epic');
  mb.landmark('Old Lighthouse', lx, lz);
}

function buildBridges(mb: MapBuilder) {
  // road crossings over the river
  const deck = (x0: number, z0: number, x1: number, z1: number) =>
    Math.max(SEA + 2, Math.min(mb.surface(x0, z0), mb.surface(x1, z1)));
  mb.bridge(204, 146, 224, 150, deck(204, 148, 224, 148));
  mb.bridge(196, 182, 216, 186, deck(196, 184, 216, 184), B.SPRUCE_PLANKS, B.SPRUCE_LOG);
  mb.bridge(164, 248, 184, 252, deck(164, 250, 184, 250), B.STONE_BRICKS, B.COBBLE);
  // ford stepping stones near the mine
  for (let i = 0; i < 6; i++) mb.set(200 + i, SEA, 95 + (i % 2), B.COBBLE);
}
