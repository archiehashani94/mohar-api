# W3-01 requirements → Mohar

Every item in the problem statement, where it lives, and the test that proves it. All results below were re-run on a
fresh local chain (`./scripts/demo.sh`).

## Must-have features

| Requirement | Status | Where | Proven by |
|---|---|---|---|
| **ZK claim verification** without revealing diagnosis, procedure or prescriptions | ✅ | Noir circuit `circuits/claim/src/main.nr` (45,596 gates, UltraHonk), proven **in the hospital's browser** (`app/src/lib/flow.ts → hospitalProve`) | `sdk/test/claim.test.ts` (real proof), Playwright `smoke.mjs --flow`, `roles.mjs` |
| ↳ claim comes from a licensed hospital on an approved list (Merkle membership) | ✅ | statement 1: leaf `Poseidon2(D_HOSP, secret)` in the regulator's root; `Regulator.sol` publishes roots, and approval requires an ABDM HFR attestation | Attack Lab "Unlicensed hospital", "Forged hospital registry"; forge `test_hospitalApprovalRequiresHfrAttestation` |
| ↳ tied to an active policy (expiry later than claim date) | ✅ | statement 2: opens the Poseidon2 policy commitment, `start ≤ date < end`, past the waiting period | Attack Lab "Expired policy", "Inside waiting period" |
| ↳ procedure in the policy's covered set **and** amount within the limit | ✅ | statements 3 + 4: covered-set Merkle root inside the commitment, exclusion list; `payout = (Σbill − deductible)(1 − copay)`, `used_before + payout ≤ sum insured` | Attack Lab "Uncovered procedure", "Excluded diagnosis", "Over the limit", "Lie about prior usage" |
| **Smart-contract settlement**: verifies the proof | ✅ | `ClaimSettlement.submitClaim` → generated `HonkVerifier` | forge `test_settlesValidClaim_paysGhostAddress`, `test_verifierDirect` |
| ↳ rejects duplicate / replayed claims (nullifier) | ✅ | `nullifier = Poseidon2(D_NUL, salt, recordHash, procedure)`; contract reverts with `NullifierUsed` | Attack Lab "Replay a settled claim" |
| ↳ releases payment automatically once the proof is valid | ✅ | same tx transfers bINR from the insurer pool to a one-time address (no human step) | Story step "Settle", insurer desk count-up |
| **Patient permissions**: records encrypted off-chain, only hashes on-chain | ✅ | AES-256-GCM ciphertext pinned by CIDv1 to the IPFS pin node (`server/`, optional Pinata mirror via `PINATA_JWT`); `HealthVault` stores only `contentHash` + CID | leak test: 0 private values on-chain |
| ↳ patient can grant **and revoke** access for a doctor | ✅ | Patient → My records → Share (1 h / 24 h / 7 d) → Revoke + re-key (re-encrypts, so the old key dies). Doctor grants need an NMC-verified clinician. | `roles.mjs`: doctor opens → revoke → `Blocked by HealthVault: NoAccess` |
| **Three-role interface**: Patient → Hospital → Insurer | ✅ | **Live demo** role sign-in (one role per tab, role-guarded screens) + **Story mode** (all three devices side by side) | `roles.mjs`, `story.mjs` |

## Public vs private inputs

| Spec | Mohar |
|---|---|
| **Public:** claim amount, policy commitment, claim nullifier, approved-hospital root | ✅ all four are public inputs, plus claim date, used-before and payout recipient (7 in total) |
| **Private:** diagnosis, procedure code, prescriptions, treatment history, record contents | ✅ private witness only. `sdk/scripts/leak-test.ts` searches every tx and event for 16 private values in ASCII / field / uint256 encodings → **PASS, 0 leaks**. The in-app X-Ray scan gives the same result. |

## Bonus features

| Bonus | Status | Where |
|---|---|---|
| Time-bound or role-based access, with every view and change in an on-chain audit trail | ✅ | `HealthVault` grants carry a role (Doctor / Hospital / Lab / Pharmacy / Emergency) and an expiry. `AccessGranted`, `AccessRevoked`, `RecordUpdated` and `AccessLogged` events (logged **before** decryption; the call reverts without access). Shown in Patient → Audit trail and Provider → My access log. |
| Emergency break-glass for responders, fully logged | ✅ | `BreakGlass`: paramedic scans the patient's emergency QR → request on-chain → 2 of 3 guardians re-wrap their Shamir shares to the responder → key rebuilt on the responder's device → `EmergencyViewed` logged. 1 share can't decrypt. |
| Lab, pharmacy or cross-hospital sharing with HL7 FHIR records | ✅ | All records are FHIR R4 bundles. **Lab** gets only an Observation slice, **pharmacy** only MedicationRequest + AllergyIntolerance; each slice is re-encrypted as its own record, so the diagnosis never reaches them. Cross-hospital: live HAPI FHIR import, SNOMED → ICD-10 mapping. |

## Deliverables

| Deliverable | Status |
|---|---|
| Contracts on a local chain or public testnet | ✅ local Anvil (`./scripts/demo.sh`). ⚠️ Base Sepolia: `scripts/deploy-testnet.sh` is ready but needs a funded `DEPLOYER_KEY`. |
| Working proof generation + verification flow | ✅ in-browser UltraHonk proof (4–9 s) → on-chain verification (~2.8M gas) |
| Front end for Patient → Hospital → Insurer | ✅ |
| Architecture + privacy threat-model diagram (on-chain vs off-chain) | ✅ `docs/architecture.svg` / `.png`, `docs/diagrams/`, `docs/THREAT_MODEL.md` |

## Beyond the brief

- **The payment doesn't leak the diagnosis.** Ghost Pay sends each claim to a one-time address derived from the hospital's secret and the nullifier, through a relayer, so the hospital never appears on-chain. An optional Zcash shielded rail exists; it queues as `awaiting-zcash-wallet` until `zingo-cli` is installed.
- **Patient-signed consent inside the circuit** (secp256k1). Payout and recipient are bound into the signed digest, which stops phantom claims and front-running.
- **Anon Aadhaar** identity: real Groth16 proofs, one Aadhaar = one account, reveals only age ≥ 18 + state.
- **Regulator**: ABDM HFR attestation before listing, NMC-verified clinicians, instant root revocation, emergency pause.
- **Attack Lab:** 14 fraud attempts against the real circuit and contracts, all blocked, plus a control claim that settles.
- **X-Ray + full-chain leak scanner** that you can run live in front of judges.
- **Role sign-in with QR**: one role per tab, sign-in QR for phones, real camera QR scanning, and a demo guide ticked from chain state.
- **Story mode** with a live *Under the hood* log for every step.
- 73k-code offline ICD-10 search with lay terms, and a local CRS mirror so proving works offline.

## Test results (this build)

| Suite | Result |
|---|---|
| `nargo test` | 2 / 2 |
| SDK (`tsx --test`) | 12 / 12 |
| Foundry | 31 / 31 (real UltraHonk + real Anon Aadhaar proofs) |
| `e2e/smoke.mjs --flow` | all 11 screens render · claim settles in ~35 s incl. the human step · leak scan 0 leaks · 0 console errors |
| `e2e/smoke.mjs --attacks` | 14 / 14 blocked + control settles |
| `e2e/roles.mjs` | 16 / 16 checks: sign-in → Aadhaar → card scan → consent → proof → settle → insurer → share doctor / lab / pharmacy → pharmacy can't see the diagnosis → revoke blocks the doctor → break-glass 2-of-3 → Rahul blocked by `DuplicateAadhaar` → role guard; demo guide 11 / 11 |
| `e2e/story.mjs` | 10 / 10 steps, keyboard only, 0 leaks |
| `e2e/zcash.mjs` | settles to the bridge, payout queued |
| `sdk/scripts/leak-test.ts` | PASS |
