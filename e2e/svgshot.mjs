import { chromium } from 'playwright';
const [,, src, out, w, h] = process.argv;
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
await p.goto('file://' + src); await p.waitForTimeout(800); await p.screenshot({ path: out }); await b.close();
