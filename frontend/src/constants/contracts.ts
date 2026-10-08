// Minimal hand-written ABIs covering only what the frontend calls.
// Source of truth: src/NDimPool.sol (see ../../../src/NDimPool.sol).
export const NDIM_POOL_ABI = [
  { type: "function", name: "n", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "tokens",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tickSpacing",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint24" }],
  },
  { type: "function", name: "feePips", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "initialized", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "reserves",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "priceOf",
    stateMutability: "view",
    inputs: [
      { type: "uint8", name: "i" },
      { type: "uint8", name: "j" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pairKey",
    stateMutability: "pure",
    inputs: [
      { type: "uint8", name: "i" },
      { type: "uint8", name: "j" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "pairLiquidity",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "positionKey",
    stateMutability: "pure",
    inputs: [
      { type: "address", name: "owner" },
      { type: "uint8", name: "i" },
      { type: "uint8", name: "j" },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256[]", name: "initialReserves" }],
    outputs: [],
  },
  {
    type: "function",
    name: "previewMint",
    stateMutability: "view",
    inputs: [
      { type: "uint8", name: "i" },
      { type: "uint8", name: "j" },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
      { type: "uint128", name: "liquidityDelta" },
    ],
    outputs: [
      { type: "uint256", name: "amountI" },
      { type: "uint256", name: "amountJ" },
      { type: "bool", name: "inRange" },
    ],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "recipient" },
      { type: "uint8", name: "i" },
      { type: "uint8", name: "j" },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
      { type: "uint128", name: "liquidityDelta" },
    ],
    outputs: [
      { type: "uint256", name: "amountI" },
      { type: "uint256", name: "amountJ" },
    ],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint8", name: "i" },
      { type: "uint8", name: "j" },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
      { type: "uint128", name: "liquidityDelta" },
    ],
    outputs: [
      { type: "uint256", name: "amountI" },
      { type: "uint256", name: "amountJ" },
    ],
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "recipient" },
      { type: "uint8", name: "tokenIn" },
      { type: "uint8", name: "tokenOut" },
      { type: "uint256", name: "amountIn" },
    ],
    outputs: [{ type: "uint256", name: "amountOut" }],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { type: "address", name: "recipient", indexed: true },
      { type: "uint8", name: "tokenIn" },
      { type: "uint8", name: "tokenOut" },
      { type: "uint256", name: "amountIn" },
      { type: "uint256", name: "amountOut" },
    ],
  },
  // Custom errors, so viem can decode a revert into its name instead of showing a bare
  // 4-byte selector ("reverted with the following signature: 0x7939f424"). The first group
  // is NDimPool's own; the rest come from Solady's SafeTransferLib, which the pool uses to
  // move tokens -- TransferFromFailed is what an insufficient balance/allowance surfaces as.
  { type: "error", name: "InvalidTokenIndex", inputs: [] },
  { type: "error", name: "InvalidTickRange", inputs: [] },
  { type: "error", name: "InsufficientLiquidity", inputs: [] },
  { type: "error", name: "ZeroLiquidity", inputs: [] },
  { type: "error", name: "ZeroReserve", inputs: [] },
  { type: "error", name: "AlreadyInitialized", inputs: [] },
  { type: "error", name: "NotInitialized", inputs: [] },
  { type: "error", name: "TransferFromFailed", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "ApproveFailed", inputs: [] },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "to" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [],
  },
] as const;

import type { Address } from "viem";
import { localAnvil, sepoliaTestnet } from "./chains";

/// The live Sepolia deployment (see the root README). Committed rather than left to
/// `VITE_POOL_ADDRESS_11155111` so a fresh clone and the Vercel build both reach a working pool
/// with no env setup. Local Anvil has no committed default: its address depends on the deployer's
/// nonce on that machine, so it comes from the env var or the in-app field.
export const SEPOLIA_POOL_ADDRESS: Address = "0xD83e212B89b622400aa1a0e360E5cBd2d4920711";

/// Deployments that must not be traded against any more. The pre-fix Sepolia pool ran the
/// origin-centred invariant, whose quotes improved with trade size and let the first arbitrageur
/// drain it (docs/DESIGN.md section 2a). A saved override pointing at one of these is discarded
/// on load -- see store/usePoolConfigStore.ts.
export const SUPERSEDED_POOL_ADDRESSES: readonly Address[] = ["0xb55Dc1fa2ACfB4e1C0CBC46C77E941f76775B92b"];

export function isSupersededPool(address: Address | undefined): boolean {
  if (!address) return false;
  return SUPERSEDED_POOL_ADDRESSES.some((a) => a.toLowerCase() === address.toLowerCase());
}

// Default NDimPool address per chain id: the `VITE_POOL_ADDRESS_*` env var if set, otherwise the
// committed deployment above. A user override saved in the pool config store
// (store/usePoolConfigStore.ts) takes precedence over both, so pointing the app at a
// freshly-deployed pool never needs a rebuild.
export const DEFAULT_POOL_ADDRESSES: Record<number, Address | undefined> = {
  [localAnvil.id]: (import.meta.env.VITE_POOL_ADDRESS_31337 as Address | undefined) || undefined,
  [sepoliaTestnet.id]:
    (import.meta.env.VITE_POOL_ADDRESS_11155111 as Address | undefined) || SEPOLIA_POOL_ADDRESS,
};
