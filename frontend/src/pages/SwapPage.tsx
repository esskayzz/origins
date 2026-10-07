import { useMemo, useState } from "react";
import { useAccount, useSimulateContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { BaseError, formatUnits, parseUnits } from "viem";
import { Alert, Button, Card, Input, Select, Space, Spin, Typography } from "antd";
import { SwapOutlined } from "@ant-design/icons";
import { usePoolAddress } from "../hooks/usePoolAddress";
import { usePoolTokens } from "../hooks/usePoolTokens";
import type { PoolToken } from "../types/pool";
import { useErc20 } from "../hooks/useErc20";
import { NDIM_POOL_ABI } from "../constants/contracts";
import { FaucetButton } from "../components/common/FaucetButton";

export function SwapPage() {
  const { poolAddress } = usePoolAddress();
  const { address: account } = useAccount();
  const { tokens, isLoading: tokensLoading, isInitialized, error: poolError } = usePoolTokens(poolAddress);

  const [tokenInIdx, setTokenInIdx] = useState(0);
  const [tokenOutIdx, setTokenOutIdx] = useState(1);
  const [amountInText, setAmountInText] = useState("");

  const tokenIn: PoolToken | undefined = tokens[tokenInIdx];
  const tokenOut: PoolToken | undefined = tokens[tokenOutIdx];

  const amountIn = useMemo(() => {
    if (!tokenIn || !amountInText) return 0n;
    try {
      return parseUnits(amountInText, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amountInText, tokenIn]);

  const { balance, allowance, approve, isApproving, refetch } = useErc20(tokenIn?.address, poolAddress);
  const needsApproval = amountIn > 0n && (allowance ?? 0n) < amountIn;
  const insufficientBalance = amountIn > 0n && balance !== undefined && amountIn > balance;

  const {
    data: simulation,
    error: simulateError,
    isFetching: isSimulating,
  } = useSimulateContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "swap",
    args: account && tokenIn && tokenOut ? [account, tokenIn.index, tokenOut.index, amountIn] : undefined,
    query: {
      enabled: Boolean(
        poolAddress &&
        account &&
        tokenIn &&
        tokenOut &&
        amountIn > 0n &&
        !needsApproval &&
        !insufficientBalance,
      ),
    },
  });

  const { writeContract, data: swapHash, isPending: isSwapping } = useWriteContract();
  const { isLoading: isConfirmingSwap, isSuccess: swapSucceeded } = useWaitForTransactionReceipt({
    hash: swapHash,
  });

  const quoteOut = simulation?.result as bigint | undefined;

  const handleSwap = () => {
    if (!simulation) return;
    writeContract(simulation.request);
  };

  const handleFlip = () => {
    setTokenInIdx(tokenOutIdx);
    setTokenOutIdx(tokenInIdx);
  };

  const tokenOptions = (excludeIdx: number) =>
    tokens.map((t) => ({ value: t.index, label: t.symbol, disabled: t.index === excludeIdx }));

  if (!poolAddress) {
    return (
      <Alert type="warning" showIcon message="Configure a pool address for this network to start swapping." />
    );
  }
  if (tokensLoading) {
    return (
      <Card>
        <Spin /> <Typography.Text type="secondary">Loading pool tokens…</Typography.Text>
      </Card>
    );
  }
  // A failed read is NOT the same as an un-seeded pool: reporting an unreachable RPC as
  // "not initialized" sends you looking at the contract when the network is the problem.
  if (poolError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Couldn't read the pool"
        description={
          <>
            {poolError instanceof BaseError ? poolError.shortMessage : poolError.message}
            <br />
            Check that the pool address is right for the network your wallet is on, and that the RPC endpoint
            is reachable.
          </>
        }
      />
    );
  }
  if (!isInitialized) return <Alert type="warning" showIcon message="Pool is not initialized yet." />;

  return (
    <Card title="Swap" className="swap-panel">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Typography.Text type="secondary">From</Typography.Text>
          <Space.Compact style={{ width: "100%" }}>
            <Select
              id="swap-token-in"
              value={tokenInIdx}
              onChange={setTokenInIdx}
              options={tokenOptions(tokenOutIdx)}
              style={{ width: 140 }}
            />
            <Input
              inputMode="decimal"
              placeholder="0.0"
              value={amountInText}
              onChange={(e) => setAmountInText(e.target.value)}
            />
          </Space.Compact>
          {tokenIn && balance !== undefined && (
            <Typography.Text type="secondary" className="hint">
              Balance: {formatUnits(balance, tokenIn.decimals)} {tokenIn.symbol}{" "}
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: "auto" }}
                onClick={() => setAmountInText(formatUnits(balance, tokenIn.decimals))}
              >
                Max
              </Button>
            </Typography.Text>
          )}
        </div>

        <Button shape="circle" icon={<SwapOutlined />} onClick={handleFlip} title="Flip tokens" />

        <div>
          <Typography.Text type="secondary">To (estimated)</Typography.Text>
          <Space.Compact style={{ width: "100%" }}>
            <Select
              id="swap-token-out"
              value={tokenOutIdx}
              onChange={setTokenOutIdx}
              options={tokenOptions(tokenInIdx)}
              style={{ width: 140 }}
            />
            <Input
              readOnly
              value={tokenOut && quoteOut !== undefined ? formatUnits(quoteOut, tokenOut.decimals) : ""}
              placeholder={isSimulating ? "Quoting…" : "0.0"}
            />
          </Space.Compact>
        </div>

        {insufficientBalance && <Alert type="error" showIcon message="Insufficient balance." />}

        {amountIn > 0n && simulateError && !needsApproval && !insufficientBalance && (
          <Alert
            type="error"
            showIcon
            message="Swap would revert"
            description={
              simulateError instanceof BaseError ? simulateError.shortMessage : simulateError.message
            }
          />
        )}

        {needsApproval && !insufficientBalance ? (
          <Button type="primary" block loading={isApproving} onClick={() => approve()}>
            Approve {tokenIn?.symbol}
          </Button>
        ) : (
          <Button
            type="primary"
            block
            disabled={!simulation || insufficientBalance}
            loading={isSwapping || isConfirmingSwap}
            onClick={handleSwap}
          >
            Swap
          </Button>
        )}

        {swapSucceeded && (
          <Alert
            type="success"
            showIcon
            message="Swap confirmed."
            action={
              <Button size="small" type="link" onClick={refetch}>
                Refresh balance
              </Button>
            }
          />
        )}

        {/* One faucet per pool token, not just the current input side: a fresh wallet needs the
            other tokens too (to swap the other direction, or to provide liquidity). */}
        {account && tokens.length > 0 && (
          <div className="faucet-row">
            <Typography.Text type="secondary" className="hint">
              Faucet
            </Typography.Text>
            <Space wrap size="middle">
              {tokens.map((t) => (
                <FaucetButton
                  key={t.address}
                  tokenAddress={t.address}
                  symbol={t.symbol}
                  decimals={t.decimals}
                />
              ))}
            </Space>
          </div>
        )}
      </Space>
    </Card>
  );
}
