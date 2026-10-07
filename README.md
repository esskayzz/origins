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
- `script/DeployNDimPool.s.sol` — deploys 3 `TestERC20` tokens + an `NDimPool`
  wrapping them, seeded with equal reserves. Used for local/testnet setup and
  by the frontend (see `frontend/README.md`).
- `test/NDimPool.t.sol` — unit + fuzz tests covering the invariant, mint/burn
  round-trips, tick crossings, and cross-pair independence/no-arbitrage.
- `test/NDimPool.anvil.t.sol` — integration tests that fork a live local node
  (`anvil`) and deploy + exercise a fresh pool over a real RPC connection
  (mint/provide-liquidity and swap across multiple pairs), as opposed to the
  in-memory EVM the rest of the suite runs against. Skips itself if no node
  is reachable, so a plain `forge test` still passes without `anvil` running.

## Usage

Built with [Foundry](https://book.getfoundry.sh/).

```shell
forge build
forge test -vv
```

To also run the Anvil integration tests (`test/NDimPool.anvil.t.sol`), start a
local node first:

```shell
anvil                                                        # in one terminal
forge test --match-contract NDimPoolAnvilIntegrationTest -vv # in another
```

To deploy a pool to that node (e.g. for the frontend, see `frontend/README.md`):

```shell
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/DeployNDimPool.s.sol:DeployNDimPool \
  --rpc-url http://127.0.0.1:8545 --broadcast
```

(That private key is Anvil's well-known, publicly documented default test
account #0 — safe only because this chain is local and ephemeral. Use your
own funded key for a testnet.)
