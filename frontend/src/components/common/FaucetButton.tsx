import { useAccount } from "wagmi";
import { Button } from "antd";
import { parseUnits } from "viem";
import type { Address } from "viem";
import { useErc20 } from "../../hooks/useErc20";

interface Props {
  tokenAddress: Address;
  symbol: string;
  decimals: number;
  amount?: string;
}

/** `TestERC20.mint()` is public and unrestricted (see src/test/TestERC20.sol) -- this just lets
 * a freshly-connected wallet (which has none of these tokens, unlike the account the pool was
 * deployed/seeded from) get some to try swapping or providing liquidity with. */
export function FaucetButton({ tokenAddress, symbol, decimals, amount = "1000" }: Props) {
  const { address: account } = useAccount();
  const { mintFaucet, isApproving: isMinting } = useErc20(tokenAddress, undefined);

  if (!account) return null;

  return (
    <Button
      size="small"
      type="link"
      style={{ padding: 0, height: "auto" }}
      loading={isMinting}
      onClick={() => mintFaucet(account, parseUnits(amount, decimals))}
    >
      Get {amount} {symbol}
    </Button>
  );
}
