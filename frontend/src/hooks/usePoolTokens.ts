import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { NDIM_POOL_ABI, ERC20_ABI } from "../constants/contracts";
import type { PoolToken } from "../types/pool";

export interface PoolTokensResult {
  tokens: PoolToken[];
  isLoading: boolean;
  isInitialized: boolean;
}

/** Reads `n`, every `tokens(i)` address, and each token's symbol/decimals. */
export function usePoolTokens(poolAddress: Address | undefined): PoolTokensResult {
  const { data: n, isLoading: nLoading } = useReadContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "n",
    query: { enabled: Boolean(poolAddress) },
  });

  const { data: initialized } = useReadContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "initialized",
    query: { enabled: Boolean(poolAddress) },
  });

  const tokenAddressCalls = useMemo(() => {
    if (!poolAddress || !n) return [];
    return Array.from({ length: Number(n) }, (_, i) => ({
      address: poolAddress,
      abi: NDIM_POOL_ABI,
      functionName: "tokens" as const,
      args: [BigInt(i)] as const,
    }));
  }, [poolAddress, n]);

  const { data: tokenAddresses, isLoading: addrsLoading } = useReadContracts({
    contracts: tokenAddressCalls,
    query: { enabled: tokenAddressCalls.length > 0 },
  });

  const addresses = useMemo(
    () =>
      (tokenAddresses ?? [])
        .map((r) => r.result as Address | undefined)
        .filter((a): a is Address => Boolean(a)),
    [tokenAddresses],
  );

  const metadataCalls = useMemo(() => {
    return addresses.flatMap((address) => [
      { address, abi: ERC20_ABI, functionName: "symbol" as const },
      { address, abi: ERC20_ABI, functionName: "decimals" as const },
    ]);
  }, [addresses]);

  const { data: metadata, isLoading: metaLoading } = useReadContracts({
    contracts: metadataCalls,
    query: { enabled: metadataCalls.length > 0 },
  });

  const tokens = useMemo<PoolToken[]>(() => {
    if (!addresses.length || !metadata) return [];
    return addresses.map((address, i) => ({
      index: i,
      address,
      symbol: (metadata[i * 2]?.result as string | undefined) ?? `TKN${i}`,
      decimals: Number((metadata[i * 2 + 1]?.result as number | undefined) ?? 18),
    }));
  }, [addresses, metadata]);

  return {
    tokens,
    isLoading: nLoading || addrsLoading || metaLoading,
    isInitialized: Boolean(initialized),
  };
}
