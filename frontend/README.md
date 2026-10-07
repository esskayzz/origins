# NDimPool frontend

A minimal React + Vite + wagmi/viem interface for the [`NDimPool`](../src/NDimPool.sol)
contract: swap between any two of the pool's N tokens, and provide concentrated
liquidity across 3 or more tokens in one guided flow (one pairwise `mint()` per
token combination, since positions are always pairwise on-chain — see
[docs/DESIGN.md](../docs/DESIGN.md) section 3).

Built per the [Modern React Project Template](https://github.com/gakeez/agents_md_collection/blob/main/examples/react-project.md)
(React 18 + TypeScript + Vite, Zustand, React Router v6, Vitest + React Testing
Library, Prettier + Husky + lint-staged), adapted for a wallet-connected dapp
with no REST backend (see [Deviations from the template](#deviations-from-the-template)).

UI is themed with [Ant Design](https://ant.design) + [Ant Design Web3](https://web3.ant.design),
in the visual language of the Ant Design Pro kit (a reference copy of the
official Sketch kit lives in [`../design`](../design)): a centered login card
to connect a wallet, then a dark sider + light content dashboard shell with
`Swap`/`Provide liquidity` pages.

### Ant Design Web3 notes

- `ConnectWallet.tsx` renders a bare `@ant-design/web3` `ConnectButton`; all
  account/connect/disconnect/chain-switch wiring comes from
  `@ant-design/web3-wagmi`'s `WagmiWeb3ConfigProvider` (see `main.tsx`), which
  wraps our existing `wagmiConfig` and internally renders the same
  `WagmiProvider`/`QueryClientProvider` our other wagmi hooks rely on. An
  earlier version hand-wired `ConnectButton` directly to `useConnect`/
  `useDisconnect` to dodge a peer-dependency conflict (`@ant-design/web3-wagmi`
  declares `wagmi@^2.x`, we have `wagmi@3`) — that version silently swallowed
  connect failures and lost multi-wallet (EIP-6963) support, which is the
  adapter's job. `.npmrc` sets `legacy-peer-deps=true` so a plain `npm install`
  works locally and on Vercel; verified only one
  `wagmi`/`antd`/`react` instance ends up in the tree (`npm ls wagmi antd react`)
  so the shared context actually line up.
- `wagmiConfig.connectors` is intentionally empty — wagmi's
  `multiInjectedProviderDiscovery` (default on) plus the adapter's `eip6963`
  flag auto-discover real installed wallets with proper name/icon metadata.
  A bare `injected()` connector shows up as an unrecognized "Injected" wallet
  the adapter can't label, logging `Can not find wallet factory for Injected`.
- `main.tsx` passes a `chains` prop (`ChainAssetWithWagmiChain[]`) for our two
  custom chains — without it the adapter only knows about its built-in
  `Mainnet` and logs `Can not find chain 31337`/`11155111` for ours.
- `antd` is pinned to `^5.22.7` (not the newer v6) so it dedupes with
  `@ant-design/web3`'s own `antd@^5` dependency — otherwise two separate antd
  copies get bundled and `ConfigProvider` theming silently stops reaching the
  web3 components.
- antd v5 logs a benign `[antd: compatible] antd v5 support React is 16 ~ 18`
  console warning under React 19 (this scaffold's Vite template default); the
  components still render/function correctly.
- The dashboard shell (connected state: sider + menu + pages) couldn't be
  exercised headlessly in this environment (no real wallet extension to
  connect with) — verify it visually with MetaMask or another injected wallet.

## Switching between local and testnet

The app ships with two networks configured out of the box (see
`src/constants/chains.ts`): **Local (Anvil)**, chain id `31337`, and
**Sepolia**, chain id `11155111`. Switch between them two ways, no rebuild
required:

1. **In the app** — use the network dropdown in the header (wired to your
   wallet's `wallet_switchEthereumChain`) and the "Pool address" field below it
   to point at that network's deployed `NDimPool` address. Both your chosen
   network and pool address are remembered per-network in `localStorage`.
2. **Via environment variables** — copy `.env.example` to `.env.local` and set:
   - `NOWNODES_API_KEY` — your [NOWNodes](https://docs.nownodes.io/nodeapis/)
     key, read **server-side only** by the `/api/rpc` proxy (`server/rpcProxy.ts`,
     served by the Vite dev server locally and by `api/rpc.ts` on Vercel). With
     it set, Sepolia reads/simulations go to `https://eth-sepolia.nownodes.io`;
     without it the proxy falls back to a keyless public endpoint. The key is
     never compiled into the browser bundle.
   - `VITE_LOCAL_RPC_URL` / `VITE_TESTNET_RPC_URL` — RPC endpoint overrides used
     for read calls (your wallet still decides which network it actually signs
     transactions on). The testnet default is the `/api/rpc` proxy; set an
     absolute URL here only when hosting somewhere without it.
   - `VITE_POOL_ADDRESS_31337` / `VITE_POOL_ADDRESS_11155111` — default pool
     addresses, used as a fallback when nothing is saved in `localStorage` yet.

To point at a different testnet entirely (e.g. Base Sepolia, Arbitrum Sepolia),
add another `defineChain(...)` entry to `supportedChains` in
`src/constants/chains.ts` and a matching transport/env var in
`src/services/wagmiConfig.ts`.

## Running locally

```shell
npm install
npm run dev      # start the dev server
npm run test     # run the Vitest + React Testing Library suite
npm run lint     # oxlint
npm run format   # prettier --write .
npm run build    # type-check + production build
```

Against a local pool: run `anvil` in one terminal, deploy `NDimPool` with
Foundry (see the repo root [README](../README.md)), then either paste the
deployed address into the in-app "Pool address" field, or set
`VITE_POOL_ADDRESS_31337` in `.env.local` before starting the dev server.

`TestERC20` (used in the test suite) exposes a public, unrestricted `mint()` —
useful as a faucet when testing locally or on a testnet.

## Deploying to Vercel

The app is a static Vite build plus one serverless function, which is exactly
Vercel's model. Import the repo and set:

1. **Root Directory** → `frontend` (the app lives in a subfolder of the Foundry
   repo). Vercel then auto-detects Vite: `npm run build` → `dist/`.
2. **Environment variables**:
   - `NOWNODES_API_KEY` — server-side only, read by `api/rpc.ts`. Optional; the
     proxy falls back to a public Sepolia endpoint without it.
   - `VITE_POOL_ADDRESS_11155111` — the Sepolia `NDimPool` address.

`vercel.json` rewrites every non-`/api/*` path to `index.html` so deep links
like `/swap` and `/liquidity` survive a refresh (the app uses `BrowserRouter`).
The `/api/rpc` function only accepts `POST` and a read-only allowlist of
JSON-RPC methods (plus `eth_sendRawTransaction`), so it can't be repurposed as
a general node. Note the **Local (Anvil)** network in the chain switcher points
at the visitor's own machine, so on a deployed site only Sepolia is usable by
anyone else.

## Layout

Follows the template's `components/`, `pages/`, `hooks/`, `store/`, `services/`,
`utils/`, `types/`, `styles/`, `constants/` split:

- `src/constants/chains.ts` — the two supported chain definitions.
- `src/constants/contracts.ts` — hand-written ABIs for `NDimPool`/ERC20 plus
  the default pool address per chain id.
- `src/services/wagmiConfig.ts` — wagmi `createConfig` (chains, connectors,
  transports).
- `src/store/usePoolConfigStore.ts` — Zustand store for the user's per-chain
  pool address override, persisted to `localStorage`.
- `src/hooks/usePoolAddress.ts` — combines the connected chain id with the
  store/env default to resolve the active pool address.
- `src/hooks/usePoolTokens.ts` — reads `n`, each `tokens(i)`, and ERC20
  symbol/decimals.
- `src/hooks/useErc20.ts` — balance/allowance/approve for a token+spender.
- `src/types/pool.ts` — shared `PoolToken` type.
- `src/utils/tickMath.ts` — UI-only tick/price helpers for picking a mint range.
- `src/pages/SwapPage.tsx` (route `/swap`) — token select, quote preview via
  `simulateContract`, approve-if-needed, swap.
- `src/pages/LiquidityPage.tsx` (route `/liquidity`) — select 3+ tokens, then
  mint a concentrated-liquidity position for every pair among them via
  `src/components/common/LiquidityPairRow.tsx`, each with its own
  approve/mint flow and amount preview.
- `src/components/common/` — `ConnectWallet`, `NetworkSwitcher`,
  `PoolAddressSettings`, `LiquidityPairRow`.
- `tests/` — Vitest + React Testing Library specs.

## Deviations from the template

The template assumes a traditional REST-backed SPA; this is a wallet-connected
dapp with no backend API, so:

- **No `services/` Axios layer** — on-chain reads/writes go through wagmi
  hooks directly in components/pages; `services/wagmiConfig.ts` holds the one
  piece of infrastructure wiring that fits the "services" role here.
- **No Redux Toolkit / Ant Design / Material-UI / Tailwind / Styled-components**
  — kept to Zustand (one small store) and plain CSS, since the UI surface is
  intentionally small; swap in a component library if this grows.
- **oxlint instead of ESLint** — Vite's scaffold already wired up oxlint
  (faster, zero-config); Prettier + Husky + lint-staged were added on top as
  the template specifies, rather than replacing a working linter.
