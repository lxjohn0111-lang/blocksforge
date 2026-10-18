import * as THREE from 'three';
import { h, clear } from './dom';
import { ICON, avatarCanvas } from './icons';
import { drawMap } from './minimap';
import type { Match, DamageEvent, KillEvent } from '../game/match';
import type { PlayerController } from '../game/player';
import { BRMatch } from '../game/brMatch';
import { TDMMatch, LOADOUTS } from '../game/tdmMatch';
import { TutorialMatch } from '../game/tutorial';
import { WEAPONS, HEALS, THROWABLES, MATERIALS, AMMO_NAMES, type MaterialKind, itemName } from '../game/weapons';
import { weaponIcon, boxIcon, bandageModel, medkitModel, plateModel, fragModel, smokeModel, pickaxeModel, hammerModel } from '../render/weaponModels';
import { blockIconCanvas } from '../render/textures';
import { B } from '../world/blocks';
import { RECIPES, canAfford } from '../game/crafting';
import { PIECES, PIECE_LABEL, PIECE_COST, type Piece } from '../game/building';
import type { BuildMat } from '../world/blocks';
import { keyLabel, type Settings, type Action } from '../core/settings';
import { loadJSON, saveJSON } from '../core/storage';
import { audio } from '../audio/audio';
import { clamp, fmtTime } from '../core/mathx';

const iconCache = new Map<string, HTMLCanvasElement>();
function icon(key: string, make: () => HTMLCanvasElement) {
  let c = iconCache.get(key);
  if (!c) {
    c = make();
    iconCache.set(key, c);
  }
  return c.cloneNode(true) as HTMLCanvasElement & { getContext: any };
}
function cloneCanvas(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
export function weaponCanvas(id: string, w = 160, hgt = 60) {
  const key = `w:${id}:${w}`;
  if (!iconCache.has(key)) iconCache.set(key, weaponIcon(id as any, w, hgt));
  return cloneCanvas(iconCache.get(key)!);
}
function itemCanvas(kind: string) {
  const key = 'i:' + kind;
  if (!iconCache.has(key)) {
    const m: Record<string, () => HTMLCanvasElement> = {
      bandage: () => boxIcon(bandageModel(), 60, 40, undefined, 'front'),
      medkit: () => boxIcon(medkitModel(), 60, 40),
      plate: () => boxIcon(plateModel(), 60, 40, undefined, 'front'),
      frag: () => boxIcon(fragModel(), 60, 40),
      smoke: () => boxIcon(smokeModel(), 60, 40),
      pickaxe: () => boxIcon(pickaxeModel(), 70, 44),
      hammer: () => boxIcon(hammerModel(), 70, 44),
    };
    iconCache.set(key, (m[kind] ?? (() => document.createElement('canvas')))());
  }
  return cloneCanvas(iconCache.get(key)!);
}
const MAT_BLOCK: Record<MaterialKind, number> = { wood: B.OAK_PLANKS, stone: B.COBBLE, metal: B.METAL_PLATE, cloth: B.WOOL_WHITE, powder: B.COAL_ORE };
function matCanvas(m: MaterialKind) {
  const key = 'm:' + m;
  if (!iconCache.has(key)) iconCache.set(key, blockIconCanvas(MAT_BLOCK[m], 40));
  return cloneCanvas(iconCache.get(key)!);
}

/** what each build piece is for, in a word */
const PIECE_USE: Record<Piece, string> = { wall: 'Cover', floor: 'Bridge', ramp: 'Climb', block: 'Fill' };
const BUILD_MATS: BuildMat[] = ['wood', 'stone', 'metal'];

/** one-time coaching state, kept across matches */
interface Tips {
  /** the build coach card was read */
  build?: boolean;
  /** pieces the player has placed, ever: tips stop once building is a habit */
  built?: number;
}
const TIPS_KEY = 'blockforge.tips.v1';

interface Hooks {
  resume(): void;
  leave(): void;
  settings(): void;
  continueAfterDeath(): void;
  lockPointer(): void;
  unlockPointer(): void;
}

export class HUD {
  root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private hitT = 0;
  private hitKind = '';
  private dmgDirs: { yaw: number; t: number }[] = [];
  private dmgNums: { el: HTMLElement; pos: THREE.Vector3; t: number; vy: number }[] = [];
  private pings: { x: number; z: number; t: number }[] = [];
  private tags = new Map<number, HTMLElement>();
  private miniCtx: CanvasRenderingContext2D;
  private dmgCtx: CanvasRenderingContext2D;
  private ringCtx: CanvasRenderingContext2D;
  overlay: 'none' | 'pause' | 'inventory' | 'map' | 'scoreboard' | 'death' = 'none';
  private overlayEl: HTMLElement | null = null;
  private feedItems: HTMLElement[] = [];
  private announceTimer = 0;
  private fpsT = 0;
  private frames = 0;
  private fpsVal = 0;
  private deathShown = false;
  private respawnEl: HTMLElement | null = null;
  private crossSpread = 0;
  /** touch-screen controls are active (changes hint text and tappable controls) */
  touch = false;
  private tips: Tips = loadJSON<Tips>(TIPS_KEY) ?? {};
  private tipTimer = 0;
  private lastBuildTip = -1e9;
  private buildTime = 0;
  private wasAirborne = true;

  constructor(parent: HTMLElement, public match: Match, public pc: PlayerController, public settings: Settings, private hooks: Hooks) {
    this.root = h('div', { class: 'hud mode-' + match.cfg.mode });
    parent.appendChild(this.root);
    const E = this.els;
    const mk = (k: string, el: HTMLElement) => {
      E[k] = el;
      this.root.appendChild(el);
      return el;
    };
    mk('cross', h('div', { class: 'cross' }, h('i', { class: 'dot' }), h('i', { class: 'l' }), h('i', { class: 'r' }), h('i', { class: 't' }), h('i', { class: 'b' })));
    mk('hit', h('div', { class: 'hitmark' }, h('i'), h('i'), h('i'), h('i')));
    const ring = h('canvas', { class: 'ring', width: 128, height: 128 });
    mk('ring', ring);
    this.ringCtx = ring.getContext('2d')!;
    const dmg = h('canvas', { class: 'dmgind', width: 440, height: 440 });
    mk('dmg', dmg);
    this.dmgCtx = dmg.getContext('2d')!;
    mk('tags', h('div', { class: 'tags' }));
    mk('nums', h('div', {}));
    mk('scope', h('div', { class: 'scope', style: { display: 'none' } }, h('div', { class: 'mask' }), h('div', { html: this.scopeSvg() }), h('div', { class: 'zoom' })));
    mk('prompt', h('div', { class: 'prompt', style: { display: 'none' } }));
    // vitals
    const segs = (cls: string) => h('div', { class: 'segbar ' + cls }, ...Array.from({ length: 10 }, () => h('i', null, h('b'))));
    mk(
      'vitals',
      h('div', { class: 'vitals' }, segs('ar'), segs('hp'), h('div', { class: 'nums' }, h('span', { 'data-k': 'hp' }), h('span', { 'data-k': 'ar' }))),
    );
    mk('slots', h('div', { class: 'slots' }));
    mk('ammo', h('div', { class: 'ammo' }, h('div', { class: 'wn' }), h('div', { class: 'mag' }), h('div', { class: 'extra' })));
    mk('mats', h('div', { class: 'mats' }));
    mk('buildbar', h('div', { class: 'buildbar', style: { display: 'none' } }));
    // compass
    const strip = h('div', { class: 'strip' });
    mk('compass', h('div', { class: 'compass' }, strip, h('div', { class: 'center' })));
    E.strip = strip;
    const mm = h('canvas', { width: 392, height: 392 });
    mk('minimap', h('div', { class: 'minimap' }, mm));
    this.miniCtx = mm.getContext('2d')!;
    mk('status', h('div', { class: 'mstatus' }));
    mk('score', h('div', { class: 'scorebar', style: { display: 'none' } }));
    mk('feed', h('div', { class: 'feed' }));
    mk('toasts', h('div', { class: 'toasts' }));
    mk('announce', h('div', { style: { display: 'none' } }));
    mk('drop', h('div', { class: 'droptip', style: { display: 'none' } }));
    mk('shield', h('div', { class: 'spawnshield', style: { display: 'none' } }, 'Spawn protection'));
    mk('fps', h('div', { class: 'fps', style: { display: settings.showFps ? 'block' : 'none' } }));
    mk('tut', h('div', { class: 'tut panel', style: { display: 'none' } }));
    // tips sit at the top of the toast stack so the two never overlap
    E.tip = h('div', { class: 'tipbar', style: { display: 'none' } });
    E.toasts.appendChild(E.tip);
    mk('coach', h('div', { class: 'coach panel clickable', style: { display: 'none' } }));
    this.buildCompass();
    this.applyCrossColor();

    const m = match;
    const p = m.player;
    m.events.on('damage', (e) => this.onDamage(e));
    m.events.on('kill', (e) => this.onKill(e));
    m.events.on('toast', (t) => t.text && this.toast(t.text, t.kind));
    m.events.on('announce', (a) => this.announce(a.title, a.sub, a.kind));
    m.events.on('pickup', ({ c, spec }) => {
      if (c === p) this.toast('+ ' + itemName(spec), 'loot');
    });
    m.events.on('built', ({ c }) => {
      if (c !== p) return;
      this.tips.built = (this.tips.built ?? 0) + 1;
      saveJSON(TIPS_KEY, this.tips);
      if (this.els.tip.dataset.kind === 'build') this.tipTimer = 0;
      if (!this.tips.build && this.els.coach.style.display !== 'none') this.dismissCoach();
    });
    m.events.on('craft', ({ c, recipe }) => {
      if (c === p) {
        this.toast('Crafted ' + recipe.name, 'good');
        if (this.overlay === 'inventory') this.openInventory();
      }
    });
    m.events.on('respawn', ({ c }) => {
      if (c === p) this.closeOverlay();
    });
    m.events.on('fire', ({ c }) => {
      if (c !== p && m.isEnemy(p, c)) this.pings.push({ x: c.body.pos.x, z: c.body.pos.z, t: m.time });
    });
  }

  /** switch the HUD into touch-screen mode: tappable hotbar and build bar, touch hints */
  enableTouch() {
    this.touch = true;
    this.root.classList.add('touch');
    for (const el of [this.els.slots, this.els.buildbar]) {
      el.classList.add('clickable');
      el.addEventListener('pointerdown', (e) => {
        const mat = (e.target as HTMLElement).closest('[data-mat]') as HTMLElement | null;
        const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
        if (!mat && !t) return;
        e.preventDefault();
        e.stopPropagation();
        if (mat) {
          this.pc.buildMat = mat.dataset.mat as BuildMat;
          audio.ui('click', 0.5);
        } else this.pc.input.tapAction(t!.dataset.act as Action);
      });
    }
    this.last.tut = '';
  }

  applyCrossColor() {
    this.els.cross.style.setProperty('--xc', this.settings.crosshairColor);
    this.els.fps.style.display = this.settings.showFps ? 'block' : 'none';
  }

  private scopeSvg() {
    return `<svg width="760" height="760" viewBox="0 0 760 760" style="width:min(84vh,84vw);height:min(84vh,84vw)">
      <g stroke="#0a0a0a" fill="none">
        <path d="M0 380H330M430 380H760M380 0V330M380 430V760" stroke-width="3"/>
        <path d="M330 380H370M390 380H430M380 330V370M380 390V430" stroke-width="1.2"/>
        ${[1, 2, 3, 4].map((i) => `<path d="M${380 - 8} ${380 + i * 18}h16" stroke-width="1.2"/>`).join('')}
        ${[1, 2, 3].map((i) => `<path d="M${380 + i * 22} 375v10M${380 - i * 22} 375v10" stroke-width="1.2"/>`).join('')}
      </g>
      <circle cx="380" cy="380" r="1.6" fill="#ff3a2a"/>
    </svg>`;
  }

  private buildCompass() {
    const strip = this.els.strip;
    clear(strip);
    // 0..720 degrees so we can wrap smoothly; 4px per degree
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -180; d <= 540; d += 15) {
      const dd = ((d % 360) + 360) % 360;
      const x = (d + 180) * 4;
      if (labels[dd]) strip.appendChild(h('div', { class: 't' + (dd % 90 === 0 ? ' c' : ''), style: { left: x + 'px' } }, labels[dd]));
      else strip.appendChild(h('div', { class: 't', style: { left: x + 'px', fontSize: '9px', top: '10px' } }, String(dd)));
      strip.appendChild(h('div', { class: 'tick', style: { left: x + 'px' } }));
    }
    this.els.markers = h('div', { style: { position: 'absolute', inset: '0' } });
    this.els.compass.appendChild(this.els.markers);
  }

  private set(key: string, el: HTMLElement, text: string) {
    if (this.last[key] === text) return;
    this.last[key] = text;
    el.textContent = text;
  }
  private setHTML(key: string, el: HTMLElement, html: string) {
    if (this.last[key] === html) return;
    this.last[key] = html;
    el.innerHTML = html;
  }

  toast(text: string, kind = 'info') {
    const t = h('div', { class: 'toast ' + kind }, text);
    this.els.toasts.appendChild(t);
    const shown = this.els.toasts.querySelectorAll('.toast');
    for (let i = 0; i < shown.length - (this.touch ? 2 : 3); i++) shown[i].remove();
    setTimeout(() => t.remove(), 2600);
  }

  announce(title: string, sub = '', kind = '') {
    const a = this.els.announce;
    a.className = 'announce ' + kind;
    a.style.display = 'block';
    clear(a);
    a.appendChild(h('div', { class: 't' }, title));
    if (sub) a.appendChild(h('div', { class: 's' }, sub));
    this.announceTimer = kind === 'win' || kind === 'lose' ? 4 : 2.6;
  }

  private onDamage(e: DamageEvent) {
    const p = this.match.player;
    if (e.attacker === p && e.target !== p) {
      this.hitT = 0.22;
      this.hitKind = e.target.hp <= 0 ? 'kill' : e.headshot ? 'head' : '';
      if (this.settings.damageNumbers) {
        const el = h('div', { class: 'dmgnum' + (e.headshot ? ' head' : e.armorHit ? ' armor' : '') }, String(Math.round(e.amount)));
        this.els.nums.appendChild(el);
        this.dmgNums.push({ el, pos: e.point.clone(), t: 0, vy: 0.9 + Math.random() * 0.3 });
      }
    }
    if (e.target === p && e.from) {
      const dx = e.from.x - p.body.pos.x;
      const dz = e.from.z - p.body.pos.z;
      this.dmgDirs.push({ yaw: Math.atan2(-dx, -dz), t: 1.2 });
    }
    const m = this.match;
    if (e.target === p && e.attacker && e.attacker !== p && m.buildingEnabled && p.slot !== 6 && (this.tips.built ?? 0) < 3 && m.time - this.lastBuildTip > 40) {
      const mats = p.mats.wood + p.mats.stone + p.mats.metal;
      if (mats >= PIECE_COST.wall) {
        this.lastBuildTip = m.time;
        this.showTip(this.touch ? `${ICON.wall(16)} Under fire? Tap build for a wall` : `Under fire? <span class="kbd">${keyLabel(this.settings.bindings.build)}</span> builds a wall`, 'build', 5);
      }
    }
  }

  private onKill(e: KillEvent) {
    const p = this.match.player;
    const tdm = this.match instanceof TDMMatch;
    const side = (c: { team: number }) => (tdm ? (c.team === p.team ? 'blue' : 'red') : '');
    const kicon = e.headshot ? ICON.head(13) : e.cause === 'zone' ? ICON.storm(13) : e.cause === 'explosion' ? ICON.grenade(13) : ICON.skull(12);
    const row = h(
      'div',
      { class: 'k' + (e.killer === p || e.victim === p ? ' me' : '') },
      e.killer ? h('span', { class: side(e.killer) }, e.killer.name) : null,
      h('span', { class: 'w', html: kicon + `<span>${e.cause === 'zone' ? 'Storm' : e.cause === 'fall' ? 'Fall' : e.weapon}</span>` }),
      h('span', { class: side(e.victim) }, e.victim.name),
    );
    this.els.feed.prepend(row);
    this.feedItems.unshift(row);
    while (this.feedItems.length > 6) this.feedItems.pop()!.remove();
    setTimeout(() => row.remove(), 7000);
    if (e.killer === p && e.victim !== p) {
      const streak = p.streak;
      this.toast(`Eliminated ${e.victim.name}${e.headshot ? ' · Headshot' : ''}${e.distance > 50 ? ` · ${Math.round(e.distance)}m` : ''}`, 'good');
      if (streak >= 3) this.toast(`${streak} elimination streak`, 'warn');
    }
  }

  private showTip(html: string, kind: string, sec: number) {
    const t = this.els.tip;
    t.innerHTML = html;
    t.dataset.kind = kind;
    t.style.display = 'flex';
    this.tipTimer = sec;
  }

  /** the panel shown while the hammer is out: what each piece is for, what it costs, what you have */
  private renderBuildPanel() {
    const pc = this.pc;
    const p = this.match.player;
    const E = this.els;
    const kb = (a: keyof Settings['bindings']) => keyLabel(this.settings.bindings[a]);
    const cost = PIECE_COST[pc.buildPiece];
    const pieces = h('div', { class: 'bp-row' }, ...PIECES.map((pp, i) =>
      h('div', { class: 'bp-piece' + (pc.buildPiece === pp ? ' on' : ''), 'data-act': 'slot' + (i + 1) },
        this.touch ? null : h('span', { class: 'bk' }, kb(('slot' + (i + 1)) as 'slot1')),
        h('span', { class: 'ic', html: (ICON as any)[pp](22) }),
        h('b', null, PIECE_LABEL[pp]),
        h('small', null, PIECE_USE[pp]))));
    const mats = h('div', { class: 'bp-row' }, ...BUILD_MATS.map((k) =>
      h('div', { class: 'bp-mat' + (pc.buildMat === k ? ' on' : '') + (p.mats[k] < cost ? ' low' : ''), 'data-mat': k, title: MATERIALS[k].name },
        matCanvas(k), h('b', null, String(p.mats[k])))),
      h('div', { class: 'bp-cost' }, `${cost} per piece`),
      this.touch ? h('div', { class: 'bp-act', 'data-act': 'rotate', html: ICON.refresh(18) + '<small>Turn</small>' }) : null,
      this.touch ? h('div', { class: 'bp-act', 'data-act': 'build', html: ICON.close(18) + '<small>Exit</small>' }) : null);
    const total = p.mats.wood + p.mats.stone + p.mats.metal;
    const hint = total < PIECE_COST.block
      ? h('div', { class: 'bp-hint warn' }, this.touch ? 'No materials: hit trees and rocks with the pick' : `No materials: hit trees and rocks with the pick (${kb('tool')})`)
      : this.touch ? null : h('div', { class: 'bp-hint' }, `${kb('fire')} place · ${kb('aim')} remove · ${kb('rotate')} turn · ${kb('material')} material · ${kb('build')} exit`);
    clear(E.buildbar);
    E.buildbar.append(pieces, mats);
    if (hint) E.buildbar.appendChild(hint);
  }

  private renderCoach() {
    const c = this.els.coach;
    clear(c);
    c.append(
      h('div', { class: 'h' }, h('span', { html: ICON.wall(18) }), 'Building'),
      h('p', null, 'Walls stop bullets. Ramps get you to high ground.'),
      h('p', null, this.touch ? 'Pick a piece below, aim, then tap fire to place it. Pieces cost materials from trees and rocks.' : `Pick a piece, aim, then click to place it. Pieces cost materials: hit trees and rocks with the pick (${keyLabel(this.settings.bindings.tool)}).`),
      h('button', { class: 'btn primary', onclick: () => this.dismissCoach() }, 'Got it'),
    );
  }

  private dismissCoach() {
    this.tips.build = true;
    saveJSON(TIPS_KEY, this.tips);
    this.els.coach.style.display = 'none';
    this.root.classList.remove('coaching');
  }

  // ===================================================================
  update(dt: number) {
    const m = this.match;
    const p = m.player;
    const pc = this.pc;
    const cam = m.engine.camera;
    const E = this.els;
    const br = m instanceof BRMatch ? m : null;
    const tdm = m instanceof TDMMatch ? m : null;
    const tut = m instanceof TutorialMatch ? m : null;
    const inShip = br ? br.inShip.has(p) : false;

    // fps
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      this.fpsVal = Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
      if (this.settings.showFps) this.set('fps', E.fps, `${this.fpsVal} fps · ${m.engine.frameTimeAvg.toFixed(1)}ms · ${Math.round(m.engine.post.settings.renderScale * 100)}%`);
    }

    const g = p.gun;
    const scopeA = pc.scopeAmount;
    // crosshair
    const showCross = p.alive && !inShip && scopeA < 0.5 && !(g && p.ads > 0.6 && g.def.category !== 'shotgun');
    E.cross.style.display = showCross ? 'block' : 'none';
    if (showCross) {
      const spread = g ? m.spreadDeg(p, g) : 0.6;
      const fovPx = window.innerHeight / (2 * Math.tan((m.engine.camera.fov * Math.PI) / 360));
      const target = Math.tan((spread * Math.PI) / 360) * fovPx + 4;
      this.crossSpread += (target - this.crossSpread) * Math.min(1, dt * 20);
      const s = Math.round(this.crossSpread);
      const kids = E.cross.children as HTMLCollectionOf<HTMLElement>;
      const k = `${s}`;
      if (this.last.cross !== k) {
        this.last.cross = k;
        kids[1].style.left = -(s + 9) + 'px';
        kids[2].style.left = s + 'px';
        kids[3].style.top = -(s + 9) + 'px';
        kids[4].style.top = s + 'px';
      }
      const tool = p.slot > 2;
      for (let i = 1; i < 5; i++) kids[i].style.display = tool ? 'none' : 'block';
    }
    // hitmarker
    this.hitT = Math.max(0, this.hitT - dt);
    E.hit.style.opacity = String(this.hitT > 0 ? Math.min(1, this.hitT / 0.12) : 0);
    E.hit.className = 'hitmark ' + this.hitKind;

    // scope overlay
    E.scope.style.display = scopeA > 0.01 ? 'block' : 'none';
    if (scopeA > 0.01) {
      E.scope.style.opacity = String(scopeA);
      const z = g?.def.scope?.zooms[Math.min(pc.scopeZoom, (g?.def.scope?.zooms.length ?? 1) - 1)] ?? 1;
      this.set('zoom', E.scope.children[2] as HTMLElement, `${z}×`);
    }
    m.engine.post.uniforms.uScope.value = scopeA;

    // vitals
    const vit = E.vitals;
    const fillSegs = (bar: Element, val: number) => {
      const segs = bar.children;
      for (let i = 0; i < 10; i++) {
        const f = clamp((val - i * 10) / 10, 0, 1);
        const b = (segs[i] as HTMLElement).firstChild as HTMLElement;
        const w = Math.round(f * 100) + '%';
        if (b.style.width !== w) b.style.width = w;
      }
    };
    const bars = vit.querySelectorAll('.segbar');
    fillSegs(bars[0], p.armor);
    fillSegs(bars[1], p.hp);
    bars[1].classList.toggle('low', p.hp < 30);
    this.set('vhp', vit.querySelector('[data-k=hp]') as HTMLElement, String(Math.ceil(p.hp)));
    this.set('var', vit.querySelector('[data-k=ar]') as HTMLElement, p.armor > 0 ? String(Math.ceil(p.armor)) : '');

    // slots
    const slotKey = JSON.stringify([p.slot, p.weapons.map((w) => w?.def.id ?? null), p.healSel, p.throwSel, p.heals, p.throws, br ? 1 : 0, tdm ? 1 : 0]);
    if (this.last.slots !== slotKey) {
      this.last.slots = slotKey;
      const S = E.slots;
      clear(S);
      const keyOf = (a: any) => keyLabel(this.settings.bindings[a as keyof Settings['bindings']]);
      for (let i = 0; i < 3; i++) {
        const w = p.weapons[i];
        const el = h('div', { class: 'slot' + (p.slot === i ? ' on' : '') + (w ? ` r-${w.def.tier}` : ''), 'data-act': 'slot' + (i + 1) }, h('span', { class: 'k' }, keyOf('slot' + (i + 1))));
        if (w) el.appendChild(weaponCanvas(w.def.id, 156, 60));
        S.appendChild(el);
      }
      if (!tdm) {
        const healCount = p.heals[p.healSel];
        const hs = h('div', { class: 'slot small' + (p.slot === 3 ? ' on' : '') + (healCount ? '' : ' empty'), 'data-act': 'slot4' }, h('span', { class: 'k' }, keyOf('slot4')), itemCanvas(p.healSel), h('span', { class: 'n' }, String(healCount)));
        S.appendChild(hs);
      }
      const ts = h('div', { class: 'slot small' + (p.slot === 4 ? ' on' : '') + (p.throws[p.throwSel] ? '' : ' empty'), 'data-act': 'slot5' }, h('span', { class: 'k' }, keyOf('slot5')), itemCanvas(p.throwSel), h('span', { class: 'n' }, String(p.throws[p.throwSel])));
      S.appendChild(ts);
      if (m.harvestEnabled) S.appendChild(h('div', { class: 'slot small tool' + (p.slot === 5 ? ' on' : ''), 'data-act': 'tool' }, h('span', { class: 'k' }, keyOf('tool')), itemCanvas('pickaxe')));
      if (m.buildingEnabled) S.appendChild(h('div', { class: 'slot small ham' + (p.slot === 6 ? ' on' : ''), 'data-act': 'build' }, h('span', { class: 'k' }, keyOf('build')), itemCanvas('hammer')));
    }
    // ammo
    const A = E.ammo;
    let wn = '';
    let mag = '';
    let extra = '';
    let low = false;
    if (p.slot <= 2 && g) {
      wn = g.def.name;
      const reloading = g.reloading > 0;
      mag = `${g.mag}<small>/ ${p.ammo[g.def.ammo]}</small>`;
      low = g.mag <= Math.ceil(g.def.mag * 0.25);
      extra = reloading ? '<span style="color:#ffcf7a">RELOADING</span>' : '';
    } else if (p.slot === 3) {
      wn = HEALS[p.healSel].name;
      mag = `${p.heals[p.healSel]}`;
    } else if (p.slot === 4) {
      wn = THROWABLES[p.throwSel].name;
      mag = `${p.throws[p.throwSel]}`;
    } else if (p.slot === 5) {
      wn = 'Forge Pick';
      extra = '<span>Hit trees and rocks for materials</span>';
    }
    this.set('wn', A.children[0] as HTMLElement, wn);
    this.setHTML('mag', A.children[1] as HTMLElement, mag);
    (A.children[1] as HTMLElement).classList.toggle('low', low);
    this.setHTML('extra', A.children[2] as HTMLElement, extra);
    A.style.display = p.alive && !inShip && p.slot !== 6 ? 'block' : 'none';
    E.slots.style.display = p.alive && !inShip ? 'flex' : 'none';
    vit.style.display = !inShip ? 'block' : 'none';

    // materials (BR / tutorial)
    if (m.buildingEnabled || m.craftingEnabled) {
      const mk = JSON.stringify([p.mats, pc.buildMat, p.slot]);
      if (this.last.mats !== mk) {
        this.last.mats = mk;
        clear(E.mats);
        for (const k of BUILD_MATS) E.mats.appendChild(h('div', { class: 'm' }, matCanvas(k), h('span', null, String(p.mats[k]))));
      }
      E.mats.style.display = p.alive && !inShip && p.slot !== 6 && m.buildingEnabled ? 'flex' : 'none';
    } else E.mats.style.display = 'none';

    // build panel (on touch screens it takes the hotbar's place) and the first-time coach card
    const building = p.slot === 6 && p.alive;
    this.root.classList.toggle('building', building);
    if (building) {
      E.buildbar.style.display = 'flex';
      const bk = [pc.buildPiece, pc.buildMat, p.mats.wood, p.mats.stone, p.mats.metal].join('|');
      if (this.last.bb !== bk) {
        this.last.bb = bk;
        this.renderBuildPanel();
      }
      this.buildTime += dt;
      if (!this.tips.build) {
        if (E.coach.style.display === 'none') {
          this.renderCoach();
          E.coach.style.display = 'block';
          this.root.classList.add('coaching');
        }
        // reading it once is enough
        if (this.buildTime > 15) this.dismissCoach();
      }
    } else {
      E.buildbar.style.display = 'none';
      E.coach.style.display = 'none';
      this.root.classList.remove('coaching');
    }

    // one short pointer to building and harvesting right after landing, until the player builds
    const airborne = inShip || p.dropping || p.gliding;
    if (this.wasAirborne && !airborne && p.alive && m.buildingEnabled && br && (this.tips.built ?? 0) < 3) {
      const b = this.settings.bindings;
      this.showTip(this.touch ? `${ICON.wall(16)} Build cover with the build button · harvest with the pick` : `<span class="kbd">${keyLabel(b.build)}</span> build cover <span class="sep"></span> <span class="kbd">${keyLabel(b.tool)}</span> harvest materials`, 'land', 7);
    }
    this.wasAirborne = airborne;
    if (this.tipTimer > 0) {
      this.tipTimer -= dt;
      if (this.tipTimer <= 0 || building) {
        this.tipTimer = 0;
        E.tip.style.display = 'none';
      }
    }

    // prompt
    let prompt = '';
    let warn = false;
    if (p.alive && !inShip) {
      if (p.slot === 6 && pc.buildReason) {
        prompt = pc.buildReason;
        warn = true;
      } else if (pc.interactPrompt) prompt = this.touch ? '' : `<span class="kbd">${keyLabel(this.settings.bindings.interact)}</span> ${pc.interactPrompt}`;
      else if (g && g.mag === 0 && p.ammo[g.def.ammo] === 0 && p.slot <= 2) {
        prompt = 'Out of ammo';
        warn = true;
      } else if (g && g.mag === 0 && p.slot <= 2 && g.reloading <= 0) prompt = this.touch ? 'Tap reload' : `<span class="kbd">${keyLabel(this.settings.bindings.reload)}</span> Reload`;
    }
    E.prompt.style.display = prompt ? 'flex' : 'none';
    E.prompt.classList.toggle('warn', warn);
    this.setHTML('prompt', E.prompt, prompt);

    // progress ring (heal / reload)
    const rc = this.ringCtx;
    rc.clearRect(0, 0, 128, 128);
    let prog = -1;
    let col = '#f2a93b';
    if (p.useTimer >= 0 && p.useDur > 0) {
      prog = p.useTimer / p.useDur;
      col = '#5be37d';
    } else if (g && g.reloading > 0 && p.slot <= 2) {
      prog = 1 - g.reloading / g.reloadTotal;
    }
    if (prog >= 0) {
      rc.lineWidth = 6;
      rc.strokeStyle = 'rgba(0,0,0,0.4)';
      rc.beginPath();
      rc.arc(64, 64, 50, 0, Math.PI * 2);
      rc.stroke();
      rc.strokeStyle = col;
      rc.beginPath();
      rc.arc(64, 64, 50, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      rc.stroke();
    }

    // damage indicators
    const dc = this.dmgCtx;
    dc.clearRect(0, 0, 440, 440);
    this.dmgDirs = this.dmgDirs.filter((d) => (d.t -= dt) > 0);
    for (const d of this.dmgDirs) {
      const rel = d.yaw - p.yaw;
      const a = -rel - Math.PI / 2;
      dc.strokeStyle = `rgba(255,60,40,${Math.min(1, d.t)})`;
      dc.lineWidth = 10;
      dc.beginPath();
      dc.arc(220, 220, 180, a - 0.28, a + 0.28);
      dc.stroke();
    }

    // damage numbers
    const tmp = new THREE.Vector3();
    this.dmgNums = this.dmgNums.filter((n) => {
      n.t += dt;
      n.pos.y += n.vy * dt;
      if (n.t > 0.9) {
        n.el.remove();
        return false;
      }
      tmp.copy(n.pos).project(cam);
      if (tmp.z > 1) {
        n.el.style.display = 'none';
        return true;
      }
      n.el.style.display = 'block';
      n.el.style.left = ((tmp.x + 1) / 2) * window.innerWidth + 'px';
      n.el.style.top = ((1 - tmp.y) / 2) * window.innerHeight + 'px';
      n.el.style.opacity = String(1 - n.t / 0.9);
      return true;
    });

    // name tags
    this.updateTags(tdm !== null);

    // compass
    const deg = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
    E.strip.style.left = `${260 - (deg + 180) * 4}px`;
    if (br) {
      const zc = br.zone;
      const dx = zc.to.x - p.body.pos.x;
      const dz = zc.to.y - p.body.pos.z;
      const zdeg = ((((Math.atan2(dx, -dz) * 180) / Math.PI) % 360) + 360) % 360;
      let rel = zdeg - deg;
      if (rel > 180) rel -= 360;
      if (rel < -180) rel += 360;
      const outside = br.zone.distToNext(p.body.pos.x, p.body.pos.z) > 0;
      this.setHTML('mk', E.markers, outside && Math.abs(rel) < 70 ? `<div class="mk" style="left:${260 + rel * 4}px;background:#c99bff;clip-path:polygon(50% 0,100% 100%,0 100%)"></div>` : '');
    }

    // minimap
    const now = m.time;
    this.pings = this.pings.filter((q) => now - q.t < 4 && Math.hypot(q.x - p.body.pos.x, q.z - p.body.pos.z) < 70);
    const zone = br ? { cx: br.zone.center.x, cz: br.zone.center.y, r: br.zone.radius, nx: br.zone.to.x, nz: br.zone.to.y, nr: br.zone.toR } : null;
    const friends = tdm ? m.combatants.filter((c) => c !== p && c.alive && c.team === p.team).map((c) => ({ x: c.body.pos.x, z: c.body.pos.z, yaw: c.yaw })) : [];
    const camYaw = p.alive ? p.yaw : Math.atan2(-(cam.getWorldDirection(tmp).x), -tmp.z);
    const center = inShip || !p.alive ? cam.position : p.body.pos;
    drawMap(this.miniCtx, m.world, m.map, {
      px: center.x, pz: center.z, yaw: camYaw, zone, friends,
      pings: this.pings.map((q) => ({ x: q.x, z: q.z, age: now - q.t })),
      path: br && br.ship.t < 1 ? { x0: br.ship.from.x, z0: br.ship.from.z, x1: br.ship.to.x, z1: br.ship.to.z, t: br.ship.t } : null,
    }, 392, br ? (inShip ? 170 : 70) : tdm ? 60 : 45, br ? inShip : false);

    // status rows
    const st: string[] = [];
    // one compact row of numbers; words only when something is wrong
    if (br) {
      const outside = br.zone.outside(p.body.pos.x, p.body.pos.z);
      st.push(`<div class="r"><span title="Players left">${ICON.people(13)}<b>${br.aliveCount}</b></span><span title="Eliminations">${ICON.skull(12)}<b>${p.stats.kills}</b></span><span class="storm${br.zone.shrinking ? ' closing' : ''}" title="Storm">${ICON.storm(13)}<b>${fmtTime(br.zone.countdown)}</b></span></div>`);
      if (outside && p.alive) st.push(`<div class="r warn">IN STORM <b>-${br.zone.dps}/s</b></div>`);
    } else if (tdm) {
      st.push(`<div class="r"><span title="Eliminations / deaths">${ICON.skull(12)}<b>${p.stats.kills}/${p.stats.deaths}</b></span></div>`);
    }
    this.setHTML('status', E.status, st.join(''));
    // TDM scorebar
    if (tdm) {
      E.score.style.display = 'flex';
      const ot = 1 - p.team;
      this.setHTML('score', E.score, `<div class="s a">${tdm.scores[p.team]}</div><div class="tm">${tdm.statusText}</div><div class="s b">${tdm.scores[ot]}</div><div class="lim">FIRST TO ${tdm.scoreLimit}</div>`);
      E.compass.style.top = '64px';
    }

    // announcements
    if (this.announceTimer > 0) {
      this.announceTimer -= dt;
      if (this.announceTimer <= 0) E.announce.style.display = 'none';
    }

    // drop phase
    if (br) {
      let dt2 = '';
      if (inShip) {
        const over = br.ship.t > 0.1;
        dt2 = over ? `<div class="big">${this.touch ? 'Tap jump to drop' : `<span class="kbd" style="font-size:20px;height:30px">${keyLabel(this.settings.bindings.jump)}</span> to drop`}</div>` : '';
      } else if (p.dropping) dt2 = `<div class="dim">${this.touch ? 'Tap jump' : keyLabel(this.settings.bindings.jump)} to open the glider</div>`;
      E.drop.style.display = dt2 ? 'block' : 'none';
      this.setHTML('drop', E.drop, dt2);
    }
    // spawn shield
    E.shield.style.display = p.alive && p.spawnShield > 0 ? 'block' : 'none';

    // tutorial panel
    if (tut) {
      E.tut.style.display = 'block';
      const s = tut.step;
      const key = `${tut.index}|${tut.doneCount}|${s.progress?.() ?? ''}`;
      if (this.last.tut !== key) {
        this.last.tut = key;
        clear(E.tut);
        const total = tut.done.length;
        E.tut.appendChild(h('div', { class: 'step' }, s.id === 'done' ? 'Complete' : `${tut.doneCount}/${total} · any order`));
        E.tut.appendChild(h('div', { class: 'tt' }, s.title));
        E.tut.appendChild(h('div', { class: 'hint' }, s.hint));
        if (s.progress) E.tut.appendChild(h('div', { class: 'prog' }, s.progress()));
        E.tut.appendChild(h('div', { class: 'dots' }, ...tut.done.map((d, i) => h('i', { class: d ? 'd' : i === tut.index ? 'c' : '' }))));
        if (s.id !== 'done')
          E.tut.appendChild(
            h('button', { class: 'skip clickable', onclick: (e: Event) => { e.stopPropagation(); tut.skipStep(); } },
              this.touch ? 'Skip step' : h('span', null, h('span', { class: 'kbd' }, 'N'), ' Skip step')),
          );
      }
    }

    // post fx for damage/zone
    const pu = m.engine.post.uniforms;
    const since = m.time - p.lastHurt;
    pu.uDamage.value = p.alive ? Math.max(0, 1 - since / 0.6) * 0.8 : 0;
    pu.uLowHealth.value = p.alive && p.hp < 30 ? 1 - p.hp / 30 : 0;
    pu.uZone.value = br && p.alive && !inShip && br.zone.outside(p.body.pos.x, p.body.pos.z) ? 1 : 0;
    pu.uFlash.value = m.playerFlash;
    pu.uSpawnShield.value = p.spawnShield > 0 ? 0.6 : 0;

    // death / respawn overlays
    if (!p.alive && !this.deathShown && !m.ended) {
      this.deathShown = true;
      setTimeout(() => this.showDeath(), br ? 1400 : 600);
    }
    if (p.alive && this.deathShown) {
      this.deathShown = false;
      if (this.overlay === 'death') this.closeOverlay();
    }
    if (this.respawnEl && tdm) {
      const left = Math.max(0, p.respawnAt - m.time);
      this.set('resp', this.respawnEl, left > 0 ? `Respawning in ${left.toFixed(1)}s` : 'Respawning…');
    }
    if (this.overlay === 'inventory') this.refreshRecipes();
  }

  private updateTags(tdm: boolean) {
    const m = this.match;
    const p = m.player;
    const cam = m.engine.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const seen = new Set<number>();
    const eye = cam.position;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    for (const c of m.combatants) {
      if (c === p || !c.alive || (c.dropping && !c.gliding)) continue;
      const friend = tdm && c.team === p.team;
      const head = c.body.pos.clone().add(new THREE.Vector3(0, 2.15, 0));
      const d = head.distanceTo(eye);
      let show = false;
      if (friend) show = d < 120;
      else {
        // enemies: only when looked at and visible
        const to = head.clone().sub(eye).normalize();
        const ang = Math.acos(clamp(to.dot(fwd), -1, 1));
        show = d < 90 && ang < Math.max(0.03, 0.6 / d) + 0.02 && m.canSee(eye, head.clone().add(new THREE.Vector3(0, -0.7, 0)));
      }
      if (!show) continue;
      const pr = head.clone().project(cam);
      if (pr.z > 1) continue;
      seen.add(c.id);
      let el = this.tags.get(c.id);
      if (!el) {
        el = h('div', { class: 'tag ' + (friend ? 'friend' : 'enemy') }, h('span'), h('div', { class: 'hpb' }, h('i')));
        this.els.tags.appendChild(el);
        this.tags.set(c.id, el);
      }
      (el.firstChild as HTMLElement).textContent = c.name;
      ((el.lastChild as HTMLElement).firstChild as HTMLElement).style.width = `${c.hp}%`;
      el.style.left = ((pr.x + 1) / 2) * W + 'px';
      el.style.top = ((1 - pr.y) / 2) * H + 'px';
      el.style.opacity = String(clamp(1.4 - d / 100, 0.35, 1));
    }
    for (const [id, el] of this.tags) {
      if (!seen.has(id)) {
        el.remove();
        this.tags.delete(id);
      }
    }
  }

  // ------------------------------------------------------------ overlays
  closeOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    this.overlayEl = null;
    const was = this.overlay;
    this.overlay = 'none';
    this.respawnEl = null;
    this.pc.uiBlocked = false;
    if (was !== 'none' && was !== 'scoreboard' && was !== 'death') this.hooks.lockPointer();
  }

  private openOverlay(kind: HUD['overlay'], el: HTMLElement, blocks = true) {
    if (this.overlayEl) this.overlayEl.remove();
    this.overlay = kind;
    this.overlayEl = el;
    this.root.appendChild(el);
    el.classList.add('clickable');
    // touch screens have no Tab / M / Esc: give panels a close button and close on a tap outside
    if (this.touch && (kind === 'inventory' || kind === 'map' || kind === 'scoreboard')) {
      el.appendChild(h('button', { class: 'ovclose', 'aria-label': 'Close', html: ICON.close(18), onclick: () => this.closeOverlay() }));
      // the tap that opened the panel is followed by a click on it: ignore that one
      const opened = performance.now();
      el.addEventListener('click', (e) => {
        if (e.target === el && performance.now() - opened > 400) this.closeOverlay();
      });
    }
    this.pc.uiBlocked = blocks;
    if (blocks) this.hooks.unlockPointer();
  }

  openPause() {
    const el = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'pause panel' },
        h('div', { class: 'h2' }, 'Paused'),
        h('button', { class: 'btn primary', onclick: () => this.hooks.resume() }, ICON.play(14) && h('span', { html: ICON.play(14) }), 'Resume'),
        h('button', { class: 'btn', onclick: () => this.hooks.settings() }, h('span', { html: ICON.gear(14) }), 'Settings'),
        h('button', { class: 'btn danger', onclick: () => this.hooks.leave() }, h('span', { html: ICON.close(14) }), this.match.cfg.mode === 'tutorial' ? 'Exit training' : this.match.cfg.ranked ? 'Leave (counts as a loss)' : 'Leave match'),
      ),
    );
    this.openOverlay('pause', el);
  }

  toggleInventory() {
    if (this.overlay === 'inventory') {
      this.closeOverlay();
      return;
    }
    if (!this.match.player.alive) return;
    this.openInventory();
  }

  private recipeEls: { el: HTMLElement; id: string }[] = [];
  openInventory() {
    const m = this.match;
    const p = m.player;
    const left = h('div', { class: 'col' });
    left.appendChild(h('h3', null, 'Weapons'));
    const wg = h('div', { class: 'col', style: { gap: '6px' } });
    p.weapons.forEach((w, i) => {
      wg.appendChild(h('div', { class: 'invcell' }, h('span', { class: 'kbd' }, String(i + 1)), w ? weaponCanvas(w.def.id, 110, 40) : h('span', { class: 'faint' }, 'Empty'), w ? h('span', null, w.def.name) : null, w ? h('b', null, `${w.mag}/${p.ammo[w.def.ammo]}`) : null));
    });
    left.appendChild(wg);
    left.appendChild(h('h3', { style: { marginTop: '10px' } }, 'Supplies'));
    const sg = h('div', { class: 'invgrid' });
    for (const [k, v] of Object.entries(p.ammo)) sg.appendChild(h('div', { class: 'invcell' }, AMMO_NAMES[k as keyof typeof AMMO_NAMES].split(' ')[0], h('b', null, String(v))));
    for (const k of ['bandage', 'medkit', 'plate'] as const) sg.appendChild(h('div', { class: 'invcell' }, itemCanvas(k), HEALS[k].name, h('b', null, String(p.heals[k]))));
    for (const k of ['frag', 'smoke'] as const) sg.appendChild(h('div', { class: 'invcell' }, itemCanvas(k), THROWABLES[k].name, h('b', null, String(p.throws[k]))));
    left.appendChild(sg);
    left.appendChild(h('h3', { style: { marginTop: '10px' } }, 'Materials'));
    const mg = h('div', { class: 'invgrid' });
    for (const k of ['wood', 'stone', 'metal', 'cloth', 'powder'] as MaterialKind[]) mg.appendChild(h('div', { class: 'invcell' }, matCanvas(k), MATERIALS[k].name, h('b', null, String(p.mats[k]))));
    left.appendChild(mg);
    const right = h('div', { class: 'col' });
    right.appendChild(h('h3', null, 'Crafting'));
    right.appendChild(h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '-6px', marginBottom: '6px' } }, this.touch ? 'Tap a recipe to craft it.' : 'Click a recipe or press its number to craft it.'));
    const rg = h('div', { class: 'recipes' });
    this.recipeEls = [];
    RECIPES.forEach((r, i) => {
      const cost = h('div', { class: 'cost' });
      const el = h(
        'div',
        { class: 'recipe', onclick: () => m.craft(p, r.id) },
        h('div', { class: 'rn' }, h('span', null, r.name), h('span', { class: 'kbd' }, i < 9 ? String(i + 1) : '')),
        cost,
        h('div', { class: 'hint' }, r.hint),
      );
      this.recipeEls.push({ el, id: r.id });
      rg.appendChild(el);
    });
    right.appendChild(rg);
    const el = h('div', { class: 'overlay', style: { background: 'rgba(6,8,11,0.5)' } }, h('div', { class: 'inv panel' }, left, right));
    this.openOverlay('inventory', el);
    this.last.recipes = '';
    this.refreshRecipes();
  }

  private refreshRecipes() {
    const p = this.match.player;
    const key = JSON.stringify(p.mats);
    if (this.last.recipes === key) return;
    this.last.recipes = key;
    for (const { el, id } of this.recipeEls) {
      const r = RECIPES.find((x) => x.id === id)!;
      const ok = canAfford(p.mats, r);
      el.classList.toggle('no', !ok);
      const cost = el.querySelector('.cost')!;
      cost.innerHTML = Object.entries(r.cost)
        .map(([k, v]) => `<span class="${(p.mats[k as MaterialKind] ?? 0) < (v ?? 0) ? 'short' : ''}">${MATERIALS[k as MaterialKind].name} ${p.mats[k as MaterialKind]}/${v}</span>`)
        .join('');
    }
  }

  /** number keys while the inventory is open craft recipes */
  handleInventoryKey(code: string) {
    if (this.overlay !== 'inventory') return false;
    const m = /^Digit(\d)$/.exec(code);
    if (!m) return false;
    const i = parseInt(m[1], 10) - 1;
    const r = RECIPES[i];
    if (r) this.match.craft(this.match.player, r.id);
    return true;
  }

  toggleMap() {
    if (this.overlay === 'map') {
      this.closeOverlay();
      return;
    }
    const m = this.match;
    const cv = h('canvas', { width: 900, height: 900 });
    const el = h('div', { class: 'overlay', style: { background: 'rgba(6,8,11,0.55)' } }, h('div', { class: 'bigmap panel' }, cv));
    this.openOverlay('map', el, false);
    const draw = () => {
      if (this.overlay !== 'map') return;
      const br = m instanceof BRMatch ? m : null;
      const p = m.player;
      drawMap(cv.getContext('2d')!, m.world, m.map, {
        px: p.body.pos.x, pz: p.body.pos.z, yaw: p.yaw,
        zone: br ? { cx: br.zone.center.x, cz: br.zone.center.y, r: br.zone.radius, nx: br.zone.to.x, nz: br.zone.to.y, nr: br.zone.toR } : null,
        friends: m instanceof TDMMatch ? m.combatants.filter((c) => c !== p && c.alive && c.team === p.team).map((c) => ({ x: c.body.pos.x, z: c.body.pos.z, yaw: c.yaw })) : [],
        pings: [],
        path: br && br.ship.t < 1 ? { x0: br.ship.from.x, z0: br.ship.from.z, x1: br.ship.to.x, z1: br.ship.to.z, t: br.ship.t } : null,
      }, 900, null, true);
      requestAnimationFrame(draw);
    };
    draw();
  }

  showScoreboard(on: boolean) {
    if (on && this.overlay === 'none') {
      this.openOverlay('scoreboard', this.scoreboardEl(), false);
    } else if (!on && this.overlay === 'scoreboard') this.closeOverlay();
  }

  scoreboardEl(): HTMLElement {
    const m = this.match;
    const p = m.player;
    const tdm = m instanceof TDMMatch ? m : null;
    const table = (list: typeof m.combatants) =>
      h(
        'table',
        { class: 'sbt' },
        h('tr', null, h('th', null, 'Player'), h('th', { class: 'n' }, 'K'), h('th', { class: 'n' }, 'D'), h('th', { class: 'n' }, 'A'), h('th', { class: 'n' }, 'DMG'), h('th', { class: 'n' }, 'Score')),
        ...list
          .sort((a, b) => b.stats.score + b.stats.kills * 100 - (a.stats.score + a.stats.kills * 100))
          .map((c) =>
            h(
              'tr',
              { class: (c === p ? 'me ' : '') + (!c.alive ? 'dead' : '') },
              h('td', null, h('span', { class: 'row', style: { gap: '8px' } }, avatarCanvas(c.ident.look, 20), c.name)),
              h('td', { class: 'n' }, String(c.stats.kills)),
              h('td', { class: 'n' }, String(c.stats.deaths)),
              h('td', { class: 'n' }, String(c.stats.assists)),
              h('td', { class: 'n' }, String(Math.round(c.stats.damage))),
              h('td', { class: 'n' }, String(c.stats.score || c.stats.kills * 100 + c.stats.assists * 50)),
            ),
          ),
      );
    if (tdm) {
      const mine = m.combatants.filter((c) => c.team === p.team);
      const other = m.combatants.filter((c) => c.team !== p.team);
      return h(
        'div',
        { class: 'overlay', style: { background: 'rgba(6,8,11,0.45)' } },
        h('div', { class: 'scoreboard panel' },
          h('div', { class: 'teamhead a' }, h('span', null, 'Your team'), h('span', null, String(tdm.scores[p.team]))), table(mine),
          h('div', { class: 'teamhead b', style: { marginTop: '14px' } }, h('span', null, 'Enemy team'), h('span', null, String(tdm.scores[1 - p.team]))), table(other)),
      );
    }
    return h('div', { class: 'overlay', style: { background: 'rgba(6,8,11,0.45)' } }, h('div', { class: 'scoreboard panel' }, h('div', { class: 'teamhead' }, 'Players'), table(m.combatants.filter((c) => c.alive || c.stats.kills > 0).slice(0, 14))));
  }

  /** re-render the TDM respawn loadout picker (after a hotkey choice) */
  refreshLoadouts: (() => void) | null = null;

  showDeath() {
    const m = this.match;
    const p = m.player;
    if (p.alive || m.ended) return;
    const br = m instanceof BRMatch ? m : null;
    const tdm = m instanceof TDMMatch ? m : null;
    const by = p.killedBy;
    if (br) {
      const el = h(
        'div',
        { class: 'death' },
        h('div', { class: 'place' }, `#${br.playerPlacement}`),
        h('div', { class: 'by' }, by ? `Eliminated by ${by.name} · ${by.weapon}` : 'Eliminated'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => this.hooks.continueAfterDeath() }, 'Continue'),
          by ? h('button', { class: 'btn', onclick: () => { this.pc.spectate = by.id; this.closeOverlay(); this.toast(`Spectating ${by.name}`, 'info'); } }, 'Spectate') : null),
      );
      this.openOverlay('death', el);
    } else if (tdm) {
      this.respawnEl = h('div', { class: 'respawn' });
      const lo = h('div', { class: 'loadouts' });
      const renderLo = () => {
        clear(lo);
        for (const l of LOADOUTS) {
          lo.appendChild(
            h('div', { class: 'loadout' + (tdm.playerLoadout === l.id ? ' on' : ''), onclick: () => { tdm.playerLoadout = l.id; audio.ui('click', 0.5); renderLo(); } },
              h('div', { class: 'ln' }, l.name), weaponCanvas(l.primary, 130, 40), h('div', { class: 'lw' }, `${WEAPONS[l.primary].name} · ${WEAPONS[l.secondary].name}`)),
          );
        }
      };
      renderLo();
      this.refreshLoadouts = renderLo;
      const el = h('div', { class: 'death', style: { background: 'linear-gradient(180deg, transparent 30%, rgba(10,14,24,0.7))' } },
        this.respawnEl,
        h('div', { class: 'by' }, by ? `Eliminated by ${by.name} · ${by.weapon}` : 'Eliminated'),
        h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Loadout for next spawn'),
        this.touch ? null : h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '8px' } }, 'Press 1–6 to pick'),
        lo);
      // keep the pointer locked so the player is ready the moment they respawn
      this.openOverlay('death', el, false);
    }
  }

  dispose() {
    this.root.remove();
  }
}
