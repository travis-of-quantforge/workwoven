import { z } from "zod";
import { verifiedOrder } from "@/lib/paypal-api";
import { createHash } from "node:crypto";
import { adminDatabase } from "@/lib/supabase/admin";
import {
  sandboxProvider,
  reconcilePayment,
  saveRefundReceipt,
} from "@/lib/paypal-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let api;
  try {
    api = sandboxProvider();
  } catch {
    return new Response("Sandbox setup incomplete", { status: 503 });
  }
  if (!api.config.webhookId)
    return new Response("Webhook not configured", { status: 503 });
  const transmissionId = request.headers.get("paypal-transmission-id"),
    transmissionTime = request.headers.get("paypal-transmission-time"),
    signature = request.headers.get("paypal-transmission-sig"),
    algorithm = request.headers.get("paypal-auth-algo"),
    cert = request.headers.get("paypal-cert-url");
  if (
    !transmissionId ||
    !transmissionTime ||
    !signature ||
    algorithm !== "SHA256withRSA" ||
    !cert
  )
    return new Response("Invalid signature headers", { status: 400 });
  try {
    const url = new URL(cert);
    if (
      url.protocol !== "https:" ||
      ![
        "api.paypal.com",
        "api.sandbox.paypal.com",
        "api-m.sandbox.paypal.com",
      ].includes(url.hostname) ||
      !url.pathname.startsWith("/v1/notifications/certs/")
    )
      throw new Error();
  } catch {
    return new Response("Invalid certificate", { status: 400 });
  }
  let body = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        throw new Error();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    return new Response("Invalid webhook body", { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(body);
    if (
      typeof event.id !== "string" ||
      typeof event.event_type !== "string" ||
      !event.resource ||
      typeof event.resource.id !== "string"
    )
      throw new Error();
  } catch {
    return new Response("Invalid event", { status: 400 });
  }
  try {
    if (!(await api.verifyWebhook(request.headers, event)))
      return new Response("Signature verification failed", { status: 401 });
  } catch {
    return new Response("Signature verification unavailable", { status: 503 });
  }
  const admin = adminDatabase(),
    hash = createHash("sha256").update(body).digest("hex");
  const previous = await admin
    .from("paypal_webhook_events")
    .select("payload_hash,processed_at")
    .eq("id", event.id)
    .maybeSingle();
  if (previous.error)
    return new Response("Event storage unavailable", { status: 503 });
  if (previous.data?.payload_hash && previous.data.payload_hash !== hash)
    return new Response("Event conflict", { status: 409 });
  if (previous.data?.processed_at) return new Response("Already reconciled");
  const saved = await admin.from("paypal_webhook_events").upsert(
    {
      id: event.id,
      event_type: event.event_type,
      resource_id: event.resource.id,
      payload_hash: hash,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (saved.error)
    return new Response("Event storage unavailable", { status: 503 });
  try {
    if (
      event.event_type.startsWith("PAYMENT.CAPTURE.") ||
      event.event_type.startsWith("CHECKOUT.ORDER.")
    ) {
      const orderId =
        event.resource.supplementary_data?.related_ids?.order_id ||
        (event.event_type.startsWith("CHECKOUT.ORDER.")
          ? event.resource.id
          : null);
      let payment = orderId
        ? await admin
            .from("payment_transactions")
            .select("*")
            .eq("order_id", String(orderId))
            .maybeSingle()
        : await admin
            .from("payment_transactions")
            .select("*")
            .eq("capture_id", event.resource.id)
            .maybeSingle();
      const refundEvent = event.event_type === "PAYMENT.CAPTURE.REFUNDED";
      if (!payment.data && refundEvent) {
        const up = Array.isArray(event.resource.links)
          ? event.resource.links.find((l: { rel: string }) => l.rel === "up")
              ?.href
          : null;
        const captureId =
          typeof up === "string"
            ? new URL(up).pathname.match(
                /^\/v2\/payments\/captures\/([A-Z0-9]+)$/,
              )?.[1]
            : null;
        if (captureId)
          payment = await admin
            .from("payment_transactions")
            .select("*")
            .eq("capture_id", captureId)
            .maybeSingle();
      }
      if (!payment.data && orderId && /^[A-Z0-9]+$/.test(String(orderId))) {
        const localId =
          event.resource.invoice_id ||
          event.resource.purchase_units?.[0]?.reference_id;
        if (z.uuid().safeParse(localId).success) {
          const candidate = await admin
            .from("payment_transactions")
            .select("*")
            .eq("id", String(localId))
            .maybeSingle();
          if (candidate.data && !candidate.data.order_id) {
            const details = await api.request(
              `/v2/checkout/orders/${orderId}`,
              { seller: candidate.data.merchant_id },
            );
            const verified = verifiedOrder(details, {
              ...candidate.data,
              order_id: String(orderId),
            });
            const bound = await admin.rpc("record_paypal_payment", {
              p: candidate.data.id,
              provider_order: String(orderId),
              provider_capture: verified.captureId,
              state: verified.completed
                ? "completed"
                : verified.pending
                  ? "processing"
                  : verified.failed
                    ? "failed"
                    : "approval_pending",
            });
            if (bound.error) throw new Error("Order recovery unavailable");
            payment = await admin
              .from("payment_transactions")
              .select("*")
              .eq("id", candidate.data.id)
              .maybeSingle();
          }
        }
      }
      if (payment.error || !payment.data)
        throw new Error("PAYMENT_NOT_YET_AVAILABLE");
      await reconcilePayment(payment.data.id);
      if (refundEvent) {
        const current = await admin
          .from("payment_transactions")
          .select("*")
          .eq("id", payment.data.id)
          .single();
        if (!current.data?.capture_id)
          throw new Error("CAPTURE_NOT_YET_AVAILABLE");
        const refund = await api.request(
          `/v2/payments/refunds/${event.resource.id}`,
          { seller: current.data.merchant_id },
        );
        await saveRefundReceipt(current.data, refund, current.data.capture_id);
      }
    }
    const done = await admin
      .from("paypal_webhook_events")
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .eq("id", event.id);
    if (done.error) throw new Error("Event completion unavailable");
    return new Response("Reconciled");
  } catch {
    await admin
      .from("paypal_webhook_events")
      .update({ last_error: "RECONCILIATION_PENDING" })
      .eq("id", event.id);
    return new Response("Reconciliation pending; retry", { status: 503 });
  }
}
