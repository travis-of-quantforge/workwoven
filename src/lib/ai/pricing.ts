export type Price = {
  id: string;
  model: string;
  input_nano_per_token: number;
  cached_nano_per_token: number;
  output_nano_per_token: number;
  markup: number;
};
export const INPUT_BYTE_LIMIT = 64000;
export const SEARCH_OUTPUT_TOKENS = 512;
export const ANSWER_OUTPUT_TOKENS = 4096;
function quantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid metered quantity");
  return BigInt(value);
}
export function providerCost(
  price: Price,
  input: number,
  cached: number,
  output: number,
) {
  if (cached > input) throw new Error("Invalid cached input quantity");
  return (
    quantity(input - cached) * quantity(price.input_nano_per_token) +
    quantity(cached) * quantity(price.cached_nano_per_token) +
    quantity(output) * quantity(price.output_nano_per_token)
  );
}
export function reservationBudget(price: Price) {
  if (price.markup !== 2) throw new Error("Unsupported pricing policy");
  return (
    (quantity(INPUT_BYTE_LIMIT + 4096) *
      2n *
      quantity(price.input_nano_per_token) +
      quantity(SEARCH_OUTPUT_TOKENS + ANSWER_OUTPUT_TOKENS) *
        quantity(price.output_nano_per_token)) *
    2n
  );
}
export function formatNano(value: string | number | bigint) {
  const nano = BigInt(value);
  const sign = nano < 0n ? "-" : "";
  const n = nano < 0n ? -nano : nano;
  const fraction = (n % 1000000000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${sign}$${n / 1000000000n}.${fraction}`;
}
