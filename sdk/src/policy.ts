// Insurance policy model + Poseidon2 commitment (only the commitment goes on-chain).
import { SigningKey, getBytes } from 'ethers';
import { DOM, codeToField, poseidon2, randomField } from './hash.js';
import { MerkleTree } from './merkle.js';

export const PROC_DEPTH = 5;
export const HOSP_DEPTH = 8;
export const N_EXCL = 4;
export const N_ITEMS = 6;

export interface Policy {
  policyId: bigint;
  planName: string;
  insurerName: string;
  patientName: string;
  patientPubKey: string; // uncompressed secp256k1 0x04…
  startDate: number; // unix seconds
  endDate: number;
  waitingUntil: number;
  sumInsured: number; // paise
  deductible: number; // paise
  copayBps: number; // 1000 = 10%
  coveredProcedures: string[]; // procedure codes
  exclusions: string[]; // ICD-10 diagnosis codes excluded
  salt: bigint;
}

export function splitPubKey(pub: string): { x: Uint8Array; y: Uint8Array } {
  const full = SigningKey.computePublicKey(pub, false); // 0x04 + x + y
  const bytes = getBytes('0x' + full.slice(4));
  return { x: bytes.slice(0, 32), y: bytes.slice(32, 64) };
}

function limbs(b: Uint8Array): [bigint, bigint] {
  let hi = 0n;
  let lo = 0n;
  for (let i = 0; i < 16; i++) {
    hi = (hi << 8n) | BigInt(b[i]);
    lo = (lo << 8n) | BigInt(b[i + 16]);
  }
  return [hi, lo];
}

export async function patientKeyHash(pub: string): Promise<bigint> {
  const { x, y } = splitPubKey(pub);
  return poseidon2([DOM.PATIENT, ...limbs(x), ...limbs(y)]);
}

export async function procedureLeaf(code: string): Promise<bigint> {
  return poseidon2([DOM.PROCEDURE, codeToField(code)]);
}

export async function coveredTree(policy: Pick<Policy, 'coveredProcedures'>): Promise<MerkleTree> {
  const leaves = await Promise.all(policy.coveredProcedures.map(procedureLeaf));
  return MerkleTree.build(PROC_DEPTH, leaves);
}

export function exclusionFields(policy: Pick<Policy, 'exclusions'>): bigint[] {
  if (policy.exclusions.length > N_EXCL) throw new Error(`max ${N_EXCL} exclusions`);
  const f = policy.exclusions.map(codeToField);
  while (f.length < N_EXCL) f.push(0n);
  return f;
}

export async function policyCommitment(policy: Policy): Promise<bigint> {
  const covered = await coveredTree(policy);
  const excl = await poseidon2([DOM.EXCLUSIONS, ...exclusionFields(policy)]);
  return poseidon2([
    DOM.POLICY,
    policy.policyId,
    await patientKeyHash(policy.patientPubKey),
    BigInt(policy.startDate),
    BigInt(policy.endDate),
    BigInt(policy.waitingUntil),
    BigInt(policy.sumInsured),
    BigInt(policy.deductible),
    BigInt(policy.copayBps),
    covered.root,
    excl,
    policy.salt,
  ]);
}

export function newPolicy(p: Omit<Policy, 'policyId' | 'salt'> & Partial<Pick<Policy, 'policyId' | 'salt'>>): Policy {
  return { ...p, policyId: p.policyId ?? randomField(), salt: p.salt ?? randomField() };
}

/** Same integer maths as the circuit. */
export function computePayout(billItems: number[], policy: Pick<Policy, 'deductible' | 'copayBps'>): number {
  const total = billItems.reduce((a, b) => a + b, 0);
  if (total <= policy.deductible) return 0;
  return Number((BigInt(total - policy.deductible) * BigInt(10000 - policy.copayBps)) / 10000n);
}

// JSON helpers (bigint-safe) for storing policies in the patient's wallet / API.
export const policyToJSON = (p: Policy) => JSON.stringify(p, (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v));
export const policyFromJSON = (s: string): Policy => {
  const o = JSON.parse(s);
  return { ...o, policyId: BigInt(o.policyId), salt: BigInt(o.salt) };
};
