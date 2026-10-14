export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }));
  await h.waitFor(() => window.__bf.state === 'match');
  await h.eval(() => { window.__timeScale = 10; });
  await h.waitFor(() => window.__bf.match.ship.t > 0.3);
  await h.eval(() => { const m = window.__bf.match; m.jumpFromShip(m.player); });
  for (let i = 0; i < 12; i++) {
    await h.run(4000);
    const st = await h.eval(() => { const m = window.__bf.match; const p = m.player; return { t: +m.time.toFixed(1), pos: p.body.pos.toArray().map(v=>+v.toFixed(1)), vel: p.body.vel.toArray().map(v=>+v.toFixed(1)), dropping: p.dropping, gliding: p.gliding, onGround: p.body.onGround, inShip: m.inShip.has(p), pcShip: window.__bf.pc.inShip, alive: p.alive, hp: p.hp, ground: m.world.groundY(p.body.pos.x, p.body.pos.z) }; });
    console.log(JSON.stringify(st));
  }
}
