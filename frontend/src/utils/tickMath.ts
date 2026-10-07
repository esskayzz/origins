/** UI-only tick helpers (JS floating point is fine here; all on-chain math stays in Solidity). */

const LN_1_0001 = Math.log(1.0001);

export function priceWadToTick(priceWad: bigint): number {
  const price = Number(priceWad) / 1e18;
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.log(price) / LN_1_0001;
}

export function nearestValidTick(rawTick: number, spacing: number): number {
  if (spacing <= 0) return Math.round(rawTick);
  return Math.round(rawTick / spacing) * spacing;
}

export function tickRangeAround(priceWad: bigint, spacing: number, widthInTicks: number): [number, number] {
  const center = nearestValidTick(priceWadToTick(priceWad), spacing);
  const width = Math.max(spacing, nearestValidTick(widthInTicks, spacing));
  return [center - width, center + width];
}
