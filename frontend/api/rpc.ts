// Vercel function (Node.js runtime, Web-standard signature): POST /api/rpc -> upstream Sepolia
// node. Set `NOWNODES_API_KEY` (no VITE_ prefix -- it must stay server-side) in the Vercel
// project's environment variables; without it the proxy falls back to a public endpoint.
import { handleRpc, resolveUpstream } from "../server/rpcProxy.ts";

const upstream = resolveUpstream(process.env);

export function POST(request: Request): Promise<Response> {
  return handleRpc(request, upstream);
}
