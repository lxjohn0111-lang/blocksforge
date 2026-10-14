// TDM loop: lobby -> match -> fast simulate -> respawns/scoring -> results.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  const before = await h.eval(() => { const p = window.__bf.meta.p; return { xp: p.xp, level: p.level, coins: p.coins, rp: p.rank.rp, matches: p.stats.matches }; });
  console.log('profile before', JSON.stringify(before));
  const map = process.env.TDM_MAP || 'hamlet';
  await h.eval((map) => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tdm', ranked: true, tdmMap: map, loadout: 'assault' }); }, map);
  await h.run(1200);
  await h.shot('tdm_lobby_' + map);
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  await h.eval(() => { window.__noRender = true; window.__pause = true; });
  await h.eval(() => window.__bf.simulate(4));
  await h.eval(() => { window.__noRender = false; });
  await h.shot('tdm_start_' + map);
  await h.eval(() => { window.__noRender = true; window.__pause = true; });
  let deaths = 0;
  for (let i = 0; i < 60; i++) {
    const t1 = Date.now();
    await h.eval(() => window.__bf.simulate(10));
    const ms = Date.now() - t1;
    const st = await h.eval(() => {
      const m = window.__bf.match; if (!m) return { gone: true, state: window.__bf.state };
      const states = {}; for (const b of m.brains) if (b.c.alive) states[b.state] = (states[b.state] || 0) + 1;
      const t = [0, 1].map((tm) => m.combatants.filter((c) => c.team === tm).length);
      return { t: +m.time.toFixed(0), scores: m.scores, teams: t, alive: m.combatants.filter(c=>c.alive).length, pk: m.player.stats.kills, pd: m.player.stats.deaths, palive: m.player.alive, states, status: m.statusText, ended: m.ended, sim: +window.__bf.perf.sim.toFixed(2) };
    });
    console.log(ms + 'ms', JSON.stringify(st));
    if (st.gone || st.ended) break;
    if (i === 3) { await h.eval(() => { window.__noRender = false; }); await h.shot('tdm_mid_' + map); await h.eval(() => { window.__noRender = true; window.__pause = true; }); }
    if (!st.palive && deaths++ === 0) { await h.eval(() => { window.__noRender = false; }); await h.shot('tdm_dead_' + map); await h.eval(() => { window.__noRender = true; window.__pause = true; }); }
  }
  await h.eval(() => { window.__noRender = false; window.__pause = false; });
  await h.waitFor(() => window.__bf.state === 'results', 60000);
  await h.run(2500);
  await h.shot('tdm_results_' + map);
  const after = await h.eval(() => { const p = window.__bf.meta.p; return { xp: p.xp, level: p.level, coins: p.coins, rp: p.rank.rp, matches: p.stats.matches, hist: p.history.slice(0, 1) }; });
  console.log('profile after', JSON.stringify(after));
}
