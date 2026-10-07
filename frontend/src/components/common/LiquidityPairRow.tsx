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

  const { data: simulation, error: simulateError } = useSimulateContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "mint",
    args: account ? [account, i.index, j.index, tickLower, tickUpper, liquidityDelta] : undefined,
    query: { enabled: Boolean(account && liquidityDelta > 0n && price !== undefined) },
  });

  const previewAmountI = simulation?.result?.[0];
  const previewAmountJ = simulation?.result?.[1];

  const needsApprovalI = previewAmountI !== undefined && (tokenI.allowance ?? 0n) < previewAmountI;
  const needsApprovalJ = previewAmountJ !== undefined && (tokenJ.allowance ?? 0n) < previewAmountJ;

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
