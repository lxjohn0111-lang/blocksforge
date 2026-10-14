// Loot tables and world item entities (floor loot, chest drops, death drops).

import * as THREE from 'three';
import { RNG } from '../core/rng';
import {
  WEAPONS, type ItemSpec, type WeaponId, type AmmoType, AMMO_PICKUP, itemTier,
} from './weapons';
import { createEntityMaterial } from '../render/voxelModel';
import {
  weaponWorldGeometry, cachedGeometry, ammoBoxModel, bandageModel, medkitModel, plateModel, fragModel, smokeModel,
  vestModel, materialModel,
} from '../render/weaponModels';
import { FX_LAYER } from '../render/chunkRenderer';
import type { LootTier } from '../world/maps/builder';

const W_COMMON: [WeaponId, number][] = [['p9', 10], ['hornet', 9], ['ranger', 8], ['breacher', 7], ['volk', 3], ['arbiter', 1.5], ['longshot', 0.6]];
const W_RARE: [WeaponId, number][] = [['ranger', 6], ['volk', 6], ['breacher', 5], ['hornet', 5], ['arbiter', 4], ['longshot', 2.2], ['thumper', 0.8]];
const W_EPIC: [WeaponId, number][] = [['longshot', 5], ['thumper', 3], ['arbiter', 4], ['volk', 3], ['breacher', 2]];

function pickW(r: RNG, table: [WeaponId, number][]): WeaponId {
  return r.weighted(table.map((t) => t[0]), table.map((t) => t[1]));
}

export function ammoFor(w: WeaponId, mult = 1): ItemSpec {
  const a = WEAPONS[w].ammo;
  return { kind: 'ammo', ammo: a, count: Math.round(AMMO_PICKUP[a] * mult) };
}

/** A floor spot yields one main item (+ ammo for guns). */
export function rollFloor(r: RNG, tier: LootTier): ItemSpec[] {
  const p = r.next();
  if (tier === 'epic') {
    if (p < 0.6) {
      const w = pickW(r, W_EPIC);
      return [{ kind: 'weapon', weapon: w }, ammoFor(w, 1.5)];
    }
    if (p < 0.8) return [{ kind: 'armor', tier: 3 }];
    return [{ kind: 'heal', heal: 'medkit', count: 1 }, { kind: 'heal', heal: 'plate', count: 2 }];
  }
  const table = tier === 'rare' ? W_RARE : W_COMMON;
  if (p < 0.4) {
    const w = pickW(r, table);
    return [{ kind: 'weapon', weapon: w }, ammoFor(w)];
  }
  if (p < 0.55) return [rollAmmo(r)];
  if (p < 0.68) return [{ kind: 'heal', heal: r.chance(tier === 'rare' ? 0.4 : 0.15) ? 'medkit' : 'bandage', count: r.int(1, 3) }];
  if (p < 0.76) return [{ kind: 'armor', tier: tier === 'rare' ? (r.chance(0.5) ? 2 : 1) : 1 }];
  if (p < 0.84) return [{ kind: 'heal', heal: 'plate', count: r.int(1, 2) }];
  if (p < 0.92) return [{ kind: 'throw', throw: r.chance(0.7) ? 'frag' : 'smoke', count: r.int(1, 2) }];
  return [rollMat(r)];
}

export function rollAmmo(r: RNG): ItemSpec {
  const t = r.weighted<AmmoType>(['light', 'medium', 'shells', 'heavy', 'rockets'], [4, 4, 2.5, 1.5, 0.4]);
  return { kind: 'ammo', ammo: t, count: AMMO_PICKUP[t] };
}

export function rollMat(r: RNG): ItemSpec {
  const m = r.weighted(['wood', 'stone', 'metal', 'cloth', 'powder'] as const, [3, 2.5, 1.6, 2, 2]);
  const n = m === 'cloth' || m === 'powder' ? r.int(4, 8) : r.int(20, 40);
  return { kind: 'mat', mat: m, count: n };
}

/** Chests: guaranteed weapon + ammo + 2 extras */
export function rollChest(r: RNG, tier: LootTier): ItemSpec[] {
  const out: ItemSpec[] = [];
  const table = tier === 'epic' ? W_EPIC : tier === 'rare' ? W_RARE : W_COMMON;
  const w = pickW(r, table);
  out.push({ kind: 'weapon', weapon: w }, ammoFor(w, 1.5));
  const extras = tier === 'common' ? 2 : 3;
  for (let i = 0; i < extras; i++) {
    const p = r.next();
    if (p < 0.25) out.push({ kind: 'heal', heal: tier !== 'common' && r.chance(0.5) ? 'medkit' : 'bandage', count: r.int(1, 3) });
    else if (p < 0.4) out.push({ kind: 'heal', heal: 'plate', count: r.int(1, 2) });
    else if (p < 0.55) out.push({ kind: 'throw', throw: r.chance(0.7) ? 'frag' : 'smoke', count: 1 });
    else if (p < 0.7) out.push({ kind: 'armor', tier: tier === 'epic' ? 3 : tier === 'rare' ? 2 : 1 });
    else if (p < 0.85) out.push(rollMat(r));
    else out.push(rollAmmo(r));
  }
  return out;
}

const AMMO_COLOR: Record<AmmoType, number> = { light: 0x6b8a3a, medium: 0x3a6a8a, shells: 0x8a2a22, heavy: 0x4a3a7a, rockets: 0x8a6a2a };
const MAT_COLOR: Record<string, [number, number]> = {
  wood: [0xa47e4b, 0x6b4426],
  stone: [0x8f8f92, 0x5a5a5e],
  metal: [0x8ea0b0, 0x4a5a6a],
  cloth: [0xe0d4bc, 0xa08a6a],
  powder: [0x3a3a3a, 0xd36a4a],
};

export const TIER_COLOR = { common: new THREE.Color(0.85, 0.88, 0.92), rare: new THREE.Color(0.25, 0.6, 1.6), epic: new THREE.Color(1.3, 0.45, 1.8) };

function itemGeometry(spec: ItemSpec): { geo: THREE.BufferGeometry; scale: number } {
  switch (spec.kind) {
    case 'weapon':
      return { geo: weaponWorldGeometry(spec.weapon, 1 / 32), scale: 0.9 };
    case 'ammo':
      return { geo: cachedGeometry('ammo_' + spec.ammo, ammoBoxModel(AMMO_COLOR[spec.ammo])), scale: 1.4 };
    case 'heal':
      return {
        geo: cachedGeometry('heal_' + spec.heal, spec.heal === 'bandage' ? bandageModel() : spec.heal === 'medkit' ? medkitModel() : plateModel()),
        scale: 1.6,
      };
    case 'throw':
      return { geo: cachedGeometry('throw_' + spec.throw, spec.throw === 'frag' ? fragModel() : smokeModel()), scale: 2.2 };
    case 'armor':
      return { geo: cachedGeometry('vest_' + spec.tier, vestModel(spec.tier)), scale: 1.5 };
    case 'mat': {
      const c = MAT_COLOR[spec.mat];
      return { geo: cachedGeometry('mat_' + spec.mat, materialModel(c[0], c[1])), scale: 1.3 };
    }
  }
}

let beamGeo: THREE.BufferGeometry | null = null;
function beamGeometry() {
  if (beamGeo) return beamGeo;
  const g = new THREE.CylinderGeometry(0.12, 0.3, 4, 8, 1, true);
  g.translate(0, 2, 0);
  const col: number[] = [];
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const a = 1 - y / 4;
    col.push(a, a, a);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  beamGeo = g;
  return g;
}

export class WorldItem {
  static nextId = 1;
  id = WorldItem.nextId++;
  mesh: THREE.Group | null = null;
  material: THREE.ShaderMaterial | null = null;
  vel = new THREE.Vector3();
  resting = false;
  spin = Math.random() * Math.PI * 2;
  taken = false;
  bornAt: number;
  light = new THREE.Vector2(1, 0);
  /** items dropped by a player can't be re-grabbed instantly by them */
  noPickupFor = 0;
  noPickupId = -1;

  constructor(public spec: ItemSpec, public pos: THREE.Vector3, now: number) {
    this.bornAt = now;
  }

  get tier() {
    return itemTier(this.spec);
  }

  ensureMesh(parent: THREE.Object3D) {
    if (this.mesh) return;
    const { geo, scale } = itemGeometry(this.spec);
    this.material = createEntityMaterial();
    this.material.uniforms.uLocalLight.value.copy(this.light);
    const m = new THREE.Mesh(geo, this.material);
    m.scale.setScalar(scale);
    const g = new THREE.Group();
    g.add(m);
    const tier = this.tier;
    if (tier !== 'common' || this.spec.kind === 'weapon') {
      const beam = new THREE.Mesh(
        beamGeometry(),
        new THREE.MeshBasicMaterial({ color: TIER_COLOR[tier].clone().multiplyScalar(tier === 'common' ? 0.25 : 0.55), transparent: true, opacity: 0.55, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.layers.set(FX_LAYER);
      g.add(beam);
    }
    this.mesh = g;
    parent.add(g);
  }

  dropMesh(parent: THREE.Object3D) {
    if (!this.mesh) return;
    parent.remove(this.mesh);
    this.material?.dispose();
    for (const c of this.mesh.children) {
      const mm = (c as THREE.Mesh).material as THREE.Material;
      if (mm && mm !== this.material) mm.dispose();
    }
    this.mesh = null;
    this.material = null;
  }

  syncMesh(t: number) {
    if (!this.mesh) return;
    const bob = this.resting ? Math.sin(t * 2 + this.id) * 0.06 + 0.32 : 0.2;
    this.mesh.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.spin += 0.016 * 1.3;
    this.mesh.children[0].rotation.set(this.spec.kind === 'weapon' ? 0.15 : 0, this.spin, 0);
    if (this.material) this.material.uniforms.uLocalLight.value.copy(this.light);
  }
}
