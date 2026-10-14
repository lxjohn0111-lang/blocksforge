// Generic driver: node tests/drive.mjs <script.js> [width] [height]
// The script exports async function(page, h) using helpers below.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
const [,, scriptPath, W = '1280', H = '720'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.setDefaultTimeout(240000);
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
const h = {
  logs,
  async waitFor(fn, timeout = 240000, arg) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await page.evaluate(fn, arg)) return true; } catch (e) { logs.push('[waitFor] ' + e.message); }
      await page.waitForTimeout(300);
    }
    throw new Error('waitFor timeout: ' + fn.toString().slice(0, 120));
  },
  async shot(name) {
    await page.evaluate(() => { window.__pause = true; });
    await page.waitForTimeout(200);
    // render one frame synchronously so the canvas shows current state
    await page.evaluate(() => { const a = window.__bf; if (a) { window.__pause = true; a.frame(0.016); } });
    await page.waitForTimeout(300);
    const out = path.join('tests/screens', name + '.png');
    await page.screenshot({ path: out, timeout: 240000 });
    await page.evaluate(() => { window.__pause = false; });
    console.log('shot', out);
  },
  async run(ms) { await page.waitForTimeout(ms); },
  eval: (fn, arg) => page.evaluate(fn, arg),
};
const mod = await import(path.resolve(scriptPath));
try {
  await page.goto('http://localhost:5173/');
  await mod.default(page, h);
} catch (e) {
  console.log('SCRIPT ERROR', e.message);
}
const uniq = [...new Set(logs)];
console.log('--- logs (' + logs.length + ') ---');
for (const l of uniq.slice(0, 40)) console.log(l.slice(0, 1500));
await browser.close();
