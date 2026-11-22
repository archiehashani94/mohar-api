// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {HealthVault} from "./HealthVault.sol";

/// @title BreakGlass — emergency access when the patient is incapacitated.
/// @notice The emergency-card key is split 2-of-3 (Shamir) between guardians the patient picked.
///         A responder (e.g. scanning the patient's emergency QR) files a request; each approving guardian
///         re-wraps THEIR share to the responder. Two shares reconstruct the key — so access is enforced
///         cryptographically, not just by a flag. Every step is a loud on-chain event the patient sees later.
contract BreakGlass {
    uint8 public constant THRESHOLD = 2;
    uint64 public constant ACCESS_WINDOW = 24 hours;

    struct Setup {
        address[3] guardians;
        bytes32 emergencyRecordId;
        bytes[3] wrappedShares; // share i wrapped to guardian i
        bool active;
    }

    struct Request {
        address patient;
        address responder;
        bytes responderPubKey;
        string reason;
        string responderId; // e.g. ambulance / ER registration number
        uint64 createdAt;
        uint8 approvals;
        bool unlocked;
        uint64 expiresAt;
    }

    HealthVault public vault;
    mapping(address => Setup) internal setups;
    Request[] public requests;
    mapping(uint256 => mapping(address => bytes)) public responderShares; // requestId => guardian => share wrapped to responder
    mapping(uint256 => address[]) internal approvers;

    event GuardiansSet(address indexed patient, address[3] guardians, bytes32 emergencyRecordId);
    event EmergencyRequested(uint256 indexed requestId, address indexed patient, address indexed responder, string reason, string responderId);
    event EmergencyApproved(uint256 indexed requestId, address indexed guardian, uint8 approvals);
    event EmergencyUnlocked(uint256 indexed requestId, address indexed patient, address indexed responder, uint64 expiresAt);
    event EmergencyViewed(uint256 indexed requestId, address indexed responder, uint64 at);

    error NotGuardian();
    error AlreadyApproved();
    error NoSetup();
    error NotResponder();
    error Expired();

    function setVault(HealthVault v) external {
        require(address(vault) == address(0), "set");
        vault = v;
    }

    function setGuardians(address[3] calldata guardians, bytes32 emergencyRecordId, bytes[3] calldata wrappedShares) external {
        setups[msg.sender] = Setup(guardians, emergencyRecordId, wrappedShares, true);
        emit GuardiansSet(msg.sender, guardians, emergencyRecordId);
    }

    function getSetup(address patient) external view returns (Setup memory) {
        return setups[patient];
    }

    function request(address patient, bytes calldata responderPubKey, string calldata reason, string calldata responderId)
        external
        returns (uint256 id)
    {
        if (!setups[patient].active) revert NoSetup();
        requests.push(Request(patient, msg.sender, responderPubKey, reason, responderId, uint64(block.timestamp), 0, false, 0));
        id = requests.length - 1;
        emit EmergencyRequested(id, patient, msg.sender, reason, responderId);
    }

    function approve(uint256 id, bytes calldata shareForResponder) external {
        Request storage r = requests[id];
        Setup storage s = setups[r.patient];
        bool isG;
        for (uint256 i; i < 3; i++) if (s.guardians[i] == msg.sender) isG = true;
        if (!isG) revert NotGuardian();
        if (responderShares[id][msg.sender].length != 0) revert AlreadyApproved();
        responderShares[id][msg.sender] = shareForResponder;
        approvers[id].push(msg.sender);
        r.approvals++;
        emit EmergencyApproved(id, msg.sender, r.approvals);
        if (r.approvals == THRESHOLD && !r.unlocked) {
            r.unlocked = true;
            r.expiresAt = uint64(block.timestamp) + ACCESS_WINDOW;
            emit EmergencyUnlocked(id, r.patient, r.responder, r.expiresAt);
        }
    }

    /// @notice Responder logs each view of the emergency card while the window is open.
    function logView(uint256 id) external {
        Request storage r = requests[id];
        if (msg.sender != r.responder) revert NotResponder();
        if (!r.unlocked || r.expiresAt < block.timestamp) revert Expired();
        emit EmergencyViewed(id, msg.sender, uint64(block.timestamp));
    }

    function approversOf(uint256 id) external view returns (address[] memory) {
        return approvers[id];
    }

    function requestCount() external view returns (uint256) {
        return requests.length;
    }
}
