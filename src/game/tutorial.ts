import * as THREE from 'three';
import { Match, type MatchConfig, type MatchResult, type KillEvent } from './match';
import type { Engine } from '../render/engine';
import type { MapData } from '../world/maps/builder';
import type { Combatant, Identity } from './combatant';
import { randomLook } from '../render/characters';
import { BotBrain } from './ai/bot';
import { makePersonality } from './ai/personality';
import { keyLabel, type Settings } from '../core/settings';
import { audio } from '../audio/audio';

export interface TutorialStep {
  id: string;
  title: string;
  hint: string;
  progress?: () => string;
  /** the controls to show on the quick tutorial's card */
  keys?: string[];
}

function dummyIdent(name: string, seed: number): Identity {
  const look = randomLook(seed);
  look.shirt = 0xc2a04a;
  look.pants = 0x8a6a2a;
  look.jacket = null;
  look.headgear = 'helmet';
  look.hat = 0x6a5a3a;
  look.vest = 0x5a4a2a;
  look.backpack = null;
  look.camo = null;
  look.skin = 0xd8b070;
  look.hair = 0x8a6a2a;
  return { id: 'dummy_' + seed, name, look, isBot: true, level: 1, rp: 0, title: 'Training', banner: 'stone', camo: 'factory', skill: 0.1, personality: makePersonality(seed) };
}

export class TutorialMatch extends Match {
  steps: TutorialStep[] = [];
  /** the first step not yet completed (what the panel suggests next) */
  index = 0;
  /** steps can be completed in any order; each one latches once done */
  done: boolean[] = [];
  private entered = new Set<string>();
  private dummies: { c: Combatant; home: THREE.Vector3; moving: boolean; key: string }[] = [];
  private duelBot: BotBrain | null = null;
  private looked = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private flags = new Set<string>();
  private stepTime = 0;
  completedAt = -1;
  /** "Basics": the first-run tutorial, five steps one at a time; otherwise the full Training course */
  readonly quick: boolean;

  constructor(engine: Engine, map: MapData, cfg: MatchConfig, private settings: Settings, touch = false, quick = false) {
    super(engine, map, cfg);
    this.quick = quick;
    this.buildingEnabled = true;
    this.craftingEnabled = true;
    this.harvestEnabled = true;
    this.regenEnabled = true;
    this.dropOnDeath = false;
    const st = map.stations!;
    const p = this.addCombatant(cfg.player, 0, true, new THREE.Vector3(st.spawn.x, st.spawn.y, st.spawn.z));
    p.yaw = 0;
    p.slot = 0;
    this.lastYaw = p.yaw;
    // weapon on the table
    this.spawnItem({ kind: 'weapon', weapon: 'ranger' }, new THREE.Vector3(st.weapon.x, st.weapon.y, st.weapon.z));
    this.spawnItem({ kind: 'ammo', ammo: 'medium', count: 90 }, new THREE.Vector3(st.weapon.x + 1.5, st.weapon.y, st.weapon.z));
    for (const [key, moving] of [['dummy1', false], ['dummy2', true], ['dummy3', false], ['far1', false], ['far2', false], ['nadeDummy', false]] as const) {
      const s = st[key];
      const c = this.addCombatant(dummyIdent(key.startsWith('far') ? 'Long Range Dummy' : 'Target Dummy', key.length * 97 + s.z), 1, false, new THREE.Vector3(s.x, s.y, s.z));
      c.yaw = Math.PI;
      this.dummies.push({ c, home: new THREE.Vector3(s.x, s.y, s.z), moving, key });
    }
    const k = (a: keyof Settings['bindings']) => keyLabel(settings.bindings[a]);
    // hints follow the controls the player actually has
    const t = (keys: string, tap: string) => (touch ? tap : keys);
    this.steps = [
      { id: 'look', title: 'Look around', hint: t('Move the mouse to look.', 'Drag on the right side of the screen to look.') },
      { id: 'move', title: 'Walk to the marker', hint: t(`${k('forward')}${k('left')}${k('back')}${k('right')} to move · ${k('sprint')} to sprint`, 'Use the stick on the left to move. Push it to the edge to sprint.') },
      { id: 'jump', title: 'Jump the wall', hint: t(`${k('jump')} to jump. One-block steps are climbed automatically.`, 'Tap the jump button. One-block steps are climbed automatically.') },
      { id: 'loot', title: 'Grab the rifle', hint: t(`Look at the Ranger AR and press ${k('interact')}`, 'Walk up to the Ranger AR and tap the pick-up button.') },
      { id: 'shoot', title: 'Down a target dummy', hint: t(`${k('fire')} to fire. Short bursts stay accurate.`, 'Hold the fire button. Short bursts stay accurate.') },
      { id: 'reload', title: 'Reload', hint: t(`Press ${k('reload')} to reload.`, 'Tap the reload button.') },
      { id: 'ads', title: 'Aim down sights', hint: t(`Hold ${k('aim')} and hit the dummy on the wall.`, 'Tap the aim button, then hit the dummy on the wall.') },
      { id: 'chest', title: 'Open the supply chest', hint: t(`Chests by the firing line hold better loot. ${k('interact')} to open.`, 'Chests by the firing line hold better loot. Tap the open button next to one.') },
      { id: 'scope', title: 'Scope in', hint: t(`Equip the Longshot, hold ${k('aim')}, scroll to change zoom, hit a far dummy.`, 'Equip the Longshot, tap aim to scope in and hit a far dummy.') },
      { id: 'harvest', title: 'Harvest materials', hint: t(`Harvest tool ${k('tool')}. Hit trees and boulders for 30 wood.`, 'Tap the pick in the hotbar, then hold fire on trees and boulders for 30 wood.'), progress: () => `${Math.min(30, this.player.mats.wood)}/30` },
      { id: 'build', title: 'Build up to the ledge', hint: t(`Press ${k('build')} to build, choose Ramp and ${k('fire')} to place it. Climb onto the ledge.`, 'Tap the build button, choose Ramp and tap fire to place it. Climb onto the ledge.') },
      { id: 'craft', title: 'Craft bandages', hint: t(`Open ${k('inventory')} and craft Bandages from cloth.`, 'Open the bag and tap Bandages to craft them from cloth.') },
      { id: 'grenade', title: 'Flush out cover', hint: t(`Hold ${k('grenade')} to aim the arc, release to throw over the wall.`, 'Hold the grenade button to aim the arc, release to throw it over the wall.') },
      { id: 'duel', title: 'Final test', hint: t(`Defeat the sparring bot in the arena. Use cover, heal with ${k('heal')}.`, 'Defeat the sparring bot in the arena. Use cover and heal between fights.') },
      { id: 'done', title: 'Training complete', hint: 'You are ready to drop in.' },
    ];
    if (quick)
      this.steps = [
        { id: 'move', title: 'Move', hint: touch ? 'Left stick' : 'Walk to the marker', keys: touch ? [] : [k('forward'), k('left'), k('back'), k('right')] },
        { id: 'jump', title: 'Jump the wall', hint: touch ? 'Jump button' : '', keys: touch ? [] : [k('jump')] },
        { id: 'loot', title: 'Grab the rifle', hint: touch ? 'Walk up and tap the hand' : 'Look at it and press', keys: touch ? [] : [k('interact')] },
        { id: 'shoot', title: 'Shoot the target', hint: touch ? 'Fire button' : '', keys: touch ? [] : [k('fire')] },
        { id: 'build', title: 'Build a wall', hint: touch ? 'Build button, then fire' : 'Build mode, then place', keys: touch ? [] : [k('build'), k('fire')] },
        { id: 'done', title: 'You are ready', hint: '' },
      ];
    this.done = this.steps.slice(0, -1).map(() => false);
    this.events.on('built', ({ c }) => {
      if (c === this.player) this.flags.add('built');
    });
    this.events.on('reloadStart', ({ c }) => {
      if (c === this.player) this.flags.add('reloaded');
    });
    this.events.on('chest', ({ c }) => {
      if (c === this.player) this.flags.add('chest');
    });
    this.events.on('craft', ({ c }) => {
      if (c === this.player) this.flags.add('crafted');
    });
    // judge "aimed" when the shot leaves the barrel: bolt-actions drop out of the
    // scope to cycle before a projectile reaches a distant target
    let aimedShot = -9;
    let scopedShot = -9;
    this.events.on('fire', ({ c, def }) => {
      if (c !== this.player) return;
      if (c.ads > 0.55) aimedShot = this.time;
      if (def.id === 'longshot' && c.ads > 0.85) scopedShot = this.time;
    });
    this.events.on('damage', (e) => {
      if (e.attacker !== this.player) return;
      const d = this.dummies.find((x) => x.c === e.target);
      if (d?.key === 'dummy3' && this.time - aimedShot < 1.5) this.flags.add('ads_hit');
      if ((d?.key === 'far1' || d?.key === 'far2') && this.time - scopedShot < 1.5) this.flags.add('scope_hit');
      // any blast that reaches the dummy behind the wall teaches the lesson
      if (d?.key === 'nadeDummy' && e.kind === 'explosion') this.flags.add('nade');
    });
  }

  get step() {
    return this.steps[this.index];
  }

  /** where the current step happens, for the on-screen marker (quick tutorial) */
  objective(): THREE.Vector3 | null {
    const st = this.map.stations!;
    const at = (q: { x: number; y: number; z: number }, up = 0.6) => new THREE.Vector3(q.x, q.y + up, q.z);
    switch (this.step.id) {
      case 'move':
        return at(st.move, 0.2);
      case 'jump':
        return at(st.jump, 0.4);
      case 'loot': {
        const rifle = this.items.find((it) => !it.taken && it.spec.kind === 'weapon' && it.spec.weapon === 'ranger');
        return rifle ? rifle.pos.clone().add(new THREE.Vector3(0, 0.5, 0)) : at(st.weapon);
      }
      case 'shoot': {
        const d = this.dummies.find((x) => x.key === 'dummy1');
        return d && d.c.alive ? d.c.body.pos.clone().add(new THREE.Vector3(0, 2.3, 0)) : null;
      }
      default:
        return null;
    }
  }

  get doneCount() {
    return this.done.filter(Boolean).length;
  }

  /** player chose to move on without completing the suggested step */
  skipStep() {
    if (this.step.id === 'done' || this.ended) return;
    this.done[this.index] = true;
    this.events.emit('toast', { text: `Skipped: ${this.step.title}`, kind: 'info' });
    this.refreshCurrent();
  }

  onKill(e: KillEvent) {
    const d = this.dummies.find((x) => x.c === e.victim);
    if (d) {
      if (e.killer === this.player) this.flags.add('kill_dummy');
      if (d.key === 'nadeDummy' && e.cause === 'explosion') this.flags.add('nade');
      e.victim.respawnAt = this.time + 2;
    }
    if (this.duelBot && e.victim === this.duelBot.c) this.flags.add('duel');
    if (e.victim.isPlayer) e.victim.respawnAt = this.time + 3;
  }

  /** point the panel at the first unfinished step and prepare it */
  private refreshCurrent() {
    const next = this.done.findIndex((d) => !d);
    const idx = next < 0 ? this.steps.length - 1 : next;
    if (idx === this.index && this.entered.has(this.step.id)) return;
    this.index = idx;
    this.stepTime = 0;
    this.enter(this.step.id);
  }

  /** one-time setup when a step becomes the suggested one */
  private enter(id: string) {
    if (this.entered.has(id)) return;
    this.entered.add(id);
    const p = this.player;
    if (id === 'scope') this.ensureLongshot();
    if (id === 'craft') this.giveCloth();
    if (id === 'grenade') this.giveFrags();
    if (id === 'build') this.giveWood();
    if (id === 'done' && this.quick) {
      this.completedAt = this.time;
      this.after(1.6, () => this.finish(this.makeResult()));
      return;
    }
    if (id === 'duel') {
      p.addHeal('bandage', 3);
      p.addHeal('plate', 2);
      this.spawnDuelBot();
    }
    if (id === 'done') {
      this.completedAt = this.time;
      this.events.emit('announce', { title: 'TRAINING COMPLETE', sub: 'You are ready to drop in', kind: 'win' });
      this.after(3.5, () => this.finish(this.makeResult()));
    }
  }

  private ensureLongshot() {
    // chest loot is random: make sure a Longshot is always within reach for the scope step
    const p = this.player;
    const st = this.map.stations!;
    const has = p.weapons.some((w) => w?.def.id === 'longshot') || this.items.some((it) => !it.taken && it.spec.kind === 'weapon' && it.spec.weapon === 'longshot');
    if (!has) {
      this.spawnItem({ kind: 'weapon', weapon: 'longshot' }, new THREE.Vector3(st.range.x + 2, st.range.y + 0.5, st.range.z), new THREE.Vector3(0, 3, 0));
      this.events.emit('toast', { text: 'A Longshot was dropped at the firing line', kind: 'loot' });
    }
    if (p.ammo.heavy < 10) this.spawnItem({ kind: 'ammo', ammo: 'heavy', count: 20 }, new THREE.Vector3(st.range.x + 3, st.range.y + 0.5, st.range.z), new THREE.Vector3(0, 3, 0));
  }

  private giveCloth() {
    if (this.flags.has('gave_cloth')) return;
    this.flags.add('gave_cloth');
    this.player.addMat('cloth', 8);
    this.events.emit('toast', { text: '+8 Cloth for crafting', kind: 'loot' });
  }

  private giveFrags() {
    if (this.flags.has('gave_frags')) return;
    this.flags.add('gave_frags');
    this.player.addThrow('frag', 3);
    this.events.emit('toast', { text: '+3 Frag Grenades', kind: 'loot' });
  }

  private giveWood() {
    if (this.flags.has('gave_wood')) return;
    this.flags.add('gave_wood');
    this.player.addMat('wood', 40);
    if (!this.quick) this.events.emit('toast', { text: '+40 Wood for building', kind: 'loot' });
  }

  private spawnDuelBot() {
    if (this.duelBot) return;
    const st = this.map.stations!;
    const ident: Identity = { id: 'sparring', name: 'Sparring Bot', look: randomLook(4242), isBot: true, level: 3, rp: 0, title: 'Trainer', banner: 'stone', camo: 'factory', skill: 0.18, personality: makePersonality(77) };
    const c = this.addCombatant(ident, 1, false, new THREE.Vector3(st.duel.x, st.duel.y, st.duel.z));
    c.giveWeapon('p9');
    c.ammo.light = 60;
    c.slot = 0;
    this.duelBot = new BotBrain(c, this, 0.18, { pushGoal: () => this.player.body.pos.clone() });
    this.registerBrain(this.duelBot);
    this.events.emit('announce', { title: 'Final test', sub: 'Defeat the sparring bot', kind: 'info' });
  }

  update(dt: number) {
    const p = this.player;
    this.stepTime += dt;
    this.looked += Math.abs(p.yaw - this.lastYaw) + Math.abs(p.pitch - this.lastPitch);
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    super.update(dt);
    if (this.ended) return;
    const st = this.map.stations!;
    // dummies: respawn + strafe
    for (const d of this.dummies) {
      const c = d.c;
      if (!c.alive && c.respawnAt > 0 && this.time >= c.respawnAt) {
        c.resetForSpawn();
        c.body.pos.copy(d.home);
        c.respawnAt = 0;
      }
      if (c.alive) {
        c.intent.forward = 0;
        c.intent.strafe = d.moving ? Math.sign(Math.sin(this.time * 0.9)) : 0;
        c.intent.yaw = Math.PI;
        c.yaw = Math.PI;
        if (d.moving && Math.abs(c.body.pos.x - d.home.x) > 3) c.intent.strafe = Math.sign(d.home.x - c.body.pos.x);
      }
    }
    if (!p.alive && p.respawnAt > 0 && this.time >= p.respawnAt) {
      p.resetForSpawn();
      p.body.pos.set(st.arena.x, st.arena.y, st.arena.z + 2);
      p.respawnAt = 0;
    }
    if (this.duelBot && !this.duelBot.c.alive) this.flags.add('duel');
    const near = (q: { x: number; y: number; z: number }, r: number) => Math.hypot(p.body.pos.x - q.x, p.body.pos.z - q.z) < r;
    const isDone = (id: string) => this.done[this.steps.findIndex((s) => s.id === id)];
    // stations prepare themselves when the player shows up early, so any order works
    if (!isDone('grenade') && near(st.nade, 8) && p.throws.frag === 0) this.giveFrags();
    if (!isDone('build') && near(st.build, 10) && p.mats.wood < 20) this.giveWood();
    if (!isDone('duel') && (near(st.arena, 9) || near(st.duel, 9))) this.spawnDuelBot();
    // every step is checked every frame and stays done once achieved
    const checks: Record<string, () => boolean> = {
      look: () => this.looked > 2.2,
      move: () => near(st.move, 2.2) || p.body.pos.z < st.move.z - 2,
      jump: () => p.body.pos.z < 85,
      loot: () => p.weapons.some((w) => w?.def.id === 'ranger'),
      shoot: () => this.flags.has('kill_dummy'),
      reload: () => this.flags.has('reloaded'),
      ads: () => this.flags.has('ads_hit'),
      chest: () => this.flags.has('chest'),
      scope: () => this.flags.has('scope_hit'),
      harvest: () => p.mats.wood >= 30 || p.stats.harvested >= 30,
      build: () => p.body.onGround && p.body.pos.y >= st.ledge.y - 0.1 && Math.hypot(p.body.pos.x - st.ledge.x, p.body.pos.z - st.ledge.z) < 7,
      craft: () => this.flags.has('crafted'),
      grenade: () => this.flags.has('nade'),
      duel: () => this.flags.has('duel'),
    };
    // the quick tutorial wants a wall placed anywhere rather than the climb to the ledge
    if (this.quick) checks.build = () => this.flags.has('built');
    let completed = false;
    for (let i = 0; i < this.done.length; i++) {
      if (this.done[i]) continue;
      const step = this.steps[i];
      const check = checks[step.id];
      if (check && check()) {
        this.done[i] = true;
        completed = true;
        // finishing a later step early still gets a nod
        if (i !== this.index) this.events.emit('toast', { text: `Done: ${step.title}`, kind: 'good' });
      }
    }
    if (completed) audio.ui('quest', 0.8);
    this.refreshCurrent();
    this.statusText = `${this.quick ? 'Basics' : 'Training'} ${this.doneCount}/${this.done.length}`;
  }

  makeResult(): MatchResult {
    const p = this.player;
    return {
      mode: 'tutorial', ranked: false, mapName: this.map.name, won: this.done.every(Boolean), draw: false, placement: 1, participants: 1,
      teamScores: null, playerTeam: 0, stats: { ...p.stats }, duration: this.time, roster: this.buildRoster().filter((r) => r.isPlayer), mvp: p.name,
      survived: this.time,
      basics: this.quick,
    };
  }

  forfeitResult(): MatchResult {
    const r = this.makeResult();
    r.won = false;
    return r;
  }
}
