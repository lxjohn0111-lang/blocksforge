// Ad UI: the rewarded-ad button every offer uses, a small notice, and the main menu's bottom banner.

import { h } from './dom';
import { ICON } from './icons';
import { audio } from '../audio/audio';
import { platform } from '../platform/crazygames';
import { watchRewarded } from '../ads';

let toastEl: HTMLElement | null = null;

/** a short notice at the top of the screen */
export function adToast(text: string, kind: 'warn' | 'good' = 'warn') {
  toastEl?.remove();
  const el = h('div', { class: `toast ${kind} rwtoast` }, text);
  (document.getElementById('ui') ?? document.body).appendChild(el);
  toastEl = el;
  setTimeout(() => el.remove(), 2600);
}

export interface AdOffer {
  /** what the player gets, e.g. "Double rewards" */
  label: string;
  /** the detail line, e.g. "+640 XP · +80 coins" */
  sub?: string;
  /** checked right before the ad: a reason to refuse (shown instead of playing an ad) */
  check?: () => string | null;
  onReward: () => void;
  big?: boolean;
  /** 'gold' for the highlight offers */
  tone?: 'gold' | 'violet';
  /** count shown on the badge, e.g. "1/3" */
  badge?: string;
}

/**
 * A rewarded-ad button: one click plays one ad, the reward is granted when it finished. Returns null
 * when no rewarded ads can play here, so no offer is ever shown that cannot pay out.
 */
export function adButton(o: AdOffer): HTMLElement | null {
  if (!platform.rewardedReady) return null;
  let busy = false;
  const btn = h('button', { class: `btn rwbtn${o.big ? ' big' : ''}${o.tone ? ' ' + o.tone : ''}`, title: 'Watch a short video ad for this reward' },
    h('span', { class: 'rwtag' }, h('span', { html: ICON.play(11) }), o.badge ?? 'AD'),
    h('span', { class: 'rwtext' }, h('span', { class: 'rwl' }, o.label), o.sub ? h('small', null, o.sub) : null));
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (busy) return;
    const why = o.check?.();
    if (why) {
      audio.ui('deny', 0.6);
      adToast(why);
      return;
    }
    busy = true;
    btn.classList.add('loading');
    audio.ui('click', 0.6);
    const ok = await watchRewarded();
    busy = false;
    btn.classList.remove('loading');
    if (ok) {
      audio.ui('reward', 0.8);
      o.onReward();
    } else adToast('No video available right now. Please try again in a minute.');
  });
  btn.addEventListener('mouseenter', () => audio.ui('hover', 0.3));
  return btn;
}

/** the one place a banner shows: the main menu (it stays while the player moves between its tabs) */
export type BannerSpot = 'menu';

/** CrazyGames asked for the 320×50 banner everywhere */
const SIZE: [number, number] = [320, 50];
/** refresh period CrazyGames asked for (the SDK itself refuses refreshes sooner than ~30 s) */
export const BANNER_REFRESH_MS = 35000;
const ID = 'bf-banner-slot';

/**
 * The menu banner: the SDK's 320×50 ad at the bottom centre, straight on the game's background (no frame
 * or bar of its own). Its room is kept from the moment the menu opens (whether or not an ad has loaded
 * yet) and the menu ends above it: nothing moves when the ad arrives and it never covers the menu.
 */
export class BannerAds {
  private bar: HTMLElement;
  private slot: HTMLElement;
  private spot: BannerSpot | null = null;
  private filled = false;
  private lastRequest = 0;
  private retryAt = 0;
  private failures = 0;
  private maxed = false;
  private busy = false;

  constructor(parent: HTMLElement) {
    this.slot = h('div', { id: ID, class: 'bf-bslot' });
    this.slot.style.width = `${SIZE[0]}px`;
    this.slot.style.height = `${SIZE[1]}px`;
    this.bar = h('div', { class: 'bf-foot' }, this.slot);
    this.bar.style.display = 'none';
    // banner + 6 px above and below
    document.documentElement.style.setProperty('--adh', `${SIZE[1] + 12}px`);
    parent.appendChild(this.bar);
    setInterval(() => this.tick(), 1000);
  }

  /** where a banner should show now (null: nowhere, e.g. outside the main menu) */
  want(spot: BannerSpot | null) {
    if (spot === this.spot) return;
    this.spot = spot;
    this.place();
    if (spot) this.request();
  }

  /** the bar (and the room for it) whenever the menu is up and an ad can come */
  private place() {
    const on = !!this.spot && platform.adsMode !== 'none';
    this.bar.style.display = on ? '' : 'none';
    document.body.classList.toggle('foot-room', on);
  }

  private async request() {
    if (!this.spot || this.busy || this.maxed || platform.adsMode === 'none') return;
    const now = Date.now();
    if (now < this.retryAt) return;
    if (this.filled && now - this.lastRequest < BANNER_REFRESH_MS) return;
    if (document.visibilityState === 'hidden' || platform.adPlaying) return;
    this.busy = true;
    const res = await platform.requestBanner(ID, SIZE[0], SIZE[1]);
    this.busy = false;
    this.lastRequest = Date.now();
    if (res === 'ok') {
      this.filled = true;
      this.failures = 0;
    } else if (res === 'cooldown') this.retryAt = Date.now() + 5000;
    else if (res === 'max') this.maxed = true;
    else {
      // no banner this time (no fill, blocked): the bar stays as it is and asks again later
      this.failures++;
      this.retryAt = Date.now() + Math.min(600000, 60000 * this.failures);
    }
  }

  private tick() {
    this.place();
    if (this.spot) this.request();
  }
}
