// Cosmetic catalogue: camos, outfits, banners and titles. Everything is
// earned with in-game coins or through play — there are no real-money items.

import { CAMOS } from '../render/camos';
import type { Look, Headgear } from '../render/characters';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CosKind = 'camo' | 'outfit' | 'banner' | 'title';

export interface Cosmetic {
  id: string; // e.g. camo:ember
  kind: CosKind;
  name: string;
  rarity: Rarity;
  source: string; // human description of how to unlock
  price?: number; // shop price in coins (if purchasable)
}

export interface OutfitDef {
  id: string;
  name: string;
  rarity: Rarity;
  shirt: number;
  jacket: number | null;
  pants: number;
  boots: number;
  gloves: number;
  vest: number | null;
  headgear: Headgear;
  hat: number;
  backpack: number | null;
  accent: number;
  camo: string | null;
  goggles?: boolean;
  scarf?: number | null;
  plates?: number | null;
  trim?: number | null;
  mask?: Look['mask'];
  cape?: number | null;
  helm?: Look['helm'];
}

export const OUTFITS: Record<string, OutfitDef> = {
  recruit: { id: 'recruit', name: 'Recruit', rarity: 'common', shirt: 0x4a5a3a, jacket: null, pants: 0x3a3f46, boots: 0x2a2018, gloves: 0x1c1c1c, vest: null, headgear: 'cap', hat: 0x3a4a2a, backpack: null, accent: 0xf2a93b, camo: null },
  ranger: { id: 'ranger', name: 'Ranger', rarity: 'rare', shirt: 0x5a4a3a, jacket: 0x3d4a2a, pants: 0x4a3f30, boots: 0x3a2a1a, gloves: 0x4a3a2a, vest: null, headgear: 'beanie', hat: 0x6a3a1a, backpack: 0x4a5a3a, accent: 0xffe14a, camo: 'woodland' },
  scout: { id: 'scout', name: 'Scout', rarity: 'common', shirt: 0x9a8a6a, jacket: null, pants: 0x6a5a40, boots: 0x4a3a2a, gloves: 0x5a4a3a, vest: 0x6a5a40, headgear: 'bandana', hat: 0x8a2a1a, backpack: 0x6a5a40, accent: 0xff7a2a, camo: null },
  arctic_ops: { id: 'arctic_ops', name: 'Arctic Ops', rarity: 'epic', shirt: 0xdfe4e8, jacket: 0xc8d0d8, pants: 0xb8c0c8, boots: 0x5a6670, gloves: 0x9aa6b0, vest: null, headgear: 'helmet', hat: 0xdfe4e8, backpack: 0xc8d0d8, accent: 0x4ab0ff, camo: 'arctic', goggles: true, plates: 0xeef2f5, mask: 'gas' },
  desert_fox: { id: 'desert_fox', name: 'Desert Fox', rarity: 'rare', shirt: 0xc2a878, jacket: 0x9a7a52, pants: 0xb09468, boots: 0x6a5238, gloves: 0x8a7050, vest: 0x8a7050, headgear: 'visor', hat: 0xc2a878, backpack: null, accent: 0xff9a2a, camo: 'desert', scarf: 0xd8c8a0 },
  night_owl: { id: 'night_owl', name: 'Night Owl', rarity: 'epic', shirt: 0x1a1c22, jacket: 0x23262e, pants: 0x1a1c22, boots: 0x0e0e10, gloves: 0x0e0e10, vest: 0x2a2f38, headgear: 'headset', hat: 0x1a1c22, backpack: 0x23262e, accent: 0x7d5aff, camo: null, trim: 0x7d5aff, goggles: true },
  ember_guard: { id: 'ember_guard', name: 'Ember Guard', rarity: 'epic', shirt: 0x2a1410, jacket: 0x6a1a10, pants: 0x2a1410, boots: 0x1a0a08, gloves: 0x1a0a08, vest: null, headgear: 'helmet', hat: 0x3a1a10, backpack: null, accent: 0xff5a1a, camo: 'ember', plates: 0x3a2018, trim: 0xff5a1a, mask: 'gas' },
  forgeknight: { id: 'forgeknight', name: 'Forgeknight', rarity: 'legendary', shirt: 0x3a3f46, jacket: 0x2a2d31, pants: 0x3a3f46, boots: 0x2a2d31, gloves: 0x5a6068, vest: null, headgear: 'helmet', hat: 0x8a9098, backpack: null, accent: 0xff8a2a, camo: null, plates: 0x8a9098, trim: 0xff8a2a, helm: 'knight', cape: 0x2a2d31 },
  daily_veteran: { id: 'daily_veteran', name: 'Veteran', rarity: 'rare', shirt: 0x3a4a5a, jacket: 0x2a3a4a, pants: 0x2a2f36, boots: 0x1a1a1a, gloves: 0x2a2a2a, vest: 0x3a3f2a, headgear: 'beret', hat: 0x7a1a1a, backpack: 0x3a3f2a, accent: 0xe8c040, camo: null },
  neon_raider: { id: 'neon_raider', name: 'Neon Raider', rarity: 'epic', shirt: 0x14161c, jacket: 0x1c1f28, pants: 0x14161c, boots: 0x0c0d10, gloves: 0x0c0d10, vest: null, headgear: 'hood', hat: 0x1c1f28, backpack: null, accent: 0x3af0ff, camo: null, plates: 0x262a33, trim: 0x3af0ff, mask: 'visor' },
  toxic_reaper: { id: 'toxic_reaper', name: 'Toxic Reaper', rarity: 'epic', shirt: 0x1a2416, jacket: 0x24301c, pants: 0x1a2416, boots: 0x101410, gloves: 0x101410, vest: 0x2e3a22, headgear: 'hood', hat: 0x24301c, backpack: 0x2e3a22, accent: 0x8aff3a, camo: null, trim: 0x8aff3a, mask: 'gas' },
  shadow_ninja: { id: 'shadow_ninja', name: 'Shadow Ninja', rarity: 'epic', shirt: 0x15151a, jacket: 0x1e1e26, pants: 0x15151a, boots: 0x0c0c10, gloves: 0x0c0c10, vest: null, headgear: 'none', hat: 0x15151a, backpack: null, accent: 0xe8283a, camo: null, mask: 'ninja', scarf: 0xb01a2a, trim: 0xe8283a },
  bone_trooper: { id: 'bone_trooper', name: 'Bone Trooper', rarity: 'rare', shirt: 0x2a2a2e, jacket: 0x34343a, pants: 0x2a2a2e, boots: 0x18181b, gloves: 0x18181b, vest: null, headgear: 'none', hat: 0x2a2a2e, backpack: 0x34343a, accent: 0xff3a3a, camo: null, mask: 'skull', plates: 0x46464e },
  inferno_knight: { id: 'inferno_knight', name: 'Inferno Knight', rarity: 'legendary', shirt: 0x1a0d0a, jacket: 0x2a120c, pants: 0x1a0d0a, boots: 0x0e0605, gloves: 0x2a120c, vest: null, headgear: 'none', hat: 0x2a1410, backpack: null, accent: 0xff4a0a, camo: 'inferno', plates: 0x2c1a14, trim: 0xff4a0a, helm: 'horned', cape: 0x5a0a06 },
  harvest_hunter: { id: 'harvest_hunter', name: 'Harvest Hunter', rarity: 'epic', shirt: 0x6a3a14, jacket: 0x4a2a10, pants: 0x3a2a1a, boots: 0x2a1a0a, gloves: 0x4a2a10, vest: 0x8a4a14, headgear: 'hood', hat: 0x5a2a0a, backpack: 0x6a3a14, accent: 0xff8a1a, camo: 'harvest' },
  frost_warden: { id: 'frost_warden', name: 'Frost Warden', rarity: 'epic', shirt: 0xa8d8f0, jacket: 0x5aa0d0, pants: 0x3a6a8a, boots: 0x2a4a6a, gloves: 0x5aa0d0, vest: 0xe8f6ff, headgear: 'beanie', hat: 0xe8f6ff, backpack: 0x5aa0d0, accent: 0x9ae8ff, camo: 'glacier', scarf: 0xe8f6ff },
  storm_runner: { id: 'storm_runner', name: 'Storm Runner', rarity: 'epic', shirt: 0x2a3440, jacket: 0x3a4a5a, pants: 0x2a3440, boots: 0x1a1f26, gloves: 0x1a1f26, vest: 0x4a6a8a, headgear: 'hood', hat: 0x2a3440, backpack: 0x3a4a5a, accent: 0xbfe0ff, camo: 'stormfront', goggles: true, trim: 0xbfe0ff },
  sun_warden: { id: 'sun_warden', name: 'Sun Warden', rarity: 'legendary', shirt: 0xffd25a, jacket: 0xff9a2a, pants: 0x8a3a10, boots: 0x4a1a08, gloves: 0x8a3a10, vest: null, headgear: 'none', hat: 0xffd25a, backpack: null, accent: 0xffe0a0, camo: 'sunforged', plates: 0xe0b040, trim: 0xfff0b0, mask: 'visor', cape: 0xfff2d8 },
  // Ad Vault exclusives (unlocked by watching rewarded ads) and the Lucky Wheel's top prize
  gilded_phantom: { id: 'gilded_phantom', name: 'Gilded Phantom', rarity: 'legendary', shirt: 0x14110a, jacket: 0x1c170c, pants: 0x14110a, boots: 0x0c0a06, gloves: 0x2a2010, vest: null, headgear: 'none', hat: 0x1c170c, backpack: null, accent: 0xffd25a, camo: 'gilded', plates: 0xd8a83a, trim: 0xffe08a, helm: 'knight', cape: 0xc8961e, mask: 'visor' },
  void_ronin: { id: 'void_ronin', name: 'Void Ronin', rarity: 'legendary', shirt: 0x120c1e, jacket: 0x1e1430, pants: 0x120c1e, boots: 0x08060e, gloves: 0x08060e, vest: null, headgear: 'none', hat: 0x1e1430, backpack: null, accent: 0xb45aff, camo: 'prism', plates: 0x2a1e44, trim: 0xc87aff, mask: 'ninja', scarf: 0x7a2aff, helm: 'horned', cape: 0x3a1a6a },
  lucky_ace: { id: 'lucky_ace', name: 'Lucky Ace', rarity: 'legendary', shirt: 0xf2ead8, jacket: 0x0e5a34, pants: 0x0a2a1a, boots: 0x0a0a0a, gloves: 0xf2ead8, vest: 0x0a3a22, headgear: 'beret', hat: 0x0a3a22, backpack: null, accent: 0xffd25a, camo: null, trim: 0xffd25a, plates: 0x1a6a40, cape: 0x0e5a34, goggles: true },
  vanguard: { id: 'vanguard', name: 'Season Vanguard', rarity: 'epic', shirt: 0x2a2f38, jacket: 0x3a2a4a, pants: 0x23262e, boots: 0x15161a, gloves: 0x23262e, vest: null, headgear: 'helmet', hat: 0x3a2a4a, backpack: null, accent: 0xb779ff, camo: null, plates: 0x4a3a6a, trim: 0xb779ff },
};

export const BANNERS: Record<string, { name: string; css: string; rarity: Rarity }> = {
  stone: { name: 'Bedrock', css: 'linear-gradient(135deg,#2a2d33,#3a3f47)', rarity: 'common' },
  meadow: { name: 'Meadow', css: 'linear-gradient(135deg,#2f5a2a,#6a9a3a)', rarity: 'common' },
  tide: { name: 'Tide', css: 'linear-gradient(135deg,#123a5a,#2a8ab0)', rarity: 'rare' },
  ember: { name: 'Ember Glow', css: 'linear-gradient(135deg,#3a0e08,#c2401a 70%,#ff9a3a)', rarity: 'rare' },
  dusk: { name: 'Dusk', css: 'linear-gradient(135deg,#2a1a3a,#8a3a5a 60%,#f2a05a)', rarity: 'rare' },
  forest: { name: 'Canopy', css: 'linear-gradient(135deg,#0e2a1a,#2a5a3a)', rarity: 'common' },
  circuit: { name: 'Circuit', css: 'repeating-linear-gradient(90deg,#0a1a14 0 10px,#123a2a 10px 12px),linear-gradient(#0a1a14,#0a1a14)', rarity: 'epic' },
  aurora: { name: 'Aurora', css: 'linear-gradient(135deg,#0a1a3a,#1a8a7a 50%,#7a4aff)', rarity: 'epic' },
  sunrise: { name: 'Sunrise', css: 'linear-gradient(135deg,#ff7a2a,#ffd25a 60%,#fff2c0)', rarity: 'epic' },
  void: { name: 'Voidglass', css: 'linear-gradient(135deg,#05030a,#2a1a48 60%,#9a5aff)', rarity: 'legendary' },
};

export const TITLES = [
  'Rookie', 'Scrapper', 'Survivor', 'Sharpshooter', 'Architect', 'Demolisher', 'Last Block Standing', 'Centurion', 'Marksman',
  'Scavenger', 'Grenadier', 'Apex', 'Veteran', 'Tactician', 'Forgemaster',
];

/** Ad Vault: exclusive items unlocked by watching this many rewarded ads */
export const VAULT: { id: string; ads: number }[] = [
  { id: 'outfit:gilded_phantom', ads: 3 },
  { id: 'outfit:void_ronin', ads: 3 },
  { id: 'camo:prism', ads: 2 },
];

export const DEFAULT_OWNED = ['camo:factory', 'outfit:recruit', 'banner:stone', 'title:Rookie'];

/** Level-up unlocks */
export const LEVEL_UNLOCKS: Record<number, string> = {
  2: 'camo:woodland',
  3: 'banner:meadow',
  5: 'outfit:ranger',
  8: 'banner:forest',
  10: 'camo:slate',
  15: 'outfit:night_owl',
  20: 'camo:redwood',
  25: 'camo:circuit',
  30: 'outfit:forgeknight',
  40: 'banner:aurora',
  50: 'camo:gilded',
};

const PRICE: Record<Rarity, number> = { common: 400, rare: 800, epic: 1500, legendary: 2400 };

/** cosmetics handed out by the 7-day login track (day number) */
export const DAILY_ITEMS: Record<string, number> = { 'outfit:neon_raider': 2, 'camo:inferno': 3, 'banner:dusk': 4, 'outfit:inferno_knight': 7 };

export function catalog(): Cosmetic[] {
  const out: Cosmetic[] = [];
  const levelOf = (id: string) => Object.entries(LEVEL_UNLOCKS).find(([, v]) => v === id)?.[0];
  const eventCos = new Set(['camo:harvest', 'camo:glacier', 'camo:sunforged', 'camo:stormfront', 'outfit:harvest_hunter', 'outfit:frost_warden', 'outfit:storm_runner', 'outfit:sun_warden', 'banner:sunrise']);
  for (const c of Object.values(CAMOS)) {
    const id = 'camo:' + c.id;
    const lvl = levelOf(id);
    let source = 'Armory';
    let price: number | undefined = PRICE[c.rarity];
    if (c.id === 'factory') { source = 'Default'; price = undefined; }
    else if (lvl) { source = `Reach level ${lvl}`; price = undefined; }
    else if (eventCos.has(id)) { source = 'Limited-time event'; price = undefined; }
    else if (c.id.startsWith('rank_')) { source = 'Ranked season reward'; price = undefined; }
    else if (DAILY_ITEMS[id]) { source = `Daily reward · Day ${DAILY_ITEMS[id]}`; price = undefined; }
    else if (VAULT.some((v) => v.id === id)) { source = `Ad Vault · ${VAULT.find((v) => v.id === id)!.ads} ads`; price = undefined; }
    out.push({ id, kind: 'camo', name: c.name, rarity: c.rarity, source, price });
  }
  for (const o of Object.values(OUTFITS)) {
    const id = 'outfit:' + o.id;
    const lvl = levelOf(id);
    let source = 'Armory';
    let price: number | undefined = PRICE[o.rarity];
    if (o.id === 'recruit') { source = 'Default'; price = undefined; }
    else if (lvl) { source = `Reach level ${lvl}`; price = undefined; }
    else if (eventCos.has(id)) { source = 'Limited-time event'; price = undefined; }
    else if (DAILY_ITEMS[id]) { source = `Daily reward · Day ${DAILY_ITEMS[id]}`; price = undefined; }
    else if (o.id === 'vanguard') { source = 'Reach Gold in any season'; price = undefined; }
    else if (VAULT.some((v) => v.id === id)) { source = `Ad Vault · ${VAULT.find((v) => v.id === id)!.ads} ads`; price = undefined; }
    else if (o.id === 'lucky_ace') { source = 'Lucky Wheel jackpot prize'; price = undefined; }
    out.push({ id, kind: 'outfit', name: o.name, rarity: o.rarity, source, price });
  }
  for (const [k, b] of Object.entries(BANNERS)) {
    const id = 'banner:' + k;
    const lvl = levelOf(id);
    let source = 'Armory';
    let price: number | undefined = PRICE[b.rarity];
    if (k === 'stone') { source = 'Default'; price = undefined; }
    else if (lvl) { source = `Reach level ${lvl}`; price = undefined; }
    else if (eventCos.has(id)) { source = 'Limited-time event'; price = undefined; }
    else if (DAILY_ITEMS[id]) { source = `Daily reward · Day ${DAILY_ITEMS[id]}`; price = undefined; }
    else if (k === 'circuit') { source = 'Achievement: Architect'; price = undefined; }
    else if (k === 'void') { source = 'Reach Obsidian'; price = undefined; }
    out.push({ id, kind: 'banner', name: b.name, rarity: b.rarity, source, price });
  }
  return out;
}

export function cosmeticName(id: string): string {
  const [kind, key] = id.split(':');
  if (kind === 'camo') return (CAMOS[key]?.name ?? key) + ' Camo';
  if (kind === 'outfit') return (OUTFITS[key]?.name ?? key) + ' Outfit';
  if (kind === 'banner') return (BANNERS[key]?.name ?? key) + ' Banner';
  if (kind === 'title') return `Title: ${key}`;
  return id;
}

export function cosmeticRarity(id: string): Rarity {
  const [kind, key] = id.split(':');
  if (kind === 'camo') return CAMOS[key]?.rarity ?? 'common';
  if (kind === 'outfit') return OUTFITS[key]?.rarity ?? 'common';
  if (kind === 'banner') return BANNERS[key]?.rarity ?? 'common';
  return 'rare';
}

export interface BaseLook {
  skin: number;
  hair: number;
  hairStyle: Look['hairStyle'];
  eyes: number;
}

export function composeLook(base: BaseLook, outfitId: string): Look {
  const o = OUTFITS[outfitId] ?? OUTFITS.recruit;
  return {
    skin: base.skin,
    hair: base.hair,
    hairStyle: base.hairStyle,
    eyes: base.eyes,
    shirt: o.shirt,
    jacket: o.jacket,
    pants: o.pants,
    boots: o.boots,
    gloves: o.gloves,
    vest: o.vest,
    headgear: o.headgear,
    hat: o.hat,
    backpack: o.backpack,
    accent: o.accent,
    camo: o.camo,
    beard: false,
    goggles: !!o.goggles,
    scarf: o.scarf ?? null,
    plates: o.plates ?? null,
    trim: o.trim ?? null,
    mask: o.mask ?? null,
    cape: o.cape ?? null,
    helm: o.helm ?? null,
  };
}

export const SKIN_TONES = [0xf5d5b8, 0xf1c8a4, 0xe0ac86, 0xc68a62, 0xa0663e, 0x7a4a2a, 0x5a3520];
export const HAIR_COLORS = [0x1d1510, 0x3a2414, 0x6a3e1e, 0xa66a2c, 0xd8b058, 0x8a8a8a, 0xb03a22, 0xe6e0d0];
export const HAIR_STYLES: Look['hairStyle'][] = ['short', 'buzz', 'long', 'pony', 'mohawk', 'curly', 'bald'];
