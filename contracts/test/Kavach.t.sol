// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {BINR} from "../src/BINR.sol";
import {Regulator} from "../src/Regulator.sol";
import {ClaimSettlement, IHonkVerifier} from "../src/ClaimSettlement.sol";
import {HonkVerifier} from "../src/HonkVerifier.sol";
import {HealthVault, IClinicianRegistry} from "../src/HealthVault.sol";
import {BreakGlass} from "../src/BreakGlass.sol";

contract KavachTest is Test {
    BINR token;
    Regulator reg;
    ClaimSettlement cs;
    HonkVerifier verifier;
    address insurer = address(0x1A5);
    address relayer = address(0xBEEF);

    struct Fx {
        bytes proof;
        ClaimSettlement.ClaimPublic c;
    }

    Fx first;
    Fx second;

    function _load(string memory json, string memory k) internal pure returns (Fx memory f) {
        f.proof = vm.parseJsonBytes(json, string.concat(".", k, ".proof"));
        f.c.hospitalRoot = vm.parseJsonBytes32(json, string.concat(".", k, ".hospitalRoot"));
        f.c.policyCommitment = vm.parseJsonBytes32(json, string.concat(".", k, ".policyCommitment"));
        f.c.nullifier = vm.parseJsonBytes32(json, string.concat(".", k, ".nullifier"));
        f.c.claimDate = uint64(vm.parseJsonUint(json, string.concat(".", k, ".claimDate")));
        f.c.usedBefore = vm.parseJsonUint(json, string.concat(".", k, ".usedBefore"));
        f.c.payoutAmount = vm.parseJsonUint(json, string.concat(".", k, ".payoutAmount"));
        f.c.payoutRecipient = vm.parseJsonAddress(json, string.concat(".", k, ".payoutRecipient"));
    }

    function setUp() public {
        string memory json = vm.readFile("test/fixtures/claim.json");
        first = _load(json, "first");
        second = _load(json, "second");

        token = new BINR();
        reg = new Regulator();
        verifier = new HonkVerifier();
        cs = new ClaimSettlement(reg, token, IHonkVerifier(address(verifier)));

        reg.approveInsurer(insurer, "Demo General Insurance", "IRDAI/HLT/123");
        reg.publishRoot(first.c.hospitalRoot, false);
        token.mint(insurer, 100_000_000_00);
        vm.startPrank(insurer);
        token.approve(address(cs), type(uint256).max);
        cs.fundPool(50_000_000_00);
        cs.issuePolicy(first.c.policyCommitment);
        vm.stopPrank();
        vm.warp(first.c.claimDate + 1 hours);
    }

    // ------------------------------------------------------------ happy path
    function test_settlesValidClaim_paysGhostAddress() public {
        uint256 g0 = gasleft();
        vm.prank(relayer); // anyone can relay — hospital wallet never appears
        cs.submitClaim(first.proof, first.c);
        console.log("gas used for submitClaim (incl. Honk verify):", g0 - gasleft());
        assertEq(token.balanceOf(first.c.payoutRecipient), first.c.payoutAmount);
        assertTrue(cs.nullifierUsed(first.c.nullifier));
        (,,, uint256 used) = cs.policies(first.c.policyCommitment);
        assertEq(used, first.c.payoutAmount);
    }

    function test_secondClaimUsesUpdatedUsedAmount() public {
        cs.submitClaim(first.proof, first.c);
        cs.submitClaim(second.proof, second.c);
        (,,, uint256 used) = cs.policies(first.c.policyCommitment);
        assertEq(used, first.c.payoutAmount + second.c.payoutAmount);
    }

    // ------------------------------------------------------------ attacks
    function test_attack_replay() public {
        cs.submitClaim(first.proof, first.c);
        vm.expectRevert(ClaimSettlement.NullifierUsed.selector);
        cs.submitClaim(first.proof, first.c);
    }

    function test_attack_secondClaimBeforeFirst_staleUsed() public {
        // proof built for used_before = X cannot be used when contract says otherwise
        vm.expectRevert(abi.encodeWithSelector(ClaimSettlement.StaleUsedAmount.selector, 0, second.c.usedBefore));
        cs.submitClaim(second.proof, second.c);
    }

    function test_attack_inflatedPayout() public {
        ClaimSettlement.ClaimPublic memory c = first.c;
        c.payoutAmount += 1;
        vm.expectRevert(ClaimSettlement.InvalidProof.selector);
        cs.submitClaim(first.proof, c);
    }

    function test_attack_frontRunRecipient() public {
        ClaimSettlement.ClaimPublic memory c = first.c;
        c.payoutRecipient = address(0xBAD);
        vm.expectRevert(ClaimSettlement.InvalidProof.selector);
        cs.submitClaim(first.proof, c);
    }

    function test_attack_otherPolicy() public {
        bytes32 fake = keccak256("someone else's policy");
        vm.prank(insurer);
        cs.issuePolicy(fake);
        ClaimSettlement.ClaimPublic memory c = first.c;
        c.policyCommitment = fake;
        vm.expectRevert(ClaimSettlement.InvalidProof.selector);
        cs.submitClaim(first.proof, c);
    }

    function test_attack_tamperedProofBytes() public {
        bytes memory p = first.proof;
        p[p.length - 40] = bytes1(uint8(p[p.length - 40]) ^ 0x01);
        vm.expectRevert(ClaimSettlement.InvalidProof.selector);
        cs.submitClaim(p, first.c);
    }

    function test_attack_unknownRoot() public {
        ClaimSettlement.ClaimPublic memory c = first.c;
        c.hospitalRoot = keccak256("fake registry");
        vm.expectRevert(ClaimSettlement.UnknownHospitalRoot.selector);
        cs.submitClaim(first.proof, c);
    }

    function test_attack_revokedRootDiesImmediately() public {
        reg.publishRoot(keccak256("root without revoked hospital"), true);
        vm.expectRevert(ClaimSettlement.UnknownHospitalRoot.selector);
        cs.submitClaim(first.proof, first.c);
    }

    function test_routineRootUpdate_hasGraceWindow() public {
        reg.publishRoot(keccak256("new hospital joined"), false);
        cs.submitClaim(first.proof, first.c); // still valid within grace
    }

    function test_attack_cancelledPolicy() public {
        vm.prank(insurer);
        cs.cancelPolicy(first.c.policyCommitment);
        vm.expectRevert(ClaimSettlement.PolicyNotActive.selector);
        cs.submitClaim(first.proof, first.c);
    }

    function test_attack_claimTooOld() public {
        vm.warp(first.c.claimDate + 91 days);
        vm.expectRevert(ClaimSettlement.ClaimTooOld.selector);
        cs.submitClaim(first.proof, first.c);
    }

    function test_attack_futureDated() public {
        vm.warp(first.c.claimDate - 2 hours);
        vm.expectRevert(ClaimSettlement.ClaimDateInFuture.selector);
        cs.submitClaim(first.proof, first.c);
    }

    function test_pausedByRegulator() public {
        reg.setPaused(true);
        vm.expectRevert(ClaimSettlement.Paused.selector);
        cs.submitClaim(first.proof, first.c);
    }

    function test_poolTooLow() public {
        ClaimSettlement cs2 = new ClaimSettlement(reg, token, IHonkVerifier(address(verifier)));
        vm.prank(insurer);
        cs2.issuePolicy(first.c.policyCommitment);
        vm.expectRevert(abi.encodeWithSelector(ClaimSettlement.PoolTooLow.selector, 0, first.c.payoutAmount));
        cs2.submitClaim(first.proof, first.c);
    }

    function test_hospitalApprovalRequiresHfrAttestation() public {
        uint256 id = reg.requestListing("New Clinic", "IN2210009999", keccak256("leaf"));
        vm.expectRevert(Regulator.NotAttested.selector);
        reg.approveHospital(id);
        reg.attestHospital(id, keccak256("hfr-record"), "hfr-offline-snapshot");
        reg.approveHospital(id);
    }

    function test_onlyApprovedInsurerIssues() public {
        vm.expectRevert(ClaimSettlement.NotInsurer.selector);
        cs.issuePolicy(bytes32(uint256(1)));
    }

    function test_precheckReasons() public {
        assertEq(cs.precheck(first.c), bytes4(0));
        cs.submitClaim(first.proof, first.c);
        assertEq(cs.precheck(first.c), ClaimSettlement.NullifierUsed.selector);
    }

    function test_verifierDirect() public view {
        assertTrue(verifier.verify(first.proof, cs.publicInputs(first.c)));
    }
}

contract VaultTest is Test {
    HealthVault vault;
    Regulator reg;
    BreakGlass bg;
    address patient = address(0xA11CE);
    address doctor = address(0xD0C);
    address[3] guardians = [address(0x61), address(0x62), address(0x63)];
    address responder = address(0x911);
    bytes32 rid = keccak256("record-1");

    function setUp() public {
        bg = new BreakGlass();
        reg = new Regulator();
        reg.registerClinician(doctor, "Dr. Meera Iyer", "CGMC/2011/4471", keccak256("nmc-record"));
        vault = new HealthVault(address(bg), IClinicianRegistry(address(reg)));
        bg.setVault(vault);
        vm.prank(patient);
        vault.registerRecord(rid, keccak256("ct"), "bafkrei-demo", "encounter");
    }

    function test_grantViewRevoke_auditTrail() public {
        vm.prank(patient);
        vault.grantAccess(rid, doctor, HealthVault.Role.Doctor, uint64(block.timestamp + 1 days), hex"aa");
        assertTrue(vault.canAccess(rid, doctor));
        vm.expectEmit(true, true, false, false);
        emit HealthVault.AccessLogged(rid, doctor, HealthVault.Role.Doctor, "consult", 0);
        vm.prank(doctor);
        vault.logAccess(rid, "consult");
        vm.prank(patient);
        vault.revokeAccess(rid, doctor);
        assertFalse(vault.canAccess(rid, doctor));
        vm.prank(doctor);
        vm.expectRevert(HealthVault.NoAccess.selector);
        vault.logAccess(rid, "after revoke");
    }

    function test_timeBoundAccessExpires() public {
        vm.prank(patient);
        vault.grantAccess(rid, doctor, HealthVault.Role.Lab, uint64(block.timestamp + 1 hours), hex"aa");
        vm.warp(block.timestamp + 2 hours);
        assertFalse(vault.canAccess(rid, doctor));
    }

    function test_rekeyInvalidatesOldGrants() public {
        vm.prank(patient);
        vault.grantAccess(rid, doctor, HealthVault.Role.Doctor, uint64(block.timestamp + 1 days), hex"aa");
        vm.prank(patient);
        vault.updateRecord(rid, keccak256("ct2"), "bafkrei-v2", "re-key after revoke");
        assertFalse(vault.canAccess(rid, doctor));
    }

    function test_doctorGrantRequiresNmcVerifiedClinician() public {
        vm.prank(patient);
        vm.expectRevert(HealthVault.NotVerifiedClinician.selector);
        vault.grantAccess(rid, address(0xBAD), HealthVault.Role.Doctor, uint64(block.timestamp + 1 days), hex"aa");
        reg.suspendClinician(doctor);
        vm.prank(patient);
        vm.expectRevert(HealthVault.NotVerifiedClinician.selector);
        vault.grantAccess(rid, doctor, HealthVault.Role.Doctor, uint64(block.timestamp + 1 days), hex"aa");
    }

    function test_onlyOwnerGrants() public {
        vm.prank(doctor);
        vm.expectRevert(HealthVault.NotOwner.selector);
        vault.grantAccess(rid, doctor, HealthVault.Role.Doctor, uint64(block.timestamp + 1 days), hex"aa");
    }

    function test_breakGlass_needsTwoGuardians() public {
        bytes[3] memory shares = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        vm.prank(patient);
        bg.setGuardians(guardians, rid, shares);
        vm.prank(responder);
        uint256 id = bg.request(patient, hex"04", "unconscious, road accident", "CG-108-AMB-17");

        vm.prank(address(0xBAD));
        vm.expectRevert(BreakGlass.NotGuardian.selector);
        bg.approve(id, hex"ff");

        vm.prank(guardians[0]);
        bg.approve(id, hex"aa");
        (,,,,,,, bool unlocked,) = bg.requests(id);
        assertFalse(unlocked);

        vm.prank(guardians[0]);
        vm.expectRevert(BreakGlass.AlreadyApproved.selector);
        bg.approve(id, hex"aa");

        vm.prank(guardians[2]);
        bg.approve(id, hex"bb");
        (,,,,,,, unlocked,) = bg.requests(id);
        assertTrue(unlocked);

        vm.prank(responder);
        bg.logView(id);
        vm.warp(block.timestamp + 25 hours);
        vm.prank(responder);
        vm.expectRevert(BreakGlass.Expired.selector);
        bg.logView(id);
    }
}
