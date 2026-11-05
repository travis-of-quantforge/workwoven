import { expect, it } from "vitest";
import { milestoneOrder, verifiedCapture } from "../src/lib/paypal";
const seller = "ABCDEFGHIJKLM";
const reference = "11111111-1111-4111-8111-111111111111";
it("creates the accepted amount for the verified seller without a platform fee", () => {
  const order = milestoneOrder(12345n, seller, reference);
  expect(order.purchase_units[0]).toMatchObject({
    reference_id: reference,
    amount: { currency_code: "USD", value: "123.45" },
    payee: { merchant_id: seller },
  });
  expect(order.purchase_units[0]).not.toHaveProperty("payment_instruction");
});
it("requires completed capture for the exact order, payee, amount and currency", () => {
  const capture = {
    id: "CAPTURE",
    status: "COMPLETED",
    amount: { value: "123.45", currency_code: "USD" },
    payee: { merchant_id: seller },
    supplementary_data: { related_ids: { order_id: "ORDER" } },
  };
  expect(verifiedCapture(capture, "ORDER", 12345n, seller)).toBe(true);
  expect(
    verifiedCapture(
      { ...capture, seller_receivable_breakdown: { platform_fees: [] } },
      "ORDER",
      12345n,
      seller,
    ),
  ).toBe(true);
  for (const change of [
    { status: "PENDING" },
    { amount: { value: "123.46", currency_code: "USD" } },
    { amount: { value: "123.45", currency_code: "EUR" } },
    { payee: { merchant_id: "OTHER" } },
    { supplementary_data: { related_ids: { order_id: "OTHER" } } },
    {
      seller_receivable_breakdown: {
        platform_fees: [{ amount: { currency_code: "USD", value: "1.23" } }],
      },
    },
    { seller_receivable_breakdown: { platform_fees: null } },
  ])
    expect(
      verifiedCapture({ ...capture, ...change }, "ORDER", 12345n, seller),
    ).toBe(false);
});
