import { afterEach, describe, expect, test, vi } from "vitest";

// chains.ts reads its env at module-evaluation time, so each case re-imports it fresh.
async function loadChains() {
  vi.resetModules();
  return import("../../src/constants/chains");
}

describe("testnet RPC selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("defaults to the same-origin proxy so no provider key ships in the bundle", async () => {
    vi.stubEnv("VITE_TESTNET_RPC_URL", "");
    const chains = await loadChains();
    expect(chains.TESTNET_RPC_URL).toBe("/api/rpc");
  });

  test("honours an explicit VITE_TESTNET_RPC_URL override", async () => {
    vi.stubEnv("VITE_TESTNET_RPC_URL", "https://sepolia.example-provider.io/v2/abc");
    const chains = await loadChains();
    expect(chains.TESTNET_RPC_URL).toBe("https://sepolia.example-provider.io/v2/abc");
  });

  test("the wallet-facing Sepolia chain definition stays an absolute public URL", async () => {
    vi.stubEnv("VITE_TESTNET_RPC_URL", "");
    const chains = await loadChains();
    expect(chains.sepoliaTestnet.rpcUrls.default.http[0]).toBe(chains.PUBLIC_TESTNET_RPC_URL);
    expect(chains.sepoliaTestnet.rpcUrls.default.http[0]).toMatch(/^https:\/\//);
  });

  // Regression test for: without a multicall3 entry, `useReadContracts` issued one eth_call per
  // token/metadata item and the burst was rate-limited (HTTP 429) by the free NOWNodes tier.
  test("Sepolia registers Multicall3 so multi-reads aggregate into one eth_call", async () => {
    const chains = await loadChains();
    expect(chains.sepoliaTestnet.contracts?.multicall3?.address).toBe(
      "0xca11bde05977b3631167028862be2a173976ca11",
    );
  });
});
