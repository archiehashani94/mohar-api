// Secondary flows: share → doctor opens (audited) → revoke+re-key → doctor blocked; break-glass 2-of-3; insurer renewal.
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = new URL('./shots/', import.meta.url).pathname;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('dialog', async (d) => (errors.push('alert: ' + d.message()), d.dismiss()));

// --- share with doctor
await p.goto(`${BASE}/#/vault`);
const enc = p.locator('div.rounded-xl', { hasText: 'Encounter' }).first();
await enc.getByRole('button', { name: /Share with/ }).click();
await enc.getByRole('button', { name: /Revoke \+ re-key/ }).waitFor({ timeout: 30000 });
console.log('shared with doctor');
// --- doctor opens
await p.goto(`${BASE}/#/doctor`);
await p.getByRole('button', { name: /Open \(logged\)/ }).first().click();
await p.getByText('FHIR R4 Bundle').waitFor({ timeout: 30000 });
console.log('doctor decrypted record');
await p.screenshot({ path: `${OUT}doctor.png`, fullPage: true });
// --- revoke + rekey
await p.goto(`${BASE}/#/vault`);
await p.locator('div.rounded-xl', { hasText: 'Encounter' }).first().getByRole('button', { name: /Revoke \+ re-key/ }).click();
await p.getByText(/re-key after revoke/).waitFor({ timeout: 40000 });
console.log('revoked + re-keyed');
await p.goto(`${BASE}/#/doctor`);
await p.getByText('no access').first().waitFor({ timeout: 20000 });
await p.getByRole('button', { name: /Open \(logged\)/ }).first().click();
await p.getByText(/Blocked/).waitFor({ timeout: 20000 });
console.log('doctor blocked after revoke:', await p.getByText(/Blocked/).first().textContent());
await p.goto(`${BASE}/#/vault`);
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}vault-audit.png`, fullPage: true });

// --- break-glass
await p.goto(`${BASE}/#/emergency`);
await p.getByRole('button', { name: /Scan Asha/ }).click();
await p.getByText(/0\/2 guardians/).waitFor({ timeout: 30000 });
await p.locator('section.card', { hasText: 'Ravi Verma' }).getByRole('button', { name: /Release my share/ }).click();
await p.getByText(/1\/2 guardians/).waitFor({ timeout: 30000 });
await p.getByRole('button', { name: /Reconstruct key/ }).first().click();
await p.getByText(/Holding 1 of 2 shares/).waitFor({ timeout: 20000 });
console.log('1 share → cannot decrypt (as expected)');
await p.locator('section.card', { hasText: 'Neha Verma' }).getByRole('button', { name: /Release my share/ }).click();
await p.getByText(/unlocked · 24h/).waitFor({ timeout: 30000 });
await p.getByRole('button', { name: /Reconstruct key/ }).first().click();
await p.getByText('Emergency card').first().waitFor({ timeout: 30000 });
console.log('2 shares → emergency card decrypted');
await p.screenshot({ path: `${OUT}emergency.png`, fullPage: true });

// --- insurer renewal for Rahul
await p.goto(`${BASE}/#/desk`);
await p.getByRole('button', { name: /Upgrade Rahul/ }).click();
await p.getByText(/✓ Issued/).waitFor({ timeout: 30000 });
console.log('insurer issued renewal');
await p.screenshot({ path: `${OUT}desk.png`, fullPage: true });

console.log('errors:', errors.length ? errors : 'none');
await b.close();
