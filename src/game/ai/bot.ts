// AI player controller. Uses exactly the same inputs/APIs as the human
// player: a movement intent, look angles, and match actions. Skill affects
// decision quality (cover, flanks, grenades, rotations) as well as aim.

import * as THREE from 'three';
import type { Match, DamageEvent } from '../match';
import type { Combatant } from '../combatant';
import { skillParams, type Personality } from './personality';
import { WEAPONS, type WeaponDef, type ItemSpec, ARMOR_VEST, HEALS, AMMO_MAX } from '../weapons';
import type { WorldItem } from '../items';
import { B, IS_SOLID, isLog, type BuildMat } from '../../world/blocks';
import { snapStand, standable } from './nav';
import { clamp, wrapAngle, DEG } from '../../core/mathx';
import { RECIPES, canAfford } from '../crafting';

type State = 'drop' | 'loot' | 'roam' | 'rotate' | 'fight' | 'chase' | 'heal' | 'investigate' | 'push' | 'harvest' | 'hold';

export interface BotHooks {
  /** BR: zone info */
  zone?: () => { cx: number; cz: number; r: number; nx: number; nz: number; nr: number; shrinking: boolean; countdown: number } | null;
  /** TDM: goal for pushing */
  pushGoal?: (b: BotBrain) => THREE.Vector3 | null;
  perches?: THREE.Vector3[];
}

export class BotBrain {
  sk: ReturnType<typeof skillParams>;
  p: Personality;
  state: State = 'roam';
  target: Combatant | null = null;
  targetVisible = false;
  lastSeenPos = new THREE.Vector3();
  lastSeenTime = -100;
  spottedAt = -100;
  private path: THREE.Vector3[] = [];
  private pathI = 0;
  private goal: THREE.Vector3 | null = null;
  private pathPending = false;
  private repathAt = 0;
  private stuckT = 0;
  private stuckCount = 0;
  private lastPos = new THREE.Vector3();
  private thinkT = Math.random() * 0.3;
  private aimErr = new THREE.Vector2();
  private strafeDir = 1;
  private strafeT = 0;
  private burstLeft = 0;
  private burstPause = 0;
  private nextClick = 0;
  private cover: THREE.Vector3 | null = null;
  private coverUntil = 0;
  private lootItem: WorldItem | null = null;
  private lootChest: { x: number; y: number; z: number } | null = null;
  private harvestBlock: { x: number; y: number; z: number } | null = null;
  private threat: THREE.Vector3 | null = null;
  private threatTime = -100;
  private holdUntil = 0;
  private investigatePos: THREE.Vector3 | null = null;
  private lastBuild = -100;
  private lastNade = -100;
  private wantJump = false;
  private crouchHold = 0;
  private distractedUntil = 0;
  private peekT = 0;
  dropTarget: THREE.Vector2 | null = null;
  jumpProgress = 0.5;
  private lookYaw = 0;
  private lookPitch = 0;
  private slotCooldown = 0;
  private headPref: boolean;
  private lane = Math.random();

  constructor(public c: Combatant, public match: Match, public skill: number, public hooks: BotHooks = {}) {
    this.sk = skillParams(skill);
    this.p = c.ident.personality!;
    this.headPref = Math.random() < this.sk.headshot;
    this.lookYaw = c.yaw;
  }

  private get now() {
    return this.match.time;
  }

  onDamaged(e: DamageEvent) {
    if (!e.attacker || e.attacker === this.c) return;
    if (!this.match.isEnemy(this.c, e.attacker)) return;
    // know roughly where it came from
    const err = (1 - this.skill) * 6;
    this.threat = e.attacker.body.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * err, 0, (Math.random() - 0.5) * err));
    this.threatTime = this.now;
    if (!this.targetVisible) {
      this.target = e.attacker;
      this.lastSeenPos.copy(this.threat);
      this.lastSeenTime = this.now;
    }
    // panic build if exposed
    if (this.match.buildingEnabled && this.c.hp < 85 && Math.random() < this.p.building * 0.8 && this.now - this.lastBuild > 2.5) this.buildCover(e.attacker.body.pos);
  }

  // ===================================================================
  update(dt: number) {
    const c = this.c;
    this.thinkT -= dt;
    this.slotCooldown -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.22 + Math.random() * 0.16;
      this.think();
    }
    if (c.dropping || c.gliding) {
      this.steerDrop();
      return;
    }
    this.updateAim(dt);
    this.updateMove(dt);
    this.updateFire(dt);
  }

  // ------------------------------------------------------------ perception
  private perceive() {
    const c = this.c;
    const m = this.match;
    const eye = c.eye();
    const fwd = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const range = m.cfg.mode === 'tdm' ? 95 : 130;
    let best: Combatant | null = null;
    let bestScore = Infinity;
    const cands = m.combatants
      .filter((o) => o.alive && m.isEnemy(c, o) && !(o.dropping && !o.gliding))
      .map((o) => ({ o, d: o.body.pos.distanceTo(c.body.pos) }))
      .filter((x) => x.d < range)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (const { o, d } of cands) {
      // vision cone (wider when close or recently attacked by them)
      const to = o.body.pos.clone().sub(c.body.pos).setY(0).normalize();
      const cos = to.dot(fwd);
      const recentlyHit = c.lastAttacker === o.id && this.now - c.lastHurt < 2;
      const fov = d < 6 ? -1 : recentlyHit ? -0.5 : 0.35 - this.skill * 0.25;
      if (cos < fov) continue;
      // crouched / still targets are harder to notice at range
      let eff = d;
      if (o.crouching) eff *= 1.35;
      if (Math.hypot(o.body.vel.x, o.body.vel.z) < 0.5) eff *= 1.15;
      if (o.lastShotTime > this.now - 1.5) eff *= 0.6;
      if (eff > range) continue;
      const head = o.eye();
      const chest = o.body.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
      if (!m.canSee(eye, head) && !m.canSee(eye, chest)) continue;
      let score = d;
      if (o === this.target) score *= 0.6;
      if (recentlyHit) score *= 0.5;
      if (o.hp < 40) score *= 0.85;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) {
        // new acquisition: reaction delay + fresh aim error
        if (best !== this.target || this.now - this.lastSeenTime > 1.5) {
          this.spottedAt = this.now + this.sk.reaction * (0.7 + Math.random() * 0.6);
          const e = this.sk.aimError * DEG * (1 + Math.min(2, best.body.pos.distanceTo(c.body.pos) / 40));
          const a = Math.random() * Math.PI * 2;
          this.aimErr.set(Math.cos(a) * e, Math.sin(a) * e * 0.6);
          this.headPref = Math.random() < this.sk.headshot;
        }
      }
      this.target = best;
      this.targetVisible = true;
      this.lastSeenPos.copy(best.body.pos);
      this.lastSeenTime = this.now;
      // team callout: share with nearby allies
      if (m.cfg.mode === 'tdm') {
        for (const b of (m as any).brains as BotBrain[] | undefined ?? []) {
          if (b === this || b.c.team !== c.team || !b.c.alive) continue;
          if (b.c.body.pos.distanceTo(c.body.pos) < 40 * b.p.teamwork + 10 && !b.targetVisible && Math.random() < b.skill) {
            b.lastSeenPos.copy(best.body.pos);
            b.lastSeenTime = this.now;
            b.target = best;
          }
        }
      }
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
    // hearing
    if (!this.targetVisible && !this.investigatePos) {
      for (const n of m.noises) {
        if (n.by === c || !m.isEnemy(c, n.by)) continue;
        const d = n.pos.distanceTo(c.body.pos);
        if (d < n.radius * (0.6 + this.skill * 0.4)) {
          this.investigatePos = n.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------ decisions
  private think() {
    const c = this.c;
    const m = this.match;
    if (!c.alive) return;
    if (c.dropping || c.gliding) return;
    this.perceive();
    this.manageInventory();
    const hasGun = c.weapons.some((w) => w && (w.mag > 0 || c.ammo[w.def.ammo] > 0));
    const zone = this.hooks.zone?.() ?? null;
    const lowHp = c.hp + c.armor * 0.5 < 45 + this.p.caution * 30;
    const prev = this.state;

    if (this.targetVisible && this.target && hasGun) this.state = 'fight';
    else if (this.target && this.target.alive && this.now - this.lastSeenTime < 5 + this.p.aggression * 6 && hasGun && !lowHp) this.state = 'chase';
    else if (lowHp && this.canHeal() && !this.targetVisible) this.state = 'heal';
    else if (zone && this.zoneUrgent(zone)) this.state = 'rotate';
    else if (m.cfg.mode === 'br' && this.needsLoot()) this.state = 'loot';
    else if (this.investigatePos && hasGun && this.p.aggression > 0.3) this.state = 'investigate';
    else if (m.cfg.mode === 'tdm' || m.cfg.mode === 'tutorial') this.state = 'push';
    else if (m.cfg.mode === 'br' && this.p.building > 0.5 && c.mats.wood < 40 && this.findTree()) this.state = 'harvest';
    else if (zone) this.state = this.now < this.holdUntil ? 'hold' : 'rotate';
    else this.state = 'roam';

    if (!hasGun && this.state === 'fight') this.state = m.cfg.mode === 'br' ? 'loot' : 'push';
    if (prev !== this.state) {
      this.path = [];
      this.goal = null;
    }

    switch (this.state) {
      case 'fight':
        this.thinkFight();
        break;
      case 'chase':
        this.setGoal(this.lastSeenPos);
        this.maybeNade();
        break;
      case 'heal':
        if (c.useTimer < 0) {
          const k = c.bestHeal();
          if (k) m.startHeal(c, k);
        }
        break;
      case 'loot':
        this.thinkLoot();
        break;
      case 'rotate':
      case 'hold':
        this.thinkRotate(zone);
        break;
      case 'investigate':
        if (this.investigatePos) {
          this.setGoal(this.investigatePos);
          if (this.investigatePos.distanceTo(c.body.pos) < 4) this.investigatePos = null;
        }
        break;
      case 'push': {
        const g = this.hooks.pushGoal?.(this) ?? null;
        if (g) this.setGoal(g);
        break;
      }
      case 'harvest':
        this.thinkHarvest();
        break;
      case 'roam':
        if (!this.goal || this.goal.distanceTo(c.body.pos) < 3) this.setGoal(this.randomNearby(30));
        break;
    }
    // reload when safe
    const g = c.gun;
    if (g && !this.targetVisible && g.mag < g.def.mag * 0.5 && c.ammo[g.def.ammo] > 0) m.reload(c);
    // crafting when supplies are low
    if (m.craftingEnabled && Math.random() < 0.15) this.maybeCraft();
    // occasionally forget / get distracted (human-like mistakes)
    if (Math.random() < this.sk.mistake * 0.08) this.distractedUntil = this.now + 0.4 + Math.random() * 0.8;
  }

  private canHeal() {
    const k = this.c.bestHeal();
    return !!k && this.c.canUseHeal(k);
  }

  private manageInventory() {
    const c = this.c;
    const m = this.match;
    if (c.useTimer >= 0 || c.throwHold >= 0 || this.slotCooldown > 0) return;
    if (this.state === 'harvest') return;
    // pick the right gun for the situation
    const d = this.target && this.state === 'fight' ? this.target.body.pos.distanceTo(c.body.pos) : 30;
    let best = -1;
    let bestS = -1;
    c.weapons.forEach((w, i) => {
      if (!w) return;
      const has = w.mag > 0 || c.ammo[w.def.ammo] > 0;
      if (!has) return;
      const [lo, hi] = w.def.idealRange;
      let s = d >= lo && d <= hi ? 3 : d < lo ? 1.5 - (lo - d) / 30 : 1.5 - (d - hi) / 60;
      if (this.p.favWeapons.includes(w.def.id)) s += 0.6;
      if (w.mag === 0) s -= 0.8;
      if (w.def.category === 'launcher' && (d < 10 || !this.target)) s -= 2;
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    });
    if (best >= 0 && (c.slot > 2 || best !== c.slot)) {
      const cur = c.gun;
      const curReloading = cur && cur.reloading > 0;
      if (!curReloading || c.slot > 2) {
        m.switchSlot(c, best as 0 | 1 | 2);
        this.slotCooldown = 1.2 + (1 - this.skill) * 1.5;
      }
    }
  }

  private thinkFight() {
    const c = this.c;
    const t = this.target!;
    const m = this.match;
    const d = t.body.pos.distanceTo(c.body.pos);
    const g = c.gun;
    // cover when hurt or reloading
    const hurt = c.hp + c.armor < 60;
    const reloading = g && (g.reloading > 0 || g.mag === 0);
    if ((hurt || reloading) && Math.random() < this.sk.coverUse && (!this.cover || this.now > this.coverUntil)) {
      const cv = this.findCover(t);
      if (cv) {
        this.cover = cv;
        this.coverUntil = this.now + 2.5 + Math.random() * 2;
      }
    }
    if (this.cover && this.now > this.coverUntil) this.cover = null;
    if (g && g.mag === 0 && c.ammo[g.def.ammo] > 0) m.reload(c);
    // build when exposed and outgunned
    if (m.buildingEnabled && d > 6 && d < 60 && this.now - this.lastBuild > 4 && Math.random() < this.p.building * 0.25 && c.hp < 90) this.buildCover(t.body.pos);
    // grenade into cover
    this.maybeNade();
    // aim error drifts while tracking a moving target
    const tv = Math.hypot(t.body.vel.x, t.body.vel.z);
    if (tv > 3 && Math.random() < 0.3 * (1 - this.skill)) {
      this.aimErr.x += (Math.random() - 0.5) * 2.5 * DEG * (1 - this.skill);
    }
    // strafe pattern
    this.strafeT -= 0.3;
    if (this.strafeT <= 0) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeT = 0.6 + Math.random() * 1.8 * (1 - this.sk.strafe * 0.5);
    }
    // crouch at range for accuracy
    this.crouchHold = d > 25 && (this.p.archetype === 'sniper' || this.p.archetype === 'tactician') && Math.random() < 0.6 ? 1 : 0;
    this.wantJump = d < 12 && this.p.aggression > 0.6 && Math.random() < 0.08;
    // positioning
    const ideal = g ? g.def.idealRange : [5, 40];
    if (this.cover) this.setGoal(this.cover);
    else if (d > ideal[1] * (1 + (1 - this.p.aggression) * 0.3) || (!this.targetVisible && this.p.aggression > 0.5)) {
      // flankers swing wide
      if (this.p.archetype === 'flanker' && d > 15) {
        const side = new THREE.Vector3().subVectors(t.body.pos, c.body.pos).normalize();
        const perp = new THREE.Vector3(-side.z, 0, side.x).multiplyScalar(this.lane > 0.5 ? 10 : -10);
        this.setGoal(t.body.pos.clone().add(perp));
      } else this.setGoal(t.body.pos);
    } else if (d < ideal[0] * 0.7 && g && g.def.category !== 'shotgun' && g.def.category !== 'smg') {
      const away = c.body.pos.clone().sub(t.body.pos).setY(0).normalize().multiplyScalar(8);
      this.setGoal(c.body.pos.clone().add(away));
    } else {
      this.goal = null;
      this.path = [];
    }
  }

  private maybeNade() {
    const c = this.c;
    const t = this.target;
    if (!t || c.throws.frag <= 0 || c.throwHold >= 0) return;
    if (this.now - this.lastNade < 6) return;
    const d = this.lastSeenPos.distanceTo(c.body.pos);
    if (d < 7 || d > 28) return;
    const hiding = !this.targetVisible && this.now - this.lastSeenTime < 4;
    const camping = this.targetVisible && t.crouching && Math.random() < 0.3;
    if (!(hiding || camping)) return;
    if (Math.random() > this.p.grenades * this.sk.grenadeIQ) return;
    // ballistic solve for a ~0.9-1.4 s flight
    const target = this.lastSeenPos.clone().add(new THREE.Vector3(0, 0.6, 0));
    const start = c.eye();
    const T = 0.8 + d / 30;
    const vel = new THREE.Vector3(
      (target.x - start.x) / T,
      (target.y - start.y + 0.5 * 22 * T * T) / T,
      (target.z - start.z) / T,
    );
    if (vel.length() > 26) return;
    c.throwSel = 'frag';
    if (this.match.startThrow(c)) {
      this.lastNade = this.now;
      setTimeout(() => {
        if (c.alive && c.throwHold >= 0) this.match.releaseThrow(c, vel.add(new THREE.Vector3((Math.random() - 0.5) * (1 - this.skill) * 3, 0, (Math.random() - 0.5) * (1 - this.skill) * 3)));
      }, 350);
    }
  }

  private buildCover(enemy: THREE.Vector3) {
    const c = this.c;
    const m = this.match;
    const mat: BuildMat | null = c.mats.metal >= 10 && this.skill > 0.6 ? 'metal' : c.mats.stone >= 10 ? 'stone' : c.mats.wood >= 10 ? 'wood' : null;
    if (!mat) return;
    // face the enemy horizontally and drop a wall
    const prevYaw = c.yaw;
    const prevPitch = c.pitch;
    c.yaw = Math.atan2(-(enemy.x - c.body.pos.x), -(enemy.z - c.body.pos.z));
    c.pitch = -0.35;
    const r = m.placeBuild(c, 'wall', 0, mat);
    if (r.ok && this.skill > 0.55 && Math.random() < 0.4 && c.mats[mat] >= 10) {
      c.pitch = -0.6;
      m.placeBuild(c, 'ramp', 0, mat);
    }
    c.yaw = prevYaw;
    c.pitch = prevPitch;
    this.lastBuild = this.now;
  }

  private findCover(t: Combatant): THREE.Vector3 | null {
    const c = this.c;
    const w = this.match.world;
    const enemyEye = t.eye();
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 8;
      const x = Math.floor(c.body.pos.x + Math.cos(a) * r);
      const z = Math.floor(c.body.pos.z + Math.sin(a) * r);
      const y = snapStand(w, x, Math.floor(c.body.pos.y), z);
      if (y === null) continue;
      const head = new THREE.Vector3(x + 0.5, y + 1.5, z + 0.5);
      if (w.lineOfSight(enemyEye.x, enemyEye.y, enemyEye.z, head.x, head.y, head.z)) continue;
      const d = head.distanceTo(c.body.pos);
      if (d < bestD) {
        bestD = d;
        best = new THREE.Vector3(x + 0.5, y, z + 0.5);
      }
    }
    return best;
  }

  // ------------------------------------------------------------ looting
  private gearScore() {
    const c = this.c;
    const guns = c.weapons.filter((w) => w && c.ammo[w.def.ammo] + w.mag > 0).length;
    const heals = c.heals.bandage + c.heals.medkit * 3 + c.heals.plate;
    return guns * 2 + Math.min(3, heals) + (c.armor >= 50 ? 1 : 0) + (c.armor >= 75 ? 1 : 0);
  }

  private needsLoot() {
    const satisfied = 6 + (this.p.archetype === 'looter' ? 2 : 0);
    if (this.gearScore() < satisfied) return true;
    return !!this.findLoot(10);
  }

  private itemValue(s: ItemSpec): number {
    const c = this.c;
    switch (s.kind) {
      case 'weapon': {
        const def = WEAPONS[s.weapon];
        if (c.weapons.some((w) => w?.def.id === s.weapon)) return 0;
        const free = c.weapons.some((w) => w === null);
        const tierV = def.tier === 'epic' ? 3 : def.tier === 'rare' ? 2 : 1;
        const fav = this.p.favWeapons.includes(s.weapon) ? 1.5 : 0;
        if (free) return 5 + tierV + fav;
        const worst = Math.min(...c.weapons.map((w) => (w ? (w.def.tier === 'epic' ? 3 : w.def.tier === 'rare' ? 2 : 1) + (this.p.favWeapons.includes(w.def.id) ? 1.5 : 0) : 0)));
        return tierV + fav > worst + 0.5 ? 2 + tierV : 0;
      }
      case 'ammo':
        return c.weapons.some((w) => w?.def.ammo === s.ammo) && c.ammo[s.ammo] < AMMO_MAX[s.ammo] * 0.6 ? 3 : 0;
      case 'armor':
        return ARMOR_VEST[s.tier].armor > c.armor ? 4 + s.tier : 0;
      case 'heal':
        return c.heals[s.heal] < HEALS[s.heal].cap ? (s.heal === 'medkit' ? 3 : 2) : 0;
      case 'throw':
        return c.throws[s.throw] < 3 ? 1.5 : 0;
      case 'mat':
        return this.p.building > 0.4 || s.mat === 'cloth' || s.mat === 'powder' ? 1 : 0.3;
    }
  }

  private findLoot(radius: number): { item?: WorldItem; chest?: { x: number; y: number; z: number }; pos: THREE.Vector3 } | null {
    const c = this.c;
    const m = this.match;
    let best: { item?: WorldItem; chest?: { x: number; y: number; z: number }; pos: THREE.Vector3 } | null = null;
    let bestS = 0;
    const p = c.body.pos;
    for (const it of m.items) {
      if (it.taken || !it.resting) continue;
      const d = it.pos.distanceTo(p);
      if (d > radius) continue;
      const v = this.itemValue(it.spec);
      if (v <= 0) continue;
      // avoid items another bot is already going for
      const s = v / (4 + d);
      if (s > bestS) {
        bestS = s;
        best = { item: it, pos: it.pos.clone() };
      }
    }
    for (const ch of m.map.chests) {
      if (m.world.get(ch.x, ch.y, ch.z) !== B.CHEST) continue;
      const pos = new THREE.Vector3(ch.x + 0.5, ch.y, ch.z + 0.5);
      const d = pos.distanceTo(p);
      if (d > radius) continue;
      const s = (ch.tier === 'epic' ? 9 : ch.tier === 'rare' ? 7 : 5) / (4 + d);
      if (s > bestS) {
        bestS = s;
        best = { chest: ch, pos };
      }
    }
    return best;
  }

  private thinkLoot() {
    const c = this.c;
    const m = this.match;
    if (this.lootItem && (this.lootItem.taken || this.itemValue(this.lootItem.spec) <= 0)) this.lootItem = null;
    if (this.lootChest && m.world.get(this.lootChest.x, this.lootChest.y, this.lootChest.z) !== B.CHEST) this.lootChest = null;
    if (!this.lootItem && !this.lootChest) {
      const f = this.findLoot(45);
      if (f) {
        this.lootItem = f.item ?? null;
        this.lootChest = f.chest ?? null;
      } else {
        // wander toward the nearest structure-ish area
        if (!this.goal || this.goal.distanceTo(c.body.pos) < 4) this.setGoal(this.randomNearby(40));
        return;
      }
    }
    const pos = this.lootItem ? this.lootItem.pos : new THREE.Vector3(this.lootChest!.x + 0.5, this.lootChest!.y, this.lootChest!.z + 0.5);
    const d = Math.hypot(pos.x - c.body.pos.x, pos.z - c.body.pos.z);
    if (d < 1.9 && Math.abs(pos.y - c.body.pos.y) < 2.5) {
      if (this.lootItem) {
        m.pickup(c, this.lootItem, true);
        this.lootItem = null;
      } else if (this.lootChest) {
        m.openChest(c, this.lootChest.x, this.lootChest.y, this.lootChest.z);
        this.lootChest = null;
      }
      this.goal = null;
      this.path = [];
      return;
    }
    this.setGoal(this.lootChest ? this.adjacentTo(this.lootChest) : pos);
  }

  private adjacentTo(b: { x: number; y: number; z: number }): THREE.Vector3 {
    const w = this.match.world;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const y = snapStand(w, b.x + dx, b.y, b.z + dz);
      if (y !== null && Math.abs(y - b.y) <= 1) return new THREE.Vector3(b.x + dx + 0.5, y, b.z + dz + 0.5);
    }
    return new THREE.Vector3(b.x + 0.5, b.y + 1, b.z + 0.5);
  }

  // ------------------------------------------------------------ harvest
  private findTree(): boolean {
    if (this.harvestBlock && isLog(this.match.world.get(this.harvestBlock.x, this.harvestBlock.y, this.harvestBlock.z))) return true;
    const c = this.c;
    const w = this.match.world;
    const px = Math.floor(c.body.pos.x), py = Math.floor(c.body.pos.y), pz = Math.floor(c.body.pos.z);
    for (let r = 1; r <= 9; r++)
      for (let i = 0; i < 6; i++) {
        const x = px + Math.round((Math.random() - 0.5) * r * 2);
        const z = pz + Math.round((Math.random() - 0.5) * r * 2);
        for (let y = py; y <= py + 1; y++) {
          if (isLog(w.get(x, y, z)) && !isLog(w.get(x, y - 1, z))) {
            this.harvestBlock = { x, y, z };
            return true;
          }
        }
      }
    return false;
  }

  private thinkHarvest() {
    const c = this.c;
    const b = this.harvestBlock;
    if (!b || !isLog(this.match.world.get(b.x, b.y, b.z))) {
      this.harvestBlock = null;
      if (c.slot === 5 && c.hasAnyGun()) this.match.switchSlot(c, c.lastGunSlot);
      return;
    }
    const d = Math.hypot(b.x + 0.5 - c.body.pos.x, b.z + 0.5 - c.body.pos.z);
    if (d < 2.2) {
      this.goal = null;
      this.path = [];
      if (c.slot !== 5) this.match.switchSlot(c, 5);
      this.faceAt(new THREE.Vector3(b.x + 0.5, b.y + 0.6, b.z + 0.5), 1);
      this.match.toolSwing(c);
    } else this.setGoal(this.adjacentTo(b));
  }

  // ------------------------------------------------------------ zone
  private zoneUrgent(z: NonNullable<ReturnType<NonNullable<BotHooks['zone']>>>) {
    const c = this.c;
    const dOut = Math.hypot(c.body.pos.x - z.cx, c.body.pos.z - z.cz) - z.r;
    if (dOut > -4) return true;
    const dNext = Math.hypot(c.body.pos.x - z.nx, c.body.pos.z - z.nz) - z.nr;
    if (dNext > 0) {
      // travel time needed vs time left; better bots rotate earlier
      const tNeed = dNext / 5.5;
      const slack = 10 + this.sk.rotateEarly * 35;
      return z.countdown < tNeed + slack || z.shrinking;
    }
    return false;
  }

  private thinkRotate(z: ReturnType<NonNullable<BotHooks['zone']>> | null) {
    const c = this.c;
    if (!z) return;
    const inNext = Math.hypot(c.body.pos.x - z.nx, c.body.pos.z - z.nz) < z.nr * 0.85;
    if (inNext && !(Math.hypot(c.body.pos.x - z.cx, c.body.pos.z - z.cz) > z.r - 4)) {
      // inside: hold a spot for a while (snipers find high ground)
      if (this.now > this.holdUntil) {
        this.holdUntil = this.now + 6 + this.p.patience * 14;
        const r = z.nr * 0.6 * Math.random();
        const a = Math.random() * Math.PI * 2;
        const gx = z.nx + Math.cos(a) * r;
        const gz = z.nz + Math.sin(a) * r;
        const gy = this.match.world.groundY(gx, gz) + 1;
        this.setGoal(new THREE.Vector3(gx, gy, gz));
      }
      return;
    }
    if (!this.goal || this.goal.distanceTo(c.body.pos) < 4 || Math.hypot(this.goal.x - z.nx, this.goal.z - z.nz) > z.nr) {
      const a = Math.atan2(c.body.pos.z - z.nz, c.body.pos.x - z.nx) + (Math.random() - 0.5) * 0.8;
      const r = z.nr * (0.3 + Math.random() * 0.5);
      const gx = z.nx + Math.cos(a) * r;
      const gz = z.nz + Math.sin(a) * r;
      const gy = this.match.world.groundY(gx, gz) + 1;
      this.setGoal(new THREE.Vector3(gx, gy, gz));
    }
  }

  // ------------------------------------------------------------ crafting
  private maybeCraft() {
    const c = this.c;
    const g = c.gun;
    if (g && c.ammo[g.def.ammo] < g.def.mag) {
      const r = RECIPES.find((x) => x.give.kind === 'ammo' && x.give.ammo === g.def.ammo);
      if (r && canAfford(c.mats, r)) this.match.craft(c, r.id);
    }
    if (c.heals.bandage + c.heals.medkit === 0) {
      const r = RECIPES.find((x) => x.id === 'bandage')!;
      if (canAfford(c.mats, r)) this.match.craft(c, r.id);
    }
  }

  // ------------------------------------------------------------ drop
  private steerDrop() {
    const c = this.c;
    const t = this.dropTarget;
    const it = c.intent;
    it.jump = false;
    it.crouch = false;
    it.sprint = false;
    if (!t) {
      it.forward = 0;
      it.strafe = 0;
      return;
    }
    const dx = t.x - c.body.pos.x;
    const dz = t.y - c.body.pos.z;
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    c.yaw = yaw;
    it.yaw = yaw;
    it.forward = d > 3 ? 1 : 0;
    it.strafe = 0;
    c.pitch = -0.6;
  }

  // ------------------------------------------------------------ navigation
  private randomNearby(r: number): THREE.Vector3 {
    const c = this.c;
    const w = this.match.world;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (0.4 + Math.random() * 0.6);
      const x = clamp(c.body.pos.x + Math.cos(a) * d, 10, w.sx - 10);
      const z = clamp(c.body.pos.z + Math.sin(a) * d, 10, w.sz - 10);
      const y = w.groundY(x, z) + 1;
      if (y > w.seaLevel + 1) return new THREE.Vector3(x, y, z);
    }
    return c.body.pos.clone();
  }

  setGoal(g: THREE.Vector3) {
    if (this.goal && this.goal.distanceTo(g) < 2.5 && (this.path.length || this.pathPending)) return;
    this.goal = g.clone();
    this.requestPath();
  }

  private requestPath() {
    if (!this.goal || this.pathPending) return;
    const c = this.c;
    let target = this.goal;
    const d = target.distanceTo(c.body.pos);
    // long trips: go in hops
    if (d > 45) {
      const dir = target.clone().sub(c.body.pos).setY(0).normalize();
      const hop = c.body.pos.clone().addScaledVector(dir, 38);
      hop.y = this.match.world.groundY(hop.x, hop.z, Math.floor(c.body.pos.y + 20)) + 1;
      target = hop;
    }
    this.pathPending = true;
    const zone = this.hooks.zone?.();
    const avoid = zone ? (x: number, z: number) => (Math.hypot(x - zone.cx, z - zone.cz) > zone.r ? 3 : 0) : undefined;
    this.match.nav.request(c.body.pos, target, (r) => {
      this.pathPending = false;
      this.path = r ? r.points : [];
      this.pathI = 0;
      this.repathAt = this.now + 4 + Math.random() * 2;
    }, 2200, avoid);
  }

  private updateMove(dt: number) {
    const c = this.c;
    const it = c.intent;
    it.jump = false;
    it.sprint = false;
    it.crouch = this.crouchHold > 0;
    let moveDir: THREE.Vector3 | null = null;
    // follow path
    if (this.goal) {
      if (this.pathI < this.path.length) {
        const wp = this.path[this.pathI];
        const dx = wp.x - c.body.pos.x;
        const dz = wp.z - c.body.pos.z;
        const dd = Math.hypot(dx, dz);
        if (dd < 0.7 && Math.abs(wp.y - c.body.pos.y) < 1.6) this.pathI++;
        else {
          moveDir = new THREE.Vector3(dx, 0, dz).normalize();
          if (wp.y > c.body.pos.y + 1.1) this.wantJump = true;
        }
      } else if (!this.pathPending) {
        const dx = this.goal.x - c.body.pos.x;
        const dz = this.goal.z - c.body.pos.z;
        const dd = Math.hypot(dx, dz);
        if (dd > 1.2 && this.now > this.repathAt - 3.5) this.requestPath();
        else if (dd > 1.2) moveDir = new THREE.Vector3(dx, 0, dz).normalize();
        else {
          this.goal = null;
        }
      }
      if (this.now > this.repathAt && this.goal) this.requestPath();
    }
    // combat strafing
    if (this.state === 'fight' && this.target) {
      const toT = this.target.body.pos.clone().sub(c.body.pos).setY(0).normalize();
      const side = new THREE.Vector3(-toT.z, 0, toT.x).multiplyScalar(this.strafeDir);
      const strafeAmt = this.sk.strafe * (this.cover ? 0.2 : 1);
      if (moveDir) moveDir.addScaledVector(side, strafeAmt * 0.6).normalize();
      else if (c.useTimer < 0) moveDir = side.multiplyScalar(strafeAmt);
      // peeking from cover: step out to shoot, step back while reloading
      if (this.cover && c.gun && c.gun.reloading <= 0 && c.gun.mag > 0) {
        this.peekT += dt;
        if (Math.sin(this.peekT * 2.2) > 0.2) moveDir = side.clone().multiplyScalar(0.8);
      }
    }
    if (this.now < this.distractedUntil) moveDir = null;
    // translate world move direction into intent relative to look yaw
    if (moveDir && moveDir.lengthSq() > 0.01) {
      const fwd = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
      const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
      it.forward = clamp(moveDir.dot(fwd) * 1.4, -1, 1);
      it.strafe = clamp(moveDir.dot(right) * 1.4, -1, 1);
      const far = this.goal ? this.goal.distanceTo(c.body.pos) > 8 : false;
      it.sprint = (this.state !== 'fight' || (!this.targetVisible && far)) && far && c.useTimer < 0;
    } else {
      it.forward = 0;
      it.strafe = 0;
    }
    it.yaw = c.yaw;
    // stuck handling
    const moved = c.body.pos.distanceTo(this.lastPos);
    this.lastPos.copy(c.body.pos);
    if (moveDir && moved < 0.6 * dt && c.body.onGround) {
      this.stuckT += dt;
      if (this.stuckT > 0.45) this.wantJump = true;
      if (this.stuckT > 1.6) {
        this.stuckT = 0;
        this.stuckCount++;
        this.path = [];
        if (this.stuckCount > 2) {
          this.stuckCount = 0;
          this.goal = this.randomNearby(12);
          // break out with the tool if boxed in by player builds (BR)
          if (this.match.harvestEnabled) {
            const prev = c.slot;
            if (prev !== 5) this.match.switchSlot(c, 5);
            this.match.toolSwing(c);
          }
        }
        this.requestPath();
      }
    } else this.stuckT = Math.max(0, this.stuckT - dt);
    if (c.body.inWater) {
      it.jump = true;
    }
    if (this.wantJump) {
      it.jump = true;
      this.wantJump = false;
    }
    if (this.crouchHold > 0 && moveDir) this.crouchHold = 0;
  }

  // ------------------------------------------------------------ aim & fire
  private faceAt(p: THREE.Vector3, k: number) {
    const c = this.c;
    const e = c.eye();
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    c.yaw += wrapAngle(yaw - c.yaw) * k;
    c.pitch += (pitch - c.pitch) * k;
  }

  private aimPoint(t: Combatant): THREE.Vector3 {
    const g = this.c.gun;
    const base = t.body.pos.clone().add(new THREE.Vector3(0, this.headPref ? 1.56 - t.crouchBlend * 0.3 : 1.05 - t.crouchBlend * 0.2, 0));
    if (g?.def.projectile) {
      const d = base.distanceTo(this.c.eye());
      const tt = d / g.def.projectile.speed;
      base.addScaledVector(t.body.vel, tt * this.sk.leadTarget);
      base.y += 0.5 * g.def.projectile.gravity * tt * tt * (0.5 + this.sk.leadTarget * 0.5);
    }
    return base;
  }

  private updateAim(dt: number) {
    const c = this.c;
    let target: THREE.Vector3 | null = null;
    if (this.state === 'fight' && this.target && this.targetVisible) target = this.aimPoint(this.target);
    else if (this.target && this.now - this.lastSeenTime < 3) target = this.lastSeenPos.clone().add(new THREE.Vector3(0, 1.3, 0));
    else if (this.threat && this.now - this.threatTime < 3) target = this.threat.clone().add(new THREE.Vector3(0, 1.3, 0));
    if (this.state === 'harvest') return;
    if (!target) {
      // look where we're going, with idle glances
      let lookDir: THREE.Vector3 | null = null;
      if (this.pathI < this.path.length) lookDir = this.path[this.pathI].clone().sub(c.body.pos).setY(0);
      else if (this.goal) lookDir = this.goal.clone().sub(c.body.pos).setY(0);
      if (lookDir && lookDir.lengthSq() > 0.1) {
        const yaw = Math.atan2(-lookDir.x, -lookDir.z) + Math.sin(this.now * 0.7 + this.c.id) * 0.25;
        c.yaw += wrapAngle(yaw - c.yaw) * Math.min(1, dt * 4);
      } else c.yaw += Math.sin(this.now * 0.4 + this.c.id) * dt * 0.6;
      c.pitch += (Math.sin(this.now * 0.5 + this.c.id * 3) * 0.12 - c.pitch) * Math.min(1, dt * 2);
      return;
    }
    // error decays while tracking
    this.aimErr.multiplyScalar(Math.exp(-this.sk.errorDecay * dt));
    const e = c.eye();
    const dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;
    let yaw = Math.atan2(-dx, -dz) + this.aimErr.x;
    let pitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.aimErr.y;
    // recoil compensation is imperfect
    pitch -= c.recoilPitch * (0.25 + this.skill * 0.55);
    yaw -= c.recoilYaw * (0.2 + this.skill * 0.5);
    if (this.now < this.distractedUntil) yaw += 0.4;
    const maxTurn = this.sk.turnSpeed * dt;
    const dyaw = wrapAngle(yaw - c.yaw);
    c.yaw += clamp(dyaw, -maxTurn, maxTurn);
    c.pitch += clamp(pitch - c.pitch, -maxTurn * 0.7, maxTurn * 0.7);
    c.pitch = clamp(c.pitch, -1.4, 1.4);
    this.lookYaw = yaw;
    this.lookPitch = pitch;
  }

  private updateFire(dt: number) {
    const c = this.c;
    const m = this.match;
    const g = c.gun;
    let held = false;
    if (this.state === 'fight' && this.target && this.targetVisible && g && this.now >= this.spottedAt) {
      const t = this.target;
      const d = t.body.pos.distanceTo(c.body.pos);
      c.wantAds = d > 9 || g.def.category === 'sniper' || g.def.category === 'dmr';
      // angular tolerance ~ target size
      const ap = this.aimPoint(t);
      const e = c.eye();
      const want = Math.atan2(-(ap.x - e.x), -(ap.z - e.z));
      const err = Math.abs(wrapAngle(want - c.yaw));
      const tol = Math.atan2(0.45, d) * (1.3 + (1 - this.skill) * 1.8);
      const scoped = g.def.scope ? c.ads > 0.85 : true;
      const inRange = d < g.def.range * 0.9;
      if (err < tol && scoped && inRange && c.useTimer < 0) {
        if (g.def.action === 'auto') {
          if (this.burstPause > 0) this.burstPause -= dt;
          else {
            held = true;
            if (d > 22 && this.burstLeft <= 0) this.burstLeft = 3 + Math.floor(Math.random() * 5 * (1 - this.sk.burstDiscipline * 0.5));
          }
        } else if (this.now >= this.nextClick) {
          held = true;
          const cadence = g.def.action === 'semi' ? 0.16 + (1 - this.skill) * 0.25 + (g.def.category === 'dmr' ? 0.25 : 0) : 0.1;
          this.nextClick = this.now + cadence + Math.random() * 0.12;
        }
      }
    } else {
      c.wantAds = false;
    }
    if (c.slot > 2) held = false;
    const fired = m.tryFire(c, held);
    if (fired && g?.def.action === 'auto' && this.burstLeft > 0) {
      this.burstLeft--;
      if (this.burstLeft === 0) this.burstPause = 0.18 + Math.random() * 0.3 * (1.5 - this.sk.burstDiscipline);
    }
    if (fired && this.skill < 0.5 && Math.random() < 0.05) {
      // flinch / overcorrect
      this.aimErr.x += (Math.random() - 0.5) * 3 * DEG;
    }
    void IS_SOLID;
    void standable;
  }
}
