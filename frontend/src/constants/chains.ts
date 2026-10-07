import { defineChain } from "viem";

// RPC URLs are read from Vite env vars so the same build can point at a local
// Anvil node or a public testnet without code changes. Defaults assume a
// default `anvil` instance on the standard Foundry port.
export const LOCAL_RPC_URL = import.meta.env.VITE_LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
export const TESTNET_RPC_URL =
  import.meta.env.VITE_TESTNET_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

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
  rpcUrls: { default: { http: [TESTNET_RPC_URL] } },
  blockExplorers: { default: { name: "Etherscan", url: "https://sepolia.etherscan.io" } },
  testnet: true,
});

export const supportedChains = [localAnvil, sepoliaTestnet] as const;
export type SupportedChainId = (typeof supportedChains)[number]["id"];
