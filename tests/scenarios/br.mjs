export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.shot('br_menu');
  await h.eval(() => window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }));
  await h.run(1500);
  await h.shot('br_lobby');
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  console.log('match started');
  await h.run(2000);
  await h.shot('br_ship');
  // let the ship fly a bit then jump
  await h.eval(() => { window.__timeScale = 10; });
  await h.waitFor(() => window.__bf.match.ship.t > 0.3);
  await h.eval(() => { const m = window.__bf.match; m.jumpFromShip(m.player); });
  await h.waitFor(() => { const p = window.__bf.match.player; return !p.dropping && !p.gliding; });
  await h.eval(() => { window.__timeScale = 1; });
  const st = await h.eval(() => { const m = window.__bf.match; const p = m.player; return { pos: p.body.pos.toArray().map(v=>+v.toFixed(1)), alive: m.alive.length, items: m.items.length, t: +m.time.toFixed(1) }; });
  console.log('landed', JSON.stringify(st));
  await h.shot('br_landed');
  // fast-forward to watch bots
  await h.eval(() => { window.__timeScale = 20; });
  await h.run(20000);
  const st2 = await h.eval(() => { const m = window.__bf.match; return { alive: m.alive.length, t: +m.time.toFixed(1), kills: m.combatants.reduce((a,c)=>a+c.stats.kills,0), zone: m.zone.phase, states: window.__bf.match.brains.map(b=>b.state).join(',') }; });
  console.log('after ff', JSON.stringify(st2));
  await h.eval(() => { window.__timeScale = 1; });
  await h.shot('br_mid');
}
