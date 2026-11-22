# Kavach — Build Journal

> Hackasol 5.0 · Track 4 (Web3) · W3-01 Privacy-Preserving Health Records & ZKP Insurance Claims
> "Insurers pay. Diagnoses stay sealed."

This journal is written while building. Each entry says **what** was done, **how**, and **why**,
including dead ends.

---

## 0. Research & decisions (before code)

**Design goals:** cover every must-have of the brief, then close the gaps a naive ZK-claims design leaves open:
- the hospital's identity must stay hidden (not just the diagnosis), and so must the *payment recipient*;
- policy expiry, coverage and limits must be proven inside the circuit, not checked loosely by a contract;
- a revoked hospital must not keep proving against an old registry root;
- the patient must consent to every claim (no phantom-patient fraud), and splitting a bill must not dodge the cap;
- records must be truly patient-controlled (grant / revoke / audit), with real emergency access.

**Chain:** Zcash has no programmable contracts → cannot verify a custom proof (fails the "contract verifies proof"
must-have). Core runs on **EVM (Anvil local + Base Sepolia)**; Zcash is used for the private payout rail (Ghost Pay).

---

## 1. Toolchain (Day 0)

- `noirup` → **nargo 1.0.0**. Instead of the separate `bbup` installer we use the
  **`bb` binary that ships inside `@aztec/bb.js@5.3.0`** (npm). Same prover, also used in the browser.
- `std::hash::poseidon2` was removed from Noir's stdlib in 1.0 → using `noir-lang/poseidon v0.4.0`.
- Verified JS ↔ Noir hash compatibility: `Poseidon2([1,2])` = `0x0386…7383` in both. This matters because Merkle
  trees and commitments are built in TypeScript and opened inside the circuit.

## 2. The claim circuit (`circuits/claim/src/main.nr`)

One UltraHonk circuit, **45,596 gates**, 7 public inputs:

| Public | Meaning |
|---|---|
| `hospital_root` | Regulator's approved-hospital Merkle root |
| `policy_commitment` | Poseidon2 commitment to the whole policy (terms stay private) |
| `nullifier` | `H(policy_salt, record_hash, procedure)` — one claim per treatment, unlinkable |
| `claim_date` | Checked against block time by the contract |
| `used_before` | Contract-tracked amount already paid on this policy |
| `payout_amount` | Computed in-circuit from bill, deductible and co-pay |
| `payout_recipient` | One-time address (Ghost Pay) — bound so it can't be front-run |

Private: hospital secret + Merkle path, every policy field, diagnosis (ICD-10), procedure code + covered-set path,
itemised bill, record hash, patient's ECDSA consent signature.

Design choices:
- **Hospital identity hidden**: hospital proves knowledge of `secret` with `H(DOM, secret)` in the tree — no public key ever leaves.
- **Covered set is private too**: it's a Merkle root *inside* the policy commitment.
- **Exclusions + waiting period**: Indian health policies have pre-existing-disease waiting periods and exclusions; both are proven.
- **Claim-splitting blocked**: `used_before + payout <= sum_insured` with `used_before` supplied by the contract.
- **Fake-patient fraud blocked**: patient signs `H(nullifier, payout, recipient, date, policy)` with the secp256k1 key bound into the policy.
- `u1` was removed in Noir 1.0 → Merkle bits use `[bool; N]`.

Solidity verifier generated with `bb write_solidity_verifier -t evm` (ZK Honk).

## 3. SDK (`sdk/`) — one library for scripts, server and browser

- `hash.ts` Poseidon2 via bb.js (same WASM in Node and browser) + domain tags mirrored from the circuit.
- `merkle.ts` fixed-depth tree with precomputed empty subtrees.
- `policy.ts` policy model, covered-procedure tree, commitment, payout maths identical to the circuit.
- `claim.ts` nullifier, consent digest, patient signature (raw secp256k1, verified in-circuit), witness builder,
  **Ghost Pay one-time addresses** `keccak(hospitalSecret, nullifier)` → fresh wallet per claim.
- `records.ts` AES-256-GCM sealing, IPFS CIDv1 (sha2-256), ECIES key wrapping, **Shamir 2-of-3 over GF(256)**.
- `fhir.ts` HL7 FHIR R4 bundles (Patient, Organization with ABDM HFR id, Condition ICD-10, Procedure,
  MedicationRequest, AllergyIntolerance, Observation LOINC, Claim) + emergency card.

**Tests (`sdk/test/claim.test.ts`) — 11/11 pass.** A valid claim proves in **~1.75 s** (Node, single thread,
8,768-byte proof) and verifies. Nine attacks fail *inside the circuit* with their exact reason: unlicensed hospital,
expired policy, waiting period, uncovered procedure, excluded diagnosis, over-limit, forged consent, tampered payout,
revoked hospital. (Initial failure was my own arithmetic in the expected payout — ₹67,500 not ₹75,600.)

## 4. Contracts (`contracts/`)

| Contract | Job |
|---|---|
| `Regulator` | Hospital listings (HFR id), approve/revoke, Merkle root with 15-min grace for routine updates and **instant death of all old roots on revocation**, insurer approvals, pause switch |
| `ClaimSettlement` | Immutable policy commitments, insurer pools, `submitClaim` (anyone can relay), nullifiers, `used` tracking, `precheck()` reason codes, verifier gas cap |
| `HonkVerifier` | Generated by bb (17.7 KB — fits the 24 KB limit, deployable to Base Sepolia) |
| `HealthVault` | Records (hash + CID only), time-bound role grants with wrapped keys, re-key on revoke, `logAccess` audit trail |
| `BreakGlass` | 2-of-3 guardians, responder requests, share re-wrapping, 24h window, logged views |
| `BINR` | Demo rupee stablecoin, 2 decimals = paise |

**24/24 Foundry tests pass**, using a *real* proof fixture produced by `sdk/scripts/make-fixture.ts`:
replay, stale `used` (claim ordering), inflated payout, front-run recipient, wrong policy, flipped proof byte, unknown root,
revoked root, cancelled policy, too-old / future-dated claim, pause, empty pool, unapproved insurer, plus vault and
break-glass flows.

**Gas:** `submitClaim` ≈ **2.8–3.25M gas** (UltraHonk verification ≈ 3.1M). That's ~9× a Groth16 verifier, the price
of no trusted setup and ~2 s browser proving; on Base it's cents. A malformed proof originally burned ~1B gas inside
the verifier, so the call is now capped at 6M (`VERIFY_GAS_CAP`).

## 5. Local chain end-to-end (`sdk/scripts/seed.ts`, `e2e.ts`)

`forge script Deploy.s.sol` (links verifier libraries) → `seed.ts` creates the world: 4 real Chhattisgarh hospitals
(+1 unlicensed "Shady Clinic" left pending), on-chain root == locally rebuilt root, insurer "Suraksha Health" with a
₹1 crore pool, two policy commitments (Asha: Gold; Rahul: Basic still in waiting period), encrypted FHIR history on IPFS,
emergency card with guardian shares.

`e2e.ts` result: oncology claim (C50.9 / chemo) from Balco Medical Centre → proof 1.76 s → relayer submits →
block 109, 2.78M gas → **ghost address received ₹73,800** → replay reverts `NullifierUsed`. The chain never saw
"oncology", "Balco", or Asha's address.

## 6. API server (`server/`) — sees only ciphertext

Hono on Node, three jobs:
1. **IPFS pin node.** `PUT /api/ipfs` stores blobs under their CIDv1 (sha2-256, raw codec); `GET` re-hashes on read
   and refuses content that doesn't match its CID. Sanity check: `"hello"` → `bafkreibm6jg3ux5q…`, the canonical IPFS
   CID, so the store is interchangeable with any IPFS node. Optional Pinata mirror via `PINATA_JWT`.
2. **Consent inbox.** The hospital's request is sealed to the patient's key (ECIES) before it leaves the browser,
   so the server only sees a patient address and ciphertext.
3. **Relayer.** It `staticCall`s first (never pays gas for a doomed claim), then submits from its own wallet,
   so **the hospital's address never appears on-chain.**

**Ghost Pay Zcash rail** (`server/src/ghostpay.ts`): the proof binds the bridge as recipient; the bridge watches
`ClaimSettled` and forwards ZEC to the hospital's shielded unified address via `zingo-cli quicksend`, with the
nullifier in the encrypted memo. `zingo-cli` (the Zcash light wallet) isn't installed on our dev machine yet, so the rail is wired and tested up to the wallet call: a
settled Zcash-rail claim is queued as `awaiting-zcash-wallet`, never faked as paid. Installing `zingo-cli` locally
turns it on (see README).

## 7. Web app (`app/`) — Vite + React + Tailwind v4, proving in the browser

Next.js was the plan, but bb.js/noir_js WASM + workers are far less painful under Vite (the Noir team's own
examples use Vite), so we switched. COOP/COEP headers make the page cross-origin isolated, which enables
multithreaded proving.

| Screen | What it does |
|---|---|
| Overview | Live stats from chain, explains the payment-leak insight |
| 🗝 Vault (patient) | Policy card (commitment recomputed from the patient's own copy), **consent inbox that independently re-derives payout, nullifier and digest before signing**, records (decrypt / share for 1h, 24h or 7d / revoke + re-key), on-chain audit trail, guardians + emergency QR |
| 🏥 Seal (hospital) | Encounter form (ICD-10, procedure, itemised bill), live payout maths, rail picker, 6-step progress with live proof timer, Ghost Pay receivables |
| 👁 Blind Desk (insurer) | Pool, settled-claim feed showing the 6 proven statements next to 6 redacted fields, policy issuance (renewal with waiting-period continuity) |
| 🩺 Doctor | Records shared with her; **opening writes `AccessLogged` on-chain first**, blocked after revoke |
| ⚖ Regulator | Approve/revoke hospitals, root audit (recomputed in browser), root history, emergency pause |
| 🚑 Break-glass | Responder scans QR → guardians release Shamir shares re-wrapped to the responder → 2 shares reconstruct the key |
| 🧪 Attack Lab | 13 one-click scenarios against the real circuit and contract |
| 🩻 X-Ray | Private witness vs public chain side by side, plus an in-browser leak scan of the whole chain |

## 8. Browser verification (Playwright, headless Chromium)

- `e2e/smoke.mjs`: all 9 pages render, **0 console errors**.
- `--flow`: Seal → consent → Vault signs → in-browser proof (**7.9 s** single-thread headless WASM; native bb in Node
  is 1.75 s) → relayer → settled ₹73,800 to a one-time address. Total 36 s, including the human step.
- `--attacks`: **12/12 attacks blocked, control claim settles.** Circuit blocks: unlicensed hospital, expired
  policy, waiting period, uncovered procedure, excluded diagnosis, over limit, fake consent. Contract blocks:
  replay (`NullifierUsed`), lying about prior usage (`StaleUsedAmount`), inflated payout and front-run recipient
  (`InvalidProof`), forged registry (`UnknownHospitalRoot`).
- `flows.mjs`: share → doctor opens (audited) → revoke + re-key → doctor gets `NoAccess`; break-glass with 1 share
  can't decrypt, with 2 shares the emergency card opens; insurer renewal.
- `zcash.mjs`: the Zcash-rail claim settles to the bridge and queues the shielded payout.

**The leak scanner caught something.** The X-Ray scan flagged the patient's secp256k1 public key on-chain (from
`HealthVault.registerKey`). Analysis: it's public by design (any wallet that sends a tx reveals it), it sits inside
the policy commitment only as a salted hash, and it never appears in a claim transaction. The check is now scoped to
claim txs, with that explanation shown in the UI. Roadmap: a separate per-policy consent key makes even that link
impossible.

Bugs found and fixed along the way: renewed policies broke after reload (commitment was read from `demo.json` →
now always recomputed from the patient's copy); custom errors showed as "unknown custom error" → decoded against all ABIs.

## 9. CLI privacy leak test (`sdk/scripts/leak-test.ts`)

Settles a breast-cancer chemo claim at the oncology hospital, then downloads every tx and event of every Kavach
contract and searches 16 private values in every encoding (ASCII, field element, uint256):
**41 txs, 47 events, 51.8 KB scanned → PASS, 0 leaks.**

## 10. Deliverables

- **Architecture + threat-model diagram:** `docs/architecture.svg` / `.png`, `docs/THREAT_MODEL.md` (data placement,
  13 adversaries → mitigation → the test that proves it, known trade-offs).
- **Demo video:** `demo/kavach-demo.mp4` (3:42, 1440×900, H.264). Recorded by `e2e/record-demo.mjs`, which drives
  the *real* app on a fresh chain with on-screen captions: hook → vault → oncology admission → consent → in-browser
  proof → settled → insurer view → X-Ray + leak scan → Attack Lab (13 scenarios, sped up 8×) → share/open/revoke
  → break-glass (1 share fails, 2 succeed) → regulator → close. 0 page errors during recording.
  First take failed because the caption overlay intercepted clicks (`pointer-events:none` fixed it). Seal now
  resumes an in-flight claim after you visit the Vault, which the single-tab recording needed.
- **Pitch deck:** `pitch/deck.html` (15 slides, 1920×1080) → `pitch/Kavach-pitch.pdf`, built from real screenshots.
- **Testnet:** `scripts/deploy-testnet.sh` deploys and seeds Base Sepolia with *fresh* role keys (Anvil keys are
  public and get swept by bots even on testnets). Needs a funded `DEPLOYER_KEY`, which only the team can provide.

## 11. Final verification (same session, fresh chain)

| Suite | Result |
|---|---|
| `nargo test` | 2/2 |
| SDK (`tsx --test`) | 11/11 · native proof 1.17 s with 4 threads |
| Foundry | 24/24 |
| App typecheck | clean |
| Playwright smoke / flow / attacks / flows / zcash | all pass, 0 console errors |
| `leak-test.ts` | PASS, 0 private values on-chain |

## 12. What's left for the team

1. `DEPLOYER_KEY=0x… ./scripts/deploy-testnet.sh` with ~0.05 Base Sepolia ETH, for a public deployment.
2. Install `zingo-cli` (command in README) and fund it from a Zcash testnet faucet to make the shielded payout leg live.
3. Rehearse the 3-minute pitch with the video as backup.

---

## 13. Round 2 — every research item + a presentable UX

### Logic built from the research
| Item | What we built | Verified by |
|---|---|---|
| **Anon Aadhaar** | `PatientRegistry.sol` + vendored `AnonAadhaar.sol` / Groth16 `Verifier.sol` (test-mode UIDAI key). Proof bound to the wallet (signal), app-scoped nullifier → one Aadhaar = one account; reveals only age ≥ 18 + state. | 5 Foundry tests on **real** proofs (`contracts/test/fixtures/aadhaar-*.json`): valid (377k gas), stolen proof from another wallet, same Aadhaar on a 2nd account, tampered reveal, wrong seed |
| Proving cost | snarkjs on CPU: **232 s / 7 GB RAM** cold, **83 s** warm. Too slow for a live stage, so proofs are generated once at onboarding (`sdk/scripts/aadhaar-prove.mjs`, cached) and **verified on-chain live**. The first background run was OOM-killed while the demo stack was up; rerun alone. | |
| **ABDM HFR check** | `sdk/src/registry.ts` + `/api/registry/hfr/:id`: format, found, ACTIVE, name match, system of medicine → keccak attestation stored on-chain (`Regulator.attestHospital`). **Approval now reverts without an attestation.** Live mode via `HFR_LOOKUP_URL` + `ABDM_ACCESS_TOKEN`; otherwise a labelled offline snapshot. | `test_hospitalApprovalRequiresHfrAttestation`; Shady Clinic fails the check in the UI |
| **NMC clinicians** | `Regulator.registerClinician/suspendClinician`; `HealthVault` refuses Doctor-role grants to anyone not NMC-verified. Live NMC IMR lookup only when `NMC_LIVE=1`. | `test_doctorGrantRequiresNmcVerifiedClinician` |
| **HAPI FHIR import** | `/api/fhir/hapi` pulls a live Condition + Patient from `hapi.fhir.org/baseR4`; Seal maps its SNOMED display to ICD-10. | manual: returned SNOMED 35489007 "depression" |
| **ICD-10 smart search** | 73,390 ICD-10-CM codes offline, lay-term synonyms ("heart attack" → I21.9, "breast cancer" → C50.x). | API checks |
| **Per-policy consent keys** | The patient key inside a policy is derived from a wallet signature (`consentKeyFor`), so it's never on-chain and works with MetaMask's `personal_sign`. Leak test now checks the consent key across the *entire* chain. | SDK 11/11, leak test |

### Two real bugs found by our own tooling
1. **Record-hash linkability (found by the leak scanner).** The record id inside the nullifier was `keccak(ciphertext) mod p`, which equals the public `contentHash` in HealthVault whenever keccak < p (~19% of records). The insurer knows the policy salt, so it could link a claim to a vault record and wallet. Fixed: `recordHashField(bytes, recordKey)` is keyed with the record's AES key, so only patient and hospital can compute it. Scan: 1 hit → 0.
2. **Cached init failure.** If bb.js's first CRS download hit a network blip, the rejected promise was cached and *every* later proof failed ("Failed to fetch" ×12 in the Attack Lab). Fixed: retry on failure, **plus a local CRS mirror** (`/api/crs/*`, cached in `.cache/crs`) and **self-hosted fonts**, so the demo works on bad Wi-Fi or offline.

### UX overhaul
- **Design system:** light "medical record meets declassified file". Paper `#F5F2EA`, ink `#16181D`, violet = private, teal = public, green = verified, vermilion = blocked. Newsreader + Geist + Geist Mono, lucide icons, **every emoji removed**. Ink redaction bars, dashed device boundaries, perforated ledger rows. Attack Lab + X-Ray switch to a dark "lab" theme.
- **Story mode (default screen):** three devices side by side (Asha's phone · Balco's hospital desk · insurer Blind Desk), a "wire" strip showing exactly what crosses between them (packets with sizes), a 9-step stepper, serif narration + the on-chain line, and **one button / → key per step**. Every step runs the real action: on-chain Anon Aadhaar verify, IPFS + ECIES consent, patient re-derivation + signing, in-browser UltraHonk proof (with a constraint "loom" and PROVEN stamp), relayer settlement, insurer count-up with redactions, full-chain leak scan. Keys: → / Space, ←, 1/2/3 zoom, X x-ray tags, R restart, ? help.
- **IA:** sidebar of 9 pages → top bar `Story | Roles | Proof & Security`, role tabs with coloured markers.

### Verification (fresh chain)
| Suite | Result |
|---|---|
| Foundry | **31/31** (incl. real Anon Aadhaar proofs) |
| SDK | 11/11 |
| Story mode playthrough (`e2e/story.mjs`, keyboard only) | 10/10 steps, 0 errors, **leak scan 0 leaks** |
| Attack Lab in browser | **14/14 blocked** + control settles (incl. duplicate Aadhaar, stolen Aadhaar proof) |
| Role flows (`e2e/flows.mjs`) | share → audited open → revoke+re-key → NoAccess · break-glass 1 share fails / 2 open · renewal |
| CLI leak test | PASS |

The demo video was **not** re-recorded (the team asked not to); `demo/kavach-demo.mp4` still shows the previous UI.
