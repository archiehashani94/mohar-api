// PRIVACY LEAK TEST — dump the whole chain and prove no private value is in it.
// 1. Settles a sensitive claim (breast cancer chemo at an oncology hospital) on the live local chain.
// 2. Downloads EVERY transaction + event emitted by the Kavach contracts since deployment.
// 3. Searches for each private value in every encoding we could think of. Any hit = test fails.
import { readFileSync } from 'node:fs';
import { AbiCoder, hexlify, keccak256, toUtf8Bytes } from 'ethers';
import {
  ClaimProver,
  HOSP_DEPTH,
  MerkleTree,
  buildWitnessInput,
  claimNullifier,
  codeToField,
  ghostWallet,
  policyFromJSON,
  prepareClaim,
  signConsent,
  splitPubKey,
  toHex32,
  consentKeyFor,
} from '../src/index.js';
import { ROOT, contracts, provider, signer } from './chain.js';

const demo = JSON.parse(readFileSync(`${ROOT}app/public/demo.json`, 'utf8'));
const circuit = JSON.parse(readFileSync(`${ROOT}circuits/claim/target/claim.json`, 'utf8'));
const p = provider();
const k = contracts(signer('relayer', p));
const policy = policyFromJSON(demo.policies.asha.json);
const hosp = demo.hospitals[1];
const patient = demo.accounts.patient.address;

// ---- 1. settle a sensitive claim
const leaves: string[] = await k.regulator.approvedLeaves();
const tree = await MerkleTree.build(HOSP_DEPTH, leaves.map(BigInt));
const recordHash = BigInt(keccak256(toUtf8Bytes('leaktest-' + Date.now()))) >> 8n;
const n = await claimNullifier(policy, recordHash, 'MO012');
const used = Number((await k.claims.policies(toHex32(await (await import('../src/index.js')).policyCommitment(policy)))).used);
const draft = {
  policy,
  diagnosis: 'C50.9',
  procedure: 'MO012',
  recordHash,
  billItems: [300000, 6500000, 1500000, 400000],
  claimDate: (await p.getBlock('latest'))!.timestamp,
  usedBefore: used,
  recipient: ghostWallet(BigInt(hosp.secret), n).address,
};
const prep = await prepareClaim(draft);
const { input, pub } = await buildWitnessInput(draft, { secret: BigInt(hosp.secret), tree }, signConsent(consentKeyFor(demo.accounts.patient.privateKey, policy.policyId).privateKey, prep.digest));
const proof = await new ClaimProver(circuit).prove(input);
const claim = {
  hospitalRoot: toHex32(pub.hospitalRoot),
  policyCommitment: toHex32(pub.policyCommitment),
  nullifier: toHex32(pub.nullifier),
  claimDate: pub.claimDate,
  usedBefore: pub.usedBefore,
  payoutAmount: pub.payoutAmount,
  payoutRecipient: pub.payoutRecipient,
};
const tx = await k.claims.submitClaim(hexlify(proof.proof), claim);
await tx.wait();
console.log(`settled claim ${tx.hash}`);

// ---- 2. dump the chain
const d = demo.deployment;
const logs = await p.getLogs({ fromBlock: d.startBlock, toBlock: 'latest', address: [d.claimSettlement, d.healthVault, d.breakGlass, d.regulator, d.token] });
const hashes = [...new Set(logs.map((l) => l.transactionHash))];
const txs = await Promise.all(hashes.map((h) => p.getTransaction(h)));
const strip = (h: string) => h.toLowerCase().replace(/^0x/, '');
const everything = [...txs.map((t) => strip(t!.data)), ...logs.map((l) => strip(l.data) + l.topics.map(strip).join(''))].join('|');
const claimRc = await p.getTransactionReceipt(tx.hash);
const claimOnly = [strip(tx.data), strip(tx.from), ...claimRc!.logs.map((l) => strip(l.data) + l.topics.map(strip).join(''))].join('|');

// ---- 3. search
const ascii = (s: string) => strip(hexlify(toUtf8Bytes(s)));
const u256 = (x: number | bigint) => strip(AbiCoder.defaultAbiCoder().encode(['uint256'], [x]));
const { x } = splitPubKey(policy.patientPubKey);
const checks: [string, string[], 'all' | 'claim'][] = [
  ['diagnosis C50.9 (ascii)', [ascii('C50.9')], 'all'],
  ['diagnosis C50.9 (field)', [strip(toHex32(codeToField('C50.9')))], 'all'],
  ['"Breast cancer"', [ascii('Breast cancer')], 'all'],
  ['procedure MO012', [ascii('MO012'), strip(toHex32(codeToField('MO012')))], 'all'],
  ['hospital secret', [strip(hosp.secret)], 'all'],
  ['policy salt', [strip(toHex32(policy.salt))], 'all'],
  ['policy id', [strip(toHex32(policy.policyId))], 'all'],
  ['record hash', [strip(toHex32(recordHash))], 'all'],
  ['hospital name', [ascii(hosp.name)], 'claim'],
  ['hospital HFR id', [ascii(hosp.hfrId)], 'claim'],
  ['hospital registry leaf', [strip(hosp.leaf)], 'claim'],
  ['patient wallet', [strip(patient)], 'claim'],
  ['patient consent key', [strip(hexlify(x))], 'all'],
  ['patient wallet pubkey (claim)', [strip(demo.accounts.patient.address)], 'claim'],
  ['sum insured', [u256(policy.sumInsured)], 'claim'],
  ['bill total', [u256(8700000)], 'claim'],
  ['bill line 65,000', [u256(6500000)], 'claim'],
];
let fail = 0;
console.log(`\nscanned ${txs.length} txs, ${logs.length} events, ${(everything.length / 2 / 1024).toFixed(1)} KB\n`);
for (const [label, needles, scope] of checks) {
  const hay = scope === 'all' ? everything : claimOnly;
  const hit = needles.some((nd) => hay.includes(nd));
  if (hit) fail++;
  console.log(`${hit ? '✗ LEAK' : '✓ clean'}  ${label.padEnd(26)} (${scope === 'all' ? 'entire chain' : 'claim tx + events'})`);
}
console.log(fail ? `\n${fail} LEAKS` : '\nPASS — no private value appears on-chain');
process.exit(fail ? 1 : 0);
