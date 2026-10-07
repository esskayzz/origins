import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Address } from "viem";
import { isSupersededPool } from "../constants/contracts";

type Overrides = Partial<Record<number, Address>>;

interface PoolConfigState {
  /** User-entered pool address overrides, keyed by chain id, persisted to localStorage. */
  overridesByChain: Overrides;
  setPoolAddress: (chainId: number, address: Address | undefined) => void;
}

/** Discards overrides pointing at a pool we've since replaced, so a stale value saved in one
 * browser can't keep the app trading against it after a redeploy. */
function dropSuperseded(overrides: Overrides): Overrides {
  const kept: Overrides = {};
  for (const [chainId, address] of Object.entries(overrides)) {
    if (address && !isSupersededPool(address)) kept[Number(chainId)] = address;
  }
  return kept;
}

export const usePoolConfigStore = create<PoolConfigState>()(
  persist(
    (set) => ({
      overridesByChain: {},
      setPoolAddress: (chainId, address) =>
        set((state) => {
          const next = { ...state.overridesByChain };
          if (address) next[chainId] = address;
          else delete next[chainId];
          return { overridesByChain: next };
        }),
    }),
    {
      name: "ndimpool:poolAddressByChain",
      // Bumped when a deployment is superseded: entries written before this version are filtered
      // on load, which is what moves existing browsers off the old pool and onto the default.
      version: 1,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<PoolConfigState>;
        return { ...state, overridesByChain: dropSuperseded(state.overridesByChain ?? {}) };
      },
    },
  ),
);
