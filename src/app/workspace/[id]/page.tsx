import { ConversationFindings } from "@/components/conversation-findings";
import { z } from "zod";
import { after } from "next/server";
import { ContractView } from "@/components/contract-view";
import { processQueuedAssessment, recoverExpiredAssessments } from "@/lib/ai/scope-monitor";
export const maxDuration = 120;
import { FileList } from "@/components/file-list";
import { ReputationView } from "@/components/reputation-view";
import { CalendarView } from "@/components/calendar-view";
import { IndividualMilestones } from "@/components/individual-milestones";
import { MilestoneProposal } from "@/components/milestone-proposal";
import { ActiveMilestonePreview } from "@/components/active-milestone-preview";
import { AgentPanel, AgentAdvice } from "@/components/agent-panel";
import { CreditView } from "@/components/credit-view";
import { agentView } from "@/lib/ai/view";
import { agentResultSchema } from "@/lib/ai/contracts";
import { ActionForm } from "@/components/action-form";
import { ThreadedMessages } from "@/components/threaded-messages";
import { DiscussionReadTracker } from "@/components/discussion-read-tracker";
import { MessageAttachmentPicker } from "@/components/message-attachment-picker";
import { DiscussionScroll } from "@/components/discussion-scroll";
import { ConcernView } from "@/components/concern-view";
import { PaymentView } from "@/components/payment-view";
import Link from "next/link";
import {
  MessageSquare,
} from "lucide-react";
import { workspaceData } from "@/lib/workspace-data";
import { Button } from "@/components/ui/button";
import { formatTokens } from "@/lib/ai/pricing";
const tabs = [
  "discussion",
  "milestones",
  "contract",
  "files",
  "calendar",
  "concerns",
  "payments",
  "credits",
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
    mail?: string;
    message?: string;
    page?: string;
    version?: string;
    checkout?: string;
    cancelled?: string;
    ledger_page?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { db, user, project, members, role, identities } = await workspaceData(id);
  const tab = query.tab === "agreement" || query.tab === "milestones"
    ? "milestones"
    : query.tab === "reputation"
      ? "discussion"
      : tabs.includes(query.tab || "") ? query.tab! : "discussion";
  const visibility = query.context === "private" ? role : "shared";
  const pageNumber = Math.min(
    1000,
    Math.max(0, Number.parseInt(query.page || "0", 10) || 0),
  );
  const [
    invitationResult,
    agent,
    policy,
    summaryRun,
    messagesResult,
    filesResult,
    readResult,
  ] = await Promise.all([
    tab === "discussion" && members.length < 2
      ? db
          .from("invitations")
          .select("id,email,role,expires_at")
          .eq("engagement_id", id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("expires_at", { ascending: false })
          .limit(1)
      : { data: [] },
    ["discussion", "milestones", "credits"].includes(tab)
      ? agentView(db, id, tab === "milestones" ? "shared" : visibility)
      : { summary: null, budgetNano: null, setupReason: null, runs: [], conversation: [] },
    tab === "credits"
      ? db
          .from("credit_policy_versions")
          .select("supported_topups")
          .eq("enabled", true)
          .single()
      : { data: null },
    tab === "discussion"
      ? db
          .from("agent_runs")
          .select("result,created_at,finished_at")
          .eq("engagement_id", id)
          .eq("visibility", "shared")
          .eq("status", "succeeded")
          .eq("result->>kind", "summary")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null },
    tab === "discussion"
      ? db
          .from("messages")
          .select("*")
          .eq("engagement_id", id)
          .eq("visibility", visibility)
          .eq("channel", "discussion")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(pageNumber * 200, pageNumber * 200 + 199)
      : { data: [], error: null },
    tab === "discussion" || tab === "files"
      ? db
          .from("attachments")
          .select("*")
          .eq("engagement_id", id)
          .eq("visibility", visibility)
          .eq("upload_status", "ready")
          .order("created_at", { ascending: false })
          .limit(1000)
      : { data: [] },
    tab === "discussion"
      ? db
          .from("discussion_reads")
          .select("last_read_at")
          .eq("engagement_id", id)
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null },
  ]);
  const pendingInvitations = invitationResult.data;
  const invitationError = "error" in invitationResult ? invitationResult.error : null;
  const recentMessages = messagesResult.data;
  const messagesError = messagesResult.error;
  const files = filesResult.data;
  const read = readResult.data;
  const parsedSummary = agentResultSchema.safeParse(summaryRun.data?.result);
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
              "id,status,charge_nano,usage_uncertain,created_at",
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
  let messages = recentMessages || [];
  let agentEvidenceMessage: { id: string; kind: string; body: string; created_at: string; author_id: string } | null = null;
  if (tab === "discussion" &&
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
    if (target.data?.channel === "agent") agentEvidenceMessage = target.data;
    else if (target.data)
      messages = [...messages, target.data].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
  }
  const milestoneEvents = tab === "discussion" && visibility === "shared" && messages.length
    ? await db.from("milestone_events").select("message_id,milestone_id,version_id,event").in("message_id", messages.map(m => m.id))
    : { data: [] };
  const fileIds = (files || []).map((f) => f.id);
  const [assessmentRows,pendingMonitor] = tab==="discussion" && visibility==="shared"
    ? await Promise.all([
      messages.length ? db.from("message_assessments").select("message_id,notice_message_id,status,reason,result").eq("engagement_id",id).or(`message_id.in.(${messages.map(m=>m.id).join(",")}),notice_message_id.in.(${messages.map(m=>m.id).join(",")})`).limit(100) : Promise.resolve({data:[]}),
      db.from("message_assessments").select("id").eq("engagement_id",id).in("status",["queued","running"]).limit(1).maybeSingle(),
    ]) : [{data:[]},{data:null}];
  if(pendingMonitor.data) after(async()=>{await recoverExpiredAssessments(id);await processQueuedAssessment(id);});
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
  const { count: unread } =
    tab === "discussion"
      ? await db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("engagement_id", id)
          .eq("visibility", "shared")
          .eq("channel", "discussion")
          .neq("author_id", user.id)
          .gt("created_at", read?.last_read_at || "1970-01-01T00:00:00Z")
      : { count: 0 };
  return (
        <div className="p-5 lg:p-9 max-w-6xl mx-auto">
          {["completed", "cancelled"].includes(project.status) &&
            project.accepted_version_id && tab !== "discussion" && (
              <p className="notice mb-6">
                This engagement has ended. <Link className="underline" href="?tab=discussion">View two-way feedback</Link> in Discussion.
              </p>
            )}
          {project.funding === "pending" && (
            <p className="notice mb-6">
              This engagement is a private setup draft until an admin allocates
              at least 50 shared demo AI tokens. PayPal checkout is
              not implemented; no purchase has been recorded.
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
                {visibility !== "shared" ? (agent.summary ? <AgentPanel
                  engagementId={id} visibility={visibility} availableNano={agent.summary.availableNano}
                  budgetNano={agent.budgetNano} setupReason={agent.setupReason} runs={agent.runs} userId={user.id}
                  privateChat focusedMessage={query.message}
                  attachments={files || []}
                  conversation={agent.conversation === null ? null : [...agent.conversation, ...messages, ...(agentEvidenceMessage && !agent.conversation.some(message => message.id === agentEvidenceMessage!.id) ? [agentEvidenceMessage] : [])].sort((a, b) => a.created_at.localeCompare(b.created_at))}
                /> : <p className="notice">Private assistant information could not be loaded. Refresh to retry.</p>) : (
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
                    </div>
                  )}
                  {messagesError && (
                    <p role="alert" className="notice">
                      Messages could not be loaded. Refresh to retry.
                    </p>
                  )}
                  <DiscussionScroll
                    storageKey={`discussion-scroll:${user.id}:${id}:${visibility}:${pageNumber}`}
                    initialBottom={pageNumber === 0 && !query.message}
                    focusedMessage={query.message}
                  >
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
                    milestoneEvents={milestoneEvents.data || []}
                    assessments={assessmentRows.data || []}
                  />
                  {visibility === "shared" && !query.message && pageNumber === 0 && !messagesError && !!unread && messages?.[0] && (
                    <DiscussionReadTracker engagementId={id} lastMessage={messages[0].id} />
                  )}
                  </DiscussionScroll>
                  <ActionForm actionName="message" className="mt-6" submitOnCtrlEnter={visibility === "shared"}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="visibility" value={visibility} />
                    <label htmlFor="body" className={visibility === "shared" ? "sr-only" : undefined}>
                      {visibility === "shared"
                        ? "Message"
                        : "Private note · never shown to the counterparty"}
                    </label>
                    <MessageAttachmentPicker />
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
                )}
              </div>
              <aside className="stack content-start">
                {visibility === "shared" && <ConversationFindings db={db} id={id} />}
                {visibility === "shared" && <ActiveMilestonePreview db={db} id={id} status={project.status} />}
                {visibility === "shared" && <MilestoneProposal
                  key={id}
                  engagementId={id}
                  expected={null}
                  base={null}
                  initial={[]}
                  aiUnavailable={agent.setupReason || (!agent.summary || !agent.budgetNano || BigInt(agent.summary.availableNano) < BigInt(agent.budgetNano) ? "The shared agent needs sufficient tokens to draft milestones." : null)}
                  disabled={project.funding !== "funded" || !["discussion", "active"].includes(project.status)}
                />}
                {visibility !== "shared" && <section className="panel">
                  <h3>Private conversation</h3>
                  <p className="muted text-sm my-3">Only you can read this conversation. Your assistant can use shared engagement material and your own private notes. The other party and the project agent cannot access it.</p>
                  <p className="text-sm"><strong>{formatTokens(agent.summary?.availableNano || "0")}</strong> available</p>
                  <Link className="underline text-xs" href={`?tab=credits&context=private`}>Manage this agent’s tokens</Link>
                  {agent.setupReason ? <p className="notice text-xs mt-4">{agent.setupReason}</p> : (!agent.budgetNano || BigInt(agent.summary?.availableNano || "0") < BigInt(agent.budgetNano)) && <p className="notice text-xs mt-4">This private assistant needs more tokens to continue.</p>}
                </section>}
                {visibility === "shared" && <details open={!!agentEvidenceMessage}>
                <summary className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium">{visibility === "shared" ? "Chat with the project agent" : "Your private assistant"}</summary>
                {agent.summary ? (
                  <AgentPanel
                    key={visibility}
                    engagementId={id}
                    visibility={visibility}
                    availableNano={agent.summary.availableNano}
                    budgetNano={agent.budgetNano}
                    setupReason={agent.setupReason}
                    runs={agent.runs}
                    conversation={agent.conversation && [...agent.conversation, ...(agentEvidenceMessage && !agent.conversation.some((message) => message.id === agentEvidenceMessage!.id) ? [agentEvidenceMessage] : [])].sort((a, b) => a.created_at.localeCompare(b.created_at))}
                    userId={user.id}
                  />
                ) : (
                  <div className="notice">
                    Agent token information could not be loaded. Human messages
                    remain available.
                  </div>
                )}
                {visibility === "shared" && parsedSummary.success && <details className="panel mt-3"><summary className="cursor-pointer">Project summary</summary><p className="muted text-xs mt-3">Last refreshed: {summaryRun.data?.finished_at || summaryRun.data?.created_at}. This summary is not an agreement.</p><AgentAdvice id={id} result={parsedSummary.data} /></details>}
                </details>}
                {visibility === "shared" &&
                  members.length < 2 &&
                  ["discussion", "active"].includes(project.status) && (
                    <div className="panel">
                      <h3>Invite your counterpart</h3>
                      <p className="muted text-xs my-3">
                        They will see all shared content after joining. Private
                        material stays private. With email configured, we send the invitation to their address.
                      </p>
                      {invitationError ? (
                        <p role="alert" className="notice text-sm">
                          Invitation status could not be loaded. Refresh to retry.
                        </p>
                      ) : pendingInvitations?.[0] ? (
                        <div className="border-t border-slate-200 pt-4">
                          <h4 className="font-medium">Pending invitation</h4>
                          <p className="text-sm mt-3">
                            {pendingInvitations[0].email} · expires {new Date(pendingInvitations[0].expires_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC
                          </p>
                          {query.invite && query.mail === "submitted" && (
                            <p className="notice mt-3 text-sm">Invitation to {pendingInvitations[0].email} sent.</p>
                          )}
                          {query.invite && query.mail === "unconfigured" && (
                            <p className="notice mt-3 text-sm">Email delivery is not configured. Copy and share the link below.</p>
                          )}
                          {query.invite && query.mail === "failed" && (
                            <p role="alert" className="notice mt-3 text-sm">Brevo did not accept this email. The invitation is still active; copy and share the link below.</p>
                          )}
                          {query.invite && (
                            <p className="mt-4 break-all text-xs">
                              <a className="underline" href={`/invite/${query.invite}`}>
                                {process.env.NEXT_PUBLIC_APP_URL}/invite/{query.invite}
                              </a>
                            </p>
                          )}
                          <ActionForm actionName="revoke-invite" className="mt-4">
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="invitation" value={pendingInvitations[0].id} />
                            <Button variant="outline">Revoke invitation</Button>
                          </ActionForm>
                        </div>
                      ) : (
                        <ActionForm actionName="invite" className="stack">
                          <input type="hidden" name="id" value={id} />
                          <label htmlFor="invite-email">Their email</label>
                          <input type="email" id="invite-email" name="email" required />
                          <Button variant="outline" disabled={project.funding !== "funded"}>
                            Send invitation
                          </Button>
                        </ActionForm>
                      )}
                    </div>
                  )}
              </aside>
            </div>
          )}
          {tab === "milestones" && <IndividualMilestones db={db} id={id} userId={user.id} role={role} status={project.status}
            disabled={project.funding !== "funded" || !["discussion", "active"].includes(project.status)}
            aiUnavailable={agent.setupReason || (!agent.summary || !agent.budgetNano || BigInt(agent.summary.availableNano) < BigInt(agent.budgetNano) ? "The shared agent needs sufficient tokens to draft milestones." : null)} selected={query.version} />}
          {tab === "calendar" && (
            <CalendarView db={db} userId={user.id} e={id} />
          )}
          {tab === "concerns" && (
            <ConcernView db={db} engagementId={id} role={role} status={project.status} members={members} />
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
          {tab === "discussion" && !["discussion", "active"].includes(project.status) && <ReputationView db={db} id={id} role={role} userId={user.id} accepted={project.accepted_version_id} status={project.status} isDemo={project.is_demo} />}
          {tab === "payments" && (
            <PaymentView db={db} engagementId={id} acceptedVersion={project.accepted_version_id}
              checkout={query.checkout} cancelled={query.cancelled} page={Math.min(10000, Math.max(0, Number.parseInt(query.ledger_page || "0", 10) || 0))} role={role} professionalName={identities.data?.find((party: {role: string}) => party.role === "professional")?.display_name || ""} />
          )}
          {tab === "contract" && <ContractView db={db} id={id} userId={user.id} selected={query.version}/>}
        </div>
  );
}
