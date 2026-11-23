// Plays the Story end-to-end with the keyboard, like a presenter. Screenshot per step.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/story', { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 960 }, ...(process.env.REC ? { recordVideo: { dir: 'videos', size: { width: 1600, height: 960 } } } : {}) });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/#/story');
await p.waitForTimeout(2500);
const wait = Number(process.env.PAUSE ?? 600);
async function press(n, waitFor) {
  await p.keyboard.press('ArrowRight');
  if (waitFor) await p.waitForFunction((t) => document.body.innerText.includes(t), waitFor, { timeout: 240000 });
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `shots/story/${String(n).padStart(2, '0')}.png` });
  const err = await p.locator('text=⛔').count();
  console.log('step', n, err ? 'ERROR ' + (await p.locator('text=⛔').first().textContent()) : 'ok');
}
// device view (V) and skip the opening "Today" scene
await p.keyboard.press('v');
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(800);
await p.screenshot({ path: 'shots/story/00.png' });
await press(1); // Begin
await press(2, '18+ ✓'); // Anon Aadhaar on-chain
await press(3, 'waiting for Asha'); // admit
await press(4); // next → consent
await press(5, 'Zero-knowledge proof'); // sign → advances to prove
await press(6, 'PROVEN'); // prove
await press(7); // next → settle
await press(8, 'relayed tx'); // settle → insurer
await press(9, 'recipient unlinkable'); // show insurer
await p.keyboard.press('x');
await p.waitForTimeout(500);
await p.screenshot({ path: 'shots/story/09x.png' });
await p.keyboard.press('x');
await press(10, 'searched'); // leak scan
console.log('leak:', (await p.locator('.chip', { hasText: /leak/ }).allTextContents()).join(','), 'record-hash row:', await p.locator('div', { hasText: /^Record hash/ }).last().textContent());
console.log('errors', errs.slice(0, 5));
await ctx.close();
await b.close();
