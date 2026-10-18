// Weapon, ammo and item definitions plus per-instance weapon state.

export type WeaponId = 'p9' | 'hornet' | 'ranger' | 'volk' | 'breacher' | 'arbiter' | 'longshot' | 'thumper';
export type AmmoType = 'light' | 'medium' | 'shells' | 'heavy' | 'rockets';
export type Category = 'pistol' | 'smg' | 'ar' | 'shotgun' | 'dmr' | 'sniper' | 'launcher';
export type ReloadKind = 'mag' | 'shell' | 'rocket';
export type ActionKind = 'semi' | 'auto' | 'pump' | 'bolt' | 'single';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  short: string;
  category: Category;
  ammo: AmmoType;
  mag: number;
  rpm: number;
  action: ActionKind;
  damage: number;
  headMult: number;
  pellets: number;
  /** falloff start, end (blocks), minimum multiplier */
  falloff: [number, number, number];
  range: number;
  /** spread in degrees */
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  spreadAir: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecover: number;
  /** recoil degrees per shot */
  recoilV: number;
  recoilH: number;
  recoilRecover: number;
  adsTime: number;
  adsZoom: number;
  scope?: { zooms: number[]; sens: number };
  reload: { kind: ReloadKind; time: number; empty: number; perShell?: number };
  /** delay after shot before next for pump/bolt (cycling animation) */
  cycle?: number;
  equipTime: number;
  moveMult: number;
  projectile?: { speed: number; gravity: number; explode?: { radius: number; damage: number } };
  blockDamage: number;
  soundKey: string;
  lootWeight: number;
  tier: 'common' | 'rare' | 'epic';
  /** short flavour for loot cards */
  blurb: string;
  /** bot preference ranges */
  idealRange: [number, number];
}

export const AMMO_NAMES: Record<AmmoType, string> = {
  light: 'Light Rounds',
  medium: 'Medium Rounds',
  shells: 'Shells',
  heavy: 'Heavy Rounds',
  rockets: 'Rockets',
};
export const AMMO_PICKUP: Record<AmmoType, number> = { light: 36, medium: 30, shells: 8, heavy: 8, rockets: 2 };
export const AMMO_MAX: Record<AmmoType, number> = { light: 240, medium: 210, shells: 40, heavy: 40, rockets: 8 };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  p9: {
    id: 'p9', name: 'Vex P9', short: 'PISTOL', category: 'pistol', ammo: 'light', mag: 15, rpm: 420, action: 'semi',
    damage: 23, headMult: 1.9, pellets: 1, falloff: [16, 45, 0.6], range: 140,
    spreadHip: 1.6, spreadAds: 0.25, spreadMove: 1.2, spreadAir: 3, bloomPerShot: 0.55, bloomMax: 2.5, bloomRecover: 9,
    recoilV: 1.5, recoilH: 0.5, recoilRecover: 10, adsTime: 0.14, adsZoom: 0.8,
    reload: { kind: 'mag', time: 1.25, empty: 1.5 }, equipTime: 0.3, moveMult: 1.0,
    blockDamage: 0.8, soundKey: 'pistol', lootWeight: 10, tier: 'common', blurb: 'Reliable sidearm. Fast handling.', idealRange: [0, 30],
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', short: 'SMG', category: 'smg', ammo: 'light', mag: 30, rpm: 880, action: 'auto',
    damage: 16, headMult: 1.5, pellets: 1, falloff: [12, 34, 0.55], range: 120,
    spreadHip: 2.2, spreadAds: 0.6, spreadMove: 0.8, spreadAir: 3, bloomPerShot: 0.18, bloomMax: 2.2, bloomRecover: 7,
    recoilV: 0.5, recoilH: 0.45, recoilRecover: 9, adsTime: 0.16, adsZoom: 0.75,
    reload: { kind: 'mag', time: 1.6, empty: 1.95 }, equipTime: 0.35, moveMult: 1.0,
    blockDamage: 0.7, soundKey: 'smg', lootWeight: 9, tier: 'common', blurb: 'Blistering fire rate up close.', idealRange: [0, 22],
  },
  ranger: {
    id: 'ranger', name: 'Ranger AR', short: 'RIFLE', category: 'ar', ammo: 'medium', mag: 30, rpm: 660, action: 'auto',
    damage: 24, headMult: 1.7, pellets: 1, falloff: [32, 90, 0.72], range: 220,
    spreadHip: 2.4, spreadAds: 0.18, spreadMove: 1.4, spreadAir: 4, bloomPerShot: 0.22, bloomMax: 1.9, bloomRecover: 6,
    recoilV: 0.62, recoilH: 0.32, recoilRecover: 7, adsTime: 0.22, adsZoom: 0.62,
    reload: { kind: 'mag', time: 2.0, empty: 2.45 }, equipTime: 0.45, moveMult: 0.95,
    blockDamage: 1, soundKey: 'rifle', lootWeight: 8, tier: 'common', blurb: 'Balanced rifle for every range.', idealRange: [8, 70],
  },
  volk: {
    id: 'volk', name: 'Volk-47', short: 'RIFLE', category: 'ar', ammo: 'medium', mag: 30, rpm: 560, action: 'auto',
    damage: 30, headMult: 1.75, pellets: 1, falloff: [30, 85, 0.7], range: 220,
    spreadHip: 2.8, spreadAds: 0.26, spreadMove: 1.6, spreadAir: 4.5, bloomPerShot: 0.3, bloomMax: 2.3, bloomRecover: 5.5,
    recoilV: 0.95, recoilH: 0.5, recoilRecover: 6, adsTime: 0.25, adsZoom: 0.66,
    reload: { kind: 'mag', time: 2.25, empty: 2.7 }, equipTime: 0.5, moveMult: 0.93,
    blockDamage: 1.1, soundKey: 'rifle_heavy', lootWeight: 6, tier: 'rare', blurb: 'Hard-hitting, harder to tame.', idealRange: [8, 60],
  },
  breacher: {
    id: 'breacher', name: 'Breacher 12', short: 'SHOTGUN', category: 'shotgun', ammo: 'shells', mag: 6, rpm: 75, action: 'pump',
    damage: 11, headMult: 1.5, pellets: 9, falloff: [6, 20, 0.3], range: 45,
    spreadHip: 5.2, spreadAds: 4.0, spreadMove: 0.8, spreadAir: 1.5, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
    recoilV: 4.5, recoilH: 1.2, recoilRecover: 7, adsTime: 0.2, adsZoom: 0.85,
    reload: { kind: 'shell', time: 0.5, empty: 0.5, perShell: 0.48 }, cycle: 0.62, equipTime: 0.45, moveMult: 0.96,
    blockDamage: 1.3, soundKey: 'shotgun', lootWeight: 7, tier: 'common', blurb: 'Pump-action room clearer.', idealRange: [0, 12],
  },
  arbiter: {
    id: 'arbiter', name: 'Arbiter DMR', short: 'MARKSMAN', category: 'dmr', ammo: 'heavy', mag: 10, rpm: 260, action: 'semi',
    damage: 44, headMult: 2.0, pellets: 1, falloff: [60, 150, 0.85], range: 280,
    spreadHip: 3.0, spreadAds: 0.08, spreadMove: 2.2, spreadAir: 5, bloomPerShot: 0.6, bloomMax: 2.5, bloomRecover: 6,
    recoilV: 2.4, recoilH: 0.6, recoilRecover: 8, adsTime: 0.28, adsZoom: 0.45,
    scope: { zooms: [2.5], sens: 0.55 },
    reload: { kind: 'mag', time: 2.2, empty: 2.6 }, equipTime: 0.55, moveMult: 0.92,
    projectile: { speed: 420, gravity: 6 },
    blockDamage: 1.4, soundKey: 'dmr', lootWeight: 4, tier: 'rare', blurb: 'Semi-auto precision at range.', idealRange: [30, 140],
  },
  longshot: {
    id: 'longshot', name: 'Longshot .338', short: 'SNIPER', category: 'sniper', ammo: 'heavy', mag: 5, rpm: 46, action: 'bolt',
    damage: 105, headMult: 2.4, pellets: 1, falloff: [120, 260, 0.9], range: 340,
    spreadHip: 6, spreadAds: 0.0, spreadMove: 4, spreadAir: 8, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
    recoilV: 5.5, recoilH: 1.0, recoilRecover: 5, adsTime: 0.34, adsZoom: 0.25,
    scope: { zooms: [4, 8], sens: 0.4 },
    reload: { kind: 'mag', time: 2.9, empty: 3.3 }, cycle: 1.0, equipTime: 0.65, moveMult: 0.88,
    projectile: { speed: 520, gravity: 7 },
    blockDamage: 2.2, soundKey: 'sniper', lootWeight: 3, tier: 'epic', blurb: 'Bolt-action. One clean headshot ends it.', idealRange: [50, 240],
  },
  thumper: {
    id: 'thumper', name: 'Thumper RL', short: 'LAUNCHER', category: 'launcher', ammo: 'rockets', mag: 1, rpm: 60, action: 'single',
    damage: 0, headMult: 1, pellets: 1, falloff: [0, 1, 1], range: 200,
    spreadHip: 1.2, spreadAds: 0.3, spreadMove: 1.5, spreadAir: 3, bloomPerShot: 0, bloomMax: 0, bloomRecover: 10,
    recoilV: 6, recoilH: 1.5, recoilRecover: 4, adsTime: 0.3, adsZoom: 0.7,
    reload: { kind: 'rocket', time: 2.6, empty: 2.6 }, equipTime: 0.7, moveMult: 0.85,
    projectile: { speed: 48, gravity: 2.5, explode: { radius: 5, damage: 115 } },
    blockDamage: 1, soundKey: 'launcher', lootWeight: 1.5, tier: 'epic', blurb: 'Shreds structures. Splash damage.', idealRange: [12, 80],
  },
};

export const WEAPON_LIST: WeaponId[] = ['p9', 'hornet', 'ranger', 'volk', 'breacher', 'arbiter', 'longshot', 'thumper'];

export class WeaponInstance {
  mag: number;
  lastShot = -10;
  bloom = 0;
  /** remaining time of pump/bolt cycle */
  cycling = 0;
  reloading = 0;
  reloadTotal = 0;
  reloadShells = 0;
  triggerHeld = false;
  constructor(public def: WeaponDef, mag?: number) {
    this.mag = mag ?? def.mag;
  }
  get interval() {
    return 60 / this.def.rpm;
  }
}

// ---------------------------------------------------------------- items
export type HealKind = 'bandage' | 'medkit' | 'plate';
export type ThrowKind = 'frag' | 'smoke';

export const HEALS: Record<HealKind, { name: string; time: number; hp: number; armor: number; max: number; cap: number; blurb: string }> = {
  bandage: { name: 'Bandage', time: 2.6, hp: 20, armor: 0, max: 75, cap: 15, blurb: '+20 HP (up to 75)' },
  medkit: { name: 'Medkit', time: 5.5, hp: 100, armor: 0, max: 100, cap: 5, blurb: 'Full heal' },
  plate: { name: 'Armor Plate', time: 2.2, hp: 0, armor: 25, max: 100, cap: 10, blurb: '+25 Armor' },
};

export const THROWABLES: Record<ThrowKind, { name: string; fuse: number; cap: number; blurb: string }> = {
  frag: { name: 'Frag Grenade', fuse: 2.6, cap: 6, blurb: 'Bounces, then blasts a 5.5m radius' },
  smoke: { name: 'Smoke Grenade', fuse: 1.6, cap: 4, blurb: 'Blocks line of sight for 14s' },
};

export const FRAG = { radius: 5.5, damage: 110, blockDamage: 150 };

export type MaterialKind = 'wood' | 'stone' | 'metal' | 'cloth' | 'powder';
export const MATERIALS: Record<MaterialKind, { name: string; cap: number; color: string }> = {
  wood: { name: 'Wood', cap: 500, color: '#c48c4a' },
  stone: { name: 'Stone', cap: 500, color: '#a3a7ad' },
  metal: { name: 'Metal', cap: 500, color: '#7fb2d6' },
  cloth: { name: 'Cloth', cap: 60, color: '#e8d7b8' },
  powder: { name: 'Powder', cap: 60, color: '#d36a4a' },
};

export type ArmorTier = 1 | 2 | 3;
export const ARMOR_VEST: Record<ArmorTier, { name: string; armor: number }> = {
  1: { name: 'Light Vest', armor: 50 },
  2: { name: 'Combat Vest', armor: 75 },
  3: { name: 'Heavy Vest', armor: 100 },
};

/** A world/inventory item description. */
export type ItemSpec =
  | { kind: 'weapon'; weapon: WeaponId; mag?: number }
  | { kind: 'ammo'; ammo: AmmoType; count: number }
  | { kind: 'heal'; heal: HealKind; count: number }
  | { kind: 'throw'; throw: ThrowKind; count: number }
  | { kind: 'mat'; mat: MaterialKind; count: number }
  | { kind: 'armor'; tier: ArmorTier };

export function itemName(it: ItemSpec): string {
  switch (it.kind) {
    case 'weapon':
      return WEAPONS[it.weapon].name;
    case 'ammo':
      return `${AMMO_NAMES[it.ammo]} ×${it.count}`;
    case 'heal':
      return `${HEALS[it.heal].name}${it.count > 1 ? ` ×${it.count}` : ''}`;
    case 'throw':
      return `${THROWABLES[it.throw].name}${it.count > 1 ? ` ×${it.count}` : ''}`;
    case 'mat':
      return `${MATERIALS[it.mat].name} ×${it.count}`;
    case 'armor':
      return ARMOR_VEST[it.tier].name;
  }
}

export function itemTier(it: ItemSpec): 'common' | 'rare' | 'epic' {
  if (it.kind === 'weapon') return WEAPONS[it.weapon].tier;
  if (it.kind === 'armor') return it.tier === 3 ? 'epic' : it.tier === 2 ? 'rare' : 'common';
  if (it.kind === 'heal' && it.heal === 'medkit') return 'rare';
  return 'common';
}
