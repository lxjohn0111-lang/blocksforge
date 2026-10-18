// Persistent pool of simulated AI competitors. Identities are derived from a
// fixed seed (so the same players reappear across sessions) and their
// ladder points / career stats evolve as they play matches with you.
// Every one of these profiles is an AI player — never a real person.

import { RNG, hashString } from '../core/rng';
import { TIERS } from './ranks';
import { randomLook } from '../render/characters';
import { makePersonality, type Personality } from '../game/ai/personality';
import type { Identity } from '../game/combatant';
import { loadJSON, saveJSON, removeKey } from '../core/storage';
import { CAMOS } from '../render/camos';

export const POOL_SIZE = 420;

const ADJ = ['Silent', 'Iron', 'Crimson', 'Lucky', 'Frozen', 'Swift', 'Rusty', 'Neon', 'Hollow', 'Grim', 'Wild', 'Lazy', 'Cosmic', 'Atomic', 'Brave', 'Sneaky', 'Mossy', 'Salty', 'Dusty', 'Rapid', 'Quiet', 'Stormy', 'Golden', 'Shadow', 'Blazing', 'Feral', 'Lunar', 'Solar', 'Arctic', 'Pixel', 'Blocky', 'Mighty', 'Clumsy', 'Cheeky', 'Grumpy', 'Velvet', 'Vivid', 'Electric', 'Ancient', 'Tiny', 'Spicy', 'Sleepy', 'Turbo', 'Fuzzy', 'Hyper', 'Crispy', 'Wobbly', 'Noble'];
const NOUN = ['Fox', 'Badger', 'Raven', 'Wolf', 'Otter', 'Falcon', 'Panda', 'Golem', 'Knight', 'Ranger', 'Viper', 'Moose', 'Yeti', 'Comet', 'Ember', 'Bandit', 'Wizard', 'Sprout', 'Turtle', 'Lynx', 'Hawk', 'Titan', 'Phantom', 'Goblin', 'Cactus', 'Pebble', 'Anvil', 'Lantern', 'Biscuit', 'Noodle', 'Pigeon', 'Walrus', 'Gecko', 'Rhino', 'Mantis', 'Beacon', 'Sparrow', 'Muffin', 'Kraken', 'Pretzel', 'Waffle', 'Bison', 'Corgi', 'Toaster', 'Nugget', 'Squid', 'Hornet', 'Owl'];
const NAMES = ['Juno', 'Kaito', 'Mira', 'Theo', 'Rex', 'Nova', 'Ezra', 'Luna', 'Kai', 'Zara', 'Milo', 'Ivy', 'Axel', 'Nyx', 'Odin', 'Sage', 'Remy', 'Finn', 'Aria', 'Leo', 'Vex', 'Rook', 'Jinx', 'Echo', 'Bram', 'Tess', 'Orin', 'Yuki', 'Ravi', 'Sol', 'Ines', 'Kofi', 'Mika', 'Pax', 'Wren', 'Dax', 'Lio', 'Suri', 'Bodhi', 'Cato', 'Elio', 'Nell', 'Arlo', 'Koa', 'Zed', 'Faye', 'Hugo', 'Isla'];
const CLANS = ['VX', 'BLK', 'NRD', 'OWL', 'FRG', 'MSS', 'ZEN', 'RIP', 'GG', 'KRT', 'AXE', 'HVN', 'LMN', 'TRX'];
const TITLES = ['Rookie', 'Scrapper', 'Survivor', 'Sharpshooter', 'Architect', 'Pathfinder', 'Demolisher', 'Ghost', 'Vanguard', 'Duelist', 'Collector', 'Strategist', 'Iron Will', 'Night Owl', 'Storm Chaser', 'Block Breaker'];
const BANNERS = ['ember', 'tide', 'forest', 'dusk', 'circuit', 'stone', 'aurora', 'sunrise', 'void', 'meadow'];

function leet(s: string, r: RNG) {
  const map: Record<string, string> = { o: '0', e: '3', a: '4', i: '1', s: '5' };
  return s
    .split('')
    .map((c) => (map[c.toLowerCase()] && r.chance(0.35) ? map[c.toLowerCase()] : c))
    .join('');
}

function makeName(r: RNG): string {
  const p = r.next();
  const num = () => (r.chance(0.5) ? String(r.int(1, 99)) : String(r.int(100, 2099)));
  if (p < 0.24) return r.pick(ADJ) + r.pick(NOUN) + (r.chance(0.35) ? num() : '');
  if (p < 0.38) return (r.pick(ADJ) + r.pick(NOUN)).toLowerCase() + (r.chance(0.5) ? num() : '');
  if (p < 0.5) return r.pick(NOUN) + '_' + num();
  if (p < 0.6) return r.pick(['its', 'the', 'not', 'just', 'mr', 'xX']) + r.pick(NAMES) + (r.chance(0.3) ? 'Xx' : '');
  if (p < 0.7) return r.pick(NAMES) + r.pick(['FPS', 'TV', 'gg', 'Plays', 'Aim', '.exe', 'OW', 'BR']);
  if (p < 0.8) return leet(r.pick(ADJ) + r.pick(NOUN), r);
  if (p < 0.9) return r.pick(NAMES).toLowerCase() + r.pick(['', '_', '.', 'x']) + r.pick(NOUN).toLowerCase();
  return r.pick(NAMES) + r.pick(NAMES).toLowerCase() + (r.chance(0.5) ? num() : '');
}

export interface BotState {
  rp: number;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  level: number;
  recent: { mode: string; place: number; kills: number; t: number }[];
}

export interface PoolEntry {
  ident: Identity;
  baseSkill: number;
  state: BotState;
}

const KEY = 'blockforge.bots.v1';
let pool: PoolEntry[] | null = null;

export function getPool(): PoolEntry[] {
  if (pool) return pool;
  const r = new RNG(20260101);
  const used = new Set<string>();
  const saved = loadJSON<Record<string, BotState>>(KEY) ?? {};
  const camoKeys = Object.keys(CAMOS);
  pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    let name = makeName(r);
    let guard = 0;
    while (used.has(name.toLowerCase()) && guard++ < 10) name = makeName(r);
    if (used.has(name.toLowerCase())) name = name + r.int(2, 9);
    used.add(name.toLowerCase());
    const seed = hashString(name);
    // skill distribution: bell-ish around 0.5
    const skill = Math.max(0.05, Math.min(0.98, (r.next() + r.next() + r.next()) / 3 + (r.next() - 0.5) * 0.15));
    const personality: Personality = makePersonality(seed);
    const baseRp = Math.round(Math.max(0, skill * 3000 + (r.next() - 0.5) * 700));
    const ident: Identity = {
      id: 'bot_' + i,
      name: r.chance(0.12) ? `[${r.pick(CLANS)}] ${name}` : name,
      look: randomLook(seed),
      isBot: true,
      level: Math.round(5 + skill * 120 + r.next() * 40),
      rp: baseRp,
      title: r.pick(TITLES),
      banner: r.pick(BANNERS),
      camo: r.chance(0.6) ? r.pick(camoKeys) : 'factory',
      personality,
      skill,
    };
    const matches = Math.round(40 + r.next() * 900);
    const winRate = 0.02 + skill * 0.12;
    const st: BotState = saved[ident.id] ?? {
      rp: baseRp,
      matches,
      wins: Math.round(matches * winRate),
      kills: Math.round(matches * (0.4 + skill * 2.6)),
      deaths: Math.round(matches * (0.9 + (1 - skill) * 0.4)),
      level: ident.level,
      recent: [],
    };
    ident.rp = st.rp;
    ident.level = st.level;
    pool.push({ ident, baseSkill: skill, state: st });
  }
  return pool;
}

export function resetPool() {
  removeKey(KEY);
  pool = null;
}

export function savePool() {
  if (!pool) return;
  const out: Record<string, BotState> = {};
  for (const p of pool) out[p.ident.id] = p.state;
  saveJSON(KEY, out);
}

/**
 * Pick competitors. Ranked: sample bots whose ladder points are near the
 * player's. Casual: broad mix weighted toward average skill.
 */
export function pickBots(count: number, playerRp: number, ranked: boolean, seed: number): PoolEntry[] {
  const p = getPool();
  const r = new RNG(seed);
  const scored = p.map((e) => {
    const d = Math.abs(e.state.rp - playerRp);
    const w = ranked ? Math.exp(-(d * d) / (2 * 380 * 380)) : Math.exp(-((e.baseSkill - 0.42) ** 2) / 0.08);
    return { e, w: w * (0.6 + r.next() * 0.8) };
  });
  scored.sort((a, b) => b.w - a.w);
  const top = scored.slice(0, Math.max(count * 2, 40)).map((s) => s.e);
  r.shuffle(top);
  return top.slice(0, count);
}

/**
 * How tough opponents are, from 0 (bottom of Flint) to 1 (Forgemaster). It follows the player's
 * rank, so climbing the ladder is what makes matches harder; casual stays a notch easier.
 */
const FORGEMASTER_RP = TIERS[TIERS.length - 1].min;

export function difficultyFor(playerRp: number, ranked: boolean): number {
  const d = Math.min(1, Math.max(0, playerRp / FORGEMASTER_RP));
  return ranked ? d : Math.max(0, d * 0.85 - 0.04);
}

/**
 * In-match skill for a lobby: centred on the difficulty, with each competitor's own talent
 * (relative to the rest of the lobby) showing through more at higher ranks.
 */
export function lobbySkills(entries: PoolEntry[], difficulty: number): number[] {
  const mean = entries.reduce((s, e) => s + e.baseSkill, 0) / Math.max(1, entries.length);
  const center = 0.04 + difficulty * 0.82;
  const spread = 0.35 + difficulty * 0.45;
  return entries.map((e) => Math.max(0.02, Math.min(0.97, center + (e.baseSkill - mean) * spread)));
}

export function recordBotResult(id: string, mode: string, place: number, kills: number, won: boolean, rpDelta: number) {
  const p = getPool().find((e) => e.ident.id === id);
  if (!p) return;
  const s = p.state;
  s.matches++;
  if (won) s.wins++;
  s.kills += kills;
  s.deaths += won ? 0 : 1;
  s.rp = Math.max(0, s.rp + rpDelta);
  p.ident.rp = s.rp;
  if (s.matches % 6 === 0) s.level++;
  p.ident.level = s.level;
  s.recent.unshift({ mode, place, kills, t: Date.now() });
  s.recent = s.recent.slice(0, 5);
}
