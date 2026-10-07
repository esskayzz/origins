import { useMemo } from "react";
import {
  useAccount,
  useReadContract,
  useSimulateContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { BaseError, formatUnits } from "viem";
import type { Address } from "viem";
import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { NDIM_POOL_ABI } from "../../constants/contracts";
import { useErc20 } from "../../hooks/useErc20";
import { tickRangeAround } from "../../utils/tickMath";
import type { PoolToken } from "../../types/pool";
import { FaucetButton } from "./FaucetButton";

interface Props {
  poolAddress: Address;
  tickSpacing: number;
  tokenA: PoolToken;
  tokenB: PoolToken;
  widthInTicks: number;
  liquidityDelta: bigint;
}

/** One pairwise `mint()` within a multi-token liquidity-provision flow (see docs/DESIGN.md
 * section 3 -- positions are always pairwise on-chain; providing liquidity across 3+ tokens
 * means doing one of these per pair among the tokens the LP selected). */
export function LiquidityPairRow({
  poolAddress,
  tickSpacing,
  tokenA,
  tokenB,
  widthInTicks,
  liquidityDelta,
}: Props) {
  const { address: account } = useAccount();
  const [i, j] = tokenA.index < tokenB.index ? [tokenA, tokenB] : [tokenB, tokenA];

  const { data: price } = useReadContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "priceOf",
    args: [i.index, j.index],
  });

  const [tickLower, tickUpper] = useMemo(
    () => (price !== undefined ? tickRangeAround(price, tickSpacing, widthInTicks) : [0, 0]),
    [price, tickSpacing, widthInTicks],
  );

  const tokenI = useErc20(i.address, poolAddress);
  const tokenJ = useErc20(j.address, poolAddress);

  // Read-only quote: works regardless of allowance, unlike simulating `mint` itself (which
  // reverts with TransferFromFailed for insufficient allowance before the user has even had a
  // chance to see how much to approve -- a chicken-and-egg deadlock).
  const { data: preview } = useReadContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "previewMint",
    args: [i.index, j.index, tickLower, tickUpper, liquidityDelta],
    query: { enabled: Boolean(liquidityDelta > 0n && price !== undefined) },
  });

  const previewAmountI = preview?.[0];
  const previewAmountJ = preview?.[1];

  const needsApprovalI = previewAmountI !== undefined && (tokenI.allowance ?? 0n) < previewAmountI;
  const needsApprovalJ = previewAmountJ !== undefined && (tokenJ.allowance ?? 0n) < previewAmountJ;

  // Only simulate the real call once approvals are sufficient, both to avoid the deadlock above
  // and so any remaining error here is a genuine (non-approval) problem with the mint. That
  // includes waiting for the preview itself: before it loads both `needsApproval*` are trivially
  // false, and simulating then flashes a spurious TransferFromFailed error on every fresh row.
  const { data: simulation, error: simulateError } = useSimulateContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "mint",
    args: account ? [account, i.index, j.index, tickLower, tickUpper, liquidityDelta] : undefined,
    query: {
      enabled: Boolean(
        account && liquidityDelta > 0n && preview !== undefined && !needsApprovalI && !needsApprovalJ,
      ),
    },
  });

  const { writeContract, data: mintHash, isPending: isMinting } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: mintHash });

  const canMint = Boolean(simulation) && !needsApprovalI && !needsApprovalJ;

  return (
    <Card size="small" className="liquidity-pair-row">
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Space>
          <Typography.Text strong>
            {i.symbol} / {j.symbol}
          </Typography.Text>
          <Tag>
            ticks [{tickLower}, {tickUpper}]
          </Tag>
        </Space>

        <Space size="large">
          <Typography.Text type="secondary">
            {i.symbol}: {previewAmountI !== undefined ? formatUnits(previewAmountI, i.decimals) : "—"}
          </Typography.Text>
          <Typography.Text type="secondary">
            {j.symbol}: {previewAmountJ !== undefined ? formatUnits(previewAmountJ, j.decimals) : "—"}
          </Typography.Text>
          <FaucetButton tokenAddress={i.address} symbol={i.symbol} decimals={i.decimals} />
          <FaucetButton tokenAddress={j.address} symbol={j.symbol} decimals={j.decimals} />
        </Space>

        {simulateError && (
          <Alert
            type="error"
            showIcon
            message={simulateError instanceof BaseError ? simulateError.shortMessage : simulateError.message}
          />
        )}

        <Space>
          {needsApprovalI && (
            <Button size="small" loading={tokenI.isApproving} onClick={() => tokenI.approve()}>
              Approve {i.symbol}
            </Button>
          )}
          {needsApprovalJ && (
            <Button size="small" loading={tokenJ.isApproving} onClick={() => tokenJ.approve()}>
              Approve {j.symbol}
            </Button>
          )}
          {!needsApprovalI && !needsApprovalJ && (
            <Button
              size="small"
              type="primary"
              disabled={!canMint}
              loading={isMinting || isConfirming}
              onClick={() => simulation && writeContract(simulation.request)}
            >
              {isSuccess ? "Minted ✓" : "Provide liquidity"}
            </Button>
          )}
        </Space>
      </Space>
    </Card>
  );
}
