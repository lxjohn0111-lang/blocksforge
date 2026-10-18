// Thin, failure-tolerant wrapper around localStorage. If storage is blocked
// (private mode, disabled site data) the game keeps running in memory and the
// UI tells the player that progress will not persist.

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

export function loadJSON<T>(key: string): T | null {
  try {
    const cloud = platform.storage();
    const raw = cloud ? cloud.get(key) ?? (storageAvailable() ? localStorage.getItem(key) : null) : storageAvailable() ? localStorage.getItem(key) : memory.get(key) ?? null;
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  platform.storage()?.set(key, raw);
  try {
    if (storageAvailable()) {
      localStorage.setItem(key, raw);
      return true;
    }
  } catch {
    // quota or blocked — fall through to memory
  }
  memory.set(key, raw);
  return false;
}

export function removeKey(key: string) {
  platform.storage()?.remove(key);
  try {
    if (storageAvailable()) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  memory.delete(key);
}
