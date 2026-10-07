import { describe, expect, test } from "vitest";
import { getConnectErrorMessage, RESOURCE_UNAVAILABLE_CODE } from "../../src/utils/connectErrors";

// Regression test for: clicking "Connect Wallet" while MetaMask had a prior
// `wallet_requestPermissions` request still pending showed a raw, unhelpful
// JSON-RPC error instead of actionable guidance.
describe("getConnectErrorMessage", () => {
  test("maps MetaMask's 'resource unavailable' (-32002) error to an actionable message", () => {
    const error = Object.assign(new Error("Already processing eth_requestAccounts."), {
      code: RESOURCE_UNAVAILABLE_CODE,
    });

    const message = getConnectErrorMessage(error);

    expect(message).toMatch(/already open/i);
    expect(message).toMatch(/MetaMask/);
  });

  test("falls back to the error's own message for other errors", () => {
    const error = new Error("User rejected the request.");
    expect(getConnectErrorMessage(error)).toBe("User rejected the request.");
  });

  test("falls back to a generic message when there is no error", () => {
    expect(getConnectErrorMessage(undefined)).toBe("Failed to connect wallet.");
  });
});
