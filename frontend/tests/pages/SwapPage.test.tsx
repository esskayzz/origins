import { beforeAll, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mock } from "wagmi/connectors";
import { connect } from "wagmi/actions";
import { localAnvil, sepoliaTestnet, supportedChains } from "../../src/constants/chains";
import { usePoolConfigStore } from "../../src/store/usePoolConfigStore";
import { SwapPage } from "../../src/pages/SwapPage";

const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
// A closed port: every read fails immediately with a connection error.
const DEAD_RPC = "http://127.0.0.1:1";

const config = createConfig({
  chains: supportedChains,
  connectors: [mock({ accounts: [ACCOUNT], features: { reconnect: true } })],
  transports: { [localAnvil.id]: http(DEAD_RPC), [sepoliaTestnet.id]: http(DEAD_RPC) },
});

function Providers({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

describe("SwapPage with an unreachable RPC", () => {
  beforeAll(async () => {
    window.matchMedia ??= ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

    usePoolConfigStore.getState().setPoolAddress(localAnvil.id, "0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE");
    await connect(config, { connector: config.connectors[0] });
  });

  // Regression test for: `isInitialized` was `Boolean(initialized)`, so a read that failed (or
  // had not resolved) collapsed to false and the page announced "Pool is not initialized yet."
  // even for a pool that was demonstrably initialized on-chain -- pointing at the contract when
  // the real fault was the RPC endpoint.
  test("reports the read failure instead of claiming the pool is not initialized", async () => {
    render(<SwapPage />, { wrapper: Providers });

    await screen.findByText("Couldn't read the pool", undefined, { timeout: 15_000 });
    expect(screen.queryByText("Pool is not initialized yet.")).toBeNull();
  });
});
