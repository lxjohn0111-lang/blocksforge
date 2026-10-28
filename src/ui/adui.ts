// Ad UI: the rewarded-ad button every offer uses, a small notice, and the bottom banner that the menu,
// the results screen and Battle Royale spectating share.

import { h } from './dom';
import { ICON } from './icons';
import { audio } from '../audio/audio';
import { platform } from '../platform/crazygames';
import { watchRewarded } from '../ads';

let toastEl: HTMLElement | null = null;

/** a short notice at the top of the screen */
export function adToast(text: string, kind: 'warn' | 'good' = 'warn') {
  toastEl?.remove();
  const el = h('div', { class: `toast ${kind} adtoast` }, text);
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
  const btn = h('button', { class: `btn adbtn${o.big ? ' big' : ''}${o.tone ? ' ' + o.tone : ''}`, title: 'Watch a short video ad for this reward' },
    h('span', { class: 'adtag' }, h('span', { html: ICON.play(11) }), o.badge ?? 'AD'),
    h('span', { class: 'adtext' }, h('span', { class: 'adl' }, o.label), o.sub ? h('small', null, o.sub) : null));
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

export type BannerSpot = 'menu' | 'results' | 'spectate';

/** the sizes CrazyGames serves, largest first */
const SIZES: [number, number][] = [
  [728, 90],
  [468, 60],
  [320, 50],
];
/**
 * Refresh period. The CrazyGames SDK refuses a refresh of the same container sooner than about 30 s
 * after the last one ("bannerCooldown") and caps refreshes per session ("maxRefreshReached"): refresh
 * right after the cooldown, and only while the banner is on screen.
 */
export const BANNER_REFRESH_MS = 30500;
const ID = 'bf-banner-slot';

export class BannerAds {
  private wrap: HTMLElement;
  private slot: HTMLElement;
  private spot: BannerSpot | null = null;
  private size: [number, number] | null = null;
  private filled = false;
  private lastRequest = 0;
  private retryAt = 0;
  private failures = 0;
  private maxed = false;
  private busy = false;

  constructor(parent: HTMLElement) {
    this.slot = h('div', { id: ID, class: 'adslot' });
    this.wrap = h('div', { class: 'adbar' }, h('span', { class: 'adlabel' }, 'Advertisement'), this.slot);
    this.wrap.style.display = 'none';
    // a dark band across the bottom so the banner sits in the UI rather than over the 3D scene
    parent.appendChild(h('div', { class: 'adband' }));
    parent.appendChild(this.wrap);
    setInterval(() => this.tick(), 1000);
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => this.resized(), 400);
    });
  }

  /** where a banner should show now (null: none, e.g. during play) */
  want(spot: BannerSpot | null) {
    if (spot === this.spot) return;
    this.spot = spot;
    document.body.classList.toggle('ad-spec', spot === 'spectate');
    if (!spot) {
      this.wrap.style.display = 'none';
      this.reserve(false);
      return;
    }
    if (platform.adsMode === 'none') return;
    this.wrap.dataset.spot = spot;
    const size = this.pick();
    if (!this.size || size[0] !== this.size[0]) {
      this.setSize(size);
      this.filled = false;
    }
    // back on screen: show what is there and refresh if the cooldown allows
    if (this.filled) this.showFilled();
    this.request();
  }

  private pick(): [number, number] {
    const w = window.innerWidth;
    const hh = window.innerHeight;
    if (w >= 760 && hh >= 560) return SIZES[0];
    if (w >= 500 && hh >= 400) return SIZES[1];
    return SIZES[2];
  }

  private setSize(s: [number, number]) {
    if (this.size) platform.clearBanner(ID);
    this.size = s;
    this.slot.style.width = `${s[0]}px`;
    this.slot.style.height = `${s[1]}px`;
  }

  private showFilled() {
    this.wrap.style.display = '';
    this.reserve(true);
  }

  /** keep the screen's own UI clear of the banner (a banner must never cover game UI) */
  private reserve(on: boolean) {
    const b = document.body;
    b.classList.toggle('ad-on', on);
    // banner + its frame (22 px) + the gap below it (6 px) + 2 px air
    if (on && this.size) document.documentElement.style.setProperty('--adh', `${this.size[1] + 30}px`);
  }

  private async request() {
    if (!this.spot || this.busy || this.maxed || !this.size) return;
    const now = Date.now();
    if (now < this.retryAt) return;
    if (this.filled && now - this.lastRequest < BANNER_REFRESH_MS) return;
    if (document.visibilityState === 'hidden' || platform.adPlaying) return;
    this.busy = true;
    // the container has to be laid out at its size while the SDK fills it; until the first banner
    // arrives the frame around it stays invisible
    this.wrap.style.display = '';
    this.wrap.classList.toggle('pending', !this.filled);
    const size = this.size;
    const res = await platform.requestBanner(ID, size[0], size[1]);
    this.busy = false;
    this.lastRequest = Date.now();
    if (res === 'ok') {
      this.filled = true;
      this.failures = 0;
    } else if (res === 'cooldown') this.retryAt = Date.now() + 5000;
    else if (res === 'max') this.maxed = true;
    else {
      // no banner here (ads off, blocked, no fill): back off and keep the screen clear
      this.failures++;
      this.retryAt = Date.now() + Math.min(600000, 60000 * this.failures);
    }
    if (!this.spot) {
      this.wrap.style.display = 'none';
      return;
    }
    this.wrap.classList.toggle('pending', !this.filled);
    if (this.filled) this.showFilled();
    else {
      this.wrap.style.display = 'none';
      this.reserve(false);
    }
  }

  private tick() {
    if (!this.spot || platform.adsMode === 'none') return;
    this.request();
  }

  private resized() {
    if (!this.spot || platform.adsMode === 'none') return;
    const s = this.pick();
    if (this.size && s[0] === this.size[0]) return;
    this.setSize(s);
    this.filled = false;
    this.lastRequest = 0;
    this.request();
  }
}
