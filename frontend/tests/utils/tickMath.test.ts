import { describe, expect, test } from "vitest";
import { nearestValidTick, priceWadToTick, tickRangeAround } from "../../src/utils/tickMath";

describe("nearestValidTick", () => {
  test("rounds to the nearest multiple of the spacing", () => {
    expect(nearestValidTick(59, 60)).toBe(60);
    expect(nearestValidTick(-59, 60)).toBe(-60);
    expect(nearestValidTick(0, 60)).toBe(0);
  });
});

describe("priceWadToTick", () => {
  test("price = 1 (1e18 WAD) maps to tick 0", () => {
    expect(priceWadToTick(10n ** 18n)).toBeCloseTo(0, 5);
  });

  test("price = 1.0001 maps close to tick 1", () => {
    expect(priceWadToTick(1_000_100_000_000_000_000n)).toBeCloseTo(1, 1);
  });
});

describe("tickRangeAround", () => {
  test("produces a symmetric, spacing-aligned range around the current price", () => {
    const [lower, upper] = tickRangeAround(10n ** 18n, 60, 6000);
    expect(lower).toBe(-6000);
    expect(upper).toBe(6000);
    expect(Math.abs(lower % 60)).toBe(0);
    expect(Math.abs(upper % 60)).toBe(0);
  });
});
