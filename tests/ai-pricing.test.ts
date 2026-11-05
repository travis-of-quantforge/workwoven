import { it, expect } from "vitest";
import {
  providerCost,
  reservationBudget,
  formatNano,
  type Price,
} from "../src/lib/ai/pricing";
import { parseUsd } from "../src/lib/domain";
const price: Price = {
  id: "fixture",
  model: "fixture",
  input_nano_per_token: 250,
  cached_nano_per_token: 25,
  output_nano_per_token: 2000,
  markup: 2,
};
it("charges cached inputs once at their documented discounted rate", () =>
  expect(providerCost(price, 100, 80, 50)).toBe(107000n));
it("preserves nanodollars in small usage displays", () => {
  expect(formatNano(34)).toBe("$0.000000034");
  expect(formatNano("5000000000")).toBe("$5.00");
});
it("bounds both model turns including output/reasoning tokens", () => {
  expect(reservationBudget(price)).toBeGreaterThan(
    providerCost(price, 64000, 0, 4096) * 2n,
  );
  expect(reservationBudget(price)).toBeLessThan(100000000n);
});
it("rejects impossible or imprecise usage", () => {
  expect(() => providerCost(price, 5, 6, 1)).toThrow();
  expect(() => providerCost(price, 5, 0, 0.5)).toThrow();
  expect(() => providerCost(price, -1, 0, 1)).toThrow();
});
it("parses human USD input without floating-point rounding", () => {
  expect(parseUsd("19.99")).toBe(1999);
  expect(parseUsd("0.01")).toBe(1);
  expect(() => parseUsd("1.001")).toThrow();
  expect(() => parseUsd("1e6")).toThrow();
  expect(() => parseUsd("-1")).toThrow();
});

it("rejects cache write billing and requires confirmed zero cache usage for cache-disabled pricing", async () => {
  const { validateCacheUsage } = await import("../src/lib/ai/pricing");
  const base = {
    id: "fixture",
    model: "gpt-6-luna",
    input_nano_per_token: 100,
    cached_nano_per_token: 10,
    output_nano_per_token: 500,
    markup: 2,
    cache_mode: "disabled" as const,
  };
  expect(() =>
    validateCacheUsage(base, { cached_tokens: 0, cache_write_tokens: 0 }),
  ).not.toThrow();
  expect(() => validateCacheUsage(base, { cached_tokens: 0 })).toThrow();
  expect(() =>
    validateCacheUsage(base, { cached_tokens: 0, cache_write_tokens: 1 }),
  ).toThrow();
  expect(() =>
    validateCacheUsage(base, { cached_tokens: 1, cache_write_tokens: 0 }),
  ).toThrow();
});
