// Runtime audio: 3D positional playback (HRTF panning, distance filtering,
// near/far gunshot variants), ambience beds and generative menu music.

import * as THREE from 'three';
import { synthesizeAll, SR } from './synth';
import type { Settings } from '../core/settings';

export interface PlayOpts {
  pos?: THREE.Vector3;
  vol?: number;
  rate?: number;
  bus?: 'sfx' | 'ui' | 'music' | 'ambient';
  ref?: number;
  variant?: number;
  /** extra lowpass 0..1 (occlusion / underwater) */
  muffle?: number;
}

interface Voice {
  src: AudioBufferSourceNode;
  start: number;
  prio: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  buses: Record<string, GainNode> = {};
  buffers = new Map<string, AudioBuffer[]>();
  voices: Voice[] = [];
  listenerPos = new THREE.Vector3();
  ready = false;
  underwater = false;
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private musicTimer: number | null = null;
  private musicGain: GainNode | null = null;
  private settings: Settings | null = null;
  private lastPlay = new Map<string, number>();

  async init(settings: Settings) {
    this.settings = settings;
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    for (const b of ['sfx', 'ui', 'music', 'ambient']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    this.applyVolumes(settings);
    // synthesise (yield to the event loop between batches so loading stays responsive)
    await new Promise((r) => setTimeout(r, 0));
    const bank = synthesizeAll();
    for (const [name, list] of Object.entries(bank)) {
      this.buffers.set(
        name,
        list.map((data) => {
          const buf = ctx.createBuffer(1, data.length, SR);
          buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
          return buf;
        }),
      );
    }
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  applyVolumes(s: Settings) {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVol, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(s.sfxVol, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(s.sfxVol * 0.8, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.musicVol, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(s.ambientVol, t, 0.05);
  }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3) {
    this.listenerPos.copy(pos);
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      (l as any).setPosition(pos.x, pos.y, pos.z);
      (l as any).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  play(name: string, o: PlayOpts = {}): AudioBufferSourceNode | null {
    if (!this.ctx || !this.ready || this.ctx.state !== 'running') return null;
    const list = this.buffers.get(name);
    if (!list || !list.length) return null;
    // de-duplicate identical sounds fired in the same instant
    const nowMs = performance.now();
    const key = name + (o.pos ? `${Math.round(o.pos.x)},${Math.round(o.pos.z)}` : '');
    const last = this.lastPlay.get(key) ?? 0;
    if (nowMs - last < 18) return null;
    this.lastPlay.set(key, nowMs);

    const ctx = this.ctx;
    const buf = list[o.variant ?? Math.floor(Math.random() * list.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 1;
    let node: AudioNode = src;
    const muffle = Math.max(o.muffle ?? 0, this.underwater && o.bus !== 'ui' ? 0.85 : 0);
    if (o.pos) {
      const d = o.pos.distanceTo(this.listenerPos);
      const ref = o.ref ?? 4;
      const air = Math.min(1, d / 260);
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 20000 * Math.pow(1 - air * 0.85, 2) * (1 - muffle * 0.93) + 250;
      node.connect(lpf);
      node = lpf;
      const p = ctx.createPanner();
      p.panningModel = d < 70 ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.rolloffFactor = 1.0;
      p.maxDistance = 10000;
      if (p.positionX) {
        p.positionX.value = o.pos.x;
        p.positionY.value = o.pos.y;
        p.positionZ.value = o.pos.z;
      } else (p as any).setPosition(o.pos.x, o.pos.y, o.pos.z);
      node.connect(p);
      node = p;
    } else if (muffle > 0) {
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 20000 * (1 - muffle * 0.95) + 200;
      node.connect(lpf);
      node = lpf;
    }
    node.connect(g);
    g.connect(this.buses[o.bus ?? 'sfx']);
    src.start();
    const v: Voice = { src, start: ctx.currentTime, prio: o.vol ?? 1 };
    this.voices.push(v);
    src.onended = () => {
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
      try {
        g.disconnect();
      } catch {
        /* noop */
      }
    };
    if (this.voices.length > 56) {
      const old = this.voices.shift();
      try {
        old?.src.stop();
      } catch {
        /* noop */
      }
    }
    return src;
  }

  /** Gunshot picking near/far variants by distance. */
  gun(key: string, pos: THREE.Vector3 | null, vol = 1) {
    if (!pos) {
      this.play('gun_' + key, { vol: vol * 0.9 });
      return;
    }
    const d = pos.distanceTo(this.listenerPos);
    if (d < 55) this.play('gun_' + key, { pos, vol, ref: 6 });
    else this.play('gunfar_' + key, { pos, vol: vol * 1.4, ref: 30 });
  }

  ui(name: string, vol = 1) {
    this.play('ui_' + name, { bus: 'ui', vol });
  }

  // ------------------------------------------------------------ ambience
  setLoop(name: string, level: number, rate = 1) {
    if (!this.ctx || !this.ready) return;
    let l = this.loops.get(name);
    if (!l && level > 0.001) {
      const buf = this.buffers.get(name)?.[0];
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.buses.ambient);
      src.start(0, Math.random() * buf.duration);
      l = { src, gain };
      this.loops.set(name, l);
    }
    if (l) {
      l.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
      l.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.4);
    }
  }

  stopLoops() {
    if (!this.ctx) return;
    for (const l of this.loops.values()) l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  // ------------------------------------------------------------ music
  startMenuMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1800;
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    delay.connect(fb).connect(delay);
    this.musicGain.connect(filt).connect(this.buses.music);
    filt.connect(delay);
    delay.connect(this.buses.music);
    // Am  F  C  G  progression, voiced as MIDI notes
    const chords = [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [48, 55, 60, 64],
      [55, 59, 62, 67],
    ];
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    const barLen = 4.0;
    let next = ctx.currentTime + 0.2;
    let bar = 0;
    const out = this.musicGain;
    const schedule = () => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 1.2) {
        const ch = chords[bar % chords.length];
        // pad
        for (const n of ch) {
          for (const det of [-6, 5]) {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = mtof(n - 12);
            o.detune.value = det;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, next);
            g.gain.linearRampToValueAtTime(0.022, next + 1.2);
            g.gain.setTargetAtTime(0, next + barLen - 0.6, 0.5);
            const lf = ctx.createBiquadFilter();
            lf.type = 'lowpass';
            lf.frequency.value = 700;
            o.connect(lf).connect(g).connect(out);
            o.start(next);
            o.stop(next + barLen + 1.5);
          }
        }
        // bass
        {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = mtof(ch[0] - 24);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, next);
          g.gain.linearRampToValueAtTime(0.09, next + 0.05);
          g.gain.setTargetAtTime(0.0, next + 0.3, 1.2);
          o.connect(g).connect(out);
          o.start(next);
          o.stop(next + barLen);
        }
        // arpeggio
        const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
        for (let i = 0; i < 8; i++) {
          if (bar % 8 < 2 && i % 2) continue;
          const t = next + i * (barLen / 8);
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = mtof(ch[pattern[i]] + 12);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.035, t + 0.01);
          g.gain.setTargetAtTime(0, t + 0.02, 0.18);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + 1.2);
        }
        next += barLen;
        bar++;
      }
    };
    schedule();
    this.musicTimer = window.setInterval(schedule, 300);
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.musicGain && this.ctx) {
      const g = this.musicGain;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      setTimeout(() => {
        try {
          g.disconnect();
        } catch {
          /* noop */
        }
      }, 2500);
      this.musicGain = null;
    }
  }
}

export const audio = new AudioEngine();
