// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedPointMathLib as M} from "solady/utils/FixedPointMathLib.sol";

/// @notice Tick <-> price conversion (reuses v3/v4's `1.0001^tick` convention) plus the
/// circle-component helpers (`cos`, `sin`) used to place a pairwise price on the
/// `x_i^2 + x_j^2 = r^2` slice of the N-sphere invariant. All values are WAD (1e18) fixed point.
library PriceMath {
    uint256 internal constant WAD = 1e18;
    int256 internal constant BASE = 1.0001e18;

    int24 internal constant MIN_TICK = -400000;
    int24 internal constant MAX_TICK = 400000;

    /// @dev `price(tick) = 1.0001^tick`, identical convention to Uniswap v3/v4.
    function priceAtTick(int24 tick) internal pure returns (uint256) {
        int256 p = M.powWad(BASE, int256(tick) * int256(WAD));
        return uint256(p);
    }

    /// @dev `sqrt(1 + p^2)`, the normalizing radius for a unit circle point `(cos, sin)`.
    function sqrtOnePlusPSquared(uint256 p) internal pure returns (uint256) {
        return M.sqrtWad(WAD + M.mulWad(p, p));
    }

    /// @dev `cos(theta) = 1 / sqrt(1 + p^2)` where `p = tan(theta)` is the pair's price.
    function cosTheta(uint256 p) internal pure returns (uint256) {
        return M.divWad(WAD, sqrtOnePlusPSquared(p));
    }

    /// @dev `sin(theta) = p / sqrt(1 + p^2)` where `p = tan(theta)` is the pair's price.
    function sinTheta(uint256 p) internal pure returns (uint256) {
        return M.divWad(p, sqrtOnePlusPSquared(p));
    }
}
