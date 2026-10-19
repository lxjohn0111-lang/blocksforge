// Saved data. On CrazyGames every key lives in the SDK's data module (synced to the player's account,
// kept locally for guests); everywhere else in localStorage. If neither is usable (private mode,
// blocked site data) the game keeps running from memory and the UI says progress will not persist.

import { platform } from '../platform/crazygames';

const memory = new Map<string, string>();
let available: boolean | null = null;

export function storageAvailable(): boolean {
  if (available !== null) return available;
  try {
    const k = '__bf_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** progress survives a reload (platform cloud save or browser storage) */
export function persistentStorage(): boolean {
  return !!platform.storage() || storageAvailable();
}

function localGet(key: string): string | null {
  try {
    return storageAvailable() ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  // this session's latest write wins (also when a platform save failed)
  const m = memory.get(key);
  if (m != null) return m;
  const cloud = platform.storage();
  if (cloud) {
    const v = cloud.get(key);
    if (v != null) return v;
    // first run with the SDK: bring progress saved by an earlier, SDK-less build along
    const local = localGet(key);
    if (local != null) cloud.set(key, local);
    return local;
  }
  return localGet(key);
}

export function loadJSON<T>(key: string): T | null {
  try {
    const raw = readRaw(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  const cloud = platform.storage();
  if (cloud) return cloud.set(key, raw);
  try {
    if (storageAvailable()) {
      localStorage.setItem(key, raw);
      return true;
    }
  } catch {
    // quota or blocked: memory only
  }
  return false;
}

export function removeKey(key: string) {
  memory.delete(key);
  platform.storage()?.remove(key);
  try {
    if (storageAvailable()) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
