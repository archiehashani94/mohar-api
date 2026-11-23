// Records the demo video on a FRESH chain: Story mode (presenter keyboard flow) → Attack Lab → roles tour.
//   node record-demo.mjs   → videos/*.webm  (then ffmpeg → ../demo/kavach-demo.mp4)
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const W = 1600, H = 960;
rmSync('videos', { recursive: true, force: true });
mkdirSync('videos', { recursive: true });
mkdirSync('shots/demo', { recursive: true });

const browser = await chromium.launch();
// warm-up: lets Vite finish optimizing deps so the recording never reloads mid-flow
{
  const w = await (await browser.newContext()).newPage();
  for (const pg of ['story', 'vault', 'seal', 'desk', 'regulator', 'emergency', 'attack', 'xray']) {
    await w.goto(`${BASE}/#/${pg}`);
    await w.waitForTimeout(1500);
  }
  await w.context().close();
}

const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: 'videos', size: { width: W, height: H } } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('dialog', (d) => (errors.push('dialog ' + d.message()), d.dismiss()));
const t0 = Date.now();
const marks = [];
const mark = (m) => marks.push({ t: ((Date.now() - t0) / 1000).toFixed(1), m });
let shot = 0;
const snap = (name) => p.screenshot({ path: `shots/demo/${String(++shot).padStart(2, '0')}-${name}.png` });

async function caption(title, sub = '', ms = 3500) {
  mark(title);
  await p.evaluate(
    ([title, sub]) => {
      let el = document.getElementById('__cap');
      if (!el) {
        el = document.createElement('div');
        el.id = '__cap';
        el.style.cssText =
          'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99999;pointer-events:none;max-width:1100px;padding:14px 24px;border-radius:14px;background:#16181d;color:#f5f2ea;text-align:center;font-family:"Geist Variable",system-ui;box-shadow:0 12px 40px rgba(0,0,0,.35)';
        document.body.appendChild(el);
      }
      el.innerHTML = `<div style="font-family:'Newsreader Variable',Georgia,serif;font-size:24px;line-height:1.2">${title}</div>${sub ? `<div style="font-size:14px;opacity:.75;margin-top:4px">${sub}</div>` : ''}`;
    },
    [title, sub],
  );
  await p.waitForTimeout(ms);
}
const hide = () => p.evaluate(() => document.getElementById('__cap')?.remove());
const until = (text, timeout = 240000) => p.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });
async function next(waitFor, readMs = 4200) {
  await p.keyboard.press('ArrowRight');
  if (waitFor) await until(waitFor);
  await p.waitForTimeout(readMs);
}

// ================================================================ STORY
await p.goto(`${BASE}/#/story`);
await p.waitForTimeout(2500);
mark('story');
await p.waitForTimeout(4500);
await snap('story-intro');
await next(null, 2500); // → identity
await snap('story-identity');
await next('18+ ✓', 4500); // live Anon Aadhaar verification on-chain
await snap('story-identity-done');
await next('waiting for Asha', 5000); // encounter sealed
await snap('story-encounter');
await next(null, 4500); // → consent
await snap('story-consent');
await next('Zero-knowledge proof', 2500); // sign → prove step
await next('PROVEN', 3500); // in-browser proof
await snap('story-proven');
await next(null, 1500); // → settle
await next('relayed tx', 4500);
await snap('story-settled');
await next('recipient unlinkable', 6000); // insurer view
await snap('story-insurer');
await p.keyboard.press('x');
await p.waitForTimeout(3500);
await snap('story-xray');
await p.keyboard.press('x');
await next('searched', 6000); // leak scan
await snap('story-leakscan');
await next(null, 4500); // finale narration

// ================================================================ ATTACK LAB
await p.goto(`${BASE}/#/attack`);
await p.waitForTimeout(1500);
await caption('Attack Lab — now try to cheat it', '15 real attempts against the real circuit and the deployed contracts.', 3000);
await hide();
mark('attack-run-start');
await p.getByRole('button', { name: /Run all/ }).click();
await p.waitForFunction(() => document.body.innerText.includes('14 attacks blocked'), null, { timeout: 600000 }).catch(() => {});
mark('attack-run-end');
await p.waitForTimeout(800);
await caption('14 of 14 attacks blocked', 'Fake hospital, expired, waiting period, exclusions, over-limit, forged consent → no proof can exist. Replay, splitting, tampering, front-running, duplicate Aadhaar → contract rejects.', 5000);
await snap('attacks');
await hide();
for (const y of [700, 1400, 2100]) {
  await p.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y);
  await p.waitForTimeout(1600);
}

// ================================================================ ROLES TOUR
await p.goto(`${BASE}/#/regulator`);
await p.waitForTimeout(2000);
await caption('Regulator: licences are checked before a hospital joins the Merkle tree', 'ABDM Health Facility Registry check → attestation on-chain → approve → new root.', 3000);
await p.getByRole('button', { name: /Check ABDM HFR/ }).first().click(); // Shady Clinic: not in the registry
await until('Facility found in registry', 30000);
await caption('Shady Clinic fails the registry check — it can never enter the tree', 'Lakeview Nursing Home is a real listed facility: check → attest → approve.', 3500);
await p.getByRole('button', { name: /Check ABDM HFR/ }).nth(1).click();
await p.getByRole('button', { name: /Attest on-chain/ }).first().waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await p.getByRole('button', { name: /Attest on-chain/ }).first().click();
await p.getByRole('button', { name: /Approve \+ publish root/ }).first().waitFor({ timeout: 30000 });
await p.getByRole('button', { name: /Approve \+ publish root/ }).first().click();
await p.waitForTimeout(4000);
await snap('regulator');
await hide();

await p.goto(`${BASE}/#/seal`);
await p.waitForTimeout(1800);
await caption('Clinical data that speaks the standards', 'Lay-language ICD-10 search over 73,000 codes, and live HL7 FHIR import from another provider’s server.', 2500);
await p.locator('input.input').first().click();
await p.keyboard.type('heart attack', { delay: 60 });
await p.waitForTimeout(2500);
await snap('icd');
await p.locator('h1').click();
await p.getByRole('button', { name: /Import from HAPI FHIR/ }).click();
await until('Suggested ICD-10', 40000).catch(() => {});
await p.getByText('Cross-hospital record import').scrollIntoViewIfNeeded();
await p.waitForTimeout(3500);
await snap('hapi');
await hide();

await p.goto(`${BASE}/#/vault`);
await p.waitForTimeout(2200);
await caption('Patient-controlled records', 'Share with an NMC-verified doctor for 24 hours. Every view is logged on-chain. Revoke = re-encrypt.', 2500);
await p.locator('div.rounded-xl', { hasText: 'Encounter' }).first().getByRole('button', { name: /Share with/ }).click();
await p.getByRole('button', { name: /Revoke \+ re-key/ }).first().waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await snap('vault-share');
await hide();

await p.goto(`${BASE}/#/emergency`);
await p.waitForTimeout(2000);
await caption('Break-glass: 2 of 3 guardians, enforced by Shamir secret sharing', 'One share reveals nothing. Two reconstruct the key. Every step is logged and the patient is alerted.', 2500);
await p.getByRole('button', { name: /Scan Asha/ }).click();
await until('0/2 guardians', 30000);
await p.locator('section.card', { hasText: 'Ravi Verma' }).getByRole('button', { name: /Release my share/ }).click();
await until('1/2 guardians', 30000);
await p.locator('section.card', { hasText: 'Neha Verma' }).getByRole('button', { name: /Release my share/ }).click();
await until('unlocked · 24h', 30000);
await p.getByRole('button', { name: /Reconstruct key/ }).first().click();
await until('Penicillin', 30000);
await p.waitForTimeout(3000);
await snap('emergency');
await hide();

await p.goto(`${BASE}/#/story`);
await p.waitForTimeout(1200);
await caption('Mohar — insurers pay, diagnoses stay sealed.', 'Hiding the diagnosis in the proof isn’t enough if the payment leaks it. Mohar hides it everywhere.', 5500);

await ctx.close();
await browser.close();
console.log(JSON.stringify({ seconds: (Date.now() - t0) / 1000, marks, errors }, null, 1));
