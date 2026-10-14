import { h, clear, fmt, timeAgo } from './dom';
import { ICON, rankEmblem, avatarCanvas, logoMark } from './icons';
import type { Meta, Reward } from '../meta/meta';
import { DAILY_TRACK } from '../meta/meta';
import { rankOf, TIERS, DIV_NAMES } from '../meta/ranks';
import { xpForLevel } from '../meta/profile';
import { catalog, OUTFITS, BANNERS, TITLES, composeLook, cosmeticName, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, type Cosmetic } from '../meta/cosmetics';
import { CAMOS, camoCss } from '../render/camos';
import { ACHIEVEMENTS } from '../meta/achievements';
import { TDM_MAPS } from '../world/maps/tdmMaps';
import { LOADOUTS } from '../game/tdmMatch';
import { WEAPONS } from '../game/weapons';
import { fmtDuration } from '../core/mathx';
import { audio } from '../audio/audio';
import { weaponCanvas } from './hud';
import { persistent } from '../meta/profile';
import type { Identity } from '../game/combatant';
import { ARCHETYPE_LABEL } from '../game/ai/personality';
import { getPool } from '../meta/botPool';
import { eventStatus } from '../meta/events';

export interface PlaySelection {
  mode: 'br' | 'tdm' | 'tutorial';
  ranked: boolean;
  tdmMap: string;
  loadout: string;
}

export interface MenuApi {
  meta: Meta;
  play(sel: PlaySelection): void;
  openSettings(): void;
  setMenuView(v: 'orbit' | 'showcase'): void;
  refreshShowcase(): void;
}

type Tab = 'play' | 'career' | 'locker' | 'armory' | 'ladder';

export function playerCard(ident: Identity, opts: { emblem?: boolean; ai?: boolean; extra?: string } = {}): HTMLElement {
  const banner = BANNERS[ident.banner] ?? BANNERS.stone;
  const r = rankOf(ident.rp);
  return h(
    'div',
    { class: 'pcard' },
    h('div', { class: 'bg', style: { background: banner.css } }),
    avatarCanvas(ident.look, 44),
    h('div', { class: 'col', style: { gap: '2px', minWidth: '0' } },
      h('div', { class: 'nm' }, ident.name),
      h('div', { class: 'tl' }, `${ident.title} · LV ${ident.level}`),
      opts.extra ? h('div', { class: 'tl', style: { color: '#ffffff80' } }, opts.extra) : null),
    h('div', { class: 'em row', style: { gap: '6px' } },
      opts.ai ? h('span', { class: 'chip ai' }, 'AI') : null,
      opts.emblem !== false ? h('span', { html: rankEmblem(r.tier, r.division, 30), title: r.label }) : null),
  );
}

export function rewardArt(rw: Reward | { id?: string; kind: string; amount?: number }): HTMLElement {
  if (rw.kind === 'coins') return h('div', { html: ICON.coin(56) });
  if (rw.kind === 'xp') return h('div', { style: { color: '#7fd0ff' }, html: ICON.xp(56) });
  const id = rw.id ?? '';
  const [kind, key] = id.split(':');
  if (kind === 'camo') {
    const c = CAMOS[key];
    const wrap = h('div', { style: { width: '140px', height: '64px', display: 'grid', placeItems: 'center' } });
    wrap.appendChild(weaponCanvas('ranger', 140, 54));
    const sw = h('div', { style: { width: '120px', height: '12px', marginTop: '4px', background: c ? camoCss(c) : '#333', clipPath: 'var(--chamfer-sm)' } });
    return h('div', { class: 'col', style: { alignItems: 'center', gap: '0' } }, wrap, sw);
  }
  if (kind === 'outfit') {
    const look = composeLook({ skin: 0xe0ac86, hair: 0x3a2414, hairStyle: 'short', eyes: 0x3a6a2a }, key);
    return h('div', { class: 'row', style: { gap: '6px' } }, avatarCanvas(look, 64), h('div', { style: { width: '26px', height: '64px', background: `linear-gradient(#${(look.jacket ?? look.shirt).toString(16).padStart(6, '0')}, #${look.pants.toString(16).padStart(6, '0')})`, clipPath: 'var(--chamfer-sm)' } }));
  }
  if (kind === 'banner') return h('div', { style: { width: '130px', height: '60px', background: BANNERS[key]?.css ?? '#333', clipPath: 'var(--chamfer-sm)' } });
  if (kind === 'title') return h('div', { style: { fontFamily: 'var(--display)', fontSize: '18px' } }, key);
  return h('div', null, '?');
}

// Reveals (rewards, promotions, level-ups) play one at a time: each waits for the previous
// Continue instead of stacking on top of it.
const revealQueue: { box: HTMLElement; parent: HTMLElement }[] = [];
let revealActive: HTMLElement | null = null;

function pumpReveals() {
  if (revealActive?.isConnected) return;
  revealActive = null;
  while (revealQueue.length) {
    const next = revealQueue.shift()!;
    if (!next.parent.isConnected) continue;
    next.parent.appendChild(next.box);
    revealActive = next.box;
    audio.ui('reward', 0.9);
    return;
  }
}

/** Drop pending and visible reveals (when the screen that queued them closes). */
export function clearReveals() {
  revealQueue.length = 0;
  revealActive?.remove();
  revealActive = null;
}

export function showReveal(parent: HTMLElement, kicker: string, title: string, rewards: Reward[], onDone?: () => void, extra?: HTMLElement) {
  const box = h('div', { class: 'reveal' }, h('div', { class: 'rays' }), h('div', { class: 'kicker' }, kicker), h('div', { class: 'big' }, title));
  if (extra) box.appendChild(extra);
  const items = h('div', { class: 'items' });
  rewards.forEach((r, i) => {
    const card = h('div', { class: `rcard rb-${r.rarity}`, style: { animationDelay: `${0.15 + i * 0.12}s` } }, h('div', { class: 'art' }, rewardArt(r)), h('div', { class: 'nm' }, r.label), h('div', { class: `rr rar-${r.rarity}` }, r.duplicate ? 'Duplicate' : r.rarity));
    items.appendChild(card);
  });
  if (rewards.length) box.appendChild(items);
  const btn = h('button', { class: 'btn primary big', onclick: () => { audio.ui('click'); box.remove(); onDone?.(); pumpReveals(); } }, 'Continue');
  box.appendChild(btn);
  revealQueue.push({ box, parent });
  pumpReveals();
  return box;
}

export class Menu {
  root: HTMLElement;
  tab: Tab = 'play';
  sel: PlaySelection;
  private body!: HTMLElement;
  private timers: (() => void)[] = [];
  private tick = 0;
  private lockerCat: 'outfit' | 'camo' | 'banner' | 'title' | 'look' = 'outfit';

  constructor(public parent: HTMLElement, public api: MenuApi) {
    const p = api.meta.p;
    this.sel = { mode: p.tutorialDone ? 'br' : 'tutorial', ranked: false, tdmMap: 'rotation', loadout: p.lastLoadout || 'assault' };
    this.root = h('div', { class: 'screen menu' });
    parent.appendChild(this.root);
    this.render();
    this.tick = window.setInterval(() => this.timers.forEach((f) => f()), 1000);
    // pending notices (season reset etc.)
    setTimeout(() => this.showNotices(), 300);
  }

  dispose() {
    clearInterval(this.tick);
    this.root.remove();
  }

  render() {
    clear(this.root);
    this.timers = [];
    this.root.appendChild(this.topbar());
    this.body = h('div', { style: { flex: '1', display: 'flex', minHeight: '0' } });
    this.root.appendChild(this.body);
    switch (this.tab) {
      case 'play':
        this.renderPlay();
        break;
      case 'career':
        this.renderCareer();
        break;
      case 'locker':
        this.renderLocker();
        break;
      case 'armory':
        this.renderArmory();
        break;
      case 'ladder':
        this.renderLadder();
        break;
    }
    this.api.setMenuView(this.tab === 'locker' ? 'showcase' : 'orbit');
  }

  private topbar() {
    const p = this.api.meta.p;
    const tabs: [Tab, string][] = [['play', 'Play'], ['career', 'Career'], ['locker', 'Locker'], ['armory', 'Armory'], ['ladder', 'Ladder']];
    const need = xpForLevel(p.level);
    return h(
      'div',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { html: logoMark(30) }), h('span', null, 'BLOCK', h('b', null, 'FORGE'))),
      h('div', { class: 'tabs' }, ...tabs.map(([t, l]) => h('button', { class: 'tab' + (this.tab === t ? ' on' : ''), onclick: () => { audio.ui('click', 0.5); this.tab = t; this.render(); }, onmouseenter: () => audio.ui('hover', 0.3) }, l))),
      h('div', { class: 'wallet' },
        h('div', { class: 'coin', title: 'Forge Coins — earned by playing. Spend them in the Armory.' }, h('span', { html: ICON.coin(18) }), fmt(p.coins)),
        h('div', { class: 'lvl', title: `${fmt(p.xp)} / ${fmt(need)} XP` }, h('div', { class: 'badge' }, String(p.level)), h('div', { class: 'col', style: { gap: '3px' } }, h('div', { class: 'label', style: { fontSize: '9.5px' } }, `${fmt(p.xp)} / ${fmt(need)} XP`), h('div', { class: 'bar xpbar' }, h('i', { style: { width: `${(p.xp / need) * 100}%` } })))),
        h('div', { class: 'row', style: { cursor: 'pointer' }, onclick: () => this.editName(), title: 'Change name' }, avatarCanvas(composeLook(p.base, p.equipped.outfit), 34), h('div', { class: 'col', style: { gap: '0' } }, h('b', { style: { fontSize: '13px' } }, p.name), h('span', { class: 'dim', style: { fontSize: '10.5px', letterSpacing: '0.08em', textTransform: 'uppercase' } }, p.equipped.title))),
        h('div', { class: 'iconbtn', onclick: () => this.api.openSettings(), title: 'Settings', html: ICON.gear(18) }),
      ),
    );
  }

  // ------------------------------------------------------------ PLAY
  private renderPlay() {
    const meta = this.api.meta;
    const p = meta.p;
    const wrap = h('div', { class: 'menu-body', style: { flex: '1' } });
    this.body.appendChild(wrap);
    // left: modes
    const left = h('div', { class: 'menu-left' });
    const modes: [PlaySelection['mode'], string, string, string[]][] = [
      ['br', 'Battle Royale', '24 players drop onto Ashcrown Isle. Loot, build, craft — outlast the storm.', ['24 players', 'Building', 'Crafting', 'Storm']],
      ['tdm', 'Team Deathmatch', '6v6 on handcrafted arenas. First team to 50 eliminations wins.', ['6 v 6', 'Loadouts', 'Respawns', '8 min']],
      ['tutorial', 'Training Grounds', 'Learn aiming, looting, building and crafting in a guided course.', p.tutorialDone ? ['Completed', 'Practice'] : ['Recommended', '+300 coins']],
    ];
    for (const [id, title, sub, tags] of modes) {
      left.appendChild(
        h('div', { class: 'modecard panel' + (this.sel.mode === id ? ' on' : ''), onclick: () => { audio.ui('click', 0.5); this.sel.mode = id; if (id === 'tutorial') this.sel.ranked = false; this.render(); }, onmouseenter: () => audio.ui('hover', 0.25) },
          h('div', { class: 'art', html: id === 'br' ? ICON.storm(120) : id === 'tdm' ? ICON.people(120) : ICON.crosshair(120) }),
          h('div', { class: 'title' }, title),
          h('div', { class: 'sub' }, sub),
          h('div', { class: 'meta' }, ...tags.map((t) => h('span', { class: 'chip' }, t)))),
      );
    }
    if (this.sel.mode !== 'tutorial') {
      const rk = rankOf(p.rank.rp);
      left.appendChild(
        h('div', { class: 'seg' },
          h('button', { class: !this.sel.ranked ? 'on' : '', onclick: () => { this.sel.ranked = false; this.render(); } }, 'Casual'),
          h('button', { class: this.sel.ranked ? 'on rk' : '', onclick: () => { this.sel.ranked = true; this.render(); } }, `Ranked · ${rk.label}`)),
      );
      left.appendChild(h('div', { class: 'honesty' }, h('span', { html: ICON.info(14) }), this.sel.ranked ? 'Ranked: ladder points (RP) change after every match. Opponents are matched to your rank — higher divisions bring smarter, more coordinated AI.' : 'Casual: relaxed AI competitors, full XP and quest progress, no RP at stake.'));
    }
    if (this.sel.mode === 'tdm') {
      const st = eventStatus();
      const featured = st.current?.def.mods.featuredMap;
      left.appendChild(h('div', { class: 'label' }, 'Map'));
      left.appendChild(
        h('div', { class: 'seg' },
          h('button', { class: this.sel.tdmMap === 'rotation' ? 'on' : '', onclick: () => { this.sel.tdmMap = 'rotation'; this.render(); } }, 'Rotation'),
          ...TDM_MAPS.map((mm) => h('button', { class: this.sel.tdmMap === mm.id ? 'on' : '', title: mm.blurb, onclick: () => { this.sel.tdmMap = mm.id; this.render(); } }, mm.name + (featured === mm.id ? ' ★' : '')))),
      );
      left.appendChild(h('div', { class: 'label' }, 'Loadout'));
      const lo = h('div', { class: 'loadouts', style: { justifyContent: 'flex-start' } });
      for (const l of LOADOUTS) {
        lo.appendChild(h('div', { class: 'loadout' + (this.sel.loadout === l.id ? ' on' : ''), style: { width: '30%' }, title: l.blurb, onclick: () => { this.sel.loadout = l.id; meta.p.lastLoadout = l.id; meta.save(); this.render(); } },
          h('div', { class: 'ln' }, l.name), weaponCanvas(l.primary, 120, 36), h('div', { class: 'lw' }, `${WEAPONS[l.primary].short} · ${WEAPONS[l.secondary].short}`)));
      }
      left.appendChild(lo);
    }
    const play = h('div', { class: 'playbar' },
      h('button', { class: 'btn primary big', onclick: () => { audio.ui('confirm'); this.api.play({ ...this.sel }); }, onmouseenter: () => audio.ui('hover', 0.3) }, h('span', { html: ICON.play(18) }), this.sel.mode === 'tutorial' ? 'Start training' : 'Find match'),
      h('div', { class: 'honesty' }, h('span', { html: ICON.people(14) }), 'Every other player in BlockForge is an AI competitor with a persistent profile, rank and play style. No account or connection needed.'),
      !persistent() ? h('div', { class: 'honesty', style: { color: '#ffb3a8' } }, h('span', { html: ICON.info(14) }), 'Browser storage is blocked — progress will not be saved after this session.') : null,
    );
    left.appendChild(play);
    wrap.appendChild(left);
    // middle hero
    const hero = h('div', { class: 'hero' });
    const mapName = this.sel.mode === 'br' ? 'Ashcrown Isle' : this.sel.mode === 'tdm' ? (this.sel.tdmMap === 'rotation' ? 'Map rotation' : TDM_MAPS.find((m) => m.id === this.sel.tdmMap)?.name ?? '') : 'Training Grounds';
    hero.appendChild(h('div', { class: 'sub' }, this.sel.mode === 'br' ? 'Battle Royale' : this.sel.mode === 'tdm' ? 'Team Deathmatch' : 'Tutorial'));
    hero.appendChild(h('div', { class: 'map' }, mapName));
    wrap.appendChild(hero);
    // right: daily, quests, events, rank
    const right = h('div', { class: 'menu-right scroll', style: { overflowY: 'auto' } });
    right.appendChild(this.rankCard());
    right.appendChild(this.dailyCard());
    right.appendChild(this.questCard());
    right.appendChild(this.eventCard());
    wrap.appendChild(right);
  }

  private rankCard() {
    const p = this.api.meta.p;
    const r = rankOf(p.rank.rp);
    const s = this.api.meta.season();
    const cd = h('span', { class: 'mono dim', style: { fontSize: '11px' } });
    const upd = () => (cd.textContent = `Ends in ${fmtDuration(s.end - Date.now())}`);
    upd();
    this.timers.push(upd);
    const next = r.next;
    return h('div', { class: 'card panel' },
      h('div', { class: 'head' }, h('span', { class: 'label' }, `Season ${s.number} · ${s.name}`), cd),
      h('div', { class: 'rankcard' },
        h('div', { html: rankEmblem(r.tier, r.division, 64) }),
        h('div', { class: 'col grow', style: { gap: '6px' } },
          h('div', { class: 'rname', style: { color: r.tierDef.color } }, r.label),
          h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, r.progress)}%`, background: r.tierDef.color } })),
          h('div', { class: 'row dim', style: { fontSize: '11.5px', justifyContent: 'space-between' } }, h('span', null, `${fmt(p.rank.rp)} RP`), h('span', null, next ? `${fmt(next - p.rank.rp)} RP to next division` : 'Top tier'), p.rank.shield > 0 ? h('span', { class: 'chip' }, `Shield ${p.rank.shield}`) : null))));
  }

  private dailyCard() {
    const meta = this.api.meta;
    const st = meta.dailyStatus();
    const grid = h('div', { class: 'daily' });
    DAILY_TRACK.forEach((d, i) => {
      const got = i < st.day || (st.claimedToday && i === (st.day + 6) % 7);
      const today = i === st.day && st.claimable;
      grid.appendChild(h('div', { class: 'd' + (got && !today ? ' got' : '') + (today ? ' today' : '') }, h('b', null, String(i + 1)), d.label));
    });
    const cd = h('span', { class: 'mono dim', style: { fontSize: '11px' } });
    const upd = () => (cd.textContent = st.claimable ? 'Ready to claim' : `Next in ${fmtDuration(st.nextReset - Date.now())}`);
    upd();
    this.timers.push(upd);
    const btn = st.claimable
      ? h('button', { class: 'btn primary', style: { marginTop: '10px', width: '100%' }, onclick: () => {
          const r = meta.claimDaily();
          if (r) showReveal(this.parent, `Daily reward · Day ${st.day + 1}`, 'Reward claimed', [r], () => this.render());
        } }, h('span', { html: ICON.calendar(14) }), 'Claim daily reward')
      : null;
    return h('div', { class: 'card panel' }, h('div', { class: 'head' }, h('span', { class: 'label' }, 'Daily rewards'), cd), grid, btn);
  }

  private questCard() {
    const meta = this.api.meta;
    const q = meta.p.quests;
    const box = h('div', { class: 'card panel' });
    const cd = h('span', { class: 'mono dim', style: { fontSize: '11px' } });
    const nx = meta.dailyStatus().nextReset;
    const upd = () => (cd.textContent = `New in ${fmtDuration(nx - Date.now())}`);
    upd();
    this.timers.push(upd);
    box.appendChild(h('div', { class: 'head' }, h('span', { class: 'label' }, 'Daily quests'), cd));
    q.list.forEach((qs, i) => {
      const done = qs.progress >= qs.target;
      const row = h('div', { class: 'quest' + (done ? ' done' : '') },
        h('div', { class: 'q' }, qs.text),
        h('div', { class: 'rw' }, `${fmt(qs.progress)}/${fmt(qs.target)}`),
        h('div', { class: 'bar' }, h('i', { style: { width: `${(qs.progress / qs.target) * 100}%` } })),
        h('div', { class: 'row dim', style: { fontSize: '11px', gridColumn: '1 / -1', justifyContent: 'space-between' } },
          h('span', { class: 'row', style: { gap: '10px' } }, h('span', { class: 'row', style: { gap: '3px' } }, h('span', { html: ICON.xp(12) }), `${qs.xp} XP`), h('span', { class: 'row', style: { gap: '3px' } }, h('span', { html: ICON.coin(12) }), String(qs.coins))),
          qs.claimed ? h('span', { class: 'chip' }, 'Claimed')
            : done ? h('button', { class: 'btn primary', style: { padding: '4px 10px', fontSize: '11px' }, onclick: () => { const rw = meta.claimQuest(i); if (rw.length) showReveal(this.parent, 'Quest complete', qs.text, rw, () => this.render()); } }, 'Claim')
            : q.rerolls < 1 ? h('button', { class: 'btn ghost', style: { padding: '2px 8px', fontSize: '10.5px' }, title: 'One free reroll per day', onclick: () => { if (meta.rerollQuest(i)) { audio.ui('click'); this.render(); } } }, h('span', { html: ICON.refresh(12) }), 'Reroll') : null));
      box.appendChild(row);
    });
    return box;
  }

  private eventCard() {
    const meta = this.api.meta;
    const ev = meta.events();
    const inst = ev.current ?? ev.next;
    const def = inst.def;
    const live = !!ev.current;
    const cd = h('span', { class: 'count' });
    const upd = () => (cd.textContent = live ? `Ends in ${fmtDuration(inst.end - Date.now())}` : `Starts in ${fmtDuration(inst.start - Date.now())}`);
    upd();
    this.timers.push(upd);
    const card = h('div', { class: 'event-card panel' }, h('div', { class: 'eb', style: { background: def.gradient } }));
    card.appendChild(h('div', { class: 'head row', style: { justifyContent: 'space-between' } }, h('span', { class: 'row' }, live ? h('span', { class: 'chip live' }, 'Live event') : h('span', { class: 'chip' }, 'Upcoming event'), h('span', { html: ICON.flame(14), style: { color: def.accent } })), cd));
    card.appendChild(h('div', { class: 'ename', style: { color: def.accent } }, def.name));
    card.appendChild(h('div', { style: { fontSize: '13px', marginTop: '2px' } }, def.tagline));
    card.appendChild(h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '6px', lineHeight: '1.45' } }, def.desc));
    const row = h('div', { class: 'col', style: { marginTop: '10px', gap: '6px' } });
    for (const ch of def.challenges) {
      const prog = live ? ev.progress[ch.id] ?? 0 : 0;
      const claimed = ev.claimed.includes(ch.id);
      const done = prog >= ch.target;
      const rewardRarity = ch.reward.startsWith('coins') ? 'common' : 'epic';
      const rw = { kind: ch.reward.startsWith('coins') ? 'coins' : 'cosmetic', id: ch.reward, label: ch.reward.startsWith('coins') ? `${ch.reward.split(':')[1]} Coins` : cosmeticName(ch.reward), rarity: rewardRarity } as Reward;
      row.appendChild(h('div', { class: 'row', style: { background: 'rgba(0,0,0,0.35)', padding: '6px 8px', clipPath: 'var(--chamfer-sm)', gap: '10px' } },
        h('div', { style: { width: '62px', height: '34px', display: 'grid', placeItems: 'center', transform: 'scale(0.5)', transformOrigin: 'center' } }, rewardArt(rw)),
        h('div', { class: 'col grow', style: { gap: '3px' } }, h('span', { style: { fontSize: '12.5px' } }, ch.text), h('span', { class: `rar-${rw.rarity}`, style: { fontSize: '10.5px', letterSpacing: '0.08em', textTransform: 'uppercase' } }, rw.label),
          live ? h('div', { class: 'bar', style: { height: '4px' } }, h('i', { style: { width: `${(prog / ch.target) * 100}%`, background: def.accent } })) : null),
        live ? (claimed ? h('span', { class: 'chip' }, 'Claimed') : done ? h('button', { class: 'btn primary', style: { padding: '4px 10px', fontSize: '11px' }, onclick: () => { const r = meta.claimEvent(ch); if (r) showReveal(this.parent, def.name, 'Event reward', [r], () => this.render()); } }, 'Claim') : h('span', { class: 'mono dim', style: { fontSize: '11px' } }, `${fmt(prog)}/${fmt(ch.target)}`)) : h('span', { html: ICON.lock(14), class: 'dim' })));
    }
    card.appendChild(row);
    if (!live) card.appendChild(h('div', { class: 'dim', style: { fontSize: '11px', marginTop: '8px' } }, `Weekend events run Friday 00:00 → Monday 00:00 (your local time).`));
    return card;
  }

  // ------------------------------------------------------------ CAREER
  private renderCareer() {
    const p = this.api.meta.p;
    const S = p.stats;
    const page = h('div', { class: 'page two', style: { flex: '1' } });
    const left = h('div', { class: 'panel' });
    const kd = S.deaths ? (S.kills / S.deaths).toFixed(2) : S.kills.toFixed(2);
    const acc = S.shots ? `${Math.round((S.hits / S.shots) * 100)}%` : '—';
    const hsr = S.hits ? `${Math.round((S.headshots / S.hits) * 100)}%` : '—';
    const stats: [string, string][] = [
      ['Matches', fmt(S.matches)], ['Wins', fmt(S.wins)], ['K/D', kd], ['Eliminations', fmt(S.kills)],
      ['Assists', fmt(S.assists)], ['Accuracy', acc], ['Headshot %', hsr], ['Damage', fmt(S.damage)],
      ['BR wins', fmt(S.brWins)], ['Top 5', fmt(S.top5)], ['TDM wins', fmt(S.tdmWins)], ['Longest elim', `${Math.round(S.longestKill)}m`],
      ['Built', fmt(S.built)], ['Chests', fmt(S.chests)], ['Crafted', fmt(S.crafted)], ['Playtime', fmtDuration(S.playtime * 1000)],
    ];
    left.appendChild(h('div', { class: 'head row', style: { justifyContent: 'space-between', marginBottom: '12px' } }, h('div', { class: 'h2' }, 'Career'), h('span', { class: 'dim', style: { fontSize: '12px' } }, `Ranked: ${S.rankedWins}W / ${S.rankedMatches} played · Peak ${rankOf(p.rank.peakRp).label}`)));
    left.appendChild(h('div', { class: 'statgrid' }, ...stats.map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l)))));
    left.appendChild(h('div', { class: 'h2', style: { margin: '18px 0 8px' } }, 'Match history'));
    const hist = h('div', { class: 'scroll', style: { flex: '1', minHeight: '0' } });
    if (!p.history.length) hist.appendChild(h('div', { class: 'dim', style: { padding: '12px 0' } }, 'No matches yet. Your last 30 matches will appear here.'));
    hist.appendChild(h('div', { class: 'histrow label', style: { borderTop: 'none' } }, h('span', null, 'Result'), h('span', null, 'Mode · Map'), h('span', null, 'K/D/A'), h('span', null, 'DMG'), h('span', null, 'ACC'), h('span', null, 'RP'), h('span', null, 'When')));
    for (const e of p.history) {
      const res = e.mode === 'br' ? (e.placement === 1 ? 'Victory' : `#${e.placement}`) : e.won ? 'Victory' : e.draw ? 'Draw' : 'Defeat';
      hist.appendChild(h('div', { class: 'histrow' },
        h('span', { class: 'res ' + (e.won ? 'w' : 'l') }, res),
        h('span', null, `${e.mode === 'br' ? 'Battle Royale' : 'TDM'} · ${e.map}${e.ranked ? ' · Ranked' : ''}${e.score ? ` · ${e.score}` : ''}`),
        h('span', { class: 'mono' }, `${e.kills}/${e.deaths}/${e.assists}`),
        h('span', { class: 'mono' }, fmt(e.damage)),
        h('span', { class: 'mono' }, `${e.accuracy}%`),
        h('span', { class: 'mono', style: { color: e.rpDelta === null ? 'var(--faint)' : e.rpDelta >= 0 ? 'var(--green)' : '#ff7a6a' } }, e.rpDelta === null ? '—' : `${e.rpDelta >= 0 ? '+' : ''}${e.rpDelta}`),
        h('span', { class: 'dim', style: { fontSize: '11.5px' } }, timeAgo(e.t))));
    }
    left.appendChild(hist);
    const right = h('div', { class: 'panel' });
    const got = Object.keys(p.achievements).length;
    right.appendChild(h('div', { class: 'head row', style: { justifyContent: 'space-between', marginBottom: '12px' } }, h('div', { class: 'h2' }, 'Achievements'), h('span', { class: 'dim' }, `${got}/${ACHIEVEMENTS.length}`)));
    const list = h('div', { class: 'scroll col', style: { flex: '1', minHeight: '0', gap: '6px' } });
    for (const a of ACHIEVEMENTS) {
      const done = !!p.achievements[a.id];
      const pr = a.progress?.(p);
      list.appendChild(h('div', { class: 'row', style: { padding: '10px', background: done ? 'rgba(242,169,59,0.1)' : 'rgba(255,255,255,0.03)', border: '1px solid var(--line)', clipPath: 'var(--chamfer-sm)', gap: '12px' } },
        h('span', { html: done ? ICON.trophy(22) : ICON.lock(18), style: { color: done ? 'var(--accent)' : 'var(--faint)' } }),
        h('div', { class: 'col grow', style: { gap: '3px' } }, h('b', { style: { fontSize: '13.5px' } }, a.name), h('span', { class: 'dim', style: { fontSize: '12px' } }, a.desc),
          !done && pr ? h('div', { class: 'bar', style: { height: '4px' } }, h('i', { style: { width: `${Math.min(100, (pr[0] / pr[1]) * 100)}%` } })) : null),
        h('span', { class: 'dim', style: { fontSize: '11px', textAlign: 'right' } }, a.reward.startsWith('coins') ? `${a.coins} coins` : `${cosmeticName(a.reward)} + ${a.coins}`)));
    }
    right.appendChild(list);
    page.appendChild(left);
    page.appendChild(right);
    this.body.appendChild(page);
  }

  // ------------------------------------------------------------ LOCKER
  private renderLocker() {
    const meta = this.api.meta;
    const p = meta.p;
    const page = h('div', { class: 'page locker', style: { flex: '1' } });
    const cats: [Locker, string][] = [['outfit', 'Outfits'], ['camo', 'Weapon camos'], ['banner', 'Banners'], ['title', 'Titles'], ['look', 'Appearance']];
    type Locker = Menu['lockerCat'];
    const left = h('div', { class: 'panel' }, h('div', { class: 'h2', style: { marginBottom: '12px' } }, 'Locker'));
    for (const [c, l] of cats) left.appendChild(h('button', { class: 'btn' + (this.lockerCat === c ? ' primary' : ''), style: { justifyContent: 'flex-start', marginBottom: '6px' }, onclick: () => { this.lockerCat = c; this.render(); } }, l));
    left.appendChild(h('div', { style: { marginTop: 'auto' } }, playerCard({ id: 'player', name: p.name, look: composeLook(p.base, p.equipped.outfit), isBot: false, level: p.level, rp: p.rank.rp, title: p.equipped.title, banner: p.equipped.banner, camo: p.equipped.camo, skill: 0 })));
    left.appendChild(h('div', { class: 'dim', style: { fontSize: '11.5px', marginTop: '8px' } }, 'Cosmetics never affect gameplay. Unlock them through levels, quests, events, ranked seasons, or the Armory with coins earned in matches.'));
    page.appendChild(left);
    page.appendChild(h('div', { class: 'preview3d' }));
    const right = h('div', { class: 'panel scroll' });
    const cat = this.lockerCat;
    if (cat === 'look') {
      right.appendChild(h('div', { class: 'h2', style: { marginBottom: '12px' } }, 'Appearance'));
      const sw = (label: string, list: number[], cur: number, set: (v: number) => void) =>
        h('div', { class: 'col', style: { marginBottom: '12px' } }, h('div', { class: 'label' }, label), h('div', { class: 'swatchrow' }, ...list.map((c) => h('div', { class: 'swatch' + (c === cur ? ' on' : ''), style: { background: '#' + c.toString(16).padStart(6, '0') }, onclick: () => { set(c); meta.save(); this.api.refreshShowcase(); this.render(); } }))));
      right.appendChild(sw('Skin tone', SKIN_TONES, p.base.skin, (v) => (p.base.skin = v)));
      right.appendChild(sw('Hair colour', HAIR_COLORS, p.base.hair, (v) => (p.base.hair = v)));
      right.appendChild(h('div', { class: 'label' }, 'Hair style'));
      right.appendChild(h('div', { class: 'swatchrow', style: { marginTop: '6px' } }, ...HAIR_STYLES.map((s) => h('button', { class: 'btn' + (p.base.hairStyle === s ? ' primary' : ''), style: { padding: '6px 10px', fontSize: '11px' }, onclick: () => { p.base.hairStyle = s; meta.save(); this.api.refreshShowcase(); this.render(); } }, s))));
    } else if (cat === 'title') {
      right.appendChild(h('div', { class: 'h2', style: { marginBottom: '12px' } }, 'Titles'));
      const items = h('div', { class: 'items' });
      for (const t of TITLES) {
        const id = 'title:' + t;
        const own = meta.owns(id);
        items.appendChild(h('div', { class: 'item' + (p.equipped.title === t ? ' on' : '') + (own ? '' : ' locked'), onclick: () => { if (own) { meta.equip('title', t); audio.ui('click'); this.render(); } } },
          h('div', { class: 'sw', style: { background: 'rgba(255,255,255,0.04)', fontFamily: 'var(--display)', fontSize: '16px' } }, t), h('div', { class: 'src' }, own ? 'Owned' : 'Earn via achievements & ranks')));
      }
      right.appendChild(items);
    } else {
      const all = catalog().filter((c) => c.kind === cat);
      right.appendChild(h('div', { class: 'h2', style: { marginBottom: '12px' } }, cat === 'outfit' ? 'Outfits' : cat === 'camo' ? 'Weapon camos' : 'Banners'));
      const items = h('div', { class: 'items' });
      for (const c of all) {
        const own = meta.owns(c.id);
        const key = c.id.split(':')[1];
        const on = (cat === 'outfit' && p.equipped.outfit === key) || (cat === 'camo' && p.equipped.camo === key) || (cat === 'banner' && p.equipped.banner === key);
        items.appendChild(this.itemTile(c, own, on, () => {
          if (!own) return;
          meta.equip(cat as 'outfit', key);
          audio.ui('click');
          this.api.refreshShowcase();
          this.render();
        }));
      }
      right.appendChild(items);
    }
    page.appendChild(right);
    this.body.appendChild(page);
  }

  private itemTile(c: Cosmetic, own: boolean, on: boolean, onclick: () => void, price?: HTMLElement) {
    const key = c.id.split(':')[1];
    let sw: HTMLElement;
    if (c.kind === 'camo') {
      const cm = CAMOS[key];
      sw = h('div', { class: 'sw', style: { background: camoCss(cm) } });
      sw.appendChild(weaponCanvas('ranger', 120, 46));
    } else if (c.kind === 'outfit') {
      const look = composeLook(this.api.meta.p.base, key);
      sw = h('div', { class: 'sw', style: { background: `linear-gradient(135deg, #${(look.jacket ?? look.shirt).toString(16).padStart(6, '0')}, #${look.pants.toString(16).padStart(6, '0')})` } }, avatarCanvas(look, 44));
    } else sw = h('div', { class: 'sw', style: { background: BANNERS[key]?.css } });
    return h('div', { class: `item rb-${c.rarity}` + (on ? ' on' : '') + (own ? '' : ' locked'), onclick },
      sw, h('div', { class: 'nm' }, c.name), h('div', { class: `src rar-${c.rarity}` }, own ? (on ? 'Equipped' : 'Owned') : c.source), price ?? null);
  }

  // ------------------------------------------------------------ ARMORY
  private renderArmory() {
    const meta = this.api.meta;
    const page = h('div', { class: 'page', style: { flex: '1', gridTemplateRows: 'auto 1fr' } });
    const cd = h('span', { class: 'mono dim' });
    const nx = meta.dailyStatus().nextReset;
    const upd = () => (cd.textContent = `Rotates in ${fmtDuration(nx - Date.now())}`);
    upd();
    this.timers.push(upd);
    page.appendChild(h('div', { class: 'row panel', style: { justifyContent: 'space-between', padding: '16px 20px' } }, h('div', null, h('div', { class: 'h1' }, 'Armory'), h('div', { class: 'dim', style: { marginTop: '6px' } }, 'Daily rotating cosmetics, bought only with Forge Coins earned in play. No real-money purchases exist in BlockForge.')), cd));
    const grid = h('div', { class: 'items', style: { gridTemplateColumns: 'repeat(3, 1fr)', alignContent: 'start' } });
    for (const c of meta.shopItems()) {
      const own = meta.owns(c.id);
      const price = h('div', { class: 'price' }, own ? h('span', { class: 'chip' }, 'Owned') : h('span', { class: 'coin', style: { fontSize: '13px' } }, h('span', { html: ICON.coin(14) }), fmt(c.price!)));
      const tile = this.itemTile(c, true, false, () => {
        if (own) return;
        const r = meta.buy(c.id);
        if (r === 'funds') {
          audio.ui('deny');
          this.toastMsg(`Need ${fmt(c.price! - meta.p.coins)} more coins`);
        } else if (typeof r === 'object') showReveal(this.parent, 'Armory', 'Purchased', [r], () => this.render());
      }, price);
      tile.classList.toggle('locked', false);
      (tile.querySelector('.src') as HTMLElement).textContent = own ? 'Owned' : `${c.kind} · ${c.rarity}`;
      tile.style.minHeight = '150px';
      (tile.querySelector('.sw') as HTMLElement).style.height = '90px';
      grid.appendChild(tile);
    }
    page.appendChild(grid);
    this.body.appendChild(page);
  }

  private toastMsg(t: string) {
    const el = h('div', { class: 'toast warn', style: { position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: '40' } }, t);
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ------------------------------------------------------------ LADDER
  private renderLadder() {
    const meta = this.api.meta;
    const p = meta.p;
    const rows = meta.ladder();
    const myIdx = rows.findIndex((r) => r.isPlayer);
    const page = h('div', { class: 'page two', style: { flex: '1', gridTemplateColumns: '1.4fr 1fr' } });
    const left = h('div', { class: 'panel' });
    const s = meta.season();
    left.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('div', { class: 'h2' }, `Season ${s.number} Ladder`), h('span', { class: 'chip ai' }, 'Simulated')));
    left.appendChild(h('div', { class: 'honesty', style: { marginBottom: '10px' } }, h('span', { html: ICON.info(14) }), `This ladder ranks you against ${rows.length - 1} persistent AI competitor profiles. It is a simulated standing, not a global ranking of real players.`));
    left.appendChild(h('div', { class: 'ladder-row label', style: { borderTop: 'none' } }, h('span', null, 'Pos'), h('span', null, 'Player'), h('span', null, 'Rank'), h('span', null, 'RP'), h('span', null, 'Wins')));
    const list = h('div', { class: 'scroll', style: { flex: '1', minHeight: '0' } });
    const show = new Set<number>();
    for (let i = 0; i < Math.min(100, rows.length); i++) show.add(i);
    for (let i = Math.max(0, myIdx - 3); i <= Math.min(rows.length - 1, myIdx + 3); i++) show.add(i);
    let lastI = -1;
    for (const i of [...show].sort((a, b) => a - b)) {
      if (lastI >= 0 && i > lastI + 1) list.appendChild(h('div', { class: 'dim', style: { textAlign: 'center', padding: '4px' } }, '···'));
      lastI = i;
      const r = rows[i];
      const rk = rankOf(r.rp);
      list.appendChild(h('div', { class: 'ladder-row' + (r.isPlayer ? ' me' : ''), style: { cursor: r.isPlayer ? 'default' : 'pointer' }, onclick: () => !r.isPlayer && this.showProfile(r.id) },
        h('span', { class: 'pos' }, `#${i + 1}`),
        h('span', { class: 'row', style: { gap: '8px', minWidth: '0' } }, avatarCanvas(r.isPlayer ? composeLook(p.base, p.equipped.outfit) : r.ident.look, 22), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.name), r.isPlayer ? h('span', { class: 'chip accent' }, 'You') : h('span', { class: 'chip ai' }, 'AI')),
        h('span', { class: 'row', style: { gap: '6px' } }, h('span', { html: rankEmblem(rk.tier, rk.division, 18) }), h('span', { style: { color: rk.tierDef.color, fontSize: '12px' } }, rk.label)),
        h('span', { class: 'mono' }, fmt(r.rp)),
        h('span', { class: 'mono dim' }, fmt(r.wins))));
    }
    left.appendChild(list);
    page.appendChild(left);
    const right = h('div', { class: 'panel' });
    right.appendChild(h('div', { class: 'h2', style: { marginBottom: '12px' } }, 'Rank tiers'));
    const tiers = h('div', { class: 'col', style: { gap: '6px' } });
    TIERS.forEach((t, i) => {
      const reached = p.rank.peakRp >= t.min;
      tiers.appendChild(h('div', { class: 'row', style: { gap: '12px', padding: '6px', background: rankOf(p.rank.rp).tier === i ? 'rgba(255,255,255,0.06)' : 'none', clipPath: 'var(--chamfer-sm)' } },
        h('span', { html: rankEmblem(i, i === TIERS.length - 1 ? -1 : 3, 34) }),
        h('div', { class: 'col grow', style: { gap: '2px' } }, h('b', { style: { color: t.color, fontFamily: 'var(--display)', fontSize: '18px', fontWeight: '400' } }, t.name), h('span', { class: 'dim', style: { fontSize: '11.5px' } }, i === TIERS.length - 1 ? `${fmt(t.min)}+ RP` : `${fmt(t.min)}–${fmt(t.min + 399)} RP · Divisions ${DIV_NAMES.join(' ')}`)),
        t.camo ? h('span', { class: 'dim', style: { fontSize: '11px' } }, reached ? 'Season reward earned' : `Reward: ${CAMOS[t.camo].name}`) : null));
    });
    right.appendChild(tiers);
    right.appendChild(h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '14px', lineHeight: '1.5' } }, `Seasons last 8 weeks. When a season ends your rating is softly reset and you receive the camo of every tier you reached, plus coins. After a tier promotion you get 3 matches of demotion protection.`));
    page.appendChild(right);
    this.body.appendChild(page);
  }

  private showProfile(id: string) {
    const e = getPool().find((x) => x.ident.id === id);
    if (!e) return;
    const st = e.state;
    const kd = st.deaths ? (st.kills / st.deaths).toFixed(2) : st.kills.toFixed(2);
    const modal = h('div', { class: 'modal', onclick: (ev: MouseEvent) => { if (ev.target === modal) modal.remove(); } },
      h('div', { class: 'box panel' },
        playerCard(e.ident, { ai: true }),
        h('div', { class: 'statgrid', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
          ...[['Matches', fmt(st.matches)], ['Wins', fmt(st.wins)], ['K/D', kd], ['RP', fmt(st.rp)], ['Level', String(st.level)], ['Style', ARCHETYPE_LABEL[e.ident.personality!.archetype]]].map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'v', style: { fontSize: '20px' } }, v), h('div', { class: 'l' }, l)))),
        st.recent.length ? h('div', { class: 'col', style: { gap: '2px' } }, h('div', { class: 'label' }, 'Recent matches with you'), ...st.recent.map((r) => h('div', { class: 'row dim', style: { fontSize: '12px', justifyContent: 'space-between' } }, h('span', null, r.mode === 'br' ? `Battle Royale · #${r.place || '—'}` : 'Team Deathmatch'), h('span', null, `${r.kills} elims · ${timeAgo(r.t)}`)))) : null,
        h('div', { class: 'honesty' }, h('span', { html: ICON.info(14) }), 'AI competitor. Career numbers are simulated and grow as they play matches with you.'),
        h('button', { class: 'btn', onclick: () => modal.remove() }, 'Close')));
    this.parent.appendChild(modal);
  }

  // ------------------------------------------------------------ misc
  editName() {
    const meta = this.api.meta;
    const input = h('input', { class: 'textin', value: meta.p.name, maxlength: '16' }) as HTMLInputElement;
    const err = h('div', { class: 'dim', style: { fontSize: '12px', minHeight: '1em', color: '#ffb3a8' } });
    const save = () => {
      const v = input.value.trim();
      if (!/^[A-Za-z0-9_.\-]{3,16}$/.test(v)) {
        err.textContent = '3–16 characters: letters, numbers, _ . -';
        return;
      }
      meta.p.name = v;
      meta.save();
      modal.remove();
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    const modal = h('div', { class: 'modal' }, h('div', { class: 'box panel' }, h('div', { class: 'h2' }, 'Player name'), input, err, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn ghost', onclick: () => modal.remove() }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save'))));
    this.parent.appendChild(modal);
    setTimeout(() => input.focus(), 50);
  }

  showNotices() {
    const meta = this.api.meta;
    const n = meta.p.notices.shift();
    if (!n) {
      // daily reward nudge on launch
      return;
    }
    meta.save();
    if (n.kind === 'season') {
      const d = n.data;
      const extra = h('div', { class: 'dim', style: { position: 'relative', maxWidth: '520px', textAlign: 'center' } }, `Season ${d.from} has ended. Your rating was softly reset from ${d.before} to ${d.after} RP. Rewards for your peak tier (${TIERS[d.peakTier].name}) are below.`);
      showReveal(this.parent, `Season ${d.to} · ${d.name}`, 'New season', d.rewards, () => this.showNotices(), extra);
    } else this.showNotices();
  }
}
