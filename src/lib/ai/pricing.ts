export type Price = {
  id: string;
  model: string;
  input_nano_per_token: number;
  cached_nano_per_token: number;
  output_nano_per_token: number;
  markup: number;
  cache_mode?: "implicit" | "disabled";
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

// At the launch exchange rate, one token is $0.10 = 100 million USD nanodollars.
export const TOKEN_ATOMS = 100000000n;
export function formatTokens(value: string | number | bigint) {
  const atoms = BigInt(value);
  const sign = atoms < 0n ? "-" : "";
  const amount = atoms < 0n ? -atoms : atoms;
  const fraction = (amount % TOKEN_ATOMS)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${sign}${amount / TOKEN_ATOMS}${fraction ? "." + fraction : ""} tokens`;
}

export function parseTokens(value: FormDataEntryValue | null) {
  const input = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,8})?$/.test(input))
    throw new Error("Enter a valid token amount.");
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * TOKEN_ATOMS + BigInt(fraction.padEnd(8, "0") || "0");
}

export function validateCacheUsage(
  price: Price,
  details: { cached_tokens?: number; cache_write_tokens?: number },
) {
  if (
    price.cache_mode === "disabled" &&
    (details.cached_tokens !== 0 || details.cache_write_tokens !== 0)
  )
    throw new Error("Unexpected or unconfirmed cache billing");
  if ((details.cache_write_tokens || 0) !== 0)
    throw new Error("Cache writes are not enabled by this pricing version");
}
