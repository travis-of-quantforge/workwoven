import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";

export async function ConcernView({
  db,
  engagementId,
  role,
  status,
  members,
}: {
  db: SupabaseClient;
  engagementId: string;
  role: "client" | "professional";
  status: string;
  members: { user_id: string; role: string }[];
}) {
  const casesResult = await db
    .from("concern_cases")
    .select(
      "id,title,description,desired_outcome,status,opened_by,created_at,resolved_at",
    )
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });
  if (casesResult.error) throw new Error("Unable to load concerns.");
  const cases = casesResult.data || [];
  const ids = cases.map((c) => c.id);
  const [updatesResult, acknowledgementsResult] = ids.length
    ? await Promise.all([
        db
          .from("concern_updates")
          .select("id,case_id,author_id,body,created_at")
          .in("case_id", ids)
          .order("created_at"),
        db
          .from("concern_acknowledgements")
          .select("case_id,role,actor_id,created_at")
          .in("case_id", ids),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (updatesResult.error || acknowledgementsResult.error)
    throw new Error("Unable to load concern responses.");
  const updates = updatesResult.data || [];
  const acknowledgements = acknowledgementsResult.data || [];
  return (
    <div className="stack">
      <section className="panel">
        <p className="eyebrow mb-3">Shared concerns</p>
        <h2>Raise a concern together</h2>
        <p className="muted mt-3">
          Both parties can explain their position and suggest a way forward. A
          concern does not pause the engagement, change the agreement, decide a
          settlement, or authorise a payment. Use formal agreement revisions for
          any change to scope, price, or schedule.
        </p>
        <p className="muted mt-3 text-sm">
          The opening and each response also appear in shared Discussion, where
          either party can explicitly ask the neutral project agent for help.
        </p>
        {status !== "archived" && (
          <details className="mt-5">
            <summary className="cursor-pointer font-medium text-teal-800">
              Open a concern
            </summary>
            <ActionForm actionName="concern-open" className="stack mt-4">
              <input type="hidden" name="id" value={engagementId} />
              <input type="hidden" name="operationKey" value={randomUUID()} />
              <label htmlFor="concern-title">Short title</label>
              <input
                id="concern-title"
                name="title"
                minLength={5}
                maxLength={160}
                required
              />
              <label htmlFor="concern-description">
                What happened and what evidence matters?
              </label>
              <textarea
                id="concern-description"
                name="description"
                minLength={10}
                maxLength={5000}
                rows={4}
                required
              />
              <label htmlFor="concern-outcome">
                What would you like to discuss?
              </label>
              <textarea
                id="concern-outcome"
                name="desiredOutcome"
                minLength={3}
                maxLength={3000}
                rows={2}
                required
              />
              <Button>Open shared concern</Button>
            </ActionForm>
          </details>
        )}
      </section>
      {!cases.length && (
        <section className="panel">
          <p>No concerns have been opened in this engagement.</p>
        </section>
      )}
      {cases.map((c) => {
        const caseAcks = acknowledgements.filter((a) => a.case_id === c.id);
        const acknowledged = caseAcks.some((a) => a.role === role);
        return (
          <section key={c.id} className="panel" id={`concern-${c.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">
                  {c.status === "resolved"
                    ? "Resolved by both parties"
                    : "Open concern"}
                </p>
                <h3 className="mt-2">{c.title}</h3>
                <p className="muted mt-2 text-xs">
                  Opened by the{" "}
                  {members.find((m) => m.user_id === c.opened_by)?.role ||
                    "party"}
                </p>
              </div>
              <span className="muted text-xs">
                Opened{" "}
                {new Date(c.created_at).toLocaleString("en-GB", {
                  timeZone: "UTC",
                })}{" "}
                UTC
              </span>
            </div>
            <p className="mt-4 whitespace-pre-wrap">{c.description}</p>
            <p className="mt-3 whitespace-pre-wrap">
              <strong>Requested discussion:</strong> {c.desired_outcome}
            </p>
            <Link
              className="mt-3 inline-block text-sm underline"
              href={`/workspace/${engagementId}?tab=discussion&context=shared`}
            >
              View shared Discussion
            </Link>
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h4 className="font-medium">Responses</h4>
              {updates
                .filter((u) => u.case_id === c.id)
                .map((u) => (
                  <div
                    key={u.id}
                    className="mt-3 rounded-lg border border-slate-200 p-3"
                  >
                    <p className="muted text-xs">
                      {members.find((m) => m.user_id === u.author_id)?.role ||
                        "party"}{" "}
                      ·{" "}
                      {new Date(u.created_at).toLocaleString("en-GB", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </p>
                    <p className="mt-2 whitespace-pre-wrap">{u.body}</p>
                  </div>
                ))}
              {!updates.some((u) => u.case_id === c.id) && (
                <p className="muted mt-3">No responses yet.</p>
              )}
            </div>
            {c.status === "open" && (
              <>
                <ActionForm actionName="concern-update" className="stack mt-5">
                  <input type="hidden" name="id" value={engagementId} />
                  <input type="hidden" name="case" value={c.id} />
                  <input
                    type="hidden"
                    name="operationKey"
                    value={randomUUID()}
                  />
                  <label htmlFor={`concern-update-${c.id}`}>
                    Add your position or an option
                  </label>
                  <textarea
                    id={`concern-update-${c.id}`}
                    name="body"
                    maxLength={5000}
                    rows={3}
                    required
                  />
                  <Button variant="outline">Post shared response</Button>
                </ActionForm>
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <p className="muted text-sm">
                    Resolution acknowledgements: {caseAcks.length} of 2 parties.
                  </p>
                  {!acknowledged ? (
                    <ActionForm
                      actionName="concern-acknowledge"
                      className="mt-3"
                    >
                      <input type="hidden" name="id" value={engagementId} />
                      <input type="hidden" name="case" value={c.id} />
                      <Button variant="outline">
                        I consider this concern resolved
                      </Button>
                    </ActionForm>
                  ) : (
                    <p className="muted mt-2 text-sm">
                      Your party has marked this resolved. Waiting for the other
                      party.
                    </p>
                  )}
                </div>
              </>
            )}
            {c.status === "resolved" && (
              <p className="muted mt-5 text-sm">
                Both parties marked this concern resolved. Agreement and payment
                records remain unchanged.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
