// Daily quests: three per local day, generated deterministically from the
// date so they stay stable across refreshes. One free reroll per day.

import { RNG, hashString } from '../core/rng';
import type { MatchResult } from '../game/match';

export type QuestStat =
  | 'kills' | 'damage' | 'headshots' | 'built' | 'chests' | 'crafted' | 'top10' | 'tdmWins' | 'matches' | 'harvested'
  | 'assists' | 'distance' | 'longshots' | 'grenadeKills' | 'brMatches' | 'wins';

interface QuestTemplate {
  id: string;
  text: string;
  stat: QuestStat;
  targets: number[];
  xp: number;
  coins: number;
}

const TEMPLATES: QuestTemplate[] = [
  { id: 'elims', text: 'Get {n} eliminations', stat: 'kills', targets: [5, 8, 12], xp: 500, coins: 120 },
  { id: 'damage', text: 'Deal {n} damage', stat: 'damage', targets: [800, 1500, 2500], xp: 450, coins: 110 },
  { id: 'heads', text: 'Land {n} headshots', stat: 'headshots', targets: [4, 8, 12], xp: 500, coins: 120 },
  { id: 'build', text: 'Place {n} build pieces in Battle Royale', stat: 'built', targets: [8, 15, 25], xp: 400, coins: 100 },
  { id: 'chests', text: 'Open {n} supply chests', stat: 'chests', targets: [3, 5, 8], xp: 400, coins: 100 },
  { id: 'craft', text: 'Craft {n} items', stat: 'crafted', targets: [3, 6], xp: 350, coins: 90 },
  { id: 'top10', text: 'Finish top 10 in Battle Royale', stat: 'top10', targets: [1, 2], xp: 600, coins: 150 },
  { id: 'tdmwin', text: 'Win Team Deathmatch {n}×', stat: 'tdmWins', targets: [1, 2], xp: 600, coins: 150 },
  { id: 'play', text: 'Play {n} matches', stat: 'matches', targets: [2, 3, 4], xp: 350, coins: 90 },
  { id: 'harvest', text: 'Harvest {n} materials', stat: 'harvested', targets: [80, 150, 250], xp: 350, coins: 90 },
  { id: 'assists', text: 'Get {n} assists', stat: 'assists', targets: [3, 5], xp: 400, coins: 100 },
  { id: 'travel', text: 'Travel {n}m', stat: 'distance', targets: [1200, 2500], xp: 300, coins: 80 },
  { id: 'longshot', text: 'Get {n} eliminations from 50m+', stat: 'longshots', targets: [1, 2], xp: 550, coins: 140 },
  { id: 'nades', text: 'Get a grenade elimination', stat: 'grenadeKills', targets: [1], xp: 500, coins: 130 },
];

export interface QuestState {
  id: string;
  text: string;
  stat: QuestStat;
  target: number;
  progress: number;
  xp: number;
  coins: number;
  claimed: boolean;
}

export function generateQuests(date: string, salt: number, reroll = 0): QuestState[] {
  const r = new RNG(hashString(date) ^ salt ^ (reroll * 0x9e37));
  const pool = r.shuffle([...TEMPLATES]);
  const picked = pool.slice(0, 3);
  return picked.map((t, i) => {
    const target = t.targets[Math.min(t.targets.length - 1, i === 0 ? 0 : r.int(0, t.targets.length - 1))];
    return { id: t.id, text: t.text.replace('{n}', target.toLocaleString()), stat: t.stat, target, progress: 0, xp: t.xp, coins: t.coins, claimed: false };
  });
}

export function statFromResult(stat: QuestStat, r: MatchResult, longshots: number): number {
  const s = r.stats;
  switch (stat) {
    case 'kills': return s.kills;
    case 'damage': return Math.round(s.damage);
    case 'headshots': return s.headshots;
    case 'built': return r.mode === 'br' ? s.built : 0;
    case 'chests': return s.chests;
    case 'crafted': return s.crafted;
    case 'top10': return r.mode === 'br' && r.placement <= 10 ? 1 : 0;
    case 'tdmWins': return r.mode === 'tdm' && r.won ? 1 : 0;
    case 'matches': return r.mode === 'tutorial' ? 0 : 1;
    case 'harvested': return s.harvested;
    case 'assists': return s.assists;
    case 'distance': return Math.round(s.distance);
    case 'longshots': return longshots;
    case 'grenadeKills': return s.grenadeKills;
    case 'brMatches': return r.mode === 'br' ? 1 : 0;
    case 'wins': return r.won ? 1 : 0;
  }
}
