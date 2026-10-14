import type { Profile } from './profile';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  reward: string; // 'coins:300' | 'title:X' | 'banner:x' | 'camo:x'
  coins: number;
  check: (p: Profile) => boolean;
  progress?: (p: Profile) => [number, number];
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'training', name: 'Boots on the Ground', desc: 'Complete the training course', reward: 'title:Rookie', coins: 200, check: (p) => p.tutorialDone },
  { id: 'first_blood', name: 'First Blood', desc: 'Get your first elimination', reward: 'coins:150', coins: 150, check: (p) => p.stats.kills >= 1 },
  { id: 'first_win', name: 'Last Block Standing', desc: 'Win a Battle Royale match', reward: 'title:Last Block Standing', coins: 500, check: (p) => p.stats.brWins >= 1 },
  { id: 'tdm_win', name: 'Team Player', desc: 'Win a Team Deathmatch match', reward: 'coins:250', coins: 250, check: (p) => p.stats.tdmWins >= 1 },
  { id: 'sharpshooter', name: 'Sharpshooter', desc: 'Land 50 headshots', reward: 'title:Sharpshooter', coins: 300, check: (p) => p.stats.headshots >= 50, progress: (p) => [p.stats.headshots, 50] },
  { id: 'marksman', name: 'Marksman', desc: 'Get an elimination from 100m or more', reward: 'title:Marksman', coins: 400, check: (p) => p.stats.longestKill >= 100, progress: (p) => [Math.round(p.stats.longestKill), 100] },
  { id: 'architect', name: 'Architect', desc: 'Place 100 build pieces', reward: 'banner:circuit', coins: 300, check: (p) => p.stats.built >= 100, progress: (p) => [p.stats.built, 100] },
  { id: 'demolisher', name: 'Demolisher', desc: 'Destroy 150 player-built blocks', reward: 'title:Demolisher', coins: 300, check: (p) => p.stats.destroyed >= 150, progress: (p) => [p.stats.destroyed, 150] },
  { id: 'scavenger', name: 'Scavenger', desc: 'Open 40 supply chests', reward: 'title:Scavenger', coins: 300, check: (p) => p.stats.chests >= 40, progress: (p) => [p.stats.chests, 40] },
  { id: 'crafter', name: 'Tinkerer', desc: 'Craft 40 items', reward: 'coins:300', coins: 300, check: (p) => p.stats.crafted >= 40, progress: (p) => [p.stats.crafted, 40] },
  { id: 'survivor', name: 'Survivor', desc: 'Finish top 5 ten times', reward: 'title:Survivor', coins: 400, check: (p) => p.stats.top5 >= 10, progress: (p) => [p.stats.top5, 10] },
  { id: 'grenadier', name: 'Grenadier', desc: 'Get 10 grenade eliminations', reward: 'title:Grenadier', coins: 300, check: (p) => p.stats.grenadeKills >= 10, progress: (p) => [p.stats.grenadeKills, 10] },
  { id: 'centurion', name: 'Centurion', desc: 'Get 100 eliminations', reward: 'title:Centurion', coins: 600, check: (p) => p.stats.kills >= 100, progress: (p) => [p.stats.kills, 100] },
  { id: 'veteran', name: 'Veteran', desc: 'Play 50 matches', reward: 'title:Veteran', coins: 500, check: (p) => p.stats.matches >= 50, progress: (p) => [p.stats.matches, 50] },
  { id: 'apex', name: 'Apex', desc: 'Win Battle Royale with 6+ eliminations', reward: 'title:Apex', coins: 800, check: (p) => p.flags.includes('apex') },
  { id: 'streak', name: 'On Fire', desc: 'Get a 5-elimination streak in Team Deathmatch', reward: 'coins:300', coins: 300, check: (p) => p.flags.includes('streak5') },
  { id: 'level10', name: 'Seasoned', desc: 'Reach level 10', reward: 'coins:400', coins: 400, check: (p) => p.level >= 10, progress: (p) => [p.level, 10] },
  { id: 'level25', name: 'Hardened', desc: 'Reach level 25', reward: 'title:Tactician', coins: 800, check: (p) => p.level >= 25, progress: (p) => [p.level, 25] },
  { id: 'gold', name: 'Struck Gold', desc: 'Reach Gold rank', reward: 'outfit:vanguard', coins: 500, check: (p) => p.rank.peakRp >= 1200, progress: (p) => [p.rank.peakRp, 1200] },
  { id: 'obsidian', name: 'Into the Void', desc: 'Reach Obsidian rank', reward: 'banner:void', coins: 1500, check: (p) => p.rank.peakRp >= 2400, progress: (p) => [p.rank.peakRp, 2400] },
];
