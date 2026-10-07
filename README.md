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

### Deploying to Sepolia

Put a Sepolia RPC in the (gitignored) root `.env` as `SEPOLIA_RPC_URL`;
`foundry.toml` exposes it as the `sepolia` alias. With a NOWNodes key the URL is
`https://eth-sepolia.nownodes.io/<key>` (key as a path segment, since
`forge script` can't send headers). Then sign with a `cast wallet` keystore
instead of a raw key — leave `PRIVATE_KEY` unset and the script broadcasts as
`--sender`:

```shell
forge script script/DeployNDimPool.s.sol:DeployNDimPool \
  --rpc-url sepolia --account <keystore-name> --sender <its-address> --broadcast
```

Two Sepolia-specific flags matter. Post-Fusaka Sepolia charges ~1,542 gas per
byte of deployed code (vs. the 200 forge's local EVM assumes) and caps any one
transaction at 16,777,216 gas, so forge's simulated estimates are ~6x too low
and a default `--gas-estimate-multiplier` of 130% would push the pool deploy
over the cap. `--skip-simulation` makes forge take gas from the node's
`eth_estimateGas` instead, and `100` disables the multiplier. `foundry.toml`'s
`optimizer_runs = 1` / no metadata hash exist for the same reason: they shrink
`NDimPool` from 10,438 to 10,168 bytes, which is what fits under the cap.

The deployer needs a little Sepolia ETH (the whole deploy is ~26M gas, a few
ten-thousandths of an ETH at typical Sepolia prices). Afterwards set
`VITE_POOL_ADDRESS_11155111` to the printed `NDimPool` address in
`frontend/.env.local` (and in the Vercel project, if deployed).

Current Sepolia deployment (deployer `0x37e3C22A7e155e65f32B35c149a2aF23176d107e`):

| Contract | Address |
| --- | --- |
| `NDimPool` | `0xb55Dc1fa2ACfB4e1C0CBC46C77E941f76775B92b` |
| TKA (`TestERC20`) | `0x7BD498d5b870B66e2457218C54AD0e30d9A28007` |
| TKB (`TestERC20`) | `0xE9957C35D5A0B76a6544abeA81B584C96D4A3e73` |
| TKC (`TestERC20`) | `0x2FEBECf56748D7E7b0e39e6976918475af5488d8` |

`TestERC20.mint()` is public, so anyone can faucet themselves TKA/TKB/TKC (the
frontend's "Get 1000 …" links do exactly that).
