// Saved data. On CrazyGames every key lives in the SDK's data module only (synced to the player's
// account, kept by the SDK for guests): the game never touches browser storage there. Everywhere else
// it uses localStorage. If neither is usable (private mode, blocked site data, the SDK missing) the
// game keeps running from memory and the UI says progress will not persist.
//
// The data module is not asked on every change: each key is read from it once, and changes are
// written in one batch at most every 30 seconds, and right away when the page is being left.

import { platform } from '../platform/crazygames';

/** this session's view of every key it has read or written (null: no value) */
const memory = new Map<string, string | null>();
let available: boolean | null = null;

export const CLOUD_SAVE_MS = 30000;
/** keys changed since the last write to the data module */
const dirty = new Set<string>();
let lastFlush = 0;
let flushTimer = 0;
let flushHooked = false;

/** writes the changed keys to the data module now (a no-op when nothing changed) */
export function flushSaves() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
  const cloud = platform.storage();
  if (!cloud || !dirty.size) return;
  lastFlush = Date.now();
  for (const key of dirty) {
    const raw = memory.get(key);
    if (raw == null) cloud.remove(key);
    else cloud.set(key, raw);
  }
  dirty.clear();
}

function scheduleFlush() {
  if (!flushHooked) {
    flushHooked = true;
    // leaving or hiding the page is when a save is really needed
    addEventListener('pagehide', flushSaves);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSaves();
    });
  }
  if (flushTimer) return;
  flushTimer = window.setTimeout(flushSaves, Math.max(0, lastFlush + CLOUD_SAVE_MS - Date.now()));
}

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
  // this session's latest value wins (also while a platform save is pending or failed)
  if (memory.has(key)) return memory.get(key) ?? null;
  const cloud = platform.storage();
  if (cloud) {
    const v = cloud.get(key);
    memory.set(key, v);
    return v;
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
  const cloud = platform.storage();
  if (cloud) {
    if (memory.get(key) !== raw) {
      memory.set(key, raw);
      dirty.add(key);
      scheduleFlush();
    }
    return true;
  }
  memory.set(key, raw);
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
  const cloud = platform.storage();
  if (cloud) {
    memory.set(key, null);
    dirty.add(key);
    scheduleFlush();
    return;
  }
  memory.delete(key);
  try {
    if (storageAvailable()) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
