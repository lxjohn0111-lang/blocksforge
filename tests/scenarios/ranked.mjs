// Ranked presentation: promotion, demotion, season-end notice, ladder labels, persistence.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  const mk = (over) => h.eval((over) => {
    const bf = window.__bf; const p = bf.meta.p;
    const stats = { kills: 3, assists: 1, deaths: 0, damage: 540, damageTaken: 120, shots: 80, hits: 31, headshots: 4, built: 12, destroyed: 3, crafted: 2, chests: 3, healed: 40, distance: 1800, harvested: 60, longestKill: 74, grenadeKills: 0, sniperKills: 1, score: 400 };
    const roster = [{ identId: 'player', name: p.name, isPlayer: true, isBot: false, team: 0, kills: 3, deaths: 0, assists: 1, damage: 540, placement: 1, score: 400, rp: p.rank.rp, level: p.level }];
    const r = Object.assign({ mode: 'br', ranked: true, mapName: 'Ashcrown Isle', won: true, draw: false, placement: 1, participants: 24, teamScores: null, playerTeam: 0, stats, duration: 612, roster, mvp: p.name, survived: 612, eventTag: null }, over);
    bf.finishMatch(r);
  }, over);
  // promotion: Flint I (390) -> Copper with a BR win
  await h.eval(() => { const p = window.__bf.meta.p; p.rank.rp = 390; p.rank.shield = 0; window.__bf.meta.save(); });
  await mk({});
  await h.run(1500);
  await h.shot('rk_promo_a');
  await h.run(4500);
  await h.shot('rk_promo_b');
  const a = await h.eval(() => ({ rp: window.__bf.meta.p.rank.rp, shield: window.__bf.meta.p.rank.shield }));
  console.log('after win', JSON.stringify(a));
  await h.eval(() => [...document.querySelectorAll('#ui button')].find((b) => /menu/i.test(b.textContent))?.click());
  await h.waitFor(() => window.__bf.state === 'menu', 30000);
  // demotion: Copper IV with no shield, ranked TDM loss
  await h.eval(() => { const p = window.__bf.meta.p; p.rank.rp = 405; p.rank.shield = 0; window.__bf.meta.save(); });
  await mk({ mode: 'tdm', mapName: 'Quarry', won: false, placement: 5, participants: 6, teamScores: [38, 50], duration: 430, survived: 430 });
  await h.run(5000);
  await h.shot('rk_demote');
  const b = await h.eval(() => ({ rp: window.__bf.meta.p.rank.rp }));
  console.log('after loss', JSON.stringify(b));
  await h.eval(() => [...document.querySelectorAll('#ui button')].find((b) => /menu/i.test(b.textContent))?.click());
  await h.waitFor(() => window.__bf.state === 'menu', 30000);
  // ladder
  await h.eval(() => [...document.querySelectorAll('#ui .tab')].find((b) => /ladder/i.test(b.textContent))?.click());
  await h.run(1200);
  await h.shot('rk_ladder');
  // season rollover: pretend the stored profile is from last season, then reload
  await h.eval(() => { const p = window.__bf.meta.p; p.rank.season -= 1; p.rank.rp = 1450; p.rank.seasonPeak = 1500; window.__bf.meta.save(); });
  await page.reload();
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.run(2500);
  await h.shot('rk_season');
  const c = await h.eval(() => ({ rp: window.__bf.meta.p.rank.rp, season: window.__bf.meta.p.rank.season, history: window.__bf.meta.p.history.length }));
  console.log('after season reset + reload', JSON.stringify(c));
}
