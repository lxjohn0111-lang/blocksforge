// First-run quick tutorial: five cards, one line each, swipe or tap through. Shown once on the
// first visit and reopenable from the menu's "?" button.

import { h, clear } from './dom';
import { ICON } from './icons';
import { keyLabel, type Settings } from '../core/settings';
import { loadJSON, saveJSON } from '../core/storage';
import { audio } from '../audio/audio';

const KEY = 'blockforge.tips.v1';

export function introSeen(): boolean {
  return !!loadJSON<{ intro?: boolean }>(KEY)?.intro;
}

function markSeen() {
  const t = loadJSON<Record<string, unknown>>(KEY) ?? {};
  t.intro = true;
  saveJSON(KEY, t);
}

const big = (inner: string) => `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square">${inner}</svg>`;
const ART = {
  move: big('<path d="M12 3v6M12 15v6M3 12h6M15 12h6M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/><circle cx="12" cy="12" r="2"/>'),
  shoot: big('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  loot: big('<rect x="3" y="9" width="18" height="11"/><path d="M3 13h18M10 13v3h4v-3M5 9l2-4h10l2 4"/>'),
  build: big('<path d="M3 21h18M5 21V11l7-6 7 6v10"/><path d="M5 15h14M9 11v4M15 11v4M12 15v6"/>'),
  storm: big('<circle cx="12" cy="12" r="9" stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="4"/><path d="M12 8v-2M12 18v-2"/>'),
};

interface Card {
  art: string;
  title: string;
  line: string;
  keys: string[];
}

export function showIntro(parent: HTMLElement, settings: Settings, touch: boolean, done: (choice: 'play' | 'training' | 'close') => void) {
  const k = (a: keyof Settings['bindings']) => keyLabel(settings.bindings[a]);
  const cards: Card[] = [
    { art: ART.move, title: 'Move', line: touch ? 'Left thumb moves. Drag right side to look.' : 'Move and look around.', keys: touch ? [] : [`${k('forward')}${k('left')}${k('back')}${k('right')}`, 'Mouse', `${k('jump')} jump`] },
    { art: ART.shoot, title: 'Shoot', line: touch ? 'Fire button shoots. Aim zooms in.' : 'Aim for the head.', keys: touch ? [] : [`${k('fire')} fire`, `${k('aim')} aim`, `${k('reload')} reload`] },
    { art: ART.loot, title: 'Loot', line: 'Grab weapons, ammo and heals. Chests hold the best gear.', keys: touch ? [] : [`${k('interact')} pick up`] },
    { art: ART.build, title: 'Build', line: 'Walls stop bullets. Ramps reach high ground.', keys: touch ? [] : [`${k('build')} build`, `${k('tool')} harvest`] },
    { art: ART.storm, title: 'Survive', line: 'Stay inside the circle. Last one standing wins.', keys: [] },
  ];
  let i = 0;
  const card = h('div', { class: 'intro-card' });
  const dots = h('div', { class: 'intro-dots' });
  const nav = h('div', { class: 'intro-nav' });
  const box = h('div', { class: 'intro-box panel-solid' }, card, dots, nav);
  const skip = h('button', { class: 'btn ghost intro-skip' }, 'Skip');
  const root = h('div', { class: 'intro' }, box, skip);
  const finish = (choice: 'play' | 'training' | 'close') => {
    markSeen();
    root.remove();
    done(choice);
  };
  skip.addEventListener('click', () => finish('close'));
  const render = () => {
    const c = cards[i];
    clear(card);
    card.append(h('div', { class: 'art', html: c.art }), h('div', { class: 'tt' }, c.title), h('div', { class: 'ln' }, c.line));
    if (c.keys.length) card.appendChild(h('div', { class: 'keys' }, ...c.keys.map((x) => h('span', { class: 'kbd' }, x))));
    card.classList.remove('in');
    void card.offsetWidth;
    card.classList.add('in');
    clear(dots);
    cards.forEach((_, j) => dots.appendChild(h('i', { class: j === i ? 'on' : '', onclick: () => go(j) })));
    clear(nav);
    const last = i === cards.length - 1;
    if (last) {
      nav.append(
        h('button', { class: 'btn', onclick: () => finish('training') }, 'Training'),
        h('button', { class: 'btn primary', onclick: () => finish('play') }, h('span', { html: ICON.play(14) }), 'Play'),
      );
    } else {
      if (i > 0) nav.appendChild(h('button', { class: 'btn ghost', onclick: () => go(i - 1) }, 'Back'));
      nav.appendChild(h('button', { class: 'btn primary', onclick: () => go(i + 1) }, 'Next'));
    }
    skip.style.visibility = last ? 'hidden' : '';
  };
  const go = (j: number) => {
    i = Math.max(0, Math.min(cards.length - 1, j));
    audio.ui('click', 0.4);
    render();
  };
  // swipe between cards
  let sx: number | null = null;
  box.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    sx = e.clientX;
  });
  box.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
  });
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) return window.removeEventListener('keydown', onKey);
    if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      if (i < cards.length - 1) go(i + 1);
    } else if (e.code === 'ArrowLeft') go(i - 1);
    else if (e.code === 'Escape') finish('close');
  };
  window.addEventListener('keydown', onKey);
  render();
  parent.appendChild(root);
  return root;
}
