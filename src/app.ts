// Application shell: boot, menu world, matchmaking, match lifecycle, results.

import * as THREE from 'three';
import { Engine } from './render/engine';
import { ChunkRenderer } from './render/chunkRenderer';
import { Weather } from './render/weather';
import { CharacterModel } from './render/characters';
import { CAMOS } from './render/camos';
import { Input } from './core/input';
import { loadSettings, saveSettings, type Settings } from './core/settings';
import { audio } from './audio/audio';
import { buildBRMap } from './world/maps/brMap';
import { TDM_MAPS } from './world/maps/tdmMaps';
import { buildTraining } from './world/maps/tutorialMap';
import { computeAllLight } from './world/lighting';
import type { MapData } from './world/maps/builder';
import { CHUNK } from './world/world';
import { Meta } from './meta/meta';
import { playerIdentity } from './meta/profile';
import { composeLook } from './meta/cosmetics';
import { getPool, pickBots, effectiveSkill } from './meta/botPool';
import { Match, type MatchConfig, type MatchResult } from './game/match';
import { BRMatch } from './game/brMatch';
import { TDMMatch } from './game/tdmMatch';
import { TutorialMatch } from './game/tutorial';
import { PlayerController } from './game/player';
import { HUD } from './ui/hud';
import { Menu, type PlaySelection } from './ui/menu';
import { runLobby } from './ui/lobby';
import { showResults } from './ui/results';
import { openSettings } from './ui/settings';
import { h } from './ui/dom';
import { logoMark } from './ui/icons';
import { invalidateTerrainImage } from './ui/minimap';
import { RNG } from './core/rng';
import { B } from './world/blocks';

const TIPS = [
  'Hold right mouse to aim down sights — rifles become laser-accurate.',
  'Scroll while scoped with the Longshot to switch between 4× and 8×.',
  'Wooden walls are cheap but fragile. Metal shrugs off rifle fire.',
  'Crouching tightens your spread. Sprinting widens it.',
  'Supply chests glow gold. Open them with E for better loot.',
  'The storm erodes structures outside the circle. Keep moving.',
  'Grenades bounce. Hold G to see the arc, release to throw.',
  'Harvest trees, boulders and ore with the Forge Pick (F).',
  'Every competitor is an AI player with their own style — learn their habits.',
  'Craft ammo, bandages and grenades instantly from the inventory (Tab).',
];

type State = 'boot' | 'menu' | 'lobby' | 'match' | 'results';

export class App {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  settings: Settings;
  input: Input;
  engine!: Engine;
  meta!: Meta;
  state: State = 'boot';
  brMap!: MapData;
  brRenderer!: ChunkRenderer;
  private brSnap!: { blocks: Uint8Array; light: Uint8Array };
  weather = new Weather();
  menu: Menu | null = null;
  match: Match | null = null;
  pc: PlayerController | null = null;
  hud: HUD | null = null;
  private tmpRenderer: ChunkRenderer | null = null;
  private showcase: CharacterModel | null = null;
  private menuView: 'orbit' | 'showcase' = 'orbit';
  private orbitT = Math.random() * Math.PI * 2;
  private last = performance.now();
  private lastSel: PlaySelection | null = null;
  private lockPrompt: HTMLElement;
  private ambT = 0;
  private dyn = { slow: 0, fast: 0, cooldown: 0, avg: 16 };
  private resultsEl: HTMLElement | null = null;
  private settingsOpen = false;
  private ending = false;
  time = 0;

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ui = document.getElementById('ui')!;
    this.settings = loadSettings();
    this.input = new Input(this.canvas, this.settings);
    this.lockPrompt = h('div', { class: 'overlay', style: { display: 'none', background: 'rgba(6,8,11,0.35)', zIndex: '5', cursor: 'pointer' } },
      h('div', { class: 'panel', style: { padding: '18px 28px', textAlign: 'center' } }, h('div', { class: 'h2' }, 'Click to play'), h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'Mouse is captured for aiming · Esc to pause')));
    this.lockPrompt.addEventListener('click', () => this.lockPointer());
  }

  // ===================================================================== boot
  async boot() {
    const bar = h('i', { style: { width: '0%' } });
    const label = h('div', { class: 'label', style: { marginTop: '10px', textAlign: 'center' } }, 'Starting');
    const tip = h('div', { class: 'tip' }, TIPS[Math.floor(Math.random() * TIPS.length)]);
    const boot = h('div', { class: 'screen boot' },
      h('div', { class: 'logo' }, h('span', { html: logoMark(72) }), h('span', null, 'BLOCK', h('span', { class: 'forge' }, 'FORGE'))),
      h('div', { class: 'tag' }, 'Voxel combat · Battle Royale · Team Deathmatch'),
      h('div', { class: 'progress' }, h('div', { class: 'bar', style: { height: '6px' } }, bar)),
      label, tip);
    this.ui.appendChild(boot);
    const tipTimer = setInterval(() => (tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]), 3500);
    const step = async (f: number, t: string) => {
      bar.style.width = `${Math.round(f * 100)}%`;
      label.textContent = t;
      await new Promise((r) => setTimeout(r, 16));
    };
    await step(0.02, 'Preparing renderer');
    this.engine = new Engine(this.canvas, { ...this.settings });
    this.engine.scene.add(this.weather.points);
    this.engine.atmosphere.onThunder = (delay, k) => setTimeout(() => audio.play('thunder', { vol: 0.5 + k * 0.5, bus: 'ambient' }), delay * 1000);
    await step(0.06, 'Synthesising audio');
    await audio.init(this.settings);
    await step(0.2, 'Raising Ashcrown Isle');
    this.brMap = buildBRMap((f, t) => {
      bar.style.width = `${Math.round((0.2 + f * 0.35) * 100)}%`;
      label.textContent = t;
    });
    await step(0.56, 'Lighting the world');
    computeAllLight(this.brMap.world);
    this.brSnap = { blocks: this.brMap.world.blocks.slice(), light: this.brMap.world.light.slice() };
    await step(0.62, 'Meshing terrain');
    this.brRenderer = new ChunkRenderer(this.brMap.world);
    await this.brRenderer.buildAll((f) => {
      bar.style.width = `${Math.round((0.62 + f * 0.33) * 100)}%`;
    });
    this.brRenderer.addOcean(this.brMap.seaLevel);
    await step(0.96, 'Loading profiles');
    getPool();
    this.meta = new Meta();
    await step(1, 'Ready');
    clearInterval(tipTimer);
    boot.remove();
    this.ui.appendChild(this.lockPrompt);
    this.installHandlers();
    this.showMenu();
    requestAnimationFrame((t) => this.loop(t));
    (window as any).__bf = this;
  }

  private installHandlers() {
    const firstGesture = () => {
      audio.resume();
      if (this.state === 'menu') audio.startMenuMusic();
    };
    window.addEventListener('pointerdown', firstGesture);
    window.addEventListener('keydown', firstGesture);
    this.input.onLockChange = (locked) => {
      if (this.state !== 'match' || !this.hud || !this.match) return;
      if (!locked && this.hud.overlay === 'none' && !this.match.ended && !this.ending) this.hud.openPause();
    };
    this.input.onEscape = () => {
      if (this.settingsOpen) return;
      if (this.state !== 'match' || !this.hud) return;
      const o = this.hud.overlay;
      if (o === 'pause') this.resume();
      else if (o === 'inventory' || o === 'map' || o === 'scoreboard') this.hud.closeOverlay();
      else if (o === 'none' && !this.input.locked) this.hud.openPause();
    };
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'match' || !this.hud || !this.match || this.settingsOpen) return;
      const b = this.settings.bindings;
      if (this.hud.handleInventoryKey(e.code)) return;
      if (this.hud.overlay === 'death' && this.match instanceof TDMMatch) {
        const m = /^Digit([1-6])$/.exec(e.code);
        if (m) {
          const lo = ['assault', 'cqb', 'marksman', 'heavy', 'recon', 'demo'][parseInt(m[1], 10) - 1];
          this.match.playerLoadout = lo;
          this.meta.p.lastLoadout = lo;
          this.hud.refreshLoadouts?.();
          audio.ui('click', 0.5);
        }
      }
      if (e.repeat) return;
      if (e.code === b.inventory) {
        e.preventDefault();
        if (this.match instanceof TDMMatch) this.hud.showScoreboard(true);
        else if (this.match.craftingEnabled) this.hud.toggleInventory();
      } else if (e.code === b.map && !(this.match instanceof TDMMatch)) this.hud.toggleMap();
    });
    window.addEventListener('keyup', (e) => {
      if (this.state !== 'match' || !this.hud) return;
      if (e.code === this.settings.bindings.inventory && this.match instanceof TDMMatch) this.hud.showScoreboard(false);
    });
    this.canvas.addEventListener('click', () => {
      if (this.state === 'match' && this.hud && this.hud.overlay === 'none' && !this.input.locked) this.lockPointer();
    });
    window.addEventListener('beforeunload', () => this.meta?.save());
  }

  lockPointer() {
    this.input.requestLock();
  }

  // ===================================================================== loop
  private loop(now: number) {
    requestAnimationFrame((t) => this.loop(t));
    if ((window as any).__pause) return;
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.05, Math.max(0.0001, raw));
    const scale = (window as any).__timeScale ?? 1;
    this.time += dt;
    this.frame(dt * scale, raw);
  }

  /** Test/debug hook: advance the current match without rendering. */
  simulate(seconds: number, step = 1 / 30) {
    let t = 0;
    while (t < seconds && this.state === 'match' && this.match && this.pc) {
      this.pc.update(step);
      this.match.update(step);
      t += step;
    }
    this.hud?.update(step);
    return t;
  }

  perf = { sim: 0, render: 0, hud: 0 };

  frame(dt: number, raw = dt) {
    const eng = this.engine;
    if (this.state === 'match' && this.match && this.pc && this.hud) {
      const steps = dt > 0.05 ? Math.ceil(dt / 0.05) : 1;
      const sdt = dt / steps;
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) {
        this.pc.update(sdt);
        this.match.update(sdt);
      }
      const t1 = performance.now();
      this.perf.sim = this.perf.sim * 0.9 + (t1 - t0) * 0.1;
      const t2 = performance.now();
      this.hud.update(dt);
      this.perf.hud = this.perf.hud * 0.9 + (performance.now() - t2) * 0.1;
      this.updateAmbience(dt);
      this.lockPrompt.style.display = !this.input.locked && this.hud.overlay === 'none' && !this.match.ended && !this.ending ? 'flex' : 'none';
      this.dynamicResolution(raw);
    } else {
      this.input.consumeMouse();
      this.input.endFrame();
      this.updateMenuCamera(dt);
      this.lockPrompt.style.display = 'none';
    }
    const cam = eng.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    audio.setListener(cam.position, fwd, new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion));
    this.weather.update(cam.position, eng.atmosphere.rain, eng.atmosphere.snow);
    const wcam = this.match?.world ?? this.brMap.world;
    const inWater = wcam.getF(cam.position.x, cam.position.y, cam.position.z) === B.WATER;
    audio.underwater = inWater;
    eng.post.uniforms.uUnderwater.value = inWater ? 1 : 0;
    (eng.chunks?.waterMat.uniforms.uUnderwater ?? { value: 0 }).value = inWater ? 1 : 0;
    if ((window as any).__noRender) return;
    const r0 = performance.now();
    eng.render(dt, this.time);
    this.perf.render = this.perf.render * 0.9 + (performance.now() - r0) * 0.1;
  }

  private dynamicResolution(raw: number) {
    const s = this.settings;
    const d = this.dyn;
    d.avg = d.avg * 0.95 + raw * 1000 * 0.05;
    d.cooldown -= raw;
    if (!s.dynamicRes || d.cooldown > 0) return;
    const ps = this.engine.post.settings;
    if (d.avg > 26) d.slow += raw;
    else d.slow = 0;
    if (d.avg < 15) d.fast += raw;
    else d.fast = 0;
    if (d.slow > 2 && ps.renderScale > 0.55) {
      ps.renderScale = Math.max(0.55, ps.renderScale - 0.1);
      this.engine.resize();
      d.slow = 0;
      d.cooldown = 3;
    } else if (d.fast > 5 && ps.renderScale < s.renderScale - 0.01) {
      ps.renderScale = Math.min(s.renderScale, ps.renderScale + 0.05);
      this.engine.resize();
      d.fast = 0;
      d.cooldown = 3;
    }
  }

  private updateAmbience(dt: number) {
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = 0.5;
    const eng = this.engine;
    const atm = eng.atmosphere;
    const cam = eng.camera.position;
    const w = this.match?.world ?? this.brMap.world;
    let water = 0;
    let leaves = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const r of [5, 12]) {
        const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
        const y = w.height(x, z);
        const id = w.get(Math.floor(x), y, Math.floor(z));
        if (id === B.WATER) water++;
        if (id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES) leaves++;
      }
    }
    const night = atm.sunDir.y < -0.05;
    const alt = Math.max(0, cam.y - w.seaLevel - 10) / 50;
    audio.setLoop('wind', Math.min(0.75, 0.18 + alt * 0.4 + atm.rain * 0.3 + atm.overcast * 0.15));
    audio.setLoop('rain', atm.rain * 0.55);
    audio.setLoop('water', Math.min(0.5, water / 10));
    audio.setLoop('birds', !night && atm.rain < 0.3 ? Math.min(0.35, 0.06 + leaves / 30) : 0);
    audio.setLoop('crickets', night && atm.rain < 0.3 && atm.snow < 0.3 ? 0.22 : 0);
    let hum = 0;
    if (this.match instanceof BRMatch && this.match.player.alive) {
      const d = Math.abs(this.match.zone.distOutside(cam.x, cam.z));
      hum = Math.max(0, 1 - d / 30) * 0.5 + (this.match.zone.outside(cam.x, cam.z) ? 0.35 : 0);
    }
    audio.setLoop('hum', hum);
  }

  // ===================================================================== menu
  private resetAtmosphereForMenu() {
    const atm = this.engine.atmosphere;
    atm.time = 17.25;
    atm.timeScale = 0;
    atm.cloudBase = 0.42;
    atm.setWeather('clear', true);
  }

  showMenu() {
    this.state = 'menu';
    this.ending = false;
    this.engine.setChunks(this.brRenderer);
    this.engine.showViewmodel = false;
    this.weather.world = this.brMap.world;
    this.resetAtmosphereForMenu();
    this.input.exitLock();
    this.snapMenu = true;
    this.menu = new Menu(this.ui, {
      meta: this.meta,
      play: (sel) => this.play(sel),
      openSettings: () => this.openSettingsUI(),
      setMenuView: (v) => this.setMenuView(v),
      refreshShowcase: () => this.refreshShowcase(),
    });
    audio.stopLoops();
    if (audio.ctx?.state === 'running') audio.startMenuMusic();
  }

  private setMenuView(v: 'orbit' | 'showcase') {
    this.menuView = v;
    if (v === 'showcase') this.refreshShowcase();
    else if (this.showcase) this.showcase.root.visible = false;
  }

  private refreshShowcase() {
    if (this.showcase) {
      this.engine.scene.remove(this.showcase.root);
      this.showcase.dispose();
    }
    const p = this.meta.p;
    const look = composeLook(p.base, p.equipped.outfit);
    this.showcase = new CharacterModel(look, { weaponCamo: CAMOS[p.equipped.camo] ?? null });
    this.showcase.setWeapon('ranger');
    this.showcase.setLight(1, 0.2);
    this.showcase.root.position.set(164.5, 30, 169.5);
    this.engine.scene.add(this.showcase.root);
    this.showcase.root.visible = this.menuView === 'showcase';
  }

  private snapMenu = true;

  private updateMenuCamera(dt: number) {
    const cam = this.engine.camera;
    if (this.snapMenu) {
      dt = 10;
      this.snapMenu = false;
    }
    if (this.state !== 'menu' && this.state !== 'results' && this.state !== 'lobby') return;
    if (this.menuView === 'showcase' && this.showcase && this.state === 'menu') {
      const s = this.showcase;
      s.root.visible = true;
      s.root.rotation.y += dt * 0.35;
      s.pose({ speed: 0, forward: 0, strafe: 0, onGround: true, crouch: 0, pitch: -0.08, sprint: false, aiming: false, recoil: 0, reload: -1, dead: 0, deathDir: 0, gliding: false, swimming: false, throwing: 0, swing: 0, holding: 'gun' }, dt);
      const target = new THREE.Vector3(164.5, 31.0, 169.5);
      cam.position.lerp(new THREE.Vector3(164.5 + 0.9, 31.45, 169.5 + 3.4), Math.min(1, dt * 3));
      cam.lookAt(target.clone().add(new THREE.Vector3(0.9, 0, 0)));
      this.engine.fovScale = 0.6;
      return;
    }
    if (this.showcase) this.showcase.root.visible = false;
    this.engine.fovScale = 1;
    this.orbitT += dt * 0.025;
    const cx = 160, cz = 165;
    const want = new THREE.Vector3(cx + Math.cos(this.orbitT) * 150, 74, cz + Math.sin(this.orbitT) * 150);
    cam.position.lerp(want, Math.min(1, dt * 2));
    cam.lookAt(cx + Math.cos(this.orbitT + 0.6) * 30, 34, cz + Math.sin(this.orbitT + 0.6) * 30);
  }

  private openSettingsUI() {
    this.settingsOpen = true;
    openSettings(this.ui, this.settings, this.input, (s) => this.applySettings(s), () => {
      this.settingsOpen = false;
    });
  }

  applySettings(s: Settings) {
    saveSettings(s);
    this.engine.applySettings({ ...s });
    audio.applyVolumes(s);
    this.hud?.applyCrossColor();
    this.dyn.cooldown = 1;
  }

  // ===================================================================== match
  private restoreBR() {
    const w = this.brMap.world;
    const b = w.blocks;
    const snap = this.brSnap.blocks;
    const sy = w.sy;
    const chunks = new Set<number>();
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== snap[i]) {
        const col = (i / sy) | 0;
        const x = col % w.sx;
        const z = (col / w.sx) | 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const cx = Math.floor((x + dx * 15) / CHUNK), cz = Math.floor((z + dz * 15) / CHUNK);
            if (cx >= 0 && cz >= 0 && cx < w.chunksX && cz < w.chunksZ) chunks.add(cz * w.chunksX + cx);
          }
      }
    }
    w.blocks.set(snap);
    w.light.set(this.brSnap.light);
    w.builtHP.clear();
    w.builtOwner.clear();
    w.fragileHP.clear();
    w.listeners = [];
    if (chunks.size) {
      w.recomputeHeights();
      for (const c of chunks) w.dirty.add(c);
      invalidateTerrainImage(w);
    }
  }

  async play(sel: PlaySelection) {
    if (this.state === 'lobby' || this.state === 'match') return;
    this.lastSel = sel;
    const meta = this.meta;
    meta.refreshDaily();
    const mods = meta.eventMods();
    this.menu?.dispose();
    this.menu = null;
    this.resultsEl?.remove();
    this.resultsEl = null;
    if (this.showcase) this.showcase.root.visible = false;
    this.menuView = 'orbit';
    this.state = 'lobby';
    audio.stopMusic();
    const ranked = sel.ranked && sel.mode !== 'tutorial';
    const seed = Math.floor(Math.random() * 1e9);
    const rng = new RNG(seed);
    const player = playerIdentity(meta.p);
    const rp = meta.p.rank.rp;
    const botCount = sel.mode === 'br' ? 23 : sel.mode === 'tdm' ? 11 : 0;
    const entries = botCount ? pickBots(botCount, rp, ranked, seed) : [];
    const bots = entries.map((e) => ({ ident: e.ident, skill: effectiveSkill(e, ranked, rp) }));
    let map: MapData | null = null;
    let mapName = '';
    let mapSub = '';
    let tdmInfo: (typeof TDM_MAPS)[number] | null = null;
    if (sel.mode === 'br') {
      mapName = 'Ashcrown Isle';
      mapSub = `Battle Royale · ${ranked ? 'Ranked' : 'Casual'} · 24 players`;
    } else if (sel.mode === 'tdm') {
      tdmInfo = sel.tdmMap === 'rotation' ? (mods.featuredMap && rng.chance(0.5) ? TDM_MAPS.find((m) => m.id === mods.featuredMap)! : rng.pick(TDM_MAPS)) : TDM_MAPS.find((m) => m.id === sel.tdmMap) ?? TDM_MAPS[0];
      mapName = tdmInfo.name;
      mapSub = `Team Deathmatch · ${tdmInfo.time} · 6 v 6`;
    } else {
      mapName = 'Training Grounds';
      mapSub = 'Tutorial · Learn the essentials';
    }
    const ready = (async () => {
      await new Promise((r) => setTimeout(r, 30));
      if (sel.mode === 'br') {
        this.restoreBR();
        map = this.brMap;
      } else {
        map = sel.mode === 'tdm' ? tdmInfo!.build() : buildTraining();
        computeAllLight(map.world);
        this.tmpRenderer = new ChunkRenderer(map.world);
        await this.tmpRenderer.buildAll();
      }
    })();
    const teams: [typeof player[], typeof player[]] | undefined =
      sel.mode === 'tdm' ? [[player, ...bots.slice(0, 5).map((b) => b.ident)], bots.slice(5).map((b) => b.ident)] : undefined;
    await runLobby(this.ui, { mode: sel.mode, ranked, mapName, mapSub, player, bots: bots.map((b) => b.ident), teams, ready });
    await ready;
    this.startMatch(sel, map!, { mode: sel.mode, ranked, mapId: sel.mode === 'tdm' ? tdmInfo!.id : sel.mode, seed, player, bots, camo: meta.p.equipped.camo, eventTag: meta.events().current?.def.id ?? null }, mods);
  }

  private startMatch(sel: PlaySelection, map: MapData, cfg: MatchConfig, mods: ReturnType<Meta['eventMods']>) {
    const eng = this.engine;
    if (sel.mode === 'br') eng.setChunks(this.brRenderer);
    else eng.setChunks(this.tmpRenderer);
    const atm = eng.atmosphere;
    const rng = new RNG(cfg.seed ^ 77);
    if (sel.mode === 'br') {
      const presets = [9.2, 12.4, 15.8, 17.4];
      atm.time = mods.allTime ?? mods.brTime ?? rng.pick(presets);
      atm.timeScale = mods.brTimeScale ?? 1 / 240;
      const wthr = mods.brWeather ?? rng.weighted(['clear', 'cloudy', 'rain'] as const, [0.62, 0.25, 0.13]);
      atm.setWeather(wthr, true);
      atm.cloudBase = wthr === 'clear' ? 0.38 : 0.5;
    } else {
      atm.time = mods.allTime ?? map.preset.time;
      atm.timeScale = map.preset.timeScale;
      atm.setWeather(map.preset.weather, true);
      atm.cloudBase = map.preset.weather === 'clear' ? 0.35 : 0.55;
    }
    let match: Match;
    if (sel.mode === 'br') match = new BRMatch(eng, map, cfg);
    else if (sel.mode === 'tdm') match = new TDMMatch(eng, map, cfg, sel.loadout);
    else match = new TutorialMatch(eng, map, cfg, this.settings);
    match.attach();
    this.match = match;
    this.weather.world = map.world;
    const pc = new PlayerController(match, this.input, this.settings);
    this.pc = pc;
    if (match instanceof BRMatch) {
      pc.inShip = true;
      match.onPlayerJump = () => (pc.inShip = false);
      // look in the flight direction
      match.player.yaw = Math.atan2(-match.ship.dir.x, -match.ship.dir.z);
      match.player.pitch = -0.25;
    }
    eng.showViewmodel = true;
    this.hud = new HUD(this.ui, match, pc, this.settings, {
      resume: () => this.resume(),
      leave: () => this.leaveMatch(),
      settings: () => this.openSettingsUI(),
      continueAfterDeath: () => this.leaveMatch(),
      lockPointer: () => this.lockPointer(),
      unlockPointer: () => this.input.exitLock(),
    });
    match.events.on('end', (r) => this.onMatchEnd(r));
    match.events.on('kill', (e) => {
      if (e.killer === match.player && match instanceof TDMMatch && match.player.streak >= 5) this.meta.markStreak5();
    });
    match.events.on('fire', ({ c }) => {
      if (c === match.player && (c.gun?.def.category === 'sniper' || c.gun?.def.category === 'shotgun')) eng.post.uniforms.uFlash.value = 0.02;
    });
    this.state = 'match';
    this.ending = false;
    this.lockPointer();
    audio.resume();
  }

  private resume() {
    if (!this.hud) return;
    this.hud.closeOverlay();
    this.lockPointer();
  }

  private leaveMatch() {
    const m = this.match;
    if (!m) return;
    const r = (m as BRMatch | TDMMatch | TutorialMatch).forfeitResult();
    this.onMatchEnd(r);
  }

  private onMatchEnd(result: MatchResult) {
    if (this.ending) return;
    this.ending = true;
    const delay = this.match && this.match.player.alive && result.mode !== 'tutorial' ? 1200 : 300;
    setTimeout(() => this.finishMatch(result), delay);
  }

  private finishMatch(result: MatchResult) {
    const summary = this.meta.applyResult(result);
    this.teardownMatch();
    this.state = 'results';
    this.engine.setChunks(this.brRenderer);
    this.resetAtmosphereForMenu();
    this.resultsEl = showResults(this.ui, result, summary, {
      again: () => {
        this.resultsEl = null;
        if (this.lastSel) this.play(this.lastSel);
        else this.showMenu();
      },
      menu: () => {
        this.resultsEl = null;
        this.showMenu();
      },
    });
  }

  private teardownMatch() {
    this.input.exitLock();
    this.hud?.dispose();
    this.hud = null;
    this.pc?.dispose();
    this.pc = null;
    this.match?.dispose();
    this.match = null;
    this.engine.showViewmodel = false;
    this.engine.fovScale = 1;
    const pu = this.engine.post.uniforms;
    pu.uDamage.value = 0;
    pu.uZone.value = 0;
    pu.uLowHealth.value = 0;
    pu.uScope.value = 0;
    pu.uFlash.value = 0;
    pu.uSpawnShield.value = 0;
    this.engine.lights = [];
    if (this.tmpRenderer) {
      if (this.engine.chunks === this.tmpRenderer) this.engine.setChunks(this.brRenderer);
      this.tmpRenderer.dispose();
      this.tmpRenderer = null;
    }
    audio.stopLoops();
    this.ending = false;
  }
}
