import { chromium } from 'playwright';
const src = new URL('../pitch/deck.html', import.meta.url).href;
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await p.goto(src, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.pdf({ path: new URL('../pitch/Mohar-pitch.pdf', import.meta.url).pathname, width: '1920px', height: '1080px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
const n = await p.locator('.slide').count();
for (const i of [0, 2, 7, 10, 12]) await p.locator('.slide').nth(i).screenshot({ path: `shots/deck-${i + 1}.png` });
console.log('slides', n); await b.close();
