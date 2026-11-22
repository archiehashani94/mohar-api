// Generates a REAL proof + public inputs for the Foundry tests (contracts/test/fixtures/claim.json).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hexlify } from 'ethers';
import {
  ClaimProver,
  buildWitnessInput,
  prepareClaim,
  signConsent,
  ghostWallet,
  claimNullifier,
  toHex32,
} from '../src/index.js';
import { circuit, world, NOW } from '../test/fixtures.js';

const w = await world();
const prover = new ClaimProver(circuit);
const recordHash = 0x1234567890abcdefn;

async function one(usedBefore: number, procedure: string, bill: number[]) {
  const n = await claimNullifier(w.policy, recordHash, procedure);
  const recipient = ghostWallet(w.hospitalSecrets[0], n).address;
  const draft = { policy: w.policy, diagnosis: 'K35.80', procedure, recordHash, billItems: bill, claimDate: NOW, usedBefore, recipient };
  const prep = await prepareClaim(draft);
  const sig = signConsent(w.patient.privateKey, prep.digest);
  const { input, pub } = await buildWitnessInput(draft, { secret: w.hospitalSecrets[0], tree: w.tree }, sig);
  const p = await prover.prove(input);
  if (!(await prover.verify(p))) throw new Error('local verify failed');
  return {
    proof: hexlify(p.proof),
    hospitalRoot: toHex32(pub.hospitalRoot),
    policyCommitment: toHex32(pub.policyCommitment),
    nullifier: toHex32(pub.nullifier),
    claimDate: pub.claimDate,
    usedBefore: pub.usedBefore,
    payoutAmount: pub.payoutAmount,
    payoutRecipient: pub.payoutRecipient,
  };
}

const first = await one(0, 'SG039', [900000, 3500000, 2000000, 800000, 450000, 350000]);
// second claim on same policy (different procedure) proven against used_before = first payout
const second = await one(first.payoutAmount, 'MO012', [300000, 6500000, 1500000, 400000]);

const dir = fileURLToPath(new URL('../../contracts/test/fixtures/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'claim.json', JSON.stringify({ first, second }, null, 2));
console.log('fixture written', first.payoutAmount, second.payoutAmount);
process.exit(0);
