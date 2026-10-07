# Hypersphere — N-dimensional concentrated liquidity AMM

A Uniswap v4-inspired reference implementation that extends concentrated
liquidity pools from 2 tokens to **N tokens** in a single pool contract.
Every pair of tokens `(i, j)` trades along a circle `x_i² + x_j² = L_ij²` —
the sum-of-squares analogue of v3/v4's `x·y = L²` hyperbola — using the same
`1.0001^tick` price convention and single-range concentrated-liquidity
mechanics LPs already know from v3/v4.

See [docs/DESIGN.md](docs/DESIGN.md) for the full math writeup (invariant,
tick system, mint/burn formulas, swap algorithm, and explicit scope/
limitations versus v4).

## Layout

- `src/NDimPool.sol` — the pool contract (N ERC20 reserves, per-pair active
  liquidity, ticks, positions, `initialize`/`mint`/`burn`/`swap`).
- `src/libraries/PriceMath.sol` — tick↔price conversion and circle
  (`cos`/`sin`) helpers.
- `src/test/TestERC20.sol` — minimal ERC20 used by the tests.
- `test/NDimPool.t.sol` — unit + fuzz tests covering the invariant, mint/burn
  round-trips, tick crossings, and cross-pair independence/no-arbitrage.

## Usage

Built with [Foundry](https://book.getfoundry.sh/).

```shell
forge build
forge test -vv
```
