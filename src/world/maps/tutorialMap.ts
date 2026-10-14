// "Training Grounds": a compact course teaching movement, shooting,
// reloading, aiming, scoping, looting, harvesting, building, crafting and
// grenades through play.

import { B } from '../blocks';
import { VoxelWorld } from '../world';
import { MapBuilder, type MapData } from './builder';

export function buildTraining(): MapData {
  const W = 72, D = 112, H = 40, G = 10;
  const w = new VoxelWorld(W, H, D);
  w.seaLevel = 4;
  w.buildCeiling = 30;
  const mb = new MapBuilder(w, 55);
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      const d = Math.min(x, z, W - 1 - x, D - 1 - z);
      const h = d < 4 ? G + (4 - d) * 3 : G;
      const base = (z * W + x) * H;
      for (let y = 0; y <= h; y++) w.blocks[base + y] = y === 0 ? B.BEDROCK : y === h ? B.GRASS : y > h - 2 ? B.DIRT : B.STONE;
    }
  const Y = G + 1;
  // central concrete path
  mb.fill(33, G, 6, 38, G, 106, B.CONCRETE);
  for (let z = 6; z <= 106; z += 4) mb.set(35, G, z, B.HAZARD);
  const st: Record<string, { x: number; y: number; z: number }> = {};
  // 1. spawn pad
  mb.fill(31, G, 100, 40, G, 108, B.STONE_BRICKS);
  st.spawn = { x: 35.5, y: Y, z: 104.5 };
  // 2. move marker + jump wall
  st.move = { x: 35.5, y: Y, z: 94.5 };
  mb.fill(31, Y, 88, 40, Y, 88, B.COBBLE);
  mb.fill(31, Y, 86, 40, Y + 1, 86, B.COBBLE);
  st.jump = { x: 35.5, y: Y, z: 83.5 };
  // 3. weapon table
  mb.fill(33, Y, 78, 38, Y, 78, B.OAK_PLANKS);
  st.weapon = { x: 35.5, y: Y + 1, z: 78.5 };
  mb.lampPost(31, Y, 78);
  mb.lampPost(40, Y, 78);
  // 4. shooting range: firing line at z=72, dummies further north
  mb.fill(30, Y, 72, 41, Y, 72, B.HAZARD);
  st.range = { x: 35.5, y: Y, z: 73.5 };
  st.dummy1 = { x: 32.5, y: Y, z: 62.5 };
  st.dummy2 = { x: 38.5, y: Y, z: 52.5 };
  st.dummy3 = { x: 35.5, y: Y + 2, z: 38.5 };
  mb.fill(33, Y, 37, 38, Y + 1, 40, B.STONE_BRICKS);
  // long range targets
  st.chest = { x: 40, y: Y, z: 73 };
  mb.chest(41, Y, 74, 'epic');
  st.far1 = { x: 30.5, y: Y + 4, z: 14.5 };
  st.far2 = { x: 41.5, y: Y + 4, z: 10.5 };
  mb.fill(28, Y, 13, 33, Y + 3, 16, B.STONE_BRICKS);
  mb.fill(39, Y, 9, 44, Y + 3, 12, B.STONE_BRICKS);
  // 5. harvest grove (west)
  st.harvest = { x: 18.5, y: Y, z: 72.5 };
  for (const [x, z] of [[12, 66], [18, 64], [12, 76], [22, 78]]) mb.oak(x, Y, z, false);
  mb.boulder(24, Y, 70, 1.6);
  mb.boulder(8, Y, 71, 1.4);
  mb.set(15, Y, 80, B.IRON_ORE);
  mb.set(15, Y, 81, B.COAL_ORE);
  // 6. build gap (east): a pit with a high ledge beyond
  st.build = { x: 52.5, y: Y, z: 74.5 };
  mb.fill(48, G - 6, 62, 62, G, 68, B.AIR);
  mb.fill(48, G - 7, 62, 62, G - 7, 68, B.STONE);
  mb.fill(48, Y, 54, 62, Y + 3, 61, B.STONE_BRICKS);
  mb.fill(50, Y + 4, 56, 60, Y + 4, 59, B.OAK_PLANKS);
  st.ledge = { x: 55, y: Y + 4, z: 57.5 };
  mb.lampPost(48, Y + 4, 54);
  mb.lampPost(62, Y + 4, 54);
  // 7. grenade wall with a dummy behind
  st.nade = { x: 18.5, y: Y, z: 48.5 };
  mb.fill(14, Y, 41, 23, Y + 2, 41, B.STONE_BRICKS);
  st.nadeDummy = { x: 18.5, y: Y, z: 38.5 };
  mb.fill(13, Y, 35, 13, Y + 2, 41, B.STONE_BRICKS);
  mb.fill(24, Y, 35, 24, Y + 2, 41, B.STONE_BRICKS);
  // 8. duel arena (north)
  st.arena = { x: 35.5, y: Y, z: 28.5 };
  st.duel = { x: 35.5, y: Y, z: 20.5 };
  mb.walls(24, Y, 17, 47, Y + 2, 32, B.COBBLE);
  mb.clear(33, Y, 32, 38, Y + 2, 32);
  mb.coverWall(29, 22, 31, 22, Y, B.CRATE, 2);
  mb.coverWall(40, 26, 42, 26, Y, B.CRATE, 2);
  mb.coverWall(34, 24, 37, 24, Y, B.HAY, 1);
  // decorations
  for (const [x, z] of [[6, 100], [65, 100], [6, 30], [65, 30], [65, 86]]) mb.oak(x, Y, z, true);
  mb.decorateGround(5, 5, W - 6, D - 6, 0.2, 0.06);
  w.recomputeHeights();
  return {
    world: w, name: 'Training Grounds', lootSpots: [], chests: mb.chests, landmarks: [],
    spawns: [{ x: st.spawn.x, y: Y, z: st.spawn.z, yaw: 0 }], dropTargets: [], seaLevel: 4, coverHints: mb.coverHints,
    preset: { time: 9.5, weather: 'clear', timeScale: 0 },
    bounds: { x0: 4, z0: 4, x1: W - 4, z1: D - 4 },
    stations: st,
  };
}
