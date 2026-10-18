import * as THREE from 'three';
import { Match, type MatchConfig, type KillEvent, type MatchResult } from './match';
import type { Engine } from '../render/engine';
import type { MapData } from '../world/maps/builder';
import { Zone } from './zone';
import { BotBrain } from './ai/bot';
import { buildVoxelGeometry, createEntityMaterial, type VBox } from '../render/voxelModel';
import { audio } from '../audio/audio';
import { clamp } from '../core/mathx';
import type { Combatant } from './combatant';
import { BLOCKS } from '../world/blocks';

/** the airship flies well above the world (blocks end at y 80) so the drop has a real freefall */
const SHIP_Y = 135;

function airshipBoxes(): VBox[] {
  const o: VBox[] = [];
  const env = 0xd9dde2;
  const stripe = 0xe0802a;
  // envelope: stacked elliptical slices along z
  for (let z = -16; z <= 16; z++) {
    const t = z / 16.5;
    const r = Math.sqrt(Math.max(0, 1 - t * t)) * 5.2;
    if (r < 0.6) continue;
    const c = Math.abs(z) % 6 === 0 ? stripe : env;
    o.push({ min: [-r, 6 - r * 0.85, z], max: [r, 6 + r * 0.85, z + 1], color: c, mat: 'cloth' });
  }
  // fins
  o.push({ min: [-0.2, 6, 13], max: [0.2, 12, 18], color: stripe, mat: 'cloth' });
  o.push({ min: [-6, 5.8, 13], max: [6, 6.2, 18], color: stripe, mat: 'cloth' });
  // gondola
  o.push({ min: [-2.2, -1, -6], max: [2.2, 1.6, 6], color: 0x6b4426, mat: 'wood' });
  o.push({ min: [-2.3, 1.6, -6.2], max: [2.3, 2.0, 6.2], color: 0x3a2414, mat: 'wood' });
  o.push({ min: [-2.25, 0.2, -5], max: [2.25, 1.2, 5], color: 0x9fd0e8, mat: 'glass' });
  o.push({ min: [-0.15, 2, -4], max: [0.15, 2.4, 4], color: 0x2a2a2a, mat: 'metal' });
  for (const z of [-5, 5]) {
    o.push({ min: [-1.6, 1.8, z - 0.2], max: [-1.4, 3.5, z + 0.2], color: 0x2a2a2a, mat: 'metal' });
    o.push({ min: [1.4, 1.8, z - 0.2], max: [1.6, 3.5, z + 0.2], color: 0x2a2a2a, mat: 'metal' });
  }
  // engine pods
  for (const x of [-4.2, 4.2]) {
    o.push({ min: [x - 0.7, 2, 4], max: [x + 0.7, 3.4, 8], color: 0x3a3f46, mat: 'metal' });
    o.push({ min: [x - 0.1, 0.6, 8], max: [x + 0.1, 4.8, 8.2], color: 0x1a1a1a, mat: 'metal' });
  }
  // nav lights
  o.push({ min: [-5.3, 6, -1], max: [-5.1, 6.4, -0.6], color: 0xff3030, mat: 'emissive' });
  o.push({ min: [5.1, 6, -1], max: [5.3, 6.4, -0.6], color: 0x30ff60, mat: 'emissive' });
  return o;
}

const START_WOOD = 30;

export class BRMatch extends Match {
  zone: Zone;
  brains: BotBrain[] = [];
  ship: { group: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number; duration: number; dir: THREE.Vector3 };
  inShip = new Set<Combatant>();
  zoneTick = 0;
  erosionTick = 0;
  playerPlacement = 0;
  winner: Combatant | null = null;
  playerDeadResult: MatchResult | null = null;
  participants = 0;
  private dropCounts: number[] = [];
  onPlayerJump: (() => void) | null = null;

  constructor(engine: Engine, map: MapData, cfg: MatchConfig) {
    super(engine, map, cfg);
    this.buildingEnabled = true;
    this.craftingEnabled = true;
    this.harvestEnabled = true;
    this.phase = 'drop';
    const center = new THREE.Vector2(map.world.sx / 2, map.world.sz / 2 + 2);
    this.zone = new Zone(map.world, center, Math.hypot(map.world.sx, map.world.sz) * 0.55, cfg.seed);
    this.root.add(this.zone.mesh);
    // ship path across the island
    const a = this.rng.next() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const c3 = new THREE.Vector3(center.x, SHIP_Y, center.y).addScaledVector(perp, (this.rng.next() - 0.5) * 70);
    const half = 200;
    const from = c3.clone().addScaledVector(dir, -half);
    const to = c3.clone().addScaledVector(dir, half);
    const group = new THREE.Group();
    const mat = createEntityMaterial();
    mat.uniforms.uLocalLight.value.set(1, 0.1);
    const mesh = new THREE.Mesh(buildVoxelGeometry(airshipBoxes(), 1), mat);
    group.add(mesh);
    group.position.copy(from);
    group.lookAt(to);
    group.rotateY(Math.PI);
    this.root.add(group);
    this.ship = { group, from, to, t: 0, duration: 42, dir };
    this.setup();
  }

  private setup() {
    const cfg = this.cfg;
    const p = this.addCombatant(cfg.player, 0, true, this.ship.from.clone());
    p.slot = 5;
    // everyone lands with enough wood for a few pieces, so building is an option from the first fight
    p.mats.wood = START_WOOD;
    this.inShip.add(p);
    cfg.bots.forEach((b, i) => {
      const c = this.addCombatant(b.ident, i + 1, false, this.ship.from.clone());
      c.slot = 5;
      c.mats.wood = START_WOOD;
      this.inShip.add(c);
      const brain = new BotBrain(c, this, b.skill, {
        zone: () => ({
          cx: this.zone.center.x, cz: this.zone.center.y, r: this.zone.radius,
          nx: this.zone.to.x, nz: this.zone.to.y, nr: this.zone.toR, shrinking: this.zone.shrinking, countdown: this.zone.countdown,
        }),
      });
      this.planDrop(brain);
      this.brains.push(brain);
      this.registerBrain(brain);
    });
    this.participants = this.combatants.length;
    this.populateLoot();
    this.zone.start();
  }

  private planDrop(b: BotBrain) {
    const targets = this.map.dropTargets;
    const s = this.ship;
    const len = s.from.distanceTo(s.to);
    const weights = targets.map((t, i) => {
      const rel = new THREE.Vector3(t.x - s.from.x, 0, t.z - s.from.z);
      const along = rel.dot(s.dir);
      const off = Math.abs(rel.x * -s.dir.z + rel.z * s.dir.x);
      // a glider opened early carries a competitor roughly 100 blocks sideways
      const reach = Math.exp(-Math.max(0, off - 90) / 25);
      // aggressive players chase hot drops, looters avoid them
      const pull = b.p.aggression > 0.6 ? t.weight : b.p.archetype === 'looter' ? 1 / Math.sqrt(t.weight) : Math.sqrt(t.weight);
      // spread the lobby out: every competitor already heading somewhere makes it less attractive
      const crowd = this.dropCounts[i] ?? 0;
      const crowdPen = 1 / (1 + crowd * crowd * 1.6);
      return (along > 0 && along < len ? reach : 0.02) * pull * crowdPen;
    });
    const t = this.rng.weighted(targets, weights);
    const ti = targets.indexOf(t);
    const already = this.dropCounts[ti] ?? 0;
    this.dropCounts[ti] = already + 1;
    // later arrivals at a popular spot land on its outskirts
    const spread = 24 + this.rng.next() * 20 + already * 14;
    const ja = this.rng.next() * Math.PI * 2;
    const jx = t.x + Math.cos(ja) * spread * this.rng.next();
    const jz = t.z + Math.sin(ja) * spread * this.rng.next();
    b.dropTarget = new THREE.Vector2(jx, jz);
    const rel = new THREE.Vector3(jx - s.from.x, 0, jz - s.from.z);
    const along = rel.dot(s.dir);
    b.jumpProgress = clamp((along - 25 - this.rng.next() * 15) / len, 0.14, 0.9);
  }

  get aliveCount() {
    return this.combatants.filter((c) => c.alive).length;
  }

  jumpFromShip(c: Combatant) {
    if (!this.inShip.has(c)) return;
    if (this.ship.t < 0.1 && this.ship.t < 0.95) {
      if (c.isPlayer) this.events.emit('toast', { text: 'Wait until we are over the island', kind: 'warn' });
      return;
    }
    this.inShip.delete(c);
    const p = this.shipPos();
    c.body.pos.set(p.x + (Math.random() - 0.5) * 2, p.y - 2.5, p.z + (Math.random() - 0.5) * 2);
    c.body.vel.copy(this.ship.dir).multiplyScalar(6);
    c.body.fallPeakY = c.body.pos.y;
    c.dropping = true;
    if (c.isPlayer) {
      audio.play('b_swing', { vol: 0.8, rate: 0.5 });
      this.onPlayerJump?.();
    }
  }

  shipPos() {
    return this.ship.from.clone().lerp(this.ship.to, this.ship.t);
  }

  update(dt: number) {
    // airship
    if (this.ship.t < 1) {
      this.ship.t = Math.min(1, this.ship.t + dt / this.ship.duration);
      const sp = this.shipPos();
      this.ship.group.position.copy(sp).add(new THREE.Vector3(0, 4, 0));
      for (const c of this.inShip) {
        c.body.pos.copy(sp);
        c.body.vel.set(0, 0, 0);
        if (!c.isPlayer) {
          const b = this.brains.find((x) => x.c === c);
          if (b && this.ship.t >= b.jumpProgress) this.jumpFromShip(c);
        }
      }
      if (this.ship.t >= 0.96) for (const c of [...this.inShip]) this.jumpFromShip(c);
      if (this.ship.t >= 1) this.ship.group.visible = false;
    }
    if (this.phase === 'drop' && this.inShip.size === 0 && this.combatants.every((c) => !c.dropping && !c.gliding)) this.phase = 'live';

    // combatants in the ship don't simulate physics
    const shipBound = [...this.inShip];
    for (const c of shipBound) c.alive && (c.intent.forward = 0);
    const saved = shipBound.map((c) => c.body.pos.clone());
    super.update(dt);
    shipBound.forEach((c, i) => {
      if (this.inShip.has(c)) {
        c.body.pos.copy(saved[i]);
        c.body.vel.set(0, 0, 0);
        if (c.model) c.model.root.visible = false;
      }
    });

    // zone: with few competitors left, holding phases pass faster so the endgame arrives sooner
    const left = this.aliveCount;
    this.zone.pace = left <= 3 ? 2.2 : left <= 6 ? 1.7 : left <= 10 ? 1.3 : 1;
    const ev = this.zone.update(dt);
    if (ev === 'shrink_start') {
      this.events.emit('announce', { title: 'Storm closing', sub: 'Move into the safe zone', kind: 'zone' });
      audio.ui('zone', 0.8);
    } else if (ev === 'phase_end' && this.zone.phase < 6) {
      this.events.emit('toast', { text: 'Storm stabilised — next circle marked', kind: 'info' });
    }
    this.zoneTick += dt;
    if (this.zoneTick >= 1) {
      this.zoneTick -= 1;
      for (const c of this.combatants) {
        if (!c.alive || this.inShip.has(c)) continue;
        if (this.zone.outside(c.body.pos.x, c.body.pos.z)) this.damage(c, this.zone.dps, { attacker: null, kind: 'zone', weapon: 'Storm' });
      }
    }
    // storm erodes player structures outside the circle
    this.erosionTick += dt;
    if (this.erosionTick > 2.5) {
      this.erosionTick = 0;
      const w = this.world;
      let n = 0;
      for (const [i] of [...w.builtHP]) {
        const y = i % w.sy;
        const col = (i - y) / w.sy;
        const x = col % w.sx;
        const z = (col - x) / w.sx;
        if (this.zone.outside(x, z) && n++ < 40) this.build.damageBlock(x, y, z, 25, null);
      }
    }
    // status text
    const zc = Math.ceil(this.zone.countdown);
    this.statusText = this.zone.phase >= 6 ? 'Final storm' : this.zone.shrinking ? `Storm closing ${zc}s` : `Storm shrinks in ${zc}s`;
  }

  onKill(e: KillEvent) {
    const alive = this.aliveCount;
    e.victim.placement = alive + 1;
    if (e.victim.isPlayer) {
      this.playerPlacement = alive + 1;
      this.playerDeadResult = this.makeResult(false);
      this.events.emit('announce', { title: `#${alive + 1}`, sub: e.killer ? `Eliminated by ${e.killer.name}` : 'Eliminated', kind: 'dead' });
    }
    if (alive <= 1) {
      const w = this.combatants.find((c) => c.alive) ?? null;
      this.winner = w;
      if (w) w.placement = 1;
      const playerWon = !!w?.isPlayer;
      setTimeout(() => {
        if (this.ended) return;
        this.finish(playerWon ? this.makeResult(true) : this.playerDeadResult ?? this.makeResult(false));
      }, 1800);
      if (playerWon) this.events.emit('announce', { title: 'VICTORY', sub: 'Last block standing', kind: 'win' });
      else if (w) this.events.emit('announce', { title: `${w.name} wins`, sub: 'Match complete', kind: 'info' });
    }
  }

  makeResult(won: boolean): MatchResult {
    const p = this.player;
    const placement = won ? 1 : p.alive ? this.aliveCount : this.playerPlacement || this.aliveCount;
    const placements = new Map<number, number>();
    for (const c of this.combatants) placements.set(c.id, c.alive ? (won && c.isPlayer ? 1 : 0) : c.placement);
    const roster = this.buildRoster(placements);
    const mvp = [...this.combatants].sort((a, b) => b.stats.kills - a.stats.kills || b.stats.damage - a.stats.damage)[0];
    return {
      mode: 'br', ranked: this.cfg.ranked, mapName: this.map.name, won, draw: false, placement, participants: this.participants,
      teamScores: null, playerTeam: 0, stats: { ...p.stats }, duration: this.time, roster, mvp: mvp?.name ?? '',
      survived: p.alive ? this.time : p.deathTime, eventTag: this.cfg.eventTag,
    };
  }

  /** leaving early counts as an elimination at the current standing */
  forfeitResult(): MatchResult {
    if (this.playerDeadResult) return this.playerDeadResult;
    if (this.result) return this.result;
    this.playerPlacement = this.aliveCount;
    return this.makeResult(false);
  }

  dispose() {
    super.dispose();
    void BLOCKS;
  }
}
