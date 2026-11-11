import Link from "next/link";
import { Button } from "./ui/button";
import { ActionForm } from "./action-form";
import type { Assessment } from "@/lib/ai/scope-monitor";
type MessageAssessment = {
  message_id: string;
  notice_message_id: string | null;
  status: string;
  reason: string | null;
  result: Assessment | null;
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
export function ThreadedMessages({
  messages,
  engagementId,
  visibility,
  userId,
  members,
  files,
  milestoneEvents = [],
  assessments = [],
}: {
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
  const ids = new Set(messages.map((m) => m.id));
  function card(m: Message) {
    const milestoneEvent = milestoneEvents.find(
      (event) => event.message_id === m.id,
    );
    const assessment = assessments.find((a) => a.message_id === m.id);
    const notice = assessments.find(
      (a) => a.notice_message_id === m.id && a.status === "flagged",
    );
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
          <Link
            className="muted text-xs underline"
            href={`?tab=discussion${visibility === "shared" ? "" : "&context=private"}&message=${m.id}#message-${m.id}`}
          >
            Evidence link
          </Link>
        </div>
        {notice?.result ? (
          <div className="ai-text rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="font-semibold">Potential scope or contract issue</h3>
            <p className="mt-2">{notice.result.summary}</p>
            <p className="text-xs mt-2">
              AI advice for both parties to review. No agreement has been
              changed.
            </p>
            {notice.result.issues.map((issue, index) => {
              const [kind, record] = issue.termRef.split(":");
              const href =
                kind === "contract"
                  ? `/workspace/${engagementId}?tab=contract&version=${record}#contract-archive-${record}`
                  : `/workspace/${engagementId}?tab=milestones&version=${record}`;
              return (
                <section
                  key={index}
                  className="mt-4 border-t border-blue-200 pt-3"
                >
                  <Link
                    className="underline text-sm"
                    href={`?tab=discussion&message=${notice.message_id}#message-${notice.message_id}`}
                  >
                    Quoted message
                  </Link>
                  <blockquote className="border-l-2 border-blue-400 pl-3 my-2 whitespace-pre-wrap break-words">
                    <mark className="bg-amber-100 text-blue-900">
                      {issue.messageQuote}
                    </mark>
                  </blockquote>
                  <p className="whitespace-pre-wrap">{issue.explanation}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm">
                      Accepted term cited
                    </summary>
                    <blockquote className="whitespace-pre-wrap border-l-2 pl-3 mt-2">
                      {issue.termQuote}
                    </blockquote>
                    <Link className="underline text-sm" href={href}>
                      View accepted{" "}
                      {kind === "contract" ? "contract" : "milestone"} version
                    </Link>
                  </details>
                </section>
              );
            })}
          </div>
        ) : (
          <p
            className={`whitespace-pre-wrap break-words ${m.kind === "agent" ? "ai-text" : ""}`}
          >
            {m.body}
          </p>
        )}
        {assessment && (
          <details className="mt-2 text-xs muted">
            <summary className="cursor-pointer">
              Scope check ·{" "}
              {assessment.status === "checked"
                ? assessment.result?.isRequest
                  ? "assessed"
                  : "no request identified"
                : assessment.status}
            </summary>
            <p className="mt-2">
              {assessment.result?.summary ||
                (
                  {
                    no_accepted_terms:
                      "No accepted contract or milestones to compare yet.",
                    paused: "Automatic checks are paused.",
                    credits_unavailable:
                      "Shared AI tokens are unavailable. Human discussion remains usable.",
                    daily_budget:
                      "The automatic daily token budget has been reached.",
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
                  ? "This check failed and was not charged. Ask the project agent for a review."
                  : "Automatic checks use shared AI tokens and run after the message is sent.")}
            </p>
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
            <Link
              key={f.id}
              className="underline text-sm block mt-3"
              href={`/workspace/${engagementId}?tab=files${visibility === "shared" ? "" : "&context=private"}#file-${f.id}`}
            >
              Open attachment: {f.name}
            </Link>
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
