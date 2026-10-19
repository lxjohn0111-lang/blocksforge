// Progression service: XP & levels, coins, ranked RP, seasons, daily rewards,
// daily quests, limited-time event challenges, achievements, shop and the
// simulated ladder. Applies match results and persists everything.

import { loadProfile, saveProfile, xpForLevel, profileSalt, type Profile, type HistoryEntry } from './profile';
import { generateQuests, statFromResult } from './quests';
import { dayKey, nextMidnight, daysBetween } from './calendar';
import { computeRP, rankOf, seasonAt, softReset, TIERS, type RPBreakdown } from './ranks';
import { eventStatus, startsTomorrow, type EventInstance, type EventChallenge } from './events';
import { ACHIEVEMENTS, type Achievement } from './achievements';
import { catalog, cosmeticName, cosmeticRarity, LEVEL_UNLOCKS, type Cosmetic } from './cosmetics';
import { getPool, savePool, recordBotResult } from './botPool';
import type { MatchResult } from '../game/match';
import { RNG, hashString } from '../core/rng';

export interface Reward {
  kind: 'coins' | 'xp' | 'cosmetic';
  id?: string;
  amount?: number;
  label: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  duplicate?: boolean;
}

export interface LevelUp {
  level: number;
  rewards: Reward[];
}

export interface ResultSummary {
  xpLines: { label: string; value: number }[];
  xpTotal: number;
  levelBefore: number;
  xpBefore: number;
  levelAfter: number;
  xpAfter: number;
  levelUps: LevelUp[];
  coins: number;
  coinLines: { label: string; value: number }[];
  rp: RPBreakdown | null;
  quests: { text: string; progress: number; target: number; done: boolean; justDone: boolean }[];
  achievements: Achievement[];
  eventLines: { text: string; progress: number; target: number; justDone: boolean }[];
  teaser: EventInstance | null;
  entry: HistoryEntry;
}

export const DAILY_TRACK: { label: string; reward: string }[] = [
  { label: '250 Coins', reward: 'coins:250' },
  { label: 'Neon Raider', reward: 'outfit:neon_raider' },
  { label: 'Inferno Camo', reward: 'camo:inferno' },
  { label: 'Dusk Banner', reward: 'banner:dusk' },
  { label: '500 Coins', reward: 'coins:500' },
  { label: '1,500 XP', reward: 'xp:1500' },
  { label: 'Inferno Knight', reward: 'outfit:inferno_knight' },
];

export class Meta {
  p: Profile;
  constructor() {
    this.p = loadProfile();
    this.refreshDaily();
    this.checkSeason();
    this.save();
  }

  save() {
    saveProfile(this.p);
    savePool();
  }

  // ------------------------------------------------------------ cosmetics
  owns(id: string) {
    return this.p.owned.includes(id);
  }

  /** Grant a reward string; duplicate cosmetics convert to coins. */
  grant(reward: string): Reward {
    const [kind, val] = reward.split(':');
    if (kind === 'coins') {
      const n = parseInt(val, 10);
      this.p.coins += n;
      return { kind: 'coins', amount: n, label: `${n.toLocaleString()} Coins`, rarity: n >= 400 ? 'rare' : 'common' };
    }
    if (kind === 'xp') {
      const n = parseInt(val, 10);
      this.addXp(n);
      return { kind: 'xp', amount: n, label: `${n.toLocaleString()} XP`, rarity: 'common' };
    }
    if (kind === 'title') {
      if (!this.owns(reward)) this.p.owned.push(reward);
      return { kind: 'cosmetic', id: reward, label: cosmeticName(reward), rarity: 'rare' };
    }
    if (this.owns(reward)) {
      const comp = { common: 150, rare: 300, epic: 500, legendary: 800 }[cosmeticRarity(reward)];
      this.p.coins += comp;
      return { kind: 'coins', amount: comp, label: `${cosmeticName(reward)} (owned) → ${comp} Coins`, rarity: cosmeticRarity(reward), duplicate: true };
    }
    this.p.owned.push(reward);
    return { kind: 'cosmetic', id: reward, label: cosmeticName(reward), rarity: cosmeticRarity(reward) };
  }

  equip(kind: 'camo' | 'outfit' | 'banner' | 'title', key: string) {
    if (!this.owns(`${kind}:${key}`)) return false;
    this.p.equipped[kind] = key;
    this.save();
    return true;
  }

  // ------------------------------------------------------------ xp / levels
  addXp(n: number): LevelUp[] {
    const ups: LevelUp[] = [];
    this.p.xp += Math.round(n);
    while (this.p.xp >= xpForLevel(this.p.level)) {
      this.p.xp -= xpForLevel(this.p.level);
      this.p.level++;
      const rewards: Reward[] = [this.grant('coins:100')];
      const unlock = LEVEL_UNLOCKS[this.p.level];
      if (unlock) rewards.push(this.grant(unlock));
      ups.push({ level: this.p.level, rewards });
    }
    return ups;
  }

  // ------------------------------------------------------------ daily reward
  dailyStatus() {
    const today = dayKey();
    const claimed = this.p.daily.lastClaim === today;
    // guard against clocks moving backwards: no claims if last claim is in the future
    const future = this.p.daily.lastClaim ? daysBetween(today, this.p.daily.lastClaim) > 0 : false;
    return {
      claimable: !claimed && !future,
      day: this.p.daily.day % 7,
      claimedToday: claimed,
      nextReset: nextMidnight(),
      track: DAILY_TRACK,
    };
  }

  claimDaily(): Reward | null {
    const st = this.dailyStatus();
    if (!st.claimable) return null;
    const entry = DAILY_TRACK[st.day];
    const r = this.grant(entry.reward);
    this.p.daily.lastClaim = dayKey();
    this.p.daily.day = (this.p.daily.day + 1) % 7;
    this.p.daily.total++;
    this.save();
    return r;
  }

  // ------------------------------------------------------------ quests
  refreshDaily() {
    const today = dayKey();
    if (this.p.quests.date !== today) {
      this.p.quests = { date: today, list: generateQuests(today, profileSalt(this.p)), rerolls: 0 };
    }
    if (this.p.shop.date !== today) this.p.shop = { date: today, bought: [] };
  }

  rerollQuest(i: number): boolean {
    if (this.p.quests.rerolls >= 1) return false;
    const q = this.p.quests.list[i];
    if (!q || q.claimed || q.progress >= q.target) return false;
    const fresh = generateQuests(this.p.quests.date, profileSalt(this.p), 7 + i).find((n) => !this.p.quests.list.some((o) => o.id === n.id));
    if (!fresh) return false;
    this.p.quests.list[i] = fresh;
    this.p.quests.rerolls++;
    this.save();
    return true;
  }

  claimQuest(i: number): Reward[] {
    const q = this.p.quests.list[i];
    if (!q || q.claimed || q.progress < q.target) return [];
    q.claimed = true;
    const out = [this.grant(`coins:${q.coins}`)];
    const before = this.p.level;
    const ups = this.addXp(q.xp);
    out.push({ kind: 'xp', amount: q.xp, label: `${q.xp} XP`, rarity: 'common' });
    for (const u of ups) out.push(...u.rewards);
    void before;
    this.save();
    return out;
  }

  // ------------------------------------------------------------ season
  season() {
    return seasonAt();
  }

  checkSeason() {
    const s = seasonAt();
    const r = this.p.rank;
    if (r.season === s.number) return;
    if (r.season < s.number) {
      // rewards for the previous season's peak
      const peakTier = rankOf(r.seasonPeak).tier;
      const rewards: Reward[] = [];
      if (r.seasonPeak > 0) {
        rewards.push(this.grant(`coins:${(peakTier + 1) * 250}`));
        for (let t = 1; t <= peakTier; t++) {
          const camo = TIERS[t].camo;
          if (camo) rewards.push(this.grant(`camo:${camo}`));
        }
        if (peakTier >= 3) rewards.push(this.grant('outfit:vanguard'));
        if (peakTier >= 6) rewards.push(this.grant('banner:void'));
        this.p.seasonRewards.push({ season: r.season, tier: peakTier, claimed: true });
      }
      const before = r.rp;
      r.rp = softReset(r.rp);
      r.shield = 0;
      r.seasonPeak = r.rp;
      this.p.notices.push({ kind: 'season', data: { from: r.season, to: s.number, name: s.name, peakTier, rewards, before, after: r.rp } });
      // AI ladder resets too
      for (const e of getPool()) {
        e.state.rp = softReset(e.state.rp);
        e.ident.rp = e.state.rp;
      }
    }
    r.season = s.number;
  }

  // ------------------------------------------------------------ events
  events() {
    const st = eventStatus();
    const cur = st.current;
    let progress: Record<string, number> = {};
    let claimed: string[] = [];
    if (cur) {
      const rec = this.p.events[cur.key];
      progress = rec?.progress ?? {};
      claimed = rec?.claimed ?? [];
    }
    return { ...st, progress, claimed };
  }

  claimEvent(ch: EventChallenge): Reward | null {
    const st = eventStatus();
    const cur = st.current;
    if (!cur || !cur.def.challenges.includes(ch)) return null;
    const rec = (this.p.events[cur.key] ??= { progress: {}, claimed: [] });
    if (rec.claimed.includes(ch.id) || (rec.progress[ch.id] ?? 0) < ch.target) return null;
    rec.claimed.push(ch.id);
    const r = this.grant(ch.reward);
    this.save();
    return r;
  }

  eventMods() {
    return eventStatus().current?.def.mods ?? {};
  }

  // ------------------------------------------------------------ shop
  shopItems(): Cosmetic[] {
    const today = dayKey();
    const r = new RNG(hashString('armory' + today));
    const pool = catalog().filter((c) => c.price !== undefined);
    r.shuffle(pool);
    // feature: 2 camos, 2 outfits, 2 banners when available
    const pick = (k: string, n: number) => pool.filter((c) => c.kind === k).slice(0, n);
    return [...pick('outfit', 2), ...pick('camo', 3), ...pick('banner', 1)];
  }

  buy(id: string): Reward | 'owned' | 'funds' | 'unavailable' {
    const item = this.shopItems().find((c) => c.id === id);
    if (!item || item.price === undefined) return 'unavailable';
    if (this.owns(id)) return 'owned';
    if (this.p.coins < item.price) return 'funds';
    this.p.coins -= item.price;
    this.p.shop.bought.push(id);
    const r = this.grant(id);
    this.save();
    return r;
  }

  // ------------------------------------------------------------ achievements
  checkAchievements(): Achievement[] {
    const out: Achievement[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.p.achievements[a.id]) continue;
      if (a.check(this.p)) {
        this.p.achievements[a.id] = Date.now();
        this.grant(`coins:${a.coins}`);
        if (!a.reward.startsWith('coins')) this.grant(a.reward);
        out.push(a);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ ladder
  ladder() {
    const pool = getPool();
    const rows = pool.map((e) => ({ id: e.ident.id, name: e.ident.name, rp: e.state.rp, level: e.state.level, isPlayer: false, wins: e.state.wins, matches: e.state.matches, ident: e.ident }));
    rows.push({ id: 'player', name: this.p.name, rp: this.p.rank.rp, level: this.p.level, isPlayer: true, wins: this.p.stats.wins, matches: this.p.stats.matches, ident: null as any });
    rows.sort((a, b) => b.rp - a.rp || (a.isPlayer ? -1 : 1));
    return rows;
  }

  // ------------------------------------------------------------ results
  applyResult(r: MatchResult): ResultSummary {
    const p = this.p;
    this.refreshDaily();
    const mods = this.eventMods();
    const s = r.stats;
    const xpLines: { label: string; value: number }[] = [];
    const coinLines: { label: string; value: number }[] = [];
    const levelBefore = p.level;
    const xpBefore = p.xp;
    const longshots = s.longestKill >= 50 ? 1 : 0;
    if (r.mode === 'tutorial') {
      const first = !p.tutorialDone && r.won;
      if (r.won) p.tutorialDone = true;
      xpLines.push({ label: r.won ? 'Training complete' : 'Training progress', value: r.won ? (first ? 1200 : 200) : 100 });
      coinLines.push({ label: first ? 'First completion' : 'Training', value: first ? 300 : 0 });
    } else {
      xpLines.push({ label: 'Match played', value: 120 });
      if (s.kills) xpLines.push({ label: `Eliminations ×${s.kills}`, value: s.kills * 60 });
      if (s.assists) xpLines.push({ label: `Assists ×${s.assists}`, value: s.assists * 25 });
      if (s.damage) xpLines.push({ label: `Damage ${Math.round(s.damage)}`, value: Math.round(s.damage / 10) });
      if (s.headshots) xpLines.push({ label: `Headshots ×${s.headshots}`, value: s.headshots * 10 });
      if (r.mode === 'br') {
        const pl = r.placement;
        const v = pl === 1 ? 650 : pl <= 3 ? 350 : pl <= 5 ? 250 : pl <= 10 ? 150 : 50;
        xpLines.push({ label: pl === 1 ? 'Victory' : `Placed #${pl}`, value: v });
        xpLines.push({ label: 'Survival', value: Math.round((r.survived / 60) * 12) });
        coinLines.push({ label: 'Match', value: 40 });
        if (pl === 1) coinLines.push({ label: 'Victory', value: 200 });
        else if (pl <= 5) coinLines.push({ label: 'Top 5', value: 80 });
        else if (pl <= 10) coinLines.push({ label: 'Top 10', value: 40 });
      } else {
        xpLines.push({ label: r.won ? 'Victory' : r.draw ? 'Draw' : 'Defeat', value: r.won ? 300 : r.draw ? 150 : 100 });
        if (r.mvp === p.name) xpLines.push({ label: 'Match MVP', value: 120 });
        coinLines.push({ label: 'Match', value: 40 });
        if (r.won) coinLines.push({ label: 'Victory', value: 60 });
      }
      if (s.kills) coinLines.push({ label: 'Eliminations', value: s.kills * 10 });
      if (r.ranked) xpLines.push({ label: 'Ranked bonus', value: Math.round(xpLines.reduce((a, b) => a + b.value, 0) * 0.1) });
      const mult = (mods.xpMult ?? 1) * (r.mode === 'tdm' ? mods.tdmXpMult ?? 1 : 1);
      if (mult > 1) xpLines.push({ label: `Event bonus ×${mult}`, value: Math.round(xpLines.reduce((a, b) => a + b.value, 0) * (mult - 1)) });
    }
    const xpTotal = xpLines.reduce((a, b) => a + b.value, 0);
    const coins = coinLines.reduce((a, b) => a + b.value, 0);
    p.coins += coins;
    const levelUps = this.addXp(xpTotal);

    // ranked
    let rp: RPBreakdown | null = null;
    if (r.ranked && r.mode !== 'tutorial') {
      rp = computeRP(p.rank.rp, r, p.rank.shield);
      const tierBefore = rankOf(p.rank.rp).tier;
      p.rank.rp = rp.after;
      p.rank.peakRp = Math.max(p.rank.peakRp, rp.after);
      p.rank.seasonPeak = Math.max(p.rank.seasonPeak, rp.after);
      const tierAfter = rankOf(rp.after).tier;
      if (tierAfter > tierBefore) p.rank.shield = 3;
      else if (p.rank.shield > 0) p.rank.shield--;
      p.stats.rankedMatches++;
      if (r.won) p.stats.rankedWins++;
    }

    // lifetime stats
    const L = p.stats;
    if (r.mode !== 'tutorial') {
      L.matches++;
      if (r.won) L.wins++;
      else if (!r.draw) L.losses++;
      L.kills += s.kills;
      L.deaths += s.deaths;
      L.assists += s.assists;
      L.damage += Math.round(s.damage);
      L.shots += s.shots;
      L.hits += s.hits;
      L.headshots += s.headshots;
      L.built += s.built;
      L.destroyed += s.destroyed;
      L.chests += s.chests;
      L.crafted += s.crafted;
      L.harvested += s.harvested;
      L.grenadeKills += s.grenadeKills;
      L.longestKill = Math.max(L.longestKill, s.longestKill);
      L.playtime += r.duration;
      if (r.mode === 'br') {
        L.brMatches++;
        if (r.won) L.brWins++;
        if (r.placement <= 5) L.top5++;
        if (r.placement <= 10) L.top10++;
        if (r.won && s.kills >= 6 && !p.flags.includes('apex')) p.flags.push('apex');
      } else {
        L.tdmMatches++;
        if (r.won) L.tdmWins++;
      }
    }

    // quests
    const quests = p.quests.list.map((q) => {
      const was = q.progress >= q.target;
      if (!q.claimed) q.progress = Math.min(q.target, q.progress + statFromResult(q.stat, r, longshots));
      const done = q.progress >= q.target;
      return { text: q.text, progress: q.progress, target: q.target, done, justDone: done && !was };
    });

    // events
    const ev = eventStatus();
    const eventLines: ResultSummary['eventLines'] = [];
    if (ev.current && r.mode !== 'tutorial') {
      const rec = (p.events[ev.current.key] ??= { progress: {}, claimed: [] });
      for (const ch of ev.current.def.challenges) {
        const before = rec.progress[ch.id] ?? 0;
        let add = 0;
        switch (ch.stat) {
          case 'kills': add = s.kills; break;
          case 'chests': add = s.chests; break;
          case 'top5': add = r.mode === 'br' && r.placement <= 5 ? 1 : 0; break;
          case 'wins': add = r.won ? 1 : 0; break;
          case 'matches': add = 1; break;
          case 'damage': add = Math.round(s.damage); break;
          case 'headshots': add = s.headshots; break;
          case 'built': add = s.built; break;
          case 'tdmWins': add = r.mode === 'tdm' && r.won ? 1 : 0; break;
        }
        rec.progress[ch.id] = Math.min(ch.target, before + add);
        eventLines.push({ text: ch.text, progress: rec.progress[ch.id], target: ch.target, justDone: before < ch.target && rec.progress[ch.id] >= ch.target });
      }
    }

    // history
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const entry: HistoryEntry = {
      t: Date.now(), mode: r.mode, ranked: r.ranked, map: r.mapName, won: r.won, draw: r.draw, placement: r.placement, participants: r.participants,
      kills: s.kills, deaths: s.deaths, assists: s.assists, damage: Math.round(s.damage), accuracy: acc, rpDelta: rp ? rp.total : null, xp: xpTotal,
      score: r.teamScores ? `${r.teamScores[0]}–${r.teamScores[1]}` : undefined, duration: Math.round(r.duration),
    };
    if (r.mode !== 'tutorial') {
      p.history.unshift(entry);
      p.history = p.history.slice(0, 30);
    }

    // simulated competitors' careers
    if (r.mode !== 'tutorial') {
      for (const row of r.roster) {
        if (row.isPlayer || !row.identId.startsWith('bot_')) continue;
        let won = false;
        let delta = 0;
        if (r.mode === 'br') {
          won = row.placement === 1;
          if (r.ranked) delta = (row.placement <= 1 ? 70 : row.placement <= 5 ? 35 : row.placement <= 10 ? 15 : -12) + row.kills * 6;
        } else {
          const myTeamWon = r.won ? row.team === r.playerTeam : !r.draw && row.team !== r.playerTeam;
          won = myTeamWon;
          if (r.ranked) delta = r.draw ? 0 : myTeamWon ? 22 : -18;
        }
        recordBotResult(row.identId, r.mode, row.placement, row.kills, won, delta);
      }
    }

    const achievements = this.checkAchievements();
    const teaser = !ev.current && startsTomorrow(ev.next) ? ev.next : null;
    this.save();
    return {
      xpLines, xpTotal, levelBefore, xpBefore, levelAfter: p.level, xpAfter: p.xp, levelUps, coins, coinLines, rp, quests, achievements,
      eventLines, teaser, entry,
    };
  }

  markStreak5() {
    if (!this.p.flags.includes('streak5')) this.p.flags.push('streak5');
  }

  /** the first-run Basics tutorial was played or skipped (players who already have matches skip it) */
  get basicsDone() {
    const p = this.p;
    return p.flags.includes('basics') || p.tutorialDone || p.stats.matches > 0;
  }

  /** Basics finished or skipped; returns the coins granted (first completion only) */
  completeBasics(won: boolean): number {
    const p = this.p;
    const first = won && !p.flags.includes('basics_reward');
    if (!p.flags.includes('basics')) p.flags.push('basics');
    if (first) {
      p.flags.push('basics_reward');
      p.coins += 100;
    }
    this.save();
    return first ? 100 : 0;
  }
}
