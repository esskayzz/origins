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
    const [tka, tkb, tkc] = await Promise.all([tokenAt(0), tokenAt(1), tokenAt(2)]);
    await revokeAllowance(tka);
    await revokeAllowance(tkb);
    await revokeAllowance(tkc);
  }, 30_000);

  afterEach(cleanup);

  const SYMBOLS = ["TKA", "TKB", "TKC"] as const;
  const ALL_PAIRS: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  /** Pick a token in one of the swap page's antd Selects (0 = "From", 1 = "To"). antd renders
   * the option list into a body-level portal, so the open dropdown is located there. */
  async function selectToken(which: 0 | 1, symbol: string) {
    const combobox = screen.getAllByRole("combobox")[which];
    fireEvent.mouseDown(combobox.closest(".ant-select-selector") as HTMLElement);
    const option = await waitFor(() => {
      // Both Selects keep their (hidden) dropdowns mounted once opened, so locate *this* one
      // through the combobox's aria-controls listbox rather than "the visible dropdown". That
      // relies on the page giving each Select its own `id` (rc-select otherwise uses one shared
      // placeholder id under test, and the lookup lands on the other Select's dropdown).
      const listbox = document.getElementById(combobox.getAttribute("aria-controls") ?? "");
      const dropdown = listbox?.closest<HTMLElement>(".ant-select-dropdown");
      const el = dropdown?.querySelector<HTMLElement>(`.ant-select-item-option[title="${symbol}"]`);
      if (!el) throw new Error(`option ${symbol} is not in this Select's dropdown`);
      return el;
    }, WAIT);
    expect(option.classList.contains("ant-select-item-option-disabled"), `${symbol} is disabled`).toBe(false);
    fireEvent.click(option);
    await waitFor(() => expect(shownSelections()[which]).toBe(symbol), WAIT);
  }

  /** The symbols currently displayed in the From / To selects. */
  const shownSelections = () =>
    Array.from(document.querySelectorAll(".ant-select-selection-item")).map((el) => el.textContent);

  const flip = () => fireEvent.click(screen.getByTitle("Flip tokens"));

  // Every ordered pair, reached from the page's default TKA -> TKB using only *enabled* Select
  // options (the token on the other side is disabled) plus the Flip button.
  const SWAP_ROUTES: { label: string; from: number; to: number; steps: () => Promise<void> }[] = [
    { label: "TKA -> TKB", from: 0, to: 1, steps: async () => {} },
    { label: "TKB -> TKA", from: 1, to: 0, steps: async () => flip() },
    { label: "TKA -> TKC", from: 0, to: 2, steps: () => selectToken(1, "TKC") },
    {
      label: "TKC -> TKA",
      from: 2,
      to: 0,
      steps: async () => {
        await selectToken(1, "TKC");
        flip();
      },
    },
    {
      label: "TKB -> TKC",
      from: 1,
      to: 2,
      steps: async () => {
        await selectToken(1, "TKC");
        await selectToken(0, "TKB");
      },
    },
    {
      label: "TKC -> TKB",
      from: 2,
      to: 1,
      steps: async () => {
        await selectToken(1, "TKC");
        await selectToken(0, "TKB");
        flip();
      },
    },
  ];

  test.each(SWAP_ROUTES)(
    "swap page: faucet -> approve -> quote -> swap $label",
    async ({ from, to, steps }) => {
      const [tokenIn, tokenOut] = await Promise.all([tokenAt(from), tokenAt(to)]);
      const inBefore = await balanceOf(tokenIn, ACCOUNT);
      const outBefore = await balanceOf(tokenOut, ACCOUNT);
      // Pre-trade spot price of `from` in `to` (WAD), the ceiling any quote may approach. The
      // pool keys pair state by (lower, higher) index and `priceOf` does not reorder its
      // arguments (it returns 0 for i > j), so the reverse direction is the reciprocal.
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const priceLoInHi = await readContract(config, {
        address: POOL!,
        abi: NDIM_POOL_ABI,
        functionName: "priceOf",
        args: [lo, hi],
      });
      const WAD = 10n ** 18n;
      const spot = from < to ? priceLoInHi : (WAD * WAD) / priceLoInHi;

      render(<SwapPage />, { wrapper: Providers });

      // Pool metadata loads from chain: token selects default to TKA -> TKB.
      await screen.findByText(/Balance:/, undefined, WAIT);
      await steps();
      await waitFor(() => expect(shownSelections()).toEqual([SYMBOLS[from], SYMBOLS[to]]), WAIT);
      // The balance line follows the input side.
      await screen.findByText(new RegExp(`^Balance: .* ${SYMBOLS[from]}`), undefined, WAIT);

      // Faucet the input token (a fresh wallet holds none of them).
      fireEvent.click(buttonByText(screen, `Get 1000 ${SYMBOLS[from]}`));
      const funded = inBefore + parseUnits("1000", 18);
      await waitFor(async () => expect(await balanceOf(tokenIn, ACCOUNT)).toBe(funded), WAIT);
      // ...and the balance line refreshes without a manual reload.
      await screen.findByText(`Balance: ${formatUnits(funded, 18)}`, { exact: false }, WAIT);

      // Enter an amount; allowance is 0 so the primary action becomes "Approve <in>".
      const amountInput = screen.getAllByPlaceholderText("0.0").find((el) => !el.hasAttribute("readonly"))!;
      fireEvent.change(amountInput, { target: { value: "10" } });
      fireEvent.click(await findButtonByText(screen, `Approve ${SYMBOLS[from]}`));

      // Once the approval lands the allowance refetches, the swap is simulated and a quote shows.
      const swapButton = await findButtonByText(screen, "Swap");
      await waitFor(() => expect(swapButton).toBeEnabled(), WAIT);
      const quoteInput = screen
        .getAllByRole("textbox")
        .find((el) => el.hasAttribute("readonly")) as HTMLInputElement;
      const quoted = parseUnits(quoteInput.value, 18);
      expect(quoted).toBeGreaterThan(0n);
      // Never beats the pre-trade spot price (same invariant as test_SwapIsConvexAndNeverBeatsSpot
      // in test/NDimPool.t.sol): the 0.3% fee plus price impact keep it strictly below. A fixed
      // "less than the input" bound would be wrong here: earlier swaps move the price, so selling
      // the token the pool is now short of legitimately pays out more than 1:1.
      const amountIn = parseUnits("10", 18);
      const spotCeiling = (amountIn * spot) / WAD;
      expect(quoted, `quote ${quoted} vs spot ceiling ${spotCeiling}`).toBeLessThan(spotCeiling);
      expect(screen.queryByText("Swap would revert")).toBeNull();

      fireEvent.click(swapButton);
      await screen.findByText("Swap confirmed.", undefined, WAIT);

      expect(await balanceOf(tokenIn, ACCOUNT)).toBe(funded - amountIn);
      expect(await balanceOf(tokenOut, ACCOUNT)).toBe(outBefore + quoted);
    },
    90_000,
  );

  test("swap page: faucets cover every pool token, not just the input side", SLOW, async () => {
    const [tka, tkb, tkc] = await Promise.all([tokenAt(0), tokenAt(1), tokenAt(2)]);

    render(<SwapPage />, { wrapper: Providers });
    await screen.findByText(/Balance:/, undefined, WAIT);

    // The input side defaults to TKA, but TKB and TKC must be faucetable too -- otherwise a
    // fresh wallet can never swap in the other direction or provide liquidity.
    buttonByText(screen, "Get 1000 TKA");

    const tkbBefore = await balanceOf(tkb, ACCOUNT);
    fireEvent.click(buttonByText(screen, "Get 1000 TKB"));
    await waitFor(async () => {
      expect(await balanceOf(tkb, ACCOUNT)).toBe(tkbBefore + parseUnits("1000", 18));
    }, WAIT);

    const tkcBefore = await balanceOf(tkc, ACCOUNT);
    fireEvent.click(buttonByText(screen, "Get 1000 TKC"));
    await waitFor(async () => {
      expect(await balanceOf(tkc, ACCOUNT)).toBe(tkcBefore + parseUnits("1000", 18));
    }, WAIT);

    // Each token has exactly one faucet on the page, so the earlier `getByText` lookups stay
    // unambiguous (an inline duplicate next to the balance line would break them).
    expect(screen.getAllByText(/^Get 1000 TK[ABC]$/, { selector: "button span" })).toHaveLength(3);
    expect(tka).toBeDefined();
  });

  // Regression test for: with an approved token but not enough balance for the preview amounts,
  // the mint simulation reverted with Solady's TransferFromFailed and the row showed the bare
  // selector "0x7939f424". The row must say which token is short instead, and not offer to mint.
  test("liquidity page: an unaffordable position reports the shortfall instead of a raw revert", async () => {
    render(<LiquidityPage />, { wrapper: Providers });

    await screen.findByLabelText("TKA", undefined, WAIT);
    fireEvent.click(screen.getByLabelText("TKA"));
    fireEvent.click(screen.getByLabelText("TKB"));
    await screen.findByText("TKA / TKB", undefined, WAIT);
    const row = within(screen.getByText("TKA / TKB").closest(".liquidity-pair-row") as HTMLElement);
    await row.findByText(/^TKA: \d/, undefined, WAIT);

    // Pre-approve so allowance is not what blocks the mint (that is the "sometimes" case).
    for (const symbol of ["TKA", "TKB"]) {
      const btn = row.queryByText(`Approve ${symbol}`, { selector: "button span" })?.closest("button");
      if (btn) {
        fireEvent.click(btn);
        await waitFor(() => expect(row.queryByText(`Approve ${symbol}`)).toBeNull(), WAIT);
      }
    }

    // Ask for far more liquidity than the faucet's 1000 tokens can back.
    fireEvent.change(screen.getByDisplayValue("100"), { target: { value: "1000000" } });

    await row.findByText(/^Insufficient TKA: this position needs/, undefined, WAIT);
    await row.findByText(/^Insufficient TKB: this position needs/, undefined, WAIT);
    expect(row.queryByText(/reverted|0x7939f424|TransferFromFailed/)).toBeNull();
    await waitFor(() => expect(buttonByText(row, "Provide liquidity")).toBeDisabled(), WAIT);
  }, 60_000);

  test("liquidity page: select 3 tokens, then fund + approve + mint a position on every pair", async () => {
    const tokens = await Promise.all([0, 1, 2].map(tokenAt));
    const liquidityBefore = await Promise.all(ALL_PAIRS.map(([i, j]) => pairLiquidity(i, j)));

    render(<LiquidityPage />, { wrapper: Providers });

    await screen.findByLabelText("TKA", undefined, WAIT);
    fireEvent.click(screen.getByLabelText("TKA"));
    fireEvent.click(screen.getByLabelText("TKB"));
    fireEvent.click(screen.getByLabelText("TKC"));

    // Three tokens => every pair among them gets its own row.
    await screen.findByText("TKA / TKB", undefined, WAIT);
    expect(screen.getByText("TKA / TKC")).toBeInTheDocument();
    expect(screen.getByText("TKB / TKC")).toBeInTheDocument();
    expect(document.querySelectorAll(".liquidity-pair-row")).toHaveLength(ALL_PAIRS.length);

    for (const [k, [i, j]] of ALL_PAIRS.entries()) {
      const title = `${SYMBOLS[i]} / ${SYMBOLS[j]}`;
      const row = within(screen.getByText(title).closest(".liquidity-pair-row") as HTMLElement);

      // previewMint quote (independent of allowance) renders both token amounts.
      await row.findByText(new RegExp(`^${SYMBOLS[i]}: \\d`), undefined, WAIT);
      await row.findByText(new RegExp(`^${SYMBOLS[j]}: \\d`), undefined, WAIT);

      // Fund via the row's own faucets, one at a time so the connector's nonces stay in order.
      const before: bigint[] = [];
      for (const idx of [i, j]) {
        before[idx] = await balanceOf(tokens[idx], ACCOUNT);
        fireEvent.click(buttonByText(row, `Get 1000 ${SYMBOLS[idx]}`));
        await waitFor(async () => {
          expect(await balanceOf(tokens[idx], ACCOUNT)).toBe(before[idx] + parseUnits("1000", 18));
        }, WAIT);
      }

      // Approve each side that still needs it. `approve()` grants an unlimited allowance, so a
      // token already approved in an earlier row must NOT be asked for again here.
      for (const idx of [i, j]) {
        const label = `Approve ${SYMBOLS[idx]}`;
        const approveButton = row.queryByText(label, { selector: "button span" })?.closest("button");
        if (approveButton) {
          fireEvent.click(approveButton);
          await waitFor(() => expect(row.queryByText(label)).toBeNull(), WAIT);
        }
      }

      const mintButton = await findButtonByText(row, "Provide liquidity");
      await waitFor(() => expect(mintButton).toBeEnabled(), WAIT);
      expect(row.queryByText(/reverted/), `${title}: mint simulation reverted`).toBeNull();
      fireEvent.click(mintButton);
      await row.findByText("Minted ✓", undefined, WAIT);

      // Default form values: 100 liquidity per pair across ±6000 ticks around the current price,
      // so the range is active and the pair's in-range liquidity grows by exactly that much.
      expect(await pairLiquidity(i, j), `${title}: in-range liquidity`).toBe(
        liquidityBefore[k] + parseUnits("100", 18),
      );
      expect(await balanceOf(tokens[i], ACCOUNT)).toBeLessThan(before[i] + parseUnits("1000", 18));
      expect(await balanceOf(tokens[j], ACCOUNT)).toBeLessThan(before[j] + parseUnits("1000", 18));
    }

    // Every token is in two pairs, so each got approved exactly once (unlimited) and no row
    // should still be offering an approval.
    expect(screen.queryAllByText(/^Approve TK[ABC]$/)).toHaveLength(0);
  }, 180_000);
});
