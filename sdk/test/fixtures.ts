import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { HOSP_DEPTH, MerkleTree, hospitalLeaf, newPolicy, randomField, consentKeyFor } from '../src/index.js';

export const circuit = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../circuits/claim/target/claim.json', import.meta.url)), 'utf8'),
);

export const DAY = 86400;
export const NOW = 1_795_000_000; // fixed clock for deterministic tests (~Nov 2026)

export async function world() {
  const patient = new Wallet('0x' + '11'.repeat(32));
  const hospitalSecrets = [randomField(), randomField(), randomField()];
  const leaves = await Promise.all(hospitalSecrets.map(hospitalLeaf));
  const tree = await MerkleTree.build(HOSP_DEPTH, leaves);
  const policyId = randomField();
  const consent = consentKeyFor(patient.privateKey, policyId);
  const policy = newPolicy({
    policyId,
    planName: 'Arogya Shield Gold',
    insurerName: 'Demo General Insurance',
    patientName: 'Asha Verma',
    patientPubKey: consent.publicKey,
    startDate: NOW - 400 * DAY,
    endDate: NOW + 300 * DAY,
    waitingUntil: NOW - 300 * DAY,
    sumInsured: 50000000, // ₹5,00,000
    deductible: 500000, // ₹5,000
    copayBps: 1000, // 10%
    coveredProcedures: ['SG039', 'MO012', 'SO051', 'MC011', 'OR004'],
    exclusions: ['Z41.1', 'N97.9'],
  });
  return { patient: { privateKey: consent.privateKey, wallet: patient }, hospitalSecrets, tree, policy };
}
