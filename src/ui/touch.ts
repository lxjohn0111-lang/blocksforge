// On-screen controls for touch screens. A floating stick on the left moves, dragging anywhere
// else turns the camera, and thumb buttons on the right map onto the same actions as keys
// and mouse buttons, so the player controller needs no touch-specific logic.

import type { Input } from '../core/input';
import type { Action, Settings } from '../core/settings';
import { h } from './dom';
import { ICON } from './icons';

export interface TouchState {
  overlay: string;
  alive: boolean;
  inShip: boolean;
  falling: boolean;
  prompt: string;
  buildMode: boolean;
  hasGun: boolean;
  canBuild: boolean;
  hasMap: boolean;
  bagLabel: string;
  throws: number;
  heals: number;
  ended: boolean;
}

export interface TouchHooks {
  pause(): void;
  bag(): void;
  map(): void;
  state(): TouchState;
}

const svg = (inner: string, z = 26) =>
  `<svg width="${z}" height="${z}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">${inner}</svg>`;

const GLYPH = {
  fire: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>', 34),
  aim: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'),
  jump: svg('<path d="M5 14l7-7 7 7M12 7v13"/>'),
  crouch: svg('<path d="M5 9l7 7 7-7M12 16V3"/>'),
  reload: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>'),
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L3.5 13a1.5 1.5 0 0 1 2.5-1.6L8 14"/>', 22),
  place: svg('<path d="M4 20h16M7 20V10h10v10M7 14h10" />', 32),
  rotate: svg('<rect x="3" y="7" width="18" height="11" rx="1"/><path d="M8 3h8M12 3v2" stroke-width="1.6"/>', 54),
  pause: svg('<path d="M8 5v14M16 5v14"/>', 20),
  bag: svg('<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>', 20),
};

export class TouchControls {
  root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private joyId: number | null = null;
  private joyX = 0;
  private joyY = 0;
  private looks = new Map<number, { x: number; y: number }>();
  private aimOn = false;
  private crouchOn = false;
  private b: Record<string, HTMLElement> = {};
  private promptText: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement, private input: Input, private settings: Settings, private hooks: TouchHooks) {
    this.root = h('div', { class: 'touch-ui' });
    this.stick = h('div', { class: 'tstick' }, (this.knob = h('div', { class: 'knob' })));
    this.root.appendChild(this.stick);
    this.promptText = h('span', { class: 'lbl' });

    // right thumb cluster
    this.b.fire = this.button('t-fire', GLYPH.fire, 'fire', { look: true });
    this.b.aim = this.button('t-aim', GLYPH.aim, null, { toggle: 'aim' });
    this.b.jump = this.button('t-jump', GLYPH.jump, 'jump');
    this.b.crouch = this.button('t-crouch', GLYPH.crouch, null, { toggle: 'crouch' });
    this.b.reload = this.button('t-reload', GLYPH.reload, 'reload', { tap: true });
    this.b.interact = this.button('t-use pill', GLYPH.hand, 'interact', { tap: true });
    this.b.interact.appendChild(this.promptText);
    // quick-use gear (the hotbar is tappable too: pick, hammer, heals and throwables live there)
    this.b.grenade = this.button('t-gren small', ICON.grenade(20), 'grenade');
    this.b.heal = this.button('t-heal small', ICON.medkit(20), 'heal', { tap: true });
    this.b.build = this.button('t-build small', ICON.wall(20), 'build', { tap: true });
    // corner buttons
    this.b.pause = this.button('t-pause corner', GLYPH.pause, null, { onTap: () => this.hooks.pause() });
    this.b.bag = this.button('t-bag corner', GLYPH.bag, null, { onTap: () => this.hooks.bag() });
    this.b.map = this.button('t-map corner', ICON.map(20), null, { onTap: () => this.hooks.map() });

    // phones held upright: the HUD needs the width, so ask for landscape (CSS shows this only in portrait)
    const rot = h('div', { class: 'rotate' }, h('span', { html: GLYPH.rotate }), h('b', null, 'Turn your device sideways'), h('span', null, 'BlockForge plays in landscape.'));
    rot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.appendChild(rot);
    const r = this.root;
    r.addEventListener('pointerdown', (e) => this.onDown(e));
    r.addEventListener('pointermove', (e) => this.onMove(e));
    r.addEventListener('pointerup', (e) => this.onUp(e));
    r.addEventListener('pointercancel', (e) => this.onUp(e));
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.appendChild(r);
  }

  private button(cls: string, icon: string, action: Action | null, opts: { tap?: boolean; look?: boolean; toggle?: 'aim' | 'crouch'; onTap?: () => void } = {}) {
    const el = h('div', { class: 'tbtn ' + cls, html: icon });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      if (opts.onTap) opts.onTap();
      else if (opts.toggle) this.toggle(opts.toggle);
      else if (action && opts.tap) this.input.tapAction(action);
      else if (action) this.input.pressAction(action);
      if (opts.look) this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const end = (e: PointerEvent) => {
      e.stopPropagation();
      el.classList.remove('down');
      if (action && !opts.tap && !opts.toggle) this.input.releaseAction(action);
      this.looks.delete(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointermove', (e) => {
      e.stopPropagation();
      if (opts.look) this.lookMove(e);
    });
    this.root.appendChild(el);
    return el;
  }

  private toggle(which: 'aim' | 'crouch') {
    const on = which === 'aim' ? (this.aimOn = !this.aimOn) : (this.crouchOn = !this.crouchOn);
    if (on) this.input.pressAction(which);
    else this.input.releaseAction(which);
    this.b[which].classList.toggle('on', on);
  }

  private onDown(e: PointerEvent) {
    e.preventDefault();
    this.root.setPointerCapture(e.pointerId);
    const w = window.innerWidth;
    if (this.joyId === null && e.clientX < w * 0.45) {
      this.joyId = e.pointerId;
      this.joyX = e.clientX;
      this.joyY = e.clientY;
      this.stick.classList.add('active');
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.style.bottom = 'auto';
      this.setKnob(0, 0);
    } else {
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId === this.joyId) {
      const R = this.stickRadius();
      let dx = (e.clientX - this.joyX) / R;
      let dy = (e.clientY - this.joyY) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.setKnob(dx, dy);
      const m = Math.hypot(dx, dy);
      this.input.moveAxis = m < 0.12 ? { x: 0, y: 0 } : { x: dx, y: -dy };
    } else if (this.looks.has(e.pointerId)) this.lookMove(e);
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.input.moveAxis = null;
      this.stick.classList.remove('active');
      this.stick.style.left = '';
      this.stick.style.top = '';
      this.stick.style.bottom = '';
      this.setKnob(0, 0);
    }
    this.looks.delete(e.pointerId);
  }

  private lookMove(e: PointerEvent) {
    const prev = this.looks.get(e.pointerId);
    if (!prev) return;
    // a thumb swipe across the screen turns roughly half a circle at the default speed
    const k = 1.9 * this.settings.touchLook;
    this.input.addLook((e.clientX - prev.x) * k, (e.clientY - prev.y) * k);
    prev.x = e.clientX;
    prev.y = e.clientY;
  }

  private stickRadius() {
    return Math.max(44, Math.min(70, Math.min(window.innerWidth, window.innerHeight) * 0.13));
  }

  private setKnob(x: number, y: number) {
    const R = this.stickRadius();
    this.knob.style.transform = `translate(calc(-50% + ${x * R}px), calc(-50% + ${y * R}px))`;
  }

  /** per frame: show what's usable right now */
  update() {
    const s = this.hooks.state();
    const hidden = s.overlay !== 'none' || s.ended;
    this.root.style.display = hidden ? 'none' : '';
    if (hidden) {
      // an overlay took over: let go of everything so nothing stays held
      this.releaseAll();
      return;
    }
    const play = s.alive && !s.inShip && !s.falling;
    // toggles don't survive death, the drop or switching to the hammer (aim removes blocks there)
    if (this.aimOn && (!play || s.buildMode || !s.hasGun)) this.toggle('aim');
    if (this.crouchOn && !play) this.toggle('crouch');
    const key = [s.alive, s.inShip, s.falling, s.prompt, s.buildMode, s.hasGun, s.canBuild, s.hasMap, s.bagLabel, s.throws > 0, s.heals > 0].join('|');
    if (key === this.last) return;
    this.last = key;
    const show = (k: string, on: boolean) => (this.b[k].style.display = on ? '' : 'none');
    show('fire', play);
    show('aim', play && s.hasGun && !s.buildMode);
    show('jump', s.alive);
    show('crouch', play);
    show('reload', play && s.hasGun && !s.buildMode);
    show('interact', play && !!s.prompt);
    show('grenade', play && s.throws > 0 && !s.buildMode);
    show('heal', play && s.heals > 0 && !s.buildMode);
    show('build', play && s.canBuild);
    this.b.build.classList.toggle('on', s.buildMode);
    // in build mode the fire button places the piece
    this.b.fire.innerHTML = s.buildMode ? GLYPH.place : GLYPH.fire;
    this.b.fire.classList.toggle('placing', s.buildMode);
    show('map', s.hasMap);
    show('bag', !!s.bagLabel);
    this.b.bag.title = s.bagLabel;
    this.promptText.textContent = s.prompt;
    this.stick.style.display = s.alive && !s.inShip ? '' : 'none';
  }

  releaseAll() {
    for (const a of ['fire', 'jump', 'grenade'] as Action[]) this.input.releaseAction(a);
    if (this.aimOn) this.toggle('aim');
    if (this.crouchOn) this.toggle('crouch');
    this.looks.clear();
    if (this.joyId !== null) {
      this.joyId = null;
      this.stick.classList.remove('active');
      this.stick.style.left = '';
      this.stick.style.top = '';
      this.stick.style.bottom = '';
      this.setKnob(0, 0);
    }
    this.input.moveAxis = null;
    for (const el of Object.values(this.b)) el.classList.remove('down');
  }

  dispose() {
    this.releaseAll();
    this.root.remove();
  }
}
