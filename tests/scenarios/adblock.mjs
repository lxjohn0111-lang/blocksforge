// A returning player (straight to the menu) with an ad blocker's cosmetic filters: EasyList's generic
// hide rules (plain CSS selectors, one per line, without the leading "##") are applied as display:none,
// then every screen is checked for UI that vanished. Get the list first and pass its path:
//   curl -s https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt \
//     | grep '^##' | sed 's/^##//' > /tmp/easylist_generic.txt
//   BF_EASYLIST=/tmp/easylist_generic.txt node tests/drive.mjs tests/scenarios/adblock.mjs 1280 720
import fs from 'fs';

export default async function (page, h) {
  const ok = (c, m) => console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  const rules = fs.readFileSync(process.env.BF_EASYLIST || '/tmp/easylist_generic.txt', 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  await h.run(1500);
  // what is on screen before the filters, then what of it they hide
  const snap = () => h.eval(() => [...document.querySelectorAll('body, #ui, #ui *')].filter((e) => e.checkVisibility()).map((e) => e));
  const hiddenBy = async (label) => {
    await h.eval(() => { window.__vis = new Set([document.body, ...document.querySelectorAll('#ui, #ui *')].filter((e) => e.checkVisibility())); });
    const n = await h.eval((rules) => {
      let s = document.getElementById('__easylist');
      if (!s) {
        s = document.createElement('style');
        s.id = '__easylist';
        document.head.appendChild(s);
        let n = 0;
        for (const r of rules) {
          try { s.sheet.insertRule(`${r}{display:none!important}`, s.sheet.cssRules.length); n++; } catch { /* not plain CSS */ }
        }
        return n;
      }
      return s.sheet.cssRules.length;
    }, rules);
    await h.run(200);
    const gone = await h.eval(() => [...window.__vis].filter((e) => !e.checkVisibility()).filter((e) => !e.parentElement || window.__vis.has(e.parentElement) && e.parentElement.checkVisibility()).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`));
    ok(!gone.length, `${label}: nothing hidden by ${n} EasyList rules${gone.length ? ': ' + gone.slice(0, 12).join(' | ') : ''}`);
    await h.eval(() => document.getElementById('__easylist').disabled = true);
  };
  const reapply = () => h.eval(() => { const s = document.getElementById('__easylist'); if (s) s.disabled = false; });
  await hiddenBy('menu (returning player)');
  for (const t of ['Career', 'Locker', 'Armory', 'Ladder', 'Play']) {
    await h.eval((t) => [...document.querySelectorAll('.topbar .tab')].find((b) => b.textContent === t)?.click(), t);
    await h.run(400);
    await reapply();
    await hiddenBy(`menu ${t}`);
  }
  await h.eval(() => document.querySelector('.wheelcard')?.click());
  await h.run(500);
  await reapply();
  await hiddenBy('lucky wheel');
  await h.eval(() => document.querySelector('.wheel-close')?.click());
  await h.eval(() => { window.__bf.settings.dynamicRes = false; window.__bf.play({ mode: 'br', ranked: false, tdmMap: 'rotation', loadout: 'assault' }); });
  await h.waitFor(() => window.__bf.state === 'match', 120000);
  await h.eval(() => { window.__pause = true; window.__noRender = true; const bf = window.__bf; const m = bf.match; bf.simulate(5); m.jumpFromShip(m.player); for (let i = 0; i < 60 && (m.player.dropping || m.player.gliding); i++) bf.simulate(1); bf.frame(1 / 30); });
  await reapply();
  await hiddenBy('battle royale HUD');
  await h.eval(() => { const m = window.__bf.match; m.damage(m.player, 500, { attacker: m.combatants.find((c) => !c.isPlayer && c.alive), kind: 'bullet', weapon: 'Ranger AR' }); for (let i = 0; i < 60; i++) window.__bf.frame(1 / 30); });
  await h.run(1600);
  await h.eval(() => window.__bf.frame(1 / 30));
  await reapply();
  await hiddenBy('death screen');
  await h.eval(() => [...document.querySelectorAll('.death .btn')].find((b) => /Continue/.test(b.textContent))?.click());
  await h.eval(() => { window.__pause = false; window.__noRender = false; });
  await h.waitFor(() => window.__bf.state === 'results' && !!document.querySelector('.res2'), 60000);
  await h.run(1500);
  await h.eval(() => document.querySelectorAll('.reveal .btn').forEach((b) => b.click()));
  await reapply();
  await hiddenBy('results');
}
