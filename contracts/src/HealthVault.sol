// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IClinicianRegistry {
    function isClinician(address who) external view returns (bool);
}

/// @title HealthVault — patient-owned records, time-bound role-based access, on-chain audit trail.
/// @notice Records live encrypted on IPFS. On-chain: only the content hash + CID, who may read it until when,
///         and a log of every grant, revoke, view and change. The record key is wrapped (ECIES) to each
///         grantee's public key; revoking re-keys the record so a revoked doctor's old key stops working.
contract HealthVault {
    enum Role {
        None,
        Doctor,
        Hospital,
        Lab,
        Pharmacy,
        Emergency
    }

    struct Record {
        address owner;
        bytes32 contentHash; // keccak256 of the ciphertext
        string cid; // IPFS CIDv1 of the ciphertext
        string kind; // "encounter" | "lab" | "prescription" | "emergency-card"
        uint64 version;
        uint64 updatedAt;
    }

    struct Grant {
        Role role;
        uint64 expiresAt;
        uint64 keyVersion; // which record version the wrapped key opens
        bytes wrappedKey; // ECIES(recordKey) to grantee pubkey — useless to anyone else
    }

    mapping(bytes32 => Record) public records;
    mapping(bytes32 => mapping(address => Grant)) internal grants;
    mapping(address => bytes32[]) internal ownerRecords;
    mapping(bytes32 => address[]) internal granteeList;
    mapping(address => bytes) public encryptionKey; // registered pubkey for key wrapping

    address public breakGlass; // may write Emergency grants
    IClinicianRegistry public immutable registry; // Doctor grants only to NMC-verified clinicians

    event KeyRegistered(address indexed who, bytes pubKey);
    event RecordRegistered(bytes32 indexed recordId, address indexed owner, bytes32 contentHash, string cid, string kind);
    event RecordUpdated(bytes32 indexed recordId, bytes32 contentHash, string cid, uint64 version, string reason);
    event AccessGranted(bytes32 indexed recordId, address indexed grantee, Role role, uint64 expiresAt);
    event AccessRevoked(bytes32 indexed recordId, address indexed grantee);
    event AccessLogged(bytes32 indexed recordId, address indexed viewer, Role role, string purpose, uint64 at);

    error NotOwner();
    error NoAccess();
    error Exists();
    error NotVerifiedClinician();

    constructor(address _breakGlass, IClinicianRegistry _registry) {
        breakGlass = _breakGlass;
        registry = _registry;
    }

    function registerKey(bytes calldata pubKey) external {
        encryptionKey[msg.sender] = pubKey;
        emit KeyRegistered(msg.sender, pubKey);
    }

    function registerRecord(bytes32 recordId, bytes32 contentHash, string calldata cid, string calldata kind) external {
        if (records[recordId].owner != address(0)) revert Exists();
        records[recordId] = Record(msg.sender, contentHash, cid, kind, 1, uint64(block.timestamp));
        ownerRecords[msg.sender].push(recordId);
        emit RecordRegistered(recordId, msg.sender, contentHash, cid, kind);
    }

    /// @notice Re-key / amend: new ciphertext replaces the old one. Logged with a reason.
    function updateRecord(bytes32 recordId, bytes32 contentHash, string calldata cid, string calldata reason) external {
        Record storage r = records[recordId];
        if (r.owner != msg.sender) revert NotOwner();
        r.contentHash = contentHash;
        r.cid = cid;
        r.version++;
        r.updatedAt = uint64(block.timestamp);
        emit RecordUpdated(recordId, contentHash, cid, r.version, reason);
    }

    function grantAccess(bytes32 recordId, address grantee, Role role, uint64 expiresAt, bytes calldata wrappedKey) public {
        Record storage r = records[recordId];
        if (r.owner != msg.sender && !(msg.sender == breakGlass && role == Role.Emergency)) revert NotOwner();
        if (role == Role.Doctor && address(registry) != address(0) && !registry.isClinician(grantee)) revert NotVerifiedClinician();
        if (grants[recordId][grantee].role == Role.None) granteeList[recordId].push(grantee);
        grants[recordId][grantee] = Grant(role, expiresAt, r.version, wrappedKey);
        emit AccessGranted(recordId, grantee, role, expiresAt);
    }

    function revokeAccess(bytes32 recordId, address grantee) external {
        if (records[recordId].owner != msg.sender) revert NotOwner();
        grants[recordId][grantee].expiresAt = 0;
        grants[recordId][grantee].wrappedKey = "";
        emit AccessRevoked(recordId, grantee);
    }

    function canAccess(bytes32 recordId, address who) public view returns (bool) {
        Grant storage g = grants[recordId][who];
        return who == records[recordId].owner || (g.expiresAt > block.timestamp && g.keyVersion == records[recordId].version);
    }

    /// @notice Every view is written on-chain (bonus: audit trail). The UI calls this before decrypting.
    function logAccess(bytes32 recordId, string calldata purpose) external {
        if (!canAccess(recordId, msg.sender)) revert NoAccess();
        Role role = msg.sender == records[recordId].owner ? Role.None : grants[recordId][msg.sender].role;
        emit AccessLogged(recordId, msg.sender, role, purpose, uint64(block.timestamp));
    }

    function getGrant(bytes32 recordId, address grantee) external view returns (Grant memory) {
        return grants[recordId][grantee];
    }

    function recordsOf(address owner) external view returns (bytes32[] memory) {
        return ownerRecords[owner];
    }

    function granteesOf(bytes32 recordId) external view returns (address[] memory) {
        return granteeList[recordId];
    }
}
