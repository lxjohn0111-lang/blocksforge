// Keyboard + mouse input with rebindable actions, pointer lock, edge
// detection and protection against stuck keys (blur / lock loss clears all).

import type { Action, Settings } from './settings';

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  enabled = true;
  /** set while a UI wants raw key capture (rebinding) */
  captureNext: ((code: string) => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  onEscape: (() => void) | null = null;
  private ignoreClickUntil = 0;
  /** pointer lock refused by this page's host (some embedded views): steer with plain mouse movement */
  private fallback = false;
  private lastUnlock = -1e9;
  private requestedWithGesture = false;
  /** touch-screen controls drive input: no pointer lock, mouse events ignored */
  touchMode = false;
  /** analog movement from the on-screen stick: x = strafe right, y = forward (null when idle) */
  moveAxis: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLElement, public settings: Settings) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || this.touchMode) return;
      // ignore spikes some browsers emit right after locking
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) {
          this.wheel += Math.sign(e.deltaY);
          e.preventDefault();
        }
      },
      { passive: false },
    );
    // losing focus (a click on the host page, an ad) means keys no longer reach the game: drop held
    // keys, and leave cursor steering so "Click to play" brings the focus back
    window.addEventListener('blur', () => {
      this.clearAll();
      if (this.fallback && this.locked && !this.touchMode) this.setFallbackLocked(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearAll();
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      if (document.pointerLockElement === this.canvas) {
        // a real lock always wins, also over cursor steering
        this.fallback = false;
        this.locked = true;
        this.ignoreClickUntil = performance.now() + 120;
      } else {
        // cursor steering keeps its own state when the browser's lock goes away
        if (this.fallback) return;
        this.locked = false;
        this.clearAll();
        this.lastUnlock = performance.now();
      }
      if (was !== this.locked) this.onLockChange?.(this.locked);
    });
    // Chrome refuses a re-lock for about a second after Esc; another refusal of a click (a host that
    // doesn't allow pointer lock) switches to cursor steering for now rather than a dead camera, and
    // the next click asks for a real lock again (a request without a click is refused by every
    // browser, so only a refused click counts)
    document.addEventListener('pointerlockerror', () => {
      if (this.requestedWithGesture && performance.now() - this.lastUnlock > 1500) this.enterFallback();
    });
    // no browser context menu anywhere in the game (text fields keep theirs)
    window.addEventListener('contextmenu', (e) => {
      if (!(e.target as HTMLElement | null)?.closest?.('input, textarea')) e.preventDefault();
    });
  }

  /** keyboard focus for the game's page (best effort: browsers only move it on a user action) */
  focus() {
    try {
      window.focus();
      (this.canvas as HTMLElement & { focus(o?: FocusOptions): void }).focus({ preventScroll: true });
    } catch {
      /* not allowed here */
    }
  }

  requestLock() {
    this.focus();
    if (this.touchMode) {
      this.setFallbackLocked(true);
      return;
    }
    // already a real lock (with cursor steering, every click asks for the real one again)
    if (this.locked && !this.fallback) return;
    const el = this.canvas as HTMLElement & { requestPointerLock?: (o?: object) => Promise<void> | void };
    if (typeof el.requestPointerLock !== 'function') {
      this.enterFallback();
      return;
    }
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    this.requestedWithGesture = ua ? ua.isActive : true;
    try {
      // a plain request: some systems refuse the raw-input (unadjustedMovement) option outright
      const p = el.requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
    } catch {
      /* refused: pointerlockerror decides */
    }
  }

  exitLock() {
    if (this.fallback || this.touchMode) {
      this.setFallbackLocked(false);
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- on-screen (touch) controls feed the same action state as keys and mouse buttons
  pressAction(a: Action) {
    const code = this.code(a);
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  releaseAction(a: Action) {
    const code = this.code(a);
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.released.add(code);
  }

  /** a tap: pressed this frame, released right away */
  tapAction(a: Action) {
    this.pressAction(a);
    this.releaseAction(a);
  }

  /** camera turn from a drag, in mouse-pixel units */
  addLook(dx: number, dy: number) {
    if (!this.locked) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** true when the camera is steered by the visible cursor because pointer lock is unavailable */
  get cursorSteering() {
    return this.fallback;
  }

  private enterFallback() {
    this.fallback = true;
    this.setFallbackLocked(true);
  }

  private setFallbackLocked(v: boolean) {
    const was = this.locked;
    this.locked = v;
    if (!v) {
      this.clearAll();
      this.lastUnlock = performance.now();
    } else this.ignoreClickUntil = performance.now() + 120;
    if (was !== v) this.onLockChange?.(v);
  }

  clearAll() {
    for (const k of this.down) this.released.add(k);
    this.down.clear();
    this.moveAxis = null;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  private onKey(e: KeyboardEvent, isDown: boolean) {
    if (isDown && this.captureNext) {
      e.preventDefault();
      const cb = this.captureNext;
      this.captureNext = null;
      cb(e.code);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Escape') {
      // cursor steering has no browser-managed lock to drop, so Esc releases it here (which pauses)
      if (isDown && this.fallback && this.locked) this.setFallbackLocked(false);
      else if (isDown) this.onEscape?.();
      return;
    }
    if (e.code === 'Tab' || e.code === 'Space' || (this.locked && (e.ctrlKey || e.code.startsWith('Digit')))) e.preventDefault();
    if (this.locked && e.ctrlKey && (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyD' || e.code === 'KeyA')) e.preventDefault();
    if (isDown) {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    } else {
      this.down.delete(e.code);
      this.released.add(e.code);
    }
  }

  private onMouse(e: MouseEvent, isDown: boolean) {
    // on touch screens the browser synthesises mouse events from taps; the on-screen controls own input
    if (this.touchMode) return;
    const code = 'Mouse' + e.button;
    if (isDown && this.captureNext) {
      e.preventDefault();
      const cb = this.captureNext;
      this.captureNext = null;
      cb(code);
      return;
    }
    if (!this.locked) {
      if (!isDown) this.down.delete(code);
      return;
    }
    if (isDown && performance.now() < this.ignoreClickUntil) return;
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }

  private code(a: Action) {
    return this.settings.bindings[a];
  }

  isDown(a: Action) {
    return this.enabled && this.down.has(this.code(a));
  }
  wasPressed(a: Action) {
    return this.enabled && this.pressed.has(this.code(a));
  }
  wasReleased(a: Action) {
    return this.released.has(this.code(a));
  }
  rawPressed(code: string) {
    return this.pressed.has(code);
  }

  consumeMouse(): [number, number] {
    const r: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
