import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { usd } from "@/lib/domain";
import { paypalSetupReason } from "@/lib/paypal-service";
type Payment = {
  id: string;
  milestone_id: string | null;
  amount_cents: number;
  status: string;
};
type Refund = { payment_id: string; amount_cents: number; status: string };
export function MilestonePayments({
  engagementId,
  milestoneId,
  taskId,
  amount,
  role,
  archived,
  payments,
  refunds,
  requested,
}: {
  engagementId: string;
  milestoneId: string;
  taskId: string;
  amount: number;
  role: string;
  archived: boolean;
  payments: Payment[];
  refunds: Refund[];
  requested: boolean;
}) {
  const related = payments.filter((p) => p.milestone_id === milestoneId);
  const completed = related.filter((p) => p.status === "completed");
  const gross = completed.reduce((sum, p) => sum + Number(p.amount_cents), 0);
  const refunded = refunds
    .filter(
      (r) =>
        r.status === "completed" &&
        completed.some((p) => p.id === r.payment_id),
    )
    .reduce((sum, r) => sum + Number(r.amount_cents), 0);
  const net = gross - refunded,
    due = Math.max(0, amount - net);
  const processing = related.some((p) =>
    ["creating", "approval_pending", "processing"].includes(p.status),
  );
  const state = processing
    ? "Payment pending"
    : net >= amount
      ? amount === 0
        ? "No payment due"
        : "Paid"
      : net > 0
        ? "Partially paid"
        : refunded > 0
          ? "Refunded"
          : "Not paid";
  return (
    <section
      className="mt-5 border-t border-slate-200 pt-4 text-sm"
      aria-label="Milestone payment"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <h4 className="font-semibold">Payment</h4>
        <span className="badge">{state} · sandbox</span>
      </div>
      <p className="muted mt-3">
        Net paid {usd(net)} · Outstanding {usd(due)}
        {refunded > 0 ? ` · Refunded ${usd(refunded)}` : ""}
      </p>
      {gross > 0 && (
        <p className="muted text-xs mt-2">
          Includes payments against earlier accepted versions of this milestone.
        </p>
      )}
      <div className="flex flex-wrap gap-3 items-center mt-3">
        {!archived &&
          due > 0 &&
          !processing &&
          (role === "client" || !requested) && (
            <ActionForm
              actionName={
                role === "client" ? "paypal-pay" : "milestone-payment-request"
              }
            >
              <input type="hidden" name="id" value={engagementId} />
              <input type="hidden" name="task" value={taskId} />
              <input type="hidden" name="operationKey" value={randomUUID()} />
              <Button
                variant="outline"
                disabled={role === "client" && !!paypalSetupReason()}
              >
                {role === "client"
                  ? "Pay with PayPal sandbox"
                  : "Request milestone payment"}
              </Button>
            </ActionForm>
          )}
        {requested && due > 0 && !processing && (
          <span className="muted text-xs">Payment requested</span>
        )}
        <Link
          className="underline text-teal-800"
          href={`/workspace/${engagementId}?tab=payments`}
        >
          Payment history
        </Link>
      </div>
    </section>
  );
}
