import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConversationFindings } from "./conversation-findings";
import { conversationReviewSchema } from "@/lib/ai/conversation-checks";
import {assessmentPresentation,currentAssessmentState} from "@/lib/assessment-presentation";
import { Button } from "./ui/button";
import { CopyMessageId } from "./copy-message-id";
import { ActionSubmitButton } from "./action-form";
import { ActionForm } from "./action-form";
import type { Assessment } from "@/lib/ai/scope-monitor";
import { EvidenceLinkHelp } from "./evidence-link-help";
type MessageAssessment = {
  id: string;
  message_id: string;
  retry_message_id?: string | null;
  notice_message_id: string | null;
  status: string;
  reason: string | null;
  created_at?: string;
  finished_at?: string | null;
  result: (Assessment & { review?: unknown }) | null;
};
type Message = {
  id: string;
  author_id: string;
  kind: string;
  body: string;
  created_at: string;
  reply_to: string | null;
};
type Member = { user_id: string; role: string };
export async function ThreadedMessages({
  db,
  messages,
  engagementId,
  visibility,
  userId,
  members,
  files,
  milestoneEvents = [],
  assessments = [],
}: {
  db: SupabaseClient;
  messages: Message[];
  engagementId: string;
  visibility: string;
  userId: string;
  members: Member[];
  milestoneEvents?: {
    message_id: string;
    milestone_id: string;
    version_id: string;
    event: string;
  }[];
  assessments?: MessageAssessment[];
  files: { id: string; name: string; source_message_id: string | null }[];
}) {
  const currentFindings=visibility==="shared" && assessments.length
    ? await db.from("conversation_findings").select("id,issue_key,status,updated_at").eq("engagement_id",engagementId).limit(100)
    : {data:[],error:null};
  const ids = new Set(messages.map((m) => m.id));
  function card(m: Message) {
    const milestoneEvent = milestoneEvents.find(
      (event) => event.message_id === m.id,
    );
    const assessment = assessments.find((a) => (a.retry_message_id || a.message_id) === m.id);
    const review=conversationReviewSchema.safeParse(assessment?.result?.review);
    const current=assessment?currentAssessmentState(assessment,currentFindings.error?[]:currentFindings.data || []):null;
    const presentation=assessment?assessmentPresentation(current?.check || assessment):null;
    const SummaryContainer=current?.cleared?"details":"div";
    return (
      <article
        key={m.id}
        id={`message-${m.id}`}
        className="border-b border-slate-100 pb-5 scroll-mt-5"
      >
        <div className="flex flex-wrap gap-3 items-center mb-2">
          <span
            className={`font-semibold text-xs ${m.kind === "agent" ? "ai-text" : ""}`}
          >
            {m.kind === "agent"
              ? visibility === "shared"
                ? "Project agent"
                : `Private ${visibility} agent`
              : m.author_id === userId
                ? "You"
                : members.find((x) => x.user_id === m.author_id)?.role ||
                  "Participant"}
          </span>
          <span className="badge">
            {m.kind === "share" ? "Shared copy" : m.kind}
          </span>
          <time className="muted text-[11px]" dateTime={m.created_at}>
            {new Date(m.created_at).toLocaleString("en-GB", {
              timeZone: "UTC",
            })}{" "}
            UTC
          </time>
          <span className="inline-flex items-center gap-1">
          <CopyMessageId id={m.id} />
          <EvidenceLinkHelp />
          </span>
        </div>
        <p className={`whitespace-pre-wrap break-words ${m.kind === "agent" ? "ai-text" : ""}`}>{m.body}</p>
        {assessment && (
          <details className={`mt-2 rounded-lg border p-3 text-xs ai-text ${presentation!.className}`}>
            <summary className="cursor-pointer">
              <span className="font-semibold">{current?.label || presentation!.label}</span> · Conversation check ·{" "}
              {current?.cleared ? "updated" : assessment.status === "checked"
                ? assessment.reason === "unchanged_context" ? "already reviewed" : "complete"
                : assessment.status}
            </summary>
            {(assessment.finished_at || assessment.created_at) && <p className="mt-2"><time dateTime={assessment.finished_at || assessment.created_at}>{assessment.finished_at?(["checked","flagged"].includes(assessment.status)?"Assessed":"Last attempt"):(["checked","flagged"].includes(assessment.status)?"Recorded":"Queued")} {new Date((assessment.finished_at || assessment.created_at)!).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</time></p>}
            {currentFindings.error && <p className="notice mt-2">Current issue status is unavailable; showing the original assessment.</p>}
            {current?.cleared && <p className="mt-2 font-semibold">The earlier concerns have been resolved or dismissed. This does not change approved commitments.</p>}
            {current?.updatedAt && <p className="mt-2">Issue status updated <time dateTime={current.updatedAt}>{new Date(current.updatedAt).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</time></p>}
            <SummaryContainer className="mt-2">
              {current?.cleared && <summary className="cursor-pointer">Original assessment</summary>}
              <p>{assessment.result?.summary ||
                (
                  {
                    unchanged_context: "This discussion context has already been reviewed.",
                    coalesced: "This message was included in a later discussion review.",
                    incomplete_coverage: "The review covered only part of the available discussion. Ask the project agent about any missing context.",
                    no_accepted_terms:
                      "No accepted contract or milestones to compare yet.",
                    paused: "Automatic checks are paused.",
                    credits_unavailable:
                      "This check could not run because the project agent has no available balance.",
                    daily_budget:
                      "The daily check budget has been reached.",
                    daily_limit:
                      "The daily automatic check limit has been reached.",
                    rate_limit:
                      "Automatic checks are temporarily rate limited.",
                    ai_unavailable:
                      "AI is not configured for this environment.",
                    terms_changed:
                      "Accepted terms changed. Ask the project agent for a fresh assessment.",
                    context_too_large:
                      "The complete accepted terms exceed the automatic context limit. Ask the project agent for a focused review.",
                  } as Record<string, string>
                )[assessment.reason || ""] ||
                (assessment.status === "failed"
                  ? "This check could not finish. Retry to assess this message again."
                  : assessment.status === "checked"
                    ? "No actionable concerns found in the available shared discussion."
                    : assessment.status === "queued" ? "Waiting to review this message."
                    : assessment.status === "running" ? "Reviewing this message against the shared discussion and agreement."
                    : assessment.status === "flagged" ? "A concern was identified. See its explanation and evidence below."
                    : "This check did not complete. Retry when the project agent is available.")}
              </p>
            </SummaryContainer>
            {review.success && review.data.findings.length>0 && <ConversationFindings db={db} id={engagementId} assessmentId={assessment.id} review={review.data} />}
            {!review.success && assessment.result?.issues?.map((issue,index)=>{
              if(typeof issue?.termRef!=="string")return null;
              const [kind,record]=issue.termRef.split(":");
              const href=kind==="contract"?`/workspace/${engagementId}?tab=contract&version=${record}`:`/workspace/${engagementId}?tab=milestones&version=${record}`;
              return <section key={index} className="mt-3 border-t pt-3"><blockquote className="border-l-2 pl-3">{issue.messageQuote}</blockquote><p className="mt-2">{issue.explanation}</p><blockquote className="border-l-2 pl-3 mt-2">{issue.termQuote}</blockquote><Link className="underline" href={href}>View accepted {kind==="contract"?"contract":"milestone"} version</Link></section>;
            })}
            {["failed","skipped","stale"].includes(assessment.status) && <ActionForm actionName="retry-conversation-check" className="mt-2">
              <input type="hidden" name="id" value={engagementId}/><input type="hidden" name="message" value={m.id}/>
              <ActionSubmitButton variant="outline" pendingLabel="Queuing retry…">Retry check</ActionSubmitButton>
            </ActionForm>}
          </details>
        )}
        {milestoneEvent && (
          <Link
            className="inline-flex rounded-lg border border-teal-700 px-4 py-2 mt-3 text-sm font-medium text-teal-900"
            href={`/workspace/${engagementId}?tab=milestones&version=${milestoneEvent.version_id}#milestone-${milestoneEvent.milestone_id}`}
          >
            View milestone ·{" "}
            {milestoneEvent.event === "accepted"
              ? "accepted version"
              : "review proposal"}
          </Link>
        )}
        {files
          .filter((f) => f.source_message_id === m.id)
          .map((f) => (
            <a
              key={f.id}
              className="underline text-sm block mt-3"
              href={`/api/attachments/${f.id}/download`}
            >
              Download attachment: {f.name}
            </a>
          ))}
      </article>
    );
  }
  return (
    <div className="space-y-6">
      {messages
        .filter((m) => !m.reply_to || !ids.has(m.reply_to))
        .map((root) => (
          <section key={root.id}>
            {root.reply_to && (
              <p className="muted text-xs mb-2">Reply to an earlier message</p>
            )}
            {card(root)}
            <div className="ml-4 pl-4 border-l-2 border-teal-100 space-y-4 mt-4">
              {messages.filter((m) => m.reply_to === root.id).map(card)}
            </div>
            {!root.reply_to && (
              <details className="mt-3">
                <summary className="text-xs text-teal-800 cursor-pointer">
                  Reply in thread
                </summary>
                <ActionForm actionName="message" className="mt-3 stack">
                  <input type="hidden" name="id" value={engagementId} />
                  <input type="hidden" name="visibility" value={visibility} />
                  <input type="hidden" name="parent" value={root.id} />
                  <label htmlFor={`reply-${root.id}`}>
                    Reply to this message
                  </label>
                  <textarea
                    id={`reply-${root.id}`}
                    name="body"
                    maxLength={30000}
                    required
                  />
                  <Button>Send reply</Button>
                </ActionForm>
              </details>
            )}
          </section>
        ))}
    </div>
  );
}
