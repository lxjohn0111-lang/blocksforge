// Headless end-to-end smoke test.
//   npm run build && npm run test:e2e
// Boots the production build, plays a fast-forwarded slice of every mode,
// finishes matches, and checks the results flow, profile updates and persistence.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'fs';

if (!fs.existsSync('dist/index.html')) {
  console.error('dist/ missing — run `npm run build` first');
  process.exit(1);
}

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
const URL = 'http://localhost:4179/';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('crash', () => { console.log('FAIL  page crashed'); process.exit(1); });

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed++;
};
const waitFor = async (fn, timeout = 300000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await page.waitForTimeout(250);
  }
  return false;
};
const ev = (fn, arg) => page.evaluate(fn, arg);

async function startMode(sel) {
  await ev((s) => { window.__bf.settings.dynamicRes = false; window.__bf.play(s); }, sel);
  await page.waitForTimeout(400);
  await ev(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
  const ok = await waitFor(() => window.__bf.state === 'match');
  await ev(() => { window.__noRender = true; window.__pause = true; });
  return ok;
}
async function leaveToResults() {
  await ev(() => { window.__noRender = false; window.__pause = false; window.__bf.leaveMatch(); });
  const ok = await waitFor(() => window.__bf.state === 'results', 30000);
  await ev(() => [...document.querySelectorAll('#ui button')].find((b) => /menu/i.test(b.textContent))?.click());
  await waitFor(() => window.__bf.state === 'menu', 30000);
  return ok;
}

try {
  await page.goto(URL);
  await ev(() => localStorage.clear());
  await page.reload();
  check(await waitFor(() => window.__bf && window.__bf.state === 'match' && window.__bf.match.quick === true), 'first visit starts the Basics tutorial');
  await ev(() => window.__bf.leaveMatch());
  check(await waitFor(() => window.__bf.state === 'menu', 30000), 'Basics: skip -> main menu');
  check(await ev(() => window.__bf.meta.basicsDone), 'Basics: marked as done');
  const p0 = await ev(() => ({ ...window.__bf.meta.p.stats }));

  // ---- Battle Royale
  check(await startMode({ mode: 'br', ranked: true, tdmMap: 'rotation', loadout: 'assault' }), 'BR: lobby -> airship');
  const br = await ev(() => {
    const bf = window.__bf; const m = bf.match;
    bf.simulate(5);
    m.jumpFromShip(m.player);
    bf.simulate(30);
    const landed = !m.player.dropping && !m.player.gliding;
    const stormDeaths = [];
    m.events.on('kill', (e) => { if (e.cause === 'zone' && !e.victim.isPlayer) stormDeaths.push(Math.round(m.time)); });
    bf.simulate(90);
    const bots = m.combatants.filter((c) => !c.isPlayer && c.alive);
    return { landed, n: m.combatants.length, alive: m.aliveCount, zone: m.zone.phase, bots: bots.length, armed: bots.filter((c) => c.weapons.some(Boolean)).length, stormDeaths };
  });
  check(br.n === 24, `BR: 24 competitors (${br.n})`);
  check(br.landed, 'BR: player dropped, glided and landed');
  check(br.bots > 0 && br.armed / br.bots >= 0.5, `BR: most living bots found weapons (${br.armed}/${br.bots})`);
  check(br.alive >= 3, `BR: match still running after two minutes (${br.alive} alive)`);
  // the first storm deals 1 HP/s, so only a wounded or stranded bot can die to it
  check(br.stormDeaths.length <= 2, `BR: bots rotate out of the first storm (${br.stormDeaths.length} lost)`);
  check(br.zone >= 0, `BR: storm running (phase ${br.zone})`);
  check(await leaveToResults(), 'BR: leave -> results screen');

  // ---- Team Deathmatch
  check(await startMode({ mode: 'tdm', ranked: false, tdmMap: 'quarry', loadout: 'cqb' }), 'TDM: lobby -> match');
  const tdm = await ev(() => {
    const bf = window.__bf; const m = bf.match;
    const teams = [0, 1].map((t) => m.combatants.filter((c) => c.team === t).length);
    bf.simulate(150);
    const respawned = m.combatants.some((c) => c.stats.deaths > 0 && c.alive);
    return { teams, scores: [...m.scores], respawned };
  });
  check(tdm.teams[0] === 6 && tdm.teams[1] === 6, `TDM: 6v6 (${tdm.teams})`);
  check(tdm.scores[0] + tdm.scores[1] > 0, `TDM: kills scored (${tdm.scores.join('-')})`);
  check(tdm.respawned, 'TDM: eliminated players respawn');
  check(await leaveToResults(), 'TDM: leave -> results screen');

  // ---- Tutorial
  check(await startMode({ mode: 'tutorial', ranked: false, tdmMap: 'rotation', loadout: 'assault' }), 'Tutorial: starts');
  const tut = await ev(() => {
    const bf = window.__bf; const m = bf.match; const p = m.player; const I = bf.input;
    I.locked = true; for (let i = 0; i < 10; i++) { I.mouseDX += 120; bf.simulate(0.1); }
    const s = m.map.stations.move; I.down.add('KeyW');
    for (let t = 0; t < 15 && m.step.id === 'move'; t += 0.1) { p.yaw = Math.atan2(-(s.x - p.body.pos.x), -(s.z - p.body.pos.z)); bf.simulate(0.1); }
    I.down.delete('KeyW'); bf.simulate(0.6);
    return m.index;
  });
  check(tut >= 2, `Tutorial: look + move steps complete (step ${tut})`);
  check(await leaveToResults(), 'Tutorial: exit -> results');

  // ---- Persistence
  const p1 = await ev(() => ({ ...window.__bf.meta.p.stats }));
  check(p1.matches >= p0.matches + 2, `profile recorded matches (${p0.matches} -> ${p1.matches})`);
  await page.reload();
  check(await waitFor(() => window.__bf && window.__bf.state === 'menu'), 'reboots after reload');
  const p2 = await ev(() => ({ matches: window.__bf.meta.p.stats.matches, history: window.__bf.meta.p.history.length }));
  check(p2.matches === p1.matches && p2.history >= 2, `progress persisted across reload (${p2.matches} matches, ${p2.history} history)`);
} catch (e) {
  check(false, 'unexpected error: ' + e.message);
}
check(errors.length === 0, `no console errors${errors.length ? ': ' + [...new Set(errors)].slice(0, 5).join(' | ') : ''}`);
await browser.close();
server.httpServer.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
