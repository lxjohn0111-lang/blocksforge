import { h, clear } from './dom';
import { ACTION_LABELS, DEFAULT_BINDINGS, DEFAULT_SETTINGS, keyLabel, saveSettings, SHARED_OK, type Action, type Settings } from '../core/settings';
import type { Input } from '../core/input';
import { QUALITY_PRESETS, type Quality } from '../render/engine';
import { audio } from '../audio/audio';
import { ICON } from './icons';
import { resetProfile } from '../meta/profile';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay' | 'about';

export function openSettings(parent: HTMLElement, s: Settings, input: Input, apply: (s: Settings) => void, onClose?: () => void) {
  let tab: Tab = 'graphics';
  const main = h('div', { class: 'main' });
  const side = h('div', { class: 'side' });
  const modal = h('div', { class: 'modal', style: { zIndex: '25' } }, h('div', { class: 'settings panel-solid' }, side, main));
  parent.appendChild(modal);
  const commit = () => {
    saveSettings(s);
    apply(s);
  };
  const close = () => {
    input.captureNext = null;
    modal.remove();
    onClose?.();
  };
  const slider = (label: string, desc: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmtv = (v: number) => v.toFixed(2)) => {
    const val = h('span', { class: 'mono dim', style: { width: '48px', textAlign: 'right', fontSize: '12px' } }, fmtv(get()));
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) }) as HTMLInputElement;
    inp.addEventListener('input', () => {
      set(parseFloat(inp.value));
      val.textContent = fmtv(get());
      commit();
    });
    return h('div', { class: 'setrow' }, h('div', null, label, h('div', { class: 'd' }, desc)), h('div', { class: 'row' }, inp, val));
  };
  const toggle = (label: string, desc: string, get: () => boolean, set: (v: boolean) => void) => {
    const t = h('div', { class: 'toggle' + (get() ? ' on' : '') }, h('i'));
    t.addEventListener('click', () => {
      set(!get());
      t.classList.toggle('on', get());
      audio.ui('click', 0.5);
      commit();
    });
    return h('div', { class: 'setrow' }, h('div', null, label, h('div', { class: 'd' }, desc)), t);
  };
  const render = () => {
    clear(side);
    clear(main);
    side.appendChild(h('div', { class: 'h2', style: { padding: '0 18px 12px' } }, 'Settings'));
    for (const [t, l] of [['graphics', 'Graphics'], ['audio', 'Audio'], ['controls', 'Controls'], ['gameplay', 'Gameplay'], ['about', 'About']] as [Tab, string][]) {
      side.appendChild(h('button', { class: tab === t ? 'on' : '', onclick: () => { tab = t; render(); } }, l));
    }
    side.appendChild(h('div', { style: { marginTop: 'auto', padding: '0 14px' } }, h('button', { class: 'btn primary', style: { width: '100%' }, onclick: close }, 'Done')));
    if (tab === 'graphics') {
      main.appendChild(h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Quality preset'));
      const seg = h('div', { class: 'seg', style: { marginBottom: '8px' } });
      for (const q of ['low', 'medium', 'high', 'ultra'] as Quality[]) {
        seg.appendChild(h('button', { class: s.quality === q ? 'on' : '', onclick: () => {
          s.quality = q;
          const pr = QUALITY_PRESETS[q];
          s.renderScale = pr.renderScale;
          s.viewDistance = pr.viewDistance;
          s.shadows = pr.shadows;
          s.bloom = pr.bloom;
          s.godRays = pr.godRays;
          s.ssr = pr.ssr;
          s.fxaa = pr.fxaa;
          commit();
          render();
        } }, q));
      }
      main.appendChild(seg);
      main.appendChild(slider('Render scale', 'Internal resolution. Lower for performance.', 0.5, 1.25, 0.05, () => s.renderScale, (v) => (s.renderScale = v), (v) => `${Math.round(v * 100)}%`));
      main.appendChild(toggle('Dynamic resolution', 'Lowers render scale automatically if the frame rate drops.', () => s.dynamicRes, (v) => (s.dynamicRes = v)));
      main.appendChild(slider('View distance', 'How far terrain is drawn before it fades into the haze.', 100, 320, 10, () => s.viewDistance, (v) => (s.viewDistance = v), (v) => `${v}m`));
      main.appendChild(slider('Field of view', 'Horizontal camera field of view.', 65, 105, 1, () => s.fov, (v) => (s.fov = v), (v) => `${v}°`));
      main.appendChild(toggle('Shadows', 'Cascaded sun & moon shadows with soft edges.', () => s.shadows, (v) => (s.shadows = v)));
      main.appendChild(toggle('Water reflections', 'Screen-space reflections on water.', () => s.ssr, (v) => (s.ssr = v)));
      main.appendChild(toggle('Bloom', 'Glow around bright lights and the sun.', () => s.bloom, (v) => (s.bloom = v)));
      main.appendChild(toggle('Light shafts', 'Volumetric-style sun rays.', () => s.godRays, (v) => (s.godRays = v)));
      main.appendChild(toggle('Anti-aliasing (FXAA)', 'Smooths jagged edges.', () => s.fxaa, (v) => (s.fxaa = v)));
      main.appendChild(toggle('Show FPS', 'Frame rate counter in the corner.', () => s.showFps, (v) => (s.showFps = v)));
    } else if (tab === 'audio') {
      main.appendChild(slider('Master volume', '', 0, 1, 0.01, () => s.masterVol, (v) => (s.masterVol = v), (v) => `${Math.round(v * 100)}`));
      main.appendChild(slider('Effects', 'Weapons, footsteps, impacts, UI.', 0, 1, 0.01, () => s.sfxVol, (v) => (s.sfxVol = v), (v) => `${Math.round(v * 100)}`));
      main.appendChild(slider('Music', 'Menu music.', 0, 1, 0.01, () => s.musicVol, (v) => (s.musicVol = v), (v) => `${Math.round(v * 100)}`));
      main.appendChild(slider('Ambience', 'Wind, water, rain and wildlife.', 0, 1, 0.01, () => s.ambientVol, (v) => (s.ambientVol = v), (v) => `${Math.round(v * 100)}`));
    } else if (tab === 'controls') {
      main.appendChild(slider('Mouse sensitivity', '', 0.1, 4, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v)));
      main.appendChild(slider('Aim-down-sights sensitivity', 'Multiplier while aiming with iron sights / red dots.', 0.2, 1.5, 0.05, () => s.adsSens, (v) => (s.adsSens = v)));
      main.appendChild(slider('Scoped sensitivity', 'Multiplier while looking through magnified scopes (scales with zoom).', 0.2, 2, 0.05, () => s.scopeSens, (v) => (s.scopeSens = v)));
      main.appendChild(toggle('Invert vertical look', '', () => s.invertY, (v) => (s.invertY = v)));
      main.appendChild(toggle('Toggle aim', 'Press instead of hold to aim.', () => s.aimToggle, (v) => (s.aimToggle = v)));
      main.appendChild(toggle('Toggle crouch', 'Press instead of hold to crouch.', () => s.crouchToggle, (v) => (s.crouchToggle = v)));
      main.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '16px 0 4px' } }, h('div', { class: 'label' }, 'Key bindings'), h('button', { class: 'btn ghost', style: { fontSize: '11px' }, onclick: () => { s.bindings = { ...DEFAULT_BINDINGS }; commit(); render(); } }, 'Reset to defaults')));
      for (const a of Object.keys(ACTION_LABELS) as Action[]) {
        const btn = h('button', { class: 'btn keybind' }, keyLabel(s.bindings[a]));
        btn.addEventListener('click', () => {
          btn.classList.add('listen');
          btn.textContent = 'Press a key…';
          input.captureNext = (code) => {
            if (code === 'Escape') {
              render();
              return;
            }
            // swap with any conflicting action (unless the pair may share)
            for (const other of Object.keys(s.bindings) as Action[]) {
              if (other === a || s.bindings[other] !== code) continue;
              const okShare = SHARED_OK.some(([x, y]) => (x === a && y === other) || (y === a && x === other));
              if (!okShare) s.bindings[other] = s.bindings[a];
            }
            s.bindings[a] = code;
            commit();
            render();
          };
        });
        main.appendChild(h('div', { class: 'setrow' }, h('div', null, ACTION_LABELS[a]), btn));
      }
    } else if (tab === 'gameplay') {
      main.appendChild(toggle('Damage numbers', 'Show floating damage when you hit.', () => s.damageNumbers, (v) => (s.damageNumbers = v)));
      const colors = ['#ffffff', '#5bff7d', '#ffe14a', '#4ad8ff', '#ff5ad8'];
      const row = h('div', { class: 'swatchrow', style: { justifySelf: 'end' } }, ...colors.map((c) => h('div', { class: 'swatch' + (s.crosshairColor === c ? ' on' : ''), style: { background: c }, onclick: () => { s.crosshairColor = c; commit(); render(); } })));
      main.appendChild(h('div', { class: 'setrow' }, h('div', null, 'Crosshair colour'), row));
      main.appendChild(h('div', { class: 'setrow' }, h('div', null, 'Restore all settings', h('div', { class: 'd' }, 'Graphics, audio and controls back to defaults.')), h('button', { class: 'btn', style: { justifySelf: 'end' }, onclick: () => { Object.assign(s, JSON.parse(JSON.stringify(DEFAULT_SETTINGS))); commit(); render(); } }, 'Restore')));
    } else {
      main.appendChild(h('div', { class: 'h2', style: { marginBottom: '10px' } }, 'About BlockForge'));
      const p = (t: string) => h('p', { class: 'dim', style: { fontSize: '13.5px', lineHeight: '1.6', margin: '0 0 10px' } }, t);
      main.appendChild(p('BlockForge is a single-player voxel shooter. Every other participant — teammates, opponents and everyone on the ladder — is an AI player with a persistent identity, rank and play style. There are no real players, servers, accounts or chat.'));
      main.appendChild(p('Ranked points, seasons, daily quests and events run locally on your device clock. The ladder compares you with the AI competitor profiles only; it is not a global ranking.'));
      main.appendChild(p('All art, textures, models, sounds and music are generated procedurally by the game. Cosmetics are earned through play and never affect gameplay. There are no purchases.'));
      main.appendChild(h('div', { class: 'setrow' }, h('div', null, 'Reset progress', h('div', { class: 'd' }, 'Erase level, coins, unlocks, rank and history on this device.')), h('button', { class: 'btn danger', style: { justifySelf: 'end' }, onclick: () => {
        if (confirm('Erase all BlockForge progress on this device? This cannot be undone.')) {
          resetProfile();
          location.reload();
        }
      } }, h('span', { html: ICON.close(12) }), 'Reset')));
    }
  };
  render();
}
