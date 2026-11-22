// Full on-chain flow against a running Anvil + seeded deployment:
// hospital prepares claim → patient signs consent → hospital proves → relayer submits → contract pays ghost address.
import { readFileSync } from 'node:fs';
import { hexlify, keccak256, toUtf8Bytes } from 'ethers';
import {
  ClaimProver,
  HOSP_DEPTH,
  MerkleTree,
  buildWitnessInput,
  claimNullifier,
  ghostWallet,
  policyFromJSON,
  prepareClaim,
  signConsent,
  toHex32,
  formatINR,
  consentKeyFor,
} from '../src/index.js';
import { ROOT, contracts, provider, signer } from './chain.js';

const demo = JSON.parse(readFileSync(`${ROOT}app/public/demo.json`, 'utf8'));
const circuit = JSON.parse(readFileSync(`${ROOT}circuits/claim/target/claim.json`, 'utf8'));
const p = provider();
const relay = contracts(signer('relayer', p));

const policy = policyFromJSON(demo.policies.asha.json);
const hospital = demo.hospitals[1]; // Balco Medical Centre (oncology) — the "leaky" one
const leaves: string[] = await relay.regulator.approvedLeaves();
const tree = await MerkleTree.build(HOSP_DEPTH, leaves.map((l) => BigInt(l)));
const onchainRoot = await relay.regulator.currentRoot();
if (toHex32(tree.root) !== onchainRoot) throw new Error('local tree != on-chain root');

const recordHash = BigInt(keccak256(toUtf8Bytes('encounter-' + Date.now()))) >> 8n;
const procedure = 'MO012';
const nullifier = await claimNullifier(policy, recordHash, procedure);
const ghost = ghostWallet(BigInt(hospital.secret), nullifier);
const used = (await relay.claims.policies(demo.policies.asha.commitment)).used;
const now = (await p.getBlock('latest'))!.timestamp;

const draft = {
  policy,
  diagnosis: 'C50.9',
  procedure,
  recordHash,
  billItems: [300000, 6500000, 1500000, 400000],
  claimDate: now,
  usedBefore: Number(used),
  recipient: ghost.address,
};
const prep = await prepareClaim(draft);
const sig = signConsent(consentKeyFor(demo.accounts.patient.privateKey, policy.policyId).privateKey, prep.digest);
const { input, pub } = await buildWitnessInput(draft, { secret: BigInt(hospital.secret), tree }, sig);
const prover = new ClaimProver(circuit);
const proof = await prover.prove(input);
console.log(`proved in ${proof.proveMs.toFixed(0)}ms`);

const c = {
  hospitalRoot: toHex32(pub.hospitalRoot),
  policyCommitment: toHex32(pub.policyCommitment),
  nullifier: toHex32(pub.nullifier),
  claimDate: pub.claimDate,
  usedBefore: pub.usedBefore,
  payoutAmount: pub.payoutAmount,
  payoutRecipient: pub.payoutRecipient,
};
const pre = await relay.claims.precheck(c);
console.log('precheck', pre);
const tx = await relay.claims.submitClaim(hexlify(proof.proof), c);
const rc = await tx.wait();
console.log(`settled in block ${rc.blockNumber}, gas ${rc.gasUsed}`);
console.log(`ghost address ${ghost.address} received ${formatINR(Number(await relay.token.balanceOf(ghost.address)))}`);
try {
  await relay.claims.submitClaim.staticCall(hexlify(proof.proof), c);
} catch (e: any) {
  console.log('replay →', e.revert?.name ?? e.shortMessage);
}
process.exit(0);
