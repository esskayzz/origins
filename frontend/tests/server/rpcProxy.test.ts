import { describe, expect, test, vi } from "vitest";
import { NOWNODES_SEPOLIA_URL, PUBLIC_SEPOLIA_URL, handleRpc, resolveUpstream } from "../../server/rpcProxy";

describe("resolveUpstream", () => {
  test("falls back to the keyless public endpoint with no key configured", () => {
    expect(resolveUpstream({})).toEqual({ url: PUBLIC_SEPOLIA_URL, headers: {} });
    expect(resolveUpstream({ NOWNODES_API_KEY: "  " })).toEqual({ url: PUBLIC_SEPOLIA_URL, headers: {} });
  });

  test("uses NOWNodes with the key in an `api-key` header when a key is set", () => {
    expect(resolveUpstream({ NOWNODES_API_KEY: "k-123" })).toEqual({
      url: NOWNODES_SEPOLIA_URL,
      headers: { "api-key": "k-123" },
    });
  });

  test("never sends the NOWNodes key to a non-NOWNodes override", () => {
    const upstream = resolveUpstream({
      NOWNODES_API_KEY: "k-123",
      RPC_UPSTREAM_URL: "https://sepolia.example-provider.io/v2/abc",
    });
    expect(upstream).toEqual({ url: "https://sepolia.example-provider.io/v2/abc", headers: {} });
  });
});

describe("handleRpc", () => {
  const upstream = { url: NOWNODES_SEPOLIA_URL, headers: { "api-key": "k-123" } };
  const post = (body: unknown) =>
    new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const okUpstream = (result: unknown) =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result })));

  test("forwards an allowed call with the upstream headers and returns its body", async () => {
    const fetchFn = okUpstream("0xaa36a7");
    const res = await handleRpc(
      post({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      upstream,
      fetchFn,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(NOWNODES_SEPOLIA_URL);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("api-key")).toBe("k-123");
    expect(JSON.parse(init?.body as string).method).toBe("eth_chainId");
  });

  test("accepts JSON-RPC batches when every member is allowed", async () => {
    const fetchFn = okUpstream([]);
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_getTransactionReceipt", params: ["0x00"] },
    ];
    const res = await handleRpc(post(batch), upstream, fetchFn);
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("refuses disallowed methods without touching the upstream", async () => {
    for (const method of ["eth_sendTransaction", "eth_accounts", "personal_sign", "debug_traceCall"]) {
      const fetchFn = okUpstream(null);
      const res = await handleRpc(post({ jsonrpc: "2.0", id: 7, method, params: [] }), upstream, fetchFn);
      expect(res.status, method).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe(-32601);
      expect(body.id).toBe(7);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  test("rejects a batch if any member is disallowed", async () => {
    const fetchFn = okUpstream(null);
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_sendTransaction", params: [{}] },
    ];
    const res = await handleRpc(post(batch), upstream, fetchFn);
    expect(res.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("rejects non-POST, malformed JSON, and non-RPC bodies", async () => {
    const fetchFn = okUpstream(null);
    const get = await handleRpc(new Request("http://localhost/api/rpc"), upstream, fetchFn);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");

    const bad = await handleRpc(post("{not json"), upstream, fetchFn);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);

    const noMethod = await handleRpc(post({ jsonrpc: "2.0", id: 1 }), upstream, fetchFn);
    expect(noMethod.status).toBe(400);

    const empty = await handleRpc(post([]), upstream, fetchFn);
    expect(empty.status).toBe(400);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("turns an unreachable upstream into a 502 JSON-RPC error instead of throwing", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const res = await handleRpc(
      post({ jsonrpc: "2.0", id: 9, method: "eth_chainId", params: [] }),
      upstream,
      fetchFn,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.id).toBe(9);
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toMatch(/unreachable/i);
  });

  test("passes upstream error statuses through", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("Missing API_key", { status: 422 }));
    const res = await handleRpc(
      post({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      upstream,
      fetchFn,
    );
    expect(res.status).toBe(422);
  });
});
