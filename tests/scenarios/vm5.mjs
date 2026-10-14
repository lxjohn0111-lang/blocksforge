export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  const info = await h.eval(() => {
    const bf = window.__bf; const m = bf.match; const p = m.player; window.__pause = true; window.__noRender = true;
    p.addMat('wood', 50); m.switchSlot(p, 6);
    for (let i = 0; i < 30; i++) bf.frame(1 / 60);
    const vm = bf.pc.vm; const eng = bf.engine;
    vm.root.updateMatrixWorld(true);
    const P = (o) => { const v = o.position.clone(); o.getWorldPosition(v); return v.toArray().map((x) => +x.toFixed(3)); };
    const chain = []; let o = vm.item; while (o) { chain.push({ type: o.type, name: o.name, pos: o.position.toArray().map((x) => +x.toFixed(3)), scale: o.scale.toArray(), auto: o.matrixAutoUpdate, world: P(o) }); o = o.parent; }
    const geo = vm.item.geometry; geo.computeBoundingBox();
    const bb = geo.boundingBox;
    return { chain, bbMin: bb.min.toArray().map((x) => +x.toFixed(3)), bbMax: bb.max.toArray().map((x) => +x.toFixed(3)), cam: eng.camera.position.toArray().map((x) => +x.toFixed(2)), camQuat: eng.camera.quaternion.toArray().map((x) => +x.toFixed(3)), rootQuat: vm.root.quaternion.toArray().map((x) => +x.toFixed(3)), attrs: Object.keys(geo.attributes) };
  });
  console.log(JSON.stringify(info, null, 1));
}
