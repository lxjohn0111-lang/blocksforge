// A combatant is any participant (the local player or an AI player). Both
// go through the same movement, inventory and combat code paths.

import * as THREE from 'three';
import { makeBody, type Body, type MoveIntent, STAND_H, CROUCH_H, EYE_STAND, EYE_CROUCH } from './physics';
import {
  WeaponInstance, WEAPONS, type WeaponId, type AmmoType, type HealKind, type ThrowKind, type MaterialKind,
  AMMO_MAX, HEALS, THROWABLES, MATERIALS,
} from './weapons';
import type { CharacterModel, Look, AnimState } from '../render/characters';
import type { Personality } from './ai/personality';

export interface Identity {
  id: string;
  name: string;
  look: Look;
  isBot: boolean;
  level: number;
  rp: number;
  title: string;
  banner: string;
  camo: string;
  personality?: Personality;
  /** 0..1 simulated skill */
  skill: number;
  clan?: string;
}

export interface CombatStats {
  kills: number;
  assists: number;
  deaths: number;
  damage: number;
  damageTaken: number;
  shots: number;
  hits: number;
  headshots: number;
  built: number;
  destroyed: number;
  crafted: number;
  chests: number;
  healed: number;
  distance: number;
  harvested: number;
  longestKill: number;
  grenadeKills: number;
  sniperKills: number;
  score: number;
}

export function emptyStats(): CombatStats {
  return {
    kills: 0, assists: 0, deaths: 0, damage: 0, damageTaken: 0, shots: 0, hits: 0, headshots: 0, built: 0, destroyed: 0,
    crafted: 0, chests: 0, healed: 0, distance: 0, harvested: 0, longestKill: 0, grenadeKills: 0, sniperKills: 0, score: 0,
  };
}

/** slots: 0..2 guns, 3 heals, 4 throwables, 5 harvest tool, 6 build hammer */
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export class Combatant {
  static nextId = 1;
  id = Combatant.nextId++;
  body: Body;
  yaw = 0;
  pitch = 0;
  hp = 100;
  armor = 0;
  armorCap = 0;
  alive = true;
  deathTime = 0;
  deathDir = 0;
  weapons: (WeaponInstance | null)[] = [null, null, null];
  slot: SlotIndex = 0;
  lastGunSlot: 0 | 1 | 2 = 0;
  /** the player started a heal from another slot (quick heal): go back to the gun afterwards */
  healReturn = false;
  ammo: Record<AmmoType, number> = { light: 0, medium: 0, shells: 0, heavy: 0, rockets: 0 };
  heals: Record<HealKind, number> = { bandage: 0, medkit: 0, plate: 0 };
  throws: Record<ThrowKind, number> = { frag: 0, smoke: 0 };
  mats: Record<MaterialKind, number> = { wood: 0, stone: 0, metal: 0, cloth: 0, powder: 0 };
  healSel: HealKind = 'bandage';
  throwSel: ThrowKind = 'frag';
  ads = 0;
  wantAds = false;
  crouching = false;
  crouchBlend = 0;
  sprinting = false;
  swapTimer = 0;
  useTimer = -1;
  useDur = 0;
  useKind: HealKind | null = null;
  throwHold = -1;
  toolTimer = 0;
  recoilPitch = 0;
  recoilYaw = 0;
  lastHurt = -100;
  lastAttacker: number | null = null;
  damageBy = new Map<number, { dmg: number; t: number }>();
  stats: CombatStats = emptyStats();
  spawnShield = 0;
  model: CharacterModel | null = null;
  anim: AnimState;
  footDist = 0;
  /** BR placement once eliminated */
  placement = 0;
  killedBy: { name: string; weapon: string; id: number } | null = null;
  respawnAt = 0;
  // drop phase (BR)
  dropping = false;
  gliding = false;
  /** last time this combatant fired (for AI hearing) */
  lastShotTime = -100;
  lastShotPos = new THREE.Vector3();
  /** last reported position for spotting (minimap pings) */
  revealedUntil = 0;
  streak = 0;
  intent: MoveIntent = { forward: 0, strafe: 0, yaw: 0, jump: false, crouch: false, sprint: false, speedMult: 1 };
  /** last time sprint ended (sprint-to-fire delay) */
  sprintEnd = -10;
  lightTimer = 0;
  localSky = 1;
  localBlock = 0;
  dryFired = false;
  quickThrowReturn: SlotIndex | null = null;

  constructor(public ident: Identity, public team: number, public isPlayer: boolean, x = 0, y = 0, z = 0) {
    this.body = makeBody(x, y, z);
    this.anim = {
      speed: 0, forward: 0, strafe: 0, onGround: true, crouch: 0, pitch: 0, sprint: false, aiming: false, recoil: 0,
      reload: -1, dead: 0, deathDir: 0, gliding: false, swimming: false, throwing: 0, swing: 0, holding: 'gun',
    };
  }

  get name() {
    return this.ident.name;
  }

  get eyeHeight() {
    return this.crouchBlend > 0.5 ? EYE_CROUCH : EYE_STAND;
  }

  eye(out = new THREE.Vector3()) {
    const h = EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouchBlend;
    return out.set(this.body.pos.x, this.body.pos.y + h, this.body.pos.z);
  }

  /** view direction including recoil offset */
  aimDir(out = new THREE.Vector3()) {
    const yaw = this.yaw + this.recoilYaw;
    const pitch = Math.max(-1.55, Math.min(1.55, this.pitch + this.recoilPitch));
    const cp = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  }

  get gun(): WeaponInstance | null {
    return this.slot <= 2 ? this.weapons[this.slot] : null;
  }

  setCrouch(on: boolean, canStand: boolean) {
    if (!on && !canStand) return;
    this.crouching = on;
    this.body.height = on ? CROUCH_H : STAND_H;
  }

  hasAnyGun() {
    return this.weapons.some((w) => w !== null);
  }

  giveWeapon(id: WeaponId, mag?: number): { slot: number; dropped: WeaponInstance | null } {
    const inst = new WeaponInstance(WEAPONS[id], mag);
    let slot = this.weapons.findIndex((w) => w === null);
    let dropped: WeaponInstance | null = null;
    if (slot < 0) {
      slot = this.slot <= 2 ? this.slot : this.lastGunSlot;
      dropped = this.weapons[slot];
    }
    this.weapons[slot] = inst;
    return { slot, dropped };
  }

  addAmmo(t: AmmoType, n: number) {
    const before = this.ammo[t];
    this.ammo[t] = Math.min(AMMO_MAX[t], this.ammo[t] + n);
    return this.ammo[t] - before;
  }
  addHeal(h: HealKind, n: number) {
    const before = this.heals[h];
    this.heals[h] = Math.min(HEALS[h].cap, this.heals[h] + n);
    return this.heals[h] - before;
  }
  addThrow(t: ThrowKind, n: number) {
    const before = this.throws[t];
    this.throws[t] = Math.min(THROWABLES[t].cap, this.throws[t] + n);
    return this.throws[t] - before;
  }
  addMat(m: MaterialKind, n: number) {
    const before = this.mats[m];
    this.mats[m] = Math.min(MATERIALS[m].cap, this.mats[m] + n);
    return this.mats[m] - before;
  }

  /** best available heal for current state */
  bestHeal(): HealKind | null {
    if (this.hp < 100) {
      if (this.hp < 60 && this.heals.medkit > 0) return 'medkit';
      if (this.hp < HEALS.bandage.max && this.heals.bandage > 0) return 'bandage';
      if (this.heals.medkit > 0) return 'medkit';
    }
    if (this.armor < Math.max(this.armorCap, 25) && this.heals.plate > 0) return 'plate';
    return null;
  }

  canUseHeal(h: HealKind) {
    if (this.heals[h] <= 0) return false;
    const d = HEALS[h];
    if (d.hp > 0) return this.hp < d.max;
    return this.armor < 100;
  }

  resetForSpawn() {
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.deathTime = 0;
    this.useTimer = -1;
    this.throwHold = -1;
    this.swapTimer = 0;
    this.ads = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.damageBy.clear();
    this.lastAttacker = null;
    this.body.vel.set(0, 0, 0);
    this.crouching = false;
    this.body.height = STAND_H;
    this.dropping = false;
    this.gliding = false;
    this.killedBy = null;
  }
}
