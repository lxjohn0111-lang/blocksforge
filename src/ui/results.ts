// Post-match results: one headline, three numbers, a progress strip (XP, coins, rank) and the
// buttons. The scoreboard is one tap away; level-ups and promotions get their own reveal.

import { h, fmt } from './dom';
import { ICON, rankEmblem, avatarCanvas } from './icons';
import { showReveal, clearReveals } from './menu';
import type { MatchResult } from '../game/match';
import type { ResultSummary, Reward, LevelUp } from '../meta/meta';
import { adButton } from './adui';
import { rankOf, TIERS } from '../meta/ranks';
import { xpForLevel } from '../meta/profile';
import { audio } from '../audio/audio';
import { fmtDuration } from '../core/mathx';

export interface ResultsActions {
  again(): void;
  menu(): void;
  /** grant the match's XP and coins a second time (after a rewarded ad) */
  double?(): { levelUps: LevelUp[]; level: number; xp: number };
}

export function showResults(parent: HTMLElement, r: MatchResult, s: ResultSummary, cb: ResultsActions) {
  const root = h('div', { class: 'screen results' });
  parent.appendChild(root);
  const wrap = h('div', { class: 'res2' });
  root.appendChild(wrap);
  // ---------------------------------------------------------------- headline
  let title = '';
  let cls = '';
  if (r.mode === 'tutorial') {
    title = r.won ? 'Training complete' : 'Training paused';
    cls = r.won ? 'win' : '';
  } else if (r.mode === 'br') {
    title = r.won ? 'Victory' : `#${r.placement}`;
    cls = r.won ? 'win' : 'lose';
  } else {
    title = r.won ? 'Victory' : r.draw ? 'Draw' : 'Defeat';
    cls = r.won ? 'win' : r.draw ? '' : 'lose';
  }
  audio.ui(r.won ? 'victory' : 'defeat', 0.8);
  const kicker = r.mode === 'br' ? `${r.ranked ? 'Ranked · ' : ''}${r.mapName}` : r.mode === 'tdm' ? `${r.ranked ? 'Ranked · ' : ''}${r.mapName}` : 'Training Grounds';
  const head = h('div', { class: 'res2-head ' + cls }, h('div', { class: 'kick' }, kicker), h('div', { class: 'res-title ' + cls }, title));
  if (r.mode === 'br' && !r.won) head.appendChild(h('div', { class: 'of' }, `of ${r.participants}`));
  if (r.mode === 'tdm' && r.teamScores) head.appendChild(h('div', { class: 'score' }, h('span', { class: 'a' }, String(r.teamScores[0])), h('i'), h('span', { class: 'b' }, String(r.teamScores[1]))));
  wrap.appendChild(head);

  // ---------------------------------------------------------------- the numbers that matter
  const st = r.stats;
  const acc = st.shots ? `${Math.round((st.hits / st.shots) * 100)}%` : '—';
  const tiles: [string, string, string][] = r.mode === 'tutorial'
    ? [[ICON.skull(18), String(st.kills), 'Elims'], [ICON.crosshair(18), acc, 'Accuracy'], [ICON.wall(18), String(st.built), 'Built']]
    : r.mode === 'br'
      ? [[ICON.skull(18), String(st.kills), 'Elims'], [ICON.bolt(18), fmt(st.damage), 'Damage'], [ICON.clock(18), fmtDuration(r.survived * 1000), 'Survived']]
      : [[ICON.skull(18), String(st.kills), 'Elims'], [ICON.bolt(18), fmt(st.damage), 'Damage'], [ICON.crosshair(18), acc, 'Accuracy']];
  wrap.appendChild(h('div', { class: 'res2-tiles' }, ...tiles.map(([ic, v, l], i) =>
    h('div', { class: 'tile', style: { animationDelay: `${0.1 + i * 0.07}s` } }, h('span', { class: 'ic', html: ic }), h('b', null, v), h('small', null, l)))));

  // ---------------------------------------------------------------- progression strip: XP, coins, rank
  const strip = h('div', { class: 'res2-strip' });
  const lvlBadge = h('div', { class: 'badge' }, String(s.levelBefore));
  const xpFill = h('i', { style: { width: `${(s.xpBefore / xpForLevel(s.levelBefore)) * 100}%` } });
  strip.appendChild(h('div', { class: 'prog xp' }, h('div', { class: 'lvl' }, lvlBadge), h('div', { class: 'grow' }, h('div', { class: 'row-sb' }, h('span', null, 'Level'), h('b', { class: 'xpv' }, `+${fmt(s.xpTotal)} XP`)), h('div', { class: 'bar' }, xpFill))));
  const coinsEl = h('b', null, `+${fmt(s.coins)}`);
  if (s.coins) strip.appendChild(h('div', { class: 'prog coins' }, h('span', { html: ICON.coin(20) }), coinsEl));
  let rpBar: HTMLElement | null = null;
  let rpName: HTMLElement | null = null;
  let rpEmblem: HTMLElement | null = null;
  if (s.rp) {
    const rp = s.rp;
    const before = rankOf(rp.before);
    rpEmblem = h('div', { class: 'em', html: rankEmblem(before.tier, before.division, 40) });
    rpName = h('span', { style: { color: before.tierDef.color } }, before.label);
    rpBar = h('i', { style: { width: `${before.progress}%`, background: before.tierDef.color } });
    strip.appendChild(h('div', { class: 'prog rank' }, rpEmblem, h('div', { class: 'grow' }, h('div', { class: 'row-sb' }, rpName, h('b', { class: rp.total >= 0 ? 'pos' : 'neg' }, `${rp.total >= 0 ? '+' : ''}${rp.total} RP`)), h('div', { class: 'bar' }, rpBar))));
  }
  wrap.appendChild(strip);

  // rewarded: the match's XP and coins once more
  if (cb.double && r.mode !== 'tutorial' && (s.xpTotal > 0 || s.coins > 0)) {
    const xpv = strip.querySelector('.xpv') as HTMLElement;
    const offer = adButton({
      label: '2× Rewards', sub: `+${fmt(s.xpTotal)} XP${s.coins ? ` · +${fmt(s.coins)} coins` : ''}`, big: true, tone: 'gold',
      onReward: () => {
        const d = cb.double!();
        offer!.replaceWith(h('div', { class: 'doubled' }, h('span', { html: ICON.check(16) }), 'Rewards doubled'));
        xpv.textContent = `+${fmt(s.xpTotal * 2)} XP`;
        xpv.appendChild(h('span', { class: 'x2' }, '×2'));
        coinsEl.textContent = `+${fmt(s.coins * 2)}`;
        lvlBadge.textContent = String(d.level);
        xpFill.style.width = `${(d.xp / xpForLevel(d.level)) * 100}%`;
        if (d.levelUps.length) showReveal(parent, 'Level up', `Level ${d.level}`, d.levelUps.flatMap((u) => u.rewards));
      },
    });
    if (offer) wrap.appendChild(h('div', { class: 'res2-double' }, offer));
  }

  // finished quests / achievements: one chip each, nothing about unfinished ones
  const done = [...s.quests.filter((q) => q.justDone).map((q) => q.text), ...s.eventLines.filter((e) => e.justDone).map((e) => e.text), ...s.achievements.map((a) => a.name)];
  if (done.length && r.mode !== 'tutorial') {
    audio.ui('quest', 0.7);
    wrap.appendChild(h('div', { class: 'res2-chips' }, ...done.slice(0, 4).map((t) => h('span', { class: 'chip accent' }, h('span', { html: ICON.check(12) }), t))));
  }

  // ---------------------------------------------------------------- actions
  const sbBox = h('div', { class: 'res2-sb', style: { display: 'none' } });
  const actions = h('div', { class: 'res2-actions' },
    r.mode !== 'tutorial' ? h('button', { class: 'btn big primary', onclick: () => { clearReveals(); root.remove(); cb.again(); } }, h('span', { html: ICON.play(16) }), 'Play again') : null,
    h('button', { class: 'btn big', onclick: () => { clearReveals(); root.remove(); cb.menu(); } }, 'Menu'),
    r.mode !== 'tutorial' ? h('button', { class: 'btn ghost sbtoggle', onclick: (e: Event) => { const open = sbBox.style.display === 'none'; sbBox.style.display = open ? 'block' : 'none'; (e.currentTarget as HTMLElement).classList.toggle('on', open); } }, h('span', { html: ICON.people(16) }), 'Scoreboard') : null);
  wrap.appendChild(actions);
  if (r.mode !== 'tutorial') {
    const roster = [...r.roster];
    const row = (e: (typeof roster)[number]) =>
      h('tr', { class: e.isPlayer ? 'me' : '' },
        r.mode === 'br' ? h('td', { class: 'n' }, e.placement ? `#${e.placement}` : '—') : null,
        h('td', null, e.name),
        h('td', { class: 'n' }, String(e.kills)), h('td', { class: 'n' }, String(e.deaths)), h('td', { class: 'n' }, fmt(e.damage)));
    const headRow = () => h('tr', null, r.mode === 'br' ? h('th', { class: 'n' }, '#') : null, h('th', null, ''), h('th', { class: 'n' }, 'K'), h('th', { class: 'n' }, 'D'), h('th', { class: 'n' }, 'DMG'));
    if (r.mode === 'br') {
      roster.sort((a, b) => (a.placement || 99) - (b.placement || 99) || b.kills - a.kills);
      sbBox.appendChild(h('table', { class: 'sbt' }, headRow(), ...roster.slice(0, 10).map(row)));
    } else {
      const mine = roster.filter((e) => e.team === r.playerTeam).sort((a, b) => b.score - a.score);
      const other = roster.filter((e) => e.team !== r.playerTeam).sort((a, b) => b.score - a.score);
      sbBox.appendChild(h('div', { class: 'sbcols' },
        h('div', null, h('div', { class: 'teamhead a' }, 'Your team'), h('table', { class: 'sbt' }, headRow(), ...mine.map(row))),
        h('div', null, h('div', { class: 'teamhead b' }, 'Enemies'), h('table', { class: 'sbt' }, headRow(), ...other.map(row)))));
    }
    wrap.appendChild(sbBox);
  }

  // ---------------------------------------------------------------- animations: XP through level ups, then RP
  (async () => {
    let lvl = s.levelBefore;
    await sleep(500);
    while (lvl < s.levelAfter) {
      xpFill.style.width = '100%';
      await sleep(600);
      lvl++;
      lvlBadge.textContent = String(lvl);
      xpFill.style.transition = 'none';
      xpFill.style.width = '0%';
      await sleep(30);
      xpFill.style.transition = '';
      audio.ui('levelup', 0.7);
    }
    xpFill.style.width = `${(s.xpAfter / xpForLevel(s.levelAfter)) * 100}%`;
  })();
  if (s.rp && rpBar && rpName && rpEmblem) {
    const rp = s.rp;
    const after = rankOf(rp.after);
    const bar = rpBar, name = rpName, emblem = rpEmblem;
    (async () => {
      await sleep(900);
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        const v = Math.round(rp.before + ((rp.after - rp.before) * i) / steps);
        const rk = rankOf(v);
        bar.style.width = `${Math.min(100, rk.tier === TIERS.length - 1 ? 100 : rk.progress)}%`;
        bar.style.background = rk.tierDef.color;
        if (rk.label !== name.textContent) {
          name.textContent = rk.label;
          name.style.color = rk.tierDef.color;
          emblem.innerHTML = rankEmblem(rk.tier, rk.division, 40);
        }
        await sleep(28);
      }
      if (rp.promoted) {
        audio.ui('rankup', 0.9);
        const big = h('div', { class: 'emblem-big', style: { ['--glow' as any]: after.tierDef.color }, html: rankEmblem(after.tier, after.division, 220) });
        const box = showReveal(parent, rp.tierUp ? 'Promotion' : 'Division up', after.label, [], undefined, big);
        (box.querySelector('.big') as HTMLElement).style.color = after.tierDef.color;
      } else if (rp.demoted) {
        audio.ui('rankdown', 0.8);
        const big = h('div', { class: 'emblem-big', style: { ['--glow' as any]: '#ff5a4a' }, html: rankEmblem(after.tier, after.division, 160) });
        showReveal(parent, 'Demoted', after.label, [], undefined, big);
      }
    })();
  }
  // level-up reveal after the bar finishes
  if (s.levelUps.length) {
    setTimeout(() => {
      const rewards: Reward[] = s.levelUps.flatMap((u) => u.rewards);
      showReveal(parent, 'Level up', `Level ${s.levelAfter}`, rewards);
    }, 900 + s.levelUps.length * 700);
  }
  void avatarCanvas;
  return root;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
