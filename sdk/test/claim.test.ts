import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClaimProver,
  buildWitnessInput,
  prepareClaim,
  signConsent,
  ghostWallet,
  claimNullifier,
  randomField,
  computePayout,
  circuitFailureReason,
  MerkleTree,
  HOSP_DEPTH,
  hospitalLeaf,
} from '../src/index.js';
import { circuit, world, NOW, DAY } from './fixtures.js';

const prover = new ClaimProver(circuit);

async function makeClaim(over: Partial<any> = {}) {
  const w = await world();
  const recordHash = randomField();
  const procedure = over.procedure ?? 'SG039';
  const policy = { ...w.policy, ...(over.policy ?? {}) };
  const n = await claimNullifier(policy, recordHash, procedure);
  const recipient = ghostWallet(w.hospitalSecrets[0], n).address;
  const draft = {
    policy,
    diagnosis: over.diagnosis ?? 'K35.80',
    procedure,
    recordHash,
    billItems: over.billItems ?? [900000, 3500000, 2000000, 800000, 450000, 350000],
    claimDate: over.claimDate ?? NOW,
    usedBefore: over.usedBefore ?? 0,
    recipient,
  };
  const prep = await prepareClaim(draft);
  const sig = signConsent(over.signer ?? w.patient.privateKey, prep.digest);
  const hospital = { secret: over.hospitalSecret ?? w.hospitalSecrets[0], tree: w.tree };
  return { w, draft, hospital, sig, ...(await buildWitnessInput(draft, hospital, sig)) };
}

async function expectFail(over: any, reason: RegExp) {
  const { input } = await makeClaim(over);
  await assert.rejects(prover.witness(input), (e: any) => {
    const r = circuitFailureReason(e);
    assert.match(r + ' ' + e.message, reason);
    return true;
  });
}

test('valid claim proves and verifies (UltraHonk, EVM target)', async () => {
  const { input, pub } = await makeClaim();
  const p = await prover.prove(input);
  console.log(`  witness ${p.witnessMs.toFixed(0)}ms, proof ${p.proveMs.toFixed(0)}ms, ${p.proof.length} bytes`);
  assert.equal(p.publicInputs.length, 7);
  assert.equal(BigInt(p.publicInputs[5]), BigInt(pub.payoutAmount));
  // (8,000,000 - 500,000) * 0.9 = 6,750,000 paise = ₹67,500
  assert.equal(pub.payoutAmount, 6750000);
  assert.ok(await prover.verify(p));
});

test('payout maths matches circuit', () => {
  assert.equal(computePayout([1000000], { deductible: 500000, copayBps: 1000 }), 450000);
  assert.equal(computePayout([400000], { deductible: 500000, copayBps: 1000 }), 0);
});

test('attack: unlicensed hospital', async () => {
  await expectFail({ hospitalSecret: randomField() }, /hospital not in approved registry/);
});
test('attack: expired policy', async () => {
  await expectFail({ claimDate: NOW + 400 * DAY }, /policy expired/);
});
test('attack: claim inside waiting period', async () => {
  const w = await world();
  await expectFail({ policy: { waitingUntil: NOW + DAY } }, /waiting period|policy commitment/);
});
test('attack: uncovered procedure', async () => {
  await expectFail({ procedure: 'PL007' }, /procedure not covered/);
});
test('attack: excluded diagnosis', async () => {
  await expectFail({ diagnosis: 'Z41.1' }, /diagnosis excluded/);
});
test('attack: over remaining limit (claim splitting)', async () => {
  await expectFail({ usedBefore: 45000000 }, /exceeds remaining sum insured/);
});
test('attack: forged patient consent', async () => {
  await expectFail({ signer: '0x' + '22'.repeat(32) }, /consent signature invalid/);
});
test('attack: tampered public payout', async () => {
  const { input } = await makeClaim();
  await assert.rejects(prover.witness({ ...input, payout_amount: '9999999' }));
});
test('attack: revoked hospital (new root without its leaf)', async () => {
  const { input, w } = await makeClaim();
  const leaves = await Promise.all(w.hospitalSecrets.slice(1).map(hospitalLeaf));
  const newRoot = (await MerkleTree.build(HOSP_DEPTH, leaves)).root;
  await assert.rejects(prover.witness({ ...input, hospital_root: '0x' + newRoot.toString(16).padStart(64, '0') }));
});
