// Usage: node tests/shot.mjs "<url path+query>" out.png [waitMs] [width] [height]
import { chromium } from 'playwright';
const [,, path = '/', out = 'tests/screens/shot.png', wait = '6000', W = '1280', H = '720'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173' + path);
await page.waitForTimeout(+wait);
await page.evaluate(() => { window.__pause = true; });
await page.waitForTimeout(500);
const stats = await page.evaluate(() => ({ stats: window.__stats, frames: window.__frames }));
console.log(JSON.stringify(stats));
page.setDefaultTimeout(180000);
const url = await page.evaluate(() => (window.__capture ? window.__capture() : null));
if (url) {
  const fs = await import('fs');
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
} else {
  await page.screenshot({ path: out, timeout: 120000 });
}
for (const l of logs.slice(0, 30)) console.log(l.slice(0, 2000));
await browser.close();
