// Read-only sandbox credential check. Never print credentials or bearer tokens.
if (process.env.PAYPAL_ENVIRONMENT !== "sandbox") {
  throw new Error("Only PayPal sandbox credentials can be checked here");
}
const id = process.env.SANDBOX_PAYPAL_PARTNER_CLIENT_ID;
const secret = process.env.SANDBOX_PAYPAL_PARTNER_CLIENT_SECRET;
if (!id || !secret) {
  throw new Error(
    "Set SANDBOX_PAYPAL_PARTNER_CLIENT_ID and SANDBOX_PAYPAL_PARTNER_CLIENT_SECRET in .env.local",
  );
}
const response = await fetch(
  "https://api-m.sandbox.paypal.com/v1/oauth2/token",
  {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(15_000),
  },
);
const result = await response.json();
console.log(
  JSON.stringify({
    httpStatus: response.status,
    sandboxMerchantIdConfigured: /^[A-Z0-9]{13}$/.test(process.env.SANDBOX_PAYPAL_PARTNER_MERCHANT_ID || ""),
    sandboxBnCodeConfigured: Boolean(process.env.SANDBOX_PAYPAL_PARTNER_ATTRIBUTION_ID),
    sandboxWebhookConfigured: Boolean(process.env.SANDBOX_PAYPAL_PARTNER_WEBHOOK_ID),
    tokenIssued: Boolean(result.access_token),
    partnerReferralsScope:
      typeof result.scope === "string" &&
      result.scope
        .split(" ")
        .includes(
          "https://uri.paypal.com/services/customer/partner-referrals/readwrite",
        ),
    error: result.error || null,
  }),
);
if (!response.ok || !result.access_token) process.exitCode = 1;
