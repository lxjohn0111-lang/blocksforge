export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  for (const [slot, name] of [[6, 'hammer'], [5, 'pick'], [3, 'heal'], [4, 'frag']]) {
    const info = await h.eval(([slot]) => {
      const bf = window.__bf; const m = bf.match; const p = m.player; window.__pause = true; window.__noRender = true;
      p.addMat('wood', 50); p.addHeal('bandage', 2); p.addThrow('frag', 2);
      m.switchSlot(p, slot);
      for (let i = 0; i < 90; i++) bf.frame(1 / 60);
      window.__noRender = false;
      const vm = bf.pc.vm; const eng = bf.engine; const v = vm.root.position.clone();
      eng.vmCamera.position.copy(eng.camera.position); eng.vmCamera.quaternion.copy(eng.camera.quaternion); eng.vmCamera.updateMatrixWorld();
      vm.root.updateMatrixWorld(true);
      let ndc = null; if (vm.item) { vm.item.getWorldPosition(v); ndc = v.clone().project(eng.vmCamera).toArray().map((x) => +x.toFixed(2)); }
      return { slot: p.slot, holding: vm.holding.kind, rootVis: vm.root.visible, item: !!vm.item, itemVis: vm.item?.visible, ndc, pivot: vm.pivot.position.toArray().map((x) => +x.toFixed(3)), rot: [vm.pivot.rotation.x, vm.pivot.rotation.y, vm.pivot.rotation.z].map((x) => +x.toFixed(2)) };
    }, [slot]);
    console.log(name, JSON.stringify(info));
    await h.shot('vm4_' + name);
  }
}
