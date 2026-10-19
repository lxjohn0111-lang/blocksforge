// First visit: the Basics tutorial starts by itself and is played through the real input layer.
// Run with BF_FIRST_RUN=1 (otherwise the driver opts out of Basics):
//   BF_FIRST_RUN=1 node tests/drive.mjs tests/scenarios/basics.mjs 1280 720
export default async function (page, h) {
  const t0 = Date.now();
  const started = await h.waitFor(() => window.__bf && window.__bf.state === 'match' && window.__bf.match.quick, 240000);
  console.log('basics started on first visit', started);
  await h.eval(() => {
    window.__noRender = true;
    window.__pause = true;
    const bf = window.__bf;
    const I = () => bf.input;
    const P = () => bf.match.player;
    const T = (window.__t = {
      press(code) { I().locked = true; if (!I().down.has(code)) I().pressed.add(code); I().down.add(code); },
      release(code) { I().down.delete(code); I().released.add(code); },
      tap(code, hold = 0.05) { T.press(code); bf.simulate(hold); T.release(code); bf.simulate(0.05); },
      aimAt(x, y, z) { const p = P(); const e = p.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); },
      walkTo(x, z, tol = 1, max = 20, keys = []) {
        let t = 0;
        T.press('KeyW');
        for (const k of keys) T.press(k);
        while (t < max) { const p = P(); const dx = x - p.body.pos.x, dz = z - p.body.pos.z; if (Math.hypot(dx, dz) < tol) break; p.yaw = Math.atan2(-dx, -dz); p.pitch = 0; bf.simulate(0.1); t += 0.1; }
        T.release('KeyW');
        for (const k of keys) T.release(k);
        bf.simulate(0.2);
        return t;
      },
      st() { return bf.match.map.stations; },
    });
  });
  const step = () => h.eval(() => ({ id: window.__bf.match.step.id, done: window.__bf.match.doneCount, card: document.querySelector('.qt .qt-title')?.textContent, marker: document.querySelector('.qtmark')?.style.display }));
  const view = async (name) => {
    // a second of play with the HUD ticking every frame (finished-step ticks clear, the next card shows)
    await h.eval(() => { const bf = window.__bf; for (let i = 0; i < 30; i++) { bf.simulate(1 / 30); bf.hud?.update(1 / 30); } window.__noRender = false; });
    await h.shot(name);
    await h.eval(() => { window.__noRender = true; window.__pause = true; });
  };
  await view('basics_1_move');
  console.log('1', JSON.stringify(await step()));
  await h.eval(() => { const s = __t.st().move; __t.walkTo(s.x, s.z, 1.2); });
  console.log('after move', JSON.stringify(await step()));
  await view('basics_2_jump');
  await h.eval(() => { const s = __t.st().jump; __t.walkTo(s.x, s.z, 1.2, 12, ['Space']); });
  console.log('after jump', JSON.stringify(await step()));
  await view('basics_3_loot');
  await h.eval(() => { const s = __t.st().weapon; __t.walkTo(s.x, s.z + 1.6, 0.6); __t.aimAt(s.x, s.y + 0.2, s.z); __t.tap('KeyE'); window.__bf.simulate(0.5); });
  console.log('after loot', JSON.stringify(await step()));
  await view('basics_4_shoot');
  const shot = await h.eval(() => {
    const bf = window.__bf; const m = bf.match;
    const s = __t.st().range; __t.walkTo(s.x, s.z, 0.8);
    const d = m.dummies.find((x) => x.key === 'dummy1');
    let t = 0;
    while (t < 12 && m.step.id === 'shoot') { const q = d.c.body.pos; __t.aimAt(q.x, q.y + 1.2, q.z); __t.press('Mouse0'); bf.simulate(0.25); t += 0.25; }
    __t.release('Mouse0'); bf.simulate(0.3);
    return t;
  });
  console.log('after shoot', shot, JSON.stringify(await step()));
  await view('basics_5_build');
  await h.eval(() => { const p = window.__bf.match.player; p.pitch = -0.3; __t.tap('KeyQ'); window.__bf.simulate(0.3); __t.tap('Mouse0'); window.__bf.simulate(0.4); });
  console.log('after build', JSON.stringify(await step()));
  await h.eval(() => window.__bf.simulate(2.5));
  await h.eval(() => { window.__noRender = false; window.__pause = false; });
  await page.waitForTimeout(3000);
  console.log('end state', JSON.stringify(await h.eval(() => { const bf = window.__bf; const m = bf.match; return { state: bf.state, ended: m?.ended, time: m?.time, done: m?.completedAt, overlay: bf.hud?.overlay, locked: bf.input.locked }; })));
  const ready = await h.waitFor(() => window.__bf.state === 'results' && !!document.querySelector('.ready-card'), 30000);
  console.log('ready card', ready, JSON.stringify(await h.eval(() => ({ coins: window.__bf.meta.p.coins, done: window.__bf.meta.basicsDone, text: document.querySelector('.ready-card')?.innerText.replace(/\s+/g, ' ') }))));
  await h.shot('basics_6_ready');
  await h.eval(() => [...document.querySelectorAll('.ready-card button')].find((b) => /menu/i.test(b.textContent))?.click());
  console.log('menu after ready', await h.waitFor(() => window.__bf.state === 'menu', 30000));
  await page.reload();
  await h.waitFor(() => window.__bf && (window.__bf.state === 'menu' || window.__bf.state === 'lobby' || window.__bf.state === 'match'), 240000);
  await page.waitForTimeout(1500);
  console.log('after reload state', await h.eval(() => window.__bf.state), 'basicsDone', await h.eval(() => window.__bf.meta.basicsDone));
  console.log('total seconds', Math.round((Date.now() - t0) / 1000));
}
