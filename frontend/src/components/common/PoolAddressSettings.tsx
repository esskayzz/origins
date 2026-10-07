import { useState } from "react";
import { isAddress } from "viem";
import { Input, Tooltip } from "antd";
import { usePoolAddress } from "../../hooks/usePoolAddress";

/** Lets the user view/override the NDimPool address for the currently connected chain,
 * persisted in localStorage -- so switching from local to testnet (or pointing at a
 * freshly-deployed pool) doesn't require rebuilding the app. */
export function PoolAddressSettings() {
  const { poolAddress, setPoolAddress } = usePoolAddress();
  const [draft, setDraft] = useState(poolAddress ?? "");
  const valid = draft === "" || isAddress(draft);

  return (
    <Tooltip title={!poolAddress ? "No pool configured for this network yet" : undefined}>
      <Input.Search
        className="pool-address-settings"
        placeholder="Pool address 0x..."
        value={draft}
        status={valid ? undefined : "error"}
        enterButton="Save"
        onChange={(e) => setDraft(e.target.value.trim())}
        onSearch={() => valid && setPoolAddress(draft as `0x${string}` | "")}
        style={{ width: 360 }}
      />
    </Tooltip>
  );
}
