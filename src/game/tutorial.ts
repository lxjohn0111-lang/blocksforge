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
  index = 0;
  private dummies: { c: Combatant; home: THREE.Vector3; moving: boolean; key: string }[] = [];
  private duelBot: BotBrain | null = null;
  private looked = 0;
  private flags = new Set<string>();
  private stepTime = 0;
  completedAt = -1;

  constructor(engine: Engine, map: MapData, cfg: MatchConfig, private settings: Settings) {
    super(engine, map, cfg);
    this.buildingEnabled = true;
    this.craftingEnabled = true;
    this.harvestEnabled = true;
    this.regenEnabled = true;
    this.dropOnDeath = false;
    const st = map.stations!;
    const p = this.addCombatant(cfg.player, 0, true, new THREE.Vector3(st.spawn.x, st.spawn.y, st.spawn.z));
    p.yaw = 0;
    p.slot = 0;
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
    this.steps = [
      { id: 'look', title: 'Look around', hint: 'Move the mouse to look.' },
      { id: 'move', title: 'Walk to the marker', hint: `${k('forward')}${k('left')}${k('back')}${k('right')} to move · ${k('sprint')} to sprint` },
      { id: 'jump', title: 'Jump the wall', hint: `${k('jump')} to jump. One-block steps are climbed automatically.` },
      { id: 'loot', title: 'Grab the rifle', hint: `Look at the Ranger AR and press ${k('interact')}` },
      { id: 'shoot', title: 'Down both dummies', hint: `${k('fire')} to fire. Short bursts stay accurate.`, progress: () => `${this.flagCount('kill_dummy1') + this.flagCount('kill_dummy2')}/2` },
      { id: 'reload', title: 'Reload', hint: `Press ${k('reload')} to reload.` },
      { id: 'ads', title: 'Aim down sights', hint: `Hold ${k('aim')} and hit the dummy on the wall.` },
      { id: 'chest', title: 'Open the supply chest', hint: `Chests by the firing line hold better loot. ${k('interact')} to open.` },
      { id: 'scope', title: 'Scope in', hint: `Equip the Longshot, hold ${k('aim')}, scroll to change zoom, hit a far dummy.` },
      { id: 'harvest', title: 'Harvest materials', hint: `Harvest tool ${k('tool')}. Hit trees and boulders for 30 wood.`, progress: () => `${this.player.mats.wood}/30` },
      { id: 'build', title: 'Build up to the ledge', hint: `Build mode ${k('build')} · ${k('slot3')} ramp · ${k('fire')} place · ${k('rotate')} rotate · ${k('material')} material` },
      { id: 'craft', title: 'Craft bandages', hint: `Open ${k('inventory')} and craft Bandages from cloth.` },
      { id: 'grenade', title: 'Flush out cover', hint: `Hold ${k('grenade')} to aim the arc, release to throw over the wall.` },
      { id: 'duel', title: 'Final test', hint: 'Defeat the sparring bot in the arena. Use cover, heal with ' + k('heal') + '.' },
      { id: 'done', title: 'Training complete', hint: 'You are ready to drop in.' },
    ];
    this.events.on('reloadStart', ({ c }) => {
      if (c === this.player) this.flags.add('reloaded');
    });
    this.events.on('chest', ({ c }) => {
      if (c === this.player) this.flags.add('chest');
    });
    this.events.on('craft', ({ c }) => {
      if (c === this.player) this.flags.add('crafted');
    });
    this.events.on('damage', (e) => {
      if (e.attacker !== this.player) return;
      const d = this.dummies.find((x) => x.c === e.target);
      if (d?.key === 'dummy3' && this.player.ads > 0.7) this.flags.add('ads_hit');
      if ((d?.key === 'far1' || d?.key === 'far2') && this.player.gun?.def.id === 'longshot' && this.player.ads > 0.85) this.flags.add('scope_hit');
    });
  }

  private flagCount(f: string) {
    return this.flags.has(f) ? 1 : 0;
  }

  get step() {
    return this.steps[this.index];
  }

  onKill(e: KillEvent) {
    const d = this.dummies.find((x) => x.c === e.victim);
    if (d) {
      this.flags.add('kill_' + d.key);
      if (d.key === 'nadeDummy' && e.cause === 'explosion') this.flags.add('nade');
      e.victim.respawnAt = this.time + 2;
    }
    if (this.duelBot && e.victim === this.duelBot.c) this.flags.add('duel');
    if (e.victim.isPlayer) e.victim.respawnAt = this.time + 3;
  }

  private advance() {
    this.index = Math.min(this.steps.length - 1, this.index + 1);
    this.stepTime = 0;
    audio.ui('quest', 0.8);
    const id = this.step.id;
    const p = this.player;
    if (id === 'harvest') this.switchSlotIfNeeded();
    if (id === 'craft') {
      p.addMat('cloth', 8);
      this.events.emit('toast', { text: '+8 Cloth for crafting', kind: 'loot' });
    }
    if (id === 'grenade') {
      p.addThrow('frag', 3);
      this.events.emit('toast', { text: '+3 Frag Grenades', kind: 'loot' });
    }
    if (id === 'build') {
      p.addMat('wood', 40);
    }
    if (id === 'duel') {
      const st = this.map.stations!;
      p.addHeal('bandage', 3);
      p.addHeal('plate', 2);
      const ident: Identity = { id: 'sparring', name: 'Sparring Bot', look: randomLook(4242), isBot: true, level: 3, rp: 0, title: 'Trainer', banner: 'stone', camo: 'factory', skill: 0.22, personality: makePersonality(77) };
      const c = this.addCombatant(ident, 1, false, new THREE.Vector3(st.duel.x, st.duel.y, st.duel.z));
      c.giveWeapon('p9');
      c.ammo.light = 60;
      c.slot = 0;
      this.duelBot = new BotBrain(c, this, 0.22, { pushGoal: () => this.player.body.pos.clone() });
      this.registerBrain(this.duelBot);
      this.events.emit('announce', { title: 'Final test', sub: 'Defeat the sparring bot', kind: 'info' });
    }
    if (id === 'done') {
      this.completedAt = this.time;
      this.events.emit('announce', { title: 'TRAINING COMPLETE', sub: 'You are ready to drop in', kind: 'win' });
      setTimeout(() => this.finish(this.makeResult()), 3500);
    }
  }

  private switchSlotIfNeeded() {
    /* the player switches tools themselves; prompts explain how */
  }

  update(dt: number) {
    const p = this.player;
    this.stepTime += dt;
    this.looked += Math.abs(p.yaw - ((this as any)._lastYaw ?? p.yaw)) + Math.abs(p.pitch - ((this as any)._lastPitch ?? p.pitch));
    (this as any)._lastYaw = p.yaw;
    (this as any)._lastPitch = p.pitch;
    super.update(dt);
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
    if (this.duelBot && !this.duelBot.c.alive && !this.flags.has('duel')) this.flags.add('duel');
    // step checks
    const s = this.step.id;
    const near = (q: { x: number; y: number; z: number }, r: number) => Math.hypot(p.body.pos.x - q.x, p.body.pos.z - q.z) < r;
    let ok = false;
    switch (s) {
      case 'look':
        ok = this.looked > 2.2;
        break;
      case 'move':
        ok = near(st.move, 2.2);
        break;
      case 'jump':
        ok = p.body.pos.z < 85;
        break;
      case 'loot':
        ok = p.weapons.some((w) => w?.def.id === 'ranger');
        break;
      case 'shoot':
        ok = this.flags.has('kill_dummy1') && this.flags.has('kill_dummy2');
        break;
      case 'reload':
        ok = this.flags.has('reloaded');
        break;
      case 'ads':
        ok = this.flags.has('ads_hit');
        break;
      case 'chest':
        ok = this.flags.has('chest');
        break;
      case 'scope':
        ok = this.flags.has('scope_hit');
        break;
      case 'harvest':
        ok = p.mats.wood >= 30;
        break;
      case 'build':
        ok = p.body.onGround && p.body.pos.y >= st.ledge.y - 0.1 && Math.hypot(p.body.pos.x - st.ledge.x, p.body.pos.z - st.ledge.z) < 7;
        break;
      case 'craft':
        ok = this.flags.has('crafted');
        break;
      case 'grenade':
        ok = this.flags.has('nade') || this.flags.has('kill_nadeDummy');
        break;
      case 'duel':
        ok = this.flags.has('duel');
        break;
    }
    if (ok && this.stepTime > 0.4) this.advance();
    this.statusText = `Training ${Math.min(this.index + 1, this.steps.length - 1)}/${this.steps.length - 1}`;
  }

  makeResult(): MatchResult {
    const p = this.player;
    return {
      mode: 'tutorial', ranked: false, mapName: this.map.name, won: this.index >= this.steps.length - 1, draw: false, placement: 1, participants: 1,
      teamScores: null, playerTeam: 0, stats: { ...p.stats }, duration: this.time, roster: this.buildRoster().filter((r) => r.isPlayer), mvp: p.name,
      survived: this.time,
    };
  }

  forfeitResult(): MatchResult {
    const r = this.makeResult();
    r.won = false;
    return r;
  }
}
