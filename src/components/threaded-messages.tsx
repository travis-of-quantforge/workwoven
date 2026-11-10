import Link from "next/link";
import { Button } from "./ui/button";
import { ActionForm } from "./action-form";
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
}: {
  messages: Message[];
  engagementId: string;
  visibility: string;
  userId: string;
  members: Member[];
  milestoneEvents?: { message_id: string; milestone_id: string; version_id: string; event: string }[];
  files: { id: string; name: string; source_message_id: string | null }[];
}) {
  const ids = new Set(messages.map((m) => m.id));
  function card(m: Message) {
    const milestoneEvent = milestoneEvents.find(event => event.message_id === m.id);
    return (
      <article
        key={m.id}
        id={`message-${m.id}`}
        className="border-b border-slate-100 pb-5 scroll-mt-5"
      >
        <div className="flex flex-wrap gap-3 items-center mb-2">
          <span className={`font-semibold text-xs ${m.kind === "agent" ? "ai-text" : ""}`}>
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
        <p className={`whitespace-pre-wrap break-words ${m.kind === "agent" ? "ai-text" : ""}`}>{m.body}</p>
        {milestoneEvent && <Link className="inline-flex rounded-lg border border-teal-700 px-4 py-2 mt-3 text-sm font-medium text-teal-900" href={`/workspace/${engagementId}?tab=milestones&version=${milestoneEvent.version_id}#milestone-${milestoneEvent.milestone_id}`}>View milestone · {milestoneEvent.event === "accepted" ? "accepted version" : "review proposal"}</Link>}
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
