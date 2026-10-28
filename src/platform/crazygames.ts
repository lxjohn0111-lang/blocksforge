// CrazyGames HTML5 SDK v3 bridge. The SDK script is loaded on demand, only on CrazyGames hosts: on
// any other host, or when the script is blocked, every call here is a safe no-op and the game
// behaves as standalone.
//
// Ads: on CrazyGames every ad goes through the SDK ('sdk'). Off CrazyGames (own hosting, previews)
// ad slots run a short labelled stand-in instead ('demo') so the reward flows can be tried; on
// CrazyGames without a working SDK (blocked script, ads switched off) there are no ads ('none') and
// every rewarded offer is hidden, so no button is ever left without effect.

interface AdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (e: unknown) => void;
}

export interface PlatformUser {
  username: string;
  avatar: string | null;
}

interface SdkUser {
  username: string;
  profilePictureUrl?: string;
}

interface CrazySDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?: (fn: (s: { muteAudio?: boolean }) => void) => void;
  };
  ad?: { requestAd(type: 'midgame' | 'rewarded', cb: AdCallbacks): void; hasAdblock?: () => Promise<boolean> };
  banner?: {
    requestBanner(b: { id: string; width: number; height: number }): Promise<void> | void;
    clearBanner?: (id: string) => void;
  };
  user?: {
    isUserAccountAvailable?: boolean;
    getUser?: () => Promise<SdkUser | null>;
    showAuthPrompt?: () => Promise<SdkUser | null>;
    addAuthListener?: (fn: (u: SdkUser | null) => void) => void;
  };
  data?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
}

function sdk(): CrazySDK | null {
  return (window as unknown as { CrazyGames?: { SDK?: CrazySDK } }).CrazyGames?.SDK ?? null;
}

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

/** the SDK only works on CrazyGames' domains (and sister portals), or locally with ?useLocalSdk=true */
function onCrazyGames() {
  try {
    const portal = /crazygames|1001juegos/i;
    const ancestors = Array.from((location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins ?? []);
    return portal.test(location.hostname) || portal.test(document.referrer) || ancestors.some((o) => portal.test(o)) || /useLocalSdk=true/.test(location.search);
  } catch {
    return false;
  }
}

function loadScript(src: string, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    const t = setTimeout(resolve, timeoutMs);
    el.onload = el.onerror = () => {
      clearTimeout(t);
      resolve();
    };
    document.head.appendChild(el);
  });
}

export type AdsMode = 'sdk' | 'demo' | 'none';

let active = false;
let playing = false;
let loading = false;
let muteListener: ((muted: boolean) => void) | null = null;
let adsMode: AdsMode = 'none';
let adPlaying = false;
let adblock = false;
let rewardedFails = 0;
let rewardedOffUntil = 0;
let lastDemoMidgame = 0;
let user: PlatformUser | null = null;
let userAvailable = false;
const adListeners = new Set<() => void>();
const userListeners = new Set<(u: PlatformUser | null) => void>();
const bootAt = performance.now();

function notifyAds() {
  for (const f of adListeners) f();
}

function toUser(u: SdkUser | null | undefined): PlatformUser | null {
  return u && u.username ? { username: String(u.username), avatar: u.profilePictureUrl ? String(u.profilePictureUrl) : null } : null;
}

function setUser(u: PlatformUser | null) {
  user = u;
  for (const f of userListeners) f(u);
}

/** run an SDK call, never letting a platform error reach the game */
function safe(fn: (s: CrazySDK) => void) {
  const s = sdk();
  if (!active || !s) return;
  try {
    fn(s);
  } catch (e) {
    console.warn('[CrazyGames SDK]', e);
  }
}

function errorCode(e: unknown) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  const o = e as { code?: string; message?: string };
  return String(o.code ?? o.message ?? e);
}

/** how long the stand-in ads take (tests shorten them) */
function demoMs(kind: 'midgame' | 'rewarded') {
  const t = (window as unknown as { __bfDemoAdMs?: number }).__bfDemoAdMs;
  return typeof t === 'number' ? t : kind === 'rewarded' ? 3000 : 2200;
}

/** the labelled stand-in shown where a video ad plays on CrazyGames */
function demoAd(kind: 'midgame' | 'rewarded', cb: AdCallbacks) {
  const ms = demoMs(kind);
  const box = document.createElement('div');
  box.className = 'demo-ad';
  const card = document.createElement('div');
  card.className = 'demo-ad-card';
  const t = document.createElement('div');
  t.className = 'demo-ad-t';
  t.textContent = kind === 'rewarded' ? 'Rewarded ad' : 'Advertisement';
  const d = document.createElement('div');
  d.className = 'demo-ad-d';
  d.textContent = 'Ad placeholder: on CrazyGames a short video ad plays here.';
  const bar = document.createElement('div');
  bar.className = 'demo-ad-bar';
  const fill = document.createElement('i');
  bar.appendChild(fill);
  card.append(t, d, bar);
  box.appendChild(card);
  document.body.appendChild(box);
  cb.adStarted?.();
  const t0 = performance.now();
  const step = () => {
    const f = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
    fill.style.width = `${f * 100}%`;
    if (f >= 1) {
      box.remove();
      cb.adFinished?.();
    } else setTimeout(step, 50);
  };
  step();
}

export const platform = {
  /** true when running inside CrazyGames (or its local test mode) with the SDK initialised */
  get active() {
    return active;
  },

  /**
   * Initialise before the game reads saved progress (init also preloads the player's saved data, so it
   * gets a generous timeout); gives up quietly if the SDK never answers.
   */
  async init(timeoutMs = 8000) {
    const portal = onCrazyGames();
    if (!sdk() && portal) await loadScript(SDK_URL, timeoutMs);
    const s = sdk();
    if (s) {
      try {
        await Promise.race([s.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('SDK init timeout')), timeoutMs))]);
        active = s.environment === 'crazygames' || s.environment === 'local';
      } catch (e) {
        console.warn('[CrazyGames SDK] not available:', e);
        active = false;
      }
    }
    const off = /[?&]ads=off\b/.test(location.search) || (window as unknown as { __bfAds?: string }).__bfAds === 'off';
    adsMode = off ? 'none' : active && s?.ad ? 'sdk' : !portal ? 'demo' : 'none';
    if (active && s) {
      safe((x) => x.game.addSettingsChangeListener?.((st) => muteListener?.(!!st.muteAudio)));
      if (adsMode === 'sdk' && s.ad?.hasAdblock) {
        s.ad.hasAdblock().then((b) => {
          adblock = !!b;
          if (adblock) notifyAds();
        }).catch(() => undefined);
      }
      await this.loadUser();
    }
  },

  // ------------------------------------------------------------------ account
  /** the signed-in CrazyGames player (null for guests and outside CrazyGames) */
  get user() {
    return user;
  },
  /** CrazyGames accounts can sign in here (shows a "Sign in" offer to guests) */
  get userAvailable() {
    return userAvailable;
  },
  onUser(fn: (u: PlatformUser | null) => void) {
    userListeners.add(fn);
    return () => userListeners.delete(fn);
  },
  async loadUser() {
    const s = sdk();
    if (!active || !s?.user) return;
    try {
      userAvailable = !!s.user.isUserAccountAvailable;
      s.user.addAuthListener?.((u) => setUser(toUser(u)));
      if (userAvailable && s.user.getUser) setUser(toUser(await s.user.getUser()));
    } catch (e) {
      console.warn('[CrazyGames SDK] user', e);
    }
  },
  /** only on a click: the platform's sign-in dialog */
  async signIn() {
    const s = sdk();
    if (!active || !s?.user?.showAuthPrompt) return;
    try {
      setUser(toUser(await s.user.showAuthPrompt()));
    } catch {
      /* closed or refused: stay a guest */
    }
  },

  // ------------------------------------------------------------------ game events
  loadingStart() {
    if (loading) return;
    loading = true;
    safe((s) => s.game.loadingStart());
  },
  loadingStop() {
    if (!loading) return;
    loading = false;
    safe((s) => s.game.loadingStop());
  },
  /** call when the player is in control (match running, no menu or pause on top) */
  gameplayStart() {
    if (playing || adPlaying) return;
    playing = true;
    safe((s) => s.game.gameplayStart());
  },
  /** call at every break: menus, pause, death screens, results */
  gameplayStop() {
    if (!playing) return;
    playing = false;
    safe((s) => s.game.gameplayStop());
  },
  /** a moment of celebration (a win, a promotion) */
  happytime() {
    safe((s) => s.game.happytime());
  },

  /** platform asks for silence (its own mute setting) */
  onMute(fn: (muted: boolean) => void) {
    muteListener = fn;
    safe((s) => fn(!!s.game.settings?.muteAudio));
  },

  // ------------------------------------------------------------------ ads
  get adsMode(): AdsMode {
    return adsMode;
  },
  get adPlaying() {
    return adPlaying;
  },
  /** rewarded offers can be shown (hidden with no ads, an ad blocker, or after repeated no-fills) */
  get rewardedReady() {
    return adsMode !== 'none' && !adblock && Date.now() >= rewardedOffUntil;
  },
  /** re-render ad offers when availability changes */
  onAdsChange(fn: () => void) {
    adListeners.add(fn);
    return () => adListeners.delete(fn);
  },

  /**
   * A midgame ad at a natural break. Asked for at every break: the SDK itself decides how often one
   * really plays (at most one every 3 minutes, none right at the start, spaced from rewarded ads) and
   * ignores the rest. `pause` freezes and mutes the game while one plays; `done` always runs.
   */
  midgameAd(pause: (paused: boolean) => void, done: () => void) {
    const s = sdk();
    let finished = false;
    let started = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (started) {
        adPlaying = false;
        pause(false);
      }
      done();
    };
    const cb: AdCallbacks = {
      adStarted: () => {
        started = true;
        adPlaying = true;
        this.gameplayStop();
        pause(true);
      },
      adFinished: finish,
      adError: finish,
    };
    if (adPlaying) return void done();
    if (adsMode === 'demo') {
      // the same pacing the SDK applies: not in the first 3 minutes, then at most one per 3 minutes
      const now = performance.now();
      if (now - bootAt < 180000 || now - lastDemoMidgame < 180000) return void done();
      lastDemoMidgame = now;
      demoAd('midgame', cb);
      return;
    }
    if (adsMode !== 'sdk' || !s?.ad) return void done();
    try {
      s.ad.requestAd('midgame', cb);
      // never leave the player stuck if the SDK stays silent
      setTimeout(() => {
        if (!finished && !started) finish();
      }, 8000);
    } catch (e) {
      console.warn('[CrazyGames SDK]', e);
      finish();
    }
  },

  /**
   * A rewarded video the player asked for. Resolves true when it was watched to the end (grant the
   * reward then), false when none could play. `pause` freezes and mutes the game during the ad.
   */
  rewardedAd(pause: (paused: boolean) => void): Promise<boolean> {
    const s = sdk();
    if (!this.rewardedReady || adPlaying) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let started = false;
      let finished = false;
      const end = (ok: boolean, err?: unknown) => {
        if (finished) return;
        finished = true;
        if (started) {
          adPlaying = false;
          pause(false);
        }
        if (ok) rewardedFails = 0;
        else {
          if (err) console.warn('[CrazyGames SDK] rewarded:', errorCode(err));
          // several no-fills in a row: stop offering rewards for a while instead of dead buttons
          if (++rewardedFails >= 3) {
            rewardedFails = 0;
            rewardedOffUntil = Date.now() + 180000;
            notifyAds();
            setTimeout(notifyAds, 180500);
          }
        }
        resolve(ok);
      };
      const cb: AdCallbacks = {
        adStarted: () => {
          started = true;
          adPlaying = true;
          this.gameplayStop();
          pause(true);
        },
        adFinished: () => end(true),
        adError: (e) => end(false, e ?? 'adError'),
      };
      if (adsMode === 'demo') return demoAd('rewarded', cb);
      if (!s?.ad) return end(false, 'no sdk');
      try {
        s.ad.requestAd('rewarded', cb);
        setTimeout(() => {
          if (!started) end(false, 'timeout');
        }, 12000);
      } catch (e) {
        end(false, e);
      }
    });
  },

  /**
   * Fill (or refresh) the banner container with this id at one of the SDK's sizes. Resolves 'ok',
   * 'cooldown' (asked again too soon), 'max' (session refresh limit reached) or 'error'.
   */
  async requestBanner(id: string, width: number, height: number): Promise<'ok' | 'cooldown' | 'max' | 'error'> {
    if (adsMode === 'demo') {
      const el = document.getElementById(id);
      if (!el) return 'error';
      el.textContent = '';
      const ph = document.createElement('div');
      ph.className = 'demo-banner';
      ph.textContent = `Banner ad ${width}×${height} · placeholder (real ads on CrazyGames)`;
      el.appendChild(ph);
      return 'ok';
    }
    const s = sdk();
    if (adsMode !== 'sdk' || !s?.banner || adPlaying) return 'error';
    try {
      await s.banner.requestBanner({ id, width, height });
      return 'ok';
    } catch (e) {
      const c = errorCode(e);
      if (/cooldown/i.test(c)) return 'cooldown';
      if (/maxRefresh/i.test(c)) return 'max';
      console.warn('[CrazyGames SDK] banner:', c);
      return 'error';
    }
  },
  clearBanner(id: string) {
    if (adsMode === 'demo') {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
      return;
    }
    safe((s) => s.banner?.clearBanner?.(id));
  },

  /**
   * The SDK's data module: the player's progress, synced to their CrazyGames account (kept locally
   * for guests and moved to the account when they sign in). Null outside CrazyGames.
   */
  storage(): { get(k: string): string | null; set(k: string, v: string): boolean; remove(k: string): void } | null {
    const s = sdk();
    if (!active || !s?.data) return null;
    const d = s.data;
    return {
      get: (k) => {
        try {
          const v = d.getItem(k);
          return typeof v === 'string' ? v : v == null ? null : JSON.stringify(v);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          d.setItem(k, v);
          return true;
        } catch (e) {
          console.warn('[CrazyGames SDK] save failed', e);
          return false;
        }
      },
      remove: (k) => {
        try {
          d.removeItem(k);
        } catch {
          /* ignore */
        }
      },
    };
  },
};
