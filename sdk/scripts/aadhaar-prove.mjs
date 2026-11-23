// Generates (and caches) a REAL Anon Aadhaar Groth16 proof binding a test-mode Aadhaar QR to a wallet.
// snarkjs on CPU: ~4 min, ~7 GB RAM. Onboarding is one-time per patient, so proofs are cached by signal.
//   node scripts/aadhaar-prove.mjs <walletAddress> [nullifierSeed]
import { init, prove, verify, generateArgs, ArtifactsOrigin, packGroth16Proof } from '@anon-aadhaar/core';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const A = root + '.cache/anon-aadhaar/';
const signal = process.argv[2];
const seed = process.argv[3] ?? '11651504'; // 0xB1C8B0 — Kavach's app-scoped nullifier seed
const out = `${A}proof-${signal.toLowerCase()}-${seed}.json`;
if (existsSync(out)) { console.log('cached', out); process.exit(0); }
mkdirSync(A, { recursive: true });
await init({ wasmURL: A + 'aadhaar-verifier.wasm', zkeyURL: A + 'circuit_final.zkey', vkeyURL: A + 'vkey.json', artifactsOrigin: ArtifactsOrigin.local });
const { testQRData } = JSON.parse(readFileSync(root + 'sdk/assets/anon-aadhaar/dataInput.json', 'utf8'));
const args = await generateArgs({
  qrData: testQRData,
  certificateFile: readFileSync(root + 'sdk/assets/anon-aadhaar/testCertificate.pem', 'utf8'),
  nullifierSeed: Number(seed),
  signal,
  fieldsToRevealArray: ['revealAgeAbove18', 'revealState'],
});
const t0 = Date.now();
const pcd = await prove(args);
const ms = Date.now() - t0;
if (!(await verify(pcd, true))) throw new Error('local verify failed');
const p = pcd.proof;
writeFileSync(out, JSON.stringify({
  signal, nullifierSeed: p.nullifierSeed, nullifier: p.nullifier, timestamp: p.timestamp,
  revealArray: [p.ageAbove18, p.gender, p.pincode, p.state],
  groth16Proof: packGroth16Proof(p.groth16Proof), pubkeyHash: p.pubkeyHash, proveMs: ms,
}, null, 1));
console.log('proved in', ms, 'ms →', out);
process.exit(0);
