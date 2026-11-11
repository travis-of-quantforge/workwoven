import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fake = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({
  adminDatabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: fake.single }) }) }),
    rpc: fake.rpc,
  }),
}));
import {
  cancelPayPalPayment,
  checkoutLink,
  reconcilePayment,
} from "../src/lib/paypal-service";
import { SandboxPayPal, checkoutAppUrl } from "../src/lib/paypal-api";
const payment = {
  id: "payment",
  request_id: "request",
  engagement_id: "engagement",
  payer_id: "client",
  merchant_id: "ABCDEFGHIJKLM",
  amount_cents: 500,
  order_id: "ORDER123",
  status: "approval_pending",
  capture_id: null,
  created_at: new Date().toISOString(),
};
function order(status = "APPROVED", capture?: string) {
  return {
    id: payment.order_id,
    intent: "CAPTURE",
    status,
    purchase_units: [
      {
        reference_id: payment.id,
        custom_id: payment.request_id,
        payee: { merchant_id: payment.merchant_id },
        amount: { currency_code: "USD", value: "5.00" },
        payments: capture
          ? {
              captures: [
                {
                  id: "CAPTURE123",
                  status: capture,
                  amount: { currency_code: "USD", value: "5.00" },
                },
              ],
            }
          : {},
      },
    ],
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
  fake.single.mockReset();
  fake.rpc.mockReset();
  for (const [key, value] of Object.entries({
    PAYPAL_ENVIRONMENT: "sandbox",
    SANDBOX_PAYPAL_PARTNER_CLIENT_ID: "test",
    SANDBOX_PAYPAL_PARTNER_CLIENT_SECRET: "test",
    SANDBOX_PAYPAL_PARTNER_MERCHANT_ID: "ABCDEFGHIJKLM",
    SANDBOX_PAYPAL_PARTNER_ATTRIBUTION_ID: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  }))
    vi.stubEnv(key, value);
  fake.single.mockResolvedValue({ data: { ...payment }, error: null });
  fake.rpc.mockResolvedValue({ error: null });
});
it("checks the provider without capture, then cancels the exact checkout for its client", async () => {
  const request = vi
    .spyOn(SandboxPayPal.prototype, "request")
    .mockResolvedValue(order());
  await cancelPayPalPayment(payment.id, "client");
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "/v2/checkout/orders/ORDER123",
    { seller: payment.merchant_id },
  );
  expect(fake.rpc).toHaveBeenLastCalledWith("cancel_paypal_checkout", {
    p: payment.id,
    actor: "client",
    provider_order: payment.order_id,
  });
});
it.each(["COMPLETED", "PENDING"])(
  "reconciles %s captures without cancelling or releasing their balance",
  async (status) => {
    vi.spyOn(SandboxPayPal.prototype, "request").mockResolvedValue(
      order("COMPLETED", status),
    );
    await expect(cancelPayPalPayment(payment.id, "client")).rejects.toThrow(
      "cannot be cancelled",
    );
    expect(
      fake.rpc.mock.calls.some(([name]) => name === "cancel_paypal_checkout"),
    ).toBe(false);
  },
);
it("blocks unknown status, mismatched provider details and provider failures", async () => {
  const request = vi.spyOn(SandboxPayPal.prototype, "request");
  for (const response of [order("UNKNOWN"), { ...order(), id: "WRONG" }]) {
    request.mockResolvedValue(response);
    await expect(cancelPayPalPayment(payment.id, "client")).rejects.toThrow();
  }
  request.mockRejectedValue(new Error("Provider unavailable"));
  await expect(cancelPayPalPayment(payment.id, "client")).rejects.toThrow(
    "Provider unavailable",
  );
  expect(
    fake.rpc.mock.calls.some(([name]) => name === "cancel_paypal_checkout"),
  ).toBe(false);
});
it("rejects other parties and in-flight captures before contacting PayPal", async () => {
  const request = vi.spyOn(SandboxPayPal.prototype, "request");
  await expect(cancelPayPalPayment(payment.id, "professional")).rejects.toThrow(
    "paying client",
  );
  fake.single.mockResolvedValue({
    data: { ...payment, status: "processing" },
    error: null,
  });
  await expect(cancelPayPalPayment(payment.id, "client")).rejects.toThrow(
    "uncaptured checkout",
  );
  expect(request).not.toHaveBeenCalled();
});
it("keeps checkout returns on the authenticated loopback host and rejects external origins", () => {
  expect(checkoutAppUrl("http://localhost:3000", "http://127.0.0.1:3000")).toBe(
    "http://127.0.0.1:3000",
  );
  for (const origin of [
    "https://evil.example",
    "http://127.0.0.1:3001",
    "https://localhost:3000",
  ])
    expect(() => checkoutAppUrl("http://localhost:3000", origin)).toThrow();
});
it("resumes an approved order through local completion instead of looking for a missing approval link", async () => {
  vi.spyOn(SandboxPayPal.prototype, "request").mockResolvedValue(order());
  expect(await checkoutLink(payment.id, "http://127.0.0.1:3000")).toBe(
    "http://127.0.0.1:3000/workspace/engagement?tab=payments&checkout=payment",
  );
});
it("captures approved orders only after authorization and verifies the final receipt", async () => {
  const authorize = vi.fn().mockResolvedValue(undefined);
  const request = vi
    .spyOn(SandboxPayPal.prototype, "request")
    .mockResolvedValueOnce(order())
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(order("COMPLETED", "COMPLETED"));
  expect((await reconcilePayment(payment.id, true, authorize)).completed).toBe(
    true,
  );
  expect(authorize).toHaveBeenCalledOnce();
  expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
    request.mock.invocationCallOrder[1],
  );
  expect(request).toHaveBeenNthCalledWith(
    2,
    "/v2/checkout/orders/ORDER123/capture",
    {
      method: "POST",
      body: {},
      seller: payment.merchant_id,
      key: `capture-${payment.id}`,
    },
  );
  expect(fake.rpc).toHaveBeenCalledWith(
    "record_paypal_payment",
    expect.objectContaining({
      state: "completed",
      provider_capture: "CAPTURE123",
    }),
  );
});
it("does not capture unapproved, cancelled or already captured orders", async () => {
  const authorize = vi
    .fn()
    .mockRejectedValue(new Error("Payment request is no longer payable"));
  const request = vi
    .spyOn(SandboxPayPal.prototype, "request")
    .mockResolvedValue(order("CREATED"));
  await expect(reconcilePayment(payment.id, true, authorize)).rejects.toThrow(
    "Approve this payment",
  );
  expect(authorize).not.toHaveBeenCalled();
  request.mockResolvedValue(order());
  await expect(reconcilePayment(payment.id, true, authorize)).rejects.toThrow(
    "no longer payable",
  );
  request.mockResolvedValue(order("COMPLETED", "COMPLETED"));
  expect((await reconcilePayment(payment.id, true, authorize)).completed).toBe(
    true,
  );
  expect(
    request.mock.calls.every(([, options]) => options?.method !== "POST"),
  ).toBe(true);
});
