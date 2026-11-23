// Diagram 2 — full technical flow. Output: docs/diagrams/2-technical.{excalidraw,png,svg}
import { writeFileSync } from 'node:fs';
import { Diagram, C } from './diagram-lib.mjs';

const d = new Diagram(3320, 2560);
const OUT = new URL('../docs/diagrams/', import.meta.url).pathname;

d.text(40, 24, 'Mohar — full technical flow (exactly what happens, where, and how)', { size: 60, font: 'title' });
d.text(42, 98, 'Lanes = where code runs.  Solid arrows = data/tx flow, numbered in order.  Purple = private (never leaves unencrypted) · Teal = off-chain service (sees ciphertext only) · Yellow = on-chain (public)', { size: 22, color: C.muted });

const LX = [40, 690, 1370, 1980, 2730];
const LW = [610, 640, 570, 710, 560];
const LT = ['📱 Patient device (Vault)', '🏥 Hospital browser (Seal)', '☁ Mohar API (Node/Hono)', '⛓ EVM chain (Anvil → Base Sepolia)', '🏦 Insurer · ⚖ Regulator'];
const LS = [C.violet, C.violet, C.teal, C.yellow, C.blue];
const LB = [C.violetBg, C.violetBg, C.tealBg, C.yellowBg, C.blueBg];
const TOP = 150, BOT = 2030;
for (let i = 0; i < 5; i++) {
  d.box(LX[i], TOP, LW[i], BOT - TOP, { stroke: LS[i], dashed: true, sw: 2 });
  d.box(LX[i] + 14, TOP + 14, LW[i] - 28, 52, { fill: LB[i], stroke: LS[i], solid: true });
  d.text(LX[i] + LW[i] / 2, TOP + 24, '# ' + LT[i], { size: 25, align: 'center' });
}
d.text(LX[0] + 20, TOP + 76, 'private', { size: 18, color: C.violet });
d.text(LX[1] + 20, TOP + 76, 'private (proving is local)', { size: 18, color: C.violet });
d.text(LX[2] + 20, TOP + 76, 'sees only ciphertext + public inputs', { size: 18, color: C.teal });
d.text(LX[3] + 20, TOP + 76, 'public: everyone can read', { size: 18, color: C.yellow });

function step(lane, y, h, title, body, o = {}) {
  const x = LX[lane] + 18, w = LW[lane] - 36;
  d.box(x, y, w, h, { fill: o.fill ?? C.white, stroke: o.stroke ?? LS[lane], solid: o.solid ?? true, sw: 2 });
  d.text(x + 16, y + 12, '# ' + title, { size: 23 });
  d.text(x + 16, y + 50, body, { size: 16.5, font: 'mono', color: C.ink });
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}

// ---------------- 0 · setup
const reg = step(4, 260, 240, '0a  Licensing (Regulator)', 'HFR check: format, found, ACTIVE,\n  name, Modern Medicine\nattestHospital(id, keccak(record))\napproveHospital(id)   ← needs attest\npublishRoot(merkleRoot)\nleaf = Poseidon2(D_HOSP, secret)\nregisterClinician(addr, NMC reg no)', { fill: C.blueBg });
const regC = step(3, 260, 240, 'Regulator.sol', 'hospitals[] {name, hfrId, leaf,\n  status, attestation}\ncurrentRoot · rootEpoch\nrevocation → all old roots die\nroutine update → 15 min grace\nclinicians[addr] (NMC) · paused', { fill: C.yellowBg });
d.arrow(reg.x - 4, reg.cy, regC.r + 4, regC.cy, { stroke: C.blue, label: 'tx', size: 18 });

const pol = step(4, 530, 270, '0b  Policy (Insurer)', 'C = Poseidon2(D_POL, policyId,\n  H(consentPub), start, end,\n  waitingUntil, sumInsured,\n  deductible, copayBps,\n  coveredRoot, H(exclusions), salt)\nissuePolicy(C)  · fundPool(bINR)\nfull policy JSON → patient (off-chain)', { fill: C.blueBg });
const polC = step(3, 530, 200, 'ClaimSettlement.sol (state)', 'policies[C] = {insurer, active,\n  issuedAt, used}\npool[insurer]  (bINR, paise)\nnullifierUsed[N]', { fill: C.yellowBg });
d.arrow(pol.x - 4, pol.y + 110, polC.r + 4, polC.y + 110, { stroke: C.blue, label: 'tx', size: 18 });

const ck = step(0, 260, 200, '0c  Keys on the phone', 'wallet key (pays gas, owns records)\nconsentKey = keccak(personal_sign(\n  "Mohar consent key v1\\n\n   policy <id>"))  → never on-chain\npolicy JSON + salt (from insurer)', { fill: C.violetBg });

// ---------------- 1 · Anon Aadhaar
const aa = step(0, 500, 230, '1  Anon Aadhaar (on device)', 'Aadhaar Secure QR, RSA-2048 signed\n  by UIDAI (test key in demo)\nsnarkjs Groth16 · ~1M constraints\n  (~1.5–4 min, made once)\nsignal = wallet · seed = app id\nreveals only: age ≥ 18, state', { fill: C.violetBg });
const aaC = step(3, 770, 200, 'PatientRegistry + AnonAadhaar', 'verifyWithAadhaar(seed, n, ts,\n  reveal[4], proof[8])\n→ Groth16 verify (~377k gas)\nnullifierOwner[n] = wallet\n→ 1 Aadhaar = 1 account', { fill: C.yellowBg });
d.arrow(aa.r + 4, aa.y + 200, aaC.x - 4, aaC.y + 40, { stroke: C.violet, via: [[1340, aa.y + 242], [1950, aa.y + 242]], label: '① Groth16 proof + reveal (tx)', labelAt: [1650, aa.y + 205], size: 18 });

// ---------------- 2 · encounter
const enc = step(1, 760, 360, '2  Encounter + claim terms', 'FHIR R4 Bundle: Condition(ICD-10),\n  Procedure, Meds, LOINC, Claim\nk  = random AES-256 key\nct = AES-256-GCM(k, bundle)\nrecordHash = keccak(tag‖k‖ct) mod p\nN  = Poseidon2(D_NUL, salt,\n       recordHash, procedure)\nR  = addr(keccak(hospitalSecret, N))\npayout = (Σbill − ded)·(1 − copay)\ndigest = Poseidon2(D_CONSENT, N,\n       payout, R, date, C)', { fill: C.violetBg });
const ipfs = step(2, 760, 150, 'IPFS pin node', 'PUT /api/ipfs → CIDv1(sha2-256)\nre-hashes on read (CID check)\noptional Pinata mirror', { fill: C.tealBg });
const inbox = step(2, 940, 170, 'Consent inbox', 'POST /api/consent\n{patient addr, ECIES(payload)}\npayload: cid, ECIES(k→patient),\n  N, payout, R, digest', { fill: C.tealBg });
d.arrow(enc.r + 4, ipfs.cy, ipfs.x - 4, ipfs.cy, { stroke: C.teal, label: '②', size: 18 });
d.arrow(enc.r + 4, inbox.cy, inbox.x - 4, inbox.cy, { stroke: C.teal, label: '②', size: 18 });

// ---------------- 3 · consent
const con = step(0, 1150, 300, '3  Consent (Vault)', 'ECIES-decrypt request, fetch CID\nrecompute recordHash, N, payout,\n  digest from OWN policy copy  ✓\nregisterRecord(id, keccak(ct), cid)\nsig = ECDSA_secp256k1(\n        consentKey, digest)\n→ POST /api/consent/:id {sig}', { fill: C.violetBg });
const hv = step(3, 1010, 210, 'HealthVault.sol', 'records[id] = {owner, contentHash,\n  cid, version}\ngrants[id][who] = {role, expiresAt,\n  keyVersion, wrappedKey}\nAccessLogged · RecordUpdated', { fill: C.yellowBg });
d.arrow(inbox.x - 4, inbox.b - 20, con.r + 4, con.y + 40, { stroke: C.teal, dashed: true, via: [[1200, inbox.b - 10]], label: '③ pull + decrypt', labelAt: [870, inbox.b + 60], size: 18 });
d.arrow(con.r + 4, con.y + 150, hv.x - 4, hv.b - 40, { stroke: C.violet, via: [[1330, con.y + 150], [1940, hv.b - 40]], label: '③ registerRecord (tx)', labelAt: [1650, con.y + 112], size: 18 });
d.arrow(con.r + 4, con.b - 40, inbox.x - 4, inbox.b - 30, { stroke: C.violet, via: [[1345, con.b - 40], [1345, inbox.b - 30]], label: '③ sig (64 B) → inbox', labelAt: [1000, con.b - 74], size: 18 });

// ---------------- 4 · prove
const prv = step(1, 1490, 300, '4  Prove (browser, bb.js WASM)', 'approvedLeaves() → Merkle(depth 8)\n  must == currentRoot\nnoir_js.execute → witness\n  (all 7 asserts checked here)\nUltraHonk, EVM target, keccak\n  transcript · 45,596 gates\nπ ≈ 8.6 KB · ~1–8 s · CRS from\n  /api/crs (offline mirror)', { fill: C.violetBg });
d.arrow(enc.cx, enc.b + 6, prv.cx, prv.y - 6, { stroke: C.violet, label: 'after sig arrives', labelAt: [enc.cx + 120, enc.b + 140], size: 18 });

// ---------------- 5 · relay + settle
const rel = step(2, 1490, 230, '5  Relayer', 'POST /api/relay/claim {π, pub}\nstaticCall first (no gas wasted\n  on doomed claims)\nsubmitClaim(π, pub) from the\n  RELAYER wallet → hospital\n  address never on-chain', { fill: C.tealBg });
const set = step(3, 1290, 520, '5  ClaimSettlement.submitClaim', 'require Regulator.isValidRoot(root)\nrequire policies[C].active\nrequire !nullifierUsed[N]\nrequire usedBefore == used[C]\nrequire date ∈ [now−90d, now+1h]\nrequire pool[insurer] ≥ payout\nHonkVerifier.verify(π, pub[7])\n  (gas-capped 6M, ~2.6M used)\n── effects ──\nnullifierUsed[N] = true\nused[C] += payout · pool −= payout\nbINR.transfer(R, payout)\nemit ClaimSettled(N, C, insurer,\n  payout, R, date)   ≈ 2.8M gas', { fill: C.yellowBg });
d.arrow(prv.r + 4, prv.y + 120, rel.x - 4, rel.y + 60, { stroke: C.violet, label: '⑤', size: 18 });
d.arrow(rel.r + 4, rel.y + 140, set.x - 4, set.y + 330, { stroke: C.teal, label: '⑤', size: 18 });

// ---------------- 6 · payout + insurer
const gp = step(2, 1760, 250, '6  Ghost Pay', 'stealth rail (default, trustless):\n  bINR lands at R, a fresh address\n  only the hospital can derive\nZcash rail: R = bridge →\n  watch ClaimSettled → zingo\n  quicksend(UA, zats, memo = N)\n  (needs zingo-cli installed)', { fill: C.greenBg, stroke: C.green });
d.arrow(set.x - 4, set.b - 30, gp.r + 4, gp.y + 60, { stroke: C.green, label: '⑥ bINR → R', labelAt: [1900, set.b + 10], size: 18 });
const bd = step(4, 1290, 260, '6  Blind Desk reads events', 'ClaimSettled → payout, C, N, R\n\nNOT visible: diagnosis, procedure,\nbill, hospital, patient, policy\nterms. No human approval.', { fill: C.blueBg });
d.arrow(set.r + 4, set.y + 120, bd.x - 4, bd.y + 120, { stroke: C.yellow, label: '⑥', size: 18 });
const ls = step(4, 1590, 250, '7  Leak scan', 'getLogs(all Mohar contracts)\n+ calldata of every tx\nsearch 13 secrets as ASCII,\n  field element, uint256\n→ 0 matches', { fill: C.greenBg, stroke: C.green });
d.arrow(ls.x - 4, ls.cy, set.r + 4, set.b - 120, { stroke: C.green, dashed: true, label: '⑦ read all', labelAt: [2610, ls.cy + 40], size: 18 });

// ---------------- bottom panels
const PY = 2075, PH = 450;
function panel(x, w, title, body, fill, stroke) {
  d.box(x, PY, w, PH, { fill, stroke, sw: 2.5 });
  d.text(x + 20, PY + 16, '# ' + title, { size: 26 });
  d.text(x + 20, PY + 62, body, { size: 16.5, font: 'mono' });
}
panel(40, 830, 'The circuit — circuits/claim/src/main.nr (Noir)', 'public (7): hospital_root, policy_commitment, nullifier,\n  claim_date, used_before, payout_amount, payout_recipient\nprivate: hospital secret + path, all policy fields,\n  ICD-10, procedure + path, bill[6], recordHash, sig\n\n1 Merkle(H(D_HOSP, secret)) == hospital_root\n2 Poseidon2(policy fields) == C; start ≤ date < end;\n  date ≥ waitingUntil\n3 Merkle(H(D_PROC, proc)) == coveredRoot;\n  diagnosis ∉ exclusions[4]\n4 payout == (Σbill − ded)(1 − copay);\n  used_before + payout ≤ sumInsured\n5 nullifier == Poseidon2(D_NUL, salt, recordHash, proc)\n6 ECDSA_verify(consentPub, sig, digest)\n7 recipient + payout bound inside digest', C.violetBg, C.violet);
panel(900, 760, 'Records: share · audit · revoke', 'wrap = ECIES(k → grantee pubkey)\n  (secp256k1 ECDH + sha256 + AES-GCM)\ngrantAccess(id, who, role, expiresAt, wrap)\n  Doctor role ⇒ Regulator.isClinician(who)\n  (NMC-verified) else revert\ndoctor: logAccess(id, purpose) FIRST\n  → AccessLogged on-chain → then decrypt\nrevoke: revokeAccess + re-encrypt with k′\n  → updateRecord(v+1); old grants are\n  bound to old keyVersion → dead\ncross-hospital: HAPI FHIR import +\n  ICD-10-CM search (73k codes)', C.violetBg, C.violet);
panel(1690, 760, 'Break-glass: 2-of-3 guardians', 'k_e = AES key of the emergency card\nShamir split over GF(256): 3 shares, t = 2\nshare_i = ECIES-wrapped to guardian_i\n  → BreakGlass.setGuardians (on-chain)\nresponder: request(patient, pubkey,\n  reason, id)  ← from the lock-screen QR\nguardian: unwrap own share → re-wrap\n  to responder → approve(id, share)\n2 approvals → unlocked for 24 h\nresponder: combine 2 shares → k_e →\n  decrypt card → logView (on-chain)\n1 share alone reveals nothing', C.redBg, C.red);
panel(2480, 800, 'Crypto & infrastructure', 'hash: Poseidon2 over BN254, domain\n  tags D_HOSP, D_POL, D_NUL, D_CONSENT…\nsignatures/ECDH: secp256k1\nsymmetric: AES-256-GCM\nproofs: UltraHonk (claims, no trusted\n  setup) · Groth16 (Anon Aadhaar)\nstorage: IPFS CIDv1 (sha2-256)\ndata: HL7 FHIR R4 · ICD-10-CM · LOINC\nregistries: ABDM HFR / NMC → keccak\n  attestation on-chain (snapshot or live)\noffline: CRS mirror + bundled fonts\nchain: Anvil now · Base Sepolia script\ntests: 31 forge · 11 sdk · 14/14 attacks', C.grayBg, C.gray);

writeFileSync(OUT + '2-technical.excalidraw', JSON.stringify(d.toExcalidraw(), null, 1));
await d.renderPng(OUT + '2-technical.png', new URL('./', import.meta.url).pathname);
console.log('diagram 2 done');
