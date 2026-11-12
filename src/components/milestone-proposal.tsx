"use client";
import { cleanMilestoneText } from "@/lib/milestones";
import { useActionState, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ZodError } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { AgentAdvice } from "./agent-panel";
import { workspaceFormAction } from "@/app/actions";
import { milestoneAgentResultSchema } from "@/lib/ai/contracts";
import type { AgentResult } from "@/lib/ai/contracts";

export type MilestoneRow = {
  description: string;
  amountUsd: string;
  targetDate: string;
  acceptanceCriteria: string;
  responsibilities: string;
};
type Row = MilestoneRow;
const empty = (): Row => ({
  description: "",
  amountUsd: "",
  targetDate: "",
  acceptanceCriteria: "",
  responsibilities: "",
});
export function MilestoneProposal({
  engagementId,
  expected,
  base,
  initial,
  aiUnavailable,
  disabled,
  milestoneId,
  triggerLabel = "Propose milestones",
}: {
  engagementId: string;
  expected: string | null;
  base: string | null;
  initial: Row[];
  aiUnavailable: string | null;
  disabled: boolean;
  milestoneId?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [empty()]);
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    async (previous: { error: string; success: boolean }, form: FormData) => {
      const result = await workspaceFormAction(previous, form);
      if (result.success) {
        setOpen(false);
        setSubmissionKey(crypto.randomUUID());
        if (!milestoneId) setRows([empty()]);
      }
      return result;
    },
    { error: "", success: false },
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [advice, setAdvice] = useState<AgentResult | null>(null);
  const operation = useRef<string | null>(null);
  function edit(index: number, field: keyof Row, value: string) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }
  async function generate() {
    setBusy(true);
    setError("");
    setStatus("Reading the shared discussion…");
    operation.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          visibility: "shared",
          mode: "milestones",
          operationKey: operation.current,
          question:
            "Draft detailed milestones from our shared discussion, all readable shared attachments, and accepted terms. Populate deliverables in description, testable acceptanceCriteria and client responsibilities. Preserve documented release boundaries and delivery conditions. Keep source IDs out of the editable fields; use citations separately. Do not invent requirements, amounts or deadlines. Flag unresolved details as questions.",
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error ||
            "Milestone drafting could not start.",
        );
      let result: unknown;
      let resultStatus = "";
      if (response.headers.get("content-type")?.includes("ndjson")) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value || new Uint8Array(), {
            stream: !chunk.done,
          });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "status") setStatus(event.message);
            if (event.type === "result") {
              result = event.result;
              resultStatus = event.status;
            }
          }
          if (chunk.done) break;
        }
      } else {
        const saved = await response.json();
        result = saved.result;
        resultStatus = saved.status;
      }
      if (resultStatus === "partial_offered")
        throw new Error(
          "A partial result is available. Review the keep/discard decision in the project agent chat before using it.",
        );
      if (resultStatus !== "succeeded" || !result)
        throw new Error(
          "No completed draft yet. Retry to check this operation without another charge.",
        );
      // Older saved drafts contained descriptions only.
      const legacy=result as {milestones?: {description:string;acceptanceCriteria?:string|null;responsibilities?:string|null}[]};
      const parsed = milestoneAgentResultSchema.parse({...legacy,milestones:legacy.milestones?.map(row=>({...row,acceptanceCriteria:row.acceptanceCriteria ?? null,responsibilities:row.responsibilities ?? null})) ?? null});
      setAdvice(parsed);
      const suggestions = parsed.milestones || [];
      if (suggestions.length)
        setRows((current) =>
          suggestions.map((row) => ({
            ...empty(),
            description: cleanMilestoneText(row.description),
            acceptanceCriteria: cleanMilestoneText(row.acceptanceCriteria || ""),
            responsibilities: cleanMilestoneText(row.responsibilities || ""),
            amountUsd:
              current.find(
                (prior) => prior.description.trim() === row.description.trim(),
              )?.amountUsd || "",
            targetDate:
              current.find(
                (prior) => prior.description.trim() === row.description.trim(),
              )?.targetDate || "",
          })),
        );
      setStatus(
        suggestions.length
          ? "Milestone details drafted. Review criteria and responsibilities, then enter amounts and deadlines before proposing them."
          : "More information is needed. Review the questions below.",
      );
      operation.current = null;
    } catch (cause) {
      setStatus("");
      setError(
        cause instanceof ZodError || cause instanceof TypeError
          ? "The milestone draft could not be read. Refresh the page and try again."
          : cause instanceof Error
            ? cause.message
            : "Drafting failed.",
      );
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy && !pending) {
          setOpen(value);
          if (value && milestoneId) setRows(initial);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          disabled={disabled}
          className={milestoneId ? undefined : "w-full"}
        >
          {triggerLabel}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
          <Dialog.Title className="text-xl font-semibold">
            {triggerLabel}
          </Dialog.Title>
          <Dialog.Description className="muted mt-3 text-sm">
            Describe the work, its completion price and target deadline. Payment
            is due on client acceptance of milestone completion. Both parties
            must approve the same version of each milestone. Submitting records
            your approval; your counterpart must accept it.
          </Dialog.Description>
          {!milestoneId && (
            <div className="my-5 space-y-3">
              <Button
                variant="outline"
                onClick={generate}
                disabled={busy || pending || !!aiUnavailable}
              >
                {busy
                  ? "Creating suggestions…"
                  : "Create milestones from discussion"}
              </Button>
              {aiUnavailable && (
                <p className="muted text-xs">{aiUnavailable}</p>
              )}
              {status && (
                <p role="status" className="text-sm">
                  {status}
                </p>
              )}
              {error && (
                <p role="alert" className="notice text-sm">
                  {error}
                </p>
              )}
              {advice && (
                <details>
                  <summary className="cursor-pointer text-sm">
                    AI suggestions and evidence
                  </summary>
                  <AgentAdvice result={advice} id={engagementId} />
                </details>
              )}
            </div>
          )}
          <form action={action} className="stack">
            <input type="hidden" name="_action" value="individual-milestones" />
            <input type="hidden" name="id" value={engagementId} />
            <input type="hidden" name="expected" value={expected || ""} />
            <input type="hidden" name="milestone" value={milestoneId || ""} />
            <input type="hidden" name="operationKey" value={submissionKey} />
            <input
              type="hidden"
              name="milestones"
              value={JSON.stringify(rows)}
            />
            <fieldset disabled={busy || pending} className="stack">
              {rows.map((row, index) => (
                <fieldset
                  key={index}
                  className="stack rounded-lg border border-slate-200 p-4"
                >
                  <legend className="px-2 font-semibold">
                    Milestone {index + 1}
                  </legend>
                  <label htmlFor={`milestone-description-${index}`}>
                    Description
                  </label>
                  <textarea
                    className={advice ? "ai-text" : undefined}
                    id={`milestone-description-${index}`}
                    value={row.description}
                    onChange={(event) =>
                      edit(index, "description", event.target.value)
                    }
                    required
                    maxLength={5000}
                  />
                  <label htmlFor={`milestone-criteria-${index}`}>
                    Acceptance criteria
                  </label>
                  <textarea
                    id={`milestone-criteria-${index}`}
                    value={row.acceptanceCriteria}
                    onChange={(event) =>
                      edit(index, "acceptanceCriteria", event.target.value)
                    }
                    required
                    maxLength={5000}
                  />
                  <label htmlFor={`milestone-responsibilities-${index}`}>
                    Client responsibilities (optional)
                  </label>
                  <textarea
                    id={`milestone-responsibilities-${index}`}
                    value={row.responsibilities}
                    onChange={(event) =>
                      edit(index, "responsibilities", event.target.value)
                    }
                    maxLength={5000}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`milestone-price-${index}`}>
                        Amount on completion (USD)
                      </label>
                      <input
                        id={`milestone-price-${index}`}
                        type="number"
                        min="0"
                        max="1000000"
                        step="0.01"
                        value={row.amountUsd}
                        onChange={(event) =>
                          edit(index, "amountUsd", event.target.value)
                        }
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor={`milestone-deadline-${index}`}>
                        Target deadline
                      </label>
                      <input
                        id={`milestone-deadline-${index}`}
                        type="date"
                        value={row.targetDate}
                        onChange={(event) =>
                          edit(index, "targetDate", event.target.value)
                        }
                        required
                      />
                    </div>
                  </div>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove milestone {index + 1}
                    </Button>
                  )}
                </fieldset>
              ))}
              {!milestoneId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRows((current) => [...current, empty()])}
                  disabled={rows.length >= 30}
                >
                  Add milestone
                </Button>
              )}
              {base && (
                <div>
                  <label htmlFor="milestone-revision-reason">
                    Reason for revision
                  </label>
                  <textarea
                    id="milestone-revision-reason"
                    name="reason"
                    required
                    maxLength={3000}
                  />
                </div>
              )}
              {state.error && (
                <p role="alert" className="notice text-sm">
                  {state.error}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button disabled={pending}>
                  {pending
                    ? "Submitting…"
                    : milestoneId
                      ? triggerLabel === "Propose amendment"
                        ? "Submit and approve amendment"
                        : "Submit and approve revision"
                      : "Submit and approve proposals"}
                </Button>
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
              </div>
            </fieldset>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
