import { defineChain } from "viem";

// RPC URLs are read from Vite env vars so the same build can point at a local
// Anvil node or a public testnet without code changes. Defaults assume a
// default `anvil` instance on the standard Foundry port.

/** A `VITE_X=` line left blank in an env file arrives as "", which must count as unset. */
const env = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const LOCAL_RPC_URL = env(import.meta.env.VITE_LOCAL_RPC_URL) ?? "http://127.0.0.1:8545";

/** Keyless public Sepolia endpoint; what wallets are handed for `wallet_addEthereumChain`. */
export const PUBLIC_TESTNET_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** Same-origin JSON-RPC proxy (server/rpcProxy.ts): served by the Vite dev/preview server
 * locally and by the Vercel function api/rpc.ts in production. It holds the NOWNodes key
 * server-side, so nothing secret is compiled into this bundle. */
export const TESTNET_RPC_PROXY_PATH = "/api/rpc";

/** Testnet RPC used by the app's own reads/simulations. Override with `VITE_TESTNET_RPC_URL`
 * when hosting somewhere without the proxy (e.g. a plain static host). */
export const TESTNET_RPC_URL: string = env(import.meta.env.VITE_TESTNET_RPC_URL) ?? TESTNET_RPC_PROXY_PATH;

export const localAnvil = defineChain({
  id: 31337,
  name: "Local (Anvil)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [LOCAL_RPC_URL] } },
  testnet: true,
});

export const sepoliaTestnet = defineChain({
  id: 11155111,
  name: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  // Wallet-facing (used if a wallet has to add this chain): must be an absolute, keyless URL.
  // The app's own transport (wagmiConfig.ts) is what uses TESTNET_RPC_URL.
  rpcUrls: { default: { http: [PUBLIC_TESTNET_RPC_URL] } },
  blockExplorers: { default: { name: "Etherscan", url: "https://sepolia.etherscan.io" } },
  testnet: true,
});

export const supportedChains = [localAnvil, sepoliaTestnet] as const;
export type SupportedChainId = (typeof supportedChains)[number]["id"];
