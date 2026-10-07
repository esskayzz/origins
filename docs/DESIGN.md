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
- replacing the hyperbola with a **circle** per pair
  (`(L_ij − x_i)² + (L_ij − x_j)² = L_ij²`), as requested — the sum-of-squares
  analogue of v3's product invariant, centred so that the curve is convex where
  trading happens (§2a), and
- reusing v3/v4's exact tick→price convention (`price(tick) = 1.0001^tick`)
  so existing tick math/intuition carries over,
- sharing **custody of all N token balances in one contract**, so a trade
  routed through several hops (e.g. `i → j → k`) nets out the intermediate
  token atomically instead of needing N(N-1)/2 separately deployed pools.

## 2. The invariant: a circle centred at `(L, L)`, per pair

### 2a. Why the circle must be centred, not origin-centred

The obvious reading of "sum of squares" is the origin-centred circle
`x_i² + x_j² = L²`. **That curve cannot be used as an AMM**, and an earlier
revision of this implementation shipped it. Differentiating gives the marginal
price `−dx_j/dx_i = x_i / x_j`, which *rises* as token i is sold. Each extra
unit of input buys more output than the last, so price impact runs in the
trader's favour, LPs are strictly worse off than holding, and the first
arbitrageur drains the pair. Measured on a 1000/1000 pool, selling 10 token i
returned 13.9 token j and selling 200 returned 390 — both above fair value.
The underlying defect is that an AMM's feasible region must be **convex**;
`x_i² + x_j² ≥ L²` is the outside of a disk, which is not.

The fix is to move the centre so the arc reserves travel along bulges *toward*
the origin:

```
(L_ij − x_i)² + (L_ij − x_j)² = L_ij²        0 ≤ x_i, x_j ≤ L_ij
```

Writing `u_i = L − x_i` for each reserve's distance from the centre, the pair
still lives on a circle `u_i² + u_j² = L²`, but now the feasible region is a
*ball* (convex), and the marginal price is

```
p  =  −dx_j/dx_i  =  u_i / u_j
```

which **falls** as token i is sold, exactly as it must. The resulting curve is
flat near the balanced point and steep at the edges — a stableswap shape, well
suited to correlated assets and a poor fit for volatile pairs. Unlike v2's
hyperbola it has finite depth: the arc from the balanced point to price zero
absorbs at most `L·sin θ` of token i (~2414 units on a 1000/1000 seed), and a
swap beyond that reverts with `InsufficientLiquidity` rather than emptying the
reserve at a favourable rate. This is the same family of surface as Paradigm's
Orbital, which centres its N-sphere at `(r, ..., r)` for the same reason.

Seeding solves the invariant for its radius, taking the root with
`L ≥ max(x_i, x_j)` so the reserves land on the near arc:

```
L_ij = x_i + x_j + sqrt(2 · x_i · x_j)        (= x·(2 + sqrt 2) when x_i = x_j = x)
```

### 2b. Why it is per-pair, not one global sphere

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

On pair `(i,j)`'s centred circle, price is the ratio of the two reserves'
*distances from the centre* — which is also, unlike the origin-centred version,
the true marginal rate:

```
p = u_i / u_j = (L − x_i)/(L − x_j)   (price of token i, denominated in token j)
tick → p(tick) = 1.0001^tick          (identical convention to v3/v4)
```

Given `p`, the circle point is recovered without any trigonometry:

```
cos θ(p) = 1 / sqrt(1 + p²)
sin θ(p) = p / sqrt(1 + p²)
x_i = L_ij · (1 − sin θ(p)),   x_j = L_ij · (1 − cos θ(p))
```

Note `sin` now carries token i and `cos` token j, the opposite of the
origin-centred parametrization. As `p` rises, `x_i` falls and `x_j` rises, so
the familiar directional convention survives: price below a range leaves the
position entirely in token i, above it entirely in token j.

**Price is stored, not derived.** `pairPrice[pairKey(i,j)]` is pool state,
updated only by swaps — the analogue of v3's `sqrtPriceX96`. Deriving it from
`reserves[j]/reserves[i]` is wrong once liquidity is concentrated, because each
position's real reserves are offset from the bare circle point by
range-dependent constants (§5); it also let an in-range `mint` move the quoted
price without any trade. `reserves` is therefore pure custody: the balance of
each token, shared by every pair that token participates in. One consequence
worth naming: because pairs price independently while sharing custody, the
claims of pair `(i,j)` and pair `(i,k)` on token `i` can in principle exceed the
balance, in which case the later payout reverts on the transfer rather than
over-paying. Splitting seed capital per pair would remove this; it is left out
of this reference implementation.

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
    amount_i = l · (sin θ_b − sin θ_a)
    amount_j = 0

if p_a < p < p_b (price inside range):
    amount_i = l · (sin θ_b − sin θ)
    amount_j = l · (cos θ_a − cos θ)

if p ≥ p_b (price above range, position is 100% token j):
    amount_i = 0
    amount_j = l · (cos θ_a − cos θ_b)
```

These are the exact circle analogues of v3's
`amount0 = L·(1/√p − 1/√p_b)`, `amount1 = L·(√p − √p_a)` formulas, and they
satisfy the same boundary conditions (amount_i → 0 at the upper tick,
amount_j → 0 at the lower tick). As with v3, note that **deltas** between two
prices within a constant-`L_ij` interval collapse to
`Δamount_i = l·(sin θ_2 − sin θ_1)` — both the range offsets *and* the circle's
centre offset cancel — which is exactly what the swap step (§6) uses, and why it
never needs to recompute an absolute `(x_i, x_j)` position from `L_ij` alone.

## 6. Swap algorithm

Swapping an exact input of token `i` for token `j` walks ticks on pair
`(i, j)` exactly like `UniswapV3Pool.swap`, operating on **deltas** along the
arc rather than resetting reserves to an absolute circle point (see §5).

Both directions are the *same* step with the roles of `sin` and `cos`
exchanged. Call `a` the component the input consumes and `b` the one the output
comes from; `a` always shrinks and `b` always grows. Selling token i walks the
price **down**, so `a = sin`, `b = cos`; selling token j walks it **up**, so
`a = cos`, `b = sin`. Then:

1. Read the pair's stored price `p` (`pairPrice`) and active liquidity `L_ij`.
2. Find the next initialized tick on pair `(i, j)` in the swap direction
   (linear scan of a sorted per-pair tick array in this implementation).
3. Compute the input needed to reach that tick:
   `Δin = L_ij·(a_current − a_target)`. If the remaining input is smaller,
   solve for the exact resting point within the step instead (no tick
   crossing): `a_new = a_current − remaining/L_ij`, then
   `b_new = sqrt(1 − a_new²)`.
4. Output for the step is `Δout = L_ij·(b_new − b_current)`, and the new price
   is recovered as `tan θ` from the `(sin, cos)` pair.
5. If the tick boundary is reached, cross it: adjust `L_ij` by the tick's
   `liquidityNet` (added when crossing upward, subtracted when crossing
   downward) and continue stepping with the new `L_ij`.
6. Repeat until the input is exhausted or `MAX_SWAP_STEPS` is hit. If input
   remains after the last step, the pair's finite depth is exhausted and the
   swap reverts with `InsufficientLiquidity` (§2a).
7. Finally write back `pairPrice` and `pairLiquidity`, credit the whole input
   to `reserves[tokenIn]` and debit the output from `reserves[tokenOut]`.

A pips fee is withheld from the input before stepping and left in the pool as an
unattributed reserve donation (§7). Because price is stored rather than derived,
the fee does **not** nudge the price — only traded amounts move it.

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
