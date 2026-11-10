import { z } from "zod";
import { milestoneSuggestionSchema } from "../milestones";
export const agentModeSchema = z.enum([
  "advice",
  "scope",
  "change",
  "summary",
  "meeting",
  "milestones",
]);
export const evidenceSchema = z.object({
  ref: z.string(),
  kind: z.enum(["message", "agreement", "attachment"]),
  record_id: z.uuid(),
  version: z.string(),
  body: z.string(),
  state: z.string(),
  source_visibility: z.enum(["shared", "client", "professional"]),
  excerpt: z.boolean(),
});
export type Evidence = z.infer<typeof evidenceSchema>;
const scopeDraft = z.object({
  deliverables: z.string(),
  exclusions: z.string(),
  assumptions: z.string(),
  responsibilities: z.string(),
  acceptanceCriteria: z.string(),
  priceCents: z.number().int().nonnegative().nullable(),
  currency: z.literal("USD"),
  paymentTerms: z.string(),
  schedule: z.string(),
});
export const agentResultSchema = z.object({
  answer: z.string().min(1).max(12000),
  kind: agentModeSchema,
  citations: z
    .array(
      z.object({
        ref: z.string(),
        version: z.string(),
        visibility: z.enum(["shared", "client", "professional"]),
      }),
    )
    .max(20),
  questions: z.array(z.string().max(1000)).max(12),
  proposal: z
    .object({
      title: z.string().max(200),
      description: z.string().max(10000),
      scope: scopeDraft.nullable(),
      costImpact: z.string().max(2000),
      scheduleImpact: z.string().max(2000),
      assessment: z.enum([
        "proposed",
        "already_included",
        "clarification_required",
      ]),
    })
    .nullable(),
  summary: z
    .object({
      goals: z.array(z.string()),
      currentState: z.string(),
      confirmedDecisions: z.array(z.string()),
      unansweredQuestions: z.array(z.string()),
      blockers: z.array(z.string()),
      nextActions: z.array(
        z.object({
          owner: z.enum(["client", "professional", "both"]),
          action: z.string(),
        }),
      ),
    })
    .nullable(),
});
export type AgentResult = z.infer<typeof agentResultSchema>;
export const milestoneAgentResultSchema = agentResultSchema.extend({
  milestones: z.array(milestoneSuggestionSchema).max(30).nullable(),
  proposal: z.null(),
  summary: z.null(),
});
export function validateGrounding(result: AgentResult, evidence: Evidence[]) {
  if (result.kind === "milestones" && "milestones" in result && Array.isArray(result.milestones) && result.milestones.length && !result.citations.length)
    throw new Error("Milestone descriptions require supporting evidence");
  const allowed = new Map(evidence.map((e) => [e.ref, e]));
  for (const citation of result.citations)
    if (
      allowed.get(citation.ref)?.version !== citation.version ||
      allowed.get(citation.ref)?.source_visibility !== citation.visibility
    )
      throw new Error("Unsupported evidence reference");
  if (
    ["change", "summary", "milestones"].includes(result.kind) &&
    evidence.some((e) => e.kind === "agreement" && e.state === "agreed") &&
    !result.citations.some((c) =>
      evidence.some((e) => e.ref === c.ref && e.state === "agreed"),
    )
  )
    throw new Error(
      "Scope comparisons and summaries must cite the accepted agreement",
    );
  return result;
}
export function boundedEvidence(rows: Evidence[], maxBytes = 30000) {
  let remaining = maxBytes;
  return rows.flatMap((row) => {
    if (remaining < 300) return [];
    const jsonBytes = Buffer.byteLength(
      JSON.stringify({ ...row, body: "" }),
      "utf8",
    );
    const budget = Math.max(0, remaining - jsonBytes - 100);
    if (!budget) return [];
    const source = Buffer.from(row.body, "utf8");
    let body = source.subarray(0, budget).toString("utf8");
    let item = {
      ...row,
      body,
      state: row.state,
      excerpt: row.excerpt || source.length > budget,
    };
    while (
      Buffer.byteLength(JSON.stringify(item), "utf8") > remaining &&
      body.length
    ) {
      body = body.slice(0, Math.floor(body.length * 0.8));
      item = { ...item, body, excerpt: true };
    }
    if (Buffer.byteLength(JSON.stringify(item), "utf8") > remaining) return [];
    remaining -= Buffer.byteLength(JSON.stringify(item), "utf8");
    return [item];
  });
}
export function partialAnswer(snapshot: string) {
  const match = snapshot.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/s);
  if (!match) return "";
  const raw = match[1].replace(/\\u[0-9a-fA-F]{0,3}$/, "");
  try {
    return JSON.parse('"' + raw + '"') as string;
  } catch {
    return "";
  }
}
export function resultBody(result: AgentResult) {
  return [
    result.answer,
    result.kind === "milestones" && "milestones" in result && Array.isArray(result.milestones)
      ? "Draft milestones (require human review):\n" + JSON.stringify(result.milestones)
      : "",
    result.proposal
      ? `Proposal: ${result.proposal.title}\n${result.proposal.description}\nCost impact: ${result.proposal.costImpact}\nSchedule impact: ${result.proposal.scheduleImpact}\nRequires human review and formal approval.`
      : "",
    result.questions.length ? "Questions:\n" + result.questions.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 30000);
}
