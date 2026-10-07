import { useAccount } from "wagmi";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Layout, Menu } from "antd";
import { FundOutlined, SwapOutlined } from "@ant-design/icons";
import { ConnectWallet } from "./components/common/ConnectWallet";
import { PoolAddressSettings } from "./components/common/PoolAddressSettings";
import { LandingPage } from "./pages/LandingPage";
import { SwapPage } from "./pages/SwapPage";
import { LiquidityPage } from "./pages/LiquidityPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import "./styles/App.css";

const { Header, Sider, Content } = Layout;

export default function App() {
  const { isConnected } = useAccount();
  const location = useLocation();

  if (!isConnected) {
    return <LandingPage />;
  }

  return (
    <Layout className="app-layout">
      <Sider breakpoint="lg" collapsedWidth="0">
        <div className="logo">Hypersphere</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={[
            { key: "/swap", icon: <SwapOutlined />, label: <NavLink to="/swap">Swap</NavLink> },
            {
              key: "/liquidity",
              icon: <FundOutlined />,
              label: <NavLink to="/liquidity">Provide liquidity</NavLink>,
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <PoolAddressSettings />
          <ConnectWallet />
        </Header>
        <Content className="app-content">
          <Routes>
            <Route path="/" element={<Navigate to="/swap" replace />} />
            <Route path="/swap" element={<SwapPage />} />
            <Route path="/liquidity" element={<LiquidityPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
