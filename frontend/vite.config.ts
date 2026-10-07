import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { handleRpc, resolveUpstream } from "./server/rpcProxy.ts";

/** Serves POST /api/rpc from the dev and preview servers with the exact handler Vercel runs in
 * production (api/rpc.ts), so the NOWNodes key stays server-side locally too. */
function rpcProxyPlugin(env: Record<string, string | undefined>): Plugin {
  const upstream = resolveUpstream(env);

  const middleware = async (req: IncomingMessage, res: ServerResponse) => {
    // Nothing may escape this function: a rejected promise in a connect middleware is an
    // uncaught exception that terminates the whole Vite process.
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request("http://localhost/api/rpc", {
        method: req.method,
        headers,
        body: hasBody ? new Uint8Array(Buffer.concat(chunks)) : undefined,
      });

      const response = await handleRpc(request, upstream);
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error("[rpc-proxy]", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Proxy error" } }));
    }
  };

  return {
    name: "hypersphere:rpc-proxy",
    configureServer: (server) => void server.middlewares.use("/api/rpc", middleware),
    configurePreviewServer: (server) => void server.middlewares.use("/api/rpc", middleware),
  };
}

/** Server-side env for the proxy. Empty prefix so non-`VITE_` vars (NOWNODES_API_KEY) are picked
 * up, and the repo root is read as well as `frontend/`: the root `.env` is where `foundry.toml`
 * already reads the same key from, so it stays the single place to put it. Frontend values win. */
function serverEnv(mode: string): Record<string, string | undefined> {
  const frontendDir = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  return { ...loadEnv(mode, repoRoot, ""), ...loadEnv(mode, frontendDir, "") };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), rpcProxyPlugin(serverEnv(mode))],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
}));
