import { loadJSON, saveJSON } from './storage';
import type { Quality } from '../render/engine';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'reload' | 'interact' | 'build' | 'tool' | 'grenade' | 'heal'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
  | 'inventory' | 'map' | 'rotate' | 'material' | 'fire' | 'aim' | 'scoreboard';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move Forward', back: 'Move Back', left: 'Strafe Left', right: 'Strafe Right',
  jump: 'Jump', crouch: 'Crouch', sprint: 'Sprint', reload: 'Reload', interact: 'Interact / Loot',
  build: 'Build Mode', tool: 'Harvest Tool', grenade: 'Throw Grenade', heal: 'Quick Heal',
  slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3', slot4: 'Slot 4 (Heals)', slot5: 'Slot 5 (Throwables)',
  inventory: 'Inventory / Craft', map: 'Map', rotate: 'Rotate Piece', material: 'Cycle Material',
  fire: 'Fire', aim: 'Aim / Scope', scoreboard: 'Scoreboard',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft',
  reload: 'KeyR', interact: 'KeyE', build: 'KeyQ', tool: 'KeyF', grenade: 'KeyG', heal: 'KeyH',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5',
  inventory: 'Tab', map: 'KeyM', rotate: 'KeyR', material: 'KeyX', fire: 'Mouse0', aim: 'Mouse2', scoreboard: 'Tab',
};

/** Actions that may legitimately share a key with another (context dependent). */
export const SHARED_OK: [Action, Action][] = [
  ['reload', 'rotate'],
  ['inventory', 'scoreboard'],
];

export interface Settings {
  sensitivity: number;
  adsSens: number;
  scopeSens: number;
  invertY: boolean;
  fov: number;
  masterVol: number;
  sfxVol: number;
  musicVol: number;
  ambientVol: number;
  quality: Quality;
  renderScale: number;
  viewDistance: number;
  shadows: boolean;
  bloom: boolean;
  godRays: boolean;
  ssr: boolean;
  fxaa: boolean;
  dynamicRes: boolean;
  aimToggle: boolean;
  crouchToggle: boolean;
  showFps: boolean;
  damageNumbers: boolean;
  crosshairColor: string;
  bindings: Record<Action, string>;
  version: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  adsSens: 0.85,
  scopeSens: 1,
  invertY: false,
  fov: 80,
  masterVol: 0.8,
  sfxVol: 1,
  musicVol: 0.45,
  ambientVol: 0.7,
  quality: 'high',
  renderScale: 1,
  viewDistance: 270,
  shadows: true,
  bloom: true,
  godRays: true,
  ssr: true,
  fxaa: true,
  dynamicRes: true,
  aimToggle: false,
  crouchToggle: false,
  showFps: false,
  damageNumbers: true,
  crosshairColor: '#ffffff',
  bindings: { ...DEFAULT_BINDINGS },
  version: 1,
};

const KEY = 'blockforge.settings.v1';

export function loadSettings(): Settings {
  const s = loadJSON<Partial<Settings>>(KEY);
  const merged: Settings = { ...DEFAULT_SETTINGS, ...(s ?? {}), bindings: { ...DEFAULT_BINDINGS, ...(s?.bindings ?? {}) } };
  return merged;
}

export function saveSettings(s: Settings) {
  saveJSON(KEY, s);
}

export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', Tab: 'Tab', Escape: 'Esc', CapsLock: 'Caps', Backquote: '`',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Backspace: 'Bksp',
  };
  return map[code] ?? code;
}
