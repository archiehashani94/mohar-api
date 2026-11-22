// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title Regulator — licensed-hospital registry (Merkle root) + approved insurers + circuit breaker.
/// @notice The approved-hospital list is public (licences are public), but a claim proof only shows
///         "I am ONE of these leaves" — never which one. Leaves are H(DOM_HOSPITAL, hospitalSecret).
///         Anyone can recompute the root from the `HospitalApproved` events and check `currentRoot`.
contract Regulator {
    enum Status {
        None,
        Pending,
        Approved,
        Revoked
    }

    struct Hospital {
        string name;
        string hfrId; // ABDM Health Facility Registry id
        bytes32 leaf;
        Status status;
        uint64 updatedAt;
        bytes32 attestation; // hash of the verified ABDM HFR facility record
        string attestationSource; // "abdm-hfr-sandbox" | "hfr-offline-snapshot"
    }

    struct Clinician {
        string name;
        string nmcRegNo; // National Medical Commission (IMR) registration number
        bytes32 attestation; // hash of the verified NMC record
        bool active;
    }

    struct Insurer {
        string name;
        string irdaiReg;
        bool approved;
    }

    uint64 public constant ROOT_GRACE = 15 minutes; // in-flight proofs survive a routine root update

    address public regulator;
    bool public paused;

    Hospital[] public hospitals;
    mapping(bytes32 => uint256) public leafToId; // id + 1
    mapping(address => Insurer) public insurers;

    bytes32 public currentRoot;
    mapping(bytes32 => uint64) public rootValidUntil;
    uint256 public rootVersion;

    event HospitalRequested(uint256 indexed id, string name, string hfrId, bytes32 leaf);
    event HospitalApproved(uint256 indexed id, bytes32 leaf);
    event HospitalRevoked(uint256 indexed id, bytes32 leaf);
    event RootPublished(uint256 indexed version, bytes32 root, bool revocation);
    event InsurerApproved(address indexed insurer, string name, string irdaiReg);
    event Paused(bool paused);
    event HospitalAttested(uint256 indexed id, bytes32 attestation, string source);
    event ClinicianRegistered(address indexed clinician, string name, string nmcRegNo, bytes32 attestation);
    event ClinicianSuspended(address indexed clinician);

    error NotRegulator();
    error BadStatus();
    error LeafExists();
    error NotAttested();

    modifier onlyRegulator() {
        if (msg.sender != regulator) revert NotRegulator();
        _;
    }

    constructor() {
        regulator = msg.sender;
    }

    // ---------------- hospitals ----------------
    /// @dev Called by (or for) a hospital. The caller address is NOT stored: the hospital's on-chain
    ///      identity is only its leaf, so later claims can't be linked to a wallet.
    function requestListing(string calldata name, string calldata hfrId, bytes32 leaf) external returns (uint256 id) {
        if (leafToId[leaf] != 0) revert LeafExists();
        hospitals.push(Hospital(name, hfrId, leaf, Status.Pending, uint64(block.timestamp), bytes32(0), ""));
        id = hospitals.length - 1;
        leafToId[leaf] = id + 1;
        emit HospitalRequested(id, name, hfrId, leaf);
    }

    /// @notice Regulator records that the facility was checked against the ABDM Health Facility Registry.
    function attestHospital(uint256 id, bytes32 attestation, string calldata source) external onlyRegulator {
        Hospital storage h = hospitals[id];
        h.attestation = attestation;
        h.attestationSource = source;
        emit HospitalAttested(id, attestation, source);
    }

    function approveHospital(uint256 id) external onlyRegulator {
        Hospital storage h = hospitals[id];
        if (h.status != Status.Pending) revert BadStatus();
        if (h.attestation == bytes32(0)) revert NotAttested();
        h.status = Status.Approved;
        h.updatedAt = uint64(block.timestamp);
        emit HospitalApproved(id, h.leaf);
    }

    function revokeHospital(uint256 id) external onlyRegulator {
        Hospital storage h = hospitals[id];
        if (h.status != Status.Approved) revert BadStatus();
        h.status = Status.Revoked;
        h.updatedAt = uint64(block.timestamp);
        emit HospitalRevoked(id, h.leaf);
    }

    /// @param revocation true when a hospital was removed: every older root dies immediately,
    ///        so a revoked hospital cannot keep proving against a stale root.
    function publishRoot(bytes32 root, bool revocation) external onlyRegulator {
        bytes32 prev = currentRoot;
        if (prev != bytes32(0)) {
            rootValidUntil[prev] = revocation ? 0 : uint64(block.timestamp) + ROOT_GRACE;
        }
        if (revocation) rootVersion++; // invalidates every root from older versions
        currentRoot = root;
        rootValidUntil[root] = type(uint64).max;
        rootEpoch[root] = rootVersion;
        emit RootPublished(rootVersion, root, revocation);
    }

    mapping(bytes32 => uint256) public rootEpoch;

    function isValidRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        if (root == currentRoot) return true;
        return rootEpoch[root] == rootVersion && rootValidUntil[root] >= block.timestamp;
    }

    function hospitalCount() external view returns (uint256) {
        return hospitals.length;
    }

    function approvedLeaves() external view returns (bytes32[] memory leaves) {
        uint256 n;
        for (uint256 i; i < hospitals.length; i++) if (hospitals[i].status == Status.Approved) n++;
        leaves = new bytes32[](n);
        uint256 j;
        for (uint256 i; i < hospitals.length; i++) if (hospitals[i].status == Status.Approved) leaves[j++] = hospitals[i].leaf;
    }

    // ---------------- clinicians (NMC Indian Medical Register) ----------------
    mapping(address => Clinician) public clinicians;

    function registerClinician(address who, string calldata name, string calldata nmcRegNo, bytes32 attestation) external onlyRegulator {
        clinicians[who] = Clinician(name, nmcRegNo, attestation, true);
        emit ClinicianRegistered(who, name, nmcRegNo, attestation);
    }

    function suspendClinician(address who) external onlyRegulator {
        clinicians[who].active = false;
        emit ClinicianSuspended(who);
    }

    function isClinician(address who) external view returns (bool) {
        return clinicians[who].active;
    }

    // ---------------- insurers ----------------
    function approveInsurer(address insurer, string calldata name, string calldata irdaiReg) external onlyRegulator {
        insurers[insurer] = Insurer(name, irdaiReg, true);
        emit InsurerApproved(insurer, name, irdaiReg);
    }

    function isInsurer(address a) external view returns (bool) {
        return insurers[a].approved;
    }

    // ---------------- circuit breaker ----------------
    function setPaused(bool p) external onlyRegulator {
        paused = p;
        emit Paused(p);
    }
}
