// Offline DSP: every sound in the game is synthesised here into AudioBuffers.

export const SR = 44100;

type Buf = Float32Array;

function mk(sec: number): Buf {
  return new Float32Array(Math.max(1, Math.floor(sec * SR)));
}

let seed = 12345;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function noise() {
  return rnd() * 2 - 1;
}

/** one-pole lowpass in place */
function lp(b: Buf, cutoff: number | ((t: number) => number)) {
  let y = 0;
  for (let i = 0; i < b.length; i++) {
    const fc = typeof cutoff === 'number' ? cutoff : cutoff(i / SR);
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    y += a * (b[i] - y);
    b[i] = y;
  }
  return b;
}
function hp(b: Buf, cutoff: number) {
  let y = 0;
  let x1 = 0;
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = rc / (rc + 1 / SR);
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    y = a * (y + x - x1);
    x1 = x;
    b[i] = y;
  }
  return b;
}
/** resonant bandpass (biquad) */
function bp(b: Buf, f: number, q: number) {
  const w0 = (2 * Math.PI * f) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    b[i] = y;
  }
  return b;
}
function env(b: Buf, attack: number, decay: number, curve = 1) {
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const a = attack > 0 ? Math.min(1, t / attack) : 1;
    const d = Math.exp(-Math.max(0, t - attack) / decay);
    b[i] *= a * Math.pow(d, curve);
  }
  return b;
}
function gain(b: Buf, g: number) {
  for (let i = 0; i < b.length; i++) b[i] *= g;
  return b;
}
function add(dst: Buf, src: Buf, g = 1, offset = 0) {
  const o = Math.floor(offset * SR);
  for (let i = 0; i < src.length && i + o < dst.length; i++) dst[i + o] += src[i] * g;
  return dst;
}
function noiseBuf(sec: number) {
  const b = mk(sec);
  for (let i = 0; i < b.length; i++) b[i] = noise();
  return b;
}
function brown(sec: number) {
  const b = mk(sec);
  let v = 0;
  for (let i = 0; i < b.length; i++) {
    v = (v + noise() * 0.02) * 0.998;
    b[i] = v * 3.5;
  }
  return b;
}
function sine(sec: number, f: number | ((t: number) => number), phase = 0) {
  const b = mk(sec);
  let ph = phase;
  for (let i = 0; i < b.length; i++) {
    const fr = typeof f === 'number' ? f : f(i / SR);
    ph += (2 * Math.PI * fr) / SR;
    b[i] = Math.sin(ph);
  }
  return b;
}
function saw(sec: number, f: number) {
  const b = mk(sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    ph += f / SR;
    b[i] = 2 * (ph - Math.floor(ph + 0.5));
  }
  return b;
}
function softclip(b: Buf, drive = 1.5) {
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / Math.tanh(drive);
  return b;
}
function normalize(b: Buf, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  if (m > 0) gain(b, peak / m);
  return b;
}
function fadeOut(b: Buf, sec = 0.01) {
  const n = Math.floor(sec * SR);
  for (let i = 0; i < n && i < b.length; i++) b[b.length - 1 - i] *= i / n;
  return b;
}
/** cheap reverb tail: sum of decaying filtered noise taps */
function reverbTail(len: number, decay: number, bright: number) {
  const b = noiseBuf(len);
  lp(b, (t) => bright * Math.exp(-t * 2.2) + 300);
  env(b, 0.005, decay);
  return b;
}
function click(sec: number, f: number, q: number, dec: number) {
  const b = noiseBuf(sec);
  env(b, 0, 0.0015);
  bp(b, f, q);
  env(b, 0, dec);
  return normalize(b, 0.8);
}

// ---------------------------------------------------------------- gunshots
interface GunP {
  body: number; // body noise decay
  bright: number; // lowpass of body
  thump: number; // low sine strength
  thumpF: number;
  tail: number; // reverb length
  crack: number; // supersonic crack strength
  len: number;
}
const GUNS: Record<string, GunP> = {
  pistol: { body: 0.028, bright: 5200, thump: 0.6, thumpF: 150, tail: 0.45, crack: 0.5, len: 0.6 },
  smg: { body: 0.022, bright: 6000, thump: 0.45, thumpF: 170, tail: 0.35, crack: 0.45, len: 0.45 },
  rifle: { body: 0.032, bright: 6500, thump: 0.7, thumpF: 120, tail: 0.6, crack: 0.8, len: 0.75 },
  rifle_heavy: { body: 0.04, bright: 5000, thump: 0.9, thumpF: 100, tail: 0.7, crack: 0.85, len: 0.85 },
  shotgun: { body: 0.07, bright: 3800, thump: 1.2, thumpF: 85, tail: 0.9, crack: 0.4, len: 1.1 },
  dmr: { body: 0.045, bright: 6200, thump: 1.0, thumpF: 95, tail: 0.9, crack: 1.0, len: 1.0 },
  sniper: { body: 0.06, bright: 5800, thump: 1.35, thumpF: 70, tail: 1.4, crack: 1.2, len: 1.6 },
  launcher: { body: 0.12, bright: 2200, thump: 1.1, thumpF: 60, tail: 0.9, crack: 0, len: 1.2 },
};

function gunshot(p: GunP, variant: number, far: boolean): Buf {
  seed = 1000 + variant * 77 + Math.floor(p.bright);
  const out = mk(far ? p.len * 1.6 : p.len);
  if (!far) {
    // transient
    const tr = noiseBuf(0.006);
    hp(tr, 2500);
    env(tr, 0, 0.0012);
    add(out, tr, 0.9 * (0.5 + p.crack * 0.5));
    // body
    const body = noiseBuf(p.body * 6);
    lp(body, (t) => p.bright * Math.exp(-t * 18) + 600);
    env(body, 0.0005, p.body);
    add(out, softclip(body, 2.2), 1.0);
    // thump
    const th = sine(0.25, (t) => p.thumpF * (1 + 1.2 * Math.exp(-t * 40)));
    env(th, 0.001, 0.05);
    add(out, th, p.thump * 0.9);
    // tail
    const tail = reverbTail(p.tail, p.tail * 0.32, 2400);
    add(out, tail, 0.25, 0.01);
    // mechanical clack
    const m = click(0.03, 2800 + variant * 300, 6, 0.008);
    add(out, m, 0.06, 0.06);
  } else {
    const crack = noiseBuf(0.02);
    hp(crack, 1800);
    env(crack, 0, 0.003);
    add(out, crack, 0.35 * p.crack);
    const body = noiseBuf(0.3);
    lp(body, 900);
    env(body, 0.004, p.body * 2.2);
    add(out, body, 1.2, 0.02);
    const th = sine(0.4, p.thumpF * 0.8);
    env(th, 0.01, 0.12);
    add(out, th, p.thump * 0.6, 0.02);
    const tail = reverbTail(p.len * 1.4, p.tail * 0.55, 900);
    add(out, tail, 0.55, 0.03);
  }
  fadeOut(out, 0.05);
  return normalize(out, far ? 0.7 : 0.95);
}

function explosion(far: boolean): Buf {
  seed = far ? 991 : 990;
  const out = mk(far ? 3.2 : 2.6);
  const boom = sine(1.4, (t) => 55 + 90 * Math.exp(-t * 9));
  env(boom, 0.002, 0.35);
  add(out, softclip(boom, 2), 1.0);
  const n = brown(2.5);
  lp(n, (t) => (far ? 500 : 2500) * Math.exp(-t * 3) + 120);
  env(n, 0.003, far ? 0.8 : 0.55);
  add(out, n, 1.3);
  if (!far) {
    const cr = noiseBuf(1.5);
    for (let i = 0; i < cr.length; i++) cr[i] *= rnd() > 0.995 ? 1 : 0.02;
    hp(cr, 1200);
    env(cr, 0.05, 0.4);
    add(out, cr, 0.6, 0.05);
    const tr = noiseBuf(0.01);
    env(tr, 0, 0.002);
    add(out, tr, 0.8);
  }
  fadeOut(out, 0.2);
  return normalize(out, 0.95);
}

// ---------------------------------------------------------------- foley
function footstep(surface: string, v: number): Buf {
  seed = 200 + v * 31 + surface.length * 7;
  const out = mk(0.22);
  switch (surface) {
    case 'grass': {
      const n = noiseBuf(0.16);
      hp(n, 1400);
      lp(n, 5000);
      for (let i = 0; i < n.length; i++) n[i] *= 0.4 + rnd() * 0.6;
      env(n, 0.008, 0.04);
      add(out, n, 0.7);
      break;
    }
    case 'dirt':
    case 'gravel': {
      const n = noiseBuf(0.16);
      lp(n, surface === 'gravel' ? 3500 : 1800);
      for (let i = 0; i < n.length; i++) n[i] *= rnd() > 0.92 ? 1.6 : 0.5;
      env(n, 0.004, 0.035);
      add(out, n, 0.8);
      break;
    }
    case 'sand':
    case 'snow': {
      const n = noiseBuf(0.2);
      lp(n, surface === 'snow' ? 2200 : 1500);
      env(n, 0.02, 0.05);
      add(out, n, 0.7);
      break;
    }
    case 'wood': {
      const n = click(0.15, 260 + v * 30, 4, 0.04);
      add(out, n, 0.8);
      const c = click(0.05, 1800, 3, 0.006);
      add(out, c, 0.3);
      break;
    }
    case 'metal': {
      const c = click(0.2, 900 + v * 120, 18, 0.06);
      add(out, c, 0.5);
      const c2 = click(0.2, 2300 + v * 200, 20, 0.04);
      add(out, c2, 0.3);
      break;
    }
    case 'water': {
      const n = noiseBuf(0.22);
      bp(n, 700 + v * 100, 1.2);
      env(n, 0.01, 0.06);
      add(out, n, 1.0);
      break;
    }
    case 'leaves': {
      const n = noiseBuf(0.2);
      hp(n, 2500);
      for (let i = 0; i < n.length; i++) n[i] *= rnd();
      env(n, 0.01, 0.06);
      add(out, n, 0.6);
      break;
    }
    default: {
      // stone
      const c = click(0.1, 1300 + v * 150, 2.5, 0.012);
      add(out, c, 0.9);
      const n = noiseBuf(0.06);
      hp(n, 3000);
      env(n, 0, 0.01);
      add(out, n, 0.25);
    }
  }
  fadeOut(out);
  return normalize(out, 0.6);
}

function impact(kind: string, v: number): Buf {
  seed = 400 + v * 13 + kind.length * 101;
  const out = mk(0.3);
  if (kind === 'flesh') {
    const n = noiseBuf(0.1);
    lp(n, 900);
    env(n, 0.001, 0.025);
    add(out, n, 1);
    const th = sine(0.08, 110);
    env(th, 0, 0.02);
    add(out, th, 0.6);
  } else if (kind === 'armor') {
    add(out, click(0.25, 2400 + v * 300, 25, 0.07), 0.6);
    add(out, click(0.25, 4100 + v * 200, 30, 0.05), 0.4);
    const n = noiseBuf(0.05);
    hp(n, 3000);
    env(n, 0, 0.006);
    add(out, n, 0.5);
  } else if (kind === 'metal') {
    add(out, click(0.3, 1700 + v * 250, 30, 0.09), 0.6);
    add(out, click(0.3, 3300 + v * 300, 25, 0.06), 0.4);
  } else if (kind === 'wood') {
    add(out, click(0.15, 500 + v * 80, 3, 0.03), 0.9);
    const n = noiseBuf(0.08);
    bp(n, 2200, 1);
    env(n, 0, 0.01);
    add(out, n, 0.5);
  } else if (kind === 'glass') {
    for (let k = 0; k < 9; k++) add(out, click(0.25, 3000 + rnd() * 5000, 30, 0.04 + rnd() * 0.06), 0.25, rnd() * 0.12);
  } else {
    // stone / dirt
    const n = noiseBuf(0.12);
    lp(n, kind === 'dirt' ? 1600 : 4500);
    env(n, 0, kind === 'dirt' ? 0.03 : 0.014);
    add(out, n, 1);
    add(out, click(0.06, 2600 + v * 200, 4, 0.006), 0.4);
  }
  fadeOut(out);
  return normalize(out, 0.7);
}

function mech(kind: string): Buf {
  seed = 700 + kind.length * 17;
  switch (kind) {
    case 'mag_out': {
      const out = mk(0.25);
      add(out, click(0.08, 2400, 5, 0.01), 0.7);
      const s = noiseBuf(0.12);
      bp(s, 1800, 2);
      env(s, 0.02, 0.03);
      add(out, s, 0.3, 0.02);
      return normalize(out, 0.6);
    }
    case 'mag_in': {
      const out = mk(0.25);
      add(out, click(0.08, 1500, 4, 0.012), 0.8);
      add(out, click(0.08, 3200, 6, 0.008), 0.6, 0.05);
      return normalize(out, 0.7);
    }
    case 'bolt_rack': {
      const out = mk(0.4);
      add(out, click(0.1, 2000, 6, 0.012), 0.6);
      const s = noiseBuf(0.1);
      bp(s, 2600, 3);
      env(s, 0.01, 0.03);
      add(out, s, 0.4, 0.03);
      add(out, click(0.1, 1600, 5, 0.014), 0.9, 0.16);
      return normalize(out, 0.7);
    }
    case 'bolt_cycle': {
      const out = mk(0.7);
      add(out, click(0.08, 1400, 6, 0.012), 0.6);
      add(out, click(0.08, 2400, 6, 0.01), 0.7, 0.18);
      add(out, click(0.08, 2600, 6, 0.01), 0.7, 0.36);
      add(out, click(0.08, 1300, 6, 0.014), 0.8, 0.52);
      return normalize(out, 0.7);
    }
    case 'pump': {
      const out = mk(0.55);
      add(out, click(0.1, 900, 3, 0.02), 0.9);
      const s = noiseBuf(0.1);
      bp(s, 1500, 2);
      env(s, 0.01, 0.03);
      add(out, s, 0.4, 0.04);
      add(out, click(0.1, 1100, 3, 0.02), 1.0, 0.24);
      return normalize(out, 0.75);
    }
    case 'shell_in': {
      const out = mk(0.2);
      add(out, click(0.08, 1900, 5, 0.01), 0.7);
      add(out, click(0.08, 1200, 4, 0.012), 0.5, 0.04);
      return normalize(out, 0.55);
    }
    case 'rocket_load': {
      const out = mk(0.6);
      const s = noiseBuf(0.4);
      bp(s, 700, 1.5);
      env(s, 0.05, 0.12);
      add(out, s, 0.6);
      add(out, click(0.1, 800, 3, 0.03), 1, 0.38);
      return normalize(out, 0.7);
    }
    case 'equip': {
      const out = mk(0.25);
      const s = noiseBuf(0.15);
      bp(s, 1200, 1.2);
      env(s, 0.03, 0.04);
      add(out, s, 0.6);
      add(out, click(0.05, 2200, 5, 0.008), 0.4, 0.1);
      return normalize(out, 0.45);
    }
    case 'dry_fire':
      return normalize(click(0.08, 3000, 8, 0.006), 0.5);
    case 'scope_in': {
      const out = mk(0.2);
      const s = noiseBuf(0.15);
      bp(s, 900, 2);
      env(s, 0.04, 0.03);
      add(out, s, 0.5);
      return normalize(out, 0.35);
    }
    case 'pin_pull': {
      const out = mk(0.35);
      add(out, click(0.2, 3400, 25, 0.05), 0.6);
      add(out, click(0.2, 2100, 20, 0.04), 0.4, 0.12);
      return normalize(out, 0.5);
    }
    case 'throw': {
      const s = noiseBuf(0.3);
      bp(s, 600, 0.8);
      env(s, 0.06, 0.05);
      return normalize(s, 0.5);
    }
    case 'bounce':
      return normalize(click(0.15, 1600, 12, 0.03), 0.5);
    case 'smoke_hiss': {
      const s = noiseBuf(3);
      hp(s, 2000);
      env(s, 0.1, 1.2);
      return normalize(s, 0.4);
    }
    default:
      return normalize(click(0.1, 1500, 4, 0.01), 0.5);
  }
}

function tone(freqs: number[], dur: number, type: 'sine' | 'tri' = 'sine', decay = 0.15, step = 0.06): Buf {
  const out = mk(dur + step * freqs.length + 0.2);
  freqs.forEach((f, i) => {
    const s = sine(dur, f);
    if (type === 'tri') {
      const h = sine(dur, f * 3);
      add(s, h, 0.12);
    }
    env(s, 0.004, decay);
    add(out, s, 0.5, i * step);
  });
  fadeOut(out, 0.03);
  return normalize(out, 0.5);
}

function ui(kind: string): Buf {
  switch (kind) {
    case 'hover':
      return gain(tone([1800], 0.05, 'sine', 0.012), 0.25);
    case 'click':
      return gain(tone([1200, 1800], 0.06, 'tri', 0.02, 0.02), 0.5);
    case 'confirm':
      return tone([660, 880, 1320], 0.18, 'tri', 0.08, 0.05);
    case 'back':
      return tone([880, 660], 0.12, 'tri', 0.05, 0.05);
    case 'hitmarker':
      return gain(click(0.06, 4200, 10, 0.012), 0.7);
    case 'headshot': {
      const out = mk(0.3);
      add(out, click(0.15, 5200, 25, 0.04), 0.7);
      add(out, click(0.15, 2600, 18, 0.05), 0.5);
      return normalize(out, 0.6);
    }
    case 'kill':
      return tone([1046, 1568], 0.22, 'tri', 0.12, 0.06);
    case 'pickup':
      return tone([880, 1320], 0.08, 'tri', 0.03, 0.04);
    case 'craft':
      return tone([523, 784, 1046], 0.12, 'tri', 0.05, 0.05);
    case 'reward':
      return tone([523, 659, 784, 1046, 1318], 0.3, 'tri', 0.2, 0.07);
    case 'levelup':
      return tone([392, 523, 659, 784, 1046], 0.4, 'tri', 0.3, 0.09);
    case 'rankup':
      return tone([261, 392, 523, 659, 784, 1046, 1568], 0.5, 'tri', 0.4, 0.1);
    case 'rankdown':
      return tone([659, 523, 392, 330], 0.35, 'sine', 0.25, 0.12);
    case 'countdown':
      return tone([880], 0.12, 'sine', 0.06);
    case 'go':
      return tone([1320, 1760], 0.25, 'tri', 0.12, 0.03);
    case 'zone':
      return tone([440, 415, 392], 0.35, 'sine', 0.2, 0.18);
    case 'quest':
      return tone([784, 988, 1175], 0.2, 'tri', 0.12, 0.06);
    case 'victory':
      return tone([392, 494, 587, 784, 988, 1175], 0.6, 'tri', 0.5, 0.12);
    case 'defeat':
      return tone([440, 392, 349, 294], 0.6, 'sine', 0.45, 0.2);
    case 'deny':
      return tone([220, 196], 0.1, 'tri', 0.05, 0.06);
    default:
      return tone([1000], 0.05);
  }
}

function build(kind: string, v: number): Buf {
  seed = 900 + v * 11 + kind.length * 3;
  const out = mk(0.6);
  if (kind === 'place') {
    add(out, click(0.2, 320 + v * 40, 3, 0.04), 0.9);
    add(out, click(0.1, 1800, 4, 0.01), 0.4, 0.01);
  } else if (kind === 'break_wood') {
    for (let k = 0; k < 5; k++) add(out, click(0.2, 400 + rnd() * 600, 3, 0.03), 0.4, rnd() * 0.12);
    const n = noiseBuf(0.3);
    lp(n, 2500);
    env(n, 0.005, 0.07);
    add(out, n, 0.5);
  } else if (kind === 'break_stone') {
    const n = noiseBuf(0.45);
    lp(n, 3000);
    env(n, 0.003, 0.09);
    add(out, n, 0.9);
    for (let k = 0; k < 6; k++) add(out, click(0.1, 1500 + rnd() * 2500, 4, 0.01), 0.3, rnd() * 0.2);
  } else if (kind === 'break_metal') {
    add(out, click(0.5, 600 + v * 50, 20, 0.15), 0.6);
    add(out, click(0.5, 1300, 25, 0.12), 0.4, 0.02);
    const n = noiseBuf(0.3);
    hp(n, 2000);
    env(n, 0, 0.05);
    add(out, n, 0.5);
  } else if (kind === 'swing') {
    const n = noiseBuf(0.25);
    bp(n, 500 + v * 80, 0.9);
    env(n, 0.06, 0.05);
    add(out, n, 0.6);
  } else if (kind === 'chop') {
    add(out, click(0.25, 380 + v * 60, 3, 0.05), 1);
    add(out, click(0.1, 2000, 3, 0.01), 0.4);
  } else if (kind === 'chip') {
    add(out, click(0.15, 2200 + v * 300, 6, 0.015), 1);
    add(out, click(0.15, 3800, 8, 0.01), 0.5, 0.005);
  } else if (kind === 'tree_fall') {
    for (let k = 0; k < 10; k++) add(out, click(0.3, 200 + rnd() * 400, 2, 0.06), 0.35, rnd() * 0.5);
    const n = noiseBuf(0.6);
    hp(n, 1500);
    env(n, 0.05, 0.2);
    add(out, n, 0.4);
  } else if (kind === 'chest') {
    add(out, click(0.2, 300, 4, 0.04), 0.8);
    add(out, click(0.2, 600, 6, 0.03), 0.6, 0.08);
    const s = tone([880, 1320, 1760], 0.15, 'tri', 0.1, 0.04);
    add(out, s, 0.4, 0.12);
  } else if (kind === 'heal') {
    const n = noiseBuf(0.5);
    bp(n, 1600, 1.5);
    for (let i = 0; i < n.length; i++) n[i] *= 0.5 + 0.5 * Math.sin(i / SR * 40);
    env(n, 0.05, 0.15);
    add(out, n, 0.6);
  } else if (kind === 'plate') {
    add(out, click(0.3, 900, 15, 0.08), 0.7);
    add(out, click(0.3, 2400, 20, 0.05), 0.4, 0.05);
  }
  fadeOut(out);
  return normalize(out, 0.7);
}

// ---------------------------------------------------------------- loops
function loopify(b: Buf, xf = 0.5) {
  const n = Math.floor(xf * SR);
  const out = new Float32Array(b.length - n);
  for (let i = 0; i < out.length; i++) out[i] = b[i];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = b[i] * t + b[out.length + i] * (1 - t);
  }
  return out;
}

function windLoop(): Buf {
  seed = 5;
  const len = 12;
  const b = brown(len + 0.5);
  const m = mk(len + 0.5);
  for (let i = 0; i < m.length; i++) {
    const t = i / SR;
    m[i] = 0.55 + 0.3 * Math.sin(t * 0.7) + 0.15 * Math.sin(t * 1.9 + 1);
  }
  for (let i = 0; i < b.length; i++) b[i] *= m[i];
  const h = noiseBuf(len + 0.5);
  bp(h, 900, 0.6);
  for (let i = 0; i < h.length; i++) h[i] *= m[i] * m[i] * 0.15;
  add(b, h, 1);
  return normalize(loopify(b), 0.5);
}

function rainLoop(): Buf {
  seed = 6;
  const len = 6;
  const b = noiseBuf(len + 0.5);
  lp(b, 5000);
  hp(b, 300);
  gain(b, 0.35);
  for (let k = 0; k < 900; k++) {
    const d = click(0.03, 2000 + rnd() * 5000, 3, 0.004);
    add(b, d, 0.25 * rnd(), rnd() * len);
  }
  return normalize(loopify(b), 0.5);
}

function waterLoop(): Buf {
  seed = 7;
  const len = 8;
  const b = noiseBuf(len + 0.5);
  bp(b, 450, 0.7);
  for (let k = 0; k < 120; k++) {
    const f = 300 + rnd() * 900;
    const bub = sine(0.06, (t) => f * (1 + t * 12));
    env(bub, 0.002, 0.012);
    add(b, bub, 0.25 * rnd(), rnd() * len);
  }
  return normalize(loopify(b), 0.45);
}

function birdsLoop(): Buf {
  seed = 8;
  const len = 14;
  const b = mk(len + 0.5);
  for (let k = 0; k < 16; k++) {
    const start = rnd() * len;
    const base = 2600 + rnd() * 2400;
    const notes = 2 + Math.floor(rnd() * 5);
    for (let n = 0; n < notes; n++) {
      const dur = 0.05 + rnd() * 0.08;
      const s = sine(dur, (t) => base * (1 + Math.sin(t * 90) * 0.08 + (rnd() > 0.5 ? t * 3 : -t * 2)));
      env(s, 0.005, dur * 0.4);
      add(b, s, 0.2 + rnd() * 0.2, start + n * (dur + 0.03));
    }
  }
  return normalize(loopify(b), 0.35);
}

function cricketsLoop(): Buf {
  seed = 9;
  const len = 8;
  const b = mk(len + 0.5);
  for (let k = 0; k < 3; k++) {
    const f = 4200 + k * 350;
    const s = sine(len + 0.5, f);
    for (let i = 0; i < s.length; i++) {
      const t = i / SR;
      const chirp = Math.sin(t * 2 * Math.PI * (2.2 + k * 0.4)) > 0.55 ? 1 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 40);
      s[i] *= chirp * pulse * 0.2;
    }
    add(b, s, 1);
  }
  return normalize(loopify(b), 0.25);
}

function humLoop(): Buf {
  seed = 10;
  const len = 4;
  const b = saw(len + 0.5, 55);
  add(b, saw(len + 0.5, 55.7), 0.8);
  add(b, sine(len + 0.5, 110), 0.5);
  lp(b, 400);
  return normalize(loopify(b), 0.4);
}

function thunder(): Buf {
  seed = 11;
  const out = brown(5);
  lp(out, (t) => 600 * Math.exp(-t * 0.8) + 80);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] *= Math.exp(-t * 0.9) * (0.6 + 0.4 * Math.sin(t * 7 + Math.sin(t * 3) * 2));
  }
  const cr = noiseBuf(0.4);
  hp(cr, 800);
  env(cr, 0.01, 0.1);
  add(out, cr, 0.5);
  return normalize(fadeOut(out, 0.5), 0.9);
}

export interface SoundBank {
  [name: string]: Float32Array[];
}

/** Build all sounds. Returns name -> variants. */
export function synthesizeAll(): SoundBank {
  const bank: SoundBank = {};
  for (const [k, p] of Object.entries(GUNS)) {
    bank['gun_' + k] = [0, 1, 2].map((v) => gunshot(p, v, false));
    bank['gunfar_' + k] = [0, 1].map((v) => gunshot(p, v, true));
  }
  bank.explosion = [explosion(false)];
  bank.explosion_far = [explosion(true)];
  for (const s of ['grass', 'dirt', 'gravel', 'sand', 'snow', 'wood', 'metal', 'water', 'leaves', 'stone']) bank['step_' + s] = [0, 1, 2, 3].map((v) => footstep(s, v));
  for (const k of ['flesh', 'armor', 'metal', 'wood', 'glass', 'stone', 'dirt']) bank['hit_' + k] = [0, 1, 2].map((v) => impact(k, v));
  for (const k of ['mag_out', 'mag_in', 'bolt_rack', 'bolt_cycle', 'pump', 'shell_in', 'rocket_load', 'equip', 'dry_fire', 'scope_in', 'pin_pull', 'throw', 'bounce', 'smoke_hiss']) bank[k] = [mech(k)];
  for (const k of ['hover', 'click', 'confirm', 'back', 'hitmarker', 'headshot', 'kill', 'pickup', 'craft', 'reward', 'levelup', 'rankup', 'rankdown', 'countdown', 'go', 'zone', 'quest', 'victory', 'defeat', 'deny']) bank['ui_' + k] = [ui(k)];
  for (const k of ['place', 'break_wood', 'break_stone', 'break_metal', 'swing', 'chop', 'chip', 'tree_fall', 'chest', 'heal', 'plate']) bank['b_' + k] = [0, 1, 2].map((v) => build(k, v));
  bank.wind = [windLoop()];
  bank.rain = [rainLoop()];
  bank.water = [waterLoop()];
  bank.birds = [birdsLoop()];
  bank.crickets = [cricketsLoop()];
  bank.hum = [humLoop()];
  bank.thunder = [thunder()];
  // jump / land
  {
    seed = 77;
    const l = noiseBuf(0.15);
    lp(l, 700);
    env(l, 0.002, 0.04);
    const th = sine(0.12, 90);
    env(th, 0, 0.03);
    add(l, th, 0.8);
    bank.land = [normalize(l, 0.6)];
    const s = noiseBuf(0.5);
    bp(s, 900, 0.8);
    env(s, 0.01, 0.12);
    bank.splash = [normalize(s, 0.6)];
  }
  return bank;
}
