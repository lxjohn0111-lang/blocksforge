// Hand-authored voxel weapon & equipment models. Units are "pixels" of
// 1/32 block. Barrels point down -Z, +Y is up, origin sits at the trigger.

import * as THREE from 'three';
import type { VBox, MatKind } from './voxelModel';
import { buildVoxelGeometry } from './voxelModel';
import type { WeaponId } from '../game/weapons';

export type V3 = [number, number, number];

export interface ModelParts {
  body: VBox[];
  mag?: VBox[];
  slide?: VBox[];
  bolt?: VBox[];
  pump?: VBox[];
  rocket?: VBox[];
}

export interface WeaponModel extends ModelParts {
  sight: V3;
  muzzle: V3;
  eject: V3;
  rightHand: V3;
  leftHand: V3;
  /** where the left hand grabs the magazine during reloads */
  magGrab: V3;
  scope: boolean;
  /** hip pose offset tweaks */
  hipOffset: V3;
  shell: 'small' | 'rifle' | 'shotgun' | 'none';
}

const b = (min: V3, max: V3, color: number, mat: MatKind = 'matte', camo = false): VBox => ({ min, max, color, mat, camo });

// palette
const GM = 0x2b2e33; // gunmetal
const GM_D = 0x1b1d20;
const GM_L = 0x454a52;
const POLY = 0x25272a;
const POLY_L = 0x34373b;
const RUB = 0x151618;
const TAN = 0x8a7454;
const OLIVE = 0x4c5434;
const OLIVE_D = 0x363c25;
const WOOD = 0x7b4a27;
const WOOD_L = 0x9b6436;
const BRASS = 0xc89b3c;
const GLASS = 0x5a8fb0;
const RED_DOT = 0xff2a2a;

function rail(z0: number, z1: number, y: number, w = 0.55, color = GM_D): VBox[] {
  const out: VBox[] = [b([-w + 0.05, y, z0], [w - 0.05, y + 0.35, z1], color, 'metal')];
  for (let z = z0 + 0.2; z < z1 - 0.4; z += 1) out.push(b([-w, y + 0.35, z], [w, y + 0.6, z + 0.55], color, 'metal'));
  return out;
}

function slots(x: number, y0: number, y1: number, z0: number, z1: number, step: number, len: number, color = GM_D): VBox[] {
  const out: VBox[] = [];
  const s = Math.sign(x) || 1;
  for (let z = z0; z + len <= z1; z += step) out.push(b([s > 0 ? x : x - 0.05, y0, z], [s > 0 ? x + 0.05 : x, y1, z + len], color, 'metal'));
  return out;
}

function redDot(z: number, y: number): VBox[] {
  return [
    b([-0.55, y, z - 2.2], [0.55, y + 0.45, z + 1.2], GM_D, 'metal'),
    b([-0.85, y + 0.45, z - 1.8], [-0.6, y + 2.4, z + 0.8], POLY, 'polymer'),
    b([0.6, y + 0.45, z - 1.8], [0.85, y + 2.4, z + 0.8], POLY, 'polymer'),
    b([-0.85, y + 2.4, z - 1.8], [0.85, y + 2.75, z + 0.8], POLY, 'polymer'),
    b([-0.85, y + 0.45, z - 1.8], [0.85, y + 0.75, z + 0.8], POLY, 'polymer'),
    b([-0.6, y + 0.75, z - 0.6], [0.6, y + 2.4, z - 0.5], GLASS, 'glass'),
    b([-0.09, y + 1.47, z - 0.5], [0.09, y + 1.65, z - 0.45], RED_DOT, 'emissive'),
    b([0.85, y + 1.0, z - 0.6], [1.15, y + 1.8, z + 0.4], GM, 'metal'),
  ];
}

function scope(z0: number, z1: number, y: number, r: number, color = POLY): VBox[] {
  const L = z1 - z0;
  return [
    // tube (octagonal look)
    b([-r, y - r * 0.7, z0 + L * 0.2], [r, y + r * 0.7, z1 - L * 0.18], color, 'metal', true),
    b([-r * 0.7, y - r, z0 + L * 0.2], [r * 0.7, y + r, z1 - L * 0.18], color, 'metal', true),
    // objective bell
    b([-r * 1.35, y - r * 1.0, z0], [r * 1.35, y + r * 1.0, z0 + L * 0.2], color, 'metal'),
    b([-r * 1.0, y - r * 1.35, z0], [r * 1.0, y + r * 1.35, z0 + L * 0.2], color, 'metal'),
    b([-r * 1.05, y - r * 1.05, z0 - 0.1], [r * 1.05, y + r * 1.05, z0], GLASS, 'glass'),
    // eyepiece
    b([-r * 1.2, y - r * 0.9, z1 - L * 0.18], [r * 1.2, y + r * 0.9, z1], color, 'metal'),
    b([-r * 0.9, y - r * 1.2, z1 - L * 0.18], [r * 0.9, y + r * 1.2, z1], color, 'metal'),
    b([-r * 0.95, y - r * 0.95, z1], [r * 0.95, y + r * 0.95, z1 + 0.1], 0x1a2a33, 'glass'),
    // turrets
    b([-0.45, y + r, z0 + L * 0.42], [0.45, y + r + 0.9, z0 + L * 0.56], GM_L, 'metal'),
    b([r, y - 0.45, z0 + L * 0.42], [r + 0.9, y + 0.45, z0 + L * 0.56], GM_L, 'metal'),
    b([-r - 0.5, y - 0.4, z0 + L * 0.44], [-r, y + 0.4, z0 + L * 0.54], GM_L, 'metal'),
    // rings
    b([-r - 0.15, y - r - 0.15, z0 + L * 0.28], [r + 0.15, y + r * 0.2, z0 + L * 0.34], GM_D, 'metal'),
    b([-r - 0.15, y - r - 0.15, z0 + L * 0.68], [r + 0.15, y + r * 0.2, z0 + L * 0.74], GM_D, 'metal'),
  ];
}

function triggerGroup(zf: number, zb: number, y: number): VBox[] {
  return [
    b([-0.22, y - 0.95, zf], [0.22, y - 0.7, zb], GM_D, 'metal'),
    b([-0.22, y - 0.95, zf - 0.3], [0.22, y, zf], GM_D, 'metal'),
    b([-0.12, y - 0.65, (zf + zb) / 2 - 0.2], [0.12, y, (zf + zb) / 2 + 0.15], GM_L, 'metal'),
  ];
}

function grip(z: number, y: number, color = RUB, w = 0.58, steps = 3, mat: MatKind = 'rubber', camo = false): VBox[] {
  const out: VBox[] = [];
  for (let i = 0; i < steps; i++) out.push(b([-w, y - 1.4 * (i + 1), z + 0.42 * i], [w, y - 1.4 * i + 0.05, z + 1.5 + 0.42 * i], color, mat, camo));
  // texture stripes
  for (let i = 0; i < steps * 2; i++) out.push(b([-w - 0.03, y - 0.5 - i * 0.7, z + 0.3 + 0.21 * i], [w + 0.03, y - 0.35 - i * 0.7, z + 1.3 + 0.21 * i], 0x0c0d0e, 'rubber'));
  return out;
}

// ------------------------------------------------------------------ pistol
function p9(): WeaponModel {
  const slide: VBox[] = [
    b([-0.55, -0.35, -6.2], [0.55, 0.95, 0.6], GM, 'metal', true),
    b([-0.45, 0.95, -6.0], [0.45, 1.05, 0.4], GM, 'metal', true),
    // serrations
    ...[0, 1, 2, 3].map((i) => b([-0.6, -0.2, -0.6 + i * 0.3 - 0.0], [0.6, 0.85, -0.45 + i * 0.3], GM_D, 'metal')),
    // ejection port
    b([0.1, 0.96, -2.6], [0.5, 1.06, -0.9], 0x111214, 'metal'),
    // sights
    b([-0.48, 1.05, 0.0], [-0.14, 1.45, 0.45], GM_D, 'metal'),
    b([0.14, 1.05, 0.0], [0.48, 1.45, 0.45], GM_D, 'metal'),
    b([-0.42, 1.05, 0.0], [-0.36, 1.2, 0.46], 0xffffff, 'emissive'),
    b([0.36, 1.05, 0.0], [0.42, 1.2, 0.46], 0xffffff, 'emissive'),
    b([-0.13, 1.05, -5.95], [0.13, 1.42, -5.5], GM_D, 'metal'),
    b([-0.06, 1.25, -5.96], [0.06, 1.36, -5.9], 0x7dff8a, 'emissive'),
    // muzzle
    b([-0.3, -0.1, -6.3], [0.3, 0.4, -6.2], 0x08090a, 'metal'),
  ];
  const body: VBox[] = [
    b([-0.5, -1.0, -5.8], [0.5, -0.35, 0.5], POLY, 'polymer'),
    b([-0.42, -1.35, -5.6], [0.42, -1.0, -3.2], POLY, 'polymer'),
    ...[0, 1, 2].map((i) => b([-0.45, -1.4, -5.4 + i * 0.7], [0.45, -1.3, -5.1 + i * 0.7], POLY_L, 'polymer')),
    ...triggerGroup(-2.6, -0.5, -1.0),
    ...grip(-0.55, -1.0, POLY, 0.56, 3, 'polymer'),
    // beavertail
    b([-0.45, -1.2, 0.5], [0.45, -0.6, 1.1], POLY, 'polymer'),
    // slide stop
    b([-0.65, -0.55, -2.8], [-0.5, -0.35, -1.6], GM_D, 'metal'),
  ];
  const mag: VBox[] = [
    b([-0.42, -4.9, 0.05], [0.42, -1.4, 1.1], GM_D, 'metal'),
    b([-0.55, -5.1, -0.05], [0.55, -4.75, 1.45], POLY, 'polymer'),
  ];
  return {
    body, slide, mag,
    sight: [0, 1.32, 0.3], muzzle: [0, 0.3, -6.4], eject: [0.4, 1.0, -1.8],
    rightHand: [0, -2.2, 0.6], leftHand: [-0.7, -2.6, 0.2], magGrab: [0, -4.8, 0.6],
    scope: false, hipOffset: [0, 0, 0], shell: 'small',
  };
}

// ------------------------------------------------------------------ SMG
function hornet(): WeaponModel {
  const Y = 0xf2b632;
  const body: VBox[] = [
    b([-0.8, 0.0, -9], [0.8, 1.65, 4], POLY, 'polymer', true),
    ...rail(-8, 3.6, 1.65),
    b([-0.62, 0.2, -11.6], [0.62, 1.3, -9], POLY_L, 'polymer'),
    b([-0.3, 0.45, -13], [0.3, 1.05, -11.6], GM_D, 'metal'),
    b([-0.42, 0.33, -14], [0.42, 1.17, -13], GM, 'metal'),
    ...slots(0.42, 0.55, 0.95, -13.9, -13.1, 0.4, 0.2),
    // angled lower housing
    b([-0.85, -2.7, -7], [0.85, 0.02, -1.5], POLY, 'polymer', true),
    b([-0.85, -1.9, -8.3], [0.85, 0.02, -7], POLY, 'polymer', true),
    b([-0.85, -1.1, -9], [0.85, 0.02, -8.3], POLY, 'polymer', true),
    // yellow accents
    b([-0.83, 0.65, -8.8], [-0.8, 0.95, 3.8], Y, 'polymer'),
    b([0.8, 0.65, -8.8], [0.83, 0.95, 3.8], Y, 'polymer'),
    b([-0.86, -2.4, -6.6], [-0.83, -2.1, -1.9], Y, 'polymer'),
    b([0.83, -2.4, -6.6], [0.86, -2.1, -1.9], Y, 'polymer'),
    ...triggerGroup(-1.4, 0.4, -0.1),
    ...grip(0.1, -0.05, RUB, 0.58, 3),
    // stock
    b([-0.45, 0.25, 4], [0.45, 1.15, 9.2], GM, 'metal'),
    b([-0.72, -1.5, 9.2], [0.72, 1.85, 10.3], POLY, 'polymer', true),
    b([-0.75, -1.6, 10.3], [0.75, 1.95, 10.7], RUB, 'rubber'),
    // charging handle
    b([-1.15, 0.8, -6.2], [-0.8, 1.25, -5.0], GM_L, 'metal'),
    b([-1.5, 0.75, -6.4], [-1.15, 1.3, -5.6], POLY, 'polymer'),
    ...redDot(-0.8, 1.95),
  ];
  const mag: VBox[] = [
    b([-0.52, -9.2, -6.3], [0.52, -2.6, -4.5], GM_D, 'metal'),
    b([-0.62, -9.6, -6.5], [0.62, -9.2, -4.2], Y, 'polymer'),
  ];
  return {
    body, mag,
    sight: [0, 3.42, -1.2], muzzle: [0, 0.75, -14.2], eject: [0.85, 1.0, -2.5],
    rightHand: [0, -1.6, 0.9], leftHand: [0, -2.2, -5.4], magGrab: [0, -8.6, -5.4],
    scope: false, hipOffset: [0, 0, 0], shell: 'small',
  };
}

// ------------------------------------------------------------------ AR
function ranger(): WeaponModel {
  const body: VBox[] = [
    // lower + upper receiver
    b([-0.7, -1.5, -5], [0.7, 0.5, 3], GM, 'metal', true),
    b([-0.76, 0.5, -6], [0.76, 2.2, 3.5], GM, 'metal', true),
    ...rail(-13.5, 3.2, 2.2),
    // M-LOK handguard
    b([-0.92, -0.2, -15], [0.92, 2.2, -6], POLY_L, 'polymer', true),
    ...slots(0.92, 0.6, 1.1, -14.4, -6.6, 2.0, 1.3),
    ...slots(-0.92, 0.6, 1.1, -14.4, -6.6, 2.0, 1.3),
    b([-0.6, -0.25, -14.6], [0.6, -0.2, -6.4], GM_D, 'metal'),
    // barrel, gas block, flash hider
    b([-0.3, 0.6, -21], [0.3, 1.2, -15], GM_D, 'metal'),
    b([-0.42, 0.45, -17.2], [0.42, 1.45, -16.2], GM, 'metal'),
    b([-0.42, 0.48, -22.7], [0.42, 1.32, -21], GM_D, 'metal'),
    ...slots(0.42, 0.65, 1.15, -22.5, -21.2, 0.5, 0.25, 0x08090a),
    // folding front sight
    b([-0.28, 2.6, -13.8], [0.28, 3.55, -13.1], GM_D, 'metal'),
    b([-0.08, 3.55, -13.6], [0.08, 3.8, -13.3], GM_D, 'metal'),
    // ejection port & forward assist
    b([0.76, 0.85, -1.6], [0.86, 1.75, 1.6], 0x141517, 'metal'),
    b([0.76, 1.2, 2.0], [1.25, 1.85, 3.0], GM_L, 'metal'),
    // mag well
    b([-0.72, -2.6, -5], [0.72, -1.4, -1.8], GM, 'metal', true),
    b([0.7, -1.2, -1.9], [0.95, -0.75, -1.25], GM_L, 'metal'),
    ...triggerGroup(-1.4, 0.7, -1.5),
    ...grip(0.6, -1.5, RUB, 0.6, 3),
    // charging handle
    b([-0.62, 2.0, 3.5], [0.62, 2.45, 4.5], GM_L, 'metal'),
    // buffer tube + stock
    b([-0.5, 0.65, 3.5], [0.5, 1.65, 10], GM_D, 'metal'),
    b([-0.82, -0.9, 7.5], [0.82, 2.0, 11.4], POLY, 'polymer', true),
    b([-0.62, 2.0, 8.0], [0.62, 2.45, 11.0], POLY, 'polymer', true),
    b([-0.86, -1.3, 11.4], [0.86, 2.15, 12.1], RUB, 'rubber'),
    b([-0.3, -0.9, 8.2], [0.3, -0.55, 10.8], GM_D, 'metal'),
    // angled foregrip
    b([-0.45, -2.6, -12.4], [0.45, -0.2, -10.5], POLY, 'polymer'),
    b([-0.45, -1.3, -13.2], [0.45, -0.2, -12.4], POLY, 'polymer'),
    // sling swivel
    b([-0.15, -0.6, 10.6], [0.15, -0.2, 11.2], GM_L, 'metal'),
    ...redDot(-1.0, 2.75),
  ];
  const mag: VBox[] = [
    b([-0.55, -6.0, -4.6], [0.55, -1.5, -2.2], GM_D, 'metal'),
    b([-0.55, -8.4, -4.25], [0.55, -6.0, -1.7], GM_D, 'metal'),
    b([-0.62, -8.75, -4.35], [0.62, -8.4, -1.55], POLY, 'polymer'),
    b([-0.58, -5.6, -4.65], [0.58, -5.45, -2.15], GM_L, 'metal'),
    b([-0.25, -1.5, -4.1], [0.25, -1.2, -2.8], BRASS, 'gold'),
  ];
  return {
    body, mag,
    sight: [0, 4.22, -1.6], muzzle: [0, 0.9, -22.9], eject: [0.9, 1.3, 0],
    rightHand: [0, -2.4, 1.3], leftHand: [0, -1.4, -11.4], magGrab: [0, -7.6, -3.0],
    scope: false, hipOffset: [0, 0, 0], shell: 'rifle',
  };
}

// ------------------------------------------------------------------ AK
function volk(): WeaponModel {
  const BAK = 0x7a2f16;
  const body: VBox[] = [
    b([-0.75, -0.6, -5.5], [0.75, 1.6, 4], GM, 'metal'),
    b([-0.66, 1.6, -4.5], [0.66, 2.15, 3.9], GM, 'metal'),
    b([-0.5, 1.6, -7.6], [0.5, 2.6, -5.5], GM, 'metal'),
    b([-0.45, 2.6, -7.2], [0.45, 3.0, -6.2], GM_D, 'metal'),
    // wood handguards
    b([-0.92, -0.5, -14], [0.92, 1.05, -6], WOOD, 'wood', true),
    b([-0.66, 1.05, -13.5], [0.66, 2.0, -7.6], WOOD_L, 'wood', true),
    ...slots(0.92, 0.0, 0.4, -13.2, -6.6, 2.2, 1.2, 0x3a2414),
    // gas block + barrel
    b([-0.5, 0.45, -16], [0.5, 2.0, -14], GM, 'metal'),
    b([-0.3, 0.2, -23], [0.3, 0.8, -14], GM_D, 'metal'),
    b([-0.36, 0.8, -21.5], [0.36, 2.9, -20.6], GM, 'metal'),
    b([-0.55, 2.0, -21.5], [-0.36, 3.0, -20.6], GM, 'metal'),
    b([0.36, 2.0, -21.5], [0.55, 3.0, -20.6], GM, 'metal'),
    b([-0.09, 2.9, -21.2], [0.09, 3.15, -20.9], GM_D, 'metal'),
    b([-0.42, 0.08, -24.6], [0.42, 0.92, -23], GM_D, 'metal'),
    b([-0.43, 0.7, -24.4], [0.43, 0.93, -23.6], 0x08090a, 'metal'),
    // selector & charging handle
    b([0.75, 0.55, -3.2], [0.95, 0.9, 2.2], GM_L, 'metal'),
    b([0.75, 1.0, -2.2], [1.4, 1.5, -1.3], GM_L, 'metal'),
    b([-0.72, -1.2, -5.5], [0.72, -0.6, -2.8], GM, 'metal'),
    ...triggerGroup(-1.6, 0.6, -0.6),
    ...grip(0.6, -0.6, BAK, 0.56, 3, 'polymer'),
    // wooden stock
    b([-0.66, -1.3, 4], [0.66, 1.5, 8], WOOD, 'wood', true),
    b([-0.72, -2.6, 8], [0.72, 1.35, 12], WOOD, 'wood', true),
    b([-0.76, -2.8, 12], [0.76, 1.42, 12.6], GM, 'metal'),
    b([-0.73, -0.2, 9], [0.73, 0.1, 11.5], 0x5e3820, 'wood'),
  ];
  const mag: VBox[] = [
    b([-0.56, -4.0, -4.9], [0.56, -0.6, -2.0], BAK, 'polymer'),
    b([-0.56, -6.5, -5.9], [0.56, -4.0, -2.8], BAK, 'polymer'),
    b([-0.56, -8.6, -7.3], [0.56, -6.5, -4.0], BAK, 'polymer'),
    b([-0.6, -2.2, -5.0], [0.6, -2.0, -1.9], 0x5b230f, 'polymer'),
    b([-0.6, -4.6, -6.0], [0.6, -4.4, -2.7], 0x5b230f, 'polymer'),
  ];
  return {
    body, mag,
    sight: [0, 3.04, -6.7], muzzle: [0, 0.5, -24.8], eject: [0.85, 1.2, -0.5],
    rightHand: [0, -2.0, 1.4], leftHand: [0, -0.9, -10.5], magGrab: [0, -6.8, -4.8],
    scope: false, hipOffset: [0, 0, 0], shell: 'rifle',
  };
}

// ------------------------------------------------------------------ shotgun
function breacher(): WeaponModel {
  const body: VBox[] = [
    b([-0.8, -0.85, -5], [0.8, 1.5, 3], GM, 'metal', true),
    b([-0.45, 0.45, -26], [0.45, 1.4, -5], GM_D, 'metal'),
    b([-0.46, -0.6, -22.5], [0.46, 0.4, -5], GM, 'metal'),
    b([-0.5, -0.7, -23], [0.5, 0.5, -22.4], GM_L, 'metal'),
    b([-0.14, 1.4, -25.6], [0.14, 1.7, -25.1], 0xff6a2a, 'emissive'),
    ...rail(-3.5, 2.0, 1.5),
    b([-0.62, 2.1, 0.6], [-0.3, 2.95, 1.4], GM_D, 'metal'),
    b([0.3, 2.1, 0.6], [0.62, 2.95, 1.4], GM_D, 'metal'),
    b([-0.62, 2.75, 0.6], [0.62, 2.95, 1.4], GM_D, 'metal'),
    b([0.8, 0.15, -2.6], [0.9, 1.15, 0.6], 0x111214, 'metal'),
    // side saddle with shells
    b([0.8, -0.5, -4.2], [1.1, 1.0, -0.2], POLY, 'polymer'),
    ...[0, 1, 2, 3].map((i) => b([1.1, -0.35, -4.0 + i * 0.95], [1.5, 0.85, -3.3 + i * 0.95], 0xa3221c, 'polymer')),
    ...[0, 1, 2, 3].map((i) => b([1.1, -0.55, -4.0 + i * 0.95], [1.5, -0.35, -3.3 + i * 0.95], BRASS, 'gold')),
    ...triggerGroup(-1.6, 0.6, -0.85),
    ...grip(1.4, -0.85, RUB, 0.58, 3),
    b([-0.72, -1.9, 3], [0.72, 1.0, 9], POLY, 'polymer', true),
    b([-0.78, -3.0, 9], [0.78, 1.2, 13], POLY, 'polymer', true),
    b([-0.82, -3.2, 13], [0.82, 1.3, 13.8], RUB, 'rubber'),
  ];
  const pump: VBox[] = [
    b([-0.82, -1.05, -16], [0.82, 0.55, -9], POLY, 'polymer', true),
    ...[0, 1, 2, 3, 4, 5].map((i) => b([-0.88, -0.9, -15.6 + i * 1.1], [0.88, 0.45, -15.2 + i * 1.1], RUB, 'rubber')),
  ];
  return {
    body, pump,
    sight: [0, 2.6, 1.0], muzzle: [0, 0.95, -26.2], eject: [0.9, 0.7, -1.0],
    rightHand: [0, -2.0, 2.0], leftHand: [0, -0.9, -12.5], magGrab: [0.3, -1.5, -6],
    scope: false, hipOffset: [0, 0, 0], shell: 'shotgun',
  };
}

// ------------------------------------------------------------------ DMR
function arbiter(): WeaponModel {
  const body: VBox[] = [
    b([-0.7, -1.5, -5], [0.7, 0.5, 3], OLIVE_D, 'polymer', true),
    b([-0.76, 0.5, -6], [0.76, 2.2, 3.5], GM, 'metal', true),
    ...rail(-17.5, 3.2, 2.2),
    b([-0.95, -0.25, -18.5], [0.95, 2.2, -6], OLIVE, 'polymer', true),
    ...slots(0.95, 0.4, 1.2, -18, -6.6, 2.3, 1.6),
    ...slots(-0.95, 0.4, 1.2, -18, -6.6, 2.3, 1.6),
    b([-0.32, 0.6, -27], [0.32, 1.25, -18.5], GM_D, 'metal'),
    b([-0.6, 0.35, -29], [0.6, 1.5, -27], GM, 'metal'),
    ...slots(0.6, 0.55, 1.3, -28.8, -27.2, 0.6, 0.3, 0x08090a),
    b([0.76, 0.85, -1.6], [0.86, 1.75, 1.6], 0x141517, 'metal'),
    b([-0.72, -2.6, -5], [0.72, -1.4, -1.6], OLIVE_D, 'polymer', true),
    ...triggerGroup(-1.4, 0.7, -1.5),
    ...grip(0.6, -1.5, RUB, 0.6, 3),
    b([-0.62, 2.0, 3.5], [0.62, 2.45, 4.5], GM_L, 'metal'),
    // precision stock
    b([-0.5, 0.6, 3.5], [0.5, 1.7, 7], GM_D, 'metal'),
    b([-0.8, -1.8, 7], [0.8, 1.9, 13], OLIVE_D, 'polymer', true),
    b([-0.6, 1.9, 7.6], [0.6, 2.8, 12.4], OLIVE_D, 'polymer', true),
    b([-0.84, -2.1, 13], [0.84, 2.0, 13.7], RUB, 'rubber'),
    // folded bipod
    b([-0.75, -0.95, -17.6], [-0.45, -0.25, -9.5], GM_D, 'metal'),
    b([0.45, -0.95, -17.6], [0.75, -0.25, -9.5], GM_D, 'metal'),
    b([-0.6, -0.6, -18.2], [0.6, -0.2, -17.4], GM, 'metal'),
    ...scope(-8, 4.5, 3.9, 0.85, 0x23262a),
    b([-0.5, 2.6, -6.6], [0.5, 3.3, -5.4], GM_D, 'metal'),
    b([-0.5, 2.6, 1.4], [0.5, 3.3, 2.6], GM_D, 'metal'),
  ];
  const mag: VBox[] = [
    b([-0.58, -6.4, -4.6], [0.58, -1.5, -2.0], GM_D, 'metal'),
    b([-0.64, -6.8, -4.7], [0.64, -6.4, -1.9], POLY, 'polymer'),
  ];
  return {
    body, mag,
    sight: [0, 3.9, 4.6], muzzle: [0, 0.92, -29.2], eject: [0.9, 1.3, 0],
    rightHand: [0, -2.4, 1.3], leftHand: [0, -0.9, -13.5], magGrab: [0, -6.0, -3.3],
    scope: true, hipOffset: [0, 0, 0], shell: 'rifle',
  };
}

// ------------------------------------------------------------------ sniper
function longshot(): WeaponModel {
  const C = 0x5b6440; // chassis olive
  const body: VBox[] = [
    b([-1.0, -1.6, -16], [1.0, 1.0, -4], C, 'polymer', true),
    b([-1.0, -1.8, -4], [1.0, 1.0, 4], C, 'polymer', true),
    b([-0.72, 1.0, -4], [0.72, 1.95, 4], GM, 'metal'),
    b([-0.9, 1.0, 4], [0.9, 1.7, 8], C, 'polymer', true),
    b([-0.9, -3.7, 6.4], [0.9, -1.0, 13], C, 'polymer', true),
    b([-0.7, 1.7, 7.2], [0.7, 2.6, 12.2], C, 'polymer', true),
    b([-1.0, -3.9, 13], [1.0, 1.8, 13.8], RUB, 'rubber'),
    b([-0.9, -1.0, 8], [0.9, 1.0, 13], C, 'polymer', true),
    ...grip(2.2, -1.8, C, 0.62, 2, 'polymer', true),
    b([-0.62, -4.6, 3.0], [0.62, -3.6, 6.4], C, 'polymer', true),
    ...triggerGroup(-0.6, 1.8, -1.8),
    // barrel with flutes + brake
    b([-0.42, 0.55, -34], [0.42, 1.45, -16], GM_D, 'metal'),
    ...slots(0.42, 0.8, 1.15, -33.5, -16.5, 2.5, 2.0, 0x0a0b0c),
    ...slots(-0.42, 0.8, 1.15, -33.5, -16.5, 2.5, 2.0, 0x0a0b0c),
    b([-0.78, 0.25, -37], [0.78, 1.75, -34], GM, 'metal'),
    ...slots(0.78, 0.6, 1.4, -36.6, -34.4, 0.75, 0.4, 0x08090a),
    ...slots(-0.78, 0.6, 1.4, -36.6, -34.4, 0.75, 0.4, 0x08090a),
    // bipod
    b([-0.85, -1.9, -15.6], [-0.5, -1.2, -6], GM_D, 'metal'),
    b([0.5, -1.9, -15.6], [0.85, -1.2, -6], GM_D, 'metal'),
    // rail + scope
    ...rail(-9, 3.5, 1.95, 0.55),
    b([-0.62, 2.5, -7.4], [0.62, 3.6, -6.2], GM_D, 'metal'),
    b([-0.62, 2.5, 0.8], [0.62, 3.6, 2.0], GM_D, 'metal'),
    ...scope(-11, 6, 4.6, 1.05, 0x22262b),
    b([-1.05, -1.5, -15.9], [1.05, 1.0, -15.6], 0x2b2f20, 'polymer'),
  ];
  const mag: VBox[] = [
    b([-0.6, -3.7, -3.2], [0.6, -1.7, 0.6], GM_D, 'metal'),
    b([-0.66, -3.95, -3.3], [0.66, -3.7, 0.7], POLY, 'polymer'),
  ];
  const bolt: VBox[] = [
    b([0.72, 1.05, 0.6], [1.12, 1.6, 4.0], GM_L, 'metal'),
    b([1.12, 0.75, 3.0], [2.3, 1.25, 3.7], GM_L, 'metal'),
    b([2.2, 0.35, 2.75], [3.0, 1.15, 3.95], GM_D, 'metal'),
  ];
  return {
    body, mag, bolt,
    sight: [0, 4.6, 6.2], muzzle: [0, 1.0, -37.2], eject: [0.9, 1.4, 1.5],
    rightHand: [0, -2.8, 3.2], leftHand: [0, -1.8, -10.5], magGrab: [0, -3.2, -1.3],
    scope: true, hipOffset: [0, 0, 0], shell: 'rifle',
  };
}

// ------------------------------------------------------------------ launcher
function thumper(): WeaponModel {
  const T = 0x4f5a3a;
  const body: VBox[] = [
    b([-0.95, -0.95, -12], [0.95, 0.95, 14], T, 'metal', true),
    b([-0.7, -1.2, -12], [0.7, 1.2, 14], T, 'metal', true),
    b([-1.2, -1.25, -4.5], [1.2, 1.25, 4.5], WOOD, 'wood', true),
    b([-1.25, -1.0, -4.3], [1.25, 1.0, 4.3], WOOD_L, 'wood', true),
    // venturi
    b([-1.45, -1.45, 14], [1.45, 1.45, 17], GM, 'metal'),
    b([-1.1, -1.1, 16.95], [1.1, 1.1, 17.05], 0x050505, 'metal'),
    b([-1.1, -1.1, -12.1], [1.1, 1.1, -11.6], GM_D, 'metal'),
    // grips
    b([-0.5, -3.8, -1.6], [0.5, -0.95, 0], RUB, 'rubber'),
    b([-0.5, -3.4, -8.2], [0.5, -0.95, -6.6], RUB, 'rubber'),
    ...triggerGroup(-3.0, -1.4, -0.95),
    // sights + optic
    b([-0.22, 0.95, -10.2], [0.22, 2.5, -9.6], GM_D, 'metal'),
    b([-0.35, 0.95, 1.0], [0.35, 2.3, 1.6], GM_D, 'metal'),
    b([-0.08, 2.0, 1.0], [0.08, 2.3, 1.62], 0x000000, 'metal'),
    b([-2.8, 0.2, -1.4], [-1.2, 1.9, 3.4], GM_D, 'metal'),
    b([-2.6, 0.4, 3.4], [-1.4, 1.7, 3.5], GLASS, 'glass'),
    b([-1.2, 0.7, 0], [-0.95, 1.4, 2], GM, 'metal'),
    // hazard band
    b([-0.97, -0.97, 8], [0.97, 0.97, 8.6], 0xd8a520, 'polymer'),
  ];
  const rocket: VBox[] = [
    b([-1.35, -1.35, -17], [1.35, 1.35, -12], OLIVE_D, 'metal'),
    b([-1.05, -1.05, -19], [1.05, 1.05, -17], OLIVE_D, 'metal'),
    b([-0.65, -0.65, -21], [0.65, 0.65, -19], 0x6b6f4a, 'metal'),
    b([-0.28, -0.28, -22], [0.28, 0.28, -21], GM_L, 'metal'),
    b([-1.37, -1.37, -15], [1.37, 1.37, -14.5], 0xd8a520, 'polymer'),
  ];
  return {
    body, rocket,
    sight: [0, 2.2, 1.3], muzzle: [0, 0, -22], eject: [0, 0, 16],
    rightHand: [0, -2.6, -0.6], leftHand: [0, -2.4, -7.4], magGrab: [0, 0, -16],
    scope: false, hipOffset: [0.04, 0.02, 0], shell: 'none',
  };
}

export function weaponModel(id: WeaponId): WeaponModel {
  switch (id) {
    case 'p9':
      return p9();
    case 'hornet':
      return hornet();
    case 'ranger':
      return ranger();
    case 'volk':
      return volk();
    case 'breacher':
      return breacher();
    case 'arbiter':
      return arbiter();
    case 'longshot':
      return longshot();
    case 'thumper':
      return thumper();
  }
}

// ------------------------------------------------------------------ equipment
export function fragModel(): VBox[] {
  const O = 0x4a5530;
  const out: VBox[] = [
    b([-1.2, -1.4, -1.2], [1.2, 1.3, 1.2], O, 'polymer'),
    b([-1.35, -1.0, -1.0], [1.35, 0.9, 1.0], O, 'polymer'),
    b([-1.0, -1.0, -1.35], [1.0, 0.9, 1.35], O, 'polymer'),
    b([-0.5, 1.3, -0.5], [0.5, 2.1, 0.5], GM_L, 'metal'),
    b([0.45, 0.4, -0.3], [0.8, 2.0, 0.3], GM_L, 'metal'),
    b([-1.3, 1.8, -0.08], [-0.45, 2.5, 0.08], 0xb8b8b8, 'metal'),
  ];
  for (let i = 0; i < 3; i++) out.push(b([-1.37, -0.9 + i * 0.7, -1.02], [1.37, -0.75 + i * 0.7, 1.02], 0x343c22, 'polymer'));
  return out;
}

export function smokeModel(): VBox[] {
  return [
    b([-1.0, -1.9, -1.0], [1.0, 1.7, 1.0], 0x5c6660, 'metal'),
    b([-1.05, -0.4, -1.05], [1.05, 0.2, 1.05], 0xe8e8e8, 'polymer'),
    b([-0.6, 1.7, -0.6], [0.6, 2.3, 0.6], GM_L, 'metal'),
    b([0.5, 0.8, -0.3], [0.85, 2.2, 0.3], GM_L, 'metal'),
  ];
}

export function pickaxeModel(): VBox[] {
  const H = 0x6b4426;
  const S = 0x9aa4ad;
  const E = 0xff8a2a;
  return [
    b([-0.55, -12, -0.55], [0.55, 4.2, 0.55], H, 'wood'),
    b([-0.62, -12.6, -0.62], [0.62, -10.8, 0.62], RUB, 'rubber'),
    b([-0.6, -4, -0.6], [0.6, -3.4, 0.6], 0x3a2414, 'wood'),
    b([-0.8, 3.4, -2.2], [0.8, 6.6, 2.2], S, 'metal'),
    b([-0.7, 3.9, -5.0], [0.7, 6.1, -2.2], S, 'metal'),
    b([-0.6, 3.1, -7.6], [0.6, 5.3, -5.0], S, 'metal'),
    b([-0.5, 1.6, -9.6], [0.5, 3.6, -7.6], S, 'metal'),
    b([-0.4, 0.4, -10.6], [0.4, 1.9, -9.4], E, 'emissive'),
    b([-0.7, 3.9, 2.2], [0.7, 6.1, 5.0], S, 'metal'),
    b([-0.6, 3.1, 5.0], [0.6, 5.3, 7.6], S, 'metal'),
    b([-0.5, 1.6, 7.6], [0.5, 3.6, 9.6], S, 'metal'),
    b([-0.4, 0.4, 9.4], [0.4, 1.9, 10.6], E, 'emissive'),
    b([-0.85, 6.0, -1.2], [0.85, 6.9, 1.2], 0x5d6670, 'metal'),
  ];
}

export function hammerModel(): VBox[] {
  return [
    b([-0.55, -10, -0.55], [0.55, 3.5, 0.55], 0x8a5a30, 'wood'),
    b([-0.6, -10.5, -0.6], [0.6, -8.6, 0.6], 0x2a6ad8, 'rubber'),
    b([-1.0, 3.2, -3.4], [1.0, 5.6, 2.0], GM, 'metal'),
    b([-1.2, 3.0, -4.6], [1.2, 5.8, -3.2], GM_L, 'metal'),
    b([-0.6, 3.6, 2.0], [0.6, 5.2, 4.6], GM, 'metal'),
    b([-0.2, 3.6, 4.4], [0.2, 5.2, 5.0], GM_D, 'metal'),
  ];
}

export function bandageModel(): VBox[] {
  return [
    b([-1.6, -1.6, -1.5], [1.6, 1.6, 1.5], 0xe8e0d0, 'cloth'),
    b([-0.5, -0.5, -1.55], [0.5, 0.5, 1.55], 0xc8bca8, 'cloth'),
    b([-1.6, -1.65, -0.8], [1.6, -1.2, 2.6], 0xe8e0d0, 'cloth'),
    b([-0.25, -0.9, 1.5], [0.25, 0.9, 1.56], 0xd02a2a, 'cloth'),
    b([-0.9, -0.25, 1.5], [0.9, 0.25, 1.56], 0xd02a2a, 'cloth'),
  ];
}

export function medkitModel(): VBox[] {
  return [
    b([-3.0, -2.0, -1.6], [3.0, 2.0, 1.6], 0xeeeeee, 'polymer'),
    b([-3.05, -2.05, -0.2], [3.05, 2.05, 0.2], 0xc81e1e, 'polymer'),
    b([-0.45, -1.4, 1.6], [0.45, 1.4, 1.7], 0xd81e1e, 'polymer'),
    b([-1.4, -0.45, 1.6], [1.4, 0.45, 1.7], 0xd81e1e, 'polymer'),
    b([-1.2, 2.0, -0.5], [-0.8, 2.8, 0.5], GM_D, 'rubber'),
    b([0.8, 2.0, -0.5], [1.2, 2.8, 0.5], GM_D, 'rubber'),
    b([-1.2, 2.6, -0.5], [1.2, 3.0, 0.5], GM_D, 'rubber'),
  ];
}

export function plateModel(): VBox[] {
  return [
    b([-2.6, -3.6, -0.45], [2.6, 3.4, 0.45], 0x2c3a4c, 'polymer'),
    b([-2.2, 3.4, -0.45], [2.2, 3.9, 0.45], 0x2c3a4c, 'polymer'),
    b([-2.65, -3.65, -0.5], [2.65, -3.3, 0.5], 0x5ab0ff, 'emissive'),
    b([-1.6, -1.0, 0.45], [1.6, 1.6, 0.55], 0x435a74, 'polymer'),
  ];
}

export function ammoBoxModel(color: number): VBox[] {
  return [
    b([-3, -1.8, -2], [3, 1.6, 2], color, 'polymer'),
    b([-3.05, 0.6, -2.05], [3.05, 1.0, 2.05], 0x1a1a1a, 'polymer'),
    ...[-2, -1, 0, 1, 2].map((x) => b([x - 0.3, 1.6, -0.3], [x + 0.3, 2.4, 0.3], BRASS, 'gold')),
    ...[-2, -1, 0, 1, 2].map((x) => b([x - 0.2, 2.4, -0.2], [x + 0.2, 2.8, 0.2], 0xb06a3a, 'metal')),
  ];
}

export function vestModel(tier: number): VBox[] {
  const c = tier === 3 ? 0x2a2f38 : tier === 2 ? 0x4a5234 : 0x7a6a4a;
  const acc = tier === 3 ? 0xb779ff : tier === 2 ? 0x4aa8ff : 0xcfcfcf;
  return [
    b([-3.6, -4, -1.4], [3.6, 3.4, 1.4], c, 'cloth'),
    b([-3.6, 3.4, -1.4], [-1.6, 5, 1.4], c, 'cloth'),
    b([1.6, 3.4, -1.4], [3.6, 5, 1.4], c, 'cloth'),
    b([-2.6, -3, 1.4], [2.6, 2.4, 1.9], c, 'cloth'),
    ...[-2, 0, 2].map((x) => b([x - 0.8, -3.6, 1.4], [x + 0.8, -1.2, 2.3], 0x22252a, 'cloth')),
    b([-3.65, -4.05, -1.45], [3.65, -3.6, 1.45], acc, 'emissive'),
  ];
}

export function materialModel(color: number, accent: number): VBox[] {
  return [
    b([-2.5, -2.5, -2.5], [2.5, 2.5, 2.5], color, 'matte'),
    b([-2.55, 1.6, -2.55], [2.55, 2.0, 2.55], accent, 'matte'),
    b([-2.55, -2.0, -2.55], [2.55, -1.6, 2.55], accent, 'matte'),
  ];
}

// ------------------------------------------------------------------ building
export interface BuiltWeaponMeshes {
  group: THREE.Group;
  body: THREE.Mesh;
  mag: THREE.Mesh | null;
  slide: THREE.Mesh | null;
  bolt: THREE.Mesh | null;
  pump: THREE.Mesh | null;
  rocket: THREE.Mesh | null;
  model: WeaponModel;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export function cachedGeometry(key: string, boxes: VBox[], scale = 1 / 32): THREE.BufferGeometry {
  const k = `${key}@${scale}`;
  let g = geoCache.get(k);
  if (!g) {
    g = buildVoxelGeometry(boxes, scale);
    geoCache.set(k, g);
  }
  return g;
}

export function buildWeaponMeshes(id: WeaponId, material: THREE.Material, scale = 1 / 32): BuiltWeaponMeshes {
  const model = weaponModel(id);
  const group = new THREE.Group();
  const mk = (part: keyof ModelParts) => {
    const boxes = model[part];
    if (!boxes || !boxes.length) return null;
    const m = new THREE.Mesh(cachedGeometry(`${id}:${part}`, boxes, scale), material);
    group.add(m);
    return m;
  };
  const body = mk('body')!;
  return { group, body, mag: mk('mag'), slide: mk('slide'), bolt: mk('bolt'), pump: mk('pump'), rocket: mk('rocket'), model };
}

/** Merged single geometry (third-person / loot). */
export function weaponWorldGeometry(id: WeaponId, scale: number): THREE.BufferGeometry {
  const m = weaponModel(id);
  const boxes = [...m.body, ...(m.mag ?? []), ...(m.slide ?? []), ...(m.bolt ?? []), ...(m.pump ?? []), ...(m.rocket ?? [])];
  return cachedGeometry(`${id}:all`, boxes, scale);
}

/** Side-profile icon rendered from the actual model boxes. */
export function weaponIcon(id: WeaponId, w = 220, h = 90, tint?: string): HTMLCanvasElement {
  const m = weaponModel(id);
  const boxes = [...m.body, ...(m.mag ?? []), ...(m.slide ?? []), ...(m.bolt ?? []), ...(m.pump ?? []), ...(m.rocket ?? [])];
  return boxIcon(boxes, w, h, tint);
}

export function boxIcon(boxes: VBox[], w: number, h: number, tint?: string, view: 'side' | 'front' = 'side'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  const hz = (bx: VBox) => (view === 'side' ? [bx.min[2], bx.max[2]] : [bx.min[0], bx.max[0]]);
  for (const bx of boxes) {
    const [a, bb] = hz(bx);
    minZ = Math.min(minZ, a);
    maxZ = Math.max(maxZ, bb);
    minY = Math.min(minY, bx.min[1]);
    maxY = Math.max(maxY, bx.max[1]);
  }
  const pad = 6;
  const s = Math.min((w - pad * 2) / (maxZ - minZ), (h - pad * 2) / (maxY - minY));
  const ox = (w - (maxZ - minZ) * s) / 2;
  const oy = (h - (maxY - minY) * s) / 2;
  // draw far (negative x) to near (positive x) so the right side is on top
  const sorted = [...boxes].sort((a, bb) => (view === 'side' ? a.max[0] - bb.max[0] : a.max[2] - bb.max[2]));
  for (const bx of sorted) {
    const [a, bb] = hz(bx);
    const x0 = view === 'side' ? ox + (maxZ - bb) * s : ox + (a - minZ) * s;
    const x1 = view === 'side' ? ox + (maxZ - a) * s : ox + (bb - minZ) * s;
    const y0 = oy + (maxY - bx.max[1]) * s;
    const y1 = oy + (maxY - bx.min[1]) * s;
    let col = bx.color;
    if (tint && bx.camo) col = parseInt(tint.slice(1), 16);
    const r = (col >> 16) & 255, g = (col >> 8) & 255, bl = col & 255;
    const lift = (v: number) => Math.min(255, Math.round(v * 1.25 + 26));
    ctx.fillStyle = `rgb(${lift(r)},${lift(g)},${lift(bl)})`;
    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, Math.min(2, y1 - y0)));
  }
  return c;
}
