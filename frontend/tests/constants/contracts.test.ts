import { afterEach, describe, expect, test, vi } from "vitest";

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
