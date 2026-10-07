import { afterEach, describe, expect, test, vi } from "vitest";
import { chainAssets, wagmiConfig } from "../../src/services/wagmiConfig";

// Regression test for: `wagmiConfig.connectors` was emptied out (relying solely on async
// EIP-6963 auto-discovery) which silently broke the connect flow, because
// `@ant-design/web3-wagmi`'s `MetaMask()` wallet factory looks up a connector literally named
// "MetaMask" in `config.connectors` and does not create one itself.
describe("wagmiConfig", () => {
  test("registers a connector named 'MetaMask'", () => {
    const names = wagmiConfig.connectors.map((c) => c.name);
    expect(names).toContain("MetaMask");
  });
});

// Regression test for: adding/using a chain in `wagmiConfig.chains` without a matching
// `chainAssets` entry made the Ant Design Web3 adapter log "Can not find chain <id>" and fail to
// render a chain switcher for it.
describe("chainAssets", () => {
  test("has a display-metadata entry for every configured chain", () => {
    for (const chain of wagmiConfig.chains) {
      const asset = chainAssets.find((a) => a.id === chain.id);
      expect(asset, `missing chainAssets entry for chain id ${chain.id}`).toBeDefined();
      expect(asset?.name).toBe(chain.name);
    }
  });
});

// Regression test for: the free NOWNodes tier rate-limits per second, and the pool pages fire
// ~20 reads on mount. Unbatched, several came back HTTP 429 and the UI showed "Couldn't read the
// pool / HTTP request failed." Batching sends the whole burst as one JSON-RPC array.
describe("testnetTransport", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("folds concurrent requests into a single JSON-RPC batch POST", async () => {
    // viem builds a `new Request(url)` before calling fetch; in the browser the default relative
    // `/api/rpc` resolves against the page origin, but Node's Request needs an absolute URL.
    vi.stubEnv("VITE_TESTNET_RPC_URL", "https://sepolia.example-provider.io/v2/abc");
    vi.resetModules();
    const { testnetTransport: freshTestnetTransport } = await import("../../src/services/wagmiConfig");
    const { sepoliaTestnet: freshSepolia } = await import("../../src/constants/chains");

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string }[];
      const results = calls.map((c) => ({
        jsonrpc: "2.0",
        id: c.id,
        result: c.method === "eth_chainId" ? "0xaa36a7" : "0x1",
      }));
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const transport = freshTestnetTransport({ fetchFn: fetchMock as typeof fetch })({
      chain: freshSepolia,
      retryCount: 0,
    });
    const [chainId, block] = await Promise.all([
      transport.request({ method: "eth_chainId" }),
      transport.request({ method: "eth_blockNumber" }),
    ]);

    expect(chainId).toBe("0xaa36a7");
    expect(block).toBe("0x1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://sepolia.example-provider.io/v2/abc");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((c: { method: string }) => c.method).sort()).toEqual(["eth_blockNumber", "eth_chainId"]);
  });
});
