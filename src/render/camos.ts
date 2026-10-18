// Weapon / outfit camo patterns (pure cosmetics).
// mode: 0 none, 1 organic blobs, 2 digital blocks, 3 tiger stripes, 4 solid finish

export interface CamoDef {
  id: string;
  name: string;
  mode: number;
  a: number;
  b: number;
  c: number;
  scale: number;
  glow?: boolean;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export const CAMOS: Record<string, CamoDef> = {
  factory: { id: 'factory', name: 'Factory', mode: 0, a: 0, b: 0, c: 0, scale: 1, rarity: 'common' },
  woodland: { id: 'woodland', name: 'Woodland', mode: 1, a: 0x3d4a2a, b: 0x6a6440, c: 0x23241a, scale: 1, rarity: 'common' },
  arctic: { id: 'arctic', name: 'Arctic Pixel', mode: 2, a: 0xd8dde2, b: 0x9aa6b0, c: 0x5a6670, scale: 1, rarity: 'common' },
  desert: { id: 'desert', name: 'Dune', mode: 1, a: 0xc2a878, b: 0x9a7a52, c: 0x6a5238, scale: 1.2, rarity: 'common' },
  ocean: { id: 'ocean', name: 'Riptide', mode: 1, a: 0x1f3a5a, b: 0x2a6a8a, c: 0x0f2030, scale: 0.9, rarity: 'rare' },
  ember: { id: 'ember', name: 'Ember', mode: 3, a: 0x2a1a14, b: 0xc23a14, c: 0xff8a2a, scale: 1, glow: true, rarity: 'epic' },
  gilded: { id: 'gilded', name: 'Gilded', mode: 4, a: 0xd8b048, b: 0xd8b048, c: 0xd8b048, scale: 1, rarity: 'legendary' },
  obsidian: { id: 'obsidian', name: 'Obsidian', mode: 2, a: 0x15111c, b: 0x2a2238, c: 0x5a3a8a, scale: 1, rarity: 'epic' },
  circuit: { id: 'circuit', name: 'Circuit', mode: 2, a: 0x10241e, b: 0x1a3a30, c: 0x3affb0, scale: 0.8, glow: true, rarity: 'epic' },
  redwood: { id: 'redwood', name: 'Redwood', mode: 3, a: 0x5a2a1a, b: 0x8a4a2a, c: 0x2a160e, scale: 1.3, rarity: 'rare' },
  slate: { id: 'slate', name: 'Slate', mode: 2, a: 0x3a3f46, b: 0x55606a, c: 0x22262b, scale: 1, rarity: 'common' },
  sakura: { id: 'sakura', name: 'Blossom', mode: 1, a: 0xf2b8c8, b: 0xd87a9a, c: 0x6a3a4a, scale: 1, rarity: 'rare' },
  inferno: { id: 'inferno', name: 'Inferno', mode: 3, a: 0x1a0806, b: 0xff3a0a, c: 0xffc23a, scale: 0.85, glow: true, rarity: 'legendary' },
  // event exclusives
  harvest: { id: 'harvest', name: 'Harvest Moon', mode: 1, a: 0x6a3a14, b: 0xc26a1a, c: 0x2a1a0a, scale: 1, rarity: 'epic' },
  glacier: { id: 'glacier', name: 'Glacier', mode: 2, a: 0xa8d8f0, b: 0x5aa0d0, c: 0xe8f6ff, scale: 1, glow: false, rarity: 'epic' },
  sunforged: { id: 'sunforged', name: 'Sunforged', mode: 3, a: 0xff9a2a, b: 0xffd25a, c: 0x8a3a10, scale: 1, glow: true, rarity: 'legendary' },
  stormfront: { id: 'stormfront', name: 'Stormfront', mode: 3, a: 0x2a3440, b: 0x4a6a8a, c: 0xbfe0ff, scale: 1.1, glow: true, rarity: 'epic' },
  // ranked season finishes
  rank_copper: { id: 'rank_copper', name: 'Copper Finish', mode: 4, a: 0xb06a3a, b: 0xb06a3a, c: 0xb06a3a, scale: 1, rarity: 'rare' },
  rank_iron: { id: 'rank_iron', name: 'Ironclad', mode: 2, a: 0x8a8f96, b: 0x6a6f76, c: 0xb8bec6, scale: 1, rarity: 'rare' },
  rank_gold: { id: 'rank_gold', name: 'Gold Standard', mode: 4, a: 0xe0b040, b: 0xe0b040, c: 0xe0b040, scale: 1, rarity: 'epic' },
  rank_jade: { id: 'rank_jade', name: 'Jade Vein', mode: 1, a: 0x1a6a4a, b: 0x3aaa7a, c: 0x0a2a1a, scale: 0.9, glow: true, rarity: 'epic' },
  rank_diamond: { id: 'rank_diamond', name: 'Diamond Lattice', mode: 2, a: 0x5ae0e8, b: 0x2a9ab0, c: 0xd8ffff, scale: 0.8, glow: true, rarity: 'legendary' },
  rank_obsidian: { id: 'rank_obsidian', name: 'Voidglass', mode: 2, a: 0x0a0812, b: 0x2a1a48, c: 0x9a5aff, scale: 0.8, glow: true, rarity: 'legendary' },
  rank_forge: { id: 'rank_forge', name: 'Forgemaster', mode: 3, a: 0x1a0a06, b: 0xff5a1a, c: 0xffd27a, scale: 0.9, glow: true, rarity: 'legendary' },
};

export function camoCss(c: CamoDef): string {
  const h = (n: number) => '#' + n.toString(16).padStart(6, '0');
  if (c.mode === 0) return 'linear-gradient(135deg,#2b2e33,#454a52)';
  if (c.mode === 4) return `linear-gradient(135deg, ${h(c.a)}, ${h(c.b)} 60%, #ffffff55)`;
  return `repeating-linear-gradient(45deg, ${h(c.a)} 0 6px, ${h(c.b)} 6px 12px, ${h(c.c)} 12px 16px)`;
}
