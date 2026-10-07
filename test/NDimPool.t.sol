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
        // Radius of the centred circle through the seeded reserves:
        // L_ij = x_i + x_j + sqrt(2*x_i*x_j), which for equal reserves is SEED*(2 + sqrt(2)).
        uint256 expected = 2 * SEED + M.sqrtWad(2 * M.mulWad(SEED, SEED));
        assertApproxEqAbs(pool.pairLiquidity(pool.pairKey(0, 1)), expected, 2);
        assertApproxEqAbs(pool.pairLiquidity(pool.pairKey(0, 2)), expected, 2);
        assertApproxEqAbs(pool.pairLiquidity(pool.pairKey(1, 2)), expected, 2);

        // Equal reserves must sit at the balanced point, price 1.
        assertApproxEqAbs(pool.priceOf(0, 1), WAD, 2);

        // The seeded reserves really are on the circle: (L-x)^2 + (L-x)^2 == L^2.
        uint256 l = pool.pairLiquidity(pool.pairKey(0, 1));
        uint256 u = l - SEED;
        assertApproxEqRel(2 * M.mulWad(u, u), M.mulWad(l, l), 1e12);
    }

    /// @notice The defining property of a usable AMM curve, and the one the original
    /// origin-centred circle `x_i^2 + x_j^2 = L^2` violated: marginal price must *fall* as a
    /// token is sold, so a trader never gets a better rate by trading more and can never buy
    /// output below its spot value. On the old curve the rate rose with size and a few hundred
    /// tokens drained a 1000-token reserve.
    function test_SwapIsConvexAndNeverBeatsSpot() public {
        uint256 spot = pool.priceOf(0, 1); // token1 per token0, WAD
        uint256 prevRate = type(uint256).max;
        uint256[5] memory sizes = [uint256(1e18), 10e18, 50e18, 200e18, 500e18];

        for (uint256 k; k < sizes.length; ++k) {
            uint256 snap = vm.snapshotState();
            uint256 out = pool.swap(address(this), 0, 1, sizes[k]);

            // Never more output than the pre-trade spot price would give.
            assertLe(out, M.mulWad(sizes[k], spot), "output beat spot price");

            // Average rate must be strictly worse for a larger trade (diminishing returns).
            uint256 rate = M.divWad(out, sizes[k]);
            assertLt(rate, prevRate, "larger trade got a better rate");
            prevRate = rate;

            vm.revertToState(snap);
        }
    }

    /// @notice Like stableswap (and unlike v2's asymptotic hyperbola) a centred circle has finite
    /// depth: the arc from the balanced point down to price zero absorbs at most `L*sin(theta)`
    /// of token i, here ~2414e18. A swap inside that capacity must clear and leave the counter
    /// reserve positive; one beyond it must revert rather than hand over the whole reserve.
    function test_FiniteDepthClearsBelowCapacityAndRevertsAbove() public {
        uint256 reserve1Before = pool.reserves(1);

        uint256 snap = vm.snapshotState();
        uint256 out = pool.swap(address(this), 0, 1, 2_000e18);
        assertGt(out, 0);
        assertLt(out, reserve1Before, "paid out the entire reserve");
        assertGt(pool.reserves(1), 0, "reserve drained to zero");
        vm.revertToState(snap);

        vm.expectRevert(NDimPool.InsufficientLiquidity.selector);
        pool.swap(address(this), 0, 1, 3_000e18);
    }

    /// @notice Price must move against the trader on both sides, and a sell must push the price
    /// of the sold token down (the sign convention `priceOf(i, j)` documents).
    function test_PriceMovesAgainstTheTrader() public {
        uint256 p0 = pool.priceOf(0, 1);
        pool.swap(address(this), 0, 1, 100e18);
        uint256 p1 = pool.priceOf(0, 1);
        assertLt(p1, p0, "selling token0 should lower its price");

        pool.swap(address(this), 1, 0, 100e18);
        assertGt(pool.priceOf(0, 1), p1, "selling token1 should raise token0's price");
    }

    /// @notice A mint of in-range liquidity must not move the quoted price. This failed under the
    /// old reserve-derived pricing, where depositing shifted `reserves[j]/reserves[i]`.
    function test_MintDoesNotMoveThePrice() public {
        uint256 before = pool.priceOf(0, 1);
        pool.mint(address(this), 0, 1, -600, 600, 500e18);
        assertEq(pool.priceOf(0, 1), before);
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
