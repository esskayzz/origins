import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import { MetaMask, WagmiWeb3ConfigProvider } from "@ant-design/web3-wagmi";
import "./styles/index.css";
import App from "./App.tsx";
import { chainAssets, wagmiConfig } from "./services/wagmiConfig";

const queryClient = new QueryClient();

// Ant Design Pro's signature blue (per the Ant Design Pro 4.0 reference UI kit).
const theme = {
  token: {
    colorPrimary: "#1890ff",
    borderRadius: 6,
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider theme={theme}>
      <WagmiWeb3ConfigProvider
        config={wagmiConfig}
        queryClient={queryClient}
        wallets={[MetaMask()]}
        chains={chainAssets}
        eip6963={{ autoAddInjectedWallets: true }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </WagmiWeb3ConfigProvider>
    </ConfigProvider>
  </StrictMode>,
);
