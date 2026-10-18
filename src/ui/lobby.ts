// Quick matchmaking + match intro presentation. Short by design: a roster of
// AI competitor cards fills in, then the map card and a 3-2-1 countdown.

import { h, clear } from './dom';
import { playerCard } from './menu';
import type { Identity } from '../game/combatant';
import { audio } from '../audio/audio';
import { ICON } from './icons';

export interface LobbyOpts {
  mode: 'br' | 'tdm' | 'tutorial';
  ranked: boolean;
  mapName: string;
  mapSub: string;
  player: Identity;
  bots: Identity[];
  teams?: [Identity[], Identity[]];
  ready: Promise<void>;
}

export function runLobby(parent: HTMLElement, o: LobbyOpts): Promise<void> {
  return new Promise((resolve) => {
    const root = h('div', { class: 'screen lobby' });
    parent.appendChild(root);
    let skip = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') skip = true;
    };
    window.addEventListener('keydown', onKey);
    root.addEventListener('click', () => (skip = true));
    const wait = (ms: number) => new Promise<void>((r) => {
      const t0 = performance.now();
      const step = () => (skip || performance.now() - t0 >= ms ? r() : requestAnimationFrame(step));
      step();
    });
    const done = () => {
      window.removeEventListener('keydown', onKey);
      root.remove();
      resolve();
    };
    (async () => {
      if (o.mode !== 'tutorial') {
        // phase 1: lobby assembly
        const total = o.bots.length + 1;
        const head = h('div', { class: 'head' });
        const count = h('div', { class: 'h1', style: { fontSize: '36px' } });
        head.appendChild(h('div', { class: 'label' }, `${o.mode === 'br' ? 'Battle Royale' : 'Team Deathmatch'} · ${o.ranked ? 'Ranked' : 'Casual'}`));
        head.appendChild(count);
        root.appendChild(head);
        const grid = h('div', { class: 'grid' });
        root.appendChild(grid);
        const all = [o.player, ...o.bots];
        const per = Math.max(28, 1100 / total);
        for (let i = 0; i < all.length; i++) {
          count.textContent = `Assembling lobby  ${i + 1}/${total}`;
          const card = playerCard(all[i]);
          if (!all[i].isBot) card.style.boxShadow = 'inset 0 0 0 1px var(--accent)';
          grid.appendChild(card);
          if (i % 3 === 0) audio.ui('hover', 0.25);
          if (!skip) await wait(per);
        }
        count.textContent = `Lobby ready  ${total}/${total}`;
        audio.ui('confirm', 0.7);
        await wait(450);
        await o.ready;
        clear(root);
        // phase 2: intro
        root.appendChild(h('div', { class: 'label', style: { textAlign: 'center' } }, o.mode === 'br' ? 'Drop zone' : 'Arena'));
        root.appendChild(h('div', { class: 'intro-map' }, o.mapName));
        root.appendChild(h('div', { class: 'dim', style: { textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '13px', marginBottom: '22px' } }, o.mapSub));
        if (o.teams) {
          const team = (list: Identity[], cls: string, label: string) => h('div', { class: 'team ' + cls }, h('div', { class: 'label' }, label), ...list.map((id) => playerCard(id)));
          root.appendChild(h('div', { class: 'vs' }, team(o.teams[0], 'team-blue', 'Your team'), h('div', { class: 'vsmark' }, 'VS'), team(o.teams[1], 'team-red', 'Enemy team')));
        }
      } else {
        await o.ready;
        root.appendChild(h('div', { class: 'intro-map' }, o.mapName));
        root.appendChild(h('div', { class: 'dim', style: { textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '13px' } }, o.mapSub));
      }
      const cd = h('div', { class: 'countdown' });
      root.appendChild(cd);
      for (const n of [3, 2, 1]) {
        cd.textContent = String(n);
        audio.ui('countdown', 0.8);
        await wait(skip ? 120 : 650);
      }
      audio.ui('go', 0.9);
      done();
    })();
  });
}
