import { ConnectButton, Connector } from "@ant-design/web3";
import { message } from "antd";
import { getConnectErrorMessage } from "../../utils/connectErrors";

// `Connector` reads account/connect/disconnect/chain-switch state from the
// `Web3ConfigProvider` context (populated by `WagmiWeb3ConfigProvider` in main.tsx) and injects
// it into its child -- a bare `<ConnectButton />` has no `onConnectClick` handler at all and
// silently does nothing when clicked.
export function ConnectWallet() {
  return (
    <Connector onConnectError={(error?: Error) => message.error(getConnectErrorMessage(error))}>
      <ConnectButton tooltip actionsMenu />
    </Connector>
  );
}
