// Full BR loop: lobby -> drop -> fast simulate until end -> results + profile update.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  const before = await h.eval(() => { const p = window.__bf.meta.p; return { xp: p.xp, level: p.level, coins: p.coins, rp: p.rank.rp, matches: p.stats?.matches }; });
  console.log('profile before', JSON.stringify(before));
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: true, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(1200);
  await h.shot('brf_lobby');
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  await h.eval(() => { window.__noRender = true; window.__pause = true; window.__kills = []; const m = window.__bf.match; m.events.on('kill', (e) => window.__kills.push({ t: +m.time.toFixed(0), cause: e.cause, w: e.weapon, d: +e.distance.toFixed(0), k: e.killer?.name ?? null, v: e.victim.name })); });
  // ride ship briefly then drop
  await h.eval(() => window.__bf.simulate(6));
  await h.eval(() => { const m = window.__bf.match; m.jumpFromShip(m.player); });
  const t0 = Date.now();
  await h.eval(() => window.__bf.simulate(25));
  console.log('drop sim ms', Date.now() - t0);
  let st = await h.eval(() => { const m = window.__bf.match; const p = m.player; return { pos: p.body.pos.toArray().map(v=>+v.toFixed(1)), dropping: p.dropping, gliding: p.gliding, alive: m.aliveCount, inShip: m.inShip.size, t: +m.time.toFixed(1) }; });
  console.log('after drop', JSON.stringify(st));
  await h.eval(() => { window.__noRender = false; });
  await h.shot('brf_landed');
  await h.eval(() => { window.__noRender = true; window.__pause = true; });
  // make the player invulnerable-ish observer: keep player alive by teleporting high? no — just let it play out.
  for (let i = 0; i < 80; i++) {
    const t1 = Date.now();
    await h.eval(() => window.__bf.simulate(10));
    const ms = Date.now() - t1;
    st = await h.eval(() => {
      const m = window.__bf.match; if (!m) return { gone: true, state: window.__bf.state };
      const brains = m.brains ?? [];
      const states = {}; for (const b of brains) if (b.c.alive) states[b.state] = (states[b.state] || 0) + 1;
      return { t: +m.time.toFixed(0), alive: m.aliveCount, kills: m.combatants.reduce((a,c)=>a+c.stats.kills,0), zone: m.zone.phase, r: +m.zone.radius.toFixed(0), status: m.statusText, php: m.player.hp, palive: m.player.alive, states, ended: m.ended, perf: { sim: +window.__bf.perf.sim.toFixed(2) } };
    });
    console.log(ms + 'ms', JSON.stringify(st));
    if (st.gone || st.ended || st.alive <= 1) break;
    if (i === 6) { await h.eval(() => { window.__noRender = false; }); await h.shot('brf_mid'); await h.eval(() => { window.__noRender = true; window.__pause = true; }); }
  }
  console.log('kills', JSON.stringify(await h.eval(() => window.__kills)));
  await h.eval(() => { window.__noRender = false; window.__pause = false; });
  await h.waitFor(() => window.__bf.state === 'results', 60000);
  await h.run(2500);
  await h.shot('brf_results');
  const after = await h.eval(() => { const p = window.__bf.meta.p; return { xp: p.xp, level: p.level, coins: p.coins, rp: p.rank.rp, matches: p.stats?.matches, hist: (p.history||[]).slice(0,1) }; });
  console.log('profile after', JSON.stringify(after));
  const stored = await h.eval(() => Object.keys(localStorage));
  console.log('ls keys', JSON.stringify(stored));
}
