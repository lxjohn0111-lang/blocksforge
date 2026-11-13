// Ads and rewarded offers, with the stand-in ads that run off CrazyGames:
//   node tests/drive.mjs tests/scenarios/ads.mjs 1280 720
// Checks the 320×50 menu banner on every tab (and that it never covers menu UI), and that there is no
// banner anywhere else; the Lucky Wheel (free spin, cooldown, ad spin), the boosts, the Ad Vault (one
// ad per item), the daily double, the starter kit, Redeploy after a Battle Royale elimination, 2×
// rewards on the results screen, and no ad on the way back to the menu.
export default async function (page, h) {
  const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bfDemoAdMs = 250; });
  // the banner and what it would cover: every visible menu element that intersects it
  const banner = () => h.eval(() => {
    const bar = document.querySelector('.bf-bslot');
    if (!bar || !bar.checkVisibility() || !bar.childElementCount) return { shown: false };
    // nothing of the menu may reach into the banner's footer bar
    const r = bar.closest('.bf-foot').getBoundingClientRect();
    const hits = [];
    // the part of an element that is really on screen (scrolling columns clip their content)
    const visible = (el) => {
      let b = el.getBoundingClientRect();
      let box = { l: b.left, t: b.top, r: b.right, b: b.bottom };
      for (let a = el.parentElement; a && a.id !== 'ui'; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (/(auto|scroll|hidden)/.test(o.overflow + o.overflowX + o.overflowY)) {
          const c = a.getBoundingClientRect();
          box = { l: Math.max(box.l, c.left), t: Math.max(box.t, c.top), r: Math.min(box.r, c.right), b: Math.min(box.b, c.bottom) };
        }
      }
      return box.r > box.l && box.b > box.t ? box : null;
    };
    for (const el of document.querySelectorAll('#ui .screen *, #ui .hud *')) {
      if (el.closest('.bf-foot') || !el.offsetParent || el.children.length) continue;
      const v = visible(el);
      if (!v) continue;
      const b = { left: v.l, top: v.t, right: v.r, bottom: v.b };
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      if (b.right > r.left + 1 && b.left < r.right - 1 && b.bottom > r.top + 1 && b.top < r.bottom - 1) hits.push(`${el.className || el.tagName}:${(el.textContent || '').trim().slice(0, 20)}`);
    }
    const slot = bar.getBoundingClientRect();
    return { shown: true, w: Math.round(slot.width), h: Math.round(slot.height), hits: hits.slice(0, 6), reserved: document.body.classList.contains('foot-room') };
  });
  await h.run(1500);
  for (const tab of ['Play', 'Career', 'Locker', 'Armory', 'Ladder']) {
    await h.eval((t) => [...document.querySelectorAll('.topbar .tab')].find((b) => b.textContent === t)?.click(), tab);
    await h.run(400);
    const b = await banner();
    ok(b.shown && b.reserved && b.w === 320 && b.h === 50 && !b.hits.length, `menu banner on ${tab}: ${JSON.stringify(b)}`);
    if (tab === 'Play' || tab === 'Armory' || tab === 'Locker') await h.shot(`ads_menu_${tab.toLowerCase()}`);
  }
  await h.eval(() => [...document.querySelectorAll('.topbar .tab')].find((b) => b.textContent === 'Play')?.click());
  await h.run(300);

  // ---- the banner under Settings, and no refresh while something covers it (refresh every 3 s here)
  await h.eval(() => {
    window.__bfDemoBannerMs = 3000;
    window.__bfBanners = 0;
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('demo-banner')) window.__bfBanners++; }).observe(document.getElementById('bf-banner-slot'), { childList: true });
  });
  const onTop = () => h.eval(() => { const s = document.querySelector('.bf-bslot').getBoundingClientRect(); return !!document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2)?.closest('.bf-bslot'); });
  await h.eval(() => document.querySelector('[title="Settings"]').click());
  await h.run(4500);
  const set = await h.eval(() => ({ panel: Math.round(document.querySelector('.setmodal .settings').getBoundingClientRect().bottom), foot: Math.round(document.querySelector('.bf-foot').getBoundingClientRect().top), n: window.__bfBanners }));
  ok((await onTop()) && set.panel <= set.foot && set.n >= 1, `banner shown and refreshed under Settings: ${JSON.stringify(set)}`);
  await h.eval(() => [...document.querySelectorAll('.settings .btn')].find((b) => b.textContent === 'Done')?.click());
  await h.eval(() => document.querySelector('.wheelcard, .ptile')?.click());
  await h.run(500);
  const hid0 = await h.eval(() => window.__bfBanners);
  const covered = !(await onTop());
  await h.run(7000);
  const hid1 = await h.eval(() => window.__bfBanners);
  ok(covered && hid1 === hid0, `no refresh while a pop-up covers the banner: ${hid0} -> ${hid1} (covered ${covered})`);
  await h.eval(() => document.querySelector('.wheel-close')?.click());
  await h.run(2000);
  const hid2 = await h.eval(() => window.__bfBanners);
  ok(hid2 === hid1 + 1, `refreshed once it shows again: ${hid1} -> ${hid2}`);
  await h.eval(() => { delete window.__bfDemoBannerMs; });

  // phones show the Play tab's extras as tiles: each card (and its offers) is on a sheet the tile opens
  const phone = await h.eval(() => document.body.classList.contains('phone'));
  const openTile = async (name) => {
    if (!phone) return;
    await h.eval((n) => [...document.querySelectorAll('.ptile')].find((t) => t.textContent.includes(n))?.click(), name);
    await h.run(300);
  };
  const closeSheet = async () => {
    if (!phone) return;
    await h.eval(() => [...document.querySelectorAll('.psheet .btn')].find((b) => b.textContent === 'Close')?.click());
    await h.run(200);
  };
  await openTile('Boosts');
  const offers = await h.eval(() => [...document.querySelectorAll('.rwbtn .rwl')].map((e) => e.textContent));
  ok(offers.length >= 4, `rewarded offers on the Play tab: ${JSON.stringify(offers)}`);

  // ---- Lucky Wheel: free spin, then the cooldown, then a spin for an ad
  await closeSheet();
  if (phone) await openTile('Lucky Wheel');
  else await h.eval(() => document.querySelector('.wheelcard')?.click());
  await h.run(500);
  await h.shot('ads_wheel_ready');
  const coins0 = await h.eval(() => window.__bf.meta.p.coins);
  await h.eval(() => document.querySelector('.wheel-spin')?.click());
  await h.run(2500);
  await h.shot('ads_wheel_spinning');
  await h.run(3500);
  const spin1 = await h.eval(() => ({ result: document.querySelector('.wheel-result')?.textContent, next: window.__bf.meta.wheelReadyIn(), spins: window.__bf.meta.p.ads.wheelSpins, wait: document.querySelector('.wheel-wait')?.textContent, ad: !!document.querySelector('.wheel-actions .rwbtn') }));
  ok(spin1.spins === 1 && spin1.next > 540000 && spin1.ad && /Free spin in/.test(spin1.wait || ''), `free spin, then 10 min cooldown and an ad spin offer: ${JSON.stringify(spin1)}`);
  await h.shot('ads_wheel_result');
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  await h.eval(() => document.querySelector('.wheel-actions .rwbtn')?.click());
  await h.run(7000);
  const spin2 = await h.eval(() => ({ spins: window.__bf.meta.p.ads.wheelSpins, result: document.querySelector('.wheel-result')?.textContent, coins: window.__bf.meta.p.coins }));
  ok(spin2.spins === 2, `ad spin while on cooldown: ${JSON.stringify(spin2)} (coins before ${coins0})`);
  await h.eval(() => { document.querySelector('.reveal .btn')?.click(); document.querySelector('.wheel-close')?.click(); });
  await h.run(400);

  // ---- boosts: supply drop, 2× XP, a vault step
  await openTile('Boosts');
  const c1 = await h.eval(() => window.__bf.meta.p.coins);
  await h.eval(() => [...document.querySelectorAll('.boostcard .rwbtn')].find((b) => /\+\d+/.test(b.textContent))?.click());
  await h.run(1200);
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  const c2 = await h.eval(() => ({ coins: window.__bf.meta.p.coins, next: window.__bf.meta.coinsReadyIn() }));
  ok(c2.coins >= c1 + 200 && c2.next > 290000, `supply drop: ${c1} -> ${JSON.stringify(c2)}`);
  await h.eval(() => [...document.querySelectorAll('.boostcard .rwbtn')].find((b) => /XP/.test(b.textContent))?.click());
  await h.run(1200);
  const boost = await h.eval(() => ({ left: window.__bf.meta.xpBoostLeft(), chip: !!document.querySelector('.boostchip') }));
  ok(boost.left > 14 * 60000, `2× XP boost running: ${JSON.stringify(boost)}`);
  await h.eval(() => [...document.querySelectorAll('.boostcard .rwbtn')].find((b) => /Unlock/.test(b.textContent))?.click());
  await h.run(1200);
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  const vault = await h.eval(() => ({ owned: window.__bf.meta.owns('outfit:gilded_phantom'), vault: window.__bf.meta.p.ads.vault }));
  ok(vault.owned, `Ad Vault item unlocked by one ad: ${JSON.stringify(vault)}`);

  // ---- daily reward, then doubling it
  await closeSheet();
  await openTile('Daily reward');
  await h.eval(() => [...document.querySelectorAll('.card .btn.primary')].find((b) => /Claim daily/.test(b.textContent))?.click());
  await h.run(600);
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  await h.run(300);
  const canDouble = await h.eval(() => window.__bf.meta.canDoubleDaily());
  await h.eval(() => [...document.querySelectorAll('.rwbtn')].find((b) => /Double today/.test(b.textContent))?.click());
  await h.run(1200);
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  ok(canDouble && !(await h.eval(() => window.__bf.meta.canDoubleDaily())), 'daily reward doubled once');
  await h.shot('ads_menu_boosted');

  // ---- starter kit, then a Battle Royale match
  await closeSheet();
  await openTile('Boosts');
  await h.eval(() => [...document.querySelectorAll('.perks .rwbtn')].find((b) => /Drop in loaded/.test(b.textContent))?.click());
  await h.run(1200);
  ok(await h.eval(() => window.__bf.meta.p.ads.starterKit), 'starter kit armed for the next drop');
  await closeSheet();
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(1500);
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  // from here the match is stepped by hand (software rendering is far too slow to wait on)
  await h.eval(() => { window.__pause = true; window.__noRender = true; });
  const frames = (n, dt = 1 / 30) => h.eval(([n, dt]) => { for (let i = 0; i < n; i++) window.__bf.frame(dt); }, [n, dt]);
  await frames(3);
  const kit = await h.eval(() => ({ weapons: window.__bf.match.player.weapons.map((w) => w?.def.id ?? null), plates: window.__bf.match.player.heals.plate, wood: window.__bf.match.player.mats.wood, used: window.__bf.meta.p.ads.starterKit }));
  ok(kit.weapons.includes('ranger') && kit.plates >= 3 && kit.wood >= 150 && !kit.used, `starter kit in the match: ${JSON.stringify(kit)}`);
  ok(!(await banner()).shown, 'no banner during play');
  await h.eval(() => { const bf = window.__bf; const m = bf.match; bf.simulate(5); m.jumpFromShip(m.player); bf.simulate(30); });
  // count the break ads from here on (the 3-minute pacing is lifted so every break shows)
  await h.eval(() => {
    window.__bfDemoPacingMs = 0;
    window.__breaks = 0;
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('demo-ad') && /Advertisement/.test(n.textContent)) window.__breaks++; }).observe(document.body, { childList: true });
  });
  // eliminated: no banner while spectating, the death screen offers Redeploy
  await h.eval(() => { const m = window.__bf.match; m.damage(m.player, 500, { attacker: m.combatants.find((c) => !c.isPlayer && c.alive), kind: 'bullet', weapon: 'Ranger AR' }); });
  await frames(2);
  await h.run(300);
  const spec = await banner();
  ok(!spec.shown, 'no banner while spectating');
  await frames(50);
  await h.run(1600);
  await frames(2);
  const death = await h.eval(() => ({ overlay: window.__bf.hud.overlay, redeploy: !!document.querySelector('.death .redeploy .rwbtn') }));
  ok(death.overlay === 'death' && death.redeploy, `death screen with Redeploy: ${JSON.stringify(death)}`);
  const spec2 = await banner();
  ok(!spec2.shown, 'no banner on the death screen');
  await h.run(400);
  ok(await h.eval(() => window.__breaks === 0), `no break ad next to the Redeploy offer (${await h.eval(() => window.__breaks)})`);
  await h.eval(() => { window.__noRender = false; });
  await h.shot('ads_spectate');
  await h.eval(() => { window.__pause = true; window.__noRender = true; document.querySelector('.death .redeploy .rwbtn')?.click(); });
  await h.run(1200);
  await frames(3);
  const back = await h.eval(() => ({ alive: window.__bf.match.player.alive, dropping: window.__bf.match.player.dropping, overlay: window.__bf.hud.overlay, redeployed: window.__bf.match.redeployed }));
  ok(back.alive && back.redeployed && back.overlay === 'none', `redeployed: ${JSON.stringify(back)}`);
  ok(!(await banner()).shown, 'banner gone once back in play');
  // second elimination: no second redeploy, continue to the results
  await h.eval(() => { const m = window.__bf.match; m.damage(m.player, 500, { attacker: null, kind: 'zone', weapon: 'Storm' }); });
  await frames(50);
  await h.run(1600);
  await frames(2);
  ok(await h.eval(() => window.__bf.hud.overlay === 'death' && !document.querySelector('.death .redeploy')), 'Redeploy only once a match');
  await h.run(400);
  ok(await h.eval(() => window.__breaks === 1), `break ad when the death screen without Redeploy comes up (${await h.eval(() => window.__breaks)})`);
  await h.eval(() => [...document.querySelectorAll('.death .btn')].find((b) => /Continue/.test(b.textContent))?.click());
  for (let i = 0; i < 40 && !(await h.eval(() => window.__bf.state === 'results')); i++) {
    await frames(2);
    await h.run(250);
  }
  await h.eval(() => { window.__pause = false; window.__noRender = false; });
  await h.waitFor(() => window.__bf.state === 'results' && !!document.querySelector('.res2'), 60000);
  await h.run(800);
  const before = await h.eval(() => ({ coins: window.__bf.meta.p.coins, xp: window.__bf.meta.p.xp, level: window.__bf.meta.p.level, offer: !!document.querySelector('.res2-double .rwbtn'), xpLine: document.querySelector('.xpv')?.textContent }));
  const rb = await banner();
  ok(before.offer && !rb.shown, `results: 2× offer, no banner: ${JSON.stringify(before)}`);
  ok(await h.eval(() => window.__breaks === 1), 'no break ad on Continue (navigation)');
  await h.eval(() => { window.__bfDemoPacingMs = undefined; });
  await h.shot('ads_results');
  await h.eval(() => document.querySelector('.res2-double .rwbtn')?.click());
  await h.run(1200);
  const after = await h.eval(() => ({ coins: window.__bf.meta.p.coins, xp: window.__bf.meta.p.xp, level: window.__bf.meta.p.level, doubled: !!document.querySelector('.doubled'), xpLine: document.querySelector('.xpv')?.textContent }));
  ok(after.doubled && after.coins > before.coins, `2× rewards granted: ${JSON.stringify(after)}`);
  await h.eval(() => document.querySelector('.reveal .btn')?.click());
  await h.shot('ads_results_doubled');
  // going to the menu is navigation: no midgame ad on the way
  await h.eval(() => { window.__adSeen = false; new MutationObserver(() => { if (document.querySelector('.demo-ad')) window.__adSeen = true; }).observe(document.body, { childList: true }); });
  await h.eval(() => [...document.querySelectorAll('.res2-actions .btn')].find((b) => /Menu/.test(b.textContent))?.click());
  await h.waitFor(() => window.__bf.state === 'menu', 30000);
  await h.run(1500);
  ok(!(await h.eval(() => window.__adSeen)), 'no ad on the way back to the menu');
  // the banner comes with the menu's first frame (slow in software rendering)
  for (let i = 0; i < 30 && !(await banner()).shown; i++) await h.run(500);
  ok((await banner()).shown, 'menu banner back');
}
