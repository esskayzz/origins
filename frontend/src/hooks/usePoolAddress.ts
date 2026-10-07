import { useChainId } from "wagmi";
import type { Address } from "viem";
import { usePoolConfigStore } from "../store/usePoolConfigStore";
import { DEFAULT_POOL_ADDRESSES } from "../constants/contracts";

/** The active chain's pool address (user override from the store, falling back to the
 * build-time default) plus a setter that scopes the override to the current chain. */
export function usePoolAddress() {
  const chainId = useChainId();
  const override = usePoolConfigStore((s) => s.overridesByChain[chainId]);
  const setForChain = usePoolConfigStore((s) => s.setPoolAddress);

  return {
    chainId,
    poolAddress: override ?? DEFAULT_POOL_ADDRESSES[chainId],
    setPoolAddress: (address: Address | "") => setForChain(chainId, address || undefined),
  };
}
