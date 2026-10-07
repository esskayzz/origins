import { ConfigProvider, theme as antdTheme, Typography } from "antd";
import { ConnectWallet } from "../components/common/ConnectWallet";
import { HypersphereBlob } from "../components/common/HypersphereBlob";
import { SwapPage } from "./SwapPage";

/** Pre-connect landing page: dark theme, swap UI on the left, an animated 3D distorted sphere
 * (see src/webgl/blobShaders.ts) on the right. Scoped to its own dark `ConfigProvider` so the
 * connected dashboard (docs/DESIGN.md's Ant Design Pro light theme) is unaffected. */
export function LandingPage() {
  return (
    <ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm, token: { colorPrimary: "#1890ff" } }}>
      <div className="landing-page">
        <header className="landing-header">
          <Typography.Title level={3} className="landing-logo">
            Hypersphere
          </Typography.Title>
          <ConnectWallet />
        </header>

        <div className="landing-body">
          <div className="landing-swap">
            <Typography.Paragraph type="secondary" className="landing-tagline">
              N-token concentrated liquidity. Connect a wallet to swap or provide liquidity.
            </Typography.Paragraph>
            <SwapPage />
          </div>
          <div className="landing-sphere">
            <HypersphereBlob />
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}
