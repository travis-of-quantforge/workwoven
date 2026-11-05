import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usd } from "@/lib/domain";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";

export async function PaymentView({
  db,
  engagementId,
  acceptedVersion,
  role,
  professionalName,
}: {
  db: SupabaseClient;
  engagementId: string;
  acceptedVersion: string | null;
  role: "client" | "professional";
  professionalName: string;
}) {
  const requestsResult = await db
    .from("payment_requests")
    .select(
      "id,version_id,task_id,amount_cents,currency,payment_terms,status,created_at",
    )
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (requestsResult.error) throw new Error("Unable to load payment requests.");
  const requests = requestsResult.data || [];
  const acceptedResult = acceptedVersion
    ? await db
        .from("scope_versions")
        .select("id,number,content")
        .eq("id", acceptedVersion)
        .single()
    : { data: null, error: null };
  if (acceptedResult.error)
    throw new Error("Unable to load accepted payment terms.");
  const accepted = acceptedResult.data;
  const currentTasksResult = acceptedVersion
    ? await db
        .from("milestone_tasks")
        .select("id,title,amount_cents,payment_terms")
        .eq("version_id", acceptedVersion)
        .order("position")
    : { data: [], error: null };
  if (currentTasksResult.error)
    throw new Error("Unable to load accepted milestones.");
  const currentTasks = currentTasksResult.data || [];
  const historicalTaskIds = requests
    .map((r) => r.task_id)
    .filter((id): id is string => !!id);
  const historyTasksResult = historicalTaskIds.length
    ? await db
        .from("milestone_tasks")
        .select("id,title")
        .in("id", historicalTaskIds)
    : { data: [], error: null };
  if (historyTasksResult.error)
    throw new Error("Unable to load payment references.");
  const price = Number(accepted?.content?.priceCents || 0);
  const balance =
    price -
    currentTasks.reduce((total, task) => total + Number(task.amount_cents), 0);
  const alreadyRequested = new Set(
    requests
      .filter(
        (r) => r.version_id === acceptedVersion && r.status === "requested",
      )
      .map((r) => r.task_id || "balance"),
  );
  const choices = [
    ...currentTasks
      .filter(
        (task) =>
          Number(task.amount_cents) > 0 && !alreadyRequested.has(task.id),
      )
      .map((task) => ({
        value: task.id,
        label: `${task.title} · ${usd(Number(task.amount_cents))}`,
      })),
    ...(balance > 0 && !alreadyRequested.has("balance")
      ? [
          {
            value: "balance",
            label: `Unallocated agreement balance · ${usd(balance)}`,
          },
        ]
      : []),
  ];
  return (
    <div className="stack">
      <section className="panel">
        <p className="eyebrow mb-3">Professional payments</p>
        <h2>Agreement payment requests</h2>
        <p className="muted mt-3">
          A request records the professional’s claim against an accepted
          agreement. It does not charge the client or confirm payment. PayPal
          seller checkout, capture, webhook verification and refunds are not
          connected yet.
        </p>
        <p className="muted mt-3 text-sm">
          The client pays the agreed amount directly to{" "}
          {professionalName || "the professional"}. Workspace charges no
          commission. PayPal processing fees will be shown when a verified
          checkout is available.
        </p>
        {accepted ? (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="font-medium">
              Accepted agreement v{accepted.number} · {usd(price)}
            </p>
            <p className="muted mt-2 whitespace-pre-wrap text-sm">
              Payment terms: {accepted.content.paymentTerms}
            </p>
            {role === "professional" && choices.length > 0 && (
              <ActionForm actionName="payment-request" className="stack mt-5">
                <input type="hidden" name="id" value={engagementId} />
                <input type="hidden" name="version" value={acceptedVersion!} />
                <input type="hidden" name="operationKey" value={randomUUID()} />
                <label htmlFor="payment-target">Request payment for</label>
                <select id="payment-target" name="target" required>
                  {choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <p className="muted text-xs">
                  Amount and payee are calculated from accepted records. This
                  creates a request only.
                </p>
                <Button variant="outline">Create payment request</Button>
              </ActionForm>
            )}
            {role === "professional" && !choices.length && (
              <p className="muted mt-4 text-sm">
                All payable items in this accepted version already have
                requests.
              </p>
            )}
          </div>
        ) : (
          <p className="notice mt-5">
            Both parties must formally approve the same agreement version before
            payment can be requested.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Request history</h2>
        {!requests.length && (
          <p className="muted mt-4">No payment requests yet.</p>
        )}
        {requests.map((request) => (
          <div key={request.id} className="mt-5 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {request.task_id
                    ? (historyTasksResult.data || []).find(
                        (task) => task.id === request.task_id,
                      )?.title || "Milestone"
                    : "Unallocated agreement balance"}
                </p>
                <p className="muted mt-1 text-sm">
                  {usd(Number(request.amount_cents))} · {request.currency} ·{" "}
                  {request.status === "superseded"
                    ? "Superseded by a newer accepted agreement"
                    : "Requested; checkout unavailable"}
                </p>
              </div>
              <p className="muted text-xs">
                {new Date(request.created_at).toLocaleString("en-GB", {
                  timeZone: "UTC",
                })}{" "}
                UTC
              </p>
            </div>
            <p className="muted mt-2 whitespace-pre-wrap text-sm">
              Terms at request: {request.payment_terms}
            </p>
            <p className="muted mt-2 break-all text-xs">
              Agreement version ID: {request.version_id}
            </p>
          </div>
        ))}
        <Link
          className="mt-5 inline-block text-sm underline"
          href={`/workspace/${engagementId}?tab=discussion&context=shared`}
        >
          Discuss a request
        </Link>
      </section>
    </div>
  );
}
