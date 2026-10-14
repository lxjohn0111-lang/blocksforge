// Ranked ladder: tiers, divisions, RP calculation, seasons.

import type { MatchResult } from '../game/match';

export interface Tier {
  name: string;
  color: string;
  glow: string;
  min: number;
  camo: string | null;
}

export const TIERS: Tier[] = [
  { name: 'Flint', color: '#9a948a', glow: '#5c5852', min: 0, camo: null },
  { name: 'Copper', color: '#d07a45', glow: '#7a3a18', min: 400, camo: 'rank_copper' },
  { name: 'Iron', color: '#c3cbd3', glow: '#5a6470', min: 800, camo: 'rank_iron' },
  { name: 'Gold', color: '#f3c84a', glow: '#8a6410', min: 1200, camo: 'rank_gold' },
  { name: 'Jade', color: '#3fd6a2', glow: '#0e6a4a', min: 1600, camo: 'rank_jade' },
  { name: 'Diamond', color: '#74e9ff', glow: '#1a7a9a', min: 2000, camo: 'rank_diamond' },
  { name: 'Obsidian', color: '#a874ff', glow: '#4a1a9a', min: 2400, camo: 'rank_obsidian' },
  { name: 'Forgemaster', color: '#ff8a3a', glow: '#a8320a', min: 2800, camo: 'rank_forge' },
];

export const DIV_NAMES = ['IV', 'III', 'II', 'I'];

export interface RankInfo {
  tier: number;
  division: number; // 0..3 (IV..I); -1 for top tier
  progress: number; // 0..100 inside division (or rp above floor for top)
  label: string;
  tierDef: Tier;
  floor: number;
  next: number | null;
}

export function rankOf(rp: number): RankInfo {
  let t = 0;
  for (let i = TIERS.length - 1; i >= 0; i--)
    if (rp >= TIERS[i].min) {
      t = i;
      break;
    }
  const tierDef = TIERS[t];
  if (t === TIERS.length - 1) {
    return { tier: t, division: -1, progress: rp - tierDef.min, label: tierDef.name, tierDef, floor: tierDef.min, next: null };
  }
  const within = rp - tierDef.min;
  const division = Math.min(3, Math.floor(within / 100));
  const progress = within - division * 100;
  return {
    tier: t, division, progress, label: `${tierDef.name} ${DIV_NAMES[division]}`, tierDef, floor: tierDef.min + division * 100,
    next: tierDef.min + (division + 1) * 100,
  };
}

export interface RPBreakdown {
  lines: { label: string; value: number }[];
  total: number;
  before: number;
  after: number;
  promoted: boolean;
  demoted: boolean;
  tierUp: boolean;
  tierDown: boolean;
  shielded: boolean;
}

export function computeRP(rp: number, r: MatchResult, shield: number): RPBreakdown {
  const info = rankOf(rp);
  const lines: { label: string; value: number }[] = [];
  if (r.mode === 'br') {
    const entry = -[0, 6, 12, 18, 24, 30, 36, 44][info.tier];
    if (entry) lines.push({ label: `${info.tierDef.name} entry cost`, value: entry });
    const p = r.placement;
    const place = p === 1 ? 80 : p === 2 ? 60 : p === 3 ? 50 : p <= 5 ? 40 : p <= 10 ? 25 : p <= 15 ? 10 : 0;
    lines.push({ label: `Placement #${p}`, value: place });
    const kf = p <= 10 ? 1 : 0.6;
    const k = Math.round(Math.min(8, r.stats.kills) * 8 * kf);
    if (k) lines.push({ label: `Eliminations ×${r.stats.kills}`, value: k });
    const a = Math.round(Math.min(6, r.stats.assists) * 4 * kf);
    if (a) lines.push({ label: `Assists ×${r.stats.assists}`, value: a });
  } else if (r.mode === 'tdm') {
    if (r.draw) lines.push({ label: 'Draw', value: 2 });
    else if (r.won) lines.push({ label: 'Victory', value: 26 });
    else lines.push({ label: 'Defeat', value: -20 - info.tier * 2 });
    const perf = [8, 5, 2, 0, -2, -4][Math.min(5, r.placement - 1)] ?? 0;
    lines.push({ label: `Team rank #${r.placement}`, value: perf });
    if (r.stats.kills >= 15) lines.push({ label: 'Fragger bonus', value: 4 });
  }
  let total = lines.reduce((s, l) => s + l.value, 0);
  let after = Math.max(0, rp + total);
  let shielded = false;
  // demotion protection: right after reaching a tier you can't fall out of it
  if (shield > 0 && after < info.tierDef.min) {
    shielded = true;
    after = info.tierDef.min;
    total = after - rp;
    lines.push({ label: 'Demotion shield', value: 0 });
  }
  const a = rankOf(after);
  return {
    lines,
    total,
    before: rp,
    after,
    promoted: a.tier > info.tier || (a.tier === info.tier && a.division > info.division),
    demoted: a.tier < info.tier || (a.tier === info.tier && a.division < info.division),
    tierUp: a.tier > info.tier,
    tierDown: a.tier < info.tier,
    shielded,
  };
}

// ---------------------------------------------------------------- seasons
const SEASON_EPOCH = new Date(2026, 0, 5).getTime(); // Monday 5 Jan 2026, local
const SEASON_LEN = 56 * 86400000;
const SEASON_NAMES = ['First Light', 'Deepvein', 'Frostspine', 'Silvervein', 'Ashcrown', 'Emberfall', 'Stormglass', 'Overgrowth'];

export function seasonAt(now = Date.now()) {
  const idx = Math.max(0, Math.floor((now - SEASON_EPOCH) / SEASON_LEN));
  const start = SEASON_EPOCH + idx * SEASON_LEN;
  return { number: idx + 1, name: SEASON_NAMES[idx % SEASON_NAMES.length], start, end: start + SEASON_LEN };
}

export function softReset(rp: number) {
  return Math.max(0, Math.round(rp * 0.55) - 60);
}
