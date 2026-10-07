// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedPointMathLib as M} from "solady/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @title NDimPool
/// @notice Reference implementation of an N-token concentrated liquidity pool.
/// Every pair of tokens (i, j) trades along a circular slice
/// `(L_ij - x_i)^2 + (L_ij - x_j)^2 = L_ij^2` -- a circle *centred at* `(L_ij, L_ij)`, so the
/// arc reserves travel along bulges toward the origin and marginal price falls as a token is
/// sold, exactly as it must for an AMM (docs/DESIGN.md section 2). It is the sum-of-squares
/// analogue of v3/v4's `x*y = L^2` hyperbola and behaves like a stableswap curve: nearly flat
/// near the balanced point, steep at the edges. The pool reuses v3/v4's
/// `1.0001^tick` price convention and single-range concentrated-liquidity mechanics
/// (see docs/DESIGN.md). Each pair's active liquidity `L_ij` is tracked independently
/// -- concentrated liquidity ranges are inherently local to their own price axis and
/// cannot literally be shared across unrelated pairs (docs/DESIGN.md section 3). What
/// *is* shared across every pair is custody of the underlying N token balances in this
/// single contract, enabling atomic multi-hop routing without per-pair pool deployments.
///
/// Scope: this contract proves out the N-dimensional invariant/tick math. It
/// intentionally omits v4's singleton+hooks+flash-accounting architecture and
/// LP fee accounting/collection (see docs/DESIGN.md section 7).
contract NDimPool {
    using SafeTransferLib for address;

    error InvalidTokenIndex();
    error InvalidTickRange();
    error InsufficientLiquidity();
    error ZeroLiquidity();
    error ZeroReserve();
    error AlreadyInitialized();
    error NotInitialized();

    event Mint(address indexed owner, uint8 i, uint8 j, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amountI, uint256 amountJ);
    event Burn(address indexed owner, uint8 i, uint8 j, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amountI, uint256 amountJ);
    event Swap(address indexed recipient, uint8 tokenIn, uint8 tokenOut, uint256 amountIn, uint256 amountOut);

    struct TickInfo {
        uint128 liquidityGross;
        int128 liquidityNet;
    }

    struct Position {
        uint128 liquidity;
    }

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_SWAP_STEPS = 256;

    uint8 public immutable n;
    address[] public tokens;
    uint24 public immutable tickSpacing;
    /// @dev Swap fee in pips (1e6 = 100%). Fee is deducted from the input and left in the
    /// pool's reserve as an unattributed donation (see docs/DESIGN.md section 7).
    uint24 public immutable feePips;

    /// @dev Token custody only: the contract's balance of each token, shared by every pair that
    /// token participates in. NOT the source of truth for any pair's price -- see `pairPrice`.
    uint256[] public reserves;
    /// @dev Per-pair active liquidity `L_ij` -- the sum-of-squares analogue of v3's
    /// per-pool `liquidity`, and the radius of pair (i, j)'s circle, keyed by `pairKey(i, j)`.
    mapping(bytes32 => uint256) public pairLiquidity;
    /// @dev Per-pair current price `p = (L - x_i) / (L - x_j)`, WAD, keyed by `pairKey(i, j)`.
    /// Tracked as state (v3 tracks `sqrtPriceX96` the same way) rather than derived from
    /// `reserves`: once liquidity is concentrated, a position's real reserves are offset from
    /// the bare circle point by range-dependent constants (docs/DESIGN.md section 5), so the
    /// aggregate reserve ratio is no longer the price. Deriving it would also let an in-range
    /// mint move the quoted price without any trade happening.
    mapping(bytes32 => uint256) public pairPrice;

    // pairKey(i,j) => tick => info
    mapping(bytes32 => mapping(int24 => TickInfo)) public ticks;
    // pairKey(i,j) => sorted ascending list of initialized ticks
    mapping(bytes32 => int24[]) internal initializedTicks;
    // positionKey(owner,i,j,tickLower,tickUpper) => position
    mapping(bytes32 => Position) public positions;

    bool public initialized;

    constructor(address[] memory _tokens, uint24 _tickSpacing, uint24 _feePips) {
        uint256 len = _tokens.length;
        if (len < 2 || len > type(uint8).max) revert InvalidTokenIndex();

        n = uint8(len);
        tokens = _tokens;
        tickSpacing = _tickSpacing;
        feePips = _feePips;
        reserves = new uint256[](len);
    }

    /// @notice Seeds the pool's starting reserves (one per token). For every pair (i, j) this
    /// establishes base full-range liquidity by solving the centred invariant for its radius,
    /// `L_ij = x_i + x_j + sqrt(2 * x_i * x_j)` (the root with `L >= max(x_i, x_j)`, so the
    /// reserves sit on the arc nearest the origin), plus that pair's starting price. Every pair
    /// is then immediately tradeable. Must be called once, after approving this contract to pull
    /// `initialReserves` of every token from the caller.
    function initialize(uint256[] calldata initialReserves) external {
        if (initialized) revert AlreadyInitialized();
        if (initialReserves.length != n) revert InvalidTokenIndex();
        initialized = true;

        for (uint256 k; k < n; ++k) {
            uint256 amt = initialReserves[k];
            if (amt == 0) revert ZeroReserve();
            tokens[k].safeTransferFrom(msg.sender, address(this), amt);
            reserves[k] = amt;
        }
        for (uint8 i; i < n; ++i) {
            for (uint8 j = i + 1; j < n; ++j) {
                uint256 xi = reserves[i];
                uint256 xj = reserves[j];
                uint256 l = xi + xj + M.sqrtWad(2 * M.mulWad(xi, xj));
                bytes32 pk = pairKey(i, j);
                pairLiquidity[pk] = l;
                pairPrice[pk] = M.divWad(l - xi, l - xj);
            }
        }
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    function getReserves() external view returns (uint256[] memory) {
        return reserves;
    }

    /// @notice Current price of token `i` denominated in token `j` (WAD): the marginal amount of
    /// `j` one more unit of `i` buys, `-dx_j/dx_i = (L - x_i) / (L - x_j)`.
    function priceOf(uint8 i, uint8 j) external view returns (uint256) {
        return pairPrice[pairKey(i, j)];
    }

    function pairKey(uint8 i, uint8 j) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(i, j));
    }

    function positionKey(address owner, uint8 i, uint8 j, int24 tickLower, int24 tickUpper) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, i, j, tickLower, tickUpper));
    }

    // ----------------------------------------------------------------------
    // Mint / burn
    // ----------------------------------------------------------------------

    /// @notice Read-only quote for `mint`/`burn`'s required/returned token amounts -- unlike
    /// simulating `mint` itself, this never reverts for insufficient allowance/balance, so
    /// callers can size an `approve()` before ever attempting the real call.
    function previewMint(uint8 i, uint8 j, int24 tickLower, int24 tickUpper, uint128 liquidityDelta)
        external
        view
        returns (uint256 amountI, uint256 amountJ, bool inRange)
    {
        _checkPair(i, j);
        _checkTicks(tickLower, tickUpper);
        return _amountsForRange(i, j, tickLower, tickUpper, liquidityDelta);
    }

    function mint(address recipient, uint8 i, uint8 j, int24 tickLower, int24 tickUpper, uint128 liquidityDelta)
        external
        returns (uint256 amountI, uint256 amountJ)
    {
        if (!initialized) revert NotInitialized();
        _checkPair(i, j);
        _checkTicks(tickLower, tickUpper);
        if (liquidityDelta == 0) revert ZeroLiquidity();

        bool inRange;
        (amountI, amountJ, inRange) = _amountsForRange(i, j, tickLower, tickUpper, liquidityDelta);

        if (amountI > 0) tokens[i].safeTransferFrom(msg.sender, address(this), amountI);
        if (amountJ > 0) tokens[j].safeTransferFrom(msg.sender, address(this), amountJ);
        reserves[i] += amountI;
        reserves[j] += amountJ;

        bytes32 pk = pairKey(i, j);
        _updateTick(pk, tickLower, liquidityDelta, true, true);
        _updateTick(pk, tickUpper, liquidityDelta, true, false);

        bytes32 posKey = positionKey(recipient, i, j, tickLower, tickUpper);
        positions[posKey].liquidity += liquidityDelta;

        if (inRange) pairLiquidity[pk] += liquidityDelta;

        emit Mint(recipient, i, j, tickLower, tickUpper, liquidityDelta, amountI, amountJ);
    }

    function burn(uint8 i, uint8 j, int24 tickLower, int24 tickUpper, uint128 liquidityDelta)
        external
        returns (uint256 amountI, uint256 amountJ)
    {
        _checkPair(i, j);
        _checkTicks(tickLower, tickUpper);
        if (liquidityDelta == 0) revert ZeroLiquidity();

        bytes32 posKey = positionKey(msg.sender, i, j, tickLower, tickUpper);
        Position storage pos = positions[posKey];
        if (pos.liquidity < liquidityDelta) revert InsufficientLiquidity();

        bool inRange;
        (amountI, amountJ, inRange) = _amountsForRange(i, j, tickLower, tickUpper, liquidityDelta);

        pos.liquidity -= liquidityDelta;

        bytes32 pk = pairKey(i, j);
        _updateTick(pk, tickLower, liquidityDelta, false, true);
        _updateTick(pk, tickUpper, liquidityDelta, false, false);

        if (inRange) pairLiquidity[pk] -= liquidityDelta;

        reserves[i] -= amountI;
        reserves[j] -= amountJ;
        if (amountI > 0) tokens[i].safeTransfer(msg.sender, amountI);
        if (amountJ > 0) tokens[j].safeTransfer(msg.sender, amountJ);

        emit Burn(msg.sender, i, j, tickLower, tickUpper, liquidityDelta, amountI, amountJ);
    }

    /// @dev Token amounts for `liquidityDelta` over `[tickLower, tickUpper]` at the current
    /// price of pair (i, j), using the circle analogue of v3's mint/burn formulas
    /// (docs/DESIGN.md section 5). Also reports whether the range is currently active, i.e.
    /// whether `liquidityDelta` should be added to/removed from `pairLiquidity[pairKey(i,j)]`.
    function _amountsForRange(uint8 i, uint8 j, int24 tickLower, int24 tickUpper, uint128 liquidityDelta)
        internal
        view
        returns (uint256 amountI, uint256 amountJ, bool inRange)
    {
        uint256 pCurrent = pairPrice[pairKey(i, j)];
        uint256 pA = PriceMath.priceAtTick(tickLower);
        uint256 pB = PriceMath.priceAtTick(tickUpper);

        uint256 cosA = PriceMath.cosTheta(pA);
        uint256 sinA = PriceMath.sinTheta(pA);
        uint256 cosB = PriceMath.cosTheta(pB);
        uint256 sinB = PriceMath.sinTheta(pB);

        // `sin` grows with price and `cos` shrinks, so `amount_i` empties at the upper tick and
        // `amount_j` at the lower -- the same boundary conditions as v3, with cos/sin swapped
        // relative to the old origin-centred circle because reserves are now `L - L*sin`/
        // `L - L*cos` rather than `L*cos`/`L*sin`.
        if (pCurrent <= pA) {
            amountI = M.mulWad(liquidityDelta, sinB - sinA);
            amountJ = 0;
        } else if (pCurrent >= pB) {
            amountI = 0;
            amountJ = M.mulWad(liquidityDelta, cosA - cosB);
            inRange = false;
        } else {
            amountI = M.mulWad(liquidityDelta, sinB - PriceMath.sinTheta(pCurrent));
            amountJ = M.mulWad(liquidityDelta, cosA - PriceMath.cosTheta(pCurrent));
            inRange = true;
        }
    }

    // ----------------------------------------------------------------------
    // Swap
    // ----------------------------------------------------------------------

    /// @notice Swaps an exact `amountIn` of `tokenIn` for `tokenOut`. Only `tokenIn`/`tokenOut`
    /// reserves move; every other reserve is held fixed. Walks pair (i, j)'s own ticks, exactly
    /// like a v3 pool, applying per-step deltas `Delta = L_ij * (cos/sin theta_2 - cos/sin theta_1)`
    /// (docs/DESIGN.md section 6) -- these deltas are offset-free regardless of how `L_ij` is
    /// distributed across overlapping ranges, so no absolute "reset to r*cos(theta)" is needed.
    function swap(address recipient, uint8 tokenIn, uint8 tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        if (!initialized) revert NotInitialized();
        if (tokenIn == tokenOut || tokenIn >= n || tokenOut >= n) revert InvalidTokenIndex();
        if (amountIn == 0) return 0;

        uint8 i = tokenIn < tokenOut ? tokenIn : tokenOut;
        uint8 j = tokenIn < tokenOut ? tokenOut : tokenIn;
        bool sellingI = tokenIn == i; // true => price p = (L-x_i)/(L-x_j) decreases

        tokens[tokenIn].safeTransferFrom(msg.sender, address(this), amountIn);

        // Fee is withheld from what walks the curve and simply stays in the reserve as an
        // unattributed donation (docs/DESIGN.md section 7). Unlike the old reserve-derived
        // pricing, it no longer nudges the price: `pairPrice` only moves by traded amounts.
        uint256 remaining = amountIn - (amountIn * feePips) / 1_000_000;

        bytes32 pk = pairKey(i, j);
        uint256 p = pairPrice[pk];
        uint256 L = pairLiquidity[pk];

        for (uint256 step; step < MAX_SWAP_STEPS && remaining > 0; ++step) {
            if (L == 0) revert InsufficientLiquidity();

            (int24 nextTick, bool found) =
                sellingI ? _nextInitializedTickBelow(pk, p) : _nextInitializedTickAbove(pk, p);

            uint256 pTarget = found
                ? PriceMath.priceAtTick(nextTick)
                : PriceMath.priceAtTick(sellingI ? PriceMath.MIN_TICK : PriceMath.MAX_TICK);

            // Both directions are the same step with the roles of sin/cos swapped: `a` is the
            // component the input consumes (it always shrinks) and `b` the one the output comes
            // from (it always grows). Selling i walks the price down, so a = sin; selling j walks
            // it up, so a = cos. Working in deltas means the circle's centre offset cancels.
            (uint256 aCur, uint256 bCur, uint256 aTarget, uint256 bTarget) = sellingI
                ? (PriceMath.sinTheta(p), PriceMath.cosTheta(p), PriceMath.sinTheta(pTarget), PriceMath.cosTheta(pTarget))
                : (PriceMath.cosTheta(p), PriceMath.sinTheta(p), PriceMath.cosTheta(pTarget), PriceMath.sinTheta(pTarget));

            uint256 maxIn = aCur > aTarget ? M.mulWad(L, aCur - aTarget) : 0;

            if (remaining < maxIn || !found) {
                // Stops inside this step: solve for the exact resting point on the arc.
                if (!found && remaining >= maxIn) revert InsufficientLiquidity();
                uint256 newA = aCur - M.divWad(remaining, L);
                uint256 newB = M.sqrtWad(WAD - M.mulWad(newA, newA));
                amountOut += M.mulWad(L, newB - bCur);
                p = sellingI ? M.divWad(newA, newB) : M.divWad(newB, newA);
                remaining = 0;
            } else {
                // Reaches the tick: bank the step, cross, and continue with the new liquidity.
                amountOut += M.mulWad(L, bTarget - bCur);
                remaining -= maxIn;
                p = pTarget;
                int128 net = ticks[pk][nextTick].liquidityNet;
                L = sellingI ? uint256(int256(L) - net) : uint256(int256(L) + net);
            }
        }
        if (remaining > 0) revert InsufficientLiquidity();

        // `reserves` is custody, not curve state: the whole input (fee included) stays, and the
        // output leaves. An underflow here means other pairs have already claimed this token.
        reserves[tokenIn] += amountIn;
        reserves[tokenOut] -= amountOut;
        pairPrice[pk] = p;
        pairLiquidity[pk] = L;

        tokens[tokenOut].safeTransfer(recipient, amountOut);
        emit Swap(recipient, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ----------------------------------------------------------------------
    // Internal helpers
    // ----------------------------------------------------------------------

    function _checkPair(uint8 i, uint8 j) internal view {
        if (i >= j || j >= n) revert InvalidTokenIndex();
    }

    function _checkTicks(int24 tickLower, int24 tickUpper) internal view {
        if (
            tickLower >= tickUpper || tickLower < PriceMath.MIN_TICK || tickUpper > PriceMath.MAX_TICK
                || tickLower % int24(tickSpacing) != 0 || tickUpper % int24(tickSpacing) != 0
        ) revert InvalidTickRange();
    }

    /// @dev `isLowerTick` follows v3's convention: liquidityNet is added at the lower tick and
    /// subtracted at the upper tick when price crosses upward; `adding` flips sign for burns.
    function _updateTick(bytes32 pk, int24 tick, uint128 liquidityDelta, bool adding, bool isLowerTick) internal {
        TickInfo storage info = ticks[pk][tick];
        bool wasInitialized = info.liquidityGross != 0;

        int128 netDelta = isLowerTick ? int128(liquidityDelta) : -int128(liquidityDelta);
        if (adding) {
            info.liquidityGross += liquidityDelta;
            info.liquidityNet += netDelta;
        } else {
            info.liquidityGross -= liquidityDelta;
            info.liquidityNet -= netDelta;
        }

        if (!wasInitialized && info.liquidityGross != 0) {
            _insertTick(pk, tick);
        } else if (wasInitialized && info.liquidityGross == 0) {
            _removeTick(pk, tick);
        }
    }

    function _insertTick(bytes32 pk, int24 tick) internal {
        int24[] storage list = initializedTicks[pk];
        uint256 len = list.length;
        list.push(tick);
        uint256 idx = len;
        while (idx > 0 && list[idx - 1] > tick) {
            list[idx] = list[idx - 1];
            --idx;
        }
        list[idx] = tick;
    }

    function _removeTick(bytes32 pk, int24 tick) internal {
        int24[] storage list = initializedTicks[pk];
        uint256 len = list.length;
        for (uint256 idx; idx < len; ++idx) {
            if (list[idx] == tick) {
                for (uint256 k = idx; k < len - 1; ++k) {
                    list[k] = list[k + 1];
                }
                list.pop();
                break;
            }
        }
    }

    function _nextInitializedTickBelow(bytes32 pk, uint256 pCurrent) internal view returns (int24 tick, bool found) {
        int24[] storage list = initializedTicks[pk];
        for (uint256 idx = list.length; idx > 0; --idx) {
            int24 t = list[idx - 1];
            if (PriceMath.priceAtTick(t) < pCurrent) return (t, true);
        }
        return (0, false);
    }

    function _nextInitializedTickAbove(bytes32 pk, uint256 pCurrent) internal view returns (int24 tick, bool found) {
        int24[] storage list = initializedTicks[pk];
        uint256 len = list.length;
        for (uint256 idx; idx < len; ++idx) {
            int24 t = list[idx];
            if (PriceMath.priceAtTick(t) > pCurrent) return (t, true);
        }
        return (0, false);
    }
}
