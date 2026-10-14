// Visits every menu tab + settings, claims the daily reward, and checks the claim limit.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.run(1500);
  const clickText = (re) => h.eval((src) => { const r = new RegExp(src, 'i'); const b = [...document.querySelectorAll('#ui button, #ui .tab, #ui .btn')].find((e) => r.test(e.textContent.trim())); if (b) { b.click(); return b.textContent.trim().slice(0, 40); } return null; }, re.source);
  await h.shot('m_play');
  // daily reward
  const before = await h.eval(() => ({ coins: window.__bf.meta.p.coins, daily: { ...window.__bf.meta.p.daily } }));
  console.log('daily before', JSON.stringify(before));
  console.log('claim click', await clickText(/claim/));
  await h.run(1500);
  await h.shot('m_daily_claim');
  console.log('continue click', await clickText(/^(collect|continue|nice|awesome|ok)/));
  await h.run(600);
  const after = await h.eval(() => ({ coins: window.__bf.meta.p.coins, daily: { ...window.__bf.meta.p.daily }, canClaimAgain: window.__bf.meta.claimDaily() !== null }));
  console.log('daily after', JSON.stringify(after));
  for (const tab of ['Career', 'Locker', 'Armory', 'Ladder']) {
    console.log('tab', tab, await clickText(new RegExp('^' + tab + '$')));
    await h.run(1200);
    await h.shot('m_' + tab.toLowerCase());
  }
  console.log('tab Play', await clickText(/^Play$/));
  await h.run(500);
  await h.eval(() => window.__bf.openSettingsUI?.());
  await h.run(800);
  await h.shot('m_settings');
  for (const t of ['Controls', 'Audio', 'About']) {
    console.log('settings tab', t, await clickText(new RegExp('^' + t + '$')));
    await h.run(500);
    await h.shot('m_settings_' + t.toLowerCase());
  }
}
