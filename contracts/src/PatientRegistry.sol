// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IAnonAadhaar} from "../interfaces/IAnonAadhaar.sol";

/// @title PatientRegistry — one real person per patient account, without revealing who.
/// @notice A patient proves with Anon Aadhaar (Groth16 over UIDAI's RSA signature on the Aadhaar Secure QR)
///         that they hold a genuine Aadhaar, revealing only "age ≥ 18" and state. The proof is bound to the
///         caller's address (signal) and yields an app-scoped nullifier, so one Aadhaar can back only one
///         Kavach account — no fake patients, no duplicate identities, no Aadhaar number on-chain.
///         Insurers check `isVerified(patient)` off-chain before issuing a policy (keeping policies unlinkable).
contract PatientRegistry {
    struct Patient {
        bool verified;
        bool ageAbove18;
        uint256 state; // packed ASCII of the state name revealed by the proof
        uint64 aadhaarTimestamp;
        uint64 verifiedAt;
    }

    IAnonAadhaar public immutable anonAadhaar;
    uint256 public immutable nullifierSeed;
    bool public immutable testMode;

    mapping(address => Patient) public patients;
    mapping(uint256 => address) public nullifierOwner;
    uint256 public verifiedCount;

    event PatientVerified(address indexed patient, uint256 indexed nullifier, bool ageAbove18, uint256 state);

    error WrongSeed();
    error AlreadyVerified();
    error DuplicateAadhaar(address existing);
    error InvalidAadhaarProof();
    error Underage();

    constructor(IAnonAadhaar _anonAadhaar, uint256 _nullifierSeed, bool _testMode) {
        anonAadhaar = _anonAadhaar;
        nullifierSeed = _nullifierSeed;
        testMode = _testMode;
    }

    /// @param revealArray [ageAbove18, gender, pincode, state] as revealed by the proof (0 = not revealed)
    function verifyWithAadhaar(
        uint256 seed,
        uint256 nullifier,
        uint256 timestamp,
        uint256[4] calldata revealArray,
        uint256[8] calldata groth16Proof
    ) external {
        if (seed != nullifierSeed) revert WrongSeed();
        if (patients[msg.sender].verified) revert AlreadyVerified();
        if (nullifierOwner[nullifier] != address(0)) revert DuplicateAadhaar(nullifierOwner[nullifier]);
        // signal = the caller: a proof made for one wallet cannot be replayed by another
        if (!anonAadhaar.verifyAnonAadhaarProof(seed, nullifier, timestamp, uint256(uint160(msg.sender)), revealArray, groth16Proof)) {
            revert InvalidAadhaarProof();
        }
        if (revealArray[0] != 1) revert Underage();
        nullifierOwner[nullifier] = msg.sender;
        patients[msg.sender] = Patient(true, true, revealArray[3], uint64(timestamp), uint64(block.timestamp));
        verifiedCount++;
        emit PatientVerified(msg.sender, nullifier, true, revealArray[3]);
    }

    function isVerified(address a) external view returns (bool) {
        return patients[a].verified;
    }
}
