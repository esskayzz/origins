// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {NDimPool} from "../src/NDimPool.sol";
import {TestERC20} from "../src/test/TestERC20.sol";

/// @notice Deploys a 3-token NDimPool (symbols TKA/TKB/TKC) seeded with equal reserves, for
/// local/testnet experimentation with the frontend. Not for production use (TestERC20 has an
/// unrestricted public `mint`).
contract DeployNDimPool is Script {
    uint256 internal constant SEED = 1_000e18;

    function run() external {
        // Two ways to sign:
        //  - PRIVATE_KEY env var (raw key; fine for anvil's well-known dev accounts), or
        //  - no PRIVATE_KEY and `forge script --account <keystore> --sender <addr>` (or
        //    `--private-key`), in which case forge supplies the signer and we broadcast as it.
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer;
        if (deployerKey != 0) {
            deployer = vm.addr(deployerKey);
            vm.startBroadcast(deployerKey);
        } else {
            deployer = msg.sender;
            vm.startBroadcast();
        }

        TestERC20 tokenA = new TestERC20("Token A", "TKA");
        TestERC20 tokenB = new TestERC20("Token B", "TKB");
        TestERC20 tokenC = new TestERC20("Token C", "TKC");

        address[] memory tokens = new address[](3);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        tokens[2] = address(tokenC);

        NDimPool pool = new NDimPool(tokens, 60, 3000);

        tokenA.mint(deployer, SEED);
        tokenB.mint(deployer, SEED);
        tokenC.mint(deployer, SEED);
        tokenA.approve(address(pool), SEED);
        tokenB.approve(address(pool), SEED);
        tokenC.approve(address(pool), SEED);

        uint256[] memory initialReserves = new uint256[](3);
        initialReserves[0] = SEED;
        initialReserves[1] = SEED;
        initialReserves[2] = SEED;
        pool.initialize(initialReserves);

        vm.stopBroadcast();

        console.log("TokenA (TKA):", address(tokenA));
        console.log("TokenB (TKB):", address(tokenB));
        console.log("TokenC (TKC):", address(tokenC));
        console.log("NDimPool:", address(pool));
    }
}
