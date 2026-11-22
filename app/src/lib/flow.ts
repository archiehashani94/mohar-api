// The claim workflow, split across the three parties exactly as in real life.
import { getBytes, hexlify, keccak256, toUtf8Bytes, getAddress } from 'ethers';
import {
  Policy,
  buildWitnessInput,
  claimNullifier,
  computePayout,
  consentDigest,
  encounterBundle,
  ghostWallet,
  newRecordKey,
  open,
  openJSON,
  policyFromJSON,
  prepareClaim,
  recordHashField,
  seal,
  sealJSON,
  sealedBytes,
  signConsent,
  unwrapKey,
  wrapKey,
  DIAGNOSES,
  PROCEDURES,
  consentKeyFor,
} from '@kavach/sdk';
import { c, getDemo, signerFor, Role, blockTime } from './chain';
import { api, ipfsPut, ipfsGet, hospitalTree, claimStruct, getProver } from './zk';
import { ring } from './keyring';

export type Rail = 'stealth' | 'zcash';

export function policyFor(patient: Role): Policy {
  const own = ring.get().policies[patient];
  if (own) return policyFromJSON(own);
  const d = getDemo();
  return policyFromJSON(d.policies[patient === 'patient' ? 'asha' : 'rahul'].json);
}

export async function commitmentFor(patient: Role): Promise<string> {
  const { policyCommitment, toHex32 } = await import('@kavach/sdk');
  return toHex32(await policyCommitment(policyFor(patient)));
}

export async function patientPubKey(addr: string): Promise<string> {
  return hexlify(await c().vault.encryptionKey(addr));
}

// ---------------- HOSPITAL: admission → sealed record + consent request ----------------
export async function hospitalRequestConsent(o: {
  hospitalIdx: number;
  patient: Role;
  diagnosis: string;
  diagnosisDisplay?: string;
  procedure: string;
  bill: { label: string; amount: number }[];
  rail: Rail;
  zcashUA?: string;
}) {
  const d = getDemo();
  const h = d.hospitals[o.hospitalIdx];
  const patientAddr = d.accounts[o.patient].address;
  const policy = policyFor(o.patient);
  const diag = DIAGNOSES.find((x) => x.code === o.diagnosis) ?? { code: o.diagnosis, display: o.diagnosisDisplay ?? o.diagnosis, sensitive: true };
  const proc = PROCEDURES.find((x) => x.code === o.procedure)!;
  const now = await blockTime();

  // 1. FHIR encounter, encrypted with a fresh record key, pinned to IPFS
  const bundle = encounterBundle({
    patientName: d.names[o.patient],
    patientId: o.patient,
    hospitalName: h.name,
    hfrId: h.hfrId,
    diagnosis: diag,
    procedure: proc,
    medications: o.procedure === 'MO012' ? ['Paclitaxel 175mg/m²', 'Ondansetron 8mg'] : ['Ceftriaxone 1g IV', 'Paracetamol 650mg'],
    allergies: ['Penicillin'],
    bloodGroup: 'B+',
    observations: [{ code: '718-7', display: 'Haemoglobin', value: 11.8, unit: 'g/dL' }],
    date: new Date(now * 1000).toISOString().slice(0, 10),
    billItems: o.bill,
  });
  const recordKey = await newRecordKey();
  const sealed = await sealJSON(recordKey, bundle);
  const bytes = sealedBytes(sealed);
  const cid = await ipfsPut(bytes);
  const recordHash = recordHashField(bytes, recordKey);

  // 2. Ghost Pay recipient
  const nullifier = await claimNullifier(policy, recordHash, o.procedure);
  const gp = await api('/ghostpay');
  const recipient = o.rail === 'zcash' ? gp.bridgeAddress : ghostWallet(BigInt(h.secret), nullifier).address;
  if (o.rail === 'zcash' && o.zcashUA) await api('/ghostpay/zcash', { nullifier: '0x' + nullifier.toString(16).padStart(64, '0'), ua: o.zcashUA });

  const billItems = o.bill.map((b) => b.amount);
  const usedBefore = Number((await c().claims.policies(await commitmentFor(o.patient))).used);
  const draft = { policy, diagnosis: o.diagnosis, procedure: o.procedure, recordHash, billItems, claimDate: now, usedBefore, recipient };
  const prep = await prepareClaim(draft);

  // 3. Everything the patient needs, sealed to the patient — the inbox server sees only ciphertext.
  const payload = {
    hospital: h.name,
    hfrId: h.hfrId,
    diagnosis: diag,
    procedure: proc,
    bill: o.bill,
    cid,
    wrappedRecordKey: await wrapKey(recordKey, await patientPubKey(patientAddr)),
    claim: { claimDate: now, payoutAmount: prep.payoutAmount, recipient, rail: o.rail, nullifier: prep.nullifier.toString(), digest: prep.digest.toString() },
  };
  const pk = await newRecordKey();
  const req = { box: await sealJSON(pk, payload), key: await wrapKey(pk, await patientPubKey(patientAddr)) };
  const inboxItem = await api('/consent', { patient: patientAddr, request: req });

  const local = {
    id: inboxItem.id,
    at: Date.now(),
    hospitalIdx: o.hospitalIdx,
    hospital: h.name,
    patient: o.patient,
    diagnosis: diag,
    procedure: proc,
    bill: o.bill,
    rail: o.rail,
    cid,
    recordHash: recordHash.toString(),
    draft: { ...draft, policy: undefined, recordHash: recordHash.toString() },
    status: 'awaiting-consent',
  };
  ring.update((r) => r.claims.push(local));
  return local;
}

// ---------------- PATIENT: open request, verify terms, register record, sign ----------------
export async function patientOpenRequest(patient: Role, item: any) {
  const priv = getDemo().accounts[patient].privateKey;
  const k = await unwrapKey(item.request.key, priv);
  const payload = await openJSON(k, item.request.box);
  // Independently re-derive every number before signing (patient holds the policy, so it can).
  const policy = policyFor(patient);
  const bytes = await ipfsGet(payload.cid);
  const recordHash = recordHashField(bytes, await unwrapKey(payload.wrappedRecordKey, priv));
  const nullifier = await claimNullifier(policy, recordHash, payload.procedure.code);
  const { policyCommitment } = await import('@kavach/sdk');
  const commitment = await policyCommitment(policy);
  const payout = computePayout(payload.bill.map((b: any) => b.amount), policy);
  const digest = await consentDigest({ policyCommitment: commitment, nullifier, claimDate: payload.claim.claimDate, payoutAmount: payout, payoutRecipient: getAddress(payload.claim.recipient) });
  const checks = {
    recordMatchesCid: true,
    nullifierMatches: nullifier.toString() === payload.claim.nullifier,
    payoutMatchesPolicy: payout === payload.claim.payoutAmount,
    digestMatches: digest.toString() === payload.claim.digest,
    covered: policy.coveredProcedures.includes(payload.procedure.code),
  };
  return { payload, checks, digest, recordHash };
}

export async function patientApprove(patient: Role, item: any) {
  const { payload, checks, digest } = await patientOpenRequest(patient, item);
  if (!checks.digestMatches || !checks.payoutMatchesPolicy) throw new Error('claim terms do not match — refusing to sign');
  const priv = getDemo().accounts[patient].privateKey;
  const recordKey = await unwrapKey(payload.wrappedRecordKey, priv);
  const bytes = await ipfsGet(payload.cid);
  const recordId = keccak256(toUtf8Bytes(`${getDemo().accounts[patient].address}:encounter:${payload.cid}`));
  const v = c(patient).vault;
  if ((await v.records(recordId)).owner === '0x0000000000000000000000000000000000000000') {
    await (await v.registerRecord(recordId, keccak256(bytes), payload.cid, 'encounter')).wait();
  }
  ring.update((r) => (r.recordKeys[recordId] = hexlify(recordKey)));
  const signature = signConsent(consentKeyFor(priv, policyFor(patient).policyId).privateKey, digest);
  await api(`/consent/${item.id}`, { signature, recordId });
  return { recordId, signature };
}

// ---------------- HOSPITAL: prove in browser, then relay ----------------
export async function hospitalProve(localId: string, onStep: (s: string, extra?: any) => void = () => {}) {
  const d = getDemo();
  const local = ring.get().claims.find((x) => x.id === localId);
  const inbox = await api(`/consent/${localId}`);
  if (inbox.status !== 'signed') throw new Error('patient has not signed yet');
  const policy = policyFor(local.patient);
  const h = d.hospitals[local.hospitalIdx];
  onStep('tree');
  const { tree, matches } = await hospitalTree();
  if (!matches) throw new Error('local hospital tree does not match on-chain root');
  const draft = { ...local.draft, policy, recordHash: BigInt(local.recordHash) };
  // refresh used_before right before proving (another claim may have settled)
  draft.usedBefore = Number((await c().claims.policies(await commitmentFor(local.patient))).used);
  onStep('witness');
  const { input, pub } = await buildWitnessInput(draft, { secret: BigInt(h.secret), tree }, inbox.signature);
  const prover = await getProver();
  await prover.witness(input); // all 7 statements checked here; throws with the failing one
  onStep('prove');
  const proof = await prover.prove(input);
  onStep('proved', proof);
  return { proof, claim: claimStruct(pub) };
}

export async function hospitalSubmit(localId: string, proof: { proof: Uint8Array; proveMs: number }, claim: any) {
  const local = ring.get().claims.find((x) => x.id === localId);
  const res = await api('/relay/claim', { proof: hexlify(proof.proof), claim, meta: { rail: local.rail } });
  ring.update((r) => {
    const x = r.claims.find((y) => y.id === localId);
    Object.assign(x, { status: res.ok ? 'settled' : 'rejected', result: res, pub: claim, proveMs: proof.proveMs, proofBytes: proof.proof.length });
  });
  return res;
}

export async function hospitalProveAndSubmit(localId: string, onStep: (s: string, extra?: any) => void) {
  const { proof, claim } = await hospitalProve(localId, onStep);
  onStep('relay');
  const res = await hospitalSubmit(localId, proof, claim);
  onStep(res.ok ? 'settled' : 'rejected', res);
  return { res, proof, claim };
}

// ---------------- records: open / share / revoke+rekey ----------------
export async function openRecord(viewer: Role, recordId: string, purpose: string) {
  const v = c(viewer).vault;
  const rec = await v.records(recordId);
  const me = getDemo().accounts[viewer].address;
  let key: Uint8Array;
  if (rec.owner.toLowerCase() === me.toLowerCase()) {
    const hex = ring.get().recordKeys[recordId] ?? getDemo().records.asha?.find((r) => r.recordId === recordId)?.key;
    if (!hex) throw new Error('record key not on this device');
    key = getBytes(hex);
  } else {
    await (await v.logAccess(recordId, purpose)).wait(); // reverts if no access → audit trail of every view
    const g = await v.getGrant(recordId, me);
    key = await unwrapKey(JSON.parse(new TextDecoder().decode(getBytes(g.wrappedKey))), getDemo().accounts[viewer].privateKey);
  }
  const bytes = await ipfsGet(rec.cid);
  if (keccak256(bytes) !== rec.contentHash) throw new Error('IPFS content does not match on-chain hash');
  return openJSON(key, JSON.parse(new TextDecoder().decode(bytes)));
}

export async function shareRecord(owner: Role, recordId: string, grantee: string, role: number, hours: number) {
  const hex = ring.get().recordKeys[recordId] ?? getDemo().records.asha?.find((r) => r.recordId === recordId)?.key;
  if (!hex) throw new Error('record key not on this device');
  const w = await wrapKey(getBytes(hex), await patientPubKey(grantee));
  const exp = (await blockTime()) + hours * 3600;
  await (await c(owner).vault.grantAccess(recordId, grantee, role, exp, toUtf8Bytes(JSON.stringify(w)))).wait();
}

export async function revokeAndRekey(owner: Role, recordId: string, grantee: string) {
  const doc = await openRecord(owner, recordId, 'rekey');
  const v = c(owner).vault;
  await (await v.revokeAccess(recordId, grantee)).wait();
  const key = await newRecordKey();
  const bytes = sealedBytes(await sealJSON(key, doc));
  const cid = await ipfsPut(bytes);
  await (await v.updateRecord(recordId, keccak256(bytes), cid, 're-key after revoke')).wait();
  ring.update((r) => (r.recordKeys[recordId] = hexlify(key)));
}

// ---------------- Anon Aadhaar onboarding ----------------
/** Anon Aadhaar packs revealed ASCII little-endian into a field. */
export function decodeReveal(n: bigint | number | string): string {
  let v = BigInt(n);
  let s = '';
  while (v > 0n) {
    s += String.fromCharCode(Number(v & 0xffn));
    v >>= 8n;
  }
  return s;
}

export async function aadhaarStatus(patient: Role) {
  const p = await c().patients.patients(getDemo().accounts[patient].address);
  return { verified: p.verified as boolean, state: decodeReveal(p.state), ageAbove18: p.ageAbove18 as boolean, at: Number(p.verifiedAt) };
}

/** The proof was generated on the patient's device at onboarding (snarkjs, ~1.5–4 min); here it is verified on-chain. */
export async function verifyAadhaar(patient: Role) {
  const pr = await api(`/aadhaar/proof/${getDemo().accounts[patient].address}`);
  if (pr.error) throw new Error(pr.error);
  const t0 = performance.now();
  const tx = await c(patient).patients.verifyWithAadhaar(pr.nullifierSeed, pr.nullifier, pr.timestamp, pr.revealArray, pr.groth16Proof);
  const rc = await tx.wait();
  return { proof: pr, gas: Number(rc.gasUsed), ms: performance.now() - t0, tx: tx.hash, state: decodeReveal(pr.revealArray[3]) };
}

export { seal, open, signerFor };
