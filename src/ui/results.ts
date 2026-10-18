// Post-match results: headline, stats, scoreboard, animated XP / level ups,
// coins, ranked RP with promotion & demotion screens, quests, achievements,
// event progress and next-day event teasers.

import { h, fmt } from './dom';
import { ICON, rankEmblem, avatarCanvas } from './icons';
import { showReveal, clearReveals } from './menu';
import type { MatchResult } from '../game/match';
import type { ResultSummary, Reward } from '../meta/meta';
import { rankOf, TIERS } from '../meta/ranks';
import { xpForLevel } from '../meta/profile';
import { audio } from '../audio/audio';
import { fmtDuration } from '../core/mathx';

export function showResults(parent: HTMLElement, r: MatchResult, s: ResultSummary, cb: { again(): void; menu(): void }) {
  const root = h('div', { class: 'screen results' });
  parent.appendChild(root);
  const wrap = h('div', { class: 'res-wrap' });
  root.appendChild(wrap);
  // headline
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
  const sub = r.mode === 'br' ? `Battle Royale · ${r.mapName} · ${r.won ? 'Last block standing' : `of ${r.participants}`}` : r.mode === 'tdm' ? `Team Deathmatch · ${r.mapName} · ${r.teamScores![0]} – ${r.teamScores![1]}` : 'Training Grounds';
  wrap.appendChild(
    h('div', { class: 'res-head' },
      h('div', null, h('div', { class: 'label' }, r.ranked ? 'Ranked match' : r.mode === 'tutorial' ? 'Tutorial' : 'Casual match'), h('div', { class: 'res-title ' + cls }, title), h('div', { class: 'dim', style: { marginTop: '8px', letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: '13px' } }, sub)),
      h('div', { class: 'row' },
        r.mode !== 'tutorial' ? h('button', { class: 'btn big primary', onclick: () => { clearReveals(); root.remove(); cb.again(); } }, h('span', { html: ICON.play(16) }), 'Play again') : null,
        h('button', { class: 'btn big', onclick: () => { clearReveals(); root.remove(); cb.menu(); } }, 'Main menu'))),
  );
  const grid = h('div', { class: 'res-grid' });
  wrap.appendChild(grid);
  // left: stats + roster
  const left = h('div', { class: 'col', style: { gap: '16px' } });
  const st = r.stats;
  const acc = st.shots ? `${Math.round((st.hits / st.shots) * 100)}%` : '—';
  const cells: [string, string][] = [
    ['Eliminations', String(st.kills)], ['Assists', String(st.assists)], ['Damage', fmt(st.damage)], ['Accuracy', acc],
    ['Headshots', String(st.headshots)], r.mode === 'br' ? ['Survived', fmtDuration(r.survived * 1000)] : ['Deaths', String(st.deaths)],
    r.mode === 'br' ? ['Built', String(st.built)] : ['Longest', `${Math.round(st.longestKill)}m`], r.mode === 'br' ? ['Chests', String(st.chests)] : ['Team rank', `#${r.placement}`],
  ];
  left.appendChild(h('div', { class: 'panel', style: { padding: '18px' } }, h('div', { class: 'statgrid' }, ...cells.map(([l, v], i) => h('div', { class: 'stat', style: { animation: `lineIn .3s ${i * 0.04}s both` } }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l))))));
  if (r.mode !== 'tutorial') {
    const sb = h('div', { class: 'panel', style: { padding: '18px' } });
    sb.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('div', { class: 'h2' }, 'Scoreboard'), h('span', { class: 'dim', style: { fontSize: '12px' } }, `MVP · ${r.mvp}`)));
    const roster = [...r.roster];
    const row = (e: (typeof roster)[number]) =>
      h('tr', { class: e.isPlayer ? 'me' : '' },
        h('td', null, r.mode === 'br' ? (e.placement ? `#${e.placement}` : '—') : ''),
        h('td', null, h('span', { class: 'row', style: { gap: '6px' } }, e.name, e.isBot ? null : h('span', { class: 'chip accent' }, 'You'))),
        h('td', { class: 'n' }, String(e.kills)), h('td', { class: 'n' }, String(e.deaths)), h('td', { class: 'n' }, String(e.assists)), h('td', { class: 'n' }, fmt(e.damage)));
    const head = h('tr', null, h('th', null, r.mode === 'br' ? 'Place' : ''), h('th', null, 'Player'), h('th', { class: 'n' }, 'K'), h('th', { class: 'n' }, 'D'), h('th', { class: 'n' }, 'A'), h('th', { class: 'n' }, 'DMG'));
    if (r.mode === 'br') {
      roster.sort((a, b) => (a.placement || 99) - (b.placement || 99) || b.kills - a.kills);
      sb.appendChild(h('table', { class: 'sbt' }, head, ...roster.slice(0, 12).map(row)));
    } else {
      const mine = roster.filter((e) => e.team === r.playerTeam).sort((a, b) => b.score - a.score);
      const other = roster.filter((e) => e.team !== r.playerTeam).sort((a, b) => b.score - a.score);
      sb.appendChild(h('div', { class: 'teamhead a' }, h('span', null, 'Your team'), h('span', null, String(r.teamScores![0]))));
      sb.appendChild(h('table', { class: 'sbt' }, head, ...mine.map(row)));
      sb.appendChild(h('div', { class: 'teamhead b', style: { marginTop: '10px' } }, h('span', null, 'Enemy team'), h('span', null, String(r.teamScores![1]))));
      sb.appendChild(h('table', { class: 'sbt' }, head.cloneNode(true), ...other.map(row)));
    }
    left.appendChild(sb);
  }
  grid.appendChild(left);

  // right: progression
  const right = h('div', { class: 'col', style: { gap: '16px' } });
  // XP
  const xpPanel = h('div', { class: 'panel', style: { padding: '18px' } });
  const lvlBadge = h('div', { class: 'lvl' }, h('div', { class: 'badge' }, String(s.levelBefore)));
  const xpBar = h('div', { class: 'bar', style: { height: '10px', flex: '1' } }, h('i', { style: { width: `${(s.xpBefore / xpForLevel(s.levelBefore)) * 100}%`, background: 'linear-gradient(90deg,#7fd0ff,#4aa8ff)' } }));
  xpPanel.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('div', { class: 'h2' }, 'Experience'), h('div', { class: 'row', style: { color: '#7fd0ff', fontFamily: 'var(--display)', fontSize: '26px' } }, h('span', { html: ICON.xp(20) }), `+${fmt(s.xpTotal)}`)));
  xpPanel.appendChild(h('div', { class: 'row', style: { gap: '12px', marginBottom: '10px' } }, lvlBadge, xpBar));
  const lines = h('div', { class: 'lines' });
  s.xpLines.forEach((l, i) => lines.appendChild(h('div', { class: 'ln', style: { animationDelay: `${0.2 + i * 0.06}s` } }, h('span', null, l.label), h('b', { class: 'pos' }, `+${fmt(l.value)}`))));
  if (s.coins) lines.appendChild(h('div', { class: 'ln', style: { animationDelay: `${0.25 + s.xpLines.length * 0.06}s` } }, h('span', { class: 'row', style: { gap: '6px' } }, h('span', { html: ICON.coin(14) }), 'Coins'), h('b', { style: { color: 'var(--accent)' } }, `+${fmt(s.coins)}`)));
  xpPanel.appendChild(lines);
  right.appendChild(xpPanel);
  // animate xp bar through level ups
  (async () => {
    let lvl = s.levelBefore;
    await sleep(500);
    while (lvl < s.levelAfter) {
      (xpBar.firstChild as HTMLElement).style.width = '100%';
      await sleep(600);
      lvl++;
      (lvlBadge.firstChild as HTMLElement).textContent = String(lvl);
      (xpBar.firstChild as HTMLElement).style.transition = 'none';
      (xpBar.firstChild as HTMLElement).style.width = '0%';
      await sleep(30);
      (xpBar.firstChild as HTMLElement).style.transition = '';
      audio.ui('levelup', 0.7);
    }
    (xpBar.firstChild as HTMLElement).style.width = `${(s.xpAfter / xpForLevel(s.levelAfter)) * 100}%`;
  })();

  // ranked
  if (s.rp) {
    const rp = s.rp;
    const before = rankOf(rp.before);
    const after = rankOf(rp.after);
    const num = h('div', { class: 'num ' + (rp.total >= 0 ? 'pos' : 'neg') }, `${rp.total >= 0 ? '+' : ''}${rp.total} RP`);
    const emblem = h('div', { html: rankEmblem(before.tier, before.division, 76) });
    const name = h('div', { style: { fontFamily: 'var(--display)', fontSize: '24px', color: before.tierDef.color } }, before.label);
    const bar = h('div', { class: 'bar', style: { height: '10px' } }, h('i', { style: { width: `${before.progress}%`, background: before.tierDef.color } }));
    const rpText = h('div', { class: 'dim mono', style: { fontSize: '12px' } }, `${fmt(rp.before)} RP`);
    const panel = h('div', { class: 'panel', style: { padding: '18px' } },
      h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('div', { class: 'h2' }, 'Ranked'), num),
      h('div', { class: 'rpbox' }, emblem, h('div', { class: 'col grow', style: { gap: '6px' } }, name, bar, rpText)),
      h('div', { class: 'lines', style: { marginTop: '10px' } }, ...rp.lines.map((l, i) => h('div', { class: 'ln', style: { animationDelay: `${0.3 + i * 0.07}s` } }, h('span', null, l.label), h('b', { class: l.value >= 0 ? 'pos' : 'neg' }, l.label === 'Demotion shield' ? 'Protected' : `${l.value >= 0 ? '+' : ''}${l.value}`)))));
    right.appendChild(panel);
    (async () => {
      await sleep(900);
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        const v = Math.round(rp.before + ((rp.after - rp.before) * i) / steps);
        const rk = rankOf(v);
        (bar.firstChild as HTMLElement).style.width = `${Math.min(100, rk.tier === TIERS.length - 1 ? 100 : rk.progress)}%`;
        (bar.firstChild as HTMLElement).style.background = rk.tierDef.color;
        rpText.textContent = `${fmt(v)} RP`;
        if (rk.label !== name.textContent) {
          name.textContent = rk.label;
          name.style.color = rk.tierDef.color;
          emblem.innerHTML = rankEmblem(rk.tier, rk.division, 76);
        }
        await sleep(28);
      }
      if (rp.promoted) {
        audio.ui('rankup', 0.9);
        const big = h('div', { class: 'emblem-big', style: { ['--glow' as any]: after.tierDef.color }, html: rankEmblem(after.tier, after.division, 220) });
        const box = showReveal(parent, rp.tierUp ? 'Promotion' : 'Division up', after.label, [], undefined, big);
        (box.querySelector('.big') as HTMLElement).style.color = after.tierDef.color;
        if (rp.tierUp) box.insertBefore(h('div', { class: 'dim', style: { position: 'relative', marginBottom: '8px' } }, 'Demotion protection active for 3 matches. Tougher opponents await.'), box.querySelector('button'));
      } else if (rp.demoted) {
        audio.ui('rankdown', 0.8);
        const big = h('div', { class: 'emblem-big', style: { ['--glow' as any]: '#ff5a4a' }, html: rankEmblem(after.tier, after.division, 160) });
        showReveal(parent, 'Demoted', after.label, [], undefined, big);
      }
    })();
  }

  // quests
  if (s.quests.length && r.mode !== 'tutorial') {
    const qp = h('div', { class: 'panel', style: { padding: '18px' } }, h('div', { class: 'h2', style: { marginBottom: '8px' } }, 'Daily quests'));
    for (const q of s.quests) {
      qp.appendChild(h('div', { class: 'quest' + (q.done ? ' done' : '') }, h('div', { class: 'q' }, q.text, q.justDone ? h('span', { class: 'chip accent', style: { marginLeft: '8px' } }, 'Complete') : null), h('div', { class: 'rw' }, `${fmt(q.progress)}/${fmt(q.target)}`), h('div', { class: 'bar' }, h('i', { style: { width: `${(q.progress / q.target) * 100}%` } }))));
    }
    if (s.quests.some((q) => q.justDone)) {
      qp.appendChild(h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '6px' } }, 'Claim completed quests from the Play screen.'));
      audio.ui('quest', 0.7);
    }
    right.appendChild(qp);
  }
  if (s.eventLines.length) {
    const ep = h('div', { class: 'panel', style: { padding: '18px' } }, h('div', { class: 'h2', style: { marginBottom: '8px' } }, 'Event challenges'));
    for (const e of s.eventLines) ep.appendChild(h('div', { class: 'quest' + (e.progress >= e.target ? ' done' : '') }, h('div', { class: 'q' }, e.text, e.justDone ? h('span', { class: 'chip accent', style: { marginLeft: '8px' } }, 'Complete') : null), h('div', { class: 'rw' }, `${fmt(e.progress)}/${fmt(e.target)}`), h('div', { class: 'bar' }, h('i', { style: { width: `${(e.progress / e.target) * 100}%` } }))));
    right.appendChild(ep);
  }
  if (s.achievements.length) {
    const ap = h('div', { class: 'panel', style: { padding: '18px' } }, h('div', { class: 'h2', style: { marginBottom: '8px' } }, 'Achievements unlocked'));
    for (const a of s.achievements) ap.appendChild(h('div', { class: 'row', style: { gap: '10px', padding: '6px 0' } }, h('span', { html: ICON.trophy(20), style: { color: 'var(--accent)' } }), h('div', { class: 'col', style: { gap: '2px' } }, h('b', null, a.name), h('span', { class: 'dim', style: { fontSize: '12px' } }, a.desc))));
    right.appendChild(ap);
  }
  if (s.teaser) {
    const t = s.teaser;
    right.appendChild(h('div', { class: 'event-card panel' }, h('div', { class: 'eb', style: { background: t.def.gradient } }),
      h('span', { class: 'chip' }, 'Starts tomorrow'),
      h('div', { class: 'ename', style: { color: t.def.accent, marginTop: '6px' } }, t.def.name),
      h('div', { style: { fontSize: '13px' } }, t.def.tagline),
      h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, `Begins ${new Date(t.start).toLocaleDateString(undefined, { weekday: 'long' })} 00:00 · ${t.def.challenges.length} challenges with exclusive cosmetics`)));
  }
  grid.appendChild(right);

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
