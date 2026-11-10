import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { usd } from "@/lib/domain";
type Scope = { id: string; number: number; content: Record<string, unknown> };
export async function MilestoneView({
  db,
  id,
  role,
  latest,
  accepted,
  status,
  taskId,
  milestoneNumber,
}: {
  db: SupabaseClient;
  id: string;
  role: string;
  latest: Scope | undefined;
  accepted: string | null;
  status: string;
  editable?: boolean;
  taskId?: string;
  milestoneNumber?: number;
}) {
  const taskQuery = db
    .from("milestone_tasks")
    .select("*")
    .eq("engagement_id", id)
    .order("position");
  const { data: tasks, error } = await (taskId
    ? taskQuery.eq("id", taskId)
    : taskQuery);
  if (error)
    return (
      <p className="notice">
        Milestone data could not be loaded. Refresh or check database
        migrations.
      </p>
    );
  const ids = (tasks || []).map((t) => t.id),
    versions = [...new Set((tasks || []).map((t) => t.version_id))];
  const [deps, progress, deliveries, files, scopeRows] = await Promise.all([
    versions.length
      ? db.from("task_dependencies").select("*").in("version_id", versions)
      : { data: [] },
    ids.length
      ? db.from("task_progress").select("*").in("task_id", ids)
      : { data: [] },
    ids.length
      ? db
          .from("delivery_submissions")
          .select("*")
          .in("task_id", ids)
          .order("number", { ascending: false })
      : { data: [] },
    db
      .from("attachments")
      .select("id,name")
      .eq("engagement_id", id)
      .eq("visibility", "shared")
      .eq("upload_status", "ready"),
    db.from("scope_versions").select("id,number").eq("engagement_id", id),
  ]);
  const subs = (deliveries.data || []).map((s) => s.id);
  const [reviews, deliveryFiles] = await Promise.all([
    subs.length
      ? db.from("delivery_reviews").select("*").in("submission_id", subs)
      : { data: [] },
    subs.length
      ? db.from("delivery_files").select("*").in("submission_id", subs)
      : { data: [] },
  ]);
  const groups = [
    ...new Set([accepted, latest?.id, ...versions].filter(Boolean)),
  ] as string[];
  return (
    <div className="stack">
      {groups.map((version) => {
        const rows = (tasks || []).filter((t) => t.version_id === version);
        if (!rows.length) return null;
        const current = version === accepted,
          proposed = !current && version === latest?.id;
        const heading = `Delivery history · version ${scopeRows.data?.find((s) => s.id === version)?.number}`;
        const content = (
          <div className="stack mt-4">
            {rows.map((t) => {
              const predecessors = (deps.data || [])
                .filter(
                  (d) => d.version_id === version && d.task_key === t.task_key,
                )
                .map((d) => rows.find((p) => p.task_key === d.predecessor_key));
              const reported = progress.data?.find((p) => p.task_id === t.id);
              const submissions = (deliveries.data || []).filter(
                (s) => s.task_id === t.id,
              );
              const acceptedDelivery = submissions.find((s) =>
                reviews.data?.some(
                  (r) => r.submission_id === s.id && r.decision === "accepted",
                ),
              );
              return (
                <article
                  key={t.id}
                  id={`task-${t.id}`}
                  className={`panel ${proposed ? "border-dashed" : ""}`}
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    {!taskId && (
                      <h3>
                        {t.position}. {t.title}
                      </h3>
                    )}
                    <span className="badge">
                      {acceptedDelivery
                        ? "Delivery accepted"
                        : `Progress ${reported?.percent || 0}%`}
                    </span>
                  </div>
                  {!taskId && (
                    <p className="muted text-xs mt-3">
                      Target deadline: {t.end_date} · {t.owner} owns this task ·{" "}
                      {usd(t.amount_cents)} allocated
                    </p>
                  )}
                  {!taskId && (
                    <p className="mt-4">
                      <strong>Acceptance criteria:</strong>{" "}
                      {t.acceptance_criteria}
                    </p>
                  )}
                  <p className="mt-3">
                    <strong>Payment terms:</strong> {t.payment_terms}
                  </p>
                  {!taskId && (
                    <p className="muted text-sm mt-3">
                      Predecessors:{" "}
                      {predecessors.map((p) => p?.title).join(", ") || "None"}.
                      Payment status: no verified payment recorded.
                    </p>
                  )}
                  {current && status === "active" && t.owner === role && (
                    <ActionForm
                      actionName="progress"
                      className="flex flex-wrap items-end gap-3 mt-5"
                    >
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="task" value={t.id} />
                      <div>
                        <label htmlFor={`progress-${t.id}`}>
                          Reported progress (%)
                        </label>
                        <input
                          id={`progress-${t.id}`}
                          name="percent"
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={reported?.percent || 0}
                          required
                        />
                      </div>
                      <Button variant="outline">Update progress</Button>
                    </ActionForm>
                  )}
                  <div className="mt-5 space-y-5">
                    {submissions.map((s, index) => {
                      const review = reviews.data?.find(
                        (r) => r.submission_id === s.id,
                      );
                      return (
                        <section
                          key={s.id}
                          id={`submission-${s.id}`}
                          className="border-t border-slate-200 pt-4"
                        >
                          <h4 className="font-semibold">
                            Delivery {s.number} ·{" "}
                            {review?.decision.replaceAll("_", " ") ||
                              "Awaiting client review"}
                          </h4>
                          <p className="muted text-xs my-2">
                            {new Date(s.created_at).toLocaleString("en-GB", {
                              timeZone: "UTC",
                            })}{" "}
                            UTC · milestone version{" "}
                            {milestoneNumber ||
                              scopeRows.data?.find((v) => v.id === version)
                                ?.number}
                          </p>
                          <p className="whitespace-pre-wrap break-words">
                            {s.message}
                          </p>
                          <ul className="mt-3 space-y-2 text-sm">
                            {(s.links as string[]).map((url, i) => (
                              <li key={i}>
                                <a
                                  className="underline break-all"
                                  href={url}
                                  rel="noopener noreferrer"
                                  target="_blank"
                                >
                                  Delivery link {i + 1}
                                </a>
                              </li>
                            ))}
                            {deliveryFiles.data
                              ?.filter((f) => f.submission_id === s.id)
                              .map((f) => (
                                <li key={f.attachment_id}>
                                  <Link
                                    className="underline"
                                    href={`/workspace/${id}?tab=files#file-${f.attachment_id}`}
                                  >
                                    {files.data?.find(
                                      (a) => a.id === f.attachment_id,
                                    )?.name || "Shared file"}
                                  </Link>
                                </li>
                              ))}
                          </ul>
                          {review && (
                            <p className="notice text-sm mt-3">
                              <strong>
                                Client review against the criteria above:
                              </strong>{" "}
                              {review.reason}
                            </p>
                          )}
                          {!review &&
                            index === 0 &&
                            current &&
                            status === "active" &&
                            role === "client" && (
                              <ActionForm
                                actionName="delivery-review"
                                className="stack mt-4"
                              >
                                <input type="hidden" name="id" value={id} />
                                <input
                                  type="hidden"
                                  name="submission"
                                  value={s.id}
                                />
                                <label htmlFor={`review-${s.id}`}>
                                  Review reason tied to the acceptance criteria
                                </label>
                                <textarea
                                  id={`review-${s.id}`}
                                  name="reason"
                                  maxLength={5000}
                                  required
                                />
                                <div className="flex flex-wrap gap-3">
                                  <Button name="decision" value="accepted">
                                    Accept delivery {s.number}
                                  </Button>
                                  <Button
                                    name="decision"
                                    value="changes_requested"
                                    variant="outline"
                                  >
                                    Request changes
                                  </Button>
                                </div>
                              </ActionForm>
                            )}
                        </section>
                      );
                    })}
                  </div>
                  {current &&
                    status === "active" &&
                    role === "professional" &&
                    !acceptedDelivery && (
                      <details className="border-t border-slate-200 mt-5 pt-4">
                        <summary className="font-semibold cursor-pointer">
                          Submit formal delivery
                        </summary>
                        <ActionForm
                          actionName="delivery"
                          className="stack mt-4"
                        >
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="task" value={t.id} />
                          <input
                            type="hidden"
                            name="operationKey"
                            value={randomUUID()}
                          />
                          <label htmlFor={`delivery-${t.id}`}>
                            Delivery message
                          </label>
                          <textarea
                            id={`delivery-${t.id}`}
                            name="body"
                            maxLength={10000}
                            required
                            placeholder="Explain what is included and how to review it against the agreed criteria."
                          />
                          <label htmlFor={`links-${t.id}`}>
                            Delivery URLs (HTTPS; one per line, optional)
                          </label>
                          <textarea
                            id={`links-${t.id}`}
                            name="links"
                            maxLength={20000}
                          />
                          <fieldset>
                            <legend className="text-sm mb-3">
                              Shared files (optional)
                            </legend>
                            {files.data?.map((f) => (
                              <label key={f.id} className="mention-option">
                                <input
                                  type="checkbox"
                                  name="file"
                                  value={f.id}
                                />
                                <span>{f.name}</span>
                              </label>
                            ))}
                          </fieldset>
                          <p className="muted text-xs">
                            This creates a timestamped delivery version. Casual
                            attachments alone do not submit delivery.
                          </p>
                          <Button>Submit delivery for review</Button>
                        </ActionForm>
                      </details>
                    )}
                </article>
              );
            })}
          </div>
        );
        return current || proposed ? (
          <section key={version}>
            {!taskId && <h2>{heading}</h2>}
            {proposed && (
              <Link
                className="underline text-sm"
                href={`/workspace/${id}?tab=milestones#version-${version}`}
              >
                Review and approve this version above
              </Link>
            )}
            {content}
          </section>
        ) : (
          <details key={version} className="panel">
            <summary>{heading}</summary>
            {content}
          </details>
        );
      })}
    </div>
  );
}
