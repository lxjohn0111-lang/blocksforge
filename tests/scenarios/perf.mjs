// CPU cost of the simulation (no rendering) + a CDP profile of the hottest functions.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(400);
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  await h.eval(() => { window.__noRender = true; window.__pause = true; const bf = window.__bf; bf.simulate(5); bf.match.jumpFromShip(bf.match.player); bf.simulate(40); });
  const measure = () => h.eval(() => { const bf = window.__bf; const t0 = performance.now(); bf.simulate(3, 1 / 60); const ms = (performance.now() - t0) / 180; return { msPerStep: +ms.toFixed(3), alive: bf.match.aliveCount, items: bf.match.items.length, proj: bf.match.projectiles.length }; });
  console.log('br early', JSON.stringify(await measure()));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await h.eval(() => window.__bf.simulate(6, 1 / 60));
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('top self time:');
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(((v / tot) * 100).toFixed(1).padStart(5) + '%  ' + k);
  console.log('br later', JSON.stringify(await measure()));
}
