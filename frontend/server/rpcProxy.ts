// Same-origin JSON-RPC proxy for the Sepolia transport. Runs in two places with identical
// behaviour: as a Vercel function (api/rpc.ts) in production and as a Vite dev/preview-server
// middleware (vite.config.ts) locally. The upstream API key lives only in server-side env, so
// it never reaches the browser bundle.

export const NOWNODES_SEPOLIA_URL = "https://eth-sepolia.nownodes.io";
export const PUBLIC_SEPOLIA_URL = "https://ethereum-sepolia-rpc.publicnode.com";

export interface Upstream {
  url: string;
  headers: Record<string, string>;
}

/** Picks the upstream node from server-side env: `RPC_UPSTREAM_URL` if set, else NOWNodes when a
 * `NOWNODES_API_KEY` is configured (https://docs.nownodes.io/nodeapis/ -- key goes in an
 * `api-key` header), else a keyless public endpoint so a fresh clone works with no setup. */
export function resolveUpstream(env: Record<string, string | undefined>): Upstream {
  const key = env.NOWNODES_API_KEY?.trim() || undefined;
  const url = env.RPC_UPSTREAM_URL?.trim() || (key ? NOWNODES_SEPOLIA_URL : PUBLIC_SEPOLIA_URL);
  // Only ever send the key to a NOWNodes host, even if the upstream was overridden.
  const headers: Record<string, string> = {};
  if (key && new URL(url).hostname.endsWith("nownodes.io")) headers["api-key"] = key;
  return { url, headers };
}

/** Read-only methods the frontend needs (wagmi/viem reads, simulations, receipt polling) plus
 * raw-tx relay. Anything stateful or node-admin (eth_sendTransaction, eth_accounts, personal_*,
 * debug_*, ...) is refused so the proxy can't be used as a general node. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_sendRawTransaction",
]);

const MAX_BODY_BYTES = 1_000_000;

interface RpcCall {
  method?: unknown;
  id?: unknown;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const rpcError = (status: number, code: number, message: string, id: unknown = null) =>
  jsonResponse(status, { jsonrpc: "2.0", id, error: { code, message } });

export async function handleRpc(
  request: Request,
  upstream: Upstream,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return rpcError(413, -32600, "Request too large");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return rpcError(400, -32700, "Parse error");
  }

  const calls = (Array.isArray(body) ? body : [body]) as RpcCall[];
  if (
    calls.length === 0 ||
    calls.some((c) => typeof c !== "object" || c === null || typeof c.method !== "string")
  ) {
    return rpcError(400, -32600, "Invalid Request");
  }
  const refused = calls.find((c) => !ALLOWED_METHODS.has(c.method as string));
  if (refused) return rpcError(403, -32601, `Method not allowed: ${refused.method as string}`, refused.id);

  // An unreachable upstream must surface as a JSON-RPC error, never as a thrown rejection: in
  // the Vite middleware an escaped rejection is an uncaught exception that kills the dev server.
  let res: Response;
  try {
    res = await fetchFn(upstream.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...upstream.headers },
      body: text,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return rpcError(
      502,
      -32603,
      `Upstream RPC unreachable: ${reason}`,
      calls.length === 1 ? calls[0].id : null,
    );
  }

  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
