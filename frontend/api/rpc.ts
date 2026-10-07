// Vercel function (Node.js runtime, Web-standard signature): POST /api/rpc -> upstream Sepolia
// node. Set `NOWNODES_API_KEY` (no VITE_ prefix -- it must stay server-side) in the Vercel
// project's environment variables; without it the proxy falls back to a public endpoint.
// Imported with a `.js` specifier on purpose: Vercel compiles each TypeScript file to `.js`
// but copies import paths through verbatim, so a `.ts` specifier here pointed at a file that
// does not exist in the deployed bundle (ERR_MODULE_NOT_FOUND at load -> every request 500 /
// FUNCTION_INVOCATION_FAILED). TypeScript's nodenext resolution maps `.js` back to the `.ts`
// source for type-checking, and Vite/Vitest do the same.
import { handleRpc, resolveUpstream } from "../server/rpcProxy.js";

const upstream = resolveUpstream(process.env);

export function POST(request: Request): Promise<Response> {
  return handleRpc(request, upstream);
}
