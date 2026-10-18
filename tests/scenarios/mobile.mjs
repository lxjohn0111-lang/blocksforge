// Phone pass (run with BF_MOBILE=1): screenshots every screen, drives the on-screen controls with real
// touch events and reports any HUD / touch control boxes that overlap each other.
export default async function (page, h) {
  const tag = process.env.BF_TAG || 'land';
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const center = (sel) => h.eval((sel) => { const e = document.querySelector(sel); if (!e || !e.checkVisibility()) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const tap = async (sel) => {
    const c = await center(sel);
    if (!c) { console.log('tap: not visible', sel); return false; }
    await page.touchscreen.tap(c[0], c[1]);
    await h.run(250);
    return true;
  };
  const overlaps = (label) => h.eval((label) => {
    const groups = ['.touch-ui .tbtn', '.touch-ui .tstick', '.hud .vitals', '.hud .slots', '.hud .buildbar', '.hud .ammo', '.hud .mats', '.hud .compass', '.hud .minimap', '.hud .mstatus', '.hud .scorebar', '.hud .feed .k', '.hud .toasts .toast', '.hud .toasts .tipbar', '.hud .coach', '.hud .tut', '.hud .prompt', '.hud .droptip', '.hud .spawnshield'];
    const boxes = [];
    for (const sel of groups) for (const e of document.querySelectorAll(sel)) {
      if (!e.checkVisibility() || !(e.textContent.trim() || e.querySelector('canvas,svg') || e.matches('.tstick,.tbtn'))) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      boxes.push({ n: sel.replace(/^\.(hud|touch-ui) /, '') + (e.classList.length ? '.' + [...e.classList].join('.') : ''), r });
    }
    const out = [];
    const W = innerWidth, H = innerHeight;
    for (const b of boxes) if (b.r.left < -1 || b.r.top < -1 || b.r.right > W + 1 || b.r.bottom > H + 1) out.push(`${b.n} off-screen ${Math.round(b.r.left)},${Math.round(b.r.top)},${Math.round(b.r.right)},${Math.round(b.r.bottom)}`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), hh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && hh > 2) out.push(`${boxes[i].n} x ${boxes[j].n} (${Math.round(w)}x${Math.round(hh)})`);
    }
    return `${label}: ${boxes.length} boxes, ${out.length ? 'OVERLAP ' + out.join(' | ') : 'no overlaps'}`;
  }, label);
  const pageOverflow = (label) => h.eval((label) => {
    // anything clickable that sits outside the viewport or wider than the screen
    const W = innerWidth;
    const bad = [];
    for (const e of document.querySelectorAll('#ui button, #ui .btn, #ui .tab, #ui .modecard, #ui .panel')) {
      if (!e.checkVisibility()) continue;
      const r = e.getBoundingClientRect();
      if (r.width > W + 1) bad.push(`${e.className} wider than screen (${Math.round(r.width)})`);
    }
    const doc = document.documentElement;
    return `${label}: ${doc.scrollWidth > W + 1 ? 'PAGE SCROLLS SIDEWAYS ' : ''}${bad.length ? bad.slice(0, 6).join(' | ') : 'fits'}`;
  }, label);

  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  console.log('touch mode', await h.eval(() => ({ touch: document.body.classList.contains('touch'), coarse: matchMedia('(pointer: coarse)').matches, q: window.__bf.settings.quality, rs: window.__bf.settings.renderScale })));
  await h.run(1200);
  await h.shot(`mob_${tag}_menu`);
  console.log(await pageOverflow('menu'));
  const clickText = (re) => h.eval((src) => { const r = new RegExp(src, 'i'); const b = [...document.querySelectorAll('#ui button, #ui .tab, #ui .btn')].find((e) => r.test(e.textContent.trim())); if (b) { b.click(); return true; } return false; }, re.source);
  for (const t of ['Career', 'Locker', 'Armory', 'Ladder']) {
    await clickText(new RegExp('^' + t + '$'));
    await h.run(700);
    await h.shot(`mob_${tag}_${t.toLowerCase()}`);
    console.log(await pageOverflow(t));
  }
  await clickText(/^Play$/);
  await h.run(300);
  // TDM selection shows map + loadout pickers: the longest Play column
  await h.eval(() => { const c = [...document.querySelectorAll('.modecard')].find((e) => /Team Deathmatch/.test(e.textContent)); c?.click(); });
  await h.run(400);
  await h.shot(`mob_${tag}_menu_tdm`);
  console.log(await pageOverflow('menu tdm'));
  await h.eval(() => window.__bf.openSettingsUI());
  await h.run(500);
  await h.shot(`mob_${tag}_settings`);
  console.log(await pageOverflow('settings'));
  await clickText(/^Controls$/);
  await h.run(300);
  await h.shot(`mob_${tag}_settings_controls`);
  await clickText(/^Done$/);
  await h.run(300);

  if (process.env.BF_MENU_ONLY) return;

  // ---- Battle Royale
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(1500);
  await h.shot(`mob_${tag}_lobby`);
  await h.waitFor(() => window.__bf.state === 'match', 120000);
  await h.eval(() => { window.__pause = true; window.__bf.simulate(2); });
  await h.shot(`mob_${tag}_ship`);
  if (await h.eval(() => document.querySelector('.touch-ui .rotate').checkVisibility())) {
    console.log('portrait phone: rotate prompt shown');
    return;
  }
  console.log(await overlaps('ship'));
  // drop with the jump button, then fast-forward to the ground
  await tap('.touch-ui .tbtn.t-jump');
  await h.eval(() => { window.__pause = true; window.__bf.simulate(0.2); });
  console.log('after jump tap', await h.eval(() => ({ inShip: window.__bf.pc.inShip, dropping: window.__bf.match.player.dropping })));
  await h.eval(() => { const bf = window.__bf; bf.match.player.hp = 1e6; window.__noRender = true; for (let i = 0; i < 60 && (bf.match.player.dropping || bf.match.player.gliding || bf.pc.inShip); i++) bf.simulate(1); window.__noRender = false; });
  await h.eval(() => {
    const m = window.__bf.match, p = m.player;
    p.giveWeapon?.('ranger');
    p.addMat('wood', 120); p.addMat('stone', 40); p.addMat('cloth', 10);
    p.heals.bandage = 3; p.throws.frag = 2;
    window.__bf.simulate(0.2);
  });
  await h.shot(`mob_${tag}_hud`);
  console.log(await overlaps('hud'));
  // joystick: drag on the left half
  const H0 = await h.eval(() => innerHeight);
  const W0 = await h.eval(() => innerWidth);
  await touch('touchStart', [[W0 * 0.15, H0 * 0.7]]);
  await touch('touchMove', [[W0 * 0.15, H0 * 0.7 - 80]]);
  const axis = await h.eval(() => window.__bf.input.moveAxis);
  await h.shot(`mob_${tag}_stick`);
  await touch('touchEnd', []);
  console.log('stick axis', JSON.stringify(axis), 'after release', JSON.stringify(await h.eval(() => window.__bf.input.moveAxis)));
  // look drag on the right
  const yaw0 = await h.eval(() => window.__bf.match.player.yaw);
  await touch('touchStart', [[W0 * 0.6, H0 * 0.4]]);
  await touch('touchMove', [[W0 * 0.6 + 60, H0 * 0.4]]);
  await touch('touchEnd', []);
  await h.eval(() => window.__bf.simulate(0.05));
  console.log('look yaw delta', (await h.eval(() => window.__bf.match.player.yaw)) - yaw0);
  // build button -> build mode: the build panel replaces the hotbar, the coach card explains it once
  await tap('.touch-ui .tbtn.t-build');
  await h.eval(() => window.__bf.simulate(0.1));
  console.log('build mode', await h.eval(() => window.__bf.pc.buildMode), 'coach', await h.eval(() => document.querySelector('.hud .coach').checkVisibility()));
  await h.shot(`mob_${tag}_build`);
  console.log(await overlaps('build'));
  await tap('.hud .buildbar [data-mat="stone"]');
  await tap('.hud .buildbar [data-act="slot3"]');
  await h.eval(() => window.__bf.simulate(0.1));
  console.log('picked', await h.eval(() => [window.__bf.pc.buildMat, window.__bf.pc.buildPiece].join(' ')));
  await tap('.hud .coach .btn');
  console.log('coach after Got it', await h.eval(() => document.querySelector('.hud .coach').checkVisibility()));
  await h.shot(`mob_${tag}_build2`);
  console.log(await overlaps('build2'));
  await tap('.hud .buildbar [data-act="build"]');
  await h.eval(() => window.__bf.simulate(0.1));
  console.log('build mode after weapons tap', await h.eval(() => window.__bf.pc.buildMode));
  // inventory via bag button, close with the X
  await tap('.touch-ui .tbtn.t-bag');
  console.log('overlay after bag', await h.eval(() => window.__bf.hud.overlay));
  await h.shot(`mob_${tag}_inventory`);
  await tap('.hud .ovclose');
  console.log('overlay after close', await h.eval(() => window.__bf.hud.overlay));
  await tap('.touch-ui .tbtn.t-map');
  console.log('overlay after map', await h.eval(() => window.__bf.hud.overlay));
  await h.shot(`mob_${tag}_map`);
  await page.touchscreen.tap(8, H0 - 8);
  await h.run(200);
  console.log('overlay after tap outside', await h.eval(() => window.__bf.hud.overlay));
  await tap('.touch-ui .tbtn.t-pause');
  await h.shot(`mob_${tag}_pause`);
  console.log(await pageOverflow('pause'));
  await clickText(/^Resume$/);
  await h.run(200);
  // leave via pause -> results
  await tap('.touch-ui .tbtn.t-pause');
  await clickText(/^Leave match$/);
  await h.waitFor(() => window.__bf.state === 'results' || document.querySelector('.results'), 30000).catch(() => {});
  await h.run(1200);
  await h.shot(`mob_${tag}_results`);
  console.log(await pageOverflow('results'));
  await h.eval(() => { const b = [...document.querySelectorAll('.reveal .btn')].pop(); b?.click(); });
  await h.run(300);
  await clickText(/^(Back to menu|Menu|Continue)$/);
  await h.waitFor(() => window.__bf.state === 'menu', 30000).catch(() => {});

  // ---- Training
  await h.eval(() => window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }));
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  await h.eval(() => { window.__pause = true; window.__bf.simulate(0.5); });
  await h.shot(`mob_${tag}_tutorial`);
  console.log(await overlaps('tutorial'));
  const s0 = await h.eval(() => window.__bf.match.step.id);
  await tap('.hud .tut .skip');
  await h.eval(() => window.__bf.simulate(0.1));
  console.log('skip tap', s0, '->', await h.eval(() => window.__bf.match.step.id), 'done', await h.eval(() => window.__bf.match.doneCount));
  await tap('.touch-ui .tbtn.t-pause');
  await clickText(/^Exit training$/);
  await h.run(800);
  await h.eval(() => { const b = [...document.querySelectorAll('.reveal .btn')].pop(); b?.click(); });
  await clickText(/^(Back to menu|Menu|Continue)$/);
  await h.waitFor(() => window.__bf.state === 'menu', 30000).catch(() => {});

  // ---- Team Deathmatch
  await h.eval(() => window.__bf.play({ mode: 'tdm', ranked: false, tdmMap: 'hamlet', loadout: 'assault' }));
  await h.run(1500);
  await h.shot(`mob_${tag}_lobby_tdm`);
  await h.waitFor(() => window.__bf.state === 'match', 120000);
  await h.eval(() => { window.__pause = true; window.__bf.simulate(1); });
  await h.shot(`mob_${tag}_tdm`);
  console.log(await overlaps('tdm'));
  await tap('.touch-ui .tbtn.t-bag');
  console.log('overlay after bag (tdm)', await h.eval(() => window.__bf.hud.overlay));
  await h.shot(`mob_${tag}_scoreboard`);
  await tap('.hud .ovclose');
  await h.eval(() => { const m = window.__bf.match; m.player.spawnShield = 0; m.damage(m.player, 999, { attacker: null, kind: 'fall', weapon: 'Fall' }); window.__bf.simulate(0.3); });
  await h.shot(`mob_${tag}_tdm_death`);
  console.log(await pageOverflow('tdm death'));
}
