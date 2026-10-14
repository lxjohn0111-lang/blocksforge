// Original SVG icon set, rank emblems and pixel avatars generated from looks.

import type { Look } from '../render/characters';
import { TIERS } from '../meta/ranks';

const s = (inner: string, size = 20, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" ${extra}>${inner}</svg>`;

export const ICON = {
  play: (z = 20) => s('<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>', z),
  gear: (z = 20) => s('<path d="M12 3l2 2.5 3-.6.8 3 2.7 1.5-1.2 2.8 1.2 2.8-2.7 1.5-.8 3-3-.6L12 21l-2-2.5-3 .6-.8-3L3.5 14.6 4.7 12 3.5 9.2l2.7-1.5.8-3 3 .6z"/><rect x="9.5" y="9.5" width="5" height="5"/>', z),
  coin: (z = 18) => `<svg width="${z}" height="${z}" viewBox="0 0 24 24"><path d="M12 1.5l9.5 5.25v10.5L12 22.5 2.5 17.25V6.75z" fill="#f2a93b"/><path d="M12 4l7.2 4v8L12 20l-7.2-4V8z" fill="#ffcf7a"/><path d="M9 8h6v2h-4v1.5h3v2h-3V16H9z" fill="#8a4a0a"/></svg>`,
  xp: (z = 18) => s('<path d="M13 2L5 13h6l-1 9 8-11h-6z" fill="currentColor" stroke="none"/>', z),
  trophy: (z = 20) => s('<path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3"/><path d="M12 14v4M8 21h8M9 18h6"/>', z),
  lock: (z = 16) => s('<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 018 0v4"/>', z),
  check: (z = 16) => s('<path d="M4 12l5 5L20 6"/>', z),
  close: (z = 18) => s('<path d="M5 5l14 14M19 5L5 19"/>', z),
  star: (z = 16) => s('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" fill="currentColor" stroke="none"/>', z),
  calendar: (z = 18) => s('<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>', z),
  scroll: (z = 18) => s('<path d="M6 3h12v15a3 3 0 01-3 3H6"/><path d="M6 3a3 3 0 00-3 3v1h3M9 8h6M9 12h6M9 16h4"/>', z),
  flame: (z = 18) => s('<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z" fill="currentColor" stroke="none"/>', z),
  skull: (z = 14) => s('<path d="M5 10a7 7 0 0114 0v4l-2 1v4H7v-4l-2-1z" fill="currentColor" stroke="none"/><rect x="8" y="10" width="3" height="3" fill="#000" stroke="none"/><rect x="13" y="10" width="3" height="3" fill="#000" stroke="none"/>', z),
  head: (z = 14) => s('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/>', z),
  shield: (z = 18) => s('<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>', z),
  heart: (z = 18) => s('<path d="M12 20s-8-5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6-8 11-8 11z" fill="currentColor" stroke="none"/>', z),
  people: (z = 16) => s('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14c3 0 5.5 1.5 5.5 5"/>', z),
  clock: (z = 16) => s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', z),
  ladder: (z = 18) => s('<path d="M4 20V12h4v8M10 20V6h4v14M16 20V9h4v11"/>', z),
  locker: (z = 18) => s('<rect x="5" y="3" width="14" height="18"/><path d="M12 3v18M9 8h1M14 8h1"/>', z),
  shop: (z = 18) => s('<path d="M4 9l2-5h12l2 5M4 9h16v11H4z"/><path d="M9 20v-6h6v6"/>', z),
  career: (z = 18) => s('<path d="M4 20V4M4 20h16"/><path d="M7 15l4-4 3 3 5-6"/>', z),
  chest: (z = 18) => s('<rect x="3" y="8" width="18" height="12"/><path d="M3 12h18M10 12v3h4v-3M5 8l2-4h10l2 4"/>', z),
  storm: (z = 16) => s('<circle cx="12" cy="12" r="9" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="4"/>', z),
  refresh: (z = 14) => s('<path d="M20 12a8 8 0 11-2.3-5.7M20 4v5h-5"/>', z),
  info: (z = 14) => s('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>', z),
  wall: (z = 22) => s('<rect x="4" y="4" width="16" height="16"/><path d="M4 9.5h16M4 15h16M12 4v5.5M8 9.5V15M16 9.5V15M12 15v5"/>', z),
  floor: (z = 22) => s('<path d="M2 15l10-5 10 5-10 5z"/><path d="M7 12.5l10 5M17 12.5l-10 5"/>', z),
  ramp: (z = 22) => s('<path d="M3 20h18V6z"/><path d="M8 20v-3h4v-3h4v-3"/>', z),
  block: (z = 22) => s('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>', z),
  map: (z = 16) => s('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>', z),
  crosshair: (z = 16) => s('<circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>', z),
  arrow: (z = 14) => s('<path d="M5 12h14M13 6l6 6-6 6"/>', z),
  medkit: (z = 16) => s('<rect x="3" y="7" width="18" height="13"/><path d="M9 7V4h6v3M12 10v7M8.5 13.5h7"/>', z),
  grenade: (z = 16) => s('<circle cx="11" cy="14" r="6.5"/><path d="M11 7.5V5h4M14 5l3-2"/>', z),
  bolt: (z = 16) => s('<path d="M13 2L5 13h6l-1 9 8-11h-6z" fill="currentColor" stroke="none"/>', z),
};

export function logoMark(size = 56): string {
  // anvil-shaped block glyph
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64">
    <defs><linearGradient id="lmA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd890"/><stop offset="1" stop-color="#e08a1a"/></linearGradient></defs>
    <path d="M32 4l24 12v28L32 58 8 44V16z" fill="#1b1f26"/>
    <path d="M32 4l24 12-24 12L8 16z" fill="url(#lmA)"/>
    <path d="M8 16l24 12v30L8 44z" fill="#b8661a"/>
    <path d="M56 16L32 28v30l24-14z" fill="#7a3f0e"/>
    <path d="M20 22h24l-4 4H24z" fill="#1b1f26" opacity=".55"/>
    <path d="M32 34l10-5v7l-10 5z" fill="#ffcf7a" opacity=".6"/>
  </svg>`;
}

let emblemId = 0;
/** Rank emblem SVG. division: 0..3 (IV..I) or -1 for top tier. */
export function rankEmblem(tier: number, division: number, size = 64): string {
  const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))];
  const id = `em${emblemId++}`;
  const wings = tier >= 4;
  const crown = tier >= 6;
  const flame = tier === 7;
  const pips = division >= 0 ? 4 - division : 0;
  let pipSvg = '';
  if (division >= 0) {
    for (let i = 0; i < 4; i++) {
      const on = i < 4 - (3 - division) - 0 && i <= division;
      pipSvg += `<rect x="${33 + i * 9}" y="100" width="6" height="6" fill="${on ? t.color : '#ffffff22'}"/>`;
    }
  }
  void pips;
  return `<svg width="${size}" height="${size * 1.1}" viewBox="0 0 100 110">
  <defs>
    <linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.color}"/><stop offset="1" stop-color="${t.glow}"/></linearGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  </defs>
  ${flame ? `<path d="M50 2c8 10 22 12 22 30 6-4 8-10 8-16 10 14 8 34-6 44H26C12 50 10 30 20 16c0 6 2 12 8 16 0-18 14-20 22-30z" fill="${t.color}" opacity=".35"/>` : ''}
  ${wings ? `<path d="M10 40L0 30l4 22 10 10zM90 40l10-10-4 22-10 10z" fill="url(#${id}a)" opacity=".85"/><path d="M14 52L2 46l6 16 10 6zM86 52l12-6-6 16-10 6z" fill="url(#${id}a)" opacity=".6"/>` : ''}
  <path d="M50 6l38 16v40L50 96 12 62V22z" fill="#0d1014" stroke="url(#${id}a)" stroke-width="4"/>
  <path d="M50 14l30 13v31L50 86 20 58V27z" fill="url(#${id}a)" opacity=".22"/>
  <path d="M50 30l18 9-18 9-18-9z" fill="${t.color}"/>
  <path d="M32 39l18 9v20l-18-9z" fill="${t.glow}"/>
  <path d="M68 39L50 48v20l18-9z" fill="${t.glow}" opacity=".7"/>
  <path d="M50 30l18 9-18 9-18-9z" fill="url(#${id}b)"/>
  ${tier >= 2 ? `<path d="M24 26l6 3v10l-6-3zM76 26l-6 3v10l6-3z" fill="${t.color}" opacity=".8"/>` : ''}
  ${crown ? `<path d="M34 12l6 6 10-12 10 12 6-6-2 12H36z" fill="${t.color}" stroke="#0d1014" stroke-width="2"/>` : ''}
  ${pipSvg}
  </svg>`;
}

/** 8x8 pixel face rendered from a Look (used on player cards). */
export function avatarCanvas(L: Look, size = 48): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const px = size / 8;
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  const shade = (n: number, f: number) => {
    const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
    const gg = Math.min(255, ((n >> 8) & 255) * f) | 0;
    const b = Math.min(255, (n & 255) * f) | 0;
    return `rgb(${r},${gg},${b})`;
  };
  const put = (x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x * px, y * px, px, px);
  };
  // skin base with subtle variation
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x, y, shade(L.skin, 0.92 + ((x * 7 + y * 3) % 5) * 0.03));
  // hair
  if (L.hairStyle !== 'bald') {
    for (let x = 0; x < 8; x++) {
      put(x, 0, hex(L.hair));
      put(x, 1, shade(L.hair, 0.9));
    }
    if (L.hairStyle !== 'buzz') {
      put(0, 2, hex(L.hair));
      put(7, 2, hex(L.hair));
      if (L.hairStyle === 'long') for (let y = 2; y < 7; y++) { put(0, y, hex(L.hair)); put(7, y, hex(L.hair)); }
    }
  }
  // eyebrows / eyes / nose / mouth
  put(1, 2, shade(L.hair, 0.8)); put(2, 2, shade(L.hair, 0.8)); put(5, 2, shade(L.hair, 0.8)); put(6, 2, shade(L.hair, 0.8));
  put(1, 3, '#f4f4f4'); put(2, 3, hex(L.eyes)); put(5, 3, hex(L.eyes)); put(6, 3, '#f4f4f4');
  put(1, 4, '#e8e8e8'); put(2, 4, shade(L.eyes, 0.7)); put(5, 4, shade(L.eyes, 0.7)); put(6, 4, '#e8e8e8');
  put(3, 5, shade(L.skin, 0.8)); put(4, 5, shade(L.skin, 0.8));
  for (let x = 2; x < 6; x++) put(x, 6, '#6a3a30');
  if (L.beard) for (let x = 0; x < 8; x++) { put(x, 7, hex(L.hair)); if (x < 2 || x > 5) put(x, 6, hex(L.hair)); }
  if (L.goggles) {
    for (let x = 0; x < 8; x++) put(x, 3, '#1a1a1a');
    put(1, 3, '#5ab0e0'); put(2, 3, '#7ac8f0'); put(5, 3, '#5ab0e0'); put(6, 3, '#7ac8f0');
  }
  // headgear
  const H = hex(L.hat);
  switch (L.headgear) {
    case 'cap':
      for (let x = 0; x < 8; x++) { put(x, 0, H); put(x, 1, H); }
      for (let x = 0; x < 8; x++) put(x, 2, shade(L.hat, 0.7));
      break;
    case 'beanie':
      for (let x = 0; x < 8; x++) { put(x, 0, H); put(x, 1, shade(L.hat, 0.85)); put(x, 2, shade(L.hat, 0.7)); }
      break;
    case 'helmet':
      for (let x = 0; x < 8; x++) { put(x, 0, H); put(x, 1, H); put(x, 2, shade(L.hat, 0.75)); }
      put(0, 3, '#2a2a2a'); put(7, 3, '#2a2a2a');
      break;
    case 'hood':
      for (let x = 0; x < 8; x++) { put(x, 0, H); put(x, 1, H); }
      for (let y = 2; y < 8; y++) { put(0, y, H); put(7, y, H); }
      break;
    case 'headset':
      put(0, 3, '#1a1a1a'); put(0, 4, '#1a1a1a'); put(7, 3, '#1a1a1a'); put(7, 4, '#1a1a1a');
      for (let x = 0; x < 8; x++) put(x, 0, '#1a1a1a');
      put(0, 5, hex(L.accent));
      break;
    case 'bandana':
      for (let x = 0; x < 8; x++) put(x, 1, H);
      break;
    case 'beret':
      for (let x = 0; x < 8; x++) put(x, 0, H);
      for (let x = 0; x < 6; x++) put(x, 1, shade(L.hat, 0.85));
      put(6, 1, hex(L.accent));
      break;
    case 'visor':
      for (let x = 0; x < 8; x++) put(x, 1, H);
      break;
  }
  // soft vignette for depth
  const grd = g.createLinearGradient(0, 0, 0, size);
  grd.addColorStop(0, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}
