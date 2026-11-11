import { expect, it, vi } from "vitest";
import {
  ledgerCsv,
  ledgerMovement,
  centsText,
  type LedgerEntry,
} from "../src/lib/payment-ledger";
import {
  SandboxPayPal,
  verifiedOrder,
  verifiedRefund,
  safePayPalLink,
} from "../src/lib/paypal-api";
const p = {
  id: "11000000-0000-4000-8000-000000000001",
  request_id: "11000000-0000-4000-8000-000000000002",
  order_id: "ORDER123",
  merchant_id: "ABCDEFGHIJKLM",
  amount_cents: 12345,
  engagement_id: "11000000-0000-4000-8000-000000000003",
};
const order = () => ({
  id: p.order_id,
  intent: "CAPTURE",
  status: "COMPLETED",
  purchase_units: [
    {
      reference_id: p.id,
      custom_id: p.request_id,
      payee: { merchant_id: p.merchant_id },
      amount: { currency_code: "USD", value: "123.45" },
      payments: {
        captures: [
          {
            id: "CAPTURE123",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "123.45" },
          },
        ],
      },
    },
  ],
});
it("verifies actual Orders responses and never treats approval alone as payment", () => {
  expect(verifiedOrder(order(), p).completed).toBe(true);
  const approved = order();
  approved.status = "APPROVED";
  approved.purchase_units[0].payments.captures = [];
  expect(verifiedOrder(approved, p)).toMatchObject({
    approved: true,
    completed: false,
    captureId: null,
  });
  for (const change of [
    () => {
      const o = order();
      o.purchase_units[0].payee.merchant_id = "OTHER";
      return o;
    },
    () => {
      const o = order();
      o.purchase_units[0].custom_id = "OTHER";
      return o;
    },
    () => {
      const o = order();
      o.purchase_units[0].amount.value = "123.46";
      return o;
    },
    () => {
      const o = order();
      o.purchase_units[0].payments.captures[0].amount.currency_code = "EUR";
      return o;
    },
  ])
    expect(() => verifiedOrder(change(), p)).toThrow();
  expect(() => verifiedOrder({ ...order(), id: "OTHER" }, p)).toThrow();
});
it("requires original-capture-linked refunds of the exact currency and amount", () => {
  const refund = {
    id: "REFUND123",
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "12.34" },
    links: [
      {
        rel: "up",
        href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE123",
      },
    ],
  };
  expect(verifiedRefund(refund, "CAPTURE123", 1234)).toMatchObject({
    cents: 1234,
    status: "completed",
  });
  expect(verifiedRefund({...refund,links:[{rel:"up",href:"https://api.sandbox.paypal.com/v2/payments/captures/CAPTURE123"}]},"CAPTURE123",1234).status).toBe("completed");
  for (const href of [
    "https://evil.example/v2/payments/captures/CAPTURE123",
    "https://api.paypal.com/v2/payments/captures/CAPTURE123",
    "http://api.sandbox.paypal.com/v2/payments/captures/CAPTURE123",
    "https://user:pass@api.sandbox.paypal.com/v2/payments/captures/CAPTURE123",
    "https://api.sandbox.paypal.com:444/v2/payments/captures/CAPTURE123",
    "https://api.sandbox.paypal.com/v2/payments/captures/OTHER",
  ]) expect(() => verifiedRefund({...refund,links:[{rel:"up",href}]},"CAPTURE123",1234)).toThrow();
  expect(() => verifiedRefund(refund, "OTHER", 1234)).toThrow();
  expect(() => verifiedRefund(refund, "CAPTURE123", 1235)).toThrow();
  expect(() =>
    verifiedRefund(
      { ...refund, amount: { currency_code: "EUR", value: "12.34" } },
      "CAPTURE123",
    ),
  ).toThrow();
  expect(
    verifiedRefund({ ...refund, status: "PENDING" }, "CAPTURE123").status,
  ).toBe("processing");
});
it("exports quotes/newlines/formulas safely and counts only completed monetary movements", () => {
  const entry: LedgerEntry = {
    id: 1,
    created_at: "2026-11-10T10:00:00Z",
    kind: "request_created",
    amount_cents: 1234,
    currency: "USD",
    description: '  =HYPERLINK("bad")\nCSV support',
    request_id: p.request_id,
    payment_id: p.id,
    refund_id: null,
    provider_reference: null,
    environment: "sandbox",
  };
  expect(ledgerMovement(entry)).toBe(0n);
  expect(ledgerMovement({ ...entry, kind: "payment_completed" })).toBe(1234n);
  expect(ledgerMovement({ ...entry, kind: "refund_completed" })).toBe(-1234n);
  const csv = ledgerCsv([entry, { ...entry, id: 2, kind: "refund_completed" }]);
  expect(csv).toContain('"\'  =HYPERLINK(""bad"")\nCSV support"');
  expect(csv).toContain('"-12.34"');
  expect(csv).not.toContain("'-12.34");
  expect(centsText(123456789123456n)).toBe("1234567891234.56");
});
it("uses only sandbox endpoints, stored amounts, seller assertions and persistent idempotency keys", async () => {
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "TEST_TOKEN" }))
    .mockResolvedValueOnce(Response.json(order()));
  const api = new SandboxPayPal(
    {
      clientId: "APP",
      secret: "TEST_SECRET",
      partnerId: "PARTNER123456",
      attributionId: "BN_TEST",
      appUrl: "http://localhost:3000",
    },
    mock,
  );
  await api.createOrder(p);
  const [url, options] = mock.mock.calls[1];
  expect(url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
  const headers = options!.headers as Record<string, string>;
  expect(headers["PayPal-Request-Id"]).toBe(p.id);
  expect(
    JSON.parse(
      Buffer.from(
        headers["PayPal-Auth-Assertion"].split(".")[1],
        "base64url",
      ).toString(),
    ),
  ).toEqual({ iss: "APP", payer_id: p.merchant_id });
  const body = JSON.parse(String(options!.body));
  expect(body.purchase_units[0].amount.value).toBe("123.45");
  expect(body.purchase_units[0]).not.toHaveProperty("payment_instruction");
  await expect(api.request("//evil.invalid")).rejects.toThrow();
  expect(() =>
    safePayPalLink(
      { links: [{ rel: "approve", href: "https://evil.invalid" }] },
      "approve",
    ),
  ).toThrow();
});
it("checks seller ownership, receivability, email confirmation and app-specific refund permission", async () => {
  const tracking = "11000000-0000-4000-8000-000000000099";
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "TOKEN" }))
    .mockResolvedValueOnce(Response.json({ merchant_id: p.merchant_id }))
    .mockResolvedValueOnce(
      Response.json({
        merchant_id: p.merchant_id,
        tracking_id: tracking,
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_integrations: [
          {
            oauth_third_party: [
              {
                partner_client_id: "OTHER",
                scopes: ["https://uri.paypal.com/services/payments/refund"],
              },
              {
                partner_client_id: "APP",
                scopes: [
                  "https://uri.paypal.com/services/payments/payment/authcapture",
                ],
              },
            ],
          },
        ],
      }),
    );
  const api = new SandboxPayPal(
    {
      clientId: "APP",
      secret: "TEST",
      partnerId: "PARTNER123456",
      attributionId: "BN",
      appUrl: "http://localhost:3000",
    },
    mock,
  );
  expect(await api.sellerStatus(tracking)).toEqual({
    merchantId: p.merchant_id,
    payments: true,
    refunds: false,
  });
});

it("requires provider signature verification against the configured webhook ID", async () => {
  const headers = new Headers({
    "paypal-transmission-id": "DELIVERY",
    "paypal-transmission-time": "2026-11-10T10:00:00Z",
    "paypal-transmission-sig": "SIGNATURE",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url":
      "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
  });
  const event = {
    id: "EVENT",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "CAPTURE" },
  };
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "TOKEN" }))
    .mockResolvedValueOnce(Response.json({ verification_status: "FAILURE" }))
    .mockResolvedValueOnce(Response.json({ verification_status: "SUCCESS" }));
  const api = new SandboxPayPal(
    {
      clientId: "APP",
      secret: "TEST",
      partnerId: "PARTNER123456",
      attributionId: "BN",
      appUrl: "http://localhost:3000",
      webhookId: "CONFIGURED_HOOK",
    },
    mock,
  );
  expect(await api.verifyWebhook(headers, event)).toBe(false);
  expect(await api.verifyWebhook(headers, event)).toBe(true);
  const payload = JSON.parse(String(mock.mock.calls[1][1]!.body));
  expect(payload.webhook_id).toBe("CONFIGURED_HOOK");
  expect(payload.webhook_event).toEqual(event);
  await expect(api.verifyWebhook(new Headers(), event)).rejects.toThrow();
  const wrong = new Headers(headers);
  wrong.set("paypal-cert-url", "https://evil.invalid/cert");
  await expect(api.verifyWebhook(wrong, event)).rejects.toThrow();
  expect(mock).toHaveBeenCalledTimes(3);
});
