// Time of day + weather -> every lighting, sky, fog and grading uniform.

import * as THREE from 'three';
import { shared } from './shaderlib';
import type { PostFX } from './post';
import { clamp, lerp, smoothstep } from '../core/mathx';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';

interface Key {
  e: number;
  zenith: number[];
  horizon: number[];
  ground: number[];
  glow: number[];
  light: number[];
  ambSky: number[];
  ambGround: number[];
  fog: number;
  exposure: number;
  tint: number[];
}

const KEYS: Key[] = [
  { e: -1.0, zenith: [0.006, 0.01, 0.028], horizon: [0.016, 0.025, 0.05], ground: [0.006, 0.008, 0.012], glow: [0.02, 0.03, 0.06], light: [0.16, 0.2, 0.32], ambSky: [0.05, 0.07, 0.13], ambGround: [0.02, 0.022, 0.03], fog: 0.0031, exposure: 1.9, tint: [0.92, 0.96, 1.08] },
  { e: -0.22, zenith: [0.008, 0.014, 0.04], horizon: [0.03, 0.04, 0.08], ground: [0.008, 0.01, 0.016], glow: [0.05, 0.05, 0.1], light: [0.16, 0.2, 0.32], ambSky: [0.055, 0.075, 0.14], ambGround: [0.02, 0.022, 0.03], fog: 0.0031, exposure: 1.85, tint: [0.92, 0.96, 1.08] },
  { e: -0.07, zenith: [0.05, 0.07, 0.17], horizon: [0.38, 0.22, 0.2], ground: [0.04, 0.04, 0.05], glow: [0.7, 0.28, 0.12], light: [0.0, 0.0, 0.0], ambSky: [0.12, 0.12, 0.2], ambGround: [0.05, 0.045, 0.05], fog: 0.0042, exposure: 1.6, tint: [1.0, 0.95, 1.02] },
  { e: 0.02, zenith: [0.16, 0.25, 0.5], horizon: [1.0, 0.55, 0.3], ground: [0.12, 0.1, 0.1], glow: [1.6, 0.7, 0.25], light: [1.6, 0.75, 0.32], ambSky: [0.3, 0.3, 0.42], ambGround: [0.12, 0.09, 0.08], fog: 0.0043, exposure: 1.25, tint: [1.06, 0.97, 0.9] },
  { e: 0.12, zenith: [0.22, 0.38, 0.72], horizon: [1.0, 0.78, 0.55], ground: [0.2, 0.18, 0.16], glow: [1.3, 0.85, 0.45], light: [2.6, 1.75, 1.0], ambSky: [0.42, 0.46, 0.62], ambGround: [0.18, 0.15, 0.12], fog: 0.0036, exposure: 1.05, tint: [1.04, 0.99, 0.94] },
  { e: 0.35, zenith: [0.2, 0.42, 0.85], horizon: [0.72, 0.82, 0.94], ground: [0.26, 0.25, 0.24], glow: [0.9, 0.78, 0.6], light: [3.2, 2.8, 2.3], ambSky: [0.5, 0.6, 0.82], ambGround: [0.24, 0.21, 0.17], fog: 0.0029, exposure: 0.95, tint: [1.01, 1.0, 0.98] },
  { e: 1.0, zenith: [0.16, 0.38, 0.86], horizon: [0.62, 0.77, 0.93], ground: [0.28, 0.27, 0.26], glow: [0.75, 0.7, 0.6], light: [3.5, 3.25, 2.95], ambSky: [0.52, 0.64, 0.88], ambGround: [0.26, 0.23, 0.19], fog: 0.0028, exposure: 0.92, tint: [1.0, 1.0, 1.0] },
];

function lerpArr(a: number[], b: number[], t: number, out: THREE.Color) {
  out.setRGB(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}

export class Atmosphere {
  /** hours 0..24 */
  time = 15.5;
  /** game-hours per real second */
  timeScale = 0;
  weather: Weather = 'clear';
  /** smoothed weather intensities */
  rain = 0;
  overcast = 0;
  snow = 0;
  lightning = 0;
  private nextLightning = 8;
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  lightDir = new THREE.Vector3();
  private lastLightDir = new THREE.Vector3(0, 1, 0);
  sunVisible = 0;
  onThunder: ((delay: number, intensity: number) => void) | null = null;
  cloudBase = 0.4;

  setWeather(w: Weather, instant = false) {
    this.weather = w;
    if (instant) {
      const t = this.targets();
      this.rain = t.rain;
      this.overcast = t.overcast;
      this.snow = t.snow;
    }
  }

  private targets() {
    switch (this.weather) {
      case 'clear':
        return { rain: 0, overcast: 0, snow: 0 };
      case 'cloudy':
        return { rain: 0, overcast: 0.55, snow: 0 };
      case 'rain':
        return { rain: 0.85, overcast: 0.85, snow: 0 };
      case 'storm':
        return { rain: 1, overcast: 1, snow: 0 };
      case 'snow':
        return { rain: 0, overcast: 0.7, snow: 1 };
    }
  }

  update(dt: number, post: PostFX | null) {
    this.time = (this.time + dt * this.timeScale + 24) % 24;
    const t = this.targets();
    const k = 1 - Math.exp(-dt * 0.25);
    this.rain += (t.rain - this.rain) * k;
    this.overcast += (t.overcast - this.overcast) * k;
    this.snow += (t.snow - this.snow) * k;

    // sun path
    const theta = ((this.time - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(theta), Math.sin(theta), 0.38).normalize();
    this.moonDir.copy(this.sunDir).negate();
    this.moonDir.z = Math.abs(this.moonDir.z) * -1;
    this.moonDir.normalize();
    const e = this.sunDir.y;

    // keyframe interpolation
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const f = clamp((e - a.e) / (b.e - a.e), 0, 1);
    const u = shared;
    lerpArr(a.zenith, b.zenith, f, u.uSkyZenith.value);
    lerpArr(a.horizon, b.horizon, f, u.uSkyHorizon.value);
    lerpArr(a.ground, b.ground, f, u.uSkyGround.value);
    lerpArr(a.glow, b.glow, f, u.uSunGlow.value);
    lerpArr(a.light, b.light, f, u.uLightColor.value);
    lerpArr(a.ambSky, b.ambSky, f, u.uAmbientSky.value);
    lerpArr(a.ambGround, b.ambGround, f, u.uAmbientGround.value);
    let fog = lerp(a.fog, b.fog, f);
    let exposure = lerp(a.exposure, b.exposure, f);
    const tint = new THREE.Color();
    lerpArr(a.tint, b.tint, f, tint);

    // main light: sun by day, moon by night (crossfade through zero at horizon)
    const night = smoothstep(0.02, -0.12, e);
    u.uNight.value = night;
    let target: THREE.Vector3;
    if (e > -0.07) target = this.sunDir;
    else {
      target = this.moonDir;
      // moonlight ramps in after dusk
      const m = smoothstep(-0.07, -0.2, e);
      u.uLightColor.value.setRGB(0.16 * m, 0.2 * m, 0.32 * m);
    }
    // keep light above horizon for sane shadows
    const ld = target.clone();
    if (ld.y < 0.12) {
      ld.y = 0.12;
      ld.normalize();
    }
    // quantise direction changes to keep shadow maps stable
    if (ld.angleTo(this.lastLightDir) > 0.0015) this.lastLightDir.copy(ld);
    this.lightDir.copy(this.lastLightDir);
    u.uLightDir.value.copy(this.lightDir);
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);

    // weather
    const oc = this.overcast;
    const grey = new THREE.Color(0.4, 0.43, 0.48).multiplyScalar(lerp(1, 0.08, night));
    u.uSkyZenith.value.lerp(grey.clone().multiplyScalar(0.9), oc * 0.75);
    u.uSkyHorizon.value.lerp(grey, oc * 0.7);
    u.uSunGlow.value.multiplyScalar(1 - oc * 0.75);
    u.uLightColor.value.multiplyScalar(1 - oc * 0.62);
    u.uAmbientSky.value.lerp(grey.clone().multiplyScalar(1.15), oc * 0.45);
    fog *= 1 + oc * 0.8 + this.rain * 1.8 + this.snow * 2.2;
    exposure *= 1 + oc * 0.12;
    u.uFogDensity.value = fog;
    u.uCloudCover.value = clamp(this.cloudBase + oc * 0.6, 0, 1);
    u.uWetness.value = clamp(this.rain * 1.1, 0, 1);
    u.uWindStrength.value = 1 + this.rain * 1.2 + oc * 0.5;

    // lightning in storms
    if (this.weather === 'storm' && this.rain > 0.6) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.lightning = 1;
        this.nextLightning = 6 + Math.random() * 14;
        const delay = 0.4 + Math.random() * 2.5;
        this.onThunder?.(delay, 1 - delay / 3.5);
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    const flick = this.lightning > 0 ? this.lightning * (0.6 + 0.4 * Math.sin(this.lightning * 60)) : 0;
    u.uLightning.value = flick;
    if (flick > 0) u.uAmbientSky.value.addScalar(flick * 0.9);

    this.sunVisible = smoothstep(-0.02, 0.08, e) * (1 - oc * 0.9);

    if (post) {
      const pu = post.uniforms;
      pu.uExposure.value = exposure;
      pu.uTint.value.copy(tint);
      pu.uGodColor.value.copy(u.uSunGlow.value).multiplyScalar(0.6).add(new THREE.Color(0.25, 0.22, 0.18));
      pu.uSaturation.value = lerp(1.1, 0.88, oc) * lerp(1, 0.8, night);
    }
  }
}
