export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  await h.eval(() => {
    const bf = window.__bf; const m = bf.match; const p = m.player; window.__pause = true; window.__noRender = true;
    p.weapons = [null, null, null]; p.giveWeapon('p9'); p.ammo.light = 90; m.switchSlot(p, 1); m.switchSlot(p, 0);
    for (let i = 0; i < 90; i++) bf.frame(1 / 60);
    window.__noRender = false;
  });
  for (let i = 1; i <= 3; i++) {
    await h.shot('vm3_frame' + i);
    const info = await h.eval(() => { const vm = window.__bf.pc.vm; const r = window.__bf.engine.renderer; return { calls: r.info.render.calls, programs: r.info.programs?.length, geoms: r.info.memory.geometries, vis: vm.root.visible }; });
    console.log('frame', i, JSON.stringify(info));
  }
}
