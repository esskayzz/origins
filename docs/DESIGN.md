# N-Sphere AMM: Extending Uniswap v4 Concentrated Liquidity to N Dimensions

## 1. Motivation

Uniswap v3/v4 pools hold exactly two tokens and define a single price axis. A
position is just two ticks `[tickLower, tickUpper]` bounding a 1-D price range,
and liquidity `L` is the radius parameter of the invariant hyperbola
`x·y = L²`.

This design generalizes that model to a single pool holding **N tokens**
(`x_1 ... x_N`), while:

- keeping the *same tick-range mental model* LPs already understand (a
  position still has exactly one `[tickLower, tickUpper]`, not one per
  token-pair),
- replacing the hyperbola with a **circle** per pair (`x_i² + x_j² = L_ij²`),
  as requested — the sum-of-squares analogue of v3's product invariant, and
- reusing v3/v4's exact tick→price convention (`price(tick) = 1.0001^tick`)
  so existing tick math/intuition carries over,
- sharing **custody of all N token balances in one contract**, so a trade
  routed through several hops (e.g. `i → j → k`) nets out the intermediate
  token atomically instead of needing N(N-1)/2 separately deployed pools.

## 2. The invariant, and why it is per-pair (not one global sphere)

A first instinct is to enforce one global hypersphere `x_1² + ... + x_N² = L²`
with a *single* scalar `L` shared by the whole pool, and derive each pair's
trading circle by holding every other reserve fixed:
`x_i² + x_j² = L² − Σ_{k≠i,j} x_k²`. That identity is real, but it only holds
if `L` is the *literal* current radius of the whole reserve vector — which is
only true for **full-range** liquidity. The moment a position is concentrated
to a sub-range `[tickLower, tickUpper]`, v3's own offset construction (§5)
means the position's *real* reserves are offset from the raw `l·cos θ`,
`l·sin θ` point by range-dependent constants. Summed across many overlapping,
differently-ranged positions, the aggregate real reserves **do not** satisfy
`x_i² + x_j² = (Σ l)²` — only the *deltas* between two prices within a
constant-liquidity interval do (the offset constants cancel in a delta, see
§5). This is also true of v3 itself: v3 never asserts `x·y = L²` using its
*real*, aggregate reserves; `L` is only ever used to compute incremental swap
deltas at the current price.

Consequence: a single shared `L` across unrelated pairs is **not**
mathematically consistent once liquidity is concentrated — trying it produces
exactly the kind of invariant violation (negative radii, out-of-domain
`cos`/`sin`) this implementation originally crashed on. So each pair `(i, j)`
instead tracks **its own** active liquidity:

```
L_ij  =  Σ liquidity of currently in-range positions minted on pair (i, j)
```

`L_ij` is the direct analogue of v3's per-pool `liquidity`, and it changes the
same two ways v3's does: immediately on mint/burn (if the position is
in-range), and at tick crossings during a swap (by the crossed tick's
`liquidityNet`).

## 3. What's actually shared across pairs

Since `L_ij` is pair-local, concentrated liquidity minted against pair
`(i, j)` does **not** deepen an unrelated pair `(k, m)`. What N tokens living
in one contract *does* give you, honestly:

- **Shared custody / no idle inventory split across deployments.** A balance
  of token `i` sitting in this contract backs *every* pair `i` participates
  in; an LP (or router) doesn't need to pre-allocate separate capital to an
  `(i,j)` pool and a disjoint `(i,k)` pool the way two independent v3 pools
  would require.
- **Atomic multi-hop netting.** Swapping `i → j → k` in one call only ever
  moves the net amount of `j` through the contract's internal accounting —
  there's no intermediate ERC20 transfer of `j` the way routing through two
  separate v3 pools would require.
- **A shared tick/price convention and a single circle-based curve family**
  across every pair, so tooling, price math, and LP intuition are identical
  regardless of which pair is traded.

What is **not** shared is capital efficiency of concentrated ranges — minting
on `(i,j)` leaves `(k,m)`'s depth exactly as it was
([`test_PairsAreIndependent`](../test/NDimPool.t.sol)). Reserves of a token
that participates in multiple pairs *are* physically shared, though, so
minting/swapping on `(i,j)` does shift `(i,k)`'s current *price* whenever it
moves `x_i` (verified not to happen for untouched reserves in the same test).

## 4. Parametrizing a pair's circle with price (and reusing v3 ticks)

On pair `(i,j)`'s circle `x_i² + x_j² = L_ij²`, define its price exactly as v3
defines token0/token1's:

```
p = x_j / x_i                 (price of token i, denominated in token j)
tick → p(tick) = 1.0001^tick  (identical convention to v3/v4)
```

Given `p`, the unshifted circle point is recovered without any trigonometry:

```
cos θ(p) = 1 / sqrt(1 + p²)
sin θ(p) = p / sqrt(1 + p²)
x_i = L_ij · cos θ(p),   x_j = L_ij · sin θ(p)   (on an unshifted circle)
```

Ticks keep their familiar meaning (1 tick ≈ 1 bps price movement), and
`price(tick) = 1.0001^tick` is computed via `solady`'s `lnWad`/`expWad`
(`PriceMath.priceAtTick`). To keep `cos`/`sin`'s `sqrt(1+p²)` normalization
from overflowing `uint256` fixed-point math at extreme prices, this reference
implementation bounds ticks to `±400,000` (price ratios up to `~e^40`,
comfortably covering any realistic range) rather than v3's `±887,272`.

## 5. Concentrated liquidity on a circle (mint/burn amounts)

v3 offsets its virtual reserves so that real reserve `x` hits exactly `0` at
the *upper* tick and real reserve `y` hits exactly `0` at the *lower* tick. We
do the same on the circle. Let `p_a < p_b` be a range's lower/upper prices.
The position's token amounts for current price `p` and liquidity `l` are:

```
if p ≤ p_a (price below range, position is 100% token i):
    amount_i = l · (cos θ_a − cos θ_b)
    amount_j = 0

if p_a < p < p_b (price inside range):
    amount_i = l · (cos θ   − cos θ_b)
    amount_j = l · (sin θ   − sin θ_a)

if p ≥ p_b (price above range, position is 100% token j):
    amount_i = 0
    amount_j = l · (sin θ_b − sin θ_a)
```

These are the exact circle analogues of v3's
`amount0 = L·(1/√p − 1/√p_b)`, `amount1 = L·(√p − √p_a)` formulas, and they
satisfy the same boundary conditions (amount_i → 0 at the upper tick,
amount_j → 0 at the lower tick). As with v3, note that **deltas** between two
prices within a constant-`L_ij` interval collapse to
`Δamount_i = l·(cos θ_2 − cos θ_1)` — the offset terms cancel — which is
exactly what the swap step (§6) uses, and why it never needs to recompute an
absolute `(x_i, x_j)` position from `L_ij` alone.

## 6. Swap algorithm

Swapping an exact input of token `i` for token `j` walks ticks on pair
`(i, j)` exactly like `UniswapV3Pool.swap`, operating on **deltas** against
the pair's current actual reserves rather than resetting them to an absolute
circle point (see §5):

1. Read the pair's current price `p = x_j / x_i` from actual reserves, and
   its current active liquidity `L_ij`.
2. Find the next initialized tick on pair `(i, j)` in the swap direction
   (linear scan of a sorted per-pair tick array in this implementation).
3. Compute the input needed to reach that tick: `Δin = L_ij·|cos θ_target −
   cos θ_current|` (or the `sin` form for the opposite direction). If the
   remaining input is smaller, solve for the exact stopping `cos`/`sin`
   within the step instead (no tick crossing).
4. Apply the corresponding output delta to the *actual* reserves
   (`x_i += Δin`, `x_j −= Δout`, or vice versa) — a running update, not an
   absolute reset.
5. If the tick boundary is reached, cross it: adjust `L_ij` by the tick's
   `liquidityNet` (added when crossing upward, subtracted when crossing
   downward) and continue stepping with the new `L_ij`.
6. Repeat until the input is exhausted or `MAX_SWAP_STEPS` is hit.
7. A pips fee is deducted from the input up front and left in the pool as an
   unattributed reserve donation (§7) before stepping begins.

## 7. What's intentionally out of scope for this reference implementation

To keep the reference implementation focused on validating the N-dimensional
math, the following are **not** reproduced here:

- Singleton `PoolManager` + flash accounting / `unlock` callback pattern,
  hooks, ERC-6909 claim tokens, native ETH handling, `donate()`.
- Tick bitmap word-packing (`Tick`/`TickBitmap`'s compressed search) — this
  implementation uses a sorted per-pair `int24[]` array maintained by
  insertion/removal, which is correct but `O(n)` rather than gas-optimal.
- LP fee accounting/collection: the swap fee is taken from the input and left
  as extra reserve balance, but no `feeGrowthGlobal`/`feeGrowthInside`
  tracking or `collect()` exists, so it is not currently claimable by LPs.
- Protocol fees, oracle/observations, multi-pool factory/registry.

These are standard engineering additions on top of a correct invariant and
are not where the novelty of the N-dimensional generalization lives.

## 8. Contracts

- `src/libraries/PriceMath.sol` — `1.0001^tick` price conversion and
  circle-component helpers (`cosTheta`, `sinTheta`), built on
  `solady.FixedPointMathLib`.
- `src/NDimPool.sol` — the pool: N ERC20 reserves, per-pair `pairLiquidity`,
  per-pair sorted tick arrays + tick info, position storage, and
  `initialize`/`mint`/`burn`/`swap`.
- `src/test/TestERC20.sol` — minimal 18-decimal ERC20 used by the tests.
- `test/NDimPool.t.sol` — invariant, mint/burn round-trip, tick-crossing, and
  cross-pair independence tests.
