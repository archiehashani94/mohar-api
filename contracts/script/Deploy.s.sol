// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {BINR} from "../src/BINR.sol";
import {Regulator} from "../src/Regulator.sol";
import {ClaimSettlement, IHonkVerifier} from "../src/ClaimSettlement.sol";
import {HonkVerifier} from "../src/HonkVerifier.sol";
import {HealthVault, IClinicianRegistry} from "../src/HealthVault.sol";
import {BreakGlass} from "../src/BreakGlass.sol";
import {PatientRegistry} from "../src/PatientRegistry.sol";
import {AnonAadhaar} from "../src/AnonAadhaar.sol";
import {Verifier as AnonAadhaarGroth16Verifier} from "../src/AnonAadhaarVerifier.sol";
import {IAnonAadhaar} from "../interfaces/IAnonAadhaar.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $PK
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        BINR token = new BINR();
        Regulator reg = new Regulator();
        HonkVerifier verifier = new HonkVerifier();
        ClaimSettlement cs = new ClaimSettlement(reg, token, IHonkVerifier(address(verifier)));
        BreakGlass bg = new BreakGlass();
        HealthVault vault = new HealthVault(address(bg), IClinicianRegistry(address(reg)));
        bg.setVault(vault);
        // Anon Aadhaar in TEST mode (UIDAI test key). Production: productionPublicKeyHash.
        uint256 pubkeyHash = vm.envOr("AADHAAR_PUBKEY_HASH", uint256(15134874015316324267425466444584014077184337590635665158241104437045239495873));
        AnonAadhaar aa = new AnonAadhaar(address(new AnonAadhaarGroth16Verifier()), pubkeyHash);
        PatientRegistry patients = new PatientRegistry(IAnonAadhaar(address(aa)), 11651504, true);
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", block.number);
        vm.serializeAddress(o, "token", address(token));
        vm.serializeAddress(o, "regulator", address(reg));
        vm.serializeAddress(o, "verifier", address(verifier));
        vm.serializeAddress(o, "claimSettlement", address(cs));
        vm.serializeAddress(o, "breakGlass", address(bg));
        vm.serializeAddress(o, "anonAadhaar", address(aa));
        vm.serializeAddress(o, "patientRegistry", address(patients));
        string memory out = vm.serializeAddress(o, "healthVault", address(vault));
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console.log("ClaimSettlement", address(cs));
    }
}
