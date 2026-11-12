"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "./ui/button";
import { ActionForm } from "./action-form";
import {
  agentResultSchema,
  milestoneAgentResultSchema,
  type AgentResult,
} from "@/lib/ai/contracts";
import { formatTokens } from "@/lib/ai/pricing";
import { usd } from "@/lib/domain";
import { MessageAttachmentPicker } from "./message-attachment-picker";
import { uploadAgentAttachments } from "@/app/actions";
import { DiscussionScroll } from "./discussion-scroll";
type Run = {
  id: string;
  status: string;
  result: unknown;
  created_at: string;
  actor_id: string;
  output_message_id?: string | null;
  question_message_id?: string | null;
  failure_code?: string | null;
  partialChargeNano?: string | null;
};
function EvidenceLinks({ result, id }: { result: AgentResult; id: string }) {
  return (
    <ul className="flex flex-wrap gap-3 mt-4">
      {result.citations.map((c) => {
        const [kind, record] = c.ref.split(":");
        const tab =
          kind === "contract" ? "contract" : ["agreement","milestone"].includes(kind)
            ? "milestones"
            : ["payment","refund"].includes(kind) ? "payments"
            : kind === "attachment"
              ? "files"
              : "discussion";
        const anchor =
          kind === "contract" ? "contract-archive" : ["agreement","milestone"].includes(kind)
            ? "version"
            : kind === "attachment"
              ? "file"
              : ["payment","refund"].includes(kind) ? kind : "message";
        const SourceLink = kind === "attachment" ? "a" : Link;
        return (
          <li key={c.ref}>
            <SourceLink
              className="underline text-xs text-teal-800"
              href={kind === "attachment" ? `/api/attachments/${record}/download` : `/workspace/${id}?tab=${tab}${c.visibility === "shared" ? "" : "&context=private"}${kind === "message" ? `&message=${record}` : ["agreement","contract","milestone"].includes(kind) ? `&version=${record}` : ""}#${anchor}-${record}`}
            >
              {kind} ·{" "}
              {kind === "agreement"
                ? "version " + c.version
                : record.slice(0, 8)}
            </SourceLink>
          </li>
        );
      })}
    </ul>
  );
}
export function AgentAdvice({
  result,
  id,
}: {
  result: AgentResult;
  id: string;
}) {
  return (
    <div className="ai-text mt-4">
      <p className="whitespace-pre-wrap break-words">{result.answer}</p>
      {result.questions.length > 0 && (
        <ul className="list-disc pl-5 mt-4 space-y-2">
          {result.questions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      )}
      {result.proposal && (
        <details className="border-t border-slate-200 mt-5 pt-4">
          <summary className="font-semibold cursor-pointer">
            Proposal: {result.proposal.title}
          </summary>
          <p className="whitespace-pre-wrap mt-3">
            {result.proposal.description}
          </p>
          <p className="mt-3">
            <strong>Assessment:</strong>{" "}
            {result.proposal.assessment.replaceAll("_", " ")}
          </p>
          <p>
            <strong>Cost impact:</strong> {result.proposal.costImpact}
          </p>
          <p>
            <strong>Schedule impact:</strong> {result.proposal.scheduleImpact}
          </p>
          {result.proposal.scope && (
            <dl className="space-y-3 mt-4">
              {Object.entries(result.proposal.scope)
                .filter(([k]) => k !== "currency")
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-semibold text-xs">
                      {k.replace(/([A-Z])/g, " $1")}
                    </dt>
                    <dd className="whitespace-pre-wrap">
                      {k === "priceCents"
                        ? v === null
                          ? "Not confirmed"
                          : usd(Number(v))
                        : String(v)}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          <p className="notice text-xs mt-4">
            This is a recommendation. Cost and dates need professional
            confirmation; commitments require both parties’ formal approval.
          </p>
        </details>
      )}
      {result.summary && (
        <details className="mt-4">
          <summary className="font-semibold cursor-pointer">
            Summary and next actions
          </summary>
          <p className="mt-3">{result.summary.currentState}</p>
          {[
            ["Goals", result.summary.goals],
            ["Confirmed decisions", result.summary.confirmedDecisions],
            ["Unanswered questions", result.summary.unansweredQuestions],
            ["Blockers", result.summary.blockers],
          ].map(([label, items]) => (
            <div key={String(label)} className="mt-4">
              <h3>{String(label)}</h3>
              <ul className="list-disc pl-5">
                {(items as string[]).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
          <h3 className="mt-4">Next actions</h3>
          <ul className="list-disc pl-5">
            {result.summary.nextActions.map((a, i) => (
              <li key={i}>
                {a.owner}: {a.action}
              </li>
            ))}
          </ul>
        </details>
      )}
      <EvidenceLinks result={result} id={id} />
    </div>
  );
}
export function AgentPanel({
  engagementId,
  visibility,
  availableNano,
  budgetNano,
  setupReason,
  runs,
  userId,
  conversation = [],
  privateChat = false,
  fullChat = false,
  focusedMessage,
  attachments = [],
}: {
  engagementId: string;
  visibility: string;
  availableNano: string;
  budgetNano: string | null;
  setupReason: string | null;
  runs: Run[];
  userId: string;
  privateChat?: boolean;
  fullChat?: boolean;
  focusedMessage?: string;
  attachments?: { id: string; name: string; source_message_id: string | null }[];
  conversation?:
    | {
        id: string;
        kind: string;
        body: string;
        created_at: string;
        author_id: string;
      }[]
    | null;
}) {
  const centralChat=privateChat || fullChat;
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [sendRevision,setSendRevision]=useState(0);
  const [followingReply,setFollowingReply]=useState(false);
  const replyBaseline=useRef<string | undefined>(undefined);
  const latestChatMessage=conversation?.at(-1);
  useEffect(()=>{
    if(followingReply && !busy && latestChatMessage?.kind==="agent" && latestChatMessage.author_id===userId && latestChatMessage.id!==replyBaseline.current)setFollowingReply(false);
  },[followingReply,busy,latestChatMessage,userId]);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [submittedQuestion,setSubmittedQuestion]=useState("");
  const [submittedRunId,setSubmittedRunId]=useState<string|null>(null);
  const operation = useRef<string | null>(null);
  const label =
    visibility === "shared" ? "Project agent" : `Private ${visibility} agent`;
  const sufficient =
    budgetNano !== null && BigInt(availableNano) >= BigInt(budgetNano);
  const visibleRuns = runs.filter(run => run.status === "partial_offered" && run.actor_id === userId);
  const [fileCount,setFileCount]=useState(0);
  const uploadedMessage=useRef<string | null>(null);
  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSendRevision(value=>value+1);
    replyBaseline.current=latestChatMessage?.id;
    setFollowingReply(true);
    setError("");
    setSubmittedQuestion(question.trim() || "Please review the attached files.");
    setSubmittedRunId(null);
    setPreview("");
    setStatus("Starting…");
    operation.current ??= crypto.randomUUID();
    const form=event.currentTarget;
    const sentQuestion=question.trim() || "Please review the attached files.";
    try {
      if(fileCount && !uploadedMessage.current){
        setStatus("Uploading files…");
        const data=new FormData(form);
        data.set("engagementId",engagementId);data.set("visibility",visibility);
        const upload=await uploadAgentAttachments(data);
        if(upload.error || !upload.messageId)throw new Error(upload.error || "Upload failed.");
        uploadedMessage.current=upload.messageId;
      }
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          visibility,
          mode: "advice",
          question:sentQuestion,
          attachmentMessageId:uploadedMessage.current || undefined,
          operationKey: operation.current,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "The request could not start.");
      }
      if (!response.headers.get("content-type")?.includes("ndjson")) {
        const data = await response.json();
        if(data.runId){setSubmittedRunId(data.runId);form.reset();}
        if (data.status === "review_queued") {
          setFollowingReply(true);
          setQuestion("");
          setStatus("Discussion review queued. The result will appear here.");
          operation.current = null;
        } else if (["failed","discarded"].includes(data.status)) {
          operation.current=null;
          throw new Error("This earlier request did not complete. Send it again to start a new attempt.");
        } else if (data.result) {
          agentResultSchema.parse(data.result);
          setStatus(
            data.status === "partial_offered"
              ? "Partial result: choose whether to keep it below."
              : "Previously saved result.",
          );
        } else {
          if(data.runId)setQuestion("");
          setStatus("This operation is already running. Refresh to check its status.");
        }
        if (data.result) { setQuestion(""); operation.current = null; uploadedMessage.current=null; }
        router.refresh();
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Response stream unavailable");
      const decoder = new TextDecoder();
      let buffer = "";
      let final = false;
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), {
          stream: !chunk.done,
        });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) continue;
          const message = JSON.parse(line);
          if(message.type==="run" && message.runId){setSubmittedRunId(message.runId);setQuestion("");form.reset();}
          if (message.type === "status") setStatus(message.message);
          if (message.type === "preview")
            setPreview(String(message.answer).slice(0, 12000));
          if (message.type === "error") {
            if(message.runId)setSubmittedRunId(message.runId);
            if(message.retryable===true)operation.current=null;
            throw new Error(message.message);
          }
          if (message.type === "result") {
            agentResultSchema.parse(message.result);
            setStatus(
              message.status === "partial_offered"
                ? "Partial result: choose whether to keep it below."
                : "Saved with evidence links.",
            );
            final = true;
          }
        }
        if (chunk.done) break;
      }
      if (!final)
        throw new Error(
          "The connection ended before the result was confirmed. Refresh before retrying.",
        );
      { setQuestion(""); operation.current = null; uploadedMessage.current=null; }
      router.refresh();
    } catch (cause) {
      setFollowingReply(false);
      setQuestion(current=>current || sentQuestion);
      setError(cause instanceof Error ? cause.message : "Request failed.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const history = (
        <div
          aria-label="Agent chat history"
          className="space-y-5"
        >
          {!conversation?.length && centralChat && <p className="muted text-sm py-10 text-center">{privateChat?"Ask your private assistant a question to start the conversation.":"Ask the project agent a question to start the shared conversation."}</p>}
          {(conversation || []).map((message) => {
            const run = runs.find(
              (item) => item.output_message_id === message.id,
            );
            const failedRun=runs.find(item=>item.question_message_id===message.id && item.status==="failed");
            const isSubmittedMessage=runs.some(item=>item.id===submittedRunId && item.question_message_id===message.id);
            const inlineError=isSubmittedMessage && error ? error : failedRun ? "This request did not complete. Send it again to retry." : "";
            const parsed = agentResultSchema.safeParse(run?.result);
            const milestones = milestoneAgentResultSchema.safeParse(
              run?.result,
            );
            return (
              <article
                id={`message-${message.id}`}
                key={message.id}
                className="border-b border-slate-100 pb-4 scroll-mt-4"
              >
                <p
                  className={`text-xs font-semibold ${message.kind === "agent" ? "ai-text" : ""}`}
                >
                  {message.kind === "agent"
                    ? label
                    : message.author_id === userId
                      ? "You"
                      : "Counterparty"}
                </p>
                <time className="muted text-xs" dateTime={message.created_at}>
                  {new Date(message.created_at).toLocaleString("en-GB", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </time>
                {message.kind === "agent" && parsed.success ? (
                  <>
                    <AgentAdvice result={parsed.data} id={engagementId} />
                    {milestones.success && milestones.data.milestones && (
                      <ul className="ai-text mt-3 list-disc pl-5">
                        {milestones.data.milestones.map((milestone, index) => (
                          <li key={index}>{milestone.description}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p
                    className={`mt-3 whitespace-pre-wrap break-words text-sm ${message.kind === "agent" ? "ai-text" : ""}`}
                  >
                    {message.body}
                  </p>
                )}
                {inlineError && <p role="alert" className="notice mt-3 text-xs">{inlineError}</p>}
                {attachments.filter(file => file.source_message_id === message.id).map(file => (
                  <p key={file.id} className="mt-2 text-sm"><a className="underline" href={`/api/attachments/${file.id}/download`}>Download attachment: {file.name}</a></p>
                ))}
              </article>
            );
          })}
          {error && submittedQuestion && !runs.some(item=>item.id===submittedRunId && conversation?.some(message=>message.id===item.question_message_id)) && <article className="border-b border-slate-100 pb-4"><p className="text-xs font-semibold">You</p><p className="mt-3 whitespace-pre-wrap break-words text-sm">{submittedQuestion}</p><p role="alert" className="notice mt-3 text-xs">{error}</p></article>}
          {centralChat && busy && preview && <p className="ai-text whitespace-pre-wrap break-words">{preview}</p>}
        </div>
  );
  return (
    <section className="panel">
      <h2 className="ai-text">{privateChat ? "Your private assistant" : "Project Agent"}</h2>
      {centralChat && <p role="note" className={`my-4 rounded-lg border-2 p-4 font-semibold text-sm ${privateChat?"border-emerald-500 bg-emerald-50 text-emerald-950":"border-red-500 bg-red-50 text-red-950"}`}>{privateChat?"Private chat: only you can read this conversation. The other party cannot see your messages or attachments.":"Shared chat: both parties can read every message and attachment here. This conversation is not private."}</p>}
      {!centralChat && <p className="muted text-xs my-3">
        {visibility === "shared"
          ? "Both parties can read this interaction."
          : "Only your party can read this interaction. Shared sources are available; the other party’s private sources are excluded."}
      </p>}
      {conversation === null && (
        <p className="notice text-sm mt-4">
          Agent chat could not be loaded. Refresh to retry.
        </p>
      )}
      {(centralChat || !!conversation?.length || busy || !!error) && <DiscussionScroll
        storageKey={`${privateChat ? "private-agent" : "project-agent"}-scroll:${userId}:${engagementId}:${visibility}`}
        initialBottom={!focusedMessage} focusedMessage={focusedMessage} bottomOnOpen={fullChat}
        label={privateChat ? "Private assistant messages" : "Project agent messages"}
        sentMessageId={conversation?.filter(message=>message.author_id===userId && message.kind!=="agent").at(-1)?.id}
        scrollSignal={`${sendRevision}:${busy ? preview : ""}:${followingReply ? latestChatMessage?.id || "" : ""}`}
      >{history}</DiscussionScroll>}
      <form onSubmit={ask} className="stack mt-5" onKeyDown={event=>{
        if(event.key!=="Enter" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || !(event.target instanceof HTMLTextAreaElement))return;
        event.preventDefault();
        if(!busy && !event.repeat)event.currentTarget.requestSubmit();
      }}>
        <div>
          <label
            className="sr-only"
            htmlFor={`agent-question-${visibility}`}
          >
            {privateChat ? "Message your private assistant" : "Your question"}
          </label>
          <textarea
            id={`agent-question-${visibility}`}
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              operation.current = null;
            }}
            maxLength={8000}
            required={fileCount===0 && !uploadedMessage.current}
            disabled={busy}
            placeholder={privateChat ? "Message your private assistant…" : "Help me understand this better..."}
          />
        </div>
        <MessageAttachmentPicker agentChat disabled={busy} onFilesChange={setFileCount} onFilesSelected={()=>{uploadedMessage.current=null;operation.current=null;}}/>
        <p className="muted text-xs">Attach UTF-8 TXT or CSV files for the agent to read (up to 10 files, 20 MB total).</p>
        <Button
          disabled={busy || !!setupReason || !sufficient}
          title={
            (setupReason || !sufficient)
              ? setupReason || "This agent needs more tokens."
              : undefined
          }
        >
          {busy ? "Working…" : "Send"}
        </Button>
      </form>
      {status && (busy || status.startsWith("Partial")) && (
        <p role="status" className="muted text-xs mt-4">
          {status}
        </p>
      )}
      {visibleRuns.length > 0 && (
        <div className="mt-6 space-y-5">
          {visibleRuns.map((run) => {
            const parsed = agentResultSchema.safeParse(run.result);
            return (
              <details key={run.id} className="border-t border-slate-200 pt-4">
                <summary className="cursor-pointer text-sm">
                  {run.status.replaceAll("_", " ")} ·{" "}
                  {new Date(run.created_at).toLocaleString("en-GB", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </summary>
                {parsed.success && (
                    <AgentAdvice result={parsed.data} id={engagementId} />
                  )}
                {run.status === "partial_offered" &&
                  run.actor_id === userId && (
                    <ActionForm
                      actionName="partial"
                      className="mt-4 flex flex-wrap gap-3"
                    >
                      <input type="hidden" name="id" value={engagementId} />
                      <input type="hidden" name="operation" value={run.id} />
                      <Button name="decision" value="keep">
                        Keep result and charge{" "}
                        {formatTokens(run.partialChargeNano || 0)}
                      </Button>
                      <Button name="decision" value="discard" variant="outline">
                        Discard without charge
                      </Button>
                    </ActionForm>
                  )}
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
