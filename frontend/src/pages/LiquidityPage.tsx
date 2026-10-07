import { useMemo, useState } from "react";
import { BaseError, parseUnits } from "viem";
import { Alert, Card, Checkbox, Input, InputNumber, Space, Spin, Typography } from "antd";
import { usePoolAddress } from "../hooks/usePoolAddress";
import { usePoolTokens } from "../hooks/usePoolTokens";
import { useReadContract } from "wagmi";
import { NDIM_POOL_ABI } from "../constants/contracts";
import { LiquidityPairRow } from "../components/common/LiquidityPairRow";

function combinations<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) pairs.push([items[a], items[b]]);
  }
  return pairs;
}

export function LiquidityPage() {
  const { poolAddress } = usePoolAddress();
  const { tokens, isLoading, isInitialized, error: poolError } = usePoolTokens(poolAddress);
  const { data: tickSpacing } = useReadContract({
    address: poolAddress,
    abi: NDIM_POOL_ABI,
    functionName: "tickSpacing",
    query: { enabled: Boolean(poolAddress) },
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [widthText, setWidthText] = useState("6000");
  const [liquidityText, setLiquidityText] = useState("100");

  const selectedTokens = useMemo(() => tokens.filter((t) => selected.has(t.index)), [tokens, selected]);
  const pairs = useMemo(() => combinations(selectedTokens), [selectedTokens]);

  const widthInTicks = Number(widthText) || 0;
  const liquidityDelta = useMemo(() => {
    try {
      return parseUnits(liquidityText || "0", 18);
    } catch {
      return 0n;
    }
  }, [liquidityText]);

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (!poolAddress) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Configure a pool address for this network to provide liquidity."
      />
    );
  }
  if (isLoading) {
    return (
      <Card>
        <Spin /> <Typography.Text type="secondary">Loading pool tokens…</Typography.Text>
      </Card>
    );
  }
  // See SwapPage: an unreachable RPC must not be reported as an un-seeded pool.
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
    <Card title="Provide liquidity" className="liquidity-panel">
      <Typography.Paragraph type="secondary">
        Positions are always pairwise on-chain (docs/DESIGN.md section 3). Pick 3 or more tokens and this
        provides liquidity across every pair among them in one guided flow.
      </Typography.Paragraph>

      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Typography.Text strong>Tokens</Typography.Text>
          <br />
          <Space wrap className="token-checkboxes">
            {tokens.map((t) => (
              <Checkbox key={t.index} checked={selected.has(t.index)} onChange={() => toggle(t.index)}>
                {t.symbol}
              </Checkbox>
            ))}
          </Space>
          {selected.size > 0 && selected.size < 3 && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 8 }}
              message="Select at least 3 tokens to span more than one pair."
            />
          )}
        </div>

        <Space size="large" wrap>
          <div>
            <Typography.Text type="secondary">Tick range width (± ticks from current price)</Typography.Text>
            <br />
            <InputNumber value={Number(widthText)} onChange={(v) => setWidthText(String(v ?? 0))} />
          </div>
          <div>
            <Typography.Text type="secondary">Liquidity per pair</Typography.Text>
            <br />
            <Input
              inputMode="decimal"
              value={liquidityText}
              onChange={(e) => setLiquidityText(e.target.value)}
              style={{ width: 160 }}
            />
          </div>
        </Space>

        {pairs.length > 0 && tickSpacing !== undefined && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }} className="liquidity-pairs">
            {pairs.map(([a, b]) => (
              <LiquidityPairRow
                key={`${a.index}-${b.index}`}
                poolAddress={poolAddress}
                tickSpacing={Number(tickSpacing)}
                tokenA={a}
                tokenB={b}
                widthInTicks={widthInTicks}
                liquidityDelta={liquidityDelta}
              />
            ))}
          </Space>
        )}
      </Space>
    </Card>
  );
}
