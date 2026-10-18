import type { WeaponId } from '../weapons';
import { RNG } from '../../core/rng';

export type Archetype = 'aggressor' | 'looter' | 'flanker' | 'tactician' | 'builder' | 'sniper' | 'support';

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  aggressor: 'Entry Fragger',
  looter: 'Scavenger',
  flanker: 'Flanker',
  tactician: 'Tactician',
  builder: 'Builder',
  sniper: 'Marksman',
  support: 'Anchor',
};

export interface Personality {
  archetype: Archetype;
  aggression: number;
  caution: number;
  building: number;
  patience: number;
  teamwork: number;
  grenades: number;
  favWeapons: WeaponId[];
}

const FAVS: Record<Archetype, WeaponId[]> = {
  aggressor: ['breacher', 'hornet', 'volk'],
  looter: ['ranger', 'hornet', 'p9'],
  flanker: ['hornet', 'breacher', 'ranger'],
  tactician: ['ranger', 'arbiter', 'volk'],
  builder: ['breacher', 'ranger', 'thumper'],
  sniper: ['longshot', 'arbiter', 'ranger'],
  support: ['volk', 'ranger', 'arbiter'],
};

export function makePersonality(seed: number): Personality {
  const r = new RNG(seed ^ 0x9e3779b9);
  const archetype = r.weighted<Archetype>(
    ['aggressor', 'looter', 'flanker', 'tactician', 'builder', 'sniper', 'support'],
    [1.2, 1, 1, 1.1, 0.9, 0.8, 0.8],
  );
  const base = {
    aggressor: { aggression: 0.85, caution: 0.25, building: 0.3, patience: 0.2 },
    looter: { aggression: 0.35, caution: 0.6, building: 0.3, patience: 0.5 },
    flanker: { aggression: 0.65, caution: 0.4, building: 0.25, patience: 0.35 },
    tactician: { aggression: 0.5, caution: 0.6, building: 0.45, patience: 0.6 },
    builder: { aggression: 0.55, caution: 0.45, building: 0.9, patience: 0.4 },
    sniper: { aggression: 0.3, caution: 0.65, building: 0.35, patience: 0.85 },
    support: { aggression: 0.45, caution: 0.55, building: 0.4, patience: 0.6 },
  }[archetype];
  const j = () => (r.next() - 0.5) * 0.25;
  return {
    archetype,
    aggression: clamp01(base.aggression + j()),
    caution: clamp01(base.caution + j()),
    building: clamp01(base.building + j()),
    patience: clamp01(base.patience + j()),
    teamwork: clamp01(0.4 + r.next() * 0.6),
    grenades: clamp01(0.3 + r.next() * 0.7),
    favWeapons: FAVS[archetype],
  };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/** Aim/reaction parameters derived from skill 0..1. Better bots think better, not just aim better. */
export function skillParams(skill: number) {
  // below the middle of the range bots get clumsier fast: this is where new players start
  const low = Math.max(0, (0.5 - skill) / 0.5);
  return {
    reaction: 0.62 - skill * 0.4 + low * 0.6, // seconds before engaging a newly seen enemy
    aimError: 7.5 - skill * 5.5 + low * 7, // degrees initial error
    errorDecay: (1.4 + skill * 3.2) * (1 - low * 0.45), // per second
    turnSpeed: (4 + skill * 7) * (1 - low * 0.4), // rad/s
    headshot: Math.max(0.01, 0.06 + skill * 0.26 - low * 0.05),
    /** extra rest between bursts / shots, seconds */
    fireRest: low * 0.45,
    /** how far away enemies get noticed, as a share of full range */
    awareness: 0.6 + 0.4 * (1 - low),
    burstDiscipline: 0.3 + skill * 0.6,
    coverUse: 0.25 + skill * 0.7,
    grenadeIQ: 0.2 + skill * 0.7,
    strafe: 0.3 + skill * 0.6,
    rotateEarly: 0.2 + skill * 0.7,
    mistake: 0.22 - skill * 0.17 + low * 0.12,
    leadTarget: skill,
  };
}
