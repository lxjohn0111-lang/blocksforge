import * as THREE from 'three';
import { Match, type MatchConfig, type KillEvent, type MatchResult } from './match';
import type { Engine } from '../render/engine';
import type { MapData, SpawnPoint } from '../world/maps/builder';
import { BotBrain } from './ai/bot';
import { WEAPONS, type WeaponId, type ThrowKind } from './weapons';
import type { Combatant } from './combatant';
import { audio } from '../audio/audio';

export interface Loadout {
  id: string;
  name: string;
  primary: WeaponId;
  secondary: WeaponId;
  throws: Partial<Record<ThrowKind, number>>;
  blurb: string;
}

export const LOADOUTS: Loadout[] = [
  { id: 'assault', name: 'Assault', primary: 'ranger', secondary: 'p9', throws: { frag: 1 }, blurb: 'Balanced rifle kit for any lane.' },
  { id: 'cqb', name: 'Close Quarters', primary: 'hornet', secondary: 'breacher', throws: { smoke: 1 }, blurb: 'SMG + shotgun for tight streets.' },
  { id: 'marksman', name: 'Marksman', primary: 'longshot', secondary: 'p9', throws: { smoke: 1 }, blurb: 'Bolt-action sniper. Hold long angles.' },
  { id: 'heavy', name: 'Heavy', primary: 'volk', secondary: 'breacher', throws: { frag: 1 }, blurb: 'Hard-hitting rifle with a shotgun backup.' },
  { id: 'recon', name: 'Recon', primary: 'arbiter', secondary: 'hornet', throws: { frag: 1 }, blurb: 'Semi-auto DMR for mid-long range.' },
  { id: 'demo', name: 'Demolition', primary: 'thumper', secondary: 'hornet', throws: { frag: 2 }, blurb: 'Rockets for flushing out holdouts.' },
];

export class TDMMatch extends Match {
  scores: [number, number] = [0, 0];
  scoreLimit = 40;
  timeLimit = 420;
  respawnDelay = 4;
  brains: BotBrain[] = [];
  playerLoadout = 'assault';
  private botLoadout = new Map<number, string>();
  private zoneWarn = 0;
  private laneOf = new Map<number, number>();
  private wpIndex = new Map<number, number>();
  countdown = 3;

  constructor(engine: Engine, map: MapData, cfg: MatchConfig, loadout = 'assault') {
    super(engine, map, cfg);
    this.regenEnabled = true;
    this.dropOnDeath = false;
    this.playerLoadout = loadout;
    this.setup();
  }

  private setup() {
    const cfg = this.cfg;
    const half = Math.floor((cfg.bots.length + 1) / 2);
    const p = this.addCombatant(cfg.player, 0, true, new THREE.Vector3());
    this.respawn(p, true);
    cfg.bots.forEach((b, i) => {
      const team = i < half - 1 ? 0 : 1;
      const c = this.addCombatant(b.ident, team, false, new THREE.Vector3());
      const arche = b.ident.personality?.archetype;
      const lo = arche === 'sniper' ? 'marksman' : arche === 'aggressor' ? 'cqb' : arche === 'flanker' ? (Math.random() < 0.5 ? 'cqb' : 'assault') : arche === 'tactician' ? 'recon' : arche === 'builder' ? 'demo' : arche === 'support' ? 'heavy' : 'assault';
      this.botLoadout.set(c.id, lo);
      const lanes = this.map.tdm?.lanes.length ?? 3;
      this.laneOf.set(c.id, arche === 'flanker' ? (Math.random() < 0.5 ? 0 : lanes - 1) : Math.floor(Math.random() * lanes));
      this.respawn(c, true);
      const brain = new BotBrain(c, this, b.skill, { pushGoal: (bb) => this.pushGoal(bb), perches: this.map.tdm?.perches.map((q) => new THREE.Vector3(q.x, q.y, q.z)) });
      this.brains.push(brain);
      this.registerBrain(brain);
    });
  }

  get playerTeam() {
    return this.player.team;
  }

  giveLoadout(c: Combatant, id: string) {
    const lo = LOADOUTS.find((l) => l.id === id) ?? LOADOUTS[0];
    c.weapons = [null, null, null];
    c.giveWeapon(lo.primary);
    c.giveWeapon(lo.secondary);
    for (const k of Object.keys(c.ammo)) (c.ammo as any)[k] = 0;
    for (const w of [lo.primary, lo.secondary]) {
      const d = WEAPONS[w];
      c.ammo[d.ammo] += d.ammo === 'rockets' ? 2 : d.mag * 3;
    }
    c.throws = { frag: lo.throws.frag ?? 0, smoke: lo.throws.smoke ?? 0 };
    c.heals = { bandage: 0, medkit: 0, plate: 0 };
    c.slot = 0;
    c.lastGunSlot = 0;
  }

  private pickSpawn(team: number): SpawnPoint {
    const spawns = this.map.spawns.filter((s) => s.team === team);
    const enemies = this.combatants.filter((c) => c.alive && c.team !== team);
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let minD = 999;
      let seen = false;
      const head = new THREE.Vector3(s.x, s.y + 1.6, s.z);
      for (const e of enemies) {
        const d = e.body.pos.distanceTo(head);
        minD = Math.min(minD, d);
        if (d < 60 && this.world.lineOfSight(head.x, head.y, head.z, e.body.pos.x, e.body.pos.y + 1.5, e.body.pos.z)) seen = true;
      }
      const friends = this.combatants.filter((c) => c.alive && c.team === team && c.body.pos.distanceTo(head) < 2).length;
      const score = Math.min(minD, 60) - (seen ? 50 : 0) - friends * 10 + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  respawn(c: Combatant, initial = false) {
    const s = this.pickSpawn(c.team);
    c.resetForSpawn();
    c.body.pos.set(s.x + (Math.random() - 0.5) * 0.6, s.y + 0.01, s.z + (Math.random() - 0.5) * 0.6);
    c.body.fallPeakY = c.body.pos.y;
    c.yaw = s.yaw;
    c.pitch = 0;
    this.giveLoadout(c, c.isPlayer ? this.playerLoadout : this.botLoadout.get(c.id) ?? 'assault');
    c.spawnShield = initial ? 3 : 2.5;
    c.swapTimer = 0.3;
    this.wpIndex.set(c.id, 0);
    if (!initial) this.events.emit('respawn', { c });
  }

  private pushGoal(b: BotBrain): THREE.Vector3 | null {
    const c = b.c;
    const tdm = this.map.tdm;
    if (!tdm) return null;
    // snipers head for perches
    if (b.p.archetype === 'sniper' && tdm.perches.length) {
      const q = tdm.perches[c.id % tdm.perches.length];
      const v = new THREE.Vector3(q.x, q.y, q.z);
      if (v.distanceTo(c.body.pos) > 2.5) return v;
      return null;
    }
    // follow an engaged teammate (teamwork)
    if (Math.random() < b.p.teamwork * 0.4) {
      const mate = this.brains.find((o) => o !== b && o.c.alive && o.c.team === c.team && o.state === 'fight' && o.c.body.pos.distanceTo(c.body.pos) < 40);
      if (mate) return mate.c.body.pos.clone();
    }
    const lane = tdm.lanes[this.laneOf.get(c.id) ?? 0];
    const pts = c.team === 0 ? lane : [...lane].reverse();
    let i = this.wpIndex.get(c.id) ?? 0;
    const wp = pts[Math.min(i, pts.length - 1)];
    const target = new THREE.Vector3(wp.x + 0.5, 0, wp.z + 0.5);
    target.y = this.world.groundY(target.x, target.z, this.world.sy - 1) + 1;
    if (Math.hypot(target.x - c.body.pos.x, target.z - c.body.pos.z) < 4) {
      i++;
      if (i >= pts.length - 1) {
        // patrol back toward the middle, maybe switch lanes
        i = Math.floor(pts.length / 2) - 1 + Math.floor(Math.random() * 2);
        if (Math.random() < 0.35) this.laneOf.set(c.id, Math.floor(Math.random() * tdm.lanes.length));
      }
      this.wpIndex.set(c.id, i);
    }
    return target;
  }

  update(dt: number) {
    super.update(dt);
    if (this.ended) return;
    // respawns
    for (const c of this.combatants) {
      if (!c.alive && this.time >= c.respawnAt && c.respawnAt > 0) {
        c.respawnAt = 0;
        this.respawn(c);
      }
    }
    // spawn zone protection: enemies inside the other team's spawn take damage
    this.zoneWarn -= dt;
    const zones = this.map.tdm?.spawnZones ?? [];
    for (const c of this.combatants) {
      if (!c.alive) continue;
      for (const z of zones) {
        if (z.team === c.team) continue;
        const p = c.body.pos;
        if (p.x >= z.x0 && p.x <= z.x1 && p.z >= z.z0 && p.z <= z.z1) {
          this.damage(c, 30 * dt, { attacker: null, kind: 'zone', weapon: 'Restricted Area' });
          if (c.isPlayer && this.zoneWarn <= 0) {
            this.zoneWarn = 1.5;
            this.events.emit('toast', { text: 'Restricted: enemy spawn zone', kind: 'bad' });
          }
        }
      }
    }
    const left = this.timeLimit - this.time;
    const m = Math.max(0, Math.floor(left / 60));
    const s = Math.max(0, Math.floor(left % 60));
    this.statusText = `${m}:${s.toString().padStart(2, '0')}`;
    if (left <= 0) this.end();
  }

  onKill(e: KillEvent) {
    e.victim.respawnAt = this.time + this.respawnDelay;
    if (e.killer && e.killer.team !== e.victim.team) {
      this.scores[e.killer.team as 0 | 1]++;
      e.killer.stats.score += 100;
    }
    for (const a of e.assists) a.stats.score += 50;
    // ammo pack
    const g = e.victim.weapons[0];
    if (g) this.spawnItem({ kind: 'ammo', ammo: g.def.ammo, count: g.def.ammo === 'rockets' ? 1 : g.def.mag }, e.victim.body.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), new THREE.Vector3(0, 3, 0));
    if (this.scores[0] >= this.scoreLimit || this.scores[1] >= this.scoreLimit) this.end();
    else if (Math.max(...this.scores) === this.scoreLimit - 5 && e.killer) {
      const t = e.killer.team;
      this.events.emit('announce', { title: '5 kills to win', sub: t === this.playerTeam ? 'Your team is close!' : 'Enemy team is close!', kind: 'info' });
    }
  }

  private end() {
    if (this.ended) return;
    const pt = this.playerTeam;
    const ot = 1 - pt;
    const won = this.scores[pt] > this.scores[ot];
    const draw = this.scores[pt] === this.scores[ot];
    this.events.emit('announce', { title: draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT', sub: `${this.scores[pt]} – ${this.scores[ot]}`, kind: won ? 'win' : draw ? 'info' : 'lose' });
    audio.ui(won ? 'victory' : 'defeat', 0.9);
    setTimeout(() => this.finish(this.makeResult()), 1500);
    this.ended = true;
    this.phase = 'ended';
  }

  makeResult(): MatchResult {
    const pt = this.playerTeam;
    const ot = 1 - pt;
    const won = this.scores[pt] > this.scores[ot];
    const draw = this.scores[pt] === this.scores[ot];
    const roster = this.buildRoster();
    const mvp = [...this.combatants].sort((a, b) => b.stats.score + b.stats.kills * 10 - (a.stats.score + a.stats.kills * 10))[0];
    const p = this.player;
    // rank in own team
    const team = this.combatants.filter((c) => c.team === pt).sort((a, b) => b.stats.score - a.stats.score);
    return {
      mode: 'tdm', ranked: this.cfg.ranked, mapName: this.map.name, won, draw, placement: team.indexOf(p) + 1, participants: team.length,
      teamScores: [this.scores[pt], this.scores[ot]], playerTeam: pt, stats: { ...p.stats }, duration: this.time, roster, mvp: mvp?.name ?? '',
      survived: this.time, eventTag: this.cfg.eventTag,
    };
  }

  forfeitResult(): MatchResult {
    const r = this.makeResult();
    r.won = false;
    r.draw = false;
    return r;
  }

  finish(result: MatchResult) {
    this.ended = false;
    super.finish(result);
  }
}
