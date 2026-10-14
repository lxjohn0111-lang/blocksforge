import type { ItemSpec, MaterialKind } from './weapons';

export interface Recipe {
  id: string;
  name: string;
  cost: Partial<Record<MaterialKind, number>>;
  give: ItemSpec;
  group: 'ammo' | 'gear' | 'heal' | 'materials';
  hint: string;
}

export const RECIPES: Recipe[] = [
  { id: 'ammo_light', name: 'Light Rounds', cost: { metal: 4, powder: 2 }, give: { kind: 'ammo', ammo: 'light', count: 30 }, group: 'ammo', hint: '×30 · Pistol / SMG' },
  { id: 'ammo_medium', name: 'Medium Rounds', cost: { metal: 5, powder: 3 }, give: { kind: 'ammo', ammo: 'medium', count: 30 }, group: 'ammo', hint: '×30 · Rifles' },
  { id: 'ammo_shells', name: 'Shells', cost: { metal: 4, powder: 3 }, give: { kind: 'ammo', ammo: 'shells', count: 8 }, group: 'ammo', hint: '×8 · Shotgun' },
  { id: 'ammo_heavy', name: 'Heavy Rounds', cost: { metal: 6, powder: 4 }, give: { kind: 'ammo', ammo: 'heavy', count: 6 }, group: 'ammo', hint: '×6 · DMR / Sniper' },
  { id: 'ammo_rocket', name: 'Rocket', cost: { metal: 12, powder: 10 }, give: { kind: 'ammo', ammo: 'rockets', count: 1 }, group: 'ammo', hint: '×1 · Launcher' },
  { id: 'bandage', name: 'Bandages', cost: { cloth: 4 }, give: { kind: 'heal', heal: 'bandage', count: 2 }, group: 'heal', hint: '×2 · +20 HP' },
  { id: 'medkit', name: 'Medkit', cost: { cloth: 10 }, give: { kind: 'heal', heal: 'medkit', count: 1 }, group: 'heal', hint: 'Full heal' },
  { id: 'plate', name: 'Armor Plate', cost: { metal: 10, cloth: 2 }, give: { kind: 'heal', heal: 'plate', count: 1 }, group: 'heal', hint: '+25 Armor' },
  { id: 'frag', name: 'Frag Grenade', cost: { metal: 5, powder: 6 }, give: { kind: 'throw', throw: 'frag', count: 1 }, group: 'gear', hint: 'Blast 5.5m' },
  { id: 'smoke', name: 'Smoke Grenade', cost: { cloth: 3, powder: 3 }, give: { kind: 'throw', throw: 'smoke', count: 1 }, group: 'gear', hint: 'Vision block' },
  { id: 'smelt', name: 'Smelt Metal', cost: { stone: 20, wood: 10 }, give: { kind: 'mat', mat: 'metal', count: 10 }, group: 'materials', hint: '→ Metal ×10' },
  { id: 'weave', name: 'Weave Cloth', cost: { wood: 12 }, give: { kind: 'mat', mat: 'cloth', count: 4 }, group: 'materials', hint: '→ Cloth ×4' },
  { id: 'grind', name: 'Grind Powder', cost: { stone: 14 }, give: { kind: 'mat', mat: 'powder', count: 4 }, group: 'materials', hint: '→ Powder ×4' },
];

export function canAfford(mats: Record<MaterialKind, number>, r: Recipe) {
  for (const [k, v] of Object.entries(r.cost)) if ((mats[k as MaterialKind] ?? 0) < (v ?? 0)) return false;
  return true;
}
