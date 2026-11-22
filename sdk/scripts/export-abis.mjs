// Copies contract ABIs + circuit artifact into the app.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url).pathname;
const names = ['BINR', 'Regulator', 'ClaimSettlement', 'HealthVault', 'BreakGlass', 'HonkVerifier', 'PatientRegistry'];
const out = Object.fromEntries(names.map((n) => [n, JSON.parse(readFileSync(`${root}contracts/out/${n}.sol/${n}.json`, 'utf8')).abi]));
writeFileSync(`${root}app/src/abi.json`, JSON.stringify(out));
copyFileSync(`${root}circuits/claim/target/claim.json`, `${root}app/public/claim.json`);
console.log('abis + circuit exported');
