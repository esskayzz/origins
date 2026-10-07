// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NDimPool} from "../src/NDimPool.sol";
import {TestERC20} from "../src/test/TestERC20.sol";

/// @notice Integration tests that fork a live local node (default `anvil` at
/// http://127.0.0.1:8545, override with the `ANVIL_RPC_URL` env var) and deploy + exercise a
/// fresh `NDimPool` against it over a real RPC connection -- the same path
/// `script/DeployNDimPool.s.sol` and the frontend use, as opposed to the in-memory EVM the rest
/// of the suite (test/NDimPool.t.sol) runs against.
///
/// Skips itself (rather than failing) when no node is reachable, so a plain `forge test` still
/// passes for contributors who don't have `anvil` running. Run with:
///   anvil                                                        # in one terminal
///   forge test --match-contract NDimPoolAnvilIntegrationTest -vv # in another
contract NDimPoolAnvilIntegrationTest is Test {
    uint256 internal constant SEED = 1_000e18;

    NDimPool pool;
    TestERC20 tokenA;
    TestERC20 tokenB;
    TestERC20 tokenC;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ANVIL_RPC_URL", string("http://127.0.0.1:8545"));
        try vm.createSelectFork(rpcUrl) {
            // connected
        } catch {
            vm.skip(true, string.concat("No node reachable at ", rpcUrl, " -- start `anvil` to run this suite."));
            return;
        }

        tokenA = new TestERC20("Token A", "TKA");
        tokenB = new TestERC20("Token B", "TKB");
        tokenC = new TestERC20("Token C", "TKC");

        address[] memory tokens = new address[](3);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        tokens[2] = address(tokenC);
        pool = new NDimPool(tokens, 60, 3000);

        tokenA.mint(address(this), 10_000e18);
        tokenB.mint(address(this), 10_000e18);
        tokenC.mint(address(this), 10_000e18);
        tokenA.approve(address(pool), type(uint256).max);
        tokenB.approve(address(pool), type(uint256).max);
        tokenC.approve(address(pool), type(uint256).max);

        uint256[] memory initialReserves = new uint256[](3);
        initialReserves[0] = SEED;
        initialReserves[1] = SEED;
        initialReserves[2] = SEED;
        pool.initialize(initialReserves);
    }

    function test_ProvideLiquidityOnAnvil() public {
        bytes32 pk = pool.pairKey(0, 1);
        uint256 liquidityBefore = pool.pairLiquidity(pk);
        uint256 reserve0Before = pool.reserves(0);
        uint256 reserve1Before = pool.reserves(1);

        (uint256 amountI, uint256 amountJ) = pool.mint(address(this), 0, 1, -6000, 6000, 200e18);

        assertEq(pool.pairLiquidity(pk), liquidityBefore + 200e18);
        assertEq(pool.reserves(0), reserve0Before + amountI);
        assertEq(pool.reserves(1), reserve1Before + amountJ);
        assertGt(amountI, 0);
        assertGt(amountJ, 0);
    }

    function test_SwapOnAnvil() public {
        pool.mint(address(this), 0, 1, -6000, 6000, 200e18);

        uint256 balanceBefore = tokenB.balanceOf(address(this));
        uint256 reserve2Before = pool.reserves(2);

        uint256 amountOut = pool.swap(address(this), 0, 1, 10e18);

        assertGt(amountOut, 0);
        assertEq(tokenB.balanceOf(address(this)), balanceBefore + amountOut);
        assertEq(pool.reserves(2), reserve2Before); // unrelated reserve untouched
    }

    function test_ProvideLiquidityAcrossAllPairsThenSwapEach() public {
        pool.mint(address(this), 0, 1, -6000, 6000, 200e18);
        pool.mint(address(this), 0, 2, -6000, 6000, 200e18);
        pool.mint(address(this), 1, 2, -6000, 6000, 200e18);

        assertGt(pool.swap(address(this), 0, 1, 5e18), 0);
        assertGt(pool.swap(address(this), 0, 2, 5e18), 0);
        assertGt(pool.swap(address(this), 1, 2, 5e18), 0);
    }
}
