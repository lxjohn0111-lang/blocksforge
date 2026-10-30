// Saved data. On CrazyGames every key lives in the SDK's data module only (synced to the player's
// account, kept by the SDK for guests): the game never touches browser storage there. Everywhere else
// it uses localStorage. If neither is usable (private mode, blocked site data, the SDK missing) the
// game keeps running from memory and the UI says progress will not persist.

import { platform } from '../platform/crazygames';

const memory = new Map<string, string>();
let available: boolean | null = null;

export function storageAvailable(): boolean {
  if (available !== null) return available;
  if (platform.portal) return (available = false);
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
  if (cloud) return cloud.get(key);
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
  const cloud = platform.storage();
  if (cloud) return cloud.remove(key);
  try {
    if (storageAvailable()) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
