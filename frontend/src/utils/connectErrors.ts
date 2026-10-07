// MetaMask's JSON-RPC "Resource unavailable" code: a wallet_requestPermissions call is already
// pending (e.g. a previous connect attempt's popup was left open/dismissed without resolving).
export const RESOURCE_UNAVAILABLE_CODE = -32002;

/** Maps a wallet connect error to a user-facing message. Regression coverage for the
 * "Request of type 'wallet_requestPermissions' already pending" MetaMask error, which otherwise
 * surfaces as an unhelpful raw JSON-RPC message. */
export function getConnectErrorMessage(error?: Error): string {
  const code = (error as (Error & { code?: number }) | undefined)?.code;
  if (code === RESOURCE_UNAVAILABLE_CODE) {
    return "A MetaMask connection request is already open -- click the MetaMask icon in your browser toolbar to approve or dismiss it, then try again.";
  }
  return error?.message ?? "Failed to connect wallet.";
}
