// First-person viewmodel: weapon rig with procedural animation. Positions are
// in camera space (x right, y up, -z forward); the root follows the camera.

import * as THREE from 'three';
import { createEntityMaterial, buildVoxelGeometry, type VBox } from './voxelModel';
import {
  buildWeaponMeshes, type BuiltWeaponMeshes, cachedGeometry, pickaxeModel, hammerModel, fragModel, smokeModel,
  bandageModel, medkitModel, plateModel, type V3,
} from './weaponModels';
import { WEAPONS, type WeaponId, type HealKind, type ThrowKind } from '../game/weapons';
import { applyCamo, type Look } from './characters';
import type { CamoDef } from './camos';
import { Spring, clamp, lerp, easeInOutCubic, easeOutCubic } from '../core/mathx';

export type VMHolding =
  | { kind: 'gun'; weapon: WeaponId }
  | { kind: 'tool' }
  | { kind: 'hammer' }
  | { kind: 'heal'; heal: HealKind }
  | { kind: 'throw'; throw: ThrowKind }
  | { kind: 'none' };

const S = 1 / 32;

export interface VMUpdate {
  ads: number;
  speed: number;
  sprint: boolean;
  onGround: boolean;
  crouch: number;
  lookDX: number;
  lookDY: number;
  healProgress: number; // -1 when not healing
  throwCharge: number; // -1 when not holding a throw
  hideForScope: boolean;
  landed: number;
}

function flashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,210,120,0.9)');
  grd.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grd.addColorStop(1, 'rgba(255,100,20,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 12 : 32;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Viewmodel {
  root = new THREE.Group();
  pivot = new THREE.Group();
  material = createEntityMaterial({ fog: false });
  armMaterial = createEntityMaterial({ fog: false });
  holding: VMHolding = { kind: 'none' };
  gun: BuiltWeaponMeshes | null = null;
  item: THREE.Mesh | null = null;
  rightArm: THREE.Group;
  leftArm: THREE.Group;
  flash: THREE.Sprite;
  private flashT = 0;
  // animation state
  private equipT = 1;
  private equipDur = 0.4;
  private bob = 0;
  private recoilZ = new Spring(260, 24);
  private recoilX = new Spring(200, 18);
  private recoilR = new Spring(150, 14);
  private swayX = new Spring(80, 12);
  private swayY = new Spring(80, 12);
  private land = new Spring(120, 12);
  private reload: { t: number; dur: number; kind: 'mag' | 'shell' | 'rocket'; empty: boolean; shells: number } | null = null;
  private cycleAnim: { t: number; dur: number; kind: 'bolt' | 'pump' } | null = null;
  private slideT = 0;
  private slideLocked = false;
  private swingT = -1;
  private throwT = -1;
  private strikeT = -1;
  private sprintBlend = 0;
  private time = 0;
  private hand = { r: new THREE.Vector3(), l: new THREE.Vector3() };
  events: ((name: string) => void) | null = null;
  private firedEvents = new Set<string>();

  /**
   * @param camera the live world camera (already updated this frame)
   * @param vmCamera the viewmodel camera; kept in sync here so muzzle/eject reprojection never uses a stale pose
   */
  constructor(private camera: THREE.Camera, private vmCamera?: THREE.Camera) {
    this.root.add(this.pivot);
    this.rightArm = this.makeArm();
    this.leftArm = this.makeArm();
    this.root.add(this.rightArm, this.leftArm);
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(3, 2.4, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.flash.visible = false;
    this.flash.scale.setScalar(0.12);
    this.root.frustumCulled = false;
    this.root.traverse((o) => (o.frustumCulled = false));
  }

  private armBoxes(sleeve: number, glove: number, skin: number): VBox[] {
    // arm along -Z: from 0 (shoulder) to -1 (wrist) in unit length, sleeve cross-section ~0.09
    return [
      { min: [-0.5, -0.5, -1], max: [0.5, 0.5, 0], color: sleeve, mat: 'cloth' },
      { min: [-0.52, -0.52, -0.25], max: [0.52, 0.52, -0.1], color: 0x1a1a1a, mat: 'cloth' },
      { min: [-0.45, -0.45, -1.06], max: [0.45, 0.45, -0.98], color: skin, mat: 'skin' },
    ];
  }

  private makeArm(): THREE.Group {
    const g = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BufferGeometry(), this.armMaterial);
    sleeve.name = 'sleeve';
    const glove = new THREE.Mesh(new THREE.BufferGeometry(), this.armMaterial);
    glove.name = 'glove';
    g.add(sleeve, glove);
    return g;
  }

  setLook(look: Look) {
    const sleeveC = look.jacket ?? look.shirt;
    for (const arm of [this.rightArm, this.leftArm]) {
      const sleeve = arm.getObjectByName('sleeve') as THREE.Mesh;
      const glove = arm.getObjectByName('glove') as THREE.Mesh;
      sleeve.geometry.dispose();
      sleeve.geometry = buildVoxelGeometry(this.armBoxes(sleeveC, look.gloves, look.skin), 1);
      glove.geometry.dispose();
      glove.geometry = buildVoxelGeometry(
        [
          { min: [-0.55, -0.6, -0.75], max: [0.55, 0.6, 0.3], color: look.gloves, mat: 'rubber' },
          { min: [-0.5, -0.65, -0.7], max: [0.5, -0.45, 0.2], color: 0x0e0e0e, mat: 'rubber' },
          { min: [0.45, -0.3, -0.6], max: [0.75, 0.3, -0.05], color: look.gloves, mat: 'rubber' },
        ],
        1,
      );
    }
  }

  setCamo(c: CamoDef | null) {
    applyCamo(this.material, c);
  }

  setLight(sky: number, block: number) {
    this.material.uniforms.uLocalLight.value.set(sky, block);
    this.armMaterial.uniforms.uLocalLight.value.set(sky, block);
  }

  setHolding(h: VMHolding, equipTime = 0.4) {
    this.holding = h;
    this.reload = null;
    this.cycleAnim = null;
    this.swingT = -1;
    this.throwT = -1;
    this.slideLocked = false;
    this.equipT = 0;
    this.equipDur = Math.max(0.15, equipTime);
    if (this.gun) {
      this.pivot.remove(this.gun.group);
      this.gun = null;
    }
    if (this.item) {
      this.pivot.remove(this.item);
      this.item = null;
    }
    if (this.flash.parent) this.flash.parent.remove(this.flash);
    if (h.kind === 'gun') {
      this.gun = buildWeaponMeshes(h.weapon, this.material, S);
      this.pivot.add(this.gun.group);
      const m = this.gun.model.muzzle;
      this.flash.position.set(m[0] * S, m[1] * S, m[2] * S - 0.05);
      this.gun.group.add(this.flash);
    } else {
      let boxes: VBox[] | null = null;
      let key = '';
      if (h.kind === 'tool') { boxes = pickaxeModel(); key = 'pickaxe'; }
      else if (h.kind === 'hammer') { boxes = hammerModel(); key = 'hammer'; }
      else if (h.kind === 'throw') { boxes = h.throw === 'frag' ? fragModel() : smokeModel(); key = h.throw; }
      else if (h.kind === 'heal') { boxes = h.heal === 'bandage' ? bandageModel() : h.heal === 'medkit' ? medkitModel() : plateModel(); key = h.heal; }
      if (boxes) {
        this.item = new THREE.Mesh(cachedGeometry('vm_' + key, boxes, S), this.material);
        this.item.frustumCulled = false;
        this.pivot.add(this.item);
      }
    }
    this.pivot.traverse((o) => (o.frustumCulled = false));
  }

  fire(scale = 1) {
    if (this.holding.kind !== 'gun' || !this.gun) return;
    const def = WEAPONS[this.holding.weapon];
    const heavy = def.category === 'sniper' || def.category === 'shotgun' || def.category === 'launcher';
    const k = heavy ? 2.2 : def.category === 'dmr' ? 1.5 : 1;
    this.recoilZ.kick(1.4 * k * scale);
    this.recoilX.kick((0.9 + Math.random() * 0.3) * k * scale);
    this.recoilR.kick((Math.random() - 0.5) * 1.2 * k);
    this.flashT = def.category === 'launcher' ? 0.07 : 0.045;
    this.flash.visible = def.category !== 'launcher' || true;
    this.flash.scale.setScalar((def.category === 'shotgun' ? 0.2 : def.category === 'pistol' ? 0.1 : 0.15) * (0.85 + Math.random() * 0.3));
    this.flash.material.rotation = Math.random() * Math.PI;
    if (this.gun.slide) this.slideT = 0.07;
    if (this.gun.rocket) this.gun.rocket.visible = false;
  }

  setSlideLocked(v: boolean) {
    this.slideLocked = v;
  }

  startReload(kind: 'mag' | 'shell' | 'rocket', dur: number, empty: boolean, shells = 0) {
    this.reload = { t: 0, dur, kind, empty, shells };
    this.firedEvents.clear();
    this.cycleAnim = null;
  }

  cancelReload() {
    this.reload = null;
    if (this.gun?.mag) {
      this.gun.mag.visible = true;
      this.gun.mag.position.set(0, 0, 0);
    }
    if (this.gun?.rocket) this.gun.rocket.visible = true;
  }

  cycle(kind: 'bolt' | 'pump', dur: number) {
    this.cycleAnim = { t: 0, dur, kind };
    this.firedEvents.clear();
  }

  swing() {
    this.swingT = 0;
  }
  strike() {
    this.strikeT = 0;
  }
  throwRelease() {
    this.throwT = 0;
  }

  private emit(name: string, at: number, u: number) {
    if (u >= at && !this.firedEvents.has(name)) {
      this.firedEvents.add(name);
      this.events?.(name);
    }
  }

  get isReloading() {
    return this.reload !== null;
  }

  /** Muzzle position projected into world space so world FX line up. */
  muzzleWorld(world: THREE.PerspectiveCamera, vm: THREE.PerspectiveCamera, out: THREE.Vector3) {
    if (!this.gun) return out.copy(world.position);
    const m = this.gun.model.muzzle;
    const p = new THREE.Vector3(m[0] * S, m[1] * S, m[2] * S);
    this.gun.group.updateMatrixWorld(true);
    p.applyMatrix4(this.gun.group.matrixWorld);
    return this.reproject(p, world, vm, out);
  }
  ejectWorld(world: THREE.PerspectiveCamera, vm: THREE.PerspectiveCamera, out: THREE.Vector3) {
    if (!this.gun) return out.copy(world.position);
    const m = this.gun.model.eject;
    const p = new THREE.Vector3(m[0] * S, m[1] * S, m[2] * S);
    p.applyMatrix4(this.gun.group.matrixWorld);
    return this.reproject(p, world, vm, out);
  }
  private reproject(p: THREE.Vector3, world: THREE.PerspectiveCamera, vm: THREE.PerspectiveCamera, out: THREE.Vector3) {
    const ndc = p.clone().project(vm);
    const dist = p.distanceTo(vm.position);
    out.set(ndc.x, ndc.y, 0.5).unproject(world);
    const dir = out.sub(world.position).normalize();
    return out.copy(world.position).addScaledVector(dir, Math.max(0.35, dist));
  }

  update(dt: number, u: VMUpdate) {
    this.time += dt;
    // follow the camera pose of *this* frame (following the viewmodel camera, which is only
    // synced at render time, made the weapon trail one frame behind when moving or turning)
    this.root.position.copy(this.camera.position);
    this.root.quaternion.copy(this.camera.quaternion);
    if (this.vmCamera) {
      this.vmCamera.position.copy(this.camera.position);
      this.vmCamera.quaternion.copy(this.camera.quaternion);
      this.vmCamera.updateMatrixWorld();
    }
    this.root.visible = !u.hideForScope && this.holding.kind !== 'none';

    // springs
    this.swayX.target = clamp(-u.lookDX * 0.0009, -0.05, 0.05) * (1 - u.ads * 0.8);
    this.swayY.target = clamp(u.lookDY * 0.0009, -0.05, 0.05) * (1 - u.ads * 0.8);
    this.swayX.update(dt);
    this.swayY.update(dt);
    this.recoilZ.update(dt);
    this.recoilX.update(dt);
    this.recoilR.update(dt);
    if (u.landed > 0) this.land.kick(-u.landed * 0.8);
    this.land.update(dt);
    this.equipT = Math.min(1, this.equipT + dt / this.equipDur);
    this.sprintBlend += ((u.sprint && u.ads < 0.1 && !this.reload ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 10);
    if (u.speed > 0.5 && u.onGround) this.bob += dt * (u.sprint ? 13 : 9.5) * Math.min(1.3, u.speed / 4.6);
    else this.bob += dt * 1.2;
    const moveAmt = u.onGround ? Math.min(1, u.speed / 4.6) : 0;
    const bobAmp = (1 - u.ads * 0.85) * moveAmt * (u.sprint ? 1.6 : 1);
    const breathe = Math.sin(this.time * 1.6) * 0.0035 * (1 - u.ads * 0.7);

    const model = this.gun?.model;
    // base pose
    const hip: V3 = model ? [0.155, -0.19, -0.36] : [0.22, -0.26, -0.44];
    let px = hip[0], py = hip[1], pz = hip[2];
    let rx = 0, ry = 0.035, rz = 0;
    if (model) {
      px += model.hipOffset[0];
      py += model.hipOffset[1];
      pz += model.hipOffset[2];
      // aim down sights: sight point onto view axis
      const adsDist = model.scope ? 0.16 : 0.2;
      const ax = -model.sight[0] * S;
      const ay = -model.sight[1] * S;
      const az = -model.sight[2] * S - adsDist;
      const a = easeInOutCubic(u.ads);
      px = lerp(px, ax, a);
      py = lerp(py, ay, a);
      pz = lerp(pz, az, a);
      ry = lerp(ry, 0, a);
    }
    if (this.holding.kind === 'tool' || this.holding.kind === 'hammer') {
      px = 0.27; py = -0.32; pz = -0.42;
      rx = 0.15; ry = -0.25; rz = -0.1;
    } else if (this.holding.kind === 'heal') {
      px = 0.05; py = -0.2; pz = -0.38;
      rx = 0.4; ry = -0.6;
    } else if (this.holding.kind === 'throw') {
      px = 0.2; py = -0.2; pz = -0.36;
    }
    // sprint pose
    const sp = this.sprintBlend;
    px = lerp(px, px - 0.03, sp);
    py = lerp(py, py - 0.05, sp);
    rx = lerp(rx, rx - 0.32, sp);
    ry = lerp(ry, ry + 0.75, sp);
    rz = lerp(rz, rz + 0.12, sp);
    // bob
    px += Math.sin(this.bob) * 0.012 * bobAmp;
    py += -Math.abs(Math.cos(this.bob)) * 0.011 * bobAmp + breathe + this.land.value * 0.05;
    rz += Math.sin(this.bob) * 0.02 * bobAmp;
    // crouch tilt
    rz += u.crouch * 0.05 * (1 - u.ads);
    // sway
    px += this.swayX.value * 0.6;
    py += this.swayY.value * 0.5;
    ry += this.swayX.value * 1.4;
    rx += this.swayY.value * 1.2;
    // recoil
    pz += this.recoilZ.value * 0.03 * (1 - u.ads * 0.4);
    rx += this.recoilX.value * 0.045;
    rz += this.recoilR.value * 0.03;
    py += this.recoilX.value * 0.004;

    // equip
    const e = easeOutCubic(this.equipT);
    py -= (1 - e) * 0.3;
    rx -= (1 - e) * 0.9;

    // reload choreography
    let lHandMag = 0; // 0 = on handguard, 1 = on mag/belt
    let lHandDown = 0;
    if (this.reload && model) {
      const r = this.reload;
      r.t += dt;
      const uu = Math.min(1, r.t / r.dur);
      const tilt = Math.sin(Math.min(1, uu / 0.9) * Math.PI);
      if (r.kind === 'mag') {
        rz += -0.42 * tilt;
        rx += 0.16 * tilt;
        px -= 0.03 * tilt;
        py += 0.02 * tilt;
        const mag = this.gun!.mag;
        if (mag) {
          if (uu < 0.14) mag.position.set(0, 0, 0);
          else if (uu < 0.36) {
            const k = (uu - 0.14) / 0.22;
            mag.position.set(0, -k * 14 * S, k * 2 * S);
            mag.visible = k < 0.9;
          } else if (uu < 0.56) mag.visible = false;
          else if (uu < 0.74) {
            const k = (uu - 0.56) / 0.18;
            mag.visible = true;
            mag.position.set(0, -(1 - easeOutCubic(k)) * 12 * S, (1 - k) * 2 * S);
          } else mag.position.set(0, 0, 0);
        }
        lHandMag = uu < 0.1 ? uu / 0.1 : uu < 0.8 ? 1 : 1 - (uu - 0.8) / 0.2;
        lHandDown = uu > 0.34 && uu < 0.62 ? Math.sin(((uu - 0.34) / 0.28) * Math.PI) : 0;
        if (r.empty && uu > 0.76 && uu < 0.9) {
          const k = (uu - 0.76) / 0.14;
          pz += Math.sin(k * Math.PI) * 0.025;
          rx += Math.sin(k * Math.PI) * 0.05;
          if (this.gun!.slide) this.slideLocked = false;
        }
        this.emit('mag_out', 0.16, uu);
        this.emit('mag_in', 0.7, uu);
        if (r.empty) this.emit('bolt_rack', 0.82, uu);
      } else if (r.kind === 'shell') {
        rz += -0.3 * tilt;
        rx += 0.1 * tilt;
        const per = WEAPONS[(this.holding as { weapon: WeaponId }).weapon].reload.perShell ?? 0.48;
        const local = (r.t - 0.25) / per;
        if (local > 0) {
          const ph = local % 1;
          lHandMag = 0.6 + 0.4 * Math.sin(ph * Math.PI);
          lHandDown = ph < 0.4 ? Math.sin((ph / 0.4) * Math.PI) * 0.6 : 0;
        }
      } else if (r.kind === 'rocket') {
        rx += -0.35 * tilt;
        py -= 0.06 * tilt;
        const rocket = this.gun!.rocket;
        if (rocket) {
          if (uu < 0.45) rocket.visible = false;
          else {
            rocket.visible = true;
            const k = Math.min(1, (uu - 0.45) / 0.3);
            rocket.position.set(0, 0, -(1 - easeOutCubic(k)) * 8 * S);
          }
        }
        lHandDown = uu < 0.45 ? Math.sin((uu / 0.45) * Math.PI) : 0;
        lHandMag = uu > 0.4 && uu < 0.8 ? 1 : 0;
        this.emit('rocket_load', 0.6, uu);
      }
      if (uu >= 1) {
        this.reload = null;
        if (this.gun?.mag) {
          this.gun.mag.visible = true;
          this.gun.mag.position.set(0, 0, 0);
        }
      }
    }
    // bolt / pump cycling
    if (this.cycleAnim && this.gun) {
      const c = this.cycleAnim;
      c.t += dt;
      const uu = Math.min(1, c.t / c.dur);
      if (c.kind === 'bolt' && this.gun.bolt) {
        const b = this.gun.bolt;
        const pivotY = 1.2 * S;
        const up = uu < 0.2 ? uu / 0.2 : uu < 0.8 ? 1 : 1 - (uu - 0.8) / 0.2;
        const back = uu < 0.2 ? 0 : uu < 0.5 ? (uu - 0.2) / 0.3 : uu < 0.8 ? 1 - (uu - 0.5) / 0.3 : 0;
        b.rotation.z = up * 1.1;
        b.position.set(0, pivotY * up * 0.2, back * 4 * S);
        rz -= Math.sin(uu * Math.PI) * 0.12 * (1 - u.ads * 0.5);
        this.emit('bolt_cycle', 0.05, uu);
        this.emit('eject', 0.45, uu);
      } else if (c.kind === 'pump' && this.gun.pump) {
        const k = uu < 0.45 ? uu / 0.45 : 1 - (uu - 0.45) / 0.55;
        this.gun.pump.position.set(0, 0, easeOutCubic(Math.max(0, k)) * 5 * S);
        pz += k * 0.012;
        this.emit('pump', 0.02, uu);
        this.emit('eject', 0.4, uu);
      }
      if (uu >= 1) {
        this.cycleAnim = null;
        if (this.gun.bolt) {
          this.gun.bolt.rotation.set(0, 0, 0);
          this.gun.bolt.position.set(0, 0, 0);
        }
        if (this.gun.pump) this.gun.pump.position.set(0, 0, 0);
      }
    }
    // slide
    if (this.gun?.slide) {
      this.slideT = Math.max(0, this.slideT - dt);
      const back = this.slideLocked ? 1 : this.slideT > 0 ? Math.sin((this.slideT / 0.07) * Math.PI) : 0;
      this.gun.slide.position.z = back * 1.6 * S;
    }
    // flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = this.flashT > 0;
    } else this.flash.visible = false;

    // tool swing
    if (this.swingT >= 0) {
      this.swingT += dt / 0.42;
      const s = this.swingT;
      const arc = s < 0.35 ? -Math.sin((s / 0.35) * Math.PI * 0.5) * 0.5 : s < 0.6 ? -0.5 + ((s - 0.35) / 0.25) * 1.9 : 1.4 * (1 - (s - 0.6) / 0.4);
      rx -= arc;
      pz -= Math.max(0, arc) * 0.08;
      py += Math.max(0, -arc) * 0.08;
      if (this.swingT >= 1) this.swingT = -1;
    }
    if (this.strikeT >= 0) {
      this.strikeT += dt / 0.25;
      rx -= Math.sin(this.strikeT * Math.PI) * 0.7;
      if (this.strikeT >= 1) this.strikeT = -1;
    }
    // throw
    if (this.holding.kind === 'throw') {
      if (u.throwCharge >= 0 && this.throwT < 0) {
        const c = Math.min(1, u.throwCharge * 3);
        py += c * 0.08;
        pz += c * 0.12;
        rx += c * 0.6;
      }
      if (this.throwT >= 0) {
        this.throwT += dt / 0.3;
        const t = Math.min(1, this.throwT);
        pz -= Math.sin(t * Math.PI) * 0.25;
        rx -= Math.sin(t * Math.PI) * 0.9;
        if (this.item) this.item.visible = t < 0.35;
        if (this.throwT >= 1) this.throwT = -1;
      } else if (this.item) this.item.visible = true;
    }
    // healing motion
    if (this.holding.kind === 'heal' && u.healProgress >= 0) {
      const h = u.healProgress;
      px += Math.sin(this.time * 9) * 0.015;
      py += Math.sin(this.time * 6) * 0.012 + h * 0.02;
      rz += Math.sin(this.time * 4) * 0.12;
    }

    this.pivot.position.set(px, py, pz);
    this.pivot.rotation.set(rx, ry, rz, 'YXZ');
    this.pivot.updateMatrix();

    // hands
    this.updateArms(lHandMag, lHandDown);
  }

  private updateArms(lHandMag: number, lHandDown: number) {
    const m = this.gun?.model;
    this.pivot.updateMatrix();
    const PM = this.pivot.matrix;
    const kind = this.holding.kind;
    const show = kind !== 'none';
    this.rightArm.visible = show;
    this.leftArm.visible = show && kind !== 'tool' && kind !== 'hammer' && kind !== 'throw';
    if (!show) return;
    let rh: V3 = [0, -2, 0.6];
    let lh: V3 = [-2, -2, -6];
    if (m) {
      rh = m.rightHand;
      lh = m.leftHand;
      if (lHandMag > 0) {
        const g = m.magGrab;
        lh = [lerp(lh[0], g[0], lHandMag), lerp(lh[1], g[1], lHandMag), lerp(lh[2], g[2], lHandMag)];
      }
    } else if (kind === 'tool' || kind === 'hammer') {
      rh = [0, -8, 0];
    } else if (kind === 'heal') {
      rh = [2.5, -1, 1];
      lh = [-2.5, -1, 1];
    } else if (kind === 'throw') {
      rh = [0, -1.8, 0.5];
    }
    this.hand.r.set(rh[0] * S, rh[1] * S, rh[2] * S).applyMatrix4(PM);
    this.hand.l.set(lh[0] * S, lh[1] * S, lh[2] * S).applyMatrix4(PM);
    this.hand.l.y -= lHandDown * 0.22;
    this.hand.l.x -= lHandDown * 0.04;
    this.placeArm(this.rightArm, new THREE.Vector3(0.24, -0.5, 0.12), this.hand.r);
    this.placeArm(this.leftArm, new THREE.Vector3(-0.22, -0.52, 0.05), this.hand.l);
  }

  private placeArm(arm: THREE.Group, shoulder: THREE.Vector3, hand: THREE.Vector3) {
    const sleeve = arm.children[0] as THREE.Mesh;
    const glove = arm.children[1] as THREE.Mesh;
    const dir = hand.clone().sub(shoulder);
    const len = dir.length();
    arm.position.copy(shoulder);
    // orientation computed in root space (Object3D.lookAt would use world space)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
    arm.quaternion.copy(q);
    sleeve.scale.set(0.085, 0.085, Math.max(0.05, len - 0.04));
    glove.position.set(0, 0, -len + 0.01);
    glove.scale.setScalar(0.07);
  }

  dispose() {
    this.material.dispose();
    this.armMaterial.dispose();
  }
}
