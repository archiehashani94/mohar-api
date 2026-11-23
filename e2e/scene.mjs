// Plays Story mode (scene view) like a presenter: run each step, let the animation finish, screenshot.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = new URL('./shots/scene/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/#/story');
await p.waitForTimeout(3500);
const btn = p.locator('button.btn-primary').last();
const idle = () => p.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 180000 });
for (let i = 0; i < 10; i++) {
  const label = (await btn.innerText()).trim();
  await p.screenshot({ path: `${OUT}${String(i).padStart(2, '0')}a.png` });
  if (!/^Next/.test(label)) {
    if (/Attack Lab/.test(label)) break;
    await btn.click();
    await p.waitForTimeout(400);
    await idle();
    await p.waitForTimeout(3200);
    await p.screenshot({ path: `${OUT}${String(i).padStart(2, '0')}b.png` });
  }
  console.log('step', i, label);
  // advance
  if (/^Next/.test((await btn.innerText()).trim())) await btn.click();
  await p.waitForTimeout(2600);
}
console.log('errors', errs);
await b.close();
