import type { Address } from "viem";

export interface PoolToken {
  index: number;
  address: Address;
  symbol: string;
  decimals: number;
}
