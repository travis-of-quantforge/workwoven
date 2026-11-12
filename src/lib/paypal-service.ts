import "server-only";
import { z } from "zod";
import { adminDatabase } from "./supabase/admin";
import {
  SandboxPayPal,
  verifiedOrder,
  verifiedRefund,
  safePayPalLink,
  PayPalError,
  checkoutAppUrl,
} from "./paypal-api";
import { WorkspaceActionError, databaseActionError } from "./action-errors";

export function paypalSetupReason() {
  if (process.env.PAYPAL_ENVIRONMENT !== "sandbox")
    return "Only PayPal sandbox is enabled. Live payments are disabled.";
  if (
    ![
      "SANDBOX_PAYPAL_PARTNER_CLIENT_ID",
      "SANDBOX_PAYPAL_PARTNER_CLIENT_SECRET",
      "SANDBOX_PAYPAL_PARTNER_MERCHANT_ID",
      "SANDBOX_PAYPAL_PARTNER_ATTRIBUTION_ID",
    ].every((key) => !!process.env[key])
  )
    return "PayPal sandbox setup is incomplete. Requests and ledger export remain available.";
  return null;
}
export function sandboxProvider(origin?: string) {
  const reason = paypalSetupReason();
  if (reason) throw new WorkspaceActionError(reason);
  return new SandboxPayPal({
    clientId: process.env.SANDBOX_PAYPAL_PARTNER_CLIENT_ID!,
    secret: process.env.SANDBOX_PAYPAL_PARTNER_CLIENT_SECRET!,
    partnerId: z
      .string()
      .regex(/^[A-Z0-9]{13}$/)
      .parse(process.env.SANDBOX_PAYPAL_PARTNER_MERCHANT_ID),
    attributionId: z
      .string()
      .min(1)
      .parse(process.env.SANDBOX_PAYPAL_PARTNER_ATTRIBUTION_ID),
    webhookId: process.env.SANDBOX_PAYPAL_PARTNER_WEBHOOK_ID,
    appUrl: checkoutAppUrl(z.url().parse(process.env.NEXT_PUBLIC_APP_URL), origin),
  });
}
export async function refreshSeller(userId: string, api = sandboxProvider()) {
  const admin = adminDatabase();
  const seller = await admin
    .from("paypal_sellers")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (seller.error || !seller.data)
    throw new WorkspaceActionError(
      "The professional must connect PayPal sandbox before receiving payments.",
    );
  try {
    const result = await api.sellerStatus(
      seller.data.tracking_id,
      seller.data.merchant_id || undefined,
    );
    const saved = await admin
      .from("paypal_sellers")
      .update({
        merchant_id: result.merchantId,
        payments_enabled: result.payments,
        refunds_enabled: result.refunds,
        verified_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (saved.error) throw new Error("Seller verification could not be saved");
    return result;
  } catch (error) {
    // A failed lookup is not evidence that a verified merchant disconnected.
    // Only a successful provider response may change the cached capabilities.
    if (error instanceof PayPalError) {
      if (error.code === "SELLER_ONBOARDING_PENDING")
        throw new WorkspaceActionError("PayPal seller setup is not complete. Finish onboarding in the sandbox and refresh the connection.");
      throw new WorkspaceActionError(error.message);
    }
    throw new WorkspaceActionError(
      "PayPal connection could not be verified right now. Your saved connection has not been changed. Please retry.",
    );
  }
}
export async function onboardingLink(userId: string, engagementId: string) {
  let stage="configuration";
  try {
    const api=sandboxProvider(),admin=adminDatabase();
    stage="seller_registration";
    const saved=await admin.from("paypal_sellers").upsert({user_id:userId},{onConflict:"user_id",ignoreDuplicates:true});
    if(saved.error)throw new WorkspaceActionError("PayPal seller registration could not be saved. Please retry.");
    stage="seller_lookup";
    const seller=await admin.from("paypal_sellers").select("tracking_id").eq("user_id",userId).single();
    if(seller.error)throw new WorkspaceActionError("PayPal seller registration could not be loaded. Please retry.");
    stage="paypal_referral";
    const url=await api.onboard(seller.data.tracking_id,engagementId);
    stage="save_referral";
    const updated=await admin.from("paypal_sellers").update({onboarding_url:url}).eq("user_id",userId);
    if(updated.error)throw new WorkspaceActionError("PayPal connected to onboarding, but its link could not be saved. Please retry.");
    return url;
  } catch(error) {
    // Never log credentials, referral links, user IDs or provider response bodies.
    console.error("paypal_onboarding_failed",{stage,type:error instanceof Error?error.name:"unknown",code:error instanceof PayPalError?error.code:error instanceof Error && error.message==="Unexpected PayPal redirect"?"UNEXPECTED_REDIRECT":undefined});
    throw error;
  }
}
export async function checkoutLink(paymentId: string, origin?: string) {
  const api = sandboxProvider(origin),
    admin = adminDatabase();
  const appUrl = checkoutAppUrl(process.env.NEXT_PUBLIC_APP_URL!, origin);
  const result = await admin
    .from("payment_transactions")
    .select("*")
    .eq("id", paymentId)
    .single();
  if (result.error) throw new Error("Payment unavailable");
  const p = result.data;
  if (["failed", "cancelled"].includes(p.status))
    throw new WorkspaceActionError(
      "This checkout is no longer payable. Return to Milestones or Payments for the current request.",
    );
  if (p.status === "completed")
    return `/workspace/${p.engagement_id}?tab=payments`;
  if (
    !p.order_id &&
    Date.now() - new Date(p.created_at).getTime() > 3 * 60 * 60 * 1000
  )
    throw new WorkspaceActionError(
      "This checkout needs reconciliation before retrying. No new order has been created.",
    );
  if (p.status === "processing")
    return `/workspace/${p.engagement_id}?tab=payments`;
  if (p.order_id) {
    const currentOrder = await api.request(
      `/v2/checkout/orders/${p.order_id}`,
      { seller: p.merchant_id },
    );
    const current = verifiedOrder(currentOrder, p);
    if (current.approved && !current.captureId)
      return `${appUrl}/workspace/${p.engagement_id}?tab=payments&checkout=${p.id}`;
    if (current.completed || current.failed) {
      await reconcilePayment(p.id);
      if (current.completed)
        return `/workspace/${p.engagement_id}?tab=payments`;
      throw new WorkspaceActionError(
        "This PayPal checkout ended without payment. Retry Pay with PayPal to create a new checkout.",
      );
    }
    return safePayPalLink(
      currentOrder,
      Array.isArray(currentOrder.links) &&
        currentOrder.links.some(
          (link: { rel?: string }) => link.rel === "payer-action",
        )
        ? "payer-action"
        : "approve",
    );
  }
  // Use the persistent payment UUID as the provider idempotency key. A timeout
  // leaves the row in 'creating' so retries cannot create a second local charge.
  let order: Record<string, unknown>;
  try {
    order = await api.createOrder(p);
  } catch (error) {
    if (
      error instanceof PayPalError &&
      [400, 403, 404, 422].includes(error.status)
    )
      await admin.rpc("record_paypal_payment", {
        p: p.id,
        provider_order: null,
        provider_capture: null,
        state: "failed",
        code: error.code,
      });
    throw error;
  }
  const orderId = z
    .string()
    .regex(/^[A-Z0-9]+$/)
    .parse(order.id);
  verifiedOrder(order, { ...p, order_id: orderId });
  const url = safePayPalLink(
    order,
    order.links &&
      (order.links as { rel: string }[]).some((l) => l.rel === "payer-action")
      ? "payer-action"
      : "approve",
  );
  const receipt = await admin.rpc("record_paypal_payment", {
    p: p.id,
    provider_order: orderId,
    provider_capture: null,
    state: "approval_pending",
    approval: url,
  });
  if (receipt.error)
    throw new Error(
      "Checkout created but not yet saved. Retry to recover the same order.",
    );
  const current = await admin
    .from("payment_transactions")
    .select("status")
    .eq("id", p.id)
    .single();
  if (current.error || ["failed", "cancelled"].includes(current.data.status))
    throw new WorkspaceActionError(
      "The payment request changed while checkout was opening. Refresh the milestone before paying.",
    );
  return url;
}
export async function cancelPayPalPayment(paymentId: string, actorId: string) {
  const admin = adminDatabase();
  const result = await admin.from("payment_transactions").select("*").eq("id", paymentId).single();
  if (result.error || !result.data || result.data.payer_id !== actorId)
    throw new WorkspaceActionError("Only the paying client can cancel this checkout.");
  const payment = result.data;
  if (payment.status === "cancelled") return;
  if (payment.status !== "approval_pending" || !payment.order_id || payment.capture_id)
    throw new WorkspaceActionError("Only an uncaptured checkout awaiting approval can be cancelled. Refresh its payment status.");
  // A pending capture, failed check or uncertain provider response must never
  // release the request for a second payment. This operation never captures.
  const verified = await reconcilePayment(paymentId);
  if (verified.completed || verified.captureId || verified.pending)
    throw new WorkspaceActionError("PayPal has already received this payment or is processing it. Its status has been refreshed; it cannot be cancelled.");
  if (verified.failed)
    throw new WorkspaceActionError("This checkout already ended without payment. Refresh the page to retry.");
  if (!verified.cancellable)
    throw new WorkspaceActionError("PayPal has not confirmed that this checkout is safe to cancel. Refresh its payment status before retrying.");
  const cancelled = await admin.rpc("cancel_paypal_checkout", {
    p: paymentId, actor: actorId, provider_order: payment.order_id,
  });
  if (cancelled.error) throw databaseActionError(cancelled.error.code || "", cancelled.error.message);
}

export async function reconcilePayment(
  paymentId: string,
  capture = false,
  authorizeCapture?: () => Promise<unknown>,
) {
  const api = sandboxProvider(),
    admin = adminDatabase();
  const result = await admin
    .from("payment_transactions")
    .select("*")
    .eq("id", paymentId)
    .single();
  if (result.error || !result.data.order_id)
    throw new WorkspaceActionError(
      "Checkout has not been created yet. Retry Pay with PayPal.",
    );
  const p = result.data;
  let order = await api.request(`/v2/checkout/orders/${p.order_id}`, {
    seller: p.merchant_id,
  });
  let verified = verifiedOrder(order, p);
  if (capture && !verified.approved && !verified.captureId && !verified.failed)
    throw new WorkspaceActionError("Approve this payment in PayPal before completing it.");
  if (capture && verified.approved && !verified.captureId) {
    if (!authorizeCapture)
      throw new Error("Explicit client capture authorization required");
    if (Date.now() - new Date(p.created_at).getTime() > 3 * 60 * 60 * 1000)
      throw new WorkspaceActionError(
        "This checkout needs reconciliation before another capture attempt.",
      );
    await authorizeCapture();
    // Capture is only invoked by an authenticated client's explicit server action,
    // never by a browser-success callback or webhook. The same key is always reused.
    await api.request(`/v2/checkout/orders/${p.order_id}/capture`, {
      method: "POST",
      body: {},
      seller: p.merchant_id,
      key: `capture-${p.id}`,
    });
    order = await api.request(`/v2/checkout/orders/${p.order_id}`, {
      seller: p.merchant_id,
    });
    verified = verifiedOrder(order, p);
  }
  const receipt = await admin.rpc("record_paypal_payment", {
    p: p.id,
    provider_order: p.order_id,
    provider_capture: verified.captureId,
    state: verified.completed
      ? "completed"
      : verified.pending
        ? "processing"
        : verified.failed
          ? "failed"
          : "approval_pending",
  });
  if (receipt.error)
    throw new Error(
      "Payment reconciliation could not be saved. Refresh status; do not pay again.",
    );
  // Refunds made directly in the PayPal dashboard are also reconciled from
  // authoritative provider resources, preserving their original capture link.
  for (const ref of verified.refunds) {
    if (
      typeof ref.id !== "string" ||
      !/^[A-Z0-9]+$/.test(ref.id) ||
      !verified.captureId
    )
      continue;
    const details = await api.request(`/v2/payments/refunds/${ref.id}`, {
      seller: p.merchant_id,
    });
    await saveRefundReceipt(p, details, verified.captureId);
  }
  return verified;
}
type StoredPayment = {
  id: string;
  request_id: string;
  engagement_id: string;
  payee_id: string;
  merchant_id: string;
  amount_cents: number;
};
export async function saveRefundReceipt(
  payment: StoredPayment,
  details: Record<string, unknown>,
  captureId: string,
  refundId?: string,
) {
  const admin = adminDatabase();
  const verified = verifiedRefund(details, captureId);
  if (!verified.status) throw new Error("Unknown PayPal refund status");
  let localId = refundId;
  if (!localId && z.uuid().safeParse(details.invoice_id).success) {
    const owned = await admin
      .from("payment_refunds")
      .select("id")
      .eq("id", String(details.invoice_id))
      .eq("payment_id", payment.id)
      .maybeSingle();
    if (owned.error) throw new Error("Refund lookup unavailable");
    localId = owned.data?.id;
  }
  if (!localId) {
    const prior = await admin
      .from("payment_refunds")
      .select("id,amount_cents")
      .eq("provider_refund_id", verified.id)
      .maybeSingle();
    if (prior.error) throw new Error("Refund lookup unavailable");
    if (prior.data) localId = prior.data.id;
    else {
      const imported = await admin.rpc("import_paypal_refund", {
        p: payment.id,
        provider_id: verified.id,
        cents: verified.cents,
      });
      if (imported.error)
        throw new Error("External refund reconciliation failed");
      localId = imported.data;
    }
  }
  const current = await admin
    .from("payment_refunds")
    .select("amount_cents,payment_id")
    .eq("id", localId!)
    .single();
  if (
    current.error ||
    current.data.payment_id !== payment.id ||
    current.data.amount_cents !== verified.cents
  )
    throw new Error("Refund receipt mismatch");
  const saved = await admin.rpc("record_paypal_refund", {
    r: localId,
    provider_id: verified.id,
    state: verified.status,
  });
  if (saved.error) throw new Error("Refund reconciliation could not be saved");
  return verified;
}
export async function executeRefund(refundId: string) {
  const api = sandboxProvider(),
    admin = adminDatabase();
  const refund = await admin
    .from("payment_refunds")
    .select("*")
    .eq("id", refundId)
    .single();
  if (refund.error) throw new Error("Refund unavailable");
  const r = refund.data;
  const payment = await admin
    .from("payment_transactions")
    .select("*")
    .eq("id", r.payment_id)
    .single();
  if (payment.error || !payment.data.capture_id)
    throw new Error("Payment capture unavailable");
  const p = payment.data;
  if (r.status === "completed") return;
  if (["failed", "cancelled"].includes(r.status))
    throw new WorkspaceActionError(
      "This refund did not complete. Create a new refund after reviewing the ledger.",
    );
  if (
    !r.provider_refund_id &&
    Date.now() - new Date(r.created_at).getTime() > 3 * 60 * 60 * 1000
  )
    throw new WorkspaceActionError(
      "This refund needs reconciliation in PayPal before retrying. No new refund has been sent.",
    );
  let details: Record<string, unknown>;
  if (r.provider_refund_id)
    details = await api.request(
      `/v2/payments/refunds/${r.provider_refund_id}`,
      { seller: p.merchant_id },
    );
  else
    try {
      details = await api.request(
        `/v2/payments/captures/${p.capture_id}/refund`,
        {
          method: "POST",
          seller: p.merchant_id,
          key: r.id,
          body: {
            amount: {
              currency_code: "USD",
              value: `${Math.floor(r.amount_cents / 100)}.${String(r.amount_cents % 100).padStart(2, "0")}`,
            },
            invoice_id: r.id,
            note_to_payer: r.reason.slice(0, 255),
          },
        },
      );
    } catch (error) {
      if (
        error instanceof PayPalError &&
        [400, 403, 404, 422].includes(error.status)
      )
        await admin.rpc("record_paypal_refund", {
          r: r.id,
          provider_id: null,
          state: "failed",
          code: error.code,
        });
      throw error;
    }
  verifiedRefund(details, p.capture_id, r.amount_cents);
  await saveRefundReceipt(p, details, p.capture_id, r.id);
}
