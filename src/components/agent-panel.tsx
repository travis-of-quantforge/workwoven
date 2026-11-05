"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "./ui/button";
import { ActionForm } from "./action-form";
import {
  agentResultSchema,
  agentModeSchema,
  type AgentResult,
} from "@/lib/ai/contracts";
import { formatNano } from "@/lib/ai/pricing";
import { usd } from "@/lib/domain";
type Run = {
  id: string;
  status: string;
  result: unknown;
  created_at: string;
  actor_id: string;
  partialChargeNano?: string | null;
};
function EvidenceLinks({ result, id }: { result: AgentResult; id: string }) {
  return (
    <ul className="flex flex-wrap gap-3 mt-4">
      {result.citations.map((c) => {
        const [kind, record] = c.ref.split(":");
        const tab =
          kind === "agreement"
            ? "agreement"
            : kind === "attachment"
              ? "files"
              : "discussion";
        const anchor =
          kind === "agreement"
            ? "version"
            : kind === "attachment"
              ? "file"
              : "message";
        return (
          <li key={c.ref}>
            <Link
              className="underline text-xs text-teal-800"
              href={`/workspace/${id}?tab=${tab}${c.visibility === "shared" ? "" : "&context=private"}${kind === "message" ? `&message=${record}` : ""}#${anchor}-${record}`}
            >
              {kind} ·{" "}
              {kind === "agreement"
                ? "version " + c.version
                : record.slice(0, 8)}
            </Link>
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
    <div className="mt-4">
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
  defaultMode = "advice",
}: {
  engagementId: string;
  visibility: string;
  availableNano: string;
  budgetNano: string | null;
  setupReason: string | null;
  runs: Run[];
  userId: string;
  defaultMode?: "advice" | "summary";
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<string>(defaultMode);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AgentResult | null>(null);
  const operation = useRef<string | null>(null);
  const label =
    visibility === "shared" ? "Project agent" : `Private ${visibility} agent`;
  const sufficient =
    budgetNano !== null && BigInt(availableNano) >= BigInt(budgetNano);
  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setPreview("");
    setStatus("Starting…");
    operation.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          visibility,
          mode,
          question,
          operationKey: operation.current,
          confirmedBudget: confirmed,
          maximumChargeNano: budgetNano,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "The request could not start.");
      }
      if (!response.headers.get("content-type")?.includes("ndjson")) {
        const data = await response.json();
        if (data.result) {
          setResult(agentResultSchema.parse(data.result));
          setStatus(
            data.status === "partial_offered"
              ? "Partial result: choose whether to keep it below."
              : "Previously saved result.",
          );
        } else
          setStatus(
            "This operation is already running. Refresh to check its status.",
          );
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
          if (message.type === "status") setStatus(message.message);
          if (message.type === "preview")
            setPreview(String(message.answer).slice(0, 12000));
          if (message.type === "error") throw new Error(message.message);
          if (message.type === "result") {
            setResult(agentResultSchema.parse(message.result));
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
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <p className="eyebrow">{label}</p>
      <h2 className="mt-3">Clarity, with evidence</h2>
      <p className="muted text-xs my-3">
        {visibility === "shared"
          ? "Both parties can read this interaction."
          : "Only your party can read this interaction. Shared sources are available; the other party’s private sources are excluded."}
      </p>
      <p>
        <strong>{formatNano(availableNano)}</strong>{" "}
        <span className="muted text-xs">available</span>
      </p>
      <Link
        className="underline text-xs text-teal-800"
        href={`/workspace/${engagementId}?tab=credits${visibility === "shared" ? "" : "&context=private"}`}
      >
        Manage this agent’s credits
      </Link>
      {setupReason && <p className="notice text-xs mt-4">{setupReason}</p>}
      {!setupReason && !sufficient && (
        <p className="notice text-xs mt-4">
          This balance cannot cover the maximum operation budget. Top up this
          agent to continue. Human collaboration remains available.
        </p>
      )}
      <form onSubmit={ask} className="stack mt-5">
        <div>
          <label htmlFor={`agent-mode-${visibility}`}>Help with</label>
          <select
            id={`agent-mode-${visibility}`}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setConfirmed(false);
              operation.current = null;
            }}
            disabled={busy}
          >
            {agentModeSchema.options.map((option) => (
              <option key={option} value={option}>
                {option === "scope"
                  ? "Scope draft"
                  : option === "change"
                    ? "Scope comparison / change"
                    : option === "summary"
                      ? "Overview refresh"
                      : option === "meeting"
                        ? "Meeting proposal"
                        : "Advice and questions"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`agent-question-${visibility}`}>Your question</label>
          <textarea
            id={`agent-question-${visibility}`}
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setConfirmed(false);
              operation.current = null;
            }}
            maxLength={8000}
            required
            disabled={busy}
            placeholder="What is still unclear, and what should we agree before delivery?"
          />
        </div>
        <label className="mention-option">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy || !!setupReason || !sufficient}
          />
          <span className="text-xs">
            I authorise up to{" "}
            {budgetNano ? formatNano(budgetNano) : "the configured maximum"}{" "}
            from this balance. Actual usage is charged at 2× provider cost.
          </span>
        </label>
        <Button disabled={busy || !!setupReason || !sufficient || !confirmed}>
          {busy ? "Working…" : "Ask " + label.toLowerCase()}
        </Button>
      </form>
      {status && (
        <p role="status" className="muted text-xs mt-4">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="notice mt-4 text-xs">
          {error}
        </p>
      )}
      {busy && preview && (
        <div className="mt-4">
          <p className="eyebrow">Draft preview · still generating</p>
          <p className="whitespace-pre-wrap break-words mt-3">{preview}</p>
        </div>
      )}
      {result && <AgentAdvice result={result} id={engagementId} />}
      <div className="mt-6 space-y-5">
        {runs.map((run) => {
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
              <p className="muted text-xs mt-3">
                Recommendations do not constitute approval. Use selected-content
                sharing to publish private drafts.
              </p>
              {run.status === "partial_offered" && run.actor_id === userId && (
                <ActionForm
                  actionName="partial"
                  className="mt-4 flex flex-wrap gap-3"
                >
                  <input type="hidden" name="id" value={engagementId} />
                  <input type="hidden" name="operation" value={run.id} />
                  <Button name="decision" value="keep">
                    Keep result and charge{" "}
                    {formatNano(run.partialChargeNano || 0)}
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
      <p className="muted text-xs mt-5">
        No automatic refreshes or charges. Internal application failures and
        unusable provider results are platform-funded. Low credits pause only
        this agent.
      </p>
    </section>
  );
}
