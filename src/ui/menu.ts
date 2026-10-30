import { h, clear, fmt, timeAgo } from './dom';
import { ICON, rankEmblem, avatarCanvas, logoMark } from './icons';
import type { Meta, Reward } from '../meta/meta';
import { DAILY_TRACK } from '../meta/meta';
import { rankOf, TIERS, DIV_NAMES } from '../meta/ranks';
import { xpForLevel } from '../meta/profile';
import { catalog, OUTFITS, BANNERS, TITLES, composeLook, cosmeticName, cosmeticRarity, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, type Cosmetic } from '../meta/cosmetics';
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
import { VAULT } from '../meta/cosmetics';
import { COINS_DROP, BOOST_MIN } from '../meta/meta';
import { platform } from '../platform/crazygames';
import { adButton, adToast } from './adui';
import { openWheel } from './wheel';

export interface PlaySelection {
  mode: 'br' | 'tdm' | 'tutorial';
  ranked: boolean;
  tdmMap: string;
  loadout: string;
  /** the short Basics tutorial instead of the full Training course */
  quick?: boolean;
}

export interface MenuApi {
  meta: Meta;
  play(sel: PlaySelection): void;
  openSettings(): void;
  setMenuView(v: 'orbit' | 'showcase'): void;
  refreshShowcase(): void;
  /** turn the locker character by a drag of dx pixels */
  rotateShowcase(dx: number): void;
  /** replay the Basics tutorial */
  showHelp(): void;
}

type Tab = 'play' | 'career' | 'locker' | 'armory' | 'ladder';

export function playerCard(ident: Identity, opts: { emblem?: boolean; extra?: string } = {}): HTMLElement {
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
  private renderedTab: Tab | null = null;

  constructor(public parent: HTMLElement, public api: MenuApi) {
    const p = api.meta.p;
    this.sel = { mode: 'br', ranked: false, tdmMap: 'rotation', loadout: p.lastLoadout || 'assault' };
    this.root = h('div', { class: 'screen menu' });
    parent.appendChild(this.root);
    this.render();
    this.tick = window.setInterval(() => this.timers.forEach((f) => f()), 1000);
    // rewarded offers appear / disappear with ad availability, the name with the CrazyGames account
    this.unsub.push(platform.onAdsChange(() => this.render()), platform.onUser(() => this.render()));
    // pending notices (season reset etc.)
    setTimeout(() => this.showNotices(), 300);
  }

  private unsub: (() => void)[] = [];

  dispose() {
    clearInterval(this.tick);
    for (const u of this.unsub) u();
    this.root.remove();
  }

  render() {
    // re-rendering after a click must not jump the scrolled columns back to the top
    const keep = ['.menu-left', '.menu-right', '.menu-body', '.page', '.page > .panel', '.mbody'].map((sel) => [sel, this.root.querySelector(sel)?.scrollTop ?? 0] as const);
    const sameTab = this.renderedTab === this.tab;
    this.renderedTab = this.tab;
    clear(this.root);
    this.timers = [];
    this.root.appendChild(this.topbar());
    this.body = h('div', { class: 'mbody', style: { flex: '1', display: 'flex', minHeight: '0' } });
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
    if (sameTab)
      for (const [sel, top] of keep) {
        const el = this.root.querySelector(sel);
        if (el && top) el.scrollTop = top;
      }
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
        h('div', { class: 'lvl', title: `${fmt(p.xp)} / ${fmt(need)} XP` }, h('div', { class: 'badge' }, String(p.level)), h('div', { class: 'col', style: { gap: '3px' } }, h('div', { class: 'bar xpbar' }, h('i', { style: { width: `${(p.xp / need) * 100}%` } })))),
        this.boostChip(),
        h('div', { class: 'iconbtn wheelbtn' + (this.api.meta.wheelReadyIn() === 0 ? ' ready' : ''), onclick: () => this.openWheel(), title: 'Lucky Wheel' }, h('span', { class: 'miniwheel' })),
        this.whoBox(),
        h('div', { class: 'iconbtn', onclick: () => this.api.showHelp(), title: 'How to play', html: ICON.info(18) }),
        h('div', { class: 'iconbtn', onclick: () => this.api.openSettings(), title: 'Settings', html: ICON.gear(18) }),
      ),
    );
  }

  /** player name and look; the CrazyGames account name and picture when signed in */
  private whoBox() {
    const p = this.api.meta.p;
    const u = platform.user;
    if (u)
      return h('div', { class: 'row who', title: 'Signed in with your CrazyGames account' },
        u.avatar ? h('img', { class: 'cgavatar', src: u.avatar, alt: '', referrerpolicy: 'no-referrer' }) : avatarCanvas(composeLook(p.base, p.equipped.outfit), 34),
        h('div', { class: 'col', style: { gap: '0' } }, h('b', { style: { fontSize: '13px' } }, u.username)));
    return h('div', { class: 'row who' },
      h('div', { class: 'row', style: { gap: '8px' } }, avatarCanvas(composeLook(p.base, p.equipped.outfit), 34), h('div', { class: 'col', style: { gap: '0' } }, h('b', { style: { fontSize: '13px' } }, p.name))),
      platform.userAvailable ? h('button', { class: 'btn ghost signin', title: 'Sign in with CrazyGames to keep your progress on every device', onclick: () => platform.signIn() }, 'Sign in') : null);
  }

  /** the running 2× XP boost, with its time left */
  private boostChip() {
    const meta = this.api.meta;
    if (meta.xpBoostLeft() <= 0) return null;
    const t = h('b', null, fmtDuration(meta.xpBoostLeft()));
    const chip = h('div', { class: 'boostchip', title: 'Double XP from matches' }, h('span', { html: ICON.xp(14) }), '2× XP', t);
    this.timers.push(() => {
      const left = meta.xpBoostLeft();
      if (left <= 0) chip.remove();
      else t.textContent = fmtDuration(left);
    });
    return chip;
  }

  openWheel() {
    audio.ui('click', 0.6);
    openWheel(this.parent, this.api.meta, () => this.render());
  }

  // ------------------------------------------------------------ PLAY
  private renderPlay() {
    const meta = this.api.meta;
    const p = meta.p;
    const wrap = h('div', { class: 'menu-body', style: { flex: '1' } });
    this.body.appendChild(wrap);
    // left: modes
    const left = h('div', { class: 'menu-left' + (this.sel.mode === 'tdm' ? ' tdmsel' : '') });
    const modes: [PlaySelection['mode'], string, string, string[]][] = [
      ['br', 'Battle Royale', '24 players. Loot, build, outlast the storm.', []],
      ['tdm', 'Team Deathmatch', '6 v 6. First team to 50 eliminations.', []],
      ['tutorial', 'Training Grounds', 'Learn to shoot, loot and build.', p.tutorialDone ? [] : ['+300 coins']],
    ];
    const modesEl = h('div', { class: 'modes' });
    left.appendChild(modesEl);
    for (const [id, title, sub, tags] of modes) {
      modesEl.appendChild(
        h('div', { class: 'modecard panel' + (this.sel.mode === id ? ' on' : ''), onclick: () => { audio.ui('click', 0.5); this.sel.mode = id; if (id === 'tutorial') this.sel.ranked = false; this.render(); }, onmouseenter: () => audio.ui('hover', 0.25) },
          h('div', { class: 'art', html: id === 'br' ? ICON.storm(120) : id === 'tdm' ? ICON.people(120) : ICON.crosshair(120) }),
          h('div', { class: 'title' }, title),
          h('div', { class: 'sub' }, sub),
          tags.length ? h('div', { class: 'meta' }, ...tags.map((t) => h('span', { class: 'chip' }, t))) : null),
      );
    }
    if (this.sel.mode !== 'tutorial') {
      const rk = rankOf(p.rank.rp);
      left.appendChild(
        h('div', { class: 'seg' },
          h('button', { class: !this.sel.ranked ? 'on' : '', onclick: () => { this.sel.ranked = false; this.render(); } }, 'Casual'),
          h('button', { class: this.sel.ranked ? 'on rk' : '', onclick: () => { this.sel.ranked = true; this.render(); } }, `Ranked · ${rk.label}`)),
      );
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
        lo.appendChild(h('div', { class: 'loadout lo3' + (this.sel.loadout === l.id ? ' on' : ''), title: l.blurb, onclick: () => { this.sel.loadout = l.id; meta.p.lastLoadout = l.id; meta.save(); this.render(); } },
          h('div', { class: 'ln' }, l.name), weaponCanvas(l.primary, 120, 36), h('div', { class: 'lw' }, `${WEAPONS[l.primary].short} · ${WEAPONS[l.secondary].short}`)));
      }
      left.appendChild(lo);
    }
    const play = h('div', { class: 'playbar' },
      h('button', { class: 'btn primary big', onclick: () => { audio.ui('confirm'); this.api.play({ ...this.sel }); }, onmouseenter: () => audio.ui('hover', 0.3) }, h('span', { html: ICON.play(18) }), this.sel.mode === 'tutorial' ? 'Start training' : 'Find match'),
      h('div', { class: 'fineprint' }, 'All other players in BlockForge are computer-controlled.'),
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
    right.appendChild(this.wheelCard());
    right.appendChild(this.boostCard());
    right.appendChild(this.rankCard());
    right.appendChild(this.dailyCard());
    right.appendChild(this.questCard());
    right.appendChild(this.eventCard());
    wrap.appendChild(right);
  }

  /** match perks for the selected mode: the BR starter kit, the ranked Rank Shield */
  private perkOffers() {
    const meta = this.api.meta;
    const a = meta.p.ads;
    const items: HTMLElement[] = [];
    if (this.sel.mode === 'br') {
      if (a.starterKit) items.push(h('div', { class: 'perk on' }, h('span', { html: ICON.check(14) }), h('b', null, 'Starter kit ready'), h('small', null, 'Ranger AR, plates, bandages and 150 wood for your next drop')));
      else {
        const b = adButton({ label: 'Drop in loaded', sub: 'Next BR: Ranger AR + 3 plates + 150 wood', onReward: () => { meta.setStarterKit(); adToast('Starter kit ready for your next drop', 'good'); this.render(); } });
        if (b) items.push(b);
      }
    }
    if (this.sel.ranked && this.sel.mode !== 'tutorial') {
      if (a.rpGuard) items.push(h('div', { class: 'perk on' }, h('span', { html: ICON.shield(14) }), h('b', null, 'Rank Shield active'), h('small', null, 'Your next ranked match cannot cost RP')));
      else {
        const b = adButton({ label: 'Rank Shield', sub: 'Next ranked match: no RP loss', tone: 'violet', onReward: () => { meta.setRpGuard(); adToast('Rank Shield active for your next ranked match', 'good'); this.render(); } });
        if (b) items.push(b);
      }
    }
    return items.length ? h('div', { class: 'perks' }, ...items) : null;
  }

  private wheelCard() {
    const meta = this.api.meta;
    const st = h('span', { class: 'wc-state' });
    const upd = () => {
      const left = meta.wheelReadyIn();
      st.textContent = left === 0 ? 'Free spin ready!' : `Free spin in ${fmtDuration(left)}`;
      card.classList.toggle('ready', left === 0);
    };
    const card = h('div', { class: 'card panel wheelcard', onclick: () => this.openWheel(), onmouseenter: () => audio.ui('hover', 0.3) },
      h('span', { class: 'miniwheel big' }),
      h('div', { class: 'col grow', style: { gap: '3px' } }, h('div', { class: 'wc-title' }, 'Lucky Wheel'), h('div', { class: 'wc-sub' }, 'Coins, skins, XP boosts. Up to 1,000 coins!'), st),
      h('button', { class: 'btn primary' }, 'Spin'));
    upd();
    this.timers.push(upd);
    return card;
  }

  /** rewarded-ad boosts: free coins, double XP, the Ad Vault */
  private boostCard() {
    const meta = this.api.meta;
    const box = h('div', { class: 'card panel boostcard' }, h('div', { class: 'head' }, h('span', { class: 'label' }, 'Boosts'), h('span', { class: 'chip accent' }, 'Free')));
    // the selected mode's match perks first (BR starter kit, ranked Rank Shield)
    const perks = this.perkOffers();
    if (perks) box.appendChild(perks);
    const coinsLeft = meta.coinsReadyIn();
    const row = (icon: string, title: string, sub: string, action: HTMLElement | null) =>
      h('div', { class: 'boost' }, h('span', { class: 'bi', html: icon }), h('div', { class: 'col grow', style: { gap: '1px', minWidth: '0' } }, h('b', null, title), h('small', null, sub)), action);
    const coinsBtn = coinsLeft === 0 ? adButton({ label: `+${COINS_DROP}`, onReward: () => { const r = meta.freeCoins(); if (r) showReveal(this.parent, 'Supply drop', 'Coins delivered', [r], () => this.render()); } }) : null;
    const cdTxt = h('small', null, coinsLeft === 0 ? 'Watch a short ad' : `Next drop in ${fmtDuration(coinsLeft)}`);
    if (coinsLeft > 0) this.timers.push(() => { const l = meta.coinsReadyIn(); if (l === 0) this.render(); else cdTxt.textContent = `Next drop in ${fmtDuration(l)}`; });
    if (coinsBtn || coinsLeft > 0 && platform.rewardedReady) {
      const r = row(ICON.coin(22), 'Supply drop', '', coinsBtn);
      r.querySelector('small')!.replaceWith(cdTxt);
      box.appendChild(r);
    }
    const boostLeft = meta.xpBoostLeft();
    const xpBtn = adButton({ label: boostLeft > 0 ? '+15 min' : '2× XP', tone: 'violet', onReward: () => { meta.startXpBoost(); adToast(`2× XP active for ${fmtDuration(meta.xpBoostLeft())}`, 'good'); this.render(); } });
    if (xpBtn) box.appendChild(row(ICON.xp(22), 'Double XP', boostLeft > 0 ? `Active · ${fmtDuration(boostLeft)} left` : `${BOOST_MIN} minutes of 2× match XP`, xpBtn));
    // Ad Vault
    for (const v of VAULT) {
      const st = meta.vaultStatus(v.id);
      if (st.owned) continue;
      const btn = adButton({ label: 'Unlock', tone: 'gold', onReward: () => this.vaultStep(v.id) });
      if (!btn) continue;
      const [kind, key] = v.id.split(':');
      const r = row('', kind === 'outfit' ? OUTFITS[key].name : cosmeticName(v.id), '', btn);
      const art = r.querySelector('.bi') as HTMLElement;
      art.classList.add('vaultart');
      art.appendChild(kind === 'outfit' ? avatarCanvas(composeLook(meta.p.base, key), 40) : h('div', { class: 'camosw', style: { background: camoCss(CAMOS[key]) } }));
      r.querySelector('small')!.replaceWith(h('small', null, h('span', { class: 'rar-legendary' }, 'Legendary'), ' · 1 ad'));
      box.appendChild(r);
    }
    return box.childElementCount > 1 ? box : h('div');
  }

  /** one more Ad Vault ad: progress, or the item itself on the last one */
  private vaultStep(id: string) {
    const meta = this.api.meta;
    const r = meta.vaultAdvance(id);
    if (r) showReveal(this.parent, 'Ad Vault', 'Unlocked!', [r], () => this.render());
    else {
      const st = meta.vaultStatus(id);
      adToast(`${cosmeticName(id)}: ${st.count}/${st.need} ads watched`, 'good');
      this.render();
    }
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
      const cos = !d.reward.startsWith('coins') && !d.reward.startsWith('xp');
      const rar = cos ? cosmeticRarity(d.reward) : '';
      grid.appendChild(h('div', { class: 'd' + (got && !today ? ' got' : '') + (today ? ' today' : '') + (cos ? ` prize r-${rar}` : '') }, h('b', null, String(i + 1)), d.label));
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
      : meta.canDoubleDaily()
        ? adButton({ label: "Double today's reward", sub: DAILY_TRACK[(meta.p.daily.day + 6) % 7].label + ' again', tone: 'gold', onReward: () => {
            const r = meta.doubleDaily();
            if (r) showReveal(this.parent, 'Daily reward', 'Doubled!', [r], () => this.render());
          } })
        : null;
    if (btn && !st.claimable) btn.style.marginTop = '10px';
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
            : q.rerolls < 1 ? h('button', { class: 'btn ghost', style: { padding: '2px 8px', fontSize: '10.5px' }, title: 'One free reroll per day', onclick: () => { if (meta.rerollQuest(i)) { audio.ui('click'); this.render(); } } }, h('span', { html: ICON.refresh(12) }), 'Reroll')
            : adButton({ label: 'Reroll', onReward: () => { if (meta.rerollQuestAd(i)) this.render(); } })));
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
    page.appendChild(left);
    page.appendChild(this.previewBox());
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
        const vault = VAULT.find((v) => v.id === c.id);
        items.appendChild(this.itemTile(c, own, on, () => {
          if (!own && vault) return this.vaultModal(c.id);
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

  /** an Ad Vault item: what it is, the ads watched so far, and the button for the next one */
  private vaultModal(id: string) {
    const meta = this.api.meta;
    const btn = adButton({ label: 'Unlock now', big: true, tone: 'gold', onReward: () => { modal.remove(); this.vaultStep(id); } });
    const modal = h('div', { class: 'modal', onclick: (ev: MouseEvent) => { if (ev.target === modal) modal.remove(); } },
      h('div', { class: 'box panel vaultbox' },
        h('div', { class: 'label' }, 'Ad Vault · Legendary'),
        h('div', { class: 'h2' }, cosmeticName(id)),
        h('div', { class: 'vaultart big' }, rewardArt({ kind: 'cosmetic', id })),
        h('div', { class: 'dim', style: { fontSize: '13px', textAlign: 'center' } }, 'Watch one short ad to unlock it for good.'),
        btn ?? h('div', { class: 'dim' }, 'Ads are not available right now.'),
        h('button', { class: 'btn ghost', onclick: () => modal.remove() }, 'Close')));
    this.parent.appendChild(modal);
  }

  /** the see-through box the 3D character is framed in; drag it to turn the character */
  private previewBox() {
    const box = h('div', { class: 'preview3d' }, h('div', { class: 'rothint', html: ICON.refresh(16) }));
    let lastX: number | null = null;
    box.addEventListener('pointerdown', (e) => {
      lastX = e.clientX;
      box.setPointerCapture(e.pointerId);
      box.classList.add('dragging');
    });
    box.addEventListener('pointermove', (e) => {
      if (lastX === null) return;
      this.api.rotateShowcase(e.clientX - lastX);
      lastX = e.clientX;
    });
    const end = () => {
      lastX = null;
      box.classList.remove('dragging');
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    return box;
  }

  /** where the locker's character should appear on screen (null outside the locker) */
  previewRect(): DOMRect | null {
    if (this.tab !== 'locker') return null;
    const el = this.root.querySelector('.preview3d');
    return el ? el.getBoundingClientRect() : null;
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
    const page = h('div', { class: 'page armorypage', style: { flex: '1', gridTemplateRows: 'auto minmax(0, 1fr)' } });
    const cd = h('span', { class: 'mono dim' });
    const nx = meta.dailyStatus().nextReset;
    const upd = () => (cd.textContent = `Rotates in ${fmtDuration(nx - Date.now())}`);
    upd();
    this.timers.push(upd);
    page.appendChild(h('div', { class: 'row panel', style: { justifyContent: 'space-between', padding: '16px 20px' } }, h('div', { class: 'h1' }, 'Armory'), cd));
    const grid = h('div', { class: 'items shopgrid' });
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
      if (!own) {
        const half = Math.ceil(c.price! / 2);
        const ad = adButton({ label: '½ price', sub: `${fmt(half)} coins`, check: () => (meta.canBuyHalf(c.id) ? null : `Need ${fmt(half - meta.p.coins)} more coins`), onReward: () => {
          const r = meta.buyHalf(c.id);
          if (r) showReveal(this.parent, 'Armory', 'Half price!', [r], () => this.render());
        } });
        if (ad) {
          ad.classList.add('halfbtn');
          tile.appendChild(ad);
        }
      }
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
    // on CrazyGames only signed-in players are ranked on the ladder
    const guest = platform.portal && !platform.user;
    const rows = meta.ladder(!guest);
    const myIdx = rows.findIndex((r) => r.isPlayer);
    const page = h('div', { class: 'page two ladderpage', style: { flex: '1' } });
    const left = h('div', { class: 'panel' });
    const s = meta.season();
    left.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('div', { class: 'h2' }, `Season ${s.number} Ladder`), h('span', { class: 'dim', style: { fontSize: '12px' } }, `${rows.length} players`)));
    if (guest)
      left.appendChild(h('div', { class: 'ladder-guest' }, h('span', null, 'Sign in to join the ladder.'),
        platform.userAvailable ? h('button', { class: 'btn ghost signin', onclick: () => platform.signIn() }, 'Sign in') : null));
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
        h('span', { class: 'row', style: { gap: '8px', minWidth: '0' } }, avatarCanvas(r.isPlayer ? composeLook(p.base, p.equipped.outfit) : r.ident.look, 22), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.name), r.isPlayer ? h('span', { class: 'chip accent' }, 'You') : null),
        h('span', { class: 'row', style: { gap: '6px' } }, h('span', { html: rankEmblem(rk.tier, rk.division, 18) }), h('span', { style: { color: rk.tierDef.color, fontSize: '12px' } }, rk.label)),
        h('span', { class: 'mono' }, fmt(r.rp)),
        h('span', { class: 'mono dim' }, fmt(r.wins))));
    }
    left.appendChild(list);
    page.appendChild(left);
    const right = h('div', { class: 'panel' });
    right.appendChild(h('div', { class: 'h2', style: { marginBottom: '12px' } }, 'Rank tiers'));
    const tiers = h('div', { class: 'col ladder-tiers', style: { gap: '6px' } });
    TIERS.forEach((t, i) => {
      const reached = p.rank.peakRp >= t.min;
      tiers.appendChild(h('div', { class: 'row', style: { gap: '12px', padding: '6px', background: rankOf(p.rank.rp).tier === i ? 'rgba(255,255,255,0.06)' : 'none', clipPath: 'var(--chamfer-sm)' } },
        h('span', { html: rankEmblem(i, i === TIERS.length - 1 ? -1 : 3, 34) }),
        h('div', { class: 'col grow', style: { gap: '2px' } }, h('b', { style: { color: t.color, fontFamily: 'var(--display)', fontSize: '18px', fontWeight: '400' } }, t.name), h('span', { class: 'dim', style: { fontSize: '11.5px' } }, i === TIERS.length - 1 ? `${fmt(t.min)}+ RP` : `${fmt(t.min)}–${fmt(t.min + 399)} RP · Divisions ${DIV_NAMES.join(' ')}`)),
        t.camo ? h('span', { class: 'dim', style: { fontSize: '11px' } }, reached ? 'Season reward earned' : `Reward: ${CAMOS[t.camo].name}`) : null));
    });
    right.appendChild(tiers);
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
        playerCard(e.ident),
        h('div', { class: 'statgrid three' },
          ...[['Matches', fmt(st.matches)], ['Wins', fmt(st.wins)], ['K/D', kd], ['RP', fmt(st.rp)], ['Level', String(st.level)], ['Style', ARCHETYPE_LABEL[e.ident.personality!.archetype]]].map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'v', style: { fontSize: '20px' } }, v), h('div', { class: 'l' }, l)))),
        st.recent.length ? h('div', { class: 'col', style: { gap: '2px' } }, h('div', { class: 'label' }, 'Recent matches with you'), ...st.recent.map((r) => h('div', { class: 'row dim', style: { fontSize: '12px', justifyContent: 'space-between' } }, h('span', null, r.mode === 'br' ? `Battle Royale · #${r.place || '—'}` : 'Team Deathmatch'), h('span', null, `${r.kills} elims · ${timeAgo(r.t)}`)))) : null,
        h('button', { class: 'btn', onclick: () => modal.remove() }, 'Close')));
    this.parent.appendChild(modal);
  }

  // ------------------------------------------------------------ misc
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
