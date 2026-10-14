// Local player: input -> intent/actions, first-person camera, viewmodel,
// build previews and interaction prompts.

import * as THREE from 'three';
import type { Match } from './match';
import type { Input } from '../core/input';
import type { Settings } from '../core/settings';
import { Viewmodel, type VMHolding } from '../render/viewmodel';
import { GhostBlocks } from '../render/effects';
import { PIECES, PIECE_COST, type Piece } from './building';
import type { BuildMat } from '../world/blocks';
import { HEALS, THROWABLES, WEAPONS, itemName } from './weapons';
import { clamp, damp, DEG } from '../core/mathx';
import { audio } from '../audio/audio';
import { FX_LAYER } from '../render/chunkRenderer';
import { CAMOS } from '../render/camos';
import type { SlotIndex } from './combatant';

export class PlayerController {
  vm: Viewmodel;
  ghost = new GhostBlocks();
  arc: THREE.Points;
  buildPiece: Piece = 'wall';
  buildMat: BuildMat = 'wood';
  buildRot = 0;
  buildReason = '';
  scopeZoom = 0;
  interactPrompt = '';
  /** UI panels (inventory/map) suspend mouse look */
  uiBlocked = false;
  lookDX = 0;
  lookDY = 0;
  private landed = 0;
  private shakeT = 0;
  private camBob = 0;
  private lastHolding = '';
  inShip = false;
  spectate: number | null = null;
  private deathCamT = 0;
  private placeCooldown = 0;
  private adsToggleState = false;

  constructor(public match: Match, public input: Input, public settings: Settings) {
    const eng = match.engine;
    this.vm = new Viewmodel(eng.vmCamera);
    eng.vmScene.add(this.vm.root);
    this.vm.setLook(match.player.ident.look);
    this.vm.setCamo(CAMOS[match.cfg.camo] ?? null);
    match.root.add(this.ghost.mesh, this.ghost.edges);
    this.ghost.hide();
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 3), 3));
    this.arc = new THREE.Points(ag, new THREE.PointsMaterial({ color: new THREE.Color(2.2, 1.6, 0.6), size: 0.12, transparent: true, depthWrite: false }));
    this.arc.layers.set(FX_LAYER);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    match.root.add(this.arc);
    // viewmodel reacts to the player's own actions
    const p = match.player;
    match.events.on('fire', ({ c }) => {
      if (c !== p) return;
      this.vm.fire();
      const ej = this.vm.ejectWorld(eng.camera, eng.vmCamera, new THREE.Vector3());
      const g = p.gun;
      if (g && g.def.action !== 'bolt' && g.def.action !== 'pump' && g.def.category !== 'launcher') {
        const m = this.vm.gun?.model.shell ?? 'rifle';
        if (m !== 'none') {
          const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
          this.match.effects.casing(ej, right.multiplyScalar(2.2 + Math.random()).add(new THREE.Vector3(0, 2.4 + Math.random(), 0)).add(p.body.vel), m);
        }
      }
      const mz = this.vm.muzzleWorld(eng.camera, eng.vmCamera, new THREE.Vector3());
      if (g?.def.category !== 'launcher') this.match.effects.muzzleFlash(mz, p.aimDir(), 0.6);
      if (g && g.mag === 0 && this.vm.gun?.slide) this.vm.setSlideLocked(true);
      this.shakeT = Math.min(1, this.shakeT + (g?.def.category === 'sniper' || g?.def.category === 'shotgun' ? 0.35 : 0.08));
    });
    match.events.on('reloadStart', ({ c, def, dur, empty }) => {
      if (c !== p) return;
      this.vm.startReload(def.reload.kind, dur, empty);
    });
    match.events.on('reloadEnd', ({ c }) => {
      if (c !== p) return;
      if (this.vm.isReloading && (p.gun?.reloading ?? 0) <= 0) this.vm.cancelReload();
      this.vm.setSlideLocked(false);
    });
    match.events.on('cycle', ({ c, kind, dur }) => {
      if (c !== p) return;
      this.vm.cycle(kind, dur);
    });
    match.events.on('swing', ({ c }) => {
      if (c === p) this.vm.swing();
    });
    match.events.on('throw', ({ c }) => {
      if (c === p) this.vm.throwRelease();
    });
    match.events.on('built', ({ c }) => {
      if (c === p) this.vm.strike();
    });
    this.vm.events = (name) => {
      if (name === 'eject') {
        const ej = this.vm.ejectWorld(eng.camera, eng.vmCamera, new THREE.Vector3());
        const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
        this.match.effects.casing(ej, right.multiplyScalar(2).add(new THREE.Vector3(0, 2.6, 0)), p.gun?.def.category === 'shotgun' ? 'shotgun' : 'rifle');
        return;
      }
      audio.play(name, { vol: 0.75 });
    };
    match.playerMuzzleHook = () => this.vm.muzzleWorld(eng.camera, eng.vmCamera, new THREE.Vector3());
  }

  dispose() {
    this.match.engine.vmScene.remove(this.vm.root);
    this.vm.dispose();
  }

  private holdingFor(): VMHolding {
    const p = this.match.player;
    if (p.slot <= 2) {
      const g = p.weapons[p.slot];
      return g ? { kind: 'gun', weapon: g.def.id } : { kind: 'none' };
    }
    if (p.slot === 3) return { kind: 'heal', heal: p.healSel };
    if (p.slot === 4) return { kind: 'throw', throw: p.throwSel };
    if (p.slot === 5) return { kind: 'tool' };
    return { kind: 'hammer' };
  }

  get buildMode() {
    return this.match.player.slot === 6;
  }

  update(dt: number) {
    const m = this.match;
    const p = m.player;
    const inp = this.input;
    const eng = m.engine;
    const s = this.settings;

    // ---------------- look
    const [mx, my] = inp.consumeMouse();
    this.lookDX = mx;
    this.lookDY = my;
    if (!this.uiBlocked && p.alive) {
      const g = p.gun;
      let sens = 0.0022 * s.sensitivity;
      if (g && p.ads > 0.5) {
        if (g.def.scope && p.ads > 0.9) {
          const zoom = g.def.scope.zooms[Math.min(this.scopeZoom, g.def.scope.zooms.length - 1)];
          sens *= (g.def.scope.sens * s.scopeSens * 4) / zoom;
        } else sens *= s.adsSens;
      }
      p.yaw -= mx * sens;
      p.pitch -= my * sens * (s.invertY ? -1 : 1);
      p.pitch = clamp(p.pitch, -1.54, 1.54);
    }
    const wheel = inp.consumeWheel();

    // ---------------- in airship (BR pre-drop)
    if (this.inShip) {
      p.intent.forward = 0;
      p.intent.strafe = 0;
      if (!this.uiBlocked && inp.wasPressed('jump')) (m as unknown as { jumpFromShip?: (c: typeof p) => void }).jumpFromShip?.(p);
      this.updateCamera(dt);
      this.vm.root.visible = false;
      inp.endFrame();
      return;
    }

    if (!p.alive) {
      this.ghost.hide();
      this.arc.visible = false;
      this.updateCamera(dt);
      this.vm.update(dt, this.vmState(0));
      this.vm.root.visible = false;
      inp.endFrame();
      return;
    }

    // ---------------- movement intent
    const it = p.intent;
    const blocked = this.uiBlocked;
    it.forward = blocked ? 0 : (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    it.strafe = blocked ? 0 : (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0);
    it.yaw = p.yaw;
    it.jump = !blocked && inp.isDown('jump');
    if (s.crouchToggle) {
      if (!blocked && inp.wasPressed('crouch')) it.crouch = !p.crouching;
    } else it.crouch = !blocked && (inp.isDown('crouch') || inp.isDown('crouch'));
    it.sprint = !blocked && inp.isDown('sprint');

    if (blocked) {
      m.tryFire(p, false);
      p.wantAds = false;
      this.updateCamera(dt);
      this.vm.update(dt, this.vmState(wheel));
      inp.endFrame();
      return;
    }

    // ---------------- slot selection
    const slotKeys: [string, SlotIndex][] = [['slot1', 0], ['slot2', 1], ['slot3', 2], ['slot4', 3], ['slot5', 4]];
    // in build mode 1-4 pick the piece instead of a weapon slot (handled below)
    const inBuild = p.slot === 6;
    for (const [a, sl] of slotKeys) if (inp.wasPressed(a as any) && !(inBuild && sl <= 3)) m.switchSlot(p, sl);
    if (inp.wasPressed('tool') && m.harvestEnabled) m.switchSlot(p, p.slot === 5 ? p.lastGunSlot : 5);
    if (inp.wasPressed('build') && m.buildingEnabled) m.switchSlot(p, p.slot === 6 ? p.lastGunSlot : 6);
    const g = p.gun;
    const scoped = !!(g?.def.scope && p.ads > 0.6);
    if (wheel !== 0) {
      if (scoped && g!.def.scope!.zooms.length > 1) {
        this.scopeZoom = clamp(this.scopeZoom + (wheel < 0 ? 1 : -1), 0, g!.def.scope!.zooms.length - 1);
        audio.play('scope_in', { vol: 0.4 });
      } else if (this.buildMode) {
        const i = PIECES.indexOf(this.buildPiece);
        this.buildPiece = PIECES[(i + (wheel > 0 ? 1 : PIECES.length - 1)) % PIECES.length];
        audio.ui('click', 0.4);
      } else {
        // cycle through occupied gun slots + tool
        const order: SlotIndex[] = [0, 1, 2];
        const avail = order.filter((i) => p.weapons[i]);
        if (avail.length) {
          const cur = avail.indexOf(p.slot as any);
          const next = avail[(cur + (wheel > 0 ? 1 : avail.length - 1) + avail.length) % avail.length];
          m.switchSlot(p, next);
        }
      }
    }
    if (inp.wasPressed('heal')) m.startHeal(p);
    if (inp.wasPressed('interact')) {
      if (!m.interact(p)) {
        /* nothing in reach */
      }
    }

    // ---------------- actions per held item
    const fireDown = inp.isDown('fire');
    const firePressed = inp.wasPressed('fire');
    const aimDown = inp.isDown('aim');
    if (s.aimToggle) {
      if (inp.wasPressed('aim')) this.adsToggleState = !this.adsToggleState;
      if (p.slot > 2 || !g) this.adsToggleState = false;
      p.wantAds = this.adsToggleState;
    } else p.wantAds = aimDown;
    if (g && (g.reloading > 0 || p.sprinting)) this.adsToggleState = this.adsToggleState && g.reloading <= 0;

    // quick grenade with G
    if (inp.wasPressed('grenade') && p.slot !== 4) m.startThrow(p);
    if (p.throwHold >= 0 && inp.wasReleased('grenade') && p.quickThrowReturn !== null) m.releaseThrow(p);

    this.ghost.hide();
    this.arc.visible = false;
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    if (p.slot <= 2) {
      m.tryFire(p, fireDown);
      if (inp.wasPressed('reload')) m.reload(p);
    } else if (p.slot === 3) {
      m.tryFire(p, false);
      if (firePressed && p.useTimer < 0) m.startHeal(p, p.healSel);
    } else if (p.slot === 4) {
      if (firePressed && p.throwHold < 0) m.startThrow(p);
      if (p.throwHold >= 0 && !fireDown && p.quickThrowReturn === null && !inp.isDown('grenade')) m.releaseThrow(p);
    } else if (p.slot === 5) {
      if (fireDown) m.toolSwing(p);
    } else if (p.slot === 6) {
      if (inp.wasPressed('material')) {
        const mats: BuildMat[] = ['wood', 'stone', 'metal'];
        this.buildMat = mats[(mats.indexOf(this.buildMat) + 1) % 3];
        audio.ui('click', 0.5);
      }
      if (inp.wasPressed('rotate')) {
        this.buildRot = (this.buildRot + 1) % 4;
        audio.ui('click', 0.4);
      }
      for (const [a, piece] of [['slot1', 'wall'], ['slot2', 'floor'], ['slot3', 'ramp'], ['slot4', 'block']] as const) {
        if (inp.wasPressed(a)) {
          this.buildPiece = piece;
          if (p.slot !== 6) m.switchSlot(p, 6);
        }
      }
      const pl = m.build.compute(p, this.buildPiece, this.buildRot, this.buildMat);
      const afford = p.mats[this.buildMat] >= PIECE_COST[this.buildPiece];
      this.buildReason = pl.valid ? (afford ? '' : `Need ${PIECE_COST[this.buildPiece]} ${this.buildMat}`) : pl.reason;
      this.ghost.set(pl.blocks, pl.valid && afford);
      if (fireDown && this.placeCooldown <= 0) {
        const r = m.placeBuild(p, this.buildPiece, this.buildRot, this.buildMat);
        this.placeCooldown = 0.18;
        if (!r.ok && firePressed) {
          audio.ui('deny', 0.6);
          m.events.emit('toast', { text: r.reason || 'Cannot build here', kind: 'warn' });
        }
      }
      if (inp.wasPressed('aim')) this.removeOwnBlock();
    }
    // grenade arc preview
    if (p.throwHold >= 0 && p.throws[p.throwSel] > 0) {
      const pts = m.predictArc(p, p.throwHold);
      const arr = this.arc.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = Math.min(80, pts.length);
      for (let i = 0; i < n; i++) arr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
      this.arc.geometry.setDrawRange(0, n);
      arr.needsUpdate = true;
      this.arc.visible = true;
    }

    // interaction prompt
    this.interactPrompt = '';
    const chest = m.lookChest(p);
    if (chest) this.interactPrompt = 'Open Supply Chest';
    else {
      const item = m.lookItem(p);
      if (item) {
        const sp = item.spec;
        if (sp.kind === 'weapon' && p.weapons.every((w) => w) ) this.interactPrompt = `Swap for ${itemName(sp)}`;
        else this.interactPrompt = `Pick up ${itemName(sp)}`;
      }
    }

    // holding changed -> viewmodel
    const h = this.holdingFor();
    const key = JSON.stringify(h);
    if (key !== this.lastHolding) {
      this.lastHolding = key;
      const eq = h.kind === 'gun' ? WEAPONS[h.weapon].equipTime : 0.25;
      this.vm.setHolding(h, eq);
      this.scopeZoom = 0;
    }

    this.updateCamera(dt);
    this.vm.update(dt, this.vmState(wheel));
    inp.endFrame();
  }

  private removeOwnBlock() {
    const m = this.match;
    const p = m.player;
    const e = p.eye();
    const d = p.aimDir();
    const hit = m.world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, 6, (id) => id !== 0 && id !== 7);
    if (!hit) return;
    const i = m.world.idx(hit.x, hit.y, hit.z);
    if (m.world.builtOwner.get(i) !== p.id) {
      m.events.emit('toast', { text: 'You can only remove your own blocks', kind: 'warn' });
      return;
    }
    const id = hit.id;
    const mat: BuildMat = id === 48 ? 'wood' : id === 49 ? 'stone' : 'metal';
    m.world.set(hit.x, hit.y, hit.z, 0);
    m.onBlockDestroyed(hit.x, hit.y, hit.z, id, null, true);
    m.build.collapseCheck(hit.x, hit.y, hit.z, p);
    p.addMat(mat, 1);
    audio.play('b_place', { vol: 0.5, rate: 1.4 });
  }

  private vmState(_wheel: number) {
    const p = this.match.player;
    const g = p.gun;
    return {
      ads: p.ads,
      speed: Math.hypot(p.body.vel.x, p.body.vel.z),
      sprint: p.sprinting,
      onGround: p.body.onGround,
      crouch: p.crouchBlend,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      healProgress: p.useTimer >= 0 ? p.useTimer / p.useDur : -1,
      throwCharge: p.throwHold,
      hideForScope: !!(g?.def.scope && p.ads > 0.92),
      landed: this.consumeLanded(),
    };
  }

  private consumeLanded() {
    const l = this.landed;
    this.landed = 0;
    return l;
  }

  notifyLanded(fall: number) {
    this.landed = Math.min(1.5, fall / 4);
  }

  /** world camera from the player's eye (or spectate / death cam) */
  updateCamera(dt: number) {
    const m = this.match;
    const p = m.player;
    const cam = m.engine.camera;
    const g = p.gun;
    let fovScale = 1;
    if (!p.alive) {
      // death cam: slowly orbit our body, then follow the killer if known
      this.deathCamT += dt;
      const killer = p.killedBy ? m.combatants.find((c) => c.id === p.killedBy!.id && c.alive) : null;
      const focus = this.spectate !== null ? m.combatants.find((c) => c.id === this.spectate && c.alive) : killer;
      const fp = focus ? focus.body.pos.clone().add(new THREE.Vector3(0, 1.4, 0)) : p.body.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
      const a = this.deathCamT * 0.25 + p.yaw;
      const dist = focus ? 5.5 : 3.5 + Math.min(2, this.deathCamT);
      const want = fp.clone().add(new THREE.Vector3(Math.sin(a) * dist, 1.8, Math.cos(a) * dist));
      // keep camera out of walls
      const dir = want.clone().sub(fp);
      const len = dir.length();
      dir.normalize();
      const hit = m.world.raycast(fp.x, fp.y, fp.z, dir.x, dir.y, dir.z, len);
      const pos = hit ? fp.clone().addScaledVector(dir, Math.max(0.5, hit.dist - 0.3)) : want;
      cam.position.lerp(pos, damp(6, dt));
      cam.lookAt(fp);
      m.engine.fovScale = 1;
      return;
    }
    this.deathCamT = 0;
    const eye = p.eye();
    eye.y += p.body.stepSmooth;
    // subtle head bob
    const speed = Math.hypot(p.body.vel.x, p.body.vel.z);
    if (p.body.onGround && speed > 0.5) this.camBob += dt * speed * 1.7;
    const bobAmt = p.body.onGround ? Math.min(1, speed / 6) * (1 - p.ads) : 0;
    eye.y += Math.abs(Math.sin(this.camBob)) * 0.035 * bobAmt;
    // shake
    this.shakeT = Math.max(0, this.shakeT - dt * 3);
    const sh = Math.max(this.shakeT * 0.3, m.playerShake);
    const t = m.time;
    cam.position.copy(eye);
    const yaw = p.yaw + p.recoilYaw + Math.sin(t * 47) * 0.004 * sh;
    const pitch = clamp(p.pitch + p.recoilPitch + Math.sin(t * 53) * 0.006 * sh, -1.55, 1.55);
    cam.rotation.set(pitch, yaw, Math.sin(this.camBob * 0.5) * 0.004 * bobAmt + Math.sin(t * 31) * 0.01 * sh, 'YXZ');
    // fov
    if (g && p.ads > 0) {
      let z = g.def.adsZoom;
      if (g.def.scope && p.ads > 0.9) z = 1 / g.def.scope.zooms[Math.min(this.scopeZoom, g.def.scope.zooms.length - 1)];
      fovScale = 1 + (z - 1) * p.ads;
    }
    if (p.sprinting) fovScale *= 1.06;
    if (p.gliding || p.dropping) fovScale *= 1.1;
    m.engine.fovScale += (fovScale - m.engine.fovScale) * damp(18, dt);
    void DEG;
    void HEALS;
    void THROWABLES;
  }

  /** helper for HUD: scope overlay strength */
  get scopeAmount() {
    const p = this.match.player;
    const g = p.gun;
    return g?.def.scope && p.alive ? clamp((p.ads - 0.85) / 0.15, 0, 1) : 0;
  }
}
