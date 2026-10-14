// Shared match simulation used by every mode. The local player and AI
// players call the same APIs (fire, reload, heal, throw, build, interact).

import * as THREE from 'three';
import type { Engine } from '../render/engine';
import type { MapData } from '../world/maps/builder';
import type { VoxelWorld } from '../world/world';
import { Effects } from '../render/effects';
import { Emitter } from '../core/events';
import { RNG } from '../core/rng';
import { Combatant, type Identity, type SlotIndex } from './combatant';
import { applyIntent, moveBody, unstick, GRAVITY, bodyCollides } from './physics';
import {
  WEAPONS, HEALS, THROWABLES, FRAG, ARMOR_VEST, WeaponInstance, type WeaponDef, type HealKind, type ItemSpec, type WeaponId,
  AMMO_MAX, itemName,
} from './weapons';
import { WorldItem, rollChest, rollFloor } from './items';
import { BuildSystem, type Piece, type Placement } from './building';
import { RECIPES, canAfford, type Recipe } from './crafting';
import { NavService } from './ai/nav';
import { CharacterModel } from '../render/characters';
import { CAMOS } from '../render/camos';
import { B, BLOCKS, BULLET_PASS, IS_SOLID, isBuilt, type BuildMat, RENDER } from '../world/blocks';
import { audio } from '../audio/audio';
import { DEG, clamp, lerp } from '../core/mathx';
import { SHADOW_LAYER } from '../render/shadows';

export type ModeKind = 'br' | 'tdm' | 'tutorial';

export interface MatchConfig {
  mode: ModeKind;
  ranked: boolean;
  mapId: string;
  seed: number;
  player: Identity;
  bots: { ident: Identity; skill: number }[];
  /** player cosmetics */
  camo: string;
  eventTag?: string | null;
}

export interface KillEvent {
  killer: Combatant | null;
  victim: Combatant;
  weapon: string;
  headshot: boolean;
  assists: Combatant[];
  distance: number;
  cause: 'weapon' | 'explosion' | 'zone' | 'fall' | 'melee' | 'void';
}

export interface DamageEvent {
  target: Combatant;
  attacker: Combatant | null;
  amount: number;
  headshot: boolean;
  armorHit: boolean;
  armorBroke: boolean;
  from: THREE.Vector3 | null;
  kind: string;
  point: THREE.Vector3;
}

export interface RosterEntry {
  identId: string;
  name: string;
  isPlayer: boolean;
  isBot: boolean;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  placement: number;
  score: number;
  rp: number;
  level: number;
}

export interface MatchResult {
  mode: ModeKind;
  ranked: boolean;
  mapName: string;
  won: boolean;
  draw: boolean;
  placement: number;
  participants: number;
  teamScores: [number, number] | null;
  playerTeam: number;
  stats: Combatant['stats'];
  duration: number;
  roster: RosterEntry[];
  mvp: string;
  survived: number;
  eventTag?: string | null;
}

export interface MatchEvents {
  fire: { c: Combatant; def: WeaponDef };
  reloadStart: { c: Combatant; def: WeaponDef; dur: number; empty: boolean };
  reloadEnd: { c: Combatant };
  cycle: { c: Combatant; kind: 'bolt' | 'pump'; dur: number };
  slot: { c: Combatant };
  damage: DamageEvent;
  kill: KillEvent;
  toast: { text: string; kind: 'info' | 'good' | 'warn' | 'loot' | 'bad' };
  pickup: { c: Combatant; spec: ItemSpec };
  heal: { c: Combatant; kind: HealKind; done: boolean };
  explosion: { pos: THREE.Vector3; radius: number };
  swing: { c: Combatant };
  built: { c: Combatant };
  harvest: { c: Combatant; res: string; amount: number };
  throw: { c: Combatant };
  craft: { c: Combatant; recipe: Recipe };
  end: MatchResult;
  respawn: { c: Combatant };
  announce: { title: string; sub?: string; kind?: string };
  chest: { c: Combatant };
}

interface Projectile {
  kind: 'bullet' | 'rocket' | 'frag' | 'smoke';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Combatant;
  def: WeaponDef | null;
  life: number;
  traveled: number;
  fuse: number;
  mesh: THREE.Object3D | null;
  bounced: number;
  start: THREE.Vector3;
}

export interface Smoke {
  pos: THREE.Vector3;
  radius: number;
  life: number;
}

export interface Noise {
  pos: THREE.Vector3;
  t: number;
  radius: number;
  by: Combatant;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class Match {
  world: VoxelWorld;
  effects: Effects;
  nav: NavService;
  build: BuildSystem;
  combatants: Combatant[] = [];
  player!: Combatant;
  items: WorldItem[] = [];
  projectiles: Projectile[] = [];
  smokes: Smoke[] = [];
  noises: Noise[] = [];
  root = new THREE.Group();
  itemsGroup = new THREE.Group();
  events = new Emitter<MatchEvents>();
  time = 0;
  rng: RNG;
  buildingEnabled = false;
  craftingEnabled = false;
  harvestEnabled = false;
  regenEnabled = false;
  friendlyFire = false;
  dropOnDeath = true;
  ended = false;
  result: MatchResult | null = null;
  phase: 'intro' | 'drop' | 'live' | 'ended' = 'live';
  /** updated by modes so UI can show it */
  statusText = '';
  cracksDirty = false;
  /** Called by UI/AI to know whether a combatant is the local player */
  private botBrains: { update(dt: number): void; c: Combatant; onDamaged?(e: DamageEvent): void }[] = [];
  private lastLightIdx = 0;
  /** brightness flash for local player (explosions etc.) */
  playerShake = 0;
  playerFlash = 0;

  constructor(public engine: Engine, public map: MapData, public cfg: MatchConfig) {
    this.world = map.world;
    this.rng = new RNG(cfg.seed);
    this.effects = new Effects(this.world);
    this.nav = new NavService(this.world);
    this.build = new BuildSystem(this);
    this.root.add(this.itemsGroup, this.effects.group);
    this.world.listeners.push((ch) => {
      this.effects.clearDecalsAt(this.world.idx(ch.x, ch.y, ch.z));
      if (isBuilt(ch.prev) || isBuilt(ch.next)) this.cracksDirty = true;
      // anyone standing where a block appeared gets nudged out
      if (IS_SOLID[ch.next]) for (const c of this.combatants) if (c.alive) unstick(this.world, c.body);
    });
  }

  attach() {
    this.engine.scene.add(this.root);
  }

  dispose() {
    this.engine.scene.remove(this.root);
    for (const c of this.combatants) c.model?.dispose();
    for (const it of this.items) it.dropMesh(this.itemsGroup);
    this.world.listeners = [];
    this.events.clear();
    this.nav.clear();
  }

  registerBrain(b: { update(dt: number): void; c: Combatant; onDamaged?(e: DamageEvent): void }) {
    this.botBrains.push(b);
  }

  get alive() {
    return this.combatants.filter((c) => c.alive);
  }

  addCombatant(ident: Identity, team: number, isPlayer: boolean, pos: THREE.Vector3): Combatant {
    const c = new Combatant(ident, team, isPlayer, pos.x, pos.y, pos.z);
    const camo = CAMOS[ident.camo] ?? null;
    c.model = new CharacterModel(ident.look, { shadowOnly: isPlayer, weaponCamo: camo });
    this.root.add(c.model.root);
    this.combatants.push(c);
    if (isPlayer) this.player = c;
    return c;
  }

  isEnemy(a: Combatant, b: Combatant) {
    return a !== b && (a.team !== b.team || this.friendlyFire);
  }

  // =================================================================== update
  update(dt: number) {
    this.time += dt;
    for (const b of this.botBrains) if (b.c.alive) b.update(dt);
    for (const c of this.combatants) this.simulate(c, dt);
    this.updateProjectiles(dt);
    this.updateItems(dt);
    this.smokes = this.smokes.filter((s) => (s.life -= dt) > 0);
    this.noises = this.noises.filter((n) => this.time - n.t < 2.5);
    this.nav.update(2.5);
    if (this.cracksDirty) this.updateCracks();
    this.effects.update(dt, this.engine.camera.position);
    this.playerShake = Math.max(0, this.playerShake - dt * 2.5);
    this.playerFlash = Math.max(0, this.playerFlash - dt * 1.8);
  }

  private updateCracks() {
    this.cracksDirty = false;
    const w = this.world;
    const list: { x: number; y: number; z: number; stage: number }[] = [];
    for (const [i, hp] of w.builtHP) {
      const y = i % w.sy;
      const col = (i - y) / w.sy;
      const x = col % w.sx;
      const z = (col - x) / w.sx;
      const id = w.blocks[i];
      const max = BLOCKS[id]?.built?.hp ?? 1;
      if (hp >= max) continue;
      list.push({ x, y, z, stage: Math.floor((1 - hp / max) * 5) });
    }
    this.effects.setCracks(list);
  }

  simulate(c: Combatant, dt: number) {
    const w = this.world;
    // local light for shading (staggered)
    c.lightTimer -= dt;
    if (c.lightTimer <= 0) {
      c.lightTimer = 0.25 + Math.random() * 0.1;
      const x = Math.floor(c.body.pos.x), y = Math.floor(c.body.pos.y + 1.5), z = Math.floor(c.body.pos.z);
      c.localSky = w.skyLight(x, y, z) / 15;
      c.localBlock = Math.max(w.blockLight(x, y, z), w.blockLight(x, y - 1, z)) / 15;
      c.model?.setLight(c.localSky, c.localBlock);
    }
    if (!c.alive) {
      c.anim.dead = this.time - c.deathTime;
      this.syncModel(c, dt);
      return;
    }
    c.swapTimer = Math.max(0, c.swapTimer - dt);
    c.toolTimer = Math.max(0, c.toolTimer - dt);
    c.spawnShield = Math.max(0, c.spawnShield - dt);
    c.crouchBlend += ((c.crouching ? 1 : 0) - c.crouchBlend) * Math.min(1, dt * 12);

    // weapons
    const g = c.gun;
    for (const wi of c.weapons) {
      if (!wi) continue;
      wi.bloom = Math.max(0, wi.bloom - wi.def.bloomRecover * dt);
      if (wi.cycling > 0) wi.cycling -= dt;
    }
    if (g && g.reloading > 0) this.tickReload(c, g, dt);
    // recoil recovery
    if (g) {
      const since = this.time - g.lastShot;
      if (since > 0.08) {
        const rr = g.def.recoilRecover * DEG * dt;
        c.recoilPitch = Math.abs(c.recoilPitch) <= rr ? 0 : c.recoilPitch - Math.sign(c.recoilPitch) * rr;
        c.recoilYaw *= Math.exp(-dt * 6);
      }
    } else {
      c.recoilPitch *= Math.exp(-dt * 10);
      c.recoilYaw *= Math.exp(-dt * 10);
    }
    // aim down sights
    const canAds = !!g && c.wantAds && g.reloading <= 0 && c.useTimer < 0 && !c.gliding && !c.dropping && (g.def.action !== 'bolt' || g.cycling <= 0.15);
    const adsRate = g ? 1 / g.def.adsTime : 6;
    c.ads = clamp(c.ads + (canAds ? adsRate : -adsRate * 1.4) * dt, 0, 1);
    if (c.ads > 0.1) c.sprinting = false;
    // healing
    if (c.useTimer >= 0 && c.useKind) {
      c.useTimer += dt;
      if (c.useTimer >= c.useDur) this.finishHeal(c);
    }
    // throw charge
    if (c.throwHold >= 0) c.throwHold += dt;

    // regen (TDM)
    if (this.regenEnabled && this.time - c.lastHurt > 5 && c.hp < 100) c.hp = Math.min(100, c.hp + 14 * dt);

    // movement
    const it = c.intent;
    if (c.dropping || c.gliding) {
      this.simulateDrop(c, dt);
    } else {
      let mult = 1;
      if (g) mult *= g.def.moveMult;
      if (c.ads > 0.3) mult *= lerp(1, 0.62, c.ads);
      if (c.useTimer >= 0) mult *= c.useKind === 'medkit' ? 0.45 : 0.65;
      it.speedMult = mult;
      const wantSprint = it.sprint && it.forward > 0.3 && c.ads < 0.2 && !c.crouching && c.useTimer < 0;
      if (c.sprinting && !wantSprint) c.sprintEnd = this.time;
      c.sprinting = wantSprint;
      it.sprint = wantSprint;
      if (it.crouch !== c.crouching) c.setCrouch(it.crouch, !bodyCollides(w, c.body, c.body.pos.x, c.body.pos.y, c.body.pos.z, 1.8));
      it.crouch = c.crouching;
      const jumped = applyIntent(c.body, it, dt);
      if (jumped && (c.isPlayer || this.near(c.body.pos, 20))) audio.play('land', { pos: c.isPlayer ? undefined : c.body.pos.clone(), vol: 0.25, rate: 1.3 });
      const before = c.body.pos.clone();
      const res = moveBody(w, c.body, dt, true, this.time);
      const moved = Math.hypot(c.body.pos.x - before.x, c.body.pos.z - before.z);
      c.stats.distance += moved;
      if (res.landed) {
        const fd = res.fallDist;
        if (fd > 4.8 && !c.body.inWater) this.damage(c, (fd - 4.8) * 7.5, { attacker: null, kind: 'fall', weapon: 'Fall' });
        if (fd > 1.2 && (c.isPlayer || this.near(c.body.pos, 25))) audio.play('land', { pos: c.isPlayer ? undefined : c.body.pos.clone(), vol: Math.min(1, fd / 6) * 0.7 });
        if (c.isPlayer) this.events.emit('toast', { text: '', kind: 'info' });
      }
      // footsteps
      c.footDist += moved;
      const stride = c.sprinting ? 2.3 : 1.9;
      if (c.footDist > stride && c.body.onGround) {
        c.footDist = 0;
        if (!c.crouching || c.isPlayer) this.footstep(c);
      }
      if (c.body.pos.y < -10) this.kill(c, null, 'Void', false, 'void');
    }
    // water entry splash
    this.syncModel(c, dt);
  }

  private near(p: THREE.Vector3, r: number) {
    return p.distanceToSquared(this.engine.camera.position) < r * r;
  }

  footstep(c: Combatant) {
    const w = this.world;
    const below = w.get(Math.floor(c.body.pos.x), Math.floor(c.body.pos.y - 0.05), Math.floor(c.body.pos.z));
    let surf = BLOCKS[below]?.sound ?? 'stone';
    if (c.body.inWater) surf = 'water';
    const map: Record<string, string> = { glass: 'stone', wool: 'grass' };
    const s = map[surf] ?? surf;
    const vol = c.isPlayer ? (c.sprinting ? 0.32 : 0.22) : c.sprinting ? 0.75 : 0.45;
    if (c.isPlayer) audio.play('step_' + s, { vol });
    else if (this.near(c.body.pos, 32)) audio.play('step_' + s, { pos: c.body.pos.clone(), vol, ref: 2.5 });
    if (c.sprinting) this.noises.push({ pos: c.body.pos.clone(), t: this.time, radius: 14, by: c });
  }

  simulateDrop(c: Combatant, dt: number) {
    const b = c.body;
    const it = c.intent;
    const ground = this.world.groundY(b.pos.x, b.pos.z, Math.floor(b.pos.y));
    const alt = b.pos.y - (ground + 1);
    if (c.dropping && (alt < 26 || (it.jump && alt < 60))) {
      c.dropping = false;
      c.gliding = true;
      if (c.isPlayer) audio.play('b_swing', { vol: 0.6, rate: 0.6 });
    }
    const sy = Math.sin(it.yaw), cy = Math.cos(it.yaw);
    const hx = (-sy * it.forward + cy * it.strafe);
    const hz = (-cy * it.forward - sy * it.strafe);
    const sp = c.gliding ? 12 : 9;
    b.vel.x += (hx * sp - b.vel.x) * Math.min(1, dt * 2.2);
    b.vel.z += (hz * sp - b.vel.z) * Math.min(1, dt * 2.2);
    if (c.dropping) b.vel.y = Math.max(-38, b.vel.y - GRAVITY * dt * (it.forward > 0.5 ? 1.2 : 1));
    else b.vel.y += (-5.2 - b.vel.y) * Math.min(1, dt * 3);
    const res = moveBody(this.world, b, dt, false, this.time);
    if (b.onGround || b.inWater || res.landed) {
      c.dropping = false;
      c.gliding = false;
      b.fallPeakY = b.pos.y;
      if (c.isPlayer) audio.play('land', { vol: 0.6 });
    }
    // keep inside the map
    b.pos.x = clamp(b.pos.x, 6, this.world.sx - 6);
    b.pos.z = clamp(b.pos.z, 6, this.world.sz - 6);
  }

  syncModel(c: Combatant, dt: number) {
    const m = c.model;
    if (!m) return;
    const a = c.anim;
    const hs = Math.hypot(c.body.vel.x, c.body.vel.z);
    a.speed = hs;
    a.onGround = c.body.onGround;
    a.crouch = c.crouchBlend;
    a.pitch = c.pitch;
    a.sprint = c.sprinting;
    a.aiming = c.ads > 0.4;
    a.recoil = Math.max(0, a.recoil - dt * 6);
    a.gliding = c.gliding;
    a.swimming = c.body.inWater && !c.body.onGround;
    a.deathDir = c.deathDir;
    const g = c.gun;
    a.reload = g && g.reloading > 0 ? 1 - g.reloading / Math.max(0.01, g.reloadTotal) : -1;
    a.holding = c.slot <= 2 ? (g ? 'gun' : 'none') : c.slot === 3 ? 'heal' : c.slot === 4 ? 'throw' : 'tool';
    a.throwing = c.throwHold >= 0 ? Math.min(1, c.throwHold * 2) : 0;
    a.swing = c.toolTimer > 0 ? 1 - c.toolTimer / 0.45 : 0;
    if (!c.alive) a.dead = Math.max(0.0001, this.time - c.deathTime);
    else a.dead = 0;
    // held item
    if (c.slot <= 2 && g) m.setWeapon(g.def.id);
    else if (c.slot === 5) m.setWeapon('pickaxe');
    else if (c.slot === 6) m.setWeapon('hammer');
    else if (c.slot === 4) m.setWeapon('frag');
    else if (c.slot <= 2 && !g) m.setWeapon(null);
    m.setArmor(c.armorCap >= 100 ? 3 : c.armorCap >= 75 ? 2 : c.armorCap > 0 ? 1 : 0);
    m.root.position.set(c.body.pos.x, c.body.pos.y + c.body.stepSmooth, c.body.pos.z);
    m.root.rotation.set(0, c.yaw, 0);
    // pose only when visible-ish (perf): near camera or player shadow
    const d2 = c.body.pos.distanceToSquared(this.engine.camera.position);
    const visible = d2 < 220 * 220;
    m.root.visible = visible || c.isPlayer;
    if (visible || c.isPlayer) m.pose(a, dt);
    // fade out corpses
    if (!c.alive) {
      const t = this.time - c.deathTime;
      m.setOpacity(t < 3.5 ? 1 : Math.max(0, 1 - (t - 3.5) / 1.2));
      if (t > 4.8) m.root.visible = false;
    } else m.setOpacity(1);
    // hit flash
    const since = this.time - c.lastHurt;
    if (since < 0.12) m.setFlash(0.5 * (1 - since / 0.12), 0.08, 0.05);
    else if (c.spawnShield > 0) m.setFlash(0.05, 0.12, 0.25 + Math.sin(this.time * 12) * 0.08);
    else m.setFlash(0, 0, 0);
  }

  // =================================================================== weapons
  switchSlot(c: Combatant, s: SlotIndex) {
    if (!c.alive) return;
    if (s === 6 && !this.buildingEnabled) return;
    if (s === 5 && !this.harvestEnabled) return;
    if (s === 3) {
      if (c.slot === 3) {
        // cycle heals
        const order: HealKind[] = ['bandage', 'medkit', 'plate'];
        for (let i = 1; i <= 3; i++) {
          const k = order[(order.indexOf(c.healSel) + i) % 3];
          if (c.heals[k] > 0) {
            c.healSel = k;
            break;
          }
        }
        this.events.emit('slot', { c });
        return;
      }
      if (c.heals[c.healSel] <= 0) {
        const k = (['bandage', 'medkit', 'plate'] as HealKind[]).find((h) => c.heals[h] > 0);
        if (!k) {
          if (c.isPlayer) this.events.emit('toast', { text: 'No healing items', kind: 'warn' });
          return;
        }
        c.healSel = k;
      }
    }
    if (s === 4) {
      if (c.slot === 4) {
        const other = c.throwSel === 'frag' ? 'smoke' : 'frag';
        if (c.throws[other] > 0) c.throwSel = other;
        this.events.emit('slot', { c });
        return;
      }
      if (c.throws[c.throwSel] <= 0) {
        const k = c.throws.frag > 0 ? 'frag' : c.throws.smoke > 0 ? 'smoke' : null;
        if (!k) {
          if (c.isPlayer) this.events.emit('toast', { text: 'No grenades', kind: 'warn' });
          return;
        }
        c.throwSel = k;
      }
    }
    if (s === c.slot) return;
    this.cancelActions(c);
    c.slot = s;
    if (s <= 2) c.lastGunSlot = s as 0 | 1 | 2;
    const g = c.gun;
    c.swapTimer = g ? g.def.equipTime : 0.25;
    c.ads = 0;
    this.events.emit('slot', { c });
    if (c.isPlayer || this.near(c.body.pos, 12)) audio.play('equip', { pos: c.isPlayer ? undefined : c.body.pos.clone(), vol: 0.5 });
  }

  cancelActions(c: Combatant) {
    const g = c.gun;
    if (g && g.reloading > 0) {
      g.reloading = 0;
      this.events.emit('reloadEnd', { c });
    }
    if (c.useTimer >= 0) {
      c.useTimer = -1;
      c.useKind = null;
    }
    c.throwHold = -1;
  }

  reload(c: Combatant) {
    const g = c.gun;
    if (!g || !c.alive) return;
    const d = g.def;
    if (g.reloading > 0 || g.mag >= d.mag || c.ammo[d.ammo] <= 0 || c.swapTimer > 0) return;
    if (c.useTimer >= 0) return;
    const empty = g.mag === 0;
    let dur: number;
    if (d.reload.kind === 'shell') {
      const need = Math.min(d.mag - g.mag, c.ammo[d.ammo]);
      dur = 0.3 + need * (d.reload.perShell ?? 0.5) + (empty ? 0.45 : 0.1);
      g.reloadShells = 0;
    } else dur = empty ? d.reload.empty : d.reload.time;
    g.reloading = dur;
    g.reloadTotal = dur;
    c.ads = Math.min(c.ads, 0.3);
    this.events.emit('reloadStart', { c, def: d, dur, empty });
    if (!c.isPlayer && this.near(c.body.pos, 18)) audio.play('mag_out', { pos: c.body.pos.clone(), vol: 0.6 });
  }

  private tickReload(c: Combatant, g: WeaponInstance, dt: number) {
    const d = g.def;
    g.reloading -= dt;
    if (d.reload.kind === 'shell') {
      const elapsed = g.reloadTotal - g.reloading;
      const per = d.reload.perShell ?? 0.5;
      const shouldHave = Math.floor((elapsed - 0.3) / per) + 1;
      while (g.reloadShells < shouldHave && g.mag < d.mag && c.ammo[d.ammo] > 0) {
        g.reloadShells++;
        g.mag++;
        c.ammo[d.ammo]--;
        if (c.isPlayer) audio.play('shell_in', { vol: 0.7 });
        else if (this.near(c.body.pos, 15)) audio.play('shell_in', { pos: c.body.pos.clone(), vol: 0.5 });
      }
      if (g.reloading <= 0) {
        g.reloading = 0;
        if (g.reloadShells > 0 && g.mag === g.reloadShells) {
          // pumped a fresh round in
          this.events.emit('cycle', { c, kind: 'pump', dur: 0.45 });
        }
        this.events.emit('reloadEnd', { c });
      }
      return;
    }
    if (g.reloading <= 0) {
      g.reloading = 0;
      const need = d.mag - g.mag;
      const take = Math.min(need, c.ammo[d.ammo]);
      g.mag += take;
      c.ammo[d.ammo] -= take;
      this.events.emit('reloadEnd', { c });
    }
  }

  spreadDeg(c: Combatant, g: WeaponInstance) {
    const d = g.def;
    const base = lerp(d.spreadHip, d.spreadAds, c.ads);
    const hs = Math.hypot(c.body.vel.x, c.body.vel.z);
    const move = Math.min(1.4, hs / 4.6) * d.spreadMove * (1 - c.ads * 0.5);
    const air = !c.body.onGround && !c.body.inWater ? d.spreadAir : 0;
    const crouch = c.crouching && c.body.onGround ? 0.72 : 1;
    return (base + move + air + g.bloom) * crouch;
  }

  /** Returns true if a shot was fired. `held` = trigger state this frame. */
  tryFire(c: Combatant, held: boolean, aimOverride?: THREE.Vector3): boolean {
    const g = c.gun;
    if (!g || !c.alive) return false;
    const d = g.def;
    const prevHeld = g.triggerHeld;
    g.triggerHeld = held;
    if (!held) {
      c.dryFired = false;
      return false;
    }
    if (c.swapTimer > 0 || c.useTimer >= 0 || c.throwHold >= 0 || c.gliding || c.dropping) return false;
    if (g.reloading > 0) {
      if (d.reload.kind === 'shell' && g.mag > 0 && !prevHeld) {
        g.reloading = 0;
        this.events.emit('reloadEnd', { c });
      } else return false;
    }
    if (g.cycling > 0) return false;
    if (d.action !== 'auto' && prevHeld) return false;
    if (this.time - g.lastShot < g.interval) return false;
    if (this.time - c.sprintEnd < 0.1) return false;
    if (g.mag <= 0) {
      if (!c.dryFired) {
        c.dryFired = true;
        if (c.isPlayer) audio.play('dry_fire', { vol: 0.8 });
        if (c.ammo[d.ammo] > 0) this.reload(c);
      }
      return false;
    }
    c.sprinting = false;
    c.spawnShield = 0;
    g.mag--;
    g.lastShot = this.time;
    c.stats.shots++;
    c.lastShotTime = this.time;
    const eye = c.eye();
    c.lastShotPos.copy(eye);
    const baseDir = aimOverride ? aimOverride.clone().normalize() : c.aimDir();
    const spread = this.spreadDeg(c, g) * DEG;
    const right = tmpV.set(-baseDir.z, 0, baseDir.x).normalize().clone();
    const up = tmpV2.crossVectors(right, baseDir).normalize().clone();
    // muzzle (for tracers)
    const muzzle = c.isPlayer ? this.playerMuzzle(eye, baseDir) : (c.model ? (c.model.updateHelpers(), c.model.muzzle.clone()) : eye.clone());
    for (let p = 0; p < d.pellets; p++) {
      const r = Math.sqrt(Math.random()) * Math.tan(spread / 2);
      const a = Math.random() * Math.PI * 2;
      const dir = baseDir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      if (d.projectile) this.spawnBullet(c, d, eye, dir, muzzle);
      else this.hitscan(c, d, eye, dir, muzzle, p === 0 || d.pellets < 4 || p % 3 === 0);
    }
    // recoil & bloom
    const adsK = lerp(1, 0.55, c.ads) * (c.crouching ? 0.8 : 1);
    c.recoilPitch += d.recoilV * DEG * adsK * (0.85 + Math.random() * 0.3);
    c.recoilYaw += (Math.random() - 0.5) * 2 * d.recoilH * DEG * adsK;
    g.bloom = Math.min(d.bloomMax, g.bloom + d.bloomPerShot);
    if (d.cycle) {
      g.cycling = d.cycle;
      if (g.mag > 0 || d.action === 'bolt') this.events.emit('cycle', { c, kind: d.action === 'bolt' ? 'bolt' : 'pump', dur: d.cycle * 0.92 });
    }
    // feedback
    c.anim.recoil = 1;
    if (c.isPlayer) audio.gun(d.soundKey, null, 1);
    else audio.gun(d.soundKey, muzzle, 1);
    const loud = d.category === 'sniper' ? 160 : d.category === 'launcher' ? 120 : d.category === 'pistol' || d.category === 'smg' ? 65 : 95;
    this.noises.push({ pos: eye.clone(), t: this.time, radius: loud, by: c });
    if (d.category !== 'launcher') {
      const flashDir = baseDir.clone();
      if (!c.isPlayer) this.effects.muzzleFlash(muzzle, flashDir, d.category === 'shotgun' ? 1.4 : 1);
      this.engine.addLight(muzzle, new THREE.Color(5, 3.2, 1.4), 7, 0.06);
    }
    if (!c.isPlayer && d.action !== 'bolt' && d.action !== 'pump' && d.category !== 'launcher') {
      const m = c.model;
      if (m && this.near(c.body.pos, 30)) {
        const ej = muzzle.clone().addScaledVector(baseDir, -0.5);
        this.effects.casing(ej, new THREE.Vector3(Math.cos(c.yaw) * 2, 2.5, -Math.sin(c.yaw) * 2), d.category === 'shotgun' ? 'shotgun' : d.category === 'pistol' || d.category === 'smg' ? 'small' : 'rifle');
      }
    }
    this.events.emit('fire', { c, def: d });
    if (g.mag === 0 && c.ammo[d.ammo] > 0 && !c.isPlayer) this.reload(c);
    return true;
  }

  /** player muzzle world position comes from the viewmodel via hook */
  playerMuzzleHook: ((eye: THREE.Vector3, dir: THREE.Vector3) => THREE.Vector3) | null = null;
  private playerMuzzle(eye: THREE.Vector3, dir: THREE.Vector3) {
    if (this.playerMuzzleHook) return this.playerMuzzleHook(eye, dir);
    return eye.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.15, 0));
  }

  /** Ray vs character hitboxes (axis aligned; characters only yaw). */
  hitCharacters(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number, shooter: Combatant | null): { c: Combatant; t: number; part: 'head' | 'body' | 'legs' } | null {
    let best: { c: Combatant; t: number; part: 'head' | 'body' | 'legs' } | null = null;
    for (const o of this.combatants) {
      if (!o.alive || o === shooter) continue;
      if (shooter && !this.isEnemy(shooter, o)) continue;
      if (o.dropping && !o.gliding) continue;
      const p = o.body.pos;
      const dx = p.x - origin.x, dz = p.z - origin.z;
      if (dx * dx + dz * dz > (maxT + 2) * (maxT + 2)) continue;
      const crouch = o.crouchBlend * 0.32;
      const parts: ['head' | 'body' | 'legs', number, number, number][] = [
        ['head', 1.36 - crouch, 1.82 - crouch, 0.27],
        ['body', 0.7 - crouch * 0.6, 1.36 - crouch, 0.34],
        ['legs', 0, 0.7 - crouch * 0.6, 0.28],
      ];
      for (const [part, y0, y1, hw] of parts) {
        const t = rayBox(origin, dir, p.x - hw, p.y + y0, p.z - hw, p.x + hw, p.y + y1, p.z + hw);
        if (t !== null && t < maxT && (!best || t < best.t)) best = { c: o, t, part };
      }
    }
    return best;
  }

  /** voxel trace that passes through foliage and shatters glass */
  traceBlocks(origin: THREE.Vector3, dir: THREE.Vector3, range: number, breakGlass: boolean) {
    const w = this.world;
    let o = origin.clone();
    let travelled = 0;
    for (let pass = 0; pass < 4; pass++) {
      const hit = w.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, range - travelled, (id) => IS_SOLID[id] === 1 && !BULLET_PASS[id] && id !== B.WATER);
      if (!hit) return null;
      const def = BLOCKS[hit.id];
      if (def.fragile && breakGlass) {
        this.build.damageBlock(hit.x, hit.y, hit.z, 1, null);
        travelled += hit.dist + 0.01;
        o = new THREE.Vector3(hit.px, hit.py, hit.pz).addScaledVector(dir, 0.02);
        continue;
      }
      hit.dist += travelled;
      return hit;
    }
    return null;
  }

  private hitscan(c: Combatant, d: WeaponDef, eye: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, tracer: boolean) {
    const blockHit = this.traceBlocks(eye, dir, d.range, this.buildingEnabled);
    const maxT = blockHit ? blockHit.dist : d.range;
    const ch = this.hitCharacters(eye, dir, maxT, c);
    let end: THREE.Vector3;
    if (ch) {
      end = eye.clone().addScaledVector(dir, ch.t);
      this.bulletHit(c, d, ch.c, ch.part, end, dir, ch.t);
    } else if (blockHit) {
      end = new THREE.Vector3(blockHit.px, blockHit.py, blockHit.pz);
      this.blockImpact(c, d, blockHit, end, dir);
    } else end = eye.clone().addScaledVector(dir, Math.min(d.range, 160));
    if (tracer) this.effects.tracer(muzzle, end, d.category === 'smg' || d.category === 'pistol' ? new THREE.Color(2.6, 2.2, 1.3) : new THREE.Color(3.6, 2.6, 1.2));
  }

  private blockImpact(c: Combatant, d: WeaponDef, hit: { x: number; y: number; z: number; id: number; nx: number; ny: number; nz: number }, p: THREE.Vector3, dir: THREE.Vector3) {
    const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
    if (n.lengthSq() === 0) n.copy(dir).negate();
    const near = this.near(p, 60);
    if (near) {
      this.effects.impact(p, n, hit.id, d.category === 'sniper' || d.category === 'shotgun');
      if (!isBuilt(hit.id) && RENDER[hit.id] === 1) this.effects.decal(p, n, hit.x, hit.y, hit.z);
      const snd = BLOCKS[hit.id]?.sound;
      const kind = snd === 'wood' ? 'wood' : snd === 'metal' ? 'metal' : snd === 'glass' ? 'glass' : snd === 'grass' || snd === 'dirt' || snd === 'sand' || snd === 'snow' || snd === 'gravel' ? 'dirt' : 'stone';
      if (this.near(p, 30)) audio.play('hit_' + kind, { pos: p, vol: 0.35, ref: 3 });
    }
    if (this.buildingEnabled && isBuilt(hit.id)) {
      const dmg = d.damage * d.pellets > 0 ? d.damage * d.blockDamage : 0;
      this.build.damageBlock(hit.x, hit.y, hit.z, dmg, c);
      this.cracksDirty = true;
    }
  }

  private bulletHit(c: Combatant, d: WeaponDef, target: Combatant, part: 'head' | 'body' | 'legs', p: THREE.Vector3, dir: THREE.Vector3, dist: number) {
    const [f0, f1, minM] = d.falloff;
    const fall = lerp(1, minM, clamp((dist - f0) / Math.max(1, f1 - f0), 0, 1));
    let dmg = d.damage * fall;
    if (part === 'head') dmg *= d.headMult;
    else if (part === 'legs') dmg *= 0.85;
    c.stats.hits++;
    if (part === 'head') c.stats.headshots++;
    const armorHit = target.armor > 0;
    if (this.near(p, 50)) this.effects.flesh(p, dir, armorHit);
    this.damage(target, dmg, { attacker: c, kind: 'bullet', weapon: d.name, headshot: part === 'head', from: c.eye(), point: p, dist });
  }

  private spawnBullet(c: Combatant, d: WeaponDef, eye: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3) {
    const pr = d.projectile!;
    if (pr.explode) {
      // rocket
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.28, 0.2) }));
      mesh.position.copy(muzzle);
      this.root.add(mesh);
      this.projectiles.push({ kind: 'rocket', pos: muzzle.clone(), vel: dir.clone().multiplyScalar(pr.speed), owner: c, def: d, life: 6, traveled: 0, fuse: 0, mesh, bounced: 0, start: muzzle.clone() });
      this.effects.muzzleFlash(muzzle, dir, 2.2);
      if (c.isPlayer) this.playerShake = Math.max(this.playerShake, 0.5);
      return;
    }
    this.projectiles.push({ kind: 'bullet', pos: eye.clone(), vel: dir.clone().multiplyScalar(pr.speed), owner: c, def: d, life: 2, traveled: 0, fuse: 0, mesh: null, bounced: 0, start: muzzle.clone() });
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.life -= dt;
      let alive = p.life > 0;
      if (p.kind === 'bullet' || p.kind === 'rocket') {
        const g = p.def!.projectile!.gravity;
        const steps = p.kind === 'bullet' ? 3 : 1;
        for (let s = 0; s < steps && alive; s++) {
          const sdt = dt / steps;
          p.vel.y -= g * sdt;
          const seg = p.vel.clone().multiplyScalar(sdt);
          const len = seg.length();
          const dir = seg.clone().divideScalar(len);
          const blockHit = this.traceBlocks(p.pos, dir, len, this.buildingEnabled);
          const maxT = blockHit ? blockHit.dist : len;
          const ch = this.hitCharacters(p.pos, dir, maxT, p.owner);
          if (ch) {
            const hp = p.pos.clone().addScaledVector(dir, ch.t);
            if (p.kind === 'rocket') this.explode(hp, p.def!.projectile!.explode!.radius, p.def!.projectile!.explode!.damage, p.owner, p.def!.name, 260);
            else {
              this.bulletHit(p.owner, p.def!, ch.c, ch.part, hp, dir, p.traveled + ch.t);
              this.effects.tracer(p.start, hp, new THREE.Color(4, 3.2, 1.8), 900);
            }
            alive = false;
          } else if (blockHit) {
            const hp = new THREE.Vector3(blockHit.px, blockHit.py, blockHit.pz);
            if (p.kind === 'rocket') this.explode(hp.addScaledVector(dir, -0.2), p.def!.projectile!.explode!.radius, p.def!.projectile!.explode!.damage, p.owner, p.def!.name, 260);
            else {
              this.blockImpact(p.owner, p.def!, blockHit, hp, dir);
              this.effects.tracer(p.start, hp, new THREE.Color(4, 3.2, 1.8), 900);
            }
            alive = false;
          } else {
            p.pos.add(seg);
            p.traveled += len;
            if (p.traveled > p.def!.range) {
              if (p.kind === 'bullet') this.effects.tracer(p.start, p.pos, new THREE.Color(4, 3.2, 1.8), 900);
              alive = false;
            }
          }
        }
        if (p.mesh) {
          p.mesh.position.copy(p.pos);
          p.mesh.lookAt(p.pos.clone().add(p.vel));
          if (Math.random() < 0.9) this.effects.puff(p.pos.clone(), new THREE.Color(0.75, 0.74, 0.72), 1, 0.3, 1.5);
          this.engine.addLight(p.pos, new THREE.Color(4, 2, 0.8), 6, 0.05);
        }
        if (!alive && p.kind === 'rocket' && p.life <= 0) this.explode(p.pos, 5, 115, p.owner, 'Thumper RL', 260);
      } else {
        // grenades: bouncing physics
        p.fuse -= dt;
        p.vel.y -= 22 * dt;
        const np = p.pos.clone().addScaledVector(p.vel, dt);
        const w = this.world;
        if (IS_SOLID[w.getF(np.x, np.y, np.z)]) {
          let bounced = false;
          if (IS_SOLID[w.getF(p.pos.x, np.y, p.pos.z)]) {
            p.vel.y = -p.vel.y * 0.38;
            p.vel.x *= 0.72;
            p.vel.z *= 0.72;
            np.y = p.pos.y;
            bounced = true;
          }
          if (IS_SOLID[w.getF(np.x, p.pos.y, p.pos.z)]) {
            p.vel.x = -p.vel.x * 0.45;
            np.x = p.pos.x;
            bounced = true;
          }
          if (IS_SOLID[w.getF(p.pos.x, p.pos.y, np.z)]) {
            p.vel.z = -p.vel.z * 0.45;
            np.z = p.pos.z;
            bounced = true;
          }
          if (!bounced) {
            p.vel.multiplyScalar(-0.3);
            np.copy(p.pos);
          }
          if (p.vel.length() > 2 && this.near(np, 35)) audio.play('bounce', { pos: np.clone(), vol: Math.min(1, p.vel.length() / 10) });
          p.bounced++;
        }
        p.pos.copy(np);
        if (p.mesh) {
          p.mesh.position.copy(p.pos);
          p.mesh.rotation.x += dt * p.vel.length();
          p.mesh.rotation.z += dt * 3;
        }
        if (p.fuse <= 0) {
          if (p.kind === 'frag') this.explode(p.pos.clone().add(new THREE.Vector3(0, 0.15, 0)), FRAG.radius, FRAG.damage, p.owner, 'Frag Grenade', FRAG.blockDamage);
          else this.popSmoke(p.pos.clone());
          alive = false;
        }
      }
      if (alive) keep.push(p);
      else if (p.mesh) {
        this.root.remove(p.mesh);
        (p.mesh as THREE.Mesh).geometry?.dispose();
      }
    }
    this.projectiles = keep;
  }

  popSmoke(p: THREE.Vector3) {
    this.smokes.push({ pos: p.clone().add(new THREE.Vector3(0, 1, 0)), radius: 4.6, life: 14 });
    this.effects.smokeCloud(p, 14);
    if (this.near(p, 60)) audio.play('smoke_hiss', { pos: p.clone(), vol: 0.8 });
  }

  explode(pos: THREE.Vector3, radius: number, damage: number, owner: Combatant | null, weapon: string, blockDamage: number) {
    this.effects.explosion(pos, radius);
    this.engine.addLight(pos, new THREE.Color(12, 6, 2), radius * 4, 0.45);
    const d = pos.distanceTo(this.engine.camera.position);
    audio.play(d < 70 ? 'explosion' : 'explosion_far', { pos: pos.clone(), vol: 1, ref: 10 });
    if (this.player?.alive) {
      const k = clamp(1 - d / (radius * 6), 0, 1);
      this.playerShake = Math.max(this.playerShake, k * 1.5);
      this.playerFlash = Math.max(this.playerFlash, clamp(1 - d / (radius * 2), 0, 1) * 0.5);
    }
    this.noises.push({ pos: pos.clone(), t: this.time, radius: 120, by: owner ?? this.player });
    for (const c of this.combatants) {
      if (!c.alive) continue;
      if (owner && c !== owner && !this.isEnemy(owner, c)) continue;
      const center = c.body.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
      const dist = center.distanceTo(pos);
      if (dist > radius) continue;
      const los = this.world.lineOfSight(pos.x, pos.y, pos.z, center.x, center.y, center.z, true) || this.world.lineOfSight(pos.x, pos.y + 0.5, pos.z, center.x, center.y + 0.7, center.z, true);
      let dmg = damage * Math.pow(1 - dist / radius, 0.9) * (los ? 1 : 0.3);
      if (c === owner) dmg *= 0.45;
      if (dmg < 1) continue;
      this.damage(c, dmg, { attacker: owner, kind: 'explosion', weapon, from: pos.clone(), point: center });
      // knockback
      const kb = center.clone().sub(pos).normalize().multiplyScalar((1 - dist / radius) * 9);
      c.body.vel.add(kb);
      c.body.vel.y += (1 - dist / radius) * 4;
    }
    if (this.buildingEnabled) this.build.explode(pos, radius * 0.8, blockDamage, owner);
    else {
      // glass still shatters in every mode
      const r = Math.ceil(radius * 0.6);
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            const x = Math.floor(pos.x) + dx, y = Math.floor(pos.y) + dy, z = Math.floor(pos.z) + dz;
            if (BLOCKS[this.world.get(x, y, z)]?.fragile) this.build.damageBlock(x, y, z, 1, owner);
          }
    }
    this.events.emit('explosion', { pos, radius });
  }

  // =================================================================== damage
  damage(target: Combatant, amount: number, info: { attacker: Combatant | null; kind: string; weapon: string; headshot?: boolean; from?: THREE.Vector3; point?: THREE.Vector3; dist?: number }) {
    if (!target.alive || amount <= 0) return;
    if (target.spawnShield > 0 && info.kind !== 'zone') return;
    if (this.ended) return;
    let rest = amount;
    let armorHit = false;
    let armorBroke = false;
    if (info.kind !== 'zone' && info.kind !== 'fall' && target.armor > 0) {
      const a = Math.min(target.armor, rest);
      target.armor -= a;
      rest -= a;
      armorHit = true;
      if (target.armor <= 0) armorBroke = true;
    }
    target.hp -= rest;
    target.lastHurt = this.time;
    const atk = info.attacker;
    if (atk && atk !== target) {
      target.lastAttacker = atk.id;
      const rec = target.damageBy.get(atk.id) ?? { dmg: 0, t: 0 };
      rec.dmg += amount;
      rec.t = this.time;
      target.damageBy.set(atk.id, rec);
      atk.stats.damage += amount;
    }
    target.stats.damageTaken += amount;
    if (info.from) {
      const dx = info.from.x - target.body.pos.x;
      const dz = info.from.z - target.body.pos.z;
      target.deathDir = Math.atan2(dx, dz) - target.yaw + Math.PI;
    }
    const ev: DamageEvent = {
      target, attacker: atk, amount, headshot: !!info.headshot, armorHit, armorBroke, from: info.from ?? null, kind: info.kind,
      point: info.point ?? target.body.pos.clone().add(new THREE.Vector3(0, 1.2, 0)),
    };
    this.events.emit('damage', ev);
    for (const b of this.botBrains) if (b.c === target) b.onDamaged?.(ev);
    // sounds for the local player perspective
    if (atk?.isPlayer && target !== atk) {
      audio.ui(info.headshot ? 'headshot' : 'hitmarker', info.headshot ? 0.9 : 0.7);
      if (armorHit) audio.play('hit_armor', { vol: 0.35 });
      if (armorBroke) audio.play('hit_armor', { vol: 0.8, rate: 0.7 });
    }
    if (target.isPlayer) {
      audio.play(armorHit ? 'hit_armor' : 'hit_flesh', { vol: 0.8 });
    } else if (this.near(target.body.pos, 30) && !atk?.isPlayer) {
      audio.play(armorHit ? 'hit_armor' : 'hit_flesh', { pos: target.body.pos.clone(), vol: 0.5 });
    }
    if (target.hp <= 0) {
      target.hp = 0;
      const cause = info.kind === 'zone' ? 'zone' : info.kind === 'fall' ? 'fall' : info.kind === 'explosion' ? 'explosion' : info.kind === 'melee' ? 'melee' : 'weapon';
      this.kill(target, atk, info.weapon, !!info.headshot, cause);
    }
  }

  kill(victim: Combatant, killer: Combatant | null, weapon: string, headshot: boolean, cause: KillEvent['cause']) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deathTime = this.time;
    victim.stats.deaths++;
    victim.streak = 0;
    victim.useTimer = -1;
    victim.throwHold = -1;
    // credit the last attacker for environmental deaths shortly after damage
    if (!killer && victim.lastAttacker !== null) {
      const rec = victim.damageBy.get(victim.lastAttacker);
      if (rec && this.time - rec.t < 8) killer = this.combatants.find((c) => c.id === victim.lastAttacker) ?? null;
    }
    const assists: Combatant[] = [];
    for (const [id, rec] of victim.damageBy) {
      if (killer && id === killer.id) continue;
      if (this.time - rec.t < 12 && rec.dmg >= 18) {
        const a = this.combatants.find((c) => c.id === id);
        if (a && a !== victim) {
          a.stats.assists++;
          assists.push(a);
        }
      }
    }
    let distance = 0;
    if (killer && killer !== victim) {
      killer.stats.kills++;
      killer.streak++;
      distance = killer.body.pos.distanceTo(victim.body.pos);
      killer.stats.longestKill = Math.max(killer.stats.longestKill, distance);
      if (weapon === 'Frag Grenade') killer.stats.grenadeKills++;
      if (weapon === WEAPONS.longshot.name || weapon === WEAPONS.arbiter.name) killer.stats.sniperKills++;
      if (killer.isPlayer) audio.ui('kill', 0.9);
    }
    victim.killedBy = killer ? { name: killer.name, weapon, id: killer.id } : null;
    const ev: KillEvent = { killer: killer && killer !== victim ? killer : null, victim, weapon, headshot, assists, distance, cause };
    if (this.dropOnDeath) this.dropInventory(victim);
    this.onKill(ev);
    this.events.emit('kill', ev);
  }

  /** mode hook */
  onKill(_e: KillEvent) {}

  // =================================================================== healing
  startHeal(c: Combatant, kind?: HealKind) {
    if (!c.alive || c.useTimer >= 0) return;
    const k = kind ?? c.bestHeal();
    if (!k) {
      if (c.isPlayer) this.events.emit('toast', { text: c.hp >= 100 && c.armor >= 100 ? 'Already at full health' : 'No usable healing', kind: 'warn' });
      return;
    }
    if (!c.canUseHeal(k)) {
      if (c.isPlayer) this.events.emit('toast', { text: HEALS[k].hp > 0 ? (c.hp >= HEALS[k].max ? `${HEALS[k].name} only heals to ${HEALS[k].max}` : 'None left') : 'Armor already full', kind: 'warn' });
      return;
    }
    if (c.slot !== 3) {
      this.cancelActions(c);
      c.slot = 3;
      c.healSel = k;
      this.events.emit('slot', { c });
    }
    c.healSel = k;
    c.useKind = k;
    c.useTimer = 0;
    c.useDur = HEALS[k].time;
    c.sprinting = false;
    this.events.emit('heal', { c, kind: k, done: false });
    if (c.isPlayer) audio.play(k === 'plate' ? 'b_plate' : 'b_heal', { vol: 0.6 });
  }

  private finishHeal(c: Combatant) {
    const k = c.useKind!;
    const d = HEALS[k];
    c.heals[k]--;
    if (d.hp > 0) {
      const before = c.hp;
      c.hp = Math.min(d.max, c.hp + d.hp);
      c.stats.healed += c.hp - before;
    }
    if (d.armor > 0) c.armor = Math.min(100, c.armor + d.armor);
    if (d.armor > 0 && c.armorCap < c.armor) c.armorCap = Math.max(c.armorCap, 50);
    c.useTimer = -1;
    c.useKind = null;
    this.events.emit('heal', { c, kind: k, done: true });
    if (c.isPlayer) audio.play(k === 'plate' ? 'b_plate' : 'ui_confirm', { vol: 0.5, bus: 'ui' });
    // continue using if still useful and held
    if (c.heals[k] <= 0 || !c.canUseHeal(k)) {
      // return to last weapon
      if (c.hasAnyGun()) this.switchSlot(c, c.lastGunSlot);
    }
  }

  // =================================================================== grenades
  startThrow(c: Combatant) {
    if (!c.alive || c.throwHold >= 0 || c.useTimer >= 0) return false;
    if (c.throws[c.throwSel] <= 0) {
      const other = c.throwSel === 'frag' ? 'smoke' : 'frag';
      if (c.throws[other] > 0) c.throwSel = other;
      else {
        if (c.isPlayer) this.events.emit('toast', { text: 'No grenades', kind: 'warn' });
        return false;
      }
    }
    if (c.slot !== 4) {
      c.quickThrowReturn = c.slot;
      this.cancelActions(c);
      c.slot = 4;
      c.swapTimer = 0.1;
      this.events.emit('slot', { c });
    }
    c.throwHold = 0;
    if (c.isPlayer) audio.play('pin_pull', { vol: 0.7 });
    return true;
  }

  throwVelocity(c: Combatant, charge = 1): THREE.Vector3 {
    const dir = c.aimDir();
    const speed = lerp(12, 22, clamp(charge, 0, 1));
    return dir.multiplyScalar(speed).add(new THREE.Vector3(0, 2.5, 0)).add(c.body.vel.clone().multiplyScalar(0.5));
  }

  releaseThrow(c: Combatant, velOverride?: THREE.Vector3) {
    if (c.throwHold < 0) return;
    const kind = c.throwSel;
    const charge = clamp(c.throwHold / 0.6, 0.35, 1);
    c.throwHold = -1;
    if (c.throws[kind] <= 0) return;
    c.throws[kind]--;
    const eye = c.eye();
    const dir = c.aimDir();
    const start = eye.clone().addScaledVector(dir, 0.4);
    const vel = velOverride ?? this.throwVelocity(c, charge);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), new THREE.MeshLambertMaterial({ color: kind === 'frag' ? 0x4a5530 : 0x8a9490 }));
    mesh.position.copy(start);
    this.root.add(mesh);
    this.projectiles.push({ kind, pos: start, vel, owner: c, def: null, life: 10, traveled: 0, fuse: THROWABLES[kind].fuse, mesh, bounced: 0, start: start.clone() });
    this.events.emit('throw', { c });
    if (c.isPlayer || this.near(c.body.pos, 20)) audio.play('throw', { pos: c.isPlayer ? undefined : c.body.pos.clone(), vol: 0.6 });
    // return to the previous slot after a short delay
    const back = c.quickThrowReturn;
    c.quickThrowReturn = null;
    setTimeout(() => {
      if (!c.alive || c.slot !== 4) return;
      if (back !== null && back !== 4) this.switchSlot(c, back);
      else if (c.throws[c.throwSel] <= 0 && c.hasAnyGun()) this.switchSlot(c, c.lastGunSlot);
    }, 320);
  }

  /** predicted grenade arc for UI */
  predictArc(c: Combatant, charge: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const p = c.eye().addScaledVector(c.aimDir(), 0.4);
    const v = this.throwVelocity(c, clamp(charge / 0.6, 0.35, 1));
    const dt = 0.05;
    for (let i = 0; i < 70; i++) {
      pts.push(p.clone());
      v.y -= 22 * dt;
      const np = p.clone().addScaledVector(v, dt);
      if (IS_SOLID[this.world.getF(np.x, np.y, np.z)]) {
        pts.push(np);
        break;
      }
      p.copy(np);
    }
    return pts;
  }

  // =================================================================== tool / harvest
  toolSwing(c: Combatant) {
    if (!c.alive || c.toolTimer > 0) return;
    c.toolTimer = 0.45;
    this.events.emit('swing', { c });
    if (c.isPlayer || this.near(c.body.pos, 15)) audio.play('b_swing', { pos: c.isPlayer ? undefined : c.body.pos.clone(), vol: 0.5 });
    setTimeout(() => this.toolHit(c), 170);
  }

  private toolHit(c: Combatant) {
    if (!c.alive || this.ended) return;
    const eye = c.eye();
    const dir = c.aimDir();
    const ch = this.hitCharacters(eye, dir, 2.6, c);
    const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 3.4, (id) => id !== B.AIR && id !== B.WATER && RENDER[id] !== 0);
    if (ch && (!hit || ch.t < hit.dist)) {
      const p = eye.clone().addScaledVector(dir, ch.t);
      this.effects.flesh(p, dir, ch.c.armor > 0);
      this.damage(ch.c, 22, { attacker: c, kind: 'melee', weapon: 'Forge Pick', from: eye, point: p });
      return;
    }
    if (!hit) return;
    const def = BLOCKS[hit.id];
    const p = new THREE.Vector3(hit.px, hit.py, hit.pz);
    const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
    this.effects.impact(p, n, hit.id, true);
    if (isBuilt(hit.id)) {
      audio.play('b_chip', { pos: p, vol: 0.6 });
      this.build.damageBlock(hit.x, hit.y, hit.z, 30, c);
      this.cracksDirty = true;
      return;
    }
    if (def.harvest && this.harvestEnabled) {
      const res = def.harvest.res;
      const gain = Math.max(1, Math.round(def.harvest.amount / (res === 'wood' && def.harvest.fell ? 1 : 1.5)));
      const got = c.addMat(res, gain);
      c.stats.harvested += got;
      audio.play(res === 'wood' ? 'b_chop' : 'b_chip', { pos: p, vol: 0.7 });
      if (got > 0) this.events.emit('harvest', { c, res, amount: got });
      const isTree = !!def.harvest.fell;
      const destroyed = this.build.damageBlock(hit.x, hit.y, hit.z, isTree ? 18 : 26, c, { harvest: true });
      if (destroyed) {
        if (isTree) {
          const bonus = c.addMat('wood', 12);
          if (bonus > 0) this.events.emit('harvest', { c, res: 'wood', amount: bonus });
          audio.play('b_tree_fall', { pos: p, vol: 0.9 });
        } else {
          const bonus = c.addMat(res, def.harvest.amount);
          if (bonus > 0) this.events.emit('harvest', { c, res, amount: bonus });
          audio.play('b_break_stone', { pos: p, vol: 0.7 });
        }
      }
      return;
    }
    audio.play('hit_stone', { pos: p, vol: 0.5, rate: 1.4 });
  }

  // =================================================================== items
  spawnItem(spec: ItemSpec, pos: THREE.Vector3, vel?: THREE.Vector3): WorldItem {
    const it = new WorldItem(spec, pos.clone(), this.time);
    if (vel) it.vel.copy(vel);
    else it.resting = true;
    const x = Math.floor(pos.x), y = Math.floor(pos.y + 0.5), z = Math.floor(pos.z);
    it.light.set(this.world.skyLight(x, y, z) / 15, this.world.blockLight(x, y, z) / 15);
    this.items.push(it);
    return it;
  }

  populateLoot() {
    const r = new RNG(this.cfg.seed ^ 0xabc);
    for (const s of this.map.lootSpots) {
      if (r.chance(0.18)) continue;
      const specs = rollFloor(r, s.tier);
      specs.forEach((sp, i) => this.spawnItem(sp, new THREE.Vector3(s.x + (i ? (r.next() - 0.5) * 0.8 : 0), s.y, s.z + (i ? (r.next() - 0.5) * 0.8 : 0))));
    }
  }

  private updateItems(dt: number) {
    const cam = this.engine.camera.position;
    const w = this.world;
    const keep: WorldItem[] = [];
    for (const it of this.items) {
      if (it.taken) {
        it.dropMesh(this.itemsGroup);
        continue;
      }
      if (!it.resting) {
        it.vel.y -= 20 * dt;
        const np = it.pos.clone().addScaledVector(it.vel, dt);
        if (IS_SOLID[w.getF(np.x, np.y, np.z)]) {
          if (IS_SOLID[w.getF(it.pos.x, np.y, it.pos.z)]) {
            np.y = Math.floor(np.y) + 1;
            if (Math.abs(it.vel.y) < 3) {
              it.resting = true;
              it.vel.set(0, 0, 0);
            } else it.vel.y *= -0.3;
          }
          if (IS_SOLID[w.getF(np.x, it.pos.y, it.pos.z)]) {
            np.x = it.pos.x;
            it.vel.x *= -0.3;
          }
          if (IS_SOLID[w.getF(it.pos.x, it.pos.y, np.z)]) {
            np.z = it.pos.z;
            it.vel.z *= -0.3;
          }
        }
        if (w.getF(np.x, np.y, np.z) === B.WATER) {
          it.vel.multiplyScalar(0.9);
          it.vel.y = Math.max(it.vel.y, -1);
        }
        it.pos.copy(np);
        it.vel.x *= Math.exp(-dt * 1.5);
        it.vel.z *= Math.exp(-dt * 1.5);
        if (it.pos.y < -5) {
          it.taken = true;
          continue;
        }
      } else if (!IS_SOLID[w.getF(it.pos.x, it.pos.y - 0.05, it.pos.z)] && w.getF(it.pos.x, it.pos.y - 0.05, it.pos.z) !== B.WATER) {
        it.resting = false; // support removed
      }
      it.noPickupFor = Math.max(0, it.noPickupFor - dt);
      const d2 = it.pos.distanceToSquared(cam);
      if (d2 < 75 * 75) {
        it.ensureMesh(this.itemsGroup);
        it.syncMesh(this.time);
      } else it.dropMesh(this.itemsGroup);
      keep.push(it);
    }
    this.items = keep;
    // auto pickup
    for (const c of this.combatants) {
      if (!c.alive || c.dropping || c.gliding) continue;
      for (const it of this.items) {
        if (it.taken || (it.noPickupFor > 0 && it.noPickupId === c.id)) continue;
        if (Math.abs(it.pos.x - c.body.pos.x) > 1.3 || Math.abs(it.pos.z - c.body.pos.z) > 1.3) continue;
        if (Math.abs(it.pos.y - c.body.pos.y - 0.4) > 1.4) continue;
        if (this.autoPickupOK(c, it)) this.pickup(c, it);
      }
    }
  }

  private autoPickupOK(c: Combatant, it: WorldItem) {
    const s = it.spec;
    switch (s.kind) {
      case 'ammo':
        return c.ammo[s.ammo] < AMMO_MAX[s.ammo];
      case 'mat':
        return true;
      case 'heal':
        return c.heals[s.heal] < HEALS[s.heal].cap;
      case 'throw':
        return c.throws[s.throw] < THROWABLES[s.throw].cap;
      case 'weapon':
        return c.weapons.some((w) => w === null) && !c.weapons.some((w) => w?.def.id === s.weapon);
      case 'armor':
        return ARMOR_VEST[s.tier].armor > c.armor;
    }
  }

  /** Item the combatant is looking at / standing near for manual pickup. */
  lookItem(c: Combatant, maxDist = 2.6): WorldItem | null {
    const eye = c.eye();
    const dir = c.aimDir();
    let best: WorldItem | null = null;
    let bestScore = Infinity;
    for (const it of this.items) {
      if (it.taken) continue;
      const to = it.pos.clone().add(new THREE.Vector3(0, 0.3, 0)).sub(eye);
      const d = to.length();
      if (d > maxDist + 1.2) continue;
      const flat = Math.hypot(it.pos.x - c.body.pos.x, it.pos.z - c.body.pos.z);
      if (flat > maxDist) continue;
      const cos = to.dot(dir) / Math.max(0.001, d);
      if (cos < 0.75 && flat > 1.1) continue;
      const score = d * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  lookChest(c: Combatant): { x: number; y: number; z: number } | null {
    const eye = c.eye();
    const dir = c.aimDir();
    const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 3.3, (id) => IS_SOLID[id] === 1 || id === B.CHEST);
    if (hit && hit.id === B.CHEST) return { x: hit.x, y: hit.y, z: hit.z };
    return null;
  }

  interact(c: Combatant): boolean {
    if (!c.alive) return false;
    const ch = this.lookChest(c);
    if (ch) {
      this.openChest(c, ch.x, ch.y, ch.z);
      return true;
    }
    const it = this.lookItem(c);
    if (it) {
      this.pickup(c, it, true);
      return true;
    }
    return false;
  }

  openChest(c: Combatant, x: number, y: number, z: number) {
    const entry = this.map.chests.find((e) => e.x === x && e.y === y && e.z === z);
    const tier = entry?.tier ?? 'common';
    this.world.set(x, y, z, B.CHEST_OPEN);
    c.stats.chests++;
    const r = new RNG(this.cfg.seed ^ (x * 73856093) ^ (z * 19349663));
    const specs = rollChest(r, tier);
    const center = new THREE.Vector3(x + 0.5, y + 1.0, z + 0.5);
    specs.forEach((s, i) => {
      const a = (i / specs.length) * Math.PI * 2 + r.next();
      this.spawnItem(s, center.clone(), new THREE.Vector3(Math.cos(a) * 2.2, 4.5, Math.sin(a) * 2.2));
    });
    audio.play('b_chest', { pos: center.clone(), vol: 0.9 });
    this.effects.puff(center, new THREE.Color(1.6, 1.3, 0.6), 4, 0.6, 0.8);
    this.engine.addLight(center, new THREE.Color(3, 2.4, 1.2), 6, 0.6);
    this.events.emit('chest', { c });
  }

  pickup(c: Combatant, it: WorldItem, manual = false): boolean {
    const s = it.spec;
    let took = false;
    switch (s.kind) {
      case 'weapon': {
        const res = c.giveWeapon(s.weapon, s.mag);
        took = true;
        if (res.dropped) {
          const d = this.spawnItem({ kind: 'weapon', weapon: res.dropped.def.id, mag: res.dropped.mag }, c.body.pos.clone().add(new THREE.Vector3(0, 1, 0)), c.aimDir().multiplyScalar(2).add(new THREE.Vector3(0, 2, 0)));
          d.noPickupFor = 1.5;
          d.noPickupId = c.id;
        }
        const emptyHands = c.slot > 2 || !c.weapons[c.slot] || res.dropped !== null || manual;
        if (emptyHands || !c.gun) {
          this.cancelActions(c);
          c.slot = res.slot as SlotIndex;
          c.lastGunSlot = res.slot as 0 | 1 | 2;
          c.swapTimer = WEAPONS[s.weapon].equipTime;
          this.events.emit('slot', { c });
        }
        break;
      }
      case 'ammo': {
        const got = c.addAmmo(s.ammo, s.count);
        if (got > 0) {
          took = got >= s.count;
          if (!took) s.count -= got;
          else took = true;
          if (!took) this.events.emit('pickup', { c, spec: { ...s, count: got } });
        }
        break;
      }
      case 'heal': {
        const got = c.addHeal(s.heal, s.count);
        if (got > 0) {
          took = got >= s.count;
          if (!took) s.count -= got;
        }
        break;
      }
      case 'throw': {
        const got = c.addThrow(s.throw, s.count);
        if (got > 0) {
          took = got >= s.count;
          if (!took) s.count -= got;
        }
        break;
      }
      case 'mat': {
        const got = c.addMat(s.mat, s.count);
        if (got > 0) {
          took = got >= s.count;
          if (!took) s.count -= got;
        }
        break;
      }
      case 'armor': {
        const a = ARMOR_VEST[s.tier].armor;
        if (a > c.armor || manual) {
          // swap vests: drop the old one if it was better tier-wise
          c.armorCap = Math.max(c.armorCap * (manual ? 0 : 1), a);
          c.armor = Math.max(c.armor, a);
          took = true;
        }
        break;
      }
    }
    if (took) {
      it.taken = true;
      this.events.emit('pickup', { c, spec: s });
      if (c.isPlayer) audio.ui('pickup', 0.8);
    } else if (manual && c.isPlayer) {
      this.events.emit('toast', { text: 'Inventory full', kind: 'warn' });
      audio.ui('deny', 0.6);
    }
    return took;
  }

  dropInventory(c: Combatant) {
    const base = c.body.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
    const specs: ItemSpec[] = [];
    for (const w of c.weapons) if (w) specs.push({ kind: 'weapon', weapon: w.def.id as WeaponId, mag: w.mag });
    for (const [k, v] of Object.entries(c.ammo)) if (v > 0) specs.push({ kind: 'ammo', ammo: k as any, count: v });
    for (const [k, v] of Object.entries(c.heals)) if (v > 0) specs.push({ kind: 'heal', heal: k as any, count: v });
    for (const [k, v] of Object.entries(c.throws)) if (v > 0) specs.push({ kind: 'throw', throw: k as any, count: v });
    for (const [k, v] of Object.entries(c.mats)) if (v > 0) specs.push({ kind: 'mat', mat: k as any, count: v });
    if (c.armorCap > 0) specs.push({ kind: 'armor', tier: c.armorCap >= 100 ? 3 : c.armorCap >= 75 ? 2 : 1 });
    specs.forEach((s, i) => {
      const a = (i / Math.max(1, specs.length)) * Math.PI * 2;
      this.spawnItem(s, base, new THREE.Vector3(Math.cos(a) * 2.4, 3.5 + Math.random(), Math.sin(a) * 2.4));
    });
    c.weapons = [null, null, null];
    for (const k of Object.keys(c.ammo)) (c.ammo as any)[k] = 0;
    for (const k of Object.keys(c.heals)) (c.heals as any)[k] = 0;
    for (const k of Object.keys(c.throws)) (c.throws as any)[k] = 0;
    for (const k of Object.keys(c.mats)) (c.mats as any)[k] = 0;
    c.armorCap = 0;
  }

  // =================================================================== crafting
  craft(c: Combatant, id: string): boolean {
    if (!this.craftingEnabled) return false;
    const r = RECIPES.find((x) => x.id === id);
    if (!r || !canAfford(c.mats, r)) {
      if (c.isPlayer) audio.ui('deny', 0.7);
      return false;
    }
    // check capacity
    const g = r.give;
    let fits = true;
    if (g.kind === 'heal') fits = c.heals[g.heal] < HEALS[g.heal].cap;
    if (g.kind === 'throw') fits = c.throws[g.throw] < THROWABLES[g.throw].cap;
    if (g.kind === 'ammo') fits = c.ammo[g.ammo] < AMMO_MAX[g.ammo];
    if (!fits) {
      if (c.isPlayer) {
        this.events.emit('toast', { text: 'No room for ' + itemName(g), kind: 'warn' });
        audio.ui('deny', 0.7);
      }
      return false;
    }
    for (const [k, v] of Object.entries(r.cost)) c.mats[k as keyof typeof c.mats] -= v ?? 0;
    if (g.kind === 'ammo') c.addAmmo(g.ammo, g.count);
    else if (g.kind === 'heal') c.addHeal(g.heal, g.count);
    else if (g.kind === 'throw') c.addThrow(g.throw, g.count);
    else if (g.kind === 'mat') c.addMat(g.mat, g.count);
    c.stats.crafted++;
    this.events.emit('craft', { c, recipe: r });
    if (c.isPlayer) audio.ui('craft', 0.8);
    return true;
  }

  // =================================================================== building host
  placeBuild(c: Combatant, piece: Piece, rot: number, mat: BuildMat): { ok: boolean; reason: string; placement: Placement } {
    const p = this.build.compute(c, piece, rot, mat);
    if (!this.buildingEnabled) return { ok: false, reason: 'Building disabled', placement: p };
    if (!p.valid) return { ok: false, reason: p.reason, placement: p };
    if (c.mats[mat] < p.cost) return { ok: false, reason: `Need ${p.cost} ${mat}`, placement: p };
    const ok = this.build.place(c, p, mat);
    if (ok) {
      const center = p.blocks[Math.floor(p.blocks.length / 2)];
      audio.play('b_place', { pos: new THREE.Vector3(center.x + 0.5, center.y + 0.5, center.z + 0.5), vol: 0.8 });
      this.effects.puff(new THREE.Vector3(center.x + 0.5, center.y + 0.2, center.z + 0.5), new THREE.Color(0.7, 0.66, 0.6), 2, 0.8, 0.8);
      this.events.emit('built', { c });
    }
    return { ok, reason: ok ? '' : 'Cannot place', placement: p };
  }

  onBlockDestroyed(x: number, y: number, z: number, id: number, by: Combatant | null, silent = false) {
    if (id === B.AIR) return;
    const near = this.near(new THREE.Vector3(x, y, z), 70);
    if (near) this.effects.blockBreak(x, y, z, id, silent ? 4 : 14);
    if (!silent && near) {
      const def = BLOCKS[id];
      const snd = def?.sound === 'wood' || def?.sound === 'leaves' ? 'b_break_wood' : def?.sound === 'metal' ? 'b_break_metal' : def?.sound === 'glass' ? 'hit_glass' : 'b_break_stone';
      audio.play(snd, { pos: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), vol: 0.8 });
    }
    if (by && isBuilt(id)) by.stats.destroyed++;
    this.cracksDirty = true;
  }

  // =================================================================== AI helpers
  /** Line of sight for AI vision (leaves and smoke block it). */
  canSee(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const s of this.smokes) {
      if (segSphere(a, b, s.pos, s.radius * Math.min(1, s.life / 2))) return false;
    }
    return this.world.lineOfSight(a.x, a.y, a.z, b.x, b.y, b.z, false);
  }

  /** mode-specific: should this combatant be considered by AI as an enemy target */
  finish(result: MatchResult) {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    this.result = result;
    this.events.emit('end', result);
  }

  buildRoster(placements?: Map<number, number>): RosterEntry[] {
    return this.combatants.map((c) => ({
      identId: c.ident.id,
      name: c.name,
      isPlayer: c.isPlayer,
      isBot: c.ident.isBot,
      team: c.team,
      kills: c.stats.kills,
      deaths: c.stats.deaths,
      assists: c.stats.assists,
      damage: Math.round(c.stats.damage),
      placement: placements?.get(c.id) ?? c.placement,
      score: c.stats.kills * 100 + c.stats.assists * 50 + Math.round(c.stats.damage),
      rp: c.ident.rp,
      level: c.ident.level,
    }));
  }
}

export function rayBox(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = -Infinity, tmax = Infinity;
  const ax = [o.x, o.y, o.z], ad = [d.x, d.y, d.z], mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ad[i]) < 1e-9) {
      if (ax[i] < mn[i] || ax[i] > mx[i]) return null;
    } else {
      let t1 = (mn[i] - ax[i]) / ad[i];
      let t2 = (mx[i] - ax[i]) / ad[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}

function segSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number) {
  const ab = b.clone().sub(a);
  const t = clamp(c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  const p = a.clone().addScaledVector(ab, t);
  return p.distanceToSquared(c) < r * r;
}

export { SHADOW_LAYER };
