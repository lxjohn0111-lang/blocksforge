// Trace bot rotation vs the storm to diagnose storm deaths.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(400);
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  await h.eval(() => { window.__noRender = true; window.__pause = true; const bf = window.__bf; bf.simulate(5); const p = bf.match.player; p.hp = 1e9; bf.simulate(30); });
  for (let i = 0; i < 30; i++) {
    const st = await h.eval(() => {
      const bf = window.__bf; const m = bf.match; bf.simulate(15);
      const z = m.zone; const w = m.world;
      const bots = m.brains.filter((b) => b.c.alive).map((b) => {
        const c = b.c; const out = Math.hypot(c.body.pos.x - z.center.x, c.body.pos.z - z.center.y) - z.radius;
        return { n: c.name.slice(0, 8), s: b.state, p: [Math.round(c.body.pos.x), Math.round(c.body.pos.y), Math.round(c.body.pos.z)], out: Math.round(out), hp: Math.round(c.hp), goal: b.goal ? [Math.round(b.goal.x), Math.round(b.goal.y), Math.round(b.goal.z)] : null, path: b.path.length - b.pathI, pend: b.pathPending, hf: b.hopFails, sc: b.stuckCount, water: c.body.inWater };
      });
      return { t: Math.round(m.time), zone: [Math.round(z.center.x), Math.round(z.center.y), Math.round(z.radius)], next: [Math.round(z.to.x), Math.round(z.to.y), Math.round(z.toR)], nextH: w.height(Math.round(z.to.x), Math.round(z.to.y)), sea: w.seaLevel, alive: m.aliveCount, outside: bots.filter((b) => b.out > 0) };
    });
    console.log(JSON.stringify(st));
    if (st.alive <= 2) break;
  }
}
