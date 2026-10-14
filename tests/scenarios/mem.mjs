// GPU/JS memory accounting across menu -> tutorial -> menu -> BR.
export default async function (page, h) {
  const cdp = await page.context().newCDPSession(page);
  const probe = async (label) => {
    const r = await h.eval(() => {
      const bf = window.__bf; const eng = bf.engine; const info = eng.renderer.info;
      let geoBytes = 0, geoCount = 0, verts = 0; const seen = new Set();
      const scenes = [eng.scene, eng.vmScene, eng.skyScene].filter(Boolean);
      for (const s of scenes) s.traverse((o) => {
        const g = o.geometry; if (!g || seen.has(g)) return; seen.add(g); geoCount++;
        for (const k in g.attributes) geoBytes += g.attributes[k].array.byteLength;
        if (g.index) geoBytes += g.index.array.byteLength;
        verts += g.attributes.position ? g.attributes.position.count : 0;
      });
      const chunks = (eng.chunks?.chunks ?? []).length;
      return { state: bf.state, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length, sceneGeoMB: +(geoBytes / 1048576).toFixed(1), sceneGeoCount: geoCount, verts, chunks, jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
    });
    const m = await cdp.send('Memory.getBrowserSamplingProfile').catch(() => null);
    console.log(label, JSON.stringify(r));
  };
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await probe('menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  await h.eval(() => { window.__noRender = true; window.__pause = true; window.__bf.simulate(20); });
  await probe('tutorial');
  await h.eval(() => { window.__bf.leaveMatch(); window.__pause = false; window.__noRender = false; });
  await h.waitFor(() => window.__bf.state === 'results', 60000);
  await h.eval(() => [...document.querySelectorAll('#ui button')].find((b) => /menu/i.test(b.textContent))?.click());
  await h.waitFor(() => window.__bf.state === 'menu', 60000);
  await probe('menu again');
  await h.eval(() => { window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.run(400);
  await h.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  await h.waitFor(() => window.__bf.state === 'match');
  await h.eval(() => { window.__noRender = true; window.__pause = true; const bf = window.__bf; bf.simulate(5); bf.match.jumpFromShip(bf.match.player); bf.simulate(60); });
  await probe('br');
}
