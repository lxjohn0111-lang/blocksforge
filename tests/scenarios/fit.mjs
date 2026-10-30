// Every screen at one window size: reports text that is cut off, text or HUD blocks that overlap, and
// scroll areas that only scroll a little (they should fit instead). Mouse mode by default, touch with
// BF_MOBILE=1. Run it at the sizes CrazyGames embeds the game in, e.g.:
//   node tests/drive.mjs tests/scenarios/fit.mjs 907 510
//   node tests/drive.mjs tests/scenarios/fit.mjs 640 360
// Each screen prints "<screen>: ok" or its problems; BF_SHOTS=1 also saves screenshots.
export default async function (page, h) {
  const size = await h.eval(() => `${innerWidth}x${innerHeight}`);
  let problems = 0;
  const audit = async (label) => {
    const res = await h.eval(() => {
      const W = innerWidth, H = innerHeight;
      const vis = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      // the open layer on top (a modal, the wheel, a reveal, a HUD panel): only it is visible
      // (fade-in animations may still hold a layer's opacity near 0: only display/visibility count here)
      const layers = [...document.querySelectorAll('.modal, .reveal, .wheel-modal, .hud > .clickable, .screen.lobby')].filter((e) => e.checkVisibility({ visibilityProperty: true }));
      const scope = layers.length ? layers[layers.length - 1] : document.getElementById('ui');
      const skip = '.adslot, .fps, .qtmark, .tags, .hitmark, .dmgind, .minimap, .compass, .mk, .wheel-svg, .announce, .rays, .confetti';
      const name = (e) => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase()) + ` "${e.textContent.trim().slice(0, 18)}"`;
      const out = [];
      // where an element can be seen: the viewport, cut by every ancestor that clips without scrolling;
      // null when it sits outside a scroll area's view (scrolled away, which is fine)
      const clipOf = (e) => {
        let box = { l: 0, t: 0, r: W, b: H };
        // once inside a scroll area, clipping along its scroll direction just means "scroll to see it"
        let inY = false, inX = false;
        for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const o = getComputedStyle(a);
          if (o.overflowX === 'visible' && o.overflowY === 'visible' && o.clipPath === 'none') continue;
          const c = a.getBoundingClientRect();
          const scrollsY = /(auto|scroll)/.test(o.overflowY) && a.scrollHeight > a.clientHeight + 1;
          const scrollsX = /(auto|scroll)/.test(o.overflowX) && a.scrollWidth > a.clientWidth + 1;
          if (scrollsY || scrollsX) {
            const r = e.getBoundingClientRect();
            if (r.bottom < c.top || r.top > c.bottom || r.right < c.left || r.left > c.right) return null;
          }
          inY = inY || scrollsY;
          inX = inX || scrollsX;
          if (!inX) box = { ...box, l: Math.max(box.l, c.left), r: Math.min(box.r, c.right) };
          if (!inY) box = { ...box, t: Math.max(box.t, c.top), b: Math.min(box.b, c.bottom) };
        }
        if (inY) box = { ...box, t: -1e9, b: 1e9 };
        if (inX) box = { ...box, l: -1e9, r: 1e9 };
        return box;
      };
      // tight boxes of an element's own text pieces (glyph boxes trimmed to the line box, so tall
      // display fonts with a short line height do not count as touching the line above)
      const textBoxes = (e) => {
        const out = [];
        const lh = parseFloat(getComputedStyle(e).lineHeight);
        for (const n of e.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          for (const b of rg.getClientRects()) {
            if (!b.width || !b.height) continue;
            const trim = lh && b.height > lh ? (b.height - lh) / 2 : 0;
            out.push({ l: b.left, t: b.top + trim, r: b.right, b: b.bottom - trim });
          }
        }
        return out;
      };
      const texts = [];
      for (const e of scope.querySelectorAll('*')) {
        if (e.closest(skip) || !vis(e)) continue;
        const boxes = textBoxes(e);
        if (!boxes.length) continue;
        const clip = clipOf(e);
        if (!clip) continue;
        const cut = Math.max(...boxes.map((t) => Math.max(clip.l - t.l, clip.t - t.t, t.r - clip.r, t.b - clip.b)));
        if (cut > 2) out.push(`CUT ${name(e)} by ${Math.round(cut)}px`);
        const cs = getComputedStyle(e);
        if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.push(`ELLIPSIS ${name(e)}`);
        for (const t of boxes) texts.push({ e, t });
      }
      // is `e` hidden at (x, y) by something solid painted over it (a sticky footer, a panel)?
      const solid = (el) => {
        const cs = getComputedStyle(el);
        const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
        const alpha = m ? (m[1].split(',')[3] === undefined ? 1 : +m[1].split(',')[3]) : 0;
        return alpha >= 0.85 || /gradient/.test(cs.backgroundImage);
      };
      const covered = (e, x, y) => {
        for (const top of document.elementsFromPoint(x, y)) {
          if (top === e || top.contains(e)) return false;
          if (!e.contains(top) && solid(top)) return true;
        }
        return false;
      };
      for (let i = 0; i < texts.length; i++)
        for (let j = i + 1; j < texts.length; j++) {
          if (texts[i].e === texts[j].e) continue;
          const a = texts[i].t, b = texts[j].t;
          const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), hh = Math.min(a.b, b.b) - Math.max(a.t, b.t);
          if (!(w > 2 && hh > 2)) continue;
          const x = (Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2, y = (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2;
          if (covered(texts[i].e, x, y) || covered(texts[j].e, x, y)) continue;
          out.push(`OVERLAP ${name(texts[i].e)} x ${name(texts[j].e)}`);
        }
      // HUD blocks against each other (only when no panel is open over the HUD)
      if (scope.id === 'ui' && document.querySelector('.hud')) {
        const groups = ['.touch-ui .tbtn', '.touch-ui .tstick', '.hud .vitals', '.hud .slots', '.hud .buildbar', '.hud .ammo', '.hud .mats', '.hud .minimap', '.hud .mstatus', '.hud .scorebar', '.hud .feed .k', '.hud .toasts .toast', '.hud .toasts .tipbar', '.hud .coach', '.hud .tut', '.hud .qt', '.hud .prompt', '.hud .droptip', '.hud .compass'];
        const boxes = [];
        for (const sel of groups) for (const e of document.querySelectorAll(sel)) {
          if (!vis(e) || !(e.textContent.trim() || e.querySelector('canvas,svg') || e.matches('.tstick,.tbtn'))) continue;
          const r = e.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`OFFSCREEN ${sel}`);
          boxes.push({ n: sel, r });
        }
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[i].n === boxes[j].n) continue;
            const a = boxes[i].r, b = boxes[j].r;
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), hh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (w > 2 && hh > 2) out.push(`HUD OVERLAP ${boxes[i].n} x ${boxes[j].n} (${Math.round(w)}x${Math.round(hh)})`);
          }
      }
      // scroll areas that scroll only a little should fit instead
      for (const e of scope.querySelectorAll('*')) {
        if (!vis(e)) continue;
        const o = getComputedStyle(e);
        const extra = e.scrollHeight - e.clientHeight;
        if (/(auto|scroll)/.test(o.overflowY) && extra > 1 && extra < 60) out.push(`SCROLLS ${extra}px ${name(e)}`);
        // sideways scrolling outside the strips made for it means content is cut at the side
        if (/(auto|scroll)/.test(o.overflowX) && e.scrollWidth > e.clientWidth + 2 && !e.matches('.tabs, .settings .side')) out.push(`SCROLLS SIDEWAYS ${e.scrollWidth - e.clientWidth}px ${name(e)}`);
      }
      if (document.documentElement.scrollWidth > W + 1 || document.documentElement.scrollHeight > H + 1) out.push('PAGE SCROLLS');
      return [...new Set(out)];
    });
    problems += res.length;
    console.log(`${label}: ${res.length ? res.slice(0, 14).join(' | ') + (res.length > 14 ? ` | …(${res.length})` : '') : 'ok'}`);
    if (process.env.BF_SHOTS) await h.shot(`fit_${size}_${label.replace(/\W+/g, '_')}`);
  };
  const click = (re, sel = '#ui button, #ui .tab, #ui .btn, #ui .modecard') => h.eval(([src, sel]) => { const r = new RegExp(src, 'i'); const b = [...document.querySelectorAll(sel)].find((e) => e.checkVisibility() && r.test(e.textContent.trim())); if (b) b.click(); return !!b; }, [re.source, sel]);
  const frames = (n, dt = 1 / 30) => h.eval(([n, dt]) => { for (let i = 0; i < n; i++) window.__bf.frame(dt); }, [n, dt]);

  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.run(1500);
  // ---------------------------------------------------------------- menu
  await audit('menu br');
  await click(/^Ranked/);
  await h.run(200);
  await audit('menu ranked');
  await click(/^Team Deathmatch/, '.modecard');
  await h.run(200);
  await audit('menu tdm');
  await click(/^Training Grounds/, '.modecard');
  await h.run(200);
  await audit('menu training');
  await click(/^Battle Royale/, '.modecard');
  for (const t of ['Career', 'Locker', 'Armory', 'Ladder']) {
    await click(new RegExp('^' + t + '$'), '.topbar .tab');
    await h.run(400);
    await audit(t.toLowerCase());
  }
  await click(/^Locker$/, '.topbar .tab');
  for (const c of ['Weapon camos', 'Banners', 'Titles', 'Appearance']) {
    await click(new RegExp('^' + c + '$'));
    await h.run(250);
    await audit('locker ' + c.toLowerCase());
  }
  await click(/^Outfits$/);
  await h.run(250);
  await h.eval(() => [...document.querySelectorAll('.item.locked')].find((e) => /Ad Vault/.test(e.textContent))?.click());
  await h.run(300);
  await audit('vault');
  await h.eval(() => document.querySelector('.modal')?.remove());
  await click(/^Play$/, '.topbar .tab');
  await h.run(300);
  await h.eval(() => document.querySelector('.wheelcard')?.click());
  await h.run(600);
  await audit('wheel');
  await h.eval(() => document.querySelector('.wheel-spin')?.click());
  await h.run(2000);
  await h.waitFor(() => !document.querySelector('.wheel-modal.spinning'), 30000);
  await h.run(500);
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  await audit('wheel after spin');
  await h.eval(() => document.querySelector('.wheel-close')?.click());
  await h.run(300);
  await h.eval(() => [...document.querySelectorAll('.card .btn.primary')].find((b) => /Claim daily/.test(b.textContent))?.click());
  await h.run(500);
  await audit('reveal');
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  await h.run(300);
  await audit('menu after claim');
  await h.eval(() => window.__bf.openSettingsUI());
  await h.run(400);
  const tabs = ['Graphics', 'Audio', 'Controls', 'Gameplay', 'About'];
  await audit('settings');
  for (const t of tabs.slice(1)) {
    await click(new RegExp('^' + t + '$'), '.settings .side button');
    await h.run(250);
    await audit('settings ' + t.toLowerCase());
  }
  await click(/^Done$/);
  await h.run(300);

  // ---------------------------------------------------------------- Battle Royale
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: true, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(1200);
  await audit('lobby');
  await h.waitFor(() => window.__bf.state === 'match', 120000);
  await h.eval(() => { window.__pause = true; window.__noRender = true; });
  const hideLock = () => h.eval(() => { const l = [...document.querySelectorAll('#ui > .overlay')].find((e) => /Click to play/.test(e.textContent)); if (l) l.style.display = 'none'; });
  await frames(30);
  await hideLock();
  await audit('br ship');
  await h.eval(() => { const bf = window.__bf; const m = bf.match; bf.simulate(5); m.jumpFromShip(m.player); m.player.hp = 1e6; for (let i = 0; i < 60 && (m.player.dropping || m.player.gliding); i++) bf.simulate(1); });
  await h.eval(() => {
    const m = window.__bf.match, p = m.player;
    p.hp = 100;
    p.giveWeapon('ranger'); p.giveWeapon('breacher'); p.giveWeapon('longshot');
    p.addAmmo('medium', 120); p.addAmmo('shells', 20); p.addAmmo('heavy', 20);
    p.addMat('wood', 340); p.addMat('stone', 120); p.addMat('metal', 60); p.addMat('cloth', 10);
    p.heals.bandage = 5; p.heals.medkit = 2; p.throws.frag = 3; p.armor = 60; p.armorCap = 100;
    const bots = m.combatants.filter((c) => !c.isPlayer);
    // a full kill feed with long names, and a toast
    for (let i = 0; i < 5; i++) m.events.emit('kill', { killer: bots[i], victim: bots[i + 6], weapon: 'Longshot .338', headshot: i % 2 === 0, distance: 120, cause: 'bullet' });
    m.events.emit('toast', { text: 'Storm closing in 60s', kind: 'info' });
  });
  await frames(10);
  await hideLock();
  await audit('br hud');
  await h.eval(() => { window.__bf.match.player.slot = 5; });
  await frames(5);
  await hideLock();
  await audit('br hud pickaxe');
  await h.eval(() => { window.__bf.pc.buildMode = true; });
  await frames(5);
  await hideLock();
  await audit('br build');
  await h.eval(() => { window.__bf.pc.buildMode = false; window.__bf.hud.openInventory(); });
  await frames(2);
  await audit('br inventory');
  await h.eval(() => { window.__bf.hud.closeOverlay(); window.__bf.hud.toggleMap(); });
  await frames(2);
  await audit('br map');
  await h.eval(() => { window.__bf.hud.closeOverlay(); window.__bf.hud.openPause(); });
  await frames(2);
  await audit('br pause');
  await h.eval(() => { window.__bf.hud.closeOverlay(); const m = window.__bf.match; m.damage(m.player, 500, { attacker: m.combatants.find((c) => !c.isPlayer && c.alive), kind: 'bullet', weapon: 'Ranger AR' }); });
  await frames(60);
  await h.run(1500);
  await frames(2);
  await audit('br death');
  await h.eval(() => [...document.querySelectorAll('.death .btn')].find((b) => /Continue/.test(b.textContent))?.click());
  for (let i = 0; i < 40 && !(await h.eval(() => window.__bf.state === 'results')); i++) { await frames(2); await h.run(250); }
  await h.eval(() => { window.__pause = false; window.__noRender = false; });
  await h.waitFor(() => window.__bf.state === 'results' && !!document.querySelector('.res2'), 60000);
  await h.run(2500);
  await h.eval(() => document.querySelectorAll('.reveal .btn').forEach((b) => b.click()));
  await audit('results');
  await h.eval(() => document.querySelector('.sbtoggle')?.click());
  await h.run(200);
  await audit('results scoreboard');
  await click(/^Menu$/);
  await h.waitFor(() => window.__bf.state === 'menu', 30000);

  // ---------------------------------------------------------------- Team Deathmatch
  await h.eval(() => window.__bf.play({ mode: 'tdm', ranked: false, tdmMap: 'hamlet', loadout: 'assault' }));
  await h.waitFor(() => window.__bf.state === 'match', 120000);
  await h.eval(() => { window.__pause = true; window.__noRender = true; window.__bf.simulate(2); });
  await frames(5);
  await hideLock();
  await audit('tdm hud');
  await h.eval(() => window.__bf.hud.showScoreboard(true));
  await frames(2);
  await audit('tdm scoreboard');
  await h.eval(() => { window.__bf.hud.showScoreboard(false); const m = window.__bf.match; m.damage(m.player, 500, { attacker: m.combatants.find((c) => c.team !== m.player.team && c.alive), kind: 'bullet', weapon: 'Ranger AR' }); });
  await frames(30);
  await h.run(800);
  await frames(2);
  await audit('tdm death');
  await h.eval(() => { window.__pause = false; window.__noRender = false; window.__bf.leaveMatch(); });
  await h.waitFor(() => window.__bf.state === 'results', 60000);
  await h.run(1500);
  await h.eval(() => document.querySelectorAll('.reveal .btn').forEach((b) => b.click()));
  await audit('tdm results');
  await click(/^Menu$/);
  await h.waitFor(() => window.__bf.state === 'menu', 30000);

  // ---------------------------------------------------------------- tutorials and the ready card
  await h.eval(() => document.querySelector('[title="How to play"]').click());
  await h.waitFor(() => window.__bf.state === 'match' && window.__bf.match.quick, 400000);
  await h.eval(() => { window.__pause = true; window.__noRender = true; const bf = window.__bf; for (let i = 0; i < 20; i++) { bf.simulate(1 / 30); bf.hud.update(1 / 30); } });
  await hideLock();
  await audit('basics');
  await h.eval(() => { window.__pause = false; window.__noRender = false; window.__bf.leaveMatch(); });
  await h.waitFor(() => window.__bf.state === 'menu', 30000);
  await h.eval(() => { const bf = window.__bf; bf.menu?.dispose(); bf.menu = null; bf.showReady(100); });
  await h.run(400);
  await audit('ready card');
  await click(/^Menu$/);
  await h.eval(() => window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }));
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  await h.eval(() => { window.__pause = true; window.__noRender = true; window.__bf.simulate(0.5); });
  await frames(3);
  await hideLock();
  await audit('training');
  console.log(`TOTAL ${size}: ${problems} problems`);
}
