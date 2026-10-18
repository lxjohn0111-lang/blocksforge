// CrazyGames HTML5 SDK v3 bridge. The SDK script (index.html) is optional: on any other host, or
// when the script is blocked, every call here is a safe no-op and the game behaves as standalone.

interface AdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (e: unknown) => void;
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
  ad?: { requestAd(type: 'midgame' | 'rewarded', cb: AdCallbacks): void };
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

let active = false;
let playing = false;
let loading = false;
let lastAd = 0;
let muteListener: ((muted: boolean) => void) | null = null;

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

export const platform = {
  /** true when running inside CrazyGames (or its local test mode) with the SDK initialised */
  get active() {
    return active;
  },

  /** initialise before the game reads saved progress; gives up quietly after a few seconds */
  async init(timeoutMs = 4000) {
    if (!sdk() && onCrazyGames()) await loadScript(SDK_URL, timeoutMs);
    const s = sdk();
    if (!s) return;
    try {
      await Promise.race([s.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('SDK init timeout')), timeoutMs))]);
      active = s.environment === 'crazygames' || s.environment === 'local';
    } catch (e) {
      console.warn('[CrazyGames SDK] not available:', e);
      active = false;
    }
    if (active) {
      safe((x) => x.game.addSettingsChangeListener?.((st) => muteListener?.(!!st.muteAudio)));
    }
  },

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
    if (playing) return;
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

  /**
   * A midgame ad between matches, at most every three minutes. `pause` mutes and freezes the game
   * while the ad plays; `done` always runs (also when no ad is shown or it fails).
   */
  midgameAd(pause: (paused: boolean) => void, done: () => void) {
    const s = sdk();
    if (!active || !s?.ad || performance.now() - lastAd < 180000) {
      done();
      return;
    }
    let finished = false;
    let started = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      pause(false);
      done();
    };
    try {
      s.ad.requestAd('midgame', {
        adStarted: () => {
          started = true;
          lastAd = performance.now();
          pause(true);
        },
        adFinished: finish,
        adError: finish,
      });
      // never leave the player stuck if the SDK stays silent
      setTimeout(() => {
        if (!finished && !started) finish();
      }, 8000);
    } catch (e) {
      console.warn('[CrazyGames SDK]', e);
      finish();
    }
  },

  /** the SDK's data module (cloud saves for signed-in players); null outside CrazyGames */
  storage(): { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void } | null {
    const s = sdk();
    if (!active || !s?.data || s.environment !== 'crazygames') return null;
    const d = s.data;
    return {
      get: (k) => {
        try {
          return d.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          d.setItem(k, v);
        } catch (e) {
          console.warn('[CrazyGames SDK] save failed', e);
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
