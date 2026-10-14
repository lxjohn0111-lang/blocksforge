// Allocation hot spots during boot (sampling heap profiler incl. collected objects).
export default async function (page, h) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await page.goto('about:blank');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.goto(process.env.BF_URL || 'http://localhost:4173/');
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const self = new Map();
  const walk = (n, stack) => {
    const fr = n.callFrame; const name = `${fr.functionName || '(anon)'} ${(fr.url || '').split('/').pop()}:${fr.lineNumber}`;
    const st = [...stack, name];
    if (n.selfSize) { const key = st.slice(-3).join(' < '); self.set(key, (self.get(key) || 0) + n.selfSize); }
    for (const c of n.children || []) walk(c, st);
  };
  walk(profile.head, []);
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('total sampled MB', (tot / 1048576).toFixed(0));
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log((v / 1048576).toFixed(1).padStart(8) + ' MB  ' + k.slice(0, 220));
}
