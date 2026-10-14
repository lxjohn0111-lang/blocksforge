// Focused build check on the training map: ramp + block up onto the ledge.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  const r = await h.eval(() => {
    window.__noRender = true; window.__pause = true;
    const bf = window.__bf; const m = bf.match; const p = m.player; const I = bf.input; I.locked = true;
    const press = (c) => { if (!I.down.has(c)) I.pressed.add(c); I.down.add(c); };
    const release = (c) => { I.down.delete(c); I.released.add(c); };
    const tap = (c) => { press(c); bf.simulate(0.05); release(c); bf.simulate(0.05); };
    const aimAt = (x, y, z) => { const e = p.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
    const walkTo = (x, z, tol, max) => { let t = 0; press('KeyW'); while (t < max) { const dx = x - p.body.pos.x, dz = z - p.body.pos.z; if (Math.hypot(dx, dz) < tol) break; p.yaw = Math.atan2(-dx, -dz); p.pitch = 0; bf.simulate(0.1); t += 0.1; } release('KeyW'); bf.simulate(0.2); };
    const log = [];
    const L = (k) => log.push(k + ' ' + JSON.stringify({ pos: p.body.pos.toArray().map((v) => +v.toFixed(2)), slot: p.slot, wood: p.mats.wood, piece: bf.pc.buildPiece, reason: bf.pc.buildReason }));
    p.body.pos.set(30.5, 11, 57.5); p.addMat('wood', 60); bf.simulate(0.3);
    walkTo(42.5, 57.5, 0.3, 30); L('at start');
    tap('KeyQ'); bf.simulate(0.3); tap('Digit3'); bf.simulate(0.2); L('build ramp sel');
    aimAt(44.5, 10.95, 57.5); bf.simulate(0.05);
    const pl = m.build.compute(p, 'ramp', bf.pc.buildRot, 'wood'); log.push('ramp plan ' + JSON.stringify({ valid: pl.valid, reason: pl.reason, blocks: pl.blocks }));
    tap('Mouse0'); bf.simulate(0.4); L('after ramp');
    walkTo(46.5, 57.5, 0.3, 8); L('on ramp');
    tap('Digit4'); bf.simulate(0.2);
    aimAt(48.02, 14.5, 57.5); bf.simulate(0.05);
    const pl2 = m.build.compute(p, 'block', bf.pc.buildRot, 'wood'); log.push('block plan ' + JSON.stringify({ valid: pl2.valid, reason: pl2.reason, blocks: pl2.blocks }));
    tap('Mouse0'); bf.simulate(0.4); L('after block');
    walkTo(50.5, 57.5, 0.4, 8); L('end');
    return log;
  });
  for (const l of r) console.log(l);
  await h.eval(() => { window.__noRender = false; });
  await h.shot('build_check');
}
