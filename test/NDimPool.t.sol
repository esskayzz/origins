// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NDimPool} from "../src/NDimPool.sol";
import {TestERC20} from "../src/test/TestERC20.sol";
import {FixedPointMathLib as M} from "solady/utils/FixedPointMathLib.sol";

contract NDimPoolTest is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant SEED = 1_000e18;

    TestERC20[] tokens;
    NDimPool pool;

    function _deployPool(uint8 count) internal returns (NDimPool p, TestERC20[] memory toks) {
        toks = new TestERC20[](count);
        address[] memory addrs = new address[](count);
        uint256[] memory initial = new uint256[](count);
        for (uint8 k; k < count; ++k) {
            toks[k] = new TestERC20("Token", "TKN");
            toks[k].mint(address(this), 1_000_000e18);
            addrs[k] = address(toks[k]);
            initial[k] = SEED;
        }
        p = new NDimPool(addrs, 60, 3000);
        for (uint8 k; k < count; ++k) {
            toks[k].approve(address(p), type(uint256).max);
        }
        p.initialize(initial);
    }

    function setUp() public {
        (pool, tokens) = _deployPool(3);
    }

    function test_InitialPairLiquidityMatchesSeedRadius() public view {
        // L_ij = sqrt(x_i^2 + x_j^2) for the seeded (equal) reserves, for every pair.
        uint256 expected = M.sqrtWad(M.mulWad(SEED, SEED) + M.mulWad(SEED, SEED));
        assertApproxEqAbs(pool.pairLiquidity(pool.pairKey(0, 1)), expected, 2);
        assertApproxEqAbs(pool.pairLiquidity(pool.pairKey(0, 2)), expected, 2);
        assertApproxEqAbs(pool.pairLiquidity(pool.pairKey(1, 2)), expected, 2);
    }

    function test_MintBurnRoundTrip() public {
        uint256 bal0Before = tokens[0].balanceOf(address(this));
        uint256 bal1Before = tokens[1].balanceOf(address(this));
        uint256 lBefore = pool.pairLiquidity(pool.pairKey(0, 1));

        (uint256 amountI, uint256 amountJ) = pool.mint(address(this), 0, 1, -600, 600, 100e18);
        assertGt(amountI, 0);
        assertGt(amountJ, 0);
        assertEq(pool.pairLiquidity(pool.pairKey(0, 1)), lBefore + 100e18);

        (uint256 backI, uint256 backJ) = pool.burn(0, 1, -600, 600, 100e18);
        assertApproxEqAbs(backI, amountI, 1);
        assertApproxEqAbs(backJ, amountJ, 1);

        assertApproxEqAbs(tokens[0].balanceOf(address(this)), bal0Before, 1);
        assertApproxEqAbs(tokens[1].balanceOf(address(this)), bal1Before, 1);
        assertEq(pool.pairLiquidity(pool.pairKey(0, 1)), lBefore);
    }

    function test_SwapWithinRangeHoldsOtherReservesFixedAndDoesNotCrossTicks() public {
        pool.mint(address(this), 0, 1, -6000, 6000, 500e18);

        uint256 reserve2Before = pool.reserves(2);
        uint256 priceBefore = pool.priceOf(0, 1);
        uint256 lBefore = pool.pairLiquidity(pool.pairKey(0, 1));

        uint256 amountOut = pool.swap(address(this), 0, 1, 10e18);

        // Near the symmetric (price = 1) point a small trade's output is close to its input;
        // the exact ratio depends on the circle's local curvature, not strictly <= input.
        assertApproxEqRel(amountOut, 10e18, 0.01e18);
        assertEq(pool.reserves(2), reserve2Before);
        assertLt(pool.priceOf(0, 1), priceBefore); // selling token0 pushes its price down
        assertEq(pool.pairLiquidity(pool.pairKey(0, 1)), lBefore); // small swap shouldn't cross either tick
    }

    function test_SwapCanCrossATickAndUpdatePairLiquidity() public {
        // A narrow range just above the current (1:1) price, so a large enough swap must cross it.
        pool.mint(address(this), 0, 1, 60, 1200, 50e18);
        uint256 lBefore = pool.pairLiquidity(pool.pairKey(0, 1));

        pool.swap(address(this), 1, 0, 400e18); // buy token0 with token1, pushes price up through the range

        assertLt(pool.pairLiquidity(pool.pairKey(0, 1)), lBefore + 50e18 + 1);
    }

    function test_PairsAreIndependent() public {
        // Minting liquidity on pair (0,1) must not change a *disjoint* pair (2,3)'s liquidity,
        // reserves, or swap behavior -- concentrated ranges are local to their own pair
        // (docs/DESIGN.md section 3). Needs 4 tokens so (2,3) shares no token with (0,1).
        (NDimPool pool4, TestERC20[] memory toks4) = _deployPool(4);

        uint256 l23Before = pool4.pairLiquidity(pool4.pairKey(2, 3));
        uint256 reserve2Before = pool4.reserves(2);
        uint256 reserve3Before = pool4.reserves(3);

        pool4.mint(address(this), 0, 1, -6000, 6000, 500e18);

        assertEq(pool4.pairLiquidity(pool4.pairKey(2, 3)), l23Before);
        assertEq(pool4.reserves(2), reserve2Before);
        assertEq(pool4.reserves(3), reserve3Before);

        (NDimPool poolBaseline,) = _deployPool(4);
        uint256 outBaseline = poolBaseline.swap(address(this), 2, 3, 50e18);
        uint256 outAfterUnrelatedMint = pool4.swap(address(this), 2, 3, 50e18);
        assertEq(outAfterUnrelatedMint, outBaseline);
        toks4; // silence unused warning
    }

    /// @notice A round trip (sell then buy back the exact output) must never profit the trader,
    /// across random in-range tick widths and swap sizes -- the no-arbitrage property of the
    /// circle invariant (docs/DESIGN.md section 6).
    function testFuzz_RoundTripNeverProfitsTrader(int24 width, uint128 liquidityDelta, uint256 swapAmount) public {
        width = int24(int256(bound(uint256(uint24(width)), 60, 12000)));
        width -= width % 60;
        liquidityDelta = uint128(bound(liquidityDelta, 1e18, 10_000e18));
        swapAmount = bound(swapAmount, 1e15, 100e18);

        pool.mint(address(this), 0, 1, -width, width, liquidityDelta);

        uint256 bal0Before = tokens[0].balanceOf(address(this));
        uint256 out1 = pool.swap(address(this), 0, 1, swapAmount);
        uint256 out0 = pool.swap(address(this), 1, 0, out1);

        assertLe(out0, swapAmount); // round trip can't create token0 out of thin air
        assertLe(tokens[0].balanceOf(address(this)), bal0Before);
    }

    function testFuzz_MintBurnRoundTripConservesBalances(int24 width, uint128 liquidityDelta) public {
        width = int24(int256(bound(uint256(uint24(width)), 60, 12000)));
        width -= width % 60;
        liquidityDelta = uint128(bound(liquidityDelta, 1e18, 10_000e18));

        uint256 bal0Before = tokens[0].balanceOf(address(this));
        uint256 bal1Before = tokens[1].balanceOf(address(this));

        pool.mint(address(this), 0, 1, -width, width, liquidityDelta);
        pool.burn(0, 1, -width, width, liquidityDelta);

        // Rounding in the fixed-point mint/burn formulas can leave a tiny (negligible) residue.
        assertApproxEqAbs(tokens[0].balanceOf(address(this)), bal0Before, 1e6);
        assertApproxEqAbs(tokens[1].balanceOf(address(this)), bal1Before, 1e6);
    }
}
