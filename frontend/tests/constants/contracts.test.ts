import { afterEach, describe, expect, test, vi } from "vitest";
import { decodeErrorResult } from "viem";

// contracts.ts reads its env at module-evaluation time, so each case re-imports it fresh.
async function loadContracts() {
  vi.resetModules();
  return import("../../src/constants/contracts");
}

describe("DEFAULT_POOL_ADDRESSES", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Regression test for: the Sepolia address lived only in the gitignored .env.local, so a fresh
  // clone (and the Vercel build, unless the env var was set by hand) came up with no pool
  // configured at all.
  test("falls back to the committed Sepolia deployment with no env var set", async () => {
    vi.stubEnv("VITE_POOL_ADDRESS_11155111", "");
    const c = await loadContracts();
    expect(c.DEFAULT_POOL_ADDRESSES[11155111]).toBe(c.SEPOLIA_POOL_ADDRESS);
  });

  test("an env var overrides the committed Sepolia default", async () => {
    const other = "0x3333333333333333333333333333333333333333";
    vi.stubEnv("VITE_POOL_ADDRESS_11155111", other);
    const c = await loadContracts();
    expect(c.DEFAULT_POOL_ADDRESSES[11155111]).toBe(other);
  });

  test("local Anvil has no committed default, since its address is machine-specific", async () => {
    vi.stubEnv("VITE_POOL_ADDRESS_31337", "");
    const c = await loadContracts();
    expect(c.DEFAULT_POOL_ADDRESSES[31337]).toBeUndefined();
  });

  test("the committed Sepolia pool is not itself in the superseded list", async () => {
    const c = await loadContracts();
    expect(c.isSupersededPool(c.SEPOLIA_POOL_ADDRESS)).toBe(false);
    expect(c.isSupersededPool(c.SUPERSEDED_POOL_ADDRESSES[0])).toBe(true);
    expect(c.isSupersededPool(undefined)).toBe(false);
  });
});

// Regression test for: `mint` reverting showed "reverted with the following signature:
// 0x7939f424" because the ABI declared no errors. That selector is Solady's TransferFromFailed
// (the pool could not pull a token: insufficient balance or allowance).
describe("NDIM_POOL_ABI errors", () => {
  test("decodes 0x7939f424 as TransferFromFailed", async () => {
    const c = await loadContracts();
    const decoded = decodeErrorResult({ abi: c.NDIM_POOL_ABI, data: "0x7939f424" });
    expect(decoded.errorName).toBe("TransferFromFailed");
  });

  test("declares every NDimPool custom error", async () => {
    const c = await loadContracts();
    const names = c.NDIM_POOL_ABI.filter((e) => e.type === "error").map((e) => e.name);
    for (const name of [
      "InvalidTokenIndex",
      "InvalidTickRange",
      "InsufficientLiquidity",
      "ZeroLiquidity",
      "ZeroReserve",
      "AlreadyInitialized",
      "NotInitialized",
    ]) {
      expect(names, `missing error ${name}`).toContain(name);
    }
  });
});
