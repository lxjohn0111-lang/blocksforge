// Blocky humanoid characters: per-identity unique looks built as skinned
// voxel models (6 bones), procedural animation and a held third-person weapon.

import * as THREE from 'three';
import type { VBox, MatKind } from './voxelModel';
import { buildVoxelGeometry, createEntityMaterial } from './voxelModel';
import { weaponWorldGeometry, cachedGeometry, pickaxeModel, hammerModel, fragModel } from './weaponModels';
import type { WeaponId } from '../game/weapons';
import { RNG } from '../core/rng';
import { CAMOS, type CamoDef } from './camos';
import { SHADOW_LAYER } from './shadows';

export const PX = 1.8 / 32; // character pixel size in blocks

export type Headgear = 'none' | 'cap' | 'beanie' | 'helmet' | 'hood' | 'headset' | 'bandana' | 'beret' | 'visor';
export type HairStyle = 'short' | 'buzz' | 'long' | 'pony' | 'mohawk' | 'bald' | 'curly';

export interface Look {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  eyes: number;
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
  beard: boolean;
  goggles: boolean;
  scarf: number | null;
  /** premium outfit parts */
  plates?: number | null; // armour: chest plate, shoulder pads, knee pads
  trim?: number | null; // glowing seams
  mask?: 'gas' | 'skull' | 'visor' | 'ninja' | null;
  cape?: number | null;
  helm?: 'knight' | 'horned' | null; // full helmet, replaces headgear and hair
}

const SKINS = [0xf1c8a4, 0xe0ac86, 0xc68a62, 0xa0663e, 0x7a4a2a, 0x5a3520, 0xf5d5b8, 0xd9a07a];
const HAIRS = [0x1d1510, 0x3a2414, 0x6a3e1e, 0xa66a2c, 0xd8b058, 0x8a8a8a, 0xb03a22, 0x2a2a3a, 0xe6e0d0];
const EYES = [0x2a5a8a, 0x3a6a2a, 0x5a3a1a, 0x2a2a2a, 0x6a8aa0];
const CLOTH = [0x3a4a2a, 0x4a5a3a, 0x2a3a4a, 0x5a4a3a, 0x6a2a2a, 0x2a2a2a, 0x7a6a4a, 0x3a5a6a, 0x5a5a5a, 0x8a3a1a, 0x2a4a3a, 0x4a3a5a, 0x9a8a6a, 0x1f3550, 0x6b2b45, 0xb07020];
const ACCENTS = [0xf2a93b, 0x4ab0ff, 0xff4a6a, 0x7aff7a, 0xc77dff, 0xffe14a, 0x3affd8, 0xff7a2a];

export function randomLook(seed: number): Look {
  const r = new RNG(seed);
  const headgears: Headgear[] = ['none', 'cap', 'beanie', 'helmet', 'hood', 'headset', 'bandana', 'beret', 'visor'];
  const hairStyles: HairStyle[] = ['short', 'buzz', 'long', 'pony', 'mohawk', 'bald', 'curly'];
  const camoKeys = Object.keys(CAMOS).filter((k) => k !== 'factory');
  return {
    skin: r.pick(SKINS),
    hair: r.pick(HAIRS),
    hairStyle: r.pick(hairStyles),
    eyes: r.pick(EYES),
    shirt: r.pick(CLOTH),
    jacket: r.chance(0.55) ? r.pick(CLOTH) : null,
    pants: r.pick(CLOTH),
    boots: r.pick([0x1c1c1c, 0x3a2a1a, 0x4a3a2a, 0x2a2a2a, 0x5a4a3a]),
    gloves: r.pick([0x1c1c1c, 0x2a2a2a, 0x4a3a2a, 0x3a4a2a, 0x5a5a5a]),
    vest: r.chance(0.5) ? r.pick([0x2a2f22, 0x3a3f2a, 0x24282e, 0x4a4030, 0x3a3a3a]) : null,
    headgear: r.pick(headgears),
    hat: r.pick(CLOTH),
    backpack: r.chance(0.45) ? r.pick(CLOTH) : null,
    accent: r.pick(ACCENTS),
    camo: r.chance(0.3) ? r.pick(camoKeys) : null,
    beard: r.chance(0.18),
    goggles: r.chance(0.15),
    scarf: r.chance(0.18) ? r.pick(CLOTH) : null,
    plates: r.chance(0.16) ? r.pick([0x3a3f46, 0x4a4030, 0x2a2f38, 0x5a5a5a]) : null,
    trim: r.chance(0.08) ? r.pick(ACCENTS) : null,
    mask: r.chance(0.1) ? r.pick(['gas', 'skull', 'visor'] as const) : null,
  };
}

const B_BODY = 0, B_HEAD = 1, B_RARM = 2, B_LARM = 3, B_RLEG = 4, B_LLEG = 5;

function bx(min: [number, number, number], max: [number, number, number], color: number, bone: number, mat: MatKind = 'cloth', camo = false): VBox {
  return { min, max, color, mat, bone, camo };
}

/** Build the character box list in character pixels (origin at feet). */
export function characterBoxes(L: Look, armorTier = 0): VBox[] {
  const o: VBox[] = [];
  const shirt = L.shirt;
  const top = L.jacket ?? L.shirt;
  const camo = !!L.camo;
  // legs
  for (const [bone, x0] of [[B_RLEG, 0], [B_LLEG, -4]] as const) {
    o.push(bx([x0, 3, -2], [x0 + 4, 12, 2], L.pants, bone, 'cloth', camo));
    o.push(bx([x0 - 0.1, 0, -2.3], [x0 + 4.1, 3, 2.1], L.boots, bone, 'rubber'));
    o.push(bx([x0 - 0.1, 0, -2.4], [x0 + 4.1, 0.8, 2.2], 0x111111, bone, 'rubber'));
    o.push(bx([x0 + 0.5, 6, -2.15], [x0 + 3.5, 8, -2.0], 0x1a1a1a, bone, 'rubber'));
  }
  // torso
  o.push(bx([-4, 12, -2], [4, 24, 2], top, B_BODY, 'cloth', camo && !!L.jacket));
  if (L.jacket) {
    o.push(bx([-1.5, 14, -2.1], [1.5, 24, -2.0], shirt, B_BODY));
    o.push(bx([-0.15, 13, -2.15], [0.15, 23, -2.05], 0x2a2a2a, B_BODY, 'metal'));
  }
  o.push(bx([-4.1, 12, -2.1], [4.1, 13, 2.1], 0x2a2018, B_BODY, 'rubber'));
  o.push(bx([-0.7, 12.1, -2.25], [0.7, 12.9, -2.1], 0xb8a060, B_BODY, 'metal'));
  if (L.vest !== null || armorTier > 0) {
    const vc = armorTier === 3 ? 0x2a2f38 : armorTier === 2 ? 0x4a5234 : L.vest ?? 0x6a5a40;
    o.push(bx([-4.3, 14, -2.4], [4.3, 22.5, 2.3], vc, B_BODY, 'cloth'));
    for (const x of [-3, -0.5, 2]) o.push(bx([x - 0.1, 14.5, -2.9], [x + 1.6, 17.5, -2.4], 0x22252a, B_BODY, 'cloth'));
    o.push(bx([-4.35, 21.8, -2.45], [-2.6, 24.2, 2.35], vc, B_BODY, 'cloth'));
    o.push(bx([2.6, 21.8, -2.45], [4.35, 24.2, 2.35], vc, B_BODY, 'cloth'));
    if (armorTier > 0) {
      const glow = armorTier === 3 ? 0xb779ff : armorTier === 2 ? 0x4aa8ff : 0xd8d8d8;
      o.push(bx([-2, 19, -2.45], [2, 19.4, -2.4], glow, B_BODY, 'emissive'));
    }
  }
  if (L.scarf !== null) {
    o.push(bx([-4.2, 22.5, -2.4], [4.2, 24.4, 2.3], L.scarf, B_BODY, 'cloth'));
    o.push(bx([1, 18.5, -2.5], [3, 22.5, -2.2], L.scarf, B_BODY, 'cloth'));
  }
  if (L.backpack !== null) {
    o.push(bx([-3.5, 13.5, 2], [3.5, 22, 5], L.backpack, B_BODY, 'cloth'));
    o.push(bx([-3.6, 17, 2.4], [3.6, 17.6, 5.1], 0x1f1f1f, B_BODY, 'rubber'));
    o.push(bx([-3, 21.8, 2.2], [3, 23, 4.4], 0x3a3a3a, B_BODY, 'cloth'));
    o.push(bx([-3.2, 13.6, 4.9], [3.2, 16, 5.6], L.accent, B_BODY, 'cloth'));
  }
  // arms (shoulder pivot at y=22)
  for (const [bone, x0] of [[B_RARM, 4], [B_LARM, -8]] as const) {
    o.push(bx([x0, 15, -2], [x0 + 4, 24, 2], top, bone, 'cloth', camo && !!L.jacket));
    o.push(bx([x0, 12, -2], [x0 + 4, 15, 2], L.skin, bone, 'skin'));
    o.push(bx([x0 - 0.15, 11.5, -2.15], [x0 + 4.15, 14.2, 2.15], L.gloves, bone, 'rubber'));
    o.push(bx([x0 - 0.12, 15, -2.12], [x0 + 4.12, 15.8, 2.12], 0x1a1a1a, bone, 'cloth'));
  }
  // head
  o.push(bx([-4, 24, -4], [4, 32, 4], L.skin, B_HEAD, 'skin'));
  // face (front is -Z)
  const fz = -4.05;
  o.push(bx([-3, 27, fz], [-1, 28.4, -4], 0xf4f4f4, B_HEAD, 'skin'));
  o.push(bx([1, 27, fz], [3, 28.4, -4], 0xf4f4f4, B_HEAD, 'skin'));
  o.push(bx([-2, 27, fz - 0.02], [-1, 28.4, -4], L.eyes, B_HEAD, 'skin'));
  o.push(bx([1, 27, fz - 0.02], [2, 28.4, -4], L.eyes, B_HEAD, 'skin'));
  o.push(bx([-3, 28.8, fz], [-0.8, 29.3, -4], L.hair, B_HEAD, 'cloth'));
  o.push(bx([0.8, 28.8, fz], [3, 29.3, -4], L.hair, B_HEAD, 'cloth'));
  o.push(bx([-0.6, 25.8, fz], [0.6, 27, -4], shade(L.skin, 0.85), B_HEAD, 'skin'));
  o.push(bx([-1.5, 25, fz], [1.5, 25.5, -4], 0x6a3a30, B_HEAD, 'skin'));
  if (L.beard) {
    o.push(bx([-4.1, 24, -4.1], [4.1, 26.2, -2], L.hair, B_HEAD, 'cloth'));
    o.push(bx([-1.5, 24.9, -4.15], [1.5, 25.5, -4.1], 0x6a3a30, B_HEAD, 'skin'));
  }
  // hair
  const hs = L.hairStyle;
  const covered = !!L.helm || L.mask === 'ninja';
  if (hs !== 'bald' && L.headgear !== 'hood' && !covered) {
    const hTop = hs === 'buzz' ? 32.3 : 32.6;
    o.push(bx([-4.2, 30.4, -4.2], [4.2, hTop, 4.2], L.hair, B_HEAD, 'cloth'));
    if (hs !== 'buzz') {
      o.push(bx([-4.25, 26, -2], [-4.0, 31, 4.25], L.hair, B_HEAD, 'cloth'));
      o.push(bx([4.0, 26, -2], [4.25, 31, 4.25], L.hair, B_HEAD, 'cloth'));
      o.push(bx([-4.25, hs === 'long' ? 21 : 25.5, 4.0], [4.25, 31, 4.3], L.hair, B_HEAD, 'cloth'));
    }
    if (hs === 'pony') o.push(bx([-1, 23, 4.2], [1, 29, 6], L.hair, B_HEAD, 'cloth'));
    if (hs === 'mohawk') o.push(bx([-1, 32, -3], [1, 34.2, 4], L.hair, B_HEAD, 'cloth'));
    if (hs === 'curly') o.push(bx([-4.5, 29.5, -4.5], [4.5, 33.2, 4.5], L.hair, B_HEAD, 'cloth'));
    if (hs === 'long') o.push(bx([-4.25, 22, 2], [4.25, 26, 4.3], L.hair, B_HEAD, 'cloth'));
  }
  // headgear
  const h = L.hat;
  switch (covered ? 'none' : L.headgear) {
    case 'cap':
      o.push(bx([-4.3, 30.2, -4.3], [4.3, 33, 4.3], h, B_HEAD, 'cloth'));
      o.push(bx([-4.0, 30.2, -7.2], [4.0, 30.8, -4.3], h, B_HEAD, 'cloth'));
      o.push(bx([-0.6, 33, -0.6], [0.6, 33.4, 0.6], L.accent, B_HEAD, 'cloth'));
      break;
    case 'beanie':
      o.push(bx([-4.4, 29.6, -4.4], [4.4, 33.4, 4.4], h, B_HEAD, 'cloth'));
      o.push(bx([-4.45, 29.6, -4.45], [4.45, 30.6, 4.45], shade(h, 0.75), B_HEAD, 'cloth'));
      o.push(bx([-1, 33.4, -1], [1, 34.6, 1], L.accent, B_HEAD, 'cloth'));
      break;
    case 'helmet':
      o.push(bx([-4.7, 29.4, -4.7], [4.7, 33.6, 4.7], armorTier >= 2 ? 0x3a4030 : h, B_HEAD, 'polymer', camo));
      o.push(bx([-4.9, 29.0, -4.9], [4.9, 29.8, 4.9], shade(armorTier >= 2 ? 0x3a4030 : h, 0.8), B_HEAD, 'polymer'));
      o.push(bx([-4.75, 26, -1], [-4.5, 29.4, 2], 0x2a2a2a, B_HEAD, 'rubber'));
      o.push(bx([4.5, 26, -1], [4.75, 29.4, 2], 0x2a2a2a, B_HEAD, 'rubber'));
      break;
    case 'hood':
      o.push(bx([-4.5, 25, -4.3], [4.5, 33, 4.5], h, B_HEAD, 'cloth', camo));
      o.push(bx([-4.55, 24.5, 2], [4.55, 30, 5.5], h, B_HEAD, 'cloth', camo));
      o.push(bx([-3.5, 24.0, -4.4], [3.5, 25, -4.3], shade(h, 0.7), B_HEAD, 'cloth'));
      break;
    case 'headset':
      o.push(bx([-4.6, 26.2, -1.5], [-4.0, 29, 1.5], 0x1a1a1a, B_HEAD, 'polymer'));
      o.push(bx([4.0, 26.2, -1.5], [4.6, 29, 1.5], 0x1a1a1a, B_HEAD, 'polymer'));
      o.push(bx([-4.5, 32.2, -0.6], [4.5, 32.8, 0.6], 0x1a1a1a, B_HEAD, 'polymer'));
      o.push(bx([-4.62, 26.6, -0.8], [-4.55, 28.6, 0.8], L.accent, B_HEAD, 'emissive'));
      o.push(bx([-4.5, 25.5, -4.4], [-3.8, 26.2, -1.5], 0x1a1a1a, B_HEAD, 'polymer'));
      break;
    case 'bandana':
      o.push(bx([-4.3, 29.5, -4.3], [4.3, 31.2, 4.3], h, B_HEAD, 'cloth'));
      o.push(bx([-1, 28, 4.2], [1, 30, 6], h, B_HEAD, 'cloth'));
      break;
    case 'beret':
      o.push(bx([-4.4, 31, -4.4], [4.6, 32.8, 4.4], h, B_HEAD, 'cloth'));
      o.push(bx([2, 31.5, -4.5], [3, 32.5, -4.4], L.accent, B_HEAD, 'metal'));
      break;
    case 'visor':
      o.push(bx([-4.3, 29.8, -4.3], [4.3, 31.0, 4.3], h, B_HEAD, 'cloth'));
      o.push(bx([-4.0, 29.8, -7.0], [4.0, 30.3, -4.3], h, B_HEAD, 'cloth'));
      break;
  }
  premiumParts(o, L);
  if (L.goggles && !L.helm && L.mask !== 'visor' && L.mask !== 'skull') {
    o.push(bx([-4.4, 26.8, -4.5], [4.4, 28.8, -4.1], 0x1a1a1a, B_HEAD, 'rubber'));
    o.push(bx([-3.4, 27.1, -4.6], [-0.6, 28.5, -4.45], 0x5ab0e0, B_HEAD, 'glass'));
    o.push(bx([0.6, 27.1, -4.6], [3.4, 28.5, -4.45], 0x5ab0e0, B_HEAD, 'glass'));
    o.push(bx([-4.45, 27.2, -4.1], [4.45, 28.2, 4.45], 0x1a1a1a, B_HEAD, 'rubber'));
  }
  return o;
}

/** armour plates, glowing trims, masks, full helmets and capes (front is -Z) */
function premiumParts(o: VBox[], L: Look) {
  const P = L.plates;
  const T = L.trim;
  if (P != null) {
    const edge = shade(P, 0.7);
    // chest plate with a raised centre and a belt buckle
    o.push(bx([-3.7, 15.2, -2.75], [3.7, 22.4, -2.2], P, B_BODY, 'metal'));
    o.push(bx([-1.4, 16, -2.95], [1.4, 21.6, -2.7], shade(P, 1.15), B_BODY, 'metal'));
    o.push(bx([-3.75, 15.2, -2.8], [3.75, 15.7, -2.2], edge, B_BODY, 'metal'));
    o.push(bx([-3.4, 14.6, 2.15], [3.4, 22, 2.65], P, B_BODY, 'metal'));
    // shoulder pads and gauntlets
    for (const [bone, x0] of [[B_RARM, 4], [B_LARM, -8]] as const) {
      o.push(bx([x0 - 0.5, 20.6, -2.55], [x0 + 4.5, 24.7, 2.55], P, bone, 'metal'));
      o.push(bx([x0 - 0.55, 20.6, -2.6], [x0 + 4.55, 21.2, 2.6], edge, bone, 'metal'));
      o.push(bx([x0 - 0.3, 13.6, -2.35], [x0 + 4.3, 15.4, 2.35], P, bone, 'metal'));
    }
    // knee pads
    for (const [bone, x0] of [[B_RLEG, 0], [B_LLEG, -4]] as const) o.push(bx([x0 + 0.3, 5.2, -2.6], [x0 + 3.7, 8, -2.1], P, bone, 'metal'));
  }
  if (T != null) {
    // seams that glow: chest lines, arm stripes, leg stripes
    o.push(bx([-2.6, 13.2, -2.9], [-2.2, 22.2, -2.25], T, B_BODY, 'emissive'));
    o.push(bx([2.2, 13.2, -2.9], [2.6, 22.2, -2.25], T, B_BODY, 'emissive'));
    o.push(bx([-2.6, 18.6, -3.0], [2.6, 19.0, -2.3], T, B_BODY, 'emissive'));
    for (const [bone, x0, side] of [[B_RARM, 4, 8.05], [B_LARM, -8, -8.05]] as const) {
      const xa = side > 0 ? x0 + 4 : x0 - 0.06;
      o.push(bx([xa, 15.5, -0.25], [xa + 0.06, 23.5, 0.25], T, bone, 'emissive'));
    }
    for (const [bone, x0] of [[B_RLEG, 0], [B_LLEG, -4]] as const) {
      const xa = bone === B_RLEG ? x0 + 4 : x0 - 0.06;
      o.push(bx([xa, 3.5, -0.25], [xa + 0.06, 11.5, 0.25], T, bone, 'emissive'));
      o.push(bx([x0 - 0.12, 0.8, -2.45], [x0 + 4.12, 1.2, 2.25], T, bone, 'emissive'));
    }
  }
  const glow = T ?? L.accent;
  switch (L.mask) {
    case 'gas':
      o.push(bx([-2.8, 24.4, -4.9], [2.8, 27.2, -4.0], 0x1e2124, B_HEAD, 'rubber'));
      o.push(bx([-1.2, 24.0, -5.6], [1.2, 26.2, -4.9], 0x2c3136, B_HEAD, 'metal'));
      o.push(bx([-4.3, 24.6, -4.4], [-2.6, 26.4, -2.6], 0x2c3136, B_HEAD, 'metal'));
      o.push(bx([2.6, 24.6, -4.4], [4.3, 26.4, -2.6], 0x2c3136, B_HEAD, 'metal'));
      o.push(bx([-3.2, 27.0, -4.45], [-0.6, 28.8, -4.05], glow, B_HEAD, 'emissive'));
      o.push(bx([0.6, 27.0, -4.45], [3.2, 28.8, -4.05], glow, B_HEAD, 'emissive'));
      break;
    case 'skull':
      o.push(bx([-4.15, 24, -4.35], [4.15, 30.4, -4.05], 0xe8e4d8, B_HEAD, 'polymer'));
      o.push(bx([-3.1, 26.8, -4.45], [-0.8, 28.8, -4.3], 0x0c0c0e, B_HEAD, 'matte'));
      o.push(bx([0.8, 26.8, -4.45], [3.1, 28.8, -4.3], 0x0c0c0e, B_HEAD, 'matte'));
      o.push(bx([-2.4, 27.4, -4.5], [-1.4, 28.2, -4.4], glow, B_HEAD, 'emissive'));
      o.push(bx([1.4, 27.4, -4.5], [2.4, 28.2, -4.4], glow, B_HEAD, 'emissive'));
      o.push(bx([-0.5, 25.8, -4.45], [0.5, 26.6, -4.3], 0x0c0c0e, B_HEAD, 'matte'));
      for (const x of [-2.2, -1.1, 0, 1.1]) o.push(bx([x, 24.4, -4.45], [x + 0.6, 25.4, -4.3], 0x0c0c0e, B_HEAD, 'matte'));
      break;
    case 'visor':
      o.push(bx([-4.3, 24.8, -4.4], [4.3, 26.6, -4.0], shade(L.hat, 0.8), B_HEAD, 'polymer'));
      o.push(bx([-4.35, 26.6, -4.6], [4.35, 29.0, -4.0], 0x0b0d12, B_HEAD, 'glass'));
      o.push(bx([-3.8, 27.5, -4.66], [3.8, 28.0, -4.55], glow, B_HEAD, 'emissive'));
      break;
    case 'ninja':
      o.push(bx([-4.3, 24, -4.3], [4.3, 32.4, 4.3], L.hat, B_HEAD, 'cloth'));
      o.push(bx([-3.2, 26.9, -4.35], [3.2, 28.5, -4.25], L.skin, B_HEAD, 'skin'));
      o.push(bx([-2.2, 27.2, -4.4], [-1.2, 28.2, -4.36], L.eyes, B_HEAD, 'skin'));
      o.push(bx([1.2, 27.2, -4.4], [2.2, 28.2, -4.36], L.eyes, B_HEAD, 'skin'));
      o.push(bx([-1, 28.4, 4.2], [1, 30, 7.5], L.accent, B_HEAD, 'cloth'));
      break;
  }
  if (L.helm) {
    const c = P ?? L.hat;
    o.push(bx([-4.7, 24.2, -4.7], [4.7, 33.4, 4.7], c, B_HEAD, 'metal'));
    o.push(bx([-4.75, 26.9, -4.8], [4.75, 28.1, -4.6], 0x08090b, B_HEAD, 'matte'));
    o.push(bx([-0.4, 24.2, -4.85], [0.4, 26.9, -4.65], shade(c, 1.2), B_HEAD, 'metal'));
    o.push(bx([-4.8, 33.0, -4.8], [4.8, 33.6, 4.8], shade(c, 0.75), B_HEAD, 'metal'));
    if (T != null) o.push(bx([-4.0, 27.2, -4.86], [4.0, 27.8, -4.8], T, B_HEAD, 'emissive'));
    if (L.helm === 'knight') {
      o.push(bx([-0.6, 33.4, -3.6], [0.6, 36.6, 3.2], L.accent, B_HEAD, 'cloth'));
      o.push(bx([-0.5, 33.4, 3.2], [0.5, 35.4, 5.6], L.accent, B_HEAD, 'cloth'));
    } else {
      for (const s of [-1, 1]) {
        o.push(bx([s > 0 ? 4.6 : -6.4, 30.4, -1], [s > 0 ? 6.4 : -4.6, 32, 1], 0xe8dcc0, B_HEAD, 'polymer'));
        o.push(bx([s > 0 ? 5.6 : -6.6, 32, -0.8], [s > 0 ? 6.6 : -5.6, 35.2, 0.8], 0xe8dcc0, B_HEAD, 'polymer'));
        o.push(bx([s > 0 ? 5.8 : -6.4, 35.2, -0.6], [s > 0 ? 6.4 : -5.8, 36.6, 0.6], 0xffffff, B_HEAD, 'polymer'));
      }
    }
  }
  if (L.cape != null) {
    o.push(bx([-4.2, 22.6, 2.0], [4.2, 24.2, 3.2], shade(L.cape, 0.75), B_BODY, 'cloth'));
    o.push(bx([-4.0, 6.0, 2.7], [4.0, 23.0, 3.3], L.cape, B_BODY, 'cloth'));
    if (T != null) o.push(bx([-4.0, 6.0, 3.3], [4.0, 6.5, 3.4], T, B_BODY, 'emissive'));
  }
}

function shade(c: number, f: number) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

// The model is built facing -Z (that's where the face is), but the pose below is written facing +Z
// (positive X rotation swings a limb forward). Mirroring every bone and the held item through the
// XY plane once the pose is done puts arms, gun, lean and head pitch on the side the face looks at.
const MIRROR_Z = new THREE.Matrix4().makeScale(1, 1, -1);

// pivots in character pixels
const PIVOTS: [number, number, number][] = [
  [0, 12, 0], // body (hips)
  [0, 24, 0], // head (neck)
  [6, 22, 0], // right shoulder
  [-6, 22, 0], // left shoulder
  [2, 12, 0], // right hip
  [-2, 12, 0], // left hip
];

export interface AnimState {
  speed: number;
  forward: number; // signed forward speed
  strafe: number;
  onGround: boolean;
  crouch: number; // 0..1
  pitch: number;
  sprint: boolean;
  aiming: boolean;
  recoil: number;
  reload: number; // 0..1 or -1
  dead: number; // 0 alive, >0 seconds since death
  deathDir: number;
  gliding: boolean;
  /** skydiving before the glider opens */
  falling?: boolean;
  swimming: boolean;
  throwing: number; // 0..1
  swing: number; // melee 0..1
  holding: 'gun' | 'tool' | 'none' | 'throw' | 'heal';
}

export function applyCamo(mat: THREE.ShaderMaterial, camo: CamoDef | null) {
  const u = mat.uniforms;
  if (!camo || camo.mode === 0) {
    u.uCamoMode.value = 0;
    return;
  }
  u.uCamoMode.value = camo.mode;
  u.uCamoA.value.setHex(camo.a).convertSRGBToLinear();
  u.uCamoB.value.setHex(camo.b).convertSRGBToLinear();
  u.uCamoC.value.setHex(camo.c).convertSRGBToLinear();
  u.uCamoScale.value = camo.scale;
  u.uEmissiveBoost.value = camo.glow ? 1.6 : 1;
}

export class CharacterModel {
  root = new THREE.Group();
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  weaponMaterial: THREE.ShaderMaterial;
  weaponMesh: THREE.Mesh | null = null;
  weaponId: string | null = null;
  glider: THREE.Mesh;
  private phase = 0;
  private bones: THREE.Matrix4[];
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  look: Look;
  armorTier = -1;
  /** world-space muzzle position after pose() */
  muzzle = new THREE.Vector3();
  headPos = new THREE.Vector3();
  private shadowOnly: boolean;

  constructor(look: Look, opts: { shadowOnly?: boolean; weaponCamo?: CamoDef | null } = {}) {
    this.look = look;
    this.shadowOnly = !!opts.shadowOnly;
    this.material = createEntityMaterial({ skinned: true });
    this.weaponMaterial = createEntityMaterial();
    if (look.camo) applyCamo(this.material, CAMOS[look.camo] ?? null);
    if (opts.weaponCamo) applyCamo(this.weaponMaterial, opts.weaponCamo);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.setArmor(0);
    this.root.add(this.mesh);
    this.bones = this.material.uniforms.uBones.value as THREE.Matrix4[];
    // glider (shown while dropping)
    const gl: VBox[] = [];
    for (let i = -6; i <= 6; i++) gl.push({ min: [i * 4 - 2, 0, -6], max: [i * 4 + 2, 1 - Math.abs(i) * 0.12, 6], color: i % 2 ? look.accent : 0xeeeeee, mat: 'cloth' });
    gl.push({ min: [-0.3, -14, -0.3], max: [0.3, 0, 0.3], color: 0x222222, mat: 'metal' });
    this.glider = new THREE.Mesh(buildVoxelGeometry(gl, 1 / 16), this.weaponMaterial);
    this.glider.position.set(0, 2.6, 0);
    this.glider.visible = false;
    this.root.add(this.glider);
    if (this.shadowOnly) this.setLayers(true);
  }

  setLayers(shadowOnly: boolean) {
    this.root.traverse((o) => {
      if (shadowOnly) o.layers.set(SHADOW_LAYER);
      else {
        o.layers.set(0);
        o.layers.enable(SHADOW_LAYER);
      }
    });
  }

  setArmor(tier: number) {
    if (tier === this.armorTier) return;
    this.armorTier = tier;
    const old = this.mesh.geometry;
    this.mesh.geometry = buildVoxelGeometry(characterBoxes(this.look, tier), PX);
    old.dispose();
    this.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
  }

  setWeapon(kind: WeaponId | 'pickaxe' | 'hammer' | 'frag' | null) {
    if (kind === this.weaponId) return;
    this.weaponId = kind;
    if (this.weaponMesh) {
      this.root.remove(this.weaponMesh);
      this.weaponMesh = null;
    }
    if (!kind) return;
    let g: THREE.BufferGeometry;
    if (kind === 'pickaxe') g = cachedGeometry('pickaxe', pickaxeModel());
    else if (kind === 'hammer') g = cachedGeometry('hammer', hammerModel());
    else if (kind === 'frag') g = cachedGeometry('frag', fragModel());
    else g = weaponWorldGeometry(kind, 1 / 32);
    this.weaponMesh = new THREE.Mesh(g, this.weaponMaterial);
    this.weaponMesh.matrixAutoUpdate = false;
    this.weaponMesh.frustumCulled = false;
    this.root.add(this.weaponMesh);
    if (this.shadowOnly) this.setLayers(true);
    else this.setLayers(false);
  }

  setLight(sky: number, block: number) {
    this.material.uniforms.uLocalLight.value.set(sky, block);
    this.weaponMaterial.uniforms.uLocalLight.value.set(sky, block);
  }

  setFlash(r: number, g: number, b: number) {
    this.material.uniforms.uFlash.value.setRGB(r, g, b);
  }

  setOpacity(o: number) {
    this.material.uniforms.uOpacity.value = o;
    this.weaponMaterial.uniforms.uOpacity.value = o;
  }

  private setBone(i: number, rx: number, ry: number, rz: number, tx = 0, ty = 0, tz = 0, parent?: THREE.Matrix4) {
    const p = PIVOTS[i];
    const m = this.bones[i];
    this.tmpE.set(rx, ry, rz, 'YXZ');
    this.tmpQ.setFromEuler(this.tmpE);
    m.makeTranslation(-p[0] * PX, -p[1] * PX, -p[2] * PX);
    this.tmpM.makeRotationFromQuaternion(this.tmpQ);
    m.premultiply(this.tmpM);
    this.tmpM.makeTranslation(p[0] * PX + tx, p[1] * PX + ty, p[2] * PX + tz);
    m.premultiply(this.tmpM);
    if (parent) m.premultiply(parent);
  }

  /** Pose all bones. Root transform (position / yaw) set by the caller. */
  pose(s: AnimState, dt: number) {
    const crouch = s.crouch;
    const moving = s.speed > 0.3 && s.onGround && s.dead === 0;
    this.phase += dt * s.speed * (s.sprint ? 1.55 : 1.9);
    const swing = moving ? Math.sin(this.phase) * Math.min(1, s.speed / 5) * (s.sprint ? 1.0 : 0.7) : 0;
    const diving = !!s.falling && !s.gliding && s.dead === 0;
    const bodyLean = diving ? 1.2 : crouch * 0.42 + (s.sprint ? 0.12 : 0);
    const drop = -crouch * 0.24;

    // body
    this.setBone(B_BODY, bodyLean, 0, 0, 0, drop, 0);
    const bodyM = this.bones[B_BODY].clone();
    // head counter-rotates the lean and follows aim pitch
    const pitch = Math.max(-1.2, Math.min(1.2, s.pitch));
    this.setBone(B_HEAD, -bodyLean - pitch * 0.85, 0, 0, 0, 0, 0, bodyM);
    // legs
    let legR = swing * 0.9;
    let legL = -swing * 0.9;
    if (!s.onGround && !s.gliding && !s.swimming) {
      legR = -0.5;
      legL = 0.25;
    }
    if (s.gliding) {
      legR = Math.sin(this.phase * 0.2) * 0.2 + 0.1;
      legL = -legR;
    }
    if (diving) {
      // belly-down skydive: legs trail behind the body, flutter a little in the wind
      const flutter = Math.sin(performance.now() * 0.012) * 0.08;
      legR = 1.05 + flutter;
      legL = 1.05 - flutter;
    }
    if (s.swimming) {
      legR = Math.sin(performance.now() * 0.008) * 0.5;
      legL = -legR;
    }
    // strafing (common while shooting) side-steps instead of running in place
    const side = moving ? Math.min(1, Math.abs(s.strafe) / Math.max(0.5, s.speed)) : 0;
    legR *= 1 - side * 0.7;
    legL *= 1 - side * 0.7;
    const legSide = swing * 0.45 * side;
    const kneel = -crouch * 0.55;
    this.setBone(B_RLEG, legR + kneel, 0, 0.02 + legSide, 0, drop * 0.5, crouch * 0.12);
    this.setBone(B_LLEG, legL + kneel, 0, -0.02 - legSide, 0, drop * 0.5, crouch * 0.12);

    // arms
    let rArm: [number, number, number] = [-swing * 0.6, 0, 0.05];
    let lArm: [number, number, number] = [swing * 0.6, 0, -0.05];
    const aimX = -Math.PI / 2 - pitch + bodyLean * 0.0;
    if (s.gliding) {
      rArm = [-Math.PI + 0.2, 0, 0.25];
      lArm = [-Math.PI + 0.2, 0, -0.25];
    } else if (diving) {
      rArm = [-0.5, 0, 1.25];
      lArm = [-0.5, 0, -1.25];
    } else if (s.holding === 'gun') {
      if (s.sprint && !s.aiming) {
        rArm = [-0.9 + swing * 0.25, -0.4, 0.15];
        lArm = [-1.1 - swing * 0.25, 0.6, -0.1];
      } else {
        const rec = s.recoil * 0.25;
        rArm = [aimX - rec - bodyLean, -0.08, 0.0];
        lArm = [aimX - rec - bodyLean + 0.06, 0.55, 0.0];
        if (s.reload >= 0) {
          const t = Math.sin(s.reload * Math.PI);
          lArm = [aimX + 0.9 * t - bodyLean, 0.4 - 0.4 * t, -0.2 * t];
          rArm = [aimX + 0.25 * t - bodyLean, -0.1, 0];
        }
      }
    } else if (s.holding === 'tool') {
      const sw = s.swing > 0 ? Math.sin(s.swing * Math.PI) : 0;
      rArm = [-1.2 - sw * 1.4 - pitch * 0.5, -0.2, 0.1];
      lArm = [swing * 0.5, 0, -0.05];
    } else if (s.holding === 'throw' || s.holding === 'heal') {
      const th = s.throwing;
      rArm = [-1.0 - Math.sin(th * Math.PI) * 1.8, 0, 0.1];
      lArm = [-0.6, 0.3, 0];
    }
    if (s.swimming) {
      const sw = Math.sin(performance.now() * 0.006);
      rArm = [-2.4 + sw * 0.5, 0, 0.4];
      lArm = [-2.4 - sw * 0.5, 0, -0.4];
    }
    this.setBone(B_RARM, rArm[0], rArm[1], rArm[2], 0, 0, 0, bodyM);
    this.setBone(B_LARM, lArm[0], lArm[1], lArm[2], 0, 0, 0, bodyM);

    // held item follows right hand
    if (this.weaponMesh) {
      const hand = new THREE.Vector3(6 * PX, 12 * PX, 0).applyMatrix4(this.bones[B_RARM]);
      const m = this.weaponMesh.matrix;
      if (s.holding === 'gun' && !(s.sprint && !s.aiming) && !s.gliding) {
        this.tmpE.set(-pitch - s.recoil * 0.08, 0, 0, 'YXZ');
        m.makeRotationFromEuler(this.tmpE);
        m.setPosition(hand.x - 0.13, hand.y + 0.06, hand.z);
      } else if (s.holding === 'gun') {
        this.tmpE.set(-0.5, 0.9, 0.3, 'YXZ');
        m.makeRotationFromEuler(this.tmpE);
        m.setPosition(hand.x - 0.08, hand.y + 0.05, hand.z);
      } else {
        // tools / grenades: rotate with the arm
        const armRot = new THREE.Matrix4().extractRotation(this.bones[B_RARM]);
        const tilt = new THREE.Matrix4().makeRotationX(Math.PI / 2);
        m.copy(armRot).multiply(tilt);
        m.setPosition(hand.x, hand.y, hand.z);
      }
      this.weaponMesh.visible = !s.gliding && !s.falling && s.holding !== 'none' && s.holding !== 'heal';
      this.weaponMesh.matrixWorldNeedsUpdate = true;
    }
    this.glider.visible = s.gliding;
    // pivots sit on z = 0, so the mirror keeps every joint in place and only flips front and back
    for (const b of this.bones) b.premultiply(MIRROR_Z).multiply(MIRROR_Z);
    if (this.weaponMesh) this.weaponMesh.matrix.premultiply(MIRROR_Z).multiply(MIRROR_Z);

    // death topple: rotate root around feet
    if (s.dead > 0) {
      const t = Math.min(1, s.dead / 0.45);
      const e = 1 - Math.pow(1 - t, 3);
      // deathDir is where the shot came from (0 = in front): fall away from it
      this.mesh.rotation.set(e * Math.PI / 2 * Math.cos(s.deathDir), 0, -e * Math.PI / 2 * Math.sin(s.deathDir));
      this.mesh.position.y = e * 0.15;
      if (this.weaponMesh) this.weaponMesh.visible = false;
    } else {
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.position.y = 0;
    }
  }

  /** compute world-space head & muzzle helpers (after root matrices update) */
  updateHelpers() {
    this.root.updateMatrixWorld(true);
    this.headPos.set(0, 28 * PX, 0).applyMatrix4(this.bones[B_HEAD]).applyMatrix4(this.root.matrixWorld);
    if (this.weaponMesh) this.muzzle.set(0, 0.03, -0.75).applyMatrix4(this.weaponMesh.matrix).applyMatrix4(this.root.matrixWorld);
    else this.muzzle.copy(this.headPos);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.weaponMaterial.dispose();
    this.glider.geometry.dispose();
  }
}
