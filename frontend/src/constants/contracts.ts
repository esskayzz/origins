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

// Default NDimPool address per chain id, read from Vite env vars. Falls back to
// whatever the user has saved in the pool config store (see store/usePoolConfigStore.ts)
// when unset, so no rebuild is required to point at a freshly-deployed pool.
import type { Address } from "viem";
import { localAnvil, sepoliaTestnet } from "./chains";

export const DEFAULT_POOL_ADDRESSES: Record<number, Address | undefined> = {
  [localAnvil.id]: (import.meta.env.VITE_POOL_ADDRESS_31337 as Address | undefined) || undefined,
  [sepoliaTestnet.id]: (import.meta.env.VITE_POOL_ADDRESS_11155111 as Address | undefined) || undefined,
};
