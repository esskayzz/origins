import { createConfig, http } from "wagmi";
import { metaMask } from "wagmi/connectors";
import type { ChainAssetWithWagmiChain } from "@ant-design/web3-wagmi";
import {
  LOCAL_RPC_URL,
  TESTNET_RPC_URL,
  localAnvil,
  sepoliaTestnet,
  supportedChains,
} from "../constants/chains";

/** Sepolia transport. Defaults to the same-origin `/api/rpc` proxy (see server/rpcProxy.ts),
 * which the browser resolves against the page origin; any provider key stays server-side. */
export const testnetTransport = () => http(TESTNET_RPC_URL);

// The Ant Design Web3 adapter's `MetaMask()` wallet factory (see main.tsx) looks up a wagmi
// connector literally named "MetaMask" in `config.connectors` -- it does NOT create one on its
// own -- so it must be registered here directly rather than relying solely on wagmi's
// `multiInjectedProviderDiscovery`/EIP-6963 auto-discovery (which is async and wasn't reliably
// populating `config.connectors` before the user clicked Connect).
export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors: [metaMask()],
  transports: {
    [localAnvil.id]: http(LOCAL_RPC_URL),
    [sepoliaTestnet.id]: testnetTransport(),
  },
});

// Display metadata for our custom chains, passed to `WagmiWeb3ConfigProvider` (see main.tsx) --
// without an entry per chain here the adapter logs "Can not find chain <id>" and can't render
// the chain switcher for it.
export const chainAssets: ChainAssetWithWagmiChain[] = [
  { id: localAnvil.id, name: localAnvil.name, wagmiChain: localAnvil },
  { id: sepoliaTestnet.id, name: sepoliaTestnet.name, wagmiChain: sepoliaTestnet },
];

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
