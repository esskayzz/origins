import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ConnectWallet } from "../../src/components/common/ConnectWallet";

// Regression test for: `ConnectWallet` rendered a bare `<ConnectButton />` with no
// `onConnectClick` handler (that prop is only injected by `Connector`, which reads it from
// `Web3ConfigProvider` context) -- clicking "Connect Wallet" silently did nothing.
vi.mock("@ant-design/web3", () => ({
  Connector: (props: { children: ReactNode; onConnectError?: (error?: Error) => void }) => (
    <div data-testid="connector" data-has-connect-error-handler={typeof props.onConnectError === "function"}>
      {props.children}
    </div>
  ),
  ConnectButton: () => <button data-testid="connect-button">Connect Wallet</button>,
}));

describe("ConnectWallet", () => {
  test("wraps ConnectButton in Connector so account/connect wiring is supplied by context", () => {
    render(<ConnectWallet />);

    const connector = screen.getByTestId("connector");
    expect(connector).toBeInTheDocument();
    expect(connector.dataset.hasConnectErrorHandler).toBe("true");
    expect(screen.getByTestId("connect-button")).toBeInTheDocument();
  });
});
