export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  const r = await h.eval(() => {
    const bf = window.__bf; const m = bf.match; const p = m.player; window.__pause = true; window.__noRender = true;
    p.weapons = [null, null, null]; p.giveWeapon('ranger'); p.ammo.medium = 90; m.switchSlot(p, 1); m.switchSlot(p, 0);
    for (let i = 0; i < 90; i++) bf.frame(1 / 60);
    const vm = bf.pc.vm; const eng = bf.engine;
    eng.vmCamera.position.copy(eng.camera.position); eng.vmCamera.quaternion.copy(eng.camera.quaternion); eng.vmCamera.updateMatrixWorld();
    const out = {};
    const T = window.THREE_V3 || vm.root.position.constructor;
    const v = new T();
    vm.root.updateMatrixWorld(true);
    out.rootVis = vm.root.visible; out.pivotVis = vm.pivot.visible; out.gunVis = vm.gun?.group.visible;
    out.inScene = eng.vmScene.children.includes(vm.root);
    out.vmSceneChildren = eng.vmScene.children.length;
    out.pivotLocal = vm.pivot.position.toArray().map((x) => +x.toFixed(3));
    out.pivotRot = [vm.pivot.rotation.x, vm.pivot.rotation.y, vm.pivot.rotation.z].map((x) => +x.toFixed(3));
    vm.gun.group.getWorldPosition(v); out.gunWorld = v.toArray().map((x) => +x.toFixed(2)); out.cam = eng.camera.position.toArray().map((x) => +x.toFixed(2));
    const ndc = v.clone().project(eng.vmCamera); out.gunNdc = ndc.toArray().map((x) => +x.toFixed(2));
    out.vmFov = eng.vmCamera.fov; out.aspect = eng.vmCamera.aspect; out.near = eng.vmCamera.near;
    out.meshes = []; vm.gun.group.traverse((o) => { if (o.isMesh) out.meshes.push({ vis: o.visible, verts: o.geometry.getAttribute('position')?.count, mat: o.material.type, transparent: o.material.transparent }); });
    out.matUniforms = Object.keys(vm.material.uniforms).slice(0, 30);
    out.equipT = vm.equipT; out.sprintBlend = vm.sprintBlend;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
}
