// Player profile, saved through core/storage (CrazyGames data module or localStorage) with versioned
// migrations.

import { loadJSON, saveJSON, persistentStorage } from '../core/storage';
import type { BaseLook } from './cosmetics';
import { DEFAULT_OWNED, composeLook } from './cosmetics';
import { seasonAt } from './ranks';
import type { QuestState } from './quests';
import type { Identity } from '../game/combatant';
import { hashString } from '../core/rng';
import type { ModeKind } from '../game/match';

export interface HistoryEntry {
  t: number;
  mode: ModeKind;
  ranked: boolean;
  map: string;
  won: boolean;
  draw: boolean;
  placement: number;
  participants: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  accuracy: number;
  rpDelta: number | null;
  xp: number;
  score?: string;
  duration: number;
}

export interface LifetimeStats {
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  shots: number;
  hits: number;
  headshots: number;
  brMatches: number;
  brWins: number;
  top5: number;
  top10: number;
  tdmMatches: number;
  tdmWins: number;
  built: number;
  destroyed: number;
  chests: number;
  crafted: number;
  harvested: number;
  grenadeKills: number;
  longestKill: number;
  playtime: number;
  rankedMatches: number;
  rankedWins: number;
}

export interface Profile {
  v: number;
  name: string;
  seed: number;
  createdAt: number;
  lastPlayed: number;
  base: BaseLook;
  level: number;
  xp: number;
  coins: number;
  rank: { season: number; rp: number; peakRp: number; shield: number; seasonPeak: number };
  stats: LifetimeStats;
  history: HistoryEntry[];
  daily: { lastClaim: string | null; day: number; total: number };
  quests: { date: string; list: QuestState[]; rerolls: number };
  achievements: Record<string, number>;
  owned: string[];
  equipped: { camo: string; outfit: string; banner: string; title: string };
  events: Record<string, { progress: Record<string, number>; claimed: string[] }>;
  seasonRewards: { season: number; tier: number; claimed: boolean }[];
  shop: { date: string; bought: string[] };
  tutorialDone: boolean;
  flags: string[];
  lastLoadout: string;
  notices: { kind: string; data: any }[];
}

const KEY = 'blockforge.profile.v1';

function emptyStats(): LifetimeStats {
  return {
    matches: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, damage: 0, shots: 0, hits: 0, headshots: 0, brMatches: 0, brWins: 0,
    top5: 0, top10: 0, tdmMatches: 0, tdmWins: 0, built: 0, destroyed: 0, chests: 0, crafted: 0, harvested: 0, grenadeKills: 0, longestKill: 0,
    playtime: 0, rankedMatches: 0, rankedWins: 0,
  };
}

export function newProfile(): Profile {
  const now = Date.now();
  const seed = Math.floor(Math.random() * 1e9);
  const season = seasonAt(now).number;
  return {
    v: 1,
    name: 'Player' + (1000 + (seed % 9000)),
    seed,
    createdAt: now,
    lastPlayed: now,
    base: { skin: 0xe0ac86, hair: 0x3a2414, hairStyle: 'short', eyes: 0x3a6a2a },
    level: 1,
    xp: 0,
    coins: 300,
    rank: { season, rp: 0, peakRp: 0, shield: 0, seasonPeak: 0 },
    stats: emptyStats(),
    history: [],
    daily: { lastClaim: null, day: 0, total: 0 },
    quests: { date: '', list: [], rerolls: 0 },
    achievements: {},
    owned: [...DEFAULT_OWNED],
    equipped: { camo: 'factory', outfit: 'recruit', banner: 'stone', title: 'Rookie' },
    events: {},
    seasonRewards: [],
    shop: { date: '', bought: [] },
    tutorialDone: false,
    flags: [],
    lastLoadout: 'assault',
    notices: [],
  };
}

function migrate(p: any): Profile {
  const base = newProfile();
  if (!p || typeof p !== 'object') return base;
  // shallow merge with defaults so new fields appear for returning players
  const out: Profile = {
    ...base,
    ...p,
    base: { ...base.base, ...(p.base ?? {}) },
    rank: { ...base.rank, ...(p.rank ?? {}) },
    stats: { ...base.stats, ...(p.stats ?? {}) },
    daily: { ...base.daily, ...(p.daily ?? {}) },
    quests: { ...base.quests, ...(p.quests ?? {}) },
    equipped: { ...base.equipped, ...(p.equipped ?? {}) },
    shop: { ...base.shop, ...(p.shop ?? {}) },
    owned: Array.isArray(p.owned) ? Array.from(new Set([...DEFAULT_OWNED, ...p.owned])) : base.owned,
    history: Array.isArray(p.history) ? p.history.slice(0, 40) : [],
    flags: Array.isArray(p.flags) ? p.flags : [],
    notices: Array.isArray(p.notices) ? p.notices : [],
    events: p.events && typeof p.events === 'object' ? p.events : {},
    achievements: p.achievements && typeof p.achievements === 'object' ? p.achievements : {},
    seasonRewards: Array.isArray(p.seasonRewards) ? p.seasonRewards : [],
  };
  out.v = 1;
  if (!Number.isFinite(out.coins) || out.coins < 0) out.coins = 0;
  if (!Number.isFinite(out.level) || out.level < 1) out.level = 1;
  if (!Number.isFinite(out.rank.rp) || out.rank.rp < 0) out.rank.rp = 0;
  return out;
}

let current: Profile | null = null;

export function loadProfile(): Profile {
  if (current) return current;
  const raw = loadJSON<any>(KEY);
  current = raw ? migrate(raw) : newProfile();
  return current;
}

export function saveProfile(p = current) {
  if (!p) return false;
  p.lastPlayed = Date.now();
  return saveJSON(KEY, p);
}

export function resetProfile() {
  current = newProfile();
  saveProfile(current);
  return current;
}

export function persistent() {
  return persistentStorage();
}

export function playerIdentity(p: Profile): Identity {
  return {
    id: 'player',
    name: p.name,
    look: composeLook(p.base, p.equipped.outfit),
    isBot: false,
    level: p.level,
    rp: p.rank.rp,
    title: p.equipped.title,
    banner: p.equipped.banner,
    camo: p.equipped.camo,
    skill: 0.5,
  };
}

export function xpForLevel(level: number) {
  return 1000 + (level - 1) * 150;
}

export function profileSalt(p: Profile) {
  return hashString(String(p.seed));
}
