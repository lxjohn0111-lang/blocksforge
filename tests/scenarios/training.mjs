// The whole Training Grounds played through with real key and mouse input (aim is set the way the mouse
// would set it; long walks between stations are shortened by moving the player there).
export default async function (page, h) {
  const ok = (c, m) => console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }));
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  await h.eval(() => {
    window.__pause = true; window.__noRender = true;
    const bf = window.__bf;
    bf.input.locked = true; // as after "Click to play"
    window.__aim = (x, y, z) => { const p = bf.match.player; const e = p.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
    window.__done = (id) => { const m = bf.match; return m.done[m.steps.findIndex((s) => s.id === id)]; };
    window.__st = () => bf.match.map.stations;
  });
  const frames = (n) => h.eval((n) => { for (let i = 0; i < n; i++) window.__bf.frame(1 / 30); }, n);
  /** run frames until cond (evaluated in the page) holds; each round runs `each` first (re-aim etc.) */
  const until = async (cond, max, each = null) => {
    for (let i = 0; i < max; i++) {
      if (await h.eval(cond)) return true;
      if (each) await h.eval(each);
      await frames(3);
    }
    return await h.eval(cond);
  };
  const press = async (k) => { await page.keyboard.press(k); await frames(2); };
  const state = () => h.eval(() => { const m = window.__bf.match, p = m.player; return { step: m.step.id, pos: p.body.pos.toArray().map((v) => +v.toFixed(1)), gun: p.gun?.def.id, mag: p.gun?.mag, ammo: p.ammo, mats: p.mats, done: m.doneCount }; });

  // 1 look
  ok(await until(() => window.__done('look'), 40, () => { window.__bf.match.player.yaw += 0.15; }), 'look around');
  await h.eval(() => { window.__bf.match.player.yaw = 0; window.__bf.match.player.pitch = 0; });
  // 2 move + 3 jump: hold W (and Space at the wall)
  await page.keyboard.down('KeyW');
  ok(await until(() => window.__done('move'), 80), 'walk to the marker (W)');
  await page.keyboard.down('Space');
  ok(await until(() => window.__done('jump'), 120, () => { window.__bf.match.player.yaw = 0; }), 'jump the wall (W + Space)');
  await page.keyboard.up('Space');
  // 4 loot: walk to the table, look at the rifle, E
  ok(await until(() => window.__bf.match.player.body.pos.z < 80.6, 80, () => { window.__bf.match.player.yaw = 0; }), 'reach the weapon table');
  await page.keyboard.up('KeyW');
  await h.eval(() => { const it = window.__bf.match.items.find((i) => !i.taken && i.spec.weapon === 'ranger'); window.__aim(it.pos.x, it.pos.y + 0.2, it.pos.z); });
  await frames(2);
  await press('KeyE');
  ok(await until(() => window.__done('loot'), 10), `grab the rifle (E): ${JSON.stringify(await state())}`);
  // 5 shoot: aim at dummy 1, hold the left button
  await h.eval(() => window.__bf.match.player.body.pos.set(35.5, window.__st().range.y, 73.5));
  const aimDummy = (key, up = 1.3) => `(() => { const d = window.__bf.match.dummies.find((x) => x.key === '${key}'); if (d && d.c.alive) window.__aim(d.c.body.pos.x, d.c.body.pos.y + ${up}, d.c.body.pos.z); })()`;
  await page.mouse.down({ button: 'left' });
  ok(await until(() => window.__done('shoot'), 200, aimDummy('dummy1')), `down a target dummy (LMB): ${JSON.stringify(await state())}`);
  await page.mouse.up({ button: 'left' });
  await frames(10);
  // 6 reload: R
  const before = await state();
  await press('KeyR');
  ok(await until(() => window.__done('reload'), 60), `reload (R): mag ${before.mag}, spare ${before.ammo.medium}`);
  // 7 ads: hold the right button on the dummy on the wall, then fire
  await frames(60);
  await h.eval(aimDummy('dummy3', 1.2));
  await page.mouse.down({ button: 'right' });
  await frames(20);
  let hit = false;
  for (let i = 0; i < 30 && !hit; i++) {
    await h.eval(aimDummy('dummy3', 1.2));
    await page.mouse.down({ button: 'left' }); await frames(2); await page.mouse.up({ button: 'left' }); await frames(6);
    hit = await h.eval(() => window.__done('ads'));
  }
  await page.mouse.up({ button: 'right' });
  ok(hit, 'aim down sights and hit the wall dummy (RMB + LMB)');
  // 8 chest: face it up close, E
  await h.eval(() => { const ch = window.__bf.match.map.chests[0]; const p = window.__bf.match.player; p.body.pos.set(ch.x + 0.5, ch.y, ch.z + 2.6); p.yaw = 0; p.pitch = 0; });
  await frames(3);
  await press('KeyE');
  ok(await until(() => window.__done('chest'), 10), 'open the supply chest (E)');
  // 9 scope: the Longshot is in hand; hold RMB on a far dummy, fire
  await frames(30);
  const sc = await state();
  await h.eval(() => window.__bf.match.player.body.pos.set(35.5, window.__st().range.y, 73.5));
  await h.eval(aimDummy('far1', 1.2));
  await page.mouse.down({ button: 'right' });
  await frames(40);
  let scoped = false;
  for (let i = 0; i < 12 && !scoped; i++) {
    await h.eval(aimDummy('far1', 1.2));
    await frames(2);
    await page.mouse.down({ button: 'left' }); await frames(2); await page.mouse.up({ button: 'left' });
    await frames(50);
    scoped = await h.eval(() => window.__done('scope'));
  }
  await page.mouse.up({ button: 'right' });
  ok(scoped, `scope in and hit a far dummy (gun ${sc.gun})`);
  // 10 harvest: pick (F), hit a tree
  await h.eval(() => window.__bf.match.player.body.pos.set(13.5, window.__st().harvest.y, 68.5));
  await press('KeyF');
  await page.mouse.down({ button: 'left' });
  ok(await until(() => window.__done('harvest'), 300, () => window.__aim(12.5, window.__st().harvest.y + 1.5, 66.5)), `harvest 20 wood (F + LMB): ${JSON.stringify((await state()).mats)}`);
  await page.mouse.up({ button: 'left' });
  // 11 build: Q, Ramp (3), face the ledge, place, walk up
  await h.eval(() => { const p = window.__bf.match.player; p.body.pos.set(55.5, window.__st().ledge.y - 3, 66.5); p.yaw = 0; });
  await frames(3);
  await press('KeyQ');
  await press('Digit3');
  await h.eval(() => window.__aim(55.5, window.__st().ledge.y - 2, 62));
  await frames(3);
  const ghost = await h.eval(() => window.__bf.pc.buildReason);
  await page.mouse.down({ button: 'left' }); await frames(3); await page.mouse.up({ button: 'left' });
  await frames(5);
  await h.eval(() => { window.__bf.match.player.pitch = 0; window.__bf.match.player.yaw = 0; });
  await page.keyboard.down('KeyW');
  const up = await until(() => window.__done('build'), 120, () => { window.__bf.match.player.yaw = 0; });
  await page.keyboard.up('KeyW');
  ok(up, `build a ramp and walk onto the ledge (Q, 3, LMB, W) ${ghost ? '(' + ghost + ')' : ''}: ${JSON.stringify(await state())}`);
  await press('KeyQ');
  // 12 craft: inventory, click Bandages
  await frames(3);
  await press('Tab');
  await h.eval(() => [...document.querySelectorAll('.recipe')].find((r) => /Bandages/.test(r.textContent))?.click());
  await frames(3);
  ok(await until(() => window.__done('craft'), 10), 'craft bandages (Tab, click)');
  await press('Tab');
  // 13 grenade: hold G over the wall, release
  await h.eval(() => { const s = window.__st(); const p = window.__bf.match.player; p.body.pos.set(s.nade.x, s.nade.y, s.nade.z); });
  await frames(5);
  // like a player watching the arc preview: pick the pitch whose arc ends by the dummy, short hold
  const tries = [];
  let nade = false;
  for (let t = 0; t < 4 && !nade; t++) {
    const aim = await h.eval(() => {
      const m = window.__bf.match, p = m.player, s = window.__st();
      p.yaw = 0;
      let best = null;
      for (let a = -0.3; a < 1.2; a += 0.02) {
        p.pitch = a;
        const pts = m.predictArc(p, 0.2);
        const e = pts[pts.length - 1];
        const d = Math.hypot(e.x - s.nadeDummy.x, e.z - (s.nadeDummy.z + 0.5));
        if (!best || d < best.d) best = { a, d };
      }
      p.pitch = best.a;
      return { pitch: +best.a.toFixed(2), miss: +best.d.toFixed(1), frags: p.throws.frag };
    });
    await page.keyboard.down('KeyG');
    await frames(6);
    await page.keyboard.up('KeyG');
    nade = await until(() => window.__done('grenade'), 60);
    tries.push(aim);
  }
  ok(nade, `throw a grenade over the wall (G, short hold): ${JSON.stringify(tries)}`);
  // 14 duel: defeat the sparring bot
  await h.eval(() => { const s = window.__st(); const p = window.__bf.match.player; p.body.pos.set(s.arena.x, s.arena.y, s.arena.z); p.hp = 100; });
  await frames(10);
  await press('Digit1');
  await page.mouse.down({ button: 'left' });
  const duel = await until(() => window.__done('duel'), 300, () => { const m = window.__bf.match; const b = m.duelBot?.c; if (b && b.alive) { window.__aim(b.body.pos.x, b.body.pos.y + 1.2, b.body.pos.z); m.player.hp = 100; } });
  await page.mouse.up({ button: 'left' });
  ok(duel, 'defeat the sparring bot');
  const end = await h.eval(() => ({ done: window.__bf.match.doneCount, total: window.__bf.match.done.length, step: window.__bf.match.step.id }));
  ok(end.done === end.total && end.step === 'done', `training complete: ${JSON.stringify(end)}`);
}
