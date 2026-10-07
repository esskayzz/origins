import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Address } from "viem";

interface PoolConfigState {
  /** User-entered pool address overrides, keyed by chain id, persisted to localStorage. */
  overridesByChain: Partial<Record<number, Address>>;
  setPoolAddress: (chainId: number, address: Address | undefined) => void;
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
    { name: "ndimpool:poolAddressByChain" },
  ),
);
