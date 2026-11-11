import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MilestoneArchive,
  MilestoneTerms,
  type MilestoneHistory,
} from "./milestone-archive";
import { MilestoneProposal } from "./milestone-proposal";
import { MilestoneView } from "./milestone-view";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
import { MilestonePayments } from "./milestone-payments";
import { ChevronRight } from "lucide-react";
import { activeMilestoneId } from "@/lib/milestones";

export async function IndividualMilestones({
  db,
  id,
  userId,
  role,
  status,
  disabled,
  aiUnavailable,
  selected,
}: {
  db: SupabaseClient;
  id: string;
  userId: string;
  role: string;
  status: string;
  disabled: boolean;
  aiUnavailable: string | null;
  selected?: string;
}) {
  const [
    items,
    versions,
    scopes,
    tasks,
    legacyApprovals,
    members,
    payments,
    refunds,
    requests,
    deliveries,
  ] = await Promise.all([
    db
      .from("milestones")
      .select("*")
      .eq("engagement_id", id)
      .order("created_at")
      .order("id"),
    db
      .from("milestone_versions")
      .select(
        "*,milestones!milestone_versions_milestone_id_fkey!inner(engagement_id)",
      )
      .eq("milestones.engagement_id", id)
      .order("number", { ascending: false }),
    db
      .from("scope_versions")
      .select("id,number,author_id,content,created_at")
      .eq("engagement_id", id),
    db.from("milestone_tasks").select("*").eq("engagement_id", id),
    db
      .from("approvals")
      .select("*,scope_versions!inner(engagement_id)")
      .eq("scope_versions.engagement_id", id),
    db.from("memberships").select("user_id,role").eq("engagement_id", id),
    db
      .from("payment_transactions")
      .select("id,milestone_id,amount_cents,status")
      .eq("engagement_id", id),
    db
      .from("payment_refunds")
      .select("payment_id,amount_cents,status")
      .eq("engagement_id", id),
    db
      .from("payment_requests")
      .select("task_id,status")
      .eq("engagement_id", id),
    db.from("delivery_submissions").select("id,task_id,milestone_tasks!inner(engagement_id)").eq("milestone_tasks.engagement_id", id),
  ]);
  const versionIds = (versions.data || []).map((v) => v.id);
  const [approvals, acceptedReviews] = await Promise.all([versionIds.length
    ? await db
        .from("milestone_approvals")
        .select("*")
        .in("version_id", versionIds)
    : { data: [], error: null },
    deliveries.data?.length
      ? db.from("delivery_reviews").select("submission_id").in("submission_id", deliveries.data.map(d => d.id)).eq("decision", "accepted")
      : { data: [], error: null },
  ]);
  if (
    [
      items,
      versions,
      scopes,
      tasks,
      legacyApprovals,
      approvals,
      members,
      payments,
      refunds,
      requests,
      deliveries,
      acceptedReviews,
    ].some((result) => result.error)
  )
    return (
      <p role="alert" className="notice">
        Milestones could not be loaded. Refresh or check database migrations.
      </p>
    );
  const completedTaskIds = new Set(deliveries.data!
    .filter(d => acceptedReviews.data!.some(r => r.submission_id === d.id))
    .map(d => d.task_id));
  const activeId = activeMilestoneId(status, items.data!, versions.data!, tasks.data!, completedTaskIds);
  const citedSet =
    selected &&
    scopes.data?.find(
      (s) =>
        s.id === selected &&
        (Array.isArray(s.content.acceptedMilestones) || !s.content.milestoneId),
    );
  const proposal = (
    <MilestoneProposal
      engagementId={id}
      expected={null}
      base={null}
      initial={[]}
      aiUnavailable={aiUnavailable}
      disabled={disabled}
    />
  );
  return (
    <div className="stack">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2>Milestones</h2>
        <div>{proposal}</div>
      </div>
      {citedSet && (
        <MilestoneArchive
          key={selected || "agreement-archive"}
          selected={citedSet.id}
          label="View cited agreement version"
          versions={[
            {
              id: citedSet.id,
              number: citedSet.number,
              description: citedSet.content.deliverables,
              acceptanceCriteria: citedSet.content.acceptanceCriteria,
              responsibilities: citedSet.content.responsibilities,
              amountCents: Number(citedSet.content.priceCents),
              targetDate: citedSet.content.schedule,
              author: citedSet.content.acceptedMilestones
                ? "Accepted milestone set snapshot"
                : members.data?.find((m) => m.user_id === citedSet.author_id)
                    ?.role || "Participant",
              createdAt: citedSet.created_at,
              approvals: citedSet.content.acceptedMilestones
                ? [
                    "Each referenced milestone has its own party approval records",
                  ]
                : legacyApprovals
                    .data!.filter((a) => a.version_id === citedSet.id)
                    .map((a) => a.role),
              status: citedSet.content.acceptedMilestones
                ? "Accepted set snapshot"
                : "Original agreement",
              reason: citedSet.content.acceptedMilestones
                ? "This immutable snapshot references the exact milestone versions accepted at this time."
                : "Preserved original agreement source.",
            },
          ]}
        />
      )}
      {!items.data?.length && (
        <p className="panel muted">No milestones proposed yet.</p>
      )}
      {items.data?.map((item) => {
        const history: MilestoneHistory[] = (versions.data || [])
          .filter((v) => v.milestone_id === item.id)
          .map((v) => {
            const scope = scopes.data!.find(
              (s) => s.id === v.scope_version_id,
            )!;
            const task = tasks.data!.find((t) => t.id === v.task_id)!;
            return {
              id: v.id,
              number: v.number,
              description: scope.content.milestoneId
                ? scope.content.deliverables
                : task.title,
              acceptanceCriteria: task.acceptance_criteria,
              responsibilities: v.responsibilities,
              amountCents: Number(task.amount_cents),
              targetDate: task.end_date,
              author:
                scope.author_id === userId
                  ? "You"
                  : members.data?.find((m) => m.user_id === scope.author_id)
                      ?.role || "Participant",
              createdAt: scope.created_at,
              reason: v.reason,
              approvalRecords: approvals
                .data!.filter((a) => a.version_id === v.id)
                .map(
                  (a) =>
                    `${a.role} · ${new Date(a.created_at).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"}`,
                ),
              approvals: approvals
                .data!.filter((a) => a.version_id === v.id)
                .map((a) => a.role),
              status:
                item.accepted_version_id === v.id
                  ? "Accepted"
                  : item.latest_version_id === v.id
                    ? "Proposed"
                    : approvals.data!.filter((a) => a.version_id === v.id)
                          .length === 2
                      ? "Previously accepted"
                      : "Superseded",
            };
          });
        const latest = history.find((v) => v.id === item.latest_version_id)!;
        const accepted = history.find((v) => v.id === item.accepted_version_id);
        const ownApproval = approvals.data!.some(
          (a) => a.version_id === latest.id && a.user_id === userId,
        );
        const currentRecord =
          accepted && versions.data!.find((v) => v.id === accepted.id);
        const currentScope =
          currentRecord &&
          scopes.data!.find((s) => s.id === currentRecord.scope_version_id);
        const active = item.id === activeId;
        const completed = currentRecord && completedTaskIds.has(currentRecord.task_id);
        return (
          <article
            key={item.id}
            id={`milestone-${item.id}`}
            data-active={active ? "true" : undefined}
            className={`panel scroll-mt-5 ${active ? "ring-2 ring-teal-100 shadow-sm" : ""}`}
          >
            <details key={active ? "active" : "collapsed"} open={active} className="group/milestone">
              <summary className="cursor-pointer list-none rounded focus-visible:outline-2 focus-visible:outline-teal-700 [&::-webkit-details-marker]:hidden">
                <div className="flex items-start gap-3">
                  <ChevronRight size={18} aria-hidden="true" className="mt-1 shrink-0 transition-transform group-open/milestone:rotate-90" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3>Milestone · version {accepted?.number || latest.number}</h3>
                      <span className={active ? "rounded-full bg-teal-800 px-3 py-1 text-xs font-semibold text-white" : "badge"}
                        title={active ? "Next accepted milestone awaiting client acceptance of delivery" : undefined}>
                        {active ? "Active" : completed ? "Completed" : accepted ? "Accepted" : "Proposed"}
                      </span>
                    </div>
                    <p className="text-sm mt-2 line-clamp-2 whitespace-pre-wrap break-words">{(accepted || latest).description}</p>
                  </div>
                </div>
              </summary>
            <MilestoneTerms version={accepted || latest} />
            {accepted && accepted.id !== latest.id && (
              <section className="mt-5 border border-dashed rounded-lg p-4">
                <h4 className="font-semibold">
                  Pending amendment · version {latest.number}
                </h4>
                <MilestoneTerms version={latest} />
                {latest.reason && (
                  <p className="text-sm mt-3 whitespace-pre-wrap">
                    Reason: {latest.reason}
                  </p>
                )}
              </section>
            )}
            <p className="muted text-xs mt-4">
              Version {latest.number} approvals:{" "}
              {latest.approvals.join(", ") || "None"}
            </p>
            <div className="flex flex-wrap gap-3 mt-5">
              {item.latest_version_id !== item.accepted_version_id &&
                !ownApproval &&
                !disabled && (
                  <ActionForm actionName="accept-milestone">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="version" value={latest.id} />
                    <Button>Accept version {latest.number}</Button>
                  </ActionForm>
                )}
              {!disabled && (
                <MilestoneProposal
                  key={latest.id}
                  engagementId={id}
                  milestoneId={item.id}
                  expected={latest.id}
                  base={accepted?.id || null}
                  initial={[
                    {
                      description: latest.description,
                      amountUsd: (latest.amountCents / 100).toFixed(2),
                      targetDate: latest.targetDate,
                      acceptanceCriteria: latest.acceptanceCriteria,
                      responsibilities: latest.responsibilities,
                    },
                  ]}
                  disabled={disabled}
                  aiUnavailable={aiUnavailable}
                  triggerLabel={
                    item.proposer_id === userId
                      ? accepted?.id === latest.id
                        ? "Propose revision"
                        : "Edit proposal"
                      : "Propose amendment"
                  }
                />
              )}
              <MilestoneArchive
                key={selected || "milestone-archive"}
                versions={history}
                selected={
                  citedSet
                    ? undefined
                    : versions.data!.find(
                        (v) =>
                          v.milestone_id === item.id &&
                          (v.id === selected ||
                            v.scope_version_id === selected),
                      )?.id
                }
              />
            </div>
            {currentRecord && accepted && (
              <MilestonePayments
                engagementId={id}
                milestoneId={item.id}
                taskId={currentRecord.task_id}
                amount={accepted.amountCents}
                role={role}
                archived={status === "archived"}
                payments={payments.data || []}
                refunds={refunds.data || []}
                requested={(requests.data || []).some(
                  (r) =>
                    r.task_id === currentRecord.task_id &&
                    r.status === "requested",
                )}
              />
            )}
            {currentRecord && currentScope && (
              <details className="mt-5 border-t pt-4">
                <summary className="cursor-pointer font-medium">
                  Delivery and progress
                </summary>
                <MilestoneView
                  db={db}
                  id={id}
                  role={role}
                  status={status}
                  latest={currentScope}
                  accepted={currentScope.id}
                  editable={false}
                  taskId={currentRecord.task_id}
                  milestoneNumber={accepted!.number}
                />
              </details>
            )}
            </details>
          </article>
        );
      })}
    </div>
  );
}
