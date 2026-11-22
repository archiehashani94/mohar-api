// =============================================================================
//  KAVACH — zero-knowledge insurance claim circuit
//
//  A hospital proves to an insurer (and to a smart contract) that a claim is
//  valid WITHOUT revealing diagnosis, procedure, bill lines, which hospital it
//  is, or the policy terms. The contract only learns the seven public inputs.
//
//  Statements proven:
//   1. Hospital is licensed      — knows a secret whose leaf is in the
//                                  regulator's approved-hospital Merkle tree.
//   2. Policy is active          — opens the on-chain policy commitment and
//                                  start <= claim_date < end, past waiting period.
//   3. Procedure is covered      — procedure leaf is in the policy's private
//                                  covered-set Merkle tree; diagnosis is not on
//                                  the policy's exclusion list.
//   4. Amount is within limit    — itemised bill sums to total; payout is
//                                  computed IN-CIRCUIT from deductible + co-pay;
//                                  used_before + payout <= sum insured
//                                  (blocks claim-splitting).
//   5. Not a duplicate           — nullifier = H(policy_salt, record, procedure)
//                                  is unique per treatment and unlinkable.
//   6. Patient consented         — patient's secp256k1 signature over the exact
//                                  (nullifier, payout, recipient, date, policy)
//                                  verifies against the key bound in the policy.
//   7. Payout recipient bound    — recipient is a public input covered by the
//                                  proof + consent, so it can't be front-run.
//
//  Design notes:
//   - money is u64 paise (range-checked by type); maths done in u128.
//   - the hospital key never leaves the circuit: identity = Merkle membership.
//   - every hash has its own domain tag, so values can't be replayed across purposes.
// =============================================================================

use poseidon::poseidon2::Poseidon2;

global HOSP_DEPTH: u32 = 8; // up to 256 licensed hospitals
global PROC_DEPTH: u32 = 5; // up to 32 covered procedures per policy
global N_ITEMS: u32 = 6; // itemised bill lines
global N_EXCL: u32 = 4; // excluded diagnoses per policy

// Domain separators — every hash has its own purpose tag.
global DOM_HOSPITAL: Field = 0xb1f0_0001;
global DOM_POLICY: Field = 0xb1f0_0002;
global DOM_NULLIFIER: Field = 0xb1f0_0003;
global DOM_CONSENT: Field = 0xb1f0_0004;
global DOM_PATIENT: Field = 0xb1f0_0005;
global DOM_PROCEDURE: Field = 0xb1f0_0006;
global DOM_EXCLUSIONS: Field = 0xb1f0_0007;
global DOM_NODE: Field = 0xb1f0_0008;

global BPS: u128 = 10000;

fn h2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

fn merkle_root<let N: u32>(leaf: Field, index: Field, path: [Field; N]) -> Field {
    let bits: [bool; N] = index.to_le_bits();
    let mut node = leaf;
    for i in 0..N {
        let (l, r) = if bits[i] { (path[i], node) } else { (node, path[i]) };
        node = Poseidon2::hash([DOM_NODE, l, r], 3);
    }
    node
}

// 32 big-endian bytes -> (hi, lo) 128-bit field limbs (avoids modulus overflow)
fn bytes_to_limbs(b: [u8; 32]) -> (Field, Field) {
    let mut hi: Field = 0;
    let mut lo: Field = 0;
    for i in 0..16 {
        hi = hi * 256 + b[i] as Field;
        lo = lo * 256 + b[i + 16] as Field;
    }
    (hi, lo)
}

pub fn patient_key_hash(pub_x: [u8; 32], pub_y: [u8; 32]) -> Field {
    let (xh, xl) = bytes_to_limbs(pub_x);
    let (yh, yl) = bytes_to_limbs(pub_y);
    Poseidon2::hash([DOM_PATIENT, xh, xl, yh, yl], 5)
}

fn main(
    // ---------------- PUBLIC ----------------
    hospital_root: pub Field,
    policy_commitment: pub Field,
    nullifier: pub Field,
    claim_date: pub u64,
    used_before: pub u64,
    payout_amount: pub u64,
    payout_recipient: pub Field,
    // ---------------- PRIVATE: hospital ----------------
    hospital_secret: Field,
    hospital_index: Field,
    hospital_path: [Field; HOSP_DEPTH],
    // ---------------- PRIVATE: policy (opened from commitment) ----------------
    policy_id: Field,
    patient_pub_x: [u8; 32],
    patient_pub_y: [u8; 32],
    start_date: u64,
    end_date: u64,
    waiting_until: u64,
    sum_insured: u64,
    deductible: u64,
    copay_bps: u64,
    covered_root: Field,
    exclusions: [Field; N_EXCL],
    policy_salt: Field,
    // ---------------- PRIVATE: clinical ----------------
    diagnosis_code: Field,
    procedure_code: Field,
    procedure_index: Field,
    procedure_path: [Field; PROC_DEPTH],
    record_hash: Field,
    bill_items: [u64; N_ITEMS],
    // ---------------- PRIVATE: consent ----------------
    consent_sig: [u8; 64],
) {
    // ---- 1. licensed hospital (Merkle membership + knowledge of secret) ----
    let hospital_leaf = h2(DOM_HOSPITAL, hospital_secret);
    assert(
        merkle_root(hospital_leaf, hospital_index, hospital_path) == hospital_root,
        "hospital not in approved registry",
    );

    // ---- 2. policy opens + is active on claim date ----
    let pkh = patient_key_hash(patient_pub_x, patient_pub_y);
    let excl_hash = Poseidon2::hash(
        [DOM_EXCLUSIONS, exclusions[0], exclusions[1], exclusions[2], exclusions[3]],
        5,
    );
    let commitment = Poseidon2::hash(
        [
            DOM_POLICY,
            policy_id,
            pkh,
            start_date as Field,
            end_date as Field,
            waiting_until as Field,
            sum_insured as Field,
            deductible as Field,
            copay_bps as Field,
            covered_root,
            excl_hash,
            policy_salt,
        ],
        12,
    );
    assert(commitment == policy_commitment, "policy commitment mismatch");
    assert(claim_date >= start_date, "policy not yet started");
    assert(claim_date < end_date, "policy expired");
    assert(claim_date >= waiting_until, "within waiting period");

    // ---- 3. procedure covered + diagnosis not excluded ----
    let proc_leaf = h2(DOM_PROCEDURE, procedure_code);
    assert(
        merkle_root(proc_leaf, procedure_index, procedure_path) == covered_root,
        "procedure not covered",
    );
    assert(procedure_code != 0, "empty procedure");
    for i in 0..N_EXCL {
        if exclusions[i] != 0 {
            assert(diagnosis_code != exclusions[i], "diagnosis excluded by policy");
        }
    }

    // ---- 4. settlement maths in-circuit + limit ----
    let mut total: u128 = 0;
    for i in 0..N_ITEMS {
        total += bill_items[i] as u128;
    }
    assert(copay_bps as u128 <= BPS, "bad copay");
    assert(total > deductible as u128, "bill below deductible");
    let payable = ((total - deductible as u128) * (BPS - copay_bps as u128)) / BPS;
    assert(payable == payout_amount as u128, "payout does not match policy maths");
    assert(
        used_before as u128 + payable <= sum_insured as u128,
        "exceeds remaining sum insured",
    );

    // ---- 5. nullifier ----
    let expected_nullifier =
        Poseidon2::hash([DOM_NULLIFIER, policy_salt, record_hash, procedure_code], 4);
    assert(expected_nullifier == nullifier, "bad nullifier");

    // ---- 6 + 7. patient consent over exact claim terms, recipient bound ----
    let digest = Poseidon2::hash(
        [
            DOM_CONSENT,
            nullifier,
            payout_amount as Field,
            payout_recipient,
            claim_date as Field,
            policy_commitment,
        ],
        6,
    );
    let digest_bytes: [u8; 32] = digest.to_be_bytes();
    assert(
        std::ecdsa_secp256k1::verify_signature(
            patient_pub_x,
            patient_pub_y,
            consent_sig,
            digest_bytes,
        ),
        "patient consent signature invalid",
    );
}

// ----------------------------------------------------------------------------
// Unit tests for helpers (full-claim tests live in sdk/test with real ECDSA).
// ----------------------------------------------------------------------------
#[test]
fn test_merkle_left_right() {
    let leaf = 5;
    let sib = 7;
    let r0 = merkle_root(leaf, 0, [sib]);
    let r1 = merkle_root(leaf, 1, [sib]);
    assert(r0 == Poseidon2::hash([DOM_NODE, leaf, sib], 3));
    assert(r1 == Poseidon2::hash([DOM_NODE, sib, leaf], 3));
}

#[test]
fn test_limbs() {
    let mut b = [0; 32];
    b[15] = 1;
    b[31] = 2;
    let (hi, lo) = bytes_to_limbs(b);
    assert(hi == 1);
    assert(lo == 2);
}
