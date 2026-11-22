// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Regulator} from "./Regulator.sol";
import {BINR} from "./BINR.sol";

interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title ClaimSettlement — policies, insurer pools, and blind zero-knowledge claim settlement.
/// @notice The contract never sees a diagnosis, procedure, bill line, hospital identity or policy term.
///         It sees 7 numbers, checks a ZK proof over them, and pays a one-time address.
///         Anyone (e.g. a relayer) may submit, so the hospital's wallet never appears either.
contract ClaimSettlement {
    struct Policy {
        address insurer;
        bool active;
        uint64 issuedAt;
        uint256 used; // paise already paid out — fed into the proof as `used_before`
    }

    struct ClaimPublic {
        bytes32 hospitalRoot;
        bytes32 policyCommitment;
        bytes32 nullifier;
        uint64 claimDate;
        uint256 usedBefore;
        uint256 payoutAmount;
        address payoutRecipient;
    }

    uint256 public constant MAX_CLAIM_AGE = 90 days;
    uint256 public constant MAX_CLOCK_SKEW = 1 hours;
    uint256 public constant VERIFY_GAS_CAP = 6_000_000; // bounds griefing by malformed proofs

    Regulator public immutable regulator;
    BINR public immutable token;
    IHonkVerifier public immutable verifier;

    mapping(bytes32 => Policy) public policies;
    mapping(address => uint256) public pool; // insurer => bINR reserve
    mapping(bytes32 => bool) public nullifierUsed;
    uint256 public claimsSettled;
    uint256 public totalPaid;

    uint256 private locked = 1;

    event PolicyIssued(bytes32 indexed commitment, address indexed insurer);
    event PolicyCancelled(bytes32 indexed commitment);
    event PoolFunded(address indexed insurer, uint256 amount);
    event ClaimSettled(
        bytes32 indexed nullifier,
        bytes32 indexed policyCommitment,
        address indexed insurer,
        uint256 payout,
        address recipient,
        uint64 claimDate
    );

    error Paused();
    error NotInsurer();
    error PolicyExists();
    error PolicyNotActive();
    error UnknownHospitalRoot();
    error NullifierUsed();
    error StaleUsedAmount(uint256 expected, uint256 got);
    error ClaimDateInFuture();
    error ClaimTooOld();
    error ZeroPayout();
    error PoolTooLow(uint256 have, uint256 need);
    error InvalidProof();
    error Reentrancy();

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(Regulator _regulator, BINR _token, IHonkVerifier _verifier) {
        regulator = _regulator;
        token = _token;
        verifier = _verifier;
    }

    // ---------------- insurer side ----------------
    /// @notice Terms are committed once and can never change.
    function issuePolicy(bytes32 commitment) external {
        if (!regulator.isInsurer(msg.sender)) revert NotInsurer();
        if (policies[commitment].insurer != address(0)) revert PolicyExists();
        policies[commitment] = Policy(msg.sender, true, uint64(block.timestamp), 0);
        emit PolicyIssued(commitment, msg.sender);
    }

    function cancelPolicy(bytes32 commitment) external {
        Policy storage p = policies[commitment];
        if (p.insurer != msg.sender) revert NotInsurer();
        p.active = false;
        emit PolicyCancelled(commitment);
    }

    function fundPool(uint256 amount) external nonReentrant {
        if (!regulator.isInsurer(msg.sender)) revert NotInsurer();
        require(token.transferFrom(msg.sender, address(this), amount), "transfer");
        pool[msg.sender] += amount;
        emit PoolFunded(msg.sender, amount);
    }

    // ---------------- claim settlement ----------------
    /// @notice Same checks as submitClaim without state changes; returns a reason for the Blind Desk / Attack Lab.
    function precheck(ClaimPublic calldata c) public view returns (bytes4) {
        if (regulator.paused()) return Paused.selector;
        if (!regulator.isValidRoot(c.hospitalRoot)) return UnknownHospitalRoot.selector;
        Policy storage p = policies[c.policyCommitment];
        if (!p.active) return PolicyNotActive.selector;
        if (nullifierUsed[c.nullifier]) return NullifierUsed.selector;
        if (c.usedBefore != p.used) return StaleUsedAmount.selector;
        if (c.claimDate > block.timestamp + MAX_CLOCK_SKEW) return ClaimDateInFuture.selector;
        if (c.claimDate + MAX_CLAIM_AGE < block.timestamp) return ClaimTooOld.selector;
        if (c.payoutAmount == 0) return ZeroPayout.selector;
        if (pool[p.insurer] < c.payoutAmount) return PoolTooLow.selector;
        return bytes4(0);
    }

    function submitClaim(bytes calldata proof, ClaimPublic calldata c) external nonReentrant {
        if (regulator.paused()) revert Paused();
        if (!regulator.isValidRoot(c.hospitalRoot)) revert UnknownHospitalRoot();
        Policy storage p = policies[c.policyCommitment];
        if (!p.active) revert PolicyNotActive();
        if (nullifierUsed[c.nullifier]) revert NullifierUsed();
        if (c.usedBefore != p.used) revert StaleUsedAmount(p.used, c.usedBefore);
        if (c.claimDate > block.timestamp + MAX_CLOCK_SKEW) revert ClaimDateInFuture();
        if (c.claimDate + MAX_CLAIM_AGE < block.timestamp) revert ClaimTooOld();
        if (c.payoutAmount == 0) revert ZeroPayout();
        if (pool[p.insurer] < c.payoutAmount) revert PoolTooLow(pool[p.insurer], c.payoutAmount);

        if (!_verify(proof, c)) revert InvalidProof();

        // effects
        nullifierUsed[c.nullifier] = true;
        p.used += c.payoutAmount;
        pool[p.insurer] -= c.payoutAmount;
        claimsSettled++;
        totalPaid += c.payoutAmount;

        // interaction
        require(token.transfer(c.payoutRecipient, c.payoutAmount), "payout");
        emit ClaimSettled(c.nullifier, c.policyCommitment, p.insurer, c.payoutAmount, c.payoutRecipient, c.claimDate);
    }

    function publicInputs(ClaimPublic calldata c) public pure returns (bytes32[] memory pi) {
        pi = new bytes32[](7);
        pi[0] = c.hospitalRoot;
        pi[1] = c.policyCommitment;
        pi[2] = c.nullifier;
        pi[3] = bytes32(uint256(c.claimDate));
        pi[4] = bytes32(c.usedBefore);
        pi[5] = bytes32(c.payoutAmount);
        pi[6] = bytes32(uint256(uint160(c.payoutRecipient)));
    }

    function _verify(bytes calldata proof, ClaimPublic calldata c) internal view returns (bool) {
        try verifier.verify{gas: VERIFY_GAS_CAP}(proof, publicInputs(c)) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
