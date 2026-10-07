import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const KEY = "ndimpool:poolAddressByChain";
const SUPERSEDED = "0xb55Dc1fa2ACfB4e1C0CBC46C77E941f76775B92b";
const SEPOLIA = 11155111;
const ANVIL = 31337;

/** The store hydrates from localStorage at import time, so each case seeds storage then
 * re-imports it fresh. */
async function loadStore(persisted?: unknown) {
  localStorage.clear();
  if (persisted !== undefined) localStorage.setItem(KEY, JSON.stringify(persisted));
  vi.resetModules();
  const { usePoolConfigStore } = await import("../../src/store/usePoolConfigStore");
  return usePoolConfigStore;
}

describe("usePoolConfigStore persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("starts empty when nothing is saved", async () => {
    const store = await loadStore();
    expect(store.getState().overridesByChain).toEqual({});
  });

  test("keeps a normal saved override", async () => {
    const mine = "0x1111111111111111111111111111111111111111";
    const store = await loadStore({ state: { overridesByChain: { [ANVIL]: mine } }, version: 0 });
    expect(store.getState().overridesByChain[ANVIL]).toBe(mine);
  });

  // Regression test for: a browser that had the pre-fix Sepolia pool saved in the in-app "Pool
  // address" field kept using it after the redeploy, because the override wins over the built-in
  // default -- silently trading against the exploitable origin-centred curve.
  test("drops an override pointing at a superseded pool, so the default applies", async () => {
    const store = await loadStore({
      state: { overridesByChain: { [SEPOLIA]: SUPERSEDED } },
      version: 0,
    });
    expect(store.getState().overridesByChain[SEPOLIA]).toBeUndefined();
  });

  test("matches superseded pools case-insensitively and leaves other chains alone", async () => {
    const mine = "0x1111111111111111111111111111111111111111";
    const store = await loadStore({
      state: { overridesByChain: { [SEPOLIA]: SUPERSEDED.toLowerCase(), [ANVIL]: mine } },
      version: 0,
    });
    expect(store.getState().overridesByChain[SEPOLIA]).toBeUndefined();
    expect(store.getState().overridesByChain[ANVIL]).toBe(mine);
  });

  test("setPoolAddress stores and clears per chain", async () => {
    const store = await loadStore();
    const addr = "0x2222222222222222222222222222222222222222";
    store.getState().setPoolAddress(SEPOLIA, addr);
    expect(store.getState().overridesByChain[SEPOLIA]).toBe(addr);
    store.getState().setPoolAddress(SEPOLIA, undefined);
    expect(store.getState().overridesByChain[SEPOLIA]).toBeUndefined();
  });
});
