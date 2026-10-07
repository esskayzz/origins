import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mock } from "wagmi/connectors";
import { connect, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import { LOCAL_RPC_URL, localAnvil, sepoliaTestnet, supportedChains } from "../../src/constants/chains";
import { testnetTransport } from "../../src/services/wagmiConfig";
import { ERC20_ABI, NDIM_POOL_ABI } from "../../src/constants/contracts";
import { usePoolConfigStore } from "../../src/store/usePoolConfigStore";
import { SwapPage } from "../../src/pages/SwapPage";
import { LiquidityPage } from "../../src/pages/LiquidityPage";

// End-to-end check of the frontend's swap and liquidity flows against a live local `anvil`
// node (the same deployment `forge script script/DeployNDimPool.s.sol --broadcast` produces).
// Mirrors test/NDimPool.anvil.t.sol: skipped entirely when no node is reachable so a plain
// `npm test` still passes.
//
// The wallet is wagmi's `mock` connector pointed at anvil's second default account, which anvil
// holds the key for, so `eth_sendTransaction` forwarded by the connector gets signed node-side.
// That account starts with zero pool tokens, so each flow also exercises the faucet + approve
// steps a fresh user would hit.

const ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

async function detectAnvil(): Promise<boolean> {
  try {
    const res = await fetch(LOCAL_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const json = (await res.json()) as { result?: string };
    return json.result === `0x${localAnvil.id.toString(16)}`;
  } catch {
    return false;
  }
}

/** The NDimPool address from the most recent `forge script ... --broadcast` run against anvil. */
function resolvePoolAddress(): Address | undefined {
  try {
    const file = resolve(__dirname, "../../../broadcast/DeployNDimPool.s.sol/31337/run-latest.json");
    const run = JSON.parse(readFileSync(file, "utf8")) as {
      transactions: { transactionType: string; contractName: string; contractAddress: Address }[];
    };
    return run.transactions.find((t) => t.transactionType === "CREATE" && t.contractName === "NDimPool")
      ?.contractAddress;
  } catch {
    return undefined;
  }
}

const anvilUp = await detectAnvil();
const POOL = resolvePoolAddress();

// Same chain tuple as the app's wagmiConfig so this satisfies wagmi's registered `Config` type.
const config = createConfig({
  chains: supportedChains,
  // `reconnect: true` makes the mock connector report itself authorized; otherwise WagmiProvider's
  // mount-time reconnect finds no authorized connector and flips the state back to disconnected
  // right after the first render, unmounting every account-gated control (e.g. FaucetButton).
  connectors: [mock({ accounts: [ACCOUNT], features: { reconnect: true } })],
  transports: { [localAnvil.id]: http(LOCAL_RPC_URL), [sepoliaTestnet.id]: testnetTransport() },
  // Default is 4s; anvil mines instantly so tight polling keeps `useWaitForTransactionReceipt` snappy.
  pollingInterval: 50,
});

function Providers({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

const balanceOf = (token: Address, owner: Address) =>
  readContract(config, { address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });

const tokenAt = (i: number) =>
  readContract(config, { address: POOL!, abi: NDIM_POOL_ABI, functionName: "tokens", args: [BigInt(i)] });

const pairLiquidity = async (i: number, j: number) => {
  const key = await readContract(config, {
    address: POOL!,
    abi: NDIM_POOL_ABI,
    functionName: "pairKey",
    args: [i, j],
  });
  return readContract(config, {
    address: POOL!,
    abi: NDIM_POOL_ABI,
    functionName: "pairLiquidity",
    args: [key],
  });
};

/** Each flow must start from "nothing approved yet"; a previous run leaves an unlimited allowance. */
async function revokeAllowance(token: Address) {
  const hash = await writeContract(config, {
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [POOL!, 0n],
  });
  await waitForTransactionReceipt(config, { hash });
}

// antd fades its button spinner out with a CSS transition that jsdom never finishes, so a
// stale `aria-label="loading"` icon can linger inside a button and pollute its accessible
// name ("loading Swap"). Match buttons on their visible label text instead of the ARIA name.
const buttonByText = (scope: typeof screen | ReturnType<typeof within>, text: string) =>
  scope.getByText(text, { selector: "button span" }).closest("button") as HTMLButtonElement;
const findButtonByText = async (scope: typeof screen | ReturnType<typeof within>, text: string) =>
  (await scope.findByText(text, { selector: "button span" }, WAIT)).closest("button") as HTMLButtonElement;

const SLOW = { timeout: 90_000 };
const WAIT = { timeout: 20_000 };

describe.skipIf(!anvilUp || !POOL)("frontend against local anvil", () => {
  beforeAll(async () => {
    // antd's responsive observer needs matchMedia, which jsdom doesn't ship.
    window.matchMedia ??= (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;

    usePoolConfigStore.getState().setPoolAddress(localAnvil.id, POOL);
    await connect(config, { connector: config.connectors[0] });

    const initialized = await readContract(config, {
      address: POOL!,
      abi: NDIM_POOL_ABI,
      functionName: "initialized",
    });
    expect(initialized, "pool must be initialized (run the deploy script)").toBe(true);
  });

  beforeEach(async () => {
    const [tka, tkb] = await Promise.all([tokenAt(0), tokenAt(1)]);
    await revokeAllowance(tka);
    await revokeAllowance(tkb);
  }, 30_000);

  afterEach(cleanup);

  test("swap page: faucet -> approve -> quote -> swap TKA for TKB", SLOW, async () => {
    const [tka, tkb] = await Promise.all([tokenAt(0), tokenAt(1)]);
    const tkaBefore = await balanceOf(tka, ACCOUNT);
    const tkbBefore = await balanceOf(tkb, ACCOUNT);

    render(<SwapPage />, { wrapper: Providers });

    // Pool metadata loads from chain: token selects default to TKA -> TKB.
    await screen.findByText(/Balance:/, undefined, WAIT);

    // Faucet: a fresh wallet has no TKA.
    fireEvent.click(buttonByText(screen, "Get 1000 TKA"));
    const tkaFunded = tkaBefore + parseUnits("1000", 18);
    await waitFor(async () => expect(await balanceOf(tka, ACCOUNT)).toBe(tkaFunded), WAIT);
    // ...and the balance line refreshes without a manual reload.
    await screen.findByText(`Balance: ${formatUnits(tkaFunded, 18)}`, { exact: false }, WAIT);

    // Enter an amount; allowance is 0 so the primary action becomes "Approve TKA".
    const amountInput = screen.getAllByPlaceholderText("0.0").find((el) => !el.hasAttribute("readonly"))!;
    fireEvent.change(amountInput, { target: { value: "10" } });
    fireEvent.click(await findButtonByText(screen, "Approve TKA"));

    // Once the approval lands the allowance refetches, the swap is simulated and a quote shows.
    const swapButton = await findButtonByText(screen, "Swap");
    await waitFor(() => expect(swapButton).toBeEnabled(), WAIT);
    const quoteInput = screen
      .getAllByRole("textbox")
      .find((el) => el.hasAttribute("readonly")) as HTMLInputElement;
    const quoted = parseUnits(quoteInput.value, 18);
    expect(quoted).toBeGreaterThan(0n);
    // Output is strictly below the 10 TKA input: the 0.3% fee plus price impact. The pool's
    // original origin-centred curve quoted *more* than the input here, which is why this
    // assertion could not be made before (see docs/DESIGN.md section 2).
    expect(quoted).toBeLessThan(parseUnits("10", 18));

    fireEvent.click(swapButton);
    await screen.findByText("Swap confirmed.", undefined, WAIT);

    expect(await balanceOf(tka, ACCOUNT)).toBe(tkaFunded - parseUnits("10", 18));
    expect(await balanceOf(tkb, ACCOUNT)).toBe(tkbBefore + quoted);
  });

  test("liquidity page: select 3 tokens, fund + approve a pair, mint a position", SLOW, async () => {
    const [tka, tkb] = await Promise.all([tokenAt(0), tokenAt(1)]);
    const liquidityBefore = await pairLiquidity(0, 1);

    render(<LiquidityPage />, { wrapper: Providers });

    await screen.findByLabelText("TKA", undefined, WAIT);
    fireEvent.click(screen.getByLabelText("TKA"));
    fireEvent.click(screen.getByLabelText("TKB"));
    fireEvent.click(screen.getByLabelText("TKC"));

    // Three tokens => every pair among them gets its own row.
    await screen.findByText("TKA / TKB", undefined, WAIT);
    expect(screen.getByText("TKA / TKC")).toBeInTheDocument();
    expect(screen.getByText("TKB / TKC")).toBeInTheDocument();

    const row = within(screen.getByText("TKA / TKB").closest(".liquidity-pair-row") as HTMLElement);

    // previewMint quote (independent of allowance) renders both token amounts.
    await row.findByText(/^TKA: \d/, undefined, WAIT);
    await row.findByText(/^TKB: \d/, undefined, WAIT);

    // Fund via faucet, one at a time so the connector's nonces stay in order.
    const tkaBefore = await balanceOf(tka, ACCOUNT);
    fireEvent.click(buttonByText(row, "Get 1000 TKA"));
    await waitFor(async () => {
      expect(await balanceOf(tka, ACCOUNT)).toBe(tkaBefore + parseUnits("1000", 18));
    }, WAIT);
    const tkbBefore = await balanceOf(tkb, ACCOUNT);
    fireEvent.click(buttonByText(row, "Get 1000 TKB"));
    await waitFor(async () => {
      expect(await balanceOf(tkb, ACCOUNT)).toBe(tkbBefore + parseUnits("1000", 18));
    }, WAIT);

    // Approve each side; the button disappears once its allowance covers the preview amount.
    for (const symbol of ["TKA", "TKB"]) {
      fireEvent.click(await findButtonByText(row, `Approve ${symbol}`));
      await waitFor(() => expect(row.queryByText(`Approve ${symbol}`)).toBeNull(), WAIT);
    }

    const mintButton = await findButtonByText(row, "Provide liquidity");
    await waitFor(() => expect(mintButton).toBeEnabled(), WAIT);
    expect(row.queryByText(/reverted/)).toBeNull();
    fireEvent.click(mintButton);
    await row.findByText("Minted ✓", undefined, WAIT);

    // Default form values: 100 liquidity per pair across ±6000 ticks around the current price,
    // so the range is active and the pair's in-range liquidity grows by exactly that much.
    expect(await pairLiquidity(0, 1)).toBe(liquidityBefore + parseUnits("100", 18));
    expect(await balanceOf(tka, ACCOUNT)).toBeLessThan(tkaBefore + parseUnits("1000", 18));
    expect(await balanceOf(tkb, ACCOUNT)).toBeLessThan(tkbBefore + parseUnits("1000", 18));
  });
});
