// Limited-time events on a fixed, real calendar: a rotating weekend event
// every Friday 00:00 to Monday 00:00 (local time). Countdowns are computed
// from the actual schedule — the event genuinely activates at that time.

import { weekIndex } from './calendar';

export interface EventChallenge {
  id: string;
  text: string;
  stat: 'kills' | 'chests' | 'top5' | 'wins' | 'matches' | 'damage' | 'headshots' | 'built' | 'tdmWins';
  target: number;
  reward: string; // 'coins:400' | 'camo:x' | 'outfit:x' | 'banner:x' | 'xp:800'
}

export interface EventDef {
  id: string;
  name: string;
  tagline: string;
  desc: string;
  accent: string;
  gradient: string;
  mods: { brTime?: number; brTimeScale?: number; brWeather?: 'storm' | 'rain' | 'cloudy'; allTime?: number; xpMult?: number; tdmXpMult?: number; featuredMap?: string };
  challenges: EventChallenge[];
}

export const EVENTS: EventDef[] = [
  {
    id: 'harvest_moon', name: 'Harvest Moon', tagline: 'Drop at dusk. Fight into the night.',
    desc: 'Battle Royale matches begin at sunset and slide into a moonlit night. Lamps and muzzle flashes light the way.',
    accent: '#ff8a2a', gradient: 'linear-gradient(135deg,#1a0c06,#6a2a0a 55%,#ff8a2a)',
    mods: { brTime: 18.6, brTimeScale: 0.35 },
    challenges: [
      { id: 'hm1', text: 'Get 6 eliminations', stat: 'kills', target: 6, reward: 'camo:harvest' },
      { id: 'hm2', text: 'Open 8 supply chests', stat: 'chests', target: 8, reward: 'coins:400' },
      { id: 'hm3', text: 'Finish top 5 twice', stat: 'top5', target: 2, reward: 'outfit:harvest_hunter' },
    ],
  },
  {
    id: 'frost_frenzy', name: 'Frostbite Frenzy', tagline: 'Double XP in Team Deathmatch.',
    desc: 'Frostbite joins the featured rotation and every Team Deathmatch match grants double XP.',
    accent: '#9ae8ff', gradient: 'linear-gradient(135deg,#06121e,#1a4a6a 55%,#9ae8ff)',
    mods: { tdmXpMult: 2, featuredMap: 'frostbite' },
    challenges: [
      { id: 'ff1', text: 'Win 2 Team Deathmatch matches', stat: 'tdmWins', target: 2, reward: 'camo:glacier' },
      { id: 'ff2', text: 'Land 20 headshots', stat: 'headshots', target: 20, reward: 'coins:400' },
      { id: 'ff3', text: 'Get 30 eliminations', stat: 'kills', target: 30, reward: 'outfit:frost_warden' },
    ],
  },
  {
    id: 'iron_rain', name: 'Iron Rain', tagline: 'Thunderstorms over Ashcrown Isle.',
    desc: 'Battle Royale drops into a thunderstorm: rain-slick terrain, lightning flashes and low visibility.',
    accent: '#bfe0ff', gradient: 'linear-gradient(135deg,#0a0f16,#2a3a4a 55%,#bfe0ff)',
    mods: { brWeather: 'storm' },
    challenges: [
      { id: 'ir1', text: 'Deal 2,500 damage', stat: 'damage', target: 2500, reward: 'camo:stormfront' },
      { id: 'ir2', text: 'Place 30 build pieces', stat: 'built', target: 30, reward: 'coins:400' },
      { id: 'ir3', text: 'Play 4 matches', stat: 'matches', target: 4, reward: 'outfit:storm_runner' },
    ],
  },
  {
    id: 'golden_hour', name: 'Golden Hour', tagline: '+50% XP. Every match at sunset.',
    desc: 'All modes play out in warm golden light and every match grants 50% bonus XP.',
    accent: '#ffd25a', gradient: 'linear-gradient(135deg,#2a1206,#a8520e 55%,#ffd25a)',
    mods: { allTime: 17.9, xpMult: 1.5 },
    challenges: [
      { id: 'gh1', text: 'Play 5 matches', stat: 'matches', target: 5, reward: 'banner:sunrise' },
      { id: 'gh2', text: 'Get 15 eliminations', stat: 'kills', target: 15, reward: 'camo:sunforged' },
      { id: 'gh3', text: 'Win any match', stat: 'wins', target: 1, reward: 'outfit:sun_warden' },
    ],
  },
];

export interface EventInstance {
  def: EventDef;
  start: number;
  end: number;
  key: string;
  active: boolean;
}

const EPOCH = new Date(2026, 0, 5).getTime();
const DAY = 86400000;

function instanceForWeek(w: number): EventInstance {
  const def = EVENTS[((w % EVENTS.length) + EVENTS.length) % EVENTS.length];
  const weekStart = new Date(EPOCH + w * 7 * DAY);
  // compute from calendar dates so DST shifts don't skew the window
  const fri = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 4);
  const mon = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
  return { def, start: fri.getTime(), end: mon.getTime(), key: `${def.id}@${fri.getFullYear()}-${fri.getMonth() + 1}-${fri.getDate()}`, active: false };
}

export function eventStatus(now = Date.now()): { current: EventInstance | null; next: EventInstance } {
  const w = weekIndex(new Date(now));
  const cur = instanceForWeek(w);
  if (now >= cur.start && now < cur.end) {
    cur.active = true;
    return { current: cur, next: instanceForWeek(w + 1) };
  }
  // before this week's Friday -> next is this week's; after -> next week's
  const next = now < cur.start ? cur : instanceForWeek(w + 1);
  // the previous week's event may still run until Monday 00:00
  const prev = instanceForWeek(w - 1);
  if (now >= prev.start && now < prev.end) {
    prev.active = true;
    return { current: prev, next };
  }
  return { current: null, next };
}

/** True if the next event starts during the next calendar day (for teasers). */
export function startsTomorrow(next: EventInstance, now = new Date()): boolean {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const after = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
  return next.start >= tomorrow && next.start < after;
}
