import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ActionForm, ActionSubmitButton } from "./action-form";

export function reviewEvidenceHref(id: string, ref: string) {
  const [kind, record] = ref.split(":");
  if (!/^[0-9a-f-]{36}$/.test(record || "")) return null;
  const base = `/workspace/${id}`;
  if (kind === "message")
    return `${base}?tab=discussion&message=${record}#message-${record}`;
  if (kind === "attachment") return `${base}?tab=files#file-${record}`;
  if (kind === "contract")
    return `${base}?tab=contract&version=${record}#contract-archive-${record}`;
  if (["milestone", "agreement"].includes(kind))
    return `${base}?tab=milestones&version=${record}`;
  if (["payment", "refund"].includes(kind)) return `${base}?tab=payments#${kind}-${record}`;
  return null;
}
export async function ConversationFindings({
  db,
  id,
  assessmentId,
}: {
  db: SupabaseClient;
  id: string;
  assessmentId?: string;
}) {
  let query = db
    .from("conversation_findings")
    .select(
      "id,status,categories,explanation,next_step,evidence,resolution_evidence,marked_by,updated_at",
    )
    .eq("engagement_id", id)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (assessmentId) query = query.eq("assessment_id", assessmentId);
  const [found, latest] = await Promise.all([
    query,
    assessmentId
      ? Promise.resolve({ data: null })
      : db
          .from("message_assessments")
          .select("status,reason,finished_at,created_at,result")
          .eq("engagement_id", id)
          .eq("review_version", 1)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
  ]);
  const availability = found.data?.length
    ? await db.rpc("conversation_evidence_availability", { e: id })
    : { data: {} };
  return (
    <section
      id={assessmentId ? undefined : "conversation-checks"}
      className={assessmentId ? "ai-text mt-3" : "panel"}
      aria-label="Conversation checks"
    >
      {!assessmentId && (
        <>
          <h3>Conversation checks</h3>
          <ActionForm actionName="conversation-review" className="my-3">
            <input type="hidden" name="id" value={id} />
            <ActionSubmitButton
              pendingLabel="Queuing review…"
              variant="outline"
            >
              Review discussion
            </ActionSubmitButton>
          </ActionForm>
          {latest.data && (
            <p className="muted text-xs">
              {["queued", "running"].includes(latest.data.status)
                ? "Review pending…"
                : latest.data.status === "failed"
                  ? "Review failed; no charge. Previous insights remain available."
                  : latest.data.status === "stale"
                    ? "Discussion changed; a fresh review is pending."
                    : latest.data.status === "skipped"
                      ? `Review unavailable: ${(latest.data.reason || "paused").replaceAll("_", " ")}`
                      : latest.data.reason === "incomplete_coverage"
                        ? "Reviewed available context; history coverage is incomplete."
                        : "Latest review completed."}
              {latest.data.finished_at &&
                ` ${new Date(latest.data.finished_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`}
            </p>
          )}
        </>
      )}
      {found.error ? (
        <p className="notice text-xs">Conversation findings unavailable.</p>
      ) : !found.data?.length ? (
        <p className="muted text-xs">
          {latest.data?.status === "checked"
            ? "No actionable findings in the reviewed context."
            : "No recorded findings yet."}
        </p>
      ) : (
        <details open={!!assessmentId}>
          <summary className="cursor-pointer text-sm">
            Issues and questions ·{" "}
            {
              found.data.filter((f) =>
                ["open", "awaiting_clarification"].includes(f.status),
              ).length
            }{" "}
            unresolved
          </summary>
          {found.data.map((f) => (
            <article
              key={f.id}
              id={`finding-${f.id}`}
              className="border-t border-slate-200 mt-3 pt-3 text-sm ai-text"
            >
              <span className="badge">{f.status.replaceAll("_", " ")}</span>
              <p>{f.explanation}</p>
              <p className="font-semibold">{f.next_step}</p>
              {f.categories?.includes("scope") && <Link className="underline text-xs" href={`?tab=milestones`}>Review or revise milestones</Link>}
              {f.marked_by && (
                <p className="text-xs muted">
                  Marked by a participant; commitments are unchanged.
                </p>
              )}
              <details className="my-2">
                <summary className="cursor-pointer text-xs">Evidence</summary>
                {[...(f.evidence || []), ...(f.resolution_evidence || [])].map(
                  (
                    c: { ref: string; version: string; quote: string },
                    i: number,
                  ) => {
                    const href = availability.data?.[`${c.ref}@${c.version}`]
                      ? reviewEvidenceHref(id, c.ref)
                      : null;
                    return (
                      <blockquote
                        className="border-l-2 border-mint pl-3 my-2 text-xs"
                        key={i}
                      >
                        {href ? c.quote : "Source unavailable"}
                        <br />
                        {href ? (
                          <Link className="underline" href={href}>
                            View source · version {c.version}
                          </Link>
                        ) : null}
                      </blockquote>
                    );
                  },
                )}
              </details>
              {["open", "awaiting_clarification"].includes(f.status) && (
                <>
                  <Link
                    href={`?tab=discussion#body`}
                    className="underline text-xs"
                  >
                    Clarify in discussion
                  </Link>
                  <ActionForm
                    actionName="conversation-finding"
                    className="mt-2"
                  >
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="finding" value={f.id} />
                    <label className="sr-only" htmlFor={`feedback-${f.id}`}>
                      Resolution or dismissal feedback
                    </label>
                    <input
                      id={`feedback-${f.id}`}
                      name="feedback"
                      placeholder="Optional feedback"
                      maxLength={2000}
                    />
                    <div className="flex flex-wrap gap-2 mt-2">
                      <ActionSubmitButton
                        variant="outline"
                        name="status"
                        value="resolved"
                      >
                        Mark resolved
                      </ActionSubmitButton>
                      <ActionSubmitButton
                        variant="outline"
                        name="status"
                        value="dismissed"
                      >
                        Dismiss
                      </ActionSubmitButton>
                    </div>
                  </ActionForm>
                </>
              )}
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
