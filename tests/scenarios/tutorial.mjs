// Plays the tutorial through the real input layer (keys/mouse injected into Input).
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  console.log('tutorial match started');
  await h.eval(() => {
    window.__noRender = true; window.__pause = true;
    const bf = window.__bf;
    const I = () => bf.input;
    const P = () => bf.match.player;
    const T = window.__t = {
      press(code) { I().locked = true; if (!I().down.has(code)) I().pressed.add(code); I().down.add(code); },
      release(code) { I().down.delete(code); I().released.add(code); },
      sim(s) { return bf.simulate(s); },
      tap(code, hold = 0.05) { T.press(code); bf.simulate(hold); T.release(code); bf.simulate(0.05); },
      aimAt(x, y, z) { const p = P(); const e = p.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); },
      walkTo(x, z, tol = 1, max = 20, keys = []) {
        let t = 0; T.press('KeyW'); for (const k of keys) T.press(k);
        while (t < max) { const p = P(); const dx = x - p.body.pos.x, dz = z - p.body.pos.z; if (Math.hypot(dx, dz) < tol) break; p.yaw = Math.atan2(-dx, -dz); p.pitch = 0; bf.simulate(0.1); t += 0.1; }
        T.release('KeyW'); for (const k of keys) T.release(k); bf.simulate(0.2);
        return t;
      },
      step() { const m = bf.match; return m.step.id; },
      st() { return bf.match.map.stations; },
      killDummy(key, ads = true, max = 15) {
        const m = bf.match; const d = m.dummies.find((x) => x.key === key); let t = 0;
        if (ads) { T.press('Mouse2'); bf.simulate(0.45); }
        while (t < max && d.c.alive) {
          const q = d.c.body.pos; T.aimAt(q.x, q.y + 1.2, q.z); T.press('Mouse0'); bf.simulate(0.2); T.release('Mouse0');
          const q2 = d.c.body.pos; T.aimAt(q2.x, q2.y + 1.2, q2.z); bf.simulate(0.2); t += 0.4;
          const g = P().gun; if (g && g.mag === 0 && g.reloading <= 0) { T.tap('KeyR'); bf.simulate(2.8); if (ads) { T.press('Mouse2'); bf.simulate(0.45); } }
        }
        T.release('Mouse0'); if (ads) T.release('Mouse2'); bf.simulate(0.1);
        return { alive: d.c.alive, t: +t.toFixed(1), mag: P().gun?.mag, reserve: P().gun ? P().ammo[P().gun.def.ammo] : 0 };
      },
    };
  });
  const log = async (label) => console.log(label, JSON.stringify(await h.eval(() => { const m = window.__bf.match; const p = m.player; return { step: m.step.id, idx: m.index, pos: p.body.pos.toArray().map((v) => +v.toFixed(1)), hp: p.hp, slot: p.slot, gun: p.gun?.def.id, mag: p.gun?.mag, wood: p.mats.wood, alive: p.alive }; })));
  const view = async (name) => { await h.eval(() => { window.__noRender = false; }); await h.shot(name); await h.eval(() => { window.__noRender = true; window.__pause = true; }); };
  await view('tut_start');
  // look
  await h.eval(() => { for (let i = 0; i < 10; i++) { window.__bf.input.locked = true; window.__bf.input.mouseDX += 120; window.__bf.simulate(0.1); } });
  await log('after look');
  // move
  await h.eval(() => { const s = __t.st().move; __t.walkTo(s.x, s.z, 1.2); __t.sim(0.6); });
  await log('after move');
  // jump wall
  await h.eval(() => { const s = __t.st().jump; __t.walkTo(s.x, s.z, 1.2, 12, ['Space', 'ShiftLeft']); __t.sim(0.6); });
  await log('after jump');
  // loot rifle
  await h.eval(() => {
    const s = __t.st().weapon; __t.walkTo(s.x, s.z + 1.6, 0.6); __t.aimAt(s.x, s.y + 0.2, s.z); __t.tap('KeyE'); __t.sim(0.3);
    const ammo = window.__bf.match.items.find((it) => it.spec.kind === 'ammo'); if (ammo) { __t.aimAt(ammo.pos.x, ammo.pos.y + 0.1, ammo.pos.z); __t.tap('KeyE'); }
    __t.sim(0.8);
  });
  await log('after loot');
  await view('tut_loot');
  // shoot two dummies from the range
  await h.eval(() => { const s = __t.st().range; __t.walkTo(s.x, s.z, 0.8); __t.sim(0.5); });
  console.log('dummy1', JSON.stringify(await h.eval(() => __t.killDummy('dummy1'))));
  console.log('dummy2', JSON.stringify(await h.eval(() => __t.killDummy('dummy2'))));
  await h.eval(() => __t.sim(0.8));
  await log('after shoot');
  // reload
  await h.eval(() => { __t.aimAt(35.5, 12, 40); __t.press('Mouse0'); __t.sim(0.3); __t.release('Mouse0'); __t.tap('KeyR'); __t.sim(3); });
  await log('after reload');
  // ads
  console.log('dummy3', JSON.stringify(await h.eval(() => __t.killDummy('dummy3', true, 6))));
  await h.eval(() => __t.sim(0.6));
  await log('after ads');
  await view('tut_ads');
  // chest
  await h.eval(() => { const s = __t.st().chest; __t.walkTo(s.x - 1, s.z + 1.0, 0.5); __t.aimAt(41.5, 11.5, 74.5); __t.tap('KeyE'); __t.sim(2.5); });
  await log('after chest');
  // pick up everything around (longshot + ammo)
  await h.eval(() => {
    const m = window.__bf.match; const p = m.player;
    for (let k = 0; k < 2; k++) for (const it of [...m.items]) { if (it.spec.kind === 'weapon' && it.spec.weapon !== 'longshot') continue; if (it.pos.distanceTo(p.body.pos) > 12) continue; __t.walkTo(it.pos.x, it.pos.z, 1.0, 6); __t.aimAt(it.pos.x, it.pos.y, it.pos.z); __t.tap('KeyE'); }
    __t.sim(0.5);
    const i = p.weapons.findIndex((w) => w?.def.id === 'longshot'); if (i >= 0) __t.tap('Digit' + (i + 1)); __t.sim(1.2);
  });
  await log('after pickups');
  await h.eval(() => { const s = __t.st().range; __t.walkTo(s.x, s.z, 0.8); });
  console.log('far1', JSON.stringify(await h.eval(() => __t.killDummy('far1', true, 10))));
  await view('tut_scope');
  await h.eval(() => { __t.release('Mouse2'); __t.sim(0.5); });
  await log('after scope');
  // harvest
  await h.eval(() => {
    const s = __t.st().harvest; __t.tap('KeyF'); __t.sim(0.5);
    const trees = [[12, 66], [18, 64], [12, 76], [22, 78]];
    const p = window.__bf.match.player;
    for (const [x, z] of trees) {
      if (p.mats.wood >= 30) break;
      __t.walkTo(x + 0.5, z + 2.2, 0.4, 15);
      for (let k = 0; k < 60 && p.mats.wood < 30; k++) { __t.aimAt(x + 0.5, 12.2 + (k % 3) * 0.6, z + 0.5); __t.press('Mouse0'); __t.sim(0.1); }
      __t.release('Mouse0');
    }
    __t.sim(0.6);
  });
  await log('after harvest');
  // build: one ramp + one block up onto the ledge west of the pit
  await h.eval(() => {
    __t.walkTo(28, 54, 0.8, 20); __t.walkTo(42.5, 57.5, 0.3, 30); __t.sim(0.3);
    __t.tap('KeyQ'); __t.sim(0.3); __t.tap('Digit3'); __t.sim(0.2);
    __t.aimAt(44.5, 10.95, 57.5); __t.tap('Mouse0'); __t.sim(0.4);
    __t.walkTo(46.5, 57.5, 0.3, 8); __t.sim(0.3);
    __t.tap('Digit4'); __t.sim(0.2);
    __t.aimAt(48.02, 14.5, 57.5); __t.tap('Mouse0'); __t.sim(0.4);
    __t.walkTo(50.5, 57.5, 0.4, 8); __t.sim(0.8);
    __t.tap('KeyQ'); __t.sim(0.6); // back to weapons
  });
  await log('after build');
  await view('tut_build');
  // craft via the inventory UI (Tab goes through the app's key handler)
  await h.eval(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab' })); __t.sim(0.2); });
  const btns = await h.eval(() => [...document.querySelectorAll('#ui .recipe')].map((e) => e.textContent.slice(0, 30)));
  console.log('recipes', JSON.stringify(btns));
  await view('tut_inventory');
  await h.eval(() => { const el = [...document.querySelectorAll('#ui .recipe')].find((e) => /bandage/i.test(e.textContent)); if (el) el.click(); __t.sim(0.4); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab' })); __t.sim(0.3); });
  await log('after craft');
  // grenade over the wall
  await h.eval(() => {
    const s = __t.st().nade;
    __t.walkTo(40, 52, 0.8, 12); __t.walkTo(s.x, s.z, 0.6, 30); __t.sim(0.3);
    for (let k = 0; k < 4 && window.__bf.match.step.id === 'grenade'; k++) {
      const d = __t.st().nadeDummy; __t.aimAt(d.x, d.y + 6 + k, d.z);
      __t.press('KeyG'); __t.sim(0.5); __t.release('KeyG'); __t.sim(3.5);
    }
  });
  await log('after grenade');
  await view('tut_grenade');
  // duel
  await h.eval(() => {
    const s = __t.st().arena; __t.walkTo(35.5, 36, 0.8, 25); __t.walkTo(s.x, s.z, 1, 25); __t.tap('Digit1'); __t.sim(0.6);
    const m = window.__bf.match;
    let t = 0;
    while (t < 40 && m.step.id === 'duel') {
      const b = m.duelBot?.c; if (!b || !b.alive) { __t.sim(0.5); t += 0.5; continue; }
      __t.press('Mouse2');
      const q = b.body.pos; __t.aimAt(q.x, q.y + 1.2, q.z); __t.press('Mouse0'); __t.sim(0.2); __t.release('Mouse0');
      const q2 = b.body.pos; __t.aimAt(q2.x, q2.y + 1.2, q2.z); __t.sim(0.15); t += 0.35;
      if (m.player.hp < 45 && m.player.heals.bandage + m.player.heals.plate > 0) { __t.release('Mouse2'); __t.tap('KeyH'); __t.sim(2.5); t += 2.5; }
      const g = m.player.gun; if (g && g.mag === 0 && g.reloading <= 0) { __t.tap('KeyR'); __t.sim(2.6); t += 2.6; }
    }
    __t.release('Mouse0'); __t.release('Mouse2'); __t.sim(1);
  });
  await log('after duel');
  await h.eval(() => { window.__noRender = false; window.__pause = false; });
  await h.waitFor(() => window.__bf.state === 'results', 60000).catch((e) => console.log('no results', e.message));
  await h.run(2000);
  await h.shot('tut_results');
  console.log('tutorialDone', await h.eval(() => window.__bf.meta.p.tutorialDone));
}
