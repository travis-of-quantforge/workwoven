import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usd } from "@/lib/domain";
import { centsText, ledgerLabels } from "@/lib/payment-ledger";
import { paypalSetupReason } from "@/lib/paypal-service";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";

const kinds: Record<string, string> = {
  milestone: "Milestone",
  agreement: "Agreement balance",
  hourly: "Hourly billing",
  adhoc: "Ad hoc payment",
  bonus: "Bonus",
};
export async function PaymentView({
  db,
  engagementId,
  role,
  professionalName,
  checkout,
  cancelled,
  page = 0,
}: {
  db: SupabaseClient;
  engagementId: string;
  acceptedVersion: string | null;
  role: "client" | "professional";
  professionalName: string;
  checkout?: string;
  cancelled?: string;
  page?: number;
}) {
  const [
    requestsResult,
    paymentsResult,
    refundsResult,
    ledgerResult,
    totalsResult,
    sellerResult,
  ] = await Promise.all([
    db
      .from("payment_requests")
      .select("*")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("payment_transactions")
      .select("*")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("payment_refunds")
      .select("*")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("payment_ledger")
      .select("*", { count: "exact" })
      .eq("engagement_id", engagementId)
      .order("id", { ascending: false })
      .range(page * 100, page * 100 + 99),
    db.rpc("payment_ledger_totals", { e: engagementId }),
    role === "professional"
      ? db
          .from("paypal_sellers")
          .select("payments_enabled,refunds_enabled,merchant_id")
          .maybeSingle()
      : { data: null, error: null },
  ]);
  if (
    [
      requestsResult,
      paymentsResult,
      refundsResult,
      ledgerResult,
      totalsResult,
      sellerResult,
    ].some((r) => r.error)
  )
    return (
      <p className="notice" role="alert">
        Payment history could not be loaded. Refresh or check database
        migrations.
      </p>
    );
  const requests = requestsResult.data || [],
    payments = paymentsResult.data || [],
    refunds = refundsResult.data || [];
  const setup = paypalSetupReason();
  const gross = BigInt(totalsResult.data.paidCents),
    refunded = BigInt(totalsResult.data.refundedCents);
  const pending = requests.filter(
    (r) =>
      r.status === "requested" &&
      !payments.some((p) => p.request_id === r.id && p.status === "completed"),
  );
  const returned = payments.find(
    (p) =>
      p.id === checkout &&
      ["creating", "approval_pending", "processing"].includes(p.status),
  );
  const hidden = (values: Record<string, string>) =>
    Object.entries(values).map(([name, value]) => (
      <input key={name} type="hidden" name={name} value={value} />
    ));
  return (
    <div className="stack min-w-0">
      <section className="panel min-w-0">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <h2>Payments</h2>
          <a
            className="inline-flex rounded-md border border-slate-300 px-4 py-2 text-sm"
            href={`/api/engagements/${engagementId}/payments/export`}
          >
            Export CSV
          </a>
        </div>
        <p className="muted text-sm mt-3">
          A shared record of payments to{" "}
          {professionalName || "the professional"} and refunds to the client.
          Sandbox only: no real money is moved.
        </p>
        <div className="grid gap-4 sm:grid-cols-3 mt-5">
          {[
            ["Paid", gross],
            ["Refunded", refunded],
            ["Net paid", gross - refunded],
          ].map(([label, cents]) => (
            <div key={String(label)} className="rounded-lg bg-slate-50 p-4">
              <p className="muted text-xs">{String(label)}</p>
              <p className="font-semibold mt-2">
                ${centsText(cents as bigint)}
              </p>
            </div>
          ))}
        </div>
        <p className="muted text-xs mt-3">
          Totals include verified sandbox transactions only. Net paid subtracts
          refunds; PayPal processing fees are separate. Requests and pending
          payments are excluded. Milestone balances and payment controls are on
          the{" "}
          <Link
            className="underline"
            href={`/workspace/${engagementId}?tab=milestones`}
          >
            Milestones page
          </Link>
          .
        </p>
        {setup && <p className="notice text-sm mt-4">{setup}</p>}
        {role === "professional" && (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="text-sm">
              PayPal sandbox:{" "}
              {sellerResult.data?.payments_enabled
                ? "Connected"
                : "Not connected"}
              {sellerResult.data?.merchant_id
                ? ` · ${sellerResult.data.merchant_id}`
                : ""}
            </p>
            <div className="flex flex-wrap gap-3 mt-3">
              <ActionForm actionName="paypal-connect">
                {hidden({ id: engagementId })}
                <Button variant="outline" disabled={!!setup}>
                  {sellerResult.data?.payments_enabled
                    ? "Reconnect PayPal sandbox"
                    : "Connect PayPal sandbox"}
                </Button>
              </ActionForm>
              <ActionForm actionName="paypal-verify-seller">
                {hidden({ id: engagementId })}
                <Button
                  variant="outline"
                  disabled={!!setup || !sellerResult.data}
                >
                  Refresh connection
                </Button>
              </ActionForm>
            </div>
          </div>
        )}
      </section>
      {cancelled && (
        <p className="notice">
          You returned from checkout. No payment is confirmed by this return
          link. Refresh the payment status below.
        </p>
      )}
      {returned && role === "client" && (
        <section className="panel min-w-0">
          <h3>Finish your sandbox payment</h3>
          <p className="muted my-3">
            Complete the approved PayPal checkout. The server verifies the
            recipient and amount before recording payment.
          </p>
          <ActionForm actionName="paypal-status">
            {hidden({ id: engagementId, payment: returned.id, capture: "yes" })}
            <Button disabled={!!setup}>Complete sandbox payment</Button>
          </ActionForm>
        </section>
      )}
      <section className="panel min-w-0">
        <h3>{role === "client" ? "Send a bonus" : "Request a payment"}</h3>
        <p className="muted text-sm mt-3">
          {role === "client"
            ? "Choose an amount and reason, then approve the bonus through PayPal."
            : "Request hourly billing or another payment outside a milestone. The client chooses whether to pay."}
        </p>
        <ActionForm actionName="adhoc-payment-request" className="stack mt-4">
          {hidden({
            id: engagementId,
            operationKey: randomUUID(),
            ...(role === "client" ? { category: "bonus" } : {}),
          })}
          {role === "professional" && (
            <div>
              <label htmlFor="payment-category">Payment type</label>
              <select id="payment-category" name="category">
                <option value="hourly">Hourly billing</option>
                <option value="adhoc">Other payment</option>
              </select>
            </div>
          )}
          <div>
            <label htmlFor="payment-description">
              {role === "client" ? "Bonus reason" : "What is this payment for?"}
            </label>
            <textarea
              id="payment-description"
              name="description"
              required
              maxLength={2000}
              placeholder={
                role === "client"
                  ? "Thank you for the extra care during handover."
                  : "Five hours of reporting support for November."
              }
            />
          </div>
          <div>
            <label htmlFor="payment-amount">Amount (USD)</label>
            <input
              id="payment-amount"
              name="amount"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              required
            />
          </div>
          <Button>
            {role === "client" ? "Create bonus" : "Request payment"}
          </Button>
        </ActionForm>
      </section>
      {!!pending.length && (
        <section className="panel min-w-0">
          <h3>Awaiting payment</h3>
          {pending.map((r) => (
            <article key={r.id} className="mt-4 border-t border-slate-200 pt-4">
              <p className="font-medium break-words whitespace-pre-wrap">
                {r.description}
              </p>
              <p className="muted text-sm mt-2">
                {kinds[r.kind]} · {usd(Number(r.amount_cents))}
              </p>
              {role === "client" && (
                <ActionForm actionName="paypal-pay" className="mt-3">
                  {hidden({
                    id: engagementId,
                    request: r.id,
                    operationKey: randomUUID(),
                  })}
                  <Button disabled={!!setup}>Pay with PayPal sandbox</Button>
                </ActionForm>
              )}
            </article>
          ))}
        </section>
      )}
      {!!payments.length && (
        <section className="panel min-w-0">
          <h3>Payments and refunds</h3>
          {payments.map((p) => {
            const related = refunds.filter((r) => r.payment_id === p.id),
              refundTotal = related
                .filter((r) => r.status === "completed")
                .reduce((sum, r) => sum + Number(r.amount_cents), 0),
              reserved = related
                .filter((r) => ["completed", "processing"].includes(r.status))
                .reduce((sum, r) => sum + Number(r.amount_cents), 0);
            const remaining = Number(p.amount_cents) - reserved;
            const request = requests.find((r) => r.id === p.request_id);
            return (
              <article
                key={p.id}
                id={`payment-${p.id}`}
                className="mt-5 border-t border-slate-200 pt-4"
              >
                <h4 className="font-medium break-words">
                  {request?.description || "Payment"} ·{" "}
                  {usd(Number(p.amount_cents))}
                </h4>
                <p className="muted text-sm mt-2">
                  {p.status === "completed"
                    ? refundTotal === Number(p.amount_cents)
                      ? "Refunded"
                      : refundTotal > 0
                        ? "Partially refunded"
                        : "Paid"
                    : p.status.replaceAll("_", " ")}{" "}
                  · PayPal sandbox
                </p>
                <p className="muted text-xs break-all mt-2">
                  {p.capture_id
                    ? `Capture: ${p.capture_id}`
                    : p.order_id
                      ? `Order: ${p.order_id}`
                      : "Checkout creation pending"}
                </p>
                {p.order_id && (
                  <ActionForm actionName="paypal-status" className="mt-3">
                    {hidden({ id: engagementId, payment: p.id })}
                    <Button variant="outline" disabled={!!setup}>
                      Refresh payment status
                    </Button>
                  </ActionForm>
                )}
                {role === "client" &&
                  p.status === "processing" &&
                  p.id !== checkout && (
                    <ActionForm actionName="paypal-status" className="mt-3">
                      {hidden({
                        id: engagementId,
                        payment: p.id,
                        capture: "yes",
                      })}
                      <Button variant="outline" disabled={!!setup}>
                        Retry completion
                      </Button>
                    </ActionForm>
                  )}
                {related.map((r) => (
                  <div
                    key={r.id}
                    className="border-l-2 border-teal-100 pl-4 mt-4"
                  >
                    <p className="text-sm">
                      Refund {usd(Number(r.amount_cents))} · {r.status}
                    </p>
                    <p className="muted text-sm mt-1 whitespace-pre-wrap break-words">
                      {r.reason}
                    </p>
                    {r.provider_refund_id && (
                      <p className="muted text-xs break-all mt-1">
                        PayPal refund: {r.provider_refund_id}
                      </p>
                    )}
                    {role === "professional" && r.status === "processing" && (
                      <ActionForm actionName="paypal-refund" className="mt-3">
                        {hidden({ id: engagementId, refund: r.id })}
                        <Button variant="outline" disabled={!!setup}>
                          Retry or refresh refund
                        </Button>
                      </ActionForm>
                    )}
                  </div>
                ))}
                {role === "professional" &&
                  p.status === "completed" &&
                  remaining > 0 && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Refund this payment
                      </summary>
                      <ActionForm
                        actionName="paypal-refund"
                        className="stack mt-4"
                      >
                        {hidden({
                          id: engagementId,
                          payment: p.id,
                          operationKey: randomUUID(),
                        })}
                        <label htmlFor={`refund-amount-${p.id}`}>
                          Refund amount (USD)
                        </label>
                        <input
                          id={`refund-amount-${p.id}`}
                          name="amount"
                          type="number"
                          min="0.01"
                          max={(remaining / 100).toFixed(2)}
                          step="0.01"
                          defaultValue={(remaining / 100).toFixed(2)}
                          required
                        />
                        <label htmlFor={`refund-reason-${p.id}`}>
                          Refund reason
                        </label>
                        <textarea
                          id={`refund-reason-${p.id}`}
                          name="reason"
                          maxLength={2000}
                          required
                        />
                        <p className="muted text-xs">
                          Returns funds to the original client payment. This
                          does not change the milestone or accepted terms.
                        </p>
                        <Button disabled={!!setup}>
                          Refund with PayPal sandbox
                        </Button>
                      </ActionForm>
                    </details>
                  )}
              </article>
            );
          })}
        </section>
      )}
      <section className="panel min-w-0">
        <h3>Payment ledger</h3>
        <p className="muted text-sm mt-3">
          Requests, payments and refunds in order. Only Paid and Refunded
          entries move the totals.
        </p>
        {!ledgerResult.data?.length ? (
          <p className="muted mt-4">No payment activity yet.</p>
        ) : (
          <div className="w-full min-w-0 overflow-x-auto mt-4">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b">
                  <th className="p-3">Date (UTC)</th>
                  <th className="p-3">Activity</th>
                  <th className="p-3">For</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3">PayPal reference</th>
                </tr>
              </thead>
              <tbody>
                {ledgerResult.data.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100">
                    <td className="p-3 whitespace-nowrap text-xs">
                      {new Date(entry.created_at).toLocaleString("en-GB", {
                        timeZone: "UTC",
                      })}
                    </td>
                    <td className="p-3">
                      {ledgerLabels[entry.kind] || entry.kind}
                    </td>
                    <td className="p-3 min-w-48 max-w-md whitespace-pre-wrap break-words">
                      {entry.description}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {entry.kind === "refund_completed" ? "−" : ""}
                      {usd(Number(entry.amount_cents))}
                    </td>
                    <td className="p-3 text-xs break-all">
                      {entry.provider_reference || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-4 mt-4 text-sm">
          {page > 0 && (
            <Link
              className="underline"
              href={`?tab=payments&ledger_page=${page - 1}`}
            >
              Newer activity
            </Link>
          )}
          {(ledgerResult.count || 0) > (page + 1) * 100 && (
            <Link
              className="underline"
              href={`?tab=payments&ledger_page=${page + 1}`}
            >
              Older activity
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
