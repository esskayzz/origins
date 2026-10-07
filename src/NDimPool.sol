// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedPointMathLib as M} from "solady/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @title NDimPool
/// @notice Reference implementation of an N-token concentrated liquidity pool.
/// Every pair of tokens (i, j) trades along a circular slice `x_i^2 + x_j^2 = L_ij^2`
/// (the sum-of-squares analogue of v3/v4's `x*y = L^2` hyperbola), reusing v3/v4's
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

    uint256[] public reserves;
    /// @dev Per-pair active liquidity `L_ij` -- the sum-of-squares analogue of v3's
    /// per-pool `liquidity`, keyed by `pairKey(i, j)`.
    mapping(bytes32 => uint256) public pairLiquidity;

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
    /// establishes base full-range liquidity `L_ij = sqrt(x_i^2 + x_j^2)`, so every pair is
    /// immediately tradeable. Must be called once, after approving this contract to pull
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
                uint256 sumSquares = M.mulWad(reserves[i], reserves[i]) + M.mulWad(reserves[j], reserves[j]);
                pairLiquidity[pairKey(i, j)] = M.sqrtWad(sumSquares);
            }
        }
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    function getReserves() external view returns (uint256[] memory) {
        return reserves;
    }

    /// @notice Current price of token `i` denominated in token `j` (`x_j / x_i`, WAD).
    function priceOf(uint8 i, uint8 j) external view returns (uint256) {
        return M.divWad(reserves[j], reserves[i]);
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
        uint256 pCurrent = M.divWad(reserves[j], reserves[i]);
        uint256 pA = PriceMath.priceAtTick(tickLower);
        uint256 pB = PriceMath.priceAtTick(tickUpper);

        uint256 cosA = PriceMath.cosTheta(pA);
        uint256 sinA = PriceMath.sinTheta(pA);
        uint256 cosB = PriceMath.cosTheta(pB);
        uint256 sinB = PriceMath.sinTheta(pB);

        if (pCurrent <= pA) {
            amountI = M.mulWad(liquidityDelta, cosA - cosB);
            amountJ = 0;
        } else if (pCurrent >= pB) {
            amountI = 0;
            amountJ = M.mulWad(liquidityDelta, sinB - sinA);
            inRange = false;
        } else {
            uint256 cosCur = PriceMath.cosTheta(pCurrent);
            uint256 sinCur = PriceMath.sinTheta(pCurrent);
            amountI = M.mulWad(liquidityDelta, cosCur - cosB);
            amountJ = M.mulWad(liquidityDelta, sinCur - sinA);
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
        bool sellingI = tokenIn == i; // true => price (x_j/x_i) decreases

        tokens[tokenIn].safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 fee = (amountIn * feePips) / 1_000_000;
        reserves[tokenIn] += fee; // unattributed fee donation, see docs/DESIGN.md section 7
        uint256 remaining = amountIn - fee;

        bytes32 pk = pairKey(i, j);
        uint256 xi = reserves[i];
        uint256 xj = reserves[j];
        uint256 L = pairLiquidity[pk];

        for (uint256 step; step < MAX_SWAP_STEPS && remaining > 0; ++step) {
            if (L == 0) revert InsufficientLiquidity();

            uint256 pCurrent = M.divWad(xj, xi);
            uint256 cosCur = PriceMath.cosTheta(pCurrent);
            uint256 sinCur = PriceMath.sinTheta(pCurrent);

            (int24 nextTick, bool found) = sellingI
                ? _nextInitializedTickBelow(pk, pCurrent)
                : _nextInitializedTickAbove(pk, pCurrent);

            uint256 pTarget = found ? PriceMath.priceAtTick(nextTick) : PriceMath.priceAtTick(sellingI ? PriceMath.MIN_TICK : PriceMath.MAX_TICK);
            uint256 cosTarget = PriceMath.cosTheta(pTarget);
            uint256 sinTarget = PriceMath.sinTheta(pTarget);

            if (sellingI) {
                uint256 maxIn = cosTarget > cosCur ? M.mulWad(L, cosTarget - cosCur) : 0;
                if (remaining < maxIn || !found) {
                    if (!found && remaining >= maxIn) revert InsufficientLiquidity();
                    uint256 newCos = cosCur + M.divWad(remaining, L);
                    uint256 newSin = M.sqrtWad(WAD - M.mulWad(newCos, newCos));
                    uint256 out = M.mulWad(L, sinCur - newSin);
                    amountOut += out;
                    xi += remaining;
                    xj -= out;
                    remaining = 0;
                } else {
                    uint256 out = M.mulWad(L, sinCur - sinTarget);
                    amountOut += out;
                    xi += maxIn;
                    xj -= out;
                    remaining -= maxIn;
                    L = uint256(int256(L) - ticks[pk][nextTick].liquidityNet);
                }
            } else {
                uint256 maxIn = sinTarget > sinCur ? M.mulWad(L, sinTarget - sinCur) : 0;
                if (remaining < maxIn || !found) {
                    if (!found && remaining >= maxIn) revert InsufficientLiquidity();
                    uint256 newSin = sinCur + M.divWad(remaining, L);
                    uint256 newCos = M.sqrtWad(WAD - M.mulWad(newSin, newSin));
                    uint256 out = M.mulWad(L, cosCur - newCos);
                    amountOut += out;
                    xj += remaining;
                    xi -= out;
                    remaining = 0;
                } else {
                    uint256 out = M.mulWad(L, cosCur - cosTarget);
                    amountOut += out;
                    xj += maxIn;
                    xi -= out;
                    remaining -= maxIn;
                    L = uint256(int256(L) + ticks[pk][nextTick].liquidityNet);
                }
            }
        }
        if (remaining > 0) revert InsufficientLiquidity();

        reserves[i] = xi;
        reserves[j] = xj;
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
