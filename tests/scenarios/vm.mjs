// Viewmodel check: every weapon at hip and ADS, rendered through normal frames.
export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  const weapons = (process.env.VM_WEAPONS || 'p9,ranger,longshot,arbiter').split(',');
  for (const w of weapons) {
    await h.eval((w) => {
      const bf = window.__bf; const m = bf.match; const p = m.player; window.__pause = true;
      p.weapons = [null, null, null]; p.giveWeapon(w); p.ammo.heavy = 30; p.ammo.medium = 90; p.ammo.light = 90; p.ammo.shells = 20; p.ammo.rockets = 3;
      m.switchSlot(p, 1); m.switchSlot(p, 0); p.yaw = 0; p.pitch = 0.02;
      window.__noRender = true; for (let i = 0; i < 90; i++) bf.frame(1 / 60); window.__noRender = false;
    }, w);
    await h.shot('vm_' + w + '_hip');
    await h.eval(() => { const bf = window.__bf; window.__pause = true; bf.input.locked = true; bf.input.down.add('Mouse2'); window.__noRender = true; for (let i = 0; i < 60; i++) bf.frame(1 / 60); window.__noRender = false; });
    await h.shot('vm_' + w + '_ads');
    const st = await h.eval(() => { const bf = window.__bf; const vm = bf.pc.vm; return { ads: +bf.match.player.ads.toFixed(2), vis: vm.root.visible, pos: vm.root.position.toArray().map((v) => +v.toFixed(2)), cam: bf.engine.camera.position.toArray().map((v) => +v.toFixed(2)), pivot: vm.pivot.position.toArray().map((v) => +v.toFixed(3)), scale: vm.pivot.scale.x }; });
    console.log(w, JSON.stringify(st));
    await h.eval(() => { const bf = window.__bf; bf.input.down.delete('Mouse2'); window.__noRender = true; for (let i = 0; i < 30; i++) bf.frame(1 / 60); window.__noRender = false; });
  }
}
