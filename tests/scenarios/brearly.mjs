// Early-game BR analysis: landing clusters, bot accuracy, armed/unarmed victims.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(400);
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  const out = await h.eval(() => {
    window.__noRender = true; window.__pause = true;
    const bf = window.__bf; const m = bf.match; const p = m.player; p.hp = 1e9;
    const kills = [];
    m.events.on('kill', (e) => kills.push({ t: Math.round(m.time), w: e.weapon, d: Math.round(e.distance), vArmed: e.victim.weapons.some(Boolean), vHp: 0, kSkill: m.brains.find((b) => b.c === e.killer)?.skill?.toFixed(2) }));
    bf.simulate(36);
    const land = m.brains.map((b) => [Math.round(b.c.body.pos.x), Math.round(b.c.body.pos.z)]);
    const targets = m.map.dropTargets.map((t) => ({ t: [t.x, t.z], n: land.filter(([x, z]) => Math.hypot(x - t.x, z - t.z) < 40).length }));
    bf.simulate(44);
    const bots = m.brains.map((b) => b.c);
    const shots = bots.reduce((a, c) => a + c.stats.shots, 0), hits = bots.reduce((a, c) => a + c.stats.hits, 0);
    const skills = m.brains.map((b) => +b.skill.toFixed(2));
    const at80 = m.aliveCount;
    bf.simulate(45);
    return { alive: at80, alive125: m.aliveCount, targets, acc: +(hits / Math.max(1, shots)).toFixed(3), shots, hits, skills, kills };
  });
  console.log(JSON.stringify(out));
}
