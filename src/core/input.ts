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

  constructor(private canvas: HTMLElement, public settings: Settings) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
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
    window.addEventListener('blur', () => this.clearAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearAll();
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.clearAll();
      else this.ignoreClickUntil = performance.now() + 120;
      if (was !== this.locked) this.onLockChange?.(this.locked);
    });
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = (this.canvas as any).requestPointerLock?.({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(() => (this.canvas as any).requestPointerLock?.());
    } catch {
      try {
        (this.canvas as any).requestPointerLock?.();
      } catch {
        /* not supported */
      }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clearAll() {
    for (const k of this.down) this.released.add(k);
    this.down.clear();
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
      if (isDown) this.onEscape?.();
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
