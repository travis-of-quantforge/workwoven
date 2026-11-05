import { z } from "zod";
import { FileList } from "@/components/file-list";
import { ReputationView } from "@/components/reputation-view";
import { CalendarView } from "@/components/calendar-view";
import { MilestoneView } from "@/components/milestone-view";
import { ScopeDetails, ScopeComparison } from "@/components/scope-details";
import { AgentPanel, AgentAdvice } from "@/components/agent-panel";
import { CreditView } from "@/components/credit-view";
import { agentView } from "@/lib/ai/view";
import { agentResultSchema } from "@/lib/ai/contracts";
import { ActionForm } from "@/components/action-form";
import { ThreadedMessages } from "@/components/threaded-messages";
import { Notifications } from "@/components/notifications";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Layers,
  ArrowLeft,
  LockKeyhole,
  MessageSquare,
  Paperclip,
  CheckCircle2,
} from "lucide-react";
import { authenticated } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { LiveMessages } from "@/components/live-messages";
import { ShareDraft } from "@/components/share-draft";
const tabs = [
  "discussion",
  "overview",
  "agreement",
  "milestones",
  "files",
  "calendar",
  "payments",
  "credits",
  "reputation",
];
export default async function Workspace({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    context?: string;
    invite?: string;
    message?: string;
    page?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  let auth;
  try {
    auth = await authenticated();
  } catch {
    redirect("/login");
  }
  const { db, user } = auth;
  const results = await Promise.all([
    db.from("engagements").select("*").eq("id", id).single(),
    db.from("memberships").select("*").eq("engagement_id", id),
    db.from("engagements").select("id,title").order("created_at"),
    db
      .from("scope_versions")
      .select("*")
      .eq("engagement_id", id)
      .order("number", { ascending: false }),
    db.from("agent_accounts").select("*").eq("engagement_id", id),
  ]);
  const project = results[0].data;
  if (!project) notFound();
  const members = results[1].data || [];
  const identities = await db.rpc("party_identities", { e: id });
  const role = members.find((m) => m.user_id === user.id)?.role;
  const scopes = results[3].data || [];
  const latest = scopes[0];
  const tab = tabs.includes(query.tab || "") ? query.tab! : "discussion";
  const visibility = query.context === "private" ? role : "shared";
  const agent = await agentView(
    db,
    id,
    tab === "overview" ? "shared" : visibility,
  );
  const policy =
    tab === "credits"
      ? await db
          .from("credit_policy_versions")
          .select("supported_topups")
          .eq("enabled", true)
          .single()
      : { data: null };
  const creditData =
    tab === "credits" && agent.summary
      ? await Promise.all([
          db
            .from("credit_ledger")
            .select("*")
            .eq("account_id", agent.summary.accountId)
            .order("created_at", { ascending: false })
            .limit(30),
          db
            .from("usage_operations")
            .select(
              "id,status,charge_nano,provider_nano,usage_uncertain,created_at",
            )
            .eq("account_id", agent.summary.accountId)
            .order("created_at", { ascending: false })
            .limit(30),
          db
            .from("credit_purchases")
            .select("id,purchaser_id,amount_cents,status")
            .eq("account_id", agent.summary.accountId)
            .order("created_at", { ascending: false })
            .limit(20),
        ])
      : null;
  const summaryRun =
    tab === "overview"
      ? await db
          .from("agent_runs")
          .select("result,created_at,finished_at")
          .eq("engagement_id", id)
          .eq("visibility", "shared")
          .eq("status", "succeeded")
          .eq("result->>kind", "summary")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
  const parsedSummary = agentResultSchema.safeParse(summaryRun.data?.result);
  const pageNumber = Math.min(
    1000,
    Math.max(0, Number.parseInt(query.page || "0", 10) || 0),
  );
  const { data: recentMessages, error: messagesError } = await db
    .from("messages")
    .select("*")
    .eq("engagement_id", id)
    .eq("visibility", visibility)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(pageNumber * 200, pageNumber * 200 + 199);
  let messages = recentMessages || [];
  if (
    z.uuid().safeParse(query.message).success &&
    !messages.some((m) => m.id === query.message)
  ) {
    const target = await db
      .from("messages")
      .select("*")
      .eq("id", query.message!)
      .eq("engagement_id", id)
      .eq("visibility", visibility)
      .maybeSingle();
    if (target.data)
      messages = [...messages, target.data].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
  }
  const { data: files } = await db
    .from("attachments")
    .select("*")
    .eq("engagement_id", id)
    .eq("visibility", visibility)
    .order("created_at", { ascending: false })
    .limit(1000);
  const fileIds = (files || []).map((f) => f.id);
  const fileExtras =
    tab === "files" && fileIds.length
      ? await Promise.all([
          db.rpc("file_previews", { e: id, v: visibility }),
          db
            .from("delivery_files")
            .select(
              "attachment_id,submission_id,attachments!inner(engagement_id,visibility)",
            )
            .eq("attachments.engagement_id", id)
            .eq("attachments.visibility", visibility),
        ])
      : null;
  const allApprovals = scopes.length
    ? await db
        .from("approvals")
        .select("*")
        .in(
          "version_id",
          scopes.map((s) => s.id),
        )
    : { data: [] };
  const approvals = (allApprovals.data || []).filter(
    (a) => a.version_id === latest?.id,
  );
  const { data: notices } = await db
    .from("notifications")
    .select("*")
    .eq("engagement_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  const { data: read } = await db
    .from("discussion_reads")
    .select("last_read_at")
    .eq("engagement_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const { count: unread } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("engagement_id", id)
    .eq("visibility", "shared")
    .neq("author_id", user.id)
    .gt("created_at", read?.last_read_at || "1970-01-01T00:00:00Z");
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-[#edf1f1] border-r border-slate-200 p-4 md:p-6">
        <Link
          className="flex items-center gap-3 text-lg font-semibold"
          href="/"
        >
          <Layers className="text-teal-800" size={23} />
          {process.env.NEXT_PUBLIC_APP_NAME || "Workspace"}
        </Link>
        <Link
          href="/"
          className="flex items-center gap-2 muted mt-4 mb-3 md:mt-9 md:mb-8 text-xs"
        >
          <ArrowLeft size={13} />
          All engagements
        </Link>
        <p className="eyebrow mb-4 hidden md:block">Engagements</p>
        <nav className="flex gap-2 overflow-x-auto md:block">
          {results[2].data?.map((p) => (
            <Link
              key={p.id}
              href={`/workspace/${p.id}`}
              className={`block rounded-lg p-3 mb-2 text-sm ${p.id === id ? "bg-white shadow-sm font-semibold text-teal-900" : "muted"}`}
            >
              {p.title}
            </Link>
          ))}
        </nav>
        <div className="mt-12 text-xs muted hidden md:block">
          <LockKeyhole size={17} className="mb-3" />
          Private assistants have separate histories and credit balances.
        </div>
      </aside>
      <main className="min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 lg:px-10 pt-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">Engagement / {project.status}</p>
              <h1>{project.title}</h1>
              <p className="muted mt-3 text-xs">
                You are the {role} ·{" "}
                {members.length === 2
                  ? "Both parties joined"
                  : "Awaiting your counterpart"}
              </p>
            </div>
            <div className="text-xs muted">
              {identities.data?.map(
                (p: {
                  role: string;
                  display_name: string;
                  company: string;
                }) => (
                  <p key={p.role}>
                    {p.role}: {p.display_name}
                    {p.company ? ` · ${p.company}` : ""}
                  </p>
                ),
              )}
            </div>
            <span className="badge">
              {project.funding === "funded"
                ? "Funded"
                : "Private setup · funding pending"}
            </span>
          </div>
          <LiveMessages key={id} engagementId={id} />
          <nav
            aria-label="Engagement tabs"
            className="flex gap-7 overflow-x-auto mt-7"
          >
            {tabs.map((t) => (
              <Link
                key={t}
                aria-current={tab === t ? "page" : undefined}
                href={`/workspace/${id}?tab=${t}`}
                className={`capitalize pb-4 border-b-2 text-sm whitespace-nowrap ${tab === t ? "border-teal-800 text-teal-900 font-semibold" : "border-transparent muted"}`}
              >
                {t === "credits" ? "AI credits" : t}
              </Link>
            ))}
          </nav>
        </header>
        <div className="p-5 lg:p-9 max-w-6xl mx-auto">
          <Notifications items={notices || []} />
          {project.funding === "pending" && (
            <p className="notice mb-6">
              A verified $5 shared-credit purchase is required to activate this
              engagement. PayPal credit checkout is not implemented yet. Your
              private setup draft is saved; no credits have been invented.
            </p>
          )}
          {(tab === "discussion" || tab === "files" || tab === "credits") && (
            <div className="flex flex-wrap gap-3 mb-6">
              <Button
                asChild
                variant={visibility === "shared" ? "default" : "outline"}
              >
                <Link href={`?tab=${tab}`}>Shared workspace</Link>
              </Button>
              <Button
                asChild
                variant={visibility !== "shared" ? "default" : "outline"}
              >
                <Link href={`?tab=${tab}&context=private`}>
                  <LockKeyhole size={14} />
                  Your private assistant
                </Link>
              </Button>
            </div>
          )}
          {tab === "discussion" && (
            <div
              key={visibility}
              className="grid gap-6 xl:grid-cols-[1fr_340px]"
            >
              <div className="stack content-start">
                <div className="panel">
                  <div className="flex items-center justify-between mb-6">
                    <h2>
                      {visibility === "shared"
                        ? "Discussion"
                        : `Private ${role} context`}
                    </h2>
                    <span className="badge">
                      {visibility === "shared"
                        ? "Both parties can read"
                        : "Only your party"}
                    </span>
                  </div>
                  {visibility === "shared" && (
                    <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                      <p className="muted text-xs">
                        {unread || 0} unread shared messages
                      </p>
                      {messages?.[0] && (
                        <ActionForm actionName="read">
                          <input type="hidden" name="id" value={id} />
                          <input
                            type="hidden"
                            name="lastMessage"
                            value={messages[0].id}
                          />
                          <Button variant="outline">
                            Mark discussion read
                          </Button>
                        </ActionForm>
                      )}
                    </div>
                  )}
                  {messagesError && (
                    <p role="alert" className="notice">
                      Messages could not be loaded. Refresh to retry.
                    </p>
                  )}
                  <nav
                    aria-label="Message history"
                    className="flex flex-wrap gap-4 text-xs mb-4"
                  >
                    {pageNumber > 0 && (
                      <Link
                        className="underline"
                        href={`?tab=discussion${visibility === "shared" ? "" : "&context=private"}&page=${pageNumber - 1}`}
                      >
                        Newer messages
                      </Link>
                    )}
                    {recentMessages?.length === 200 && (
                      <Link
                        className="underline"
                        href={`?tab=discussion${visibility === "shared" ? "" : "&context=private"}&page=${pageNumber + 1}`}
                      >
                        Earlier messages
                      </Link>
                    )}
                  </nav>
                  {!messages?.length && (
                    <div className="py-10 text-center">
                      <MessageSquare className="mx-auto mb-4 text-teal-700" />
                      <h3>Start with a conversation</h3>
                      <p className="muted mt-2">
                        Describe what you’re working toward, what matters and
                        what is still unclear.
                      </p>
                    </div>
                  )}
                  <ThreadedMessages
                    messages={messages?.slice().reverse() || []}
                    engagementId={id}
                    visibility={visibility}
                    userId={user.id}
                    members={members}
                    files={files || []}
                  />
                  <ActionForm actionName="message" className="mt-6">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="visibility" value={visibility} />
                    <label htmlFor="body">
                      {visibility === "shared"
                        ? "Message both parties"
                        : "Private note · never shown to the counterparty"}
                    </label>
                    {visibility === "shared" &&
                      members
                        .filter((m) => m.user_id !== user.id)
                        .map((m) => (
                          <label key={m.user_id} className="mention-option">
                            <input
                              className="w-auto"
                              type="checkbox"
                              name="mention"
                              value={m.user_id}
                            />
                            Mention {m.role}
                          </label>
                        ))}
                    <textarea
                      id="body"
                      name="body"
                      maxLength={30000}
                      required
                      placeholder="Add context, ask a question or discuss the next step…"
                    />
                    <div className="flex justify-between gap-3 items-center mt-3">
                      <small className="muted">
                        Messages do not constitute formal approval.
                      </small>
                      <Button className="shrink-0">Send message</Button>
                    </div>
                  </ActionForm>
                </div>
                {visibility !== "shared" && <ShareDraft id={id} />}
              </div>
              <aside className="stack content-start">
                {agent.summary ? (
                  <AgentPanel
                    key={visibility}
                    engagementId={id}
                    visibility={visibility}
                    availableNano={agent.summary.availableNano}
                    budgetNano={agent.budgetNano}
                    setupReason={agent.setupReason}
                    runs={agent.runs}
                    userId={user.id}
                  />
                ) : (
                  <div className="notice">
                    Agent credit information could not be loaded. Human messages
                    remain available.
                  </div>
                )}
                {visibility === "shared" &&
                  members.length < 2 &&
                  ["discussion", "active"].includes(project.status) && (
                    <div className="panel">
                      <h3>Invite your counterpart</h3>
                      <p className="muted text-xs my-3">
                        They will see all shared content after joining. Private
                        material stays private. No email is sent.
                      </p>
                      <ActionForm actionName="invite" className="stack">
                        <input type="hidden" name="id" value={id} />
                        <label htmlFor="invite-email">Their email</label>
                        <input
                          type="email"
                          id="invite-email"
                          name="email"
                          required
                        />
                        <Button
                          variant="outline"
                          disabled={project.funding !== "funded"}
                        >
                          Create invitation link
                        </Button>
                      </ActionForm>
                      {query.invite && (
                        <p className="mt-4 break-all text-xs">
                          <a
                            className="underline"
                            href={`/invite/${query.invite}`}
                          >
                            {process.env.NEXT_PUBLIC_APP_URL}/invite/
                            {query.invite}
                          </a>
                        </p>
                      )}
                    </div>
                  )}
                <div className="panel">
                  <h3 className="mention-option">
                    <Paperclip size={16} />
                    Attach a file
                  </h3>
                  <ActionForm actionName="upload" className="stack mt-4">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="visibility" value={visibility} />
                    <label htmlFor="upload">
                      {visibility === "shared" ? "Shared file" : "Private file"}
                    </label>
                    <input
                      id="upload"
                      type="file"
                      name="file"
                      accept=".txt,.csv,.pdf,.png,.jpg,.jpeg"
                      required
                    />
                    <small className="muted">
                      Up to 20 MB. Text/CSV extraction is available. PDF and
                      image analysis is not yet supported.
                    </small>
                    <Button variant="outline">Upload</Button>
                  </ActionForm>
                </div>
              </aside>
            </div>
          )}
          {tab === "agreement" && (
            <div className="stack">
              <div
                className="panel"
                id={latest ? `version-${latest.id}` : undefined}
              >
                <h2>Agreement history</h2>
                <p className="muted my-3">
                  Both parties must formally approve the same current version.
                  Prior commitments and approval records are preserved.
                </p>
                {!latest && <p>No scope has been submitted yet.</p>}
                {latest && (
                  <>
                    <div className="flex gap-3 mb-5">
                      <span className="badge">Version {latest.number}</span>
                      <span className="badge">
                        {project.accepted_version_id === latest.id
                          ? "Accepted"
                          : "Proposed"}
                      </span>
                    </div>
                    <ScopeDetails content={latest.content} />
                    {project.accepted_version_id &&
                      project.accepted_version_id !== latest.id && (
                        <ScopeComparison
                          accepted={
                            scopes.find(
                              (s) => s.id === project.accepted_version_id,
                            )?.content || {}
                          }
                          proposed={latest.content}
                        />
                      )}
                    <div className="border-t border-slate-200 mt-6 pt-5">
                      <p className="mb-4">
                        Approvals:{" "}
                        {approvals?.map((a) => a.role).join(", ") || "None"}
                      </p>
                      <ActionForm actionName="approve">
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="version" value={latest.id} />
                        <Button
                          disabled={
                            !["discussion", "active"].includes(
                              project.status,
                            ) || approvals?.some((a) => a.user_id === user.id)
                          }
                        >
                          <CheckCircle2 size={16} />
                          Approve version {latest.number} as {role}
                        </Button>
                      </ActionForm>
                    </div>
                  </>
                )}
                {scopes.slice(1).map((s) => (
                  <details
                    key={s.id}
                    id={`version-${s.id}`}
                    className="mt-6 border-t pt-4"
                  >
                    <summary>
                      Historical version {s.number}
                      {project.accepted_version_id === s.id
                        ? " · currently accepted"
                        : ""}
                    </summary>
                    <p className="muted text-xs mt-3">
                      Approval records:{" "}
                      {(allApprovals.data || [])
                        .filter((a) => a.version_id === s.id)
                        .map(
                          (a) =>
                            `${a.role} · ${new Date(a.created_at).toISOString()}`,
                        )
                        .join("; ") || "None"}
                    </p>
                    <div className="mt-4">
                      <ScopeDetails content={s.content} />
                    </div>
                  </details>
                ))}
              </div>
              {["discussion", "active"].includes(project.status) && (
                <details className="panel">
                  <summary className="font-semibold cursor-pointer">
                    {latest ? "Propose a revision" : "Draft and submit scope"}
                  </summary>
                  <ActionForm actionName="scope" className="stack mt-6">
                    <input type="hidden" name="id" value={id} />
                    <input
                      type="hidden"
                      name="expected"
                      value={latest?.id || ""}
                    />
                    {[
                      ["deliverables", "Deliverables"],
                      ["exclusions", "Exclusions"],
                      ["assumptions", "Assumptions"],
                      ["responsibilities", "Client responsibilities"],
                      ["acceptanceCriteria", "Acceptance criteria"],
                      ["paymentTerms", "Payment terms"],
                      ["schedule", "Schedule"],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <label htmlFor={key}>{label}</label>
                        <textarea
                          id={key}
                          name={key}
                          defaultValue={latest?.content[key] || ""}
                          required
                          maxLength={
                            key === "deliverables" ||
                            key === "acceptanceCriteria"
                              ? 10000
                              : 5000
                          }
                        />
                      </div>
                    ))}
                    <div>
                      <label htmlFor="priceUsd">Price (USD)</label>
                      <input
                        id="priceUsd"
                        name="priceUsd"
                        inputMode="decimal"
                        placeholder="1000.00"
                        defaultValue={(
                          (latest?.content.priceCents || 0) / 100
                        ).toFixed(2)}
                        required
                      />
                    </div>
                    {project.accepted_version_id && (
                      <fieldset className="stack border-t border-slate-200 pt-5">
                        <legend className="font-semibold">
                          Change explanation
                        </legend>
                        <input
                          type="hidden"
                          name="baseVersion"
                          value={project.accepted_version_id}
                        />
                        {[
                          ["changeReason", "Why is this change needed?"],
                          ["affectedReferences", "Affected scope references"],
                          ["costImpact", "Cost impact and who confirmed it"],
                          ["scheduleImpact", "Schedule impact"],
                        ].map(([name, label]) => (
                          <div key={name}>
                            <label htmlFor={name}>{label}</label>
                            <textarea
                              id={name}
                              name={name}
                              maxLength={3000}
                              required
                            />
                          </div>
                        ))}
                      </fieldset>
                    )}
                    <p className="notice text-xs">
                      Submitting makes this version immutable and supersedes
                      prior pending approvals. Desired outcomes are not
                      guarantees. Both parties must approve this exact revision.
                    </p>
                    <Button>Submit immutable proposal</Button>
                  </ActionForm>
                </details>
              )}
            </div>
          )}
          {tab === "milestones" && (
            <MilestoneView
              db={db}
              id={id}
              role={role}
              latest={latest}
              accepted={project.accepted_version_id}
              status={project.status}
            />
          )}
          {tab === "calendar" && (
            <CalendarView db={db} userId={user.id} e={id} />
          )}
          {tab === "reputation" && (
            <ReputationView
              db={db}
              id={id}
              role={role}
              userId={user.id}
              accepted={project.accepted_version_id}
              status={project.status}
              isDemo={project.is_demo}
            />
          )}
          {tab === "files" && (
            <FileList
              key={visibility}
              files={(files || []).map((f) => ({
                ...f,
                preview:
                  fileExtras?.[0].data
                    ?.find(
                      (t: { attachment_id: string; content: string }) =>
                        t.attachment_id === f.id,
                    )
                    ?.content.slice(0, 2000) ?? null,
              }))}
              id={id}
              visibility={visibility}
              submissions={fileExtras?.[1].data || []}
            />
          )}
          {tab === "credits" && agent.summary && creditData && (
            <CreditView
              key={visibility}
              id={id}
              visibility={visibility}
              summary={agent.summary}
              ledger={creditData[0].data || []}
              usage={creditData[1].data || []}
              purchases={creditData[2].data || []}
              userId={user.id}
              topupAmounts={policy.data?.supported_topups || []}
            />
          )}
          {tab === "overview" && (
            <div className="stack">
              <section className="panel">
                <h2>Evidence-linked overview</h2>
                <p className="muted mt-3">
                  Discussed and proposed information is distinct from accepted
                  commitments. This summary is not an agreement.
                </p>
                {parsedSummary.success ? (
                  <>
                    <p className="muted text-xs mt-3">
                      Last successful refresh:{" "}
                      {new Date(
                        summaryRun.data!.finished_at ||
                          summaryRun.data!.created_at,
                      ).toLocaleString("en-GB", { timeZone: "UTC" })}{" "}
                      UTC
                    </p>
                    <AgentAdvice id={id} result={parsedSummary.data} />
                  </>
                ) : (
                  <p className="mt-4">No successful summary refresh yet.</p>
                )}
              </section>
              {agent.summary && (
                <AgentPanel
                  key="overview-shared"
                  engagementId={id}
                  visibility="shared"
                  availableNano={agent.summary.availableNano}
                  budgetNano={agent.budgetNano}
                  setupReason={agent.setupReason}
                  runs={agent.runs}
                  userId={user.id}
                  defaultMode="summary"
                />
              )}
            </div>
          )}
          {tab === "payments" && (
            <section className="panel">
              <p className="eyebrow mb-3">Payment setup required</p>
              <h2>Professional payments</h2>
              <p className="muted mt-4">
                PayPal seller onboarding and verified sandbox checkout are not
                available yet. The client pays the agreed amount; the
                professional bears a 1% platform fee plus separate PayPal
                processing fees. No payment or refund is simulated.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
