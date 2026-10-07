import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address } from "viem";
import { maxUint256 } from "viem";
import { ERC20_ABI } from "../constants/contracts";

export function useErc20(tokenAddress: Address | undefined, spender: Address | undefined) {
  const { address: owner } = useAccount();

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    query: { enabled: Boolean(tokenAddress && owner) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    query: { enabled: Boolean(tokenAddress && owner && spender) },
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const approve = (amount: bigint = maxUint256) => {
    if (!tokenAddress || !spender) return;
    writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });
  };

  const mintFaucet = (to: Address, amount: bigint) => {
    if (!tokenAddress) return;
    writeContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "mint", args: [to, amount] });
  };

  return {
    balance: balance as bigint | undefined,
    allowance: allowance as bigint | undefined,
    approve,
    mintFaucet,
    isApproving: isPending || isConfirming,
    approveConfirmed: isSuccess,
    refetch: () => {
      void refetchBalance();
      void refetchAllowance();
    },
  };
}
