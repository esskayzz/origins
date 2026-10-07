import { describe, expect, test } from "vitest";
import { chainAssets, wagmiConfig } from "../../src/services/wagmiConfig";

// Regression test for: `wagmiConfig.connectors` was emptied out (relying solely on async
// EIP-6963 auto-discovery) which silently broke the connect flow, because
// `@ant-design/web3-wagmi`'s `MetaMask()` wallet factory looks up a connector literally named
// "MetaMask" in `config.connectors` and does not create one itself.
describe("wagmiConfig", () => {
  test("registers a connector named 'MetaMask'", () => {
    const names = wagmiConfig.connectors.map((c) => c.name);
    expect(names).toContain("MetaMask");
  });
});

// Regression test for: adding/using a chain in `wagmiConfig.chains` without a matching
// `chainAssets` entry made the Ant Design Web3 adapter log "Can not find chain <id>" and fail to
// render a chain switcher for it.
describe("chainAssets", () => {
  test("has a display-metadata entry for every configured chain", () => {
    for (const chain of wagmiConfig.chains) {
      const asset = chainAssets.find((a) => a.id === chain.id);
      expect(asset, `missing chainAssets entry for chain id ${chain.id}`).toBeDefined();
      expect(asset?.name).toBe(chain.name);
    }
  });
});
