// Block registry. Face order everywhere: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z.

export type RenderKind = 'none' | 'opaque' | 'cutout' | 'cross' | 'water';
export type SoundMat = 'grass' | 'dirt' | 'stone' | 'wood' | 'sand' | 'gravel' | 'metal' | 'glass' | 'snow' | 'leaves' | 'water' | 'wool';
export type BuildMat = 'wood' | 'stone' | 'metal';
export type Resource = 'wood' | 'stone' | 'metal' | 'cloth' | 'powder';

export interface BlockDef {
  id: number;
  name: string;
  render: RenderKind;
  solid: boolean;
  opaque: boolean;
  /** texture names per face [+x,-x,+y,-y,+z,-z] */
  tex: string[];
  emit: number;
  atten: number;
  wave: 0 | 1;
  sound: SoundMat;
  color: [number, number, number];
  /** bullets pass through (foliage, plants) */
  bulletPass: boolean;
  /** natural macro colour variation */
  macro: boolean;
  /** Can be harvested with the multitool in Battle Royale */
  harvest?: { res: Resource; amount: number; hp: number; becomes: number; fell?: boolean };
  /** Player-built block */
  built?: { mat: BuildMat; hp: number };
  /** Breakable by gunfire / explosions (BR only) */
  fragile?: { hp: number };
}

const defs: BlockDef[] = [];

function tex6(top: string, bottom: string, side: string, front?: string): string[] {
  // front faces -Z (north) by default for things like chests
  return [side, side, top, bottom, side, front ?? side];
}

function add(id: number, name: string, p: Omit<Partial<BlockDef>, 'tex'> & { tex?: string[] | string }): number {
  const texIn = p.tex;
  const tex = typeof texIn === 'string' ? [texIn, texIn, texIn, texIn, texIn, texIn] : texIn ?? [];
  defs[id] = {
    id,
    name,
    render: p.render ?? 'opaque',
    solid: p.solid ?? true,
    opaque: p.opaque ?? (p.render === undefined || p.render === 'opaque'),
    tex,
    emit: p.emit ?? 0,
    atten: p.atten ?? 0,
    wave: p.wave ?? 0,
    sound: p.sound ?? 'stone',
    color: p.color ?? [128, 128, 128],
    bulletPass: p.bulletPass ?? false,
    macro: p.macro ?? false,
    harvest: p.harvest,
    built: p.built,
    fragile: p.fragile,
  };
  return id;
}

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  SAND: 5,
  GRAVEL: 6,
  WATER: 7,
  OAK_LOG: 8,
  OAK_LEAVES: 9,
  BIRCH_LOG: 10,
  BIRCH_LEAVES: 11,
  SPRUCE_LOG: 12,
  SPRUCE_LEAVES: 13,
  OAK_PLANKS: 14,
  SPRUCE_PLANKS: 15,
  GLASS: 16,
  BRICKS: 17,
  STONE_BRICKS: 18,
  CONCRETE: 19,
  CONCRETE_WHITE: 20,
  METAL_PLATE: 21,
  COAL_ORE: 22,
  IRON_ORE: 23,
  GOLD_ORE: 24,
  DIAMOND_ORE: 25,
  SNOW: 26,
  ICE: 27,
  TERRACOTTA: 28,
  SANDSTONE: 29,
  BEDROCK: 30,
  TALL_GRASS: 31,
  FLOWER_RED: 32,
  FLOWER_YELLOW: 33,
  FERN: 34,
  LAMP: 35,
  CRATE: 36,
  CHEST: 37,
  CHEST_OPEN: 38,
  HAY: 39,
  WOOL_RED: 40,
  WOOL_BLUE: 41,
  WHEAT: 42,
  MOSSY_COBBLE: 43,
  DARK_PLANKS: 44,
  IRON_BARS: 45,
  ASPHALT: 46,
  PATH: 47,
  BUILD_WOOD: 48,
  BUILD_STONE: 49,
  BUILD_METAL: 50,
  BARRIER: 51,
  LIGHT_PANEL: 52,
  CACTUS: 53,
  DEAD_BUSH: 54,
  GRASS_SNOW: 55,
  HAZARD: 56,
  SERVER: 57,
  BOOKSHELF: 58,
  BOULDER: 59,
  TILE_FLOOR: 60,
  VENT: 61,
  TERRACOTTA_RED: 62,
  ROOF: 63,
  GLASS_PANE_DARK: 64,
  WOOL_WHITE: 65,
  COAL_DEPLETED: 66,
} as const;

add(B.AIR, 'air', { render: 'none', solid: false, opaque: false, bulletPass: true });
add(B.GRASS, 'grass', { tex: tex6('grass_top', 'dirt', 'grass_side'), sound: 'grass', color: [96, 150, 58], macro: true });
add(B.DIRT, 'dirt', { tex: 'dirt', sound: 'dirt', color: [121, 85, 58], macro: true });
add(B.STONE, 'stone', { tex: 'stone', sound: 'stone', color: [125, 125, 125], macro: true });
add(B.COBBLE, 'cobblestone', { tex: 'cobble', sound: 'stone', color: [115, 115, 115] });
add(B.SAND, 'sand', { tex: 'sand', sound: 'sand', color: [219, 205, 152], macro: true });
add(B.GRAVEL, 'gravel', { tex: 'gravel', sound: 'gravel', color: [130, 124, 120], macro: true });
add(B.WATER, 'water', { render: 'water', solid: false, opaque: false, atten: 1, tex: 'water', sound: 'water', color: [48, 92, 160], bulletPass: true });
add(B.OAK_LOG, 'oak log', {
  tex: tex6('oak_log_top', 'oak_log_top', 'oak_log'),
  sound: 'wood',
  color: [104, 80, 50],
  harvest: { res: 'wood', amount: 5, hp: 50, becomes: 0, fell: true },
});
add(B.OAK_LEAVES, 'oak leaves', {
  render: 'cutout', opaque: false, atten: 2, wave: 1, tex: 'oak_leaves', sound: 'leaves', color: [70, 128, 44], bulletPass: true, macro: true,
  harvest: { res: 'wood', amount: 1, hp: 10, becomes: 0 },
});
add(B.BIRCH_LOG, 'birch log', {
  tex: tex6('birch_log_top', 'birch_log_top', 'birch_log'),
  sound: 'wood',
  color: [214, 210, 196],
  harvest: { res: 'wood', amount: 5, hp: 50, becomes: 0, fell: true },
});
add(B.BIRCH_LEAVES, 'birch leaves', {
  render: 'cutout', opaque: false, atten: 2, wave: 1, tex: 'birch_leaves', sound: 'leaves', color: [104, 160, 72], bulletPass: true, macro: true,
  harvest: { res: 'wood', amount: 1, hp: 10, becomes: 0 },
});
add(B.SPRUCE_LOG, 'spruce log', {
  tex: tex6('spruce_log_top', 'spruce_log_top', 'spruce_log'),
  sound: 'wood',
  color: [72, 52, 32],
  harvest: { res: 'wood', amount: 5, hp: 50, becomes: 0, fell: true },
});
add(B.SPRUCE_LEAVES, 'spruce leaves', {
  render: 'cutout', opaque: false, atten: 2, wave: 1, tex: 'spruce_leaves', sound: 'leaves', color: [48, 88, 60], bulletPass: true, macro: true,
  harvest: { res: 'wood', amount: 1, hp: 10, becomes: 0 },
});
add(B.OAK_PLANKS, 'oak planks', { tex: 'oak_planks', sound: 'wood', color: [168, 132, 82] });
add(B.SPRUCE_PLANKS, 'spruce planks', { tex: 'spruce_planks', sound: 'wood', color: [112, 82, 50] });
add(B.GLASS, 'glass', { render: 'cutout', opaque: false, tex: 'glass', sound: 'glass', color: [200, 230, 240], fragile: { hp: 1 } });
add(B.BRICKS, 'bricks', { tex: 'bricks', sound: 'stone', color: [150, 80, 64] });
add(B.STONE_BRICKS, 'stone bricks', { tex: 'stone_bricks', sound: 'stone', color: [120, 120, 120] });
add(B.CONCRETE, 'concrete', { tex: 'concrete', sound: 'stone', color: [138, 141, 144] });
add(B.CONCRETE_WHITE, 'white concrete', { tex: 'concrete_white', sound: 'stone', color: [205, 208, 210] });
add(B.METAL_PLATE, 'metal plate', { tex: 'metal_plate', sound: 'metal', color: [118, 126, 134] });
add(B.COAL_ORE, 'coal ore', { tex: 'coal_ore', sound: 'stone', color: [90, 90, 90], harvest: { res: 'powder', amount: 4, hp: 60, becomes: 66 } });
add(B.IRON_ORE, 'iron ore', { tex: 'iron_ore', sound: 'stone', color: [150, 130, 115], harvest: { res: 'metal', amount: 6, hp: 80, becomes: 66 } });
add(B.GOLD_ORE, 'gold ore', { tex: 'gold_ore', sound: 'stone', color: [180, 160, 80], harvest: { res: 'metal', amount: 10, hp: 90, becomes: 66 } });
add(B.DIAMOND_ORE, 'diamond ore', { tex: 'diamond_ore', sound: 'stone', color: [110, 180, 190], harvest: { res: 'metal', amount: 16, hp: 110, becomes: 66 } });
add(B.SNOW, 'snow', { tex: 'snow', sound: 'snow', color: [236, 242, 246], macro: true });
add(B.ICE, 'ice', { tex: 'ice', sound: 'glass', color: [150, 196, 238] });
add(B.TERRACOTTA, 'terracotta', { tex: 'terracotta', sound: 'stone', color: [160, 90, 52] });
add(B.SANDSTONE, 'sandstone', { tex: tex6('sandstone_top', 'sandstone_top', 'sandstone_side'), sound: 'stone', color: [214, 196, 140] });
add(B.BEDROCK, 'bedrock', { tex: 'bedrock', sound: 'stone', color: [60, 60, 60] });
add(B.TALL_GRASS, 'tall grass', { render: 'cross', solid: false, opaque: false, tex: 'tall_grass', sound: 'grass', color: [90, 150, 60], bulletPass: true, macro: true });
add(B.FLOWER_RED, 'red flower', { render: 'cross', solid: false, opaque: false, tex: 'flower_red', sound: 'grass', color: [200, 40, 40], bulletPass: true });
add(B.FLOWER_YELLOW, 'yellow flower', { render: 'cross', solid: false, opaque: false, tex: 'flower_yellow', sound: 'grass', color: [230, 210, 60], bulletPass: true });
add(B.FERN, 'fern', { render: 'cross', solid: false, opaque: false, tex: 'fern', sound: 'grass', color: [70, 130, 60], bulletPass: true, macro: true });
add(B.LAMP, 'lamp', { tex: 'lamp', emit: 15, sound: 'glass', color: [250, 210, 120] });
add(B.CRATE, 'crate', { tex: tex6('crate_top', 'crate_top', 'crate'), sound: 'wood', color: [150, 110, 64], harvest: { res: 'wood', amount: 4, hp: 40, becomes: 0 } });
add(B.CHEST, 'supply chest', { tex: tex6('chest_top', 'chest_top', 'chest_side', 'chest_front'), sound: 'wood', color: [170, 120, 50] });
add(B.CHEST_OPEN, 'opened chest', { tex: tex6('chest_open_top', 'chest_top', 'chest_side', 'chest_open_front'), sound: 'wood', color: [120, 90, 50] });
add(B.HAY, 'hay bale', { tex: tex6('hay_top', 'hay_top', 'hay_side'), sound: 'grass', color: [200, 170, 60] });
add(B.WOOL_RED, 'red wool', { tex: 'wool_red', sound: 'wool', color: [170, 50, 46] });
add(B.WOOL_BLUE, 'blue wool', { tex: 'wool_blue', sound: 'wool', color: [50, 80, 170] });
add(B.WHEAT, 'wheat', { render: 'cross', solid: false, opaque: false, tex: 'wheat', sound: 'grass', color: [200, 180, 80], bulletPass: true });
add(B.MOSSY_COBBLE, 'mossy cobblestone', { tex: 'mossy_cobble', sound: 'stone', color: [100, 120, 90] });
add(B.DARK_PLANKS, 'dark planks', { tex: 'dark_planks', sound: 'wood', color: [72, 50, 32] });
add(B.IRON_BARS, 'iron bars', { render: 'cutout', opaque: false, tex: 'iron_bars', sound: 'metal', color: [110, 110, 110], bulletPass: true });
add(B.ASPHALT, 'asphalt', { tex: 'asphalt', sound: 'stone', color: [60, 62, 65], macro: true });
add(B.PATH, 'path', { tex: tex6('path_top', 'dirt', 'dirt'), sound: 'gravel', color: [150, 122, 76], macro: true });
add(B.BUILD_WOOD, 'wood panel', { tex: 'build_wood', sound: 'wood', color: [184, 140, 80], built: { mat: 'wood', hp: 45 } });
add(B.BUILD_STONE, 'stone panel', { tex: 'build_stone', sound: 'stone', color: [140, 140, 136], built: { mat: 'stone', hp: 110 } });
add(B.BUILD_METAL, 'steel panel', { tex: 'build_metal', sound: 'metal', color: [120, 132, 142], built: { mat: 'metal', hp: 220 } });
add(B.BARRIER, 'barrier', { render: 'none', opaque: false, color: [0, 0, 0] });
add(B.LIGHT_PANEL, 'light panel', { tex: 'light_panel', emit: 14, sound: 'glass', color: [220, 236, 250] });
add(B.CACTUS, 'cactus', { tex: tex6('cactus_top', 'cactus_top', 'cactus_side'), sound: 'grass', color: [70, 130, 50] });
add(B.DEAD_BUSH, 'dead bush', { render: 'cross', solid: false, opaque: false, tex: 'dead_bush', sound: 'grass', color: [140, 100, 50], bulletPass: true });
add(B.GRASS_SNOW, 'snowy grass', { tex: tex6('snow', 'dirt', 'grass_snow_side'), sound: 'snow', color: [230, 238, 242], macro: true });
add(B.HAZARD, 'hazard block', { tex: 'hazard', sound: 'metal', color: [210, 170, 30] });
add(B.SERVER, 'server rack', { tex: tex6('metal_plate', 'metal_plate', 'server'), emit: 5, sound: 'metal', color: [50, 56, 62] });
add(B.BOOKSHELF, 'bookshelf', { tex: tex6('oak_planks', 'oak_planks', 'bookshelf'), sound: 'wood', color: [120, 80, 50] });
add(B.BOULDER, 'boulder', { tex: 'boulder', sound: 'stone', color: [140, 136, 128], harvest: { res: 'stone', amount: 6, hp: 70, becomes: 0 } });
add(B.TILE_FLOOR, 'tile floor', { tex: 'tile_floor', sound: 'stone', color: [190, 192, 196] });
add(B.VENT, 'vent', { tex: 'vent', sound: 'metal', color: [90, 96, 102] });
add(B.TERRACOTTA_RED, 'red terracotta', { tex: 'terracotta_red', sound: 'stone', color: [143, 60, 46] });
add(B.ROOF, 'roof shingles', { tex: 'roof', sound: 'wood', color: [96, 52, 40] });
add(B.GLASS_PANE_DARK, 'tinted glass', { render: 'cutout', opaque: false, tex: 'glass_dark', sound: 'glass', color: [60, 80, 90], fragile: { hp: 1 } });
add(B.WOOL_WHITE, 'white wool', { tex: 'wool_white', sound: 'wool', color: [230, 230, 230] });
add(B.COAL_DEPLETED, 'quarried stone', { tex: 'stone', sound: 'stone', color: [125, 125, 125], macro: true });

export const BLOCKS: BlockDef[] = defs;
export const BLOCK_COUNT = 256;

// Fast lookup tables used by the mesher, lighting and physics.
export const IS_SOLID = new Uint8Array(BLOCK_COUNT);
export const IS_OPAQUE = new Uint8Array(BLOCK_COUNT);
export const RENDER = new Uint8Array(BLOCK_COUNT); // 0 none, 1 opaque, 2 cutout, 3 cross, 4 water
export const EMIT = new Uint8Array(BLOCK_COUNT);
export const ATTEN = new Uint8Array(BLOCK_COUNT);
export const BULLET_PASS = new Uint8Array(BLOCK_COUNT);
export const AO_CASTER = new Uint8Array(BLOCK_COUNT);

for (let i = 0; i < BLOCK_COUNT; i++) {
  const d = defs[i];
  if (!d) {
    BULLET_PASS[i] = 1;
    continue;
  }
  IS_SOLID[i] = d.solid ? 1 : 0;
  IS_OPAQUE[i] = d.opaque ? 1 : 0;
  RENDER[i] = { none: 0, opaque: 1, cutout: 2, cross: 3, water: 4 }[d.render];
  EMIT[i] = d.emit;
  ATTEN[i] = d.atten;
  BULLET_PASS[i] = d.bulletPass ? 1 : 0;
  AO_CASTER[i] = d.opaque || d.render === 'cutout' ? 1 : 0;
}
// Glass and bars should not darken corners
AO_CASTER[B.GLASS] = 0;
AO_CASTER[B.GLASS_PANE_DARK] = 0;
AO_CASTER[B.IRON_BARS] = 0;

export function isLeaves(id: number) {
  return id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES;
}
export function isLog(id: number) {
  return id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG;
}
export function isBuilt(id: number) {
  return id === B.BUILD_WOOD || id === B.BUILD_STONE || id === B.BUILD_METAL;
}
export function buildBlockFor(mat: BuildMat) {
  return mat === 'wood' ? B.BUILD_WOOD : mat === 'stone' ? B.BUILD_STONE : B.BUILD_METAL;
}
/** Plants and other things a block can replace when placed. */
export function isReplaceable(id: number) {
  return id === B.AIR || RENDER[id] === 3 || id === B.WATER;
}
