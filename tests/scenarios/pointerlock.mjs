// pointer lock refused once: cursor steering for now, and the next click gets a real lock
export default async function (page, h) {
  const ok = (c, m) => console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.eval(() => window.__bf.play({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }));
  await h.waitFor(() => window.__bf.state === 'match', 400000);
  await h.run(1000);
  const st = () => h.eval(() => ({ real: document.pointerLockElement === document.getElementById('game'), locked: window.__bf.input.locked, cursor: window.__bf.input.cursorSteering, calls: window.__lockCalls || 0, overlay: window.__bf.hud.overlay }));
  const resume = async () => {
    const btn = page.locator('#ui button', { hasText: 'Resume' });
    const box = await btn.first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await h.run(800);
  };
  // the next request will be refused (a host that does not allow pointer lock, an unsupported option)
  await h.eval(() => {
    const orig = HTMLCanvasElement.prototype.requestPointerLock;
    let n = 0;
    HTMLCanvasElement.prototype.requestPointerLock = function (...a) {
      window.__lockCalls = ++n;
      if (n === 1) { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 10); return Promise.reject(new Error('refused')); }
      return orig.apply(this, a);
    };
    if (document.pointerLockElement) document.exitPointerLock();
  });
  await h.run(2200);
  ok((await st()).overlay === 'pause', `lock dropped: pause menu: ${JSON.stringify(await st())}`);
  await resume();
  const a = await st();
  ok(a.locked && a.overlay === 'none' && a.cursor !== a.real, `Resume after a refusal: back in play, either cursor steering or a real lock, never both: ${JSON.stringify(a)}`);
  await h.run(600);
  await page.mouse.click(640, 200);
  await h.run(800);
  const b = await st();
  ok(b.real && b.locked && !b.cursor, `the next click in the game locks the mouse for real: ${JSON.stringify(b)}`);
  await h.eval(() => document.exitPointerLock());
  await h.run(2200);
  ok((await st()).overlay === 'pause', 'Esc: pause menu');
  await resume();
  const d = await st();
  ok(d.real && d.locked && !d.cursor, `Resume locks it again: ${JSON.stringify(d)}`);
}
