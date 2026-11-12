import { z } from "zod";
import { centsText } from "./payment-ledger";
export function checkoutAppUrl(configured: string, origin?: string) {
  const base = new URL(configured);
  if (!origin) return base.origin;
  const requested = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  if (requested.origin !== base.origin && !(
    loopback.includes(base.hostname) && loopback.includes(requested.hostname) &&
    base.protocol === requested.protocol && base.port === requested.port
  )) throw new Error("Checkout return origin does not match Workspace configuration");
  return requested.origin;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export type SandboxConfig = {
  clientId: string;
  secret: string;
  partnerId: string;
  attributionId: string;
  appUrl: string;
  webhookId?: string;
};
export class PayPalError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(
      `PayPal sandbox could not complete this action (${code}). Retry or check the PayPal setup.`,
    );
  }
}
export class SandboxPayPal {
  private accessToken: Promise<string> | null = null;
  private readonly fetcher: typeof fetch;
  constructor(readonly config: SandboxConfig, fetcher: typeof fetch = fetch) {
    // Native Workers fetch rejects a PayPal instance as its receiver.
    this.fetcher = fetcher.bind(globalThis);
  }
  private async token() {
    this.accessToken ||= (async () => {
      const response = await this.fetcher(
        "https://api-m.sandbox.paypal.com/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.secret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
          redirect: "manual",
        },
      );
      if (response.status >= 300 && response.status < 400)
        throw new PayPalError(response.status, "UNEXPECTED_REDIRECT");
      const data = object(await response.json());
      if (!response.ok || typeof data.access_token !== "string")
        throw new PayPalError(response.status, "AUTHENTICATION_FAILED");
      return data.access_token;
    })();
    return this.accessToken;
  }
  async request(
    path: string,
    {
      method = "GET",
      body,
      seller,
      key,
    }: {
      method?: "GET" | "POST";
      body?: unknown;
      seller?: string;
      key?: string;
    } = {},
  ) {
    if (!/^\/v[12]\/[a-zA-Z0-9_/?=&.%:-]+$/.test(path) || path.includes(".."))
      throw new Error("Invalid PayPal path");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token()}`,
      "Content-Type": "application/json",
      "PayPal-Partner-Attribution-Id": this.config.attributionId,
      Prefer: "return=representation",
    };
    if (seller) {
      if (!/^[A-Z0-9]{13}$/.test(seller))
        throw new Error("Invalid seller reference");
      headers["PayPal-Auth-Assertion"] =
        `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: this.config.clientId, payer_id: seller })).toString("base64url")}.`;
    }
    if (key) headers["PayPal-Request-Id"] = key;
    const response = await this.fetcher(
      `https://api-m.sandbox.paypal.com${path}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
        redirect: "manual",
      },
    );
    if (response.status >= 300 && response.status < 400)
      throw new PayPalError(response.status, "UNEXPECTED_REDIRECT");
    const data = object(await response.json());
    if (!response.ok)
      throw new PayPalError(
        response.status,
        String(data.name || "PROVIDER_ERROR")
          .replace(/[^A-Z_]/g, "")
          .slice(0, 80),
      );
    return data;
  }
  async verifyWebhook(headers: Headers, event: unknown) {
    const id = headers.get("paypal-transmission-id"),
      time = headers.get("paypal-transmission-time"),
      signature = headers.get("paypal-transmission-sig"),
      algorithm = headers.get("paypal-auth-algo"),
      certificate = headers.get("paypal-cert-url");
    if (
      !this.config.webhookId ||
      !id ||
      !time ||
      !signature ||
      algorithm !== "SHA256withRSA" ||
      !certificate
    )
      throw new Error("Webhook verification headers required");
    const cert = new URL(certificate);
    if (
      cert.protocol !== "https:" ||
      cert.username ||
      cert.password ||
      ![
        "api.paypal.com",
        "api.sandbox.paypal.com",
        "api-m.sandbox.paypal.com",
      ].includes(cert.hostname) ||
      !cert.pathname.startsWith("/v1/notifications/certs/")
    )
      throw new Error("Invalid certificate URL");
    const result = await this.request(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: {
          transmission_id: id,
          transmission_time: time,
          transmission_sig: signature,
          auth_algo: algorithm,
          cert_url: certificate,
          webhook_id: this.config.webhookId,
          webhook_event: event,
        },
      },
    );
    return result.verification_status === "SUCCESS";
  }
  async sellerStatus(tracking: string, merchant?: string) {
    z.uuid().parse(tracking);
    const found = await this.request(
      `/v1/customer/partners/${this.config.partnerId}/merchant-integrations?tracking_id=${tracking}`,
    );
    const candidate =
      typeof found.merchant_id === "string"
        ? found
        : object(list(found.merchant_integrations)[0]);
    if (candidate.merchant_id === undefined)
      throw new PayPalError(409, "SELLER_ONBOARDING_PENDING");
    const merchantId = z
      .string()
      .regex(/^[A-Z0-9]{13}$/)
      .parse(candidate.merchant_id);
    if (merchant && merchant !== merchantId)
      throw new Error("Seller account changed; reconnect PayPal.");
    const details = await this.request(
      `/v1/customer/partners/${this.config.partnerId}/merchant-integrations/${merchantId}`,
    );
    if (
      details.merchant_id !== merchantId ||
      (details.tracking_id !== undefined && details.tracking_id !== tracking)
    )
      throw new Error("Seller tracking mismatch");
    const scopes = list(details.oauth_integrations)
      .flatMap((item) => list(object(item).oauth_third_party))
      .map(object)
      .filter((item) => item.partner_client_id === this.config.clientId)
      .flatMap((item) => list(item.scopes));
    return {
      merchantId,
      payments:
        details.payments_receivable === true &&
        details.primary_email_confirmed === true &&
        scopes.includes(
          "https://uri.paypal.com/services/payments/payment/authcapture",
        ),
      refunds: scopes.includes(
        "https://uri.paypal.com/services/payments/refund",
      ),
    };
  }
  async onboard(tracking: string, engagement: string) {
    const data = await this.request("/v2/customer/partner-referrals", {
      method: "POST",
      key: crypto.randomUUID(),
      body: {
        tracking_id: tracking,
        partner_config_override: {
          return_url: `${this.config.appUrl}/workspace/${engagement}?tab=payments&seller_return=1`,
        },
        operations: [
          {
            operation: "API_INTEGRATION",
            api_integration_preference: {
              rest_api_integration: {
                integration_method: "PAYPAL",
                integration_type: "THIRD_PARTY",
                third_party_details: { features: ["PAYMENT", "REFUND"] },
              },
            },
          },
        ],
        products: ["EXPRESS_CHECKOUT"],
        legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      },
    });
    return safePayPalLink(data, "action_url");
  }
  async createOrder(p: {
    id: string;
    request_id: string;
    merchant_id: string;
    amount_cents: number;
    engagement_id: string;
  }) {
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: p.id,
          custom_id: p.request_id,
          invoice_id: p.id,
          amount: {
            currency_code: "USD",
            value: centsText(BigInt(p.amount_cents)),
          },
          payee: { merchant_id: p.merchant_id },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: `${this.config.appUrl}/workspace/${p.engagement_id}?tab=payments&checkout=${p.id}`,
            cancel_url: `${this.config.appUrl}/workspace/${p.engagement_id}?tab=payments&cancelled=${p.id}`,
          },
        },
      },
    };
    return this.request("/v2/checkout/orders", {
      method: "POST",
      seller: p.merchant_id,
      key: p.id,
      body,
    });
  }
}
export function safePayPalLink(
  data: Record<string, unknown>,
  relation: string,
) {
  const value = list(data.links)
    .map(object)
    .find((link) => link.rel === relation)?.href;
  const url = new URL(z.string().parse(value));
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sandbox.paypal.com" ||
    url.username ||
    url.password
  )
    throw new Error("Unexpected PayPal redirect");
  return url.href;
}
export function verifiedOrder(
  data: Record<string, unknown>,
  p: {
    id: string;
    request_id: string;
    order_id: string | null;
    merchant_id: string;
    amount_cents: number;
  },
) {
  const units = list(data.purchase_units).map(object),
    unit = units[0];
  if (
    data.id !== p.order_id ||
    data.intent !== "CAPTURE" ||
    units.length !== 1 ||
    unit.reference_id !== p.id ||
    unit.custom_id !== p.request_id ||
    object(unit.payee).merchant_id !== p.merchant_id ||
    object(unit.amount).currency_code !== "USD" ||
    object(unit.amount).value !== centsText(BigInt(p.amount_cents))
  )
    throw new Error("PayPal order verification failed");
  const captures = list(object(unit.payments).captures).map(object);
  if (captures.length > 1) throw new Error("Unexpected split capture");
  const capture = captures[0];
  if (capture) {
    if (
      object(capture.amount).currency_code !== "USD" ||
      object(capture.amount).value !== centsText(BigInt(p.amount_cents)) ||
      !/^[A-Z0-9]+$/.test(String(capture.id))
    )
      throw new Error("Capture verification failed");
    const fees = object(capture.seller_receivable_breakdown).platform_fees;
    if (fees !== undefined && (!Array.isArray(fees) || fees.length))
      throw new Error("Unexpected platform commission");
  }
  return {
    captureId: capture ? String(capture.id) : null,
    cancellable: !capture && ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(String(data.status)),
    completed:
      !!capture &&
      ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
        String(capture.status),
      ),
    pending: capture?.status === "PENDING",
    approved: data.status === "APPROVED",
    failed:
      data.status === "VOIDED" ||
      ["DECLINED", "FAILED"].includes(String(capture?.status)),
    refunds: list(object(unit.payments).refunds).map(object),
  };
}
export function verifiedRefund(
  data: Record<string, unknown>,
  captureId: string,
  cents?: number,
) {
  const amount = object(data.amount);
  const up = list(data.links)
    .map(object)
    .find((link) => link.rel === "up");
  const url = new URL(String(up?.href || "https://invalid.invalid"));
  if (
    url.protocol !== "https:" ||
    !["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"].includes(url.hostname) ||
    url.username !== "" || url.password !== "" || url.port !== "" || url.search !== "" || url.hash !== "" ||
    url.pathname !== `/v2/payments/captures/${captureId}` ||
    amount.currency_code !== "USD" ||
    typeof data.id !== "string" ||
    !/^[A-Z0-9]+$/.test(data.id) ||
    !/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(String(amount.value))
  )
    throw new Error("Refund verification failed");
  const [whole, fraction] = String(amount.value).split(".");
  const value = BigInt(whole) * 100n + BigInt(fraction);
  if (
    value < 1n ||
    value > 100000000n ||
    (cents !== undefined && value !== BigInt(cents))
  )
    throw new Error("Refund amount mismatch");
  return {
    id: data.id,
    cents: Number(value),
    status:
      data.status === "COMPLETED"
        ? "completed"
        : data.status === "PENDING"
          ? "processing"
          : ["FAILED", "CANCELLED"].includes(String(data.status))
            ? "failed"
            : null,
  };
}
